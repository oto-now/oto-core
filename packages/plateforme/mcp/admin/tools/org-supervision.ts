// La supervision de la plateforme (administration et cellule, N9) : les opérations `overview` et `members`
// d'`admin_org`, ajoutées en dernier à `ORG_OPS`. L'équipe plateforme y lit toutes les organisations, accès daté ou
// non : identité, chiffres, membres et rôles, comptes par connecteur et titulaire ; jamais une clé, un libellé de
// compte ni un contenu. `members` nomme son organisation sans la résoudre par l'accès daté (`org: "named"`) :
// `readPlatformOrg` décide. Aucun droit ne se décide ici (H123).
import * as z from "zod/v4"
import { orgSlugSchema, SUPERVISION_DAYS, type SupervisedAccounts, type SupervisedOrg } from "../../../schemas"
import { listPlatformOrgs, readPlatformOrg } from "../../../server/admin/supervision"
import { day, listLines, MAX_LIST_LINES, plural, type AdminOutput, type OpCall, type OpTable } from "../ops"

/** Les chiffres d'une organisation, sur une ligne (supervision, N9) : ni clé, ni libellé de compte, ni contenu. */
function figuresOf(org: SupervisedOrg): string {
  return [
    plural(org.members, "member", "members"),
    plural(org.teams, "team", "teams"),
    `${plural(org.calls, "call", "calls")} in ${SUPERVISION_DAYS} days`,
    plural(org.activeConnectors, "active connector", "active connectors"),
    plural(org.accounts, "account", "accounts"),
  ].join(" · ")
}

/** Les chiffres d'une organisation en données, sans ses membres ni ses comptes (`overview`). */
function figuresData(org: SupervisedOrg) {
  return {
    slug: org.slug,
    name: org.name,
    prefix: org.prefix,
    created_at: org.createdAt,
    members: org.members,
    teams: org.teams,
    calls: org.calls,
    active_connectors: org.activeConnectors,
    accounts: org.accounts,
  }
}

async function overview(call: OpCall): Promise<AdminOutput> {
  const orgs = await listPlatformOrgs(call.deps.db, call.deps.caller)
  if (orgs.length === 0) return { text: "No organisation on this platform yet.", data: { orgs: [], total: 0, days: SUPERVISION_DAYS }, nextActions: [] }
  const lines = listLines(orgs, (org) => `- ${org.slug} · ${org.name} · prefix ${org.prefix} · ${figuresOf(org)} · created ${day(org.createdAt)}`)
  const text = [`All organisations of this platform (${orgs.length}), calls over the last ${SUPERVISION_DAYS} days:`, ...lines].join("\n")
  const rows = orgs.slice(0, MAX_LIST_LINES).map(figuresData)
  return { text, data: { orgs: rows, total: orgs.length, days: SUPERVISION_DAYS }, nextActions: ["admin_org members"] }
}

/** Le titulaire d'un groupe de comptes : l'organisation, l'équipe par son nom, la personne par son email. */
function ownerOf(group: SupervisedAccounts): string {
  if (group.ownerKind === "org") return "the organisation"
  const label = group.ownerLabel ?? (group.ownerKind === "team" ? "a team" : "a former member")
  return group.ownerKind === "team" ? `team ${label}` : label
}

async function members(call: OpCall): Promise<AdminOutput> {
  const org = await readPlatformOrg(call.deps.db, call.deps.caller, String(call.input.org))
  const people = listLines(org.people, (person) => `- ${person.email ?? person.name ?? "a member without email"} · ${person.role} · since ${day(person.since)}`)
  const accounts = listLines(
    org.accountGroups,
    (group) => `- ${group.connector} · ${ownerOf(group)} · ${group.status} · ${group.mode} · ${plural(group.accounts, "account", "accounts")}`,
  )
  const text = [
    `Organisation ${org.slug} (${org.name}): ${figuresOf(org)}.`,
    `Members (${org.people.length}):`,
    ...(people.length > 0 ? people : ["- none"]),
    `Accounts by connector and owner (${org.accounts}):`,
    ...(accounts.length > 0 ? accounts : ["- none"]),
    'Its content, journal and settings need a platform access: admin_org {"op": "get"} tells whether you have one.',
  ].join("\n")
  const data = {
    org: figuresData(org),
    days: SUPERVISION_DAYS,
    members: org.people.slice(0, MAX_LIST_LINES).map((person) => ({ email: person.email, name: person.name, role: person.role, since: person.since })),
    accounts: org.accountGroups.slice(0, MAX_LIST_LINES).map((group) => ({
      connector: group.connector,
      owner_kind: group.ownerKind,
      owner: group.ownerLabel,
      status: group.status,
      mode: group.mode,
      accounts: group.accounts,
    })),
  }
  return { text, data, nextActions: ["admin_org overview", "admin_org get"] }
}

export const SUPERVISION_OPS = {
  overview: {
    schema: z.object({}),
    org: "none",
    twoStep: false,
    summary: `Lists every organisation of this platform, platform access or not: members, teams, calls over the last ${SUPERVISION_DAYS} days, active connectors, accounts. Never a key nor any content.`,
    example: {},
    refusals: [],
    run: overview,
  },
  members: {
    schema: z.object({ org: orgSlugSchema }),
    // Nommée, jamais résolue par l'accès daté (N9) : `readPlatformOrg` décide, pour l'équipe plateforme entière.
    org: "named",
    twoStep: false,
    summary:
      "Reads any organisation of this platform, platform access or not: its members and their role, and its accounts by connector and owner (organisation, team or person), with their state and mode. Never a key, an account label nor any content.",
    example: { org: "acme" },
    refusals: ['not_found: Unknown organisation <org>. List them all with admin_org {"op": "overview"}.'],
    run: members,
  },
} satisfies OpTable
