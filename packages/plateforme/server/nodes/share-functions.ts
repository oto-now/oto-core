// Le partage d'un nœud derrière `call` (1.4.13) : `node.access` lit qui y a accès, comme le panneau « Partager » le montre
// (équipe propriétaire, toute l'organisation, personnes et équipes ajoutées, membres de l'équipe et leur niveau réel, lien
// public) ; `node.share` règle l'accès d'un sujet par les services de l'écran (`setNodeRule`, `removeRule`,
// `setGeneralAccess`), qui décident chaque droit. Sans elles, un assistant renvoyait la personne au panneau pour
// partager une page qu'il venait d'écrire.
import { nodeAccessArgsSchema, nodeShareArgsSchema, normalizeTitle, type NodeRulesView, type NodeShareArgs } from "../../schemas"
import { defineFunction, type FunctionContext, type FunctionOutput } from "../catalog/define"
import { memberDirectory, sameEmail, teamsWithLeads, type DirectoryEntry } from "../directory"
import { RESERVED_KINDS, tokenMatches } from "../pseudonym/token"
import { boundedList, inTransaction, PlatformError } from "../errors"
import { setGeneralAccess } from "../general-access"
import { listNodeRules, nodeRulesIn, removeRule, setNodeRule } from "../rules"
import { activeShareAt } from "../shares"

/** Membres de l'équipe rendus au plus dans `data` : au-delà, leur nombre. */
const MEMBERS_IN_DATA = 50

const LEVELS_LINE = "Levels: none hides the node and everything under it; read; write edits and publishes; manage also shares, moves and deletes (granted by an administrator only)."

type LinkState = { kind: "reserved" } | { kind: "none" } | { kind: "active"; includeChildren: boolean; createdAt: string }

function ownerLine(view: NodeRulesView): string {
  const { owner } = view
  if (owner.kind === "team") return `owned by team ${owner.teamName ?? "?"}${owner.leadName ? ` (lead: ${owner.leadName})` : ""}`
  if (owner.kind === "user") return `in the private space of ${owner.userName ?? "a person"}: only the people and teams added see it`
  return "in the shared space: every member reads it at least"
}

function linkLine(link: LinkState): string {
  if (link.kind === "reserved") return "Public link: reserved to those who manage the node."
  if (link.kind === "none") return "Public link: none."
  return `Public link: active since ${link.createdAt.slice(0, 10)}, ${link.includeChildren ? "pages under it included" : "this page only"}.`
}

/**
 * Le niveau de toute l'organisation, dit comme le panneau : son niveau réel, règle d'un dossier au-dessus comprise
 * (1.4.13) ; sans lui, sa règle sur le nœud, sinon seuls l'équipe et les ajoutés (ou chacun lit).
 */
function organisationLevel(view: NodeRulesView): string {
  if (view.organisation) return view.organisation.level
  if (view.general) return view.general.level
  return view.owner.kind === "org" ? "read" : "none"
}

/** Ce que `node.access` rend, et ce que `node.share` relit après son geste. */
export function accessReport(view: NodeRulesView, orgName: string, link: LinkState): Pick<FunctionOutput, "text" | "data"> {
  const ownTeamId = view.owner.kind === "team" ? view.owner.teamId : undefined
  const added = view.rules.filter((rule) => !(rule.subject.kind === "team" && rule.subject.id === ownTeamId))
  const people = view.people ?? []
  const levels = ["none", "read", "write", "manage"] as const
  const lines = [`Access to ${view.path} « ${view.title} », ${ownerLine(view)}. Your level: ${levels[view.viewerLevel]}.`]
  if (view.team) lines.push(`- Team ${view.owner.teamName ?? "?"} (owner), default for its members: ${view.team.level}${view.team.ruleId ? " (set here)" : " (inherited)"}.`)
  if (view.owner.kind !== "user") {
    const org = organisationLevel(view)
    lines.push(`- Whole organisation ${orgName}: ${org === "none" ? "none (only the owner team and the people or teams added)" : org}.`)
  }
  const ruleText = (rule: NodeRulesView["rules"][number]) => `${rule.subject.kind} ${rule.subject.name}: ${rule.level}`
  lines.push(added.length > 0 ? `- Added: ${boundedList(added.map(ruleText), "; ")}.` : "- Added: nobody.")
  if (people.length > 0) {
    const member = (person: (typeof people)[number]) => `${person.name}${person.lead ? " (lead)" : ""}: ${person.level}${person.ruleId ? " (set here)" : ""}`
    lines.push(`- Members of team ${view.owner.teamName ?? "?"}: ${boundedList(people.map(member), "; ")}.`)
  }
  lines.push(linkLine(link), LEVELS_LINE)
  const data = {
    path: view.path,
    title: view.title,
    owner: { kind: view.owner.kind, team: view.owner.teamName ?? null },
    your_level: levels[view.viewerLevel],
    owner_team_default: view.team ? { level: view.team.level, set_here: view.team.ruleId !== null } : null,
    organisation: view.owner.kind === "user" ? null : organisationLevel(view),
    added: added.map((rule) => ({ kind: rule.subject.kind, name: rule.subject.name, level: rule.level })),
    members: people.slice(0, MEMBERS_IN_DATA).map((person) => ({ name: person.name, lead: person.lead, level: person.level, set_here: person.ruleId !== null })),
    members_total: people.length,
    public_link: link.kind === "active" ? { include_children: link.includeChildren, created_at: link.createdAt } : link.kind,
  }
  return { text: lines.join("\n"), data }
}

/**
 * Le panneau du nœud et son lien public dans une transaction (`supabase-patterns.md § Couplage à Supabase`) : le lien,
 * pour qui gère le nœud seul (le service le réserve) ; « réservé » pour les autres.
 */
async function readAccess(context: FunctionContext, path: string): Promise<Pick<FunctionOutput, "text" | "data">> {
  const { db, identity } = context
  return inTransaction(db, "node.access", async (sql) => {
    const view = await nodeRulesIn({ db, sql }, identity, path, { people: true })
    if (view.viewerLevel < 3) return accessReport(view, identity.org.name, { kind: "reserved" })
    const share = await activeShareAt(sql, identity.org.id, view.path)
    return accessReport(view, identity.org.name, share ? { kind: "active", ...share } : { kind: "none" })
  })
}

export const nodeAccess = defineFunction({
  name: "node.access",
  connector: "node",
  class: "read",
  origin: "paquet",
  description:
    "Reads who has access to a page, procedure, table or folder, as the Share panel shows it: the owner team's default level, the whole organisation's access, the people and teams added, each member of the owner team with their real level, and the public link. Use it before changing access with node.share, or when the user asks who sees a page. In French: qui a accès, droits, partage, permissions.",
  schema: nodeAccessArgsSchema,
  examples: [{ path: "ventes/devis" }],
  refusals: ["Unknown path: not a node you can read."],
  next: ["node.share"],
  run: (context, args) => readAccess(context, args.path),
})

type Subject = { kind: "team" | "user"; id: string; text: string }

/** Plusieurs candidats : la fonction ne change rien et demande de choisir (`mcp-patterns.md § 3`). */
class Ambiguous {
  constructor(readonly output: FunctionOutput) {}
}

function ambiguous(what: string, name: string, candidates: string[]): Ambiguous {
  return new Ambiguous({
    text: `Several ${what} match « ${name} »: ${boundedList(candidates, "; ")}. Nothing changed: ask the user which one, then call again with that exact name${what === "members" ? " or email" : ""}.`,
    data: { changed: false, candidates },
  })
}

/** Le meilleur ensemble de candidats : le nom exact d'abord, sinon ceux qui le contiennent. */
function matching<T>(items: readonly T[], name: string, labelOf: (item: T) => string): T[] {
  const wanted = normalizeTitle(name)
  const exact = items.filter((item) => normalizeTitle(labelOf(item)) === wanted)
  return exact.length > 0 ? exact : items.filter((item) => normalizeTitle(labelOf(item)).includes(wanted))
}

/**
 * Les membres que `name` désigne quand la porte pseudonymise : le jeton reçu est celui que leur nom ou leur email reçoit à
 * la sortie (`pseudonymisation.md` § Les jetons dans les arguments). Un jeton de valeur, à sens unique, ne désigne
 * personne ; sans pseudonymisation, aucun.
 */
function byToken(context: FunctionContext, directory: readonly DirectoryEntry[], name: string): DirectoryEntry[] {
  const masked = context.pseudonymized
  const [entity] = tokenMatches(name, (_found, kind) => !RESERVED_KINDS.has(kind))
  if (!masked || entity?.[0] !== name) return []
  return directory.filter((person) => masked(person.name) === name || (typeof person.email === "string" && masked(person.email) === name))
}

async function resolvePerson(context: FunctionContext, name: string): Promise<Subject | Ambiguous> {
  const directory = await memberDirectory(context.db, context.identity.org.id)
  const tokened = byToken(context, directory, name)
  const byEmail = tokened.length > 0 ? tokened : directory.filter((person) => sameEmail(person.email, name.toLowerCase()))
  const found = byEmail.length > 0 ? byEmail : matching(directory, name, (person) => person.name)
  if (found.length > 1) return ambiguous("members", name, found.map((person) => `${person.name} <${person.email}>`).sort())
  const [person] = found
  if (!person) throw new PlatformError("not_found", `No member of ${context.identity.org.name} named ${name}. Members: ${boundedList(directory.map((entry) => entry.name))}.`)
  return { kind: "user", id: person.userId, text: `person ${person.name}` }
}

async function resolveTeam(context: FunctionContext, name: string): Promise<Subject | Ambiguous> {
  const teams = await inTransaction(context.db, "node.share: teams", (sql) => teamsWithLeads(sql, context.identity.org.id))
  const found = matching(teams, name, (team) => team.name)
  if (found.length > 1) return ambiguous("teams", name, found.map((team) => team.name).sort())
  const [team] = found
  if (!team) throw new PlatformError("not_found", `No team named ${name} in ${context.identity.org.name}. Teams: ${boundedList(teams.map((entry) => entry.name)) || "none"}.`)
  return { kind: "team", id: team.id, text: `team ${team.name}` }
}

/** Le sujet d'une personne, d'une équipe ou de l'équipe propriétaire ; `name` exigé pour les deux premiers. */
async function subjectOf(context: FunctionContext, view: NodeRulesView, args: NodeShareArgs): Promise<Subject | Ambiguous> {
  if (args.subject === "owner_team") {
    if (view.owner.kind !== "team" || !view.owner.teamId) {
      throw new PlatformError("invalid_arguments", `${view.path} is not owned by a team: share it with a person, a team or the organisation.`)
    }
    return { kind: "team", id: view.owner.teamId, text: `team ${view.owner.teamName ?? "?"} (owner)` }
  }
  if (!args.name) throw new PlatformError("invalid_arguments", `name is required with subject ${args.subject}: the ${args.subject === "person" ? "full name or email of a member" : "name of a team"}.`)
  return args.subject === "person" ? resolvePerson(context, args.name) : resolveTeam(context, args.name)
}

/** Le geste sur un sujet nommé : poser son niveau, ou retirer sa règle sur ce nœud (aucune : rien ne change). */
async function shareWithSubject(context: FunctionContext, view: NodeRulesView, subject: Subject, level: NodeShareArgs["level"]) {
  const { db, identity } = context
  if (level !== "remove") {
    const set = await setNodeRule(db, identity, { path: view.path, subject: { kind: subject.kind, id: subject.id }, level })
    return { change: `${subject.text} now has ${level} on ${view.path} and below, unless a closer rule says otherwise.`, changed: true, teamId: set.teamId }
  }
  const rule = view.rules.find((candidate) => candidate.subject.kind === subject.kind && candidate.subject.id === subject.id)
  if (!rule) return { change: `${subject.text} has no rule on ${view.path}: nothing to remove.`, changed: false, teamId: null }
  const removed = await removeRule(db, identity, rule.id)
  return { change: `The rule of ${subject.text} on ${view.path} is removed: the closest rule above applies.`, changed: true, teamId: removed.teamId }
}

async function shareWithOrganisation(context: FunctionContext, view: NodeRulesView, level: NodeShareArgs["level"]) {
  // « remove » retire la règle d'organisation du nœud (le dossier au-dessus décide alors) ; « none » la pose à aucun accès,
  // ce qui ferme une page qu'un dossier ouvre (1.4.13).
  const restricted = level === "remove"
  const input = restricted ? { path: view.path, access: "restricted" } : { path: view.path, access: "organisation", level }
  const done = await setGeneralAccess(context.db, context.identity, input)
  const org = context.identity.org.name
  const change = restricted
    ? `The rule of the whole organisation ${org} on ${view.path} is removed: the closest rule above applies, otherwise only the owner team and the people or teams added keep access.`
    : `The whole organisation ${org} now has ${level} on ${view.path} (the owner team gets at least the same).`
  return { change: done.data.changed ? change : `Nothing to change: ${change}`, changed: done.data.changed, teamId: done.teamId }
}

async function share(context: FunctionContext, args: NodeShareArgs): Promise<FunctionOutput> {
  const view = await listNodeRules(context.db, context.identity, args.path, { people: true })
  let done: { change: string; changed: boolean; teamId: string | null }
  if (args.subject === "organisation") done = await shareWithOrganisation(context, view, args.level)
  else {
    const subject = await subjectOf(context, view, args)
    if (subject instanceof Ambiguous) return subject.output
    done = await shareWithSubject(context, view, subject, args.level)
  }
  const after = await readAccess(context, view.path)
  return { text: `${done.change}\n\n${after.text}`, data: { changed: done.changed, change: done.change, access: after.data }, teamId: done.teamId }
}

export const nodeShareFunction = defineFunction({
  name: "node.share",
  connector: "node",
  class: "write",
  origin: "paquet",
  description:
    "Sets or removes the access of one person, one team, the owner team or the whole organisation to a page, procedure, table or folder and everything under it, as the Share panel does: level none, read, write or manage, or remove the rule here. Use it when the user asks to share, open, restrict or hide a content. Needs the manage level; only an administrator grants manage. Read node.access first. In French: partager, donner accès, retirer l'accès, droits, ouvrir à l'entreprise, masquer.",
  schema: nodeShareArgsSchema,
  examples: [
    { path: "ventes/devis", subject: "person", name: "Léa Roux", level: "read" },
    { path: "ventes/devis", subject: "organisation", level: "read" },
  ],
  refusals: [
    "Unknown path: not a node you can read.",
    "Sharing is reserved to those who manage the node; manage is granted by an administrator only: the refusal says whom to ask.",
    "A person or a team that does not exist, or several that match: the answer lists them, nothing changes.",
    "owner_team on a node that no team owns; organisation on a private space.",
    "The owner team below the whole organisation on the same node: lower the organisation first.",
    "The rules changed meanwhile: read node.access again, then retry.",
  ],
  next: ["node.access"],
  run: (context, args) => share(context, args),
})
