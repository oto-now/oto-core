// L'API de l'hôte d'une organisation (`fonctions-d-un-hote.md` § Source par organisation) : sa ligne `platform.host_apis`
// lue, ses fonctions tirées du document servi (gardées en mémoire tant que l'adresse et la date de service ne changent
// pas), et son rafraîchissement par l'équipe plateforme. Un document refusé ne remplace jamais celui qui est servi : la
// version précédente reste servie, et le refus est enregistré avec ses problèmes. Sans ce module, une organisation
// n'aurait pas d'API d'hôte.
import { catalogFunctions } from "../catalog/registry"
import { contractNames } from "../catalog/contracts"
import type { CatalogFunction } from "../catalog/define"
import { httpsAddressProblem } from "../connectors/settings"
import type { PlatformDb } from "../db"
import { inTransaction, PlatformError } from "../errors"
import type { Identity } from "../identity"
import { importHostDocument, readHostDocument, type HostDocumentProblem } from "./document"
import { hostCatalogFunctions } from "./functions"

/** La ligne de l'API de l'hôte d'une organisation, telle que l'administration la montre. */
export type HostApiView = {
  address: string | null
  version: string | null
  servedAt: string | null
  refreshedAt: string
  refused: { address: string; at: string; problems: HostDocumentProblem[] } | null
}

type HostApiRow = {
  address: string | null
  document: unknown
  version: string | null
  etag: string | null
  served_at: string | null
  refreshed_at: string
  refused_address: string | null
  refused_at: string | null
  problems: HostDocumentProblem[] | null
}

const viewOf = (row: HostApiRow): HostApiView => ({
  address: row.address,
  version: row.version,
  servedAt: row.served_at,
  refreshedAt: row.refreshed_at,
  refused: row.refused_at && row.refused_address ? { address: row.refused_address, at: row.refused_at, problems: row.problems ?? [] } : null,
})

/** Les espaces de noms que l'instance sert déjà, qu'aucun espace de l'hôte ne reprend. */
function reservedNamespaces(): Set<string> {
  const names = catalogFunctions().flatMap((fn) => [fn.connector, fn.name.split(".")[0], fn.name.split(".")[0].replace(/_act$/, "")])
  return new Set([...names, ...contractNames().map((name) => name.split(".")[0])])
}

/** Les fonctions tirées du document servi d'une organisation, par organisation, sous la clé adresse + date de service. */
const built = new Map<string, { key: string; functions: CatalogFunction[] }>()

/** Vide les fonctions gardées ; les tests seuls. */
export function forgetHostFunctions(): void {
  built.clear()
}

/**
 * Les fonctions de l'API de l'hôte de l'organisation de `identity`, lues sous sa session ; `[]` sans API servie. Le
 * document servi a été accepté à son rafraîchissement : un échec à le relire ici est une panne (`internal`, journalisée),
 * jamais un catalogue amputé en silence.
 */
export async function hostApiFunctions(db: PlatformDb, identity: Identity): Promise<CatalogFunction[]> {
  const orgId = identity.org.id
  const [head] = await inTransaction(
    db,
    "hostApiFunctions: host_apis",
    (sql) => sql<{ address: string | null; served_at: string | null }[]>`select address, to_json(served_at)#>>'{}' as served_at from platform.host_apis where org_id = ${orgId}`,
  )
  if (!head?.address || !head.served_at) {
    built.delete(orgId)
    return []
  }
  const key = `${head.address} ${head.served_at}`
  const kept = built.get(orgId)
  if (kept?.key === key) return kept.functions
  const [row] = await inTransaction(
    db,
    "hostApiFunctions: host_apis document",
    (sql) => sql<{ address: string; document: unknown; served_at: string }[]>`
      select address, document, to_json(served_at)#>>'{}' as served_at from platform.host_apis where org_id = ${orgId} and address is not null`,
  )
  if (!row) return []
  const imported = importHostDocument(row.document, reservedNamespaces())
  if ("problems" in imported) {
    console.error(`[platform] host api: the served document of org ${orgId} no longer imports (${imported.problems.map((problem) => problem.code).join(", ")})`)
    throw new PlatformError("internal", "Internal error.")
  }
  const functions = hostCatalogFunctions(imported.imported, row.address)
  built.set(orgId, { key: `${row.address} ${row.served_at}`, functions })
  return functions
}

const ROW_COLUMNS = `address, document, version, etag, to_json(served_at)#>>'{}' as served_at, to_json(refreshed_at)#>>'{}' as refreshed_at,
  refused_address, to_json(refused_at)#>>'{}' as refused_at, problems`

/** La ligne de l'API de l'hôte de l'organisation, `null` sans elle. */
async function rowOf(db: PlatformDb, identity: Identity): Promise<HostApiRow | null> {
  const [row] = await inTransaction(db, "hostApi: host_apis", (sql) => sql<HostApiRow[]>`select ${sql.unsafe(ROW_COLUMNS)} from platform.host_apis where org_id = ${identity.org.id}`)
  return row ?? null
}

/** L'API de l'hôte de l'organisation, telle que l'administration la montre ; `null` sans réglage. */
export async function hostApi(db: PlatformDb, identity: Identity): Promise<HostApiView | null> {
  const row = await rowOf(db, identity)
  return row ? viewOf(row) : null
}

/** Ce qu'a donné un rafraîchissement : servi (nouvelle version), inchangé (`304` ou même document), ou refusé. */
export type RefreshOutcome = { kind: "served" | "unchanged" | "refused"; view: HostApiView }

/**
 * Rafraîchit l'API de l'hôte de l'organisation, réservé à l'équipe plateforme : lit le document à `address` (à défaut,
 * l'adresse servie), le juge, et le sert s'il est accepté ; refusé, l'adresse et le document précédents restent servis,
 * et le refus s'enregistre (adresse, date, problèmes). Refus : appelant hors de l'équipe (`forbidden`), adresse mal
 * formée (`invalid_arguments`), aucune adresse ni donnée ni servie (`invalid_arguments`).
 */
export async function refreshHostApi(db: PlatformDb, identity: Identity, input: { address?: string }): Promise<RefreshOutcome> {
  if (!identity.isStaff) throw new PlatformError("forbidden", "Setting the API of a host is reserved to the platform team.")
  const current = await rowOf(db, identity)
  const address = input.address ?? current?.address ?? null
  if (!address) throw new PlatformError("invalid_arguments", "No address of the host's API is set yet: pass address (https://…).")
  const problem = httpsAddressProblem(address)
  if (problem) throw new PlatformError("invalid_arguments", `The address of the host's API ${problem}.`)
  const sameAddress = current?.address === address
  const reading = await readHostDocument(address, sameAddress ? (current?.etag ?? null) : null)
  const orgId = identity.org.id
  const refuse = async (problems: HostDocumentProblem[]): Promise<RefreshOutcome> => {
    await inTransaction(db, "refreshHostApi: refused", (sql) => sql`
      insert into platform.host_apis (org_id, refused_address, refused_at, problems, refreshed_at)
      values (${orgId}, ${address}, now(), ${sql.json(problems)}, now())
      on conflict (org_id) do update set refused_address = excluded.refused_address, refused_at = excluded.refused_at,
        problems = excluded.problems, refreshed_at = excluded.refreshed_at`)
    console.error(`[platform] host api: document of org ${orgId} refused (${problems.map((item) => item.code).join(", ")})`)
    return { kind: "refused", view: viewOf((await rowOf(db, identity)) as HostApiRow) }
  }
  if (reading.kind === "refused") return refuse(reading.problems)
  if (reading.kind === "not_modified") {
    await inTransaction(db, "refreshHostApi: not modified", (sql) => sql`
      update platform.host_apis set refreshed_at = now(), refused_address = null, refused_at = null, problems = null where org_id = ${orgId}`)
    return { kind: "unchanged", view: viewOf((await rowOf(db, identity)) as HostApiRow) }
  }
  const imported = importHostDocument(reading.document, reservedNamespaces())
  if ("problems" in imported) return refuse(imported.problems)
  const document = reading.document as Record<string, unknown>
  const unchanged = sameAddress && current?.version === imported.imported.version && JSON.stringify(current.document) === JSON.stringify(document)
  await inTransaction(db, "refreshHostApi: served", (sql) => sql`
    insert into platform.host_apis (org_id, address, document, version, etag, served_at, refreshed_at)
    values (${orgId}, ${address}, ${sql.json(document as never)}, ${imported.imported.version}, ${reading.etag}, now(), now())
    on conflict (org_id) do update set address = excluded.address, document = excluded.document, version = excluded.version,
      etag = excluded.etag, refreshed_at = excluded.refreshed_at,
      served_at = case when ${unchanged} then platform.host_apis.served_at else excluded.served_at end,
      refused_address = null, refused_at = null, problems = null`)
  return { kind: unchanged ? "unchanged" : "served", view: viewOf((await rowOf(db, identity)) as HostApiRow) }
}
