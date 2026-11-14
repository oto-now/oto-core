// Activation des connecteurs par organisation (H81, FR-ADMIN-02) : lister, activer, désactiver, et
// l'ensemble des connecteurs actifs, lu à chaque appel, sans cache (effet immédiat, N9). Sans ce
// module, rien n'ouvre un connecteur chez un client : ses fonctions n'existeraient pour personne.
// Face SQL (E01-S10, lot d1) : chaque opération dans une transaction `db.tx`, sous l'appelant ; les
// lectures d'`access.ts` et de l'annuaire se font hors d'elle.
//
// Repris d'Oto : rien. Retiré : l'activation « prochaine session » et les kits (architecture § 10).
import { connectorRefSchema, type DeactivationImpact, type OrgConnector } from "../../schemas"
import { ACCESS_LEVELS, accountLevels, administratorNames, administrators, isOrgAdmin, nodeLevels, type AccessLevel, type AccountLevel } from "../access"
import type { CatalogFunction } from "../catalog/define"
import { declaredConnector } from "../catalog/connector-source"
import { ACT_SUFFIX, catalogFunctions, NATIVE_CONNECTOR } from "../catalog/registry"
import type { PlatformDb } from "../db"
import { memberDirectory, type DirectoryEntry } from "../directory"
import { boundedList, inTransaction, invalidInput, PlatformError } from "../errors"
import type { Identity } from "../identity"
import { isJsonObject } from "../json"
import { orgLimits, requireUnderLimit, type LimitScope } from "../limits"
import type { Tx } from "../sql"
import { keepDeclaredConnector } from "./declaration"

/** Une ligne d'activation ; `updated_at` lu par `to_json`, en texte ISO comme PostgREST le rendait (AC-x2). */
type ActivationRow = { connector: string; state: string; activated_by: string | null; updated_at: string }

/**
 * Les connecteurs qui demandent une activation (origine `connecteur`, H81), triés par nom,
 * avec leurs fonctions. `table` et les fonctions ERP n'y sont jamais : ils sont toujours actifs.
 */
export function activableConnectors(functions: readonly CatalogFunction[]): Map<string, CatalogFunction[]> {
  const byConnector = new Map<string, CatalogFunction[]>()
  for (const fn of functions) {
    if (fn.origin === "connecteur") byConnector.set(fn.connector, [...(byConnector.get(fn.connector) ?? []), fn])
  }
  return new Map([...byConnector.entries()].sort(([a], [b]) => a.localeCompare(b)))
}

/**
 * Les fonctions du connecteur nommé s'il s'active ; sinon `invalid_arguments` pour un connecteur
 * natif ou ERP, `not_found` pour un nom inconnu, qui liste les connecteurs activables, 20 au plus
 * (AC2, N32).
 */
export function requireActivable(connector: string, functions: readonly CatalogFunction[]): CatalogFunction[] {
  const activable = activableConnectors(functions)
  const found = activable.get(connector)
  if (found) return found
  if (connector === NATIVE_CONNECTOR || functions.some((fn) => fn.connector === connector)) {
    throw new PlatformError("invalid_arguments", `${connector} is built in: it is always active and has no accounts.`)
  }
  const names = boundedList([...activable.keys()]) || "none"
  throw new PlatformError("not_found", `Unknown connector ${connector}. Connectors you can activate: ${names}.`)
}

/** Connecteurs actifs de l'organisation, relus à chaque appel : l'activation vaut tout de suite (N9). */
export async function loadActiveConnectors(db: PlatformDb, orgId: string): Promise<Set<string>> {
  const rows = await inTransaction(
    db,
    "loadActiveConnectors: connector_activations",
    (sql) => sql<{ connector: string }[]>`select connector from platform.connector_activations where org_id = ${orgId} and state = 'active'`,
  )
  return new Set(rows.map((row) => row.connector))
}

/** La ligne d'activation du connecteur dans l'organisation (clé `org_id, connector`), ou `null`. */
async function activationRow(sql: Tx, orgId: string, connector: string): Promise<ActivationRow | null> {
  const [row] = await sql<ActivationRow[]>`
    select connector, state, activated_by, to_json(updated_at) as updated_at
      from platform.connector_activations
     where org_id = ${orgId} and connector = ${connector}`
  return row ?? null
}

/**
 * La ligne d'un connecteur. `activated_by` nomme qui a posé l'état de la ligne : qui l'a activé, ou, la ligne fermée,
 * qui l'a désactivé (`closedBy`).
 */
function connectorView(
  connector: string,
  functions: readonly CatalogFunction[],
  row: ActivationRow | null,
  directory: DirectoryEntry[],
): OrgConnector {
  const active = row?.state === "active"
  const person = (userId: string | null) => (userId ? { userId, name: directory.find((entry) => entry.userId === userId)?.name ?? null } : null)
  return {
    connector,
    label: declaredConnector(connector)?.definition.label ?? connector,
    state: active ? "active" : "inactive",
    activatedAt: active ? row.updated_at : null,
    activatedBy: active ? person(row.activated_by) : null,
    functions: functions.map((fn) => ({ name: fn.name, class: fn.class })).sort((a, b) => a.name.localeCompare(b.name)),
    closedBy: row !== null && !active ? person(row.activated_by) : null,
  }
}

/**
 * Chaque connecteur activable du catalogue avec son état (`inactive` sans ligne), qui l'a activé et
 * quand, et ses fonctions (AC3). Catalogue sans connecteur activable : liste vide, sans lecture.
 */
export async function listConnectorsForOrg(db: PlatformDb, identity: Identity): Promise<OrgConnector[]> {
  const activable = activableConnectors(catalogFunctions())
  if (activable.size === 0) return []
  const [rows, directory] = await Promise.all([
    inTransaction(db, "listConnectorsForOrg: connector_activations", (sql) => sql<ActivationRow[]>`
        select connector, state, activated_by, to_json(updated_at) as updated_at
          from platform.connector_activations
         where org_id = ${identity.org.id}`),
    memberDirectory(db, identity.org.id),
  ])
  return [...activable.entries()].map(([connector, functions]) =>
    connectorView(connector, functions, rows.find((row) => row.connector === connector) ?? null, directory),
  )
}

/** Refus d'activer ou de désactiver (AC2), qui nomme les administrateurs. */
async function reservedToAdministrators(db: PlatformDb, identity: Identity): Promise<PlatformError> {
  const names = administratorNames(await memberDirectory(db, identity.org.id))
  const who = names ? `its administrators (${names})` : "its administrators"
  return new PlatformError("forbidden", `Activating or deactivating connectors at ${identity.org.name} is reserved to ${who}.`)
}

/**
 * Connecteur visé et droit de l'appelant, dans l'ordre : Zod, catalogue, administrateur (AC2 ;
 * `isOrgAdmin`, décidé avant toute écriture, E01-S07 AC23).
 */
async function checkedConnector(db: PlatformDb, identity: Identity, input: unknown) {
  const parsed = connectorRefSchema.safeParse(input)
  if (!parsed.success) throw invalidInput(parsed.error)
  const { connector } = parsed.data
  const functions = requireActivable(connector, catalogFunctions())
  if (!isOrgAdmin(identity)) throw await reservedToAdministrators(db, identity)
  return { connector, functions }
}

/**
 * Active un connecteur (administrateur). Déjà actif : rien n'est écrit, la date d'activation reste ;
 * sinon la ligne est créée ou repassée à `active`, au nom de l'appelant (AC1).
 */
export async function activateConnector(db: PlatformDb, identity: Identity, input: unknown): Promise<OrgConnector> {
  const { connector, functions } = await checkedConnector(db, identity, input)
  const orgId = identity.org.id
  const limits = await orgLimits(identity.org)
  // La ligne lue, puis écrite si elle n'est pas active, dans la même transaction ; un connecteur déjà actif ne compte
  // pas contre `connectors_max` (E12-S02, AC-5).
  const row = await inTransaction(db, "activateConnector: connector_activations", async (sql) => {
    const current = await activationRow(sql, orgId, connector)
    if (current?.state === "active") return current
    await requireUnderLimit(sql, { db, identity, limits }, "connectors_max")
    await keepDeclaredConnector(sql, connector)
    const [written] = await sql<ActivationRow[]>`
      insert into platform.connector_activations (org_id, connector, state, activated_by)
      values (${orgId}, ${connector}, 'active', ${identity.user.id})
      on conflict (org_id, connector) do update set state = excluded.state, activated_by = excluded.activated_by
      returning connector, state, activated_by, to_json(updated_at) as updated_at`
    return written
  }, "server")
  return connectorView(connector, functions, row, await memberDirectory(db, orgId))
}

/**
 * Désactive un connecteur (administrateur) : ses fonctions cessent aussitôt de répondre ; ses
 * comptes restent, ils reviennent à la réactivation (N13). Jamais activé : rien à écrire. La ligne fermée nomme qui
 * l'a fermée (`activated_by`, lu en `closedBy`) : un membre ne la rouvre pas par l'ajout d'un compte.
 */
export async function deactivateConnector(db: PlatformDb, identity: Identity, input: unknown): Promise<OrgConnector> {
  const { connector, functions } = await checkedConnector(db, identity, input)
  const orgId = identity.org.id
  const { stillActive, closed } = await inTransaction(db, "deactivateConnector: connector_activations", async (sql) => {
    const changed = await sql<ActivationRow[]>`
      update platform.connector_activations set state = 'inactive', activated_by = ${identity.user.id}
       where org_id = ${orgId} and connector = ${connector} and state = 'active'
      returning connector, state, activated_by, to_json(updated_at) as updated_at`
    // Aucune ligne changée : jamais activé ou déjà inactif, rien à écrire ; encore actif, l'écriture n'a
    // pas eu lieu après la décision (course, ou garde-fou de la base) : un conflit (HN-E01S07-6).
    const current = changed[0] ?? (await activationRow(sql, orgId, connector))
    return { stillActive: changed.length === 0 && current?.state === "active", closed: current }
  })
  if (stillActive) {
    console.error(`[platform] deactivateConnector: ${connector} still active after the update`)
    throw new PlatformError("conflict", `Connector ${connector} at ${identity.org.name} changed meanwhile. Reload it and retry.`)
  }
  return connectorView(connector, functions, closed, closed ? await memberDirectory(db, orgId) : [])
}

/**
 * Ouvre le connecteur d'un compte qui s'ajoute ou se réactive, dans la transaction qui l'écrit (activation implicite,
 * `connecteurs-et-comptes.md` § Écran Connecteurs) : actif, rien ; jamais activé, activé au nom de l'appelant, compté
 * contre `connectors_max` comme `activateConnector` ; fermé par un administrateur (une ligne `inactive`), `closed` :
 * rien n'est écrit, et l'appelant refuse par `closedConnector`, hors de la transaction.
 */
export async function openConnectorForAccount(sql: Tx, scope: LimitScope, connector: string): Promise<"open" | "closed"> {
  const { identity } = scope
  const current = await activationRow(sql, identity.org.id, connector)
  if (current?.state === "active") return "open"
  if (current) return "closed"
  await requireUnderLimit(sql, scope, "connectors_max")
  await keepDeclaredConnector(sql, connector)
  await sql`
    insert into platform.connector_activations (org_id, connector, state, activated_by)
    values (${identity.org.id}, ${connector}, 'active', ${identity.user.id})`
  return "open"
}

/** Vrai quand un administrateur a fermé le connecteur dans l'organisation (une ligne `inactive`), lu sous l'appelant. */
export async function isConnectorClosed(db: PlatformDb, identity: Identity, connector: string): Promise<boolean> {
  const row = await inTransaction(db, "isConnectorClosed: connector_activations", (sql) => activationRow(sql, identity.org.id, connector))
  return row !== null && row.state !== "active"
}

/** Le refus d'un connecteur fermé par un administrateur (`not_enabled`, `reason: "closed"`), qui nomme les administrateurs. */
export async function closedConnector(db: PlatformDb, identity: Identity, connector: string): Promise<PlatformError> {
  const directory = await memberDirectory(db, identity.org.id)
  const admins = directory
    .filter((person) => person.role === "admin")
    .map((person) => ({ userId: person.userId, name: person.name }))
    .sort((a, b) => a.name.localeCompare(b.name, "fr"))
  return new PlatformError(
    "not_enabled",
    `${connector} is deactivated at ${identity.org.name}: no account can be added or enabled. Ask ${administrators(identity, directory)} to activate it.`,
    { reason: "closed", administrators: admins },
  )
}

/**
 * Un bloc `call` qui appelle une fonction du connecteur : le préfixe `<connecteur>.` ou `<connecteur>_act.` comparé tel
 * quel, jamais par `like`, dont `_` est un joker.
 */
function callsConnector(data: unknown, connector: string): boolean {
  if (!isJsonObject(data) || typeof data.function !== "string") return false
  return data.function.startsWith(`${connector}.`) || data.function.startsWith(`${connector}${ACT_SUFFIX}.`)
}

/** Lu au niveau 1 au moins : la lecture a le même rang sur l'échelle des nœuds et sur celle des comptes. */
const readable = (level: AccessLevel | AccountLevel | undefined) => (level ?? ACCESS_LEVELS.none) >= ACCESS_LEVELS.read

/**
 * Ce que coûte la désactivation d'un connecteur activable (E08-S03, AC5, AC11 ; `admin_connector`
 * d'E08-S06) : ses fonctions ; les procédures publiées dont un bloc `call` publié appelle l'une d'elles
 * (les blocs d'un brouillon sont exclus par la requête), avec leur chemin ; le nombre de ses comptes.
 * Blocs et comptes se lisent dans une transaction, toutes leurs lignes ; une procédure ou un compte de
 * niveau 0 pour l'appelant est retiré par le service, en un lot (`nodeLevels`, `accountLevels`), jamais
 * par la RLS (H123) : ni nommé, ni compté. Un connecteur inconnu ou natif est refusé comme à l'activation.
 */
export async function deactivationImpact(db: PlatformDb, identity: Identity, connector: string): Promise<DeactivationImpact> {
  const functions = requireActivable(connector, catalogFunctions())
  const orgId = identity.org.id
  const { blocks, accounts } = await inTransaction(db, "deactivationImpact: blocks, accounts", async (sql) => ({
    blocks: await sql<{ data: unknown; node_id: string; path: string }[]>`
      select b.data, n.id as node_id, n.path
        from platform.blocks b join platform.nodes n on n.id = b.node_id
       where b.org_id = ${orgId} and b.state = 'published' and b.type = 'call'
         and n.kind = 'procedure' and n.status = 'published'`,
    accounts: await sql<{ id: string }[]>`select id from platform.accounts where org_id = ${orgId} and connector = ${connector}`,
  }))
  const calling = new Map(blocks.filter((block) => callsConnector(block.data, connector)).map((block) => [block.node_id, block.path]))
  const [nodeLevel, accountLevel] = await Promise.all([
    nodeLevels(db, identity, [...calling.keys()]),
    accountLevels(db, identity, accounts.map((account) => account.id)),
  ])
  return {
    functions: functions.map((fn) => fn.name).sort(),
    procedures: [...calling].flatMap(([id, path]) => (readable(nodeLevel.get(id)) ? [path] : [])).sort(),
    accounts: accounts.filter((account) => readable(accountLevel.get(account.id))).length,
  }
}
