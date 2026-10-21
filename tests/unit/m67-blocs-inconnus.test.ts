// @vitest-environment node
// Lecteur tolérant des blocs inconnus (tâche M67, fiche D122) : un bloc qu'une version plus récente de la
// plateforme a écrit (type nouveau, élément de liste d'une forme inconnue, titre de niveau 6 ou 7) est servi à sa place par
// une ligne de commentaire, jamais effacé en silence, par le rendu commun (`read`, `context`), et `write`
// refuse par `conflict` toute opération qui le perdrait. Blocs en mémoire, textes comparés mot pour mot.
import { describe, expect, it } from "vitest"
import { renderBlock, renderBlocks, splitSections, type BlockLike } from "../../packages/plateforme/schemas"
import { ACCESS_LEVELS } from "../../packages/plateforme/server/access"
import { PlatformError } from "../../packages/plateforme/server/errors"
import type { DocBlock } from "../../packages/plateforme/server/nodes/document"
import type { NodeRow } from "../../packages/plateforme/server/nodes/lookup"
import { applyOps } from "../../packages/plateforme/server/nodes/ops"
import { serveBody } from "../../packages/plateforme/server/nodes/read-body"
import { blockUuid } from "../helpers/reference-org"

const PATH = "ventes/devis"
const line = (type: string) => `<!-- block ${type} not shown: this platform version does not know it -->`

type Seed = Pick<DocBlock, "type" | "text" | "data"> & { key?: string }

const heading = (text: string, level: number, key?: string): Seed => ({ type: "heading", text, data: { level }, key })
const paragraph = (text: string): Seed => ({ type: "paragraph", text, data: {} })
const CAROUSEL: Seed = { type: "carousel", text: "Détails", data: { children: [] } }

function doc(blocks: Seed[]): DocBlock[] {
  return blocks.map((block, index) => ({
    id: blockUuid(index + 1),
    type: block.type,
    text: block.text,
    data: block.data,
    key: block.key ?? null,
    position: 1024 * (index + 1),
    revision: 1,
    provenance: {},
  }))
}

/** Objet, P1, Suite (CAROUSEL, niveau 6, P2, P2b), Fin, P3 : les blocs inconnus sont tous dans « Suite ». */
function page(): DocBlock[] {
  return doc([
    heading("Objet", 1),
    paragraph("Relancer un devis."),
    heading("Suite", 1, "suite"),
    CAROUSEL,
    heading("Détail", 6),
    paragraph("Un devis ancien se requalifie."),
    paragraph("Il se relance."),
    heading("Fin", 1),
    paragraph("Jamais le week-end."),
  ])
}

const [, , SUITE, T, H4, P2, , , P3] = page().map((block) => block.id ?? "")
const ref = (id: string) => id.slice(0, 8)

type Op = Parameters<typeof applyOps>[1][number]

function refusal(ops: Op[], blocks = page()): unknown {
  try {
    applyOps(blocks, ops, { path: PATH })
  } catch (error) {
    return error
  }
  return null
}

const inSection = (title: string) =>
  `section « ${title} » holds a carousel block newer than this platform version, which this operation would lose: update the platform to change it, or edit the other blocks one by one with block operations (read with refs: true).`

const onBlock = (block: string, type: string) =>
  `block ${block} is a ${type} block newer than this platform version: only an updated platform can replace, delete or move it. Update the platform to change it.`

describe("rendering a block this platform version does not know (M67)", () => {
  it("should render the exact line for a block of an unknown type, with its reference line when asked", () => {
    expect(renderBlock(CAROUSEL)).toBe("<!-- block carousel not shown: this platform version does not know it -->")
    expect(renderBlock(CAROUSEL, { refs: () => "t1" })).toBe(`<!-- ref: t1 -->\n${line("carousel")}`)
  })

  it("should render the line for a heading of level 6, which opens no section", () => {
    const blocks: BlockLike[] = [
      { ...heading("A", 1), id: "a" },
      { ...heading("B", 6), id: "b" },
      { ...paragraph("Suite."), id: "p" },
    ]
    expect(renderBlocks(blocks)).toBe(`## A\n\n${line("heading")}\n\nSuite.`)
    expect(splitSections(blocks).map((section) => section.blocks.map((block) => block.id))).toEqual([[], ["a", "b", "p"]])
  })
})

describe("read of a page holding unknown blocks (M67)", () => {
  const node: NodeRow = {
    id: "n",
    org_id: "o",
    parent_id: null,
    path: PATH,
    kind: "page",
    title: "Devis",
    summary: "Relance.",
    status: "published",
    revision: 3,
    meta: {},
    owner_kind: null,
    owner_team_id: null,
    owner_user_id: null,
    created_by: null,
    updated_by: null,
    created_at: "2026-09-28T00:00:00Z",
    updated_at: "2026-09-28T00:00:00Z",
  }
  const serve = (input: { section?: string }) =>
    serveBody({
      input: { path: PATH, ...input },
      context: { node, level: ACCESS_LEVELS.read },
      prefix: "acme",
      draftMode: false,
      blocks: page(),
      since: null,
      draft: null,
      reference: (block) => renderBlock(block),
    }).body

  it("should serve each unknown block at its place in the whole page", () => {
    expect(serve({})).toBe(
      [
        "## Objet",
        "Relancer un devis.",
        "## Suite",
        line("carousel"),
        line("heading"),
        "Un devis ancien se requalifie.",
        "Il se relance.",
        "## Fin",
        "Jamais le week-end.",
      ].join("\n\n"),
    )
  })

  it("should serve each unknown block at its place in a section", () => {
    expect(serve({ section: "Suite" })).toBe(["## Suite", line("carousel"), line("heading"), "Un devis ancien se requalifie.", "Il se relance."].join("\n\n"))
  })
})

describe("write around a block this platform version does not know (M67)", () => {
  it.each<[string, Op]>([
    ["replace_section", { op: "replace_section", section: "Suite", text: "Nouveau texte." }],
    ["delete_section", { op: "delete_section", section: "Suite" }],
    ["replace_text over several blocks", { op: "replace_text", section: "Suite", find: "requalifie.\n\nIl se", text: "requalifie ; il se" }],
    ["replace_text inside the line of the unknown block", { op: "replace_text", section: "Suite", find: "block carousel", text: "x" }],
  ])("should refuse %s on a section holding it, with conflict", (_name, op) => {
    const error = refusal([op])
    expect(error).toBeInstanceOf(PlatformError)
    expect(error).toMatchObject({ code: "conflict", message: `Op 1 (${op.op} « Suite »): ${inSection("Suite")} Nothing was written.` })
  })

  it("should refuse a section holding only a heading of level 6, naming its type", () => {
    const blocks = doc([heading("Suite", 1), heading("Détail", 7), paragraph("Texte.")])
    expect(refusal([{ op: "replace_section", section: "Suite", text: "Autre." }], blocks)).toMatchObject({
      code: "conflict",
      message: `Op 1 (replace_section « Suite »): ${inSection("Suite").replace("a carousel block", "a heading block")} Nothing was written.`,
    })
  })

  it.each<[string, Op]>([
    ["delete_block", { op: "delete_block", block: ref(T) }],
    ["move_block", { op: "move_block", block: ref(T), after_block: ref(P3) }],
    ["replace_block", { op: "replace_block", block: ref(T), text: "Remplacé." }],
  ])("should refuse %s of the unknown block itself, with conflict", (_name, op) => {
    expect(refusal([op])).toMatchObject({ code: "conflict", message: `Op 1 (${op.op} ${ref(T)}): ${onBlock(ref(T), "carousel")} Nothing was written.` })
  })

  it("should refuse to delete or move a heading of level 6", () => {
    expect(refusal([{ op: "delete_block", block: ref(H4) }])).toMatchObject({ code: "conflict", message: `Op 1 (delete_block ${ref(H4)}): ${onBlock(ref(H4), "heading")} Nothing was written.` })
    expect(refusal([{ op: "move_block", block: ref(H4) }])).toMatchObject({ code: "conflict" })
  })

  it("should keep the unknown blocks through the operations that do not rewrite them", () => {
    const { blocks } = applyOps(
      page(),
      [
        { op: "append", section: "Suite", text: "Ajouté." },
        { op: "replace_text", section: "Suite", find: "ancien", text: "de 90 jours" },
        { op: "insert_after", block: ref(T), text: "Inséré." },
        { op: "move_block", block: ref(P3), after_block: ref(T) },
        { op: "replace_section", section: "Fin", text: "Autre fin." },
        { op: "delete_block", block: "suite" },
      ],
      { path: PATH },
    )
    expect(blocks.map((block) => block.id)).toEqual(expect.arrayContaining([T, H4, P2]))
    expect(blocks.filter((block) => block.id === T || block.id === H4)).toMatchObject(page().filter((block) => block.id === T || block.id === H4))
    expect(blocks.some((block) => block.id === SUITE)).toBe(false)
  })
})
