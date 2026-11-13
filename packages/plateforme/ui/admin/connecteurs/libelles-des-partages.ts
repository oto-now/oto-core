// Les mots du partage d'un compte (partage des comptes), communs au journal des partages, à la liste, au détail et au
// panneau de partage de l'écran Connecteurs : le niveau d'une règle de compte, ce qu'il ouvre, et son sujet. Module sans
// « use client » : le Server Component qui liste les comptes en lit les valeurs.
import type { AccountLevelName, AccountShareEventView, OrgConnector } from "../../../schemas"

/** Le niveau d'une règle de compte, tel qu'une pastille, une ligne ou le journal l'écrit. */
export const NIVEAUX_DU_COMPTE: Record<AccountLevelName, string> = {
  none: "Aucun accès",
  read: "Lecture seule",
  write: "Lecture et écriture",
  sensitive: "Toutes les actions",
  manage: "Gestion",
}

/** La couleur de la pastille d'un niveau (`.oto-share-level`), sur les quatre tons du partage d'une page : gris, bleu, vert, violet. */
export const TON_DU_NIVEAU: Record<AccountLevelName, string> = { none: "none", read: "read", write: "write", sensitive: "manage", manage: "manage" }

/** Les niveaux qu'on partage, du plus ouvert au plus fermé : la gestion ne s'accorde que par un administrateur (`setAccountRule`). */
export const NIVEAUX_PARTAGES = ["sensitive", "write", "read"] as const satisfies readonly AccountLevelName[]

export type NiveauPartage = (typeof NIVEAUX_PARTAGES)[number]

/** Les fonctions d'un connecteur comptées par classe : ce que chaque niveau ouvre de plus. */
export type ActionsParClasse = Record<OrgConnector["functions"][number]["class"], number>

export function actionsParClasse(fonctions: OrgConnector["functions"]): ActionsParClasse {
  const compte = (classe: keyof ActionsParClasse) => fonctions.filter((fonction) => fonction.class === classe).length
  return { read: compte("read"), write: compte("write"), sensitive: compte("sensitive") }
}

const actions = (nombre: number) => `${nombre} ${nombre > 1 ? "actions" : "action"}`

/**
 * Ce qu'ouvre un niveau partagé, en une ligne, avec le nombre d'actions du connecteur quand il est connu (`null` : un
 * connecteur que le catalogue ne décrit plus).
 */
export function detailDuNiveau(niveau: NiveauPartage, parClasse: ActionsParClasse | null): string {
  if (niveau === "read") return `Son assistant consulte, sans rien changer.${parClasse ? ` ${actions(parClasse.read)}.` : ""}`
  if (niveau === "write") return `Il peut aussi créer et modifier.${parClasse ? ` ${actions(parClasse.write)} de plus.` : ""}`
  return `Y compris les actions sensibles, comme envoyer ou supprimer.${parClasse ? ` ${actions(parClasse.sensitive)} de plus.` : ""}`
}

/** Le sujet d'un partage : l'organisation, l'équipe ou la personne ; un nom absent (équipe supprimée, personne partie) se dit tel quel. */
export function sujetDuPartage({ kind, name }: AccountShareEventView["subject"]): string {
  if (kind === "org") return `toute l'organisation${name ? ` (${name})` : ""}`
  if (kind === "team") return name ? `l'équipe ${name}` : "une équipe supprimée"
  return name ?? "une personne qui n'est plus membre"
}
