// « Connecteurs » du tableau de bord (E08-S03, AC4 à AC7, AC12 ; comptes à plusieurs champs ; consentement d'une
// personne) : les connecteurs activables et leur état, qu'on active ou désactive ; les comptes de l'organisation,
// simulés ou réels, qu'on crée ou désactive, et le secret et les réglages d'un compte réel, saisis sous sa ligne ; pour
// un connecteur à consentement (`oauth2_user`) ou à compte rattaché (`accountIdentity`), « Connecter mon compte » (ou
// « Reconnecter » sous un compte à reconnecter), l'issue du retour du tiers, et la marque d'un compte (clé refusée,
// crédits épuisés) avec sa date. Server Component : les gestes sont les `ActionPlateforme` d'E05-S03,
// la question d'une désactivation composée ici depuis son impact ; le formulaire de création, la saisie d'un compte et
// la connexion par consentement sont des îlots clients.
//
// Porté d'oto-frontend (`components/connecteurs/liste-connecteurs.tsx` l. 196-234, 405-432, 480-511, et la
// capture de `/connectors`), E05-S09 partie d2. Repris : l'en-tête, deux colonnes, l'îlot des connecteurs au
// compte dans son en-tête, une ligne par connecteur (`RowList`, `Row`) sous le glyphe de prise, l'état au
// bout de la ligne, en texte et jamais par la couleur seule, des états vides qui disent la vérité ; en annexe, l'îlot où
// l'on ajoute. Retiré : replis des connexions, pagination, compteurs, états des sondes (`broken`, `noKey`,
// `overQuota`, `stepLeft` : V2), marques d'outils, liens vers une page de connecteur, pile de clés, toolbox
// (architecture § 10).
import { Plug } from "@phosphor-icons/react/dist/ssr/Plug"
import { limitReached, type AccountMarkReason, type AccountMode, type AccountView, type ConnectorAccountForm, type DeactivationImpact, type OrgConnector, type OrgLimitsView } from "../../../schemas"
import type { Resultat } from "../../api/resultat"
import { ActionPlateforme } from "../../components/action-plateforme"
import { Alert } from "../../ds/react/primitives"
import { EmptyState } from "../../ds/react/empty-state"
import { Icon } from "../../ds/react/icon"
import { Row, RowList } from "../../ds/react/row-list"
import { TwoColumns } from "../../ds/react/two-columns"
import { dateLisible } from "../../format/dates"
import { LimiteAtteinte } from "../../limites/limite-atteinte"
import { EnTeteDAdministration } from "../en-tete"
import { ErreurDeLecture } from "../../components/erreur-de-lecture"
import { Chargement, Ilot } from "../ilot"
import { questionDeDesactivation, questionDeDesactivationDuCompte } from "../textes"
import type { FilDeLEcran, LienDeLAdministration } from "../types"
import { ConnexionParConsentement } from "./connexion-par-consentement"
import { CreationDeCompte } from "./creation-de-compte"
import { SaisieDuCompte } from "./saisie-du-compte"

/** Ce que la page lit pour l'écran : le catalogue et son état, l'impact de chaque désactivation possible, les comptes, les équipes. */
export type DonneesDesConnecteurs = {
  connectors: OrgConnector[]
  /** Par connecteur actif : ce que sa désactivation arrête (AC5). */
  impacts: Partial<Record<string, DeactivationImpact>>
  accounts: AccountView[]
  options: { teams: { id: string; name: string }[] }
  /** Les capacités de l'organisation (`orgLimitsView`, E12-S02) ; absentes : aucune activation grisée. */
  limites?: OrgLimitsView
  /** Le formulaire de compte de chaque connecteur réel déclaré (`connectorAccountForms`) ; absents : comptes simulés seuls. */
  formulaires?: ConnectorAccountForm[]
}

/** L'issue d'un consentement, lue dans l'adresse où le tiers ramène la personne (`issueDuConsentement`). */
export type IssueDuConsentement = { issue: "connected"; compte: string } | { issue: "failed"; raison: string }

export type EcranConnecteursProps = {
  resultat: Resultat<DonneesDesConnecteurs>
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
 * d'un retour.
 */
export function issueDuConsentement(query: Readonly<Record<string, string | string[] | undefined>>): IssueDuConsentement | undefined {
  const lu = (nom: string) => {
    const valeur = query[nom]
    return typeof valeur === "string" ? valeur : undefined
  }
  const issue = lu("consent") ?? lu("hosted")
  if (issue === "connected") return { issue: "connected", compte: lu("account") ?? "" }
  if (issue === "failed") return { issue: "failed", raison: lu("reason") ?? "" }
  return undefined
}

/** Ce que dit l'échec d'un consentement ou d'un branchement, par le code du refus ou sa raison. */
const ECHECS_DU_CONSENTEMENT: Readonly<Record<string, string>> = {
  invalid_arguments: "La connexion n'a pas abouti : refusée, annulée, expirée ou déjà servie. Recommencez.",
  upstream_error: "Le service tiers n'a pas pu terminer la connexion. Réessayez plus tard.",
  not_enabled: "La connexion à ce service n'est pas configurée sur cette application.",
  conflict: "Un autre compte de l'organisation porte déjà ce nom.",
  not_found: "Cette demande de connexion est inconnue ou déjà servie. Recommencez.",
  expired: "Cette demande de connexion a expiré. Recommencez.",
  no_candidate: "Aucun compte connecté pendant cette demande n'a été trouvé. Recommencez.",
  candidates_dead: "La session de ce compte chez le service tiers est déconnectée. Recommencez.",
  ambiguous_candidates: "Plusieurs comptes pourraient correspondre à cette demande ; rien n'a été rangé. Recommencez dans quelques minutes.",
  forbidden: "Ce compte ne peut pas être connecté par vous.",
}

function AnnonceDuConsentement({ consentement }: { consentement: IssueDuConsentement }) {
  if (consentement.issue === "connected") return <Alert tone="ok" title={`Compte « ${consentement.compte} » connecté.`} />
  return <Alert tone="fail" title={ECHECS_DU_CONSENTEMENT[consentement.raison] ?? "La connexion du compte a échoué. Réessayez."} />
}

/** Les titres des deux listes : le focus y va quand un geste emporte sa ligne. */
const ANCRE_DES_CONNECTEURS = "admin-connecteurs"
const ANCRE_DES_COMPTES = "admin-comptes"

const MODES: Record<AccountMode, string> = { simule: "simulé", sandbox: "bac à sable", reel: "réel" }
const ETATS: Record<AccountView["status"], string> = { active: "actif", disabled: "désactivé", error: "en erreur" }
const MARQUES: Record<AccountMarkReason, string> = { credential_rejected: "clé refusée", quota_exhausted: "crédits épuisés" }

/** La marque d'un compte, sa raison et sa date : le compte reste appelé, le premier appel réussi la lève. */
function marque(compte: AccountView): string | null {
  return compte.mark ? `${MARQUES[compte.mark.reason]} le ${dateLisible(compte.mark.at)}` : null
}

function pluriel(nombre: number, singulier: string, pluriel: string): string {
  return `${nombre} ${nombre > 1 ? pluriel : singulier}`
}

function etat(connecteur: OrgConnector): string {
  if (connecteur.state !== "active") return "Inactif"
  const qui = connecteur.activatedBy?.name
  return `Actif depuis le ${dateLisible(connecteur.activatedAt) ?? "?"}${qui ? ` (${qui})` : ""}`
}

/** L'activation d'un connecteur inactif : grisée au plafond de `connectors_max` (E12-S02), avec le lien de l'hôte (écran réservé aux administrateurs). */
function Activation({ nom, ressource, limites }: { nom: string; ressource: string; limites: OrgLimitsView | undefined }) {
  if (limites?.connectors && limitReached(limites.connectors)) {
    return <LimiteAtteinte libelle="Activer" nom="connectors_max" etat={limites.connectors} lien={limites.raiseUrl} />
  }
  // Réversible : sans question (N5).
  return <ActionPlateforme libelle="Activer" nomAccessible={`Activer ${nom}`} requete={{ methode: "POST", ressource, corps: {} }} ancre={ANCRE_DES_CONNECTEURS} />
}

type LigneDeConnecteurProps = { connecteur: OrgConnector; impact: DeactivationImpact | undefined; limites: OrgLimitsView | undefined }

function LigneDeConnecteur({ connecteur, impact, limites }: LigneDeConnecteurProps) {
  const nom = connecteur.connector
  const fonctions = connecteur.functions.map((fonction) => fonction.name)
  const ressource = `admin/connectors/${encodeURIComponent(nom)}/activation`
  // `flex-wrap` : la question d'une désactivation, ou un refus, passe sous la ligne au lieu de l'écraser.
  return (
    <Row className="flex-wrap gap-3" lead={<Icon as={Plug} size="sm" />}>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="font-medium">{nom}</span>
        <span className="oto-caption">{`${pluriel(fonctions.length, "fonction", "fonctions")} : ${fonctions.join(", ")}`}</span>
      </div>
      <span className="oto-caption">{etat(connecteur)}</span>
      {connecteur.state === "active" ? (
        <ActionPlateforme
          libelle="Désactiver"
          nomAccessible={`Désactiver ${nom}`}
          requete={{ methode: "DELETE", ressource }}
          confirmation={{ question: questionDeDesactivation(nom, impact), libelleConfirmer: "Désactiver" }}
          ancre={ANCRE_DES_CONNECTEURS}
        />
      ) : (
        <Activation nom={nom} ressource={ressource} limites={limites} />
      )}
    </Row>
  )
}

type ConnecteursProps = { connecteurs: OrgConnector[]; impacts: DonneesDesConnecteurs["impacts"]; limites: OrgLimitsView | undefined }

function Connecteurs({ connecteurs, impacts, limites }: ConnecteursProps) {
  return (
    <Ilot id={ANCRE_DES_CONNECTEURS} titre="Connecteurs" compte={pluriel(connecteurs.length, "connecteur activable", "connecteurs activables")}>
      <div className="flex flex-col gap-3">
        <p className="oto-caption">Les fonctions de tableau (table.*) et celles de l&apos;application sont toujours actives : elles ne s&apos;activent pas.</p>
        <RowList rules empty={<EmptyState compact title="Aucun connecteur à activer dans cette version de la plateforme." />}>
          {connecteurs.map((connecteur) => (
            <LigneDeConnecteur key={connecteur.connector} connecteur={connecteur} impact={impacts[connecteur.connector]} limites={limites} />
          ))}
        </RowList>
      </div>
    </Ilot>
  )
}

/** Le propriétaire décrit en français (H05) : l'organisation, l'équipe nommée, ou un compte personnel. */
function proprietaire(owner: AccountView["owner"]): string {
  if (owner.kind === "team") return `équipe ${owner.teamName ?? "inconnue"}`
  return owner.kind === "org" ? "organisation" : "personnel"
}

/** Comment se connecte un compte d'un connecteur : saisi à la main, par consentement, ou branché chez le tiers. */
type Connexion = "saisie" | "consentement" | "branchement"

const connexionDe = (formulaire: ConnectorAccountForm | undefined): Connexion =>
  formulaire?.consent === true ? "consentement" : formulaire?.hosted ? "branchement" : "saisie"

/** La porte du bouton « Connecter mon compte » d'un connecteur à consentement ou à compte rattaché. */
const PORTES = { consentement: "connector-consent", branchement: "hosted-link" } as const

/**
 * Ce que la ligne dit du secret d'un compte réel, jamais sa valeur ; d'un consentement, ses jetons ou sa raison ; d'un
 * compte branché, sa raison quand il est à reconnecter.
 */
function etatDuSecret(compte: AccountView, connexion: Connexion): string | null {
  if (compte.mode !== "reel") return null
  const date = compte.secret?.updatedAt ? dateLisible(compte.secret.updatedAt) : null
  if (connexion === "branchement") return compte.status === "error" ? `à reconnecter${compte.statusReason ? ` : ${compte.statusReason}` : ""}` : null
  if (connexion === "consentement") {
    if (compte.status === "error") return `à reconnecter${compte.statusReason ? ` : ${compte.statusReason}` : ""}`
    return date ? `jetons du ${date}` : "pas encore connecté"
  }
  return date ? `secret posé le ${date}` : "sans secret"
}

function LigneDeCompte({ compte, formulaire, ici }: { compte: AccountView; formulaire: ConnectorAccountForm | undefined; ici: string }) {
  const connexion = connexionDe(formulaire)
  const parties = [compte.label, compte.connector, proprietaire(compte.owner), MODES[compte.mode], ETATS[compte.status], marque(compte), etatDuSecret(compte, connexion)]
  const reconnectable = formulaire && compte.status === "error" && (connexion === "consentement" || (connexion === "branchement" && formulaire.hosted?.ready === true))
  return (
    <Row className="flex-wrap gap-3">
      <span className="min-w-0 flex-1">{parties.filter((partie) => partie !== null).join(" · ")}</span>
      {compte.status !== "disabled" && (
        <ActionPlateforme
          libelle="Désactiver"
          nomAccessible={`Désactiver le compte ${compte.label}`}
          requete={{ methode: "POST", ressource: `admin/accounts/${encodeURIComponent(compte.id)}/disable`, corps: {} }}
          confirmation={{ question: questionDeDesactivationDuCompte(compte.label), libelleConfirmer: "Désactiver" }}
          ancre={ANCRE_DES_COMPTES}
        />
      )}
      {compte.mode === "reel" && compte.status !== "disabled" && formulaire && connexion === "saisie" && <SaisieDuCompte compte={compte} formulaire={formulaire} />}
      {reconnectable && (
        <ConnexionParConsentement
          ressource={PORTES[connexion]}
          connecteur={formulaire.connector}
          libelle="Reconnecter"
          nomAccessible={`Reconnecter le compte ${compte.label}`}
          retour={ici}
        />
      )}
    </Row>
  )
}

type ComptesProps = { comptes: AccountView[]; connecteurs: string[]; equipes: DonneesDesConnecteurs["options"]["teams"]; formulaires: ConnectorAccountForm[]; ici: string }

/**
 * Les annexes : les comptes, la connexion de son propre compte à un connecteur à consentement ou à compte rattaché
 * (quand l'hôte a fourni son port), puis l'îlot où l'on crée un compte (jamais de ces connecteurs : chacun y connecte
 * le sien).
 */
function Comptes({ comptes, connecteurs, equipes, formulaires, ici }: ComptesProps) {
  const personnels = formulaires.filter((formulaire) => connexionDe(formulaire) !== "saisie")
  const parConsentement = personnels.filter((formulaire) => formulaire.consent === true || formulaire.hosted?.ready === true)
  const aCreer = connecteurs.filter((connecteur) => !personnels.some((formulaire) => formulaire.connector === connecteur))
  return (
    <>
      <Ilot id={ANCRE_DES_COMPTES} titre="Comptes" compte={pluriel(comptes.length, "compte", "comptes")}>
        <RowList rules empty={<EmptyState compact>Aucun compte. Créez un compte pour qu&apos;une procédure puisse appeler un connecteur.</EmptyState>}>
          {comptes.map((compte) => (
            <LigneDeCompte key={compte.id} compte={compte} formulaire={formulaires.find((formulaire) => formulaire.connector === compte.connector)} ici={ici} />
          ))}
        </RowList>
      </Ilot>
      {parConsentement.length > 0 && (
        <Ilot id="admin-connecter-mon-compte" titre="Connecter mon compte">
          <div className="flex flex-col gap-3">
            <p className="oto-caption">Ces services se connectent personne par personne : chacun y connecte son propre compte, qui devient l&apos;un de ses comptes personnels.</p>
            {parConsentement.map((formulaire) => (
              <ConnexionParConsentement
                key={formulaire.connector}
                ressource={formulaire.consent === true ? PORTES.consentement : PORTES.branchement}
                connecteur={formulaire.connector}
                libelle={`Connecter mon compte ${formulaire.label}`}
                retour={ici}
              />
            ))}
          </div>
        </Ilot>
      )}
      <Ilot id="admin-creer-un-compte" titre="Créer un compte">
        {aCreer.length === 0 ? (
          <p>Aucun connecteur ne demande de compte dans cette version de la plateforme.</p>
        ) : (
          <CreationDeCompte connecteurs={aCreer} equipes={equipes} formulaires={formulaires} />
        )}
      </Ilot>
    </>
  )
}

function Donnees({ donnees, ici }: { donnees: DonneesDesConnecteurs; ici: string }) {
  const connecteurs = donnees.connectors.map((connecteur) => connecteur.connector)
  return (
    <TwoColumns aside={<Comptes comptes={donnees.accounts} connecteurs={connecteurs} equipes={donnees.options.teams} formulaires={donnees.formulaires ?? []} ici={ici} />}>
      <Connecteurs connecteurs={donnees.connectors} impacts={donnees.impacts} limites={donnees.limites} />
    </TwoColumns>
  )
}

export function EcranConnecteurs({ resultat, Lien, ici, fil, consentement }: EcranConnecteursProps) {
  // Une lecture nourrit les îlots : son échec, ou la réserve d'un non-administrateur (AC1), se dit une fois.
  return (
    <>
      <EnTeteDAdministration courant="connecteurs" fil={fil} titre="Connecteurs" glyphe={Plug} />
      {consentement && <AnnonceDuConsentement consentement={consentement} />}
      {resultat.error !== undefined ? <ErreurDeLecture message={resultat.error} href={ici} Lien={Lien} /> : <Donnees donnees={resultat.data} ici={ici} />}
    </>
  )
}

/** L'état de chargement, rendu par le `loading.tsx` de l'hôte (AC12). */
export function EcranConnecteursChargement() {
  return <Chargement texte="Chargement des connecteurs…" />
}
