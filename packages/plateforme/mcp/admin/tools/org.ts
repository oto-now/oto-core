// Opérations d'`admin_org` (E08-S02, AC14 à AC19) : chaque opération appelle un service de
// `server/admin/` et met son résultat en texte ; aucun droit ne se décide ici (H123).
import * as z from "zod/v4"
import { addAdminSchema, hostOpSchema, orgCreateSchema, orgSlugSchema, orgUpdateSchema, platformAccessSchema, type PlatformAccessView } from "../../../schemas"
import { staffDirectory } from "../../../server/admin/context"
import { grantAccess, revokeAccess } from "../../../server/admin/grants"
import { addHost, removeHost } from "../../../server/admin/hosts"
import type { AddressSetup, CreationAddresses } from "../../../server/admin/org-creation"
import { createOrg, getOrg, listOrgOverviews, updateOrg, type OrgChange, type OrgSheet } from "../../../server/admin/orgs"
import { boundedList } from "../../../server/errors"
import { TOOL_KEYS } from "../../tools"
import { day, MAX_LIST_LINES, nothingWas, plural, renderHelp, targetOf, type AdminOutput, type OpCall, type OpTable } from "../ops"
import { NO_ORGANISATION } from "./context"
import { adminAdded, firstAdminData, firstAdminLine, firstAdminSummary } from "./first-admin"

const LIST_NEXT = ["admin_org get", "admin_team list"]
const GET_NEXT = ["admin_org update", "admin_team list"]
const AFTER_WRITE = ["admin_org get"]

/** Les six outils d'une organisation, nommés par son préfixe (ADR-002 § 3). */
function toolNames(prefix: string): string {
  return TOOL_KEYS.map((key) => `${prefix}_${key}`).join(", ")
}

async function list(call: OpCall): Promise<AdminOutput> {
  const { db, caller } = call.deps
  const [{ orgs, overviews }, staff] = await Promise.all([listOrgOverviews(db, caller, MAX_LIST_LINES), staffDirectory(db)])
  if (orgs.length === 0) return { text: NO_ORGANISATION, data: { orgs: [] }, nextActions: [] }
  const shown = orgs.slice(0, MAX_LIST_LINES)
  const emails = new Map(staff.map((entry) => [entry.userId, entry.email]))
  const rows = shown.map((org) => {
    const overview = overviews.get(org.id) ?? { hosts: [], members: 0, teams: 0, accesses: [] }
    const accesses = overview.accesses.map((access) => ({ email: emails.get(access.userId) ?? null, since: access.grantedAt }))
    return {
      slug: org.slug,
      name: org.name,
      prefix: org.prefix,
      hosts: overview.hosts,
      members: overview.members,
      teams: overview.teams,
      created_at: org.createdAt,
      platform_accesses: accesses,
    }
  })
  const line = (row: (typeof rows)[number]) => {
    const hosts = row.hosts.length > 0 ? `addresses ${boundedList(row.hosts)}` : "no address"
    const granted = row.platform_accesses.map((access) => `${access.email ?? "a former platform team member"} since ${day(access.since)}`)
    const platform = granted.length > 0 ? `platform access: ${boundedList(granted)}` : "no platform access"
    const counts = `${plural(row.members, "member", "members")} · ${plural(row.teams, "team", "teams")}`
    return `- ${row.slug} · ${row.name} · prefix ${row.prefix} · ${hosts} · ${counts} · created ${day(row.created_at)} · ${platform}`
  }
  const more = orgs.length > shown.length ? [`… and ${orgs.length - shown.length} more`] : []
  const text = [`Organisations you can act on (${orgs.length}):`, ...rows.map(line), ...more].join("\n")
  return { text, data: { orgs: rows, total: orgs.length }, nextActions: LIST_NEXT }
}

function accessLine(access: PlatformAccessView): string {
  const who = access.email ?? access.name ?? "a former platform team member"
  const by = access.grantedByName ? ` by ${access.grantedByName}` : ""
  if (access.revokedAt === null) return `${who} since ${day(access.grantedAt)} (granted${by})`
  const revokedBy = access.revokedByName ? ` by ${access.revokedByName}` : ""
  return `${who}, granted ${day(access.grantedAt)}${by}, revoked ${day(access.revokedAt)}${revokedBy}`
}

function sheetText(sheet: OrgSheet): string {
  const people = (list: { name: string; email: string }[]) => boundedList(list.map((person) => `${person.name} <${person.email}>`)) || "none"
  const flags = Object.entries(sheet.flags).map(([name, value]) => `${name} ${JSON.stringify(value)}`)
  const current = sheet.accesses.filter((access) => access.revokedAt === null).map(accessLine)
  const revoked = sheet.accesses.filter((access) => access.revokedAt !== null).map(accessLine)
  const brand = sheet.brand
  return [
    `Organisation ${sheet.slug} (${sheet.name}), created ${day(sheet.createdAt)}.`,
    `Tools (prefix ${sheet.prefix}, which never changes): ${toolNames(sheet.prefix)}.`,
    `Addresses: ${boundedList(sheet.hosts) || "none: nobody reaches it until one is added"}.`,
    `Work domains: ${sheet.domains || "none"}.`,
    // E05-S13 (AC-3) : le nom de l'organisation est le seul montré, le nom affiché n'est plus lu.
    `Brand: theme ${brand.theme}, logo ${brand.logo_url ?? "none"}.`,
    `Routing: threshold ${sheet.routing.threshold}, gap ${sheet.routing.gap}.`,
    `Flags: ${boundedList(flags) || "none"}.`,
    `Rules version: ${sheet.rulesVersion}.`,
    `Administrators: ${people(sheet.administrators)}.`,
    `Contact shown to non-members: ${sheet.contact ? `${sheet.contact.name} <${sheet.contact.email}>` : "none"}.`,
    `Platform accesses in progress: ${boundedList(current, "; ") || "none"}.`,
    `Revoked platform accesses (last 5): ${revoked.join("; ") || "none"}.`,
  ].join("\n")
}

async function get(call: OpCall): Promise<AdminOutput> {
  const sheet = await getOrg(call.deps.db, targetOf(call))
  return { text: sheetText(sheet), data: { org: sheet }, nextActions: GET_NEXT }
}

/** La ligne d'adresses du récapitulatif (AC2 d'E09-S02) : celle d'E08-S02, sauf quand l'application en ajoute. */
function summaryAddresses(host: string | null, addresses: CreationAddresses | undefined): string {
  if (!addresses || addresses.added.length === 0) return host ? `Address: ${host}` : 'Address: none yet (add one with admin_org {"op": "add_host"}).'
  const shown = addresses.hosts.map((address) => (addresses.added.includes(address) ? `${address} (added by this application)` : address))
  return `${addresses.hosts.length === 1 ? "Address" : "Addresses"}: ${boundedList(shown)}.`
}

/** Les adresses créées, telles que les nomme le texte d'E08-S02 (AC4 d'E09-S02). */
function createdAddresses(hosts: readonly string[]): string {
  if (hosts.length === 0) return "no address yet"
  return `${hosts.length === 1 ? "address" : "addresses"} ${boundedList(hosts)}`
}

/** Ce que l'application a fait des adresses (AC4, AC5 d'E09-S02) : ses lignes, dans l'ordre, ou celle de son échec. */
function setupLines(slug: string, setup: AddressSetup[] | null | undefined): string[] {
  if (setup === undefined) return []
  if (setup === null) {
    return [`Organisation ${slug} is created, but this application could not finish setting up its addresses. Check them with admin_org {"op": "get"}.`]
  }
  return setup.map((entry) => entry.line)
}

async function create(call: OpCall): Promise<AdminOutput> {
  const result = await createOrg(call.deps.db, call.deps.caller, call.input, { orgCreation: call.deps.orgCreation, origin: call.deps.origin })
  const { slug, name, prefix, host } = result.org
  // Avec le point de l'hôte, toutes les adresses en données ; sans lui, les données d'E08-S02.
  const withHosts = result.addresses ? { hosts: result.addresses.hosts } : {}
  if (!result.created) {
    const text = [
      `About to create organisation ${name} (slug ${slug}).`,
      `Its assistant tools will be named ${toolNames(prefix)}, for good: the prefix never changes and no operation deletes an organisation.`,
      summaryAddresses(host, result.addresses),
      firstAdminSummary(result.firstAdmin),
      // E05-S13 (AC-7, HN-E05S13-5) : l'écran client ne montre plus les accès ; le journal, lu par ses administrateurs, les trace.
      "You get a platform access to it. Your calls are recorded in its journal, which its administrators read.",
      nothingWas("created"),
    ].join("\n")
    return { text, data: { summary: { ...result.org, ...withHosts, first_admin: firstAdminData(result.firstAdmin) } }, nextActions: [] }
  }
  const address = createdAddresses(result.addresses?.hosts ?? (host ? [host] : []))
  const text = [
    `Organisation ${slug} (${name}) created: root page guide, context page contexte, personal spaces (private), your platform access, ${address}.`,
    firstAdminLine(slug, result.firstAdmin),
    'Next: set its work domains with admin_org {"op": "update"} and create its teams with admin_team {"op": "create"}.',
    ...setupLines(slug, result.setup),
  ].join("\n")
  const setup = result.setup ? { address_setup: result.setup.map((entry) => ({ host: entry.host, status: entry.status })) } : {}
  const data = { org: { ...result.org, ...withHosts }, first_admin: firstAdminData(result.firstAdmin), ...setup }
  return { text, data, orgId: result.org.id, nextActions: ["admin_org update", "admin_team create", "admin_org get"] }
}

function shown(value: OrgChange["before"]): string {
  return value === null || value === "" ? "(none)" : String(value)
}

async function update(call: OpCall): Promise<AdminOutput> {
  const identity = targetOf(call)
  const { changes } = await updateOrg(call.deps.db, identity, call.input)
  const described = changes.map((change) => `${change.field} ${shown(change.before)} → ${shown(change.after)}`).join("; ")
  const refresh = changes.some((change) => (change.field === "name" || change.field === "domains") && change.before !== change.after)
  const note = refresh
    ? "\nThe tool descriptions changed: users see them after refreshing the connector (claude.ai « Actualiser la liste d'outils », ChatGPT « Actualiser »)."
    : ""
  return { text: `${identity.org.slug} updated: ${described}.${note}`, data: { changes }, nextActions: AFTER_WRITE }
}

async function hostAdded(call: OpCall): Promise<AdminOutput> {
  const identity = targetOf(call)
  const { host } = await addHost(call.deps.db, identity, call.input)
  const text = `Address ${host} now opens ${identity.org.slug}. Its DNS record and its domain on the hosting side are set outside the platform.`
  return { text, data: { host }, nextActions: AFTER_WRITE }
}

async function hostRemoved(call: OpCall): Promise<AdminOutput> {
  const identity = targetOf(call)
  const org = identity.org.slug
  const { host, remaining, removed } = await removeHost(call.deps.db, identity, call.input)
  if (removed) return { text: `Address ${host} removed from ${org}.`, data: { host, remaining }, nextActions: AFTER_WRITE }
  const left = remaining.length > 0 ? `${boundedList(remaining)}.` : `none: nobody will reach ${org} until an address is added.`
  const text = [
    `About to remove address ${host} from ${org}: assistants connected through https://${host}/api/mcp fail at their next call (unknown address), and the web app at this address shows « adresse inconnue ». Remaining addresses: ${left}`,
    nothingWas("removed"),
  ].join("\n")
  return { text, data: { summary: { host, remaining } }, nextActions: [] }
}

async function granted(call: OpCall): Promise<AdminOutput> {
  const identity = targetOf(call)
  const org = identity.org.slug
  const access = await grantAccess(call.deps.db, identity, call.input)
  const text = `${access.email} now has a platform access to ${org} (granted by you on ${day(access.grantedAt)}). They act as an administrator of ${org}, personal spaces excepted. Their calls are recorded in its journal, which its administrators read.`
  return { text, data: { access }, nextActions: AFTER_WRITE }
}

async function revoked(call: OpCall): Promise<AdminOutput> {
  const identity = targetOf(call)
  const org = identity.org.slug
  const result = await revokeAccess(call.deps.db, identity, call.input)
  if (result.revoked) return { text: `Platform access of ${result.email} to ${org} revoked.`, data: { access: result }, nextActions: AFTER_WRITE }
  const by = result.grantedBy ? ` by ${result.grantedBy}` : ""
  const text = [
    `About to revoke the platform access of ${result.email} to ${org} (granted on ${day(result.grantedAt)}${by}): they stop acting on ${org} at their next call; the dated line stays.`,
    ...(result.own ? [`This is your own access: you will no longer act on ${org}.`] : []),
    nothingWas("revoked"),
  ].join("\n")
  return { text, data: { summary: result }, nextActions: [] }
}

const orgOnly = z.object({ org: orgSlugSchema })
const staffAdmin = "forbidden: op <op> of admin_org is reserved to platform team members who administer <org>."

/** L'aide de `create` quand l'hôte branche un point de création (E09-S02, AC7) ; sans lui, celle d'E08-S02. */
const APPLICATION_ADDRESSES =
  "The application may add its own addresses, for example a sub-domain of this cell: the summary lists them before anything is created."

function helpOf(call: OpCall): string {
  if (!call.deps.orgCreation) return renderHelp("admin_org", ORG_OPS)
  const create = { ...ORG_OPS.create, summary: `${ORG_OPS.create.summary} ${APPLICATION_ADDRESSES}` }
  return renderHelp("admin_org", { ...ORG_OPS, create })
}

export const ORG_OPS: OpTable = {
  help: {
    schema: z.object({}),
    org: "none",
    twoStep: false,
    summary: "Gives the fields of each operation of admin_org.",
    example: {},
    refusals: [],
    run: async (call) => ({ text: helpOf(call), nextActions: [] }),
  },
  list: {
    schema: z.object({}),
    org: "none",
    twoStep: false,
    summary: "Lists the organisations you can act on: addresses, members, teams, creation date, platform accesses in progress.",
    example: {},
    refusals: [],
    run: list,
  },
  get: {
    schema: orgOnly,
    org: "target",
    twoStep: false,
    summary: "Reads an organisation: tools, addresses, work domains, brand, routing thresholds, flags, administrators, contact, platform accesses.",
    example: { org: "acme" },
    refusals: [],
    run: get,
  },
  create: {
    schema: orgCreateSchema,
    org: "new",
    twoStep: true,
    summary:
      "Creates an organisation with its root page, context page, personal spaces, your platform access, its first address and its first administrator (admin_email): your own email makes you a member with the admin role at creation, without email; another email is invited with the admin role, by the invitation email of the web app (Équipes).",
    example: { org: "acme2", name: "Acme Deux", prefix: "acmedeux", host: "acme2.localhost", admin_email: "alice@example.com" },
    refusals: [
      "invalid_arguments: Inviting <admin_email> needs an address of <org> to sign in at: pass host, or name yourself with admin_email.",
      "conflict: Address <host> already opens another organisation.",
      "conflict: Slug <org> is already taken. Pick another slug.",
      "conflict: Prefix <prefix> is already used by another organisation.",
    ],
    run: create,
  },
  update: {
    schema: orgUpdateSchema,
    org: "target",
    twoStep: false,
    summary: "Changes the name, work domains, brand (theme, logo_url) or routing thresholds; pass at least one; an empty string removes domains or logo_url. The name is the one shown everywhere: display_name is no longer shown.",
    example: { org: "acme", domains: "sales, support, energy projects", routing_threshold: 0.7 },
    refusals: [
      "forbidden: Changing the settings of <org> is reserved to its administrators.",
      'conflict: <org> changed meanwhile: read it again with admin_org {"op": "get"} and retry.',
    ],
    run: update,
  },
  add_host: {
    schema: hostOpSchema.pick({ org: true, host: true }),
    org: "target",
    twoStep: false,
    summary: "Adds an address (host) that opens the organisation, for its web app and its assistants.",
    example: { org: "acme", host: "app.acme.com" },
    refusals: ["conflict: Address <host> already opens another organisation.", "conflict: <host> is already an address of <org>.", staffAdmin],
    run: hostAdded,
  },
  remove_host: {
    schema: hostOpSchema,
    org: "target",
    twoStep: true,
    summary: "Removes an address of the organisation: assistants and the web app at this address stop reaching it.",
    example: { org: "acme", host: "old.acme.com" },
    refusals: ["not_found: <host> is not an address of <org>.", staffAdmin],
    run: hostRemoved,
  },
  grant_access: {
    schema: platformAccessSchema.pick({ org: true, email: true, reason: true }),
    org: "target",
    twoStep: false,
    summary: "Grants a platform team colleague a dated platform access: they act as an administrator of the organisation, personal spaces excepted.",
    example: { org: "acme", email: "colleague@oto.example", reason: "Pilot support" },
    refusals: [
      "not_found: No member of the platform team has the email <email>.",
      "conflict: <email> already has a platform access to <org>.",
      staffAdmin,
    ],
    run: granted,
  },
  revoke_access: {
    schema: platformAccessSchema,
    org: "target",
    twoStep: true,
    summary: "Revokes a platform access in progress, your own included; the dated line stays.",
    example: { org: "acme", email: "colleague@oto.example" },
    refusals: ["not_found: <email> has no platform access to <org> in progress."],
    run: revoked,
  },
  add_admin: {
    schema: addAdminSchema,
    org: "target",
    twoStep: false,
    summary:
      "Names an administrator of the organisation, by the rule of create: your own email makes you a member with the admin role at once, without email; a member becomes an administrator; another email is invited with the admin role, by the invitation email of the web app (Équipes).",
    example: { org: "acme", admin_email: "alice@example.com" },
    refusals: [
      'invalid_arguments: Inviting <admin_email> needs an address of <org> to sign in at: add one with admin_org {"op": "add_host"} first.',
      "conflict: An invitation is already pending for <admin_email>. Revoke it to send another.",
      staffAdmin,
    ],
    run: adminAdded,
  },
}
