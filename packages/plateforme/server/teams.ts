// Équipes : lister, créer, renommer, nommer les responsables, composer, supprimer (E05-S03 : AC10 à
// AC14, AC19 ; H69, H72, P39 ; E05-S13 : AC-22, AC-24). Ce module décide chaque droit avant d'écrire
// (E01-S07c, ADR-012 § 3) : administrer une équipe et nommer ou retirer ses responsables, par
// `isOrgAdmin` ; la composer, par `isOrgAdmin` ou `leadsTeam` (H72), un responsable n'en retirant que
// des membres. La RLS (isolation de l'organisation) reste la seconde barrière.
// Le dossier `<slug>` et le Contexte d'une équipe naissent et partent par les déclencheurs d'E01-S04
// (`teams_tree_sync`, `teams_tree_cleanup`) ; `team_members.role` est la seule source des responsables
// (E05-S13 : zéro, un ou plusieurs) ; le slug est figé (mise à jour de `name` seulement, N38).
// Face SQL (E01-S10, lot e1b2) : chaque opération tient en une transaction, annuaire compris : les lectures
// de `directory.ts` reprennent la transaction ouverte (`server/sql.ts`), qui n'attend aucune entrée-sortie
// extérieure (M32, HN-E01S10-e1b2-1).
//
// Repris d'Oto (`capabilities/groups/core.py` l. 291-302, 409-418) : création réservée à l'admin, nom
// unique sans casse, même refus au renommage, l'équipe s'excluant elle-même. Repris
// (`groups/members.py` l. 127-150) : une équipe reste administrable. Retiré : la suppression ouverte au
// chef d'équipe, le « groupe actif » (`_group=`), le refus de retirer le responsable (E05-S13).
import { createTeamSchema, teamMemberSchema, teamRoleSchema, updateTeamSchema, type TeamView } from "../schemas"
import { isOrgAdmin, leadsTeam } from "./access"
import type { PlatformDb } from "./db"
import { inTeam, memberDirectory, teamRoster, type DirectoryEntry } from "./directory"
import { changedMeanwhile, fromDatabaseError, inTransaction, invalidInput, isUniqueViolation, PlatformError } from "./errors"
import { teamRole, type Identity } from "./identity"
import { limitedTx } from "./limits"
import { slugOf } from "./nodes/segments"
import { parseId, requireAdmin, type Mutation } from "./members"
import { teamViews } from "./team-panel"
import type { Tx } from "./sql"

/** Chemins de premier niveau pris par l'arbre, par `read journal` et `read functions` (P39, P22, E11-S19 ; `teams_slug_reserved`). */
const RESERVED_SLUGS: ReadonlySet<string> = new Set(["guide", "perso", "private", "contexte", "journal", "functions", "help"])
const MAX_SLUG = 40
/** Au plus autant d'objets nommés par liste dans un refus `team_owns_objects` (AC14). */
const MAX_LISTED = 20

type TeamRow = { id: string; slug: string; name: string }

/**
 * Slug d'une équipe (HN-E05S03-8) : sans accents, en minuscules, tout ce qui n'est pas `[a-z0-9]`
 * devient `_`, 40 caractères au plus ; `equipe` pour un nom sans lettre ni chiffre.
 */
export function teamSlug(name: string): string {
  return slugOf(name, MAX_SLUG) || "equipe"
}

/** Un nom comparable : sans casse, sans accents, espaces réduits (Oto compare sans casse). */
function comparable(name: string): string {
  return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim()
}

/** Le slug d'un nom ; un slug réservé est refusé avant toute requête (AC11, `reserved_slug`). */
function unreservedSlug(name: string): string {
  const slug = teamSlug(name)
  if (RESERVED_SLUGS.has(slug)) {
    throw new PlatformError("invalid_arguments", `The name ${name} is reserved: choose another one.`, { reason: "reserved_slug" })
  }
  return slug
}

/**
 * Les refus d'un nom, avant toute écriture (AC11, AC12), son slug déjà hors des réservés
 * (`unreservedSlug`) : même nom qu'une autre équipe, sans casse ni accents, ou nom qui donne le même
 * slug (`name_taken`) ; slug gardé par une équipe renommée depuis, le slug étant figé (N38) : aucune ne
 * porte ce nom, mais son chemin est pris (`slug_taken`, HN-E05S03-32). L'équipe renommée s'exclut
 * elle-même.
 */
async function checkName(sql: Tx, identity: Identity, name: string, exceptId?: string): Promise<void> {
  const slug = teamSlug(name)
  const others = (await sql<TeamRow[]>`select id, slug, name from platform.teams where org_id = ${identity.org.id}`).filter((team) => team.id !== exceptId)
  // Un nom se compare aux noms courants, par leur slug du jour (`name_taken`, noms voisins compris) ; le chemin, au slug
  // stocké, qui garde la coupe de sa création (revue E11-S18) : pris par une équipe renommée depuis, `slug_taken`.
  const holder = others.find((team) => team.slug === slug)
  if (others.some((team) => comparable(team.name) === comparable(name) || teamSlug(team.name) === slug)) {
    throw new PlatformError("conflict", `A team of ${identity.org.name} is already named ${name}.`, { reason: "name_taken" })
  }
  if (holder) {
    throw new PlatformError("conflict", `Another team of ${identity.org.name} already uses the path ${slug}: choose another name.`, {
      reason: "slug_taken",
    })
  }
}

async function readTeam(sql: Tx, identity: Identity, teamId: string): Promise<TeamRow> {
  const [team] = await sql<TeamRow[]>`
    select id, slug, name from platform.teams where id = ${teamId} and org_id = ${identity.org.id}`
  if (!team) throw new PlatformError("not_found", `No team ${teamId} in ${identity.org.name}.`)
  return team
}

/** Une équipe, ou sa composition, changée entre la lecture et l'écriture du service (HN-E01S07-6). */
function teamChanged(context: string, team: TeamRow): PlatformError {
  return changedMeanwhile(context, team.id, `Team ${team.name} changed meanwhile. Reload the teams and retry.`)
}

/** Les équipes (par nom), leurs responsables et leurs personnes (AC10, AC-24) ; lu aussi par E05-S02. */
export async function listTeams(db: PlatformDb, identity: Identity): Promise<TeamView[]> {
  const [roster, directory] = await inTransaction(db, "listTeams", () =>
    Promise.all([teamRoster(db, identity.org.id), memberDirectory(db, identity.org.id)]),
  )
  return teamViews(roster, directory)
}

/**
 * Crée une équipe (AC11). Son dossier et son Contexte naissent par `teams_tree_sync` ; un chemin déjà pris par une page
 * d'organisation fait échouer toute la création (`23505`, `path_taken`) ; au plafond de `teams_max`, refus (E12-S02). Le créateur en devient le responsable, dans la
 * même transaction (E11-S10, AC-c1), sauf entré par un accès plateforme : `team_members_insert_admin` refuserait sa ligne.
 */
export async function createTeam(
  db: PlatformDb,
  identity: Identity,
  input: unknown,
): Promise<Mutation<{ id: string; slug: string; name: string }>> {
  const parsed = createTeamSchema.safeParse(input)
  if (!parsed.success) throw invalidInput(parsed.error)
  requireAdmin(identity, "create a team")
  const { name } = parsed.data
  const slug = unreservedSlug(name)

  // Au plafond de `teams_max`, refus en tête de la transaction (E12-S02).
  const data = await limitedTx(db, identity, "teams_max", async (sql) => {
      await checkName(sql, identity, name)
      const [team] = await sql<{ id: string; slug: string; name: string }[]>`
        insert into platform.teams (org_id, slug, name) values (${identity.org.id}, ${slug}, ${name})
        returning id, slug, name`
      return identity.viaGrant ? team : setSoleLead(sql, team.id, identity.user.id).then(() => team)
    })
    .catch((error: { code?: string; message?: string }) => {
      if (isUniqueViolation(error)) {
        // Le message de la base ne sort pas : il dit seulement quelle unicité a refusé.
        if (error.message?.includes("nodes_")) {
          throw new PlatformError("conflict", `A page is already at ${slug}: choose another name for the team.`, { reason: "path_taken" })
        }
        throw new PlatformError("conflict", `A team of ${identity.org.name} is already named ${name}.`, { reason: "name_taken" })
      }
      throw fromDatabaseError(error, "createTeam: teams insert")
    })
  return { data, target: data.slug, teamId: data.id }
}

/**
 * Le seul responsable de l'équipe (`admin_team set_lead`, AC-25) : la personne le devient, entrant dans
 * l'équipe au besoin, et les autres responsables redeviennent membres ; `null` : plus aucun responsable.
 */
async function setSoleLead(sql: Tx, teamId: string, leadUserId: string | null): Promise<void> {
  await sql`update platform.team_members set role = 'member'
             where team_id = ${teamId} and role = 'lead' and user_id is distinct from ${leadUserId}::uuid`
  if (!leadUserId) return
  await sql`insert into platform.team_members (team_id, user_id, role) values (${teamId}, ${leadUserId}, 'lead')
            on conflict (team_id, user_id) do update set role = 'lead'`
}

/**
 * Renomme une équipe (AC12) ; le slug ne change pas. `leadUserId` (gardé pour l'hôte et `admin_team
 * set_lead`) en fait le seul responsable, `null` n'en laisse aucun (AC-25).
 */
export async function updateTeam(
  db: PlatformDb,
  identity: Identity,
  teamId: unknown,
  input: unknown,
): Promise<Mutation<{ id: string; slug: string; name: string }>> {
  const id = parseId(teamId, "team")
  const parsed = updateTeamSchema.safeParse(input)
  if (!parsed.success) throw invalidInput(parsed.error)
  requireAdmin(identity, "change a team")
  const { name, leadUserId } = parsed.data
  return inTransaction(db, "updateTeam", async (sql) => {
    const team = await readTeam(sql, identity, id)
    if (name !== undefined) {
      // Le nom réservé se refuse après la lecture : une équipe inconnue se dit d'abord.
      unreservedSlug(name)
      await checkName(sql, identity, name, id)
    }
    if (leadUserId) {
      const directory = await memberDirectory(db, identity.org.id)
      if (!directory.some((person) => person.userId === leadUserId)) {
        throw new PlatformError("invalid_arguments", `The lead of team ${team.name} must be a member of ${identity.org.name}.`)
      }
    }

    if (leadUserId !== undefined) await setSoleLead(sql, id, leadUserId)
    if (name === undefined) return { data: { id: team.id, slug: team.slug, name: team.name }, target: team.slug, teamId: team.id }
    const [data] = await sql<TeamRow[]>`update platform.teams set name = ${name} where id = ${id} returning id, slug, name`
    if (!data) throw teamChanged("updateTeam", team)
    return { data: { id: data.id, slug: data.slug, name: data.name }, target: data.slug, teamId: data.id }
  })
}

/**
 * Nomme un membre de l'équipe responsable, ou le retire des responsables (AC-22, AC-24), sans toucher les
 * autres responsables. Réservé à l'administrateur (HN-E05S13-20), décidé avant toute lecture ; la personne
 * doit être dans l'équipe (`not_found` sinon). Un rôle déjà servi ne change rien.
 */
export async function setTeamMemberRole(
  db: PlatformDb,
  identity: Identity,
  membership: { teamId: unknown; userId: unknown },
  input: unknown,
): Promise<Mutation<{ teamId: string; userId: string; role: "lead" | "member" }>> {
  const id = parseId(membership.teamId, "team")
  const memberId = parseId(membership.userId, "member")
  const parsed = teamRoleSchema.safeParse(input)
  if (!parsed.success) throw invalidInput(parsed.error)
  requireAdmin(identity, "name or remove a lead of a team")
  const { role } = parsed.data
  return inTransaction(db, "setTeamMemberRole", async (sql) => {
    const team = await readTeam(sql, identity, id)
    const directory = await memberDirectory(db, identity.org.id)
    const person = directory.find((entry) => entry.userId === memberId)
    const notInTeam = new PlatformError("not_found", `${person?.name ?? memberId} is not a member of team ${team.name}.`)
    if (!person || !(await inTeam(db, id, memberId))) throw notInTeam
    const [row] = await sql<{ role: string }[]>`
      update platform.team_members set role = ${role} where team_id = ${id} and user_id = ${memberId} returning role`
    if (!row) throw teamChanged("setTeamMemberRole", team)
    return { data: { teamId: id, userId: memberId, role: teamRole(row.role) }, target: person.email, teamId: id }
  })
}

type OwnedObjects = { nodes: string[]; accounts: string[] }

/**
 * Ce que l'équipe possède encore (H69, P39) : les nœuds dont elle est propriétaire, hors son
 * dossier ; sous son dossier, tout ce qui n'est pas son Contexte (le dossier et le Contexte seuls
 * partent avec elle, `teams_tree_cleanup`) ; ses comptes. Listes triées, 20 au plus.
 */
async function ownedObjects(sql: Tx, identity: Identity, team: TeamRow): Promise<OwnedObjects> {
  const escaped = team.slug.replace(/[\\%_]/g, "\\$&")
  const [owned, below, accounts] = await Promise.all([
    sql<{ path: string }[]>`select path from platform.nodes where org_id = ${identity.org.id} and owner_team_id = ${team.id}`,
    sql<{ path: string }[]>`select path from platform.nodes where org_id = ${identity.org.id} and path like ${`${escaped}/%`}`,
    sql<{ label: string }[]>`select label from platform.accounts where org_id = ${identity.org.id} and owner_team_id = ${team.id}`,
  ])
  const folderOwned = owned.some((node) => node.path === team.slug)
  const underFolder = folderOwned ? below.map((node) => node.path).filter((path) => path.startsWith(`${team.slug}/`)) : []
  const nodes = [...new Set([...owned.map((node) => node.path), ...underFolder])]
    .filter((path) => path !== team.slug && path !== `${team.slug}/contexte`)
    .sort()
  const labels = accounts.map((account) => account.label).sort((a, b) => a.localeCompare(b, "fr"))
  return { nodes, accounts: labels }
}

/** Le refus d'une équipe qui possède encore des nœuds ou des comptes (AC14, H69) : ce qu'il faut transférer ou supprimer. */
function teamOwnsObjects(team: TeamRow, owned: OwnedObjects): PlatformError {
  return new PlatformError("conflict", `Team ${team.name} still owns nodes or accounts: transfer or delete them first.`, {
    reason: "team_owns_objects",
    nodes: owned.nodes.slice(0, MAX_LISTED),
    accounts: owned.accounts.slice(0, MAX_LISTED),
    nodesTotal: owned.nodes.length,
    accountsTotal: owned.accounts.length,
  })
}

/**
 * Supprime une équipe sans nœud ni compte à elle (AC14, H69) : ses règles et ses appartenances tombent
 * en cascade. Sinon `team_owns_objects`, avec ce qu'il faut transférer ou supprimer. Lectures et
 * suppression dans une transaction.
 */
export async function deleteTeam(db: PlatformDb, identity: Identity, teamId: unknown): Promise<Mutation<{ id: string; slug: string }>> {
  const id = parseId(teamId, "team")
  requireAdmin(identity, "delete a team")
  // Ce que la transaction a lu : le refus de son `commit` le reprend.
  let read: { team: TeamRow; owned: OwnedObjects } | null = null
  const team = await db
    .tx(async (sql) => {
      const team = await readTeam(sql, identity, id)
      read = { team, owned: await ownedObjects(sql, identity, team) }
      if (read.owned.nodes.length > 0 || read.owned.accounts.length > 0) throw teamOwnsObjects(team, read.owned)
      const deleted = await sql`delete from platform.teams where id = ${id} returning id`
      if (deleted.length === 0) throw teamChanged("deleteTeam", team)
      return team
    })
    .catch((error: { code?: string }) => {
      // Une page créée sous le dossier entre la lecture et la suppression : la clé différée
      // (`nodes.owner_team_id`) refuse au `commit` de la transaction.
      if (error.code === "23503" && read) throw teamOwnsObjects(read.team, read.owned)
      throw fromDatabaseError(error, "deleteTeam: teams delete")
    })
  // L'équipe n'existe plus : la ligne de journal ne peut pas la référencer (`journal.team_id`).
  return { data: { id, slug: team.slug }, target: team.slug, teamId: null }
}

/** Ce que la suppression d'une équipe emporterait, ou ce qui la bloque (E08-S02, AC21). */
export type TeamDeletion = {
  team: { id: string; slug: string; name: string }
  /** Ce qu'elle possède encore (H69), lu comme le refus `team_owns_objects` ; `null` : rien. */
  blockedBy: { nodes: { path: string }[]; accounts: { label: string }[] } | null
  members: { name: string; email: string }[]
  /** Règles d'accès qui la nomment, qui tombent avec elle (cascade, H69). */
  rules: number
}

/**
 * Le récapitulatif de la suppression d'une équipe (E08-S02), décidé comme `deleteTeam` avant toute
 * lecture (`requireAdmin`) : ce qui la bloque, par la lecture même de son refus (`ownedObjects`) ;
 * ses membres ; les règles qui la nomment. Lectures seules :
 * sert le premier temps d'`admin_team delete`, et la confirmation de l'écran Équipes.
 */
export async function describeTeamDeletion(db: PlatformDb, identity: Identity, teamSlug: string): Promise<TeamDeletion> {
  requireAdmin(identity, "delete a team")
  return inTransaction(db, "describeTeamDeletion", async (sql) => {
    const [team] = await sql<TeamRow[]>`
      select id, slug, name from platform.teams where org_id = ${identity.org.id} and slug = ${teamSlug}`
    if (!team) throw new PlatformError("not_found", `No team ${teamSlug} in ${identity.org.name}.`)
    // Ni les membres d'une équipe ni les règles qui la nomment n'ont de borne : la face SQL les lit en
    // entier (aucune page, la borne de PostgREST n'y est pas).
    const [owned, links, [counted], directory] = await Promise.all([
      ownedObjects(sql, identity, team),
      sql<{ user_id: string }[]>`select user_id from platform.team_members where team_id = ${team.id}`,
      sql<{ count: number }[]>`
        select count(*)::int as count from platform.access_rules where org_id = ${identity.org.id} and subject_team_id = ${team.id}`,
      memberDirectory(db, identity.org.id),
    ])
    const teamMembers = new Set(links.map((link) => link.user_id))
    const blocked = owned.nodes.length > 0 || owned.accounts.length > 0
    return {
      team: { id: team.id, slug: team.slug, name: team.name },
      blockedBy: blocked ? { nodes: owned.nodes.map((path) => ({ path })), accounts: owned.accounts.map((label) => ({ label })) } : null,
      members: directory.filter((person) => teamMembers.has(person.userId)).map((person) => ({ name: person.name, email: person.email })),
      rules: counted.count,
    }
  })
}

function notComposer(identity: Identity, team: TeamRow): PlatformError {
  return new PlatformError("forbidden", `Only the administrators of ${identity.org.name} and the leads of team ${team.name} change its members.`)
}

/**
 * Composer une équipe : l'administrateur, staff avec un accès en cours compris (`isOrgAdmin`,
 * HN-E05S03-40), ou l'un de ses responsables (`leadsTeam`, H72).
 */
function requireComposer(identity: Identity, team: TeamRow): void {
  if (isOrgAdmin(identity) || leadsTeam(identity, team.id)) return
  throw notComposer(identity, team)
}

async function memberOf(db: PlatformDb, identity: Identity, userId: string): Promise<DirectoryEntry> {
  const directory = await memberDirectory(db, identity.org.id)
  const person = directory.find((entry) => entry.userId === userId)
  if (!person) throw new PlatformError("invalid_arguments", `No member ${userId} in ${identity.org.name}.`)
  return person
}

/** Ajoute un membre de l'organisation à une équipe (AC13) ; déjà dedans, rien ne change. */
export async function addTeamMember(
  db: PlatformDb,
  identity: Identity,
  teamId: unknown,
  input: unknown,
): Promise<Mutation<{ teamId: string; userId: string; added: boolean }>> {
  const id = parseId(teamId, "team")
  const parsed = teamMemberSchema.safeParse(input)
  if (!parsed.success) throw invalidInput(parsed.error)
  const done = (person: DirectoryEntry, added: boolean) => ({
    data: { teamId: id, userId: person.userId, added },
    target: person.email,
    teamId: id,
  })
  // La personne que la transaction ajoute : le refus de son insertion la reprend.
  let adding: DirectoryEntry | null = null
  return db
    .tx(async (sql) => {
      const team = await readTeam(sql, identity, id)
      requireComposer(identity, team)
      const person = await memberOf(db, identity, parsed.data.userId)
      if (await inTeam(db, id, person.userId)) return done(person, false)
      adding = person
      await sql`insert into platform.team_members (team_id, user_id, role) values (${id}, ${person.userId}, 'member')`
      return done(person, true)
    })
    .catch((error: { code?: string }) => {
      // Ajoutée entre la lecture et l'écriture : c'est le même résultat (idempotent).
      if (isUniqueViolation(error) && adding) return done(adding, false)
      throw fromDatabaseError(error, "addTeamMember: team_members insert")
    })
}

/**
 * Retire une personne d'une équipe (AC13, AC-22) ; un responsable aussi, les autres responsables
 * restant ce qu'ils sont. Retirer un responsable est réservé à l'administrateur, comme le retirer des
 * responsables (HN-E05S13-20) : un responsable qui compose l'équipe n'en retire que des membres. Hors de
 * l'équipe, rien ne change (`removed: false`) ; présente à la lecture mais non supprimée, sa place a
 * changé entre-temps : un conflit, jamais un succès ni un refus (HN-E01S07-6).
 */
export async function removeTeamMember(
  db: PlatformDb,
  identity: Identity,
  teamId: unknown,
  userId: unknown,
): Promise<Mutation<{ teamId: string; userId: string; removed: boolean }>> {
  const id = parseId(teamId, "team")
  const memberId = parseId(userId, "member")
  return inTransaction(db, "removeTeamMember", async (sql) => {
    const team = await readTeam(sql, identity, id)
    requireComposer(identity, team)
    const directory = await memberDirectory(db, identity.org.id)
    const person = directory.find((entry) => entry.userId === memberId)
    const done = (removed: boolean) => ({ data: { teamId: id, userId: memberId, removed }, target: person?.email ?? memberId, teamId: id })

    const [link] = await sql<{ role: string }[]>`select role from platform.team_members where team_id = ${id} and user_id = ${memberId}`
    if (!link) return done(false)
    const admin = isOrgAdmin(identity)
    if (link.role === "lead" && !admin) throw new PlatformError("forbidden", `Only the administrators of ${identity.org.name} remove a lead of team ${team.name}.`)
    // Rien n'est verrouillé à la lecture : nommée responsable entre-temps, la personne n'est plus supprimée
    // par un responsable qui compose (HN-E05S13-20), et la course est un conflit.
    const removed = await sql`delete from platform.team_members where team_id = ${id} and user_id = ${memberId} and (${admin}::boolean or role = 'member') returning user_id`
    if (removed.length === 0) throw teamChanged("removeTeamMember", team)
    return done(true)
  })
}
