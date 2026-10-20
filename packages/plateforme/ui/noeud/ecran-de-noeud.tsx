// L'écran d'un nœud (E05-S02, AC1 à AC9, AC19, AC20, AC22 ; E05-S09, partie c1) : l'en-tête d'écran (fil,
// titre, méta, accès), le chapô, puis le document dans son îlot, lu, ou écrit au niveau écriture sous la
// file d'écriture ; les états (chargement, erreur, introuvable, vide). Server Component : il reçoit les
// lectures de la page de l'hôte en `resultat`, son lien et l'adresse d'un chemin ; les îlots client
// reçoivent des données et du `ReactNode` déjà rendu. Les emplacements `complement` (procédure, tableau :
// E05-S04, E07-S03) et `annexes` (la colonne d'un Contexte : E05-S04, AC10) sont remplis par l'hôte ; le
// panneau « Partager » (E05-S10, AC-b5) et les encarts des liens (E11-S05, AC-e1) reçoivent ses lectures. Sans lui,
// aucune page ne se lit.
//
// Porté d'oto-frontend (`routes/n.$nodeId.lazy.tsx`, `routes/context.$sectionId.lazy.tsx`,
// `components/noeud/sorties-du-noeud.tsx`) : un seul écran pour page, procédure, Contexte et tableau, la
// colonne de lecture (`.oto-content-max[data-width="document"]`, pleine largeur pour un tableau), le
// document dans un îlot, le Contexte en deux colonnes (`TwoColumns`, ses annexes à droite), le squelette
// aux dimensions du contenu, l'échec en alerte avec « Réessayer », l'introuvable en état vide. Retiré : la
// colonne d'arbre (l'arbre ne vit plus que dans le rail, AC-a2), `NoeudAilleurs`, l'aiguillage
// `editSurface` / `docId`, `QuiSenSert` (aucune donnée servie), TanStack Query.
//
// E05-S11 : un Contexte se titre « Contexte · <section> », composé ici, jamais écrit en place (AC-17) ; les
// pages que citent les blocs montrés se lisent par leur titre (AC-26, AC-27), lues dans l'arbre visible.
// E05-S13 (AC-20) : plus de « Déplacer » en tête, à aucun niveau : le rail déplace (« ⋯ », glisser-déposer).
// E11-S05 (lot e) : une page, une procédure et un Contexte en deux colonnes, le document à gauche, à droite les
// annexes de l'hôte puis « Cité dans », « Cite » et « Sous-pages » ; un tableau garde toute la largeur, ses encarts
// sur une ligne au-dessus de la grille ; la rangée du chapô ne reste que si elle porte quelque chose.
// E10-S02 (lot c, AC-c2) : `?view=<id>` : la visionneuse d'un fichier joint remplace l'écran du nœud trouvé.
import type { ReactNode } from "react"
import { FileText } from "@phosphor-icons/react/dist/ssr/FileText"
import { tableHeaderSchema, type FileView, type NodeRulesView, type NodeView, type TreeNode } from "../../schemas"
import type { Resultat } from "../api/resultat"
import type { LienDeLHote } from "../arbre/navigateur-d-arbre"
import { ErreurDeLecture } from "../components/erreur-de-lecture"
import { ImportDansLeTableau } from "../coque/import-de-fichier"
import { EmptyState } from "../ds/react/empty-state"
import { Icon } from "../ds/react/icon"
import { Island, IslandBody } from "../ds/react/island"
import { ScreenHeader } from "../ds/react/screen-header"
import { Skeleton, SkeletonText } from "../ds/react/skeleton"
import { TwoColumns } from "../ds/react/two-columns"
import type { SujetsDeRegle } from "../equipes/types"
import { OptionsDuTableau } from "../tableau/options-du-tableau"
import { blocsAffiches, cheminsCites, CorpsDuNoeud, niveauDEcritureDe, type CorpsDuNoeudProps } from "./corps-du-noeud"
import { FileDOperations } from "./editeur/file-d-operations"
import { ChapoDuNoeud, EnTeteDuNoeud } from "./en-tete-du-noeud"
import { titreDuContexte } from "./fil"
import { ECRAN, genreDuNoeud, INTROUVABLE, PARTAGE, resumeMontre } from "./libelles"
import { PartageDuNoeud } from "./partage-du-noeud"
import { ciblesDesLiens, ContenusLies, nomsDesContextes } from "./sous-pages"
import { VisionneuseDeFichier } from "./visionneuse-de-fichier"

type Equipe = { slug: string; name: string }

/** Les lectures du panneau « Partager » (AC-b5), chacune dite en échec dans le panneau (portage § 4). */
type LecturesDuPartage = {
  /** `null` : le nœud est introuvable pour ses droits (H68). */
  regles: Resultat<NodeRulesView | null>
  /** Les équipes et les membres qu'on peut ajouter. */
  sujets: Resultat<SujetsDeRegle>
  /** L'accès complet ne s'accorde que par un administrateur (N6) : décidé par le rôle de l'identité. */
  gestionAccordable: boolean
  /** L'identifiant de qui regarde : sa ligne dit « (vous) ». */
  moi: string | null
}

type EcranDeNoeudProps = {
  /** Le chemin demandé : celui de l'adresse, que « Réessayer » relit. */
  chemin: string
  /** `null` : chemin inconnu, invisible ou mal formé, une seule phrase pour les trois (H68). */
  noeud: Resultat<NodeView | null>
  /** L'arbre visible : les titres et les frères du fil. */
  arbre: Resultat<{ tree: TreeNode[]; truncated: boolean }>
  /** Les équipes (`listTeams`) : le nom de chaque section. */
  equipes: Resultat<Equipe[]>
  /** Le `handle` de la personne (son profil) : son espace `private/<handle>` n'est pas un maillon du fil. */
  handle: string | null
  nomOrganisation: string
  /** `?version=published` : un rédacteur lit la version publiée, sans éditeur (AC9). */
  versionPubliee: boolean
  Lien: LienDeLHote
  hrefDuChemin: (chemin: string) => string
  /** Le préfixe des adresses de pages de l'hôte (`"/n/"`), en chaîne : les îlots n'en reçoivent pas de fonction. */
  prefixeDesPages: string
  complement?: ReactNode
  /** Les annexes d'un Contexte (E05-S04, AC10) : en tête de la colonne de droite dès 1 024 px, sous le document en dessous. */
  annexes?: ReactNode
  /** Le pied de la colonne de droite, après les encarts : la jauge du budget d'un Contexte (2026-10-20), tout en bas. */
  piedDeColonne?: ReactNode
  /** Le panneau « Partager » (AC19 ; E05-S10, AC-b5), ouvert depuis « Partager · <espace> » de l'en-tête. */
  partage?: LecturesDuPartage
  /**
   * Les champs que sert `read` sur le nœud, pour ses encarts « Cité dans » et « Cite » (E11-S05, AC-e1) : lus
   * par l'hôte sans les attendre, attendus sous leur `<Suspense>`.
   */
  liens?: Promise<Resultat<Record<string, unknown>>>
  /**
   * Les blocs `reference` rendus en place par la page serveur (vue, carte ou avis, E07-S03), par `id` de
   * bloc, pour les blocs que l'écran montre (`blocsAffiches`) ; un bloc sans rendu garde `ReferenceEnLien`.
   */
  referencesRendues?: Readonly<Record<string, ReactNode>>
  /**
   * `?view=<id>` (E10-S02, AC-c2) : l'identifiant demandé et ce que sert `fileView` (`null` : introuvable) ; l'écran
   * montre alors la visionneuse du fichier à la place du nœud, une fois le nœud trouvé.
   */
  fichierVu?: { id: string; resultat: Resultat<FileView | null> }
}

// Les blocs montrés, lus par la page de l'hôte pour en résoudre les références (E07-S03).
export { blocsAffiches } from "./corps-du-noeud"

/**
 * Une lecture de la page en échec, dite avec « Réessayer » (portage-ecrans.md § 4) : l'arbre (le fil en
 * dépend), puis les équipes (le nom de chaque section).
 */
function LecturesEnEchec({ arbre, equipes, ici, Lien }: Pick<EcranDeNoeudProps, "arbre" | "equipes" | "Lien"> & { ici: string }) {
  const message = arbre.error ?? equipes.error
  if (message === undefined) return null
  return <ErreurDeLecture message={message} href={ici} Lien={Lien} />
}

/**
 * Le panneau « Partager » : chaque lecture en échec se dit avec « Réessayer », jamais une liste partielle
 * (portage-ecrans.md § 4) ; un nœud introuvable pour ses droits, la phrase de H68 ; sinon le panneau.
 */
function PanneauDuPartage({ partage, nomOrganisation, ici, Lien }: { partage: LecturesDuPartage; nomOrganisation: string; ici: string; Lien: LienDeLHote }) {
  const { regles, sujets } = partage
  if (regles.error !== undefined) return <ErreurDeLecture message={regles.error} href={ici} Lien={Lien} />
  if (sujets.error !== undefined) return <ErreurDeLecture message={sujets.error} href={ici} Lien={Lien} />
  if (regles.data === null) return <p role="alert">{PARTAGE.introuvable}</p>
  return <PartageDuNoeud noeud={regles.data} sujets={sujets.data} gestionAccordable={partage.gestionAccordable} moi={partage.moi} nomOrganisation={nomOrganisation} />
}

type PageDuNoeudProps = EcranDeNoeudProps & { vue: NodeView; ici: string }

function PageDuNoeud(props: PageDuNoeudProps) {
  const { vue, versionPubliee, arbre, equipes, prefixeDesPages } = props
  const niveauDEcriture = niveauDEcritureDe(vue, versionPubliee)
  const brouillon = niveauDEcriture === null ? null : vue.draft
  const equipesLues = equipes.error === undefined ? equipes.data : null
  const contexte = vue.kind === "context"
  const titreEcrit = brouillon?.title ?? vue.title
  const titre = contexte ? titreDuContexte(vue.path, equipesLues, props.handle) : titreEcrit
  const resume = brouillon?.summary ?? vue.summary
  const arbreLu = arbre.error === undefined ? arbre.data.tree : null
  const partage = props.partage && <PanneauDuPartage partage={props.partage} nomOrganisation={props.nomOrganisation} ici={props.ici} Lien={props.Lien} />
  // Les réglages d'un tableau, au niveau écriture hors de la version publiée, sous la file d'opérations (E11-S01, AC-g1) ;
  // « Importer un fichier… » avant eux, dans la même rangée de l'en-tête (E11-S15, AC-a7).
  const enteteDuTableau = vue.kind === "table" && niveauDEcriture !== null ? tableHeaderSchema.safeParse(vue.meta) : null
  const reglages = enteteDuTableau?.success ? (
    <>
      <ImportDansLeTableau chemin={vue.path} titre={vue.title} entete={enteteDuTableau.data} />
      <OptionsDuTableau entete={enteteDuTableau.data} enAttente={(brouillon?.meta ?? null) !== null} />
    </>
  ) : undefined
  const entete = (
    <EnTeteDuNoeud
      vue={vue}
      titre={titre}
      arbre={arbreLu}
      equipes={equipesLues}
      handle={props.handle}
      prefixeDesPages={prefixeDesPages}
      // Le titre d'un Contexte est composé, jamais écrit en place (AC-17, HN-E05S11-13).
      modifiable={niveauDEcriture !== null && !contexte}
      partage={partage}
      reglages={reglages}
    />
  )
  // Un Contexte cité ou rangé dessous se nomme comme dans l'en-tête et le rail (E11-S15, AC-a9).
  const contextes = nomsDesContextes(arbreLu, equipesLues, props.handle)
  const cibles = ciblesDesLiens(arbre.error === undefined ? arbre.data : null, cheminsCites(blocsAffiches(vue, versionPubliee)), contextes)
  // L'îlot du document garde le nom écrit du nœud : seuls l'en-tête et le fil composent celui d'un Contexte.
  const corps: CorpsDuNoeudProps = { ...props, niveauDEcriture, titre: titreEcrit, cibles }
  // Le chapô ne porte que le résumé d'une procédure et une lecture en échec (AC-f1) : sans eux, pas de rangée.
  const chapoPresent = resumeMontre(genreDuNoeud(vue)) || arbre.error !== undefined || equipes.error !== undefined
  const chapo = chapoPresent && (
    <>
      <ChapoDuNoeud vue={vue} resume={resume} modifiable={niveauDEcriture !== null} />
      <LecturesEnEchec arbre={arbre} equipes={equipes} ici={props.ici} Lien={props.Lien} />
    </>
  )
  const encarts = (disposition: "colonne" | "ligne") => (
    <ContenusLies vue={vue} arbre={arbreLu} contextes={contextes} liens={props.liens} Lien={props.Lien} hrefDuChemin={props.hrefDuChemin} ici={props.ici} disposition={disposition} />
  )
  // Une page, une procédure, un Contexte (AC-e1, AC-e2) : l'en-tête et les colonnes sont frères dans le contenu,
  // l'en-tête suit la colonne du document (`islands.css`) ; le chapô est seul dans sa rangée, pour que la colonne
  // de droite commence au haut de la carte (E05-S12, AC-21 ; deux `TwoColumns` aux mêmes pistes, l'écart entre eux
  // ramené à `--gap` par `content.css`) ; la colonne de droite a toujours sa piste, le document ne bouge pas quand
  // les liens arrivent (AC-e4, HN-E11S05-13). Un tableau (AC-e3) : une colonne pleine largeur, les encarts en ligne.
  const ecran =
    vue.kind === "table" ? (
      <div className="oto-content-max">
        {entete}
        <div className="flex flex-col gap-(--gap)">
          {chapo}
          {encarts("ligne")}
          <CorpsDuNoeud {...corps} />
        </div>
      </div>
    ) : (
      <>
        {entete}
        {chapo && (
          <TwoColumns main="document" className="oto-node-lead">
            {chapo}
          </TwoColumns>
        )}
        <TwoColumns
          main="document"
          aside={
            <>
              {props.annexes}
              {encarts("colonne")}
              {props.piedDeColonne}
            </>
          }
        >
          <CorpsDuNoeud {...corps} />
        </TwoColumns>
      </>
    )
  if (niveauDEcriture === null) return ecran
  return (
    <FileDOperations key={vue.id} chemin={vue.path} revisionPubliee={vue.revision} tampon={vue.draft?.draftStamp ?? null}>
      {ecran}
    </FileDOperations>
  )
}

function EchecDuNoeud({ message, ici, Lien }: { message: string; ici: string; Lien: LienDeLHote }) {
  return (
    <div className="oto-content-max" data-width="document">
      <ScreenHeader title={ECRAN.page} />
      <ErreurDeLecture titre={ECRAN.echec} message={message} href={ici} Lien={Lien} />
    </div>
  )
}

/** Inconnu, invisible ou mal formé : la même phrase (H68), et une sortie, jamais une impasse. */
function Introuvable({ Lien, hrefDuChemin }: Pick<EcranDeNoeudProps, "Lien" | "hrefDuChemin">) {
  return (
    <div className="oto-content-max" data-width="document">
      <ScreenHeader title={ECRAN.introuvable} />
      <EmptyState
        icon={<Icon as={FileText} size="lg" />}
        title={INTROUVABLE}
        action={
          <Lien href={hrefDuChemin("contexte")} className="oto-btn anim-host" data-variant="secondary" data-size="sm" data-press="">
            {ECRAN.allerATouLeMonde}
          </Lien>
        }
      />
    </div>
  )
}

export function EcranDeNoeud(props: EcranDeNoeudProps) {
  const { chemin, noeud, versionPubliee, Lien, hrefDuChemin } = props
  const ici = `${hrefDuChemin(chemin)}${versionPubliee ? "?version=published" : ""}`
  if (noeud.error !== undefined) return <EchecDuNoeud message={noeud.error} ici={ici} Lien={Lien} />
  if (noeud.data === null) return <Introuvable Lien={Lien} hrefDuChemin={hrefDuChemin} />
  const { fichierVu } = props
  if (fichierVu) {
    const page = { titre: noeud.data.title, href: hrefDuChemin(noeud.data.path) }
    const adresse = `${hrefDuChemin(chemin)}?view=${encodeURIComponent(fichierVu.id)}`
    return <VisionneuseDeFichier fichier={fichierVu.resultat} nomOrganisation={props.nomOrganisation} page={page} ici={adresse} Lien={Lien} hrefDuChemin={hrefDuChemin} />
  }
  return <PageDuNoeud {...props} vue={noeud.data} ici={ici} />
}

/**
 * Le chargement de la page (AC7), rendu par le `loading.tsx` de l'hôte : aux dimensions du contenu attendu,
 * jamais un spinner ; le `<h1>` garde un nom (`Skeleton` est `aria-hidden`).
 */
export function EcranDeNoeudChargement() {
  return (
    <div className="oto-content-max" data-width="document">
      <ScreenHeader
        title={
          <>
            <span className="oto-sr-only">{ECRAN.chargement}</span>
            <Skeleton width="14rem" />
          </>
        }
      />
      <Island aria-label={ECRAN.chargement}>
        <IslandBody>
          <SkeletonText lines={4} />
        </IslandBody>
      </Island>
    </div>
  )
}
