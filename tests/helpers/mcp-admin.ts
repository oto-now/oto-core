// Sessions du MCP admin des tests (E08-S02) : un client relié par InMemoryTransport à `installAdmin`,
// sur la base simulée d'E01-S07 (tests unitaires) ou sous un jeton réel ouvert par `fx.sessionFor`
// (`openAdminRequest`, comme la route). Sur le modèle de `tests/helpers/mcp.ts` ; réutilisé par
// E08-S06 et E09-S02.
//
// La base simulée ne pose aucun défaut de colonne : `simulatedAdmin` ajoute aux insertions les
// colonnes que la base fabrique (`id`, `ts`, `granted_at`), sans toucher au double commun.
import { randomUUID } from "crypto"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { buildAdminServerOptions, installAdmin, type AdminMcpDeps } from "../../packages/plateforme/mcp/admin/server"
import { flushAdminJournal, type AdminJournalEntry } from "../../packages/plateforme/server/admin/context"
import { referenceRpc } from "./reference-org"
import { liveTables, simulatedDb, type Row, type RpcHandler, type SimulatedCall, type SimulatedDbOptions, type Tables } from "./simulated-db"

type TextBlock = { type: string; text?: string }

function firstText(content: unknown): string {
  const blocks: TextBlock[] = Array.isArray(content) ? content : []
  return blocks[0]?.text ?? ""
}

/** Client MCP relié au MCP admin installé sur `deps`. */
export async function connectAdminMcp(deps: AdminMcpDeps) {
  const { serverInfo, ...options } = buildAdminServerOptions()
  const server = new McpServer(serverInfo, options)
  installAdmin(server, deps)
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: "vitest", version: "0.0.0" })
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])

  /** Appel d'un outil admin : texte, `isError` et `structuredContent`. */
  async function call(tool: string, args: Record<string, unknown> = {}) {
    const result = await client.callTool({ name: tool, arguments: args })
    // Le SDK type `structuredContent` en objet quelconque ; un refus n'en porte pas (texte seul, H26).
    const structured = (result.structuredContent ?? null) as Record<string, unknown> | null
    return { result, text: firstText(result.content), isError: result.isError === true, structured }
  }

  /** `admin_context`, et le code lu sur la première ligne. */
  async function openAdmin(args: Record<string, unknown> = {}) {
    const opened = await call("admin_context", args)
    const code = /^ctx: (\S+)/.exec(opened.text)?.[1]
    if (!code) throw new Error(`no admin ctx in: ${opened.text.slice(0, 200)}`)
    return { ...opened, code }
  }

  return {
    client,
    deps,
    call,
    openAdmin,
    /** Écrit les lignes empilées, comme la tâche `defer` de la route. */
    flush: () => flushAdminJournal(deps.db, deps.caller, deps.journal),
  }
}

export type AdminSession = Awaited<ReturnType<typeof connectAdminMcp>>

/** L'origine du MCP admin des tests (`calledOrigin` de la route) : le lien d'une invitation en reprend protocole et port. */
export const ADMIN_ORIGIN = "http://cell.test:3000"

// Les personnes, organisations et équipes de la base simulée des tests admin, en UUID : les services
// d'E05-S03 lisent leurs identifiants par `parseId`.
const id = (block: string, n: number) => `${block}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`

export const PERSONS = {
  /** Équipe plateforme : accès en cours à acme, accès révoqué à delta, administratrice membre de demo (AC12). */
  sam: { id: id("a", 1), email: "sam.staff@oto.test", name: "Sam Staff", staffSince: "2026-09-01T08:00:00.000Z" },
  /** Équipe plateforme, sans accès ni appartenance (AC13), accès en cours à other. */
  theo: { id: id("a", 2), email: "theo.staff@oto.test", name: "Théo Staff", staffSince: "2026-09-02T08:00:00.000Z" },
  ada: { id: id("a", 3), email: "ada.martin@acme.test", name: "Ada Martin", staffSince: null },
  claire: { id: id("a", 4), email: "claire.morel@acme.test", name: "Claire Morel", staffSince: null },
  marc: { id: id("a", 5), email: "marc.petit@acme.test", name: "Marc Petit", staffSince: null },
  otto: { id: id("a", 6), email: "otto@other.test", name: "Otto Other", staffSince: null },
} as const

export type AdminPerson = keyof typeof PERSONS

export const ORGS = {
  acme: { id: id("b", 1), slug: "acme", name: "Acme Test", prefix: "acme", host: "acme.test" },
  delta: { id: id("b", 2), slug: "delta", name: "Delta Test", prefix: "delta", host: "delta.test" },
  demo: { id: id("b", 3), slug: "demo", name: "Démo", prefix: "demo", host: "demo.test" },
  other: { id: id("b", 4), slug: "other", name: "Other Test", prefix: "other", host: "other.test" },
} as const

/** Équipes d'acme : Ventes (responsable Claire), Support (sans responsable, Marc), Conseil (vide). */
export const TEAMS = {
  ventes: { id: id("c", 1), slug: "ventes", name: "Ventes" },
  support: { id: id("c", 2), slug: "support", name: "Support" },
  conseil: { id: id("c", 3), slug: "conseil", name: "Conseil" },
} as const

const CREATED = "2026-09-10T08:00:00.000Z"

function orgRow(org: (typeof ORGS)[keyof typeof ORGS]): Row {
  const columns = { id: org.id, slug: org.slug, name: org.name, prefix: org.prefix }
  return { ...columns, brand: {}, settings: {}, flags: {}, rules_version: 1, created_at: CREATED, updated_at: CREATED }
}

function member(org: keyof typeof ORGS, person: AdminPerson, role: string): Row {
  return { org_id: ORGS[org].id, user_id: PERSONS[person].id, role, profile: { name: PERSONS[person].name }, created_at: CREATED }
}

function grant(key: string, org: keyof typeof ORGS, person: AdminPerson, revoked: boolean): Row {
  return {
    id: id("d", Number(key)),
    org_id: ORGS[org].id,
    user_id: PERSONS[person].id,
    granted_by: PERSONS.theo.id,
    granted_at: "2026-09-20T08:00:00.000Z",
    revoked_at: revoked ? "2026-09-21T08:00:00.000Z" : null,
    revoked_by: revoked ? PERSONS.ada.id : null,
    reason: null,
  }
}

/** Les tables des tests admin ; `other` y est aussi, que Sam ne voit pas : une ligne d'ailleurs revient dès qu'elle répond aux filtres. */
export function adminTables(): Tables {
  return {
    orgs: Object.values(ORGS).map(orgRow),
    org_domains: Object.values(ORGS).map((org) => ({ host: org.host, org_id: org.id })),
    members: [
      member("acme", "ada", "admin"),
      member("acme", "claire", "member"),
      member("acme", "marc", "member"),
      member("demo", "sam", "admin"),
      member("other", "otto", "admin"),
    ],
    teams: [
      { ...TEAMS.ventes, org_id: ORGS.acme.id },
      { ...TEAMS.support, org_id: ORGS.acme.id },
      { ...TEAMS.conseil, org_id: ORGS.acme.id },
    ],
    team_members: [
      { team_id: TEAMS.ventes.id, user_id: PERSONS.claire.id, role: "lead" },
      { team_id: TEAMS.support.id, user_id: PERSONS.marc.id, role: "member" },
    ],
    // Support possède une page : sa suppression est refusée (H69).
    nodes: [{ id: id("e", 1), org_id: ORGS.acme.id, path: "support/faq", owner_kind: "team", owner_team_id: TEAMS.support.id, owner_user_id: null }],
    accounts: [],
    access_rules: [{ id: id("f", 1), org_id: ORGS.acme.id, node_id: id("e", 1), account_id: null, subject_team_id: TEAMS.conseil.id, subject_user_id: null, level: "read" }],
    platform_staff: [
      { user_id: PERSONS.sam.id, added_by: null, added_at: PERSONS.sam.staffSince },
      { user_id: PERSONS.theo.id, added_by: null, added_at: PERSONS.theo.staffSince },
    ],
    platform_grants: [grant("1", "acme", "sam", false), grant("2", "delta", "sam", true), grant("3", "other", "theo", false)],
    admin_journal: [],
    journal: [],
    invitations: [],
  }
}

function personOf(userId: unknown) {
  return Object.values(PERSONS).find((person) => person.id === userId)
}

/** Les fonctions de la base que lisent les services admin, sur les tables simulées ; `is_staff` : celui de l'appelant. */
export function adminRpc(caller: AdminPerson, isStaff: boolean): Record<string, RpcHandler> {
  const rows = (tables: Tables, table: string) => tables[table] ?? []
  return {
    is_staff: () => isStaff,
    staff_directory: (_args, tables) =>
      rows(tables, "platform_staff").map((staff) => {
        const person = personOf(staff.user_id)
        return { user_id: staff.user_id, email: person?.email ?? null, name: person?.name ?? "?", added_at: staff.added_at }
      }),
    member_directory: (args, tables) =>
      rows(tables, "members")
        .filter((row) => row.org_id === args.p_org)
        .map((row) => {
          const person = personOf(row.user_id)
          return { user_id: row.user_id, email: person?.email ?? null, name: person?.name ?? "?", role: row.role, default_team_id: null, last_sign_in_at: null }
        }),
    org_contact: (args, tables) => {
      const admin = rows(tables, "members").find((row) => row.org_id === args.p_org && row.role === "admin")
      const person = admin ? personOf(admin.user_id) : undefined
      return person ? [{ name: person.name, email: person.email }] : []
    },
    org_by_host: (args, tables) => {
      const domain = rows(tables, "org_domains").find((row) => row.host === args.p_host)
      const org = domain ? rows(tables, "orgs").find((row) => row.id === domain.org_id) : undefined
      return org ? [{ id: org.id, slug: org.slug, name: org.name, prefix: org.prefix, brand: org.brand, domains: null }] : []
    },
    platform_access_directory: (args, tables) =>
      rows(tables, "platform_grants")
        .filter((row) => row.org_id === args.p_org)
        .flatMap((row) => [row.user_id, row.granted_by, row.revoked_by])
        .filter((userId, index, all) => userId && all.indexOf(userId) === index)
        .map((userId) => ({ user_id: userId, email: personOf(userId)?.email ?? null, name: personOf(userId)?.name ?? "?" })),
    // `create_org` d'E01-S04 : organisation, accès du créateur (`creation`), adresses.
    create_org: (args, tables) => {
      const orgId = randomUUID()
      const now = new Date().toISOString()
      const created = { id: orgId, slug: args.p_slug, name: args.p_name, prefix: args.p_prefix, brand: {}, settings: {}, flags: {}, rules_version: 1 }
      rows(tables, "orgs").push({ ...created, created_at: now, updated_at: now })
      const creator = PERSONS[caller].id
      const creation = { id: randomUUID(), org_id: orgId, user_id: creator, granted_by: creator, granted_at: now, revoked_at: null, revoked_by: null }
      rows(tables, "platform_grants").push({ ...creation, reason: "creation" })
      // Les arguments d'une fonction arrivent sans type : `p_hosts` est la liste que `createOrg` envoie.
      for (const host of (args.p_hosts as string[] | undefined) ?? []) rows(tables, "org_domains").push({ host, org_id: orgId })
      return orgId
    },
    // `node_owner` d'E01-S04 (E08-S06) : celui de la base simulée de référence (E01-S07c), par les chemins (H52).
    node_owner: referenceRpc().node_owner,
    // `applied_migrations` d'E01-S04 (E08-S06) : les lignes que le test pose dans la table fictive `schema_migrations`.
    applied_migrations: (_args, tables) => rows(tables, "schema_migrations"),
  }
}

// ------------------------------------------------------------------ Arbre d'acme (E08-S06)

const NODE_AT = "2026-09-20T08:00:00.000Z"

/** Les nœuds d'acme des tests d'E08-S06, par chemin ; `support/faq` garde l'identifiant d'E08-S02. */
export const NODES = {
  guide: id("e", 10),
  ventes: id("e", 11),
  "ventes/contexte": id("e", 12),
  "ventes/tarifs": id("e", 13),
  "ventes/tarifs/grille": id("e", 14),
  "ventes/tarifs/remises": id("e", 15),
  "ventes/relance": id("e", 16),
  conseil: id("e", 17),
  support: id("e", 18),
  "support/faq": id("e", 1),
  private: id("e", 19),
  "private/claire": id("e", 20),
  "private/claire/notes": id("e", 21),
} as const

export type NodePath = keyof typeof NODES

type Owned = { kind: "org" } | { kind: "team"; team: keyof typeof TEAMS } | { kind: "user"; person: AdminPerson } | null

function nodeRow(path: NodePath, owner: Owned, extra: Row = {}): Row {
  const slash = path.lastIndexOf("/")
  // Le parent d'un chemin de `NODES` en est un aussi : l'arbre ci-dessous n'a pas de trou.
  const parent = path === "guide" ? null : slash === -1 ? NODES.guide : NODES[path.slice(0, slash) as NodePath]
  return {
    id: NODES[path],
    org_id: ORGS.acme.id,
    parent_id: parent,
    path,
    kind: "page",
    title: path,
    summary: `The ${path} page.`,
    status: "published",
    revision: 3,
    meta: {},
    owner_kind: owner?.kind ?? null,
    owner_team_id: owner?.kind === "team" ? TEAMS[owner.team].id : null,
    owner_user_id: owner?.kind === "user" ? PERSONS[owner.person].id : null,
    created_by: PERSONS.ada.id,
    updated_by: PERSONS.ada.id,
    created_at: NODE_AT,
    updated_at: NODE_AT,
    ...extra,
  }
}

/**
 * L'arbre d'acme (E08-S06) : la racine à l'organisation, les dossiers de Ventes, Conseil et Support à
 * leur équipe, `ventes/tarifs` et `ventes/tarifs/grille` qui héritent de Ventes, `ventes/tarifs/remises`
 * à Conseil, la procédure `ventes/relance`, l'espace personnel de Claire ; les tables de contenu vides.
 */
export function adminTree(tables: Tables): void {
  tables.nodes = [
    nodeRow("guide", { kind: "org" }),
    nodeRow("ventes", { kind: "team", team: "ventes" }),
    nodeRow("ventes/contexte", null, { kind: "context" }),
    nodeRow("ventes/tarifs", null),
    nodeRow("ventes/tarifs/grille", null),
    nodeRow("ventes/tarifs/remises", { kind: "team", team: "conseil" }),
    nodeRow("ventes/relance", null, { kind: "procedure" }),
    nodeRow("conseil", { kind: "team", team: "conseil" }),
    nodeRow("support", { kind: "team", team: "support" }),
    nodeRow("support/faq", { kind: "team", team: "support" }),
    nodeRow("private", null),
    nodeRow("private/claire", { kind: "user", person: "claire" }),
    nodeRow("private/claire/notes", null),
  ]
  for (const table of ["node_drafts", "blocks", "node_aliases", "node_versions", "links", "connector_activations", "feedback"]) tables[table] = []
}

export type SimulatedAdmin = ReturnType<typeof simulatedAdmin>

/**
 * Le MCP admin de `caller` sur la base simulée des tests admin ; `change` retouche ses tables,
 * `fail` fait échouer une requête, `isStaff: false` le met hors de l'équipe plateforme.
 */
export function simulatedAdmin(
  caller: AdminPerson = "sam",
  options: Pick<SimulatedDbOptions, "fail" | "meanwhile"> & { isStaff?: boolean; change?: (tables: Tables) => void } = {},
) {
  const tables = adminTables()
  options.change?.(tables)
  const simulated = simulatedDb({ tables, rpc: adminRpc(caller, options.isStaff ?? true), fail: options.fail, meanwhile: options.meanwhile })
  const deps: AdminMcpDeps = {
    // Aucun service ne lit plus la face PostgREST de la base simulée (E01-S10 f2) : elle ne sert que les
    // tests qui ne touchent pas la base (liste des outils, contrat).
    db: simulated.db,
    caller: { userId: PERSONS[caller].id, email: PERSONS[caller].email },
    origin: ADMIN_ORIGIN,
    userAgent: "vitest",
    journal: [],
  }
  return { deps, calls: simulated.calls, tables: liveTables(simulated) }
}

/** Le code H04 de chaque refus empilé au journal admin, `null` pour un appel servi (E08-S06). */
export function codes(journal: readonly AdminJournalEntry[]): (string | null)[] {
  return journal.map((line) => line.error?.split(":")[0] ?? null)
}

/** Les écritures envoyées, l'ancrage de la session admin mis à part : l'espion d'un refus sans écriture (E08-S06). */
export function writes(calls: readonly SimulatedCall[]): SimulatedCall[] {
  return calls.filter((call) => call.kind === "table" && call.op !== "select" && call.table !== "admin_journal")
}
