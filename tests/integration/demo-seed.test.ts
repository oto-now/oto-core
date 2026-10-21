// @vitest-environment node
// Sans `window` (jsdom), supabase-js ne se croit pas dans un navigateur : pas d'avertissement
// « Multiple GoTrueClient instances » pour les clients du test.
import { execFileSync } from "child_process"
import { randomBytes } from "crypto"
import path from "path"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { blockInputSchema, tableViewSchema } from "../../packages/plateforme/schemas"
import type { Database, Json } from "../../packages/plateforme/server/database"
import { isJsonObject } from "../../packages/plateforme/server/json"
import { orgSpec, resetOrg } from "../../scripts/demo-seed.mjs"
import { section as identiteSection } from "../../scripts/demo/10-identite.mjs"
import { section as contenuSection } from "../../scripts/demo/40-contenu.mjs"
import { PROSPECTS_VALBRUNE, section as tableauSection } from "../../scripts/demo/50-tableau.mjs"
import { section as procedureSection } from "../../scripts/demo/60-procedure.mjs"
import { section as usageSection } from "../../scripts/demo/80-usage.mjs"
import { PILOT_CONTEXTS, PILOT_DOMAINS, PILOT_PAGES, PILOT_PROCEDURE, PILOT_TABLE } from "../../scripts/lib/pilot-qualification.mjs"
import { createFixtures, SKIP_REASON, supabaseConfigured, type Fixtures, type TestOrg } from "../helpers/plateforme"
import { adminConnectionSecrets, SQL_SKIP_REASON, sqlConfigured, testAdminSql, type TestSql } from "../helpers/sql"

// `pnpm demo:seed` sur le projet Supabase cloud (H120) : organisations `t<hex>` et comptes
// `test-<hex>@example.invalid` jetables, passés au script par l'environnement du processus, qui
// l'emporte sur `.env.local` (N4) ; jamais l'organisation `demo` ni le compte E2E de `.env.local`.
// Comme le script (E01-S10 f1, AC-f4), le test lit et écrit `platform` par la connexion
// d'administration (`testAdminSql`) ; la clé secrète ne sert plus qu'aux comptes (API
// d'administration d'Auth), que le script crée aussi : la suite ne tourne donc que sur Supabase. Un
// test de fumée et la garde (`security-patterns.md § Outillage à clé service`) : trois lancements du
// script (M11). Le pilote (E06-S01, AC14) : ses domaines de travail, ses documents et son tableau sont
// ceux de `scripts/lib/pilot-qualification.mjs`, rejoués en place par les sections `identite`, `contenu`,
// `tableau` et `procedure`, sans nouveau lancement (NH23).

type Tables = Database["platform"]["Tables"]
/** Une ligne rendue par `to_jsonb` : dates en texte, comme les rendait PostgREST, à la microseconde. */
type JsonRow<T> = { row: T }
const rowsOf = <T,>(rows: readonly JsonRow<T>[]): T[] => rows.map((entry) => entry.row)
type Snapshot = {
  org: Tables["orgs"]["Row"]
  teams: Tables["teams"]["Row"][]
  members: Tables["members"]["Row"][]
  teamMembers: Tables["team_members"]["Row"][]
}
type Account = { email: string; password: string }

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const secretKey = process.env.SUPABASE_SECRET_KEY

const script = path.resolve(__dirname, "../../scripts/demo-seed.mjs")
const NETWORK_TIMEOUT = 120_000
const USERS_PER_PAGE = 200

/** Les domaines de travail qu'E01-S05 posait sur Démo, avant ceux du pilote (E06-S01, AC14). */
const E01S05_DOMAINS = "sales, customer support, energy consulting"

const hex = (bytes: number) => randomBytes(bytes).toString("hex")
const newAccount = (): Account => ({
  email: `test-${hex(6)}@example.invalid`,
  password: randomBytes(24).toString("base64url"),
})

/** Lance le script ; lève si sa sortie n'est pas 0 (le message d'execFileSync porte son stderr). */
function runSeed(args: string[], account: Account): string {
  return execFileSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    stdio: "pipe",
    timeout: 90_000,
    // Le mode Supabase, verrouillé : un `PLATFORM_OIDC_ISSUER` de `.env.local` passerait le script en mode OIDC.
    env: { ...process.env, E2E_USER_EMAIL: account.email, E2E_USER_PASSWORD: account.password, PLATFORM_OIDC_ISSUER: "" },
  })
}

/** Lance le script sans lever : son code de sortie et ses deux sorties (un refus sort en 1). */
function runSeedOutcome(args: string[], account: Account) {
  try {
    return { status: 0, stdout: runSeed(args, account), stderr: "" }
  } catch (error) {
    // execFileSync lève sur un code non nul ; l'erreur porte status, stdout et stderr du processus.
    const { status, stdout, stderr } = error as { status: number | null; stdout: string; stderr: string }
    return { status, stdout, stderr }
  }
}

/** AC5 ; l'échec ne nomme que les variables, jamais leur valeur (`not.toContain` l'afficherait). */
function expectNoSecret(output: string, account: Account) {
  const secrets = { secretKey, anonKey, password: account.password, email: account.email, ...adminConnectionSecrets() }
  const printed = Object.entries(secrets).filter(([, value]) => value && output.includes(value))
  expect(printed.map(([name]) => name)).toEqual([])
}

/** Contenu d'AC1, sans exclure ce qu'ajoutent les sections des stories suivantes. */
function expectSeeded(snapshot: Snapshot, slug: string, userId: string) {
  expect(snapshot.org).toMatchObject({
    slug,
    name: `Démo ${slug}`,
    prefix: slug,
    settings: expect.objectContaining({ domains: PILOT_DOMAINS }),
  })
  // E05-S13 (fiche D128) : le responsable par `team_members.role`, plus d'équipe par défaut.
  const ventes = snapshot.teams.find((team) => team.slug === "ventes")
  expect(ventes).toMatchObject({ name: "Ventes", lead_user_id: null })
  expect(snapshot.teams.find((team) => team.slug === "support")).toMatchObject({ name: "Support" })
  expect(snapshot.members.find((member) => member.user_id === userId)).toMatchObject({
    role: "admin",
    default_team_id: null,
    profile: expect.objectContaining({ name: "Compte E2E" }),
  })
  const lead = snapshot.teamMembers.find((row) => row.team_id === ventes?.id && row.user_id === userId)
  expect(lead).toMatchObject({ role: "lead" })
}

type JsonObject = { [key: string]: Json | undefined }
type GesturedRow = { data: JsonObject; provenance: JsonObject }
type PilotStateRow = Pick<Tables["blocks"]["Row"], "id" | "key" | "data" | "provenance" | "revision" | "claimed_by" | "claimed_by_user" | "lease_until" | "updated_at">
type PilotBlockRow = PilotStateRow & Pick<Tables["blocks"]["Row"], "node_id" | "type" | "text">
type PilotLinkRow = Pick<Tables["links"]["Row"], "source_node_id" | "source_block_id" | "target_path" | "target_key">
type PilotNodeRow = Pick<Tables["nodes"]["Row"], "id" | "path" | "title" | "summary" | "meta">
type ShapedBlock = { type: string; text: string | null; data: unknown; key: string | null }
type ShapedLink = { block: number; path: string; key: string | null }
type DocumentShape = { path: string; title: string; summary: string; blocks: ShapedBlock[]; links: ShapedLink[] }

/** Un objet JSON lu en base, ses champs gardant le type `Json` qu'une écriture exige ; sinon `null`. */
function jsonObject(value: Json): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null
}

/** Un bloc tel que le module le décrit et tel qu'on le relit : type, texte, données, clé. */
const shape = (block: { type: string; text?: string | null; data?: unknown; key?: string | null }): ShapedBlock => ({
  type: block.type,
  text: block.text ?? null,
  data: block.data ?? {},
  key: block.key ?? null,
})

const byLink = (a: ShapedLink, b: ShapedLink) => a.block - b.block || a.path.localeCompare(b.path)

/** Un document du module, attendu au chemin donné : ses liens `{ block, path, key? }`, rangés. */
function moduleDocument(document: (typeof PILOT_PAGES)[number], path: string): DocumentShape {
  const links = document.links.map((link) => ({ block: link.block, path: link.path, key: link.key ?? null })).sort(byLink)
  return { path, title: document.title, summary: document.summary, blocks: document.blocks.map(shape), links }
}

const rowShape = (row: PilotStateRow) => ({
  key: row.key,
  data: row.data,
  provenance: row.provenance,
  claimed_by: row.claimed_by,
  claimed_by_user: row.claimed_by_user,
  lease_until: row.lease_until,
})

/**
 * Les dix lignes à l'état initial (AC14) : valeurs du module, aucun bail, provenance d'import au nom du
 * compte E2E, sauf les cellules complétées des lignes « à revoir », écrites par son assistant.
 */
function initialRows(by: string) {
  const { column, review } = PILOT_TABLE.header.lifecycle
  const { columns, comment } = PILOT_TABLE.completed
  return PILOT_TABLE.rows.map((row) => {
    const reviewed = row.data[column] === review.state
    const provenance = Object.fromEntries(
      Object.keys(row.data).map((name) => [
        name,
        reviewed && columns.includes(name) ? { origin: "agent", by, at: expect.any(String), comment } : { origin: "import", by, at: expect.any(String) },
      ]),
    )
    return { key: row.key, data: row.data, provenance, claimed_by: null, claimed_by_user: null, lease_until: null }
  })
}

/**
 * Le pilote tel qu'il est publié dans une organisation : ses documents (blocs, liens par rang de bloc),
 * l'en-tête et les lignes du tableau, la page de Valbrune, le nombre de versions et `rules_version`.
 */
async function pilotState(sql: TestSql, orgId: string, paths: string[]) {
  const nodes = await sql<PilotNodeRow[]>`select id, path, title, summary, meta from platform.nodes where org_id = ${orgId}`
  const ids = nodes.map((node) => node.id)
  const [blocks, links, versions, org] = await Promise.all([
    sql<PilotBlockRow[]>`
      select id, node_id, type, text, data, key, provenance, revision, claimed_by, claimed_by_user,
             lease_until::text as lease_until, updated_at::text as updated_at
        from platform.blocks
       where node_id in ${sql(ids)} and state = 'published'
       order by position, id`,
    sql<PilotLinkRow[]>`select source_node_id, source_block_id, target_path, target_key from platform.links where source_node_id in ${sql(ids)}`,
    sql<{ count: number }[]>`select count(*)::int as count from platform.node_versions where node_id in ${sql(ids)}`,
    sql<{ rules_version: number }[]>`select rules_version from platform.orgs where id = ${orgId}`,
  ])
  if (org.length !== 1) throw new Error("orgs read failed: no organization")
  const nodeAt = (path: string) => {
    const node = nodes.find((candidate) => candidate.path === path)
    if (!node) throw new Error(`${path} missing`)
    return node
  }
  const documentOf = (path: string): DocumentShape => {
    const node = nodeAt(path)
    const own = blocks.filter((block) => block.node_id === node.id && block.type !== "row")
    const linked = links
      .filter((link) => link.source_node_id === node.id)
      .map((link) => ({ block: own.findIndex((block) => block.id === link.source_block_id), path: link.target_path, key: link.target_key }))
      .sort(byLink)
    return { path, title: node.title, summary: node.summary, blocks: own.map(shape), links: linked }
  }
  const table = nodeAt(PILOT_TABLE.path)
  const rows: PilotStateRow[] = blocks.filter((block) => block.node_id === table.id && block.type === "row").sort((a, b) => (a.key ?? "").localeCompare(b.key ?? ""))
  return {
    documents: paths.map(documentOf),
    header: { title: table.title, summary: table.summary, meta: table.meta },
    rows,
    valbrune: documentOf(PROSPECTS_VALBRUNE.node.path),
    versions: versions[0].count,
    rulesVersion: org[0].rules_version,
    paths: nodes.map((node) => node.path).sort(),
  }
}

describe.skipIf(!supabaseConfigured || !sqlConfigured)(
  supabaseConfigured && sqlConfigured
    ? "demo:seed on the cloud Supabase project"
    : `demo:seed on the cloud Supabase project (${supabaseConfigured ? SQL_SKIP_REASON : SKIP_REASON})`,
  { timeout: NETWORK_TIMEOUT },
  () => {
    // Renseignés par `beforeAll` ; `describe.skipIf` garantit les variables ici. `admin` : l'API
    // d'administration d'Auth seulement (comptes) ; `sql` : `platform`.
    let admin: SupabaseClient
    let sql: TestSql

    async function snapshot(slug: string): Promise<Snapshot> {
      const [org] = rowsOf(await sql<JsonRow<Tables["orgs"]["Row"]>[]>`select to_jsonb(o) as row from platform.orgs o where o.slug = ${slug}`)
      if (!org) throw new Error("orgs read failed: no organization")
      const teams = rowsOf(
        await sql<JsonRow<Tables["teams"]["Row"]>[]>`select to_jsonb(t) as row from platform.teams t where t.org_id = ${org.id} order by t.slug`,
      )
      const members = rowsOf(
        await sql<JsonRow<Tables["members"]["Row"]>[]>`select to_jsonb(m) as row from platform.members m where m.org_id = ${org.id} order by m.user_id`,
      )
      const teamMembers = rowsOf(
        await sql<JsonRow<Tables["team_members"]["Row"]>[]>`
          select to_jsonb(tm) as row from platform.team_members tm
           where tm.team_id in ${sql(teams.map((team) => team.id))}
           order by tm.team_id, tm.user_id`,
      )
      return { org, teams, members, teamMembers }
    }

    async function findUserId(email: string): Promise<string | null> {
      for (let page = 1; ; page += 1) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: USERS_PER_PAGE })
        if (error) throw new Error(`listUsers failed: ${error.message}`)
        const user = data.users.find((candidate) => candidate.email === email)
        if (user) return user.id
        if (data.users.length < USERS_PER_PAGE) return null
      }
    }

    // Organisation (cascade) puis compte ; tourne même après un échec.
    async function cleanup(slug: string, userId: string | null) {
      const failures: string[] = []
      await sql`delete from platform.orgs where slug = ${slug}`.catch((error: unknown) => {
        failures.push(`orgs delete: ${error instanceof Error ? error.message : String(error)}`)
      })
      if (userId) {
        const deleted = await admin.auth.admin.deleteUser(userId)
        if (deleted.error) failures.push(`deleteUser: ${deleted.error.message}`)
      }
      if (failures.length > 0) throw new Error(`cleanup incomplete: ${failures.join("; ")}`)
    }

    beforeAll(() => {
      admin = createClient(url ?? "", secretKey ?? "", { auth: { persistSession: false, autoRefreshToken: false } })
      sql = testAdminSql()
    })

    afterAll(() => sql?.end({ timeout: 5 }))

    // Test de fumée (M11) : un passage sur une organisation jetable, avec un compte E2E existant.
    describe("with an existing E2E account", () => {
      const slug = `t${hex(4)}`
      const account = newAccount()
      let userId = ""
      let output = ""
      let seeded: Snapshot

      beforeAll(async () => {
        const { data, error } = await admin.auth.admin.createUser({
          ...account,
          email_confirm: true,
          user_metadata: { full_name: "Compte existant" },
        })
        if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`)
        userId = data.user.id
        output = runSeed(["--slug", slug], account)
        seeded = await snapshot(slug)
      }, NETWORK_TIMEOUT)

      afterAll(() => cleanup(slug, userId || null), NETWORK_TIMEOUT)

      it("should seed a demonstration organization, its teams and the account as admin and lead of Ventes, printing no secret", () => {
        expectSeeded(seeded, slug, userId)
        // E01-S09 (AC15) : la ligne `members` porte l'email et le nom du compte, que le script passe ;
        // comparés sans imprimer l'adresse.
        const member = seeded.members.find((row) => row.user_id === userId)
        expect({ email: member?.email === account.email, name: member?.name }).toEqual({ email: true, name: "Compte existant" })
        expect(seeded.org.settings).toMatchObject({ demo: true })
        expect(output).toContain("[identite]")
        expect(output).toContain("compte E2E : existant, laissé tel quel")
        expectNoSecret(output, account)
      })

      // E08-S09, AC14 : la section `usage`, rejouée seule sur l'organisation semée, laisse le même état.
      it("should replay the usage section to the same state: DEMO-0004 without a procedure and three demo tickets", async () => {
        async function usage() {
          const tickets = await sql`
            select number, ctx, type, state, text, target, resolution, handled_by, handled_at::text as handled_at
              from platform.feedback where org_id = ${seeded.org.id}
             order by number`
          const lines = await sql`select method, tool, target, user_id from platform.journal where org_id = ${seeded.org.id} and ctx = 'DEMO-0004'`
          return { tickets, lines }
        }
        const before = await usage()

        await usageSection.run({ sql, spec: { prefix: slug }, org: { id: seeded.org.id }, e2eUser: { id: userId, email: account.email }, report: () => {} })

        expect(await usage()).toEqual(before)
        expect(output).toContain("[usage]")
        expect(before.tickets.map((ticket) => [ticket.ctx, ticket.type, ticket.state])).toEqual([
          ["DEMO-0002", "gap", "acknowledged"],
          ["DEMO-0003", "error", "open"],
          ["DEMO-0004", "gap", "declined"],
        ])
        expect(before.lines).toEqual([{ method: "tools/call", tool: `${slug}_context`, target: "Prépare le planning des tournées de la semaine", user_id: userId }])
      })

      // E06-S01, AC14 (qui contient la remise « à revoir » d'E07-S03, HN-E07S03-7) : les documents du pilote
      // et le tableau sont ceux du module ; après les domaines de travail d'E01-S05 remis, deux documents
      // changés, une réservation, une écriture et une décision de la revue (clé secrète), les sections
      // `identite`, `contenu`, `tableau` et `procedure` rendent les domaines du pilote, la marque de
      // démonstration gardée, et l'état initial en ne republiant que les deux documents changés ; un passage
      // de plus ne publie ni ne réécrit rien. La page de la vue et de la carte d'E07-S03 reste publiée avec
      // ses deux liens.
      it("should bring the pilot and its working domains back to the module after a drift, a claim, a write and a review, then publish and rewrite nothing on another pass (AC14)", async () => {
        const orgId = seeded.org.id
        const [member] = await sql<{ profile: Json }[]>`select profile from platform.members where org_id = ${orgId} and user_id = ${userId}`
        const profile = member?.profile
        const handle = isJsonObject(profile) && typeof profile.handle === "string" ? profile.handle : null
        if (!handle) throw new Error(`handle of the E2E account missing: ${member ? "no handle" : "no member"}`)
        const expected = [
          ...PILOT_CONTEXTS.map((document) => moduleDocument(document, document.path ?? `private/${handle}/contexte`)),
          ...PILOT_PAGES.map((document) => moduleDocument(document, document.path ?? "")),
          moduleDocument(PILOT_PROCEDURE, PILOT_PROCEDURE.path ?? ""),
        ]
        const paths = expected.map((document) => document.path)
        const seededState = await pilotState(sql, orgId, paths)
        expect(seededState.documents).toEqual(expected)
        expect(seededState.header).toEqual({ title: PILOT_TABLE.title, summary: PILOT_TABLE.summary, meta: PILOT_TABLE.header })
        expect(seededState.rows.map(rowShape)).toEqual(initialRows(userId))
        expect(seededState.paths.filter((nodePath) => nodePath.split("/").includes("sujets"))).toEqual([])
        const { valbrune } = seededState
        expect(valbrune.blocks.map((block) => [block.type, blockInputSchema.safeParse(block).success])).toEqual([
          ["paragraph", true],
          ["reference", true],
          ["reference", true],
        ])
        const view = tableViewSchema.parse(isJsonObject(valbrune.blocks[1].data) ? valbrune.blocks[1].data.view : null)
        const declared = PILOT_TABLE.header.columns.map((column) => column.name)
        expect([...(view.columns ?? []), ...Object.keys(view.filter ?? {})].filter((column) => !declared.includes(column))).toEqual([])
        expect(valbrune.links).toEqual([
          { block: 1, path: PILOT_TABLE.path, key: null },
          { block: 2, path: "conseil/grille_tarifaire", key: null },
        ])
        expect(output).toContain("prospects de Valbrune : publié (révision 1)")

        // Les domaines de travail qu'E01-S05 posait, deux documents qui ne sont plus ceux du module (le titre de
        // procédure et l'en-tête ouvert qu'E01-S06 semait), puis une réservation (P-001), une écriture
        // d'assistant (P-002) et une décision de la revue (P-003).
        const settings = jsonObject(seeded.org.settings)
        if (!settings) throw new Error("settings of the organization missing")
        const reverted = await sql`update platform.orgs set settings = ${sql.json({ ...settings, domains: E01S05_DOMAINS })} where id = ${orgId} returning id`
        if (reverted.length !== 1) throw new Error("orgs update failed: no organization")
        // Les colonnes écrites seulement : `search_tsv` et `lpath`, générées, n'ont pas de type de paramètre.
        const drifted: [string, Pick<Tables["nodes"]["Update"], "title" | "meta">][] = [
          [PILOT_PROCEDURE.path ?? "", { title: "Qualifier les prospects à traiter" }],
          [PILOT_TABLE.path, { meta: { ...PILOT_TABLE.header, closed: false } }],
        ]
        for (const [nodePath, values] of drifted) {
          const changed = await sql`update platform.nodes set ${sql(values)} where org_id = ${orgId} and path = ${nodePath} returning id`
          if (changed.length !== 1) throw new Error(`${nodePath} update failed: no node`)
        }
        const at = new Date().toISOString()
        const lease = new Date(Date.now() + 30 * 60_000).toISOString()
        const gestures: [string, (row: GesturedRow) => Pick<Tables["blocks"]["Update"], "data" | "provenance" | "claimed_by" | "claimed_by_user" | "lease_until">][] = [
          ["P-001", (row) => ({ data: { ...row.data, statut: "en cours" }, claimed_by: "qualification", claimed_by_user: userId, lease_until: lease })],
          ["P-002", (row) => ({ data: { ...row.data, contact: "Hugo Ferrand, directeur" }, provenance: { ...row.provenance, contact: { origin: "agent", by: userId, at } } })],
          ["P-003", (row) => ({ data: { ...row.data, statut: "qualifié" }, provenance: { ...row.provenance, statut: { origin: "human", by: userId, at } } })],
        ]
        for (const [key, change] of gestures) {
          const row = seededState.rows.find((candidate) => candidate.key === key)
          const data = row ? jsonObject(row.data) : null
          const provenance = row ? jsonObject(row.provenance) : null
          if (!row || !data || !provenance) throw new Error(`${key} missing`)
          const values = { ...change({ data, provenance }), revision: row.revision + 1 }
          const written = await sql`update platform.blocks set ${sql(values)} where id = ${row.id} and state = 'published' returning id`
          if (written.length !== 1) throw new Error(`${key} write failed: no row`)
        }
        // Les sections rejouées dans l'ordre du script (NH23) : `identite` pose l'organisation, le compte E2E et
        // les équipes que lisent les suivantes ; elle ne lit de l'environnement que le compte E2E, qui existe.
        const ctx = {
          sql,
          auth: admin.auth.admin,
          env: { supabaseUrl: "", anonKey: "", siteUrl: undefined, e2eEmail: account.email, e2ePassword: account.password },
          spec: orgSpec(slug),
          org: null,
          e2eUser: null,
          teams: {},
          report: () => {},
        }
        const replay = async () => {
          await identiteSection.run(ctx)
          await contenuSection.run(ctx)
          await tableauSection.run(ctx)
          await procedureSection.run(ctx)
        }

        await replay()
        const [org] = await sql<{ settings: Json }[]>`select settings from platform.orgs where id = ${orgId}`
        if (!org) throw new Error("orgs read failed: no organization")
        expect(org.settings).toEqual({ ...settings, domains: PILOT_DOMAINS, demo: true })
        const reset = await pilotState(sql, orgId, paths)
        const touched = gestures.map(([key]) => key)
        expect(reset.rows.map(rowShape)).toEqual(initialRows(userId))
        expect(reset.rows.map((row) => [row.key, row.revision])).toEqual(seededState.rows.map((row) => [row.key, row.revision + (touched.includes(row.key ?? "") ? 2 : 0)]))
        const untouched = (rows: PilotStateRow[]) => rows.filter((row) => !touched.includes(row.key ?? "")).map((row) => [row.key, row.updated_at])
        expect(untouched(reset.rows)).toEqual(untouched(seededState.rows))
        // Les deux documents changés, et eux seuls, sont republiés ; aucun Contexte : `rules_version` ne bouge pas.
        expect({ documents: reset.documents, header: reset.header, valbrune: reset.valbrune, versions: reset.versions, rulesVersion: reset.rulesVersion }).toEqual({
          documents: expected,
          header: seededState.header,
          valbrune: seededState.valbrune,
          versions: (seededState.versions ?? 0) + drifted.length,
          rulesVersion: seededState.rulesVersion,
        })

        await replay()
        expect(await pilotState(sql, orgId, paths)).toEqual(reset)
      })

      // M63 : un contenu de la Démo déplacé à l'écran (son chemin devenu un ancien chemin) est remis à son
      // chemin par les sections `contenu`, `tableau` et `procedure`, sans nouveau lancement ; ce que la Démo
      // ne sème pas (une page de projet, une page de test) reste où il est.
      it("should move the demo nodes moved elsewhere back to their path, leaving the pages it does not seed where they are", async () => {
        const orgId = seeded.org.id
        type Placed = { id: string; parent_id: string | null }
        const tree = async () =>
          new Map((await sql<(Placed & { path: string })[]>`select id, path, parent_id from platform.nodes where org_id = ${orgId}`).map((node) => [node.path, node]))
        const before = await tree()
        const idAt = (nodePath: string) => {
          const node = before.get(nodePath)
          if (!node) throw new Error(`${nodePath} missing`)
          return node.id
        }
        const [guide, ventes, conseil, grille, table] = ["guide", "ventes", "conseil", "conseil/grille_tarifaire", PILOT_TABLE.path].map(idAt)
        const insertPage = async (parentId: string, nodePath: string) => {
          const [node] = await sql<{ id: string }[]>`
            insert into platform.nodes ${sql({ org_id: orgId, parent_id: parentId, path: nodePath, kind: "page", title: nodePath, summary: "Une page hors de la Démo." })} returning id`
          if (!node) throw new Error(`${nodePath} insert failed: no node`)
          return node.id
        }
        const projet = await insertPage(guide, "projet_toto")
        const test = await insertPage(conseil, "conseil/test")
        // Les gestes de l'écran, dans l'ordre du 2026-09-28 : Conseil sous le projet (sa page de test le suit),
        // la grille et la page de test à côté de Conseil ; le tableau sous la procédure.
        const moves: [string, string, string][] = [
          [conseil, projet, "projet_toto/conseil"],
          [grille, projet, "projet_toto/grille_tarifaire"],
          [test, projet, "projet_toto/test"],
          [table, idAt(PILOT_PROCEDURE.path ?? ""), `${PILOT_PROCEDURE.path}/suivi_prospects`],
        ]
        for (const [id, parentId, nodePath] of moves) {
          const moved = await sql`update platform.nodes set parent_id = ${parentId}, path = ${nodePath} where org_id = ${orgId} and id = ${id} returning id`
          if (moved.length !== 1) throw new Error(`${nodePath} move failed: no node`)
        }
        const reports: string[] = []
        const ctx = {
          sql,
          org: { id: orgId },
          e2eUser: { id: userId, email: account.email },
          teams: Object.fromEntries(seeded.teams.map((team) => [team.slug, team.id])),
          report: (line: string) => reports.push(line),
        }

        await contenuSection.run(ctx)
        await tableauSection.run(ctx)
        await procedureSection.run(ctx)

        const after = await tree()
        const placed = (nodePath: string): Placed | null => {
          const node = after.get(nodePath)
          return node ? { id: node.id, parent_id: node.parent_id } : null
        }
        expect(["conseil", "conseil/grille_tarifaire", PILOT_TABLE.path, "projet_toto", "projet_toto/test"].map(placed)).toEqual([
          { id: conseil, parent_id: guide },
          { id: grille, parent_id: conseil },
          { id: table, parent_id: ventes },
          { id: projet, parent_id: guide },
          { id: test, parent_id: projet },
        ])
        expect(reports.filter((line) => line.includes("remis à son chemin"))).toEqual(
          ["conseil", "conseil/grille_tarifaire", PILOT_TABLE.path].map((nodePath) => `nœud ${nodePath} : déplacé depuis, remis à son chemin`),
        )
      })
    })

    // Garde de l'exécuteur : une organisation que le script n'a pas créée (sans `settings.demo`)
    // n'est ni semée ni supprimée, et le compte E2E jetable n'est pas créé.
    describe("on an existing organization that is not a demonstration", () => {
      const account = newAccount()
      let fx: Fixtures
      let org: TestOrg
      let before: Snapshot
      let after: Snapshot
      let seeded: ReturnType<typeof runSeedOutcome>
      let reset: ReturnType<typeof runSeedOutcome>
      let directReset = ""

      beforeAll(async () => {
        fx = createFixtures()
        org = await fx.createOrg()
        const member = await fx.createUser()
        await fx.addMember(org.id, member.id, { role: "admin" })
        await fx.createTeam(org.id, { slug: "ventes", name: "Ventes", leadUserId: member.id })
        before = await snapshot(org.slug)
        seeded = runSeedOutcome(["--slug", org.slug], account)
        reset = runSeedOutcome(["--reset", "--slug", org.slug], account)
        // Seconde barrière, sans la garde : la suppression elle-même exige la marque (id connu).
        directReset = await resetOrg(sql, org.slug, org.id, () => {}).then(
          () => "résolue",
          (error: unknown) => (error instanceof Error ? error.message : String(error)),
        )
        after = await snapshot(org.slug)
      }, NETWORK_TIMEOUT)

      // Si la garde a laissé passer : organisation resemée sous le même slug (nouvel identifiant) et
      // compte E2E jetable créé, retrouvé par son email.
      afterAll(async () => {
        try {
          await fx?.cleanup()
        } finally {
          await cleanup(org?.slug ?? "", await findUserId(account.email))
        }
      }, NETWORK_TIMEOUT)

      it("should refuse --slug and --reset --slug with code 1, naming the organization, and the reset called by its id, the organization lacking the mark", () => {
        expect(seeded.status).toBe(1)
        expect(seeded.stderr).toContain(`Refusé : l'organisation ${org.slug} (« ${org.name} »)`)
        expect(reset.status).toBe(1)
        expect(reset.stderr).toContain(`Refusé : l'organisation ${org.slug} (« ${org.name} »)`)
        expect(directReset).toContain(`Réinitialisation refusée : l'organisation ${org.slug}`)
      })

      it("should leave every row identical, identifiers and dates included, and not create the E2E account", async () => {
        expect(after).toEqual(before)
        expect(await findUserId(account.email)).toBeNull()
      })

      it("should print no key, password or email", () => {
        expectNoSecret([seeded, reset].map((run) => run.stdout + run.stderr).join("\n"), account)
      })
    })
  },
)
