// @vitest-environment node
// `feedback` et prompts des procédures sur une vraie base (E03-S05 : AC1, AC3, AC4,
// AC8, AC12, N4, N6, N8). Organisation et personnes jetables, sessions MCP par InMemoryTransport câblées
// comme la route (`tests/helpers/mcp.ts`), procédures d'Acme semées par `seedNodes` (E03-S02). Tout
// passe au jeton de la personne ; la clé secrète ne sert qu'à poser, vieillir et relire.
// Prouvés sans base ou par un autre fichier, leurs cas sont retirés (M11b) : AC2 (numéros par
// organisation : `contenu-rls.test.ts`, `tests/unit/feedback.test.ts`), AC5 et AC6 (arguments et ctx
// refusés : `tests/unit/mcp-server.test.ts`, `server-ctx.test.ts`, `mcp-core.test.ts`), AC7 (contrat :
// `mcp-tools.test.ts`, `feedback.test.ts`), AC8 à AC11 hors de la liste de jb (niveau, borne de 20,
// noms, prompt servi, refus, journal : `tests/unit/prompts.test.ts`, `mcp-server.test.ts`).
// Suite portable (E11-S14) : personnes sans compte, jetons signés localement
// (`tests/helpers/session-locale.ts`) ; relectures et mise en place par la connexion d'administration,
// le routage par la face SQL.
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { connectMcp } from "../helpers/mcp"
import { hex, type SeedNode, type TestOrg } from "../helpers/plateforme"
import { createLocalFixtures, type LocalFixtures } from "../helpers/session-locale"
import { portable, sqlConfigured, testAdminSql, type TestSql } from "../helpers/sql"
import type { BlockInput } from "../../packages/plateforme/schemas"

const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 240_000

type Person = { id: string; email: string; accessToken: string }
type Place = TestOrg & { host: string }

/** Titres de la maquette et résumés semés d'E03-S02 (P37 : le résumé dit comment on la demande). */
const ACME = {
  preparer_rdv: {
    path: "conseil/preparer_rdv",
    team: "conseil",
    title: "Préparer un rendez-vous client",
    summary:
      "Rassemble devis, historique et points d'attention avant un rendez-vous, en une fiche d'une page. Se demande : « prépare mon rendez-vous avec le client », « brief avant ma réunion client ».",
  },
  reponse_ticket: {
    path: "support/reponse_ticket",
    team: "support",
    title: "Répondre à un ticket client",
    summary:
      "Prépare une réponse à un client à partir de la FAQ support, en brouillon, envoyée seulement après accord. Se demande : « réponds à ce client », « traite ce ticket ».",
  },
  relance_devis: {
    path: "ventes/relance_devis",
    team: "ventes",
    title: "Relancer les devis en attente",
    summary:
      "Relance par email les devis envoyés sans réponse depuis 7 jours ou plus, après accord de la personne. Se demande : « relance les devis en attente », « qui n'a pas répondu à nos devis ».",
  },
  relance_prospects: {
    path: "ventes/relance_prospects",
    team: "ventes",
    title: "Relancer les prospects à traiter",
    summary:
      "Prend les prospects « à traiter » de la file, prépare un email de relance pour chacun, puis les marque « relancé ». Se demande : « relance les prospects », « relance les leads ».",
  },
} as const

const steps = (step: string): BlockInput[] => [
  { type: "heading", text: "Étapes", data: { level: 1 } },
  { type: "list", data: { items: [step], ordered: true } },
]

// 21/10 : rien que l'assistant répéterait à la personne, ni numéro ni « l'équipe a été prévenue » ; le numéro reste au journal.
const RECORDED = "Recorded for the platform maintainers; nothing to tell the user."
const duplicateText = (minutes: number) =>
  `Already recorded ${minutes} minute(s) ago with the same text, for the platform maintainers; nothing new was recorded and nothing to tell the user. If the problem happened again, record what changed: another call, another argument or another moment.`

/** Le numéro du dernier appel de la session, lu au journal (`target`) : l'assistant ne le reçoit plus. */
function ticketOf(session: { journal: readonly { target?: string | null }[] }): unknown {
  return session.journal.at(-1)?.target
}

type Ticket = { id: string; org_id: string; user_id: string | null; ctx: string | null; type: string; target: string | null; text: string; state: string; number: number }

const SUITE = "feedback and prompts of the procedures"

describe.skipIf(!sqlConfigured)(
  portable(SUITE),
  { timeout: NETWORK_TIMEOUT },
  () => {
    let fx: LocalFixtures
    let admin: TestSql
    let acme: Place
    // Rempli par `beforeAll`, qui précède chaque test.
    const people = {} as Record<"jb" | "claire", Person>

    async function person(name: string): Promise<Person> {
      const user = await fx.createUser({ fullName: name })
      const { accessToken } = await fx.sessionFor(user)
      return { id: user.id, email: user.email, accessToken }
    }

    async function place(name?: string): Promise<Place> {
      const host = `t${hex(4)}.example.invalid`
      return { ...(await fx.createOrg({ hosts: [host], name })), host }
    }

    /** Les tickets de l'organisation, relus par la connexion d'administration, du plus ancien au plus récent. */
    function tickets(orgId: string, filter: { text?: string; ctx?: string } = {}) {
      return admin<Ticket[]>`
        select id, org_id, user_id, ctx, type, target, text, state, number from platform.feedback
        where org_id = ${orgId}
          ${filter.text === undefined ? admin`` : admin`and text = ${filter.text}`}
          ${filter.ctx === undefined ? admin`` : admin`and ctx = ${filter.ctx}`}
        order by id`
    }

    async function age(ticketId: string, minutes: number): Promise<void> {
      await admin`update platform.feedback set created_at = ${new Date(Date.now() - minutes * 60_000)} where id = ${ticketId}`
    }

    /** Session de `who` sur `where`, et un `ctx` frais. */
    async function withCtx(where: Place, who: Person, userAgent = "vitest") {
      const session = await connectMcp(where, who, userAgent)
      const { code } = await session.openContext("Cette procédure manque une étape, signale-le.")
      return { session, code }
    }

    beforeAll(async () => {
      fx = createLocalFixtures()
      admin = testAdminSql()
      acme = await place("Acme Test")
      // L'arbre d'abord : dossiers d'équipe et Contextes naissent avec les équipes (P39).
      await fx.createTree(acme.id)
      const teams = {
        ventes: (await fx.createTeam(acme.id, { slug: "ventes", name: "Ventes" })).id,
        support: (await fx.createTeam(acme.id, { slug: "support", name: "Support" })).id,
        conseil: (await fx.createTeam(acme.id, { slug: "conseil", name: "Conseil" })).id,
      }
      people.jb = await person("Jean-Baptiste")
      people.claire = await person("Claire Morel")
      await fx.addMember(acme.id, people.jb.id)
      // Administratrice : elle lit tous les tickets d'Acme (`feedback_select_own_admin`), donc seul le
      // filtre d'auteur du service sépare son signalement de celui de jb (AC4).
      await fx.addMember(acme.id, people.claire.id, { role: "admin" })
      for (const team of Object.values(teams)) await fx.addTeamMember(team, people.jb.id)
      await fx.addTeamMember(teams.ventes, people.claire.id)
      const procedures: SeedNode[] = Object.values(ACME).map(({ path, team, title, summary }) => ({
        path,
        kind: "procedure",
        title,
        summary,
        ownerTeamId: teams[team],
        blocks: steps(`Suivre : ${title}.`),
      }))
      await fx.seedNodes(acme.id, [
        ...procedures,
        { path: "ventes/brouillon", kind: "procedure", title: "Relancer en brouillon", summary: "Jamais publiée.", ownerTeamId: teams.ventes, published: false },
        {
          path: "conseil/grille_tarifaire_2026",
          kind: "page",
          title: "Grille tarifaire 2026",
          summary: "Tarifs 2026 des études et de l'accompagnement, en euros HT.",
          ownerTeamId: teams.conseil,
        },
      ])
    }, SETUP_TIMEOUT)

    afterAll(async () => {
      try {
        await fx?.cleanup()
      } finally {
        await admin?.end({ timeout: 5 })
      }
    }, SETUP_TIMEOUT)

    describe("feedback (AC1, AC3, AC4, AC12)", () => {
      it("should record a ticket numbered for the organisation, linked to the ctx, and journal its number (AC1, AC12)", async () => {
        const userAgent = `feedback-${hex(4)}`
        const { session, code } = await withCtx(acme, people.jb, userAgent)
        const args = { ctx: code, type: "gap", text: "Il manque une fonction d'export.", target: "ventes/relance_devis" }
        const answer = await session.call("feedback", args)

        const [row] = await tickets(acme.id, { ctx: code })
        const ticket = `FB-${String(row.number).padStart(4, "0")}`
        expect(answer.isError).toBe(false)
        expect(answer.text).toBe(RECORDED)
        expect(answer.result.structuredContent).toEqual({ text: RECORDED, recorded: true, type: "gap", duplicate: false, next_actions: [] })
        expect(row).toMatchObject({
          org_id: acme.id,
          user_id: people.jb.id,
          ctx: code,
          type: "gap",
          target: "ventes/relance_devis",
          text: "Il manque une fonction d'export.",
          state: "open",
        })
        expect(session.client.getServerCapabilities()?.prompts).toBeDefined()

        await session.flush()
        const lines = await admin`select method, tool, ctx, target, team_id, is_error from platform.journal where org_id = ${acme.id} and user_agent = ${userAgent} order by id`
        expect(lines.at(-1)).toEqual({ method: "tools/call", tool: `${acme.prefix}_feedback`, ctx: code, target: ticket, team_id: null, is_error: false })
      })

      it("should return the ticket filed less than 10 minutes ago with the same type, text and target, and say so (AC3)", async () => {
        const { session, code } = await withCtx(acme, people.jb)
        const text = `Le tableau ne se charge pas ${hex(3)}.`
        const first = await session.call("feedback", { ctx: code, type: "error", text, target: "table.rows" })
        const [row] = await tickets(acme.id, { text })
        const ticket = `FB-${String(row.number).padStart(4, "0")}`
        expect([first.text, ticketOf(session)]).toEqual([RECORDED, ticket])

        const again = await session.call("feedback", { ctx: code, type: "error", text: `  ${text}  `, target: " table.rows " })
        expect(again.isError).toBe(false)
        expect(again.text).toBe(duplicateText(1))
        expect(again.result.structuredContent).toEqual({ text: again.text, recorded: true, type: "error", duplicate: true, next_actions: [] })
        expect(session.journal.at(-1)).toMatchObject({ target: ticket })

        await age(row.id, 3)
        await admin`update platform.feedback set state = 'acknowledged' where id = ${row.id}`
        const later = await session.call("feedback", { ctx: code, type: "error", text, target: "table.rows" })
        expect(later.text).toBe(duplicateText(3))
        expect([later.result.structuredContent, ticketOf(session)]).toMatchObject([{ duplicate: true }, ticket])
        expect(await tickets(acme.id, { text })).toHaveLength(1)
      })

      it("should also return the ticket when neither report names a target (AC3)", async () => {
        const { session, code } = await withCtx(acme, people.jb)
        const text = `Consigne floue ${hex(3)}.`
        const first = await session.call("feedback", { ctx: code, type: "friction", text })
        const premier = ticketOf(session)
        const again = await session.call("feedback", { ctx: code, type: "friction", text })
        expect(first.result.structuredContent).toMatchObject({ duplicate: false })
        expect([again.result.structuredContent, ticketOf(session)]).toMatchObject([{ duplicate: true }, premier])
        expect(await tickets(acme.id, { text })).toHaveLength(1)
      })

      it("should file a new ticket when the text, the type or the target differs, for another person, or after 10 minutes (AC4)", async () => {
        const jb = await withCtx(acme, people.jb)
        const claire = await withCtx(acme, people.claire)
        const text = `Il manque une étape ${hex(3)}.`
        const base = { type: "friction", text, target: "ventes/relance_devis" }
        const reports = [
          [jb, base],
          [jb, { ...base, text: `${text} Encore.` }],
          [jb, { ...base, type: "gap" }],
          [jb, { ...base, target: "support/reponse_ticket" }],
          [jb, { type: base.type, text: base.text }],
          [claire, base],
        ] as const
        const answers = []
        const numbers: unknown[] = []
        for (const [who, report] of reports) {
          answers.push(await who.session.call("feedback", { ...report, ctx: who.code }))
          numbers.push(ticketOf(who.session))
        }

        const [first] = await tickets(acme.id, { text })
        await age(first.id, 11)
        answers.push(await jb.session.call("feedback", { ...base, ctx: jb.code }))
        numbers.push(ticketOf(jb.session))
        for (const answer of answers) expect(answer.result.structuredContent, answer.text).toMatchObject({ duplicate: false })
        expect(new Set(numbers).size).toBe(7)
      })

      it("should record a text carrying half a surrogate pair, the half turned into U+FFFD, and find it again (N8)", async () => {
        const { session, code } = await withCtx(acme, people.jb)
        const text = `Export cassé ${hex(3)} a\ud83d`
        const first = await session.call("feedback", { ctx: code, type: "error", text })
        const premier = ticketOf(session)
        const again = await session.call("feedback", { ctx: code, type: "error", text })
        expect(first.result.structuredContent).toMatchObject({ duplicate: false })
        expect([again.result.structuredContent, ticketOf(session)]).toMatchObject([{ duplicate: true }, premier])
        expect((await tickets(acme.id, { ctx: code })).map((row) => row.text)).toEqual([`${text.slice(0, -1)}�`])
      })

      it("should find the duplicate of a 4,000-character text that no request address could carry (N6)", async () => {
        const { session, code } = await withCtx(acme, people.jb)
        const text = `${"漢".repeat(3994)}${hex(3)}`
        const first = await session.call("feedback", { ctx: code, type: "gap", text })
        const premier = ticketOf(session)
        const again = await session.call("feedback", { ctx: code, type: "gap", text })
        expect(first.isError, first.text).toBe(false)
        expect([again.result.structuredContent, ticketOf(session)]).toMatchObject([{ duplicate: true }, premier])
        expect(await tickets(acme.id, { ctx: code })).toHaveLength(1)
      })
    })

    describe("prompts of the procedures (AC8, N4)", () => {
      const listed = (key: keyof typeof ACME) => ({ name: key, title: ACME[key].title, description: ACME[key].summary })

      it("should list the published procedures jb reads, in path order, with name, title and description only (AC8)", async () => {
        const session = await connectMcp(acme, people.jb)
        expect(session.client.getServerCapabilities()?.prompts).toBeDefined()
        const { prompts } = await session.client.listPrompts()
        expect(prompts).toEqual([listed("preparer_rdv"), listed("reponse_ticket"), listed("relance_devis"), listed("relance_prospects")])
        for (const prompt of prompts) expect(Object.keys(prompt).sort()).toEqual(["description", "name", "title"])
      })

      // Golden queries P1 et P2 sans host, pour la part que porte cette story : le message envoyé
      // (le titre) place sa procédure en tête des candidats du routage (H40, N4). La décision de
      // servir les étapes (seuil, écart) est celle d'E03-S02.
      it("should send a message that ranks its own procedure first among the routing candidates (N4)", async () => {
        const session = await connectMcp(acme, people.jb)
        const { messages } = await session.client.getPrompt({ name: "relance_devis" })
        const phrase = messages[0].content.type === "text" ? messages[0].content.text : ""
        const candidates = await session.deps.db.tx(
          (sql) => sql`select * from platform.route_candidates(p_org => ${acme.id}, p_query => ${phrase}, p_kind => 'procedure')`,
        )
        expect(candidates[0]).toMatchObject({ path: "ventes/relance_devis", s_title: 1 })
      })
    })
  },
)
