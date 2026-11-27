// Les connecteurs privés d'une organisation (`connecteurs-prives.md` § Stockage et § Service) : leur lecture, par les
// membres, et leur écriture, réservée à l'équipe plateforme. Un contrôle à blanc (`checkPrivateConnector`) rend tous les
// problèmes d'une définition sans rien écrire ; un enregistrement (`savePrivateConnector`) la contrôle de même et, refusée,
// laisse servie la version précédente ; acceptée, une version s'ajoute et devient celle servie. Un retrait
// (`removePrivateConnector`) cesse de servir le connecteur, son historique gardé ; un retour (`restorePrivateConnector`)
// réenregistre une version passée, contrôlée à nouveau, comme une version neuve. Les écritures passent sous le rôle du
// serveur, une fois le droit décidé ici. Sans ce module, aucune organisation n'aurait de connecteur décrit en données.
import { randomBytes } from "node:crypto"
import type { PlatformDb } from "../db"
import { inTransaction, PlatformError } from "../errors"
import { reservedNamespaces } from "../host-api/served"
import type { Identity } from "../identity"
import { isJsonObject } from "../json"
import type { Tx } from "../sql"
import { privateConnectorProblems, type PrivateConnectorProblem } from "./validation"

/** Une version d'un connecteur privé : son numéro, sa date, et la version qu'elle reprend (un retour). */
export type PrivateConnectorVersion = { version: number; savedAt: string; restoredFrom: number | null }

/** Un connecteur privé, tel que l'administration le montre : la version servie et son document, ou retiré. */
export type PrivateConnectorView = {
  /** La clé interne (`custom_<8 hex>`), jamais montrée à un assistant. */
  key: string
  namespace: string
  label: string
  version: number
  savedAt: string
  removedAt: string | null
  functions: number
  document: Record<string, unknown>
}

/** Un connecteur privé et ses versions, de la plus récente à la plus ancienne. */
export type PrivateConnectorDetail = PrivateConnectorView & { versions: PrivateConnectorVersion[] }

/** Ce qu'a donné un contrôle à blanc : l'espace servi lu dans la définition, ses problèmes, et ce qui est servi sous lui. */
export type PrivateConnectorCheck = { namespace: string | null; problems: PrivateConnectorProblem[]; current: PrivateConnectorView | null }

/** Ce qu'a donné un enregistrement ou un retour : une version neuve, rien à changer (déjà servie), ou un refus nommé. */
export type PrivateConnectorOutcome =
  | { kind: "saved" | "unchanged"; view: PrivateConnectorView }
  | { kind: "refused"; problems: PrivateConnectorProblem[]; current: PrivateConnectorView | null }

/** Le refus d'une écriture par qui n'est pas de l'équipe plateforme ; le contrat de l'administration le cite. */
export const PRIVATE_CONNECTOR_FORBIDDEN = "Writing a private connector is reserved to the platform team."

type ViewRow = { name: string; namespace: string; version: number; saved_at: string; removed_at: string | null; document: Record<string, unknown> }

const VIEW_COLUMNS = `c.name, c.namespace, c.version, to_json(v.created_at)#>>'{}' as saved_at, to_json(c.removed_at)#>>'{}' as removed_at, v.document`

function viewOf(row: ViewRow): PrivateConnectorView {
  const connector = isJsonObject(row.document.connector) ? row.document.connector : {}
  const functions = Array.isArray(row.document.functions) ? row.document.functions.length : 0
  return {
    key: row.name,
    namespace: row.namespace,
    label: typeof connector.label === "string" ? connector.label : row.namespace,
    version: row.version,
    savedAt: row.saved_at,
    removedAt: row.removed_at,
    functions,
    document: row.document,
  }
}

function requirePlatformTeam(identity: Identity): void {
  if (!identity.isStaff) throw new PlatformError("forbidden", PRIVATE_CONNECTOR_FORBIDDEN)
}

/** L'espace servi qu'une définition nomme (`connector.name`), ou `null`. */
function namespaceOf(document: unknown): string | null {
  return isJsonObject(document) && isJsonObject(document.connector) && typeof document.connector.name === "string" ? document.connector.name : null
}

async function rowOf(sql: Tx, orgId: string, namespace: string): Promise<ViewRow | null> {
  const [row] = await sql<ViewRow[]>`
    select ${sql.unsafe(VIEW_COLUMNS)}
      from platform.private_connectors c
      join platform.private_connector_versions v on v.private_connector_id = c.id and v.version = c.version
     where c.org_id = ${orgId} and c.namespace = ${namespace}`
  return row ?? null
}

/** Les connecteurs privés de l'organisation, servis ou retirés, par espace. */
export async function listPrivateConnectors(db: PlatformDb, identity: Identity): Promise<PrivateConnectorView[]> {
  const rows = await inTransaction(db, "listPrivateConnectors", (sql) => sql<ViewRow[]>`
    select ${sql.unsafe(VIEW_COLUMNS)}
      from platform.private_connectors c
      join platform.private_connector_versions v on v.private_connector_id = c.id and v.version = c.version
     where c.org_id = ${identity.org.id}
     order by c.namespace`)
  return rows.map(viewOf)
}

/**
 * Un connecteur privé de l'organisation et ses versions ; `version` : le document de cette version-là au lieu de celui
 * servi. Refus : aucun connecteur sous cet espace, ou aucune telle version (`not_found`).
 */
export async function readPrivateConnector(db: PlatformDb, identity: Identity, namespace: string, version?: number): Promise<PrivateConnectorDetail> {
  return inTransaction(db, "readPrivateConnector", async (sql) => {
    const row = await rowOf(sql, identity.org.id, namespace)
    if (!row) throw new PlatformError("not_found", `No private connector ${namespace} in this organisation.`)
    const versions = await sql<(PrivateConnectorVersion & { document: Record<string, unknown> })[]>`
      select v.version, to_json(v.created_at)#>>'{}' as "savedAt", v.restored_from as "restoredFrom", v.document
        from platform.private_connector_versions v join platform.private_connectors c on c.id = v.private_connector_id
       where c.org_id = ${identity.org.id} and c.namespace = ${namespace}
       order by v.version desc`
    const shown = version === undefined ? row : versions.find((item) => item.version === version)
    if (!shown) throw new PlatformError("not_found", `${namespace} has no version ${version}.`)
    return {
      ...viewOf(row),
      document: shown.document,
      versions: versions.map(({ version: number, savedAt, restoredFrom }) => ({ version: number, savedAt, restoredFrom })),
    }
  })
}

/** Les problèmes d'une définition et ce qui est servi sous son espace, lus sous la session de qui appelle. */
async function judged(db: PlatformDb, identity: Identity, document: unknown): Promise<PrivateConnectorCheck> {
  const namespace = namespaceOf(document)
  const problems = await privateConnectorProblems(document, reservedNamespaces())
  const current = namespace ? await inTransaction(db, "checkPrivateConnector: current", (sql) => rowOf(sql, identity.org.id, namespace)) : null
  return { namespace, problems, current: current ? viewOf(current) : null }
}

/**
 * Le contrôle à blanc d'une définition, réservé à l'équipe plateforme : tous ses problèmes, et le connecteur servi
 * aujourd'hui sous son espace ; rien n'est écrit.
 */
export async function checkPrivateConnector(db: PlatformDb, identity: Identity, document: unknown): Promise<PrivateConnectorCheck> {
  requirePlatformTeam(identity)
  return judged(db, identity, document)
}

/**
 * Écrit une version acceptée, sous le rôle du serveur : le connecteur neuf reçoit sa clé interne et sa version 1 ; un
 * connecteur existant (servi ou retiré) monte d'une version et redevient servi. Le même document déjà servi ne change
 * rien. Deux enregistrements simultanés d'un même connecteur neuf : le second est refusé (`conflict`).
 */
/** Une version à écrire : son espace, son document, la version qu'elle reprend (`null` : un enregistrement). */
type Written = { namespace: string; document: Record<string, unknown>; restoredFrom: number | null }

async function writeVersion(db: PlatformDb, identity: Identity, { namespace, document, restoredFrom }: Written): Promise<PrivateConnectorOutcome> {
  const orgId = identity.org.id
  const kind = await inTransaction(
    db,
    "savePrivateConnector",
    async (sql) => {
      const [held] = await sql<{ id: string; version: number; removed: boolean }[]>`
        select id, version, removed_at is not null as removed from platform.private_connectors
         where org_id = ${orgId} and namespace = ${namespace} for update`
      if (!held) {
        const key = `custom_${randomBytes(4).toString("hex")}`
        const [created] = await sql<{ id: string }[]>`
          insert into platform.private_connectors (org_id, name, namespace, version) values (${orgId}, ${key}, ${namespace}, 1) returning id`
        await sql`insert into platform.private_connector_versions (private_connector_id, org_id, version, document) values (${created.id}, ${orgId}, 1, ${sql.json(document as never)})`
        return "saved" as const
      }
      const [served] = await sql<{ same: boolean }[]>`
        select document = ${sql.json(document as never)} as same from platform.private_connector_versions
         where private_connector_id = ${held.id} and version = ${held.version}`
      if (served?.same && !held.removed) return "unchanged" as const
      const next = held.version + 1
      await sql`
        insert into platform.private_connector_versions (private_connector_id, org_id, version, document, restored_from)
        values (${held.id}, ${orgId}, ${next}, ${sql.json(document as never)}, ${restoredFrom})`
      await sql`update platform.private_connectors set version = ${next}, removed_at = null where id = ${held.id}`
      return "saved" as const
    },
    "server",
  )
  const row = await inTransaction(db, "savePrivateConnector: view", (sql) => rowOf(sql, orgId, namespace))
  if (!row) throw new PlatformError("internal", "Internal error.")
  return { kind, view: viewOf(row) }
}

/**
 * Enregistre une définition, réservé à l'équipe plateforme : contrôlée d'abord (`checkPrivateConnector`) ; refusée, rien
 * n'est écrit et la version précédente reste servie ; acceptée, elle devient la version servie de son espace.
 */
export async function savePrivateConnector(db: PlatformDb, identity: Identity, document: unknown): Promise<PrivateConnectorOutcome> {
  const checked = await checkPrivateConnector(db, identity, document)
  if (checked.problems.length > 0 || !checked.namespace || !isJsonObject(document)) {
    return { kind: "refused", problems: checked.problems, current: checked.current }
  }
  return writeVersion(db, identity, { namespace: checked.namespace, document, restoredFrom: null })
}

/**
 * Le retour à une version passée, réservé à l'équipe plateforme : son document, contrôlé à nouveau (l'instance a pu
 * changer depuis), devient une version neuve qui la nomme (`restoredFrom`). Refus : connecteur ou version inconnus
 * (`not_found`) ; une version refusée aujourd'hui rend ses problèmes, rien n'est écrit.
 */
export async function restorePrivateConnector(db: PlatformDb, identity: Identity, namespace: string, version: number): Promise<PrivateConnectorOutcome> {
  requirePlatformTeam(identity)
  const detail = await readPrivateConnector(db, identity, namespace, version)
  const checked = await judged(db, identity, detail.document)
  if (checked.problems.length > 0) return { kind: "refused", problems: checked.problems, current: checked.current }
  if (version === detail.version && !detail.removedAt) return { kind: "unchanged", view: detail }
  return writeVersion(db, identity, { namespace, document: detail.document, restoredFrom: version })
}

/**
 * Retire un connecteur privé, réservé à l'équipe plateforme : il cesse d'être servi, sa clé et ses versions restent ; un
 * enregistrement ou un retour sous le même espace le rouvre. Refus : aucun connecteur servi sous cet espace (`not_found`).
 */
export async function removePrivateConnector(db: PlatformDb, identity: Identity, namespace: string): Promise<PrivateConnectorView> {
  requirePlatformTeam(identity)
  const orgId = identity.org.id
  const removed = await inTransaction(
    db,
    "removePrivateConnector",
    (sql) => sql`update platform.private_connectors set removed_at = now() where org_id = ${orgId} and namespace = ${namespace} and removed_at is null returning id`,
    "server",
  )
  if (removed.length === 0) throw new PlatformError("not_found", `No private connector ${namespace} served in this organisation.`)
  const row = await inTransaction(db, "removePrivateConnector: view", (sql) => rowOf(sql, orgId, namespace))
  if (!row) throw new PlatformError("internal", "Internal error.")
  return viewOf(row)
}
