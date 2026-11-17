// L'arbre visible servi par `visibleTree` (E03-S03, AC36) en données de l'écran de nœud (E05-S02) :
// nœuds de `NavigateurDArbre`, sections d'équipes de P39 (AC1), destinations d'un déplacement (AC20).
// Fonctions pures. Sans elles, l'arbre reste une liste de chemins et non les sections d'équipes.
import type { TreeNode } from "../../schemas"
import type { NatureDeNoeud, NoeudDArbre, SectionCle } from "./types"

/** La racine technique de l'arbre (H50) : jamais une ligne, ni un maillon, ni une destination nommée. */
export const RACINE = "guide"
/** Le dossier des espaces personnels (H61 ; `perso` avant D107, alias côté service) : ses espaces ne sont pas des lignes, leurs enfants oui. */
export const PERSO = "private"

export const TOUT_LE_MONDE = "Tout le monde"
/** La section de l'espace personnel, « Privé » comme oto-frontend (fiche D89 B) ; son dossier est `private` (D107). */
export const SECTION_PERSO = "Privé"
/** Ce que dit un arbre sans aucun nœud visible, dans le navigateur d'arbre et dans le rail (E05-S09). */
export const ARBRE_VIDE = "L'arbre est vide : aucun nœud ne vous est encore partagé."
const RACINE_DE_L_ARBRE = "Racine de l'arbre"

const NATURES: Record<TreeNode["kind"], NatureDeNoeud> = { page: "page", procedure: "procedure", table: "tableau", context: "contexte" }
const NATURES_PAR_GENRE: ReadonlyMap<string, NatureDeNoeud> = new Map(Object.entries(NATURES))

/** La nature d'un genre servi hors de l'arbre (un nœud trouvé par la recherche du rail) ; un genre inconnu se montre en page. */
export function natureDuGenre(genre: string): NatureDeNoeud {
  return NATURES_PAR_GENRE.get(genre) ?? "page"
}

/**
 * Le titre montré d'un Contexte, composé à l'écran (E05-S11, AC-17, HN-E05S11-13) : « Contexte · <section> »
 * (« Tout le monde », le nom de l'équipe, « Privé ») ; le titre enregistré ne change pas.
 */
export function titreDeContexte(section: string): string {
  return `Contexte · ${section}`
}

/** Un Contexte se titre « Contexte », en tête de sa section (P39). */
function titreDe(noeud: Pick<TreeNode, "kind" | "title">): string {
  return noeud.kind === "context" ? "Contexte" : noeud.title
}

/** L'arbre servi en nœuds de `NavigateurDArbre` (genre `table` → nature `tableau`, `context` → `contexte`). */
export function noeudsDArbreDepuis(arbre: readonly TreeNode[]): NoeudDArbre[] {
  return arbre.map((noeud) => ({
    chemin: noeud.path,
    titre: titreDe(noeud),
    nature: NATURES[noeud.kind],
    ...(noeud.children.length > 0 ? { enfants: noeudsDArbreDepuis(noeud.children) } : {}),
  }))
}

/**
 * Les lignes de Perso : l'espace de la personne (`private/<handle>`) n'est pas une ligne, ses enfants oui ;
 * l'espace d'un autre, qu'une règle lui partage, reste une ligne, ses pages dessous.
 */
function lignesDePerso(noeud: TreeNode, handle: string | null): TreeNode[] {
  if (noeud.path === PERSO) return noeud.children.flatMap((enfant) => lignesDePerso(enfant, handle))
  return handle !== null && noeud.path === `${PERSO}/${handle}` ? noeud.children : [noeud]
}

/** Le Contexte d'abord, les autres dans l'ordre servi (par chemin). */
function contexteDAbord(noeuds: readonly NoeudDArbre[]): NoeudDArbre[] {
  return [...noeuds.filter((noeud) => noeud.nature === "contexte"), ...noeuds.filter((noeud) => noeud.nature !== "contexte")]
}

/**
 * Les sections de l'arbre (AC1, HN-E05S02-8) : « Tout le monde » (nœuds d'organisation), une par
 * équipe (ses dossier et nom lus par `listTeams`), triées par nom, puis « Privé ». Un nœud va dans la
 * section de son premier segment de chemin, dossier visible ou non ; la racine, les dossiers
 * d'équipe et l'espace de la personne (`handle`) ne sont pas des lignes, leurs enfants oui ; le
 * Contexte ouvre sa section ; une section vide n'est pas rendue. Chaque section porte sa clé (`""`, le
 * slug de l'équipe, `private`), que lit le rail (E05-S09). La clé `""` de « Tout le monde » est aussi le parent
 * de ce qu'on y crée (le haut de l'arbre) ; `all` y ferait une clé qu'une équipe au slug `all` pourrait prendre.
 * `equipesDeLaPersonne` (les slugs de ses équipes) : les équipes dont elle n'est pas membre viennent après « Privé »,
 * par nom, marquées `invite` ; sans lui, toutes les équipes se suivent comme avant.
 */
export function sectionsDeLArbre(
  arbre: readonly TreeNode[],
  equipes: readonly { slug: string; name: string }[],
  handle: string | null,
  equipesDeLaPersonne?: readonly string[],
): SectionCle[] {
  const premiers = arbre.flatMap((noeud) => (noeud.path === RACINE ? noeud.children : [noeud]))
  const slugs = new Set(equipes.map((equipe) => equipe.slug))
  const lignes = new Map<string, TreeNode[]>()
  const ajouter = (section: string, noeuds: TreeNode[]) => lignes.set(section, [...(lignes.get(section) ?? []), ...noeuds])
  for (const noeud of premiers) {
    const segment = noeud.path.split("/")[0]
    if (segment === PERSO) ajouter(PERSO, lignesDePerso(noeud, handle))
    else if (slugs.has(segment)) ajouter(segment, noeud.path === segment ? noeud.children : [noeud])
    else ajouter("", [noeud])
  }
  const parNom = [...equipes].sort((a, b) => a.name.localeCompare(b.name, "fr"))
  const membre = (equipe: { slug: string }) => equipesDeLaPersonne === undefined || equipesDeLaPersonne.includes(equipe.slug)
  const ordre: { cle: string; titre: string; invite?: true }[] = [
    { cle: "", titre: TOUT_LE_MONDE },
    ...parNom.filter(membre).map((equipe) => ({ cle: equipe.slug, titre: equipe.name })),
    { cle: PERSO, titre: SECTION_PERSO },
    ...parNom.filter((equipe) => !membre(equipe)).map((equipe) => ({ cle: equipe.slug, titre: equipe.name, invite: true as const })),
  ]
  return ordre.flatMap(({ cle, titre, invite }) => {
    const noeuds = contexteDAbord(noeudsDArbreDepuis(lignes.get(cle) ?? []))
    return noeuds.length > 0 ? [{ cle, titre, noeuds, ...(invite ? { invite } : {}) }] : []
  })
}

function aplatir(arbre: readonly TreeNode[]): TreeNode[] {
  return arbre.flatMap((noeud) => [noeud, ...aplatir(noeud.children)])
}

/** Le parent d'un chemin : `ventes/x` → `ventes`, `ventes` → la racine. */
function parentDe(chemin: string): string {
  const barre = chemin.lastIndexOf("/")
  return barre === -1 ? RACINE : chemin.slice(0, barre)
}

/**
 * Les nouveaux parents possibles d'un nœud (AC20) : « Racine de l'arbre » (`chemin` vide), puis les
 * nœuds de l'arbre visible triés par chemin, hors le nœud, ses descendants et son parent actuel (la
 * racine comprise pour un nœud de premier niveau), et hors `private`, que le service refuse toujours
 * comme parent (E03-S07 AC9).
 */
export function destinationsDuDeplacement(arbre: readonly TreeNode[], chemin: string): { chemin: string; titre: string }[] {
  const parent = parentDe(chemin)
  const exclu = (candidat: string) => candidat === RACINE || candidat === PERSO || candidat === parent || candidat === chemin || candidat.startsWith(`${chemin}/`)
  const noeuds = aplatir(arbre)
    .filter((noeud) => !exclu(noeud.path))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((noeud) => ({ chemin: noeud.path, titre: titreDe(noeud) }))
  return parent === RACINE ? noeuds : [{ chemin: "", titre: RACINE_DE_L_ARBRE }, ...noeuds]
}

/** Le titre de chaque nœud visible, par chemin : les maillons du fil (AC2). */
export function titresParChemin(arbre: readonly TreeNode[]): Map<string, string> {
  return new Map(aplatir(arbre).map((noeud) => [noeud.path, titreDe(noeud)]))
}
