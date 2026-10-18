// Faits du calcul des niveaux (E01-S07, HN-E01S07-3), lus sous l'appelant de la session et par lots :
// les cibles, leurs ancêtres par chemin et les règles de ces nœuds, en une lecture (E05-S10, partie c) ; les
// comptes et leurs règles, en deux, au rang de l'échelle des comptes (`ACCOUNT_LEVELS`). Jamais nœud par nœud, aucun cache d'une requête à l'autre (un
// retrait ou une règle nouvelle comptent dès la requête suivante, H70), et une lecture en échec lève :
// un fait manquant ne vaut jamais « niveau 0 ». Sans ce module, chaque service lirait ancêtres et
// règles à sa façon, nœud par nœud.
//
// Depuis E01-S08, la RLS n'isole que l'organisation : chaque ancêtre se lit, avec ses règles. Lus en une
// instruction, cibles et ancêtres sont d'un même instant : une chaîne n'est incomplète que si un chemin
// d'ancêtre n'a pas de nœud (arbre changé hors des services) ; une décision lit alors son propriétaire
// effectif par `node_owner` (HN-E01S07-4). Face SQL (E01-S10, partie e1a) : chaque lot de faits est lu dans une
// transaction (`db.tx`), chaque liste en un seul paramètre (`= any(…)`) ; ni borne d'adresse ni
// `max_rows` à contourner, donc ni tranches ni pages (HN-E01S07-23 et 24 ne valaient que pour PostgREST).
//
// Repris d'Oto (`oto_mcp/access/chain_resolution.py` l. 1-4) : une lecture impossible lève, elle ne
// signifie jamais « absent ». Retiré : les paliers `user > group > org > platform`, les arêtes de
// `grants`, les observateurs de comparaison (`docs/conception/vue-d-ensemble.md`, « Oto : ce qui ne revient jamais »).
import {
  ACCESS_LEVELS,
  ACCOUNT_LEVELS,
  ancestorPaths,
  ROOT_PATH,
  type AccessLevel,
  type AccountFacts,
  type AccountLevel,
  type AccountRuleFact,
  type Caller,
  type NodeChain,
  type NodeFact,
  type NodeOwner,
  type Owner,
  type RuleFact,
} from "./access-levels"
import type { PlatformDb } from "./db"
import { fromDatabaseError, inTransaction, PlatformError } from "./errors"
import type { Tx } from "./sql"

/** Une chaîne lue ; `complete` : chaque chemin d'ancêtre est revenu de la lecture. */
export type ReadNodeChain = NodeChain & { complete: boolean }

type NodeRow = {
  id: string
  org_id: string
  path: string
  owner_kind: string | null
  owner_team_id: string | null
  owner_user_id: string | null
}

type RuleRow = { subject_team_id: string | null; subject_user_id: string | null; subject_org: boolean; level: string }

/** Rang d'un niveau, comme `platform.level_rank` : `none` et toute autre valeur donnent 0. */
const LEVEL_RANKS: Record<string, AccessLevel | undefined> = {
  read: ACCESS_LEVELS.read,
  write: ACCESS_LEVELS.write,
  manage: ACCESS_LEVELS.manage,
}

/**
 * Rang d'un niveau de règle sur un compte, sur l'échelle des comptes (`ACCOUNT_LEVELS`) : `sensitive` n'existe que là
 * (contrainte `access_rules_level_check`) ; `none` donne 0. Toute autre valeur ne vient que d'une écriture hors du
 * paquet : panne nommée, jamais lue comme « aucun ».
 */
function accountLevelRank(level: string): AccountLevel {
  if (level === "none") return ACCOUNT_LEVELS.none
  if (level === "read" || level === "write" || level === "sensitive" || level === "manage") return ACCOUNT_LEVELS[level]
  console.error("[platform] access: account rule of an unknown level")
  throw new PlatformError("internal", "Internal error.")
}

function ownerKind(value: string | null): Owner["kind"] {
  return value === "team" || value === "user" ? value : "org"
}

type OwnerColumns = { owner_kind: string | null; owner_team_id: string | null; owner_user_id: string | null }

/** Le propriétaire que portent les colonnes d'un nœud, d'un compte ou de `node_owner`. */
function ownerOf(row: OwnerColumns): Owner {
  return { kind: ownerKind(row.owner_kind), teamId: row.owner_team_id ?? null, userId: row.owner_user_id ?? null }
}

function nodeFact(row: NodeRow): NodeFact {
  return { id: row.id, orgId: row.org_id, path: row.path, owner: row.owner_kind === null ? null : ownerOf(row) }
}

function ruleFact(targetId: string, row: RuleRow): RuleFact {
  return {
    targetId,
    teamId: row.subject_team_id,
    userId: row.subject_user_id,
    org: row.subject_org,
    level: LEVEL_RANKS[row.level] ?? ACCESS_LEVELS.none,
  }
}

type NodeRuleRow = RuleRow & { node_id: string }

type ChainFacts = { targets: NodeRow[]; byPath: Map<string, NodeFact>; rules: NodeRuleRow[] }

/**
 * Les cibles, leurs ancêtres par chemin et les règles de ces nœuds, en une instruction (E05-S10, partie c :
 * trois lectures en série coûtaient six allers-retours de plus à chaque décision). Une cible à la corbeille
 * (`deleted_at`, E05-S10) n'est pas lue, donc vaut 0 partout où un service décide, sauf quand la corbeille
 * elle-même décide (`trashed`) ; un ancêtre se lit toujours, corbeille comprise. Les chemins des ancêtres
 * sont ceux d'`ancestorPaths` (la racine, puis chaque préfixe du chemin), tirés en SQL de ceux des cibles ; un
 * ancêtre déjà cible n'est pas relu ; aucune règle lue sans cible.
 */
async function readChainFacts(sql: Tx, orgId: string, ids: readonly string[], trashed: boolean): Promise<ChainFacts> {
  const [facts] = await sql<{ targets: NodeRow[]; ancestors: NodeRow[]; rules: NodeRuleRow[] }[]>`
    with targets as (
      select id, org_id, path, owner_kind, owner_team_id, owner_user_id from platform.nodes
       where org_id = ${orgId} and id = any(${ids}::uuid[]) and (deleted_at is null or ${trashed})
    ), wanted as (
      select above.path from targets
       cross join lateral (
         select ${ROOT_PATH}::text as path where targets.path <> ${ROOT_PATH}
         union all
         select array_to_string((string_to_array(targets.path, '/'))[1:depth], '/')
           from generate_series(1, cardinality(string_to_array(targets.path, '/')) - 1) as depth
       ) as above
    ), ancestors as (
      select id, org_id, path, owner_kind, owner_team_id, owner_user_id from platform.nodes
       where org_id = ${orgId} and path in (select path from wanted) and path not in (select path from targets)
    ), rules as (
      select id, node_id, subject_team_id, subject_user_id, subject_org, level from platform.access_rules
       where org_id = ${orgId} and node_id in (select id from targets union all select id from ancestors)
    )
    select (select coalesce(json_agg(targets), '[]') from targets) as targets,
           (select coalesce(json_agg(ancestors), '[]') from ancestors) as ancestors,
           (select coalesce(json_agg(rules), '[]') from rules) as rules`.catch((error) => {
    throw fromDatabaseError(error, "access: node facts")
  })
  const targets = facts?.targets ?? []
  const byPath = new Map([...targets, ...(facts?.ancestors ?? [])].map((row) => [row.path, nodeFact(row)]))
  return { targets, byPath, rules: facts?.rules ?? [] }
}

/**
 * La chaîne de chaque nœud lisible de `nodeIds` dans l'organisation, par id : cibles, ancêtres par
 * chemin, règles, en une lecture (`readChainFacts`), une transaction. Un id absent de la carte est invisible,
 * inconnu, d'une autre organisation, ou à la corbeille sans `trashed` (E05-S10).
 */
export async function readNodeChains(
  db: PlatformDb,
  orgId: string,
  nodeIds: readonly string[],
  options: { trashed?: boolean } = {},
): Promise<Map<string, ReadNodeChain>> {
  const chains = new Map<string, ReadNodeChain>()
  const ids = [...new Set(nodeIds)]
  if (ids.length === 0) return chains
  const { targets, byPath, rules } = await inTransaction(db, "access: node facts", (sql) => readChainFacts(sql, orgId, ids, options.trashed === true))
  const facts = rules.map((row) => ruleFact(row.node_id, row))
  for (const row of targets) {
    const paths = ancestorPaths(row.path)
    const ancestors = paths.flatMap((path) => byPath.get(path) ?? [])
    const lineage = new Set([row.id, ...ancestors.map((node) => node.id)])
    chains.set(row.id, {
      node: nodeFact(row),
      ancestors,
      rules: facts.filter((rule) => lineage.has(rule.targetId)),
      complete: ancestors.length === paths.length,
    })
  }
  return chains
}

type AccountRow = OwnerColumns & { id: string; org_id: string }
type AccountRuleRow = RuleRow & { account_id: string }

/**
 * Chaque compte lisible de `accountIds` dans l'organisation, avec ses règles : deux lectures, parties
 * ensemble, une transaction.
 */
export async function readAccountFacts(
  db: PlatformDb,
  orgId: string,
  accountIds: readonly string[],
): Promise<Map<string, AccountFacts>> {
  const facts = new Map<string, AccountFacts>()
  const ids = [...new Set(accountIds)]
  if (ids.length === 0) return facts
  const [accounts, rules] = await inTransaction(db, "access: accounts, account rules", (sql) =>
    Promise.all([
      sql<AccountRow[]>`select id, org_id, owner_kind, owner_team_id, owner_user_id from platform.accounts
                          where org_id = ${orgId} and id = any(${ids}::uuid[])`,
      sql<AccountRuleRow[]>`select id, account_id, subject_team_id, subject_user_id, subject_org, level from platform.access_rules
                              where org_id = ${orgId} and account_id = any(${ids}::uuid[])`,
    ]),
  )
  for (const row of accounts) {
    facts.set(row.id, {
      account: { id: row.id, orgId: row.org_id, owner: ownerOf(row) },
      rules: rules.filter((rule) => rule.account_id === row.id).map((rule): AccountRuleFact => ({ ...ruleFact(row.id, rule), level: accountLevelRank(rule.level) })),
    })
  }
  return facts
}

/**
 * Chaque membre de l'organisation tel que le calcul le lit (`Caller`) : son rôle, ses équipes et celles
 * qu'il mène, en une transaction (E05-S10, aperçu d'un déplacement). L'équipe plateforme, qui n'est pas
 * membre, n'y est pas.
 */
export async function readMemberCallers(db: PlatformDb, orgId: string): Promise<Caller[]> {
  const [members, teams] = await inTransaction(db, "access: member callers", (sql) =>
    Promise.all([
      sql<{ user_id: string; role: string }[]>`select user_id, role from platform.members where org_id = ${orgId}`,
      sql<{ user_id: string; team_id: string; role: string }[]>`
        select tm.user_id, tm.team_id, tm.role from platform.team_members tm
          join platform.teams t on t.id = tm.team_id where t.org_id = ${orgId}`,
    ]),
  )
  return members.map((member) => {
    const own = teams.filter((row) => row.user_id === member.user_id)
    return {
      userId: member.user_id,
      orgId,
      isOrgAdmin: member.role === "admin",
      teamIds: new Set(own.map((row) => row.team_id)),
      ledTeamIds: new Set(own.filter((row) => row.role === "lead").map((row) => row.team_id)),
    }
  })
}

/**
 * Propriétaire effectif d'un nœud (H52) et le nœud qui le porte, par `platform.node_owner` (fonction
 * de faits, definer) ; `null` hors des organisations de l'appelant. Sert une décision sur une chaîne
 * incomplète, où le porteur peut être un ancêtre invisible (HN-E01S07-4).
 */
export async function nodeOwner(db: PlatformDb, nodeId: string): Promise<NodeOwner | null> {
  const [row] = await inTransaction(
    db,
    "nodeOwner: node_owner",
    (sql) => sql<(OwnerColumns & { owner_node_id: string })[]>`select owner_kind, owner_team_id, owner_user_id, owner_node_id
                                                                 from platform.node_owner(${nodeId})`,
  )
  if (!row) return null
  return { ...ownerOf(row), nodeId: row.owner_node_id }
}
