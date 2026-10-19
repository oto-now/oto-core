// Les mots du partage d'un compte (partage des comptes), communs au journal des partages et aux partages d'un compte de
// l'écran Connecteurs : le niveau d'une règle de compte et son sujet. Module sans « use client » : le Server Component
// qui liste les partages en lit les valeurs.
import type { AccountLevelName, AccountShareEventView } from "../../../schemas"

/** Le niveau d'une règle de compte, en complément du verbe (« partagé à l'équipe Ventes en écriture »). */
export const NIVEAUX_DU_COMPTE: Record<AccountLevelName, string> = {
  none: "sans accès",
  read: "en lecture",
  write: "en écriture",
  sensitive: "jusqu'aux fonctions sensibles",
  manage: "en gestion",
}

/** Le sujet d'un partage : l'organisation, l'équipe ou la personne ; un nom absent (équipe supprimée, personne partie) se dit tel quel. */
export function sujetDuPartage({ kind, name }: AccountShareEventView["subject"]): string {
  if (kind === "org") return `toute l'organisation${name ? ` (${name})` : ""}`
  if (kind === "team") return name ? `l'équipe ${name}` : "une équipe supprimée"
  return name ?? "une personne qui n'est plus membre"
}
