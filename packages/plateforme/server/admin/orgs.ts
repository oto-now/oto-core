// Organisations, pour le MCP admin (E08-S02) et le tableau de bord (E08-S03) : lister, lire, créer,
// régler. Adresses (`hosts.ts`) et accès plateforme (`grants.ts`) ont leur module. Chaque droit se
// décide ici, avant la requête (H123) ; la RLS n'en est qu'une seconde barrière. Sans ce module,
// aucune porte hors de l'outillage ne crée une organisation cliente.
//
// Repris d'Oto (`capabilities/orgs/admin.py` l. 37-71) : ce qui peut échouer se résout avant d'écrire
// (formats et adresse avant `create_org`) ; retiré : l'escalade super-admin sur le contenu ; le responsable
// membre de l'organisation créée revient quand il s'en nomme premier administrateur (`first-admin.ts`). Repris (`capabilities/orgs/core.py` l. 100-134) : le
// nom nettoyé de 1 à 80 caractères ; retiré : la création en libre-service, le quota, l'organisation
// personnelle.
//
// Face SQL (E01-S10, lot d2) : `db.tx` sous l'appelant (`inTransaction`, `members.ts`). Le réglage
// (`updateOrg`) lit, écrit la ligne et la marque (`updateBrand`) dans une seule transaction ; la création
// garde ses étapes à part : le point de l'hôte est une entrée-sortie extérieure, et le refus de
// `create_org` perd sa transaction avant que son conflit soit relu.
import {
  brandInputSchema,
  orgCreateSchema,
  orgSettingsSchema,
  type BrandInput,
  type OrgSettings,
  type PlatformAccessView,
} from "../../schemas"
import { describeOwner, isOrgAdmin } from "../access"
import { readBrand, updateBrand } from "../brand"
import type { Json } from "../database"
import type { PlatformDb } from "../db"
import { memberDirectory } from "../directory"
import { changedMeanwhile, fromDatabaseError, inTransaction, invalidInput, isPlatformError, PlatformError, uniqueConstraint } from "../errors"
import { memberRole, orgContact, type Identity, type MemberRole } from "../identity"
import { listPlatformAccess } from "../members"
import { routingSettings, type RoutingSettings } from "../routing"
import { domainsOf, requireStaff, resolveAdminOrg, type StaffCaller } from "./context"
import { claimOrgAdmin, firstAdminPlan, inviteAdmin, type AdminNamed, type FirstAdminPlan } from "./first-admin"
import { addressTaken, orgHosts } from "./hosts"
import {
  applicationAddresses,
  setupAddresses,
  takenAddress,
  type AddressSetup,
  type CreationAddresses,
  type OrgCreationHook,
} from "./org-creation"

/** Une organisation où l'appelant agit (N9) : il en est membre, ou y a un accès plateforme en cours. */
export type AdminOrg = {
  id: string
  slug: string
  name: string
  prefix: string
  createdAt: string
  access: "member" | "platform_access"
  /** Son rôle de membre ; `null` pour un accès plateforme. */
  role: MemberRole | null
  /** Membre depuis, ou accès accordé le. */
  since: string
  /** Qui a accordé l'accès ; `null` pour un membre. */
  grantedBy: string | null
}

/** Adresses, effectifs et accès plateforme en cours d'une organisation (AC14). */
export type OrgOverview = { hosts: string[]; members: number; teams: number; accesses: { userId: string; grantedAt: string }[] }

/** La fiche d'une organisation (AC14) ; les noms de ses six outils se déduisent de `prefix`. */
export type OrgSheet = {
  slug: string
  name: string
  prefix: string
  createdAt: string
  hosts: string[]
  domains: string | null
  brand: BrandInput
  routing: RoutingSettings
  flags: Record<string, Json | undefined>
  rulesVersion: number
  administrators: { name: string; email: string }[]
  contact: { name: string; email: string } | null
  /** Les accès en cours, puis les cinq derniers révoqués. */
  accesses: PlatformAccessView[]
}

export type OrgDraft = { slug: string; name: string; prefix: string; host: string | null }

/** Un champ réglé par `updateOrg`, avant et après ; `null` : aucune valeur. */
export type OrgChange = { field: string; before: string | number | null; after: string | number | null }

/** Accès révoqués montrés par la fiche (AC14). */
const REVOKED_SHOWN = 5

/**
 * Une ligne `members` ou un accès de l'appelant, avec les colonnes de son organisation, jointe sous RLS :
 * une organisation qu'il ne lit pas ne rend aucune ligne. Les dates en texte, comme PostgREST les rendait.
 */
type AccessRow = { org_id: string; since: string; slug: string; name: string; prefix: string; created_at: string }

function orgFields(row: AccessRow) {
  return { id: row.org_id, slug: row.slug, name: row.name, prefix: row.prefix, createdAt: row.created_at }
}

/**
 * Les organisations où l'appelant agit (AC14, N9), par slug : le filtre est dans la requête (ses lignes
 * `members`, ses accès en cours), jamais la seule RLS. Membre et titulaire d'un accès à la fois, il y
 * agit d'abord en membre, avec son rôle.
 */
export async function listOrgs(db: PlatformDb, staff: StaffCaller): Promise<AdminOrg[]> {
  const { memberships, grants } = await inTransaction(db, "listOrgs: members, platform_grants", async (sql) => ({
    memberships: await sql<(AccessRow & { role: string })[]>`
      select m.org_id, m.role, to_json(m.created_at) #>> '{}' as since,
             o.slug, o.name, o.prefix, to_json(o.created_at) #>> '{}' as created_at
        from platform.members m join platform.orgs o on o.id = m.org_id
       where m.user_id = ${staff.userId}`,
    // Un accès en cours au plus par organisation (`uq_platform_grants_open`) ; rangés par date.
    grants: await sql<(AccessRow & { granted_by: string | null })[]>`
      select g.org_id, g.granted_by, to_json(g.granted_at) #>> '{}' as since,
             o.slug, o.name, o.prefix, to_json(o.created_at) #>> '{}' as created_at
        from platform.platform_grants g join platform.orgs o on o.id = g.org_id
       where g.user_id = ${staff.userId} and g.revoked_at is null
       order by g.granted_at, g.id`,
  }))
  const orgs = new Map<string, AdminOrg>()
  for (const grant of grants) {
    orgs.set(grant.org_id, { ...orgFields(grant), access: "platform_access", role: null, since: grant.since, grantedBy: grant.granted_by })
  }
  for (const member of memberships) {
    orgs.set(member.org_id, { ...orgFields(member), access: "member", role: memberRole(member.role), since: member.since, grantedBy: null })
  }
  return [...orgs.values()].sort((a, b) => a.slug.localeCompare(b.slug))
}

type OverviewRow = OrgOverview & { id: string }

/**
 * Adresses, effectifs et accès en cours des organisations `orgIds`, en une lecture sous RLS : adresses
 * par nom, accès par identifiant, leur date en texte comme PostgREST la rendait.
 */
async function orgOverviews(db: PlatformDb, orgIds: readonly string[]): Promise<Map<string, OrgOverview>> {
  if (orgIds.length === 0) return new Map()
  const rows = await inTransaction(db, "listOrgOverviews: org_domains, members, teams, platform_grants", (sql) => sql<OverviewRow[]>`
    select o.id,
           (select coalesce(array_agg(d.host order by d.host), '{}') from platform.org_domains d where d.org_id = o.id) as hosts,
           (select count(*)::int from platform.members m where m.org_id = o.id) as members,
           (select count(*)::int from platform.teams t where t.org_id = o.id) as teams,
           (select coalesce(json_agg(json_build_object('userId', g.user_id, 'grantedAt', g.granted_at) order by g.id), '[]')
              from platform.platform_grants g where g.org_id = o.id and g.revoked_at is null) as accesses
      from unnest(${orgIds}::uuid[]) as o(id)`)
  return new Map(rows.map(({ id, ...overview }) => [id, overview]))
}

/**
 * Les organisations où l'appelant agit (`listOrgs`, qui pose le filtre) et le détail des `max`
 * premières (AC14) : aucune organisation n'est détaillée que la liste ne rende, décidé ici et jamais
 * par la RLS (H123). Le détail de toutes en une lecture, par leurs identifiants liés.
 */
export async function listOrgOverviews(
  db: PlatformDb,
  staff: StaffCaller,
  max: number,
): Promise<{ orgs: AdminOrg[]; overviews: Map<string, OrgOverview> }> {
  const orgs = await listOrgs(db, staff)
  const shown = orgs.slice(0, max)
  const read = await orgOverviews(
    db,
    shown.map((org) => org.id),
  )
  const overviews = new Map<string, OrgOverview>()
  for (const org of shown) {
    const overview = read.get(org.id)
    if (overview) overviews.set(org.id, overview)
  }
  return { orgs, overviews }
}

function record(value: Json | undefined): Record<string, Json | undefined> {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...value } : {}
}

/** La marque stockée, complète comme `updateBrand` l'attend : thème et logo par `readBrand`, nom affiché stocké ou null. */
function storedBrand(org: { name: string; brand: Json }): BrandInput {
  const { theme, logoUrl } = readBrand(org)
  const displayName = brandInputSchema.shape.display_name.safeParse(record(org.brand).display_name)
  return { theme, logo_url: logoUrl, display_name: displayName.success ? displayName.data : null }
}

type SheetRow = { slug: string; name: string; prefix: string; brand: Json; settings: Json; flags: Json; rules_version: number; created_at: string }

/** La fiche de l'organisation de l'identité (AC14), pour qui y agit. */
export async function getOrg(db: PlatformDb, identity: Identity): Promise<OrgSheet> {
  const orgId = identity.org.id
  const [[org], hosts, directory, contact, platform] = await Promise.all([
    inTransaction(db, "getOrg: orgs", (sql) => sql<SheetRow[]>`
      select slug, name, prefix, brand, settings, flags, rules_version, to_json(created_at) #>> '{}' as created_at
        from platform.orgs where id = ${orgId}`),
    orgHosts(db, orgId),
    memberDirectory(db, orgId),
    orgContact(db, orgId),
    listPlatformAccess(db, identity),
  ])
  // L'organisation de l'identité, supprimée entre-temps.
  if (!org) throw new PlatformError("not_found", "Not found.")
  const revoked = platform.accesses
    .filter((access) => access.revokedAt !== null)
    .sort((a, b) => String(b.revokedAt).localeCompare(String(a.revokedAt)))
  return {
    slug: org.slug,
    name: org.name,
    prefix: org.prefix,
    createdAt: org.created_at,
    hosts,
    domains: domainsOf(org.settings),
    brand: storedBrand(org),
    routing: routingSettings(org.settings),
    flags: record(org.flags),
    rulesVersion: org.rules_version,
    administrators: directory.filter((person) => person.role === "admin").map((person) => ({ name: person.name, email: person.email })),
    contact,
    accesses: [...platform.accesses.filter((access) => access.revokedAt === null), ...revoked.slice(0, REVOKED_SHOWN)],
  }
}

/** Le refus d'un `23505` de `create_org` ou `signup_org`, par sa contrainte (N24) ; `null` pour toute autre erreur. */
export async function createConflict(
  db: PlatformDb,
  error: { code?: string; message?: string },
  draft: OrgDraft,
  hosts: readonly string[],
): Promise<PlatformError | null> {
  switch (uniqueConstraint(error)) {
    case "orgs_slug_key":
      return new PlatformError("conflict", `Slug ${draft.slug} is already taken. Pick another slug.`)
    case "orgs_prefix_key":
      return new PlatformError(
        "conflict",
        `Prefix ${draft.prefix} is already used by another organisation. Pick another prefix: it names the tools (${draft.prefix}_context…) for good.`,
      )
    case "org_domains_pkey":
      // Prise entre les deux temps : relue, parce qu'une création peut en poser plusieurs (E09-S02).
      return (await takenAddress(db, hosts)) ?? addressTaken(hosts[0] ?? "")
    default:
      return null
  }
}

/**
 * Crée une organisation cliente, en deux temps (AC15, AC16, N8) : les adresses et le premier administrateur sont
 * vérifiés dès le premier ; sans `confirm`, rien n'est écrit. Confirmé, `create_org` (E01-S04) pose l'organisation,
 * sa racine, son Contexte, `private`, l'accès du créateur (`creation`, fiche D2) et les adresses. Seule
 * l'équipe plateforme crée : décidé ici (`requireStaff`) avant toute autre requête, la porte qui
 * l'appelle ne suffisant pas (H123) ; le contrôle `is_staff()` de `create_org` en est la seconde barrière.
 * Avec le point de l'hôte (E09-S02, `org-creation.ts`) : ses adresses aux deux temps, contrôlées comme
 * la première, puis `created` une fois l'organisation créée.
 * Premier administrateur (décision du 2026-10-14, `first-admin.ts`) : l'appelant lui-même devient membre `admin` dans
 * la transaction de `create_org` (`claim_org_admin`) ; une autre adresse est invitée `admin` une fois l'organisation
 * créée, le lien ramenant à une de ses adresses (`origin` : celle du MCP admin appelé, pour le protocole et le port).
 */
export async function createOrg(
  db: PlatformDb,
  staff: StaffCaller,
  input: unknown,
  { orgCreation, origin }: { orgCreation?: OrgCreationHook; origin: string },
): Promise<
  | { created: false; org: OrgDraft; firstAdmin: FirstAdminPlan; addresses?: CreationAddresses }
  | { created: true; org: OrgDraft & { id: string }; firstAdmin: FirstAdminOutcome; addresses?: CreationAddresses; setup?: AddressSetup[] | null }
> {
  const parsed = orgCreateSchema.safeParse(input)
  if (!parsed.success) throw invalidInput(parsed.error)
  await requireStaff(db, staff)
  const { org: slug, name, prefix, host, admin_email: adminEmail, confirm } = parsed.data
  const draft: OrgDraft = { slug, name, prefix, host: host ?? null }
  const passed = host ? [host] : []
  const takenHost = await takenAddress(db, passed)
  if (takenHost) throw takenHost
  const addresses = orgCreation ? await applicationAddresses(db, orgCreation, slug, passed) : undefined
  const hosts = addresses?.hosts ?? passed
  const withAddresses = addresses ? { addresses } : {}
  const plan = firstAdminPlan(staff, adminEmail, { slug, hosts, origin })
  if (confirm !== true) return { created: false, org: draft, firstAdmin: plan, ...withAddresses }
  // Sa propre transaction : un refus de `create_org` la perd, et `createConflict` relit dans une autre. Le créateur
  // nommé premier administrateur y devient membre : l'organisation n'existe jamais sans lui.
  const [row] = await db
    .tx(async (sql) => {
      const created = await sql<{ id: string }[]>`
        select platform.create_org(p_name => ${name}, p_slug => ${slug}, p_prefix => ${prefix}, p_hosts => ${hosts}::text[]) as id`
      if (plan.self && created[0]) await claimOrgAdmin(sql, created[0].id)
      return created
    })
    .catch(async (error: { code?: string; message?: string }) => {
      throw (await createConflict(db, error, draft, hosts)) ?? fromDatabaseError(error, `createOrg: create_org by ${staff.userId}`)
    })
  const org = { ...draft, id: row.id }
  const firstAdmin = await firstAdminOf(db, staff, slug, plan)
  if (!orgCreation) return { created: true, org, firstAdmin }
  return { created: true, org, firstAdmin, ...withAddresses, setup: await setupAddresses(orgCreation, slug, hosts) }
}

/** Le premier administrateur une fois l'organisation créée : sa place, son invitation, ou l'échec de celle-ci (`failure`). */
export type FirstAdminOutcome = AdminNamed | { email: string; self: false; outcome: "invitation_failed"; failure: string }

/**
 * Le premier administrateur d'une organisation créée : l'appelant, déjà membre (`create_org`) ; sinon l'invitation, par
 * l'accès `creation` de l'appelant (`resolveAdminOrg`). L'organisation reste créée quand l'invitation échoue : le refus
 * est rendu dans le résultat, jamais levé, pour que la création ne se rejoue pas sur un slug pris.
 */
async function firstAdminOf(db: PlatformDb, staff: StaffCaller, slug: string, plan: FirstAdminPlan): Promise<FirstAdminOutcome> {
  if (plan.self) return { email: plan.email, self: true, outcome: "joined" }
  try {
    return await inviteAdmin(db, await resolveAdminOrg(db, staff, slug), plan.email, plan.link)
  } catch (error) {
    if (!isPlatformError(error)) console.error(`[platform] createOrg: ${slug} created, inviting its first administrator failed`, error)
    const failure = isPlatformError(error) && error.message !== "Internal error." ? error.message : "Internal error."
    return { email: plan.email, self: false, outcome: "invitation_failed", failure }
  }
}

/** `settings` avec les domaines de travail (N10) et les seuils de routage (N12) passés, les autres clés gardées. */
function mergedSettings(stored: Json, input: OrgSettings, note: (change: OrgChange) => void): Json {
  const settings = record(stored)
  if (input.domains !== undefined) {
    note({ field: "domains", before: domainsOf(stored) || null, after: input.domains || null })
    settings.domains = input.domains || undefined
  }
  if (input.routing_threshold === undefined && input.routing_gap === undefined) return settings
  const current = routingSettings(stored)
  const routing = record(settings.routing)
  if (input.routing_threshold !== undefined) {
    note({ field: "routing_threshold", before: current.threshold, after: input.routing_threshold })
    routing.threshold = input.routing_threshold
  }
  if (input.routing_gap !== undefined) {
    note({ field: "routing_gap", before: current.gap, after: input.routing_gap })
    routing.gap = input.routing_gap
  }
  return { ...settings, routing }
}

// Réglages portés par la ligne `orgs` (nom et `settings`), et par la marque, que seul `updateBrand` écrit (N19).
const ROW_FIELDS = ["name", "domains", "routing_threshold", "routing_gap"] as const
const BRAND_FIELDS = ["theme", "logo_url", "display_name"] as const

type SettingsRow = { name: string; brand: Json; settings: Json; updated_at: string }

/**
 * Règle l'organisation de l'identité (AC17), réservé à qui l'administre (`isOrgAdmin`), décidé avant
 * toute lecture : nom et `settings` en une écriture sous garde `updated_at` (zéro ligne : `conflict`),
 * puis la marque complète par `updateBrand` d'E09-S01, champs non passés repris de la marque stockée.
 * Lecture et deux écritures dans une transaction, que `updateBrand` reprend (HN-E01S10-7) : l'échec de
 * l'une n'en laisse aucune (AC-x4 d'E01-S10).
 */
export async function updateOrg(db: PlatformDb, identity: Identity, input: unknown): Promise<{ changes: OrgChange[] }> {
  const parsed = orgSettingsSchema.safeParse(input)
  if (!parsed.success) throw invalidInput(parsed.error)
  if (!isOrgAdmin(identity)) {
    const who = await describeOwner(db, identity, { kind: "org", teamId: null, userId: null })
    throw new PlatformError("forbidden", `Changing the settings of ${identity.org.slug} is reserved to ${who}. Ask them.`)
  }
  const values = parsed.data
  const orgId = identity.org.id
  return inTransaction(db, "updateOrg: orgs", async (sql) => {
    // `updated_at` en texte, comparé converti dans la requête : une `Date` en perdrait les microsecondes.
    const [current] = await sql<SettingsRow[]>`select name, brand, settings, updated_at::text as updated_at from platform.orgs where id = ${orgId}`
    if (!current) throw new PlatformError("not_found", "Not found.")
    const changes: OrgChange[] = []
    const note = (change: OrgChange) => changes.push(change)

    if (ROW_FIELDS.some((field) => values[field] !== undefined)) {
      if (values.name !== undefined) note({ field: "name", before: current.name, after: values.name })
      const settings = mergedSettings(current.settings, values, note)
      const written = await sql`
        update platform.orgs set name = coalesce(${values.name ?? null}, name), settings = ${sql.json(settings)}
         where id = ${orgId} and updated_at = ${current.updated_at}::text::timestamptz
        returning id`
      const changed = `${identity.org.slug} changed meanwhile: read it again with admin_org {"op": "get"} and retry.`
      if (written.length === 0) throw changedMeanwhile("updateOrg", orgId, changed)
    }
    if (BRAND_FIELDS.some((field) => values[field] !== undefined)) {
      const stored = storedBrand(current)
      const brand: BrandInput = {
        theme: values.theme ?? stored.theme,
        logo_url: values.logo_url === undefined ? stored.logo_url : values.logo_url,
        display_name: values.display_name === undefined ? stored.display_name : values.display_name,
      }
      for (const field of BRAND_FIELDS) if (values[field] !== undefined) note({ field, before: stored[field], after: brand[field] })
      await updateBrand(db, identity, brand)
    }
    return { changes }
  })
}
