// Le fichier que rend une fonction décrite (`connecteurs-et-comptes.md` § Fichiers rendus par un tiers ; `connectors :
// docs/conception/format-de-description.md` § Fichiers, « Un fichier rendu ») : `output.file` contrôlé à la déclaration
// comme la règle 17 de la fabrique, plus les types du paquet et toute clé inconnue d'`output` refusée ; à l'appel, le
// fichier lu chez le tiers (le corps de la réponse, une adresse téléchargée par le transport gardé, un champ en base64),
// sous le délai et la borne de la fonction, nommé, son type annoncé contrôlé, puis rangé en fichier en transit de
// l'appelant (`keep`, `storeTransitFile`) ; seul son identifiant revient. Sans ce module, l'assistant recevrait l'adresse
// signée du tiers ou ses octets. Ni l'adresse, ni la réponse JSON qui la porte, ni les octets ne vont à un texte, une
// erreur ou un log : un log nomme le connecteur, la fonction, le statut et le refus.
import { FILE_MAX_BYTES, FILE_TYPES, fileExtension, fileLink, filePath, type TransitFile } from "../../schemas"
import type { FunctionOutput } from "../catalog/define"
import { actName } from "../catalog/registry"
import { PlatformError, type PlatformErrorCode } from "../errors"
import { MEDIA_TYPE, REFUSED_MIMES } from "../files/readers/registry"
import { requireStore } from "../files/service"
import { isJsonObject } from "../json"
import type { ConnectorDefinition, ConnectorFileOutput, ConnectorFunctionDefinition } from "./definition"
import { executeDescribed, valueAt, type DescribedCall, type Exchange, type PreparedFunction } from "./engine"
import { MAX_ANSWER_BYTES, requestDownload, requestFile, requestJson, type ApiRequest, type FileAnswer } from "./http"
import { DOTTED_PATH } from "./probe-declaration"

const OUTPUT_KEYS = ["items", "strip", "projection", "schema", "file"]
const FILE_KEYS = ["from", "path", "auth", "types", "name", "maxBytes"]
const NAME_KEYS = ["header", "path", "template"]
const SHAPING_KEYS = ["items", "strip", "projection", "schema"]
const FROMS = ["body", "url", "base64", "base64url"]
/** L'extension d'un type, comme `fileExtension` la lit. */
const EXTENSION = /^[a-z0-9]{1,16}$/
/** Un nom d'en-tête HTTP (un `token` de la RFC 9110). */
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}$/
/** Un nom de fichier : 255 caractères au plus, comme la ligne `files`. */
const NAME_MAX = 255
/** Les types annoncés qui ne disent rien du fichier, admis quel que soit son type. */
const NEUTRAL_TYPES = ["application/octet-stream", "binary/octet-stream"]

/** La première clé de `value` hors de `known`. */
const unknownKey = (value: Record<string, unknown>, known: readonly string[]): string | undefined => Object.keys(value).find((key) => !known.includes(key))

/** Le problème des types déclarés : extension et types MIME bien formés, une extension du paquet à son premier type. */
function typesProblem(at: string, types: unknown): string | null {
  if (!isJsonObject(types) || Object.keys(types).length === 0) return `${at} types must list at least one extension with its media types.`
  for (const [extension, mimes] of Object.entries(types)) {
    if (!EXTENSION.test(extension)) return `${at} type ${JSON.stringify(extension)}: 1 to 16 lowercase ASCII letters or digits.`
    if (!Array.isArray(mimes) || mimes.length === 0) return `${at} type ${extension} must list at least one media type.`
    for (const mime of mimes) {
      if (typeof mime !== "string" || !MEDIA_TYPE.test(mime)) return `${at} type ${extension}: ${String(mime)} must be a lowercase media type without parameters.`
      if (REFUSED_MIMES.has(mime)) return `${at} type ${extension}: ${mime} is rendered or run by a browser.`
    }
    if (!Object.hasOwn(FILE_TYPES, extension)) return `${at} type ${extension} is not a type of the package (the types of a host reader do not count for a shared description).`
    const own = FILE_TYPES[extension as keyof typeof FILE_TYPES]
    if (mimes[0] !== own) return `${at} type ${extension} must first name ${own}, the type of the package.`
  }
  return null
}

/** Le problème du nom : en-tête (corps et adresse seulement), champ, puis gabarit exigé sur les arguments requis. */
function nameProblem(fn: ConnectorFunctionDefinition, at: string, file: Record<string, unknown>): string | null {
  const { from, name } = file
  const types = file.types as Record<string, unknown>
  if (!isJsonObject(name)) return `${at} name.template is required: it always gives a name.`
  const unknown = unknownKey(name, NAME_KEYS)
  if (unknown !== undefined) return `${fn.name}: output.file.name.${unknown} is not known to this package: refused rather than ignored.`
  if (name.path !== undefined && from === "body") return `${at} name.path is for url, base64 and base64url, not body.`
  if (name.header !== undefined) {
    if (from !== "body" && from !== "url") return `${at} name.header is for body and url only.`
    if (typeof name.header !== "string" || !HEADER_NAME.test(name.header)) return `${at} name.header must be the name of a header.`
  }
  if (name.path !== undefined && (typeof name.path !== "string" || !DOTTED_PATH.test(name.path))) return `${at} name.path must be a dotted path.`
  const template = name.template
  if (typeof template !== "string" || !template.trim()) return `${at} name.template is required: it always gives a name.`
  const required = Array.isArray(fn.schema.required) ? fn.schema.required : []
  for (const [, argument] of template.matchAll(/\{([^{}]*)\}/g)) {
    if (!required.includes(argument)) return `${at} name.template cites ${argument}, which is not a required argument.`
  }
  if (!Object.hasOwn(types, fileExtension(template))) return `${at} name.template must end with a declared extension (${Object.keys(types).join(", ")}).`
  return null
}

/**
 * Le problème de la sortie d'une fonction ; `null` : aucun. Toute clé d'`output` hors de celles que le paquet exécute est
 * refusée, jamais ignorée : un paquet qui ignorerait `file` rendrait l'adresse signée. Puis `output.file`, comme la règle
 * 17 de la fabrique (exclusif des quatre autres clés, ni pagination, ni travail asynchrone ni relève ; `path` hors
 * `body` seulement ; `auth` avec `url` ; `header` avec `body` ou `url`, `name.path` hors `body` ; gabarit sur les arguments requis, à une
 * extension déclarée ; extensions et types MIME bien formés, jamais un type qu'un navigateur rend ; `maxBytes` de 1 à
 * 50 Mo ; `expect` refusé avec `body`), et de plus : chaque extension est un type du paquet (`FILE_TYPES`), à son premier
 * type MIME (une description partagée sert tous les hôtes : un type ouvert par `registerReaders` n'y vaut pas).
 */
export function fileOutputProblem(definition: ConnectorDefinition, fn: ConnectorFunctionDefinition): string | null {
  const output: unknown = fn.output
  if (output === undefined) return null
  if (!isJsonObject(output)) return `${fn.name}: output must be an object.`
  const unknown = unknownKey(output, OUTPUT_KEYS)
  if (unknown !== undefined) return `${fn.name}: output.${unknown} is not known to this package: refused rather than ignored (the connectors pin and the package go up together).`
  const file = output.file
  if (file === undefined) return null
  const at = `${fn.name}: output.file`
  if (!isJsonObject(file)) return `${at} must be an object.`
  const unknownOfFile = unknownKey(file, FILE_KEYS)
  if (unknownOfFile !== undefined) return `${fn.name}: output.file.${unknownOfFile} is not known to this package: refused rather than ignored.`
  const shaping = SHAPING_KEYS.find((key) => output[key] !== undefined)
  if (shaping !== undefined) return `${at} excludes items, strip, projection and schema (${shaping}).`
  const collected = definition.functions.some((other) => other.async?.collect === fn.name)
  if (fn.pagination !== undefined || fn.async !== undefined || collected) return `${at} is not for a paginated function, an asynchronous one or the collect of an asynchronous job.`
  const from = file.from
  if (typeof from !== "string" || !FROMS.includes(from)) return `${at} from must be body, url, base64 or base64url.`
  if (from === "body" && file.path !== undefined) return `${at} path is for url, base64 and base64url, not body.`
  if (from !== "body" && (typeof file.path !== "string" || !DOTTED_PATH.test(file.path))) return `${at} needs the path of the field that holds the address or the bytes.`
  if (file.auth !== undefined) {
    if (file.auth !== "none" && file.auth !== "account") return `${at} auth must be none or account.`
    if (from !== "url") return `${at} auth is for url only.`
  }
  const typesFault = typesProblem(at, file.types)
  if (typesFault) return typesFault
  const nameFault = nameProblem(fn, at, file)
  if (nameFault) return nameFault
  const max = file.maxBytes
  if (max !== undefined && !(Number.isInteger(max) && Number(max) >= 1 && Number(max) <= FILE_MAX_BYTES)) return `${at} maxBytes must be an integer from 1 to ${FILE_MAX_BYTES}.`
  if (from === "body" && (fn.expect?.length ?? 0) > 0) return `${at} from body has no JSON: expect is refused.`
  return null
}

const MB = 1_048_576
const tenth = (value: number) => Math.round(value * 10) / 10

/** Une taille lisible : « 64 bytes », « 2.9 KB », « 1.8 MB ». */
function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`
  if (bytes < MB) return `${tenth(bytes / 1024)} KB`
  return `${tenth(bytes / MB)} MB`
}

/** Les six refus nommés communs avec la lib (`connectors : connectors/_cases/file.yaml`). */
type FileRefusal = "file_missing" | "file_download_refused" | "file_too_large" | "file_type_refused" | "file_unreadable" | "file_foreign_origin"

/** Les refus d'une fonction qui rend un fichier, dits avec elle et le tiers ; chacun nommé au log, jamais avec l'adresse. */
function refusalsOf(prepared: PreparedFunction, file: ConnectorFileOutput) {
  const { connector, fn } = prepared
  const label = connector.label
  const refused = (code: PlatformErrorCode, refusal: FileRefusal, message: string, status?: number): PlatformError => {
    console.error(`[platform] connector ${connector.name}: ${fn.name}: file not kept (${refusal}${status === undefined ? "" : `, HTTP ${status}`})`)
    return new PlatformError(code, `${fn.name}: ${message}`, { refusal })
  }
  const served = fn.act ? (actName(fn.name) ?? fn.name) : fn.name
  return {
    missing: (where: string) => refused("not_found", "file_missing", `${label} answered without a file (${where}). Nothing was kept.`),
    downloadRefused: (status: number) =>
      refused("upstream_error", "file_download_refused", `${label} refused the download (HTTP ${status}); the link may have expired: call ${served} again. Nothing was kept.`, status),
    tooLarge: () => refused("too_large", "file_too_large", `the file is over ${sizeText(file.maxBytes ?? FILE_MAX_BYTES)}. Nothing was kept.`),
    type: (announced: string, extension: string) => refused("upstream_error", "file_type_refused", `${label} sent ${announced} instead of the file (${extension}). Nothing was kept.`),
    interrupted: () => refused("upstream_error", "file_download_refused", `${label} cut the download short; call ${served} again. Nothing was kept.`),
    unreadable: (what = `a file field that is not valid ${file.from}`) => refused("upstream_error", "file_unreadable", `${label} sent ${what}. Nothing was kept.`),
    address: () => refused("upstream_error", "file_download_refused", `${label} gave a file address that cannot be downloaded (a public https address only); nothing was downloaded.`),
    foreign: () => refused("upstream_error", "file_foreign_origin", `${label} gave a file address outside its API; nothing was downloaded.`),
  }
}

/** Ni absente, ni nulle, ni vide : un champ qui porte un fichier. */
const given = (value: unknown): boolean => value !== undefined && value !== null && value !== ""

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
const BASE64URL = /^[A-Za-z0-9_-]*={0,2}$/

/** Les octets d'un champ encodé, lu strictement (alphabet, longueur, remplissage) ; `null` s'il ne l'est pas. */
function decoded(value: unknown, encoding: "base64" | "base64url"): Uint8Array | null {
  if (typeof value !== "string") return null
  if (encoding === "base64") return BASE64.test(value) ? new Uint8Array(Buffer.from(value, "base64")) : null
  const bare = value.replace(/=+$/, "")
  // Un remplissage, s'il y en a un, complète la longueur à un multiple de 4 ; un reste d'un caractère ne code rien.
  if (!BASE64URL.test(value) || bare.length % 4 === 1 || (bare.length !== value.length && value.length % 4 !== 0)) return null
  return new Uint8Array(Buffer.from(bare, "base64url"))
}

/** L'adresse rendue par le tiers, lue ; `null` si elle ne se lit pas. */
function addressOf(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

/** Une adresse qui se télécharge : `https`, sans identifiants. */
const downloadable = (url: URL): boolean => url.protocol === "https:" && url.username === "" && url.password === ""

/** Les noms d'un `Content-Disposition` (RFC 6266) : `filename*` (RFC 8187, UTF-8 ou ISO-8859-1), puis `filename`. */
function dispositionNames(value: string): string[] {
  const names: string[] = []
  const extended = /(?:^|;)\s*filename\*\s*=\s*([^;]+)/i.exec(value)
  const parts = extended ? /^([A-Za-z0-9!#$%&+^_`{}~-]+)'[^']*'(.*)$/.exec(extended[1].trim()) : null
  if (parts) {
    try {
      const charset = parts[1].toLowerCase()
      if (charset === "utf-8") names.push(decodeURIComponent(parts[2]))
      if (charset === "iso-8859-1") names.push(parts[2].replace(/%([0-9a-f]{2})/gi, (_whole, hex: string) => String.fromCharCode(parseInt(hex, 16))))
    } catch {
      // Un encodage illisible ne nomme rien : le nom suivant est essayé.
    }
  }
  const plain = /(?:^|;)\s*filename\s*=\s*("(?:[^"\\]|\\.)*"|[^;]*)/i.exec(value)
  if (plain) {
    const raw = plain[1].trim()
    names.push(raw.startsWith('"') ? raw.slice(1, -1).replace(/\\(.)/g, "$1") : raw)
  }
  return names
}

/** Un nom réduit à son dernier segment, sans caractère de contrôle, 255 caractères au plus, l'extension gardée. */
function cleanName(raw: string): string {
  const last = raw.split(/[\\/]/).pop() ?? ""
  // Un caractère de contrôle (C0 ou DEL) n'a rien à faire dans un nom affiché et rendu dans un en-tête.
  const segment = [...last].filter((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127).join("").trim()
  if (segment.length <= NAME_MAX) return segment
  const extension = fileExtension(segment)
  return `${segment.slice(0, NAME_MAX - extension.length - 1)}.${extension}`
}

/** Un argument cité par le gabarit du nom : un texte tel quel, le reste écrit. */
const argumentText = (value: unknown): string => (typeof value === "string" ? value : JSON.stringify(value))

/**
 * Le nom du fichier : le premier dont l'extension est déclarée, pris de l'en-tête (`Content-Disposition` selon la RFC
 * 6266, `filename*` d'abord), du champ de la réponse JSON, puis du gabarit sur les arguments, qui en donne toujours un.
 */
function nameOf(file: ConnectorFileOutput, args: Record<string, unknown>, headers: Headers | null, answer: unknown): string {
  const candidates: string[] = []
  const header = file.name.header
  const announced = header !== undefined ? headers?.get(header) : null
  if (typeof announced === "string") candidates.push(...(header?.toLowerCase() === "content-disposition" ? dispositionNames(announced) : [announced]))
  const field = file.name.path !== undefined && answer !== null ? valueAt(answer, file.name.path) : undefined
  if (typeof field === "string") candidates.push(field)
  candidates.push(file.name.template.replace(/\{([^{}]+)\}/g, (_whole, argument: string) => argumentText(args[argument])))
  for (const candidate of candidates) {
    const name = cleanName(candidate)
    if (name !== "" && Object.hasOwn(file.types, fileExtension(name))) return name
  }
  // La déclaration exige un gabarit à une extension déclarée : sans nom ici, câblage fautif.
  throw new PlatformError("internal", "Internal error.")
}

/** Le type annoncé, sans ses paramètres, en minuscules ; `null` s'il n'est pas dit. */
function announcedType(type: string | null): string | null {
  const media = type?.split(";")[0].trim().toLowerCase() ?? ""
  return media === "" ? null : media
}

/** Ce que le moteur garde d'un fichier lu : son nom retenu et ses octets. */
type ReadFile = { name: string; bytes: Uint8Array }

/** Les refus d'une fonction qui rend un fichier. */
type Refusals = ReturnType<typeof refusalsOf>

/**
 * Le nom d'un fichier, puis son type annoncé, l'un de ceux de l'extension retenue (ou neutre, ou absent), contrôlé avant
 * toute lecture de ses octets ; rend le nom.
 */
function namedAndTyped(fail: Refusals, file: ConnectorFileOutput, args: Record<string, unknown>, head: { type: string | null; headers: Headers; json: unknown }): string {
  const name = nameOf(file, args, head.headers, head.json)
  const extension = fileExtension(name)
  const announced = announcedType(head.type)
  if (announced !== null && !NEUTRAL_TYPES.includes(announced) && !file.types[extension].includes(announced)) {
    throw fail.type(/^[a-z0-9!#$&^_.+-]{1,64}\/[a-z0-9!#$&^_.+-]{1,64}$/.test(announced) ? announced : "another type", extension)
  }
  return name
}

/** Les octets lus d'un fichier : sous la borne, non vides. */
function fileOf(fail: Refusals, max: number, read: { name: string; bytes: Uint8Array | null; empty: string }): ReadFile {
  if (read.bytes === null || read.bytes.byteLength > max) throw fail.tooLarge()
  if (read.bytes.byteLength === 0) throw fail.missing(read.empty)
  return { name: read.name, bytes: read.bytes }
}

/** La taille encodée en base64 de `bytes` octets. */
const encodedSize = (bytes: number) => 4 * Math.ceil(bytes / 3)

/**
 * Lit le fichier chez le tiers, sous le délai de la fonction, lecture du corps comprise, et sous `maxBytes`. `body` : la
 * requête de `requestJson`, qui demande les types déclarés et rend les octets. `url` : la réponse JSON (ses `expect`
 * joués), puis l'adresse au chemin `path`, téléchargée par le transport gardé (`https`, hôte public, aucune
 * redirection), sans authentification, ou, sous `auth: account`, avec celle du compte vers l'origine de l'adresse de
 * base seulement. `base64`, `base64url` : la réponse JSON lue jusqu'à la taille encodée de `maxBytes` au-delà des 4 Mo
 * d'une réponse ordinaire, le champ décodé strictement. Rien n'est gardé ici.
 */
async function readFile(prepared: PreparedFunction, file: ConnectorFileOutput, args: Record<string, unknown>, exchange: Exchange): Promise<ReadFile> {
  const { api, request, fetcher, resign } = exchange
  const fail = refusalsOf(prepared, file)
  const max = file.maxBytes ?? FILE_MAX_BYTES
  const accept = [...new Set(Object.values(file.types).flat())].join(", ")
  let name = ""
  const named = (json: unknown) => (head: Omit<FileAnswer, "bytes">) => {
    name = namedAndTyped(fail, file, args, { ...head, json })
  }
  if (file.from === "body") {
    const asking = (sent: ApiRequest): ApiRequest => ({ ...sent, headers: { ...sent.headers, accept } })
    const renewed = resign ? async () => asking(await resign()) : undefined
    const answer = await requestFile(api, asking(request), fetcher, { resign: renewed, maxBytes: max, before: named(null) })
    return fileOf(fail, max, { name, bytes: answer.bytes, empty: "its body is empty" })
  }
  const path = file.path ?? ""
  const bound = file.from === "url" ? undefined : { maxBytes: MAX_ANSWER_BYTES + encodedSize(max), tooLarge: fail.tooLarge }
  const json = await requestJson(api, request, fetcher, { resign, bound })
  exchange.expect(json)
  const value = valueAt(json, path)
  if (!given(value)) throw fail.missing(`${path} is empty`)
  if (file.from === "url") {
    if (typeof value !== "string") throw fail.unreadable("a file address that is not text")
    const url = addressOf(value)
    // L'origine d'abord : sous le compte, une adresse hors de l'API (en `http` sur le même hôte aussi) n'est pas la sienne.
    if (url && file.auth === "account" && url.origin !== new URL(api.baseUrl).origin) throw fail.foreign()
    if (!url || !downloadable(url)) throw fail.address()
    const headers: Record<string, string> = { accept }
    if (file.auth === "account") {
      const signature = exchange.signature()
      Object.assign(headers, signature.headers)
      for (const [name, item] of signature.query) url.searchParams.append(name, item)
    }
    const reading = { maxBytes: max, before: named(json), interrupted: fail.interrupted }
    const downloaded = await requestDownload(api, { url: url.href, headers }, exchange.download, reading).catch((error: unknown) => {
      // Un refus du transport gardé (un hôte interne) : l'adresse ne se dit pas, ni son hôte.
      throw error instanceof PlatformError && error.code === "not_enabled" ? fail.address() : error
    })
    if (!downloaded.file) throw fail.downloadRefused(downloaded.status)
    return fileOf(fail, max, { name, bytes: downloaded.file.bytes, empty: `the file at ${path} is empty` })
  }
  const bytes = decoded(value, file.from)
  if (!bytes) throw fail.unreadable()
  name = namedAndTyped(fail, file, args, { type: null, headers: new Headers(), json })
  return fileOf(fail, max, { name, bytes, empty: `${path} is empty` })
}

/** La fin d'échéance dite à l'assistant : `2026-10-22 09:12`, en UTC, à la minute (jamais plus tard que l'échéance). */
const untilText = (at: Date) => at.toISOString().slice(0, 16).replace("T", " ")

/**
 * Le résultat d'un fichier gardé : un texte, son lien sous la forme d'une page (`fileLink`, à son adresse `/f/<id>`, jamais
 * celle du tiers), puis les mêmes données en champs, `{ file: { id, name, mime, size, expires_at, url } }`. Le texte ne
 * promet que ce qui est écrit : passer l'identifiant à une fonction qui prend un fichier.
 */
function keptOutput(fn: ConnectorFunctionDefinition, kept: TransitFile, route: string): FunctionOutput {
  const expires = new Date(kept.expiresAt)
  return {
    text: [
      `${fn.name}: file ready: ${fileLink(kept, route)}, yours until ${untilText(expires)} UTC.`,
      `Pass its id ${kept.id} as is to a function that takes a file; it is deleted once sent, or at that time.`,
    ].join("\n"),
    data: { file: { id: kept.id, name: kept.name, mime: kept.mime, size: kept.size, expires_at: expires.toISOString(), url: filePath(kept.id, route) } },
  }
}

/**
 * Une fonction qui rend un fichier, de bout en bout : sans stockage, `not_enabled` avant tout appel au tiers ; l'appel
 * (contrôles, fichiers envoyés consommés après un appel réussi, marque du compte) avec la lecture du fichier ; puis le
 * fichier rangé en transit de l'appelant (`keep`), jamais avant d'être lu en entier sous sa borne. Tout refus le dit au
 * log, par son nom ou son code, sans l'adresse.
 */
export async function runFileOutput(prepared: PreparedFunction, call: DescribedCall, args: Record<string, unknown>, file: ConnectorFileOutput): Promise<FunctionOutput> {
  const { connector, fn } = prepared
  const files = call.files
  if (!files) {
    console.error(`[platform] connector ${connector.name}: ${fn.name} called without the transit files of the caller`)
    throw new PlatformError("internal", "Internal error.")
  }
  requireStore()
  try {
    const { answers } = await executeDescribed(prepared, call, args, (exchange) => readFile(prepared, file, args, exchange))
    return keptOutput(fn, await files.keep(answers[0] as ReadFile), files.route)
  } catch (error) {
    const named = error instanceof PlatformError && typeof error.details?.refusal === "string" && error.details.refusal.startsWith("file_")
    if (!named) console.error(`[platform] connector ${connector.name}: ${fn.name}: file not kept (${error instanceof PlatformError ? error.code : error instanceof Error ? error.name : typeof error})`)
    throw error
  }
}
