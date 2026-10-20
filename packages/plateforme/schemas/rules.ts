// Règles d'accès sur un nœud (E05-S03, H65, H66, fiche D4) : un schéma pour le formulaire (ui/),
// l'API (api/) et les services (server/). Les types de sortie sont ceux que rend `server/rules.ts`
// et que le panneau `ReglesDuNoeud` reçoit tels quels.
import * as z from "zod/v4"
import { nodePathSchema } from "./nodes"

/** Les quatre niveaux, du plus bas au plus haut (H65 : 0 aucun … 3 gestion). */
export const ACCESS_LEVEL_NAMES = ["none", "read", "write", "manage"] as const

const accessLevelSchema = z.enum(ACCESS_LEVEL_NAMES)

export type AccessLevelName = z.infer<typeof accessLevelSchema>

/** Une règle vise une équipe ou une personne de l'organisation (H82). */
const ruleSubjectSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("team"), id: z.uuid() }),
  z.object({ kind: z.literal("user"), id: z.uuid() }),
])

export type RuleSubject = z.infer<typeof ruleSubjectSchema>

export const setNodeRuleSchema = z.object({
  path: nodePathSchema,
  subject: ruleSubjectSchema,
  level: accessLevelSchema,
})

export type NodeRulesView = {
  path: string
  title: string
  /**
   * Propriétaire effectif (H52) : l'équipe et ses responsables (`leadName` les joint par « , »,
   * `leadCount` les compte : E05-S13), l'organisation, ou la personne.
   */
  owner: { kind: "org" | "team" | "user"; teamName?: string; leadName?: string; leadCount?: number; userName?: string }
  /** Niveau de l'appelant sur le nœud, calculé par le service (`nodeLevel`, E01-S07). */
  viewerLevel: 0 | 1 | 2 | 3
  /** Les règles des équipes et des personnes. */
  rules: { id: string; subject: { kind: "team" | "user"; id: string; name: string }; level: AccessLevelName }[]
  /**
   * L'accès général (ADR-014, AC-b13) : la règle de toute l'organisation sur le nœud, s'il en porte une ;
   * absent ou `null` : seulement les personnes ajoutées.
   */
  general?: { id: string; level: AccessLevelName } | null
  /**
   * Les membres de l'équipe propriétaire effective, chacun avec son niveau sur le nœud (`level`), celui qu'il aurait sans
   * sa règle nominative sur ce nœud (`inherited`) et cette règle (`ruleId`, `null` sans elle), par nom (1.4.12, droits
   * par personne) ; absent ou vide hors d'une équipe.
   */
  people?: { userId: string; name: string; lead: boolean; level: AccessLevelName; inherited: AccessLevelName; ruleId: string | null }[]
}

export type RuledNodeView = { path: string; title: string; rulesCount: number }

/**
 * Les niveaux d'un compte de connecteur, du plus bas au plus haut : ceux d'un nœud, plus `sensitive`, entre l'écriture
 * et la gestion, qu'exige une fonction sensible (`droits-d-acces.md` § Partage d'un compte de connecteur).
 */
export const ACCOUNT_LEVEL_NAMES = ["none", "read", "write", "sensitive", "manage"] as const

const accountLevelSchema = z.enum(ACCOUNT_LEVEL_NAMES)

export type AccountLevelName = z.infer<typeof accountLevelSchema>

/** Le sujet d'une règle sur un compte : une équipe, une personne, ou l'organisation entière (partage des comptes). */
const accountRuleSubjectSchema = z.discriminatedUnion("kind", [...ruleSubjectSchema.options, z.object({ kind: z.literal("org") })])

export type AccountRuleSubject = z.infer<typeof accountRuleSubjectSchema>

/** Une règle sur un compte de connecteur (E08-S06, N10) : le compte, le sujet, le niveau de l'échelle des comptes. */
export const setAccountRuleSchema = z.object({
  accountId: z.uuid(),
  subject: accountRuleSubjectSchema,
  level: accountLevelSchema,
})

/**
 * Une ligne du journal des partages d'un compte (`listAccountShareJournal`) : qui a posé (`set`, `previous` : le niveau
 * remplacé) ou retiré (`removed`, `level` : celui qui partait) quelle règle, vers qui, quand. `subject.name` nul : une
 * équipe supprimée ou une personne qui n'est plus membre ; `by` nul : un geste hors d'une session (outillage, import),
 * `by.name` nul : son auteur n'est plus membre.
 */
export type AccountShareEventView = {
  at: string
  action: "set" | "removed"
  subject: { kind: "team" | "user" | "org"; name: string | null }
  level: AccountLevelName
  previous: AccountLevelName | null
  by: { name: string | null } | null
}
