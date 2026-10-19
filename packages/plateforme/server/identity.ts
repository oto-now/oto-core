// Qui appelle, et pour quelle organisation. L'organisation vient de l'adresse appelée, jamais du
// jeton ; l'appartenance est relue en base à chaque résolution (ADR-004). Sans ce module, écrans,
// API et MCP résoudraient chacun l'organisation.
//
// Repris de la maquette (`mcp-test/src/proto/identity.ts` l. 44-91) : forme de l'identité, tri
// des équipes par nom, repli du nom sur l'email. Retiré : le segment d'URL `u/<slug>`, les droits
// (calculés par `access-levels.ts`, E01-S07), les connecteurs par équipe, l'équipe par défaut (E05-S13,
// fiche D128 : plus rien ne la lit).
//
// Face SQL (E01-S10, partie e1a) : chaque lecture passe par `db.tx`, sous l'appelant de la session
// (ou `anon` pour le client sans session, `resolveOrg` des pages publiques) ; `resolveIdentity` tient
// ses lectures en une transaction (HN-E01S10-2).
import { linkOrigin, normalizeHost } from "../schemas/link-origin"
import type { Json } from "./database"
import type { PlatformDb } from "./db"
import { fromDatabaseError, inTransaction, isPlatformError, PlatformError } from "./errors"
import { isJsonObject } from "./json"
import { enterOrg } from "./open-entry"
import type { Tx } from "./sql"

/** Ce qu'il faut des en-têtes d'une requête : `Headers`, ou ceux de `next/headers`. */
export type HeadersLike = { get(name: string): string | null }

export type IdentityOrg = {
  id: string
  slug: string
  name: string
  prefix: string
  brand: Json
  /** Domaines de travail en texte libre (`settings.domains`), pas les adresses. */
  domains: string | null
}

export type MemberRole = "admin" | "member"

/**
 * `members.profile` tel que les services le lisent (P39 : ton et préférences ne sont plus lus) ; prénom, nom
 * de famille et couleur depuis E05-S11 (page « Profil »). Des chaînes telles qu'enregistrées : langue et
 * thème se valident à la lecture (`server/language.ts`).
 */
export type MemberProfile = { name?: string; first_name?: string; last_name?: string; handle?: string; language?: string; theme?: string }

export type IdentityTeam = {
  id: string
  slug: string
  name: string
  /** Son rôle dans l'équipe (`team_members.role`, seule source des responsables depuis E05-S13). */
  role: "lead" | "member"
}

export type Identity = {
  org: IdentityOrg
  user: { id: string; email: string; name: string }
  member: { role: MemberRole; profile: MemberProfile }
  /** Les équipes de la personne, par nom (E05-S13, fiche D128). */
  teams: IdentityTeam[]
  /** Membre de l'équipe plateforme (`platform_staff`, H73), dans cette organisation ou non. */
  isStaff: boolean
  /**
   * Entré sans ligne `members`, par un accès plateforme en cours (`platform_grants`, fiche D2) :
   * il agit en administrateur, sauf sur les espaces personnels (H73).
   */
  viaGrant: boolean
  /**
   * Accès plateforme en cours à l'organisation (`platform_grants`, `revoked_at` nul), lu pour tout
   * membre de l'équipe plateforme, membre de l'organisation ou non (HN-E01S07-2) : avec `isStaff`,
   * il fait l'administrateur de `isOrgAdmin` (`access.ts`), comme `platform.is_org_admin`.
   */
  hasOpenGrant: boolean
}

// `normalizeHost` vit avec `linkOrigin` (`schemas/link-origin.ts`), que le middleware de l'hôte lit sans la face server.
export { normalizeHost }

/**
 * Hôte tel que le navigateur l'a appelé, port compris : premier élément de `x-forwarded-host`
 * (derrière un proxy), sinon `host`.
 */
export function rawRequestHost(headers: HeadersLike): string | null {
  const forwarded = headers.get("x-forwarded-host")?.split(",")[0]?.trim()
  const host = forwarded || headers.get("host")?.trim()
  return host || null
}

/** Hôte normalisé de la requête, celui qui désigne l'organisation. */
export function requestHost(headers: HeadersLike): string | null {
  return normalizeHost(rawRequestHost(headers))
}

/**
 * L'adresse à servir, choisie par l'hôte de l'application à la place de l'adresse appelée (previews aux adresses
 * changeantes, ERP sur un seul domaine) : il reçoit l'adresse appelée, normalisée, et la requête quand il y en a une
 * (le consentement n'en a pas : il lit l'adresse de la ressource demandée). `null` : aucune organisation. L'organisation
 * reste lue dans `org_domains` et l'appartenance revérifiée à chaque appel : seule la source de l'adresse change.
 */
export type ServedHost = (called: { host: string | null; request?: Request }) => string | null | Promise<string | null>

/** L'adresse servie : celle que rend `choose`, normalisée comme une adresse appelée ; sans `choose`, l'adresse appelée. Une exception de l'hôte remonte. */
export async function servedHost(choose: ServedHost | undefined, called: { host: string | null; request?: Request }): Promise<string | null> {
  return choose ? normalizeHost(await choose(called)) : called.host
}

/**
 * Origine appelée par le navigateur : `x-forwarded-proto` (derrière un proxy), sinon le protocole
 * donné, et l'hôte brut. Sert au contrôle d'`Origin` des mutations, comparé à ce que le navigateur
 * envoie, et aux adresses du MCP admin ; jamais au lien d'un email, qui part de `trustedRequestOrigin`
 * ou de l'hôte qui a résolu l'identité (`linkOrigin`). Un proxy peut transmettre le
 * `x-forwarded-proto` du client : seuls `http` et `https` en sont lus, sinon le protocole donné.
 */
export function requestOrigin(headers: HeadersLike, host: string, fallbackProtocol: string): string {
  const forwarded = headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase()
  const protocol = forwarded === "http" || forwarded === "https" ? forwarded : fallbackProtocol
  return `${protocol}://${host}`.toLowerCase()
}

/**
 * Ce que l'hôte de l'application passe à `trustedRequestOrigin` : ses adresses d'entrée, celles qui ne servent aucune
 * organisation mais d'où partent des liens (son adresse commune, la page qui liste les organisations d'une personne). Des
 * noms d'hôte, normalisés comme une adresse appelée (port ignoré).
 */
export type TrustedOriginOptions = { entryHosts?: readonly string[] }

/** Au-delà, l'hôte refusé est coupé au log : un en-tête de la requête n'y entre jamais en entier. */
const LOGGED_HOST_MAX = 100

/**
 * L'origine des liens que le serveur envoie hors de la requête (lien de connexion, réinitialisation, retour d'un
 * fournisseur d'identité, émetteur OIDC) : `linkOrigin` de l'hôte appelé, en `https` hors du poste local, si cet hôte
 * sert une organisation (`org_by_host` sous `db`, le client sans session de `resolveOrg`) ou figure parmi les adresses
 * d'entrée de l'hôte. Sinon `null`, journalisé : derrière un proxy qui transmet `x-forwarded-host` tel quel, le lien
 * d'un email demandé pour autrui mènerait chez qui a forgé l'en-tête. Une panne de la base remonte.
 */
export async function trustedRequestOrigin(db: PlatformDb, headers: HeadersLike, options: TrustedOriginOptions = {}): Promise<string | null> {
  const raw = rawRequestHost(headers)
  const host = normalizeHost(raw)
  const origin = linkOrigin(raw)
  if (host && origin && (isEntryHost(host, options.entryHosts ?? []) || (await servesOrg(db, host)))) return origin
  // Normalisé, coupé et échappé (`JSON.stringify`) : ni retour à la ligne ni en-tête entier au log.
  console.error(`[platform] trustedRequestOrigin: no link built, ${JSON.stringify(host?.slice(0, LOGGED_HOST_MAX) ?? null)} serves no organisation and is not an entry address`)
  return null
}

function isEntryHost(host: string, entryHosts: readonly string[]): boolean {
  return entryHosts.some((entry) => normalizeHost(entry) === host)
}

/** L'hôte sert-il une organisation ? `resolveOrg`, dont seul `unknown_org` vaut « non » ; toute autre erreur remonte. */
async function servesOrg(db: PlatformDb, host: string): Promise<boolean> {
  try {
    await resolveOrg(db, host)
    return true
  } catch (error) {
    if (isPlatformError(error) && error.code === "unknown_org") return false
    throw error
  }
}

/** Organisation servie à cette adresse, ou `unknown_org`. */
export async function resolveOrg(db: PlatformDb, host: string | null): Promise<IdentityOrg> {
  const normalized = normalizeHost(host)
  if (!normalized) throw new PlatformError("unknown_org", "No organisation is served at this address.")
  const [row] = await inTransaction(
    db,
    "resolveOrg: org_by_host",
    (sql) => sql<IdentityOrg[]>`select id, slug, name, prefix, brand, domains from platform.org_by_host(${normalized})`,
  )
  if (!row) throw new PlatformError("unknown_org", `No organisation is served at ${normalized}.`)
  return { id: row.id, slug: row.slug, name: row.name, prefix: row.prefix, brand: row.brand, domains: row.domains }
}

/** À qui demander d'entrer : l'admin le plus ancien (H13), ou `null` sans admin. */
export async function orgContact(db: PlatformDb, orgId: string): Promise<{ name: string; email: string } | null> {
  const [row] = await inTransaction(
    db,
    "orgContact: org_contact",
    (sql) => sql<{ name: string; email: string }[]>`select name, email from platform.org_contact(${orgId})`,
  )
  return row ? { name: row.name, email: row.email } : null
}

/** Rôle d'une ligne `members` (colonne texte sous contrainte `check`). */
export function memberRole(value: string): MemberRole {
  return value === "admin" ? value : "member"
}

/** Rôle d'une ligne `team_members` (colonne texte sous contrainte `check`). */
export function teamRole(value: string): IdentityTeam["role"] {
  return value === "lead" ? value : "member"
}

function memberProfile(value: Json): MemberProfile {
  if (!isJsonObject(value)) return {}
  const profile: MemberProfile = {}
  for (const key of ["name", "first_name", "last_name", "handle", "language", "theme"] as const) {
    const field = value[key]
    if (typeof field === "string" && field) profile[key] = field
  }
  return profile
}

type TeamRow = { id: string; slug: string; name: string }

function identityTeams(rows: TeamRow[], memberships: { team_id: string; role: string }[]): IdentityTeam[] {
  const roles = new Map(memberships.map((row) => [row.team_id, row.role]))
  return rows
    .filter((row) => roles.has(row.id))
    .map((row) => ({ id: row.id, slug: row.slug, name: row.name, role: teamRole(roles.get(row.id) ?? "member") }))
    .sort((a, b) => a.name.localeCompare(b.name, "fr"))
}

/** Le refus d'une personne connectée qui n'entre pas dans l'organisation : à qui demander. */
function notMember(org: IdentityOrg, email: string): PlatformError {
  return new PlatformError(
    "not_member",
    `You are signed in as ${email} but you are not a member of ${org.name}. Ask an administrator of ${org.name} to add you.`,
  )
}

/**
 * La personne de la session, telle que la base l'a traduite (E01-S11) : son identifiant interne
 * (`auth.uid()`, nul quand la traduction n'en rend aucun) et le genre de l'émetteur de son jeton.
 */
async function sessionPerson(sql: Tx): Promise<{ userId: string | null; kind: string | null }> {
  const [row] = await sql<{ id: string | null; kind: string | null }[]>`select auth.uid() as id, auth.jwt() ->> 'issuer_kind' as kind`
  return { userId: row?.id ?? null, kind: row?.kind ?? null }
}

/**
 * L'identité de l'appelant dans l'organisation de l'adresse. Lève `unknown_org` (adresse sans
 * organisation) ou `not_member` (connecté, mais ni membre ni staff avec un accès en cours) : les
 * deux portes les rendent tels quels, l'écran « aucune organisation » les traduit. Un membre de
 * l'équipe plateforme entré par un accès en cours reçoit une identité d'administrateur, sans
 * équipe (`viaGrant`, H73). Une seule transaction : `resolveOrg` et `identityInOrg` y reprennent la
 * leur (HN-E01S10-7).
 *
 * `caller.userId` : l'identifiant interne quand l'appelant le connaît déjà (outillage) ; sans lui,
 * celui de la session, que la base a traduit (E01-S11) : sans identifiant, `not_member` (AC-a5). Un
 * appelant d'un émetteur OIDC sans ligne `members` dans l'organisation voit d'abord ses invitations en
 * attente acceptées (`accept_invitations`, AC-a4) : il n'est passé par aucun écran pour les accepter.
 * `caller.email` : le texte du refus et le nom de repli.
 *
 * Une personne de la session refusée `not_member` tente l'entrée sans invitation de l'organisation (`enterOrg`,
 * `open_entry`) : admise, elle devient membre et son identité se relit ; sinon le refus reste le même, sauf au plafond
 * de membres, qui se dit (`forbidden`, `reason: "limit"`). Un membre ne paie aucune lecture de plus.
 */
export async function resolveIdentity(
  db: PlatformDb,
  host: string | null,
  caller: { userId?: string; email: string },
): Promise<Identity> {
  const first = await identityAtHost(db, host, caller)
  if ("identity" in first) return first.identity
  // L'outillage qui nomme la personne ne la fait pas entrer : seule une session, dont la base lit l'email vérifié.
  if (caller.userId || !(await enterOrg(db, first.org))) throw first.refusal
  const second = await identityAtHost(db, host, caller)
  if ("identity" in second) return second.identity
  throw second.refusal
}

/** L'identité à cette adresse, ou le refus `not_member` et l'organisation qu'il vise ; `unknown_org` et les pannes lèvent. */
async function identityAtHost(
  db: PlatformDb,
  host: string | null,
  caller: { userId?: string; email: string },
): Promise<{ identity: Identity } | { refusal: PlatformError; org: IdentityOrg }> {
  return inTransaction(db, "resolveIdentity", async (sql) => {
    const org = await resolveOrg(db, host)
    const refused = (error: unknown) => {
      if (isPlatformError(error) && error.code === "not_member") return { refusal: error, org }
      throw error
    }
    if (caller.userId) return identityInOrg(db, org, { userId: caller.userId, email: caller.email }).then((identity) => ({ identity }), refused)
    const person = await sessionPerson(sql)
    if (!person.userId) return { refusal: notMember(org, caller.email), org }
    if (person.kind === "oidc") {
      // Une instruction : l'acceptation ne court que sans ligne `members` visible dans l'organisation.
      await sql`select platform.accept_invitations()
                 where not exists (select 1 from platform.members where org_id = ${org.id} and user_id = ${person.userId})`
    }
    return identityInOrg(db, org, { userId: person.userId, email: caller.email }).then((identity) => ({ identity }), refused)
  })
}

type MemberRow = { role: string; profile: Json }

/**
 * Ce que l'identité lit de la personne dans l'organisation, en une fois : sa ligne `members`, les
 * équipes de l'organisation, ses appartenances et leur rôle, et sa ligne `platform_staff`. `platform_staff` se lit
 * sous RLS : le staff y voit sa ligne, les autres rien (même réponse que `platform.is_staff()`).
 * Toutes les équipes de l'organisation, rangées par id comme la lecture par pages qui les rendait
 * (le tri par nom garde cet ordre entre homonymes) : le calcul des niveaux en tire celles de la
 * personne. Une lecture en échec lève : la transaction s'arrête à elle, et les suivantes, parties
 * avec elle, n'ajoutent rien au log.
 */
async function personInOrg(sql: Tx, orgId: string, userId: string) {
  const [members, teams, memberships, staff] = await Promise.all([
    sql<MemberRow[]>`select role, profile from platform.members where org_id = ${orgId} and user_id = ${userId}`,
    sql<TeamRow[]>`select id, slug, name from platform.teams where org_id = ${orgId} order by id`,
    sql<{ team_id: string; role: string }[]>`select team_id, role from platform.team_members where user_id = ${userId}`,
    sql<{ user_id: string }[]>`select user_id from platform.platform_staff where user_id = ${userId}`,
  ]).catch((error) => {
    throw fromDatabaseError(error, "resolveIdentity: members, teams, team_members, platform_staff")
  })
  return { member: members[0] ?? null, teams, memberships, isStaff: staff.length > 0 }
}

/** Un accès plateforme en cours de l'appelant à l'organisation (fiche D2) ; lu sous RLS par le staff. */
async function hasOpenGrant(sql: Tx, orgId: string, userId: string): Promise<boolean> {
  const rows = await sql`select id from platform.platform_grants
                          where org_id = ${orgId} and user_id = ${userId} and revoked_at is null limit 1`.catch((error) => {
    throw fromDatabaseError(error, "resolveIdentity: platform_grants")
  })
  return rows.length > 0
}

/**
 * L'identité de l'appelant dans une organisation déjà désignée : par l'adresse (`resolveIdentity`),
 * ou par son slug au MCP admin (`resolveAdminOrg`, E08-S02). Personne, rôle, équipes, `isStaff`,
 * `viaGrant`, `hasOpenGrant` ; lève `not_member` (ni membre ni staff avec un accès en cours).
 */
export async function identityInOrg(
  db: PlatformDb,
  org: IdentityOrg,
  caller: { userId: string; email: string },
): Promise<Identity> {
  return inTransaction(db, "resolveIdentity", async (sql) => {
    const { member, teams, memberships, isStaff } = await personInOrg(sql, org.id, caller.userId)
    const openGrant = isStaff && (await hasOpenGrant(sql, org.id, caller.userId))
    const viaGrant = !member && openGrant
    if (!member && !viaGrant) throw notMember(org, caller.email)
    const profile = member ? memberProfile(member.profile) : {}
    const role: MemberRole = member ? memberRole(member.role) : "admin"
    return {
      org,
      user: { id: caller.userId, email: caller.email, name: profile.name ?? caller.email.split("@")[0] },
      member: { role, profile },
      teams: identityTeams(teams, memberships),
      isStaff,
      viaGrant,
      hasOpenGrant: openGrant,
    }
  })
}
