// Les partages d'une équipe : ce qu'elle partage hors d'elle, ce que d'autres équipes partagent avec elle, et les liens
// de ses contenus que ses membres ne peuvent pas ouvrir. Un partage est la seule source : tout se calcule ici, à la
// lecture, des règles d'accès, des contenus et des liens. Réservé aux membres de l'équipe et aux administrateurs, décidé
// avant toute lecture. Lu par `GET teams/<slug>/shares` (le dialogue « Les partages de … ») et par la fonction
// `team.shares`. Sans lui, une équipe ne voit nulle part ce qu'elle partage, et tient ce catalogue à la main.
import { BROKEN_LINKS_MAX, teamSharesArgsSchema, type ShareLevel, type ShareSubject, type TeamShares, type TeamSharesArgs } from "../schemas/team-shares"
import { ACCESS_LEVELS, isOrgAdmin, nodeLevels, teamReadLevels, type AccessLevel } from "./access"
import { defineFunction, type FunctionContext, type FunctionOutput } from "./catalog/define"
import type { PlatformDb } from "./db"
import { memberDirectory, teamRoster } from "./directory"
import { boundedList, inTransaction, PlatformError } from "./errors"
import type { Identity } from "./identity"
import { formatCount } from "./nodes/document"
import { guestTeamsOf } from "./nodes/guest-entries"
import { comparePaths, kindOf } from "./nodes/view"

const RANK: Record<ShareLevel, number> = { read: 1, write: 2, manage: 3 }

type RuleRow = { node_id: string; path: string; title: string; kind: string; team_id: string | null; user_id: string | null; org: boolean; level: ShareLevel }
type NodeRow = { id: string; path: string; title: string; summary: string; kind: string }
type LinkRow = { from_path: string; from_title: string; to_id: string; to_path: string; to_title: string }

/** Le refus d'un appelant ni membre ni administrateur : sans lecture, donc sans dire si l'équipe existe. */
function reserved(slug: string): PlatformError {
  return new PlatformError("forbidden", `The shares of team ${slug} are reserved to its members and to the administrators. Ask a member of the team, or an administrator.`)
}

type Facts = { rules: RuleRow[]; nodes: NodeRow[]; links: LinkRow[] }

/** Les règles qui partagent les contenus de l'équipe, les contenus publiés des autres équipes et les liens de ses contenus, en une transaction. */
function readFacts(db: PlatformDb, orgId: string, team: { id: string; slug: string }, otherSlugs: readonly string[]): Promise<Facts> {
  return inTransaction(db, "teamShares", async (sql) => {
    const rules = await sql<RuleRow[]>`
      select r.node_id, n.path, n.title, n.kind, r.subject_team_id as team_id, r.subject_user_id as user_id, r.subject_org as org, r.level
        from platform.access_rules r
        join platform.nodes n on n.id = r.node_id
       where r.org_id = ${orgId} and n.deleted_at is null and r.level in ('read', 'write', 'manage')
         and split_part(n.path, '/', 1) = ${team.slug}`
    const nodes = await sql<NodeRow[]>`
      select id, path, title, summary, kind from platform.nodes
       where org_id = ${orgId} and deleted_at is null and status = 'published' and split_part(path, '/', 1) = any(${[...otherSlugs]}::text[])`
    const links = await sql<LinkRow[]>`
      select s.path as from_path, s.title as from_title, t.id as to_id, t.path as to_path, t.title as to_title
        from platform.links l
        join platform.nodes s on s.id = l.source_node_id
        join platform.nodes t on t.id = l.target_node_id
       where l.org_id = ${orgId} and s.deleted_at is null and s.status = 'published' and t.deleted_at is null
         and split_part(s.path, '/', 1) = ${team.slug}`
    return { rules, nodes, links }
  })
}

type Names = { teams: ReadonlyMap<string, { slug: string; name: string }>; people: ReadonlyMap<string, string>; members: ReadonlySet<string> }

/** Avec qui un contenu de l'équipe est partagé : les équipes par nom, toute l'organisation, puis les personnes par nom ; chacun à son plus haut niveau. */
function subjectsOf(rules: readonly RuleRow[], teamId: string, names: Names): ShareSubject[] {
  const best = new Map<string, ShareSubject>()
  const keep = (key: string, subject: ShareSubject) => {
    const known = best.get(key)
    if (!known || RANK[subject.level] > RANK[known.level]) best.set(key, subject)
  }
  for (const rule of rules) {
    if (rule.team_id !== null && rule.team_id !== teamId) keep(`team:${rule.team_id}`, { kind: "team", name: names.teams.get(rule.team_id)?.name ?? rule.team_id, level: rule.level })
    if (rule.user_id !== null && !names.members.has(rule.user_id)) keep(`user:${rule.user_id}`, { kind: "user", name: names.people.get(rule.user_id) ?? "?", level: rule.level })
    if (rule.org) keep("org", { kind: "org", name: "", level: rule.level })
  }
  const order = { team: 0, org: 1, user: 2 }
  return [...best.values()].sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name, "fr"))
}

/**
 * Les partages de l'équipe `slug`. Le droit d'abord, sans lecture : ses membres (`identity.teams`) et les
 * administrateurs. Puis l'annuaire, les faits en une transaction, et les niveaux en lots : ceux de l'appelant (ce qu'il
 * lit, ce qu'il gère) et ceux d'un membre de la seule équipe (ce que l'équipe reçoit, les liens qu'elle n'ouvre pas).
 * Ce que d'autres équipes partagent avec elle est la vue invité d'un tel membre (`guestTeamsOf`) : les lignes que le
 * rail et `context` lui montrent, un partage avec toute l'organisation compris.
 */
export async function teamShares(db: PlatformDb, identity: Identity, slug: string): Promise<TeamShares> {
  if (!isOrgAdmin(identity) && !identity.teams.some((team) => team.slug === slug)) throw reserved(slug)
  const [roster, directory] = await Promise.all([teamRoster(db, identity.org.id), memberDirectory(db, identity.org.id)])
  const team = roster.teams.find((one) => one.slug === slug)
  if (!team) throw new PlatformError("not_found", `No team ${slug} in ${identity.org.name}.`)
  const names: Names = {
    teams: new Map(roster.teams.map((one) => [one.id, one])),
    people: new Map(directory.map((person) => [person.userId, person.name])),
    members: new Set(roster.memberships.filter((link) => link.teamId === team.id).map((link) => link.userId)),
  }
  const others = roster.teams.filter((one) => one.id !== team.id)
  const facts = await readFacts(db, identity.org.id, team, others.map((one) => one.slug))
  const mine = facts.rules
  const [own, theirs] = await Promise.all([
    nodeLevels(db, identity, [...new Set(mine.map((rule) => rule.node_id)), ...facts.links.map((link) => link.to_id)]),
    teamReadLevels(db, identity, team.id, [...new Set([...facts.nodes.map((node) => node.id), ...facts.links.map((link) => link.to_id)])]),
  ])
  const reads = (levels: ReadonlyMap<string, AccessLevel>) => (id: string) => (levels.get(id) ?? ACCESS_LEVELS.none) >= ACCESS_LEVELS.read

  const opened = [...new Set(mine.map((rule) => rule.node_id))]
    .filter(reads(own))
    .flatMap((id) => {
      const rules = mine.filter((rule) => rule.node_id === id)
      const subjects = subjectsOf(rules, team.id, names)
      const [{ path, title, kind }] = rules
      return subjects.length > 0 ? [{ path, title, kind: kindOf(kind), manage: (own.get(id) ?? ACCESS_LEVELS.none) >= ACCESS_LEVELS.manage, subjects }] : []
    })
    .sort(comparePaths)
  const broken = facts.links.filter((link) => !reads(theirs)(link.to_id)).sort((a, b) => comparePaths({ path: a.from_path }, { path: b.from_path }) || comparePaths({ path: a.to_path }, { path: b.to_path }))
  return {
    team: { slug: team.slug, name: team.name },
    opened,
    received: guestTeamsOf(others, facts.nodes.filter((node) => reads(theirs)(node.id))).map((from) => ({
      team: { slug: from.slug, name: from.name },
      entries: from.entries.map(({ path, title, kind, under }) => ({ path, title, kind, under })),
    })),
    brokenLinks: broken.slice(0, BROKEN_LINKS_MAX).map((link) => ({
      from: { path: link.from_path, title: link.from_title },
      // Le chemin est déjà écrit dans le contenu source ; le titre ne part qu'à qui lit la cible.
      to: { path: link.to_path, title: reads(own)(link.to_id) ? link.to_title : null },
    })),
    brokenTotal: broken.length,
  }
}

const subjectText = (subject: ShareSubject) => `${subject.kind === "org" ? "the whole organisation" : subject.kind === "team" ? `team ${subject.name}` : subject.name} (${subject.level})`

/** Les partages en texte, chaque liste bornée. */
function sharesText(shares: TeamShares): string {
  const under = (count: number) => (count > 0 ? ` (+${formatCount(count)} under it)` : "")
  const opened = shares.opened.map((node) => `- ${node.path} — ${node.title}: ${node.subjects.map(subjectText).join(", ")}`)
  const received = shares.received.flatMap((from) => [`Team ${from.team.name}:`, ...from.entries.map((entry) => `- ${entry.path}${under(entry.under)} — ${entry.title}`)])
  const broken = shares.brokenLinks.map((link) => `- ${link.from.path} links to ${link.to.path}`)
  const more = shares.brokenTotal - shares.brokenLinks.length
  return [
    `Shares of team ${shares.team.name} (generated from access rights).`,
    opened.length > 0 ? `Shared outside the team (${formatCount(opened.length)}):` : "Nothing is shared outside the team.",
    ...(opened.length > 0 ? [boundedList(opened, "\n")] : []),
    received.length > 0 ? "Shared with the team by other teams:" : "No other team shares anything with it.",
    ...(received.length > 0 ? [boundedList(received, "\n")] : []),
    ...(broken.length > 0 ? [`Links its members cannot open (${formatCount(shares.brokenTotal)}):`, ...broken, ...(more > 0 ? [`… and ${formatCount(more)} more`] : [])] : []),
  ].join("\n")
}

/** L'équipe de l'appel : celle qu'il nomme, sinon la seule de la personne ; plusieurs, la liste à montrer. */
function teamOfCall(identity: Identity, args: TeamSharesArgs): string {
  if (args.team !== undefined) return args.team
  if (identity.teams.length === 1) return identity.teams[0].slug
  if (identity.teams.length === 0) throw new PlatformError("invalid_arguments", 'You belong to no team: give the slug of a team in "team".')
  const slugs = boundedList(identity.teams.map((team) => `${team.slug} (${team.name})`))
  throw new PlatformError("invalid_arguments", `You belong to several teams: ${slugs}. Show this list to the user and ask which team, then call again with "team".`)
}

async function run(context: FunctionContext, args: TeamSharesArgs): Promise<FunctionOutput> {
  const shares = await teamShares(context.db, context.identity, teamOfCall(context.identity, args))
  return {
    text: sharesText(shares),
    data: { team: shares.team.slug, opened: shares.opened.length, received: shares.received.reduce((sum, from) => sum + from.entries.length, 0), broken_links: shares.brokenTotal },
    next: ["node.access"],
  }
}

export const teamSharesFunction = defineFunction({
  name: "team.shares",
  connector: "team",
  class: "read",
  origin: "paquet",
  description:
    "Lists what a team shares, computed from the access rights: its contents shared outside the team (with which team, person or the whole organisation, at which level), what other teams share with it, and the links of its contents that its own members cannot open. Use it when the user asks what their team shares, with whom, or what was shared with it. Reserved to the members of the team and to the administrators. In French: partages de l'équipe, ce qu'on partage, ce qu'on nous a partagé.",
  schema: teamSharesArgsSchema,
  examples: [{}, { team: "ventes" }],
  refusals: [
    "A team you are not a member of, unless you are an administrator (forbidden).",
    "An unknown team, for an administrator (not_found).",
    "No team given while you belong to several: the refusal lists them; show the list to the user and ask.",
  ],
  next: ["node.access"],
  run,
})
