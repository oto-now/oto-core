// Les membres de l'équipe propriétaire d'un nœud et leur niveau sur lui (1.4.12, droits par personne), que sert le
// panneau d'un nœud (`listNodeRules`) : « Partager » d'une page les montre, « Les personnes de … » les lit sur le dossier
// de l'équipe. Le niveau vient d'`access.ts` (`teamMemberLevels`), jamais recalculé ici. Sans lui, le niveau hérité d'un
// membre ne se voyait nulle part, et le surcharger demandait de l'ajouter à la page.
import { ACCESS_LEVEL_NAMES, type NodeRulesView } from "../schemas"
import { teamMemberLevels } from "./access"
import type { PlatformDb } from "./db"
import type { Identity } from "./identity"

type TeamPeopleInput = {
  nodeId: string
  team: { id: string; leads: readonly string[] }
  /** Les règles qui nomment une personne sur ce nœud. */
  ruledUsers: readonly { userId: string; ruleId: string }[]
  nameOf: (userId: string) => string | undefined
}

/** Les membres, les responsables d'abord, puis par nom ; la règle qui nomme chacun sur ce nœud, s'il en porte une. */
export async function teamPeople(db: PlatformDb, identity: Identity, { nodeId, team, ruledUsers, nameOf }: TeamPeopleInput): Promise<NonNullable<NodeRulesView["people"]>> {
  const levels = await teamMemberLevels(db, identity, nodeId, team.id)
  return [...levels]
    .map(([userId, { level, inherited }]) => ({
      userId,
      name: nameOf(userId) ?? userId,
      lead: team.leads.includes(userId),
      level: ACCESS_LEVEL_NAMES[level],
      inherited: ACCESS_LEVEL_NAMES[inherited],
      ruleId: ruledUsers.find((rule) => rule.userId === userId)?.ruleId ?? null,
    }))
    .sort((a, b) => Number(b.lead) - Number(a.lead) || a.name.localeCompare(b.name, "fr"))
}
