// Les fichiers qu'une fonction décrite envoie à un tiers (`connecteurs-et-comptes.md` § Fichiers envoyés à un tiers) :
// `request.files` associe une partie d'un corps `multipart/form-data` à l'argument qui porte l'identifiant d'un fichier
// de l'appelant : en transit et à lui, ou joint à une page qu'il lit. Le moteur lit ses octets sous l'identité de
// l'appelant (`readCallerBytes`), les envoie au nom et au type du fichier, et ne consomme (`expireTransitFile`) qu'un
// fichier en transit, après un appel réussi ; un fichier joint n'est jamais consommé. Sans ce module, un dépôt
// chez un tiers ferait passer les octets par l'agent. Le contenu d'un fichier n'est jamais rendu, journalisé ni cité
// dans une erreur ; un log ne nomme que la fonction.
import type { FunctionContext } from "../catalog/define"
import { PlatformError } from "../errors"
import { FILE_ADDRESS, type TransitFile } from "../../schemas"
import { readCallerBytes, type CallerBytes } from "../files/caller-file"
import { expireTransitFile, storeTransitFile } from "../files/transit"
import { isJsonObject } from "../json"
import { bodyTable } from "./body-argument"
import type { ConnectorFunctionDefinition } from "./definition"
import type { RawBody } from "./http"

/**
 * Les fichiers de l'appelant, tels que le moteur les lit (en transit, ou joints à une page qu'il lit), consomme ceux en
 * transit, et range celui qu'une fonction rend (`keep`, `connecteurs-et-comptes.md` § Fichiers rendus par un tiers).
 */
export type TransitFiles = {
  /** L'adresse des fichiers de l'appelant (`<origine>/f`, relative sans origine), où se lit celui qu'une fonction rend. */
  route: string
  read(id: unknown): Promise<CallerBytes>
  consume(id: string): Promise<void>
  keep(file: { name: string; bytes: Uint8Array }): Promise<TransitFile>
}

/**
 * Les fichiers de la personne qui appelle, sous son identité : ses fichiers en transit, jamais ceux d'un autre, et les
 * fichiers joints aux pages qu'elle lit. Celui que la fonction
 * `fn` rend porte son origine : la fonction et la conversation de l'appel.
 */
export function callerTransitFiles(context: Pick<FunctionContext, "db" | "identity" | "origin" | "ctx">, fn: string): TransitFiles {
  return {
    route: `${context.origin ?? ""}${FILE_ADDRESS}`,
    read: (id) => readCallerBytes(context.db, context.identity, id),
    consume: (id) => expireTransitFile(context.db, context.identity, id),
    keep: (file) => storeTransitFile(context.db, context.identity, { ...file, origin: { kind: "function", function: fn, ctx: context.ctx ?? null } }),
  }
}

/** Les méthodes qui envoient un corps multipart. */
const FILE_METHODS = ["POST", "PUT", "PATCH"]

/**
 * Le problème des parties fichier d'une fonction, comme la fabrique le contrôle (règle 14) ; `null` : aucun. Une
 * méthode qui envoie un corps, sans pagination ; chaque argument fichier, déclaré en texte, n'est ni encodé ni placé
 * ailleurs ; un nom de partie fichier n'est ni une entrée ni une constante du corps.
 */
export function filesProblem(fn: ConnectorFunctionDefinition): string | null {
  const files = fn.request.files
  if (files === undefined) return null
  if (!isJsonObject(files) || Object.keys(files).length === 0) return `${fn.name}: request.files must map at least one part to an argument.`
  if (!FILE_METHODS.includes(fn.request.method)) return `${fn.name}: request.files needs a method that sends a body (${FILE_METHODS.join(", ")}).`
  if (fn.pagination !== undefined) return `${fn.name}: a function that sends files is not paginated.`
  const properties = isJsonObject(fn.schema.properties) ? fn.schema.properties : {}
  const spec = fn.request
  const elsewhere = [...spec.pathParams, ...Object.values(spec.query), ...Object.values(bodyTable(spec)), ...Object.values(spec.headers)]
  const texts = [...Object.keys(bodyTable(spec)), ...Object.keys(spec.constants?.body ?? {})]
  for (const [part, argument] of Object.entries(files)) {
    const property = properties[argument]
    if (!isJsonObject(property) || property.type !== "string") return `${fn.name}: file argument ${argument} must be declared as a string (the id of a transit file).`
    if (elsewhere.includes(argument) || spec.encode?.[argument] !== undefined) return `${fn.name}: file argument ${argument} is placed elsewhere or encoded.`
    if (texts.includes(part)) return `${fn.name}: multipart part ${part} is both a file and a body value.`
  }
  return null
}

/** Un corps multipart prêt à partir, et les fichiers en transit qu'un appel réussi consommera (jamais un fichier joint). */
export type Upload = { body: RawBody; sent: string[] }

/**
 * Lit les fichiers que nomment les arguments (un argument absent ne part pas) puis compose le corps : les parties
 * texte d'abord, dans l'ordre donné, puis chaque fichier à son nom et à son type. Un fichier inconnu, échu, d'une
 * autre personne ou joint à une page que l'appelant ne lit pas : le même refus, et rien n'est envoyé.
 */
export async function uploadOf(
  fn: ConnectorFunctionDefinition,
  args: Record<string, unknown>,
  files: TransitFiles,
  texts: readonly (readonly [string, string])[],
): Promise<Upload> {
  const read: [string, CallerBytes][] = []
  for (const [part, argument] of Object.entries(fn.request.files ?? {})) {
    if (args[argument] === undefined) continue
    try {
      read.push([part, await files.read(args[argument])])
    } catch (error) {
      if (!(error instanceof PlatformError) || error.code !== "not_found") throw error
      throw new PlatformError("not_found", `${fn.name}: ${argument} names no file you can send: neither a transit file of yours (unknown, expired or already sent) nor a file on a page you read. Nothing was sent.`)
    }
  }
  const form = new FormData()
  for (const [name, value] of texts) form.append(name, value)
  for (const [part, file] of read) form.append(part, new Blob([file.bytes], { type: file.mime }), file.name)
  // L'encodeur de la plateforme : limites et noms échappés comme un navigateur ; un corps en octets, renvoyable tel quel.
  const encoded = new Response(form)
  const contentType = encoded.headers.get("content-type")
  if (contentType === null) throw new Error("[platform] connectors: multipart body without its content type")
  return { body: { bytes: new Uint8Array(await encoded.arrayBuffer()), contentType }, sent: read.filter(([, file]) => !file.attached).map(([, file]) => file.id) }
}

/**
 * Consomme les fichiers d'un appel réussi. Un échec n'en change pas l'issue : le tiers a reçu le fichier, et rejoué,
 * l'envoi partirait deux fois ; le fichier part de toute façon à son échéance. L'échec se voit au log serveur, qui ne
 * nomme que la fonction.
 */
export async function consumeSent(files: TransitFiles, sent: readonly string[], where: string): Promise<void> {
  for (const id of sent) {
    await files.consume(id).catch((error: unknown) => {
      const name = error instanceof PlatformError ? error.code : error instanceof Error ? error.name : typeof error
      console.error(`[platform] ${where}: a sent transit file was not consumed (${name})`)
    })
  }
}
