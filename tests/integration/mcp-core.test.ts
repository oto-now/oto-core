// @vitest-environment node
// Les six outils sur une vraie base (E03-S01 : AC5, AC10 à AC16, AC19 hors HTTP, AC22 ; les prompts
// d'AC24 sont remplacés par `feedback-prompts.test.ts`, E03-S05) : deux organisations et trois
// personnes jetables (membre de A, membre de A et de B, membre de B seul),
// des sessions MCP par InMemoryTransport câblées comme la route (`tests/helpers/mcp.ts`). Tout
// passe au jeton de la personne, sous RLS ; la connexion d'administration ne sert qu'à poser et relire.
// Suite portable (E11-S14) : personnes sans compte, jetons signés localement
// (`tests/helpers/session-locale.ts`) ; relectures par la connexion d'administration.
// La porte HTTP (E03-S01 : AC9, AC18, AC19) : vraie chaîne mcp-handler, jetons vérifiés par `verifyToken` ; `defer`
// collecte les tâches, lancées une fois la réponse lue en entier. L'adresse sans organisation (AC4) et le jeton
// forgé (AC2) sont prouvés sans base (`tests/unit/mcp-handler.test.ts`) ; un vrai jeton de Supabase Auth vérifié
// par la JWKS du projet, sur le projet seul, par le dernier describe de ce fichier (HN-E11S14-4).
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { connectMcp } from "../helpers/mcp"
import { createFixtures, hex, type Fixtures, type TestOrg } from "../helpers/plateforme"
import { createLocalFixtures, type LocalFixtures } from "../helpers/session-locale"
import { onProject, portable, projectConfigured, sqlConfigured, testAdminSql, type TestSql } from "../helpers/sql"
import pkg from "../../packages/plateforme/package.json"
import { makeVerifyToken } from "../../packages/plateforme/mcp/auth"
import { handleMcpPost } from "../../packages/plateforme/mcp/handler"
import { buildTools } from "../../packages/plateforme/mcp/tools"
import { callExamples, catalogFunctions } from "../../packages/plateforme/server/catalog/registry"
import { workspaceRules } from "../../packages/plateforme/server/context/blocks/code"
import { orgAddress } from "../../packages/plateforme/server/context/blocks/org"
import { MAX_LOGGED_ARGS_CHARS, writeJournal } from "../../packages/plateforme/server/journal"

const NETWORK_TIMEOUT = 60_000
const CROCKFORD = /^ctx: ([0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4})\n/
const DOMAINS = "sales, customer support, energy consulting"

type Person = { id: string; email: string; accessToken: string }
type Place = TestOrg & { host: string }

/** Des arguments valides pour chacun des cinq outils autres que `context`. */
const VALID_ARGS: Record<string, Record<string, unknown>> = {
  find: { query: "relance devis" },
  read: { path: "ventes/relance_devis" },
  call: { function: "table.rows" },
  write: { path: "conseil/cr_client_2026_09" },
  feedback: { type: "gap", text: "Il manque une fonction d'export." },
}

type JournalRow = {
  org_id: string | null
  user_id: string | null
  method: string
  tool: string | null
  ctx: string | null
  target: string | null
  args: unknown
  args_chars: number | null
  result_chars: number | null
  is_error: boolean
  error: string | null
  duration_ms: number | null
  user_agent: string | null
}

const SUITE = "MCP six tools on a real database"
const PROTOCOL = "2025-06-18"

type Task = () => Promise<void>
type RpcMessage = {
  result?: { tools?: { name: string }[]; content?: { type: string; text: string }[]; [field: string]: unknown }
  error?: { code: number; message: string }
}

const initialize = (clientInfo?: { name: string; version: string }) => ({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: PROTOCOL, capabilities: {}, ...(clientInfo ? { clientInfo } : {}) },
})

describe.skipIf(!sqlConfigured)(
  portable(SUITE),
  { timeout: NETWORK_TIMEOUT },
  () => {
    let fx: LocalFixtures
    let admin: TestSql
    let orgA: Place
    let orgB: Place
    // Rempli par `beforeAll`, qui précède chaque test : les trois personnes y sont toujours.
    const people = {} as Record<"claire" | "jb" | "outsider", Person>

    async function person(profile?: { name: string }): Promise<Person> {
      const user = await fx.createUser(profile ? { fullName: profile.name } : {})
      const { accessToken } = await fx.sessionFor(user)
      return { id: user.id, email: user.email, accessToken }
    }

    async function place(settings?: { domains: string }): Promise<Place> {
      const host = `t${hex(4)}.example.invalid`
      return { ...(await fx.createOrg({ hosts: [host], settings })), host }
    }

    async function rulesVersion(orgId: string): Promise<number> {
      const [row] = await admin<{ rules_version: number }[]>`select rules_version from platform.orgs where id = ${orgId}`
      return row.rules_version
    }

    /** Le journal d'une session, par son agent : les colonnes demandées, dans l'ordre d'écriture. */
    const journalOf = (userAgent: string) =>
      admin<JournalRow[]>`
        select org_id, user_id, method, tool, ctx, target, args, args_chars, result_chars, is_error, error, duration_ms, user_agent
        from platform.journal where org_id = ${orgA.id} and user_agent = ${userAgent} order by id`

    beforeAll(async () => {
      fx = createLocalFixtures()
      admin = testAdminSql()
      orgA = await place({ domains: DOMAINS })
      orgB = await place()
      people.claire = await person()
      people.jb = await person()
      people.outsider = await person()
      await fx.createTeam(orgA.id, { slug: "ventes", name: "Ventes", leadUserId: people.claire.id })
      const conseil = await fx.createTeam(orgA.id, { slug: "conseil", name: "Conseil", leadUserId: people.jb.id })
      await fx.addMember(orgA.id, people.claire.id, {
        profile: { name: "Claire Morel", handle: "claire", language: "français" },
      })
      await fx.addMember(orgA.id, people.jb.id, { role: "admin", profile: { name: "Jean-Baptiste" } })
      await fx.addMember(orgB.id, people.jb.id)
      await fx.addMember(orgB.id, people.outsider.id)
      // Un responsable est de son équipe par `teams.lead_user_id` (P17) : seule Claire dans Conseil
      // demande une ligne `team_members` (celle du responsable peut naître d'un déclencheur, E01-S04).
      await fx.addTeamMember(conseil.id, people.claire.id)
    }, 120_000)

    afterAll(async () => {
      try {
        await fx?.cleanup()
      } finally {
        await admin?.end({ timeout: 5 })
      }
    }, NETWORK_TIMEOUT)

    describe("contract through the protocol (AC6, AC9)", () => {
      it("should serve six tools prefixed by the organisation of the address, tools and prompts, one-sentence instructions", async () => {
        const session = await connectMcp(orgA, people.claire)
        const { tools } = await session.client.listTools()
        expect(tools.map((tool) => tool.name)).toEqual(
          ["context", "find", "read", "call", "write", "feedback"].map((key) => `${orgA.prefix}_${key}`),
        )
        expect(tools[0]).toMatchObject({
          title: `${orgA.name}: Load work context`,
          annotations: { readOnlyHint: true, openWorldHint: false },
          _meta: { securitySchemes: [{ type: "oauth2" }] },
        })
        expect(tools[0].description?.startsWith(`Loads your work context at ${orgA.name} (${DOMAINS})`)).toBe(true)
        expect(session.client.getServerVersion()).toMatchObject({ name: "oto-platform", title: orgA.name })
        expect(session.client.getServerCapabilities()).toMatchObject({ tools: {}, prompts: {} })
        expect(session.client.getInstructions()).toContain(`${orgA.prefix}_context first`)
      })
    })

    describe("context (AC10, AC22)", () => {
      // E05-S12 (D109, AC-1, AC-9) : le code et les règles de l'espace, puis une partie par Contexte, ouverte par sa
      // ligne de faits ; l'organisation du test n'a aucun Contexte publié : chaque partie se réduit à sa tête.
      it("should issue a ctx and render the code, the rules, then each Contexte part opened by its facts", async () => {
        const session = await connectMcp(orgA, people.claire, `ctx-${hex(3)}`)
        const opened = await session.openContext("Relance les devis en attente")

        expect(opened.isError).toBe(false)
        expect(opened.text).toMatch(CROCKFORD)
        // L'adresse d'Oto, l'origine de la requête, en première règle (2026-10-27) : l'assistant y compose le lien d'une page.
        const origin = /\n- This Oto is at (https?:\/\/t[0-9a-f]+\.example\.invalid)\. /.exec(opened.text)?.[1]
        expect(origin).toBeDefined()
        const opening = [
          `ctx: ${opened.code}`,
          `Pass this ctx to every ${orgA.prefix}_ tool. If a result starts with "context has changed", it gives a new ctx and the changed contexts: read them and use the new ctx from then on; the call itself ran, do not repeat it.`,
          workspaceRules(orgA.prefix, orgAddress(origin)),
          "## This request",
          `Request « Relance les devis en attente »: no procedure matches. Say so instead of guessing; ${orgA.prefix}_find can search pages, tables and functions.`,
          "",
          "## Context: everyone (contexte)",
          // E05-S13 (AC-2) : les domaines restent dans la description de l'outil (ci-dessus), plus dans la ligne de faits.
          `Organisation: ${orgA.name}.`,
          "",
          "## Context: you only (private/claire/contexte)",
          // E05-S11 (AC-37) : « français » enregistré n'est ni `fr` ni `en` ; l'organisation n'a pas de langue.
          // E05-S13 (fiche D128) : les équipes par nom, plus d'équipe par défaut.
          `You: Claire Morel (claire), member of ${orgA.name}. Teams: Conseil, Ventes (lead). Reply in French unless the user writes in another language.`,
          "",
          "## Context: team Conseil (conseil/contexte)",
          "Team Conseil. Lead: Jean-Baptiste.",
          "",
          "## Context: team Ventes (ventes/contexte)",
          "Team Ventes. Lead: Claire Morel.",
        ].join("\n")
        // E03-S08 : l'organisation du test n'a ni Contexte publié, ni procédure, ni document : aucun contenu récent ni
        // nouveauté ; depuis le 2026-10-27, ni procédures utiles, ni l'adresse en fin de texte.
        expect(opened.text).toBe(opening)
        expect(opened.text.length).toBeLessThanOrEqual(20_000)
        expect(opened.result.structuredContent).toEqual({
          ctx: opened.code,
          text: opened.text,
          next_actions: [],
          served: null,
          candidates: [],
          data_question: false,
        })

        const [row] = await admin`select org_id, user_id, rules_version, host, user_agent from platform.ctx where code = ${opened.code}`
        expect(row).toEqual({
          org_id: orgA.id,
          user_id: people.claire.id,
          rules_version: await rulesVersion(orgA.id),
          host: null,
          user_agent: session.deps.userAgent,
        })
      })

      it("should render an administrator without handle nor default team, and ask for the request when none is given", async () => {
        const session = await connectMcp(orgA, people.jb)
        const opened = await session.openContext()
        expect(opened.text.split("\n\n")[0].split("\n").at(-1)).toBe(
          `No request given: call ${orgA.prefix}_context again with the user's request as phrase to get the matching procedure.`,
        )
        // Un Privé sans `handle` : sa partie sans chemin (E05-S12, AC-3).
        expect(opened.text).toContain(
          `\n\n## Context: you only\nYou: Jean-Baptiste, administrator of ${orgA.name}. Teams: Conseil (lead). Reply in French unless the user writes in another language.\n\n`,
        )
        expect(opened.text).toContain("\n\n## Context: team Conseil (conseil/contexte)\nTeam Conseil. Lead: Jean-Baptiste.")
      })

      it("should serve no team part to a member without team, « Teams: none. » saying so", async () => {
        const session = await connectMcp(orgB, people.outsider)
        const { text } = await session.openContext("bonjour")
        expect(text).toContain(
          `\n\n## Context: everyone (contexte)\nOrganisation: ${orgB.name}.\n\n## Context: you only\nYou: `,
        )
        // Le Privé finit le texte : ni nouveauté, ni contenu récent (2026-10-27, plus de « What's new » à part).
        expect(text.endsWith(`, member of ${orgB.name}. Teams: none. Reply in French unless the user writes in another language.`)).toBe(true)
        expect(text).not.toContain("## Context: team")
      })
    })

    describe("ctx guard (AC11, AC12)", () => {
      it("should refuse a missing, unknown, foreign, other-organisation or oversized ctx", async () => {
        const claire = await connectMcp(orgA, people.claire)
        const jbOnA = await connectMcp(orgA, people.jb)
        const jbOnB = await connectMcp(orgB, people.jb)
        const foreign = (await jbOnA.openContext("x")).code
        const otherOrg = (await jbOnB.openContext("x")).code
        const missing = `Missing or unknown ctx. Call ${orgA.prefix}_context first and pass its ctx code.`

        for (const tool of Object.keys(VALID_ARGS)) {
          const refused = await claire.call(tool, VALID_ARGS[tool])
          expect(refused.isError, tool).toBe(true)
          expect(refused.text, tool).toBe(missing)
        }
        for (const ctx of ["ZZZZ-ZZZZ", "X".repeat(100_000)]) {
          expect((await claire.call("feedback", { ...VALID_ARGS.feedback, ctx })).text).toBe(missing)
        }
        expect((await claire.call("feedback", { ...VALID_ARGS.feedback, ctx: foreign })).text).toBe(missing)
        expect((await jbOnA.call("feedback", { ...VALID_ARGS.feedback, ctx: otherOrg })).text).toBe(missing)
      })

      // E11-S03 : le code périme par les Contextes qu'il a servis (`tests/integration/server-ctx.test.ts`), plus par
      // `rules_version` ; un code sans Contextes gardés (émis avant la 1.1.0) est périmé, `feedback` le prend quand même.
      it("should refuse a ctx issued before 1.1.0 but let feedback through, then accept a fresh one", async () => {
        const session = await connectMcp(orgA, people.claire)
        const { code } = await session.openContext("Relance les devis en attente")
        expect((await session.call("find", { ...VALID_ARGS.find, ctx: code })).isError).toBe(false)

        await admin`update platform.orgs set rules_version = ${(await rulesVersion(orgA.id)) + 1} where id = ${orgA.id}`
        expect((await session.call("find", { ...VALID_ARGS.find, ctx: code })).isError).toBe(false)

        await admin`update platform.ctx set contexts = null where code = ${code}`
        const stale = await session.call("find", { ...VALID_ARGS.find, ctx: code })
        expect(stale.isError).toBe(true)
        expect(stale.text).toBe(`context has changed: call ${orgA.prefix}_context again with the same request, then retry this call.`)
        expect((await session.call("feedback", { ...VALID_ARGS.feedback, ctx: code })).isError).toBe(false)

        const fresh = await session.openContext("Relance les devis en attente")
        expect((await session.call("find", { ...VALID_ARGS.find, ctx: fresh.code })).isError).toBe(false)
      })
    })

    // Les six outils sont livrés (E03-S03, E03-S04) : plus aucun ne répond `unavailable_in_v1` (AC13).
    describe("invalid arguments (AC14)", () => {
      it("should list each invalid field as path: message", async () => {
        const session = await connectMcp(orgA, people.claire)
        const { code } = await session.openContext("x")
        const find = await session.call("find", { ctx: code })
        expect(find.isError).toBe(true)
        expect(find.text.startsWith(`Invalid arguments for ${orgA.prefix}_find: query: `)).toBe(true)
        const feedback = await session.call("feedback", { ctx: code, type: "bogus", text: "x" })
        expect(feedback.text.startsWith(`Invalid arguments for ${orgA.prefix}_feedback: type: `)).toBe(true)
        expect(session.journal.at(-1)?.error?.startsWith("invalid_arguments: Invalid arguments for")).toBe(true)
      })
    })

    describe("journal (AC16)", () => {
      it("should keep one line per request, in order, and write them under the person's token", async () => {
        const userAgent = `journal-test-${hex(4)}`
        const session = await connectMcp(orgA, people.claire, userAgent)
        await session.client.listTools()
        const { code } = await session.openContext("Relance les devis en attente")
        await session.call("feedback", { ...VALID_ARGS.feedback, ctx: code, api_key: "k-123" })
        await session.call("feedback")
        await session.flush()

        const rows = await journalOf(userAgent)
        const feedbackTool = `${orgA.prefix}_feedback`
        expect(rows?.map((row) => [row.method, row.tool, row.ctx, row.is_error, row.error])).toEqual([
          ["tools/list", null, null, false, null],
          ["tools/call", `${orgA.prefix}_context`, code, false, null],
          // Une clé inconnue est refusée (`parseInput`) : la ligne est journalisée, sa valeur masquée (plus bas).
          ["tools/call", feedbackTool, code, true, `invalid_arguments: Invalid arguments for ${feedbackTool}: unknown key « api_key »; keys: ctx, type, text, target`],
          ["tools/call", feedbackTool, null, true, `ctx_missing: Missing or unknown ctx. Call ${orgA.prefix}_context first and pass its ctx code.`],
        ])
        for (const row of rows ?? []) {
          expect(row).toMatchObject({ org_id: orgA.id, user_id: people.claire.id, user_agent: userAgent })
          expect(row.duration_ms).toBeGreaterThanOrEqual(0)
          expect(row.args_chars).toBeGreaterThanOrEqual(2)
          expect(row.result_chars).toBeGreaterThan(0)
        }
        // Sans connecteur actif, `call` cite les fonctions natives toujours actives (`table.rows`, E07-S01).
        expect(rows?.[0].result_chars).toBe(JSON.stringify(buildTools(session.deps.org, callExamples(catalogFunctions(), new Set()))).length)
        expect(rows?.[1].target).toBe("Relance les devis en attente")
        expect(rows?.[2].args).toMatchObject({ ctx: code, api_key: "[masked]", type: "gap" })
      })

      // Revue du cycle 1 : une moitié de paire de substitution seule, laissée par une coupe dans un
      // emoji ou envoyée par le host, faisait refuser tout le lot par PostgREST (400 PGRST102).
      it("should write the whole batch when a cut falls inside an emoji or the host sends half a pair (N31)", async () => {
        const userAgent = `emoji-test-${hex(4)}`
        const session = await connectMcp(orgA, people.claire, userAgent)
        const { code } = await session.openContext(`${"x".repeat(199)}😀 et la suite`)
        const opening = JSON.stringify({ ctx: code, type: "gap", text: "" }).length - 2
        const text = `${"y".repeat(MAX_LOGGED_ARGS_CHARS - 1 - opening)}😀${"z".repeat(100)}`
        await session.call("feedback", { ctx: code, type: "gap", text })
        await session.call("feedback", { ctx: code, type: "gap", text: "ok", note: "a\ud83d" })
        await session.callNamed(`${orgA.prefix}_\ud83d`)
        await session.flush()

        const rows = await journalOf(userAgent)
        expect(rows).toHaveLength(4)
        expect(rows?.[0].target).toBe("x".repeat(199))
        expect(rows?.[1].args).toEqual({
          _truncated: true,
          head: JSON.stringify({ ctx: code, type: "gap", text }).slice(0, MAX_LOGGED_ARGS_CHARS - 1),
        })
        expect(rows?.[2].args).toMatchObject({ note: "a�" })
        expect(rows?.[3]).toMatchObject({
          tool: `${orgA.prefix}_�`,
          error: `not_found: Unknown tool ${orgA.prefix}_�. The tools of this server all start with ${orgA.prefix}_.`,
        })
      })
    })

    describe("host signature on the ctx (AC19, without HTTP)", () => {
      it("should carry the signature of the last initialize at the same user agent, then pass it on", async () => {
        const userAgent = `sig-test-${hex(4)}`
        const session = await connectMcp(orgA, people.claire, userAgent)
        await writeJournal(session.deps.db, [
          { org_id: orgA.id, user_id: people.claire.id, method: "initialize", host: "claude-ai@0.1.0", user_agent: userAgent },
        ])
        const { code } = await session.openContext("x")
        await session.call("feedback", { ...VALID_ARGS.feedback, ctx: code })
        expect(session.journal.map((line) => line.host)).toEqual(["claude-ai@0.1.0", "claude-ai@0.1.0"])
        const hostOf = async (ctx: string) => (await admin<{ host: string | null }[]>`select host from platform.ctx where code = ${ctx}`)[0]?.host
        expect(await hostOf(code)).toBe("claude-ai@0.1.0")

        const other = await connectMcp(orgA, people.claire, `${userAgent}-other`)
        const opened = await other.openContext("x")
        expect(other.journal[0].host).toBeNull()
        expect(await hostOf(opened.code)).toBeNull()
      })
    })

    describe("a person who is not a member (AC5)", () => {
      it("should serve the list, refuse every call by name, list no prompt and journal nothing", async () => {
        const session = await connectMcp(orgA, people.outsider)
        expect(session.kind).toBe("not_member")
        const { tools } = await session.client.listTools()
        expect(tools.map((tool) => tool.name)).toHaveLength(6)
        expect(tools[0].name).toBe(`${orgA.prefix}_context`)

        const refusal = `You are signed in as ${people.outsider.email} but you are not a member of ${orgA.name}. Ask an administrator of ${orgA.name} to add you.`
        for (const tool of ["context", "find", "feedback"]) {
          const refused = await session.call(tool, { ctx: "AAAA-BBBB" })
          expect(refused.isError, tool).toBe(true)
          expect(refused.text, tool).toBe(refusal)
        }
        expect(await session.client.listPrompts()).toEqual({ prompts: [] })
        expect(session.journal).toEqual([])
      })
    })

    // La porte HTTP, sur l'adresse de A, sous le jeton de Claire.
    describe("HTTP door (AC9, AC18, AC19)", () => {
      type PostOptions = { userAgent: string; accept?: string }

      /** `POST /api/mcp` sur l'adresse de A ; rend le premier message et les tâches. */
      async function post(body: unknown, { userAgent, accept = "application/json, text/event-stream" }: PostOptions) {
        const request = new Request("http://localhost:3000/api/mcp", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept,
            authorization: `Bearer ${people.claire.accessToken}`,
            "user-agent": userAgent,
            "x-forwarded-host": orgA.host,
            "x-forwarded-proto": "https",
            "mcp-protocol-version": PROTOCOL,
          },
          body: JSON.stringify(body),
        })
        const tasks: Task[] = []
        const response = await handleMcpPost(request, { verifyToken: fx.verifyToken, defer: (task) => tasks.push(task) })
        // Le corps lu en entier : les outils ont fini d'écrire leurs lignes avant la fin du flux.
        const text = await response.text()
        const data = text.split("\n").find((line) => line.startsWith("data: "))
        const message: RpcMessage | null = text ? JSON.parse(data ? data.slice("data: ".length) : text) : null
        return { response, message, tasks }
      }

      const journal = (userAgent: string) =>
        admin`select method, tool, ctx, host, user_agent, is_error from platform.journal where org_id = ${orgA.id} and user_agent = ${userAgent} order by id`

      it("should initialize with the server identity and journal the client signature after the response (AC9, AC18)", async () => {
        const userAgent = `http-init-${hex(4)}`
        const { response, message, tasks } = await post(initialize({ name: "claude-ai", version: "0.1.0" }), { userAgent })
        expect(response.status).toBe(200)
        expect(message?.result).toMatchObject({
          serverInfo: { name: "oto-platform", title: orgA.name, version: pkg.version },
          capabilities: { tools: {}, prompts: {} },
          instructions: expect.stringContaining(`${orgA.prefix}_context first`),
        })
        expect(await journal(userAgent)).toEqual([])

        for (const task of tasks) await task()
        expect(await journal(userAgent)).toEqual([
          { method: "initialize", tool: null, ctx: null, host: "claude-ai@0.1.0", user_agent: userAgent, is_error: false },
        ])
      })

      it("should write no initialize line for a response of 400 or more (AC18)", async () => {
        const userAgent = `http-refused-${hex(4)}`
        const { response, tasks } = await post(initialize({ name: "claude-ai", version: "0.1.0" }), { userAgent, accept: "application/json" })
        expect(response.status).toBe(406)
        for (const task of tasks) await task()
        expect(await journal(userAgent)).toEqual([])
      })

      it("should list the six tools and sign the ctx with the initialize of the same user agent (AC19)", async () => {
        const userAgent = `http-sig-${hex(4)}`
        const init = await post(initialize({ name: "claude-ai", version: "0.1.0" }), { userAgent })
        for (const task of init.tasks) await task()

        const listed = await post({ jsonrpc: "2.0", id: 2, method: "tools/list" }, { userAgent })
        const tools = listed.message?.result?.tools ?? []
        expect(tools.map((tool) => tool.name)).toEqual(
          ["context", "find", "read", "call", "write", "feedback"].map((key) => `${orgA.prefix}_${key}`),
        )

        const called = await post(
          { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: `${orgA.prefix}_context`, arguments: { phrase: "bonjour" } } },
          { userAgent },
        )
        const content = called.message?.result?.content ?? []
        const code = /^ctx: (\S+)/.exec(content[0]?.text ?? "")?.[1]
        expect(code).toBeTruthy()
        for (const task of [...listed.tasks, ...called.tasks]) await task()

        expect(await admin`select host, user_agent from platform.ctx where code = ${code ?? ""}`).toEqual([{ host: "claude-ai@0.1.0", user_agent: userAgent }])
        expect(await journal(userAgent)).toEqual([
          expect.objectContaining({ method: "initialize", host: "claude-ai@0.1.0" }),
          expect.objectContaining({ method: "tools/list" }),
          expect.objectContaining({ method: "tools/call", tool: `${orgA.prefix}_context`, ctx: code, host: "claude-ai@0.1.0" }),
        ])
      })
    })
  },
)

// La vérification d'un vrai jeton de Supabase Auth par la JWKS du projet (HN-E11S14-4) : le vérificateur de la
// configuration de l'hôte, `makeVerifyToken()` sans argument, sur le projet seul.
describe.skipIf(!projectConfigured)(onProject("MCP HTTP door under a Supabase Auth session"), { timeout: NETWORK_TIMEOUT }, () => {
  let fx: Fixtures
  let host: string
  let token: string

  beforeAll(async () => {
    fx = createFixtures()
    host = `t${hex(4)}.example.invalid`
    const org = await fx.createOrg({ hosts: [host] })
    const person = await fx.createUser()
    await fx.addMember(org.id, person.id)
    token = (await fx.sessionFor(person)).accessToken
  }, 120_000)

  afterAll(async () => {
    await fx?.cleanup()
  }, NETWORK_TIMEOUT)

  it("should initialize with 200 under a token verified by the JWKS of the project (AC2)", async () => {
    const request = new Request("http://localhost:3000/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${token}`,
        "x-forwarded-host": host,
        "x-forwarded-proto": "https",
        "mcp-protocol-version": PROTOCOL,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "claude-ai", version: "0.1.0" } } }),
    })
    // Le journal de cet appel n'est pas le sujet : prouvé par `mcp-core.test.ts`.
    const response = await handleMcpPost(request, { verifyToken: makeVerifyToken(), defer: () => {} })
    expect(response.status).toBe(200)
  })
})
