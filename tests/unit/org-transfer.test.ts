// @vitest-environment node
// Export-import d'une organisation (E09-S04) : ce que le parcours réel
// (`tests/integration/org-transfer.test.ts`) n'exerce pas — arguments, contrôle du fichier, plan
// d'import d'une personne absente, d'un ancien membre, des tickets, des invitations, des liens et des
// accès plateforme, lots, résumé, codes d'erreur ; comptes de la cible et issue d'une transaction
// d'import sur une base simulée —, testé sans base sur un fichier synthétique (Acme Test, noms
// fictifs, adresses en `.test`), une règle par test (`testing-strategy.md § Budget de tests`) ; trois
// refus des scripts lancés sans base.
import { execFile } from "child_process"
import { randomUUID } from "crypto"
import fs from "fs"
import os from "os"
import path from "path"
import { promisify } from "util"
import postgres from "postgres"
import { afterAll, describe, expect, it } from "vitest"
import { CTX_ALPHABET as PACKAGE_CTX_ALPHABET } from "../../packages/plateforme/server/ctx"
import type { Json } from "../../packages/plateforme/server/database"
import { codeOf } from "../../scripts/lib/env.mjs"
import { INVALID_PREFIX, parseExportArgs, parseImportArgs, transferEnv } from "../../scripts/lib/org-transfer-args.mjs"
import { fingerprint, planImport } from "../../scripts/lib/org-transfer-plan.mjs"
import {
  batches,
  collectPeople,
  CTX_ALPHABET,
  deepReplace,
  formatSummary,
  newCtxCode,
  orderNodes,
  TABLES,
  validateDoc,
} from "../../scripts/lib/org-transfer.mjs"
import { targetPeople, writePlan } from "../../scripts/org-import.mjs"

type Row = Record<string, Json>
type ExportDoc = {
  format: string
  version: number
  exported_at: string
  source: { host: string; org: Row }
  people: { id: string; email: string | null }[]
  tables: Record<string, Row[]>
}

const AT = "2026-09-20T10:00:00.000000+00:00"
const LATER = "2026-09-21T10:00:00.000000+00:00"
const FUTURE = "2099-01-01T00:00:00.000000+00:00"
const PAST = "2020-01-01T00:00:00.000000+00:00"
const NOW = new Date("2026-09-24T12:00:00.000Z")
const CROCKFORD = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/

const NAMES = [
  "org", "ventes", "support", "alice", "bob", "carol", "root", "private", "contexte", "ventesFolder", "ventesContexte",
  "aliceSpace", "aliceContexte", "bobSpace", "bobContexte", "bobNotes", "carolSpace", "carolContexte", "devis", "liens",
  "suivi", "orgAccount", "bobAccount", "intro", "corps", "ajout", "lien", "noteBob", "row1", "row2",
] as const

/** Identifiants du fichier : un uuid neuf par nom, plus deux codes `ctx` et deux `sim_`. */
function exportIds() {
  // `Object.fromEntries` rend un `Record<string, string>` : ses clés sont exactement `NAMES`.
  const ids = Object.fromEntries(NAMES.map((name) => [name, randomUUID()])) as Record<(typeof NAMES)[number], string>
  return { ...ids, ctxAlice: "AB12-CD34", ctxBob: "EF56-GH78", simOrg: "sim_0a1b2c3d", simBob: "sim_4e5f6a7b" }
}

type Ids = ReturnType<typeof exportIds>
type NodeSpec = [key: keyof Ids, parent: keyof Ids | null, path: string, extra?: Row]

function nodeRows(ids: Ids): Row[] {
  // Dans le désordre : le plan les remet parents d'abord.
  const specs: NodeSpec[] = [
    ["bobNotes", "bobSpace", "private/bob/notes", { status: "published", revision: 1, created_by: ids.bob, updated_by: ids.bob }],
    ["devis", "ventesFolder", "ventes/devis", { status: "published", revision: 2, created_by: ids.bob, updated_by: ids.alice }],
    ["root", null, "guide", { owner_kind: "org" }],
    ["ventesContexte", "ventesFolder", "ventes/contexte", { kind: "context" }],
    ["private", "root", "private"],
    ["aliceContexte", "aliceSpace", "private/alice/contexte", { kind: "context" }],
    ["contexte", "root", "contexte", { kind: "context", status: "published", revision: 1 }],
    ["ventesFolder", "root", "ventes", { owner_kind: "team", owner_team_id: ids.ventes }],
    ["aliceSpace", "private", "private/alice", { owner_kind: "user", owner_user_id: ids.alice }],
    ["bobSpace", "private", "private/bob", { owner_kind: "user", owner_user_id: ids.bob }],
    ["bobContexte", "bobSpace", "private/bob/contexte", { kind: "context" }],
    ["carolSpace", "private", "private/carol", { owner_kind: "user", owner_user_id: ids.carol }],
    ["carolContexte", "carolSpace", "private/carol/contexte", { kind: "context" }],
    ["liens", "ventesFolder", "ventes/liens", { status: "published", revision: 1 }],
    ["suivi", "ventesFolder", "ventes/suivi", { kind: "table", status: "published", revision: 1, meta: { key: "ref", columns: [{ name: "ref" }] } }],
  ]
  return specs.map(([key, parent, nodePath, extra]) => ({
    id: ids[key],
    org_id: ids.org,
    parent_id: parent ? ids[parent] : null,
    path: nodePath,
    kind: "page",
    title: nodePath,
    summary: `Nœud ${nodePath}.`,
    status: "draft",
    revision: 0,
    meta: {},
    owner_kind: null,
    owner_team_id: null,
    owner_user_id: null,
    created_by: null,
    updated_by: null,
    created_at: AT,
    updated_at: AT,
    ...extra,
  }))
}

function block(ids: Ids, key: keyof Ids, node: keyof Ids, extra: Row): Row {
  return {
    id: ids[key],
    state: "published",
    org_id: ids.org,
    node_id: ids[node],
    position: 1024,
    type: "paragraph",
    text: "Texte.",
    data: {},
    key: null,
    provenance: {},
    revision: 1,
    claimed_by: null,
    claimed_by_user: null,
    lease_until: null,
    created_by: ids.alice,
    updated_by: ids.alice,
    created_at: AT,
    updated_at: AT,
    ...extra,
  }
}

function blockRows(ids: Ids): Row[] {
  const intro: Row = { type: "heading", text: "Intro", data: { level: 1 }, key: "intro" }
  const corps: Row = { position: 2048, text: "Corps.", provenance: { origin: "human", by: ids.bob, ctx: ids.ctxBob } }
  const row = (key: keyof Ids, ref: string, extra: Row = {}) =>
    block(ids, key, "suivi", { type: "row", text: null, position: null, key: ref, data: { ref }, ...extra })
  return [
    block(ids, "intro", "devis", intro),
    block(ids, "intro", "devis", { ...intro, state: "draft" }),
    block(ids, "corps", "devis", corps),
    block(ids, "corps", "devis", { ...corps, state: "draft", text: "Corps modifié.", updated_by: ids.bob }),
    block(ids, "ajout", "devis", { state: "draft", position: 3072, text: "Ajout du brouillon." }),
    block(ids, "lien", "liens", { text: "Voir [[private/bob/notes]] et [[ventes/devis#intro]]." }),
    block(ids, "noteBob", "bobNotes", { text: "Note de Bob.", created_by: ids.bob, updated_by: ids.bob }),
    block(ids, "noteBob", "bobNotes", { state: "draft", text: "Note de Bob, brouillon.", created_by: ids.bob, updated_by: ids.bob }),
    row("row1", "P-001", {
      provenance: { ref: { origin: "import", by: ids.alice, at: AT } },
      claimed_by: "agent",
      claimed_by_user: ids.bob,
      lease_until: FUTURE,
    }),
    row("row2", "P-002"),
  ]
}

function snapshot(ids: Ids, keys: (keyof Ids)[]): Json {
  return keys.map((key, index) => ({ id: ids[key], type: "paragraph", position: 1024 * (index + 1), key: null, text: "v", data: {}, provenance: {}, revision: 1 }))
}

function version(node: string, revision: number, blocks: Json, extra: Row = {}): Row {
  return { node_id: node, revision, title: "t", summary: "s", kind: "page", meta: {}, blocks, author: null, created_at: AT, ...extra }
}

function contentTables(ids: Ids): Record<string, Row[]> {
  return {
    nodes: nodeRows(ids),
    node_drafts: [
      { node_id: ids.devis, base_revision: 2, title: "Devis (en attente)", summary: null, kind: null, meta: null, created_by: ids.alice, updated_by: ids.bob, created_at: LATER, updated_at: LATER },
      { node_id: ids.bobNotes, base_revision: 1, title: null, summary: null, kind: null, meta: null, created_by: ids.bob, updated_by: ids.bob, created_at: LATER, updated_at: LATER },
    ],
    blocks: blockRows(ids),
    node_versions: [
      version(ids.devis, 1, snapshot(ids, ["intro"])),
      version(ids.devis, 2, snapshot(ids, ["intro", "corps"]), { author: ids.alice }),
      version(ids.bobNotes, 1, snapshot(ids, ["noteBob"]), { author: ids.bob }),
      version(ids.contexte, 1, [], { kind: "context" }),
    ],
    node_aliases: [
      { org_id: ids.org, old_path: "ventes/ancien", node_id: ids.devis, created_by: null, created_at: AT },
      { org_id: ids.org, old_path: "private/bob/vieux", node_id: ids.bobNotes, created_by: ids.bob, created_at: AT },
    ],
    links: [
      { org_id: ids.org, source_node_id: ids.liens, source_block_id: ids.lien, target_path: "private/bob/notes", target_key: null, target_node_id: ids.bobNotes },
      { org_id: ids.org, source_node_id: ids.liens, source_block_id: ids.lien, target_path: "ventes/devis", target_key: "intro", target_node_id: ids.devis },
      { org_id: ids.org, source_node_id: ids.bobNotes, source_block_id: ids.noteBob, target_path: "ventes/devis", target_key: null, target_node_id: ids.devis },
    ],
    ...commentTables(ids),
  }
}

/** Un fil résolu par Bob sur un bloc publié du devis, dont le commentaire d'Alice le mentionne ; un fil d'Alice sur les notes de Bob. */
function commentTables(ids: Ids): Record<string, Row[]> {
  const thread = (id: string, node: string, extra: Row = {}) => ({
    id, org_id: ids.org, node_id: node, block_id: null, quote: null, block_revision: null, status: "open", resolved_by: null, resolved_at: null,
    created_by: ids.alice, created_at: AT, ...extra,
  })
  const comment = (threadId: string, extra: Row = {}) => ({
    id: randomUUID(), org_id: ids.org, thread_id: threadId, author: ids.alice, text: "À relire.", mentions: [], created_at: AT, edited_at: null, ...extra,
  })
  const [onDevis, onNotes] = [randomUUID(), randomUUID()]
  return {
    comment_threads: [
      thread(onDevis, ids.devis, { block_id: ids.corps, quote: "Corps", block_revision: 1, status: "resolved", resolved_by: ids.bob, resolved_at: LATER }),
      thread(onNotes, ids.bobNotes, { created_at: LATER }),
    ],
    comments: [comment(onDevis, { text: "À relire, @bob.", mentions: [ids.bob] }), comment(onNotes, { created_at: LATER })],
  }
}

function organisationTables(ids: Ids): Record<string, Row[]> {
  const team = (id: string, slug: string, lead: string) => ({ id, org_id: ids.org, slug, name: slug, lead_user_id: lead, created_at: AT })
  const member = (user: string, role: string, handle: string) => ({
    org_id: ids.org, user_id: user, role, default_team_id: ids.ventes, profile: { handle }, created_at: AT, email: `${handle}@example.test`,
  })
  const account = (id: string, label: string, extra: Row = {}) => ({
    id, org_id: ids.org, connector: "mail", owner_kind: "org", owner_team_id: null, owner_user_id: null, label,
    status: "active", health: {}, mode: "simule", created_at: AT, updated_at: AT, ...extra,
  })
  return {
    orgs: [{ id: ids.org, slug: "acme", name: "Acme Test", prefix: "acme", brand: {}, settings: { domains: "sales" }, flags: {}, rules_version: 3, created_at: AT, updated_at: AT }],
    org_domains: [{ host: "acme.example.test", org_id: ids.org, created_at: AT }],
    teams: [team(ids.ventes, "ventes", ids.alice), team(ids.support, "support", ids.bob)],
    members: [member(ids.alice, "admin", "alice"), member(ids.bob, "member", "bob")],
    team_members: [
      { team_id: ids.ventes, user_id: ids.alice, role: "lead", created_at: AT },
      { team_id: ids.ventes, user_id: ids.bob, role: "member", created_at: AT },
      { team_id: ids.support, user_id: ids.bob, role: "lead", created_at: AT },
    ],
    accounts: [account(ids.orgAccount, "Mail Ventes"), account(ids.bobAccount, "Mail de Bob", { owner_kind: "user", owner_user_id: ids.bob })],
  }
}

function accessTables(ids: Ids): Record<string, Row[]> {
  const rule = (extra: Row) => ({
    id: randomUUID(), org_id: ids.org, node_id: null, account_id: null, subject_team_id: null, subject_user_id: null, level: "read",
    created_by: ids.alice, created_at: AT, ...extra,
  })
  const invitation = (email: string, extra: Row = {}) => ({
    id: randomUUID(), org_id: ids.org, email, role: "member", team_id: ids.ventes, invited_by: ids.alice,
    created_at: AT, expires_at: FUTURE, accepted_at: null, accepted_by: null, declined_at: null, revoked_at: null, ...extra,
  })
  const grant = (user: string) => ({ id: randomUUID(), org_id: ids.org, user_id: user, granted_by: ids.alice, granted_at: AT, revoked_at: null, revoked_by: null, reason: "support" })
  return {
    access_rules: [
      rule({ node_id: ids.devis, subject_user_id: ids.bob }),
      rule({ node_id: ids.bobNotes, subject_team_id: ids.ventes }),
      rule({ account_id: ids.bobAccount, subject_team_id: ids.ventes }),
      rule({ node_id: ids.devis, subject_team_id: ids.support, level: "write" }),
    ],
    connector_activations: [{ org_id: ids.org, connector: "mail", state: "active", activated_by: ids.alice, created_at: AT, updated_at: AT }],
    invitations: [
      invitation("new@example.test"),
      invitation("accepted@example.test", { accepted_at: LATER, accepted_by: ids.carol }),
      invitation("declined@example.test", { declined_at: LATER }),
      invitation("revoked@example.test", { revoked_at: LATER }),
      invitation("expired@example.test", { expires_at: PAST }),
      invitation("alice@example.test"),
    ],
    platform_grants: [grant(ids.alice), grant(ids.bob)],
  }
}

function journalTables(ids: Ids): Record<string, Row[]> {
  const ctx = (code: string, user: string, at: string) => ({ code, org_id: ids.org, user_id: user, rules_version: 3, host: "claude-ai@1", user_agent: "test", created_at: at })
  const call = (extra: Row) => ({
    ts: AT, org_id: ids.org, user_id: ids.alice, team_id: ids.ventes, ctx: ids.ctxAlice, method: "tools/call", tool: "acme_read",
    target: "ventes/devis", args: { node: ids.devis }, args_chars: 10, result_chars: 20, is_error: false, error: null,
    duration_ms: 5, host: "claude-ai@1", user_agent: "test", account_id: ids.orgAccount, ...extra,
  })
  const ticket = (number: number, user: string) => ({
    org_id: ids.org, number, user_id: user, ctx: ids.ctxAlice, type: "gap", target: "ventes/devis", text: `Ticket ${number}.`,
    state: "open", resolution: null, handled_by: null, handled_at: null, created_at: AT,
  })
  const sim = (id: string, account: string, user: string) => ({
    id, org_id: ids.org, account_id: account, connector: "mail", function: "mail.draft", payload: { node: ids.devis }, status: "draft",
    created_by: user, created_at: AT, sent_by: null, sent_at: null,
  })
  return {
    ctx: [ctx(ids.ctxAlice, ids.alice, AT), ctx(ids.ctxBob, ids.bob, LATER)],
    journal: [call({}), call({ user_id: ids.bob, ctx: ids.ctxBob, account_id: ids.bobAccount })],
    admin_journal: [
      {
        ts: AT, org_id: ids.org, user_id: ids.alice, ctx: "ADMN-0001", method: "tools/call", tool: "admin_org", op: "show", target: "acme",
        args: { org: ids.org }, args_chars: 1, result_chars: 1, is_error: false, error: null, duration_ms: 1, host: null, user_agent: null,
      },
    ],
    feedback: [ticket(2, ids.alice), ticket(1, ids.bob)],
    sim_outbox: [sim(ids.simOrg, ids.orgAccount, ids.alice), sim(ids.simBob, ids.bobAccount, ids.bob)],
  }
}

/** Acme Test ; `formerMember` : Carol, présente dans le projet mais plus membre, a laissé son espace (H70). */
function exportDoc(ids: Ids, options: { formerMember?: boolean } = {}): ExportDoc {
  const tables = { ...organisationTables(ids), ...contentTables(ids), ...accessTables(ids), ...journalTables(ids) }
  if (!options.formerMember) tables.nodes = tables.nodes.filter((node) => node.id !== ids.carolSpace && node.id !== ids.carolContexte)
  return {
    format: "oto-platform-org-export",
    version: 1,
    exported_at: LATER,
    source: { host: "project.example.test", org: { id: ids.org, slug: "acme", prefix: "acme", name: "Acme Test" } },
    people: [
      { id: ids.alice, email: "alice@example.test" },
      { id: ids.bob, email: "bob@example.test" },
      { id: ids.carol, email: "carol@example.test" },
    ],
    tables,
  }
}

const TARGET = { slug: "acme2", prefix: "acmedeux" }

/** Chaque personne présente dans la cible, sous le même identifiant (même projet). */
const samePeople = (doc: ExportDoc) => new Map<string, string | null>(doc.people.map((person) => [person.id, person.id]))

describe("TABLES (carte des tables)", () => {
  it("should list each table after the tables it references: the insertion order", () => {
    const names = TABLES.map((spec) => spec.name)
    const late = TABLES.flatMap((spec) =>
      Object.values(spec.refs)
        .filter((target) => names.indexOf(target) === -1 || names.indexOf(target) > names.indexOf(spec.name))
        .map((target) => `${spec.name} -> ${target}`),
    )
    expect(late).toEqual([])
  })
})

describe("parseExportArgs", () => {
  it("should read the options and refuse a file without the suffix ignored by git (AC5)", () => {
    expect(parseExportArgs(["--with-journal", "--force", "--env", "erp.env", "--org", "acme", "--out", "x/acme.org-export.json"])).toEqual({
      org: "acme", out: "x/acme.org-export.json", env: "erp.env", withJournal: true, force: true,
    })
    expect(() => parseExportArgs(["--org", "acme", "--out", "acme.json"])).toThrow("Le fichier doit se terminer par .org-export.json (ignoré par git).")
  })
})

describe("parseImportArgs", () => {
  const base = ["--in", "acme.org-export.json", "--slug", "acme2", "--prefix", "acmedeux"]

  it("should read the options, each address once and in lower case (AC6, AC10, AC13)", () => {
    const argv = [...base, "--name", " Acme ERP ", "--auteur-par-defaut", "JB@Example.Invalid", "--domain", "Acme.oto.cx", "--domain", "erp.example.test", "--domain", "acme.oto.cx"]
    expect(parseImportArgs(argv)).toEqual({
      in: "acme.org-export.json", slug: "acme2", prefix: "acmedeux", name: "Acme ERP", defaultAuthor: "jb@example.invalid",
      domains: ["acme.oto.cx", "erp.example.test"], env: null,
    })
  })

  it("should refuse a prefix outside ^[a-z][a-z0-9]{1,11}$ and an address with a port (AC11, AC13)", () => {
    const withPrefix = (prefix: string) => ["--in", "a.org-export.json", "--slug", "acme2", "--prefix", prefix]
    for (const prefix of ["2acme", "a", "acmedeuxtrois"]) expect(() => parseImportArgs(withPrefix(prefix))).toThrow(INVALID_PREFIX)
    expect(parseImportArgs(withPrefix("acmedeuxtroi")).prefix).toBe("acmedeuxtroi")
    expect(() => parseImportArgs([...base, "--domain", "acme.oto.cx:3000"])).toThrow("acme.oto.cx:3000")
  })
})

describe("transferEnv", () => {
  it("should let the --env file win over the process, and name the missing variables only (AC5)", () => {
    const processEnv = { NEXT_PUBLIC_SUPABASE_URL: "https://process.example.test", SUPABASE_SECRET_KEY: "process" }
    const file = "NEXT_PUBLIC_SUPABASE_URL=https://erp.example.test\nSUPABASE_SECRET_KEY=from-file"
    expect(transferEnv(processEnv, [file], true).values).toMatchObject({ NEXT_PUBLIC_SUPABASE_URL: "https://erp.example.test", SUPABASE_SECRET_KEY: "from-file" })
    expect(transferEnv(processEnv, [""], true).missing).toEqual(["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY", "PLATFORM_ADMIN_DATABASE_URL"])
  })
})

describe("validateDoc", () => {
  const doc = () => exportDoc(exportIds())

  it("should accept an export, and refuse an unknown format, version or table (AC11)", () => {
    expect(() => validateDoc(doc())).not.toThrow()
    expect(() => validateDoc({ ...doc(), format: "autre-format" })).toThrow("autre-format")
    expect(() => validateDoc({ ...doc(), version: 99 })).toThrow("99")
    for (const name of ["rows", "vocabulary"]) {
      const tampered = doc()
      tampered.tables[name] = []
      expect(() => validateDoc(tampered)).toThrow(`Table inconnue dans le fichier : ${name}.`)
    }
  })

  it("should refuse a column or a reference outside the file, a row without the organization, and anything but one organization with a uuid (HN-E09S04-14)", () => {
    const withColumn = doc()
    withColumn.tables.nodes[0] = { ...withColumn.tables.nodes[0], lpath: "ventes" }
    expect(() => validateDoc(withColumn)).toThrow("nodes.lpath")
    const withReference = doc()
    withReference.tables.access_rules[0] = { ...withReference.tables.access_rules[0], node_id: randomUUID() }
    expect(() => validateDoc(withReference)).toThrow("access_rules.node_id")
    // `journal.org_id` est nullable : la ligne s'écrirait hors de l'organisation créée, et l'annulation la laisserait.
    const outsideOrg = doc()
    outsideOrg.tables.journal[0] = { ...outsideOrg.tables.journal[0], org_id: null }
    expect(() => validateDoc(outsideOrg)).toThrow("journal.org_id")
    // Sans `id`, l'organisation se désignerait par `undefined` : les lignes sans `org_id` passeraient.
    const withoutOrgId = doc()
    delete withoutOrgId.tables.orgs[0].id
    for (const row of Object.values(withoutOrgId.tables).flat()) delete row.org_id
    expect(() => validateDoc(withoutOrgId)).toThrow("tables.orgs.id")
    const withoutOrg = doc()
    withoutOrg.tables.orgs = []
    expect(() => validateDoc(withoutOrg)).toThrow("tables.orgs")
  })
})

describe("orderNodes", () => {
  it("should put every parent before its children, the root first", () => {
    const ids = exportIds()
    const rows = nodeRows(ids)
    const ordered = orderNodes(rows)
    expect(ordered[0].path).toBe("guide")
    const seen = new Set<Json>()
    for (const node of ordered) {
      expect({ path: node.path, parentSeen: node.parent_id === null || seen.has(node.parent_id) }).toEqual({ path: node.path, parentSeen: true })
      seen.add(node.id)
    }
    expect(ordered).toHaveLength(rows.length)
  })
})

describe("deepReplace", () => {
  it("should replace every string equal to an old identifier, at any depth, and nothing else (AC6)", () => {
    const ids = new Map([["old-1", "new-1"], ["old-2", "new-2"]])
    const value = { a: "old-1", list: ["old-2", "keep", { deep: ["old-1"] }], n: 3, t: true, nil: null, "old-1": "key stays" }
    expect(deepReplace(value, ids)).toEqual({ a: "new-1", list: ["new-2", "keep", { deep: ["new-1"] }], n: 3, t: true, nil: null, "old-1": "key stays" })
    expect(deepReplace("old-1 with text", ids)).toBe("old-1 with text")
  })
})

describe("newCtxCode", () => {
  it("should draw ctx codes in the alphabet of server/ctx.ts, copied", () => {
    expect(CTX_ALPHABET).toBe(PACKAGE_CTX_ALPHABET)
    expect(newCtxCode()).toMatch(CROCKFORD)
  })
})

describe("collectPeople", () => {
  it("should cite every person column and provenance.by, snapshots included (AC1)", () => {
    const ids = exportIds()
    const doc = exportDoc(ids, { formerMember: true })
    expect(collectPeople(doc.tables)).toEqual([ids.alice, ids.bob, ids.carol].sort())
    const onlyProvenance = {
      blocks: [{ provenance: { origin: "human", by: ids.bob } }, { provenance: { ref: { by: ids.carol } } }],
      node_versions: [{ blocks: [{ id: ids.intro, provenance: { by: ids.alice } }] }],
    }
    expect(collectPeople(onlyProvenance)).toEqual([ids.alice, ids.bob, ids.carol].sort())
  })
})

describe("planImport, every person present", () => {
  const ids = exportIds()
  const doc = exportDoc(ids, { formerMember: true })
  const plan = planImport(doc, { people: samePeople(doc), org: TARGET, now: NOW })

  it("should name the new organization after --name when given, after the file otherwise (AC6)", () => {
    expect(plan.rows.orgs).toEqual([expect.objectContaining({ slug: "acme2", prefix: "acmedeux", name: "Acme Test" })])
    expect(planImport(doc, { people: samePeople(doc), org: { ...TARGET, name: "Acme ERP" }, now: NOW }).rows.orgs[0].name).toBe("Acme ERP")
  })

  it("should skip the personal space left by a former member, and its descendants (HN-E09S04-15)", () => {
    expect(plan.rows.nodes.map((row) => row.path).filter((nodePath) => String(nodePath).startsWith("private/carol"))).toEqual([])
    expect(plan.skipped.nodes).toBe(2)
    expect(Object.entries(plan.skipped).filter(([name, count]) => name !== "nodes" && count > 0)).toEqual([])
  })

  // E01-S09 (AC15) : sans clé vers `auth.users`, la base ne recopie plus l'email du compte ; un fichier
  // d'avant M08 n'en porte pas dans `members`.
  it("should give each imported member the email of its person when the file carries none", () => {
    const before = exportDoc(ids, { formerMember: true })
    before.tables.members = before.tables.members.map((row) => Object.fromEntries(Object.entries(row).filter(([column]) => column !== "email")))
    const imported = planImport(before, { people: samePeople(before), org: TARGET, now: NOW })
    expect(imported.rows.members.map((row) => [row.user_id, row.email])).toEqual([
      [ids.alice, "alice@example.test"],
      [ids.bob, "bob@example.test"],
    ])
  })

  it("should import tickets in the order of their numbers, the old numbers kept for the summary", () => {
    expect(plan.tickets).toEqual([1, 2])
    expect(plan.rows.feedback.map((row) => row.text)).toEqual(["Ticket 1.", "Ticket 2."])
  })

  it("should leave closed invitations and the one for a member's address (AC13, HN-E09S04-13)", () => {
    expect(plan.rows.invitations.map((row) => row.email)).toEqual(["new@example.test"])
    expect(plan.closedInvitations).toBe(5)
  })

  // La clé unique des liens vaut pour toute la base : un lien parti du bloc d'une autre organisation
  // ferait échouer sa publication (23505).
  it("should skip a link whose source block is not a published block of its node (HN-E09S04-23)", () => {
    const tampered = exportDoc(ids, { formerMember: true })
    const link = (block: string) => ({ org_id: ids.org, source_node_id: ids.liens, source_block_id: block, target_path: "ventes/devis", target_key: "autre", target_node_id: ids.devis })
    tampered.tables.links.push(link(ids.corps), link(randomUUID()))
    const result = planImport(tampered, { people: samePeople(tampered), org: TARGET, now: NOW })
    expect(result.rows.links).toHaveLength(3)
    expect(result.skipped.links).toBe(2)
  })

  it("should revoke the open platform accesses at the import date when the target is another project (HN-E09S04-25)", () => {
    const elsewhere = planImport(doc, { people: samePeople(doc), org: TARGET, now: NOW, otherProject: true })
    expect(elsewhere.rows.platform_grants.map((row) => [row.revoked_at, row.revoked_by])).toEqual([[NOW.toISOString(), null], [NOW.toISOString(), null]])
    expect(elsewhere.revokedGrants).toBe(2)
    expect(plan.rows.platform_grants.map((row) => row.revoked_at)).toEqual([null, null])
  })

  it("should import a public link disabled at the import date, a disabled one as it was (HN-E05S10e-9)", () => {
    const shared = exportDoc(ids, { formerMember: true })
    const share = (revoked: string | null) => ({
      id: randomUUID(), org_id: ids.org, node_id: ids.devis, include_children: false, created_by: ids.alice, created_at: AT, revoked_at: revoked,
    })
    shared.tables.node_shares = [share(null), share(LATER)]
    const result = planImport(shared, { people: samePeople(shared), org: TARGET, now: NOW })
    expect(result.rows.node_shares.map((row) => row.revoked_at)).toEqual([NOW.toISOString(), LATER])
  })
})

describe("planImport, one person absent from the target (AC9, AC10)", () => {
  const ids = exportIds()
  const doc = exportDoc(ids)
  const people = new Map(samePeople(doc))
  people.set(ids.bob, null)
  const plan = planImport(doc, { people, org: TARGET, now: NOW })

  it("should list the absent person, and skip her memberships, accesses, ctx and personal accounts with what depends on them (AC9)", () => {
    expect(plan.absent).toEqual(["bob@example.test"])
    expect(plan.skipped).toEqual({
      orgs: 0, teams: 0, members: 1, team_members: 2, accounts: 1, nodes: 3, node_drafts: 1, blocks: 2, node_versions: 1,
      // Le fil posé sur les notes de Bob part avec leur nœud, et son commentaire avec lui.
      node_aliases: 1, links: 1, comment_threads: 1, comments: 1, access_rules: 3, connector_activations: 0, invitations: 0, platform_grants: 1, ctx: 1,
      journal: 0, admin_journal: 0, feedback: 1, sim_outbox: 1,
    })
    expect(plan.rows.nodes.map((row) => row.path).filter((nodePath) => String(nodePath).startsWith("private/bob"))).toEqual([])
    expect(plan.rows.members.map((row) => row.user_id)).toEqual([ids.alice])
  })

  it("should keep a link into a skipped node by its path, set null columns to null and leave provenance.by (AC9)", () => {
    expect(plan.rows.links.map((row) => [row.target_path, row.target_node_id === null])).toEqual([
      ["private/bob/notes", true],
      ["ventes/devis", false],
    ])
    expect(plan.teamLeads).toEqual([{ id: plan.rows.teams[0].id, lead: ids.alice }])
    expect(plan.rows.blocks.find((row) => row.key === "P-001")).toMatchObject({ claimed_by: "agent", claimed_by_user: null, lease_until: FUTURE })
    const corps = plan.rows.blocks.filter((row) => row.text === "Corps." || row.text === "Corps modifié.")
    expect(corps.map((row) => row.provenance)).toEqual([expect.objectContaining({ by: ids.bob }), expect.objectContaining({ by: ids.bob })])
    expect(plan.rows.journal[1]).toMatchObject({ user_id: null, account_id: null, ctx: expect.stringMatching(CROCKFORD) })
  })

  it("should carry a comment thread under the new identifiers of its node and block, without the absent person who resolved it", () => {
    const corps = plan.rows.blocks.find((row) => row.text === "Corps.")
    expect(plan.rows.comment_threads).toEqual([
      expect.objectContaining({ node_id: plan.rows.nodes.find((row) => row.path === "ventes/devis")?.id, block_id: corps?.id, quote: "Corps", status: "resolved", resolved_by: null, created_by: ids.alice }),
    ])
    expect(plan.rows.comment_threads[0].id).not.toBe(doc.tables.comment_threads[0].id)
    expect(plan.rows.comments).toEqual([expect.objectContaining({ thread_id: plan.rows.comment_threads[0].id, author: ids.alice, text: "À relire, @bob." })])
  })

  it("should count the rows whose author is absent, then give them the default author (AC10)", () => {
    expect(plan.needsDefaultAuthor).toEqual({ rows: 3, emails: ["bob@example.test"] })
    const withDefault = planImport(doc, { people, defaultAuthor: ids.alice, org: TARGET, now: NOW })
    expect(withDefault.rows.nodes.find((row) => row.path === "ventes/devis")).toMatchObject({ created_by: ids.alice, updated_by: ids.alice })
    expect(withDefault.rows.node_drafts[0]).toMatchObject({ created_by: ids.alice, updated_by: ids.alice })
    expect(withDefault.rows.blocks.find((row) => row.text === "Corps modifié.")).toMatchObject({ updated_by: ids.alice })
  })
})

describe("fingerprint (AC8)", () => {
  /** Ce que l'export de l'organisation importée rendrait : lignes du plan, telles que la base les garde. */
  function importedDoc(doc: ExportDoc, plan: ReturnType<typeof planImport>, people: Map<string, string | null>): ExportDoc {
    const leads = new Map(plan.teamLeads.map(({ id, lead }) => [id, lead]))
    const orgs = plan.rows.orgs.map((row) => ({ ...row, rules_version: Number(row.rules_version) + 1, updated_at: LATER }))
    const teams = plan.rows.teams.map((row) => ({ ...row, lead_user_id: leads.get(row.id) ?? null }))
    const feedback = plan.rows.feedback.map((row, index) => ({ ...row, number: index + 1 }))
    return {
      ...doc,
      people: doc.people.map((person) => ({ id: people.get(person.id) ?? person.id, email: person.email })),
      tables: { ...plan.rows, orgs, teams, feedback, org_domains: [] },
    }
  }

  it("should be equal for a copy whose identifiers all differ, people's included, and differ when a content differs", () => {
    const doc = exportDoc(exportIds())
    // Chaque personne sous un autre identifiant, comme dans un autre projet.
    const people = new Map<string, string | null>(doc.people.map((person) => [person.id, randomUUID()]))
    const copy = importedDoc(doc, planImport(doc, { people, org: TARGET, now: NOW }), people)
    expect(fingerprint(copy, NOW)).toEqual(fingerprint(doc, NOW))
    copy.tables.blocks = copy.tables.blocks.map((row) => (row.text === "Corps." ? { ...row, text: "Autre." } : row))
    expect(fingerprint(copy, NOW)).not.toEqual(fingerprint(doc, NOW))
  })
})

describe("batches", () => {
  it("should cut at 500 rows, and earlier past 1 MB of JSON", () => {
    const small = Array.from({ length: 1201 }, (_, index) => ({ index }))
    expect(batches(small).map((batch) => batch.length)).toEqual([500, 500, 201])
    const big = Array.from({ length: 5 }, () => ({ text: "x".repeat(400_000) }))
    expect(batches(big).map((batch) => batch.length)).toEqual([2, 2, 1])
    expect(batches([{ text: "x".repeat(2_000_000) }, { a: 1 }]).map((batch) => batch.length)).toEqual([1, 1])
    expect(batches([])).toEqual([])
  })
})

describe("formatSummary", () => {
  it("should say what was written, who is absent or unconfirmed, what was skipped, left, revoked and renumbered (AC6, AC9, AC13)", () => {
    const lines = formatSummary({
      slug: "acme2",
      inserted: { orgs: [{}], nodes: [{}, {}], blocks: [] },
      skipped: { members: 1, nodes: 0, blocks: 2 },
      absent: ["bob@example.test", "dan@example.test"],
      unconfirmed: ["dan@example.test"],
      closedInvitations: 2,
      revokedGrants: 1,
      tickets: [[1, 1], [3, 2]],
      domains: ["acme2.oto.cx"],
    })
    // Les textes d'AC6 et d'AC9 à l'octet ; des autres lignes, l'élément nommé.
    expect(lines).toEqual([
      "Organisation acme2 importée : 3 lignes dans 2 tables.",
      "Personnes absentes (2) : bob@example.test, dan@example.test",
      expect.stringMatching(/ dan@example\.test$/),
      expect.stringMatching(/ members 1, blocks 2$/),
      expect.stringMatching(/ 2$/),
      expect.stringMatching(/ 1$/),
      expect.stringMatching(/ FB-0003 → FB-0002$/),
      expect.stringMatching(/ acme2\.oto\.cx$/),
    ])
  })
})

describe("codeOf", () => {
  // Sans corps JSON (413, 502 à 504 de la passerelle), postgrest-js rend `{ message }` : le statut est sur le résultat.
  it("should give the error code, else the HTTP status of the response, never the message (AC12)", () => {
    const codes = [codeOf({ code: "23514", message: "m" }, 400), codeOf({ message: "Gateway Timeout" }, 504), codeOf({ message: "TypeError: fetch failed", code: "" }, 0)]
    expect(codes).toEqual(["23514", "HTTP 504", "réseau"])
  })
})

describe("targetPeople (org:import)", () => {
  // Le paquet ne fait confiance qu'à un email confirmé (`accept_invitations`, H12).
  it("should match confirmed emails only, reading pages until an empty one (HN-E09S04-24)", async () => {
    const pages = [
      [{ id: "u1", email: "Alice@Example.test", email_confirmed_at: AT }, { id: "u2", email: "dan@example.test", email_confirmed_at: undefined }],
      [{ id: "u3", email: "carol@example.test", email_confirmed_at: AT }],
    ]
    const admin = { auth: { admin: { listUsers: async ({ page }: { page: number }) => ({ data: { users: pages[page - 1] ?? [] }, error: null }) } } }
    const { byEmail, unconfirmed } = await targetPeople(admin)
    expect([...byEmail]).toEqual([["alice@example.test", "u1"], ["carol@example.test", "u3"]])
    expect([...unconfirmed]).toEqual(["dan@example.test"])
  })
})

describe("writePlan (org:import)", () => {
  /**
   * Connexion d'administration simulée : chaque requête attendue rend `answer()` (un fragment n'est
   * jamais attendu) ; `commit`, l'échec du `commit` de la transaction.
   */
  function transaction(answer: () => Promise<unknown>, commit?: Error) {
    const query = () => ({ then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => answer().then(resolve, reject) })
    const tx = Object.assign(query, { json: (value: unknown) => value })
    const sql = {
      begin: async (run: (transaction: typeof tx) => Promise<unknown>) => {
        const result = await run(tx)
        if (commit) throw commit
        return result
      },
    }
    // Seule la transaction est simulée : le type de la connexion complète ne s'en infère pas.
    return sql as unknown as Parameters<typeof writePlan>[0]
  }

  // Une transaction annulée ne laisse rien ; une connexion perdue au `commit` ne dit pas s'il a abouti.
  it("should say nothing was written when the organization is refused, and that the state is unknown when the commit loses its connection (AC12)", async () => {
    const doc = exportDoc(exportIds())
    const plan = planImport(doc, { people: samePeople(doc), org: TARGET, now: NOW })
    const refused = Object.assign(new Error("duplicate key value"), { code: "23505" })
    const lost = Object.assign(new Error("write CONNECTION_CLOSED db.example.test:5432"), { code: "CONNECTION_CLOSED" })
    const options = { slug: "acme2", domains: ["acme2.example.test"] }
    await expect(writePlan(transaction(() => Promise.reject(refused)), plan, options)).rejects.toThrow("Import annulé : orgs : 23505. Rien n'a été écrit.")
    // Chaque écriture du plan passe, les tickets reçoivent un numéro ; seul le `commit` échoue.
    await expect(writePlan(transaction(async () => [{ number: 1 }], lost), plan, options)).rejects.toThrow(
      "Import annulé : commit : CONNECTION_CLOSED. État inconnu : vérifiez si l'organisation acme2 existe.",
    )
  })

  // Une contrainte différée (`deferrable initially deferred`) refuse au `commit`, dans une réponse de la
  // base : la transaction est annulée, l'organisation créée avec elle.
  it("should say the organization was deleted when the database refuses the commit (AC12)", async () => {
    const doc = exportDoc(exportIds())
    const plan = planImport(doc, { people: samePeople(doc), org: TARGET, now: NOW })
    // postgres.js construit son erreur sur les champs de la réponse de la base ; ses types ne déclarent
    // que le constructeur d'`Error`, un message.
    const deferred = new postgres.PostgresError({ message: "insert or update violates foreign key constraint", code: "23503" } as unknown as string)
    await expect(writePlan(transaction(async () => [{ number: 1 }], deferred), plan, { slug: "acme2", domains: [] })).rejects.toThrow(
      "Import annulé : commit : 23503. L'organisation acme2 a été supprimée.",
    )
  })
})

// Les deux refus qui n'ont lieu que dans les scripts, lancés sans base : ils précèdent la lecture des
// variables. Un lancement de Node coûte jusqu'à 0,7 s sur la machine partagée (testing-strategy.md) :
// délai explicite.
describe("org:export and org:import refusals, without a base", { timeout: 30_000 }, () => {
  const run = promisify(execFile)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "org-transfer-unit-"))
  const emptyEnv = path.join(dir, "empty.env")
  fs.writeFileSync(emptyEnv, "")

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  async function script(name: string, args: string[]) {
    try {
      const { stdout, stderr } = await run(process.execPath, [path.resolve(__dirname, "../../scripts", name), ...args], { timeout: 20_000 })
      return { code: 0, stdout, stderr }
    } catch (error) {
      // execFile rejette sur un code non nul ; l'erreur porte le code et les deux sorties du processus.
      const { code, stdout, stderr } = error as { code: number; stdout: string; stderr: string }
      return { code, stdout, stderr }
    }
  }

  it("should refuse to replace an existing export without --force (AC5)", async () => {
    const out = path.join(dir, "present.org-export.json")
    fs.writeFileSync(out, "{}")
    const result = await script("org-export.mjs", ["--org", "acme", "--out", out, "--env", emptyEnv])
    expect(result).toMatchObject({ code: 1, stderr: expect.stringContaining(out) })
    expect(fs.readFileSync(out, "utf8")).toBe("{}")
  })

  it("should name the missing variables (AC5)", async () => {
    const result = await script("org-export.mjs", ["--org", "acme", "--out", path.join(dir, "new.org-export.json"), "--env", emptyEnv])
    expect(result).toMatchObject({ code: 1, stderr: expect.stringContaining("Variables manquantes : NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY") })
  })

  it("should refuse an unreadable file (AC11)", async () => {
    const unreadable = path.join(dir, "broken.org-export.json")
    fs.writeFileSync(unreadable, "{ not json")
    const result = await script("org-import.mjs", ["--in", unreadable, "--slug", "acme2", "--prefix", "acmedeux", "--env", emptyEnv])
    expect(result).toMatchObject({ code: 1, stderr: expect.stringContaining(unreadable) })
  })
})
