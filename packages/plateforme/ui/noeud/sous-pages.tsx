// Les encarts des liens d'un nœud (E11-S05, lot e, AC-e1 ; ils remplacent « Contenus liés » d'E05-S10, AC-b6) :
// « Cité dans » (les contenus qui le citent), « Cite » (ceux que cite un de ses blocs) et « Sous-pages » (les nœuds
// dessous et leur nature), hors de la carte des blocs, fermés par défaut. Server Component ; aucun
// encart quand rien n'est lié (un repli qui s'ouvre sur « rien » est une impasse). Les liens arrivent après la
// page, sous leur propre `<Suspense>` : l'en-tête et le document ne les attendent pas. Sans lui, les nœuds
// dessous et ce qui cite une page ne se lisent nulle part à l'écran.
//
// Porté d'oto-frontend (`components/noeud/qui-sen-sert.tsx`) : `LinkedContent`, ses intitulés et sa note,
// `ContentTree`, `ObjectLink`. Changé : les rubriques, lues dans `loadNode` et dans les liens `links` que sert
// `read` (E03-S07) ; retiré : la note de pied d'Oto.
//
// E05-S11 (retours 13 et 20, fiche D107) : trois rubriques, chacune absente quand elle est vide. Les mêmes liens
// donnent aux blocs le titre et la place de chaque page citée (`ciblesDesLiens`).
//
// E11-S05 (lot e ; HN-E11S05-12) : plus de bandeau « Contenus liés » ; trois encarts repliables, « Cité dans »,
// « Cite », « Sous-pages », chacun son glyphe et son total, fermés à l'arrivée, absents à 0 ; dans la colonne de
// droite d'une page, d'une procédure et d'un Contexte, sur une ligne au-dessus de la grille d'un tableau.
// E11-S15 (AC-a2) : le nom d'une ligne tient sur une ligne, coupé par « … » ; plus de résumé ; rien n'élargit la page.
// (AC-a9) : un Contexte se nomme comme ailleurs à l'écran (« Contexte · SAV »), dans les encarts et dans les liens des blocs.
import { Suspense, use, type ReactNode } from "react"
import { ArrowSquareIn } from "@phosphor-icons/react/dist/ssr/ArrowSquareIn"
import { ArrowSquareOut } from "@phosphor-icons/react/dist/ssr/ArrowSquareOut"
import { TreeStructure } from "@phosphor-icons/react/dist/ssr/TreeStructure"
import type { NodeView, TreeNode } from "../../schemas"
import type { Resultat } from "../api/resultat"
import { natureDuGenre } from "../arbre/depuis-l-arbre"
import type { LienDeLHote } from "../arbre/navigateur-d-arbre"
import type { NatureDeNoeud } from "../arbre/types"
import { ErreurDeLecture } from "../components/erreur-de-lecture"
import { ContentTree, ContentTreeItem } from "../ds/react/content-tree"
import { AnimatedIcon, type Glyphe } from "../ds/react/icon"
import { LinkedContent } from "../ds/react/linked-content"
import { ObjectLink } from "../ds/react/object-link"
import { cibleDe, dernierSegment, type CiblesDesLiens } from "./en-ligne"
import { titreDuContexte } from "./fil"
import { GlypheDeNature } from "./glyphes"
import { ENCARTS, NATURES } from "./libelles"

/** Un contenu cité par un bloc du nœud : `missing`, sans cible visible ; `moved`, rangé depuis à `vers`. */
export type ContenuCite = { chemin: string; titre: string | null; etat: "ok" | "missing" | "moved"; vers?: string }

/** Les liens d'un nœud, les premiers de chaque côté et leur total (`read`, E03-S07 AC4). */
export type LiensDuNoeud = { cites: ContenuCite[]; totalCites: number; citant: { chemin: string; titre: string }[]; totalCitant: number }

type Navigation = { Lien: LienDeLHote; hrefDuChemin: (chemin: string) => string; ici: string }

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
function naturesParChemin(arbre: readonly TreeNode[] | null): ReadonlyMap<string, NatureDeNoeud> {
  return new Map((arbre ? aplatir(arbre) : []).map((noeud) => [noeud.path, natureDuGenre(noeud.kind)]))
}

/** `contextes` : le nom montré d'un Contexte, au lieu de son titre enregistré (E11-S15, AC-a9). */
type NavigationDesLignes = Pick<Navigation, "Lien" | "hrefDuChemin"> & { contextes: NomsDesContextes }

type EncartProps = { glyphe: Glyphe; titre: string; total: number; montres: number; children: ReactNode }

/**
 * Un encart (AC-e1) : un repli fermé à l'arrivée, son glyphe, son titre et son total ; ouvert, sa liste nommée, puis
 * ce que le service n'a pas servi. Un total nul : rien, une commande qui s'ouvre sur « rien » est une impasse.
 */
function Encart({ glyphe, titre, total, montres, children }: EncartProps) {
  if (total === 0) return null
  return (
    <LinkedContent icon={<AnimatedIcon as={glyphe} size="xs" />} title={titre} count={total}>
      <ContentTree aria-label={titre}>{children}</ContentTree>
      {total > montres && <p className="oto-linked-note">{ENCARTS.autres(total - montres)}</p>}
    </LinkedContent>
  )
}

/**
 * Le nom d'une ligne d'encart (E11-S15, AC-a2) : sur une ligne, coupé par « … » ; entier au survol (`title`) et pour un
 * lecteur d'écran (le texte reste entier, seule la vue le coupe). Une boîte à lui : `.oto-object-link-name` est un
 * conteneur flex, où `text-overflow` ne coupe rien.
 */
function NomCoupe({ nom }: { nom: string }) {
  return (
    <span className="truncate" title={nom}>
      {nom}
    </span>
  )
}

/** « Sous-pages » : les nœuds dessous et leur nature, sans résumé (E11-S15, AC-a2). Connu avec le nœud. */
function SousPages({ enfants, total, Lien, hrefDuChemin, contextes }: NavigationDesLignes & { enfants: NodeView["children"]; total: number }) {
  return (
    <Encart glyphe={TreeStructure} titre={ENCARTS.sousPages} total={total} montres={enfants.length}>
      {enfants.map((enfant) => (
        <ContentTreeItem key={enfant.path} icon={<GlypheDeNature nature={natureDuGenre(enfant.kind)} />}>
          <ObjectLink as={Lien} href={hrefDuChemin(enfant.path)} name={<NomCoupe nom={contextes.get(enfant.path) ?? enfant.title} />} meta={NATURES[enfant.kind]} />
        </ContentTreeItem>
      ))}
    </Encart>
  )
}

/** Un contenu cité : son lien (vers sa nouvelle place s'il a été rangé ailleurs), ou son chemin seul, sans cible. */
function LigneCitee({ cite, nature, Lien, hrefDuChemin, contextes }: NavigationDesLignes & { cite: ContenuCite; nature: NatureDeNoeud }) {
  if (cite.etat === "missing") {
    return (
      <ContentTreeItem broken icon={<GlypheDeNature nature={nature} />}>
        <span className="oto-object-link">
          <span className="oto-object-link-name">
            <NomCoupe nom={cite.chemin} />
          </span>
          <span className="oto-object-link-meta">{ENCARTS.sansCible}</span>
        </span>
      </ContentTreeItem>
    )
  }
  const deplace = cite.etat === "moved" && cite.vers ? cite.vers : null
  return (
    <ContentTreeItem icon={<GlypheDeNature nature={nature} />}>
      <ObjectLink as={Lien} href={hrefDuChemin(deplace ?? cite.chemin)} name={<NomCoupe nom={contextes.get(deplace ?? cite.chemin) ?? cite.titre ?? cite.chemin} />} meta={deplace ? ENCARTS.deplace(deplace) : undefined} />
    </ContentTreeItem>
  )
}

type LiensProps = Navigation & { liens: Resultat<LiensDuNoeud>; natures: ReadonlyMap<string, NatureDeNoeud>; contextes: NomsDesContextes }

/** « Cité dans » (ce qui cite le nœud) puis « Cite » (ce que ses blocs citent) ; leur lecture en échec se dit à leur place. */
function Liens({ liens, natures, contextes, Lien, hrefDuChemin, ici }: LiensProps) {
  if (liens.error !== undefined) return <ErreurDeLecture message={liens.error} href={ici} Lien={Lien} />
  const { cites, totalCites, citant, totalCitant } = liens.data
  return (
    <>
      <Encart glyphe={ArrowSquareIn} titre={ENCARTS.citeDans} total={totalCitant} montres={citant.length}>
        {citant.map((source) => (
          <ContentTreeItem key={source.chemin} icon={<GlypheDeNature nature={natures.get(source.chemin) ?? "page"} />}>
            <ObjectLink as={Lien} href={hrefDuChemin(source.chemin)} name={<NomCoupe nom={contextes.get(source.chemin) ?? source.titre} />} />
          </ContentTreeItem>
        ))}
      </Encart>
      <Encart glyphe={ArrowSquareOut} titre={ENCARTS.cite} total={totalCites} montres={cites.length}>
        {cites.map((cite) => (
          <LigneCitee key={cite.chemin} cite={cite} nature={natures.get(cite.vers ?? cite.chemin) ?? "page"} Lien={Lien} hrefDuChemin={hrefDuChemin} contextes={contextes} />
        ))}
      </Encart>
    </>
  )
}

function LiensLus({ lecture, ...props }: Omit<LiensProps, "liens"> & { lecture: Promise<Resultat<Record<string, unknown>>> }) {
  const lu = use(lecture)
  return <Liens {...props} liens={lu.error !== undefined ? lu : { data: liensDeLaLecture(lu.data) }} />
}

export type ContenusLiesProps = Navigation & {
  vue: Pick<NodeView, "children" | "childrenTotal">
  /** L'arbre visible : la nature d'un contenu cité ; `null` si sa lecture a échoué (le glyphe d'une page). */
  arbre: readonly TreeNode[] | null
  /** Les champs de `read` sur le nœud (ses liens), lus par l'hôte après la page ; absents, « Cité dans » et « Cite » ne sont pas rendus. */
  liens?: Promise<Resultat<Record<string, unknown>>>
  /**
   * `colonne` : les encarts l'un sous l'autre, dans la colonne de droite d'une page (AC-e1) ; `ligne` : sur une ligne
   * au-dessus de la grille d'un tableau, qui garde toute la largeur (AC-e3).
   */
  disposition: "colonne" | "ligne"
  /** Le nom montré de chaque Contexte (`nomsDesContextes`), pour ses lignes (E11-S15, AC-a9). */
  contextes: NomsDesContextes
  /** Un encart de l'écran posé avant eux, dans leur conteneur : la colonne, ou leur ligne (l'encart « Commentaires »). */
  avant?: ReactNode
}

/**
 * « Cité dans », « Cite », « Sous-pages » (AC-e1, AC-e3, AC-e4). Seuls les liens attendent leur `<Suspense>` : « Sous-pages »,
 * connu avec le nœud, se rend tout de suite, hors de lui, une seule fois dans le flux ; à la place des deux autres,
 * « Lecture des liens… », puis leur échec et « Réessayer ».
 */
export function ContenusLies({ vue, arbre, liens, disposition, contextes, avant, ...navigation }: ContenusLiesProps) {
  const encarts = (
    <>
      {avant}
      {liens && (
        <Suspense
          fallback={
            <p role="status" className="oto-linked-note">
              {ENCARTS.chargement}
            </p>
          }
        >
          <LiensLus lecture={liens} natures={naturesParChemin(arbre)} contextes={contextes} {...navigation} />
        </Suspense>
      )}
      <SousPages enfants={vue.children} total={vue.childrenTotal} Lien={navigation.Lien} hrefDuChemin={navigation.hrefDuChemin} contextes={contextes} />
    </>
  )
  if (disposition === "colonne") return encarts
  // Sans encart, liens lus, la ligne part (HN-E11S05-14) : `:empty` ne compte pas les marques de commentaire du flux.
  return <div className="flex flex-wrap items-start gap-(--gap) empty:hidden">{encarts}</div>
}
