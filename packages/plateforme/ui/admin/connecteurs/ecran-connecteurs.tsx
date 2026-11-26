// « Connecteurs » du tableau de bord : les outils que l'assistant de la personne peut utiliser. Un seul objet à l'écran,
// le connecteur, et une seule vue, la même pour un administrateur et pour un membre : chaque compte que la personne voit
// (les siens, ceux de ses équipes, de l'organisation, ceux qu'un autre partage avec elle), avec son accès, son état en
// un mot et le geste qui le répare ; des filtres et une recherche tenus par l'adresse ; le détail d'un connecteur dans
// un tiroir, ouvert par l'adresse (`detail-du-connecteur.tsx`) ; « Ajouter un connecteur » (`ajout-d-un-connecteur.tsx`) ;
// l'issue du retour d'un consentement. Sans connecteur, un état vide qui apprend à s'en servir : trois étapes, un mur de
// logos, le même pour un administrateur. La gouvernance d'un administrateur est un geste sur l'outil, là où il apparaît :
// bloquer ou débloquer un outil pour toute l'organisation, dans le catalogue de l'ajout et dans le détail. Server
// Component : il calcule les lignes (`lignes-des-connecteurs.ts`) et le catalogue de l'ajout
// (`catalogue-des-connecteurs.ts`), et ne passe à ses îlots clients que des données.
//
// Les mots « activation », « compte » et « secret » ne s'écrivent pas pour un membre (`connecteurs-et-comptes.md`
// § Écran Connecteurs). L'écran masque un geste, le service le décide.
import type { ReactNode } from "react"
import { Info } from "@phosphor-icons/react/dist/ssr/Info"
import { Plug } from "@phosphor-icons/react/dist/ssr/Plug"
import type { AccountOwnerChoices, AccountView, ConnectorAccountForm, DeactivationImpact, OrgConnector, OrgLimitsView } from "../../../schemas"
import type { Resultat } from "../../api/resultat"
import { ErreurDeLecture } from "../../components/erreur-de-lecture"
import { Icon } from "../../ds/react/icon"
import { Island, IslandBody } from "../../ds/react/island"
import { Alert } from "../../ds/react/primitives"
import { Skeleton } from "../../ds/react/skeleton"
import type { SujetsDeRegle } from "../../equipes/types"
import { EnTeteDAdministration } from "../en-tete"
import type { FilDeLEcran, LienDeLAdministration } from "../types"
import { AjoutDUnConnecteur } from "./ajout-d-un-connecteur"
import { outilsAAjouter, type MonConnecteur } from "./catalogue-des-connecteurs"
import { DetailDuConnecteur } from "./detail-du-connecteur"
import { estAMoi, etatDuCompte, fonctionne, formulaireDuCompte, sansAcces } from "./etat-du-compte"
import { adresseDeLaVue, bloquePar, fonctionsDe, libelleDuConnecteur, lignesDesConnecteurs, logoDe, type PartagesDuCompte, type VueDesConnecteurs } from "./lignes-des-connecteurs"
import { ListeDesConnecteurs } from "./liste-des-connecteurs"
import { PartageAuRetour } from "./partage-au-retour"

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
   * Pour qui administre l'organisation : ce que le blocage de chaque outil ouvert arrête (`deactivationImpacts`, une
   * lecture pour tous), ouvert par défaut compris. Absent pour un membre. `limites` n'est plus lu : le nombre d'outils
   * n'est plus limité (`connectors_max` déprécié), rien n'est grisé ; gardé pour les hôtes.
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

/** Les connecteurs personnels de la personne, outil par outil, et ceux qui servent : « Connecté » au catalogue. */
function mesConnecteurs(donnees: DonneesDesConnecteurs, moi: string): MonConnecteur[] {
  const formulaires = donnees.formulaires ?? []
  return donnees.accounts
    .filter((compte) => estAMoi(compte, moi))
    .map((compte) => ({
      id: compte.id,
      connecteur: compte.connector,
      libelle: compte.label,
      fonctionne: fonctionne(etatDuCompte(compte, formulaireDuCompte(formulaires, compte), moi, { bloquePar: bloquePar(compte.connector, donnees.connectors), sansSonAcces: sansAcces(formulaires, compte) })),
    }))
}

type AjoutProps = { donnees: DonneesDesConnecteurs; moi: string; ici: string; vide?: ReactNode }

/** « Ajouter un connecteur » : le catalogue de la personne, les équipes qu'elle peut doter, et ce qu'elle a déjà. */
function Ajout({ donnees, moi, ici, vide }: AjoutProps) {
  const mes = mesConnecteurs(donnees, moi)
  return (
    <AjoutDUnConnecteur
      outils={outilsAAjouter(donnees.connectors, donnees.formulaires ?? [], donnees.proprietaires, mes)}
      equipes={donnees.proprietaires.teams}
      mesNoms={mes.map((un) => un.libelle)}
      ici={ici}
      moi={moi}
      gouvernance={donnees.administration}
      sujets={donnees.sujets}
      vide={vide}
    />
  )
}

/** Les trois étapes de l'état vide : ce qu'on fait, dans l'ordre, et un exemple de demande. */
const ETAPES = [
  { titre: "Choisissez un outil", texte: "Votre messagerie, votre CRM, votre comptabilité…" },
  { titre: "Connectez votre compte", texte: "Autorisez l'accès chez l'outil, ou collez une clé. Une minute." },
  { titre: "Demandez à votre assistant", texte: "« Cherche dans mes mails ceux du fournisseur de la semaine dernière. »" },
]

/** Sans connecteur : ce qu'est un connecteur, les trois étapes, puis (dans l'îlot de l'ajout) le bouton et le mur de logos. */
function EtatVide() {
  return (
    <>
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-bold text-ink">Votre assistant n&apos;a encore accès à aucun outil</h2>
        <p className="text-mute">Ajoutez un connecteur avec votre propre compte de l&apos;outil. Il reste privé tant que vous ne le partagez pas.</p>
      </div>
      <ol className="flex flex-col gap-3">
        {ETAPES.map(({ titre, texte }, rang) => (
          <li key={titre} className="flex items-start gap-3">
            <span aria-hidden="true" className="flex size-7 flex-none items-center justify-center rounded-full bg-card text-sm font-bold text-ink">
              {rang + 1}
            </span>
            <span className="flex flex-col">
              <span className="font-semibold text-ink">{titre}</span>
              <span className="oto-caption">{texte}</span>
            </span>
          </li>
        ))}
      </ol>
    </>
  )
}

type VueProps = { donnees: DonneesDesConnecteurs; moi: string; vue: VueDesConnecteurs; ici: string }

/** L'adresse de la recherche, sans `q` : le filtre de la vue y reste. */
function recherche(vue: VueDesConnecteurs, ici: string): { chemin: string; parametres: [string, string][] } {
  return { chemin: ici, parametres: vue.filtre === "all" ? [] : [["filter", vue.filtre]] }
}

/** La liste, ses filtres et sa recherche ; sans aucun compte visible, l'état vide. */
function Liste({ donnees, moi, vue, ici }: VueProps) {
  if (donnees.accounts.length === 0) {
    return (
      <>
        <Island aria-label="Connecteurs">
          <IslandBody>
            <Ajout donnees={donnees} moi={moi} ici={ici} vide={<EtatVide />} />
          </IslandBody>
        </Island>
        <p className="oto-caption">Ces connecteurs servent votre assistant à travers Oto, dans toutes vos conversations. Ils n&apos;apparaissent pas dans les réglages de votre assistant.</p>
      </>
    )
  }
  const sources = { comptes: donnees.accounts, connecteurs: donnees.connectors, formulaires: donnees.formulaires ?? [], partages: donnees.partages, moi, ici }
  const { lignes, comptes } = lignesDesConnecteurs(sources, vue)
  const filtres = [
    { valeur: "all", libelle: `Tous · ${comptes.tous}`, adresse: adresseDeLaVue(ici, { ...vue, filtre: "all", compte: null }) },
    { valeur: "mine", libelle: `À moi · ${comptes.moi}`, adresse: adresseDeLaVue(ici, { ...vue, filtre: "mine", compte: null }) },
    { valeur: "shared", libelle: `Partagés avec moi · ${comptes.partages}`, adresse: adresseDeLaVue(ici, { ...vue, filtre: "shared", compte: null }) },
  ]
  return (
    <>
      <ListeDesConnecteurs lignes={lignes} filtres={filtres} filtre={vue.filtre} q={vue.q} recherche={recherche(vue, ici)} ici={ici} />
      <p className="flex items-start gap-3 rounded-lg bg-card p-3 text-sm text-ink">
        <span aria-hidden="true" className="mt-0.5 flex-none">
          <Icon as={Info} size="sm" />
        </span>
        <span>
          Un <strong>connecteur</strong>, c&apos;est un outil (votre messagerie, votre comptabilité…) relié à un compte : le vôtre, celui d&apos;une équipe ou de
          l&apos;organisation. Il est privé tant que vous ne le partagez pas.
        </span>
      </p>
    </>
  )
}

/** Le détail du compte que l'adresse ouvre, s'il est de ceux que la personne voit ; sinon rien. */
function Detail({ donnees, moi, vue, ici }: VueProps) {
  const compte = donnees.accounts.find((candidat) => candidat.id === vue.compte)
  if (!compte) return null
  const formulaires = donnees.formulaires ?? []
  const { administration } = donnees
  const actif = donnees.connectors.some((connecteur) => connecteur.connector === compte.connector && connecteur.state === "active")
  return (
    <DetailDuConnecteur
      // Une instance par compte : le tiroir refermé d'un compte ne sert jamais, encore fermé, à un autre.
      key={compte.id}
      compte={compte}
      formulaire={formulaireDuCompte(formulaires, compte)}
      outil={libelleDuConnecteur(compte.connector, formulaires)}
      logo={logoDe(compte.connector, donnees.connectors)}
      fonctions={fonctionsDe(compte.connector, donnees.connectors)}
      bloquePar={bloquePar(compte.connector, donnees.connectors)}
      sansSonAcces={sansAcces(formulaires, compte)}
      gouvernance={administration ? { impact: administration.impacts[compte.connector], actif } : undefined}
      partages={donnees.partages[compte.id]}
      sujets={donnees.sujets}
      moi={moi}
      ici={ici}
      fermer={adresseDeLaVue(ici, { filtre: vue.filtre, q: vue.q, compte: null })}
      partagerDAbord={vue.partager === true}
    />
  )
}

// `data-entete-empile`, posé sur la phrase : elle passe sous le titre, et sous 640 px le titre, la phrase et le bouton
// s'empilent (variante opt-in de `product.css`, sans effet avec un fil d'Ariane).
/**
 * Au retour de chez le tiers, réussi ou non : le partage choisi avant de partir est repris et effacé ; réussi, il se pose
 * sur le seul connecteur de la personne apparu depuis le départ (`PartageAuRetour`).
 */
function Retour({ donnees, moi, ici, issue }: { donnees: DonneesDesConnecteurs; moi: string; ici: string; issue: IssueDuConsentement["issue"] }) {
  const miens = donnees.accounts.filter((compte) => estAMoi(compte, moi)).map(({ id, connector }) => ({ id, connector }))
  return <PartageAuRetour issue={issue} miens={miens} ici={ici} />
}

const SOUS_TITRE = "Les outils que votre assistant peut utiliser pour vous."

export function EcranConnecteurs({ resultat, moi, vue, Lien, ici, fil, consentement }: EcranConnecteursProps) {
  // Une lecture nourrit tout l'écran : son échec se dit une fois, sans « Ajouter », qui a besoin d'elle.
  const lu = resultat.error === undefined ? resultat.data : null
  // « Ajouter un connecteur » : dans l'en-tête quand la liste a des lignes, dans l'état vide sinon, jamais deux fois.
  const ajout = lu && lu.accounts.length > 0 ? <Ajout donnees={lu} moi={moi} ici={ici} /> : undefined
  return (
    <>
      <EnTeteDAdministration courant="connecteurs" fil={fil} titre="Connecteurs" glyphe={Plug} meta={<span data-entete-empile="">{SOUS_TITRE}</span>} actions={ajout} />
      {consentement && <AnnonceDuConsentement consentement={consentement} />}
      {consentement && lu && <Retour donnees={lu} moi={moi} ici={ici} issue={consentement.issue} />}
      {lu ? (
        <div className="flex flex-col gap-6">
          <Liste donnees={lu} moi={moi} vue={vue} ici={ici} />
          <Detail donnees={lu} moi={moi} vue={vue} ici={ici} />
        </div>
      ) : (
        <ErreurDeLecture titre="Les connecteurs n'ont pas pu être lus." message={resultat.error ?? ""} href={ici} Lien={Lien} />
      )}
    </>
  )
}

/** L'état de chargement, rendu par le `loading.tsx` de l'hôte (AC12). */
// Trois lignes de connecteur : la tuile, le nom et sa ligne fine, l'état. Largeurs en propriété du squelette : la règle du
// design system, hors couche, l'emporterait sur un utilitaire.
const LIGNES_DU_SQUELETTE = [
  ["34%", "22%", "18%"],
  ["28%", "16%", "22%"],
  ["38%", "20%", "16%"],
]

export function EcranConnecteursChargement() {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-6">
      <span className="oto-sr-only">Chargement des connecteurs…</span>
      <Skeleton width="16rem" height="1.75rem" />
      <Island>
        <IslandBody>
          <ul className="flex flex-col gap-4">
            {LIGNES_DU_SQUELETTE.map(([nom, sous, etat], rang) => (
              // Aucune donnée n'existe encore : le rang est l'identité de la ligne, qui ne se réordonne jamais.
              <li key={rang} className="flex items-center gap-3">
                <Skeleton shape="card" width="2.5rem" height="2.5rem" />
                <span className="flex flex-1 flex-col gap-1.5">
                  <Skeleton width={nom} />
                  <Skeleton width={sous} height="0.625rem" />
                </span>
                <Skeleton width={etat} />
              </li>
            ))}
          </ul>
        </IslandBody>
      </Island>
    </div>
  )
}
