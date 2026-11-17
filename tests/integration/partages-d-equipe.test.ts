// @vitest-environment node
// Les partages d'une équipe sur une vraie base (`teamShares`, la fonction `team.shares`) : ce qu'elle partage hors
// d'elle, ce que d'autres équipes partagent avec elle, les liens de ses contenus que ses membres ne peuvent pas ouvrir.
// La base est le sujet : tout se calcule de ses règles, de ses contenus et de ses liens, et le droit se décide dans le
// service, avant toute lecture. O de référence : Ventes (Claire la mène, Léa en est), Support (Paul le mène), Ada
// administre sans équipe.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
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
      ],
    })
    const [block] = await ref.addBlocks("ventes/devis", "published", [{ type: "paragraph", text: "Voir les notes et la FAQ." }])
    const link = (target: string) => ({ org_id: ref.org.id, source_node_id: ref.nodeId("ventes/devis"), source_block_id: block, target_path: target, target_node_id: ref.nodeId(target) })
    // Les notes privées de Claire : aucun membre de Ventes ne les ouvre ; la FAQ, partagée avec Ventes, s'ouvre.
    await seed.admin`insert into platform.links ${seed.admin([link("private/claire/notes"), link("support/faq")])}`
  }, SETUP_TIMEOUT)

  afterAll(async () => {
    await seed?.cleanup()
  }, SETUP_TIMEOUT)

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("should give a member what the team shares outside, what other teams share with it, and the links its members cannot open", async () => {
    const shares = await teamShares(await ref.db("lea"), ref.identityOf("lea"), "ventes")

    expect(shares).toEqual({
      team: { slug: "ventes", name: "Ventes" },
      opened: [
        {
          path: "ventes/devis",
          title: "Devis",
          kind: "page",
          manage: true,
          subjects: [
            { kind: "team", name: "Support", level: "read" },
            { kind: "user", name: "Paul Girard", level: "write" },
          ],
        },
        { path: "ventes/tarifs", title: "Tarifs", kind: "page", manage: false, subjects: [{ kind: "org", name: "", level: "read" }] },
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

  it("should refuse before any read who is neither a member of the team nor an administrator, and answer an administrator as a member, an unknown team as not found", async () => {
    const paul = spyDb(asCaller(ref.people.paul.id, ref.people.paul.email))
    const refused = await settle(teamShares(paul.db, ref.identityOf("paul"), "ventes"))
    const ada = await teamShares(await ref.db("ada"), ref.identityOf("ada"), "ventes")
    const unknown = await settle(teamShares(await ref.db("ada"), ref.identityOf("ada"), "absente"))

    expect(refused.error).toMatchObject({ code: "forbidden", message: "The shares of team ventes are reserved to its members and to the administrators. Ask a member of the team, or an administrator." })
    expect(paul.sent).toEqual([])
    expect([ada.opened.map((node) => node.path), ada.received.map((from) => from.team.name), ada.brokenTotal]).toEqual([["ventes/devis", "ventes/tarifs"], ["Support"], 1])
    expect(unknown.error).toMatchObject({ code: "not_found" })
  })

  it("should give as received what a plain member of the team reads in the other teams, as the rail and context show it: shared with the team, with the whole organisation, or owned by it", async () => {
    const shares = await teamShares(await ref.db("paul"), ref.identityOf("paul"), "support")

    expect(shares.received).toEqual([
      {
        team: { slug: "ventes", name: "Ventes" },
        entries: [
          // Partagé avec Support, puis avec toute l'organisation, puis le dossier de Ventes que possède Support.
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
    expect(several.error).toMatchObject({
      code: "invalid_arguments",
      message: 'You belong to several teams: ventes (Ventes), support (Support). Show this list to the user and ask which team, then call again with "team".',
    })
  })
})
