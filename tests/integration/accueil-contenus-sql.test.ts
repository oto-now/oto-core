// @vitest-environment node
// La carte « Reprendre » et les vues des pages sur une vraie base (1.4.13) : `recordNodeView` compte une
// vue par page, personne et jour, refuse une page que la personne ne lit pas et retire ce qui passe 90 jours ;
// `homeContents` filtre (Moi, Mes équipes, Toute l'organisation), ne rend que ce que la personne lit, pagine, dit par où
// le dernier changement est passé, et réunit vues à l'écran et lectures des assistants. Portable : l'organisation O d'E01-S04 par
// `buildReferenceOrg`, chaque personne par `fx.as`.
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { HOME_PAGE_SIZE } from "../../packages/plateforme/schemas"
import { HOME_OFFSET_MAX } from "../../packages/plateforme/schemas/accueil"
import { homeContents } from "../../packages/plateforme/server/home-contents"
import { resolveIdentity } from "../../packages/plateforme/server/identity"
import { recordNodeView } from "../../packages/plateforme/server/node-views"
import { createSqlFixtures, portable, sqlConfigured, type SqlFixtures, type SqlReferenceOrg } from "../helpers/sql"

const SETUP_TIMEOUT = 240_000
const NETWORK_TIMEOUT = 60_000

type Who = "ada" | "claire" | "lea" | "paul"

describe.skipIf(!sqlConfigured)(portable("the home contents and the views of pages on a real base (1.4.13)"), { timeout: NETWORK_TIMEOUT }, () => {
  let fx: SqlFixtures
  let o: SqlReferenceOrg
  let ids: Map<string, string>

  beforeAll(async () => {
    fx = createSqlFixtures()
    o = await fx.buildReferenceOrg()
    const orgId = o.org.id
    ids = await fx.seedNodes(orgId, [
      { path: "ventes/tarifs", kind: "page", title: "Tarifs", summary: "La grille." },
      { path: "ventes/salons", kind: "table", title: "Salons", summary: "Les salons." },
      { path: "ventes/cachee", kind: "page", title: "Cachée", summary: "Pas pour Léa." },
      { path: "support/faq", kind: "page", title: "FAQ", summary: "Les questions." },
      { path: "annonces", kind: "page", title: "Annonces", summary: "Pour tous." },
      { path: "private/lea/notes", kind: "page", title: "Notes", summary: "Les notes de Léa." },
    ])
    const id = (path: string) => ids.get(path) ?? ""
    const { lea, claire, paul } = o.people
    await fx.addRule({ orgId, nodeId: id("ventes/cachee"), userId: lea.id, level: "none" })
    // Les dates et les auteurs des derniers changements, du plus récent au plus ancien : notes (Léa), tarifs (Claire),
    // salons (Léa), cachée (Claire), annonces (Paul), FAQ (Paul).
    const changes: [string, string][] = [
      ["private/lea/notes", lea.id],
      ["ventes/tarifs", claire.id],
      ["ventes/salons", lea.id],
      ["ventes/cachee", claire.id],
      ["annonces", paul.id],
      ["support/faq", paul.id],
    ]
    // `updated_at` est posé par la base à chaque mise à jour (`set_updated_at`) : les changements se jouent du plus ancien au
    // plus récent.
    for (const [path, user] of [...changes].reverse()) {
      await fx.admin`update platform.nodes set updated_by = ${user} where id = ${id(path)}`
    }
    // Les tarifs changés par l'assistant de Claire, les salons à l'écran par Léa.
    const now = Date.now()
    await fx.admin`
      insert into platform.journal (ts, org_id, user_id, team_id, method, tool, target, args, is_error) values
        (${new Date(now - 2 * 3_600_000)}, ${orgId}, ${claire.id}, ${o.teams.ventes}, 'tools/call', ${`${o.org.prefix}_write`}, 'ventes/tarifs', ${fx.admin.json({ path: "ventes/tarifs" })}, false),
        (${new Date(now - 3 * 3_600_000)}, ${orgId}, ${lea.id}, ${o.teams.ventes}, 'api', 'POST nodes', 'ventes/salons', ${fx.admin.json({ path: "ventes/salons" })}, false)`
  }, SETUP_TIMEOUT)

  afterAll(async () => {
    await fx?.cleanup()
  }, SETUP_TIMEOUT)

  async function session(who: Who) {
    const person = o.people[who]
    const db = fx.as(person)
    return { db, identity: await resolveIdentity(db, o.host, { userId: person.id, email: person.email }) }
  }

  /** Les chemins semés ici, dans l'ordre rendu : l'organisation de référence porte d'autres contenus. */
  const SEMES = new Set(["ventes/tarifs", "ventes/salons", "ventes/cachee", "support/faq", "annonces", "private/lea/notes"])
  const paths = (page: { items: { path: string }[] }) => page.items.map((item) => item.path).filter((path) => SEMES.has(path))

  describe("recordNodeView", () => {
    it("should count one view per opening of a page by person and day, refuse a page she does not read, and sweep rows older than 90 days", async () => {
      const { db, identity } = await session("lea")
      const salons = ids.get("ventes/salons") ?? ""
      // Une vue d'il y a 100 jours : la prochaine vue de l'organisation la retire.
      await fx.admin`insert into platform.node_views (org_id, node_id, user_id, day) values (${o.org.id}, ${salons}, ${o.people.claire.id}, current_date - 100)`

      const vues = () => fx.admin<{ user_id: string; views: number }[]>`select user_id, views from platform.node_views where org_id = ${o.org.id} and node_id = ${salons}`
      // La page relue après un geste, dans la minute : la même ouverture.
      await recordNodeView(db, identity, { path: "ventes/salons" })
      await recordNodeView(db, identity, { path: "ventes/salons" })
      expect(await vues()).toEqual([{ user_id: o.people.lea.id, views: 1 }])
      // Rouverte plus d'une minute après la dernière : une vue de plus.
      await fx.admin`update platform.node_views set last_at = now() - interval '2 minutes' where org_id = ${o.org.id} and node_id = ${salons}`
      await recordNodeView(db, identity, { path: "ventes/salons" })
      expect(await vues()).toEqual([{ user_id: o.people.lea.id, views: 2 }])
      await expect(recordNodeView(db, identity, { path: "ventes/cachee" })).rejects.toMatchObject({ code: "not_found" })
      await expect(recordNodeView(db, identity, { path: "Pas un chemin" })).rejects.toMatchObject({ code: "invalid_arguments" })
    })
  })

  describe("homeContents, recent", () => {
    it("should filter on what she touched, what her teams own, or everything she reads, newest first, never what she cannot read", async () => {
      const { db, identity } = await session("lea")
      const recent = (scope: "me" | "teams" | "org") => homeContents(db, identity, { tab: "recent", scope })

      expect(paths(await recent("me"))).toEqual(["private/lea/notes", "ventes/salons"])
      expect(paths(await recent("teams"))).toEqual(["private/lea/notes", "ventes/tarifs", "ventes/salons"])
      // Toute l'organisation : Annonces (Tout le monde) en plus ; ni la page cachée, ni la FAQ de Support, qu'elle ne lit pas.
      expect(paths(await recent("org"))).toEqual(["private/lea/notes", "ventes/tarifs", "ventes/salons", "annonces"])
    })

    it("should say the space of each content: its owner team, Tout le monde, or a personal space", async () => {
      const { db, identity } = await session("lea")
      const page = await homeContents(db, identity, { tab: "recent", scope: "org" })
      const espace = (path: string) => page.items.find((item) => item.path === path)?.space
      expect([espace("ventes/tarifs"), espace("annonces"), espace("private/lea/notes")]).toEqual([{ kind: "team", name: "Ventes" }, { kind: "org" }, { kind: "user" }])
      expect(page.items.find((item) => item.path === "ventes/salons")).toMatchObject({ title: "Salons", kind: "table" })
    })

    it("should give a page of ten from its offset, and say whether more follow", async () => {
      const { db, identity } = await session("ada")
      const extra = Array.from({ length: HOME_PAGE_SIZE + 2 }, (_, rang) => ({ path: `ventes/lot_${rang}`, kind: "page" as const, title: `Lot ${rang}`, summary: "Une page du lot." }))
      await fx.seedNodes(o.org.id, extra)

      const premiere = await homeContents(db, identity, { tab: "recent", scope: "org" })
      const suivante = await homeContents(db, identity, { tab: "recent", scope: "org", offset: HOME_PAGE_SIZE })
      expect([premiere.items.length, premiere.hasMore]).toEqual([HOME_PAGE_SIZE, true])
      expect(suivante.items.map((item) => item.path)).not.toContain(premiere.items[0].path)
      await expect(homeContents(db, identity, { tab: "recent", scope: "org", offset: 1000 })).rejects.toMatchObject({ code: "invalid_arguments" })
    })

    it("should say no more page at the last offset allowed, though more contents follow", async () => {
      const { db, identity } = await session("ada")
      // Plus de contenus que dix pages : la dernière page permise ne propose pas une suite que l'API refuserait.
      await fx.admin`
        insert into platform.nodes (org_id, parent_id, path, title, summary, status, revision)
        select ${o.org.id}, ${o.nodes.ventes}, 'ventes/borne_' || rang, 'Borne ' || rang, 'Une page de la borne.', 'draft', 0
          from generate_series(1, ${HOME_OFFSET_MAX + HOME_PAGE_SIZE + 5}) as rang`
      const derniere = await homeContents(db, identity, { tab: "recent", scope: "org", offset: HOME_OFFSET_MAX })
      expect([derniere.items.length, derniere.hasMore]).toEqual([HOME_PAGE_SIZE, false])
      expect((await homeContents(db, identity, { tab: "recent", scope: "org", offset: HOME_OFFSET_MAX - HOME_PAGE_SIZE })).hasMore).toBe(true)
    })
  })

  describe("homeContents, most viewed", () => {
    it("should add the views on screen and the reads of assistants, the most consulted first, never what she cannot read", async () => {
      const id = (path: string) => ids.get(path) ?? ""
      await fx.admin`
        insert into platform.node_views (org_id, node_id, user_id, views) values
          (${o.org.id}, ${id("annonces")}, ${o.people.claire.id}, 3),
          (${o.org.id}, ${id("ventes/cachee")}, ${o.people.claire.id}, 9)
        on conflict (org_id, node_id, user_id, day) do update set views = excluded.views`
      await fx.seedCtxJournal(o.org, o.people.ada, [
        { tool: `${o.org.prefix}_read`, target: "ventes/tarifs" },
        { tool: `${o.org.prefix}_read`, target: "ventes/tarifs" },
        { tool: `${o.org.prefix}_read`, target: "ventes/tarifs" },
        { tool: `${o.org.prefix}_read`, target: "annonces" },
      ])
      // Ada administre : la portée de son journal est l'organisation.
      const { db, identity } = await session("ada")
      const page = await homeContents(db, identity, { tab: "viewed", scope: "org" })
      const vu = (path: string) => page.items.find((item) => item.path === path)?.views
      expect(vu("ventes/cachee")).toEqual({ screen: 9, assistant: 0 })
      expect(vu("annonces")).toEqual({ screen: 3, assistant: 1 })
      expect(vu("ventes/tarifs")).toEqual({ screen: 0, assistant: 3 })
      expect(paths(page).slice(0, 3)).toEqual(["ventes/cachee", "annonces", "ventes/tarifs"])

      const lea = await session("lea")
      expect(paths(await homeContents(lea.db, lea.identity, { tab: "viewed", scope: "org" }))).not.toContain("ventes/cachee")
    })
  })
})
