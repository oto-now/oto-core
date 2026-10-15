// Blocs du contenu (ADR-011 § 2, E01-S06) : les seize types, la clé d'un bloc, la forme minimale de
// `text` et de `data` par type, et la référence courte d'un bloc. Mêmes bornes que la base
// (`blocks_shape_check`, colonnes `text` et `key`), pas plus : le test de parité (AC36) confronte les
// deux. `position`, `revision`, `provenance`, `org_id` et l'identité sont posées par le service et la
// base : ils restent hors de ce schéma. `zod/v4` comme les autres schémas partagés (H21).
//
// Repris d'oto-frontend (`src/schemas/block.ts`, `ContentBlock`) : `id` fabriqué par le serveur,
// jamais par le client ; `items` ; `ordered` pour une étape numérotée ; les clés inconnues de `data`
// traversent sans perte. Retiré : `type` libre (liste fermée ici), `refs` servies et `content` d'un
// encart (→ bloc `reference`).
import * as z from "zod/v4"
import { FILE_MAX_BYTES } from "./files"
import { NODE_PATH_PATTERN } from "./nodes"

/** Les onze types de la V1, dans l'ordre du contrat d'E01-S06, puis ceux qu'une migration additive ajoute (E10-S04). */
export const BLOCK_TYPES = [
  "heading",
  "paragraph",
  "list",
  "checklist",
  "code",
  "call",
  "mermaid",
  "image",
  "callout",
  "reference",
  "row",
  "simple_table",
  "divider",
  "toggle",
  // E10-S02 : un fichier joint à la page (ADR-016).
  "file",
  // 1.4.3 : un cadre intégré, la page `https` d'un autre site montrée dans la page.
  "embed",
] as const

export const blockTypeSchema = z.enum(BLOCK_TYPES)

export type BlockType = z.infer<typeof blockTypeSchema>

/**
 * Longueur en caractères, comme `char_length` de Postgres : une paire de substitution compte pour un.
 * Exportée pour les tailles de `server/nodes/` (E03-S03), qui comptent comme la base.
 */
export function chars(value: string): number {
  return value.length - (value.match(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g)?.length ?? 0)
}

/**
 * `btrim` de Postgres sans second argument : il ne retire que les espaces, pas les tabulations. Par
 * boucle : l'expression ` +$` repart de chaque espace d'une longue suite, en temps quadratique
 * (5,4 s pour 100 000 caractères venus d'un client, E03-S03 ; `security-patterns.md § Validation des inputs`).
 */
function btrim(value: string): string {
  let start = 0
  let end = value.length
  while (start < end && value[start] === " ") start++
  while (end > start && value[end - 1] === " ") end--
  return value.slice(start, end)
}

const within = (min: number, max: number) => (value: string) => chars(value) >= min && chars(value) <= max

/** Texte de tout bloc : 100 000 caractères au plus (`blocks.text`). */
const blockText = z.string().refine(within(0, 100_000), "Text: 100 000 characters at most.")

/** Là où la base veut `text` nul (`list`, `checklist`, `call`, `reference`, `row`, `simple_table`, `divider`). */
const noText = z.null().optional()

/** `data` sans forme imposée : un objet. */
const anyData = z.record(z.string(), z.unknown())

/**
 * Clé d'un bloc (ancre lisible, clé métier d'une ligne) : 1 à 500 caractères, sans espace de bord
 * ni caractère de contrôle (`[[:cntrl:]]` de la base : U+0000 à U+001F, U+007F à U+009F).
 */
export const blockKeySchema = z
  .string()
  .refine(within(1, 500), "Key: 1 to 500 characters.")
  .refine((value) => btrim(value) === value, "Key: no leading or trailing space.")
  .refine((value) => !/\p{Cc}/u.test(value), "Key: no control character.")

const optionalKey = blockKeySchema.nullable().optional()

const heading = z.object({
  type: z.literal("heading"),
  text: blockText
    .refine((value) => within(1, 200)(btrim(value)), "Heading: 1 to 200 characters.")
    .refine((value) => !/[\r\n]/.test(value), "Heading: a single line."),
  // Cinq niveaux, `##` à `######` sous le titre du nœud (E10-S04, AC-b3).
  data: z.looseObject({ level: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]) }),
  key: optionalKey,
})

/**
 * Le marqueur d'un titre repliable de la 1.4.5 (`## Titre <!-- toggle -->`) : depuis que chaque titre se replie, il ne
 * s'écrit plus, et `parseMarkdown` le retire encore d'une ligne de titre, pour qu'il n'entre pas dans son texte.
 */
export const COLLAPSIBLE_MARKER = "<!-- toggle -->"

const paragraph = z.object({ type: z.literal("paragraph"), text: blockText, data: anyData.optional(), key: optionalKey })

/** Niveaux d'une liste imbriquée (E10-S04, AC-b1) : un élément de troisième niveau n'a plus d'enfants. */
export const LIST_DEPTH_MAX = 3

/**
 * Éléments d'une liste, sous-éléments compris (E10-S04, AC-b1) : une seule borne pour le schéma, l'analyse
 * (réexportée par `server/nodes/limits.ts`) et le contrôle de l'éditeur (`ui/noeud/editeur/operations.ts`).
 */
export const LIST_ITEMS_MAX = 500

/** La sous-liste d'un élément : ses éléments, puis sa numérotation, propre à son niveau. */
const childrenOf = <T extends z.ZodType>(item: T) =>
  z.strictObject({ items: z.array(item).min(1), ordered: z.boolean().optional(), start: z.number().min(1).optional() })

/** Un élément : sa chaîne (forme d'avant E10-S04), ou son texte et sa sous-liste ; toute autre clé est refusée. */
const itemWith = <T extends z.ZodType>(children: T) => z.union([z.string(), z.strictObject({ text: z.string(), children })])

/** Un élément de liste, sur trois niveaux au plus (E10-S04, AC-b1). */
export const listItemSchema = itemWith(childrenOf(itemWith(childrenOf(z.string()))))

export type ListItem = z.infer<typeof listItemSchema>

/**
 * Les textes des éléments d'une liste, sous-éléments compris, dans l'ordre de lecture ;
 * ce qui n'a pas la forme d'un élément est sauté, et rien n'est lu sous le troisième niveau. Lu par la
 * publication (liens), le contrôle des procédures et l'écran : sans lui, chacun parcourrait les
 * sous-éléments à sa façon.
 */
export function listItemTexts(items: unknown, level = 1): string[] {
  if (!Array.isArray(items) || level > LIST_DEPTH_MAX) return []
  return items.flatMap((item: unknown): string[] => {
    if (typeof item === "string") return [item]
    if (item === null || typeof item !== "object") return []
    const text = "text" in item && typeof item.text === "string" ? [item.text] : []
    const children = "children" in item && item.children !== null && typeof item.children === "object" && "items" in item.children ? item.children.items : null
    return [...text, ...listItemTexts(children, level + 1)]
  })
}

const list = z.object({
  type: z.literal("list"),
  text: noText,
  data: z
    .looseObject({
      items: z.array(listItemSchema).min(1).max(500),
      ordered: z.boolean().optional(),
      start: z.number().min(1).optional(),
    })
    .refine((data) => listItemTexts(data.items).length <= LIST_ITEMS_MAX, `List: ${LIST_ITEMS_MAX} items at most, sub-items included.`),
  key: optionalKey,
})

const checklist = z.object({
  type: z.literal("checklist"),
  text: noText,
  data: z.looseObject({ items: z.array(z.looseObject({ text: z.string(), checked: z.boolean() })).min(1).max(500) }),
  key: optionalKey,
})

const code = z.object({
  type: z.literal("code"),
  text: blockText,
  data: z.looseObject({ language: z.string().optional() }).optional(),
  key: optionalKey,
})

const call = z.object({
  type: z.literal("call"),
  text: noText,
  data: z.looseObject({ function: z.string().refine(within(1, 100), "Function: 1 to 100 characters."), args: anyData }),
  key: optionalKey,
})

const mermaid = z.object({
  type: z.literal("mermaid"),
  text: blockText.refine((value) => btrim(value) !== "", "Mermaid: not blank."),
  data: anyData.optional(),
  key: optionalKey,
})

/** L'identifiant d'un fichier joint, en minuscules comme la base le relit (`blocks_shape_check`, E10-S02). */
const fileId = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, "File: a lowercase uuid.")

/** Les largeurs d'une image (E10-S02, AC-b3) ; sans largeur, `full`. */
export const IMAGE_WIDTHS = ["small", "medium", "full"] as const

export type ImageWidth = (typeof IMAGE_WIDTHS)[number]

/** Une image : une adresse `https` externe, ou un fichier joint (E10-S02, AC-b1), jamais les deux ; sa largeur, facultative. */
const image = z.object({
  type: z.literal("image"),
  text: blockText.nullable().optional(),
  data: z
    .looseObject({
      src: z.string().refine(within(1, 2000), "Source: 1 to 2 000 characters.").optional(),
      file_id: fileId.optional(),
      alt: z.string().optional(),
      width: z.enum(IMAGE_WIDTHS).optional(),
    })
    .refine((data) => (data.src === undefined) !== (data.file_id === undefined), "Image: a source or a file, not both."),
  key: optionalKey,
})

/** Un fichier joint à la page (E10-S02, AC-b2) : son identifiant, son nom, sa taille (1 octet à 50 Mo) et son type. */
const file = z.object({
  type: z.literal("file"),
  text: noText,
  data: z.looseObject({
    file_id: fileId,
    name: z.string().refine(within(1, 255), "Name: 1 to 255 characters."),
    size: z.number().int().min(1).max(FILE_MAX_BYTES),
    mime: z.string().refine(within(1, 255), "Type: 1 to 255 characters."),
  }),
  key: optionalKey,
})

/** Les hauteurs d'un cadre intégré (1.4.3) ; sans hauteur, `medium`. */
export const EMBED_HEIGHTS = ["small", "medium", "large"] as const

export type EmbedHeight = (typeof EMBED_HEIGHTS)[number]

/** Ce qu'une adresse intégrée ne contient pas : un blanc, ou ce qui fermerait l'attribut `src` (`"`, `'`, `<`, `>`). */
const outOfUrl = (char: string) => char.trim() === "" || [`"`, "'", "<", ">"].includes(char)

/** L'adresse d'un cadre intégré : `https`, 9 à 2 000 caractères, sans blanc ni guillemet (`blocks_shape_check`). */
export const embedUrlSchema = z
  .string()
  .refine(within(9, 2000), "Embed: an address of 9 to 2 000 characters.")
  .refine((value) => value.startsWith("https://") && ![...value].some(outOfUrl), "Embed: an https address, without spaces nor quotes.")

/** Un cadre intégré (1.4.3) : la page `https` d'un autre site, montrée dans une iframe isolée ; sa hauteur, facultative. */
const embed = z.object({
  type: z.literal("embed"),
  text: noText,
  data: z.looseObject({ url: embedUrlSchema, height: z.enum(EMBED_HEIGHTS).optional() }),
  key: optionalKey,
})

const callout = z.object({
  type: z.literal("callout"),
  text: blockText,
  data: z.looseObject({ tone: z.string().optional() }).optional(),
  key: optionalKey,
})

const reference = z.object({
  type: z.literal("reference"),
  text: noText,
  data: z.looseObject({
    path: z.string().max(1000).regex(NODE_PATH_PATTERN, "Path: lowercase letters, digits and _ separated by /."),
    view: anyData.optional(),
  }),
  key: optionalKey,
})

/** Ligne d'un tableau : sa clé métier est obligatoire ; aucun type de cellule contrôlé ici (E07-S01). */
const row = z.object({ type: z.literal("row"), text: noText, data: anyData.optional(), key: blockKeySchema })

/** Bornes d'un tableau simple (E10-S04, AC-a1, HN-E10S04-3) : au-delà, c'est un tableau de données. */
export const SIMPLE_TABLE_COLUMNS_MAX = 20
export const SIMPLE_TABLE_ROWS_MAX = 200

/** Le résumé d'un repli, comme un titre : 200 caractères au plus, sans les espaces de bord (E10-S04, AC-a3). */
export const TOGGLE_SUMMARY_MAX = 200

/** Une ligne faite d'espaces et de tabulations : le bord d'un corps de repli, pour le schéma et l'analyse (`server/nodes/markdown-rich.ts`). */
export const isBlankLine = (line: string) => /^[ \t]*$/.test(line)

/** La ligne sans espaces ni tabulations de bord, par boucle (` +$` repartirait de chaque espace). */
export function trimBlanks(line: string): string {
  let start = 0
  let end = line.length
  while (start < end && (line[start] === " " || line[start] === "\t")) start++
  while (end > start && (line[end - 1] === " " || line[end - 1] === "\t")) end--
  return line.slice(start, end)
}

/**
 * Une cellule de tableau simple : une ligne, sans espace ni tabulation de bord, chaque `|` écrit `\|` (un `|`
 * précédé d'un nombre pair de `\` fermerait la cellule). Un parcours : chaque caractère lu une fois.
 */
function isCell(value: string): boolean {
  if (/[\r\n]/.test(value) || trimBlanks(value) !== value) return false
  for (let at = 0; at < value.length; at++) {
    if (value[at] === "\\") at++
    else if (value[at] === "|") return false
  }
  return true
}

const cell = z.string().refine(isCell, "Cell: one line, no leading or trailing blank, every | written \\|.")

/**
 * Les cellules d'un tableau simple, en-tête puis rangées, dans l'ordre ; ce qui n'est pas une chaîne est
 * sauté. Lu par la publication (liens), le contrôle des procédures et l'écran, comme `listItemTexts`.
 */
export function tableCells(data: Record<string, unknown>): string[] {
  const strings = (values: unknown) => (Array.isArray(values) ? values.filter((value): value is string => typeof value === "string") : [])
  return [...strings(data.columns), ...(Array.isArray(data.rows) ? data.rows.flatMap(strings) : [])]
}

export type SimpleTableAlign = "left" | "center" | "right" | null

/** Un tableau simple lu dans `data` (E10-S04, AC-a1) : l'en-tête, les rangées, l'alignement par colonne s'il y en a un. */
export type SimpleTable = { columns: string[]; rows: string[][]; align?: SimpleTableAlign[] }

/**
 * Le tableau simple d'un `data`, lu sans le valider : ce qui n'est pas un tableau se lit vide, une cellule qui n'est
 * pas une chaîne se lit `""`, un alignement inconnu `null`. Seul lecteur de l'écran (rendu, éditeur, conversion en
 * tableau de données) ; `tableCells` en garde la liste plate des publications.
 */
export function simpleTableOf(data: Record<string, unknown>): SimpleTable {
  const strings = (values: unknown) => (Array.isArray(values) ? values.map((value) => (typeof value === "string" ? value : "")) : [])
  const alignOf = (value: unknown): SimpleTableAlign => (value === "left" || value === "center" || value === "right" ? value : null)
  const table = { columns: strings(data.columns), rows: Array.isArray(data.rows) ? data.rows.map(strings) : [] }
  return Array.isArray(data.align) ? { ...table, align: data.align.map(alignOf) } : table
}

const simpleTable = z.object({
  type: z.literal("simple_table"),
  text: noText,
  data: z
    .looseObject({
      columns: z.array(cell).min(1).max(SIMPLE_TABLE_COLUMNS_MAX),
      rows: z.array(z.array(cell)).max(SIMPLE_TABLE_ROWS_MAX),
      align: z.array(z.enum(["left", "center", "right"]).nullable()).optional(),
    })
    .refine((data) => data.rows.every((cells) => cells.length === data.columns.length), "Table: every row has one cell per column.")
    .refine((data) => data.align === undefined || data.align.length === data.columns.length, "Table: one alignment per column."),
  key: optionalKey,
})

const divider = z.object({ type: z.literal("divider"), text: noText, data: anyData.optional(), key: optionalKey })

/**
 * Une ligne qui, blancs de bord retirés, ouvre un repli (`<details…`) ou le ferme (`</details>`) : dans un corps de
 * repli, relue, elle fermerait le repli ou en ouvrirait un autre. Lue par le schéma, l'analyse
 * (`server/nodes/markdown-rich.ts`) et le contrôle de l'éditeur (`ui/noeud/editeur/operations.ts`).
 */
export function isToggleFence(line: string): boolean {
  const trimmed = trimBlanks(line)
  return trimmed.startsWith("<details") || trimmed === "</details>"
}

/** Le corps d'un repli : vide, ou sans ligne blanche en tête ni en fin, et sans ligne qui ouvre ou ferme un repli. */
function isToggleBody(value: string): boolean {
  if (value === "") return true
  const lines = value.split("\n")
  if (isBlankLine(lines[0]) || isBlankLine(lines[lines.length - 1])) return false
  return !lines.some(isToggleFence)
}

const toggle = z.object({
  type: z.literal("toggle"),
  text: blockText.refine(isToggleBody, "Toggle: no blank first or last line, no <details> or </details> line."),
  data: z.looseObject({
    summary: z
      .string()
      .refine((value) => within(1, TOGGLE_SUMMARY_MAX)(btrim(value)), "Summary: 1 to 200 characters.")
      .refine((value) => !/[\r\n]/.test(value), "Summary: a single line."),
  }),
  key: optionalKey,
})

/** Un bloc à écrire : `text`, `data` et `key` selon son type (contrat d'E01-S06, § 2). */
export const blockInputSchema = z.discriminatedUnion("type", [
  heading,
  paragraph,
  list,
  checklist,
  code,
  call,
  mermaid,
  image,
  callout,
  reference,
  row,
  simpleTable,
  divider,
  toggle,
  file,
  embed,
])

export type BlockInput = z.infer<typeof blockInputSchema>

/**
 * Référence courte d'un bloc (ADR-011 § 5) : sa clé, sinon les 8 premiers caractères hexadécimaux
 * de son `id`. Elle se résout dans un nœud et un état : la clé exacte d'abord, puis le préfixe d'`id`
 * s'il est unique (E03-S03).
 */
export function blockRef(block: { id: string; key: string | null }): string {
  return block.key ?? block.id.replace(/-/g, "").slice(0, 8)
}
