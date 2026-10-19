// Session du MCP admin (E08-S02, H105) : l'équipe plateforme à la porte, le code `ctx` admin ancré
// sur sa ligne `admin_journal`, l'organisation visée par son slug, et le journal à part. Sans ce
// module, l'adaptateur `mcp/admin/` déciderait lui-même qui est du staff et où il agit, alors qu'un
// droit se décide dans le service, avant sa requête (H123).
//
// Repris de la maquette (`mcp-test/src/proto/services/ctx.ts` l. 12-29, 51-66) : forme du code
// vérifiée avant la base, code d'une autre personne = code inconnu. Retiré : la table `ctx` et
// `rules_version` (ancrage sur `admin_journal`, 24 h, H105). Repris (`services/journal.ts`
// l. 38-49) : un journal en panne ne change pas la réponse, sauf l'ancrage d'`admin_context` (N5).
//
// Face SQL (E01-S10, lot d2) : chaque lecture et chaque écriture passe par `db.tx` sous l'appelant
// (`inTransaction`, `members.ts`) ; la résolution d'une organisation lit sa ligne et l'identité dans la
// même transaction.
import type * as z from "zod/v4"
import { CTX_PATTERN, type AccountView, type OwnerRef, type TeamView } from "../../schemas"
import { isOrgAdmin } from "../access"
import { listOrgAccounts } from "../connectors/accounts"
import type { Database, Json } from "../database"
import type { PlatformDb } from "../db"
import { memberDirectory, sameEmail, type DirectoryEntry } from "../directory"
import { boundedList, inTransaction, isPlatformError, PlatformError } from "../errors"
import { identityInOrg, type Identity, type IdentityOrg } from "../identity"
import { loggedArgs } from "../journal"
import { pseudonymizedLines } from "../pseudonym/journal"
import { listTeams } from "../teams"

/** Un membre de l'équipe plateforme, reconnu par `requireStaff` : l'appelant du MCP admin. */
export type StaffCaller = { userId: string; email: string }

/** Une ligne d'`admin_journal` telle que le staff l'insère : ni `id` ni `ts`, que pose la base (M02). */
export type AdminJournalEntry = Omit<Database["platform"]["Tables"]["admin_journal"]["Insert"], "id" | "ts">

/**
 * Un membre de l'équipe plateforme dans `staff_directory()` (E01-S04, N20) ; email et nom nuls à
 * l'exécution pour une ligne écrite sans email (E01-S09) : l'email se compare par `sameEmail` (M20).
 */
export type StaffEntry = { userId: string; email: string; name: string; addedAt: string }

/** Durée de validité d'un code admin, depuis sa ligne d'ancrage (H105). */
export const ADMIN_CTX_MS = 24 * 3600 * 1000

// Textes des refus de la session admin (AC6, AC7) : servis par ce module, recopiés par le contrat que
// rend `op help` (`mcp/admin/ops.ts`, `tools/context.ts`), une seule source pour les deux.
export const ADMIN_CTX_MISSING = "Missing or unknown admin ctx. Call admin_context first and pass its ctx code."
export const ADMIN_CTX_STALE = "Admin ctx expired after 24 hours: call admin_context again, then retry this call."
export const ADMIN_SESSION_FAILED = "Could not open an admin session. Retry once."

/**
 * Chaque colonne d'une ligne du journal admin, à sa valeur par défaut : les lignes d'une insertion
 * groupée ont alors toutes les mêmes clés (`sql(rows)` prend celles de la première ligne,
 * `supabase-patterns.md § Couplage à Supabase (ADR-012)`), et `is_error`, non nulle, n'est jamais nulle.
 */
const EMPTY_ENTRY = {
  org_id: null,
  ctx: null,
  tool: null,
  op: null,
  target: null,
  args: null,
  args_chars: null,
  result_chars: null,
  is_error: false,
  error: null,
  duration_ms: null,
  host: null,
  user_agent: null,
} satisfies Omit<AdminJournalEntry, "method" | "user_id">

/**
 * La porte du MCP admin (AC2, H105) : l'appelant est-il de l'équipe plateforme (`is_staff()`, sous
 * son jeton) ? Sinon `forbidden`, que la porte rend en 401 sans rien annoncer. Son identifiant est
 * celui de la session (`auth.uid()`), que la base a traduit pour un appelant émis (E01-S11, AC-a13 :
 * l'email vérifié d'une ligne `platform_staff`), jamais le sujet du jeton ; `caller.email` : le texte.
 */
export async function requireStaff(db: PlatformDb, caller: { email: string }): Promise<StaffCaller> {
  // L'identifiant n'est rendu qu'au staff : `is_staff()` décide, dans la même instruction.
  const [row] = await inTransaction(db, "requireStaff: is_staff", (sql) => sql<{ user_id: string | null }[]>`
    select case when platform.is_staff() then auth.uid() end as user_id`)
  if (!row?.user_id) throw new PlatformError("forbidden", "Unauthorized")
  return { userId: row.user_id, email: caller.email }
}

/** Ce qu'une écriture du journal admin en échec laisse au log : le code d'une erreur de la base, jamais son message ; sinon l'erreur. */
function codeOf(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : error
}

/**
 * Des lignes du journal admin, bâties sur `EMPTY_ENTRY`, en une instruction ; `args` part par `sql.json`
 * (`supabase-patterns.md § Couplage à Supabase (ADR-012)`).
 */
function insertAdminJournal(db: PlatformDb, lines: readonly AdminJournalEntry[]): Promise<unknown> {
  return db.tx((sql) => {
    const rows = lines.map((line) => ({ ...line, args: line.args === null || line.args === undefined ? null : sql.json(line.args) }))
    return sql`insert into platform.admin_journal ${sql(rows)}`
  })
}

/**
 * Ouvre une session admin (AC6, N5) : écrit la ligne d'ancrage du code, celle de l'appel
 * d'`admin_context` elle-même, et l'attend. Un code ne vaut que par cette ligne : si elle manque,
 * aucun code n'est servi (`internal`).
 */
export async function openAdminSession(db: PlatformDb, staff: StaffCaller, anchor: AdminJournalEntry & { ctx: string }): Promise<void> {
  const line = { ...EMPTY_ENTRY, ...anchor, user_id: staff.userId, method: "tools/call", tool: "admin_context" }
  try {
    await insertAdminJournal(db, [line])
    return
  } catch (error) {
    console.error("[platform] openAdminSession: admin_journal insert failed", codeOf(error))
  }
  throw new PlatformError("internal", ADMIN_SESSION_FAILED)
}

/** Un code admin valide et la signature du client qui l'a ouvert (P6) : la ligne d'ancrage la porte. */
export type AdminCtx = { code: string; host: string | null }

/**
 * Garde des sept outils autres qu'`admin_context` (AC7) : le code a sa forme, puis une ligne
 * d'ancrage de l'appelant, datée de moins de 24 heures. Un code absent, mal formé, inconnu ou émis
 * pour un autre membre de l'équipe plateforme : `ctx_missing` ; plus ancien : `ctx_stale`. Rend aussi
 * la signature de l'ancrage, que reprend la ligne de chaque appel du code (P6, comme `journal.host`).
 */
export async function requireAdminCtx(db: PlatformDb, staff: StaffCaller, raw: unknown): Promise<AdminCtx> {
  // Forme vérifiée avant la base : un code de 100 000 caractères n'y part jamais.
  const code = typeof raw === "string" ? raw.trim().toUpperCase() : ""
  if (!CTX_PATTERN.test(code)) throw new PlatformError("ctx_missing", ADMIN_CTX_MISSING)
  // L'instant en `Date` : la milliseconde suffit à une borne de 24 heures.
  const [anchor] = await inTransaction(db, "requireAdminCtx: admin_journal", (sql) => sql<{ ts: Date; host: string | null }[]>`
    select ts, host from platform.admin_journal
     where ctx = ${code} and user_id = ${staff.userId} and method = 'tools/call' and tool = 'admin_context' and is_error = false
     order by ts desc limit 1`)
  if (!anchor) throw new PlatformError("ctx_missing", ADMIN_CTX_MISSING)
  if (Date.now() - anchor.ts.getTime() > ADMIN_CTX_MS) throw new PlatformError("ctx_stale", ADMIN_CTX_STALE)
  return { code, host: anchor.host }
}

/** Le même refus pour un slug inconnu et pour une organisation sans accès (AC10, H68). */
function unknownOrg(slug: string): PlatformError {
  return new PlatformError(
    "not_found",
    `Unknown organisation ${slug}, or you have no platform access to it. List yours with admin_context {"op": "orgs"}; a colleague who has access can grant you one with admin_org {"op": "grant_access"}.`,
  )
}

/**
 * Les domaines de travail stockés (`settings.domains`, N10), lus comme `org_by_host` les rend
 * (`settings ->> 'domains'`) : le texte, ou le JSON d'une autre valeur. Seul lecteur des services
 * admin : l'identité (`resolveAdminOrg`), la fiche et le réglage (`admin/orgs.ts`) montrent la valeur
 * même dont la description de `<prefix>_context` tire ses domaines.
 */
export function domainsOf(settings: Json): string | null {
  const value = settings && typeof settings === "object" && !Array.isArray(settings) ? settings.domains : undefined
  if (value === undefined || value === null) return null
  return typeof value === "string" ? value : JSON.stringify(value)
}

type OrgRow = { id: string; slug: string; name: string; prefix: string; brand: Json; settings: Json }

/**
 * L'organisation visée par son slug et l'identité de l'appelant dedans (AC10, N9) : lue par son slug,
 * puis `identityInOrg`, dans une transaction. Ni ligne `members` ni accès plateforme en cours :
 * `not_found`, le même que pour un slug inconnu, décidé ici et jamais par une ligne que la RLS
 * cacherait (H123) ; un accès révoqué entre les deux lectures aussi.
 */
export async function resolveAdminOrg(db: PlatformDb, staff: StaffCaller, slug: string): Promise<Identity> {
  return inTransaction(db, "resolveAdminOrg: orgs", async (sql) => {
    // `slug` est unique (`orgs_slug_key`) : une ligne au plus.
    const [row] = await sql<OrgRow[]>`select id, slug, name, prefix, brand, settings from platform.orgs where slug = ${slug}`
    if (!row) throw unknownOrg(slug)
    const org: IdentityOrg = { id: row.id, slug: row.slug, name: row.name, prefix: row.prefix, brand: row.brand, domains: domainsOf(row.settings) }
    try {
      return await identityInOrg(db, org, staff)
    } catch (failure) {
      // Le refus décidé par `identityInOrg` devient celui d'un slug inconnu ; toute autre erreur repart telle quelle.
      if (isPlatformError(failure) && failure.code === "not_member") throw unknownOrg(slug)
      throw failure
    }
  })
}

/**
 * Adresses et accès plateforme (fiche D14 B, N13, N23) : réservés au membre de l'équipe plateforme qui
 * administre l'organisation (`identity.isStaff` et `isOrgAdmin`, règles des policies `org_domains_*_admin`
 * et `platform_grants_insert_staff` d'E01-S04), décidé avant toute écriture.
 */
export function requireStaffAdmin(identity: Identity, op: string): void {
  if (identity.isStaff && isOrgAdmin(identity)) return
  throw new PlatformError(
    "forbidden",
    `op ${op} of admin_org is reserved to platform team members who administer ${identity.org.slug}. A colleague who does can grant you a platform access with admin_org {"op": "grant_access"}.`,
  )
}

/** Une équipe de l'organisation par son slug (`listTeams` d'E05-S03) ; inconnue : `not_found` qui liste les slugs. */
export async function findTeam(db: PlatformDb, identity: Identity, slug: string): Promise<TeamView> {
  const teams = await listTeams(db, identity)
  const team = teams.find((candidate) => candidate.slug === slug)
  if (team) return team
  const slugs = boundedList(teams.map((candidate) => candidate.slug)) || "none"
  throw new PlatformError("not_found", `Unknown team ${slug} in ${identity.org.slug}. Teams: ${slugs}.`)
}

/** Un membre de l'organisation par son email, sans casse (l'annuaire unique, `memberDirectory`). */
export async function findMember(db: PlatformDb, identity: Identity, email: string): Promise<DirectoryEntry> {
  const wanted = email.toLowerCase()
  const person = (await memberDirectory(db, identity.org.id)).find((entry) => sameEmail(entry.email, wanted))
  if (person) return person
  throw new PlatformError("not_found", `No member of ${identity.org.slug} has the email ${email}. Invite them first from the web app (Équipes).`)
}

/** Une référence résolue (E08-S06, N1) : l'organisation, l'héritage, l'équipe par son slug, le membre par son email. */
export type ResolvedRef = { kind: "org" } | { kind: "inherit" } | { kind: "team"; team: TeamView } | { kind: "user"; person: DirectoryEntry }

/**
 * Une référence lue par son schéma (`ownerRefSchema`, `accountOwnerRefSchema`, `subjectRefSchema`) ;
 * mal formée : `invalid_arguments` avec le seul message du schéma, que le modèle lit tel quel (AC4, AC6,
 * AC11 d'E08-S06).
 */
export function readRef<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value)
  if (parsed.success) return parsed.data
  throw new PlatformError("invalid_arguments", `${parsed.error.issues[0]?.message ?? "Invalid reference"}.`)
}

/** Une référence résolue dans l'organisation (N1) : l'équipe par `findTeam`, la personne par `findMember`, avec leurs refus. */
export async function resolveRef(db: PlatformDb, identity: Identity, ref: OwnerRef): Promise<ResolvedRef> {
  if (ref.kind === "team") return { kind: "team", team: await findTeam(db, identity, ref.slug) }
  if (ref.kind === "user") return { kind: "user", person: await findMember(db, identity, ref.email) }
  return ref
}

/**
 * Un compte par son libellé, sans casse, parmi ceux que l'appelant voit (`listOrgAccounts`, E08-S03 : un
 * compte de niveau 0 n'y est pas) ; le libellé est unique dans l'organisation (N6) : zéro ou un. Aucun :
 * `not_found`, qui liste les libellés visibles, 20 au plus.
 */
export async function findAccount(db: PlatformDb, identity: Identity, input: { label: string }): Promise<AccountView> {
  const label = input.label.trim()
  const accounts = await listOrgAccounts(db, identity)
  const account = accounts.find((candidate) => candidate.label.toLowerCase() === label.toLowerCase())
  if (account) return account
  const labels = boundedList(accounts.map((candidate) => candidate.label)) || "none"
  throw new PlatformError("not_found", `No account labelled ${label} in ${identity.org.slug}. Accounts: ${labels}.`)
}

type StaffRow = { user_id: string; email: string; name: string; added_at: string }

/**
 * L'équipe plateforme (`staff_directory()`, au staff seulement), toute en une lecture, par `user_id` ;
 * la date d'entrée en texte, comme PostgREST la rendait (`to_json`).
 */
export async function staffDirectory(db: PlatformDb): Promise<StaffEntry[]> {
  const rows = await inTransaction(db, "staffDirectory: staff_directory", (sql) => sql<StaffRow[]>`
    select s.user_id, s.email, s.name, to_json(s.added_at) #>> '{}' as added_at from platform.staff_directory() s order by s.user_id`)
  return rows.map((row) => ({ userId: row.user_id, email: row.email, name: row.name, addedAt: row.added_at }))
}

/** Un membre de l'équipe plateforme par son email, sans casse (AC19). */
export async function findStaff(db: PlatformDb, email: string): Promise<StaffEntry> {
  const wanted = email.toLowerCase()
  const person = (await staffDirectory(db)).find((entry) => sameEmail(entry.email, wanted))
  if (person) return person
  throw new PlatformError("not_found", `No member of the platform team has the email ${email}.`)
}

/**
 * La ligne du journal admin d'une requête de l'appelant (N15) : ses arguments masqués puis bornés
 * (`loggedArgs`, H07) et leur taille ; sans `params`, aucun argument (ligne `initialize`).
 */
export function adminJournalEntry(staff: StaffCaller, request: { method: string; params?: unknown; userAgent: string | null }): AdminJournalEntry {
  const entry: AdminJournalEntry = { user_id: staff.userId, method: request.method, user_agent: request.userAgent }
  if (request.params === undefined) return entry
  return { ...entry, args: loggedArgs(request.params), args_chars: JSON.stringify(request.params).length }
}

/**
 * Insertion groupée des lignes de la requête, qui ne lève jamais (H07) : un journal en panne ne
 * change pas la réponse servie. Chaque ligne est celle de l'appelant (`user_id`), jamais d'un autre.
 */
export async function flushAdminJournal(db: PlatformDb, staff: StaffCaller, entries: readonly AdminJournalEntry[]): Promise<void> {
  if (entries.length === 0) return
  try {
    // Pseudonymisé à l'écriture, comme le journal des membres : sous l'organisation de chaque ligne (J2).
    await insertAdminJournal(db, await pseudonymizedLines(db, entries.map((entry) => ({ ...EMPTY_ENTRY, ...entry, user_id: staff.userId }))))
  } catch (error) {
    console.error("[platform] admin journal: insert failed", codeOf(error))
  }
}
