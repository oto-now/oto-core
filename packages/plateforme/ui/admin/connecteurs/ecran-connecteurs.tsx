// « Connecteurs » du tableau de bord : les outils que l'assistant de la personne peut utiliser. Une seule vue, la même
// pour un administrateur et pour un membre : chaque compte que la personne voit (les siens, ceux de ses équipes, de
// l'organisation, ceux qu'un autre partage avec elle), dit « connecteur », avec son accès, son état en un mot et le geste
// qui le répare ; des filtres et une recherche tenus par l'adresse ; le détail d'un connecteur dans un tiroir, ouvert par
// l'adresse (`detail-du-connecteur.tsx`), où qui le gère le partage comme une page, remplace sa clé, lit le journal de
// ses partages et le désactive ; « Ajouter un connecteur » (`ajout-d-un-connecteur.tsx`) ; l'issue du retour d'un
// consentement. Pour un administrateur, en plus, « Outils de l'organisation » : les outils ouverts (tout outil déclaré
// l'est par défaut), ceux qu'il a fermés, qu'il ferme ou rouvre. Server Component : il calcule les
// lignes (`lignes-des-connecteurs.ts`) et le catalogue de l'ajout (`catalogue-des-connecteurs.ts`), et ne passe à ses
// îlots clients que des données.
//
// Les mots « activation », « compte » et « secret » ne s'écrivent plus pour un membre (`connecteurs-et-comptes.md`
// § Écran Connecteurs). L'écran masque un geste, le service le décide.
import { Plug } from "@phosphor-icons/react/dist/ssr/Plug"
import type { AccountOwnerChoices, AccountView, ConnectorAccountForm, DeactivationImpact, OrgConnector, OrgLimitsView } from "../../../schemas"
import type { Resultat } from "../../api/resultat"
import { ActionPlateforme } from "../../components/action-plateforme"
import { Alert } from "../../ds/react/primitives"
import { EmptyState } from "../../ds/react/empty-state"
import { Icon } from "../../ds/react/icon"
import { Row, RowList } from "../../ds/react/row-list"
import type { SujetsDeRegle } from "../../equipes/types"
import { dateLisible } from "../../format/dates"
import { EnTeteDAdministration } from "../en-tete"
import { ErreurDeLecture } from "../../components/erreur-de-lecture"
import { Chargement, Ilot } from "../ilot"
import { questionDeDesactivation } from "../textes"
import type { FilDeLEcran, LienDeLAdministration } from "../types"
import { AjoutDUnConnecteur } from "./ajout-d-un-connecteur"
import { outilsAAjouter } from "./catalogue-des-connecteurs"
import { DetailDuConnecteur } from "./detail-du-connecteur"
import { estAMoi, formulaireDuCompte } from "./etat-du-compte"
import { adresseDeLaVue, fonctionsDe, libelleDuConnecteur, lignesDesConnecteurs, type PartagesDuCompte, type VueDesConnecteurs } from "./lignes-des-connecteurs"
import { ListeDesConnecteurs } from "./liste-des-connecteurs"

/** Ce que la page lit pour l'écran : les comptes que la personne voit, le catalogue, leurs partages, et à qui partager. */
export type DonneesDesConnecteurs = {
  /** Chaque compte que la personne voit au niveau lecture au moins (`listOrgAccounts`). */
  accounts: AccountView[]
  /** Le catalogue et son état dans l'organisation : les fonctions de chaque connecteur (`listConnectorsForOrg`). */
  connectors: OrgConnector[]
  /** Le formulaire de compte de chaque connecteur réel déclaré (`connectorAccountForms`) ; absents : comptes simulés seuls. */
  formulaires?: ConnectorAccountForm[]
  /** Par compte dont la page a lu les règles (`comptesAuxPartagesLus`, `listAccountRules`) : ses partages. */
  partages: Partial<Record<string, PartagesDuCompte>>
  /** Les équipes et les personnes de l'organisation, à qui partager un connecteur. */
  sujets: SujetsDeRegle
  /** Pour qui la personne peut ajouter un connecteur (`accountOwnerChoices`) : elle-même, l'organisation, ses équipes. */
  proprietaires: AccountOwnerChoices
  /**
   * Pour qui administre l'organisation : ce que la fermeture de chaque connecteur ouvert arrête (AC5). Absent pour un
   * membre. `limites` n'est plus lu : le nombre de connecteurs n'est plus limité, rien n'est grisé ; gardé pour les hôtes.
   */
  administration?: { impacts: Partial<Record<string, DeactivationImpact>>; limites?: OrgLimitsView }
}

/**
 * L'issue d'un consentement, lue dans l'adresse où le tiers ramène la personne (`issueDuConsentement`). Réussie, sans le
 * nom du compte : l'adresse le porte, mais un lien forgé y écrirait n'importe quel texte.
 */
export type IssueDuConsentement = { issue: "connected" } | { issue: "failed"; raison: string }

export type EcranConnecteursProps = {
  resultat: Resultat<DonneesDesConnecteurs>
  /** L'identifiant de qui regarde : ses comptes personnels sont « À moi ». */
  moi: string
  /** Ce que l'adresse demande : le filtre, la recherche et le détail ouvert (`vueDesConnecteurs(query)`). */
  vue: VueDesConnecteurs
  Lien: LienDeLAdministration
  /** L'adresse de l'écran dans l'hôte : « Réessayer » d'une lecture en échec y ramène, un consentement y revient. */
  ici: string
  /** Le fil de l'en-tête : les adresses que l'hôte donne au rail et le droit de la personne ; sans lui, pas de fil. */
  fil?: FilDeLEcran
  /** L'issue du consentement dont la personne revient ; absente hors d'un retour. */
  consentement?: IssueDuConsentement
}

/**
 * L'issue d'un consentement ou d'un branchement hébergé lue dans la query de l'écran (`?consent=connected&account=…`
 * ou `?consent=failed&reason=<code>` ; `hosted=` de même, posée par l'adresse de retour du paquet) ; `undefined` hors
 * d'un retour. `account` n'est pas lu : son texte vient de l'adresse.
 */
export function issueDuConsentement(query: Readonly<Record<string, string | string[] | undefined>>): IssueDuConsentement | undefined {
  const lu = (nom: string) => {
    const valeur = query[nom]
    return typeof valeur === "string" ? valeur : undefined
  }
  const issue = lu("consent") ?? lu("hosted")
  if (issue === "connected") return { issue: "connected" }
  if (issue === "failed") return { issue: "failed", raison: lu("reason") ?? "" }
  return undefined
}

/** Ce que dit l'échec d'un consentement ou d'un branchement, par le code du refus ou sa raison. */
const ECHECS_DU_CONSENTEMENT: Readonly<Record<string, string>> = {
  invalid_arguments: "La connexion n'a pas abouti : refusée, annulée, expirée ou déjà servie. Recommencez.",
  upstream_error: "Le service tiers n'a pas pu terminer la connexion. Réessayez plus tard.",
  not_enabled: "La connexion à ce service n'est pas configurée sur cette application.",
  conflict: "Un autre connecteur de l'organisation porte déjà ce nom.",
  not_found: "Cette demande de connexion est inconnue ou déjà servie. Recommencez.",
  expired: "Cette demande de connexion a expiré. Recommencez.",
  no_candidate: "Aucun compte connecté pendant cette demande n'a été trouvé. Recommencez.",
  candidates_dead: "La session de ce compte chez le service tiers est déconnectée. Recommencez.",
  ambiguous_candidates: "Plusieurs comptes pourraient correspondre à cette demande ; rien n'a été rangé. Recommencez dans quelques minutes.",
  forbidden: "Ce connecteur ne peut pas être connecté par vous.",
}

/**
 * Ce que dit l'échec d'un consentement ou d'un branchement dont la raison est lue dans l'adresse : une raison connue
 * seule, jamais le texte de l'adresse, qu'un lien forgé écrirait ; une autre, la phrase générique.
 */
export function echecDuConsentement(raison: string): string {
  return Object.hasOwn(ECHECS_DU_CONSENTEMENT, raison) ? ECHECS_DU_CONSENTEMENT[raison] : "La connexion a échoué. Réessayez."
}

function AnnonceDuConsentement({ consentement }: { consentement: IssueDuConsentement }) {
  if (consentement.issue === "connected") return <Alert tone="ok" title="Le compte est connecté." />
  return <Alert tone="fail" title={echecDuConsentement(consentement.raison)} />
}

/** Le titre de l'îlot de l'administrateur : le focus y va quand un geste emporte sa ligne. */
const ANCRE_DES_CONNECTEURS = "admin-connecteurs"

function pluriel(nombre: number, singulier: string, pluriel: string): string {
  return `${nombre} ${nombre > 1 ? pluriel : singulier}`
}

/** Ouvert depuis son adoption, ouvert par défaut (personne ne l'a encore ajouté), ou fermé par un administrateur. */
function etat(connecteur: OrgConnector): string {
  if (connecteur.state !== "active") return `Fermé par ${connecteur.closedBy?.name ?? "un administrateur"}`
  if (connecteur.activatedAt === null) return "Ouvert"
  const qui = connecteur.activatedBy?.name
  return `Ouvert depuis le ${dateLisible(connecteur.activatedAt) ?? "?"}${qui ? ` (${qui})` : ""}`
}

/** La réouverture d'un outil fermé (îlot réservé aux administrateurs) : aucun plafond, le nombre d'outils n'est pas limité. */
function Activation({ nom, ressource }: { nom: string; ressource: string }) {
  // Réversible : sans question (N5).
  return <ActionPlateforme libelle="Rouvrir" nomAccessible={`Rouvrir ${nom}`} requete={{ methode: "POST", ressource, corps: {} }} ancre={ANCRE_DES_CONNECTEURS} />
}

type LigneDeConnecteurProps = { connecteur: OrgConnector; impact: DeactivationImpact | undefined }

function LigneDeConnecteur({ connecteur, impact }: LigneDeConnecteurProps) {
  const nom = connecteur.label
  const ressource = `admin/connectors/${encodeURIComponent(connecteur.connector)}/activation`
  // Fermé : la ligne garde qui l'a fermé, même inconnu. Ouvert, adopté ou par défaut, un outil se ferme.
  const ferme = connecteur.state !== "active"
  // `flex-wrap` : la question d'une désactivation, ou un refus, passe sous la ligne au lieu de l'écraser.
  return (
    <Row className="flex-wrap gap-3" lead={<Icon as={Plug} size="sm" />}>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="font-medium">{nom}</span>
        <span className="oto-caption">{pluriel(connecteur.functions.length, "fonction", "fonctions")}</span>
      </div>
      <span className="oto-caption">{etat(connecteur)}</span>
      {!ferme && (
        <ActionPlateforme
          libelle="Fermer"
          nomAccessible={`Fermer ${nom}`}
          requete={{ methode: "DELETE", ressource }}
          confirmation={{ question: questionDeDesactivation(nom, impact), libelleConfirmer: "Fermer" }}
          ancre={ANCRE_DES_CONNECTEURS}
        />
      )}
      {ferme && <Activation nom={nom} ressource={ressource} />}
    </Row>
  )
}

type ConnecteursProps = { connecteurs: OrgConnector[]; impacts: Partial<Record<string, DeactivationImpact>> }

/** « Outils de l'organisation », pour un administrateur : les outils du catalogue, qu'il ferme ou rouvre pour toute l'organisation. */
function Connecteurs({ connecteurs, impacts }: ConnecteursProps) {
  return (
    <Ilot id={ANCRE_DES_CONNECTEURS} titre="Outils de l'organisation" compte={pluriel(connecteurs.length, "outil", "outils")}>
      <div className="flex flex-col gap-3">
        <p className="oto-caption">Chaque outil est ouvert par défaut : l&apos;assistant le trouve et propose à chacun de connecter son compte. Fermer un outil le retire aussitôt pour toute l&apos;organisation. Les fonctions de tableau (table.*) et celles de l&apos;application sont toujours ouvertes.</p>
        <RowList rules empty={<EmptyState compact title="Aucun outil dans cette version de la plateforme." />}>
          {connecteurs.map((connecteur) => (
            <LigneDeConnecteur key={connecteur.connector} connecteur={connecteur} impact={impacts[connecteur.connector]} />
          ))}
        </RowList>
      </div>
    </Ilot>
  )
}

/** « Ajouter un connecteur » : le catalogue de la personne, les équipes qu'elle peut doter, et les noms qu'elle porte déjà. */
function Ajout({ donnees, moi, ici }: { donnees: DonneesDesConnecteurs; moi: string; ici: string }) {
  return (
    <AjoutDUnConnecteur
      outils={outilsAAjouter(donnees.connectors, donnees.formulaires ?? [], donnees.proprietaires)}
      equipes={donnees.proprietaires.teams}
      mesNoms={donnees.accounts.filter((compte) => estAMoi(compte, moi)).map((compte) => compte.label)}
      ici={ici}
    />
  )
}

type VueProps = { donnees: DonneesDesConnecteurs; moi: string; vue: VueDesConnecteurs; ici: string }

/** L'adresse de la recherche, sans `q` : le filtre de la vue y reste. */
function recherche(vue: VueDesConnecteurs, ici: string): { chemin: string; parametres: [string, string][] } {
  return { chemin: ici, parametres: vue.filtre === "all" ? [] : [["filter", vue.filtre]] }
}

/** La liste, ses filtres et sa recherche ; sans aucun compte visible, la page vide. */
function Liste({ donnees, moi, vue, ici }: VueProps) {
  if (donnees.accounts.length === 0) {
    return (
      <EmptyState icon={<Icon as={Plug} />} title="Aucun connecteur pour l'instant" action={<Ajout donnees={donnees} moi={moi} ici={ici} />}>
        Branchez un outil pour que votre assistant puisse y lire et y agir. Il reste privé tant que vous ne le partagez pas.
      </EmptyState>
    )
  }
  const sources = { comptes: donnees.accounts, formulaires: donnees.formulaires ?? [], partages: donnees.partages, moi, ici }
  const { lignes, comptes } = lignesDesConnecteurs(sources, vue)
  const filtres = [
    { valeur: "all", libelle: `Tous · ${comptes.tous}`, adresse: adresseDeLaVue(ici, { ...vue, filtre: "all", compte: null }) },
    { valeur: "mine", libelle: `À moi · ${comptes.moi}`, adresse: adresseDeLaVue(ici, { ...vue, filtre: "mine", compte: null }) },
    { valeur: "shared", libelle: `Partagés avec moi · ${comptes.partages}`, adresse: adresseDeLaVue(ici, { ...vue, filtre: "shared", compte: null }) },
  ]
  return (
    <>
      <ListeDesConnecteurs lignes={lignes} filtres={filtres} filtre={vue.filtre} q={vue.q} recherche={recherche(vue, ici)} ici={ici} />
      <p className="oto-caption">Un connecteur est privé tant que vous ne le partagez pas.</p>
    </>
  )
}

/** Le détail du compte que l'adresse ouvre, s'il est de ceux que la personne voit ; sinon rien. */
function Detail({ donnees, moi, vue, ici }: VueProps) {
  const compte = donnees.accounts.find((candidat) => candidat.id === vue.compte)
  if (!compte) return null
  const formulaires = donnees.formulaires ?? []
  return (
    <DetailDuConnecteur
      // Une instance par compte : le tiroir refermé d'un compte ne sert jamais, encore fermé, à un autre.
      key={compte.id}
      compte={compte}
      formulaire={formulaireDuCompte(formulaires, compte)}
      outil={libelleDuConnecteur(compte.connector, formulaires)}
      fonctions={fonctionsDe(compte.connector, donnees.connectors)}
      partages={donnees.partages[compte.id]}
      sujets={donnees.sujets}
      moi={moi}
      ici={ici}
      fermer={adresseDeLaVue(ici, { ...vue, compte: null })}
    />
  )
}

function Donnees(props: VueProps) {
  const { administration, connectors } = props.donnees
  return (
    <div className="flex flex-col gap-6">
      <Liste {...props} />
      {administration && <Connecteurs connecteurs={connectors} impacts={administration.impacts} />}
      <Detail {...props} />
    </div>
  )
}

const SOUS_TITRE = "Les outils que votre assistant peut utiliser pour vous."

export function EcranConnecteurs({ resultat, moi, vue, Lien, ici, fil, consentement }: EcranConnecteursProps) {
  // Une lecture nourrit tout l'écran : son échec se dit une fois, sans « Ajouter », qui a besoin d'elle.
  const lu = resultat.error === undefined ? resultat.data : null
  // « Ajouter un connecteur » : dans l'en-tête quand la liste a des lignes, dans la page vide sinon, jamais deux fois.
  const ajout = lu && lu.accounts.length > 0 ? <Ajout donnees={lu} moi={moi} ici={ici} /> : undefined
  return (
    <>
      <EnTeteDAdministration courant="connecteurs" fil={fil} titre="Connecteurs" glyphe={Plug} meta={SOUS_TITRE} actions={ajout} />
      {consentement && <AnnonceDuConsentement consentement={consentement} />}
      {lu ? <Donnees donnees={lu} moi={moi} vue={vue} ici={ici} /> : <ErreurDeLecture message={resultat.error ?? ""} href={ici} Lien={Lien} />}
    </>
  )
}

/** L'état de chargement, rendu par le `loading.tsx` de l'hôte (AC12). */
export function EcranConnecteursChargement() {
  return <Chargement texte="Chargement des connecteurs…" />
}
