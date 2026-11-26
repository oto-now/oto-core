// Le catalogue de la fenêtre « Ajouter un connecteur » : les outils que la personne peut ajouter, un par connecteur, tirés
// des connecteurs de l'organisation et de leurs formulaires (un par accès pour un connecteur qui s'ouvre par plusieurs,
// et autant de façons de s'y connecter), avec la façon de s'y connecter et les propriétaires qu'elle peut choisir.
// Module sans « use client » : l'écran, rendu par le serveur, le calcule et ne passe à la fenêtre que des données. Sans
// lui, la fenêtre proposerait un ajout que le service refuse (un propriétaire non admis, un outil sans port chez le tiers).
import { connectorLogoAddress, normalizeTitle, type AccountMode, type AccountOwnerChoices, type ConnectorAccountForm, type OrgConnector } from "../../../schemas"
import { connexionDe, faconDeLAcces, type BloqueurDeLOutil, type Connexion } from "./etat-du-compte"

type Proprietaire = ConnectorAccountForm["ownerKinds"][number]

/** Un outil du catalogue, tel que la fenêtre d'ajout le montre. */
export type OutilAAjouter = {
  connecteur: string
  /** Le nom lisible de l'outil. */
  libelle: string
  /** L'adresse du logo de l'outil, `null` sans domaine déclaré (`OrgConnector.logoDomain`). */
  logo: string | null
  /**
   * L'accès du compte à créer, pour un connecteur à plusieurs accès : son nom (envoyé à la création, au consentement et
   * à la sonde) et son libellé déclaré ; absent pour un connecteur à un seul accès. Celui de la première façon (`facons`).
   */
  acces?: { nom: string; libelle: string }
  /**
   * Pour un connecteur à plusieurs accès, les façons de s'y connecter ouvertes à la personne, soi d'abord : chacune
   * remplace dans la fiche l'accès, la façon, les propriétaires et le formulaire de l'outil. Absent pour un connecteur
   * à un seul accès.
   */
  facons?: FaconDeLOutil[]
  /** Comment on s'y connecte ; `sans_cle` : un connecteur sans formulaire, simulé ou servi par la clé de l'hôte. */
  facon: Connexion | "sans_cle"
  /** Les propriétaires que la personne peut choisir, le compte personnel d'abord. */
  proprietaires: Proprietaire[]
  /** Le mode du compte à créer, celui que le connecteur admet (`OrgConnector.accountModes`). */
  mode: AccountMode
  /** Bloqué pour l'organisation par un administrateur, et par qui : l'ajout n'est pas proposé ; `null` : il ne l'est pas. */
  bloquePar: BloqueurDeLOutil
  /** Ouvert dans l'organisation (`OrgConnector.state`) : par défaut, adopté, ou rouvert. */
  actif: boolean
  /**
   * Payé par la clé de l'application et pas encore adopté (`inactive` sans auteur de fermeture) : visible, mais ni
   * ajout ni appel avant qu'un administrateur l'adopte.
   */
  aAdopter: boolean
  /** Ses fonctions, groupées dans la fiche par ce qu'elles font. */
  fonctions: OrgConnector["functions"]
  /** Les noms des connecteurs personnels de la personne pour cet outil : un de plus demande un nom qui le distingue. */
  miens: string[]
  /** Les identifiants de ces connecteurs : un retour de chez le tiers reconnaît le nouveau, absent de cette liste. */
  mesComptes: string[]
  /** Combien de ces connecteurs servent (`fonctionne`) : « Connecté » au catalogue. */
  connectes: number
  formulaire: ConnectorAccountForm | null
}

/** Une façon de se connecter à un outil à plusieurs accès : son accès et ce qui en dépend, et sa phrase (`faconDeLAcces`). */
export type FaconDeLOutil = Required<Pick<OutilAAjouter, "acces">> & Pick<OutilAAjouter, "facon" | "proprietaires" | "formulaire"> & { phrase: string }

/** Un connecteur personnel de la personne, tel que le catalogue le compte. */
export type MonConnecteur = { id: string; connecteur: string; libelle: string; fonctionne: boolean }

/** L'ordre dans lequel les propriétaires se proposent : soi d'abord ; la page de connexion range ses façons de même. */
export const ORDRE: readonly Proprietaire[] = ["user", "org", "team"]

/** Sans formulaire (connecteur simulé, ou servi par la clé de l'hôte), un compte est d'organisation ou d'équipe. */
const SANS_FORMULAIRE: readonly Proprietaire[] = ["org", "team"]

/** Une façon d'ouvrir un compte de l'outil, par un formulaire ou sans, avant sa phrase. */
type FaconOuverte = Pick<OutilAAjouter, "acces" | "facon" | "proprietaires" | "formulaire">

const parSoiDAbord = (a: FaconOuverte, b: FaconOuverte) => ORDRE.indexOf(a.proprietaires[0]) - ORDRE.indexOf(b.proprietaires[0])

const chezLeTiersDe = (facon: OutilAAjouter["facon"]) => facon === "consentement" || facon === "branchement"

/** Les façons d'un connecteur à plusieurs accès, chacune avec sa phrase ; aucune pour un connecteur à un seul accès. */
function faconsDeLOutil(outil: string, ouvertes: readonly FaconOuverte[]): FaconDeLOutil[] {
  const parAcces = ouvertes.flatMap(({ acces, ...reste }) => (acces ? [{ acces, ...reste }] : []))
  const aDire = parAcces.map(({ acces, facon, proprietaires }) => ({ ...acces, chezLeTiers: chezLeTiersDe(facon), proprietaires }))
  return parAcces.map((facon, rang) => ({ ...facon, phrase: faconDeLAcces(outil, aDire[rang], aDire) }))
}

/**
 * Les outils que la personne peut ajouter, un par connecteur, par nom : ceux dont un propriétaire lui est ouvert,
 * d'après la règle de la création que le service rend (`accountOwnerChoices` : le compte personnel pour tout membre,
 * l'organisation pour qui administre, une équipe pour qui administre ou la dirige). Un outil à consentement ou à compte
 * rattaché ne se connecte que pour soi, et seulement si l'hôte a fourni son port. Un connecteur à plusieurs accès donne
 * un outil et ses façons (`facons`), une par accès qui a un formulaire et un propriétaire ouvert, soi d'abord :
 * « Connecter mon compte » pour un accès à consentement, la saisie de sa clé pour un autre.
 */
export function outilsAAjouter(connecteurs: readonly OrgConnector[], formulaires: readonly ConnectorAccountForm[], choix: AccountOwnerChoices, mes: readonly MonConnecteur[] = []): OutilAAjouter[] {
  const ouvert = (genre: Proprietaire) => genre === "user" || (genre === "org" ? choix.org : choix.teams.length > 0)
  const deLOutil = (connecteur: string) => mes.filter((un) => un.connecteur === connecteur)
  const faconDe = (formulaire: ConnectorAccountForm | null): FaconOuverte[] => {
    const facon = formulaire ? connexionDe(formulaire) : "sans_cle"
    if (facon === "branchement" && formulaire?.hosted?.ready !== true) return []
    const admis = formulaire ? formulaire.ownerKinds : SANS_FORMULAIRE
    const proprietaires = ORDRE.filter((genre) => admis.includes(genre) && ouvert(genre) && (genre === "user" || !chezLeTiersDe(facon)))
    if (proprietaires.length === 0) return []
    return [{ ...(formulaire?.access ? { acces: { nom: formulaire.access.name, libelle: formulaire.access.label } } : {}), facon, proprietaires, formulaire }]
  }
  return connecteurs
    .flatMap((connecteur): OutilAAjouter[] => {
      const siens = formulaires.filter((candidat) => candidat.connector === connecteur.connector)
      const ouvertes = (siens.length > 0 ? siens : [null]).flatMap(faconDe).sort(parSoiDAbord)
      const [premiere] = ouvertes
      if (!premiere) return []
      const facons = faconsDeLOutil(connecteur.label, ouvertes)
      const logo = connecteur.logoDomain !== undefined ? connectorLogoAddress(connecteur.connector) : null
      const miens = deLOutil(connecteur.connector)
      return [
        {
          connecteur: connecteur.connector,
          libelle: connecteur.label,
          logo,
          ...premiere,
          ...(facons.length > 0 ? { facons } : {}),
          mode: connecteur.accountModes[0] ?? "reel",
          bloquePar: connecteur.state === "active" ? null : connecteur.closedBy,
          actif: connecteur.state === "active",
          aAdopter: connecteur.state !== "active" && connecteur.closedBy === null,
          fonctions: connecteur.functions,
          miens: miens.map((un) => un.libelle),
          mesComptes: miens.map((un) => un.id),
          connectes: miens.filter((un) => un.fonctionne).length,
        },
      ]
    })
    .sort((a, b) => a.libelle.localeCompare(b.libelle, "fr"))
}

/** Les outils dont le nom contient le texte cherché, sans casse ni accent ; un texte vide les garde tous. */
export function outilsCherches(outils: readonly OutilAAjouter[], q: string): OutilAAjouter[] {
  const cherche = normalizeTitle(q)
  return outils.filter((outil) => cherche === "" || normalizeTitle(outil.libelle).includes(cherche))
}

/**
 * Un nom que la personne ne porte pas encore : celui de l'outil, sinon suivi du premier rang libre (« Crm 2 ») ; à
 * partir de `depuis` quand elle a déjà des connecteurs de l'outil (le troisième : « Crm 3 »).
 */
export function nomLibre(base: string, pris: readonly string[], depuis = 1): string {
  const portes = new Set(pris.map((nom) => nom.toLowerCase()))
  if (depuis <= 1 && !portes.has(base.toLowerCase())) return base
  let rang = Math.max(2, depuis)
  while (portes.has(`${base} ${rang}`.toLowerCase())) rang += 1
  return `${base} ${rang}`
}
