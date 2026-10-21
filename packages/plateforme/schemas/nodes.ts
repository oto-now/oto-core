// Chemins de nœuds, opérations de `write` et entrées de `read` et `write` (H51, H54 ; E03-S01,
// E03-S03), composés par les entrées des outils MCP (`mcp/schemas.ts`) et par le corps de l'API
// (`node-body.ts`), et types de lecture partagés avec `ui/` (E05-S02). `zod/v4` : un schéma v3 ne
// s'imbrique pas dans un objet v4, et `z.toJSONSchema` n'existe qu'en v4 (H21, N12).
//
// Contrat MCP étendu par ajout seulement (ADR-002 § 1, N16) : aucune borne du service ici (lignes
// uniques, 40 000 caractères par opération, 50 opérations, bornes de la page, champs propres à chaque
// opération), pour que le JSON Schema servi ne change que par les ajouts de la story.
import * as z from "zod/v4"
import { PLATFORM_API_PREFIX } from "./api"
import type { BlockType } from "./blocks"

export const NODE_PATH_PATTERN = /^[a-z0-9_]+(\/[a-z0-9_]+)*$/

export const nodePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(NODE_PATH_PATTERN, "Path: lowercase letters, digits and _ separated by /, e.g. ventes/relance_devis")

/**
 * Un texte en segment de chemin (le slug d'une équipe, HN-E05S03-8) : sans accents, en minuscules, tout ce qui
 * n'est pas `[a-z0-9]` devient `_`, `max` caractères au plus, sans `_` en tête ni en fin ; `""` pour un
 * texte sans lettre ni chiffre. Parcours linéaire (`security-patterns.md § Validation des inputs`). Ici depuis
 * E10-S01 : l'adresse d'un fichier importé et le nom d'une colonne d'un CSV se tirent à l'écran comme au service.
 */
export function slugOf(text: string, max: number): string {
  const slug = text
    .replace(/œ/gi, "oe")
    .replace(/æ/gi, "ae")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+/, "")
  return cutAtWord(slug, max)
}

/**
 * Un slug (`[a-z0-9_]`) coupé à `max` caractères après son dernier mot entier, un premier mot trop long à `max`, sans
 * `_` en fin (E11-S18, AC-7) : la coupe de `slugOf`, et celle d'un nom de colonne préfixé ou numéroté (`csv.ts`).
 */
export function cutAtWord(slug: string, max: number): string {
  const cut = slug.slice(0, max)
  const lastWord = slug.length > max && slug[max] !== "_" ? cut.lastIndexOf("_") : -1
  return (lastWord > 0 ? cut.slice(0, lastWord) : cut).replace(/_+$/, "")
}

/**
 * Titre comparable (H54) : sans accent, sans casse, sans espace de bord ; « Étapes » = « etapes ». Ici et non
 * dans `blocks-render.ts`, qui le lit aussi : `tables.ts` le lit, et `blocks-render.ts` dépend de `tables.ts`
 * par `csv.ts` ; l'y importer fermerait un cycle (`coding-standards.md § Imports`).
 */
export function normalizeTitle(title: string): string {
  return title.normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase()
}

/**
 * Texte d'une opération de `write` (banc E04, mesure 4 : un appel porte ~47 000 caractères) et caractères rendus
 * d'une page : bornes du service (`server/nodes/limits.ts`), que l'écran dit avant d'envoyer un collage ou un
 * fichier importé (E10-S01, AC-a1, AC-a3).
 */
export const OP_TEXT_MAX = 40_000
export const PAGE_MAX = 300_000
/**
 * Blocs d'une page, d'une procédure ou d'un Contexte : borne du service, et opérations d'une écriture faite depuis
 * l'écran (fiche D153), que l'écran dit avant d'envoyer un geste sur une sélection de blocs (E11-S17, AC-a6, AC-a8).
 */
export const BLOCKS_MAX = 1_000
/** Titre et résumé d'un nœud : 200 caractères au plus (`writeNodeSchema`), que l'écran coupe avant d'envoyer (E10-S01). */
export const NODE_HEAD_MAX = 200

/** `GET nodes/export?path=` et `GET tables/export?path=` (E10-S01, AC-a5, AC-b6) : le chemin exporté. */
export const nodeExportQuerySchema = z.object({ path: nodePathSchema })

/** Les cinq opérations par section d'E03-S01, dans leur ordre. */
export const SECTION_OPS = ["replace_section", "append", "add_section", "delete_section", "replace_text"] as const

/** Les quatre opérations par bloc (ADR-011 § 5), ajoutées après celles d'E03-S01 (N16). */
export const BLOCK_OPS = ["replace_block", "insert_after", "delete_block", "move_block"] as const

/** L'opération sur tout le corps d'une page (E11-S18, AC-11), ajoutée après celles par bloc (ADR-002 § 1). */
export const PAGE_OPS = ["set_markdown"] as const

export const WRITE_OPS = [...SECTION_OPS, ...BLOCK_OPS, ...PAGE_OPS] as const

/** Occurrences au plus qu'un `replace_text` remplace d'un coup (E11-S18, AC-10). */
export const REPLACE_COUNT_MAX = 1_000

/** Un élément de `write.ops` : une opération par section (titre), par bloc (référence) ou sur toute la page. */
export const writeOpSchema = z.object({
  op: z
    .enum(WRITE_OPS)
    .describe(
      "replace_section, append, add_section, delete_section or replace_text. By block: replace_block, insert_after, delete_block or move_block. Whole page: set_markdown (the text replaces the whole body; its # and ## headings make the sections).",
    ),
  section: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .optional()
    .describe(
      'Title of the section it applies to, e.g. "Étapes". Section operations, and move_block (to the end of that section). Titles are unique in a page: add_section refuses one that exists, and a title held by two headings is refused with the refs of their blocks. replace_text without section: the whole page.',
    ),
  text: z
    .string()
    .optional()
    .describe("New text (markdown); required by every op except delete_section. delete_block and move_block take no text either."),
  find: z
    .string()
    .min(1)
    .optional()
    .describe("replace_text only: exact words to replace, appearing once in the section, the block or the whole page (or count times)."),
  count: z
    .number()
    .int()
    .min(1)
    .max(REPLACE_COUNT_MAX)
    .optional()
    .describe("replace_text only: how many times find appears; all are replaced, and another number found is refused (default 1)."),
  after: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .optional()
    .describe("add_section only: title of the section to insert after (default: at the end)."),
  block: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .optional()
    .describe(
      'Block operations: reference of the block, from read with refs: true or from find, e.g. "3f9a2c1b" or a key such as "etapes"; with replace_text, only in that block.',
    ),
  after_block: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .optional()
    .describe("move_block only: reference of the block to put it after (default: the start of the page, outside any section)."),
})

export type WriteOp = z.infer<typeof writeOpSchema>

/** Les genres d'un nœud (ADR-011 § 1) ; `context` est posé par la base, jamais demandé. */
export const NODE_KINDS = ["page", "procedure", "context", "table"] as const

export type NodeKind = (typeof NODE_KINDS)[number]

/** Les genres qu'on peut demander à `write` (même JSON Schema que `write.kind` d'E03-S01). */
export const nodeKindSchema = z.enum(["page", "procedure", "table"])

/** L'entrée de `read`, sans `ctx` : les champs d'E03-S01 à l'identique, puis `refs`. */
export const readNodeSchema = z.object({
  path: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .describe("Path of a page, procedure or table (e.g. ventes/relance_devis), journal, or a function name (e.g. table.rows)."),
  section: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .optional()
    .describe(`Title of one section to read, e.g. "Étapes" (default: the whole page, or its outline if long). With file: one part of the file, or "*" for its whole text.`),
  outline: z.boolean().optional().describe("true: only the section titles with their sizes (default false)."),
  since_revision: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Only what changed after this revision, e.g. 3 (default: the current content)."),
  draft: z.boolean().optional().describe("true: read the pending draft instead of the published revision (default false)."),
  cursor: z
    .string()
    .min(1)
    .max(500)
    .optional()
    .describe("Cursor given by a previous result cut at 45,000 characters, to read what follows (default: from the start)."),
  refs: z
    .boolean()
    .optional()
    .describe("true: each block comes with its reference, e.g. <!-- ref: 3f9a2c1b -->, for the block operations of write (default false)."),
  // E10-S02 (AC-d2, fiche D119) : le texte d'un fichier joint, champ facultatif ajouté (ADR-002) ; avec `section`, une partie (`lecture-des-fichiers.md`).
  file: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .describe(
      `Id of one file attached to the page (html, md, txt, csv, or a format the host reads), from a file link ${PLATFORM_API_PREFIX}files/<id>, to read its text alone; a long file comes as an outline of its parts, read one with section (default: the whole page).`,
    ),
})

export type ReadNodeInput = z.infer<typeof readNodeSchema>

/**
 * L'entrée de `write`, sans `ctx` : les champs d'E03-S01 à l'identique, sauf les éléments de `ops`
 * (`writeOpSchema`) et `header`, décrit sans préfixe (`mcp/schemas.ts` pose la description préfixée).
 */
export const writeNodeSchema = z.object({
  path: nodePathSchema.describe("Path of the page, procedure or table to create or edit, e.g. conseil/cr_client_2026_09."),
  base_revision: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Revision you read, e.g. 4; required to edit an existing node, a stale one is refused (default: none, for a creation)."),
  title: z
    .string()
    .trim()
    .min(1)
    .max(NODE_HEAD_MAX)
    .optional()
    .describe(`Title, 200 characters max, e.g. "Compte rendu Mairie de Valbrune"; required to create (default: unchanged). A new title, once published, moves the path to follow it; the old path still leads here.`),
  summary: z
    .string()
    .trim()
    .min(1)
    .max(NODE_HEAD_MAX)
    .optional()
    .describe("One-line summary, 200 characters max; required to create (default: unchanged)."),
  kind: nodeKindSchema.optional().describe("Kind of a new node: page, procedure or table (default page)."),
  ops: z
    .array(writeOpSchema)
    .optional()
    .describe(
      "Operations on sections addressed by title, applied in order; the first that fails refuses them all (default: none). Block operations address a block by its reference instead.",
    ),
  header: z.record(z.string(), z.unknown()).optional().describe("Header of a table (default: unchanged)."),
  publish: z
    .boolean()
    .optional()
    .describe("false: save a draft without publishing it (default true: the write is published at once)."),
})

export type WriteNodeInput = z.infer<typeof writeNodeSchema>

/**
 * `ops` d'une écriture d'assistant (`write` au MCP, `node.write_many`) : chaque opération refuse ses clés inconnues,
 * comme son JSON Schema le dit (`additionalProperties: false`). Retirée en silence, une clé mal nommée (`content`
 * pour `text`) laissait l'opération partir sans elle. Même description que `writeNodeSchema.ops`.
 */
export const strictWriteOpsSchema = z
  .array(z.strictObject(writeOpSchema.shape))
  .optional()
  .describe(writeNodeSchema.shape.ops.description ?? "")

/** Pages au plus d'une écriture par lot (`node.write_many`, E11-S18, AC-12). */
export const WRITE_MANY_MAX = 50

/**
 * Les arguments de `node.write_many` (E11-S18, AC-12) : des écritures de `write`, sans `ctx`, faites dans l'ordre ; une
 * clé inconnue d'une page est refusée (`markdown` n'en est pas une : `ops` [{op: "set_markdown", text}]).
 */
export const writeManyArgsSchema = z.strictObject({
  pages: z
    .array(z.strictObject({ ...writeNodeSchema.shape, ops: strictWriteOpsSchema }))
    .min(1)
    .max(WRITE_MANY_MAX)
    .describe(
      'Pages to write in order (parents before their children), 50 at most; each item is a write input without ctx, e.g. {"path": "sav/fiches/garantie", "kind": "page", "title": "Garantie", "summary": "Ce que couvre la garantie.", "ops": [{"op": "set_markdown", "text": "<the markdown of the page>"}]}.',
    ),
})

/**
 * Le déplacement d'un nœud (E03-S07, AC14, P12) : un seul schéma pour la route
 * `POST /api/platform/nodes/move`, le formulaire « Déplacer… » d'E05-S02 et `moveNode`. Sans lui,
 * la route et le formulaire valideraient chacun leur chemin.
 */
export const moveNodeSchema = z.strictObject({
  // E11-S18 (AC-5) : aussi les arguments de `node.move`, décrits pour le contrat que `read` sert (`mcp-patterns.md § 3`).
  path: nodePathSchema.describe("Current path of the page, procedure, table or folder to move, e.g. ventes/relance_devis."),
  new_path: nodePathSchema.describe(
    "Path it moves to, e.g. ventes/procedures/relance_devis; its parent must exist. The pages under it follow, and the old paths still lead to it.",
  ),
})

export type MoveNodeInput = z.infer<typeof moveNodeSchema>

/** Un bloc tel que l'écran le lit (AC35) : id complet, référence servie, contenu, révision. */
export type BlockView = {
  id: string
  ref: string
  type: BlockType
  text: string | null
  data: Record<string, unknown>
  key: string | null
  position: number
  revision: number
  provenance: Record<string, unknown>
}

/** Un nœud complet pour l'écran de page (AC35, E05-S02) : sans plan servi ni plafond. */
export type NodeView = {
  id: string
  path: string
  title: string
  summary: string
  kind: NodeKind
  status: "draft" | "published"
  revision: number
  updatedAt: string
  updatedByName: string | null
  owner: { kind: "org" | "team" | "user"; teamName?: string; leadName?: string; userName?: string; you?: boolean }
  level: 1 | 2 | 3
  parent: { path: string; title: string } | null
  children: { path: string; title: string; summary: string; kind: NodeKind; status: "draft" | "published" }[]
  childrenTotal: number
  blocks: BlockView[]
  outline: { blockId: string; title: string; level: number; chars: number }[]
  draft: {
    baseRevision: number
    savedAt: string
    draftStamp: string
    blocks: BlockView[]
    title: string | null
    summary: string | null
    kind: "page" | "procedure" | null
    meta: Record<string, unknown> | null
  } | null
  meta: Record<string, unknown>
  /** Les lignes d'un tableau, comptées à la lecture du nœud (méta « <n> lignes », E07-S03 AC1) ; absent hors d'un tableau. */
  rowsTotal?: number
}

/** Un nœud de l'arbre des écrans (AC36) : triés par chemin, rattachés à l'ancêtre visible. */
export type TreeNode = { path: string; title: string; kind: NodeKind; status: "draft" | "published"; children: TreeNode[] }

/**
 * Le paramètre `version` de la page d'un nœud (E05-S02, AC9) : `published` (E11-S07) montre la version publiée à
 * un rédacteur ; toute autre valeur, ou son absence, le brouillon. Sans lui, la page lirait un
 * paramètre d'adresse sans schéma (`api-patterns.md § Search & Filter`).
 */
export const nodeVersionParamSchema = z.enum(["published"]).optional().catch(undefined)
