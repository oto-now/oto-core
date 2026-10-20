// @vitest-environment node
// Pilote V1, qualification de prospects, de bout en bout sur une vraie base
// (E06-S01 : AC3 à AC13, AC15 ; H120), là où la base est le sujet (`testing-strategy.md § Budget de
// tests`) : publication (`publish_node` par `write`), routage (`route_candidates`), recherche
// (`search_content`) et parcours de la file (`table.*`, revue humaine). Les règles propres à chaque
// service (refus de `table.*`, revue, filtres) restent prouvées par les tests de leur story, sur la base
// simulée d'E01-S07. Organisation jetable `t<hex>` : l'arbre d'abord (`createTree`), puis les équipes
// Ventes et Support, l'administratrice A, M (Ventes) et S (Support) ; dossiers d'équipe, espaces
// personnels et Contextes nés par déclencheur (P39). Contenu : le module
// `scripts/lib/pilot-qualification.mjs` (pages, tableau et Contextes par `publishBlocks` et `addRows`),
// puis la procédure écrite et publiée par A avec `write` (AC3). Sessions MCP par `InMemoryTransport`
// (`connectMcp`, câblé comme `/api/mcp`) sous les jetons ; la revue par `handlePlateforme`.
// Suite portable (E11-S14) : personnes sans compte, jetons signés localement que l'API vérifie par
// `verifyToken` (`tests/helpers/session-locale.ts`) ; relectures par la connexion d'administration, le
// routage et la lecture de S par leur session sur la face SQL (`asCaller`).
// Repris de la maquette (`mcp-test/tests/integration/proto-routing.test.ts` l. 14-81) : le rapport de
// routage imprimé ; retiré : les déclencheuses et voisines lues dans les données (P37).
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { handlePlateforme } from "@otomata_tech/oto_platform/api"
import { blockInputSchema, renderBlocks, splitSections, type BlockInput } from "../../packages/plateforme/schemas"
import { tableRowReadSchema } from "../../packages/plateforme/schemas/tables"
import type { PlatformDb } from "../../packages/plateforme/server/db"
import { resolveIdentity, type Identity } from "../../packages/plateforme/server/identity"
import { isJsonObject } from "../../packages/plateforme/server/json"
import { applyBonuses, CANDIDATES_SHOWN, decide, formatScore, loadRoutingSettings, rankCandidates, type RoutingSettings } from "../../packages/plateforme/server/routing"
import { PILOT_CONTEXTS, PILOT_DOMAINS, PILOT_PAGES, PILOT_PROCEDURE, PILOT_TABLE } from "../../scripts/lib/pilot-qualification.mjs"
import { connectMcp } from "../helpers/mcp"
import { hex, type TestOrg } from "../helpers/plateforme"
import { createLocalFixtures, type LocalFixtures } from "../helpers/session-locale"
import { asCaller, portable, sqlConfigured, testAdminSql, type SqlUser, type TestSql } from "../helpers/sql"
import { privateFolderPending, privateFolderSuite } from "../helpers/pending-migrations"
import { PILOT_PROCEDURE_PATH, PILOT_ROUTING_CASES, type PilotRoutingCase } from "./pilot-routing.cases"

// Ces tests supposent le dossier `private` en base (fiche D107) : sautés, la version nommée, tant que
// 20260928120000 n'est pas appliquée au projet (`database-patterns.md § Règles`).
const privatePending = await privateFolderPending()

const SETUP_TIMEOUT = 300_000
const NETWORK_TIMEOUT = 180_000
/** Phrases routées en même temps : le projet est partagé par les agents (quatre allers-retours chacune). */
const CONCURRENCY = 6
const PATH = PILOT_PROCEDURE_PATH
const TABLE = PILOT_TABLE.path
const WORKER = "qualification"
const QUERY = "Boulangerie des Tilleuls"

/** La consigne du bloc procédure de `context` (E03-S02, `server/context/blocks/procedure.ts`). */
const FOLLOW = "Follow these steps now. Ask the user's explicit approval before anything that sends, or that changes data beyond the steps of the procedure the user asked for."
const callLine = (prefix: string) =>
  `A \`\`\`call block holds <function> <arguments JSON>: run it with ${prefix}_call {"function": "<function>", "arguments": <arguments JSON>}, replacing each "<…>" value with the real one.`

type Person = SqlUser & { name: string; handle: string; token: string }
type Place = TestOrg & { host: string }
type Called = Awaited<ReturnType<Awaited<ReturnType<typeof connectMcp>>["call"]>>
type Fields = Record<string, unknown>
type Outcome = PilotRoutingCase & { score: number | null; first: boolean; served: boolean }

/** Les objets d'un champ de `structuredContent` (lignes, emplacements), à la profondeur donnée. */
function records(called: Called, ...path: string[]): Fields[] {
  let value: unknown = called.result.structuredContent
  for (const key of path) value = isJsonObject(value) ? value[key] : undefined
  return Array.isArray(value) ? value.filter(isJsonObject) : []
}

/** Le résultat d'une fonction appelée par `call` (`structuredContent.result`). */
function resultOf(called: Called): Fields {
  const data = called.result.structuredContent
  return isJsonObject(data) && isJsonObject(data.result) ? data.result : {}
}

/** Le refus d'un appel : son texte d'erreur, ou les problèmes des lignes refusées d'un `table.write` répondu. */
function refusal(called: Called): string {
  if (called.isError) return called.text
  return records(called, "result", "rows")
    .filter((row) => row.status === "refused")
    .flatMap((row) => (Array.isArray(row.problems) ? row.problems.map(String) : []))
    .join(" ")
}

/** Chaque `null` d'une valeur, par son chemin (H93 : une ligne lue n'en porte aucun). */
function nulls(value: unknown, path = "$"): string[] {
  if (value === null) return [path]
  if (Array.isArray(value)) return value.flatMap((item, index) => nulls(item, `${path}[${index}]`))
  if (isJsonObject(value)) return Object.entries(value).flatMap(([key, item]) => nulls(item, `${path}.${key}`))
  return []
}

/** Les sections de la procédure en opérations `add_section` : leur texte, le rendu markdown commun (E03-S03). */
function sectionOps(blocks: readonly BlockInput[]) {
  return splitSections(blocks).flatMap((section) =>
    section.heading ? [{ op: "add_section", section: section.heading.text ?? "", text: renderBlocks(section.blocks.slice(1)) }] : [],
  )
}

/** Le routage de `context` (E03-S02) pour chaque phrase, sous l'identité de M ; score de la procédure s'il est candidat (≥ 0,30). */
async function route(db: PlatformDb, identity: Identity, settings: RoutingSettings, cases: readonly PilotRoutingCase[]): Promise<Outcome[]> {
  const outcomes: Outcome[] = []
  for (let at = 0; at < cases.length; at += CONCURRENCY) {
    const batch = cases.slice(at, at + CONCURRENCY)
    outcomes.push(
      ...(await Promise.all(
        batch.map(async (routingCase) => {
          const candidates = await rankCandidates(db, identity, { query: routingCase.phrase, limit: CANDIDATES_SHOWN })
          const own = candidates.find((candidate) => candidate.path === PATH)
          return { ...routingCase, score: own?.score ?? null, first: candidates[0]?.path === PATH, served: decide(candidates, settings)?.path === PATH }
        }),
      )),
    )
  }
  return outcomes
}

/** Rapport imprimé (AC4) : score, score avec le bonus d'usage, servie ou non ; puis le taux des paraphrases servies. */
function report(outcomes: readonly Outcome[], settings: RoutingSettings): void {
  const line = (outcome: Outcome) => {
    const label = outcome.id ?? outcome.kind
    if (outcome.score === null) return `  ${label} « ${outcome.phrase} » : < 0.30, pas candidate`
    const withUsage = applyBonuses(outcome.score, { team: false, usage: true })
    const usage = withUsage >= settings.threshold ? "oui" : "non"
    return `  ${label} « ${outcome.phrase} » : score ${formatScore(outcome.score)} · avec l'usage ${formatScore(withUsage)} · servie : ${outcome.served ? "oui" : "non"} (avec l'usage : ${usage})`
  }
  const paraphrases = outcomes.filter((outcome) => outcome.kind === "paraphrase")
  const served = paraphrases.filter((outcome) => outcome.served).length
  console.log(
    [
      `[routage du pilote] seuil ${formatScore(settings.threshold)} ; M, membre de Ventes : bonus d'équipe compris, aucun usage`,
      ...outcomes.map(line),
      `  paraphrases servies : ${served}/${paraphrases.length} (${Math.round((served / paraphrases.length) * 100)} %)`,
    ].join("\n"),
  )
}

/** Ce qui manque à une phrase par rapport à son attendu (AC4) ; `null` quand rien ne manque. */
function missed(outcome: Outcome): string | null {
  if (outcome.expect === "served" && !outcome.served) return `${outcome.phrase}: not served`
  if (outcome.expect === "first" && !outcome.first) return `${outcome.phrase}: not the first candidate`
  if (outcome.expect === "never" && outcome.served) return `${outcome.phrase}: served`
  return null
}

type RowRead = { key: string; data: unknown; provenance: unknown; revision: number; claimed_by: string | null; claimed_by_user: string | null; lease_until: Date | null }

const SUITE = "pilot V1, prospect qualification, end to end"

describe.skipIf(!sqlConfigured || privatePending)(
  privateFolderSuite(portable(SUITE), privatePending),
  { timeout: NETWORK_TIMEOUT },
  () => {
    let fx: LocalFixtures
    let admin: TestSql
    let org: Place
    let a: Person
    let m: Person
    let s: Person
    let ids: { table: string; grille: string; notes: string; procedure: string }
    let published: Called

    async function person(name: string, handle: string): Promise<Person> {
      return { ...(await fx.createUser({ fullName: name })), name, handle, token: "" }
    }

    function connect(who: Person, userAgent: string) {
      return connectMcp({ host: org.host }, { id: who.id, email: who.email, accessToken: who.token }, userAgent)
    }

    /** Les lignes du tableau par clé, relues par la connexion d'administration : valeurs, provenance, révision et bail. */
    async function rowsOf(keys: string[]): Promise<RowRead[]> {
      return [
        ...(await admin<RowRead[]>`
          select key, data, provenance, revision, claimed_by, claimed_by_user, lease_until from platform.blocks
          where node_id = ${ids.table} and state = 'published' and key in ${admin(keys)} order by key`),
      ]
    }

    beforeAll(async () => {
      fx = createLocalFixtures()
      admin = testAdminSql()
      const host = `t${hex(4)}.example.invalid`
      org = { ...(await fx.createOrg({ name: "Démo pilote", hosts: [host], settings: { domains: PILOT_DOMAINS } })), host }
      // L'arbre d'abord : dossiers d'équipe, espaces personnels et Contextes naissent par déclencheur (P39).
      const tree = await fx.createTree(org.id)
      const ventes = (await fx.createTeam(org.id, { slug: "ventes", name: "Ventes" })).id
      const support = (await fx.createTeam(org.id, { slug: "support", name: "Support" })).id
      a = await person("Ada Martin", "ada")
      m = await person("Marie Leroy", "marie")
      s = await person("Sam Dubois", "sam")
      await fx.addMember(org.id, a.id, { role: "admin", profile: { handle: a.handle, name: a.name } })
      await fx.addMember(org.id, m.id, { profile: { handle: m.handle, name: m.name } })
      await fx.addMember(org.id, s.id, { profile: { handle: s.handle, name: s.name } })
      await fx.addTeamMember(ventes, m.id)
      await fx.addTeamMember(support, s.id)

      // Pages et tableau avant les Contextes : les liens de ceux-ci trouvent leur cible.
      const conseil = await fx.createNode(org.id, { parentId: tree.root, path: "conseil", title: "Conseil", summary: "Offres et tarifs du conseil en énergie." })
      const folder = await fx.nodeId(org.id, "ventes")
      const pages: string[] = []
      for (const page of PILOT_PAGES) {
        const path = page.path ?? ""
        const id = await fx.createNode(org.id, { parentId: path.startsWith("conseil/") ? conseil : folder, path, title: page.title, summary: page.summary })
        await fx.publishBlocks(id, page.blocks.map((block) => blockInputSchema.parse(block)), { links: page.links })
        pages.push(id)
      }
      const table = await fx.createNode(org.id, { parentId: folder, path: TABLE, kind: "table", title: PILOT_TABLE.title, summary: PILOT_TABLE.summary })
      await fx.publishBlocks(table, [], { meta: PILOT_TABLE.header })
      const at = new Date().toISOString()
      const imported = (data: Record<string, string | number>) => Object.fromEntries(Object.keys(data).map((column) => [column, { origin: "import", by: a.id, at }]))
      await fx.addRows(table, PILOT_TABLE.rows.map((row) => ({ key: row.key, data: row.data, provenance: imported(row.data) })))
      for (const contexte of PILOT_CONTEXTS) {
        const id = await fx.nodeId(org.id, contexte.path ?? `private/${m.handle}/contexte`)
        const blocks = contexte.blocks.map((block) => blockInputSchema.parse(block))
        await fx.publishBlocks(id, blocks, { title: contexte.title, summary: contexte.summary, links: contexte.links })
      }
      for (const who of [a, m, s]) who.token = (await fx.sessionFor(who)).accessToken

      // AC3 : A écrit et publie la procédure par `write`, une opération `add_section` par titre.
      const session = await connect(a, `pilot-admin-${hex(3)}`)
      const { code } = await session.openContext("Publie la procédure de qualification des prospects")
      const { path, title, summary, blocks } = PILOT_PROCEDURE
      const ops = sectionOps(blocks.map((block) => blockInputSchema.parse(block)))
      published = await session.call("write", { ctx: code, path, kind: "procedure", title, summary, ops, publish: true })
      await session.flush()
      ids = { table, grille: pages[0], notes: pages[1], procedure: await fx.nodeId(org.id, PATH) }
    }, SETUP_TIMEOUT)

    afterAll(async () => {
      try {
        await fx?.cleanup()
      } finally {
        await admin?.end({ timeout: 5 })
      }
    }, SETUP_TIMEOUT)

    it("should publish the procedure an administrator writes with no refusal: no header, three sections, the calls of the module and its links (AC3)", async () => {
      // Le brouillon créé, puis publié : aucun refus du contrôle d'E03-S06, aucun avertissement de lien.
      // E11-S18 (AC-4) : une ligne, la publication et ce que l'écriture a fait.
      const lines = published.text.split("\n")
      expect([published.isError, lines.length, lines[0].startsWith(`Published ${PATH} revision 1 (3 sections, 14 blocks): added « `)]).toEqual([false, 1, true])
      const node = await admin`select kind, title, summary, meta, revision from platform.nodes where id = ${ids.procedure}`
      expect(node).toEqual([{ kind: "procedure", title: PILOT_PROCEDURE.title, summary: PILOT_PROCEDURE.summary, meta: {}, revision: 1 }])
      const blocks = await admin<{ id: string; type: string; text: string | null; data: unknown }[]>`
        select id, type, text, data from platform.blocks where node_id = ${ids.procedure} and state = 'published' order by position`
      expect(blocks.map((block) => block.type)).toEqual(PILOT_PROCEDURE.blocks.map((block) => block.type))
      expect(blocks.filter((block) => block.type === "heading").map((block) => block.text)).toEqual(["Quand l'utiliser", "Étapes", "Règles"])
      const calls = (list: readonly { type: string; data?: unknown }[]) => list.filter((block) => block.type === "call").map((block) => block.data)
      expect(calls(blocks)).toEqual(calls(PILOT_PROCEDURE.blocks))

      const links = await admin<{ target_path: string }[]>`
        select source_block_id, target_path, target_key, target_node_id from platform.links where source_node_id = ${ids.procedure}`
      const targets: Record<string, string> = { [TABLE]: ids.table, "conseil/grille_tarifaire": ids.grille }
      const expected = PILOT_PROCEDURE.links.map((link) => ({ source_block_id: blocks[link.block]?.id, target_path: link.path, target_key: null, target_node_id: targets[link.path] }))
      const byPath = (x: { target_path: string }, y: { target_path: string }) => x.target_path.localeCompare(y.target_path)
      expect([...links].sort(byPath)).toEqual(expected.sort(byPath))
    })

    it("should serve the procedure for its formulations, its title and QP-D1, rank it first for QP-D2 and QP-I1, serve no negative, and print the measured phrases (AC4)", async () => {
      const db = asCaller(m.id, m.email)
      const identity = await resolveIdentity(db, org.host, { userId: m.id, email: m.email })
      const settings = await loadRoutingSettings(db, org.id)
      const outcomes = await route(db, identity, settings, PILOT_ROUTING_CASES)
      report(outcomes, settings)
      expect(outcomes.map(missed).filter((problem) => problem !== null)).toEqual([])
    })

    it("should run the pilot from context to the human review: claim, refusals, find, write with proofs, release, review, final read and journal (AC5 to AC12, AC15)", async () => {
      const agent = `pilot-m-${hex(4)}`
      const session = await connect(m, agent)
      const prefix = org.prefix

      // AC5 : `context` sert les étapes complètes, blocs `call` compris, sous la consigne du bloc procédure.
      const opened = await session.openContext("Qualifie les prospects à traiter.")
      const ctx = opened.code
      const call = (fn: string, args: Fields) => session.call("call", { ctx, function: fn, arguments: args })
      const steps = await admin<{ id: string; type: string; text: string | null; data: unknown; key: string | null; position: number | null }[]>`
        select id, type, text, data, key, position from platform.blocks where node_id = ${ids.procedure} and state = 'published' order by position`
      expect(opened.isError).toBe(false)
      expect(ctx).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/)
      // Rendu calculé sur les blocs relus : `jsonb` range les clés des arguments (`testing-strategy.md § Anti-patterns`).
      expect(opened.text).toContain(
        [`## Procedure ${PATH} (v1): ${PILOT_PROCEDURE.title}`, FOLLOW, callLine(prefix), "", renderBlocks([...steps], { headingBase: 3 })].join("\n"),
      )
      expect(opened.text.match(/```call\ntable\.(schema|claim|write|release) \{/g)).toHaveLength(4)
      expect(isJsonObject(opened.result.structuredContent) ? opened.result.structuredContent.served : null).toMatchObject({ path: PATH, revision: 1 })

      // AC6 : le contrat, puis trois lignes réservées « en cours » au travailleur et à M.
      const schema = await call("table.schema", { table: TABLE })
      const contract = resultOf(schema)
      expect([schema.isError, contract.key, isJsonObject(contract.lifecycle) ? contract.lifecycle.states : null]).toEqual([false, "ref", PILOT_TABLE.header.lifecycle.states])
      const claim = await call("table.claim", { table: TABLE, worker: WORKER, limit: 3, lease_minutes: 30 })
      const claimed = records(claim, "result", "claimed").map((row) => String(row.key))
      expect([claim.isError, claimed]).toEqual([false, ["P-001", "P-002", "P-004"]])
      const leased = await rowsOf(claimed)
      const now = Date.now()
      for (const row of leased) {
        const until = row.lease_until?.getTime() ?? Number.NaN
        expect({ key: row.key, statut: isJsonObject(row.data) ? row.data.statut : null, claimed_by: row.claimed_by, claimed_by_user: row.claimed_by_user }).toEqual({
          key: row.key,
          statut: "en cours",
          claimed_by: WORKER,
          claimed_by_user: m.id,
        })
        expect(until - now).toBeGreaterThan(28 * 60_000)
        expect(until - now).toBeLessThanOrEqual(30 * 60_000)
      }

      // AC7 : quatre refus actionnables (codes d'E07-S02), rien d'écrit.
      const before = await rowsOf([...claimed, "P-999"])
      const [first] = claimed
      const nullWrite = await call("table.write", { table: TABLE, rows: [{ key: first, set: { email: null } }] })
      const closedWrite = await call("table.write", { table: TABLE, rows: [{ key: "P-999", set: { entreprise: { value: "Entreprise inventée", comment: "Nom supposé" } } }] })
      const toWorking = await call("table.release", { table: TABLE, key: first, worker: WORKER, state: "en cours" })
      const toDecision = await call("table.release", { table: TABLE, key: first, worker: WORKER, state: "qualifié" })
      expect(refusal(nullWrite)).toContain("null is refused")
      expect([refusal(closedWrite), records(closedWrite, "result", "rows").map((row) => [row.key, row.status, row.code])]).toEqual([
        expect.stringContaining("this table is closed"),
        [["P-999", "refused", "invalid_arguments"]],
      ])
      expect([toWorking.isError, toWorking.text]).toEqual([true, expect.stringContaining("« en cours » is set by table.claim")])
      expect([toDecision.isError, toDecision.text]).toEqual([true, expect.stringContaining("are decided by a person in the review queue")])
      expect(await rowsOf([...claimed, "P-999"])).toEqual(before)

      // AC15, partie M : la source interne se trouve par `find`, au bloc près.
      const found = await session.call("find", { ctx, query: QUERY })
      const placesOf = (path: string) => records(found, "matches").find((match) => match.path === path)?.places
      // E11-S19 (AC-e4) : un titre trouvé est dans sa propre section.
      expect(placesOf("ventes/notes_salon_2026")).toContainEqual({ match: "block", block: "tilleuls", block_type: "heading", column: null, snippet: expect.stringContaining("Tilleuls"), section: "Boulangerie des Tilleuls (Valbrune)" })
      expect(placesOf(TABLE)).toContainEqual({ match: "block", block: "P-001", block_type: "row", column: "entreprise", snippet: expect.stringContaining("Tilleuls") })

      // AC8 : les trois lignes écrites en un appel, chaque valeur avec sa preuve ; « cherché, rien trouvé » avec sa raison.
      const source = "Notes du salon Énergies locales 2026 (ventes/notes_salon_2026)"
      const noEmail = "Notes du salon : aucun email laissé ; aucune adresse sur le site du camping."
      const rows = [
        {
          key: "P-001",
          set: {
            contact: { value: "Marion Vasseur, gérante", comment: source },
            email: { value: "marion.vasseur@tilleuls-valbrune.test", link: "https://www.tilleuls-valbrune.test/contact" },
            montant_estime: { value: 1500, comment: "Un seul site : pré-étude (conseil/grille_tarifaire)." },
          },
        },
        {
          key: "P-002",
          set: { contact: { value: "Hugo Ferrand, directeur", comment: source }, montant_estime: { value: 1500, comment: "Un seul site : pré-étude (conseil/grille_tarifaire)." } },
          verified_empty: [{ column: "email", reason: noEmail }],
        },
        {
          key: "P-004",
          set: {
            contact: { value: "Luc Moreau, cogérant", comment: source },
            email: { value: "luc.moreau@moreau-freres.test", link: "https://www.moreau-freres.test/contact" },
            montant_estime: { value: 6500, comment: "Deux ateliers, projet commun : étude complète (conseil/grille_tarifaire)." },
          },
        },
      ]
      const write = await call("table.write", { table: TABLE, rows })
      expect([write.isError, resultOf(write).written, resultOf(write).refused]).toEqual([false, 3, 0])
      // Écrites sous le bail de M : le travailleur du bail et le client MCP du `ctx`, s'il est connu (E11-S01, AC-d2, AC-d3).
      const [conversation] = await admin<{ host: string | null }[]>`select host from platform.ctx where code = ${ctx}`
      const assistant = { worker: WORKER, ...(conversation?.host ? { host: conversation.host } : {}) }
      const proof = (cell: { comment?: string; link?: string }) => ({
        origin: "agent",
        by: m.id,
        ctx,
        at: expect.any(String),
        ...assistant,
        ...(cell.comment === undefined ? {} : { comment: cell.comment }),
        ...(cell.link === undefined ? {} : { link: cell.link }),
      })
      // La provenance par colonne dans le bloc `row` (H94), relue à la clé secrète.
      const cells = (provenance: unknown) => {
        const stored = isJsonObject(provenance) ? provenance : {}
        return { contact: stored.contact, email: stored.email, montant_estime: stored.montant_estime }
      }
      expect((await rowsOf(claimed)).map((row) => [row.key, cells(row.provenance)])).toEqual(
        rows.map((row) => [
          row.key,
          {
            contact: proof(row.set.contact),
            email: row.set.email ? proof(row.set.email) : { origin: "verified_empty", by: m.id, ctx, at: expect.any(String), ...assistant, reason: noEmail },
            montant_estime: proof(row.set.montant_estime),
          },
        ]),
      )

      // AC9 : rendues « à revoir », sans bail ; la file de revue compte six lignes.
      const released: Called[] = []
      for (const key of claimed) released.push(await call("table.release", { table: TABLE, key, worker: WORKER, state: "à revoir" }))
      expect(released.map((one) => [one.isError, resultOf(one).state])).toEqual(claimed.map(() => [false, "à revoir"]))
      const queue = await call("table.rows", { table: TABLE, filter: { statut: "à revoir" } })
      const toReview = records(queue, "result", "rows")
      expect([resultOf(queue).total, toReview.map((row) => row.key)]).toEqual([6, ["P-001", "P-002", "P-003", "P-004", "P-006", "P-009"]])
      expect(toReview.filter((row) => "claim" in row)).toEqual([])
      expect((await rowsOf(claimed)).map((row) => [row.claimed_by, row.claimed_by_user, row.lease_until])).toEqual(claimed.map(() => [null, null, null]))
      // AC8 : aucune cellule ne vaut `null` à la lecture ; `verified_empty` garde sa raison.
      expect(nulls(toReview)).toEqual([])
      expect(toReview.find((row) => row.key === "P-002")?.verified_empty).toEqual([{ column: "email", reason: noEmail }])

      // AC10 : A décide dans la revue par l'API du paquet, à la révision lue par `table.rows`.
      const reviewAgent = `pilot-review-${hex(4)}`
      const review = async (key: string, decision: "approve" | "reject", reason?: string) => {
        const revision = toReview.find((row) => row.key === key)?.revision
        const tasks: (() => Promise<void>)[] = []
        const response = await handlePlateforme(
          new Request(`https://${org.host}/api/platform/tables/review`, {
            method: "POST",
            body: JSON.stringify({ table: TABLE, key, revision, decision, ...(reason ? { reason } : {}) }),
            headers: { origin: `https://${org.host}`, "x-forwarded-proto": "https", "user-agent": reviewAgent, "content-type": "application/json" },
          }),
          { accessToken: a.token, host: org.host, verifyToken: fx.verifyToken, defer: (task) => tasks.push(task) },
        )
        for (const task of tasks) await task()
        return { status: response.status, body: await response.json(), revision: typeof revision === "number" ? revision : 0 }
      }
      const reason = "Aucun email : fiche à compléter avant tout contact."
      const approved = await review("P-001", "approve")
      const rejected = await review("P-002", "reject", reason)
      expect([approved.status, approved.body]).toEqual([200, { data: { outcome: "decided", key: "P-001", state: "qualifié", revision: approved.revision + 1 } }])
      expect([rejected.status, rejected.body]).toEqual([200, { data: { outcome: "decided", key: "P-002", state: "écarté", revision: rejected.revision + 1 } }])
      const decided = await rowsOf(["P-001", "P-002"])
      expect(decided.map((row) => [row.key, isJsonObject(row.data) ? row.data.statut : null, isJsonObject(row.provenance) ? row.provenance.statut : null])).toEqual([
        ["P-001", "qualifié", { origin: "human", by: a.id, ctx: null, at: expect.any(String) }],
        ["P-002", "écarté", { origin: "human", by: a.id, ctx: null, at: expect.any(String), comment: reason }],
      ])
      const apiLines = await admin`select method, tool, target, user_id, is_error from platform.journal where org_id = ${org.id} and user_agent = ${reviewAgent}`
      expect(apiLines).toEqual([0, 1].map(() => ({ method: "api", tool: "POST tables/review", target: TABLE, user_id: a.id, is_error: false })))

      // AC11 : la ligne approuvée, seule « qualifié », avec ses valeurs et leur provenance (forme de H93).
      const final = await call("table.rows", { table: TABLE, filter: { statut: "qualifié" }, provenance: true })
      const qualified = records(final, "result", "rows")
      expect(qualified.map((row) => row.key)).toEqual(["P-001"])
      const [row] = qualified
      expect(tableRowReadSchema.safeParse(row).success).toBe(true)
      expect(row).toMatchObject({
        set: { contact: "Marion Vasseur, gérante", email: "marion.vasseur@tilleuls-valbrune.test", montant_estime: 1500, statut: "qualifié" },
        provenance: {
          contact: { origin: "agent", by: m.name, comment: source },
          email: { origin: "agent", by: m.name, link: "https://www.tilleuls-valbrune.test/contact" },
          montant_estime: { origin: "agent", by: m.name },
          statut: { origin: "human", by: a.name },
        },
      })

      // AC12 : tous les appels de M portent le même `ctx`, cibles : la procédure servie, la fonction de chaque `call` ;
      // chaque refus d'un appel est au journal avec `is_error` (une ligne refusée dans un `table.write` répondu reste
      // dans le résultat, E07-S02).
      await session.flush()
      const lines = await admin<{ ctx: string | null; tool: string | null; target: string | null; is_error: boolean; error: string | null }[]>`
        select ctx, tool, target, is_error, error from platform.journal where org_id = ${org.id} and user_agent = ${agent} order by id`
      const tool = (name: string | null) => (name ?? "").replace(`${prefix}_`, "")
      expect(lines.map((line) => [line.ctx, tool(line.tool), line.target, line.is_error])).toEqual(
        [
          ["context", PATH, false],
          ["call", "table.schema", false],
          ["call", "table.claim", false],
          ["call", "table.write", nullWrite.isError],
          ["call", "table.write", false],
          ["call", "table.release", true],
          ["call", "table.release", true],
          ["find", QUERY, false],
          ["call", "table.write", false],
          ["call", "table.release", false],
          ["call", "table.release", false],
          ["call", "table.release", false],
          ["call", "table.rows", false],
          ["call", "table.rows", false],
        ].map((expected) => [ctx, ...expected]),
      )
      expect(lines.filter((line) => line.is_error).map((line) => line.error?.split(":")[0])).toEqual(
        [nullWrite, toWorking, toDecision].filter((one) => one.isError).map(() => "invalid_arguments"),
      )
    })

    it("should list the procedure as the prompt qualifier_prospects, whose message makes context serve it (AC13)", async () => {
      const session = await connect(m, `pilot-prompt-${hex(3)}`)
      const { prompts } = await session.client.listPrompts()
      expect(prompts).toEqual([{ name: "qualifier_prospects", title: PILOT_PROCEDURE.title, description: PILOT_PROCEDURE.summary }])
      const { messages } = await session.client.getPrompt({ name: "qualifier_prospects" })
      const message = messages[0]?.content.type === "text" ? messages[0].content.text : ""
      expect(message).toBe(PILOT_PROCEDURE.title)
      const served = await session.openContext(message)
      expect(isJsonObject(served.result.structuredContent) ? served.result.structuredContent.served : null).toMatchObject({ path: PATH })
    })

    it("should give S, of Support only, no result of ventes/ for the same search, which the base does not let S read either (AC15)", async () => {
      const session = await connect(s, `pilot-support-${hex(3)}`)
      const { code } = await session.openContext(`Cherche ${QUERY}`)
      const found = await session.call("find", { ctx: code, query: QUERY })
      const paths = records(found, "matches").map((match) => String(match.path))
      expect({ isError: found.isError, ventes: paths.filter((path) => path.startsWith("ventes/")), cited: found.text.includes("ventes/") }).toEqual({
        isError: false,
        ventes: [],
        cited: false,
      })
      // Le filtre vient du service (H123) ; depuis `20261021130000`, la base exige aussi le niveau de lecture : S ne lit
      // pas ces blocs.
      const readable = await asCaller(s.id, s.email).tx(
        (sql) => sql`select id from platform.blocks where node_id in ${sql([ids.notes, ids.table])} and state = 'published'`,
      )
      expect(readable).toEqual([])
    })
  },
)
