// Le catalogue de la fenêtre « Ajouter un connecteur » : les outils que la personne peut ajouter, tirés des connecteurs de
// l'organisation et de leurs formulaires, avec la façon de s'y connecter et les propriétaires qu'elle peut choisir.
// Module sans « use client » : l'écran, rendu par le serveur, le calcule et ne passe à la fenêtre que des données. Sans
// lui, la fenêtre proposerait un ajout que le service refuse (un propriétaire non admis, un outil sans port chez le tiers).
import { normalizeTitle, type ConnectorAccountForm, type OrgConnector } from "../../../schemas"
import { connexionDe, type Connexion } from "./etat-du-compte"

type Proprietaire = ConnectorAccountForm["ownerKinds"][number]

/** Un outil du catalogue, tel que la fenêtre d'ajout le montre. */
export type OutilAAjouter = {
  connecteur: string
  /** Le nom lisible de l'outil. */
  libelle: string
  /** Comment on s'y connecte ; `sans_cle` : un connecteur sans formulaire, simulé ou servi par la clé de l'hôte. */
  facon: Connexion | "sans_cle"
  /** Les propriétaires que la personne peut choisir, le compte personnel d'abord. */
  proprietaires: Proprietaire[]
  /** Fermé par un administrateur : l'ajout n'est pas proposé. */
  ferme: boolean
  formulaire: ConnectorAccountForm | null
}

/** L'ordre dans lequel les propriétaires se proposent : soi d'abord. */
const ORDRE: readonly Proprietaire[] = ["user", "org", "team"]

/** Sans formulaire (connecteur simulé, ou servi par la clé de l'hôte), un compte est d'organisation ou d'équipe. */
const SANS_FORMULAIRE: readonly Proprietaire[] = ["org", "team"]

/**
 * Les outils que la personne peut ajouter, par nom : ceux dont un propriétaire lui est ouvert (le compte personnel pour
 * tout membre, l'organisation et les équipes pour qui administre). Un outil à consentement ou à compte rattaché ne se
 * connecte que pour soi, et seulement si l'hôte a fourni son port.
 */
export function outilsAAjouter(connecteurs: readonly OrgConnector[], formulaires: readonly ConnectorAccountForm[], administre: boolean): OutilAAjouter[] {
  return connecteurs
    .flatMap((connecteur): OutilAAjouter[] => {
      const formulaire = formulaires.find((candidat) => candidat.connector === connecteur.connector) ?? null
      const facon = formulaire ? connexionDe(formulaire) : "sans_cle"
      if (facon === "branchement" && formulaire?.hosted?.ready !== true) return []
      const admis = formulaire ? formulaire.ownerKinds : SANS_FORMULAIRE
      const chezLeTiers = facon === "consentement" || facon === "branchement"
      const proprietaires = ORDRE.filter((genre) => admis.includes(genre) && (genre === "user" || (administre && !chezLeTiers)))
      if (proprietaires.length === 0) return []
      return [{ connecteur: connecteur.connector, libelle: connecteur.label, facon, proprietaires, ferme: connecteur.closedBy !== null, formulaire }]
    })
    .sort((a, b) => a.libelle.localeCompare(b.libelle, "fr"))
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
