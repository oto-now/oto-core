// Les membres de l'équipe propriétaire d'un nœud et leur niveau sur lui (1.4.12, droits par personne), que sert le
// panneau d'un nœud (`listNodeRules`) : « Partager » d'une page les montre, « Les personnes de … » les lit sur le dossier
// de l'équipe. Avec eux, l'accès par défaut de l'équipe et de toute l'organisation (1.4.13), les deux lignes « Accès par
// défaut » de « Partager », règle d'un dossier au-dessus comprise. Les niveaux viennent d'`access.ts`
// (`teamMemberLevels`, `organisationLevel`), jamais recalculés ici. Sans lui, le niveau hérité d'un membre ne se voyait
// nulle part, et le surcharger demandait de l'ajouter à la page.
import { ACCESS_LEVEL_NAMES, type AccessLevelName, type NodeRulesView } from "../schemas"
import { organisationLevel, teamMemberLevels } from "./access"
import type { PlatformDb } from "./db"
import { PlatformError } from "./errors"
import type { Identity } from "./identity"

type TeamPeopleInput = {
  nodeId: string
  /** L'équipe propriétaire effective ; `null` pour un nœud de l'organisation (Tout le monde). */
  team: { id: string; leads: readonly string[] } | null
  /** Les règles du nœud : celles qui nomment une personne, et celle de l'équipe s'il en porte une. */
  rules: readonly { id: string; subject_team_id: string | null; subject_user_id: string | null }[]
  nameOf: (userId: string) => string | undefined
}

type Defaults = Required<Pick<NodeRulesView, "people" | "team" | "organisation">>

/**
 * Les membres, les responsables d'abord, puis par nom, chacun avec la règle qui le nomme sur ce nœud s'il en porte une ;
 * l'accès par défaut de l'équipe et celui de toute l'organisation, `null` quand le nœud manque.
 */
export async function teamPeople(db: PlatformDb, identity: Identity, { nodeId, team, rules, nameOf }: TeamPeopleInput): Promise<Defaults> {
  const [levels, organisation] = await Promise.all([team ? teamMemberLevels(db, identity, nodeId, team.id) : null, organisationLevel(db, identity, nodeId)])
  const organisationView = organisation ? { level: ACCESS_LEVEL_NAMES[organisation.level], inherited: ACCESS_LEVEL_NAMES[organisation.inherited] } : null
  if (!team || !levels) return { people: [], team: null, organisation: organisationView }
  const people = [...levels.members]
    .map(([userId, { level, inherited }]) => ({
      userId,
      name: nameOf(userId) ?? userId,
      lead: team.leads.includes(userId),
      level: ACCESS_LEVEL_NAMES[level],
      inherited: ACCESS_LEVEL_NAMES[inherited],
      ruleId: rules.find((rule) => rule.subject_user_id === userId)?.id ?? null,
    }))
    .sort((a, b) => Number(b.lead) - Number(a.lead) || a.name.localeCompare(b.name, "fr"))
  const teamLevel = { teamId: team.id, level: ACCESS_LEVEL_NAMES[levels.team.level], inherited: ACCESS_LEVEL_NAMES[levels.team.inherited], ruleId: rules.find((rule) => rule.subject_team_id === team.id)?.id ?? null }
  return { people, team: teamLevel, organisation: organisationView }
}

/**
 * L'équipe propriétaire n'a jamais moins que toute l'organisation sur un nœud (1.4.13), règle d'organisation d'un dossier
 * au-dessus comprise : à ce nœud, sa règle passerait devant celle de l'organisation, et ses membres auraient moins que les
 * autres. Le refus dit de baisser d'abord l'accès de l'organisation ; monter celui-ci sur le nœud remonte l'équipe
 * (`setGeneralAccess`).
 */
export async function refuseOwnerTeamBelowOrg(db: PlatformDb, identity: Identity, node: { id: string; path: string }, level: AccessLevelName): Promise<void> {
  const organisation = await organisationLevel(db, identity, node.id)
  if (!organisation || organisation.level <= ACCESS_LEVEL_NAMES.indexOf(level)) return
  throw new PlatformError(
    "invalid_arguments",
    `The whole organisation has ${ACCESS_LEVEL_NAMES[organisation.level]} on ${node.path}: its owner team cannot have less. Lower the access of the whole organisation first.`,
  )
}
