// Le catalogue de la fenêtre « Ajouter un connecteur » : les outils que la personne peut ajouter, tirés des connecteurs de
// l'organisation et de leurs formulaires (un par accès pour un connecteur qui s'ouvre par plusieurs), avec la façon de
// s'y connecter et les propriétaires qu'elle peut choisir.
// Module sans « use client » : l'écran, rendu par le serveur, le calcule et ne passe à la fenêtre que des données. Sans
// lui, la fenêtre proposerait un ajout que le service refuse (un propriétaire non admis, un outil sans port chez le tiers).
import { normalizeTitle, type AccountMode, type AccountOwnerChoices, type ConnectorAccountForm, type OrgConnector } from "../../../schemas"
import { connexionDe, faconDeLAcces, type Connexion } from "./etat-du-compte"

type Proprietaire = ConnectorAccountForm["ownerKinds"][number]

/** Un outil du catalogue, tel que la fenêtre d'ajout le montre. */
export type OutilAAjouter = {
  connecteur: string
  /** Le nom lisible de l'outil. */
  libelle: string
  /**
   * L'accès du compte à créer, pour un connecteur à plusieurs accès : son nom (envoyé à la création, au consentement et
   * à la sonde) et la façon de s'y connecter, dite par l'écran sous le nom de l'outil (`faconDeLAcces` : « Avec mon
   * compte … », « Avec une clé, pour l'organisation ») ; absent pour un connecteur à un seul accès.
   */
  acces?: { nom: string; libelle: string }
  /** Comment on s'y connecte ; `sans_cle` : un connecteur sans formulaire, simulé ou servi par la clé de l'hôte. */
  facon: Connexion | "sans_cle"
  /** Les propriétaires que la personne peut choisir, le compte personnel d'abord. */
  proprietaires: Proprietaire[]
  /** Le mode du compte à créer, celui que le connecteur admet (`OrgConnector.accountModes`). */
  mode: AccountMode
  /** Fermé par un administrateur : l'ajout n'est pas proposé. */
  ferme: boolean
  formulaire: ConnectorAccountForm | null
}

/** L'ordre dans lequel les propriétaires se proposent : soi d'abord. */
const ORDRE: readonly Proprietaire[] = ["user", "org", "team"]

/** Sans formulaire (connecteur simulé, ou servi par la clé de l'hôte), un compte est d'organisation ou d'équipe. */
const SANS_FORMULAIRE: readonly Proprietaire[] = ["org", "team"]

/** Ce qui distingue un outil du catalogue : son connecteur, et son accès pour un connecteur à plusieurs. */
export const cleDeLOutil = (outil: Pick<OutilAAjouter, "connecteur" | "acces">): string => (outil.acces ? `${outil.connecteur}:${outil.acces.nom}` : outil.connecteur)

/**
 * Les outils que la personne peut ajouter, par nom : ceux dont un propriétaire lui est ouvert, d'après la règle de la
 * création que le service rend (`accountOwnerChoices` : le compte personnel pour tout membre, l'organisation pour qui
 * administre, une équipe pour qui administre ou la dirige). Un outil à consentement ou à compte rattaché ne se connecte
 * que pour soi, et seulement si l'hôte a fourni son port. Un connecteur à plusieurs accès donne un outil par accès qui
 * a un formulaire : « Connecter mon compte » pour un accès à consentement, la saisie de sa clé pour un autre.
 */
export function outilsAAjouter(connecteurs: readonly OrgConnector[], formulaires: readonly ConnectorAccountForm[], choix: AccountOwnerChoices): OutilAAjouter[] {
  const ouvert = (genre: Proprietaire) => genre === "user" || (genre === "org" ? choix.org : choix.teams.length > 0)
  return connecteurs
    .flatMap((connecteur): OutilAAjouter[] => {
      const siens = formulaires.filter((candidat) => candidat.connector === connecteur.connector)
      // Les propriétaires que la personne peut choisir par un formulaire (ou sans formulaire) : admis, ouverts à elle, et
      // la personne seule pour un outil qui se connecte chez le tiers.
      const proprietairesDe = (formulaire: ConnectorAccountForm | null): Proprietaire[] => {
        const facon = formulaire ? connexionDe(formulaire) : "sans_cle"
        const admis = formulaire ? formulaire.ownerKinds : SANS_FORMULAIRE
        const chezLeTiers = facon === "consentement" || facon === "branchement"
        return ORDRE.filter((genre) => admis.includes(genre) && ouvert(genre) && (genre === "user" || !chezLeTiers))
      }
      return (siens.length > 0 ? siens : [null]).flatMap((formulaire): OutilAAjouter[] => {
        const facon = formulaire ? connexionDe(formulaire) : "sans_cle"
        if (facon === "branchement" && formulaire?.hosted?.ready !== true) return []
        const proprietaires = proprietairesDe(formulaire)
        if (proprietaires.length === 0) return []
        const mode = connecteur.accountModes[0] ?? "reel"
        const dite = faconDeLAcces(formulaire ?? undefined, siens, "ajout", proprietairesDe)
        const acces = formulaire?.access && dite !== null ? { acces: { nom: formulaire.access.name, libelle: dite } } : {}
        return [{ connecteur: connecteur.connector, libelle: connecteur.label, ...acces, facon, proprietaires, mode, ferme: connecteur.closedBy !== null, formulaire }]
      })
    })
    .sort((a, b) => a.libelle.localeCompare(b.libelle, "fr") || (a.acces?.libelle ?? "").localeCompare(b.acces?.libelle ?? "", "fr"))
}

/** Les outils dont le nom contient le texte cherché, sans casse ni accent ; un texte vide les garde tous. */
export function outilsCherches(outils: readonly OutilAAjouter[], q: string): OutilAAjouter[] {
  const cherche = normalizeTitle(q)
  return outils.filter((outil) => cherche === "" || normalizeTitle(outil.libelle).includes(cherche))
}

/** Un nom que la personne ne porte pas encore : celui de l'outil, sinon suivi du premier rang libre (« Crm 2 »). */
export function nomLibre(base: string, pris: readonly string[]): string {
  const portes = new Set(pris.map((nom) => nom.toLowerCase()))
  if (!portes.has(base.toLowerCase())) return base
  let rang = 2
  while (portes.has(`${base} ${rang}`.toLowerCase())) rang += 1
  return `${base} ${rang}`
}
