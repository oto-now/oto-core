// L'écran d'un nœud (E05-S02, AC1 à AC9, AC19, AC20, AC22 ; E05-S09, partie c1 ; refonte #217, #218) : l'en-tête
// d'écran (fil, titre, méta, gestes), la ligne propre au genre (résumé d'une procédure, annexes d'un Contexte), le texte
// posé à plat, lu, ou écrit au niveau écriture sous la file d'écriture, puis le pied (« Sous-pages », « Cité dans »,
// « Cite ») ; les états (chargement, erreur, introuvable, vide). Server Component : il reçoit les lectures de la page de
// l'hôte en `resultat`, son lien et l'adresse d'un chemin ; les îlots client reçoivent des données et du `ReactNode` déjà
// rendu. Les emplacements `complement` (tableau, E07-S03), `annexes` et `piedDeColonne` (un Contexte) sont remplis par
// l'hôte ; le panneau « Partager » (E05-S10, AC-b5) et les liens (E11-S05) reçoivent ses lectures. Sans lui, aucune page
// ne se lit.
//
// Porté d'oto-frontend (`routes/n.$nodeId.lazy.tsx`, `routes/context.$sectionId.lazy.tsx`,
// `components/noeud/sorties-du-noeud.tsx`) : un seul écran pour page, procédure, Contexte et tableau, la colonne de
// lecture (pleine largeur pour un tableau), le squelette aux dimensions du contenu, l'échec en alerte avec « Réessayer »,
// l'introuvable en état vide. Retiré : la colonne d'arbre (AC-a2), `NoeudAilleurs`, l'aiguillage `editSurface` /
// `docId`, `QuiSenSert`, TanStack Query.
//
// E05-S11 : un Contexte se titre « Contexte · <section> », composé ici, jamais écrit en place (AC-17) ; les
// pages que citent les blocs montrés se lisent par leur titre (AC-26, AC-27), lues dans l'arbre visible.
// E05-S13 (AC-20) : plus de « Déplacer » en tête, à aucun niveau : le rail déplace (« ⋯ », glisser-déposer).
// Refonte #217 : plus de colonne de droite ni d'îlot autour du document (HN-E11S05-13 et -14 retirés) ; les liens au
// pied et dans « Liens » de l'en-tête (D1). Refonte #218 : les commentaires dans un panneau ouvert à la demande, à droite
// dès 1 024 px (D8) ; l'historique des versions de la page et d'un bloc dans un tiroir (`FournisseurDHistorique`).
// E10-S02 (lot c, AC-c2) : `?view=<id>` : la visionneuse d'un fichier joint remplace l'écran du nœud trouvé.
import type { ReactNode } from "react"
import { FileText } from "@phosphor-icons/react/dist/ssr/FileText"
import type { FileView, NodeCommentsView, NodeRulesView, NodeView, TreeNode } from "../../schemas"
import type { Resultat } from "../api/resultat"
import type { LienDeLHote } from "../arbre/navigateur-d-arbre"
import { ErreurDeLecture } from "../components/erreur-de-lecture"
import { EmptyState } from "../ds/react/empty-state"
import { Icon } from "../ds/react/icon"
import { ScreenHeader } from "../ds/react/screen-header"
import { Skeleton, SkeletonText } from "../ds/react/skeleton"
import type { SujetsDeRegle } from "../equipes/types"
import { ColonnesDuNoeud } from "./colonnes-du-noeud"
import { FournisseurDeCommentaires } from "./commentaires/fournisseur-de-commentaires"
import { blocsAffiches, cheminsCites, CorpsDuNoeud, niveauDEcritureDe, type CorpsDuNoeudProps } from "./corps-du-noeud"
import { FileDOperations } from "./editeur/file-d-operations"
import { ChapoDuNoeud, EnTeteDuNoeud } from "./en-tete-du-noeud"
import { titreDuContexte } from "./fil"
import { FournisseurDHistorique } from "./historique-du-noeud"
import { ECRAN, genreDuNoeud, INTROUVABLE, PARTAGE, resumeMontre } from "./libelles"
import { LiensDeLEnTete } from "./liens-de-l-en-tete"
import { PartageDuNoeud } from "./partage-du-noeud"
import { PiedDuNoeud } from "./pied-du-noeud"
import { ciblesDesLiens, nomsDesContextes } from "./sous-pages"
import { VeilleDeLaPage } from "./veille-de-la-page"
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
  /**
   * Les annexes d'un Contexte (E05-S04, AC10 ; refonte #217) : sous la méta, avant le texte (`AnnexesDuContexte` : sa
   * phrase de portée et la reprise de « Mes instructions »).
   */
  annexes?: ReactNode
  /**
   * Le pied d'un Contexte (refonte #217) : la section « Ce que reçoit votre assistant », posée au pied avant les
   * colonnes des liens (`AnnexesDuContexte` en `place="pied"`). Le nom vient de l'ancienne colonne de droite.
   */
  piedDeColonne?: ReactNode
  /** Le panneau « Partager » (AC19 ; E05-S10, AC-b5), ouvert depuis « Partager » de l'en-tête. */
  partage?: LecturesDuPartage
  /**
   * Les champs que sert `read` sur le nœud, pour « Cité dans » et « Cite » au pied et dans « Liens » (refonte #217) : lus
   * par l'hôte sans les attendre, attendus sous leur `<Suspense>`.
   */
  liens?: Promise<Resultat<Record<string, unknown>>>
  /**
   * Les fils de commentaires (`listComments`), lus par l'hôte sans les attendre et avant de compter la visite : le
   * « non lu » se calcule sur la visite précédente (D8). Absents, le panneau les lit par l'API.
   */
  fils?: Promise<Resultat<NodeCommentsView>>
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

/**
 * Ce qui suit la méta, avant le texte (brief § 5.1, point 4) : le résumé d'une procédure, les annexes d'un Contexte (sa
 * phrase de portée, la reprise de « Mes instructions »), puis une lecture de la page en échec. Rien sans eux.
 */
function LigneDuGenre({ vue, resume, modifiable, annexes, echec }: { vue: NodeView; resume: string; modifiable: boolean; annexes?: ReactNode; echec: ReactNode }) {
  const procedure = resumeMontre(genreDuNoeud(vue))
  if (!procedure && !annexes && !echec) return null
  return (
    <div className="oto-node-lead">
      {procedure && <ChapoDuNoeud vue={vue} resume={resume} modifiable={modifiable} />}
      {annexes}
      {echec}
    </div>
  )
}

function PageDuNoeud(props: PageDuNoeudProps) {
  const { vue, versionPubliee, arbre, equipes, prefixeDesPages } = props
  const niveauDEcriture = niveauDEcritureDe(vue, versionPubliee)
  const brouillon = niveauDEcriture === null ? null : vue.draft
  const equipesLues = equipes.error === undefined ? equipes.data : null
  const contexte = vue.kind === "context"
  const titreEcrit = brouillon?.title ?? vue.title
  const titre = contexte ? titreDuContexte(vue.path, equipesLues, props.handle) : titreEcrit
  const arbreLu = arbre.error === undefined ? arbre.data.tree : null
  const partage = props.partage && <PanneauDuPartage partage={props.partage} nomOrganisation={props.nomOrganisation} ici={props.ici} Lien={props.Lien} />
  // Un Contexte cité ou rangé dessous se nomme comme dans l'en-tête et le rail (E11-S15, AC-a9).
  const contextes = nomsDesContextes(arbreLu, equipesLues, props.handle)
  const navigation = { Lien: props.Lien, hrefDuChemin: props.hrefDuChemin }
  const liens = props.liens && <LiensDeLEnTete lecture={props.liens} arbre={arbreLu} equipes={equipesLues} handle={props.handle} contextes={contextes} {...navigation} />
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
      liens={liens}
    />
  )
  const cibles = ciblesDesLiens(arbre.error === undefined ? arbre.data : null, cheminsCites(blocsAffiches(vue, versionPubliee)), contextes)
  // Le document garde le nom écrit du nœud : seuls l'en-tête et le fil composent celui d'un Contexte.
  const corps: CorpsDuNoeudProps = { ...props, niveauDEcriture, titre: titreEcrit, cibles }
  const lead = (
    <LigneDuGenre
      vue={vue}
      resume={brouillon?.summary ?? vue.summary}
      modifiable={niveauDEcriture !== null}
      annexes={props.annexes}
      // Seulement une lecture en échec : un élément toujours passé ouvrait la ligne vide, et sa marge, sous chaque méta.
      echec={arbre.error !== undefined || equipes.error !== undefined ? <LecturesEnEchec arbre={arbre} equipes={equipes} ici={props.ici} Lien={props.Lien} /> : null}
    />
  )
  const pied = <PiedDuNoeud vue={vue} arbre={arbreLu} liens={props.liens} contextes={contextes} ici={props.ici} avant={props.piedDeColonne} {...navigation} />
  // L'en-tête et le corps sont frères dans le contenu ; l'en-tête prend la largeur du contenu quel que soit le genre, son
  // titre et sa méta alignés sur la colonne du document (`product.css`) ; la ligne du genre, le bandeau de la veille de la
  // page ouverte (retour RET-008, brief § 5.1 point 5 : une ligne en `Alert` sous la méta, rien tant qu'elle n'a pas
  // changé ailleurs), le texte posé à plat, puis le pied ; un panneau ouvert (commentaires, historique) se pose à droite
  // (`ColonnesDuNoeud`). Un tableau garde toute la largeur (AC-e3) : sa grille encadrée, ses agrégats, puis le pied.
  const colonnes = (
    <ColonnesDuNoeud mesure={vue.kind === "table" ? undefined : "document"}>
      {lead}
      <VeilleDeLaPage chemin={vue.path} revision={vue.revision} />
      <CorpsDuNoeud {...corps} />
      {pied}
    </ColonnesDuNoeud>
  )
  const ecran =
    vue.kind === "table" ? (
      <div className="oto-content-max">
        {entete}
        {colonnes}
      </div>
    ) : (
      <>
        {entete}
        {colonnes}
      </>
    )
  // Seuls les blocs publiés se commentent : leurs identifiants, que la bulle d'un bloc lit, à la lecture comme dans l'éditeur.
  const commente = (
    <FournisseurDeCommentaires
      chemin={vue.path}
      revision={vue.revision}
      blocsPublies={vue.kind === "table" ? [] : vue.blocks.map((bloc) => bloc.id)}
      filsServis={props.fils}
    >
      {vue.status === "published" ? <FournisseurDHistorique noeud={{ chemin: vue.path, titre }}>{ecran}</FournisseurDHistorique> : ecran}
    </FournisseurDeCommentaires>
  )
  if (niveauDEcriture === null) return commente
  return (
    <FileDOperations key={vue.id} chemin={vue.path} revisionPubliee={vue.revision} tampon={vue.draft?.draftStamp ?? null}>
      {commente}
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
      <section className="oto-node-document" aria-label={ECRAN.chargement}>
        <SkeletonText lines={4} />
      </section>
    </div>
  )
}
