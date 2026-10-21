// @vitest-environment node
// Rendu des blocs (tâche M05) sur des blocs en mémoire : formes canoniques d'E03-S03 (dont les cas de
// son AC2), ordre, sections et emplacement d'un bloc `call` (E01-S06 § 3 ; E03-S06, règle 7 et AC1),
// blocs que le schéma partagé refuse (E01-S06 N44). Chaque attendu est le texte exact.
import { describe, expect, it } from "vitest"
import {
  blockRef,
  callLocation,
  findSections,
  formatCallLocation,
  normalizeTitle,
  orderBlocks,
  renderBlock,
  renderBlocks,
  sectionOfBlock,
  splitSections,
  type BlockLike,
} from "../../packages/plateforme/schemas"
import { DOCUMENT_CASES } from "../helpers/block-cases"

type Extra = Partial<BlockLike>

const heading = (text: string, level: number, extra: Extra = {}): BlockLike => ({ type: "heading", text, data: { level }, ...extra })
const paragraph = (text: string, extra: Extra = {}): BlockLike => ({ type: "paragraph", text, data: {}, ...extra })
const list = (items: string[], data: { ordered?: boolean; start?: number } = {}, extra: Extra = {}): BlockLike => ({
  type: "list",
  text: null,
  data: { items, ...data },
  ...extra,
})
const call = (fn: string, args: Record<string, unknown> = {}, extra: Extra = {}): BlockLike => ({
  type: "call",
  text: null,
  data: { function: fn, args },
  ...extra,
})
const reference = (path: string, view?: Record<string, unknown>, extra: Extra = {}): BlockLike => ({
  type: "reference",
  text: null,
  data: view === undefined ? { path } : { path, view },
  ...extra,
})
const row = (key: string): BlockLike => ({ type: "row", text: null, data: { ref: key }, key })

const lines = (...rows: string[]) => rows.join("\n")

describe("renderBlock — canonical forms of E03-S03", () => {
  it("should repeat # headingBase + level − 1 times, 2 by default", () => {
    expect(renderBlock(heading("Étapes", 1))).toBe("## Étapes")
    expect(renderBlock(heading("Cas particulier", 2))).toBe("### Cas particulier")
    expect(renderBlock(heading("Détail", 3))).toBe("#### Détail")
  })

  it("should go one level down with headingBase 3, as in context", () => {
    expect(renderBlock(heading("Étapes", 1), { headingBase: 3 })).toBe("### Étapes")
    expect(renderBlock(heading("Cas particulier", 2), { headingBase: 3 })).toBe("#### Cas particulier")
    expect(renderBlock(heading("Détail", 3), { headingBase: 3 })).toBe("##### Détail")
  })

  it("should render levels 4 and 5 as ##### and ######, and bound context (headingBase 3) to six # (E10-S04, AC-b3)", () => {
    expect([4, 5].map((level) => renderBlock(heading("Détail", level)))).toEqual(["##### Détail", "###### Détail"])
    expect([4, 5].map((level) => renderBlock(heading("Détail", level), { headingBase: 3 }))).toEqual(["###### Détail", "###### Détail"])
  })

  it("should render a paragraph as is, links and lines included", () => {
    const text = "Voir [[ventes/suivi|le suivi]] et **le devis**.\nDeuxième ligne."
    expect(renderBlock(paragraph(text))).toBe(text)
  })

  it("should render a bullet list, and ignore start when the list is not ordered", () => {
    expect(renderBlock(list(["Téléphone", "Chat"]))).toBe("- Téléphone\n- Chat")
    expect(renderBlock(list(["Téléphone", "Chat"], { ordered: false, start: 3 }))).toBe("- Téléphone\n- Chat")
  })

  it("should number an ordered list from 1, or from start", () => {
    expect(renderBlock(list(["Lire le devis.", "Écrire le brouillon."], { ordered: true }))).toBe(
      "1. Lire le devis.\n2. Écrire le brouillon.",
    )
    expect(renderBlock(list(["Réserve", "Écris"], { ordered: true, start: 3 }))).toBe("3. Réserve\n4. Écris")
  })

  it("should indent the following lines of an item by two spaces", () => {
    expect(renderBlock(list(["Lire le devis\nattentivement", "Écrire"], { ordered: true }))).toBe(
      "1. Lire le devis\n  attentivement\n2. Écrire",
    )
    const checklist = { type: "checklist", data: { items: [{ text: "Relire\nà deux", checked: false }] } }
    expect(renderBlock(checklist)).toBe("- [ ] Relire\n  à deux")
    expect(renderBlock(list(["Lire\n\nPuis écrire"]))).toBe("- Lire\n\n  Puis écrire")
  })

  it("should render a checklist with [ ] and [x]", () => {
    const checklist = { type: "checklist", data: { items: [{ text: "Relire", checked: false }, { text: "Envoyer", checked: true }] } }
    expect(renderBlock(checklist)).toBe("- [ ] Relire\n- [x] Envoyer")
  })

  it("should fence code with its language, or with none", () => {
    expect(renderBlock({ type: "code", text: "x = 1", data: { language: "python" } })).toBe("```python\nx = 1\n```")
    expect(renderBlock({ type: "code", text: "select 1" })).toBe("```\nselect 1\n```")
  })

  it("should fence code with more backticks than the longest run of its text, three at least", () => {
    const withFence = lines("Exemple :", "```", "x", "```")
    expect(renderBlock({ type: "code", text: withFence, data: { language: "md" } })).toBe(`\`\`\`\`md\n${withFence}\n\`\`\`\``)
    expect(renderBlock({ type: "code", text: "a ````` b" })).toBe("``````\na ````` b\n``````")
    expect(renderBlock({ type: "code", text: "use `x` or ``y``" })).toBe("```\nuse `x` or ``y``\n```")
  })

  it("should render a call as its function then its arguments in compact JSON, in a call fence", () => {
    expect(renderBlock(call("table.rows", { table: "ventes/suivi_prospects", limit: 3 }))).toBe(
      lines("```call", 'table.rows {"table":"ventes/suivi_prospects","limit":3}', "```"),
    )
    expect(renderBlock(call("table.schema"))).toBe(lines("```call", "table.schema {}", "```"))
  })

  it("should fence a mermaid block, longer when its text holds backticks", () => {
    expect(renderBlock({ type: "mermaid", text: "graph TD; A-->B" })).toBe("```mermaid\ngraph TD; A-->B\n```")
    expect(renderBlock({ type: "mermaid", text: "graph TD; A[```]-->B" })).toBe("````mermaid\ngraph TD; A[```]-->B\n````")
  })

  it("should render an image, its caption as the link title when it has one", () => {
    const src = "https://x.test/p.png"
    expect(renderBlock({ type: "image", text: "Plan du site", data: { src, alt: "Plan" } })).toBe(
      '![Plan](https://x.test/p.png "Plan du site")',
    )
    expect(renderBlock({ type: "image", text: null, data: { src, alt: "Plan" } })).toBe("![Plan](https://x.test/p.png)")
    expect(renderBlock({ type: "image", data: { src: "a.png" } })).toBe("![](a.png)")
    expect(renderBlock({ type: "image", text: "", data: { src: "a.png" } })).toBe('![](a.png "")')
  })

  it("should write the alt and the caption of an image as they are, without escaping, as the table of E03-S03 does", () => {
    expect(renderBlock({ type: "image", text: 'Plan "A"', data: { src: "a.png", alt: "x]y" } })).toBe('![x]y](a.png "Plan "A"")')
  })

  it("should render a callout as a quote, its tone first in capitals", () => {
    expect(renderBlock({ type: "callout", text: "Attention.", data: { tone: "warning" } })).toBe("> [!WARNING]\n> Attention.")
    expect(renderBlock({ type: "callout", text: "Ligne 1\nLigne 2" })).toBe("> Ligne 1\n> Ligne 2")
    expect(renderBlock({ type: "callout", text: "Note.", data: { tone: "" } })).toBe("> Note.")
  })

  it("should render a reference as a readable reference fence, its view in compact JSON", () => {
    expect(renderBlock(reference("ventes/suivi_prospects", { filter: { statut: "à revoir" } }))).toBe(
      lines("```reference", 'ventes/suivi_prospects {"filter":{"statut":"à revoir"}}', "```"),
    )
    expect(renderBlock(reference("conseil/grille_tarifaire"))).toBe(lines("```reference", "conseil/grille_tarifaire", "```"))
  })

  it("should never render a row", () => {
    expect(renderBlock(row("P-001"))).toBe("")
    expect(renderBlock(row("P-001"), { refs: () => "P-001" })).toBe("")
  })
})

describe("renderBlocks", () => {
  it("should put one empty line between two blocks", () => {
    const blocks = [heading("Objet", 1), paragraph("Relancer un devis."), list(["a", "b"])]
    expect(renderBlocks(blocks)).toBe("## Objet\n\nRelancer un devis.\n\n- a\n- b")
  })

  it("should keep the order it is given, without sorting by position", () => {
    const blocks = [paragraph("Deux.", { position: 2048 }), paragraph("Un.", { position: 1024 })]
    expect(renderBlocks(blocks)).toBe("Deux.\n\nUn.")
  })

  it("should leave out a row and an empty paragraph without adding lines", () => {
    expect(renderBlocks([paragraph("Un."), row("P-001"), paragraph(""), paragraph("Deux.")])).toBe("Un.\n\nDeux.")
    expect(renderBlocks([])).toBe("")
  })

  it("should render the steps of a procedure, calls between the numbered lists (E03-S06)", () => {
    const table = "ventes/suivi_prospects"
    const blocks = [
      heading("Étapes", 1),
      list(["Annonce en une phrase ce que tu vas faire.", "Lis le contrat du tableau :"], { ordered: true }),
      call("table.schema", { table }),
      list(["Réserve jusqu'à trois prospects :"], { ordered: true, start: 3 }),
      call("table.claim", { table, worker: "<ton prénom>", limit: 3 }),
      list(["Prépare un brouillon pour chacun :"], { ordered: true, start: 4 }),
      call("mail.create_draft", { to: "<email du contact>", subject: "Suite à notre échange", body: "<texte>" }),
    ]
    expect(renderBlocks(blocks)).toBe(
      lines(
        "## Étapes",
        "",
        "1. Annonce en une phrase ce que tu vas faire.",
        "2. Lis le contrat du tableau :",
        "",
        "```call",
        'table.schema {"table":"ventes/suivi_prospects"}',
        "```",
        "",
        "3. Réserve jusqu'à trois prospects :",
        "",
        "```call",
        'table.claim {"table":"ventes/suivi_prospects","worker":"<ton prénom>","limit":3}',
        "```",
        "",
        "4. Prépare un brouillon pour chacun :",
        "",
        "```call",
        'mail.create_draft {"to":"<email du contact>","subject":"Suite à notre échange","body":"<texte>"}',
        "```",
      ),
    )
  })

  it("should render the blocks of a Contexte one heading level down with headingBase 3 (E03-S08)", () => {
    const blocks = [heading("Mission", 1), paragraph("Acme conçoit des opérations."), heading("Règles", 1), paragraph("Aucun email.")]
    expect(renderBlocks(blocks, { headingBase: 3 })).toBe("### Mission\n\nAcme conçoit des opérations.\n\n### Règles\n\nAucun email.")
  })
})

describe("renderBlocks — reference option", () => {
  const cited = reference("conseil/grille_tarifaire", undefined, { id: "r1" })
  const resolved = "→ page: Grille tarifaire — Tarifs des études, en euros HT. (conseil/grille_tarifaire)"

  it("should render a reference block by the option instead of its fence, and only reference blocks", () => {
    const seen: BlockLike[] = []
    const markdown = renderBlocks([heading("Tarifs", 1), cited, paragraph("Fin.")], {
      reference: (block) => {
        seen.push(block)
        return resolved
      },
    })
    expect(markdown).toBe(`## Tarifs\n\n${resolved}\n\nFin.`)
    expect(seen).toHaveLength(1)
    expect(seen[0]).toBe(cited)
  })

  it("should let the option keep the default fence and add its line after it (form of read, E03-S07)", () => {
    const markdown = renderBlocks([cited], { reference: (block) => `${renderBlock(block)}\n<!-- ${resolved} -->` })
    expect(markdown).toBe(lines("```reference", "conseil/grille_tarifaire", "```", `<!-- ${resolved} -->`))
  })
})

describe("renderBlocks — refs option", () => {
  const objet = heading("Objet", 1, { id: "0b1e2c3d-0000-4000-8000-000000000001", key: "objet" })
  const relance = paragraph("Relancer un devis resté sans réponse.", { id: "3f9a2c1b-5b7d-4c1a-9e2f-8a6b4c2d0e1f" })
  const refs = (block: BlockLike) => blockRef({ id: block.id ?? "", key: block.key ?? null })

  it("should put exactly one reference line before each block", () => {
    expect(renderBlocks([objet, relance], { refs })).toBe(
      lines("<!-- ref: objet -->", "## Objet", "", "<!-- ref: 3f9a2c1b -->", "Relancer un devis resté sans réponse."),
    )
  })

  it("should put no line before a block whose reference is null", () => {
    expect(renderBlocks([objet, relance], { refs: (block) => (block.key ? refs(block) : null) })).toBe(
      lines("<!-- ref: objet -->", "## Objet", "", "Relancer un devis resté sans réponse."),
    )
  })

  it("should put the line before the rendering of the reference option, and none for a row", () => {
    const cited = reference("conseil/tarifs", undefined, { id: "r1", key: "tarifs" })
    expect(renderBlocks([cited, row("P-001")], { refs, reference: () => "→ page: Tarifs (conseil/tarifs)" })).toBe(
      "<!-- ref: tarifs -->\n→ page: Tarifs (conseil/tarifs)",
    )
  })

  it("should keep the reference line of an empty paragraph alone", () => {
    expect(renderBlocks([paragraph("", { key: "vide" }), relance], { refs })).toBe(
      lines("<!-- ref: vide -->", "", "<!-- ref: 3f9a2c1b -->", "Relancer un devis resté sans réponse."),
    )
  })
})

describe("orderBlocks", () => {
  const texts = (blocks: BlockLike[]) => blocks.map((block) => block.text)

  it("should order by position, then by id", () => {
    const blocks = [paragraph("b", { position: 2048, id: "b" }), paragraph("c", { position: 1024, id: "c" }), paragraph("a", { position: 1024, id: "a" })]
    expect(texts(orderBlocks(blocks))).toEqual(["a", "c", "b"])
  })

  it("should compare positions as numbers", () => {
    const blocks = [10240, 512.5, -1024, 2048].map((position) => paragraph(String(position), { position, id: String(position) }))
    expect(texts(orderBlocks(blocks))).toEqual(["-1024", "512.5", "2048", "10240"])
  })

  it("should put a block without position or id after the others, keeping the given order between equals", () => {
    const blocks = [
      paragraph("sans position", { position: null, id: "a" }),
      paragraph("sans id", { position: 1024 }),
      paragraph("complet", { position: 1024, id: "z" }),
      paragraph("brouillon 1"),
      paragraph("brouillon 2"),
    ]
    expect(texts(orderBlocks(blocks))).toEqual(["complet", "sans id", "sans position", "brouillon 1", "brouillon 2"])
  })

  it("should return a new array and leave the given one as it was", () => {
    const blocks = [paragraph("b", { position: 2 }), paragraph("a", { position: 1 })]
    const ordered = orderBlocks(blocks)
    expect(ordered).not.toBe(blocks)
    expect(texts(blocks)).toEqual(["b", "a"])
  })
})

// Page de sections imbriquées : un début de page, trois niveaux, deux titres « Exemple ».
const PAGE: BlockLike[] = [
  paragraph("Intro.", { id: "intro" }),
  heading("Objet", 1, { id: "objet", key: "objet" }),
  paragraph("Relancer un devis resté sans réponse.", { id: "p1" }),
  heading("Étapes", 1, { id: "etapes" }),
  list(["Lire le devis.", "Écrire le brouillon."], { ordered: true }, { id: "l1" }),
  heading("Cas particulier", 2, { id: "cas" }),
  paragraph("Un devis de plus de 90 jours se requalifie.", { id: "p2" }),
  heading("Détail", 3, { id: "detail" }),
  paragraph("Voir la grille.", { id: "p3" }),
  heading("Exemple", 2, { id: "exemple-2" }),
  paragraph("Premier exemple.", { id: "p4" }),
  heading("Règles", 1, { id: "regles" }),
  paragraph("Jamais d'envoi sans accord.", { id: "p5" }),
  heading("Exemple", 1, { id: "exemple-1" }),
  paragraph("Second exemple.", { id: "p6" }),
]

const outline = (sections: { heading: BlockLike | null; blocks: BlockLike[] }[]) =>
  sections.map((section) => [section.heading?.id ?? null, section.blocks.map((block) => block.id)])

describe("splitSections", () => {
  it("should give the start of the page, then each heading with the blocks up to the next heading of the same level or above", () => {
    expect(outline(splitSections(PAGE))).toEqual([
      [null, ["intro"]],
      ["objet", ["objet", "p1"]],
      ["etapes", ["etapes", "l1", "cas", "p2", "detail", "p3", "exemple-2", "p4"]],
      ["cas", ["cas", "p2", "detail", "p3"]],
      ["detail", ["detail", "p3"]],
      ["exemple-2", ["exemple-2", "p4"]],
      ["regles", ["regles", "p5"]],
      ["exemple-1", ["exemple-1", "p6"]],
    ])
  })

  it("should give an empty start of the page when the page opens with a heading, and only it for no block", () => {
    expect(outline(splitSections([heading("A", 1, { id: "a" }), paragraph("x", { id: "x" })]))).toEqual([
      [null, []],
      ["a", ["a", "x"]],
    ])
    expect(splitSections([])).toEqual([{ heading: null, blocks: [] }])
  })

  it("should give back the blocks it was given, not copies", () => {
    const sections = splitSections(PAGE)
    expect(sections[1].heading).toBe(PAGE[1])
    expect(sections[1].blocks[1]).toBe(PAGE[2])
  })
})

describe("findSections and normalizeTitle", () => {
  it("should compare titles without case, accents or edge spaces", () => {
    expect(normalizeTitle("Étapes")).toBe("etapes")
    expect(normalizeTitle("  RÈGLES  ")).toBe("regles")
    expect(normalizeTitle("Préférences")).toBe(normalizeTitle("PREFERENCES"))
    expect(normalizeTitle("Ça")).toBe("ca")
    expect(normalizeTitle("Étape")).not.toBe(normalizeTitle("Étapes"))
  })

  it("should find a section by a title written differently", () => {
    expect(outline(findSections(PAGE, "  ÉTAPES "))).toEqual([["etapes", ["etapes", "l1", "cas", "p2", "detail", "p3", "exemple-2", "p4"]]])
    expect(outline(findSections(PAGE, "cas particulier"))).toEqual([["cas", ["cas", "p2", "detail", "p3"]]])
  })

  it("should find every section of the same title, in order", () => {
    expect(outline(findSections(PAGE, "exemple"))).toEqual([
      ["exemple-2", ["exemple-2", "p4"]],
      ["exemple-1", ["exemple-1", "p6"]],
    ])
  })

  it("should find no section for an unknown title, nor the start of the page", () => {
    expect(findSections(PAGE, "Budget")).toEqual([])
    expect(findSections(PAGE, "")).toEqual([])
  })
})

describe("sectionOfBlock", () => {
  it("should give the title of the closest heading before the block, whatever its level", () => {
    expect(sectionOfBlock(PAGE, "p1")).toBe("Objet")
    expect(sectionOfBlock(PAGE, "l1")).toBe("Étapes")
    expect(sectionOfBlock(PAGE, "p2")).toBe("Cas particulier")
    expect(sectionOfBlock(PAGE, "p3")).toBe("Détail")
  })

  it("should put a heading in its own section, and a block before the first heading in none", () => {
    expect(sectionOfBlock(PAGE, "etapes")).toBe("Étapes")
    expect(sectionOfBlock(PAGE, "intro")).toBeNull()
  })

  it("should refuse a block that is not among the blocks given", () => {
    expect(() => sectionOfBlock(PAGE, "absent")).toThrow("Block absent is not among the blocks given.")
  })
})

// Les blocs de l'AC1 d'E03-S06 : un `call` avant tout titre, puis « Étapes », « Détail », « Règles ».
const PROCEDURE: BlockLike[] = [
  paragraph("Avant tout titre.", { id: "p0" }),
  call("x.zero", {}, { id: "c0" }),
  heading("Étapes", 1, { id: "etapes" }),
  list(["Annonce.", "Lis le contrat :"], { ordered: true }, { id: "l1" }),
  call("x.one", {}, { id: "c1" }),
  list(["Réserve :"], { ordered: true, start: 3 }, { id: "l2" }),
  call("x.two", {}, { id: "c2" }),
  call("x.three", {}, { id: "c3" }),
  paragraph("Puis.", { id: "p1" }),
  call("x.four", {}, { id: "c4" }),
  heading("Détail", 2, { id: "detail" }),
  call("x.five", {}, { id: "c5" }),
  heading("Règles", 1, { id: "regles" }),
  list(["Jamais sans accord."], {}, { id: "l3" }),
  call("x.six", {}, { id: "c6" }),
  list(["a", "b", "c"], { ordered: true, start: 12 }, { id: "l4" }),
  { type: "code", text: "x.seven {}", data: { language: "Call" }, id: "code" },
  call("x.eight", {}, { id: "c7" }),
]

describe("callLocation and formatCallLocation", () => {
  it("should locate each call block of E03-S06 AC1 by section, rank and step", () => {
    const ids = ["c0", "c1", "c2", "c3", "c4", "c5", "c6", "c7"]
    expect(ids.map((id) => callLocation(PROCEDURE, id))).toEqual([
      { section: null, rank: 1, step: null },
      { section: "Étapes", rank: 1, step: 2 },
      { section: "Étapes", rank: 2, step: 3 },
      { section: "Étapes", rank: 3, step: 3 },
      { section: "Étapes", rank: 4, step: null },
      { section: "Détail", rank: 1, step: null },
      { section: "Règles", rank: 1, step: null },
      { section: "Règles", rank: 2, step: null },
    ])
  })

  it("should write each location in the format of E03-S06 rule 7", () => {
    expect(["c0", "c1", "c3", "c4", "c5", "c7"].map((id) => formatCallLocation(callLocation(PROCEDURE, id)))).toEqual([
      "before the first heading, call block 1",
      "section « Étapes », call block 1 (step 2)",
      "section « Étapes », call block 3 (step 3)",
      "section « Étapes », call block 4",
      "section « Détail », call block 1",
      "section « Règles », call block 2",
    ])
    expect(formatCallLocation({ section: null, rank: 2, step: 4 })).toBe("before the first heading, call block 2 (step 4)")
  })

  it("should give the step of the last item of an ordered list of five, as E07-S02 AC27 expects", () => {
    const blocks = [heading("Étapes", 1), list(["a", "b", "c", "d", "e"], { ordered: true }), call("table.release", {}, { id: "release" })]
    expect(formatCallLocation(callLocation(blocks, "release"))).toBe("section « Étapes », call block 1 (step 5)")
  })

  it("should count the items of an ordered list from its start, the step being the last number it renders", () => {
    const steps = list(["Réserve", "Écris"], { ordered: true, start: 3 })
    const blocks = [heading("Étapes", 1), steps, call("t.x", {}, { id: "c" })]
    expect(callLocation(blocks, "c")).toEqual({ section: "Étapes", rank: 1, step: 4 })
    expect(formatCallLocation(callLocation(blocks, "c"))).toBe("section « Étapes », call block 1 (step 4)")
    expect(renderBlock(steps).split("\n").at(-1)).toBe("4. Écris")
  })

  it("should give the section of a code block of language call through sectionOfBlock, and refuse it in callLocation", () => {
    expect(sectionOfBlock(PROCEDURE, "code")).toBe("Règles")
    expect(() => callLocation(PROCEDURE, "code")).toThrow("Block code is a code block, not a call block.")
    expect(() => callLocation(PROCEDURE, "absent")).toThrow("Block absent is not among the blocks given.")
  })
})

describe("blocks the shared schema refuses (E01-S06 N44)", () => {
  // Les cas partagés sont typés `Record<string, unknown>` : leur forme est justement ce qu'ils testent.
  const asBlock = (block: Record<string, unknown>) => block as BlockLike

  // M67 (D122) : un bloc refusé est servi à sa place par une ligne, jamais effacé en silence.
  const unknown = (type: unknown) => `<!-- block ${String(type)} not shown: this platform version does not know it -->`

  // Une table de cas en un test (DG1) : le verdict de chaque cas, le différentiel de `toEqual` nomme les fautifs.
  it("should render every refused case as the unknown-block line, with its reference line, and no accepted case as it", () => {
    const verdict = (block: BlockLike, type: unknown) => {
      if (renderBlock(block, { refs: () => "ref" }) === `<!-- ref: ref -->\n${unknown(type)}`) return "unknown-block line"
      return renderBlock(block) === "" ? "nothing" : "rendered"
    }
    const expected = (c: (typeof DOCUMENT_CASES)[number]) => (!c.valid ? "unknown-block line" : c.name === "an empty paragraph" ? "nothing" : "rendered")
    expect(Object.fromEntries(DOCUMENT_CASES.map((c) => [c.name, verdict(asBlock(c.block), c.block.type)]))).toEqual(
      Object.fromEntries(DOCUMENT_CASES.map((c) => [c.name, expected(c)])),
    )
  })

  it("should not hand a reference block the schema refuses to the reference option", () => {
    const seen: BlockLike[] = []
    const refused: BlockLike = { type: "reference", text: null, data: { path: "Ventes/Suivi" } }
    const markdown = renderBlock(refused, {
      reference: (block) => {
        seen.push(block)
        return "→ page"
      },
    })
    expect(markdown).toBe(unknown("reference"))
    expect(seen).toEqual([])
  })

  it("should render as the unknown-block line, and open no section with, a heading whose level the database admits in an array", () => {
    const blocks: BlockLike[] = [
      heading("A", 1, { id: "a" }),
      { type: "heading", text: "B", data: { level: [2] }, id: "b" },
      paragraph("Suite.", { id: "p" }),
    ]
    expect(renderBlocks(blocks)).toBe(`## A\n\n${unknown("heading")}\n\nSuite.`)
    expect(outline(splitSections(blocks))).toEqual([
      [null, []],
      ["a", ["a", "b", "p"]],
    ])
    expect(sectionOfBlock(blocks, "p")).toBe("A")
  })

  it("should render as the unknown-block line, and not count as the step, an ordered list whose start the database admits in an array", () => {
    const refused: BlockLike = { type: "list", text: null, data: { items: ["Réserve"], ordered: true, start: [3, "x"] }, id: "l" }
    const blocks = [heading("Étapes", 1), refused, call("table.claim", {}, { id: "c" })]
    expect(renderBlock(refused)).toBe(unknown("list"))
    expect(callLocation(blocks, "c")).toEqual({ section: "Étapes", rank: 1, step: null })
    const accepted = [heading("Étapes", 1), list(["Réserve"], { ordered: true, start: 3 }), call("table.claim", {}, { id: "c" })]
    expect(callLocation(accepted, "c")).toEqual({ section: "Étapes", rank: 1, step: 3 })
  })
})
