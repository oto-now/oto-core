// Le dépôt par lien à usage unique (E10-S02 lot f, ADR-018) : l'entrée d'`upload.link` (derrière `call`), la forme du
// jeton, les bornes d'un envoi et les adresses que le service rend, partagées par le service (`server/uploads.ts`), la
// porte sans session (`api/uploads.ts`) et le formulaire de dépôt (`ui/depot/`). Sans lui, chaque face tiendrait sa
// forme de jeton et sa borne de 1 Mo.
import * as z from "zod/v4"
import { PLATFORM_API_PREFIX } from "./api"
import { fileNameSchema } from "./files"
import { NODE_HEAD_MAX, nodePathSchema } from "./nodes"

/** Un jeton : 32 octets aléatoires en base64url, 43 caractères (ADR-018 § 2, AC-f3). */
export const UPLOAD_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

/**
 * 1 Mo par envoi (HN-E10S02-16), sous la borne de 4,5 Mo qu'un hébergement serverless pose au corps d'une requête : un
 * fichier plus gros se joint à l'écran.
 */
export const UPLOAD_BYTES_MAX = 1_048_576

/** 15 minutes et un envoi (ADR-018 § 2). */
export const UPLOAD_TTL_MINUTES = 15

/** La porte sans session où `curl` envoie le fichier : `<route>/<jeton>` (ADR-018 § 1). */
export const UPLOADS_ROUTE = `${PLATFORM_API_PREFIX}uploads`

/** La page du formulaire de dépôt de l'hôte : `<route>/<jeton>`, en anglais (AC-f15, E11-S07). */
export const UPLOAD_FORM_ROUTE = "/upload"

/**
 * La règle dite à l'assistant (AC-f2, AC-f16), une seule source : la description d'`upload.link`, le contrat de `write`
 * (`write.table`) et la description de `call` la citent.
 */
export const UPLOAD_RULE =
  "to put a file in a page, or a file that already exists on your disk, or more than 20,000 characters: with a shell, curl; without a shell, source_url; otherwise, give the person the form link"

export const UPLOAD_KINDS = ["file", "md", "csv"] as const

export type UploadKind = (typeof UPLOAD_KINDS)[number]

export const UPLOAD_MODES = ["create", "attach", "replace", "merge"] as const

export type UploadMode = (typeof UPLOAD_MODES)[number]

/** Les modes de chaque type (AC-f1) : `csv replace` n'existe pas (§ Hors périmètre). */
export const MODES_OF: Readonly<Record<UploadKind, readonly UploadMode[]>> = { file: ["create", "attach"], md: ["create", "replace"], csv: ["create", "merge"] }

const oneLine = z.string().trim().min(1).max(NODE_HEAD_MAX)

/**
 * L'entrée d'`upload.link` (AC-f1) : strict ; `mode`, `name`, `key` et `publish` contraints par `kind`, `title` et `summary`
 * exigés pour `create`, `base_revision` exigée hors `create`. Les droits, le chemin et la révision se décident dans le
 * service, avant toute écriture.
 */
export const uploadLinkSchema = z
  .strictObject({
    path: nodePathSchema.describe("The page or table to create, or the existing one, e.g. ventes/rapports/mars."),
    kind: z.enum(UPLOAD_KINDS).describe("file: a file attached to a page; md: a markdown file that becomes the content of a page; csv: rows imported into a table."),
    mode: z.enum(UPLOAD_MODES).describe("file: create (a new page holding the file) or attach (at the end of an existing page); md: create or replace (the whole content); csv: create or merge (rows matched on the key)."),
    name: fileNameSchema.optional().describe("Name of the file, e.g. rapport_mars.html; required for kind file, whose type its extension fixes (default: none)."),
    title: oneLine.optional().describe("Title of the page or table to create, 200 characters max; required for mode create (default: none)."),
    summary: oneLine.optional().describe("One-line summary of the page or table to create, 200 characters max; required for mode create (default: none)."),
    base_revision: z.number().int().min(0).optional().describe("Revision you read of the existing page or table; required for attach, replace and merge (default: none)."),
    key: oneLine.optional().describe("csv only: the column that identifies a row, as named on the header line (default: the key of the table; with create, the first text, whole-number, email or date column whose values are all present and distinct)."),
    publish: z.boolean().optional().describe("file and md only; no longer used: the file is published when it arrives, and false is ignored (default true)."),
    source_url: z
      .string()
      .trim()
      .min(1)
      .max(2_000)
      .optional()
      .describe("Without a shell: a public https address of the file, which the platform downloads now instead of giving a link (default: none)."),
  })
  .superRefine((args, context) => {
    const problem = (message: string, path: string) => context.addIssue({ code: "custom", message, path: [path] })
    if (!MODES_OF[args.kind].includes(args.mode)) problem(`mode ${args.mode} does not apply to kind ${args.kind}: ${MODES_OF[args.kind].join(" or ")}`, "mode")
    if (args.kind === "file" && args.name === undefined) problem("name is required for kind file", "name")
    if (args.kind !== "csv" && args.key !== undefined) problem("key applies to kind csv only", "key")
    if (args.kind === "csv" && args.publish !== undefined) problem("publish applies to kinds file and md only: a table is published by its import", "publish")
    if (args.mode === "create" && (args.title === undefined || args.summary === undefined)) problem("title and summary are required for mode create", args.title === undefined ? "title" : "summary")
    if (args.mode !== "create" && args.base_revision === undefined) problem(`base_revision is required for mode ${args.mode}`, "base_revision")
    if (args.mode === "create" && args.base_revision !== undefined) problem("base_revision applies to attach, replace and merge only", "base_revision")
  })

export type UploadLinkArgs = z.infer<typeof uploadLinkSchema>

/** Le formulaire de dépôt (AC-f15) : la destination d'un ticket de la personne, encore valable. */
export type UploadFormView = { path: string; kind: UploadKind; mode: UploadMode; name: string | null; expiresAt: string }

/** Ce qu'un envoi a écrit (AC-f8) : chemin, révision, état, adresse de la page, et ce que le type ajoute. */
export type UploadDone = {
  path: string
  revision: number
  status: "published" | "draft"
  url: string
  kept_as_text?: number
  file?: { id: string; name: string; size: number }
  rows?: { created: number; updated: number; unchanged: number }
}
