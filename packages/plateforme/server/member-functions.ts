// Les membres et les équipes d'une organisation derrière `call` : `member.list`, `member.add`, `member.set_teams`,
// `member.remove` et `team.create`. Le serveur d'un hôte qui sert de client MCP, sous le jeton de la personne qui agit,
// tient ainsi son annuaire dans l'organisation sans écran ni compte de service. Chaque fonction s'appuie sur les
// services de l'écran Équipes, qui décident chaque droit : `invitationOptions` (inviter), `requireAdmin`
// (administrer), `requireComposer` (composer une équipe), `guardLastAdmin` (le dernier administrateur). Une personne en
// attente est une invitation ouverte, inscrite sans email (`registerInvitation`) : elle entre à sa première connexion.
// Une personne se désigne par son email, stable de l'attente à l'entrée, où son identifiant change.
import {
  MEMBER_LIST_PAGE,
  memberAddArgsSchema,
  memberListArgsSchema,
  memberRemoveArgsSchema,
  memberSetTeamsArgsSchema,
  normalizeTitle,
  teamCreateArgsSchema,
  type InvitationRole,
  type MemberAddArgs,
} from "../schemas"
import { isOrgAdmin } from "./access"
import { defineFunction, type FunctionContext, type FunctionOutput } from "./catalog/define"
import { memberDirectory, sameEmail, teamRoster, type DirectoryEntry, type RosterTeam } from "./directory"
import { boundedList, inTransaction, PlatformError } from "./errors"
import type { Identity } from "./identity"
import { listInvitations, registerInvitation, revokeInvitation } from "./invitations"
import { listMembers, removeMember, requireAdmin, updateMember } from "./members"
import { openInvitation, setPending, type OpenInvitation } from "./pending-members"
import { addTeamMember, createTeam, removeTeamMember } from "./teams"

/** Une personne telle que `member.list` la rend : membre, ou en attente de sa première connexion. */
type ListedPerson = {
  member_id: string
  /** Nul quand l'appelant n'a pas à la joindre (`emailFor`), ou pour une ligne écrite sans email. */
  email: string | null
  name?: string
  role: InvitationRole
  status: "active" | "pending"
  teams: string[]
}

/**
 * Gérer des personnes : l'administrateur (staff avec un accès en cours compris, `isOrgAdmin`), ou le responsable d'une
 * équipe au moins ; un simple membre est refusé avant toute lecture. Le détail (quelle équipe, quel rôle) se décide
 * ensuite dans le service de chaque geste.
 */
function requireMemberManager(identity: Identity, action: string): void {
  if (isOrgAdmin(identity) || identity.teams.some((team) => team.role === "lead")) return
  throw new PlatformError("forbidden", `Only the administrators of ${identity.org.name} and the team leads can ${action}.`, { reason: "not_allowed" })
}

/** Les équipes que nomment `given`, par leur slug ou leur nom, sans casse ni accent ; une inconnue est refusée avec la liste. */
function namedTeams(identity: Identity, teams: readonly RosterTeam[], given: readonly string[]): RosterTeam[] {
  const found = new Map<string, RosterTeam>()
  for (const name of given) {
    const team = teams.find((candidate) => candidate.slug === name) ?? teams.find((candidate) => normalizeTitle(candidate.name) === normalizeTitle(name))
    if (!team) {
      throw new PlatformError("invalid_arguments", `No team ${name} in ${identity.org.name}. Teams: ${boundedList(teams.map((entry) => entry.slug)) || "none"}.`)
    }
    found.set(team.id, team)
  }
  return [...found.values()]
}

/** Ce qu'il faut pour désigner une personne : l'annuaire, les équipes et leurs appartenances. */
type Directory = { people: DirectoryEntry[]; teams: RosterTeam[]; memberships: { teamId: string; userId: string }[] }

async function readDirectory(context: FunctionContext): Promise<Directory> {
  const { db, identity } = context
  const [people, roster] = await inTransaction(db, "member functions: directory", () =>
    Promise.all([memberDirectory(db, identity.org.id), teamRoster(db, identity.org.id)]),
  )
  return { people, teams: roster.teams, memberships: roster.memberships }
}

/** La personne de `email` : un membre, une personne en attente, ou personne. */
type Found = { kind: "active"; person: DirectoryEntry } | { kind: "pending"; invitation: OpenInvitation } | { kind: "none" }

async function findPerson(context: FunctionContext, directory: Directory, email: string): Promise<Found> {
  const person = directory.people.find((entry) => sameEmail(entry.email, email))
  if (person) return { kind: "active", person }
  const invitation = await openInvitation(context.db, context.identity, email)
  return invitation ? { kind: "pending", invitation } : { kind: "none" }
}

function unknownPerson(identity: Identity, email: string): PlatformError {
  return new PlatformError("not_found", `No member nor pending person ${email} in ${identity.org.name}. Add them with member.add.`)
}

const slugsOf = (teams: readonly RosterTeam[], ids: readonly string[]) =>
  teams.filter((team) => ids.includes(team.id)).map((team) => team.slug)

function personLine(person: ListedPerson): string {
  const who = person.name ? `${person.name}${person.email ? ` <${person.email}>` : ""}` : (person.email ?? person.member_id)
  return `- ${who} · ${person.role} · ${person.status} · teams: ${person.teams.length > 0 ? person.teams.join(", ") : "none"}`
}

async function list(context: FunctionContext, offset: number): Promise<FunctionOutput> {
  const { db, identity } = context
  requireMemberManager(identity, "list the members")
  const [members, invitations, roster] = await inTransaction(db, "member.list", () =>
    Promise.all([listMembers(db, identity), listInvitations(db, identity, { state: "pending" }), teamRoster(db, identity.org.id)]),
  )
  const active = members.map((member): ListedPerson => ({
    member_id: member.userId,
    email: member.email || null,
    name: member.name,
    role: member.role,
    status: "active",
    teams: slugsOf(roster.teams, member.teams.map((team) => team.id)),
  }))
  const pending = invitations
    .map((invitation): ListedPerson => ({
      member_id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      status: "pending",
      teams: slugsOf(roster.teams, invitation.teamIds),
    }))
    .sort((a, b) => (a.email ?? "").localeCompare(b.email ?? ""))
  const people = [...active, ...pending]
  const page = people.slice(offset, offset + MEMBER_LIST_PAGE)
  const nextOffset = offset + MEMBER_LIST_PAGE < people.length ? offset + MEMBER_LIST_PAGE : null
  const head = `${people.length} people in ${identity.org.name}: ${active.length} members, ${pending.length} pending their first sign-in.`
  const tail = nextOffset === null ? [] : [`More: call member.list again with offset ${nextOffset}.`]
  return {
    text: [head, ...page.map(personLine), ...tail].join("\n"),
    data: { total: people.length, offset, next_offset: nextOffset, people: page },
    next: ["member.add", "member.set_teams"],
  }
}

export const memberList = defineFunction({
  name: "member.list",
  connector: "member",
  class: "read",
  origin: "paquet",
  description:
    "Lists the members of the organisation and the people pending their first sign-in, each with member_id, email, name, role (admin or member), status (active or pending) and teams (slugs), by pages of 100. Reserved to the administrators and the team leads; a lead sees the emails of the members of their teams only, and the pending people of their teams. In French: membres, personnes, annuaire.",
  schema: memberListArgsSchema,
  examples: [{}],
  refusals: ["A member who is neither an administrator nor a team lead: refused."],
  next: ["member.add", "member.set_teams"],
  run: (context, args) => list(context, args.offset),
})

/** La personne après `member.add` ou `member.set_teams`. */
type PersonAfter = { member_id: string; email: string; status: "active" | "pending"; role: InvitationRole; teams: string[]; changed: boolean }

function personOutput(text: string, data: PersonAfter): FunctionOutput {
  return { text, data, next: ["member.list"] }
}

/** Ce que reçoit le geste sur une personne trouvée : l'annuaire lu, les arguments, les équipes nommées. */
type Request = { directory: Directory; args: MemberAddArgs; wanted: RosterTeam[] }

const teamIdsOf = (directory: Directory, userId: string) => directory.memberships.filter((link) => link.userId === userId).map((link) => link.teamId)

/** Un membre déjà là : promu s'il le faut (jamais rétrogradé), et ajouté aux équipes qu'il n'a pas, en une transaction. */
async function addToMember(context: FunctionContext, person: DirectoryEntry, { directory, args, wanted }: Request): Promise<FunctionOutput> {
  const { db, identity } = context
  const current = teamIdsOf(directory, person.userId)
  const missing = wanted.filter((team) => !current.includes(team.id))
  const promote = args.role === "admin" && person.role !== "admin"
  await inTransaction(db, "member.add", async () => {
    if (promote) await updateMember(db, identity, person.userId, { role: "admin" })
    for (const team of missing) await addTeamMember(db, identity, team.id, { userId: person.userId })
  })
  const changes = [promote ? "now admin" : "", missing.length > 0 ? `added to ${missing.map((team) => team.slug).join(", ")}` : ""].filter(Boolean)
  const text = changes.length > 0 ? `${person.name} is already a member: ${changes.join(", ")}.` : `${person.name} is already a member, with these teams: nothing to change.`
  const teams = slugsOf(directory.teams, [...current, ...missing.map((team) => team.id)])
  return personOutput(text, { member_id: person.userId, email: args.email, status: "active", role: promote ? "admin" : person.role, teams, changed: changes.length > 0 })
}

/** Une personne déjà en attente : les équipes et le rôle demandés s'ajoutent aux siens (jamais rétrogradée). */
async function addToPending(context: FunctionContext, invitation: OpenInvitation, { directory, args, wanted }: Request): Promise<FunctionOutput> {
  const teamIds = [...new Set([...invitation.teamIds, ...wanted.map((team) => team.id)])]
  const role: InvitationRole = invitation.role === "admin" || args.role === "admin" ? "admin" : "member"
  const { id, changed } = await setPending(context.db, context.identity, invitation, { role, teamIds })
  const teams = slugsOf(directory.teams, teamIds)
  const text = changed ? `${args.email} is pending, now ${role}${teams.length > 0 ? ` in ${teams.join(", ")}` : ""}; they join at their first sign-in.` : `${args.email} is already pending, with these teams and role: nothing to change.`
  return personOutput(text, { member_id: id, email: args.email, status: "pending", role, teams, changed })
}

async function add(context: FunctionContext, args: MemberAddArgs): Promise<FunctionOutput> {
  const { db, identity } = context
  requireMemberManager(identity, "add people")
  const directory = await readDirectory(context)
  const request = { directory, args, wanted: namedTeams(identity, directory.teams, args.teams ?? []) }
  const found = await findPerson(context, directory, args.email)
  if (found.kind === "active") return addToMember(context, found.person, request)
  if (found.kind === "pending") return addToPending(context, found.invitation, request)
  const created = await registerInvitation(db, identity, { email: args.email, role: args.role, teamIds: request.wanted.map((team) => team.id) })
  const teams = request.wanted.map((team) => team.slug)
  return personOutput(`${args.email} is added as ${created.role}${teams.length > 0 ? ` in ${teams.join(", ")}` : ""}, pending: no email is sent; they join at their first sign-in.`, {
    member_id: created.id, email: created.email, status: "pending", role: created.role, teams, changed: true,
  })
}

export const memberAdd = defineFunction({
  name: "member.add",
  connector: "member",
  class: "write",
  origin: "paquet",
  description:
    "Adds a person to the organisation by email, pending until their first sign-in, without sending any email, and puts them in their teams. Idempotent: a member or a pending person of the same email gets the missing teams, never a duplicate; a role is raised to admin, never lowered. Administrators add anyone; a team lead adds members to the teams they lead only. A pending person joins all their teams at their first sign-in. In French: ajouter membre, inscrire, rattacher équipe.",
  schema: memberAddArgsSchema,
  examples: [{ email: "lea.roux@example.com", teams: ["ventes", "support"] }, { email: "admin@example.com", role: "admin" }],
  refusals: [
    "A member who is neither an administrator nor a team lead; a lead who names a team they do not lead, no team, or the admin role.",
    "An unknown team: the refusal lists the teams.",
    "The organisation at its members limit (pending people counted).",
  ],
  next: ["member.list", "member.set_teams"],
  run: (context, args) => add(context, args),
})

async function setTeams(context: FunctionContext, email: string, given: readonly string[]): Promise<FunctionOutput> {
  const { db, identity } = context
  requireMemberManager(identity, "change the teams of a person")
  const directory = await readDirectory(context)
  const wantedIds = namedTeams(identity, directory.teams, given).map((team) => team.id)
  const teams = slugsOf(directory.teams, wantedIds)
  const found = await findPerson(context, directory, email)
  if (found.kind === "none") throw unknownPerson(identity, email)
  if (found.kind === "pending") {
    const { role } = found.invitation
    const { id, changed } = await setPending(db, identity, found.invitation, { role, teamIds: wantedIds })
    const text = changed ? `${email} is pending, now in ${teams.length > 0 ? teams.join(", ") : "no team"}.` : `${email} is pending with these teams: nothing to change.`
    return personOutput(text, { member_id: id, email, status: "pending", role, teams, changed })
  }
  const { person } = found
  const current = teamIdsOf(directory, person.userId)
  const added = wantedIds.filter((id) => !current.includes(id))
  const removed = current.filter((id) => !wantedIds.includes(id))
  // Une transaction : un refus sur une équipe (un responsable qui ne la mène pas) n'en laisse aucune changée.
  await inTransaction(db, "member.set_teams", async () => {
    for (const id of added) await addTeamMember(db, identity, id, { userId: person.userId })
    for (const id of removed) await removeTeamMember(db, identity, id, person.userId)
  })
  const moves = [added.length > 0 ? `added to ${slugsOf(directory.teams, added).join(", ")}` : "", removed.length > 0 ? `removed from ${slugsOf(directory.teams, removed).join(", ")}` : ""].filter(Boolean)
  const text = moves.length > 0 ? `${person.name}: ${moves.join("; ")}.` : `${person.name} already has these teams: nothing to change.`
  return personOutput(text, { member_id: person.userId, email, status: "active", role: person.role, teams, changed: moves.length > 0 })
}

export const memberSetTeams = defineFunction({
  name: "member.set_teams",
  connector: "member",
  class: "write",
  origin: "paquet",
  description:
    "Replaces the teams of a member or a pending person, by email: they end in exactly the teams given, which changes their role in the host when its roles are teams. Administrators change any team; a team lead adds or removes members of the teams they lead only, and must list the other teams of a member unchanged (a pending person keeps the teams the lead does not see). All or nothing. In French: changer équipes, changer rôle, retirer équipe.",
  schema: memberSetTeamsArgsSchema,
  examples: [{ member: "lea.roux@example.com", teams: ["ventes"] }],
  refusals: [
    "A member who is neither an administrator nor a team lead; a lead who adds to or removes from a team they do not lead, or removes a lead.",
    "An unknown person or team.",
  ],
  next: ["member.list"],
  run: (context, args) => setTeams(context, args.member, args.teams),
})

async function remove(context: FunctionContext, email: string): Promise<FunctionOutput> {
  const { db, identity } = context
  requireMemberManager(identity, "remove people")
  const found = await findPerson(context, await readDirectory(context), email)
  if (found.kind === "none") throw unknownPerson(identity, email)
  if (found.kind === "pending") {
    await revokeInvitation(db, identity, found.invitation.id)
    return { text: `${email} is no longer pending in ${identity.org.name}.`, data: { member_id: found.invitation.id, email, status: "removed" } }
  }
  await removeMember(db, identity, found.person.userId)
  return {
    text: `${found.person.name} is removed from ${identity.org.name}: their teams and the rules naming them are gone.`,
    data: { member_id: found.person.userId, email, status: "removed" },
  }
}

export const memberRemove = defineFunction({
  name: "member.remove",
  connector: "member",
  class: "sensitive",
  origin: "paquet",
  description:
    "Removes a member from the organisation, or withdraws a pending person, by email: they leave their teams and lose every access; their private pages stay, visible to nobody. Two steps: call without confirm for the summary, then with confirm: true. Administrators only for a member (the last administrator stays); a pending person also by whoever added them. In French: retirer membre, supprimer accès, départ.",
  schema: memberRemoveArgsSchema,
  examples: [{ member: "lea.roux@example.com" }],
  refusals: ["Not an administrator (a member) or neither an administrator nor who added them (a pending person).", "The last administrator.", "An unknown person."],
  run: (context, args) => remove(context, args.member),
  summarize: async (context, args) => {
    requireMemberManager(context.identity, "remove people")
    const directory = await readDirectory(context)
    const found = await findPerson(context, directory, args.member)
    if (found.kind === "none") throw unknownPerson(context.identity, args.member)
    if (found.kind === "pending") {
      return { text: `Withdraw the pending access of ${args.member} to ${context.identity.org.name}.`, data: { email: args.member, status: "pending" } }
    }
    requireAdmin(context.identity, "remove a member")
    const teams = slugsOf(directory.teams, teamIdsOf(directory, found.person.userId))
    return {
      text: `Remove ${found.person.name} <${args.member}> from ${context.identity.org.name}: they leave ${teams.length > 0 ? teams.join(", ") : "no team"} and lose every access.`,
      data: { email: args.member, name: found.person.name, status: "active", teams },
    }
  },
})

async function createTeamOf(context: FunctionContext, name: string): Promise<FunctionOutput> {
  const { db, identity } = context
  requireAdmin(identity, "create a team")
  const { teams } = await teamRoster(db, identity.org.id)
  const same = teams.find((team) => normalizeTitle(team.name) === normalizeTitle(name))
  const next = ["member.add", "node.share"]
  if (same) {
    return { text: `Team ${same.name} already exists, with its folder ${same.slug}: nothing to create.`, data: { slug: same.slug, name: same.name, created: false }, next }
  }
  const { data } = await createTeam(db, identity, { name })
  return {
    text: `Team ${data.name} created, with its folder ${data.slug}. Write pages under it with write; give a team read or write on a folder with node.share (subject team).`,
    data: { slug: data.slug, name: data.name, created: true },
    teamId: data.id,
    next,
  }
}

export const teamCreate = defineFunction({
  name: "team.create",
  connector: "team",
  class: "write",
  origin: "paquet",
  description:
    "Creates a team of the organisation, with its folder at its slug, owned by the team. Idempotent: a team of the same name, case and accents aside, is returned unchanged. Administrators only. Then add people with member.add, and give teams read or write on folders with node.share. In French: créer équipe, groupe, rôle.",
  schema: teamCreateArgsSchema,
  examples: [{ name: "Support" }],
  refusals: ["Not an administrator.", "A reserved name, or a name whose path is taken by another team or a page.", "The organisation at its teams limit."],
  next: ["member.add", "node.share"],
  run: (context, args) => createTeamOf(context, args.name),
})

/** Les fonctions des membres et des équipes, groupées pour le registre. */
export const memberFunctions = [memberList, memberAdd, memberSetTeams, memberRemove, teamCreate]
