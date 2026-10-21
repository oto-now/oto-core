// « Voir » un fichier joint (E10-S02 lot c : AC-c2, AC-c5 ; ADR-017) : ce que la visionneuse montre d'un fichier `html`
// ou `md` joint au nœud de l'adresse, le `.md` lu en blocs (mode tolérant d'E10-S01), et la lecture par redirection
// d'un fichier d'un lien public. Chaque refus est décidé ici, avant la lecture de l'objet (`security-patterns.md
// § Droits dans le service`) : la lecture du nœud dans l'organisation (`readableFile`), la décision de
// `public_file_by_token` hors session (`readPublicFile`) ; puis le fichier au nœud de l'adresse et le type vu. Tout ce
// qui n'est pas servi rend la même réponse `not_found`. Sans lui, « Voir » d'un `html` ou d'un `md` n'aurait rien à
// montrer, ni un visiteur d'un lien de quoi lire un fichier.
import { fileReadQuerySchema, fileTypeOf, type FileMarkdown, type FileView, type ViewedBlock } from "../../schemas"
import type { PlatformDb } from "../db"
import { invalidInput, PlatformError } from "../errors"
import type { Identity } from "../identity"
import { parseMarkdown } from "../nodes/markdown-parse"
import { readPublicFile, type PublicFile } from "../shares"
import { fileOrigin } from "./origin"
import { objectText, onStorage, readableFile, readResponse, requireStore, unknownFile } from "./service"
import { objectKey } from "./store"

/** Le type vu d'un nom (AC-c2) : `html` ou `md`, sinon `null`. */
function viewedType(name: string): "html" | "md" | null {
  const type = fileTypeOf(name)
  return type === "html" || type === "md" ? type : null
}

/**
 * Les blocs d'un `.md` (AC-c2) : l'analyse du mode tolérant d'E10-S01, qui ne refuse rien ; un texte qu'elle ne sait
 * même pas garder en blocs se montre entier, en un bloc de code (HN-E10S02-57).
 */
function markdownBlocks(text: string): ViewedBlock[] {
  const parsed = parseMarkdown(text, { tolerant: true })
  if ("problem" in parsed) return [{ type: "code", text, data: {} }]
  return parsed.blocks.map((block) => ({ type: block.type, text: block.text ?? null, data: block.data ?? {} }))
}

/**
 * Le fichier que montre la visionneuse d'un nœud (AC-c2) : un fichier `ready` joint à ce nœud, que l'appelant lit, de
 * type `html` ou `md` ; un `.md` avec ses blocs. Inconnu, `pending`, d'un autre nœud, d'une autre organisation, d'un
 * autre type ou illisible : `not_found`, la même réponse ; stockage absent : `not_enabled` ; un `.md` qui n'est pas de
 * l'UTF-8 : `invalid_arguments`, raison `not_utf8`. Un `html` n'est pas lu ici : l'iframe le lit par sa route isolée.
 */
export async function fileView(db: PlatformDb, identity: Identity, input: { node: string; file: unknown }): Promise<FileView> {
  const store = requireStore()
  const file = await readableFile(db, identity, input.file)
  const type = viewedType(file.name)
  if (file.node_id !== input.node || type === null) throw unknownFile()
  const shown = { id: file.id, name: file.name, size: file.size, path: file.path, origin: await fileOrigin(db, identity, file.id) }
  if (type === "html") return { ...shown, type }
  return { ...shown, type, blocks: markdownBlocks(await objectText(store, identity.org.id, file)) }
}

/** `GET files/<id>/markdown` (AC-c2) : le nom d'un `.md` que l'appelant lit, et ses blocs ; tout autre fichier : `not_found`. */
export async function fileMarkdown(db: PlatformDb, identity: Identity, fileId: unknown): Promise<FileMarkdown> {
  const store = requireStore()
  const file = await readableFile(db, identity, fileId)
  if (viewedType(file.name) !== "md") throw unknownFile()
  return { name: file.name, blocks: markdownBlocks(await objectText(store, identity.org.id, file)) }
}

/** Le même refus qu'une lecture publique introuvable (`readPublicFile`). */
function publicNotFound(): PlatformError {
  return new PlatformError("not_found", "Not found.")
}

/** Un fichier d'un lien public, de type `html` ou `md` (le type demandé seul, s'il est donné) ; sinon `not_found`. */
async function publicViewed(host: string | null, token: string, fileId: string, only?: "html" | "md"): Promise<PublicFile & { type: "html" | "md" }> {
  const file = await readPublicFile(host, token, fileId)
  const type = viewedType(file.name)
  if (type === null || (only !== undefined && type !== only)) throw publicNotFound()
  return { ...file, type }
}

/**
 * Le fichier que montre la visionneuse d'une page publique (AC-c5) : sous la décision de `public_file_by_token`, joint
 * au contenu de l'adresse (`path`, son chemin courant), de type `html` ou `md`. Tout autre cas : `not_found`.
 */
export async function publicFileView(host: string | null, token: string, input: { path: string; file: string }): Promise<FileView> {
  const store = requireStore()
  const file = await publicViewed(host, token, input.file)
  if (file.nodePath !== input.path) throw publicNotFound()
  const shown = { id: file.id, name: file.name, size: file.size, path: file.nodePath }
  if (file.type === "html") return { ...shown, type: "html" }
  return { ...shown, type: "md", blocks: markdownBlocks(await objectText(store, file.orgId, file)) }
}

/** `GET public/<jeton>/files/<id>/markdown` (AC-c5) : un `.md` que le lien sert, et ses blocs. */
export async function publicFileMarkdown(host: string | null, token: string, fileId: string): Promise<FileMarkdown> {
  const store = requireStore()
  const file = await publicViewed(host, token, fileId, "md")
  return { name: file.name, blocks: markdownBlocks(await objectText(store, file.orgId, file)) }
}

/** Le texte d'un fichier `html` qu'un lien public sert (AC-c5), pour sa route isolée (`files/html.ts`). */
export async function publicHtmlText(host: string | null, token: string, fileId: string): Promise<string> {
  const store = requireStore()
  const file = await publicViewed(host, token, fileId, "html")
  return objectText(store, file.orgId, file)
}

/**
 * `GET public/<jeton>/files/<id>` (AC-c5, AC-e1) : l'URL présignée de 60 s d'un fichier qu'un lien sert, au type et à la
 * disposition de la lecture d'une personne connectée (`readResponse`, AC-a5).
 */
export async function publicFileReadUrl(host: string | null, token: string, fileId: string, query: Record<string, string>): Promise<string> {
  const parsed = fileReadQuerySchema.safeParse(query)
  if (!parsed.success) throw invalidInput(parsed.error)
  const store = requireStore()
  const file = await readPublicFile(host, token, fileId)
  return onStorage("read url", () => store.readUrl(objectKey(file.orgId, file.id), readResponse(file, parsed.data.disposition === "inline")))
}
