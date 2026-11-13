// Membres d'une organisation et accès plateforme (E05-S03 : AC4, AC7 à AC9, AC18, AC19 ; fiches D2,
// D17), et la fiche que chacun écrit (E05-S04, AC13). Ce module décide chaque droit avant sa requête
// (E01-S07c, ADR-012 § 3) : administrer, par
// `isOrgAdmin` ; voir et révoquer les accès plateforme, par `isOrgAdmin` ou l'équipe plateforme, comme
// `platform_access_directory` et les policies de `platform_grants`, sauf les membres ajoutés par le
// staff, lus dans `invitations` (`isOrgAdmin`). La RLS reste la seconde barrière.
// Retirer un membre ne touche ni à ses équipes, ni à ses règles, ni à ses responsabilités :
// `members_cleanup` (E01-S04) le fait dans la même transaction (H70).
// Face SQL (E01-S10, lot e1b2) : chaque opération tient en une transaction (`inTransaction`), annuaire
// compris : les lectures de `directory.ts` reprennent la transaction ouverte (`server/sql.ts`), qui n'attend
// aucune entrée-sortie extérieure (`supabase-patterns.md § Couplage à Supabase (ADR-012)` ; M32,
// HN-E01S10-e1b2-1).
//
// Repris d'Oto (`capabilities/orgs/members.py` l. 169-197) : le dernier administrateur protégé, par
// un 409 nommé. Retiré : l'organisation personnelle (`personal_of`) et le départ volontaire.
import * as z from "zod/v4"
import {
  languageSchema,
  profilePatchSchema,
  themeSchema,
  updateMemberSchema,
  type MemberRoleView,
  type MemberView,
  type PlatformAccessOverview,
  type PlatformAccessView,
  type ProfileSheet,
  type ProfileView,
  type StaffAddedMemberView,
} from "../schemas"
import { emailFor, isOrgAdmin } from "./access"
import { readBrand } from "./brand"
import type { PlatformDb } from "./db"
import { memberDirectory, teamRoster, type DirectoryEntry } from "./directory"
import { changedMeanwhile, inTransaction, invalidInput, PlatformError } from "./errors"
import { memberRole, type Identity } from "./identity"
import { wellFormed } from "./journal"
import { isJsonObject } from "./json"
import { organisationLanguage } from "./language"
import type { Tx } from "./sql"

const idSchema = z.uuid()

/** Ce qu'une mutation rend à la porte : ses données, et pour le journal sa cible et son équipe (H07). */
export type Mutation<T> = { data: T; target: string; teamId: string | null }

/** Le refus d'un geste réservé aux administrateurs de l'organisation. */
function adminOnly(identity: Identity, action: string): PlatformError {
  return new PlatformError("forbidden", `Only an administrator of ${identity.org.name} can ${action}.`)
}

/**
 * Administrer l'organisation : administrateur, ou membre de l'équipe plateforme avec un accès en
 * cours, membre simple compris (`isOrgAdmin`, fiches D2 et D17 ; HN-E05S03-40), jamais le seul rôle.
 */
export function requireAdmin(identity: Identity, action: string): void {
  if (!isOrgAdmin(identity)) throw adminOnly(identity, action)
}

/**
 * Voir et révoquer les accès plateforme (fiche D2) : l'administrateur, ou tout membre de l'équipe
 * plateforme, comme `platform_access_directory` et les policies de `platform_grants`
 * (`is_staff() or is_org_admin(org)`).
 */
function requireAccessManager(identity: Identity, action: string): void {
  if (!isOrgAdmin(identity) && !identity.isStaff) throw adminOnly(identity, action)
}

/** Un identifiant d'URL : un UUID, sinon `invalid_arguments` avant toute lecture. */
export function parseId(value: unknown, what: string): string {
  const parsed = idSchema.safeParse(value)
  if (!parsed.success) throw new PlatformError("invalid_arguments", `The ${what} id must be a UUID.`)
  return parsed.data
}

function unknownMember(identity: Identity, userId: string): PlatformError {
  return new PlatformError("not_found", `No member ${userId} in ${identity.org.name}.`)
}

/** Une personne partie ou changée entre la lecture de l'annuaire et l'écriture (HN-E01S07-6). */
function memberChanged(context: string, person: DirectoryEntry): PlatformError {
  return changedMeanwhile(context, person.userId, `Member ${person.email} changed meanwhile. Reload the members and retry.`)
}

/** Les membres (par nom) et leurs équipes (AC4). */
export async function listMembers(db: PlatformDb, identity: Identity): Promise<MemberView[]> {
  const [directory, roster] = await inTransaction(db, "listMembers", () =>
    Promise.all([memberDirectory(db, identity.org.id), teamRoster(db, identity.org.id)]),
  )
  const names = new Map(roster.teams.map((team) => [team.id, team.name]))
  return directory.map((person) => {
    const teams = roster.memberships
      .filter((link) => link.userId === person.userId && names.has(link.teamId))
      .map((link) => ({ id: link.teamId, name: names.get(link.teamId) ?? "", role: link.role }))
      .sort((a, b) => a.name.localeCompare(b.name, "fr"))
    return {
      userId: person.userId,
      email: emailFor(identity, person, teams.map((team) => team.id)),
      name: person.name,
      role: person.role,
      teams,
      lastSignInAt: person.lastSignInAt,
      isSelf: person.userId === identity.user.id,
    }
  })
}

/** Le dernier administrateur ne se rétrograde ni ne se retire (AC7, AC9) : 409 `last_admin`. */
function guardLastAdmin(identity: Identity, directory: DirectoryEntry[], person: DirectoryEntry): void {
  if (person.role !== "admin") return
  if (directory.filter((entry) => entry.role === "admin").length > 1) return
  throw new PlatformError(
    "conflict",
    `${person.name} is the last administrator of ${identity.org.name}: name another administrator first.`,
    { reason: "last_admin" },
  )
}

/**
 * Change le rôle (`admin` ou `member`) d'un membre (AC7) ; le dernier administrateur ne se rétrograde
 * pas. L'équipe par défaut ne s'écrit plus (E05-S13, fiche D128).
 */
export async function updateMember(
  db: PlatformDb,
  identity: Identity,
  userId: unknown,
  input: unknown,
): Promise<Mutation<{ userId: string; role: MemberRoleView }>> {
  const id = parseId(userId, "member")
  const parsed = updateMemberSchema.safeParse(input)
  if (!parsed.success) throw invalidInput(parsed.error)
  requireAdmin(identity, "change a member")
  const { role } = parsed.data

  return inTransaction(db, "updateMember", async (sql) => {
    const directory = await memberDirectory(db, identity.org.id)
    const person = directory.find((entry) => entry.userId === id)
    if (!person) throw unknownMember(identity, id)
    if (role === "member") guardLastAdmin(identity, directory, person)

    const [row] = await sql<{ role: string }[]>`
      update platform.members set role = ${role}
       where org_id = ${identity.org.id} and user_id = ${id}
      returning role`
    if (!row) throw memberChanged("updateMember", person)
    return { data: { userId: id, role: memberRole(row.role) }, target: person.email, teamId: null }
  })
}

/**
 * Retire une personne de l'organisation (AC9) : ses équipes, ses règles nominatives et ses
 * responsabilités tombent par `members_cleanup` ; ses pages personnelles restent, invisibles de tous. Elle est inscrite
 * aux exclusions de l'organisation (`member_exclusions`).
 */
export async function removeMember(db: PlatformDb, identity: Identity, userId: unknown): Promise<Mutation<{ userId: string }>> {
  const id = parseId(userId, "member")
  requireAdmin(identity, "remove a member")
  return inTransaction(db, "removeMember", async (sql) => {
    const directory = await memberDirectory(db, identity.org.id)
    const person = directory.find((entry) => entry.userId === id)
    if (!person) throw unknownMember(identity, id)
    guardLastAdmin(identity, directory, person)

    // Retirée, la personne ne rentre plus par l'entrée sans invitation (`join_org`) : seule une invitation acceptée lève
    // l'exclusion. Inscrite que le réglage soit actif ou non : l'activer plus tard ne fait pas revenir d'anciens membres.
    // Avant le retrait : qui se retire lui-même n'écrit plus rien dans l'organisation une fois sa ligne partie (RLS).
    await sql`insert into platform.member_exclusions (org_id, user_id, excluded_by) values (${identity.org.id}, ${id}, ${identity.user.id})
              on conflict (org_id, user_id) do nothing`
    const removed = await sql`delete from platform.members where org_id = ${identity.org.id} and user_id = ${id} returning user_id`
    if (removed.length === 0) throw memberChanged("removeMember", person)
    return { data: { userId: id }, target: person.email, teamId: null }
  })
}

type GrantRow = {
  id: string
  user_id: string
  granted_by: string | null
  granted_at: string
  revoked_at: string | null
  revoked_by: string | null
  reason: string | null
}

type Person = { name: string; email: string }

/** Nom et email de qui a ou a eu un accès, et de qui l'a accordé ou révoqué (fiche D2, P27). */
async function platformPeople(sql: Tx, identity: Identity, directory: DirectoryEntry[]): Promise<Map<string, Person>> {
  const rows = await sql<{ user_id: string; name: string; email: string }[]>`
    select user_id, name, email from platform.platform_access_directory(${identity.org.id})`
  const people = new Map<string, Person>(rows.map((row) => [row.user_id, { name: row.name, email: row.email }]))
  // Le nom de profil d'un membre l'emporte sur celui de son compte.
  for (const person of directory) people.set(person.userId, { name: person.name, email: person.email })
  return people
}

/**
 * Les membres ajoutés par l'équipe plateforme (fiche D17, option A) : ceux qui portent ou ont porté
 * un accès, ou l'ont accordé ; et ceux qui sont entrés par l'invitation de l'un d'eux. Un membre
 * inscrit directement par le staff, sans invitation, n'a pas de trace lisible (`members` ne garde
 * pas son auteur) : il n'apparaît ici que s'il est lui-même du staff.
 */
async function addedByStaff(
  sql: Tx,
  identity: Identity,
  context: { grants: GrantRow[]; directory: DirectoryEntry[]; people: Map<string, Person> },
): Promise<StaffAddedMemberView[]> {
  const staff = new Set(context.grants.flatMap((grant) => (grant.granted_by ? [grant.user_id, grant.granted_by] : [grant.user_id])))
  if (staff.size === 0) return []
  // La date d'entrée comme PostgREST l'écrivait (`to_json`) : les écrans la lisent en texte.
  const rows = await sql<{ invited_by: string | null; accepted_by: string | null; accepted_at: string | null }[]>`
    select invited_by, accepted_by, to_json(accepted_at) #>> '{}' as accepted_at
      from platform.invitations
     where org_id = ${identity.org.id} and accepted_at is not null and invited_by in ${sql([...staff])}`
  const invitedBy = new Map<string, { by: string; at: string | null }>()
  for (const row of rows) {
    if (row.accepted_by && row.invited_by) invitedBy.set(row.accepted_by, { by: row.invited_by, at: row.accepted_at })
  }
  return context.directory.flatMap((person): StaffAddedMemberView[] => {
    const base = { userId: person.userId, name: person.name, email: person.email, role: person.role }
    if (staff.has(person.userId)) return [{ ...base, via: "staff", invitedByName: null, joinedAt: null }]
    const invitation = invitedBy.get(person.userId)
    if (!invitation) return []
    const inviter = context.people.get(invitation.by)?.name ?? null
    return [{ ...base, via: "invitation", invitedByName: inviter, joinedAt: invitation.at }]
  })
}

/**
 * Les accès de l'équipe plateforme à l'organisation, en cours d'abord (fiche D2), et à côté les
 * membres ajoutés par le staff (fiche D17). Réservé aux administrateurs et à l'équipe plateforme (AC18) ;
 * les membres ajoutés par le staff, lus dans `invitations`, aux seuls administrateurs (HN-E01S07-C2).
 */
export async function listPlatformAccess(db: PlatformDb, identity: Identity): Promise<PlatformAccessOverview> {
  requireAccessManager(identity, "see the platform accesses")
  const { grants, people, staffAdded } = await inTransaction(db, "listPlatformAccess", async (sql) => {
    const [grants, directory] = await Promise.all([
      // Les dates comme PostgREST les écrivait (`to_json`) : les écrans et le MCP admin les lisent en texte.
      sql<GrantRow[]>`
        select g.id, g.user_id, g.granted_by, to_json(g.granted_at) #>> '{}' as granted_at,
               to_json(g.revoked_at) #>> '{}' as revoked_at, g.revoked_by, g.reason
          from platform.platform_grants g
         where g.org_id = ${identity.org.id}
         order by g.granted_at desc`,
      memberDirectory(db, identity.org.id),
    ])
    const people = await platformPeople(sql, identity, directory)
    // `invitations` se lit par l'administrateur, pas par le reste de l'équipe plateforme (architecture
    // § 4) : à un membre du staff sans accès en cours, une liste vide, sans lire la table.
    const staffAdded = isOrgAdmin(identity) ? await addedByStaff(sql, identity, { grants, directory, people }) : []
    return { grants, people, staffAdded }
  })
  const nameOf = (userId: string | null) => (userId ? (people.get(userId)?.name ?? null) : null)

  const accesses: PlatformAccessView[] = grants
    .map((grant) => ({
      id: grant.id,
      userId: grant.user_id,
      name: nameOf(grant.user_id),
      email: people.get(grant.user_id)?.email ?? null,
      grantedAt: grant.granted_at,
      grantedByName: nameOf(grant.granted_by),
      revokedAt: grant.revoked_at,
      revokedByName: nameOf(grant.revoked_by),
      reason: grant.reason,
    }))
    .sort((a, b) => Number(a.revokedAt !== null) - Number(b.revokedAt !== null))
  return { accesses, addedByStaff: staffAdded }
}

/**
 * Révoque un accès plateforme (AC18, fiche D2) : `revoked_at` et `revoked_by` seulement, les seules
 * colonnes que la RLS laisse écrire. Un accès déjà révoqué rend un succès, sans changement ; un accès
 * révoqué ou parti entre la lecture et l'écriture, un conflit (HN-E01S07-6).
 */
export async function revokePlatformAccess(
  db: PlatformDb,
  identity: Identity,
  grantId: unknown,
): Promise<Mutation<{ id: string; revokedAt: string; alreadyRevoked: boolean }>> {
  const id = parseId(grantId, "access")
  requireAccessManager(identity, "revoke a platform access")
  const done = (revokedAt: string, alreadyRevoked: boolean) => ({
    data: { id, revokedAt, alreadyRevoked },
    target: id,
    teamId: null,
  })
  // La date de révocation comme PostgREST l'écrivait (`to_json`), relue ou écrite : les deux réponses
  // d'une révocation rejouée sont égales.
  return inTransaction(db, "revokePlatformAccess: platform_grants", async (sql) => {
    const [grant] = await sql<{ revoked_at: string | null }[]>`
      select to_json(revoked_at) #>> '{}' as revoked_at from platform.platform_grants
       where id = ${id} and org_id = ${identity.org.id}`
    if (!grant) throw new PlatformError("not_found", `No platform access ${id} to ${identity.org.name}.`)
    if (grant.revoked_at) return done(grant.revoked_at, true)

    const [revoked] = await sql<{ revoked_at: string | null }[]>`
      update platform.platform_grants set revoked_at = ${new Date()}, revoked_by = ${identity.user.id}
       where id = ${id} and revoked_at is null
      returning to_json(revoked_at) #>> '{}' as revoked_at`
    if (!revoked?.revoked_at) {
      throw changedMeanwhile("revokePlatformAccess", id, `Platform access ${id} changed meanwhile. Reload the platform accesses and retry.`)
    }
    return done(revoked.revoked_at, false)
  })
}

/** Une chaîne non vide de la fiche, sinon rien. */
const text = (value: unknown): string | undefined => (typeof value === "string" && value ? value : undefined)

/**
 * La fiche que rend `update_my_profile`, ou que l'identité a lue : noms, langue et couleur, s'ils ont la
 * forme attendue (E05-S11, AC-3) ; jamais `handle`.
 */
function profileView(profile: unknown): ProfileView {
  if (!isJsonObject(profile)) return {}
  const [name, firstName, lastName] = [text(profile.name), text(profile.first_name), text(profile.last_name)]
  const language = languageSchema.safeParse(profile.language)
  const theme = themeSchema.safeParse(profile.theme)
  return {
    ...(name ? { name } : {}),
    ...(firstName ? { first_name: firstName } : {}),
    ...(lastName ? { last_name: lastName } : {}),
    ...(language.success ? { language: language.data } : {}),
    ...(theme.success ? { theme: theme.data } : {}),
  }
}

/**
 * La page « Profil » (E05-S11, AC-3) : la fiche de la personne, telle que l'identité l'a lue, et ce que vaut
 * « Celle de l'organisation » (langue, AC-36 ; couleur, AC-4). Aucune lecture de plus. Comme `updateProfile`,
 * un appelant sans ligne `members` (équipe plateforme entrée par un accès en cours) n'a pas de fiche ici :
 * refusé (`security-patterns.md § Droits dans le service`).
 */
export async function readProfile(identity: Identity): Promise<ProfileSheet> {
  if (identity.viaGrant) throw new PlatformError("forbidden", `Only members of ${identity.org.name} have a profile here.`)
  return {
    profile: profileView(identity.member.profile),
    organisation: { language: organisationLanguage(identity.org), theme: readBrand(identity.org).theme },
  }
}

/**
 * La personne écrit sa propre fiche (E05-S04, AC13 ; H31, P39) : son nom et sa langue, et depuis E05-S11
 * (AC-5) son prénom, son nom de famille et sa couleur, par
 * `update_my_profile` (E01-S06 AC33), la seule écriture qui ne touche que la fiche de l'appelant. Un
 * appelant sans ligne `members` (équipe plateforme entrée par un accès en cours, `viaGrant`) n'a pas de
 * fiche ici : refusé avant la requête (HN-E05S04-12). `22023` → `invalid_arguments`, `42501` →
 * `forbidden` (`fromDatabaseError`). Cible du journal : l'email de la personne (H07). Le nom part bien
 * formé : une moitié de paire de substitution ferait refuser le paramètre `jsonb` par Postgres (`22P02`,
 * mesuré sur la face SQL), comme tout le corps par PostgREST (`supabase-patterns.md § Error Handling`) ;
 * elle devient U+FFFD, comme dans `write`.
 */
export async function updateProfile(db: PlatformDb, identity: Identity, input: unknown): Promise<Mutation<ProfileView>> {
  const parsed = profilePatchSchema.safeParse(input)
  if (!parsed.success) throw invalidInput(parsed.error)
  if (identity.viaGrant) throw new PlatformError("forbidden", `Only members of ${identity.org.name} have a profile here.`)
  const [row] = await inTransaction(
    db,
    "updateProfile: update_my_profile",
    (sql) => sql<{ profile: unknown }[]>`
      select platform.update_my_profile(${identity.org.id}, ${sql.json(wellFormed(parsed.data))}) as profile`,
  )
  return { data: profileView(row?.profile), target: identity.user.email, teamId: null }
}
