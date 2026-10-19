// L'entrée sans invitation (offres de l'hôte, identité et connexion) : dans un ERP construit sur le paquet, l'annuaire
// est celui de l'ERP ; un administrateur ouvre l'organisation aux comptes vérifiés des domaines d'email qu'il nomme, et
// une personne admise entre comme membre, sans équipe, à son premier appel. Ce module décide (ADR-012 § 3) : qui règle
// (un administrateur), et, à l'entrée, le plafond de membres lu chez l'hôte ; `join_org` en est la seconde barrière et
// tient l'entrée en une transaction. Sans lui, `resolveIdentity` et l'écran porteraient ces règles.
import { openEntrySchema, type OpenEntry } from "../schemas"
import { isOrgAdmin } from "./access"
import type { PlatformDb } from "./db"
import { inTransaction, invalidInput, PlatformError } from "./errors"
import type { Identity, IdentityOrg } from "./identity"
import { isJsonObject } from "./json"
import { orgLimits } from "./limits"

const CLOSED: OpenEntry = { enabled: false, email_domains: [] }

/** Le réglage tel qu'il est rangé dans `orgs.settings.open_entry` ; fermé s'il est absent ou illisible. */
function storedOpenEntry(settings: unknown): OpenEntry {
  const stored = isJsonObject(settings) ? settings.open_entry : undefined
  if (!isJsonObject(stored) || !Array.isArray(stored.email_domains)) return CLOSED
  return { enabled: stored.enabled === true, email_domains: stored.email_domains.filter((domain): domain is string => typeof domain === "string") }
}

function requireAdmin(identity: Identity, action: string): void {
  if (!isOrgAdmin(identity)) throw new PlatformError("forbidden", `Only an administrator of ${identity.org.name} can ${action}.`)
}

/** Le réglage de l'organisation, pour l'écran ; réservé à qui l'administre. */
export async function readOpenEntry(db: PlatformDb, identity: Identity): Promise<OpenEntry> {
  requireAdmin(identity, "see who enters without an invitation")
  const [row] = await inTransaction(db, "readOpenEntry: orgs", (sql) => sql<{ settings: unknown }[]>`select o.settings from platform.orgs o where o.id = ${identity.org.id}`)
  return storedOpenEntry(row?.settings)
}

/**
 * Ouvre ou ferme l'entrée sans invitation : un administrateur, au moins un domaine pour ouvrir (`openEntrySchema`). Les
 * domaines sont gardés à la fermeture. Les autres clés de `settings` ne bougent pas.
 */
export async function setOpenEntry(db: PlatformDb, identity: Identity, input: unknown): Promise<{ data: OpenEntry; target: string; teamId: null }> {
  const parsed = openEntrySchema.safeParse(input)
  if (!parsed.success) throw invalidInput(parsed.error)
  requireAdmin(identity, "open the organisation to accounts without an invitation")
  const next: OpenEntry = { enabled: parsed.data.enabled, email_domains: [...new Set(parsed.data.email_domains)] }
  const [row] = await inTransaction(db, "setOpenEntry: orgs", (sql) => sql<{ settings: unknown }[]>`
    update platform.orgs set settings = jsonb_set(settings, '{open_entry}', ${sql.json(next)})
     where id = ${identity.org.id}
    returning settings`)
  if (!row) throw new PlatformError("not_found", `No organisation ${identity.org.slug}.`)
  return { data: storedOpenEntry(row.settings), target: "open-entry", teamId: null }
}

/**
 * Fait entrer l'appelant dans `org` si son réglage l'admet ; rend `true` quand une ligne `members` vient de naître.
 * Non admis (réglage fermé, email absent ou hors des domaines, personne exclue ou servie par un accès plateforme) :
 * `false`, rien n'est écrit. Au plafond de membres de l'hôte : `forbidden`, `reason: "limit"`, le seul refus qui se
 * dit. Le plafond se lit chez l'hôte hors de toute transaction, et seulement pour une personne admise.
 */
export async function enterOrg(db: PlatformDb, org: IdentityOrg): Promise<boolean> {
  const [gate] = await inTransaction(db, "enterOrg: open_entry_admits", (sql) => sql<{ admits: boolean }[]>`select platform.open_entry_admits(${org.id}) as admits`)
  if (!gate?.admits) return false
  const max = (await orgLimits(org)).members_max ?? null
  // `join_org` croit le plafond lu chez l'hôte : réservée au rôle du serveur.
  const [row] = await inTransaction(db, "enterOrg: join_org", (sql) => sql<{ outcome: string }[]>`select platform.join_org(${org.id}, ${max}) as outcome`, "server")
  if (row?.outcome === "limit" && max !== null) {
    throw new PlatformError("forbidden", `${org.name} is limited to ${max} ${max > 1 ? "members" : "member"}, pending invitations included. Ask an administrator of ${org.name} about it.`, {
      reason: "limit",
      limit: "members_max",
      max,
    })
  }
  if (row?.outcome !== "joined") return false
  // Un sujet OIDC jamais vu vient de recevoir son identité : la transaction suivante de ce client la relit.
  db.retranslate?.()
  return true
}
