// @vitest-environment node
// Moteur de blocs de `context` (E03-S01, AC21, H30) : blocs entiers tant qu'ils tiennent, coupe à
// la ligne, blocs de fin omis et nommés, résultat dans le budget. E03-S02, AC9 : le bloc de la
// procédure servie, lu par `procedureBlock` sur Acme, cède la place à son pointeur. Depuis E01-S10
// (lot t1-c2), ce qui lit la base tourne sur une base réelle : Acme sur l'organisation O, semée par la
// connexion d'administration (`seedAcme`, `tests/integration/fixtures/acme-sql.ts`), lue sous la personne.
import { afterAll, describe, expect, it } from "vitest"
import { nodeId, ORG, PEOPLE } from "../helpers/reference-org"
import type { ReferenceOrgSql } from "../helpers/reference-org-sql"
import { seedWithAdmin, sqlConfigured, type SeededData, portable } from "../helpers/sql"
import { acmeNode, candidate, simulatedBlockId } from "../integration/fixtures/acme"
import { seedAcme } from "../integration/fixtures/acme-sql"
import { assembleContext } from "../../packages/plateforme/server/context"
import { procedureBlock } from "../../packages/plateforme/server/context/blocks/procedure"
import { CONTEXT_BUDGET, renderContext } from "../../packages/plateforme/server/context/engine"
import { READ_PAGE_ROWS } from "../../packages/plateforme/server/errors"

const BLOCKS = [
  { name: "code", text: "ctx: AAAA-BBBB\nPass this ctx to every acme_ tool." },
  { name: "person", text: `## You work for\n${"p".repeat(300)}` },
  { name: "organisation", text: `## Organisation\n${Array.from({ length: 20 }, (_, i) => `line ${i} `.repeat(8)).join("\n")}` },
  { name: "procedures", text: `## Procedures\n${"x".repeat(2000)}` },
  { name: "topics", text: "## By topic\n- tarifs: conseil/grille" },
]

/** Graines, sessions et lectures sur le projet partagé, sous la charge des autres agents. */
const REAL_BASE_TIMEOUT = 120_000

let seed: SeededData | undefined

/** La graine du fichier (`seedWithAdmin`), ouverte au premier Acme semé : sautés, les cas n'ouvrent aucune connexion. */
function theSeed(): SeededData {
  seed ??= seedWithAdmin()
  return seed
}

afterAll(async () => {
  // Organisations et personnes.
  await seed?.cleanup()
}, REAL_BASE_TIMEOUT)

/** La procédure servie à Claire, son nœud réel ; le candidat que le routage aurait rendu. */
async function servedTo(ref: ReferenceOrgSql, path: string) {
  return procedureBlock(await ref.db("claire"), { ...candidate(path, 1), nodeId: ref.nodeId(path), title: acmeNode(path).title }, ref.identityOf("claire"))
}

describe("renderContext (AC21)", () => {
  it("should keep every block whole, separated by a blank line, when all fit", () => {
    const { text } = renderContext(BLOCKS, CONTEXT_BUDGET, "acme")
    expect(text).toBe(BLOCKS.map((block) => block.text).join("\n\n"))
    expect(text).not.toContain("budget reached")
  })

  it("should cut the first block that overflows at a line, omit the next ones and name them", () => {
    const { text } = renderContext(BLOCKS, 1500, "acme")
    expect(text.length).toBeLessThanOrEqual(1500)
    expect(text.startsWith(`${BLOCKS[0].text}\n\n${BLOCKS[1].text}\n\n## Organisation\n`)).toBe(true)
    expect(text).not.toContain("## Procedures")
    expect(text.endsWith("\n\n[Context budget reached. Omitted: organisation (cut), procedures, topics. Use acme_find or acme_read for more.]")).toBe(true)
    const kept = text.split("\n\n")[2]
    expect(BLOCKS[2].text.startsWith(kept)).toBe(true)
  })

  it("should share the budget by priority, keep the display order, and name a list by its fallback rather than cut it", () => {
    const parts = [
      { name: "code", text: "## Code\nrules", priority: 0 },
      { name: "ventes/contexte", text: `## Context: team Ventes\n${"v".repeat(600)}`, priority: 10 },
      { name: "support/contexte", text: `## Context: team Support\n${"s".repeat(600)}`, priority: 11 },
      { name: "procedures", text: `## Procedures\n${"- p: un long résumé\n".repeat(60)}`, fallback: "## Procedures\n- p: P", priority: 3 },
    ]
    const { text, report } = renderContext(parts, 1200, "acme")
    // Les procédures, affichées en dernier, passent avant les Contextes : nommées par leurs titres, le dernier Contexte coupé.
    expect(report.map(({ name, status }) => [name, status])).toEqual([
      ["code", "full"],
      ["ventes/contexte", "full"],
      ["support/contexte", "cut"],
      ["procedures", "replaced"],
    ])
    expect(text.indexOf("## Context: team Ventes")).toBeLessThan(text.indexOf("## Procedures\n- p: P"))
    expect(text).toContain("Omitted: support/contexte (cut).")
  })

  it("should name a block that does not fit at all without (cut)", () => {
    const blocks = [BLOCKS[0], { name: "procedures", text: "x".repeat(2000) }, BLOCKS[4]]
    const { text } = renderContext(blocks, 1000, "acme")
    expect(text).toBe(`${BLOCKS[0].text}\n\n[Context budget reached. Omitted: procedures, topics. Use acme_find or acme_read for more.]`)
  })

  it("should reserve 240 characters for the closing line", () => {
    const code = { name: "code", text: "c".repeat(1000 - 240) }
    expect(renderContext([code], 1000, "acme").text).toBe(code.text)
    const tooBig = { name: "code", text: "c".repeat(1000 - 239) }
    expect(renderContext([tooBig], 1000, "acme").text).toMatch(/Omitted: code\./)
  })

  it("should ignore a block with an empty text", () => {
    const { text } = renderContext([BLOCKS[0], { name: "news", text: "" }, { name: "topics", text: "  " }], 1000, "acme")
    expect(text).toBe(BLOCKS[0].text)
  })

  // E11-S03 (lot b, fiche D134) : un plafond de 35 000 caractères, blocs gardés dans l'ordre servi ; une partie de
  // Contexte coupée par le plafond finit par son pointeur, une partie dont la tête ne tient pas est omise.
  describe("the cap of context (E11-S03, AC-b3, AC-b4)", () => {
    const head = "## Context: team Ventes (ventes/contexte)\nTeam Ventes. Lead: Claire Morel."
    const pointer = 'This context is cut: everything served together exceeds 35,000 characters. Read the rest: acme_read {"path": "ventes/contexte"}.'
    const rules = Array.from({ length: 400 }, (_, index) => `Règle ${index} : chaque devis est relu avant envoi.`)
    const fence = ["```text", ...Array.from({ length: 40 }, (_, index) => `modèle ${index}`), "```"]
    /** La partie de Ventes : sa tête, puis un bloc clôturé au milieu de ses règles ; ses listes arrêtées au besoin. */
    const ventes = (lists = false) => {
      const body = [...rules.slice(0, 200), ...fence, ...rules.slice(200)].join("\n")
      const text = `${head}\n${body}${lists ? '\nOnly the first 20 entries are listed. Read the rest: acme_read {"path": "ventes/contexte"}.' : ""}`
      return { name: "ventes/contexte", path: "ventes/contexte", head: head.length, text, ...(lists ? { cut: true } : {}) }
    }
    const filler = (name: string, size: number) => ({ name, text: `## ${name}\n${"x".repeat(size - name.length - 4)}` })
    const notice = (named: string) => `\n\n[Context budget reached. Omitted: ${named}. Use acme_find or acme_read for more.]`

    it("should keep the blocks in the served order, cut the first that does not fit at a whole line before an open fenced block, end it with its pointer and name it with the next ones", () => {
      // Le code prend la place : la coupe de Ventes tombe à 200 caractères dans son bloc clôturé.
      const upToFence = `${head}\n${rules.slice(0, 200).join("\n")}`
      const code = filler("code", 35_000 - 240 - 2 - upToFence.length - 1 - pointer.length - 200)
      const blocks = [code, ventes(true), filler("news", 900), filler("procedures", 9_000), filler("recent content", 1_000)]
      expect(fence.join("\n").length).toBeGreaterThan(200)

      const { text, report } = renderContext(blocks, CONTEXT_BUDGET, "acme")
      expect(text.length).toBeLessThanOrEqual(CONTEXT_BUDGET)
      expect(text).toBe(`${code.text}\n\n${upToFence}\n${pointer}${notice("ventes/contexte (cut), news, procedures, recent content")}`)
      expect(text).not.toContain("Only the first 20")
      expect(report.map(({ name, status }) => [name, status])).toEqual([
        ["code", "full"],
        ["ventes/contexte", "cut"],
        ["news", "omitted"],
        ["procedures", "omitted"],
        ["recent content", "omitted"],
      ])
      expect(report[1]).toMatchObject({ chars: upToFence.length + 1 + pointer.length, head: head.length, path: "ventes/contexte" })
    })

    it("should cut a Contexte at its last whole line outside any fence, the pointer counted within the cap", () => {
      const code = filler("code", 34_000 - 240 - head.length - 2 - 400)
      const { text } = renderContext([code, ventes()], CONTEXT_BUDGET, "acme")
      const part = text.slice(code.text.length + 2, text.indexOf("\n\n[Context budget reached."))
      const kept = part.slice(head.length + 1, -pointer.length - 1)
      expect([part.startsWith(`${head}\n`), part.endsWith(`\n${pointer}`), rules.join("\n").startsWith(`${kept}\n`)]).toEqual([true, true, true])
      // Une ligne de plus ne tiendrait pas avec le pointeur.
      const next = rules[kept.split("\n").length]
      expect(code.text.length + 2 + head.length + 1 + kept.length + 1 + next.length + 1 + pointer.length).toBeGreaterThan(35_000 - 240)
    })

    it("should omit and name a part whose head does not fit, and go on omitting", () => {
      const code = filler("code", 35_000 - 240 - 2 - head.length + 10)
      const { text, report } = renderContext([code, ventes(), filler("news", 500)], CONTEXT_BUDGET, "acme")
      expect(text).toBe(`${code.text}${notice("ventes/contexte, news")}`)
      expect(report.map((entry) => entry.status)).toEqual(["full", "omitted", "omitted"])
    })
  })

  // E03-S02, AC9 : une procédure trop longue n'est jamais coupée au milieu.
  it.skipIf(!sqlConfigured)(
    portable("should replace the served procedure that does not fit by its pointer to read and go on, or omit it with the next ones"),
    async () => {
      const path = "ventes/relance_devis"
      const ref = await seedAcme(theSeed())
      // Un bloc publié de plus, qui fait dépasser le budget à la procédure.
      const text = "Une étape très détaillée. ".repeat(80)
      const long = { id: simulatedBlockId(900), org_id: ORG.id, node_id: nodeId(path), state: "published", position: 99_999, type: "paragraph", text, data: {}, key: null }
      await ref.write({ blocks: [long] })
      const served = await servedTo(ref, path)
      if (served === null) throw new Error(`${path} should be read`)

      expect(renderContext([BLOCKS[0], served.block, BLOCKS[1]], 1000, "acme").text).toBe(
        [
          BLOCKS[0].text,
          "## Procedure ventes/relance_devis (v1): Relancer les devis en attente\n" +
            `Its steps do not fit in this context: read them with ${ref.org.prefix}_read {"path": "ventes/relance_devis"} before acting, and ask the user's explicit approval before anything that sends, or that changes data beyond the steps of the procedure the user asked for.`,
          BLOCKS[1].text,
        ].join("\n\n"),
      )
      // Le pointeur lui-même ne tient pas : omis avec les blocs suivants.
      expect(renderContext([BLOCKS[0], served.block, BLOCKS[1]], 500, "acme").text).toBe(
        `${BLOCKS[0].text}\n\n[Context budget reached. Omitted: procedure, person. Use acme_find or acme_read for more.]`,
      )
    },
    REAL_BASE_TIMEOUT,
  )

  // E03-S02, N32 : une lecture bornée à une page peut en cacher d'autres ; la procédure n'est jamais servie en partie.
  it.skipIf(!sqlConfigured)(
    portable("should serve only the pointer to read when the published blocks fill a page (N32)"),
    async () => {
      const path = "ventes/relance_devis"
      const ref = await seedAcme(theSeed())
      // Des étapes courtes, qui tiendraient dans le budget : seule la page pleine décide du pointeur.
      const steps = Array.from({ length: READ_PAGE_ROWS }, (_, index) => ({
        id: simulatedBlockId(0x20000 + index),
        org_id: ORG.id,
        node_id: nodeId(path),
        state: "published",
        position: 100_000 + index,
        type: "paragraph",
        text: `Étape ${index}.`,
        data: {},
        key: null,
      }))
      await ref.write({ blocks: steps })
      const served = await servedTo(ref, path)
      if (served === null) throw new Error(`${path} should be read`)

      expect(served.block.text).toBe(
        "## Procedure ventes/relance_devis (v1): Relancer les devis en attente\n" +
          `Its steps do not fit in this context: read them with ${ref.org.prefix}_read {"path": "ventes/relance_devis"} before acting, and ask the user's explicit approval before anything that sends, or that changes data beyond the steps of the procedure the user asked for.`,
      )
      expect(served.revision).toBe(1)
    },
    REAL_BASE_TIMEOUT,
  )

  it("should count the last omitted blocks when their names overflow the reserve, within the budget", () => {
    const blocks = Array.from({ length: 12 }, (_, i) => ({ name: `a context block with a long name ${i}`, text: "y".repeat(500) }))
    const { text } = renderContext([BLOCKS[0], ...blocks], 1000, "abcdefghijkl")
    expect(text.length).toBeLessThanOrEqual(1000)
    expect(text.startsWith(`${BLOCKS[0].text}\n\n${"y".repeat(500)}\n\n[Context budget reached. Omitted: a context block with a long name 1, `)).toBe(true)
    expect(text).toMatch(/ and \d+ more\. Use abcdefghijkl_find or abcdefghijkl_read for more\.\]$/)
  })

  // E03-S08, AC8 : quand un nom seul dépasse la réserve, le texte recule ; le rapport dit ce qui en reste.
  it("should report the characters each block keeps when a closing line longer than its reserve makes the text recede (E03-S08, AC8)", () => {
    const blocks = [{ name: "code", text: "c".repeat(300) }, { name: "person", text: "p\n".repeat(199) + "p" }, { name: "x".repeat(300), text: "z".repeat(400) }]
    const { text, report } = renderContext(blocks, 1000, "acme")
    const kept = text.slice(0, text.indexOf("\n\n[Context budget reached."))
    expect(text.length).toBeLessThanOrEqual(1000)
    expect(report).toEqual([
      { name: "code", chars: 300, status: "full", path: null, head: 0 },
      { name: "person", chars: kept.length - 302, status: "cut", path: null, head: 0 },
      { name: "x".repeat(300), chars: 0, status: "omitted", path: null, head: 0 },
    ])
    expect(kept).toBe(`${blocks[0].text}\n\n${blocks[1].text.slice(0, kept.length - 302)}`)
    expect(kept.length - 302).toBeLessThan(blocks[1].text.length)
  })
})

describe.skipIf(!sqlConfigured)(portable("assembleContext (E03-S08, AC7)"), { timeout: REAL_BASE_TIMEOUT }, () => {
  /**
   * Acme dans O, tous les blocs présents pour Claire : procédure servie (le vrai routage la rend nette : son
   * résumé porte la demande mot pour mot), Contextes de Tout le monde et de Ventes, une nouveauté, les
   * procédures utiles, un document récent. Rien n'est écrit par l'assemblage : une graine pour ses deux appels.
   */
  async function everyBlockRef(): Promise<ReferenceOrgSql> {
    const now = new Date().toISOString()
    const ref = await seedAcme(theSeed())
    const version = { node_id: nodeId("conseil/grille_tarifaire_2026"), revision: 2, title: "Grille tarifaire 2026", summary: "Tarifs.", kind: "page", meta: {}, blocks: [], author: null }
    // L'outil sous le préfixe réel d'O : les documents récents ne comptent que `<préfixe>_read` et `<préfixe>_write`.
    const read = { id: 1, org_id: ORG.id, user_id: PEOPLE.claire.id, team_id: null, method: "tools/call", tool: `${ref.org.prefix}_read`, target: "conseil/methode_etude", is_error: false }
    const relance = acmeNode("ventes/relance_devis")
    // Une dernière étape qui cite une page : un bloc `reference`, servi par sa ligne résolue (E03-S07).
    const cited = { org_id: ORG.id, node_id: nodeId(relance.path), state: "published", position: 99_999, type: "reference", text: null, key: null }
    await ref.write({
      node_versions: [{ ...version, created_at: now }],
      journal: [{ ...read, ts: now }],
      blocks: [{ id: simulatedBlockId(901), ...cited, data: { path: "conseil/grille_tarifaire_2026" } }],
    })
    return ref
  }

  // E05-S12 (AC-1) : une partie par Contexte, après la procédure servie ; le code porte ~1 750 caractères de
  // règles de plus, le budget de la coupe grandit d'autant (4 800 au lieu de 3 000) ; E11-S16 : les autres candidates
  // par titre et résumé, et leur consigne, allongent le bloc code (5 800).
  it("should order the blocks as P39 and, in a budget of 5,800, keep the code and the served procedure whole and name the omitted end blocks", async () => {
    const ref = await everyBlockRef()
    const db = await ref.db("claire")
    const assembly = { phrase: "relance les devis en attente", code: "AAAA-BBBB", since: new Date(Date.now() - 14 * 86_400_000).toISOString() }
    const full = await assembleContext(db, ref.identityOf("claire"), { ...assembly, budget: CONTEXT_BUDGET })
    expect(full.report.map(({ name, status }) => [name, status])).toEqual(
      ["code", "procedure", "related", "contexte", "private/claire/contexte", "ventes/contexte", "news", "procedures", "recent content"].map((name) => [name, "full"]),
    )
    expect(full.text.length).toBeLessThanOrEqual(CONTEXT_BUDGET)

    const cut = await assembleContext(db, ref.identityOf("claire"), { ...assembly, budget: 5800 })
    expect(cut.text.length).toBeLessThanOrEqual(5800)
    // Le code et la procédure servie, entiers : le début du texte servi dans le budget complet.
    const head = full.text.slice(0, full.report[0].chars + 2 + full.report[1].chars)
    expect(head.startsWith("ctx: AAAA-BBBB\n")).toBe(true)
    expect(head).toContain("\n\n## Procedure ventes/relance_devis (v1): Relancer les devis en attente\nFollow these steps now.")
    const grille = acmeNode("conseil/grille_tarifaire_2026")
    expect(head.endsWith(`\n\n→ page: ${grille.title} — ${grille.summary} (${grille.path})`)).toBe(true)
    expect(cut.text.startsWith(`${head}\n\n`)).toBe(true)
    expect(cut.report.map((block) => block.name)).toEqual(full.report.map((block) => block.name))
    // Le premier bloc qui dépasse est coupé ou omis, tous les suivants sont omis, le dernier compris.
    const first = cut.report.findIndex((block) => block.status !== "full")
    expect(first).toBeGreaterThan(1)
    expect(cut.report.slice(first + 1).map((block) => block.status)).toEqual(cut.report.slice(first + 1).map(() => "omitted"))
    expect(cut.report.at(-1)?.status).toBe("omitted")
    const named = cut.report.filter((block) => block.status !== "full").map((block) => (block.status === "cut" ? `${block.name} (cut)` : block.name))
    expect(cut.text.endsWith(`\n\n[Context budget reached. Omitted: ${named.join(", ")}. Use ${ref.org.prefix}_find or ${ref.org.prefix}_read for more.]`)).toBe(true)
  })

  // Les contenus proches : une page dont le titre porte la demande paraît sous la procédure servie, avec son score ; sans
  // phrase, aucun bloc.
  it("should list the pages and tables close to the request, by title and summary, and none without a phrase", async () => {
    const ref = await everyBlockRef()
    const db = await ref.db("claire")
    const assembly = { code: "AAAA-BBBB", since: null, budget: CONTEXT_BUDGET }
    const asked = await assembleContext(db, ref.identityOf("claire"), { ...assembly, phrase: "grille tarifaire" })
    expect(asked.text).toMatch(/\n\n## Pages and tables close to the request\n- conseil\/grille_tarifaire_2026 \(page, score \d\.\d\d\): Grille tarifaire 2026\./)
    expect(asked.report.map(({ name }) => name)).toContain("related")
    const none = await assembleContext(db, ref.identityOf("claire"), assembly)
    expect(none.text).not.toContain("## Pages and tables close to the request")
  })
})
