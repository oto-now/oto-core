// Équipe porteuse d'un appel (H84, N1, N2) et compte résolu (H83, P37, N3 à N7). Les décisions
// sont pures (`chooseTeam`, `chooseAccount`), testées sans base ; les lectures (journal du `ctx`,
// propriétaire d'un nœud, comptes et niveaux) les précèdent. Sans ce module, `call` (E03-S04)
// n'aurait ni équipe ni compte, et `context` ne dirait pas avec quel compte le modèle écrit. Face SQL
// (E01-S10, lot d1) : chaque lecture dans une transaction `db.tx`, les niveaux d'`access.ts` hors d'elle.
//
// Repris de la maquette (`mcp-test/src/proto/services/call.ts` l. 11-25) : la forme du refus
// « … Ask them for access. » ; retiré : « la première équipe qui a le droit » (H84) et
// `teams.connectors`. Repris d'Oto (`docs\roles-and-resolution.md:42-76`) : un seul ordre écrit, un
// compte nommé introuvable n'a jamais de repli ; retiré : paliers tenant et plateforme, clé membre,
// instance cross-org, compte par défaut `is_default`, axe `_account=` (architecture § 10). Repris
// d'Oto (`oto_mcp\grants_chain.py:19-31, 98-113`) : la règle qui nomme l'appelant prime (déjà dans
// le calcul des niveaux, `accountLevelOf` d'`access-levels.ts`) ; retiré : l'arête « tout le monde »
// et les clés tenant et plateforme.
import { NODE_PATH_PATTERN, nodePathSchema, normalizeTitle, type AccountMode } from "../../schemas"
import { ACCESS_LEVELS, administratorNames, describeOwner, nodeLevels, nodeOwner, type AccessLevel } from "../access"
import type { CatalogFunction, FunctionClass } from "../catalog/define"
import type { PlatformDb } from "../db"
import { memberDirectory } from "../directory"
import { boundedList, inTransaction, PlatformError } from "../errors"
import type { Identity } from "../identity"
import { connectorAccounts, levelName, type AccountOwner, type ConnectorAccount, type LevelName } from "./accounts"
import { consentRefusal, ownAccount, personalOwnerOf } from "./consent-accounts"
import { modeLabel } from "./modes"

/** Lignes du journal du `ctx` relues pour trouver la dernière procédure, les plus récentes d'abord (N11). */
const JOURNAL_LOOKBACK = 50

/**
 * Consigne d'une liste de candidats pour une action (N31) : l'utilisateur choisit, le modèle ne
 * devine pas (mcp-patterns.md § 3 « Résolution par nom », § 4 ; H37).
 */
const ASK_WHICH = "Show them to the user and ask which one to use; do not pick one yourself."

export type TeamRef = { id: string; slug: string; name: string }

export type RunningTeam = TeamRef & { source: "argument" | "table" | "procedure" | "only_team" }

export type ResolvedAccount = {
  id: string
  label: string
  connector: string
  mode: AccountMode
  owner: AccountOwner
  level: LevelName
  source: "named" | "team" | "organisation" | "personal"
}

/** Ce que les décisions lisent d'une fonction du catalogue. */
export type FunctionTraits = Pick<CatalogFunction, "name" | "connector" | "class" | "origin">

export type TeamChoiceInput = {
  fn: FunctionTraits
  /** Les équipes de la personne. */
  teams: readonly TeamRef[]
  /** `call.team` : slug ou nom d'une équipe de la personne, sans casse ni accent (N2). */
  argument?: string
  /** Équipe propriétaire du tableau visé par une fonction `table.*`. */
  tableTeam?: TeamRef | null
  /** Équipe propriétaire de la dernière procédure du `ctx`. */
  procedureTeam?: TeamRef | null
  /** Équipes qui ont un compte actif du connecteur au niveau exigé ; absent pour une fonction sans compte. */
  capable?: ReadonlySet<string>
}

export type TeamChoice =
  | { kind: "team"; team: RunningTeam | null }
  | { kind: "unknown"; wanted: string; teams: TeamRef[] }
  | { kind: "ambiguous"; teams: TeamRef[]; named?: string }

export type AccountChoiceInput = {
  fn: FunctionTraits
  /** Les comptes du connecteur que la personne voit, tous états (`connectorAccounts`). */
  accounts: readonly ConnectorAccount[]
  team: TeamRef | null
  /** `call.account` : libellé (sans casse ni accent) ou identifiant (N3). */
  account?: string
  /**
   * La personne dont le compte personnel porte l'appel d'un connecteur dont chaque personne connecte le sien
   * (consentement, compte rattaché) : sans compte nommé, le sien seul, jamais un autre (`personalOwnerOf`).
   */
  personalOwner?: string
}

export type AccountRefusal =
  | { kind: "unknown_named"; wanted: string; usable: ConnectorAccount[] }
  | { kind: "ambiguous_named"; wanted: string; accounts: ConnectorAccount[] }
  | { kind: "named_below_level"; account: ConnectorAccount }
  | { kind: "named_unavailable"; account: ConnectorAccount }
  | { kind: "ambiguous_step"; team: TeamRef | null; accounts: ConnectorAccount[] }
  | { kind: "below_level"; accounts: ConnectorAccount[] }
  | { kind: "none"; team: TeamRef | null }
  /** Connecteur à comptes personnels : aucun compte de la personne (`account` nul), ou le sien est à reconnecter. */
  | { kind: "connect_needed"; account: ConnectorAccount | null }

export type AccountChoice = { kind: "account"; account: ResolvedAccount } | AccountRefusal

/**
 * Ce que disent les refus qui nomment des personnes : à qui demander (`describeOwner`), les noms
 * des administrateurs, l'origine de l'adresse appelée (lien du tableau de bord).
 */
export type RefusalWords = { orgName: string; administrators: string; origin: string; ask: string }

/** Sans casse, sans accent ni espace de bord (`normalizeTitle`), espaces intérieurs réduits. */
function comparable(text: string): string {
  return normalizeTitle(text).replace(/\s+/g, " ")
}

/** Niveau exigé par la classe (H67) : lecture → 1 ; écriture et sensible → 2. */
export function requiredLevel(fnClass: FunctionClass): AccessLevel {
  return fnClass === "read" ? ACCESS_LEVELS.read : ACCESS_LEVELS.write
}

/** Équipes qui peuvent porter l'appel : un compte actif de l'équipe, au niveau exigé (N1). */
export function capableTeams(accounts: readonly ConnectorAccount[], needed: AccessLevel): Set<string> {
  return new Set(
    accounts.flatMap((account) =>
      account.owner.kind === "team" && account.owner.teamId && account.status === "active" && account.level >= needed
        ? [account.owner.teamId]
        : [],
    ),
  )
}

const bySlug = (teams: readonly TeamRef[]) => [...teams].sort((a, b) => a.slug.localeCompare(b.slug))

function running(team: TeamRef, source: RunningTeam["source"]): TeamChoice {
  return { kind: "team", team: { id: team.id, slug: team.slug, name: team.name, source } }
}

function teamOfArgument(teams: readonly TeamRef[], argument: string): TeamChoice {
  const wanted = argument.trim()
  const key = comparable(wanted)
  const slugged = teams.find((team) => team.slug === key)
  if (slugged) return running(slugged, "argument")
  const named = teams.filter((team) => comparable(team.name) === key)
  if (named.length === 1) return running(named[0], "argument")
  if (named.length > 1) return { kind: "ambiguous", teams: bySlug(named), named: wanted }
  return { kind: "unknown", wanted, teams: bySlug(teams) }
}

/**
 * Équipe porteuse, dans l'ordre de H84 : argument, tableau, dernière procédure ; puis, pour une fonction
 * de connecteur, la seule équipe de la personne qui peut porter l'appel, plusieurs → ambiguïté (la
 * personne dit laquelle), aucune → pas d'équipe (la résolution du compte décide). Une fonction sans compte
 * n'a pas d'équipe et n'est jamais ambiguë. Plus d'équipe par défaut (E05-S13, fiche D128). Jamais « la
 * première équipe qui a le droit ».
 */
export function chooseTeam(input: TeamChoiceInput): TeamChoice {
  if (input.argument !== undefined) return teamOfArgument(input.teams, input.argument)
  if (input.tableTeam) return running(input.tableTeam, "table")
  if (input.procedureTeam) return running(input.procedureTeam, "procedure")
  const none: TeamChoice = { kind: "team", team: null }
  if (input.fn.origin !== "connecteur") return none
  const capable = input.capable ?? new Set<string>()
  const able = bySlug(input.teams.filter((team) => capable.has(team.id)))
  if (able.length === 1) return running(able[0], "only_team")
  if (able.length > 1) return { kind: "ambiguous", teams: able }
  return none
}

const teamList = (teams: readonly TeamRef[]) => boundedList(teams.map((team) => `${team.slug} (${team.name})`))

/**
 * Refus d'un choix d'équipe (AC10, AC13 c, N29) ; les équipes sont triées par slug, 20 au plus dans
 * le texte (N32), toutes dans `details.teams`.
 */
export function teamRefusal(choice: Exclude<TeamChoice, { kind: "team" }>, fnName: string): PlatformError {
  if (choice.kind === "unknown") {
    const yours = choice.teams.length > 0 ? `Your teams: ${teamList(choice.teams)}.` : "You belong to no team."
    return new PlatformError("not_found", `Unknown team ${choice.wanted}. ${yours}`)
  }
  const several = choice.named ? `Several of your teams are named ${choice.named}` : `Several of your teams can run ${fnName}`
  return new PlatformError("ambiguous_team", `${several}: ${teamList(choice.teams)}. ${ASK_WHICH} Then call again with team: "<slug>".`, {
    teams: choice.teams.map(({ slug, name }) => ({ slug, name })),
  })
}

function resolved(account: ConnectorAccount, source: ResolvedAccount["source"]): AccountChoice {
  const { id, label, connector, mode, owner, level } = account
  return { kind: "account", account: { id, label, connector, mode, owner, level: levelName(level), source } }
}

/** Compte nommé (N3) : par identifiant, sinon par libellé sans casse ni accent ; jamais de repli (H83). */
function namedAccount(input: AccountChoiceInput, wanted: string, needed: AccessLevel): AccountChoice {
  const byId = input.accounts.find((account) => account.id === wanted.toLowerCase())
  const found = byId ? [byId] : input.accounts.filter((account) => comparable(account.label) === comparable(wanted))
  if (found.length === 0) {
    const usable = input.accounts.filter((account) => account.status === "active" && account.level >= needed)
    return { kind: "unknown_named", wanted, usable }
  }
  if (found.length > 1) return { kind: "ambiguous_named", wanted, accounts: found }
  if (found[0].level < needed) return { kind: "named_below_level", account: found[0] }
  if (found[0].status !== "active") return { kind: "named_unavailable", account: found[0] }
  return resolved(found[0], "named")
}

/**
 * Compte d'un appel (H83) : le compte nommé, sinon celui de l'équipe porteuse, sinon celui de
 * l'organisation (plus d'étape de slot, P37). À chaque étape, seul compte un compte actif dont le
 * niveau atteint celui de la classe (H67) ; deux à la même étape → ambiguïté, jamais de choix
 * silencieux (N5). Un compte personnel ne sert que nommé, sauf à sa personne celui d'un connecteur dont chaque
 * personne connecte le sien (consentement, compte rattaché) : sans compte nommé, son appel prend le sien
 * (`personalOwner`), jamais un autre ; partagé, il sert aux autres nommé, comme tout compte personnel.
 */
export function chooseAccount(input: AccountChoiceInput): AccountChoice {
  const needed = requiredLevel(input.fn.class)
  if (input.account !== undefined) return namedAccount(input, input.account.trim(), needed)
  if (input.personalOwner !== undefined) return ownAccount(input.accounts, input.personalOwner)
  const { team } = input
  const steps = [
    ...(team ? [input.accounts.filter((account) => account.owner.kind === "team" && account.owner.teamId === team.id)] : []),
    input.accounts.filter((account) => account.owner.kind === "org"),
  ]
  for (const [index, accounts] of steps.entries()) {
    const usable = accounts.filter((account) => account.status === "active" && account.level >= needed)
    const source = team && index === 0 ? "team" : "organisation"
    if (usable.length === 1) return resolved(usable[0], source)
    if (usable.length > 1) return { kind: "ambiguous_step", team: source === "team" ? team : null, accounts: usable }
  }
  const seen = steps.flat().filter((account) => account.status === "active")
  return seen.length > 0 ? { kind: "below_level", accounts: seen } : { kind: "none", team }
}

const mention = (account: ConnectorAccount) => `« ${account.label} » (${account.owner.description}, ${modeLabel(account.mode)})`

/**
 * Texte et code d'un refus de compte (AC15, AC16), une fois connus ceux à qui demander ; 20
 * comptes nommés au plus (N32), consigne de demander à l'utilisateur sur une ambiguïté (N31).
 */
export function accountRefusal(refusal: AccountRefusal, fn: FunctionTraits, words: RefusalWords): PlatformError {
  const needs = levelName(requiredLevel(fn.class))
  switch (refusal.kind) {
    case "unknown_named": {
      const usable = boundedList(refusal.usable.map(mention)) || "none"
      return new PlatformError(
        "not_found",
        `Unknown account « ${refusal.wanted} » for ${fn.connector}. Accounts you can use: ${usable}. No other account was tried.`,
      )
    }
    case "ambiguous_named": {
      const named = boundedList(refusal.accounts.map((account) => `« ${account.label} » (${account.owner.description}, id ${account.id})`))
      return new PlatformError(
        "ambiguous_account",
        `Several ${fn.connector} accounts are named « ${refusal.wanted} »: ${named}. ${ASK_WHICH} Then call again with account: "<id>".`,
      )
    }
    case "named_below_level":
      return new PlatformError(
        "forbidden",
        `Account « ${refusal.account.label} » cannot run ${fn.name} for you (${needs} access needed). Ask ${words.ask} for access.`,
      )
    case "named_unavailable":
      return new PlatformError(
        "not_enabled",
        refusal.account.status === "error"
          ? `Account « ${refusal.account.label} » is in error. Ask ${words.ask} to fix it, or name another account.`
          : `Account « ${refusal.account.label} » is disabled. Ask ${words.ask} to enable it, or name another account.`,
      )
    case "ambiguous_step": {
      const personal = refusal.accounts.every((account) => account.owner.kind === "user")
      const whose = refusal.team ? `of team ${refusal.team.name}` : personal ? "of yours" : "of the organisation"
      const labels = boundedList(refusal.accounts.map((account) => `« ${account.label} »`))
      return new PlatformError(
        "ambiguous_account",
        `Several ${fn.connector} accounts ${whose} can run ${fn.name}: ${labels}. ${ASK_WHICH} Then call again with account: "<label>".`,
      )
    }
    case "below_level": {
      const seen = boundedList(
        refusal.accounts.map((account) => `« ${account.label} » (${account.owner.description}, ${levelName(account.level)} for you)`),
      )
      return new PlatformError(
        "forbidden",
        `${fn.name} needs ${needs} access to a ${fn.connector} account. Accounts you can see but not use this way: ${seen}. Ask ${words.ask} for access.`,
      )
    }
    case "none": {
      const steps = refusal.team ? `team ${refusal.team.name}, then the organisation` : "the organisation"
      const names = words.administrators ? ` (${words.administrators})` : ""
      return new PlatformError(
        "not_enabled",
        `No ${fn.connector} account is connected for you (${steps}). Ask an administrator of ${words.orgName}${names} to connect one on the dashboard: ${words.origin}/admin/connectors.`,
      )
    }
    case "connect_needed":
      return consentRefusal(fn.connector, refusal.account)
  }
}


/**
 * Qui gère les comptes d'un refus (`describeOwner`, une fois par propriétaire : deux au plus, l'équipe
 * porteuse et l'organisation, les étapes de `chooseAccount`) ; administrateurs nommés si aucun compte.
 */
async function refusalWords(db: PlatformDb, identity: Identity, refusal: AccountRefusal, origin: string): Promise<RefusalWords> {
  const accounts =
    refusal.kind === "named_below_level" || refusal.kind === "named_unavailable"
      ? [refusal.account]
      : refusal.kind === "below_level"
        ? refusal.accounts
        : []
  const owners = [...new Map(accounts.map((account) => [JSON.stringify([account.owner.kind, account.owner.teamId, account.owner.userId]), account.owner])).values()]
  const [asks, administrators] = await Promise.all([
    Promise.all(owners.map((owner) => describeOwner(db, identity, owner))),
    refusal.kind === "none" ? memberDirectory(db, identity.org.id).then(administratorNames) : Promise.resolve(""),
  ])
  return { orgName: identity.org.name, administrators, origin, ask: boundedList([...new Set(asks)], " or ") }
}

/**
 * Compte d'un appel à une fonction de connecteur (H83) : les comptes visibles du connecteur, la
 * décision de `chooseAccount`, et un refus qui dit à qui demander. Une fonction sans compte
 * (`table.*`, ERP) n'est pas résolue : son appelant ne l'appelle pas (E03-S04).
 */
export async function resolveAccount(
  db: PlatformDb,
  identity: Identity,
  input: { fn: FunctionTraits; team: TeamRef | null; account?: string; origin: string },
): Promise<ResolvedAccount> {
  const accounts = await connectorAccounts(db, identity, input.fn.connector)
  const choice = chooseAccount({ fn: input.fn, accounts, team: input.team, account: input.account, personalOwner: personalOwnerOf(input.fn.connector, identity) })
  if (choice.kind === "account") return choice.account
  throw accountRefusal(choice, input.fn, await refusalWords(db, identity, choice, input.origin))
}

/** Équipe propriétaire effective d'un nœud (`node_owner`), si c'est une équipe. */
async function ownerTeam(db: PlatformDb, identity: Identity, nodeId: string): Promise<TeamRef | null> {
  const owner = await nodeOwner(db, nodeId)
  if (owner?.kind !== "team" || !owner.teamId) return null
  const mine = identity.teams.find((team) => team.id === owner.teamId)
  if (mine) return { id: mine.id, slug: mine.slug, name: mine.name }
  const teamId = owner.teamId
  const [team] = await inTransaction(
    db,
    "runningTeam: teams",
    (sql) => sql<TeamRef[]>`select id, slug, name from platform.teams where id = ${teamId} and org_id = ${identity.org.id}`,
  )
  return team ?? null
}

/** Les nœuds de `nodes` que la personne lit (niveau 1 au moins), décidé ici (E01-S07 AC23). */
async function readable<Node extends { id: string }>(db: PlatformDb, identity: Identity, nodes: readonly Node[]): Promise<Node[]> {
  const levels = await nodeLevels(db, identity, nodes.map((node) => node.id))
  return nodes.filter((node) => (levels.get(node.id) ?? ACCESS_LEVELS.none) >= ACCESS_LEVELS.read)
}

/** Tableau visible à ce chemin : son équipe propriétaire ; un chemin invisible ou d'un autre type ne décide pas. */
async function tableTeam(db: PlatformDb, identity: Identity, tablePath: string): Promise<TeamRef | null> {
  const path = nodePathSchema.safeParse(tablePath)
  if (!path.success) return null
  const [node] = await inTransaction(
    db,
    "runningTeam: nodes",
    (sql) => sql<{ id: string }[]>`select id from platform.nodes where org_id = ${identity.org.id} and path = ${path.data} and kind = 'table'`,
  )
  const [table] = node ? await readable(db, identity, [node]) : []
  return table ? ownerTeam(db, identity, table.id) : null
}

/**
 * Dernière procédure du `ctx` (N11) : parmi les lignes `<p>_context` et `<p>_read` réussies de la
 * personne sous ce code, la plus récente dont la cible est une procédure qu'elle voit. Une ligne
 * pas encore écrite (le journal part après la réponse, H07) n'est pas vue.
 */
export async function lastProcedure(db: PlatformDb, identity: Identity, ctxCode: string): Promise<{ id: string; path: string } | null> {
  const orgId = identity.org.id
  const prefix = identity.org.prefix
  const lines = await inTransaction(db, "lastProcedure: journal", (sql) => sql<{ target: string | null }[]>`
    select target from platform.journal where org_id = ${orgId} and user_id = ${identity.user.id} and ctx = ${ctxCode}
       and tool in (${`${prefix}_context`}, ${`${prefix}_read`}) and is_error = false and target is not null
     order by ts desc, id desc limit ${JOURNAL_LOOKBACK}`)
  // Une cible de `context` peut être une phrase : seuls les chemins partent dans la liste lue (`path =
  // any`), les plus récents d'abord. Une liste liée n'a pas la borne de l'adresse de PostgREST (N22,
  // retirée avec sa face, E01-S10 f2) : `JOURNAL_LOOKBACK` borne les lignes lues.
  const paths: string[] = []
  for (const { target } of lines) {
    if (!target || !NODE_PATH_PATTERN.test(target) || paths.includes(target)) continue
    paths.push(target)
  }
  if (paths.length === 0) return null
  const nodes = await inTransaction(
    db,
    "lastProcedure: nodes",
    (sql) => sql<{ id: string; path: string }[]>`select id, path from platform.nodes where org_id = ${orgId} and kind = 'procedure' and path = any(${paths})`,
  )
  const byPath = new Map((await readable(db, identity, nodes)).map((node) => [node.path, node]))
  return paths.map((path) => byPath.get(path)).find((node) => node !== undefined) ?? null
}

/**
 * Équipe porteuse d'un appel (H84, N1) : ne lit que ce que l'ordre demande (tableau, puis journal
 * du `ctx`, puis comptes pour une fonction de connecteur), puis décide par `chooseTeam`. `null` :
 * aucune équipe ne porte l'appel. Refus : `not_found` (équipe inconnue), `ambiguous_team`.
 */
export async function runningTeam(
  db: PlatformDb,
  identity: Identity,
  input: { fn: FunctionTraits; team?: string; tablePath?: string; ctxCode: string | null },
): Promise<RunningTeam | null> {
  const choice: TeamChoiceInput = {
    fn: input.fn,
    teams: identity.teams.map(({ id, slug, name }) => ({ id, slug, name })),
    argument: input.team,
  }
  if (input.team === undefined) {
    choice.tableTeam = input.tablePath ? await tableTeam(db, identity, input.tablePath) : null
    const procedure = !choice.tableTeam && input.ctxCode ? await lastProcedure(db, identity, input.ctxCode) : null
    choice.procedureTeam = procedure ? await ownerTeam(db, identity, procedure.id) : null
    if (!choice.tableTeam && !choice.procedureTeam && input.fn.origin === "connecteur") {
      choice.capable = capableTeams(await connectorAccounts(db, identity, input.fn.connector), requiredLevel(input.fn.class))
    }
  }
  const decided = chooseTeam(choice)
  if (decided.kind !== "team") throw teamRefusal(decided, input.fn.name)
  return decided.team
}
