// Capacités d'une organisation (E12-S02, ADR-022) : le paquet les déclare (`orgLimitsSchema`) et décide chaque refus
// avant l'écriture ; les valeurs viennent de l'hôte, par la fonction qu'il enregistre une fois, comme ses fonctions
// métier (`registerFunctions`). Sans fonction, ou sans valeur pour une clé, aucune limite, sauf le stockage, qui garde
// son quota de 10 Go : un ERP qui ne vend rien voit le comportement d'avant. Sans ce module, un hôte qui vend le paquet
// par offres ne pourrait brider une écriture qu'en filtrant les routes du paquet, hors du service (ADR-012 § 3).
//
// La fonction de l'hôte se lit hors de toute transaction (elle peut lire sa propre base) ; le compte et l'écriture
// qu'il garde tiennent dans la transaction du service, sous le verrou de l'organisation.
import * as z from "zod/v4"
import { ORG_QUOTA_BYTES, orgLimitsSchema, type LimitState, type OrgLimits, type OrgLimitsView } from "../schemas"
import { administrators, isOrgAdmin } from "./access"
import { createAnonPlatformDb, type PlatformDb } from "./db"
import { memberDirectoryIn } from "./directory"
import { inTransaction, invalidInput, PlatformError } from "./errors"
import type { Identity } from "./identity"
import type { Tx } from "./sql"

/**
 * Ce que l'hôte enregistre : `read` rend les capacités d'une organisation (`null` ou `{}` : aucune limite), `raiseUrl`
 * l'adresse où un administrateur relève une limite (une adresse `https://` ou un chemin de l'hôte), montrée sous un
 * geste grisé.
 */
export type OrgLimitsSource = {
  read(org: { id: string; slug: string }): OrgLimits | null | undefined | Promise<OrgLimits | null | undefined>
  raiseUrl?: string
}

/** Le verrou consultatif des limites comptées d'une organisation (`database-patterns.md § Transactions`, après 7501). */
const LIMIT_LOCK = 7601

let source: OrgLimitsSource | null = null

/** `raiseUrl` montrée en lien : une adresse `https://`, ou un chemin de l'hôte (`/billing`), jamais `//autre-hôte`. */
function linkable(url: string): boolean {
  if (/^\/(?![/\\])/.test(url)) return true
  try {
    return new URL(url).protocol === "https:"
  } catch {
    return false
  }
}

/**
 * Enregistre la source des capacités de l'hôte (ADR-022 § 2), en tête de chaque route qui monte une porte du paquet et
 * de chaque page qui montre un geste limité ; `null` la retire. Une source mal formée lève au chargement, avant de
 * servir sans limite.
 */
export function registerOrgLimits(next: OrgLimitsSource | null): void {
  if (next !== null && typeof next.read !== "function") throw new TypeError("registerOrgLimits: read must be a function.")
  if (next?.raiseUrl !== undefined && !linkable(next.raiseUrl)) {
    throw new TypeError("registerOrgLimits: raiseUrl must be an https address or a path of the host starting with /.")
  }
  source = next
}

/** Une panne de la source de l'hôte : un refus, jamais une limite tombée en silence (ADR-022 § 4). */
function sourceFailure(slug: string, what: string): PlatformError {
  // Ni son message ni sa pile : ils peuvent porter ce que l'hôte seul doit voir.
  console.error(`[platform] limits: the host's limits ${what} for ${slug}`)
  return new PlatformError("internal", "Internal error.")
}

/** Les capacités de l'organisation, lues chez l'hôte et validées ; `{}` sans source. */
export async function orgLimits(org: { id: string; slug: string }): Promise<OrgLimits> {
  if (!source) return {}
  let returned: unknown
  try {
    returned = await source.read({ id: org.id, slug: org.slug })
  } catch {
    throw sourceFailure(org.slug, "function failed")
  }
  const parsed = orgLimitsSchema.safeParse(returned ?? {})
  if (!parsed.success) throw sourceFailure(org.slug, "function returned invalid limits")
  return parsed.data
}

/** Les limites comptées par un service. */
export type CountedLimit = "members_max" | "teams_max" | "connectors_max"

type Counts = Record<CountedLimit, number>

/** Ce qui est pris : membres et invitations en attente, équipes, connecteurs actifs ; lu sous la session. */
async function limitCounts(sql: Tx, orgId: string): Promise<Counts> {
  const [row] = await sql<{ members: number; teams: number; connectors: number }[]>`
    select (select count(*)::int from platform.members m where m.org_id = ${orgId})
         + (select count(*)::int from platform.invitations i
             where i.org_id = ${orgId} and i.accepted_at is null and i.declined_at is null
               and i.revoked_at is null and i.expires_at > now()) as members,
           (select count(*)::int from platform.teams t where t.org_id = ${orgId}) as teams,
           (select count(*)::int from platform.connector_activations a where a.org_id = ${orgId} and a.state = 'active') as connectors`
  return { members_max: row.members, teams_max: row.teams, connectors_max: row.connectors }
}

/** Ce que le service a lu avant sa transaction : son client, l'identité et les capacités de l'hôte. */
export type LimitScope = { db: PlatformDb; identity: Identity; limits: OrgLimits }

/** Le texte d'un refus au plafond, neutre : ni offre ni prix. */
function limitText(orgName: string, name: CountedLimit, max: number): string {
  if (name === "teams_max" && max === 0) return `Creating teams is not open for ${orgName}.`
  const plural = max > 1
  if (name === "members_max") return `${orgName} is limited to ${max} ${plural ? "members" : "member"}, pending invitations included.`
  if (name === "teams_max") return `${orgName} is limited to ${max} ${plural ? "teams" : "team"}.`
  return `${orgName} is limited to ${max} active ${plural ? "connectors" : "connector"}.`
}

/**
 * L'équipe plateforme avec un accès en cours à l'organisation : elle passe les limites comptées (décision du
 * 2026-10-01), ce qu'un administrateur de l'organisation ne fait pas. Un membre de l'équipe plateforme sans accès en
 * cours reste un membre comme un autre.
 */
function passesLimits(identity: Identity): boolean {
  return identity.isStaff && identity.hasOpenGrant
}

/** Le verrou consultatif de l'organisation, pris avant de compter : deux ajouts concurrents ne passent pas tous deux. */
async function lockLimits(sql: Tx, identity: Identity): Promise<void> {
  await sql`select pg_catalog.pg_advisory_xact_lock(${LIMIT_LOCK}, pg_catalog.hashtext(${identity.org.id}::text))`
}

/**
 * Au plafond, compté sous le verrou : l'équipe plateforme passe, une ligne du journal de l'organisation nommant la limite
 * passée ; tout autre est refusé (`forbidden`, `reason: "limit"`, `limit`, `max`), et qui n'administre pas apprend qui
 * peut la faire relever.
 */
async function atLimit(sql: Tx, { identity }: LimitScope, limit: { name: string; max: number; used: number; text: string }): Promise<void> {
  const { name, max, used } = limit
  if (passesLimits(identity)) {
    await sql`
      insert into platform.journal (org_id, user_id, method, tool, target, args)
      values (${identity.org.id}, ${identity.user.id}, 'api', 'limit passed', ${name}, ${sql.json({ max, used })})`
    return
  }
  // Les administrateurs, lus dans la transaction ouverte : une seconde transaction n'est jamais ouverte pendant celle-ci.
  const ask = isOrgAdmin(identity) ? "" : ` Ask ${administrators(identity, await memberDirectoryIn(sql, identity.org.id))} about it.`
  throw new PlatformError("forbidden", `${limit.text}${ask}`, { reason: "limit", limit: name, max })
}

/**
 * Refuse l'ajout qui passerait la limite `name` (ADR-022 § 3), dans la transaction qui écrira ensuite : le verrou de
 * l'organisation, puis le compte ; au plafond, `forbidden` (`reason: "limit"`, `limit`, `max`). À qui n'administre pas,
 * le refus nomme qui peut la faire relever. Sans valeur pour `name`, rien n'est lu. L'équipe plateforme passe : une
 * ligne du journal de l'organisation, écrite dans la même transaction que l'ajout, nomme la limite passée.
 */
export async function requireUnderLimit(sql: Tx, scope: LimitScope, name: CountedLimit): Promise<void> {
  const max = scope.limits[name]
  if (max === undefined) return
  await lockLimits(sql, scope.identity)
  const counts = await limitCounts(sql, scope.identity.org.id)
  if (counts[name] < max) return
  await atLimit(sql, scope, { name, max, used: counts[name], text: limitText(scope.identity.org.name, name, max) })
}

/** Le propriétaire d'un compte de connecteur, tel que la base le range. */
export type AccountOwnerRef = { kind: "org" | "team" | "user"; teamId: string | null; userId: string | null }

/**
 * Refuse un compte de connecteur que les capacités de l'hôte n'admettent pas (ADR-022 § 8), avant la transaction qui
 * l'écrit : un propriétaire hors d'`account_owner_kinds` (`forbidden`, `reason: "limit"`, `limit`, `admitted`). Sans
 * valeur, tout propriétaire passe. Ce n'est pas une limite comptée : l'équipe plateforme ne la passe pas.
 */
export function requireAdmittedAccountOwner({ identity, limits }: LimitScope, kind: AccountOwnerRef["kind"]): void {
  const admitted = limits.account_owner_kinds
  if (admitted === undefined || admitted.includes(kind)) return
  const words = { org: "organisation", team: "team", user: "personal" } as const
  throw new PlatformError("forbidden", `${identity.org.name} does not open ${words[kind]} connector accounts.`, {
    reason: "limit",
    limit: "account_owner_kinds",
    admitted,
  })
}

/**
 * Refuse un compte de connecteur de plus pour un même propriétaire au-delà d'`accounts_per_owner_max` (ADR-022 § 8),
 * dans la transaction qui l'écrit ou le réactive, sous le verrou des limites : les comptes de ce connecteur et de ce
 * propriétaire comptés, un compte désactivé exclu. Au plafond, comme `requireUnderLimit`. Sans valeur, rien n'est lu.
 */
export async function requireUnderAccountsPerOwner(sql: Tx, scope: LimitScope, account: { connector: string; owner: AccountOwnerRef }): Promise<void> {
  const max = scope.limits.accounts_per_owner_max
  if (max === undefined) return
  const { connector, owner } = account
  await lockLimits(sql, scope.identity)
  const [{ used }] = await sql<{ used: number }[]>`
    select count(*)::int as used from platform.accounts
     where org_id = ${scope.identity.org.id} and connector = ${connector} and status <> 'disabled'
       and owner_kind = ${owner.kind}
       and owner_team_id is not distinct from ${owner.teamId}::uuid and owner_user_id is not distinct from ${owner.userId}::uuid`
  if (used < max) return
  const whose = owner.kind === "user" ? "one person" : owner.kind === "team" ? "one team" : "the organisation"
  const text = `${scope.identity.org.name} is limited to ${max} ${connector} ${max > 1 ? "accounts" : "account"} for ${whose}, disabled ones aside.`
  await atLimit(sql, scope, { name: "accounts_per_owner_max", max, used, text })
}

/**
 * Une transaction du service gardée par la limite `name` : les capacités lues chez l'hôte avant elle, puis, en tête de
 * la transaction, le refus au plafond (`requireUnderLimit`) ; `fn` écrit ensuite sous le même verrou.
 */
export async function limitedTx<T>(db: PlatformDb, identity: Identity, name: CountedLimit, fn: (sql: Tx) => Promise<T>): Promise<T> {
  const limits = await orgLimits(identity.org)
  return db.tx(async (sql) => {
    await requireUnderLimit(sql, { db, identity, limits }, name)
    return fn(sql)
  })
}

/** Le quota de fichiers de l'organisation, lu chez l'hôte hors de toute transaction : `storage_bytes`, sinon les 10 Go d'avant. */
export async function orgStorageQuota(org: { id: string; slug: string }): Promise<number> {
  return (await orgLimits(org)).storage_bytes ?? ORG_QUOTA_BYTES
}

/**
 * L'état des limites comptées pour les écrans (ADR-022 § 7) : plafond et compte de chaque limite posée, `null` pour les
 * autres ; sans aucune limite comptée, aucune lecture de la base. Rien n'est grisé pour l'équipe plateforme, qui passe
 * les limites.
 */
export async function orgLimitsView(db: PlatformDb, identity: Identity): Promise<OrgLimitsView> {
  const raiseUrl = source?.raiseUrl ?? null
  if (passesLimits(identity)) return { members: null, teams: null, connectors: null, raiseUrl }
  const limits = await orgLimits(identity.org)
  const posed = (["members_max", "teams_max", "connectors_max"] as const).some((name) => limits[name] !== undefined)
  if (!posed) return { members: null, teams: null, connectors: null, raiseUrl }
  const counts = await inTransaction(db, "orgLimitsView: counts", (sql) => limitCounts(sql, identity.org.id))
  const state = (name: CountedLimit): LimitState | null => {
    const max = limits[name]
    return max === undefined ? null : { max, used: counts[name] }
  }
  return { members: state("members_max"), teams: state("teams_max"), connectors: state("connectors_max"), raiseUrl }
}

/** Ce qu'une organisation compte, lu sans session : ses membres et ses invitations en attente. */
export type OrgUsage = { members: number; pendingInvitations: number }

/**
 * Les compteurs de l'organisation `orgId`, lus sans session (ADR-022 § 10) : l'hôte en a besoin hors de toute requête
 * d'une personne (tâche planifiée, webhook de paiement), pour prévenir d'un seuil sans refuser. Par `org_usage`, sous
 * `anon`, deux nombres et rien d'autre ; `null` pour une organisation inconnue.
 */
export async function orgUsage(orgId: string): Promise<OrgUsage | null> {
  const parsed = z.uuid().safeParse(orgId)
  if (!parsed.success) throw invalidInput(parsed.error)
  const [row] = await inTransaction(createAnonPlatformDb(), "orgUsage: org_usage", (sql) =>
    sql<{ members: number; pending_invitations: number }[]>`select members, pending_invitations from platform.org_usage(${parsed.data})`,
  )
  return row ? { members: row.members, pendingInvitations: row.pending_invitations } : null
}
