// @vitest-environment node
// Les partages d'une équipe sur une vraie base (`teamShares`, la fonction `team.shares`) : ce qu'elle partage hors
// d'elle, ce que d'autres équipes partagent avec elle, les liens de ses contenus que ses membres ne peuvent pas ouvrir.
// La base est le sujet : tout se calcule de ses règles, de ses contenus et de ses liens, et le droit se décide dans le
// service, avant toute lecture. O de référence : Ventes (Claire la mène, Léa en est), Support (Paul le mène), Ada
// administre sans équipe.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { runCall } from "../../packages/plateforme/server/calls"
import type { FunctionContext } from "../../packages/plateforme/server/catalog/define"
import { teamShares, teamSharesFunction } from "../../packages/plateforme/server/team-shares"
import { seedReferenceOrg, type ReferenceOrgSql } from "../helpers/reference-org-sql"
import { asCaller, seedWithAdmin, spyDb, SQL_SKIP_REASON, sqlConfigured, type SeededData } from "../helpers/sql"

const SETUP_TIMEOUT = 180_000

const settle = <T>(promise: Promise<T>) =>
  promise.then(
    (result) => ({ result, error: null }),
    (error: unknown) => ({ result: null, error }),
  )

describe.skipIf(!sqlConfigured)(sqlConfigured ? "shares of a team on a real database" : `shares of a team on a real database (${SQL_SKIP_REASON})`, { timeout: SETUP_TIMEOUT }, () => {
  let seed: SeededData
  let ref: ReferenceOrgSql

  beforeAll(async () => {
    seed = seedWithAdmin()
    ref = await seedReferenceOrg(seed, {
      nodes: [
        { path: "support/dossier", title: "Dossier" },
        { path: "support/dossier/a", title: "Fiche A" },
        { path: "support/dossier/a/detail", title: "Détail" },
        { path: "support/faq", title: "FAQ" },
        { path: "ventes/devis", title: "Devis" },
        { path: "ventes/tarifs", title: "Tarifs" },
        { path: "ventes/cache", title: "Cache" },
        { path: "support/reserve", title: "Réserve" },
      ],
      rules: [
        // Reçu de Support : un dossier et une page ; un contenu sous le dossier n'est pas un second point d'entrée.
        { node: "support/dossier", team: "ventes", level: "read" },
        { node: "support/dossier/a", team: "ventes", level: "read" },
        { node: "support/faq", team: "ventes", level: "write" },
        // Partagé hors de Ventes : une équipe, une personne qui n'en est pas, toute l'organisation.
        { node: "ventes/devis", team: "support", level: "read" },
        { node: "ventes/devis", user: "paul", level: "write" },
        { node: "ventes/tarifs", org: true, level: "read" },
        // Ni un membre de l'équipe, ni une fermeture ne sont un partage hors d'elle.
        { node: "ventes/devis", user: "lea", level: "manage" },
        { node: "ventes/x", team: "support", level: "none" },
        // Fermés à Léa seule : un contenu de son équipe partagé hors d'elle, et un contenu reçu de Support.
        { node: "ventes/cache", team: "support", level: "read" },
        { node: "ventes/cache", user: "lea", level: "none" },
        { node: "support/reserve", team: "ventes", level: "read" },
        { node: "support/reserve", user: "lea", level: "none" },
      ],
    })
    const [block] = await ref.addBlocks("ventes/devis", "published", [{ type: "paragraph", text: "Voir les notes et la FAQ." }])
    const link = (target: string) => ({ org_id: ref.org.id, source_node_id: ref.nodeId("ventes/devis"), source_block_id: block, target_path: target, target_node_id: ref.nodeId(target) })
    // Les notes privées de Claire : aucun membre de Ventes ne les ouvre ; la FAQ, partagée avec Ventes, s'ouvre.
    await seed.admin`insert into platform.links ${seed.admin([link("private/claire/notes"), link("support/faq")])}`
    // Un lien d'un contenu fermé à Léa, écrit sous l'ancien chemin de sa cible.
    const [hidden] = await ref.addBlocks("ventes/cache", "published", [{ type: "paragraph", text: "Voir les anciennes notes." }])
    await seed.admin`insert into platform.links ${seed.admin([
      { org_id: ref.org.id, source_node_id: ref.nodeId("ventes/cache"), source_block_id: hidden, target_path: "private/claire/ancien", target_node_id: ref.nodeId("private/claire/notes") },
    ])}`
  }, SETUP_TIMEOUT)

  afterAll(async () => {
    await seed?.cleanup()
  }, SETUP_TIMEOUT)

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("should give a member what the team shares outside, what other teams share with it, and the links its members cannot open, nothing of a content closed to her", async () => {
    const shares = await teamShares(await ref.db("lea"), ref.identityOf("lea"), "ventes")

    expect(shares).toEqual({
      team: { slug: "ventes", name: "Ventes" },
      opened: [
        {
          path: "ventes/devis",
          title: "Devis",
          kind: "page",
          subjects: [
            { kind: "team", name: "Support", level: "read" },
            { kind: "user", name: "Paul Girard", level: "write" },
          ],
        },
        { path: "ventes/tarifs", title: "Tarifs", kind: "page", subjects: [{ kind: "org", name: "", level: "read" }] },
      ],
      received: [
        {
          team: { slug: "support", name: "Support" },
          entries: [
            { path: "support/dossier", title: "Dossier", kind: "page", under: 2 },
            { path: "support/faq", title: "FAQ", kind: "page", under: 0 },
          ],
        },
      ],
      // Le chemin est écrit dans la page de Ventes ; le titre d'un contenu que Léa ne lit pas ne part pas.
      brokenLinks: [{ from: { path: "ventes/devis", title: "Devis" }, to: { path: "private/claire/notes", title: null } }],
      brokenTotal: 1,
    })
  })

  it("should refuse before any read who is neither a member of the team nor an administrator, answer an administrator with what she reads, a team by its name, and name the teams for an unknown one", async () => {
    const paul = spyDb(asCaller(ref.people.paul.id, ref.people.paul.email))
    const refused = await settle(teamShares(paul.db, ref.identityOf("paul"), "ventes"))
    const ada = await teamShares(await ref.db("ada"), ref.identityOf("ada"), "ventes")
    const unknown = await settle(teamShares(await ref.db("ada"), ref.identityOf("ada"), "absente"))
    const byName = await teamShares(await ref.db("lea"), ref.identityOf("lea"), "Ventes")

    expect(refused.error).toMatchObject({ code: "forbidden", message: "The shares of team ventes are reserved to its members and to the administrators. Ask a member of the team, or an administrator." })
    expect(paul.sent).toEqual([])
    // Ada lit ce qui est fermé à Léa ; la cible d'un lien part sous le chemin que la source écrit.
    expect(ada.opened.map((node) => node.path)).toEqual(["ventes/cache", "ventes/devis", "ventes/tarifs"])
    expect(ada.received.map((from) => from.entries.map((entry) => entry.path))).toEqual([["support/dossier", "support/faq", "support/reserve"]])
    expect(ada.brokenLinks.map((link) => `${link.from.path} > ${link.to.path}`)).toEqual(["ventes/cache > private/claire/ancien", "ventes/devis > private/claire/notes"])
    expect(byName.team).toEqual({ slug: "ventes", name: "Ventes" })
    expect(unknown.error).toMatchObject({ code: "not_found", message: expect.stringMatching(/^No team absente in .+\. Teams: .*ventes.*\.$/) })
  })

  it("should give as received what a plain member of the team reads in the other teams, as the rail and context show it: shared with the team, with the whole organisation, or owned by it", async () => {
    const shares = await teamShares(await ref.db("paul"), ref.identityOf("paul"), "support")

    expect(shares.received).toEqual([
      {
        team: { slug: "ventes", name: "Ventes" },
        entries: [
          // Partagé avec Support, puis avec toute l'organisation, puis le dossier de Ventes que possède Support.
          { path: "ventes/cache", title: "Cache", kind: "page", under: 0 },
          { path: "ventes/devis", title: "Devis", kind: "page", under: 1 },
          { path: "ventes/tarifs", title: "Tarifs", kind: "page", under: 0 },
          { path: "ventes/zone", title: "ventes/zone", kind: "page", under: 1 },
        ],
      },
    ])
  })

  it("should serve the same shares as a text through team.shares, the team of the person by default, and ask which team when she has several", async () => {
    const context = async (overrides = {}): Promise<FunctionContext> => ({ db: await ref.db("lea"), identity: ref.identityOf("lea", overrides), ctx: null })
    const served = await teamSharesFunction.run(await context(), {} as never)
    const several = await settle(teamSharesFunction.run(await context({ teams: [ref.teamOf("ventes", "lea"), ref.teamOf("support", "lea")] }), {} as never))

    expect(served.text.split("\n")).toEqual([
      "Shares of team Ventes (generated from access rights).",
      "Shared outside the team (2):",
      "- ventes/devis — Devis: team Support (read), Paul Girard (write)",
      "- ventes/tarifs — Tarifs: the whole organisation (read)",
      "Shared with the team by other teams:",
      "Team Support:",
      "- support/dossier (+2 under it) — Dossier",
      "- support/faq — FAQ",
      "Links its members cannot open (1):",
      "- ventes/devis links to private/claire/notes",
    ])
    expect(served.data).toEqual({ team: "ventes", opened: 2, received: 2, broken_links: 1 })
    // Par `call`, comme un assistant l'appelle : la fonction est au catalogue, l'équipe nommée par son nom.
    const called = await runCall(
      { db: await ref.db("lea"), identity: ref.identityOf("lea"), ctxCode: null, origin: "https://exemple.test", activeConnectors: async () => new Set<string>() },
      { function: "team.shares", arguments: { team: "Ventes" } },
    )
    expect(called.text).toContain("Shares of team Ventes (generated from access rights).")
    expect(several.error).toMatchObject({
      code: "invalid_arguments",
      message: 'You belong to several teams: ventes (Ventes), support (Support). Show this list to the user and ask which team, then call again with "team".',
    })
  })
})
