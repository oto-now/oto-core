// Le reçu des commits poussés : chaque commit porte le `Verified-tree:` de l'arbre de code qu'il contient, posé par
// `pnpm commit:export` après un `pnpm verify` complet (`CLAUDE.md § Vérifier, commiter, pousser`). Un commit qui ne
// change pas l'arbre de code de son premier parent (documents de méthode seuls : changelog, conception, sprint) n'en
// a pas besoin : le reçu de son parent le couvre.
// Usage : `node scripts/ci/recu.mjs --depuis <sha|vide> --jusqua <sha> [--avertir]`. Sans `--depuis` (branche neuve,
// historique réécrit), seul `--jusqua` est lu. Code 1 si un commit n'est pas couvert ; `--avertir` le dit en
// avertissement et sort en 0 (première semaine, jusqu'au 29/10/2026).
import { execFileSync } from "node:child_process"
import { pathToFileURL } from "node:url"
import { arbreDeCodeDuCommit } from "../lib/arbre-de-code.mjs"

const git = (depot, args) => execFileSync("git", ["-C", depot, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()

/** Les commits de `depuis` (exclu) à `jusqua`, du plus ancien au plus récent ; `jusqua` seul si `depuis` n'en est pas un ancêtre. */
export function commitsAVerifier(depot, depuis, jusqua) {
  const ancetre = depuis && !/^0+$/.test(depuis) && (() => {
    try {
      git(depot, ["merge-base", "--is-ancestor", depuis, jusqua])
      return true
    } catch {
      return false
    }
  })()
  if (!ancetre) return [git(depot, ["rev-parse", `${jusqua}^{commit}`])]
  const liste = git(depot, ["rev-list", "--reverse", `${depuis}..${jusqua}`])
  return liste ? liste.split("\n") : []
}

/** Le verdict d'un commit : `atteste`, `inchange` (même arbre de code que son premier parent), `absent` ou `faux`. */
export function verdict(depot, sha) {
  const arbre = arbreDeCodeDuCommit(depot, sha)
  const portes = git(depot, ["log", "-1", "--format=%(trailers:key=Verified-tree,valueonly,separator=%x0A)", sha])
    .split("\n")
    .filter(Boolean)
  const porte = portes.at(-1)
  if (porte === arbre) return { sha, etat: "atteste", arbre }
  const parent = git(depot, ["rev-list", "--parents", "-n", "1", sha]).split(" ")[1]
  if (parent && arbreDeCodeDuCommit(depot, parent) === arbre) return { sha, etat: "inchange", arbre }
  return { sha, etat: porte ? "faux" : "absent", arbre, porte }
}

const LIBELLES = {
  atteste: "reçu conforme",
  inchange: "arbre de code inchangé, couvert par son parent",
  absent: "sans `Verified-tree:` : commit construit hors de `pnpm commit:export`",
  faux: "`Verified-tree:` ne correspond pas à son arbre de code : le code a changé après `pnpm verify`",
}

function options(argv) {
  const lues = { avertir: false }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--avertir") lues.avertir = true
    else if (argv[i] === "--depuis" || argv[i] === "--jusqua") lues[argv[i].slice(2)] = argv[++i] ?? ""
    else return null
  }
  return lues.jusqua ? lues : null
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const lues = options(process.argv.slice(2))
  if (!lues) {
    console.error("usage : node scripts/ci/recu.mjs --depuis <sha|vide> --jusqua <sha> [--avertir]")
    process.exit(2)
  }
  const verdicts = commitsAVerifier(".", lues.depuis, lues.jusqua).map((sha) => verdict(".", sha))
  const fautifs = verdicts.filter((v) => v.etat === "absent" || v.etat === "faux")
  for (const v of verdicts) {
    const ligne = `${v.sha.slice(0, 7)} ${git(".", ["log", "-1", "--format=%s", v.sha])} : ${LIBELLES[v.etat]}`
    if (!fautifs.includes(v)) console.log(`✔ ${ligne}`)
    else console.log(`${lues.avertir ? "::warning" : "::error"} title=Reçu du commit::${ligne}`)
  }
  console.log(`${verdicts.length} commit(s) lus, ${fautifs.length} sans reçu valable${lues.avertir && fautifs.length ? " (avertissement seulement)" : ""}.`)
  process.exit(fautifs.length && !lues.avertir ? 1 : 0)
}
