// Procédures (E03-S06 ; ADR-011, P37, P38) : les genres des refus du contrôle à la publication, la
// forme de `details.refusals` et d'une procédure listée, et la règle de l'espace réservé
// (`isPlaceholderValue`, règle 4) : des types et une fonction pure d'E03-S06, sans schéma Zod (N15) ;
// `server/`, les `checkArgs` d'E07-S02 et l'écran d'E05-S04, dans `ui/` qui n'importe pas `server/`
// (ADR-008 § 4), les lisent ici. Sans lui, l'écran redéclarerait ces formes et la règle de l'espace
// réservé. E05-S04 y ajoute les deux schémas d'adresse de ses écrans, lus par les pages de l'hôte, et la
// borne d'une phrase à tester.
import * as z from "zod/v4"

/**
 * La taille d'une procédure, servie entière par `context` (H30, P24) : son rendu, sans titre ni résumé (N6). Lue par le
 * contrôle à la publication et par le refus que dit l'écran : sans elle ici, l'écran écrivait la borne en chiffres.
 */
export const PROCEDURE_MAX_CHARS = 12_000

/** Les huit genres d'un refus (colonne « Genre » d'E03-S06), dans l'ordre des cas R1 à R13. */
export const PROCEDURE_REFUSAL_KINDS = [
  "too_long",
  "invalid_block",
  "unknown_function",
  "function_not_active",
  "unknown_key",
  "missing_argument",
  "invalid_value",
  "check_failed",
] as const

export type ProcedureRefusalKind = (typeof PROCEDURE_REFUSAL_KINDS)[number]

/**
 * Un problème du contrôle (`details.refusals`) : `section`, `block` (rang) et `step` sont ceux de
 * `callLocation` (M05), la seule `section` de `sectionOfBlock` pour un bloc qui n'est pas un `call` ;
 * `block_id` situe le bloc dans l'éditeur ; `element`, la clé d'argument en cause quand elle est connue.
 */
export type ProcedureRefusal = {
  kind: ProcedureRefusalKind
  section?: string
  block?: number
  step?: number
  block_id?: string
  function?: string
  element?: string
  message: string
}

/** Une procédure listée pour l'écran (E05-S04) ; `ownerTeam` : l'équipe propriétaire effective (H52). */
export type ProcedureSummary = {
  path: string
  title: string
  summary: string
  status: "draft" | "published"
  revision: number
  updatedAt: string
  ownerTeam: { id: string; name: string } | null
  hasDraft: boolean
}

const PLACEHOLDER = /^<[^<>]+>$/

/**
 * Une valeur fournie à l'exécution (règle 4, N10) : une chaîne entière de la forme `<…>`
 * (`"<email du contact>"`, `"<id>"`), sans chevron intérieur. Seule définition : sa clé est
 * contrôlée, sa valeur ne l'est pas.
 */
export function isPlaceholderValue(value: unknown): boolean {
  return typeof value === "string" && PLACEHOLDER.test(value)
}

/** La borne d'une phrase : celle de `context.phrase` (E03-S01), lue par `?phrase=` et par le champ « Tester une phrase ». */
export const PHRASE_MAX_CHARS = 2000

/**
 * `?phrase=` de l'écran d'une procédure (E05-S04, AC8) : la borne de `context.phrase` ; une phrase vide,
 * trop longue ou répétée est ignorée, et aucun aperçu n'est calculé.
 */
export const previewSearchSchema = z.object({ phrase: z.string().trim().min(1).max(PHRASE_MAX_CHARS).optional().catch(undefined) })

/** `?team=` de la liste des procédures (E05-S04, AC9 ; en anglais, E11-S07) : un identifiant d'équipe, ignoré s'il est illisible. */
export const proceduresSearchSchema = z.object({ team: z.uuid().optional().catch(undefined) })

export type ProceduresSearch = z.output<typeof proceduresSearchSchema>
