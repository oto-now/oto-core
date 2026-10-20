// Niveaux d'accès, décisions et refus « à qui demander » (E01-S04, E01-S07 ; H65 à H68, ADR-012
// § 3). Les niveaux se calculent en TypeScript (`access-levels.ts`) sur les faits lus sous le jeton de
// la personne (`access-facts.ts`) : chaque service décide ici, avant sa requête, et aucun niveau ne
// se lit plus par RPC. Les fonctions SQL de niveau qui restent en base (`node_level_for`,
// `node_level_of`) ne servent que la recherche (`search_content`, `route_candidates`), la lecture
// publique par lien (`public_node_by_token`) et le test de parité des nœuds (E01-S12 partie c).
// Sans ce module, chaque service formulerait son refus, et « à qui demander » divergerait d'une
// porte à l'autre.
//
// Repris de la maquette (`mcp-test/src/proto/identity.ts` l. 105-110, `describeTeam`) : la forme
// « team Ventes (lead: Claire Morel) ». Retiré : l'admin qui lit tout, le repli anonyme « the
// organisation admins » (H68 nomme les personnes). Repris d'Oto (`capabilities/_authz.py` l. 26-49) :
// un refus nomme le périmètre et propose une issue ; retiré : l'administrateur désigné par son rôle,
// sans nom.
import { nodeOwner, readAccountFacts, readMemberCallers, readNodeChains, type ReadNodeChain } from "./access-facts"
import {
  ACCESS_LEVELS,
  ACCOUNT_LEVELS,
  accountLevelOf,
  callerOf,
  effectiveOwner,
  nodeLevelOf,
  type AccessLevel,
  type AccountLevel,
  type Caller,
  type NodeChain,
  type Owner,
} from "./access-levels"
import type { PlatformDb } from "./db"
import { leadNames, leadWord, memberDirectory, teamsWithLeads, type DirectoryEntry } from "./directory"
import { fromDatabaseError, inTransaction, PlatformError } from "./errors"
import type { Identity } from "./identity"

export { ACCESS_LEVELS, ACCOUNT_LEVELS, isOrgAdmin, isStaffWithGrant, leadsTeam, requiredAccountLevel } from "./access-levels"
export type { AccessLevel, AccountLevel, NodeOwner, Owner } from "./access-levels"
export { nodeOwner } from "./access-facts"
// Chemins de l'arbre (H50, H51), sans décision : `server/nodes/` les lit ici, `access-levels.ts` lui
// étant fermé (ESLint) ; sans eux, `lookup.ts` recopiait racine, ancêtres et profondeur (E03-S03).
export { ancestorPaths, nodeDepth, ROOT_PATH } from "./access-levels"

/**
 * Ce que l'appelant tente sur un nœud, et le niveau que cela exige : écrire le brouillon et publier
 * (H63 ; écrire publie, fiche D135, E11-S02), renommer par le titre publié (le chemin qui suit le titre,
 * HN-E11S02-18), poser ou retirer une règle d'accès (fiche D4, E05-S03), déplacer (H71, E03-S07),
 * changer son propriétaire (E08-S06, N19). L'action fixe le niveau et le verbe du refus.
 */
const NODE_ACTIONS = {
  write: ACCESS_LEVELS.write,
  publish: ACCESS_LEVELS.write,
  rename: ACCESS_LEVELS.write,
  share: ACCESS_LEVELS.manage,
  move: ACCESS_LEVELS.manage,
  transfer: ACCESS_LEVELS.manage,
  // E05-S10 : mettre à la corbeille, en restaurer (le niveau de « Déplacer »).
  trash: ACCESS_LEVELS.manage,
  restore: ACCESS_LEVELS.manage,
} as const

export type NodeAction = keyof typeof NODE_ACTIONS

/** Ce que l'appelant tente, sur un nœud ou un compte (`use`) : le verbe du refus et son issue. */
export type AccessAction = NodeAction | "use"

const ACTIONS: Record<AccessAction, { verb: string; ask: string }> = {
  write: { verb: "Writing", ask: "Ask them for access." },
  publish: { verb: "Publishing", ask: "Ask them to publish it." },
  rename: { verb: "Renaming", ask: "Ask them to rename it." },
  share: { verb: "Sharing", ask: "Ask them to share it." },
  move: { verb: "Moving", ask: "Ask them to move it." },
  transfer: { verb: "Changing the owner of", ask: "Ask them to change it." },
  trash: { verb: "Deleting", ask: "Ask them to delete it." },
  restore: { verb: "Restoring", ask: "Ask them to restore it." },
  use: { verb: "Using", ask: "Ask them for access." },
}

/** Au plus autant d'administrateurs nommés dans un refus, puis « and <n> more » (AC21). */
const MAX_NAMED = 3

/** Un niveau et le propriétaire qui dit à qui demander ; `owner` nul pour une cible invisible. */
type Decision = { level: AccessLevel; owner: Owner | null }

const INVISIBLE: Decision = { level: ACCESS_LEVELS.none, owner: null }

/**
 * Niveau de l'appelant sur chacun des nœuds, en une lecture, une transaction
 * (`access-facts.ts`) ; 0 pour un nœud inconnu, invisible ou d'une autre organisation. Pour les listes :
 * jamais au-dessus du niveau de la base, exact au seuil de la lecture (niveau ≥ 1). Un nœud dont un
 * ancêtre manque à la lecture (un chemin sans nœud ; la RLS n'en cache plus depuis E01-S08) est ramené à
 * la lecture : sans `node_owner`, son propriétaire effectif peut être faux (HN-E01S07-4, HN-E01S07-19). Une décision à
 * l'écriture ou à la gestion passe par `nodeLevel` ou `requireNodeLevel`.
 */
export async function nodeLevels(
  db: PlatformDb,
  identity: Identity,
  nodeIds: readonly string[],
): Promise<Map<string, AccessLevel>> {
  const caller = callerOf(identity)
  const chains = await readNodeChains(db, identity.org.id, nodeIds)
  return new Map(
    nodeIds.map((id) => {
      const chain = chains.get(id)
      if (!chain) return [id, ACCESS_LEVELS.none]
      const level = nodeLevelOf(caller, chain)
      return [id, chain.complete || level <= ACCESS_LEVELS.read ? level : ACCESS_LEVELS.read]
    }),
  )
}

/**
 * La chaîne lue d'un nœud, prête pour une décision : incomplète (un chemin d'ancêtre sans nœud ; la
 * RLS n'en cache plus depuis E01-S08), elle reçoit son propriétaire effectif de `node_owner` (HN-E01S07-4).
 */
async function completedChain(db: PlatformDb, nodeId: string, read: ReadNodeChain): Promise<NodeChain> {
  return read.complete ? read : { ...read, owner: await nodeOwner(db, nodeId) }
}

/**
 * Décision sur un nœud : une chaîne incomplète reçoit son propriétaire de `node_owner`. `trashed` : un
 * nœud à la corbeille se décide aussi (E05-S10, restauration) ; sinon il vaut 0.
 */
async function nodeDecision(db: PlatformDb, identity: Identity, nodeId: string, trashed = false): Promise<Decision> {
  const read = (await readNodeChains(db, identity.org.id, [nodeId], { trashed })).get(nodeId)
  if (!read) return INVISIBLE
  const chain = await completedChain(db, nodeId, read)
  return { level: nodeLevelOf(callerOf(identity), chain), owner: effectiveOwner(chain) }
}

/**
 * Niveau de l'appelant sur un nœud, pour une décision ; 0 pour un nœud inconnu, invisible ou d'une
 * autre organisation. Exact : l'écart résiduel de HN-E01S07-4 (c), un ancêtre que l'appelant ne voyait
 * pas, est parti avec la RLS de niveau (E01-S08), qui n'isole plus que l'organisation.
 */
export async function nodeLevel(db: PlatformDb, identity: Identity, nodeId: string): Promise<AccessLevel> {
  return (await nodeDecision(db, identity, nodeId)).level
}

/**
 * Décision sur chacun des nœuds d'une liste qui décide au-delà de la lecture (E03-S06 : brouillon
 * servi à partir de l'écriture, P24 ; équipe propriétaire effective, H52) : niveau exact et
 * propriétaire effectif, comme `nodeDecision`, sur des faits lus en un lot (HN-E01S07-3) ; `node_owner`
 * pour une chaîne incomplète seulement. `nodeLevels` n'est exact qu'au seuil de la lecture
 * (HN-E01S07-19). Un nœud inconnu, invisible ou d'une autre organisation : niveau 0, sans propriétaire.
 * `trashed` : les nœuds à la corbeille se décident aussi (E05-S10, liste de la corbeille).
 */
export async function nodeDecisions(
  db: PlatformDb,
  identity: Identity,
  nodeIds: readonly string[],
  options: { trashed?: boolean } = {},
): Promise<Map<string, { level: AccessLevel; owner: Owner | null }>> {
  const caller = callerOf(identity)
  const chains = await readNodeChains(db, identity.org.id, nodeIds, options)
  const decisions = new Map<string, Decision>()
  for (const id of nodeIds) {
    const read = chains.get(id)
    // Un chemin d'ancêtre sans nœud (la RLS n'en cache plus depuis E01-S08) : une lecture de
    // `node_owner` par chaîne incomplète.
    const chain = read && !read.complete ? { ...read, owner: await nodeOwner(db, id) } : read
    decisions.set(id, chain ? { level: nodeLevelOf(caller, chain), owner: effectiveOwner(chain) } : INVISIBLE)
  }
  return decisions
}

/**
 * Niveau de l'appelant sur chacun des comptes, sur l'échelle des comptes (`ACCOUNT_LEVELS`), en deux lectures ; 0 pour
 * un compte inconnu ou invisible.
 */
export async function accountLevels(
  db: PlatformDb,
  identity: Identity,
  accountIds: readonly string[],
): Promise<Map<string, AccountLevel>> {
  const caller = callerOf(identity)
  const facts = await readAccountFacts(db, identity.org.id, accountIds)
  return new Map(
    accountIds.map((id) => {
      const account = facts.get(id)
      return [id, account ? accountLevelOf(caller, account) : ACCOUNT_LEVELS.none]
    }),
  )
}

async function accountDecision(db: PlatformDb, identity: Identity, accountId: string): Promise<{ level: AccountLevel; owner: Owner | null }> {
  const facts = (await readAccountFacts(db, identity.org.id, [accountId])).get(accountId)
  if (!facts) return { level: ACCOUNT_LEVELS.none, owner: null }
  return { level: accountLevelOf(callerOf(identity), facts), owner: facts.account.owner }
}

/** Niveau de l'appelant sur un compte de connecteur (`ACCOUNT_LEVELS`) ; 0 pour un compte inconnu ou invisible. */
export async function accountLevel(db: PlatformDb, identity: Identity, accountId: string): Promise<AccountLevel> {
  return (await accountDecision(db, identity, accountId)).level
}

/** « Ada Martin », « A and B », « A, B and C », « A, B, C and 2 more ». */
function namesList(names: string[]): string {
  if (names.length > MAX_NAMED) {
    return `${names.slice(0, MAX_NAMED).join(", ")} and ${names.length - MAX_NAMED} more`
  }
  if (names.length <= 1) return names.join("")
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
}

/** Noms des administrateurs : « Ada Martin », « A and B », « A, B, C and 2 more » ; vide sans administrateur. */
export function administratorNames(directory: DirectoryEntry[]): string {
  // Tri en mémoire, en français, comme les équipes de l'identité : l'ordre ne dépend pas de la
  // collation de la base de l'hôte.
  const names = directory
    .filter((person) => person.role === "admin")
    .map((person) => person.name)
    .sort((a, b) => a.localeCompare(b, "fr"))
  return namesList(names)
}

/** « the administrators of Acme (Ada Martin) », ou sans parenthèse quand l'organisation n'en a pas. */
export function administrators(identity: Identity, directory: DirectoryEntry[]): string {
  const names = administratorNames(directory)
  const who = `the administrators of ${identity.org.name}`
  return names ? `${who} (${names})` : who
}

/** « lead: Claire Morel », « leads: Claire Morel, Paul Girard » : les responsables nommés d'une équipe. */
function leadsWords(names: readonly string[]): string {
  return `${leadWord(names.length)}: ${names.join(", ")}`
}

/**
 * À qui demander (H68), d'après le propriétaire : « team Ventes (lead: Claire Morel) », « team Ventes
 * (leads: Claire Morel, Léa Roux) » (E05-S13), « team Support » (sans responsable), « the administrators
 * of Acme (Ada Martin) », « its owner ». Les noms viennent de `member_directory` (`memberDirectory`,
 * `directory.ts`), lus avec l'équipe et ses responsables dans une transaction (face SQL, E01-S10), où
 * `memberDirectory` reprend la sienne.
 */
export async function describeOwner(db: PlatformDb, identity: Identity, owner: Owner): Promise<string> {
  if (owner.kind === "user") return "its owner"
  const { teamId } = owner
  if (owner.kind === "org" || !teamId) return administrators(identity, await memberDirectory(db, identity.org.id))
  return inTransaction(db, "describeOwner", async (sql) => {
    const directory = await memberDirectory(db, identity.org.id)
    const [team] = await teamsWithLeads(sql, identity.org.id, teamId).catch((error) => {
      throw fromDatabaseError(error, "describeOwner: teams")
    })
    // Une équipe illisible (supprimée entre deux lectures) : ses administrateurs restent ceux à qui
    // demander.
    if (!team) return administrators(identity, directory)
    const names = leadNames(team.leads, (userId) => directory.find((person) => person.userId === userId)?.name)
    return names.length > 0 ? `team ${team.name} (${leadsWords(names)})` : `team ${team.name}`
  })
}

/** Même réponse qu'un chemin inexistant : un nœud invisible est introuvable (H68). */
export function unknownPath(path: string): string {
  return `Unknown path ${path}.`
}

/** « Writing ventes/devis is reserved to team Ventes (lead: Claire Morel). Ask them for access. » */
export function reservedTo(action: AccessAction, target: string, who: string): string {
  const { verb, ask } = ACTIONS[action]
  return `${verb} ${target} is reserved to ${who}. ${ask}`
}

/**
 * Exige sur un nœud le niveau de l'action (écrire et publier : 2, gérer : 3) et rend le niveau de
 * l'appelant. Invisible : `not_found` (H68) ; visible sans le niveau : `forbidden`, qui dit à qui
 * demander. Décidé comme `nodeLevel`, exact depuis E01-S08.
 */
export async function requireNodeLevel(
  db: PlatformDb,
  identity: Identity,
  node: { id: string; path: string },
  action: NodeAction,
): Promise<AccessLevel> {
  // Restaurer décide sur un nœud à la corbeille, que toute autre action tient pour absent (E05-S10).
  const { level, owner } = await nodeDecision(db, identity, node.id, action === "restore")
  if (level >= NODE_ACTIONS[action]) return level
  if (level === ACCESS_LEVELS.none || !owner) throw new PlatformError("not_found", unknownPath(node.path))
  throw new PlatformError("forbidden", reservedTo(action, node.path, await describeOwner(db, identity, owner)))
}

/**
 * Exige un niveau sur un compte de connecteur (H67, échelle des comptes) et rend le niveau de l'appelant. Invisible :
 * `not_found` ; visible sans le niveau : `forbidden`, qui dit à qui demander.
 */
export async function requireAccountLevel(
  db: PlatformDb,
  identity: Identity,
  account: { id: string; label: string },
  needed: AccountLevel,
): Promise<AccountLevel> {
  const { level, owner } = await accountDecision(db, identity, account.id)
  if (level >= needed) return level
  if (level === ACCOUNT_LEVELS.none || !owner) throw new PlatformError("not_found", `Unknown account « ${account.label} ».`)
  throw new PlatformError("forbidden", reservedTo("use", `account « ${account.label} »`, await describeOwner(db, identity, owner)))
}

/** Les niveaux de chaque membre sur un nœud avant et après un déplacement, et son propriétaire effectif. */
export type MoveLevels = {
  callers: Caller[]
  before: Map<string, AccessLevel>
  after: Map<string, AccessLevel>
  owners: { before: Owner | null; after: Owner | null }
}

/**
 * Ce qu'un déplacement changerait (E05-S10, AC-b7) : le niveau de chaque membre de l'organisation sur
 * le nœud à sa place, puis sous `parentId` au chemin `newPath` (ses règles propres le suivent, celles de
 * ses anciens ancêtres restent, H71), et le propriétaire effectif de chaque place ; `null` quand le nœud
 * ou le parent manque. Calcul pur sur les faits lus (H66), sans rien écrire.
 */
export async function moveLevels(db: PlatformDb, identity: Identity, move: { nodeId: string; parentId: string; newPath: string }): Promise<MoveLevels | null> {
  const [chains, callers] = await Promise.all([readNodeChains(db, identity.org.id, [move.nodeId, move.parentId]), readMemberCallers(db, identity.org.id)])
  const read = chains.get(move.nodeId)
  const parent = chains.get(move.parentId)
  if (!read || !parent) return null
  const current = await completedChain(db, move.nodeId, read)
  const moved: NodeChain = {
    node: { ...current.node, path: move.newPath },
    ancestors: [...parent.ancestors, parent.node],
    rules: [...parent.rules, ...current.rules.filter((rule) => rule.targetId === move.nodeId)],
  }
  return {
    callers,
    before: new Map(callers.map((caller) => [caller.userId, nodeLevelOf(caller, current)])),
    after: new Map(callers.map((caller) => [caller.userId, nodeLevelOf(caller, moved)])),
    owners: { before: effectiveOwner(current), after: effectiveOwner(moved) },
  }
}

/** Le niveau d'un membre sur un nœud, et celui qu'il aurait sans la règle qui le nomme sur ce nœud même. */
export type MemberLevel = { level: AccessLevel; inherited: AccessLevel }

/**
 * Les niveaux des membres d'une équipe sur un nœud (1.4.12, droits par personne) : chacun tel que le calcul le décide
 * (`nodeLevelOf`, sur les faits de chaque membre, comme `moveLevels`), et ce qu'il aurait sans sa règle nominative sur ce
 * nœud (`inherited`), ce que « Rétablir » rend. Vide quand le nœud manque. Calcul pur sur les faits lus, sans rien écrire.
 */
export async function teamMemberLevels(db: PlatformDb, identity: Identity, nodeId: string, teamId: string): Promise<Map<string, MemberLevel>> {
  const [chains, callers] = await Promise.all([readNodeChains(db, identity.org.id, [nodeId]), readMemberCallers(db, identity.org.id)])
  const read = chains.get(nodeId)
  if (!read) return new Map()
  const chain = await completedChain(db, nodeId, read)
  return new Map(
    callers
      .filter((caller) => caller.teamIds.has(teamId))
      .map((caller) => {
        const without: NodeChain = { ...chain, rules: chain.rules.filter((rule) => rule.targetId !== nodeId || rule.userId !== caller.userId) }
        return [caller.userId, { level: nodeLevelOf(caller, chain), inherited: nodeLevelOf(caller, without) }]
      }),
  )
}
