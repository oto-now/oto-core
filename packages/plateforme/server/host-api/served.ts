// L'API servie de l'hôte d'une organisation (`fonctions-d-un-hote.md` § Source par organisation) : le document de sa
// ligne `platform.host_apis`, importé, gardé en mémoire tant que l'adresse et la date de service ne changent pas. Lue par
// le catalogue de l'organisation (`service.ts`) et par le consentement d'une personne (`consent-access.ts`), qui ne
// dépendent ainsi pas l'un de l'autre. Sans ce module, chacun relirait et réimporterait le document.
import { catalogFunctions } from "../catalog/registry"
import { contractNames } from "../catalog/contracts"
import { HOST_CONSENT_CONNECTOR } from "../connectors/definition"
import type { PlatformDb } from "../db"
import { inTransaction, PlatformError } from "../errors"
import type { Identity } from "../identity"
import { importHostDocument, type ImportedHost } from "./document"

/** L'API servie d'une organisation : son document importé et son adresse. */
export type ServedHost = { imported: ImportedHost; address: string }

/**
 * Les espaces de noms que l'instance sert déjà, qu'aucun espace de l'hôte ne reprend : ceux du catalogue, des contrats,
 * et le connecteur des consentements à l'API d'un hôte.
 */
export function reservedNamespaces(): Set<string> {
  const names = catalogFunctions().flatMap((fn) => [fn.connector, fn.name.split(".")[0], fn.name.split(".")[0].replace(/_act$/, "")])
  return new Set([...names, ...contractNames().map((name) => name.split(".")[0]), HOST_CONSENT_CONNECTOR])
}

/** Les documents importés, par organisation, sous la clé adresse + date de service. */
const served = new Map<string, { key: string; host: ServedHost }>()

/** Vide les documents gardés ; les tests seuls. */
export function forgetServedHosts(): void {
  served.clear()
}

/**
 * L'API servie de l'organisation de `identity`, lue sous sa session ; `null` sans API servie. Le document servi a été
 * accepté à son rafraîchissement : un échec à le réimporter ici est une panne (`internal`, journalisée), jamais une API
 * amputée en silence.
 */
export async function servedHost(db: PlatformDb, identity: Identity): Promise<ServedHost | null> {
  const orgId = identity.org.id
  const [head] = await inTransaction(
    db,
    "servedHost: host_apis",
    (sql) => sql<{ address: string | null; served_at: string | null }[]>`select address, to_json(served_at)#>>'{}' as served_at from platform.host_apis where org_id = ${orgId}`,
  )
  if (!head?.address || !head.served_at) {
    served.delete(orgId)
    return null
  }
  const kept = served.get(orgId)
  if (kept?.key === `${head.address} ${head.served_at}`) return kept.host
  const [row] = await inTransaction(
    db,
    "servedHost: host_apis document",
    (sql) => sql<{ address: string; document: unknown; served_at: string }[]>`
      select address, document, to_json(served_at)#>>'{}' as served_at from platform.host_apis where org_id = ${orgId} and address is not null`,
  )
  if (!row) return null
  const imported = importHostDocument(row.document, reservedNamespaces())
  if ("problems" in imported) {
    console.error(`[platform] host api: the served document of org ${orgId} no longer imports (${imported.problems.map((problem) => problem.code).join(", ")})`)
    throw new PlatformError("internal", "Internal error.")
  }
  const host = { imported: imported.imported, address: row.address }
  served.set(orgId, { key: `${row.address} ${row.served_at}`, host })
  return host
}
