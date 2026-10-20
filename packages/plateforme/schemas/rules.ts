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
  owner: { kind: "org" | "team" | "user"; teamId?: string; teamName?: string; leadName?: string; leadCount?: number; userName?: string }
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
  /**
   * L'accès par défaut de l'équipe propriétaire effective, lu avec `people` : le niveau d'un membre sans règle qui le nomme
   * ni responsabilité (`level`), celui qu'il aurait sans la règle de l'équipe sur ce nœud (`inherited`) et cette règle
   * (`ruleId`) ; absent ou `null` hors d'une équipe.
   */
  team?: { teamId: string; level: AccessLevelName; inherited: AccessLevelName; ruleId: string | null } | null
  /**
   * L'accès de toute l'organisation, lu avec `people` : son niveau réel sur le nœud, règle d'un dossier au-dessus comprise
   * (`level`), et celui qu'il aurait sans la règle d'organisation du nœud même (`inherited`) ; absent ou `null` dans Privé.
   */
  organisation?: { level: AccessLevelName; inherited: AccessLevelName } | null
}

export type RuledNodeView = { path: string; title: string; rulesCount: number }

/** Une règle sur un compte de connecteur (E08-S06, N10) : le compte, le sujet, le niveau, comme sur un nœud. */
export const setAccountRuleSchema = z.object({
  accountId: z.uuid(),
  subject: ruleSubjectSchema,
  level: accessLevelSchema,
})
