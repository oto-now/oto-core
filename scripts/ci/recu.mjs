// Le reçu des commits poussés : chaque commit porte le `Verified-tree:` de l'arbre de code qu'il contient, posé par
// `pnpm commit:export` après un `pnpm verify` complet (`CLAUDE.md § Vérifier, commiter, pousser`). Un commit qui ne
// change pas l'arbre de code de son premier parent (documents de méthode seuls : changelog, conception, sprint) n'en
// a pas besoin : le reçu de son parent le couvre. Un commit de fusion n'en a pas besoin non plus quand son second parent
// (la branche fusionnée) est couvert par l'une de ces deux règles et que la fusion garde l'arbre de code de ce second
// parent : le code fusionné est exactement celui que la branche a vérifié. Si `main` a bougé entre-temps, l'arbre de
// la fusion diffère et le mélange n'a été vérifié par personne : la fusion est signalée (`ecart`). Un commit fait sur
// un reçu doc (`Verified: docs seule`, `check:framework` et `check:public` seulement) n'est couvert que s'il ne change, par rapport à son
// premier parent, que de la documentation de méthode ou des chemins exclus (`scripts/lib/arbre-de-code.mjs`).
// Usage : `node scripts/ci/recu.mjs --depuis <sha|vide> --jusqua <sha> [--avertir]`. Sans `--depuis` (branche neuve,
// historique réécrit), seul `--jusqua` est lu. Code 1 si un commit n'est pas couvert ; `--avertir` le dit en
// avertissement et sort en 0 (première semaine, jusqu'au 29/10/2026).
import { execFileSync } from "node:child_process"
import { pathToFileURL } from "node:url"
import { arbreDeCodeDuCommit, cheminsHorsDoc } from "../lib/arbre-de-code.mjs"
import { PREFIXE_DOC } from "../commit-depuis-export.mjs"

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

/** Le reçu porté par `sha`, s'il couvre son arbre (`atteste`) ou s'il laisse inchangé celui de son premier parent (`inchange`). */
function couverture(depot, sha, arbre) {
  const portes = git(depot, ["log", "-1", "--format=%(trailers:key=Verified-tree,valueonly,separator=%x0A)", sha])
    .split("\n")
    .filter(Boolean)
  const porte = portes.at(-1)
  const parents = git(depot, ["rev-list", "--parents", "-n", "1", sha]).split(" ").slice(1)
  if (porte === arbre) {
    // Reçu doc (méthode et secrets seulement) : il n'atteste que de la documentation ; le code doit être celui du premier parent.
    const verifie = git(depot, ["log", "-1", "--format=%(trailers:key=Verified,valueonly,separator=%x0A)", sha]).split("\n").filter(Boolean).at(-1) ?? ""
    if (verifie.startsWith(PREFIXE_DOC) && cheminsHorsDoc(depot, parents[0], sha).length) return { etat: null, porte, parents, horsDoc: true }
    return { etat: "atteste", porte }
  }
  if (parents[0] && arbreDeCodeDuCommit(depot, parents[0]) === arbre) return { etat: "inchange", porte, parents }
  return { etat: null, porte, parents }
}

/**
 * Le verdict d'un commit : `atteste`, `inchange` (même arbre de code que son premier parent), `fusion` (second parent
 * couvert, même arbre de code que lui), `ecart` (second parent couvert, arbre différent), `absent`, `faux`, ou
 * `docHorsDoc` (reçu doc sur un commit qui change autre chose que de la documentation).
 */
export function verdict(depot, sha) {
  const arbre = arbreDeCodeDuCommit(depot, sha)
  const { etat, porte, parents, horsDoc } = couverture(depot, sha, arbre)
  if (etat) return { sha, etat, arbre }
  if (horsDoc) return { sha, etat: "docHorsDoc", arbre, porte }
  const second = parents[1]
  if (second) {
    const arbreSecond = arbreDeCodeDuCommit(depot, second)
    if (couverture(depot, second, arbreSecond).etat) return { sha, etat: arbreSecond === arbre ? "fusion" : "ecart", arbre }
  }
  return { sha, etat: porte ? "faux" : "absent", arbre, porte }
}

const LIBELLES = {
  atteste: "reçu conforme",
  inchange: "arbre de code inchangé, couvert par son parent",
  fusion: "fusion d'une branche couverte par son reçu, même arbre de code qu'elle",
  ecart: "fusion d'une branche couverte, mais son arbre de code diffère de celui de la branche (`main` a bougé) : le code fusionné n'a pas été vérifié",
  absent: "sans `Verified-tree:` : commit construit hors de `pnpm commit:export`",
  faux: "`Verified-tree:` ne correspond pas à son arbre de code : le code a changé après `pnpm verify`",
  docHorsDoc: "reçu doc (`Verified: docs seule`, méthode et secrets seulement) sur un commit qui change autre chose que de la documentation",
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
  const fautifs = verdicts.filter((v) => ["absent", "faux", "ecart", "docHorsDoc"].includes(v.etat))
  for (const v of verdicts) {
    const ligne = `${v.sha.slice(0, 7)} ${git(".", ["log", "-1", "--format=%s", v.sha])} : ${LIBELLES[v.etat]}`
    if (!fautifs.includes(v)) console.log(`✔ ${ligne}`)
    else console.log(`${lues.avertir ? "::warning" : "::error"} title=Reçu du commit::${ligne}`)
  }
  console.log(`${verdicts.length} commit(s) lus, ${fautifs.length} sans reçu valable${lues.avertir && fautifs.length ? " (avertissement seulement)" : ""}.`)
  process.exit(fautifs.length && !lues.avertir ? 1 : 0)
}
