// @vitest-environment node
// Contrat MCP de `read` et `write` étendu par ajout seulement (E03-S03, AC1 ; ADR-002 § 1, fiche D8) :
// le JSON Schema servi, privé exactement des ajouts du « Contrat MCP (ajouts) » (et `section` remis
// dans `required`), égale celui d'E03-S01 ; les champs du corps de l'API et les bornes du service n'y
// sont pas.
import { describe, expect, it } from "vitest"
import { inputSchemas, toInputSchema } from "../../../packages/plateforme/mcp/schemas"

type Json = Record<string, unknown>

/** Le sous-objet `key` d'un JSON Schema : `z.toJSONSchema` rend des objets imbriqués, que le type `unknown` ne décrit pas. */
function at(value: Json, key: string): Json {
  // Les champs lus ici (`properties`, `items`, une propriété) sont des objets par construction du JSON Schema.
  return value[key] as Json
}

const CTX = { description: "ctx code returned by acme_context, e.g. 7K3Q-M2XA. Required: call acme_context first.", type: "string" }
const text200 = (description: string) => ({ description, maxLength: 200, minLength: 1, type: "string" })

/** Les JSON Schema de `read` et `write` servis par E03-S01 (instantané de sa story). */
const E03_S01: Record<"read" | "write", Json> = {
  read: {
    type: "object",
    additionalProperties: false,
    properties: {
      ctx: CTX,
      path: text200("Path of a page, procedure or table (e.g. ventes/relance_devis), journal, or a function name (e.g. table.rows)."),
      section: text200(`Title of one section to read, e.g. "Étapes" (default: the whole page, or its outline if long).`),
      outline: { description: "true: only the section titles with their sizes (default false).", type: "boolean" },
      since_revision: { description: "Only what changed after this revision, e.g. 3 (default: the current content).", type: "integer", minimum: 0, maximum: 9007199254740991 },
      draft: { description: "true: read the pending draft instead of the published revision (default false).", type: "boolean" },
      cursor: { description: "Cursor given by a previous result cut at 45,000 characters, to read what follows (default: from the start).", type: "string", minLength: 1, maxLength: 500 },
    },
    required: ["ctx", "path"],
  },
  write: {
    type: "object",
    additionalProperties: false,
    properties: {
      ctx: CTX,
      path: { ...text200("Path of the page, procedure or table to create or edit, e.g. conseil/cr_client_2026_09."), pattern: "^[a-z0-9_]+(\\/[a-z0-9_]+)*$" },
      base_revision: {
        description: "Revision you read, e.g. 4; required to edit an existing node, a stale one is refused (default: none, for a creation).",
        type: "integer",
        minimum: 0,
        maximum: 9007199254740991,
      },
      title: text200(`Title, 200 characters max, e.g. "Compte rendu Mairie de Valbrune"; required to create (default: unchanged). A new title, once published, moves the path to follow it; the old path still leads here.`),
      summary: text200("One-line summary, 200 characters max; required to create (default: unchanged)."),
      kind: { description: "Kind of a new node: page, procedure or table (default page).", enum: ["page", "procedure", "table"], type: "string" },
      ops: {
        description: "Operations on sections addressed by title, applied in order; the first that fails refuses them all (default: none).",
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            op: {
              description: "replace_section, append, add_section, delete_section or replace_text.",
              enum: ["replace_section", "append", "add_section", "delete_section", "replace_text"],
              type: "string",
            },
            section: text200(`Title of the section it applies to, e.g. "Étapes".`),
            text: { description: "New text (markdown); required by every op except delete_section.", type: "string" },
            find: { description: "replace_text only: exact words to replace, appearing once in the section.", minLength: 1, type: "string" },
            after: text200("add_section only: title of the section to insert after (default: at the end)."),
          },
          required: ["op", "section"],
        },
      },
      header: {
        description: "Header of a table; its contract: acme_read with path write.table (default: unchanged).",
        type: "object",
        propertyNames: { type: "string" },
        additionalProperties: {},
      },
      publish: { description: "false: save a draft without publishing it (default true: the write is published at once).", type: "boolean" },
    },
    required: ["ctx", "path"],
  },
}

/** Retire de `field.description` l'ajout d'E03-S03, qui doit la finir mot pour mot. */
function strip(field: Json, added: string): void {
  const description = String(field.description)
  expect(description.endsWith(added), description).toBe(true)
  field.description = description.slice(0, -added.length)
}

describe("read and write input schemas, extended by additions only (AC1)", () => {
  const served = inputSchemas("acme")

  it("should serve the E03-S01 JSON Schema of read plus the optional refs, then the optional file, last", () => {
    const read = structuredClone(toInputSchema(served.read))
    const properties = at(read, "properties")
    // Les ajouts, dans leur ordre : `refs` (E03-S03), puis `file` (E10-S02 AC-d2, fiche D119).
    expect(Object.keys(properties).slice(-2)).toEqual(["refs", "file"])
    expect(properties.refs).toEqual({
      description: "true: each block comes with its reference, e.g. <!-- ref: 3f9a2c1b -->, for the block operations of write (default false).",
      type: "boolean",
    })
    expect(properties.file).toEqual({
      description:
        "Id of one file attached to the page (html, md, txt, csv, or a format the host reads), from a file link /api/platform/files/<id>, to read its text alone; a long file comes as an outline of its parts, read one with section (default: the whole page).",
      type: "string",
      minLength: 1,
      maxLength: 100,
    })
    // Lecteurs de fichiers (lot 1) : `section` lit aussi une partie d'un fichier.
    strip(at(properties, "section"), ` With file: one part of the file, or "*" for its whole text.`)
    delete properties.refs
    delete properties.file
    expect(read).toEqual(E03_S01.read)
  })

  it("should serve the E03-S01 JSON Schema of write plus the block operations, section no longer required, no API field nor service bound", () => {
    const write = structuredClone(toInputSchema(served.write))
    const properties = at(write, "properties")
    const ops = at(properties, "ops")
    const items = at(ops, "items")
    const fields = at(items, "properties")
    strip(ops, " Block operations address a block by its reference instead.")
    // E11-S18 (1.1.3) : set_markdown, l'unicité des titres et replace_text sur la page ou un bloc, avec count.
    strip(at(fields, "op"), " Whole page: set_markdown (the text replaces the whole body; its # and ## headings make the sections).")
    strip(at(fields, "op"), " By block: replace_block, insert_after, delete_block or move_block.")
    strip(
      at(fields, "section"),
      " Titles are unique in a page: add_section refuses one that exists, and a title held by two headings is refused with the refs of their blocks. replace_text without section: the whole page.",
    )
    strip(at(fields, "section"), " Section operations, and move_block (to the end of that section).")
    strip(at(fields, "text"), " delete_block and move_block take no text either.")
    expect(at(fields, "find").description).toBe("replace_text only: exact words to replace, appearing once in the section, the block or the whole page (or count times).")
    at(fields, "find").description = "replace_text only: exact words to replace, appearing once in the section."
    expect(at(fields, "op").enum).toEqual(["replace_section", "append", "add_section", "delete_section", "replace_text", "replace_block", "insert_after", "delete_block", "move_block", "set_markdown"])
    at(fields, "op").enum = ["replace_section", "append", "add_section", "delete_section", "replace_text"]
    expect([fields.block, fields.after_block, fields.count]).toEqual([
      {
        description: 'Block operations: reference of the block, from read with refs: true or from find, e.g. "3f9a2c1b" or a key such as "etapes"; with replace_text, only in that block.',
        type: "string",
        minLength: 1,
        maxLength: 500,
      },
      { description: "move_block only: reference of the block to put it after (default: the start of the page, outside any section).", type: "string", minLength: 1, maxLength: 500 },
      { description: "replace_text only: how many times find appears; all are replaced, and another number found is refused (default 1).", type: "integer", minimum: 1, maximum: 1000 },
    ])
    delete fields.block
    delete fields.after_block
    delete fields.count
    expect(items.required).toEqual(["op"])
    items.required = ["op", "section"]
    expect(write).toEqual(E03_S01.write)
    for (const field of ["revision", "input"]) expect(fields).not.toHaveProperty(field)
    expect(properties).not.toHaveProperty("draft_stamp")
    expect(ops).not.toHaveProperty("maxItems")
    expect(fields.text).not.toHaveProperty("maxLength")
  })
})
