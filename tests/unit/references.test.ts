// @vitest-environment node
// Blocs `reference` (E03-S07, AC11, AC12) sur une base réelle (E01-S10, lot t1-b) : ligne résolue pour le
// lecteur, ses deux formes (`read` : clôture puis commentaire ; `context` : la ligne seule), aller-retour
// par `replace_section`, avertissements de la publication. Chaque cas écrit ses tables simulées sur
// l'organisation O de la graine du fichier (`replaceContent`) ; la base rend les cibles invisibles de O (RLS
// d'isolation seule) : le service les dit introuvables (`security-patterns.md § Droits dans le service`).
// En suite portable (`sqlConfigured`) : le projet, ou le Postgres nu du job `bare-postgres`.
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { renderBlocks, type BlockInput } from "../../packages/plateforme/schemas"
import { loadNode, readNode } from "../../packages/plateforme/server/nodes/read"
import { contextReference, readReference, referenceLines, resolveReferences } from "../../packages/plateforme/server/nodes/references"
import { loadBlocks } from "../../packages/plateforme/server/nodes/store"
import { writeNode } from "../../packages/plateforme/server/nodes/write"
import { addBlocks, aliasRow, contentTables, identityOf, nodeId, openDraftRow, ORG, type Person } from "../helpers/reference-org"
import { seedReferenceOrg, type ReferenceOrgSql } from "../helpers/reference-org-sql"
import type { Tables } from "../helpers/simulated-db"
import { linkSet, replaceContent, writtenLinks } from "../helpers/spy-t1-b"
import { sqlConfigured, seedWithAdmin, type SeededData, portable } from "../helpers/sql"
import { TEMPS_LINEAIRE_MS } from "../helpers/temps-lineaire"

const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 180_000

const heading = (text: string): BlockInput => ({ type: "heading", text, data: { level: 1 } })
const paragraph = (text: string): BlockInput => ({ type: "paragraph", text, data: {} })
const reference = (data: { path: string; view?: Record<string, unknown> }): BlockInput => ({ type: "reference", data })

const GRILLE_LINE = "→ page: Grille tarifaire 2026 — Tarifs 2026 des études et de l'accompagnement, en euros HT. (conseil/grille_tarifaire_2026)"
const VIEW = { filter: { ville: "Valbrune" }, columns: ["entreprise", "contact"], limit: 10 }
/** Chaque champ de `VIEW`, tel que l'appel de la ligne résolue l'écrit. */
const VIEW_ARGUMENTS: Record<string, string> = { filter: '"filter": {"ville": "Valbrune"}', columns: '"columns": ["entreprise", "contact"]', limit: '"limit": 10' }

/**
 * La ligne résolue de la vue `VIEW`, l'appel portant ses champs dans l'ordre où la base rend la vue écrite :
 * `jsonb` range les clés par longueur, puis par octets, et l'ordre se lit sur la ligne relue
 * (`testing-strategy.md § Anti-patterns`, texte d'un objet JSON écrit en base).
 */
function viewLine(keys: readonly string[]): string {
  return `→ view of table Suivi des prospects (ventes/suivi_prospects): filter {"ville":"Valbrune"}, columns entreprise, contact, limit 10. Rows: acme_call {"function": "table.rows", "arguments": {"table": "ventes/suivi_prospects", ${keys.map((key) => VIEW_ARGUMENTS[key]).join(", ")}}}`
}

/** Cibles des références : une page, un tableau, une page et un tableau déplacés, une page que Léa ne voit pas. */
function targets(): Tables {
  const tables = contentTables([], [
    { path: "ventes", title: "Ventes" },
    { path: "conseil", title: "Conseil", owner: { kind: "org", teamId: null, userId: null } },
    { path: "conseil/grille_tarifaire_2026", title: "Grille tarifaire 2026", summary: "Tarifs 2026 des études et de l'accompagnement, en euros HT." },
    { path: "conseil/tarifs", title: "Tarifs" },
    { path: "ventes/suivi_prospects", kind: "table", title: "Suivi des prospects" },
    { path: "ventes/b", title: "B", summary: "La page B." },
    { path: "ventes/t2", kind: "table", title: "T" },
    { path: "ventes/prepa", title: "Préparer le rendez-vous" },
    { path: "ventes/pub", title: "Publiée" },
  ])
  tables.node_aliases = [aliasRow("ventes/a", "ventes/b"), aliasRow("ventes/t", "ventes/t2")]
  return tables
}

const PREPA: BlockInput[] = [
  paragraph("Les tarifs de l'année :"),
  reference({ path: "conseil/grille_tarifaire_2026" }),
  paragraph("Les prospects de Valbrune :"),
  reference({ path: "ventes/suivi_prospects", view: VIEW }),
  heading("Annexe"),
  reference({ path: "conseil/x" }),
  reference({ path: "ventes/absente", view: { limit: 5 } }),
  reference({ path: "support/faq" }),
  reference({ path: "ventes/a" }),
  reference({ path: "ventes/t", view: { limit: 5 } }),
  reference({ path: "conseil/tarifs", view: { limit: 5 } }),
]

describe.skipIf(!sqlConfigured)(portable("reference blocks on a real database"), { timeout: NETWORK_TIMEOUT }, () => {
  let seed: SeededData
  let ref: ReferenceOrgSql

  beforeAll(async () => {
    seed = seedWithAdmin()
    ref = await seedReferenceOrg(seed)
  }, SETUP_TIMEOUT)

  afterAll(async () => {
    await seed?.cleanup()
  }, SETUP_TIMEOUT)

  /** L'identité de la personne dans O, préfixe `acme` des textes servis (l'organisation simulée, son identifiant réel). */
  const who = (person: Person) => ref.identityOf(person, { org: identityOf(person).org })
  const content = (tables: Tables) => replaceContent(seed, ref, tables)

  /** Les blocs d'un état de `ventes/prepa`, `[id, type]` dans l'ordre du document, relus par la connexion d'administration. */
  async function kept(state: "published" | "draft"): Promise<[string, string][]> {
    const rows = await seed.admin<{ id: string; type: string }[]>`
      select id, type from platform.blocks where node_id = ${ref.nodeId("ventes/prepa")} and state = ${state} order by position, id`
    return rows.map((row) => [row.id, row.type])
  }

  describe("resolved lines of reference blocks (AC11)", () => {
    it("should resolve each target for its reader, serve the line after the fence in read and alone for context, and keep the blocks through replace_section", async () => {
      const tables = targets()
      const ids = addBlocks(tables, "ventes/prepa", "published", PREPA)
      // Les liens que `publish_node` a écrits pour ces blocs (N4) : `read` reprend leurs cibles, relues pour
      // son en-tête, sans les relire (N24) ; ses lignes sont celles d'une résolution sans elles.
      tables.links = PREPA.flatMap((block, rank) =>
        block.type === "reference"
          ? [{ id: rank + 1, org_id: ORG.id, source_node_id: nodeId("ventes/prepa"), source_block_id: ids[rank], target_path: block.data.path, target_key: null, target_node_id: null }]
          : [],
      )
      await content(tables)
      // La vue relue telle que la base la rend : l'ordre de ses clés est celui des textes servis.
      const [stored] = await seed.admin<{ view: Record<string, unknown> }[]>`
        select data -> 'view' as view from platform.blocks where id = ${ref.id(ids[3])} and state = 'published'`
      const storedViewLine = viewLine(Object.keys(stored.view))
      const db = await ref.db("lea")
      const lea = who("lea")
      const blocks = await loadBlocks(db, ref.nodeId("ventes/prepa"), "published")
      const resolved = await resolveReferences(db, lea, blocks, [])
      expect(resolved.map((one) => [one.status, one.line])).toEqual([
        ["ok", GRILLE_LINE],
        ["ok", storedViewLine],
        ["missing", "→ page: conseil/x (not found)"],
        ["missing", "→ view: ventes/absente (not found)"],
        // Rendue par la base, de niveau 0 pour Léa : introuvable, sans son titre (H68).
        ["missing", "→ page: support/faq (not found)"],
        ["moved", "→ page: B — La page B. (ventes/b, moved from ventes/a)"],
        ["moved", '→ view of table T (ventes/t2, moved from ventes/t): limit 5. Rows: acme_call {"function": "table.rows", "arguments": {"table": "ventes/t2", "limit": 5}}'],
        ["invalid", "→ view: invalid block (conseil/tarifs is not a table)"],
      ])

      const page = await readNode(db, lea, { path: "ventes/prepa" })
      const grille = `\`\`\`reference\nconseil/grille_tarifaire_2026\n\`\`\`\n<!-- ${GRILLE_LINE} -->`
      const view = `\`\`\`reference\nventes/suivi_prospects ${JSON.stringify(stored.view)}\n\`\`\`\n<!-- ${storedViewLine} -->`
      expect(page.text).toContain(`Les tarifs de l'année :\n\n${grille}\n\nLes prospects de Valbrune :\n\n${view}\n\n## Annexe`)
      expect(page.data?.references).toEqual([
        { kind: "page", path: "conseil/grille_tarifaire_2026", title: "Grille tarifaire 2026", status: "ok" },
        { kind: "view", path: "ventes/suivi_prospects", title: "Suivi des prospects", status: "ok" },
        { kind: "page", path: "conseil/x", status: "missing" },
        { kind: "view", path: "ventes/absente", status: "missing" },
        { kind: "page", path: "support/faq", status: "missing" },
        // `read` sert une référence vers un nœud déplacé à son chemin courant (`withCurrentLinks`).
        { kind: "page", path: "ventes/b", title: "B", status: "ok" },
        { kind: "view", path: "ventes/t2", title: "T", status: "ok" },
        { kind: "view", path: "conseil/tarifs", title: "Tarifs", status: "invalid" },
      ])
      const section = await readNode(db, lea, { path: "ventes/prepa", section: "Annexe" })
      expect(section.text).toContain("## Annexe\n\n```reference\nconseil/x\n```\n<!-- → page: conseil/x (not found) -->\n\n```reference\nventes/absente")
      expect((await readNode(db, lea, { path: "ventes/prepa", since_revision: 0 })).text).toContain(`(added)\n${grille}\n`)
      // L'écran lit les blocs tels quels (lu ici, avant le brouillon ouvert plus bas).
      const screen = await loadNode(db, lea, { path: "ventes/prepa" })
      expect(screen.blocks.filter((block) => block.type === "reference").map((block) => block.data)).toEqual(PREPA.filter((block) => block.type === "reference").map((block) => block.data))
      // Le brouillon copie les blocs publiés sous les mêmes ids (`open_draft`).
      await ref.openDraft("ventes/prepa")
      await ref.addBlocks("ventes/prepa", "draft", PREPA.map((block, index) => ({ ...block, id: ids[index] })))
      expect((await readNode(db, lea, { path: "ventes/prepa", draft: true })).text).toContain(`\n\n${grille}\n\n`)

      // Le texte lu d'une section, renvoyé tel quel : chaque bloc gardé (même id), aucun paragraphe créé.
      const body = section.text.slice(section.text.indexOf("## Annexe"), section.text.lastIndexOf("\n\nTo edit"))
      const rewrite = targets()
      addBlocks(rewrite, "ventes/prepa", "published", PREPA.map((block, index) => ({ ...block, id: ids[index] })))
      await content(rewrite)
      await writeNode(await ref.db("lea"), lea, { path: "ventes/prepa", base_revision: 1, ops: [{ op: "replace_section", section: "Annexe", text: body }], publish: false }, { kind: "agent", ctx: null })
      expect(await kept("draft")).toEqual(await kept("published"))

      // La forme `context` (E03-S08 la branche) : la ligne seule.
      const lines = referenceLines(resolved)
      expect(renderBlocks(blocks.slice(0, 4), { reference: contextReference(lines) })).toBe(`Les tarifs de l'année :\n\n${GRILLE_LINE}\n\nLes prospects de Valbrune :\n\n${storedViewLine}`)
    })
  })

  describe("reference blocks at publication (AC12)", () => {
    it("should publish and warn about each reference block by its section, never as a link, the view itself unchecked", async () => {
      const tables = targets()
      openDraftRow(tables, "ventes/pub")
      addBlocks(tables, "ventes/pub", "draft", [
        reference({ path: "conseil/y" }),
        heading("Annexe"),
        reference({ path: "conseil/x" }),
        heading("Suivi"),
        reference({ path: "conseil/tarifs", view: { limit: 5 } }),
        reference({ path: "ventes/suivi_prospects", view: { colonne_inconnue: true } }),
      ])
      await content(tables)
      const published = await writeNode(await ref.db("claire"), who("claire"), { path: "ventes/pub", base_revision: 1, publish: true }, { kind: "agent", ctx: null })
      expect(published.text).toBe(
        [
          "Published ventes/pub revision 2 (2 sections, 6 blocks). Next write: base_revision 2.",
          "Warnings:",
          "- reference block before the first heading: conseil/y does not exist (yet)",
          "- reference block in « Annexe »: conseil/x does not exist (yet)",
          "- view block in « Suivi »: conseil/tarifs is not a table",
        ].join("\n"),
      )
      // Chaque bloc `reference` est un lien écrit par `publish_node` ; les lignes écrites n'ont pas d'ordre.
      const links = await writtenLinks(seed.admin, ref.nodeId("ventes/pub"))
      expect(linkSet(links.map(({ path }) => ({ path })))).toEqual(linkSet([{ path: "conseil/y" }, { path: "conseil/x" }, { path: "conseil/tarifs" }, { path: "ventes/suivi_prospects" }]))
    })
  })
})

describe("read form of a reference block (security)", () => {
  it("should put a line carrying hostile whitespace of the largest size a client sends on one line in linear time", () => {
    // Une vue écrite par l'API (`input` d'une opération par bloc) porte ses espaces telles quelles dans la
    // ligne résolue : `\s*[\r\n]+\s*` relisait chaque suite depuis chacun de ses caractères (0,5 à 1,4 s
    // pour 40 000, 199 s pour 250 000, mesuré à la fusion d'E03-S07 sur `main`) ; en temps linéaire,
    // quelques millisecondes.
    const block = { id: "b0", type: "reference", text: null, data: { path: "ventes/t" } }
    for (const space of [" ", String.fromCharCode(0xa0), String.fromCharCode(0x2028)]) {
      const run = space.repeat(250_000)
      const line = `→ view of table T (ventes/t): filter {"v":"${run}x${run}\n${run}"}.`
      const started = performance.now()
      const served = readReference(new Map([["b0", line]]))(block)
      expect(performance.now() - started, `U+${space.charCodeAt(0).toString(16)}`).toBeLessThan(TEMPS_LINEAIRE_MS)
      expect(served.split("\n")).toEqual(["```reference", "ventes/t", "```", `<!-- → view of table T (ventes/t): filter {"v":"${run}x "}. -->`])
    }
  })
})
