// `node.export_tree` et `node.import_tree`, derrière `call`, sans outil ajouté (ADR-002) : une arborescence passe d'un
// MCP Oto à un autre par une URL signée que la plateforme destinataire télécharge elle-même. L'assistant ne fait que
// relayer l'adresse : aucun contenu ne passe par la conversation, aucune borne de volume ne lui revient. Adaptateurs fins
// : la lecture est dans `collect.ts`, les formats dans `formats.ts`, l'écriture dans `import.ts`, les fichiers joints et la
// purge des exports expirés dans `files.ts`.
import { strToU8 } from "fflate"
import { fileExtension } from "../../schemas/csv"
import {
  TREE_EXPORT_URL_SECONDS,
  TREE_IMPORT_BYTES_MAX,
  treeExportArgsSchema,
  treeImportArgsSchema,
  type TreeImportArgs,
} from "../../schemas/tree-transfer"
import { defineFunction, type FunctionContext, type FunctionOutput } from "../catalog/define"
import { PlatformError } from "../errors"
import { boundedBytes, onStorage, readableFile, requireStore } from "../files/service"
import { fileStore, objectKey } from "../files/store"
import { fileIdOfUrl } from "../nodes/markdown-files"
import { fetchSource } from "../uploads-fetch"
import { collectTree, type ExportReport } from "./collect"
import { exportKey, purgeExpiredExports, treeFetchDeps } from "./files"
import { detectFormat, importPlan, pivotZip } from "./formats"
import { reportLines, runImport, type ImportReport } from "./import"

/** Les lignes d'une liste nommée du rapport, ou rien quand elle est vide. */
function section(title: string, items: readonly string[]): string[] {
  return items.length === 0 ? [] : [`${title} (${items.length}):`, ...reportLines(items).map((item) => `- ${item}`)]
}

function exportText(url: string, nodes: number, format: string, report: ExportReport): string {
  return [
    `Exported ${nodes} node(s) as ${format}. Give this address to node.import_tree on the other platform (it downloads it itself; valid 1 hour, readable several times): ${url}`,
    ...section("Links outside the export, left as they are", report.orphans.map((orphan) => `${orphan.from} → ${orphan.to}`)),
    ...section("Left out", report.skipped.map((skipped) => `${skipped.path}: ${skipped.reason}`)),
    ...section("Attached files not carried (only their mention travels; a zip carries none)", report.files.map((file) => `${file.from}: ${file.name}`)),
  ].join("\n")
}

async function runExport(context: FunctionContext, args: { paths: string[]; format?: "json" | "zip" }): Promise<FunctionOutput> {
  const store = requireStore()
  await purgeExpiredExports(store, context.identity.org.id)
  const format = args.format ?? "json"
  const { pivot, report } = await collectTree(context.db, context.identity, args.paths, { origin: context.origin, store: format === "json" ? store : null })
  const bytes = format === "zip" ? pivotZip(pivot) : strToU8(JSON.stringify(pivot))
  const name = `${pivot.roots.map((root) => root.name).join("_").slice(0, 80)}.${format}`
  const key = exportKey(context.identity.org.id, format)
  const mime = format === "zip" ? "application/zip" : "application/json"
  try {
    await store.put(key, bytes, mime)
  } catch (error) {
    console.error("[platform] node.export_tree: storage put failed", error)
    throw new PlatformError("conflict", "The file storage did not keep the export: try again in a moment.")
  }
  const url = await store.readUrl(key, { contentType: mime, disposition: `attachment; filename="${name}"`, seconds: TREE_EXPORT_URL_SECONDS })
  const data = {
    url,
    format,
    nodes: pivot.nodes.length,
    bytes: bytes.byteLength,
    expires_in_seconds: TREE_EXPORT_URL_SECONDS,
    roots: pivot.roots,
    orphans: report.orphans,
    skipped: report.skipped,
    files: pivot.files?.length ?? 0,
    files_left: report.files,
  }
  return { text: exportText(url, pivot.nodes.length, format, report), data, next: ["node.import_tree"] }
}

export const nodeExportTree = defineFunction({
  name: "node.export_tree",
  connector: "node",
  class: "read",
  origin: "paquet",
  description:
    "Exports one or several roots, each with everything under it that you can read, to a signed address valid one hour: json is the faithful pivot (pages and procedures with their typed blocks, tables with their header, rows and the proof of each value), meant for node.import_tree on another Oto platform; zip gives one .md per page and one .csv per table, for a person. Use it to copy a knowledge base, a team folder or a set of procedures to another organisation: give the address to node.import_tree there; the content never goes through this conversation. Links to pages outside the export are kept as they are and listed; json carries the attached files, zip only their mention. In French: exporter, sauvegarder, transférer une arborescence.",
  schema: treeExportArgsSchema,
  examples: [{ paths: ["sav"] }, { paths: ["sav/fiches", "sav/procedures"], format: "zip" }],
  refusals: [
    "An unknown root, or one you cannot read; a root under another root of the same call; two roots with the same last segment (export their common parent).",
    "More than 2,000 nodes (export the folders one by one); a platform without file storage (not_enabled).",
  ],
  next: ["node.import_tree"],
  run: runExport,
  checkArgs: async () => ["node.export_tree is called by an assistant, not by a procedure"],
})

/** Le nom de fichier d'une adresse : son dernier segment, sans requête. */
function fileNameOf(address: string): string {
  try {
    const path = new URL(address).pathname
    return decodeURIComponent(path.slice(path.lastIndexOf("/") + 1))
  } catch {
    return ""
  }
}

function importText(run: Awaited<ReturnType<typeof runImport>>, args: TreeImportArgs): string {
  const report: ImportReport = run.report
  const head = run.next
    ? `Import under ${args.parent} stopped at step ${run.done} of ${run.total} (time limit): call node.import_tree again with the same arguments and continue_from "${run.next}".`
    : `Import under ${args.parent} done: ${report.created.length} created, ${report.updated.length} updated, ${report.skipped.length} kept as they were, ${report.refused.length} refused.`
  return [
    head,
    ...section("Created", report.created),
    ...section("Updated", report.updated),
    ...section("Kept as they were", report.skipped.map((item) => `${item.path}: ${item.reason}`)),
    ...section("Refused", report.refused.map((item) => `${item.path}: ${item.reason}`)),
    ...section("Kept as drafts, their publication refused (fix them, then publish)", report.drafts.map((item) => `${item.path}: ${item.reason}`)),
    ...section("Links outside the imported tree, left as they are", report.orphans.map((orphan) => `${orphan.from} → ${orphan.to}`)),
    ...report.notes,
  ].join("\n")
}

export { setTreeFetchDeps, type TreeFetchDeps } from "./files"

/**
 * Les octets de la source : un fichier joint à une page de cette plateforme (l'adresse que `read` donne d'un fichier) est
 * lu dans son stockage, sous le droit de lecture de sa page ; toute autre adresse est téléchargée, avec les gardes de
 * `fetchSource`. Le fichier joint est la voie d'un arbre posé sur le disque de la personne : joint à l'écran ou par
 * `upload.link`, puis importé, et relu à chaque `continue_from`.
 */
async function sourceOf(context: FunctionContext, address: string): Promise<{ bytes: Uint8Array; type: string | null; name: string }> {
  const fileId = fileIdOfUrl(address)
  if (fileId !== null) {
    const store = requireStore()
    const file = await readableFile(context.db, context.identity, fileId)
    const url = await onStorage("read url", () => store.readUrl(objectKey(context.identity.org.id, file.id), { contentType: "application/octet-stream", disposition: "attachment" }))
    return { bytes: await boundedBytes(url, file.name, TREE_IMPORT_BYTES_MAX), type: null, name: file.name }
  }
  const fetched = await fetchSource(address, { ...treeFetchDeps(), maxBytes: TREE_IMPORT_BYTES_MAX, timeoutMs: 30_000 })
  if ("failure" in fetched) throw new PlatformError("invalid_arguments", `Could not download the source: ${fetched.failure}. Export it again (an export address lasts one hour), or give another address.`)
  return { bytes: fetched.bytes, type: fetched.type, name: fileNameOf(address) }
}

async function runImportTree(context: FunctionContext, args: TreeImportArgs): Promise<FunctionOutput> {
  await purgeExpiredExports(fileStore(), context.identity.org.id)
  const fetched = await sourceOf(context, args.source_url)
  const name = fetched.name
  const format = detectFormat(args.format ?? "auto", fetched.bytes, fetched.type, name)
  const plan = importPlan(format, fetched.bytes, name || `import.${fileExtension(name) || format}`)
  const run = await runImport(context, plan, { ...args, source: name || "node.import_tree" })
  const data = {
    parent: args.parent,
    format,
    done: run.done,
    total: run.total,
    ...(run.next ? { continue_from: run.next } : {}),
    created: run.report.created,
    updated: run.report.updated,
    skipped: run.report.skipped,
    refused: run.report.refused,
    drafts: run.report.drafts,
    orphans: run.report.orphans,
  }
  return { text: importText(run, args), data, next: ["node.import_tree"] }
}

export const nodeImportTree = defineFunction({
  name: "node.import_tree",
  connector: "node",
  class: "write",
  origin: "paquet",
  description:
    "Imports a tree under an existing page, from an https address the platform downloads itself: the address node.export_tree gave on another Oto platform (json, faithful: blocks, table headers, rows and proofs, attached files), or a .zip (folders become parent pages, .md files pages, .csv files tables; a folder's page is <folder>.md next to it or <folder>/index.md), a single .md (one page) or a single .csv (one table, columns inferred); or the address of a file attached to a page of this platform, as read gives it. Links between imported pages follow their new paths. A path already taken: skip (default) keeps it unless it is empty, overwrite updates it (same kind), suffix puts the imported root next to it. Use it after node.export_tree, or to bring a folder of markdown files; for a file on the person's disk, attach it to a page first (on screen, or upload.link kind file), then pass the address of that file. A long import answers continue_from: call again with it. In French: importer, restaurer, greffer une arborescence.",
  schema: treeImportArgsSchema,
  examples: [
    { source_url: "https://storage.example.com/exports/sav.json?X-Amz-Signature=…", parent: "csm_sav" },
    { source_url: "https://example.com/base.zip", parent: "csm_sav/base_connaissances", root_folder: false, collision: "overwrite" },
  ],
  refusals: [
    "source_url that cannot be downloaded (not https, private address, more than 25 MB, expired export): export it again; the address of an attached file you cannot read (not_found).",
    "A source that is not an Oto tree, a readable zip, a markdown file or a CSV; a CSV whose quote is never closed.",
    "An unknown parent, or one you cannot read. Each node: the refusals of write and table.write (rights under the parent, kind of an existing node, a row the table refuses), listed in the report while the others are imported.",
  ],
  next: [],
  run: runImportTree,
  checkArgs: async () => ["node.import_tree is called by an assistant, not by a procedure"],
})
