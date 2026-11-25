// Les mots du partage d'un compte (partage des comptes), communs au journal des partages, à la liste, au détail et au
// panneau de partage de l'écran Connecteurs : le niveau d'une règle de compte, ce qu'il ouvre, et son sujet. Module sans
// « use client » : le Server Component qui liste les comptes en lit les valeurs.
import type { AccountLevelName, AccountShareEventView, OrgConnector } from "../../../schemas"
import type { SujetsDeRegle } from "../../equipes/types"

/**
 * Le niveau d'une règle de compte, tel qu'une pastille, une ligne ou le journal l'écrit : la langue des connecteurs, la
 * même que les groupes de fonctions (« Lire », « Créer et modifier », « Avec votre accord »), cumulatifs.
 */
export const NIVEAUX_DU_COMPTE: Record<AccountLevelName, string> = {
  none: "Aucun accès",
  read: "Lire",
  write: "Lire et modifier",
  sensitive: "Tout, avec accord",
  manage: "Gestion",
}

/** La couleur de la pastille d'un niveau (`.oto-share-level`), sur les quatre tons du partage d'une page : gris, bleu, vert, violet. */
export const TON_DU_NIVEAU: Record<AccountLevelName, string> = { none: "none", read: "read", write: "write", sensitive: "manage", manage: "manage" }

/**
 * Les niveaux qu'on partage, du plus fermé au plus ouvert, comme les groupes de fonctions ; la gestion ne s'accorde que
 * par un administrateur (`setAccountRule`), qui la voit en plus.
 */
export const NIVEAUX_PARTAGES = ["read", "write", "sensitive"] as const satisfies readonly AccountLevelName[]

type NiveauPartage = (typeof NIVEAUX_PARTAGES)[number] | "manage"

/** Les fonctions d'un connecteur comptées par classe : ce que chaque niveau ouvre de plus. */
export type ActionsParClasse = Record<OrgConnector["functions"][number]["class"], number>

export function actionsParClasse(fonctions: OrgConnector["functions"]): ActionsParClasse {
  const compte = (classe: keyof ActionsParClasse) => fonctions.filter((fonction) => fonction.class === classe).length
  return { read: compte("read"), write: compte("write"), sensitive: compte("sensitive") }
}

/** « 1 fonction », « 9 fonctions ». */
export const fonctions = (nombre: number) => `${nombre} ${nombre > 1 ? "fonctions" : "fonction"}`

/**
 * Ce qu'ouvre un niveau partagé, en une ligne, avec le nombre de fonctions qu'il ajoute quand il est connu (`null` : un
 * connecteur que le catalogue ne décrit plus).
 */
export function detailDuNiveau(niveau: NiveauPartage, parClasse: ActionsParClasse | null): string {
  if (niveau === "read") return `Consulte sans rien changer.${parClasse ? ` ${fonctions(parClasse.read)}.` : ""}`
  if (niveau === "write") return `Crée et modifie aussi.${parClasse ? ` ${fonctions(parClasse.write)} de plus.` : ""}`
  if (niveau === "sensitive") return `Y compris envoyer ou supprimer, toujours après votre accord.${parClasse ? ` ${fonctions(parClasse.sensitive)} de plus.` : ""}`
  return "Tout, et partage, renomme ou désactive le connecteur. Accordé par un administrateur."
}

/** Le sujet d'un partage : l'organisation, l'équipe ou la personne ; un nom absent (équipe supprimée, personne partie) se dit tel quel. */
export function sujetDuPartage({ kind, name }: AccountShareEventView["subject"]): string {
  if (kind === "org") return `toute l'organisation${name ? ` (${name})` : ""}`
  if (kind === "team") return name ? `l'équipe ${name}` : "une équipe supprimée"
  return name ?? "une personne qui n'est plus membre"
}

/** Le nom de qui regarde, dans l'annuaire de l'organisation ; « Vous » s'il n'y est pas. */
export const nomDe = (sujets: SujetsDeRegle, moi: string) => sujets.personnes.find((personne) => personne.id === moi)?.nom ?? "Vous"
