// Les liens d'un nœud lus dans `read` (E11-S05, AC-e1 ; E05-S11, fiche D107) : « Cité dans » (les contenus qui le
// citent), « Cite » (ceux que cite un de ses blocs), le nom montré d'un Contexte (E11-S15, AC-a9), les cibles des pages
// que citent les blocs (`ciblesDesLiens`) et le genre de chaque nœud visible. Leur rendu est au pied du contenu
// (`pied-du-noeud.tsx`) et dans le popover « Liens » de l'en-tête (`liens-de-l-en-tete.tsx`), depuis la refonte #217
// qui retire la colonne de droite et ses encarts (`ContenusLies`). Sans lui, chaque lecteur des liens les relirait à sa façon.
import type { TreeNode } from "../../schemas"
import type { Resultat } from "../api/resultat"
import { natureDuGenre } from "../arbre/depuis-l-arbre"
import type { NatureDeNoeud } from "../arbre/types"
import { cibleDe, dernierSegment, type CiblesDesLiens } from "./en-ligne"
import { titreDuContexte } from "./fil"

/** Un contenu cité par un bloc du nœud : `missing`, sans cible visible ; `moved`, rangé depuis à `vers`. */
export type ContenuCite = { chemin: string; titre: string | null; etat: "ok" | "missing" | "moved"; vers?: string }

/** Les liens d'un nœud, les premiers de chaque côté et leur total (`read`, E03-S07 AC4). */
export type LiensDuNoeud = { cites: ContenuCite[]; totalCites: number; citant: { chemin: string; titre: string }[]; totalCitant: number }

const estObjet = (valeur: unknown): valeur is Record<string, unknown> => typeof valeur === "object" && valeur !== null && !Array.isArray(valeur)
const texte = (valeur: unknown): string | null => (typeof valeur === "string" && valeur !== "" ? valeur : null)
const nombre = (valeur: unknown, sinon: number): number => (typeof valeur === "number" && Number.isInteger(valeur) && valeur >= 0 ? valeur : sinon)

function citeDe(lien: Record<string, unknown>): ContenuCite[] {
  const chemin = texte(lien.path)
  if (!chemin) return []
  const etat = lien.status === "missing" || lien.status === "moved" ? lien.status : "ok"
  const vers = texte(lien.moved_to)
  return [{ chemin, titre: texte(lien.title), etat, ...(vers ? { vers } : {}) }]
}

/**
 * Les liens d'un nœud dans les champs que sert `read` (`links_out`, `links_in` et leurs totaux, E03-S07
 * AC4), lus champ par champ ; un contenu cité par deux ancres (`#clé`) ne se montre qu'une fois.
 */
export function liensDeLaLecture(donnees: Record<string, unknown>): LiensDuNoeud {
  const sortants = (Array.isArray(donnees.links_out) ? donnees.links_out : []).filter(estObjet).flatMap(citeDe)
  const cites = [...new Map(sortants.map((cite) => [cite.chemin, cite])).values()]
  const citant = (Array.isArray(donnees.links_in) ? donnees.links_in : []).filter(estObjet).flatMap((lien) => {
    const chemin = texte(lien.path)
    return chemin ? [{ chemin, titre: texte(lien.title) ?? chemin }] : []
  })
  return {
    cites,
    totalCites: nombre(donnees.links_out_total, sortants.length) - (sortants.length - cites.length),
    citant,
    totalCitant: nombre(donnees.links_in_total, citant.length),
  }
}

function aplatir(arbre: readonly TreeNode[]): TreeNode[] {
  return arbre.flatMap((noeud) => [noeud, ...aplatir(noeud.children)])
}

/** Le nom montré de chaque Contexte, par chemin (E11-S15, AC-a9). */
export type NomsDesContextes = ReadonlyMap<string, string>

/**
 * Le nom de chaque Contexte de l'arbre visible, par chemin, tel que l'écran le nomme ailleurs (`titreDuContexte` : « Contexte ·
 * SAV », « Contexte · Tout le monde », « Contexte · Privé ») : un lien vers lui et sa ligne d'encart le montrent au lieu de
 * son titre enregistré (E11-S15, AC-a9). Le genre vient de l'arbre, que le service sert déjà ; arbre illisible : aucun nom.
 */
export function nomsDesContextes(arbre: readonly TreeNode[] | null, equipes: readonly { slug: string; name: string }[] | null, handle: string | null): NomsDesContextes {
  return new Map((arbre ? aplatir(arbre) : []).flatMap((noeud) => (noeud.kind === "context" ? [[noeud.path, titreDuContexte(noeud.path, equipes, handle)] as const] : [])))
}

/**
 * Les cibles des pages que citent les blocs montrés (E05-S11, AC-26, AC-27), lues dans l'arbre visible : un
 * chemin de l'arbre sous son titre, un autre sans page visible (`null`). Seuls les chemins cités partent vers
 * l'îlot de l'éditeur, jamais l'arbre entier. Arbre illisible : aucune cible, rien n'est deviné. Arbre coupé
 * (`truncated`) : un chemin absent reste inconnu, son lien est gardé. Un Contexte : son nom montré, son titre enregistré
 * gardé à côté (AC-a9).
 */
export function ciblesDesLiens(
  arbre: { tree: readonly TreeNode[]; truncated: boolean } | null,
  chemins: readonly string[],
  contextes: NomsDesContextes,
): CiblesDesLiens | undefined {
  if (arbre === null) return undefined
  const cites = new Set(chemins)
  const visibles = new Map(aplatir(arbre.tree).flatMap((noeud) => (cites.has(noeud.path) ? [[noeud.path, noeud.title] as const] : [])))
  return Object.fromEntries([...cites].flatMap((chemin): [string, CiblesDesLiens[string]][] => {
    const titre = visibles.get(chemin)
    const nom = contextes.get(chemin)
    if (titre !== undefined) return [[chemin, nom === undefined ? { titre, chemin } : { titre: nom, chemin, titreEnregistre: titre }]]
    return arbre.truncated ? [] : [[chemin, null]]
  }))
}

/**
 * Les cibles complétées par les liens sortants lus (`links_out`, les 20 premiers) : un contenu déplacé mène à sa
 * nouvelle place, sous son titre ; un contenu sans cible se lit en texte. Un Contexte déjà nommé par l'arbre garde son
 * nom (AC-a9) : `links_out` ne sert que son titre enregistré.
 */
function avecLesMentions(cibles: CiblesDesLiens | undefined, liens: LiensDuNoeud): CiblesDesLiens | undefined {
  if (cibles === undefined) return undefined
  const lues = liens.cites.map((cite) => {
    const connue = cibleDe(cibles, cite.chemin)
    if (cite.etat === "ok" && connue?.titreEnregistre !== undefined) return [cite.chemin, connue] as const
    return [cite.chemin, cite.etat === "missing" ? null : { titre: cite.titre ?? dernierSegment(cite.chemin), chemin: cite.etat === "moved" && cite.vers ? cite.vers : cite.chemin }] as const
  })
  return { ...cibles, ...Object.fromEntries(lues) }
}

/** Les cibles complétées par les champs de `read` lus, ou telles quelles si leur lecture a échoué (le bandeau le dit). */
export function ciblesLues(cibles: CiblesDesLiens | undefined, lu: Resultat<Record<string, unknown>>): CiblesDesLiens | undefined {
  return lu.error !== undefined ? cibles : avecLesMentions(cibles, liensDeLaLecture(lu.data))
}

/** La nature de chaque nœud visible, par chemin : le glyphe d'un contenu cité ; un chemin inconnu se montre en page. */
export function naturesParChemin(arbre: readonly TreeNode[] | null): ReadonlyMap<string, NatureDeNoeud> {
  return new Map((arbre ? aplatir(arbre) : []).map((noeud) => [noeud.path, natureDuGenre(noeud.kind)]))
}
