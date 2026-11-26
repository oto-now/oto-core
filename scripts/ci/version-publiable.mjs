// Les contrôles de contenu d'une version, joués AVANT son tag (distribution-du-paquet.md § Publication) : par `ci.yml`
// sur toute pull request qui change `version` de `packages/plateforme/package.json`, puis par le job `tag` de
// `publish.yml` à sa fusion, et de nouveau par le job `publish` sur le tag posé. Un tag posé sur un commit qui
// ne peut pas être publié ne se retire qu'à la main : l'erreur doit se voir avant.
//
// Usage :
//   node scripts/ci/version-publiable.mjs --ref <commit> --base <sha> --head <sha>   (pull request : avant le tag)
//   node scripts/ci/version-publiable.mjs --ref <commit> --tag v<x.y.z>               (publication : sur le tag)
// `--ref` : le commit publié (fusion de la pull request, ou commit du tag). Avec `--base` et `--head`, la version
// est celle du dernier commit de la pull request ; inchangée depuis le point où elle part, rien n'est contrôlé
// (code 0, aucune sortie `tag`). Sinon : la version du commit publié est celle de la pull request, son tag
// n'existe pas encore. Dans les deux cas : une seule migration ajoutée depuis le tag précédent (database-patterns.md
// § Règles, fiche D124), une section `## <version> — ` au CHANGELOG du paquet, rien sous `## Unreleased` et aucun
// fragment dans `packages/plateforme/changelog.d/` (versés par `pnpm changelog:version`). Sous GitHub Actions, écrit
// `tag=v<version>` dans `$GITHUB_OUTPUT`. Code 1 au premier contrôle en échec.
import { execFileSync } from "node:child_process"
import { appendFileSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { CHANGELOG, FRAGMENTS, lignesSousUnreleased } from "../changelog-version.mjs"

const MANIFESTE = "packages/plateforme/package.json"
const MIGRATIONS = "packages/plateforme/migrations"

const git = (depot, args) => execFileSync("git", ["-C", depot, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()

const versionA = (depot, commit) => JSON.parse(git(depot, ["show", `${commit}:${MANIFESTE}`])).version

/** Le tag `v*` le plus proche avant `ref` (premier parent), ou null. */
function tagPrecedent(depot, ref) {
  try {
    return git(depot, ["describe", "--tags", "--abbrev=0", "--match", "v*", `${ref}^`])
  } catch {
    return null
  }
}

/**
 * Le verdict d'une version : `{ etat: "inchangee", version }`, `{ etat: "publiable", tag, precedent, migrations }`
 * ou `{ etat: "refusee", raison }`.
 * @param {string} depot
 * @param {{ ref: string, base?: string, head?: string, tag?: string }} options
 */
export function controler(depot, { ref, base, head, tag }) {
  const version = versionA(depot, ref)
  if (base && head) {
    const avant = versionA(depot, git(depot, ["merge-base", base, head]))
    const apres = versionA(depot, head)
    if (avant === apres) return { etat: "inchangee", version: apres }
    if (version !== apres) return { etat: "refusee", raison: `le commit publié porte ${version}, la pull request ${apres}` }
    if (git(depot, ["tag", "--list", `v${version}`])) return { etat: "refusee", raison: `le tag v${version} existe déjà` }
  } else if (tag !== `v${version}`) {
    return { etat: "refusee", raison: `tag ${tag}, paquet v${version}` }
  }

  const precedent = tagPrecedent(depot, ref)
  const migrations = precedent
    ? git(depot, ["diff", "--name-only", "--diff-filter=A", precedent, ref, "--", MIGRATIONS]).split("\n").filter((f) => f.endsWith(".sql"))
    : []
  if (migrations.length > 1) {
    return { etat: "refusee", raison: `${migrations.length} migrations ajoutées depuis ${precedent} : les réunir en un seul <horodatage>_vX_Y_Z.sql (scripts/reunir-migrations.mjs)` }
  }
  const changelog = git(depot, ["show", `${ref}:${CHANGELOG}`])
  if (!changelog.split("\n").some((ligne) => ligne.startsWith(`## ${version} — `))) {
    return { etat: "refusee", raison: `CHANGELOG : aucune section « ## ${version} — <date> »` }
  }
  // Une ligne restée sous `## Unreleased` ou dans un fragment partirait annoncée par la version suivante, pas par celle-ci.
  if (lignesSousUnreleased(changelog.split("\n")).some((ligne) => ligne.trim())) {
    return { etat: "refusee", raison: `CHANGELOG : des lignes restent sous « ## Unreleased » : pnpm changelog:version ${version}` }
  }
  const fragments = git(depot, ["ls-tree", "--name-only", ref, `${FRAGMENTS}/`]).split("\n").filter((f) => f.endsWith(".md"))
  if (fragments.length) {
    return { etat: "refusee", raison: `${fragments.length} fragment(s) non versé(s) (${fragments.join(", ")}) : pnpm changelog:version ${version}` }
  }
  return { etat: "publiable", tag: `v${version}`, precedent, migrations }
}

function options(argv) {
  const lues = {}
  for (let i = 0; i < argv.length; i += 2) {
    const nom = argv[i]?.replace(/^--/, "")
    if (!["ref", "base", "head", "tag"].includes(nom) || !argv[i + 1]) return null
    lues[nom] = argv[i + 1]
  }
  const pullRequest = lues.base && lues.head && !lues.tag
  const publication = lues.tag && !lues.base && !lues.head
  return lues.ref && (pullRequest || publication) ? lues : null
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const lues = options(process.argv.slice(2))
  if (!lues) {
    console.error("usage: version-publiable.mjs --ref <commit> (--base <sha> --head <sha> | --tag v<x.y.z>)")
    process.exit(2)
  }
  const verdict = controler(process.cwd(), lues)
  if (verdict.etat === "inchangee") {
    console.log(`version inchangée (${verdict.version}) : rien à publier`)
  } else if (verdict.etat === "refusee") {
    console.error(verdict.raison)
    process.exit(1)
  } else {
    console.log(`${verdict.tag} publiable : ${verdict.migrations.length} migration(s) depuis ${verdict.precedent ?? "le début"}, CHANGELOG à jour`)
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `tag=${verdict.tag}\n`)
  }
}
