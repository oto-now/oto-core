// Transfert d'une arborescence d'un MCP Oto à un autre (export et import, `node.export_tree` et `node.import_tree`) :
// les arguments des deux fonctions et le format pivot qui voyage entre elles, une URL signée que la plateforme
// destinataire télécharge elle-même. Sans lui, déplacer une base de connaissances d'une organisation à l'autre passerait
// par l'assistant, page par page, et un tableau y perdrait son schéma et ses preuves.
import * as z from "zod/v4"
import { nodeKindSchema, nodePathSchema, NODE_HEAD_MAX } from "./nodes"
import { tableHeaderSchema } from "./tables"

/** Le nom et la version du format pivot : un import refuse tout autre format qu'il ne sait pas lire. */
export const TREE_FORMAT = "oto-tree"
export const TREE_FORMAT_VERSION = 1

/** Racines au plus par export, nœuds au plus par arbre exporté ou importé. */
export const TREE_ROOTS_MAX = 20
export const TREE_NODES_MAX = 2_000

/** Fichiers joints au plus par export, chacun relu par l'import à son URL signée. */
export const TREE_FILES_MAX = 1_000

/** L'URL d'un export : une heure, relue autant de fois que l'import le demande. */
export const TREE_EXPORT_URL_SECONDS = 3_600

/** Octets au plus d'un arbre lu par l'import (pivot, ZIP, `.md` ou CSV), téléchargé par la plateforme. */
export const TREE_IMPORT_BYTES_MAX = 25 * 1024 * 1024

/** Les formats lus par l'import ; `auto` les reconnaît au type servi, au nom ou au contenu. */
export const TREE_IMPORT_FORMATS = ["auto", "json", "zip", "md", "csv"] as const
export type TreeImportFormat = (typeof TREE_IMPORT_FORMATS)[number]

/** Ce que fait l'import d'un chemin déjà pris à la destination. */
export const TREE_COLLISIONS = ["overwrite", "skip", "suffix"] as const
export type TreeCollision = (typeof TREE_COLLISIONS)[number]

export const treeExportArgsSchema = z.strictObject({
  paths: z
    .array(nodePathSchema)
    .min(1)
    .max(TREE_ROOTS_MAX)
    .describe("The roots to export, each with everything under it, e.g. [\"sav\"] or [\"sav/fiches\", \"sav/procedures\"]; 20 at most."),
  format: z
    .enum(["json", "zip"])
    .optional()
    .describe("json: the pivot, faithful (blocks, table headers, rows and their proofs), for another Oto platform; zip: one .md per page and one .csv per table, for a person (default json)."),
})

export type TreeExportArgs = z.infer<typeof treeExportArgsSchema>

export const treeImportArgsSchema = z.strictObject({
  source_url: z
    .string()
    .trim()
    .min(1)
    .max(4_000)
    .describe("The https address of the tree to import: the url given by node.export_tree on another Oto platform, a public .zip, .md, .csv or pivot .json, or the address of a file attached to a page here (read gives it)."),
  parent: nodePathSchema.describe("The existing page the tree goes under, e.g. csm_sav or csm_sav/base_connaissances."),
  root_folder: z
    .boolean()
    .optional()
    .describe("true: each exported root is created under parent (sav goes to parent/sav); false: the content of each root goes directly under parent, the root page itself not created (default true)."),
  collision: z
    .enum(TREE_COLLISIONS)
    .optional()
    .describe("A path already taken: overwrite updates it (same kind only), skip leaves it as it is, suffix creates the node next to it (_2, _3…) (default skip, which also resumes an interrupted import)."),
  format: z.enum(TREE_IMPORT_FORMATS).optional().describe("The format of the source, when its address does not say it (default auto)."),
  continue_from: z
    .string()
    .trim()
    .min(1)
    .max(4_000)
    .optional()
    .describe("The value given by a previous answer that stopped before the end (time limit): the import goes on from there, with the same other arguments (default: from the start)."),
})

export type TreeImportArgs = z.infer<typeof treeImportArgsSchema>

// ------------------------------------------------------------------------------------- Pivot

/** Un bloc du pivot : sa forme publiée (type, texte, données, clé), sans identifiant ni provenance. */
const pivotBlockSchema = z.strictObject({
  type: z.string(),
  text: z.string().nullable(),
  data: z.record(z.string(), z.unknown()),
  key: z.string().nullable(),
})

export type PivotBlock = z.infer<typeof pivotBlockSchema>

const pivotCellSchema = z.union([z.string(), z.number(), z.boolean()])

/** Une ligne d'un tableau : ses valeurs, ses vides vérifiés et la preuve de chaque valeur (commentaire ou lien). */
const pivotRowSchema = z.strictObject({
  key: z.union([z.string(), z.number()]),
  set: z.record(z.string(), pivotCellSchema),
  verified_empty: z.array(z.strictObject({ column: z.string(), reason: z.string() })).optional(),
  proofs: z.record(z.string(), z.strictObject({ comment: z.string().optional(), link: z.string().optional() })).optional(),
})

export type PivotRow = z.infer<typeof pivotRowSchema>

const pivotNodeSchema = z.strictObject({
  /** Relatif : le nom de sa racine, puis le chemin sous elle (`sav`, `sav/fiches/garantie`). */
  path: nodePathSchema,
  kind: nodeKindSchema,
  title: z.string().min(1).max(NODE_HEAD_MAX),
  summary: z.string().max(NODE_HEAD_MAX),
  blocks: z.array(pivotBlockSchema).optional(),
  table: z.strictObject({ header: tableHeaderSchema, rows: z.array(pivotRowSchema) }).optional(),
})

export type PivotNode = z.infer<typeof pivotNodeSchema>

/**
 * Un fichier joint qu'un bloc exporté cite (`file`, image jointe) : son identifiant à la source, celui que le bloc porte,
 * et l'URL signée où l'import relit ses octets, valable aussi longtemps que celle de l'export.
 */
const pivotFileSchema = z.strictObject({
  id: z.uuid(),
  name: z.string().min(1).max(255),
  size: z.number().int().min(0),
  url: z.string().max(4_000),
})

export type PivotFile = z.infer<typeof pivotFileSchema>

export const treePivotSchema = z.strictObject({
  format: z.literal(TREE_FORMAT),
  version: z.literal(TREE_FORMAT_VERSION),
  exported_at: z.string(),
  /** L'organisation source : son slug, son adresse, et le préfixe de ses outils, que l'import remplace dans les textes. */
  source: z.strictObject({ org: z.string(), origin: z.string().optional(), prefix: z.string().optional() }),
  /** Chaque racine : son chemin à la source, absolu, et le nom qu'elle porte dans `nodes` ; un lien vers elle ou sous elle se recolle à l'import. */
  roots: z.array(z.strictObject({ path: nodePathSchema, name: nodePathSchema })).min(1).max(TREE_ROOTS_MAX),
  nodes: z.array(pivotNodeSchema).max(TREE_NODES_MAX),
  files: z.array(pivotFileSchema).max(TREE_FILES_MAX).optional(),
})

export type TreePivot = z.infer<typeof treePivotSchema>
