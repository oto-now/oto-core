// @vitest-environment node
// La vue invité d'une équipe sur une vraie base : ce qu'une équipe a partagé avec une personne qui n'en est pas membre,
// lu par `guestTeams` et servi par `context`. La base est le sujet : les niveaux se calculent sur ses règles, et le filtre
// de lecture est dans le service (la base rend tous les contenus des équipes). O de référence : Léa est de Ventes, Paul
// mène Support, Ada administre sans équipe. Support partage avec Ventes un dossier (dont un enfant est refermé, un autre
// jamais publié) et une page ; Ventes partage une page avec toute l'organisation.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { SERVED_GUESTS } from "../../packages/plateforme/schemas"
import { buildContext, previewContext } from "../../packages/plateforme/server/context"
import { guestsBlock } from "../../packages/plateforme/server/context/blocks/guests"
import { guestTeams } from "../../packages/plateforme/server/nodes/guest-entries"
import { visibleTree } from "../../packages/plateforme/server/nodes/tree"
import { sectionsDeLArbre } from "../../packages/plateforme/ui/arbre/depuis-l-arbre"
import { loggedText } from "../helpers/logs"
import type { Person } from "../helpers/reference-org"
import { seedReferenceOrg, type ReferenceOrgSql } from "../helpers/reference-org-sql"
import { asCaller, seedWithAdmin, spyDb, SQL_SKIP_REASON, sqlConfigured, type SeededData } from "../helpers/sql"

const SETUP_TIMEOUT = 180_000

const TEAMS = [
  { slug: "ventes", name: "Ventes" },
  { slug: "support", name: "Support" },
]

describe.skipIf(!sqlConfigured)(sqlConfigured ? "guest view of a team on a real database" : `guest view of a team on a real database (${SQL_SKIP_REASON})`, { timeout: SETUP_TIMEOUT }, () => {
  let seed: SeededData
  let ref: ReferenceOrgSql

  beforeAll(async () => {
    seed = seedWithAdmin()
    ref = await seedReferenceOrg(seed, {
      nodes: [
        { path: "support/dossier", title: "Dossier", summary: "Les fiches du support." },
        { path: "support/dossier/a", title: "Fiche A" },
        { path: "support/dossier/a/detail", title: "Détail" },
        { path: "support/dossier/ferme", title: "Fermé" },
        { path: "support/dossier/brouillon", title: "Brouillon", status: "draft", revision: 0 },
        { path: "support/faq", title: "FAQ", summary: "Les questions fréquentes." },
      ],
      rules: [
        { node: "support/dossier", team: "ventes", level: "read" },
        { node: "support/dossier/ferme", team: "ventes", level: "none" },
        { node: "support/faq", team: "ventes", level: "read" },
        { node: "ventes/tarifs", org: true, level: "read" },
      ],
    })
  }, SETUP_TIMEOUT)

  afterAll(async () => {
    await seed?.cleanup()
  }, SETUP_TIMEOUT)

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const notice = () => `${SERVED_GUESTS.noticeStart}${ref.org.prefix}${SERVED_GUESTS.noticeMiddle}${ref.org.prefix}${SERVED_GUESTS.noticeEnd}`

  it("should serve what another team shared: a folder counted with what is readable under it, a page, never a closed or unpublished child", async () => {
    const block = await guestsBlock(await ref.db("lea"), ref.identityOf("lea"))

    expect(block).toEqual({
      name: "guests",
      text: [
        SERVED_GUESTS.title,
        notice(),
        "### Team Support. Lead: Paul Girard.",
        "- support/dossier (+2 under it) — Dossier — Les fiches du support.",
        "- support/faq — FAQ — Les questions fréquentes.",
      ].join("\n"),
    })
  })

  it("should give an administrator who is not a member what a member would get, and nothing of a team to its own members", async () => {
    const paths = async (person: Person, overrides = {}) =>
      (await guestTeams(await ref.db(person), ref.identityOf(person, overrides))).map((team) => [team.name, team.entries.map((entry) => entry.path)])

    expect({
      // Ada administre : comme membre, elle ne lit de Ventes que la page partagée avec toute l'organisation.
      ada: await paths("ada"),
      // Paul, de Support : la page de toute l'organisation, et le dossier de Ventes que possède Support.
      paul: await paths("paul"),
      // Membre de toutes les équipes : aucune vue invité.
      everywhere: await paths("lea", { teams: [ref.teamOf("ventes", "lea"), ref.teamOf("support", "lea")] }),
    }).toEqual({
      ada: [["Ventes", ["ventes/tarifs"]]],
      paul: [["Ventes", ["ventes/tarifs", "ventes/zone"]]],
      everywhere: [],
    })
  })

  it("should list the entry points the rail shows in the sections of the teams the person is not a member of", async () => {
    const compared: Record<string, unknown> = {}
    for (const person of ["lea", "paul", "ada"] as const) {
      const identity = ref.identityOf(person)
      const db = await ref.db(person)
      const mine = new Set(identity.teams.map((team) => team.slug))
      const { tree } = await visibleTree(db, identity)
      const rail = sectionsDeLArbre(tree, TEAMS, person)
        .filter((section) => TEAMS.some((team) => team.slug === section.cle) && !mine.has(section.cle))
        .flatMap((section) => section.noeuds.map((node) => node.chemin))
      const served = (await guestTeams(db, identity)).flatMap((team) => team.entries.map((entry) => entry.path))
      compared[person] = { rail: [...rail].sort(), served: [...served].sort() }
    }

    expect(compared).toEqual({
      lea: { rail: ["support/dossier", "support/faq"], served: ["support/dossier", "support/faq"] },
      paul: { rail: ["ventes/tarifs", "ventes/zone"], served: ["ventes/tarifs", "ventes/zone"] },
      ada: { rail: ["ventes/tarifs"], served: ["ventes/tarifs"] },
    })
  })

  it("should read the teams, their contents and their leads once each, whatever the number of teams", async () => {
    const { db, sent } = spyDb(asCaller(ref.people.ada.id, ref.people.ada.email))
    await guestsBlock(db, ref.identityOf("ada"))

    const reads = (target: string) => sent.filter((query) => query.face === "sql" && query.target === target).length
    expect({ teams: reads("teams"), teamMembers: reads("team_members") }).toEqual({ teams: 1, teamMembers: 1 })
  })

  it("should serve the same block, byte for byte, whatever the request", async () => {
    const db = await ref.db("lea")
    const block = async (phrase: string) => {
      const { text } = await previewContext(db, ref.identityOf("lea"), { phrase })
      const start = text.indexOf(SERVED_GUESTS.title)
      const end = text.indexOf("\n## ", start + 1)
      return text.slice(start, end < 0 ? undefined : end)
    }
    const first = await block("un devis pour un client")

    expect(first).toContain("### Team Support. Lead: Paul Girard.")
    expect(await block("les questions fréquentes du support")).toBe(first)
  })

  it("should keep the block whole after the Contextes when they fill the budget, and leave it out of a light context", async () => {
    const long = Array.from({ length: 45 }, (_, rank) => ({ type: "paragraph" as const, text: `${rank} ${"contexte long ".repeat(70)}` }))
    await ref.addBlocks("contexte", "published", long)
    await ref.addBlocks("ventes/contexte", "published", long)
    const db = await ref.db("lea")
    const identity = ref.identityOf("lea")

    const preview = await previewContext(db, identity, {})
    const names = preview.blocks.map((block) => block.name)
    const full = await buildContext(db, identity, {}, { userAgent: null })
    const light = await buildContext(db, identity, { since_ctx: String(full.ctx) }, { userAgent: null })

    expect({
      guests: preview.blocks.find((block) => block.name === "guests")?.status,
      afterContexts: names.indexOf("guests") > names.indexOf("ventes/contexte"),
      contextsCutOrOmitted: preview.blocks.some((block) => block.name.endsWith("contexte") && block.status !== "full"),
      inFull: full.text.includes(SERVED_GUESTS.title),
      inLight: light.text.includes(SERVED_GUESTS.title),
    }).toEqual({ guests: "full", afterContexts: true, contextsCutOrOmitted: true, inFull: true, inLight: false })
  })

  it("should leave the block out and still answer when its read fails, naming the read in the log", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const { db } = spyDb(asCaller(ref.people.lea.id, ref.people.lea.email), { fail: (query) => (query.face === "sql" && query.target === "teams" ? { code: "57014" } : null) })

    const preview = await previewContext(db, ref.identityOf("lea"), {})

    expect(preview.blocks.map((block) => block.name)).not.toContain("guests")
    expect(preview.text).toContain("## Context: everyone")
    expect(loggedText(errors)).toContain("[platform] context: guest views read failed")
  })
})
