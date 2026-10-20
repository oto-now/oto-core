// Opérations d'`admin_team` (E08-S02, AC20, AC21) : chaque opération passe par les services d'équipes
// d'E05-S03, qui décident leurs droits (E01-S07 AC22) ; un refus de droit y garde son texte. Ne sont
// réécrits ici que les refus que le modèle doit lire dans les termes de l'outil (nom pris, objets
// possédés). E05-S13 (AC-25) : une équipe a zéro, un ou plusieurs responsables (`add_lead`, `remove_lead`) ;
// `set_lead` garde son sens, un seul responsable. Le dossier `<slug>` et `<slug>/contexte` d'une équipe créée naissent par le
// déclencheur d'E01-S04 (P39), jamais par le service.
import * as z from "zod/v4"
import { createTeamSchema, emailSchema, orgSlugSchema, type TeamView } from "../../../schemas"
import { findMember, findTeam } from "../../../server/admin/context"
import { leadWord, sameEmail } from "../../../server/directory"
import { isPlatformError, PlatformError } from "../../../server/errors"
import type { Identity } from "../../../server/identity"
import {
  addTeamMember,
  createTeam,
  deleteTeam,
  describeTeamDeletion,
  listTeams,
  removeTeamMember,
  setTeamMemberRole,
  teamSlug,
  updateTeam,
} from "../../../server/teams"
import { firstOf, listLines, nothingWas, plural, renderHelp, targetOf, type AdminOutput, type OpCall, type OpTable } from "../ops"

const AFTER_WRITE = ["admin_team list"]
/** Chemins et noms cités au plus par un récapitulatif ou un refus de suppression (AC21). */
const NAMED = 10

const teamField = z.string().trim().min(1).max(100)
const teamName = createTeamSchema.shape.name

/** Le refus d'un nom pris (`name_taken`, `slug_taken` d'E05-S03), dans les termes de l'outil (AC20). */
function nameTaken(error: unknown, identity: Identity, name: string): unknown {
  const reason = isPlatformError(error) ? error.details?.reason : undefined
  if (reason !== "name_taken" && reason !== "slug_taken") return error
  return new PlatformError(
    "conflict",
    `A team named ${name} (or with the slug ${teamSlug(name)}) already exists in ${identity.org.slug}. Pick another name.`,
  )
}

type Person = { name: string; email: string }

/** Les responsables de l'équipe, par nom (`TeamView.members` les range d'abord) ; E05-S13 : zéro, un ou plusieurs. */
function leadsOf(team: TeamView): Person[] {
  return team.members.filter((member) => member.role === "lead").map((member) => ({ name: member.name, email: member.email }))
}

/** « lead: none », « lead: Claire Morel », « leads: Claire Morel, Léa Roux ». */
function leadsText(leads: readonly Person[]): string {
  return `${leadWord(leads.length)}: ${leads.map((lead) => lead.name).join(", ") || "none"}`
}

async function list(call: OpCall): Promise<AdminOutput> {
  const identity = targetOf(call)
  const org = identity.org.slug
  const teams = await listTeams(call.deps.db, identity)
  if (teams.length === 0) {
    const text = `${org} has no team yet. Create one with admin_team {"op": "create", "org": "${org}", "name": "<Name>"}.`
    return { text, data: { teams: [] }, nextActions: ["admin_team create"] }
  }
  const line = (team: TeamView) => {
    const leads = leadsOf(team)
    // Un responsable sans email (ligne écrite sans email, E01-S09) : le texte le dit (M20).
    const named = leads.map((lead) => `${lead.name} ${lead.email || "(no email)"}`).join(", ")
    return `- ${team.slug} · ${team.name} · ${leads.length === 0 ? "no lead" : `${leadWord(leads.length)} ${named}`} · ${plural(team.members.length, "member", "members")}`
  }
  // `lead` (le premier) reste pour qui le lisait ; `leads` les nomme tous (AC-25).
  const data = teams.map((team) => ({ slug: team.slug, name: team.name, lead: leadsOf(team)[0] ?? null, leads: leadsOf(team), members: team.members.length }))
  return { text: listLines(teams, line).join("\n"), data: { teams: data }, nextActions: ["admin_team create", "admin_team add_member"] }
}

async function create(call: OpCall): Promise<AdminOutput> {
  const { db } = call.deps
  const identity = targetOf(call)
  const name = String(call.input.name)
  const email = typeof call.input.email === "string" ? call.input.email : undefined
  // L'email d'abord : un responsable inconnu ne laisse pas une équipe créée sans lui.
  const lead = email ? await findMember(db, identity, email) : null
  const created = await createTeam(db, identity, { name }).catch((error: unknown) => {
    throw nameTaken(error, identity, name)
  })
  const { slug } = created.data
  const head = `Team ${created.data.name} created in ${identity.org.slug} with the slug ${slug} (folder ${slug}, context page ${slug}/contexte)`
  const output = { data: { team: created.data }, target: `team:${slug}`, nextActions: AFTER_WRITE }
  // Sans email, le créateur membre de l'organisation en est le responsable (`createTeam`, E11-S10 AC-c3).
  if (!lead) return { ...output, text: identity.viaGrant ? `${head}, no lead yet.` : `${head}, lead ${identity.user.name} ${identity.user.email} (you).` }
  try {
    await updateTeam(db, identity, created.data.id, { leadUserId: lead.userId })
  } catch (failure) {
    console.error("[platform] admin_team create: lead not set", isPlatformError(failure) ? failure.code : failure)
    throw new PlatformError("internal", `Team ${created.data.name} was created (slug ${slug}) but its lead could not be set: call admin_team {"op": "set_lead"}.`)
  }
  return { ...output, text: `${head}, lead ${lead.name} ${lead.email}.` }
}

async function rename(call: OpCall): Promise<AdminOutput> {
  const { db } = call.deps
  const identity = targetOf(call)
  const team = await findTeam(db, identity, String(call.input.team))
  const name = String(call.input.name)
  const renamed = await updateTeam(db, identity, team.id, { name }).catch((error: unknown) => {
    throw nameTaken(error, identity, name)
  })
  const text = `Team renamed: ${team.name} → ${renamed.data.name} (slug ${renamed.data.slug}).`
  return { text, data: { team: renamed.data }, target: `team:${team.slug}`, nextActions: AFTER_WRITE }
}

async function setLead(call: OpCall): Promise<AdminOutput> {
  const { db } = call.deps
  const identity = targetOf(call)
  const team = await findTeam(db, identity, String(call.input.team))
  const output = { target: `team:${team.slug}`, nextActions: AFTER_WRITE }
  if (call.input.email === "") {
    await updateTeam(db, identity, team.id, { leadUserId: null })
    return { ...output, text: `Team ${team.name} has no lead now.`, data: { team: { slug: team.slug, lead: null } } }
  }
  const person = await findMember(db, identity, String(call.input.email))
  await updateTeam(db, identity, team.id, { leadUserId: person.userId })
  const lead = { name: person.name, email: person.email }
  return { ...output, text: `${person.name} ${person.email} now leads team ${team.name}.`, data: { team: { slug: team.slug, lead } } }
}

/** Un responsable de plus (AC-25) : la personne entre dans l'équipe au besoin ; les autres responsables le restent. */
async function addLead(call: OpCall): Promise<AdminOutput> {
  const { db } = call.deps
  const identity = targetOf(call)
  const team = await findTeam(db, identity, String(call.input.team))
  const person = await findMember(db, identity, String(call.input.email))
  const output = { target: `team:${team.slug}`, nextActions: AFTER_WRITE }
  const current = team.members.find((member) => member.userId === person.userId)
  if (current?.role === "lead") {
    return { ...output, text: `${person.email} already leads team ${team.name}; nothing changed.`, data: { team: { slug: team.slug, leads: leadsOf(team) } } }
  }
  if (!current) await addTeamMember(db, identity, team.id, { userId: person.userId })
  await setTeamMemberRole(db, identity, { teamId: team.id, userId: person.userId }, { role: "lead" })
  const leads = [...leadsOf(team), { name: person.name, email: person.email }].sort((a, b) => a.name.localeCompare(b.name, "fr"))
  return { ...output, text: `${person.name} ${person.email} now leads team ${team.name} (${leadsText(leads)}).`, data: { team: { slug: team.slug, leads } } }
}

/** Un responsable de moins (AC-25) : la personne reste membre de l'équipe ; les autres responsables le restent. */
async function removeLead(call: OpCall): Promise<AdminOutput> {
  const { db } = call.deps
  const identity = targetOf(call)
  const team = await findTeam(db, identity, String(call.input.team))
  const email = String(call.input.email)
  const member = team.members.find((candidate) => sameEmail(candidate.email, email))
  if (!member) throw new PlatformError("not_found", `${email} is not a member of team ${team.name}.`)
  const output = { target: `team:${team.slug}`, nextActions: AFTER_WRITE }
  const leads = leadsOf(team).filter((lead) => !sameEmail(lead.email, email))
  if (member.role !== "lead") {
    return { ...output, text: `${member.name} does not lead team ${team.name}; nothing changed.`, data: { team: { slug: team.slug, leads } } }
  }
  await setTeamMemberRole(db, identity, { teamId: team.id, userId: member.userId }, { role: "member" })
  return { ...output, text: `${member.name} no longer leads team ${team.name} and stays a member (${leadsText(leads)}).`, data: { team: { slug: team.slug, leads } } }
}

async function addMember(call: OpCall): Promise<AdminOutput> {
  const { db } = call.deps
  const identity = targetOf(call)
  const team = await findTeam(db, identity, String(call.input.team))
  const person = await findMember(db, identity, String(call.input.email))
  const { data } = await addTeamMember(db, identity, team.id, { userId: person.userId })
  const output = { data: { team: { slug: team.slug }, member: { name: person.name, email: person.email, added: data.added } }, target: `team:${team.slug}` }
  if (!data.added) return { ...output, text: `${person.email} is already a member of team ${team.name}; nothing changed.`, nextActions: AFTER_WRITE }
  const count = plural(team.members.length + 1, "member", "members")
  return { ...output, text: `${person.name} ${person.email} added to team ${team.name} (${count}).`, nextActions: AFTER_WRITE }
}

async function removeMember(call: OpCall): Promise<AdminOutput> {
  const { db } = call.deps
  const identity = targetOf(call)
  const team = await findTeam(db, identity, String(call.input.team))
  const email = String(call.input.email)
  const member = team.members.find((candidate) => sameEmail(candidate.email, email))
  const notInTeam = new PlatformError("not_found", `${email} is not a member of team ${team.name}.`)
  if (!member) throw notInTeam
  const removed = await removeTeamMember(db, identity, team.id, member.userId)
  if (!removed.data.removed) throw notInTeam
  const leads = leadsOf(team).filter((lead) => !sameEmail(lead.email, email))
  const count = plural(team.members.length - 1, "member", "members")
  const text = `${member.name} removed from team ${team.name} (${count}; ${leadsText(leads)}).`
  return { text, data: { team: { slug: team.slug }, member: { name: member.name, email: member.email } }, target: `team:${team.slug}`, nextActions: AFTER_WRITE }
}

/** Des objets nommés : leurs premiers noms, et leur nombre quand la liste n'en porte que le début. */
type Named = { names: string[]; total: number }

/** Le refus d'une équipe qui possède encore (AC21, H69) : dix chemins au plus, puis les libellés des comptes. */
function ownsObjects(teamName: string, nodes: Named, accounts: Named): PlatformError {
  const owned = (objects: Named, one: string, many: string) =>
    objects.total > 0 ? [`${plural(objects.total, one, many)} (${firstOf(objects.names, NAMED, objects.total)})`] : []
  const parts = [...owned(nodes, "page", "pages"), ...owned(accounts, "account", "accounts")]
  return new PlatformError(
    "conflict",
    `Team ${teamName} owns ${parts.join(" and ")}: it cannot be deleted while it owns them. Transfer the pages to another owner first; a team that owns accounts cannot be deleted in V1.`,
  )
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

async function remove(call: OpCall): Promise<AdminOutput> {
  const { db } = call.deps
  const identity = targetOf(call)
  const org = identity.org.slug
  const found = await findTeam(db, identity, String(call.input.team))
  const plan = await describeTeamDeletion(db, identity, found.slug)
  const { team, blockedBy } = plan
  if (blockedBy) {
    const nodes = blockedBy.nodes.map((node) => node.path)
    const accounts = blockedBy.accounts.map((account) => account.label)
    throw ownsObjects(team.name, { names: nodes, total: nodes.length }, { names: accounts, total: accounts.length })
  }
  if (call.input.confirm !== true) {
    const names = firstOf(plan.members.map((member) => member.name), NAMED)
    const members = plan.members.length > 0 ? `its ${plural(plan.members.length, "member", "members")} (${names}) lose this team` : "it has no member"
    const rules = plan.rules === 1 ? "1 access rule that names it is removed" : `${plan.rules} access rules that name it are removed`
    // 1.4.13 : ses pages à la corbeille partent avec elle, pour de bon.
    const trashed = plan.trashed > 0 ? `; ${plural(plan.trashed, "page in the trash is", "pages in the trash are")} erased for good` : ""
    const text = [`About to delete team ${team.name} (${team.slug}) of ${org}: ${members}; ${rules}${trashed}.`, nothingWas("deleted")].join("\n")
    return { text, data: { summary: plan }, target: `team:${team.slug}`, nextActions: [] }
  }
  await deleteTeam(db, identity, team.id).catch((error: unknown) => {
    if (!isPlatformError(error) || error.details?.reason !== "team_owns_objects") throw error
    const { details } = error
    const nodes = { names: stringsOf(details.nodes), total: Number(details.nodesTotal) }
    throw ownsObjects(team.name, nodes, { names: stringsOf(details.accounts), total: Number(details.accountsTotal) })
  })
  return { text: `Team ${team.name} deleted from ${org}.`, data: { team: { slug: team.slug } }, target: `team:${team.slug}`, nextActions: AFTER_WRITE }
}

const onTeam = { org: orgSlugSchema, team: teamField }
/** Un email, ou `""` pour laisser l'équipe sans responsable (`set_lead`, N22). */
const leadEmail = z.literal("").or(emailSchema)

export const TEAM_OPS: OpTable = {
  help: {
    schema: z.object({}),
    org: "none",
    twoStep: false,
    summary: "Gives the fields of each operation of admin_team.",
    example: {},
    refusals: [],
    run: async () => ({ text: renderHelp("admin_team", TEAM_OPS), nextActions: [] }),
  },
  list: {
    schema: z.object({ org: orgSlugSchema }),
    org: "target",
    twoStep: false,
    summary: "Lists the teams of the organisation with their slug, lead and number of members.",
    example: { org: "acme" },
    refusals: [],
    run: list,
  },
  create: {
    schema: z.object({ org: orgSlugSchema, name: teamName, email: emailSchema.optional() }),
    org: "target",
    twoStep: false,
    summary: "Creates a team from a name (the result gives its slug), with its folder and context page, and optionally its lead.",
    example: { org: "acme", name: "Ventes", email: "claire@acme.example" },
    refusals: ["conflict: A team named <name> (or with the slug <slug>) already exists in <org>.", "not_found: No member of <org> has the email <email>."],
    run: create,
  },
  rename: {
    schema: z.object({ ...onTeam, name: teamName }),
    org: "target",
    twoStep: false,
    summary: "Renames a team; its slug does not change.",
    example: { org: "acme", team: "ventes", name: "Ventes France" },
    refusals: ["not_found: Unknown team <team> in <org>.", "conflict: A team named <name> (or with the slug <slug>) already exists in <org>."],
    run: rename,
  },
  set_lead: {
    schema: z.object({ ...onTeam, email: leadEmail }),
    org: "target",
    twoStep: false,
    summary: 'Makes a person the only lead of a team, who joins it if needed, the other leads staying members; email "" leaves the team without a lead.',
    example: { org: "acme", team: "ventes", email: "claire@acme.example" },
    refusals: ["not_found: Unknown team <team> in <org>.", "not_found: No member of <org> has the email <email>."],
    run: setLead,
  },
  add_lead: {
    schema: z.object({ ...onTeam, email: emailSchema }),
    org: "target",
    twoStep: false,
    summary: "Adds a lead to a team, who joins it if needed; the other leads stay leads.",
    example: { org: "acme", team: "ventes", email: "lea@acme.example" },
    refusals: ["not_found: Unknown team <team> in <org>.", "not_found: No member of <org> has the email <email>."],
    run: addLead,
  },
  remove_lead: {
    schema: z.object({ ...onTeam, email: emailSchema }),
    org: "target",
    twoStep: false,
    summary: "Removes a person from the leads of a team; they stay a member, the other leads stay leads.",
    example: { org: "acme", team: "ventes", email: "lea@acme.example" },
    refusals: ["not_found: Unknown team <team> in <org>.", "not_found: <email> is not a member of team <name>."],
    run: removeLead,
  },
  add_member: {
    schema: z.object({ ...onTeam, email: emailSchema }),
    org: "target",
    twoStep: false,
    summary: "Adds a member of the organisation to a team; already in it, nothing changes.",
    example: { org: "acme", team: "support", email: "marc@acme.example" },
    refusals: ["not_found: Unknown team <team> in <org>.", "not_found: No member of <org> has the email <email>."],
    run: addMember,
  },
  remove_member: {
    schema: z.object({ ...onTeam, email: emailSchema }),
    org: "target",
    twoStep: false,
    summary: "Removes a person from a team, a lead included; the other leads stay leads.",
    example: { org: "acme", team: "support", email: "marc@acme.example" },
    refusals: ["not_found: <email> is not a member of team <name>."],
    run: removeMember,
  },
  delete: {
    schema: z.object({ ...onTeam, confirm: z.boolean().optional() }),
    org: "target",
    twoStep: true,
    summary: "Deletes a team that owns no page and no account: its members lose it and the access rules that name it are removed.",
    example: { org: "acme", team: "conseil" },
    refusals: ["not_found: Unknown team <team> in <org>.", "conflict: Team <name> owns pages or accounts: it cannot be deleted while it owns them."],
    run: remove,
  },
}
