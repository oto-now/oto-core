// Le client sans session que `trustedRequestOrigin` et `resolveOrg` lisent, sans base : `org_by_host` ne sert une
// organisation qu'aux hôtes donnés. Pour les tests de l'hôte de référence qui simulent la requête sans Postgres ; la
// vraie fonction est prouvée par `tests/integration/identity.test.ts`.
import type { PlatformDb } from "../../packages/plateforme/server/db"
import type { Tx } from "../../packages/plateforme/server/sql"

const ORG = { id: "org-1", slug: "acme", name: "Acme", prefix: "acme", brand: {}, domains: null }

/** Un client dont la seule requête est `org_by_host(<hôte>)` : une organisation pour `hosts`, aucune sinon. */
export function orgDomainsDb(hosts: readonly string[]): PlatformDb {
  const sql = async (_text: TemplateStringsArray, host: unknown) => (hosts.includes(String(host)) ? [ORG] : [])
  return { tx: async (fn) => fn(sql as unknown as Tx) }
}
