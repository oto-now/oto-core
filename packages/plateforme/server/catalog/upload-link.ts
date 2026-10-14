// `upload.link` (E10-S02 lot f : AC-f1, AC-f2, AC-f12 à AC-f14, AC-f16 ; ADR-018 ; fiches D117, D130), derrière `call`,
// sans outil ajouté (ADR-002) : un lien à usage unique où Claude Code envoie par `curl` un fichier qu'il a déjà, sans le
// réécrire dans la conversation ; pour un assistant sans shell, une adresse publique que la plateforme télécharge, sinon
// le formulaire de dépôt. Adaptateur fin : le ticket et l'envoi sont décidés par `server/uploads.ts`. Connecteur
// `upload`, classe `write` (HN-E10S02-20), origine `paquet` (HN-E10S02-15). Sans lui, un fichier de 1 Mo passerait par le
// modèle, ou pas du tout.
import {
  UPLOAD_BYTES_MAX,
  UPLOAD_RULE,
  uploadLinkSchema,
  type UploadLinkArgs,
} from "../../schemas"
import { FILTERED_ROWS_MAX } from "../../schemas/tables"
import { formatCount } from "../nodes/document"
import { BLOCKS_MAX, PAGE_MAX } from "../nodes/limits"
import { createUploadTicket, receiveUpload, uploadTokenHash, type IssuedTicket } from "../uploads"
import { fetchSource, textSourceFailure } from "../uploads-fetch"
import { defineFunction, type FunctionContext, type FunctionOutput } from "./define"

/** La phrase d'AC-f2, à l'identique dans le texte et les champs. */
export const UPLOAD_NOTE = "the link works once, for 15 minutes; the file never goes through this conversation"

/** Le fichier cité par les commandes : le nom donné, sinon la place où l'assistant écrit le sien. */
const FILE_PLACEHOLDER = "<file>"

/** Entre apostrophes pour bash : une apostrophe du nom ferme, s'échappe, rouvre. */
function bashQuoted(text: string): string {
  return `'${text.replaceAll("'", "'\\''")}'`
}

/** Entre guillemets pour PowerShell : l'accent grave échappe `"`, `$` et lui-même. */
function powershellQuoted(text: string): string {
  return `"${text.replace(/[`"$]/g, "`$&")}"`
}

/** Les deux commandes d'AC-f2 : bash, puis PowerShell (`curl.exe`, jamais l'alias `curl` de Windows PowerShell). */
export function uploadCommands(url: string, file: string): { bash: string; powershell: string } {
  return {
    bash: `curl -sS --fail-with-body --data-binary @${bashQuoted(file)} ${bashQuoted(url)}`,
    powershell: `curl.exe -sS --fail-with-body --data-binary ${powershellQuoted(`@${file}`)} ${powershellQuoted(url)}`,
  }
}

/** La limite du type demandé (AC-f2, AC-f7). */
function limitOf(args: UploadLinkArgs): string {
  const mb = `1 MB (${formatCount(UPLOAD_BYTES_MAX)} bytes)`
  if (args.kind === "md") return `${mb}, ${formatCount(PAGE_MAX)} characters and ${formatCount(BLOCKS_MAX)} blocks once read; UTF-8.`
  if (args.kind === "csv") return `${mb} and ${formatCount(FILTERED_ROWS_MAX)} lines; UTF-8, the header line first.`
  return `${mb}; its type comes from the extension of ${args.name ?? "name"}.`
}

/**
 * Le repli quand `curl` n'atteint pas l'adresse (FB-0013, HN-E10S02-119) : sans shell, ou un proxy qui répond 403 (celui
 * du shell de claude.ai). Un `.md` par `write`, un CSV par `table.import`, sinon le formulaire donné à la personne.
 */
function fallbackOf(kind: UploadLinkArgs["kind"]): string {
  if (kind === "md") return "send the markdown with write (one page, within its limits), or give the person this form link"
  if (kind === "csv") return "send the rows with table.import, or give the person this form link"
  return "give the person this form link to drop the file"
}

/** Le lien rendu (AC-f2) : adresse, expiration, commandes, limite et phrase, les mêmes éléments en texte et en champs. */
function linkOutput(issued: IssuedTicket, args: UploadLinkArgs): FunctionOutput {
  const commands = uploadCommands(issued.url, args.name ?? FILE_PLACEHOLDER)
  const limit = limitOf(args)
  const text = [
    `Upload link for ${issued.path} (${args.kind}, ${args.mode}): ${issued.url}`,
    `Expires at ${issued.expiresAt}: ${UPLOAD_NOTE}.`,
    `bash: ${commands.bash}`,
    `PowerShell: ${commands.powershell}`,
    `Limit: ${limit}`,
    `Without a shell, or if curl cannot reach this address (a proxy answers 403): ${fallbackOf(args.kind)}: ${issued.formUrl}`,
  ].join("\n")
  const data = { path: issued.path, kind: args.kind, mode: args.mode, url: issued.url, expires_at: issued.expiresAt, commands, limit, note: UPLOAD_NOTE, form_url: issued.formUrl }
  return { text, data }
}

/** Un téléchargement en échec (AC-f14) : un résultat, pas `isError` (HN-E10S02-103), la cause et le repli du type. */
function failedDownload(issued: IssuedTicket, args: UploadLinkArgs, reason: string): FunctionOutput {
  const fallback = fallbackOf(args.kind)
  const text = `Could not download the file: ${reason}. ${fallback.charAt(0).toUpperCase()}${fallback.slice(1)} (${UPLOAD_NOTE}): ${issued.formUrl}`
  return { text, data: { path: issued.path, download: "failed", reason, form_url: issued.formUrl, expires_at: issued.expiresAt } }
}

/**
 * `upload.link` (AC-f1) : le ticket, décidé comme l'envoi le sera ; avec `source_url` (AC-f12), le téléchargement contrôlé
 * puis l'envoi, comme par `curl` (même ticket, mêmes contrôles, même provenance) ; un téléchargement en échec, ou un `.md`
 * ou un CSV servi sous un type qui n'est pas du texte (HN-E10S02-118), rend sa cause et le repli (AC-f14), sans l'adresse
 * ni le contenu, le ticket libre pour le formulaire.
 */
async function runUploadLink(context: FunctionContext, args: UploadLinkArgs): Promise<FunctionOutput> {
  const issued = await createUploadTicket(context, args)
  if (args.source_url === undefined) return linkOutput(issued, args)
  const fetched = await fetchSource(args.source_url)
  if ("failure" in fetched) return failedDownload(issued, args, fetched.failure)
  const notText = args.kind === "file" ? null : textSourceFailure(fetched.type)
  if (notText !== null) return failedDownload(issued, args, notText)
  const origin = new URL(issued.url).origin
  const result = await receiveUpload(context.identity.org, { hash: uploadTokenHash(issued.token), via: "link", bytes: fetched.bytes, origin, userAgent: "upload.link source_url" })
  return { text: result.text, data: result.data }
}

export const uploadLink = defineFunction({
  name: "upload.link",
  connector: "upload",
  class: "write",
  origin: "paquet",
  description: `Gives a one-time link where you send a file: a file attached to a page (kind file), a markdown file that becomes the content of a page (kind md), or the rows of a CSV imported into a table (kind csv). Rule: ${UPLOAD_RULE}. The link works once, for 15 minutes, 1 MB at most; the file never goes through this conversation. Everything is decided now (write level, free or existing path, base_revision, storage for a file) and read again when the file arrives. Use this for a report, a minutes, an export or any file you already have; do not use it to write a short text (use write). If curl cannot reach this platform (a proxy answers 403) and no public address holds the file: a markdown file goes by write, a CSV by table.import, any other file by the form link (form_url) given to the person.`,
  schema: uploadLinkSchema,
  examples: [
    { path: "ventes/rapports/mars", kind: "file", mode: "create", name: "rapport_mars.html", title: "Rapport de mars", summary: "Le rapport des ventes de mars." },
    { path: "ventes/rapports", kind: "file", mode: "attach", name: "export.pdf", base_revision: 4 },
    { path: "conseil/cr_client", kind: "md", mode: "replace", base_revision: 2 },
    { path: "ventes/clients", kind: "csv", mode: "merge", base_revision: 1, key: "Nom", name: "clients.csv" },
    { path: "ventes/notes_salon", kind: "md", mode: "create", title: "Notes du salon", summary: "Les notes prises au salon.", source_url: "https://example.com/notes_salon.md" },
  ],
  refusals: [
    'create on a path already taken (conflict: "Path … is not available: … Choose another path."), under a missing parent (not_found), or without the write level on the parent (forbidden, with whom to ask).',
    "attach, replace or merge on an unknown path (not_found), a node of another kind (a file or a markdown file goes into a page, a CSV into a table), without the write level (forbidden), or with a base_revision that is not the current one (stale_revision).",
    "kind file on a platform without file storage (not_enabled), a name whose extension is not admitted, or files of the organisation beyond 10 GB (too_large).",
    "When the file arrives: the link unknown, expired or already used (not_found, the same answer), a request from a browser or by another method than POST (forbidden), more than 1 MB (too_large), a markdown file or a CSV that is not UTF-8, a markdown file that is an HTML page, a CSV that does not fit the table (invalid_arguments), or anything that changed since the link (rights, path, revision).",
    "The file storage failing (conflict, saying whether it could not be reached, refused the file or kept another size): nothing is attached, and a page created for the file is removed.",
    "source_url serving a markdown file or a CSV under a type that is not text (text/html): not downloaded; the cause and the fallback are given, the link stays free for the form.",
  ],
  next: [],
  run: runUploadLink,
  // Le lien n'a de sens que dans une conversation (HN-E10S02-23).
  checkArgs: async () => ["upload.link is called by an assistant, not by a procedure"],
})
