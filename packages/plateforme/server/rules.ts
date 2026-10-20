// Règles d'accès sur un nœud (E05-S03 : AC15 à AC17, AC19 ; H65, H66, H68, fiche D4). Les niveaux
// viennent d'`access.ts` (`nodeLevel`, `nodeLevels`, `requireNodeLevel`, `nodeOwner`), jamais
// recalculés ici. Ce module décide et filtre avant sa requête (E01-S07c, ADR-012 § 3) : un nœud se
// lit au niveau 1, une règle se pose ou se retire au niveau 3 (`share`), `manage` est réservé à
// `isOrgAdmin` (fiche D4, N6), le sujet est de l'organisation ; la RLS d'`access_rules` reste la
// seconde barrière. Un refus dit à qui demander (H68).
//
// Face SQL (E01-S10, lot e1b1) : chaque opération tient en une transaction (`inTransaction`, M32), ses
// lectures, ses décisions et ses écritures (AC-x4), en paramètres liés. Les décisions d'`access.ts` et
// l'annuaire la reprennent par `db` (un `tx` sous la même session reprend la transaction ouverte,
// `server/sql.ts`), depuis que tous deux lisent par la face SQL : une transaction n'attend aucune
// entrée-sortie extérieure (`supabase-patterns.md § Couplage à Supabase (ADR-012)`, HN-E01S10-e1b1-1).
//
// Repris de la maquette (`mcp-test/src/proto/identity.ts` l. 105-110, `describeTeam`) : le
// propriétaire décrit comme « équipe X (responsable : Y) ». Retiré : l'admin qui lit tout, personnel
// compris (H66 (1), fiche D5), et le calcul des droits (`canRead`, `canWrite` : calculés par
// `access-levels.ts`, E01-S07).
import {
  ACCESS_LEVEL_NAMES,
  nodePathSchema,
  setAccountRuleSchema,
  setNodeRuleSchema,
  type AccessLevelName,
  type NodeRulesView,
  type RuledNodeView,
  type RuleSubject,
} from "../schemas"
import {
  ACCESS_LEVELS,
  nodeLevel,
  nodeLevels,
  nodeOwner,
  requireAccountLevel,
  requireNodeLevel,
  unknownPath,
  type AccessLevel,
  type NodeAction,
  type Owner,
} from "./access"
import type { PlatformDb } from "./db"
import { leadNames, memberDirectory, teamsWithLeads } from "./directory"
import { refuseOwnerTeamBelowOrg, teamPeople } from "./team-people"
import { changedMeanwhile, inTransaction, invalidInput, isPlatformError, PlatformError } from "./errors"
import type { Identity } from "./identity"
import { parseId, requireAdmin, type Mutation } from "./members"
import type { Tx } from "./sql"

type NodeRef = { id: string; path: string; title: string }

type RuleRow = { id: string; subject_team_id: string | null; subject_user_id: string | null; subject_org: boolean; level: string }

type TeamName = { id: string; name: string }

/** Le client de l'opération et sa transaction ouverte (`inTransaction`), que les décisions d'`access.ts` reprennent par `db`. */
export type InOperation = { db: PlatformDb; sql: Tx }

/** Le niveau d'une règle lu en base, nommé comme `ACCESS_LEVEL_NAMES` ; toute autre valeur : `none`. */
function levelName(value: string): AccessLevelName {
  return ACCESS_LEVEL_NAMES.find((name) => name === value) ?? "none"
}

/** Les règles d'un nœud changées entre la lecture et l'écriture du service (HN-E05S03-39, HN-E01S07-6). */
function rulesChanged(path: string): string {
  return `The rules of ${path} changed meanwhile: reload them and try again.`
}

/**
 * Un nœud que l'appelant lit, par son chemin, et son niveau, décidé ici (`nodeLevel`) et non par la
 * RLS. Inconnu, invisible (niveau 0, H68) ou mal formé : la même réponse, `not_found`, pour que
 * l'écran dise la même phrase dans les trois cas (AC16). Avec une action, le niveau qu'elle exige, et
 * son refus qui dit à qui demander (`requireNodeLevel`). `sql` : la transaction de l'opération, que la
 * décision d'`access.ts` reprend par `db`.
 */
async function readNode({ db, sql }: InOperation, identity: Identity, path: string, action?: NodeAction): Promise<NodeRef & { level: AccessLevel }> {
  const parsed = nodePathSchema.safeParse(path)
  if (!parsed.success) throw new PlatformError("not_found", unknownPath(path))
  const [data] = await sql<NodeRef[]>`select id, path, title from platform.nodes where org_id = ${identity.org.id} and path = ${parsed.data}`
  if (!data) throw new PlatformError("not_found", unknownPath(parsed.data))
  const level = action ? await requireNodeLevel(db, identity, data, action) : await nodeLevel(db, identity, data.id)
  if (level === ACCESS_LEVELS.none) throw new PlatformError("not_found", unknownPath(parsed.data))
  return { ...data, level }
}

/**
 * L'équipe propriétaire effective d'un nœud, pour le journal (H07) ; `null` hors d'une équipe. Lue
 * avant l'écriture : sa panne ne rend jamais une erreur sur une base déjà changée.
 */
async function ownerTeam(db: PlatformDb, nodeId: string): Promise<string | null> {
  const owner = await nodeOwner(db, nodeId)
  return owner?.kind === "team" ? owner.teamId : null
}

/**
 * Le panneau d'un nœud (AC16) : son propriétaire effectif (H52), le niveau de l'appelant, ses
 * règles (les équipes, puis les personnes, par nom), à part celle de toute l'organisation, l'accès
 * général (ADR-014), et, sur demande (`people`), les membres de l'équipe propriétaire avec leur niveau (1.4.12) : un calcul
 * de plus, que l'affichage d'une page ne paie pas.
 */
export async function listNodeRules(db: PlatformDb, identity: Identity, path: string, options: { people?: boolean } = {}): Promise<NodeRulesView> {
  return inTransaction(db, "listNodeRules", (sql) => nodeRulesIn({ db, sql }, identity, path, options))
}

/**
 * Le panneau d'un nœud dans la transaction `sql` d'un appelant : celle d'un service qui lit encore autre chose du même
 * nœud (`node.access` et son lien public) sans ouvrir une seconde transaction (`supabase-patterns.md § Couplage à Supabase`).
 */
export async function nodeRulesIn({ db, sql }: InOperation, identity: Identity, path: string, options: { people?: boolean } = {}): Promise<NodeRulesView> {
  const node = await readNode({ db, sql }, identity, path)
  const [owner, [rules, teams], directory] = await Promise.all([
    nodeOwner(db, node.id),
    Promise.all([
      sql<RuleRow[]>`select id, subject_team_id, subject_user_id, subject_org, level from platform.access_rules where node_id = ${node.id}`,
      // Les responsables de chaque équipe (`team_members.role`, E05-S13), dans la même lecture.
      teamsWithLeads(sql, identity.org.id),
    ]),
    memberDirectory(db, identity.org.id),
  ])
  const teamOf = new Map(teams.map((team) => [team.id, team]))
  const nameOf = (userId: string | null) => directory.find((person) => person.userId === userId)?.name

  let ownerView: NodeRulesView["owner"] = { kind: "org" }
  const team = owner?.kind === "team" && owner.teamId ? teamOf.get(owner.teamId) : undefined
  // Les membres et l'accès par défaut de l'équipe propriétaire et de toute l'organisation, sur demande (`people`), hors Privé.
  const owned = options.people && owner && owner.kind !== "user" ? await teamPeople(db, identity, { nodeId: node.id, team: team ?? null, rules, nameOf }) : { people: [], team: null }
  if (owner?.kind === "team") {
    const names = leadNames(team?.leads ?? [], (userId) => nameOf(userId))
    const led = names.length > 0
    ownerView = { kind: "team", teamId: team?.id, teamName: team?.name, leadName: led ? names.join(", ") : undefined, leadCount: led ? names.length : undefined }
  } else if (owner?.kind === "user") {
    ownerView = { kind: "user", userName: nameOf(owner.userId) }
  }

  const view = (rule: RuleRow): NodeRulesView["rules"][number] => {
    const subject = rule.subject_team_id
      ? { kind: "team" as const, id: rule.subject_team_id, name: teamOf.get(rule.subject_team_id)?.name ?? rule.subject_team_id }
      : { kind: "user" as const, id: rule.subject_user_id ?? "", name: nameOf(rule.subject_user_id) ?? rule.subject_user_id ?? "" }
    return { id: rule.id, subject, level: levelName(rule.level) }
  }
  const general = rules.find((rule) => rule.subject_org)
  return {
    path: node.path,
    title: node.title,
    owner: ownerView,
    viewerLevel: node.level,
    rules: rules
      .filter((rule) => !rule.subject_org)
      .map(view)
      .sort((a, b) => Number(a.subject.kind === "user") - Number(b.subject.kind === "user") || a.subject.name.localeCompare(b.subject.name, "fr")),
    general: general ? { id: general.id, level: levelName(general.level) } : null,
    ...owned,
  }
}

/**
 * Les nœuds que l'appelant lit (niveau 1 au moins, calculé par `nodeLevels`) et qui portent au moins
 * une règle, par chemin (AC15). Une liste compare `nodeLevels` à la lecture seulement
 * (`security-patterns.md § Droits dans le service`).
 */
export async function listRuledNodes(db: PlatformDb, identity: Identity): Promise<RuledNodeView[]> {
  return inTransaction(db, "listRuledNodes", async (sql) => {
    const rules = await sql<{ node_id: string }[]>`select node_id from platform.access_rules where org_id = ${identity.org.id} and node_id is not null`
    const counts = new Map<string, number>()
    for (const rule of rules) counts.set(rule.node_id, (counts.get(rule.node_id) ?? 0) + 1)
    if (counts.size === 0) return []
    // Les titres des seuls nœuds lus : la liste reste celle que la RLS de niveau servait.
    const levels = await nodeLevels(db, identity, [...counts.keys()])
    const readable = [...counts.keys()].filter((id) => (levels.get(id) ?? ACCESS_LEVELS.none) >= ACCESS_LEVELS.read)
    if (readable.length === 0) return []
    const nodes = await sql<NodeRef[]>`select id, path, title from platform.nodes where org_id = ${identity.org.id} and id = any(${readable})`
    return nodes
      .map((node) => ({ path: node.path, title: node.title, rulesCount: counts.get(node.id) ?? 0 }))
      .sort((a, b) => a.path.localeCompare(b.path))
  })
}

/** Le sujet d'une règle est une équipe ou un membre de l'organisation (AC17) : un identifiant forgé est refusé. */
async function requireSubject(sql: Tx, identity: Identity, subject: RuleSubject): Promise<void> {
  const [found] =
    subject.kind === "team"
      ? await sql`select id from platform.teams where id = ${subject.id} and org_id = ${identity.org.id}`
      : await sql`select user_id from platform.members where user_id = ${subject.id} and org_id = ${identity.org.id}`
  if (!found) throw new PlatformError("invalid_arguments", `No ${subject.kind} ${subject.id} in ${identity.org.name}.`)
}

/**
 * Une règle à poser : sa cible (un nœud ou un compte, par sa colonne), son sujet (toute l'organisation
 * sur un nœud seulement, ADR-014), son niveau.
 */
type RuleWrite = { target: { column: "node_id" | "account_id"; id: string }; subject: RuleSubject | { kind: "org" }; level: AccessLevelName }

/**
 * Pose la règle du sujet sur la cible, ou remplace son niveau (AC17, fiche D4), dans la transaction de
 * l'opération (E01-S10, AC-x4) : relit la règle du couple cible-sujet, puis met à jour `level` ou insère — pas
 * d'upsert, `access_rules` n'accorde que `update (level)` (N15). Posée entre la lecture et l'insertion
 * (l'insertion n'écrit rien : `on conflict do nothing`), son niveau est remplacé ; déjà retirée aussi,
 * la page ne montre plus les règles de la cible, c'est un conflit (« Rechargez la page »), ni une panne
 * ni un refus (HN-E05S03-39, HN-E01S07-6). Une mise à jour sans ligne n'est jamais un succès muet.
 */
export async function saveRule(
  sql: Tx,
  identity: Identity,
  rule: RuleWrite,
  changed: { context: string; message: string },
): Promise<{ id: string; created: boolean }> {
  const { target, subject, level } = rule
  const targetColumn = sql(target.column)
  const subjectColumn = sql(subject.kind === "team" ? "subject_team_id" : subject.kind === "user" ? "subject_user_id" : "subject_org")
  // La règle de toute l'organisation se reconnaît à `subject_org` vrai.
  const subjectValue = subject.kind === "org" ? true : subject.id
  const current = async () => {
    const [found] = await sql<{ id: string }[]>`
      select id from platform.access_rules where ${targetColumn} = ${target.id} and ${subjectColumn} = ${subjectValue}`
    return found
  }
  const replace = async (id: string) => {
    const updated = await sql`update platform.access_rules set level = ${level} where id = ${id} returning id`
    if (updated.length === 0) throw changedMeanwhile(changed.context, id, changed.message)
    return { id, created: false }
  }
  const existing = await current()
  if (existing) return replace(existing.id)
  const [inserted] = await sql<{ id: string }[]>`
    insert into platform.access_rules (org_id, ${targetColumn}, ${subjectColumn}, level, created_by)
    values (${identity.org.id}, ${target.id}, ${subjectValue}, ${level}, ${identity.user.id})
    on conflict do nothing
    returning id`
  if (inserted) return { id: inserted.id, created: true }
  const raced = await current()
  if (!raced) throw changedMeanwhile(changed.context, target.id, changed.message)
  return replace(raced.id)
}

/**
 * Pose une règle, ou remplace le niveau de la règle du même sujet (AC17, fiche D4), par `saveRule`
 * une fois le nœud géré, le niveau permis et le sujet reconnu.
 */
export async function setNodeRule(
  db: PlatformDb,
  identity: Identity,
  input: unknown,
): Promise<Mutation<{ id: string; path: string; subject: RuleSubject; level: AccessLevelName; created: boolean }>> {
  const parsed = setNodeRuleSchema.safeParse(input)
  if (!parsed.success) throw invalidInput(parsed.error)
  const { path, subject, level } = parsed.data
  return inTransaction(db, "setNodeRule", async (sql) => {
    const node = await readNode({ db, sql }, identity, path, "share")
    if (level === "manage") requireAdmin(identity, "grant the manage level")
    await requireSubject(sql, identity, subject)
    const teamId = await ownerTeam(db, node.id)
    if (subject.kind === "team" && subject.id === teamId) await refuseOwnerTeamBelowOrg(db, identity, node, level)

    const target = { column: "node_id" as const, id: node.id }
    const saved = await saveRule(sql, identity, { target, subject, level }, { context: "setNodeRule", message: rulesChanged(node.path) })
    return { data: { id: saved.id, path: node.path, subject, level, created: saved.created }, target: node.path, teamId }
  })
}

/**
 * Retire une règle d'un nœud (AC17) ; il faut la gestion du nœud, comme pour la poser. La règle d'un
 * nœud que l'appelant ne lit pas est introuvable, comme une règle inconnue : le refus ne nomme pas le
 * chemin du nœud (H68). La règle et son nœud se lisent l'une après l'autre, dans la transaction de
 * l'opération.
 */
export async function removeRule(db: PlatformDb, identity: Identity, ruleId: unknown): Promise<Mutation<{ id: string; path: string }>> {
  const id = parseId(ruleId, "rule")
  const unknownRule = () => new PlatformError("not_found", `No rule ${id} on a node of ${identity.org.name}.`)
  return inTransaction(db, "removeRule", async (sql) => {
    const [rule] = await sql<{ id: string; node_id: string | null }[]>`select id, node_id from platform.access_rules where id = ${id} and org_id = ${identity.org.id}`
    const nodeId = rule?.node_id
    if (!nodeId) throw unknownRule()
    const [node] = await sql<NodeRef[]>`select id, path, title from platform.nodes where id = ${nodeId}`
    if (!node) throw unknownRule()
    await requireNodeLevel(db, identity, node, "share").catch((refusal: unknown) => {
      throw isPlatformError(refusal) && refusal.code === "not_found" ? unknownRule() : refusal
    })
    const teamId = await ownerTeam(db, node.id)

    const deleted = await sql`delete from platform.access_rules where id = ${id} returning id`
    if (deleted.length === 0) throw changedMeanwhile("removeRule", id, rulesChanged(node.path))
    return { data: { id, path: node.path }, target: node.path, teamId }
  })
}

// ------------------------------------------------------------------ Règles d'un compte (E08-S06, N10)
// Sur le modèle des règles d'un nœud : un compte se lit au niveau 1, une règle s'y pose ou s'en retire à
// la gestion du compte (`requireAccountLevel`, H67), `manage` réservé à `isOrgAdmin` (fiche D4), le
// sujet est de l'organisation ; tout est décidé avant la requête (H123). Un compte n'hérite de rien : la
// règle du sujet sur le compte même décide, sinon les défauts de H67.

/** Les règles d'un compte telles que les lit le MCP admin : le compte, son propriétaire, le niveau de l'appelant. */
export type AccountRulesView = { id: string; label: string; owner: Owner; viewerLevel: AccessLevel; rules: NodeRulesView["rules"] }

type AccountRow = { id: string; label: string; owner_kind: string; owner_team_id: string | null; owner_user_id: string | null }

function accountRulesChanged(label: string): string {
  return `The rules of account « ${label} » changed meanwhile: reload them and try again.`
}

/**
 * Le compte de l'organisation et son propriétaire (H67) ; le niveau `needed` exigé de l'appelant, sinon le
 * refus d'`access.ts`. Un compte invisible (niveau 0) répond comme un identifiant inconnu, sans son libellé (H68).
 */
async function readAccount({ db, sql }: InOperation, identity: Identity, accountId: string, needed: AccessLevel) {
  const unknownAccount = () => new PlatformError("not_found", `Unknown account ${accountId}.`)
  const [row] = await sql<AccountRow[]>`
    select id, label, owner_kind, owner_team_id, owner_user_id from platform.accounts where id = ${accountId} and org_id = ${identity.org.id}`
  if (!row) throw unknownAccount()
  const level = await requireAccountLevel(db, identity, { id: row.id, label: row.label }, needed).catch((refusal: unknown) => {
    throw isPlatformError(refusal) && refusal.code === "not_found" ? unknownAccount() : refusal
  })
  const kind: Owner["kind"] = row.owner_kind === "team" || row.owner_kind === "user" ? row.owner_kind : "org"
  const owner: Owner = { kind, teamId: row.owner_team_id, userId: row.owner_user_id }
  return { id: row.id, label: row.label, owner, level, teamId: kind === "team" ? row.owner_team_id : null }
}

/**
 * Les règles d'un compte que l'appelant lit (niveau 1 au moins) : les équipes, puis les personnes, par nom.
 * Les règles, puis les noms de leurs équipes, se lisent l'une après l'autre dans la transaction de l'opération.
 */
export async function listAccountRules(db: PlatformDb, identity: Identity, accountId: unknown): Promise<AccountRulesView> {
  const id = parseId(accountId, "account")
  return inTransaction(db, "listAccountRules", async (sql) => {
    const account = await readAccount({ db, sql }, identity, id, ACCESS_LEVELS.read)
    // Rangées par id, comme les pages qu'en lisait PostgREST : un même nom garde son ordre.
    const rows = await sql<RuleRow[]>`
      select id, subject_team_id, subject_user_id, subject_org, level from platform.access_rules
       where org_id = ${identity.org.id} and account_id = ${account.id} order by id`
    const teamIds = [...new Set(rows.flatMap((row) => (row.subject_team_id ? [row.subject_team_id] : [])))]
    const readTeams = async (): Promise<TeamName[]> =>
      teamIds.length === 0 ? [] : sql<TeamName[]>`select id, name from platform.teams where org_id = ${identity.org.id} and id = any(${teamIds})`
    const [teams, directory] = await Promise.all([readTeams(), memberDirectory(db, identity.org.id)])
    const teamName = new Map(teams.map((team) => [team.id, team.name]))
    const personName = new Map(directory.map((person) => [person.userId, person.name]))
    const rules = rows.map((rule) => {
      const subject = rule.subject_team_id
        ? { kind: "team" as const, id: rule.subject_team_id, name: teamName.get(rule.subject_team_id) ?? rule.subject_team_id }
        : { kind: "user" as const, id: rule.subject_user_id ?? "", name: personName.get(rule.subject_user_id ?? "") ?? rule.subject_user_id ?? "" }
      return { id: rule.id, subject, level: levelName(rule.level) }
    })
    rules.sort((a, b) => Number(a.subject.kind === "user") - Number(b.subject.kind === "user") || a.subject.name.localeCompare(b.subject.name, "fr"))
    return { id: account.id, label: account.label, owner: account.owner, viewerLevel: account.level, rules }
  })
}

/**
 * Pose une règle sur un compte, ou remplace le niveau de la règle du même sujet (`saveRule`, comme
 * `setNodeRule`). La gestion du compte est exigée avant toute écriture ; sans elle, aucune requête
 * d'écriture ne part.
 */
export async function setAccountRule(
  db: PlatformDb,
  identity: Identity,
  input: unknown,
): Promise<Mutation<{ id: string; accountId: string; label: string; subject: RuleSubject; level: AccessLevelName; created: boolean }>> {
  const parsed = setAccountRuleSchema.safeParse(input)
  if (!parsed.success) throw invalidInput(parsed.error)
  const { subject, level } = parsed.data
  return inTransaction(db, "setAccountRule", async (sql) => {
    const account = await readAccount({ db, sql }, identity, parsed.data.accountId, ACCESS_LEVELS.manage)
    if (level === "manage") requireAdmin(identity, "grant the manage level")
    await requireSubject(sql, identity, subject)

    const target = { column: "account_id" as const, id: account.id }
    const saved = await saveRule(sql, identity, { target, subject, level }, { context: "setAccountRule", message: accountRulesChanged(account.label) })
    return {
      data: { id: saved.id, accountId: account.id, label: account.label, subject, level, created: saved.created },
      target: `account:${account.label}`,
      teamId: account.teamId,
    }
  })
}

/**
 * Retire une règle d'un compte, à la gestion du compte, comme on la pose. La règle d'un compte que
 * l'appelant ne voit pas est introuvable, comme une règle inconnue (H68). `removeRule` ne vise que les
 * règles d'un nœud : sa route et son écran restent ceux d'E05-S03.
 */
export async function removeAccountRule(db: PlatformDb, identity: Identity, ruleId: unknown): Promise<Mutation<{ id: string; accountId: string; label: string }>> {
  const id = parseId(ruleId, "rule")
  const unknownRule = () => new PlatformError("not_found", `No rule ${id} on an account of ${identity.org.name}.`)
  return inTransaction(db, "removeAccountRule", async (sql) => {
    const [rule] = await sql<{ id: string; account_id: string | null }[]>`select id, account_id from platform.access_rules where id = ${id} and org_id = ${identity.org.id}`
    const ruleAccount = rule?.account_id
    if (!ruleAccount) throw unknownRule()
    const account = await readAccount({ db, sql }, identity, ruleAccount, ACCESS_LEVELS.manage).catch((refusal: unknown) => {
      throw isPlatformError(refusal) && refusal.code === "not_found" ? unknownRule() : refusal
    })
    const deleted = await sql`delete from platform.access_rules where id = ${id} returning id`
    if (deleted.length === 0) throw changedMeanwhile("removeAccountRule", id, accountRulesChanged(account.label))
    return { data: { id, accountId: account.id, label: account.label }, target: `account:${account.label}`, teamId: account.teamId }
  })
}
