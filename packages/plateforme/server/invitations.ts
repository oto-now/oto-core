// Inviter, lister, révoquer, accepter (E02-S01). L'email d'invitation est le lien magique de
// Supabase, demandé avec la clé publique de l'hôte par un client Supabase Auth sans session (fiche
// D1, option B ; E01-S10, AC-e1b) : aucune clé de service ici. En mode OIDC, l'email de la
// plateforme, par le relais SMTP de l'hôte (`mail.ts`, E01-S11 a2). Les droits et les filtres se décident
// ici, avant la requête (`isOrgAdmin`, `leadsTeam` : E01-S07) ; la RLS n'est qu'un garde-fou, et le
// déclencheur `invitations_guard` tient les invariants d'état (`already_member`, `already_invited`).
// La base se lit et s'écrit par la face SQL (`db.tx`, E01-S10 partie e1b) : une transaction par
// opération, jamais ouverte pendant l'envoi de l'email ; les dates rendues ont la forme que PostgREST
// leur donnait (`to_json`), celle que lisent l'API et les écrans.
//
// Repris d'Oto (`org_store/invitations.py`, `capabilities/orgs/invites.py`) : 7 jours, un seul
// critère « en attente », doublons `already_member` / `already_invited`, jamais de rétrogradation,
// rôles rendus = rôles écrits. Retiré : jeton maison dans l'URL, organisation personnelle, refus
// par l'invité (hors V1, N5), acceptation sans email vérifié.
import { createClient } from "@supabase/supabase-js"
import * as z from "zod/v4"
import {
  invitationIdSchema,
  inviteSchema,
  listInvitationsQuerySchema,
  type Invite,
  type InvitationRole,
  type InvitationState,
} from "../schemas"
import { isOrgAdmin, leadsTeam } from "./access"
import { readBrand } from "./brand"
import type { PlatformDb } from "./db"
import { fromDatabaseError, inTransaction, isPlatformError, PlatformError } from "./errors"
import { memberRole, type Identity, type MemberRole } from "./identity"
import { oidcMode } from "./issuer"
import { orgLimits, requireUnderLimit } from "./limits"
import { invitationMail, mailSender, type MailContent } from "./mail"
import { PlatformConfigError } from "./sql"

/** Au plus autant d'invitations listées : l'écran les montre toutes, sans pagination (V1). */
const MAX_LISTED_INVITATIONS = 200

type InvitationTeamOption = { id: string; slug: string; name: string }

/** Ce que l'appelant peut proposer dans le formulaire d'invitation (AC18). */
export type InvitationOptions = {
  roles: InvitationRole[]
  teams: InvitationTeamOption[]
  teamRequired: boolean
}

type CreatedInvitation = {
  id: string
  email: string
  role: InvitationRole
  teamId: string | null
  /** `null` : une inscription sans email (`registerInvitation`), qui n'expire pas. */
  expiresAt: string | null
}

/** Une invitation partie par email : elle porte toujours son échéance, la valeur par défaut de la colonne. */
type EmailedInvitation = CreatedInvitation & { expiresAt: string }

type Invitation = {
  id: string
  email: string
  role: InvitationRole
  teamId: string | null
  invitedBy: string | null
  createdAt: string
  expiresAt: string | null
  state: InvitationState
}

type JoinedOrg = { orgId: string; slug: string; name: string; role: MemberRole }

function invalidArguments(error: z.ZodError): PlatformError {
  const issue = error.issues[0]
  const field = issue?.path.join(".") || "input"
  return new PlatformError("invalid_arguments", `Invalid ${field}: ${issue?.message ?? "invalid value"}.`)
}

export function invitationRole(value: string): InvitationRole {
  return value === "admin" ? "admin" : "member"
}

/**
 * Rôles et équipes que l'appelant peut proposer : l'administrateur (`isOrgAdmin`, staff avec un
 * accès en cours compris), les deux rôles et toutes les équipes ; le responsable d'équipe
 * (`leadsTeam`), le rôle membre dans les équipes qu'il dirige (H72) ; les autres, `forbidden`
 * (`not_allowed`).
 */
export async function invitationOptions(db: PlatformDb, identity: Identity): Promise<InvitationOptions> {
  const teams = await inTransaction(
    db,
    "invitationOptions: teams",
    (sql) => sql<InvitationTeamOption[]>`select id, slug, name from platform.teams where org_id = ${identity.org.id}`,
  )
  // Tri en mémoire, en français, comme les équipes de l'identité : l'ordre ne dépend pas de la
  // collation de la base de l'hôte, et aucun `order` ne porte sur `teams.name`, que rien n'indexe.
  const rows = [...teams].sort((a, b) => a.name.localeCompare(b.name, "fr"))
  const option = (row: InvitationTeamOption) => ({ id: row.id, slug: row.slug, name: row.name })

  if (isOrgAdmin(identity)) {
    return { roles: ["member", "admin"], teams: rows.map(option), teamRequired: false }
  }
  const led = rows.filter((row) => leadsTeam(identity, row.id))
  if (led.length === 0) {
    throw new PlatformError("forbidden", "Only administrators and team leads can invite people.", {
      reason: "not_allowed",
    })
  }
  return { roles: ["member"], teams: led.map(option), teamRequired: true }
}

function insertError(error: { code?: string; message?: string }, email: string, orgName: string): PlatformError {
  // Le déclencheur `invitations_guard` lève `23505` avec la raison pour seul message : on la lit
  // pour nommer le refus, on ne recopie jamais le texte de la base.
  if (error.code === "23505" && error.message?.includes("already_member")) {
    return new PlatformError("conflict", `${email} is already a member of ${orgName}.`, { reason: "already_member" })
  }
  if (error.code === "23505" && error.message?.includes("already_invited")) {
    return new PlatformError("conflict", `An invitation is already pending for ${email}. Revoke it to send another.`, {
      reason: "already_invited",
    })
  }
  return fromDatabaseError(error, "inviteMember: invitations insert")
}

/**
 * Retire l'invitation dont l'email n'est pas parti, dans sa propre transaction : l'envoi s'est fait
 * hors de toute transaction (`supabase-patterns.md § Couplage à Supabase (ADR-012)`).
 */
async function withdraw(db: PlatformDb, id: string): Promise<void> {
  await db
    .tx((sql) => sql`update platform.invitations set revoked_at = ${new Date()} where id = ${id}`)
    .catch((error: unknown) => {
      // Rare (panne juste après l'insertion) : l'invitation reste en attente sans email et bloque une
      // nouvelle invitation de l'adresse (`already_invited`). Le log la nomme pour qu'on la révoque.
      const code = error instanceof Error && "code" in error ? error.code : undefined
      console.error(`[platform] inviteMember: invitation ${id} stays pending without an email; withdrawing it failed`, code)
    })
}

/**
 * Le client Supabase Auth qui envoie le lien magique (E01-S10, AC-e1b) : l'URL et la clé publique de
 * l'hôte, sans session ni jeton ; la clé publique suffit, le hook « Before User Created » filtre les
 * adresses (fiches D1 et D13). Construit ici, pas tiré de `db` : la face PostgREST part à la partie
 * f2, Supabase Auth reste (implémentation Supabase du port, ADR-012 § 1). Une variable manquante est
 * nommée, jamais sa valeur.
 */
function magicLinkAuth() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url) throw new PlatformConfigError("NEXT_PUBLIC_SUPABASE_URL manquante dans l'environnement de l'hôte")
  if (!anonKey) throw new PlatformConfigError("NEXT_PUBLIC_SUPABASE_ANON_KEY manquante dans l'environnement de l'hôte")
  return createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }).auth
}

type CreatedRow = { id: string; email: string; role: string; team_id: string | null; expires_at: string | null }

/** Le refus d'un email qui n'est pas parti, l'invitation retirée (AC17, AC-a8b). */
const EMAIL_NOT_SENT = "The invitation email could not be sent; the invitation was withdrawn. Try again."

/**
 * L'envoi de l'email d'une invitation, préparé avant son insertion : une configuration qui manque
 * refuse avant qu'aucune invitation n'existe. Rend, après l'envoi, le refus à servir une fois
 * l'invitation retirée, ou `null`.
 */
type InvitationEmail = (email: string) => Promise<PlatformError | null>

/**
 * Le lien magique de Supabase (`shouldCreateUser: true` : le hook « Before User Created » laisse créer
 * le compte d'une adresse invitée), qui ramène à `redirectTo`.
 */
function magicLinkEmail(redirectTo: string): InvitationEmail {
  const auth = magicLinkAuth()
  return async (email) => {
    const { error } = await auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: redirectTo } })
    if (!error) return null
    console.error("[platform] inviteMember: signInWithOtp failed", error.status)
    if (error.status === 429) {
      return new PlatformError("conflict", `An email was sent to ${email} moments ago; the invitation was withdrawn. Try again in a minute.`, {
        reason: "email_rate_limited",
      })
    }
    return new PlatformError("internal", EMAIL_NOT_SENT)
  }
}

/** L'origine d'une adresse, `""` quand elle est illisible : `invitationMail` la refuse alors. */
function originOf(address: string): string {
  try {
    return new URL(address).origin
  } catch {
    // Illisible : aucune origine, et l'email refusé avant l'invitation.
    return ""
  }
}

/**
 * Mode OIDC (E01-S11 a2, AC-a8) : l'email de la plateforme, envoyé par le relais SMTP de l'hôte, à la
 * marque de l'organisation (`readBrand`) et au nom de qui invite s'il est connu, avec le lien
 * `<origine>/login` sur l'adresse d'où l'on invite, celle de `redirectTo` (hypothèse N2). Les variables
 * du relais et le modèle se contrôlent ici, avant l'insertion ; chaque refus part au log.
 */
function platformEmail(identity: Identity, to: string, redirectTo: string): InvitationEmail {
  const send = mailSender()
  let content: MailContent
  try {
    content = invitationMail({ to, brand: readBrand(identity.org), inviterName: identity.member.profile.name ?? null, origin: originOf(redirectTo) })
  } catch (error) {
    // Le modèle est pur et n'écrit rien : son refus (une origine ni `http:` ni `https:`) part au log ici.
    console.error("[platform] inviteMember: invitation email refused before the invitation, the request origin is not http(s)")
    throw error
  }
  return async () => {
    try {
      await send(content)
      return null
    } catch (error) {
      // `mailSender` a écrit au log le code du relais, jamais son adresse ; une autre erreur remonte.
      if (!isPlatformError(error)) throw error
      return new PlatformError("internal", EMAIL_NOT_SENT)
    }
  }
}

/**
 * Le droit d'inviter `invite` (rôle et équipe), décidé avant toute écriture par `invitationOptions` : seul un
 * administrateur invite un administrateur ; un responsable d'équipe invite dans une équipe qu'il mène.
 */
async function authorizeInvitation(db: PlatformDb, identity: Identity, invite: Invite): Promise<void> {
  const allowed = await invitationOptions(db, identity)
  if (!allowed.roles.includes(invite.role)) {
    throw new PlatformError("forbidden", "Only an administrator can invite an administrator.", {
      reason: "admin_role_reserved",
    })
  }
  const inAllowedTeam = invite.teamId !== undefined && allowed.teams.some((team) => team.id === invite.teamId)
  if (allowed.teamRequired && !inAllowedTeam) {
    throw new PlatformError("forbidden", "Choose a team you lead.", { reason: "team_required" })
  }
  if (invite.teamId !== undefined && !inAllowedTeam) {
    throw new PlatformError("invalid_arguments", `Unknown team ${invite.teamId} in ${identity.org.name}.`)
  }
}

/**
 * L'invitation écrite, au plafond de `members_max` (invitations en attente comprises) refusée avant l'insertion (E12-S02) :
 * les limites de l'hôte lues avant la transaction, le refus au plafond en tête de celle-ci (`requireUnderLimit`).
 * `registered` : une inscription sans email, sans échéance, qui révoque d'abord dans la même transaction l'attente
 * qu'elle remplace (`replacing`) ; un refus de l'insertion annule la révocation. Sans lui, l'échéance par défaut.
 */
async function insertInvitation(db: PlatformDb, identity: Identity, invite: Invite, registered?: { replacing?: string }): Promise<CreatedRow> {
  const limits = await orgLimits(identity.org)
  return db
    .tx(async (sql) => {
      if (registered?.replacing) await revokeInvitation(db, identity, registered.replacing)
      await requireUnderLimit(sql, { db, identity, limits }, "members_max")
      return sql<CreatedRow[]>`
        insert into platform.invitations (org_id, email, role, team_id, invited_by, expires_at)
        values (${identity.org.id}, ${invite.email}, ${invite.role}, ${invite.teamId ?? null}, ${identity.user.id}, ${registered ? sql`null` : sql`default`})
        returning id, email, role, team_id, to_json(expires_at) as expires_at`
    })
    .then(([row]) => row, (error) => Promise.reject(insertError(error, invite.email, identity.org.name)))
}

function createdInvitation(data: CreatedRow): CreatedInvitation {
  return { id: data.id, email: data.email, role: invitationRole(data.role), teamId: data.team_id, expiresAt: data.expires_at }
}

function emailedInvitation(data: CreatedRow): EmailedInvitation {
  if (data.expires_at === null) throw new Error("[platform] inviteMember: an emailed invitation without its expiry")
  return { ...createdInvitation(data), expiresAt: data.expires_at }
}

function parsedInvite(input: unknown): Invite {
  const parsed = inviteSchema.safeParse(input)
  if (!parsed.success) throw invalidArguments(parsed.error)
  return parsed.data
}

/**
 * Invite une personne dans l'organisation de l'identité, puis envoie l'email : le lien magique de
 * Supabase, ou, en mode OIDC, l'email de la plateforme (E01-S11 a2). Un email qui ne part pas retire
 * l'invitation : aucune ligne en attente ne reste sans email parti (AC17, AC-a8b).
 */
export async function inviteMember(
  db: PlatformDb,
  identity: Identity,
  input: unknown,
  options: { redirectTo: string },
): Promise<{ invitation: EmailedInvitation; emailed: true }> {
  const invite = parsedInvite(input)
  await authorizeInvitation(db, identity, invite)

  // L'envoi avant l'insertion : une variable manquante ne laisse aucune invitation sans email.
  const email = oidcMode() ? platformEmail(identity, invite.email, options.redirectTo) : magicLinkEmail(options.redirectTo)
  const data = await insertInvitation(db, identity, invite)

  // L'invitation écrite, sa transaction close : l'email part hors de toute transaction.
  const refused = await email(data.email)
  if (refused) {
    await withdraw(db, data.id)
    throw refused
  }

  return { invitation: emailedInvitation(data), emailed: true }
}

/**
 * Inscrit une personne en attente, sans email : l'hôte qui gère lui-même son annuaire la prévient, et la personne entre
 * à sa première connexion, ses invitations en attente acceptées (`accept_invitations` ; en mode OIDC, dès sa première
 * requête, `resolveIdentity`). Mêmes droits, même plafond et mêmes refus qu'`inviteMember` (`already_member`,
 * `already_invited`) ; seul l'email ne part pas. `replacing` : l'invitation en attente de la même adresse qu'elle
 * remplace (autre rôle, autre équipe), révoquée après la décision du droit (`revokeInvitation` : son émetteur ou un
 * administrateur), dans la transaction de l'insertion : un refus de l'insertion laisse l'attente d'avant intacte.
 * L'inscription n'expire pas (`expires_at` nul) : l'hôte prévient la personne quand il veut, et elle peut se connecter
 * des semaines plus tard ; `member.remove` la retire.
 */
export async function registerInvitation(db: PlatformDb, identity: Identity, input: unknown, replacing?: string): Promise<CreatedInvitation> {
  const invite = parsedInvite(input)
  await authorizeInvitation(db, identity, invite)
  return createdInvitation(await insertInvitation(db, identity, invite, { replacing }))
}

type InvitationRow = {
  id: string
  email: string
  role: string
  team_id: string | null
  invited_by: string | null
  created_at: string
  expires_at: string | null
  accepted_at: string | null
  declined_at: string | null
  revoked_at: string | null
}

function invitationState(row: InvitationRow, now: Date): InvitationState {
  if (row.accepted_at) return "accepted"
  if (row.declined_at) return "declined"
  if (row.revoked_at) return "revoked"
  return row.expires_at !== null && new Date(row.expires_at) <= now ? "expired" : "pending"
}

/**
 * Les invitations de l'organisation que l'appelant peut voir, décidé ici (HN-E01S07-7) : à
 * l'administrateur, toutes ; aux autres, celles des équipes qu'ils mènent et celles adressées à leur
 * email. Le périmètre est filtré dans la requête, et la liste servie bornée après le filtre
 * (HN-E01S07-8) : les plus récentes d'abord, 200 au plus. `state: "pending"` (défaut) ne garde que
 * les invitations en attente.
 */
export async function listInvitations(db: PlatformDb, identity: Identity, query: unknown = {}): Promise<Invitation[]> {
  const parsed = listInvitationsQuerySchema.safeParse(query ?? {})
  if (!parsed.success) throw invalidArguments(parsed.error)
  const now = new Date()
  // Les équipes menées, en une liste liée : leur nombre n'a pas de borne, et la face SQL n'a pas celle
  // de l'adresse.
  const led = identity.teams.filter((team) => leadsTeam(identity, team.id)).map((team) => team.id)

  const rows = await inTransaction(db, "listInvitations", (sql) => {
    const pending =
      parsed.data.state === "pending"
        ? sql`and i.accepted_at is null and i.declined_at is null and i.revoked_at is null and (i.expires_at is null or i.expires_at > ${now})`
        : sql``
    const scope = isOrgAdmin(identity) ? sql`` : sql`and (i.email = ${identity.user.email.toLowerCase()} or i.team_id = any(${led}))`
    // L'ordre sur la colonne de la table (`i.`), jamais sur son texte rendu du même nom.
    return sql<InvitationRow[]>`
      select i.id, i.email, i.role, i.team_id, i.invited_by, to_json(i.created_at) as created_at,
             to_json(i.expires_at) as expires_at, to_json(i.accepted_at) as accepted_at,
             to_json(i.declined_at) as declined_at, to_json(i.revoked_at) as revoked_at
        from platform.invitations i
       where i.org_id = ${identity.org.id} ${pending} ${scope}
       order by i.created_at desc
       limit ${MAX_LISTED_INVITATIONS}`
  })

  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    role: invitationRole(row.role),
    teamId: row.team_id,
    invitedBy: row.invited_by,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    state: invitationState(row, now),
  }))
}

/** Ce que la révocation lit d'une invitation : son émetteur et son issue. */
type RevocableRow = { invited_by: string | null; accepted_at: Date | null; declined_at: Date | null; revoked_at: Date | null }

/**
 * Révoque une invitation encore ouverte (la ligne reste, datée), par son émetteur ou un
 * administrateur (`isOrgAdmin`), décidé ici avant l'écriture ; une invitation expirée non close se
 * révoque encore. `not_found`, même texte, quand elle est inconnue, d'une autre organisation, close,
 * ou que l'appelant ne peut pas la révoquer (HN-E01S07-7). L'écriture répète la garde « encore
 * ouverte » : aucune ligne écrite est un conflit, jamais un refus (HN-E01S07-6).
 */
export async function revokeInvitation(
  db: PlatformDb,
  identity: Identity,
  id: unknown,
): Promise<{ id: string; state: "revoked"; teamId: string | null }> {
  const parsed = invitationIdSchema.safeParse(id)
  if (!parsed.success) throw new PlatformError("invalid_arguments", "The invitation id must be a UUID.")

  // La lecture, la décision et l'écriture dans une transaction : une invitation close entre la lecture
  // et l'écriture ne rend aucune ligne à l'écriture, qui relit la version validée (`read committed`).
  const written = await inTransaction(db, "revokeInvitation", async (sql) => {
    const [row] = await sql<RevocableRow[]>`
      select invited_by, accepted_at, declined_at, revoked_at
        from platform.invitations
       where id = ${parsed.data} and org_id = ${identity.org.id}`
    const closed = !row || row.accepted_at !== null || row.declined_at !== null || row.revoked_at !== null
    if (closed || (row.invited_by !== identity.user.id && !isOrgAdmin(identity))) {
      throw new PlatformError("not_found", `No open invitation ${parsed.data} that you can revoke.`)
    }
    const [revoked] = await sql<{ id: string; team_id: string | null }[]>`
      update platform.invitations set revoked_at = ${new Date()}
       where id = ${parsed.data} and org_id = ${identity.org.id}
         and accepted_at is null and declined_at is null and revoked_at is null
      returning id, team_id`
    return revoked
  })
  if (!written) {
    console.error(`[platform] revokeInvitation: invitation ${parsed.data} closed between the read and the write`)
    throw new PlatformError("conflict", `Invitation ${parsed.data} changed meanwhile. Reload the invitations and retry.`)
  }
  return { id: written.id, state: "revoked", teamId: written.team_id }
}

const joinedSchema = z.array(
  z.object({ org_id: z.string(), slug: z.string(), name: z.string(), role: z.string() }),
)

/**
 * Accepte les invitations en attente de l'email vérifié de l'appelant (`accept_invitations`), au
 * retour d'un lien ou après un mot de passe. Rend les organisations rejointes, rôle écrit. La même
 * fonction recopie l'email, le nom et la date de connexion du compte dans chaque ligne `members` de la
 * personne : l'annuaire (`member_directory`) les lit là depuis M08. Elle les lit dans les claims de la
 * session : l'appelant que l'hôte passe porte le nom du compte (HN-E01S10-9), sans quoi le nom s'efface.
 */
export async function acceptInvitations(db: PlatformDb): Promise<JoinedOrg[]> {
  const [result] = await inTransaction(
    db,
    "acceptInvitations: accept_invitations",
    (sql) => sql<{ joined: unknown }[]>`select platform.accept_invitations() as joined`,
  )
  const parsed = joinedSchema.safeParse(result?.joined)
  if (!parsed.success) {
    console.error("[platform] acceptInvitations: unexpected result shape")
    throw new PlatformError("internal", "Internal error.")
  }
  return parsed.data.map((row) => ({ orgId: row.org_id, slug: row.slug, name: row.name, role: memberRole(row.role) }))
}
