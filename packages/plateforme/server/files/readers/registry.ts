// Le registre des lecteurs de fichiers (`lecture-des-fichiers.md` § Le registre des lecteurs), sur le modèle de
// `registerFunctions` : le paquet inscrit d'office ses lecteurs texte (`text.ts`) et celui du tableur (`xlsx.ts`) ;
// l'hôte inscrit les siens par `registerReaders([...])`, en tête de chaque route qui monte une porte du paquet, et
// chaque appel remplace toute sa liste. Un lecteur de l'hôte ouvre au dépôt les types qu'il lit, et eux seuls (§ Types
// de l'hôte) : un type ni dans `FILE_TYPES` ni inscrit reste refusé. Sans lui, un format qu'un programme tiers lit
// (plan, modèle 3D) n'aurait aucune place, ni au dépôt ni à la lecture.
import { FILE_TYPES } from "../../../schemas/files"
import { TEXT_READERS } from "./text"
import { READER_LIMITS, type Reader, type ReaderType } from "./types"
import { XLSX_READER } from "./xlsx"

/** Un lecteur trouvé pour un type, et les octets qu'il lit au plus. */
export type FoundReader = { reader: Reader; extension: string; maxBytes: number }

/** L'extension d'un type d'hôte : des minuscules ASCII et des chiffres, comme `fileExtension` la lit. */
const EXTENSION = /^[a-z0-9]{1,16}$/

/**
 * Un type MIME bien formé (RFC 6838), en minuscules, sous un type de premier niveau qu'un fichier porte ; ni paramètre,
 * ni joker.
 */
export const MEDIA_TYPE = /^(?:application|audio|font|image|model|text|video)\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/

/**
 * Les extensions qu'un hôte n'ouvre jamais : une page ou un script qu'un navigateur rend ou exécute, un programme qu'un
 * système lance, un document Office à macros. Le fichier est déjà servi en téléchargement (`readResponse`) : la liste
 * double cette garde, au cas où une autre lecture le servirait un jour en place.
 */
const REFUSED_EXTENSIONS: ReadonlySet<string> = new Set([
  "htm", "html", "xhtml", "xht", "shtml", "mht", "mhtml", "svg", "svgz", "xml", "xsl", "xslt",
  "js", "mjs", "cjs", "wasm", "php", "asp", "aspx", "jsp",
  "exe", "msi", "dll", "com", "bat", "cmd", "scr", "pif", "cpl", "ps1", "vbs", "vbe", "jse", "wsf", "wsh", "hta", "lnk", "reg", "jar", "sh", "app", "apk", "dmg",
  "docm", "dotm", "xlsm", "xltm", "xlam", "pptm", "potm", "ppam",
])

/**
 * Les types MIME qu'un navigateur rend en page ou exécute : jamais signés pour un type d'hôte, ni déclarés par un fichier
 * rendu par un tiers (`connectors/file-output.ts`).
 */
export const REFUSED_MIMES: ReadonlySet<string> = new Set([
  "text/html", "application/xhtml+xml", "image/svg+xml", "text/xml", "application/xml", "text/xsl", "application/xslt+xml",
  "text/javascript", "application/javascript", "application/x-javascript", "text/ecmascript", "application/ecmascript", "application/wasm",
])

/** Les lecteurs du paquet par extension, et les octets qu'ils lisent : 4 Mo d'un fichier texte, 50 Mo d'un tableur. */
const PACKAGE_BY_EXTENSION: ReadonlyMap<string, { reader: Reader; maxBytes: number }> = new Map(
  [
    ...TEXT_READERS.map((reader) => ({ reader, maxBytes: READER_LIMITS.textBytes })),
    { reader: XLSX_READER, maxBytes: READER_LIMITS.binaryBytes },
  ].flatMap((found) => found.reader.types.map((type) => [type.extension, found] as const)),
)

/** Les types inscrits par l'hôte, par extension. */
let hostByExtension: ReadonlyMap<string, { reader: Reader; type: ReaderType }> = new Map()

/** Déclare un lecteur, sur le modèle de `defineErpFunction` : la liste entière se contrôle à `registerReaders`. */
export function defineReader(reader: Reader): Reader {
  return reader
}

/** Le premier problème d'un type déclaré par un lecteur de l'hôte ; `null` : aucun. */
function typeProblem(type: unknown, seen: ReadonlySet<string>): string | null {
  if (typeof type !== "object" || type === null) return "each type must be { extension, mime }."
  const { extension, mime } = type as Partial<ReaderType>
  if (typeof extension !== "string" || !EXTENSION.test(extension)) {
    return `extension ${JSON.stringify(extension)}: 1 to 16 lowercase ASCII letters or digits, without the dot.`
  }
  if (Object.hasOwn(FILE_TYPES, extension)) return `.${extension} is a type of the package: a host reader cannot redefine it.`
  if (REFUSED_EXTENSIONS.has(extension)) return `.${extension} is a page, a script or a program: it is never admitted.`
  if (seen.has(extension)) return `.${extension} is read by two readers.`
  if (typeof mime !== "string" || !MEDIA_TYPE.test(mime)) return `.${extension}: mime ${JSON.stringify(mime)} must be a lowercase media type such as model/stl, without parameters.`
  if (REFUSED_MIMES.has(mime)) return `.${extension}: ${mime} is rendered or run by a browser: declare the type of the format itself.`
  return null
}

/**
 * Inscrit les lecteurs de l'hôte. Toute la liste est contrôlée d'abord : un objet `{ types, read }`, au moins un type,
 * chaque type une extension libre (ni du paquet, ni d'une page, d'un script ou d'un programme, ni lue par un autre
 * lecteur) et un type MIME bien formé qu'un navigateur ne rend pas en page. Au premier problème, `TypeError` et rien
 * n'est inscrit ; sinon la liste remplace celle de l'hôte, et un rechargement à chaud ne double rien.
 */
export function registerReaders(readers: readonly Reader[]): void {
  if (!Array.isArray(readers)) throw new TypeError("registerReaders: expected a list of readers made with defineReader.")
  const seen = new Set<string>()
  const byExtension = new Map<string, { reader: Reader; type: ReaderType }>()
  for (const [index, reader] of readers.entries()) {
    const where = `registerReaders: reader ${index + 1}`
    if (typeof reader !== "object" || reader === null || typeof reader.read !== "function") throw new TypeError(`${where} must be { types, read } with read a function.`)
    if (!Array.isArray(reader.types) || reader.types.length === 0) throw new TypeError(`${where} must list at least one type.`)
    for (const type of reader.types) {
      const problem = typeProblem(type, seen)
      if (problem) throw new TypeError(`${where}: ${problem}`)
      seen.add(type.extension)
      byExtension.set(type.extension, { reader, type: { extension: type.extension, mime: type.mime } })
    }
  }
  hostByExtension = byExtension
}

/** Le lecteur d'une extension : celui du paquet, sinon celui de l'hôte ; `null` sans lecteur. */
export function readerFor(extension: string): FoundReader | null {
  const own = PACKAGE_BY_EXTENSION.get(extension)
  if (own) return { ...own, extension }
  const host = hostByExtension.get(extension)
  return host ? { reader: host.reader, extension, maxBytes: READER_LIMITS.binaryBytes } : null
}

/** Le type d'hôte d'une extension (son type MIME), ouvert au dépôt par son lecteur ; `null` sinon. */
export function hostFileType(extension: string): ReaderType | null {
  return hostByExtension.get(extension)?.type ?? null
}

/** Les extensions ouvertes par les lecteurs de l'hôte, dans l'ordre de leur inscription. */
export function hostExtensions(): string[] {
  return [...hostByExtension.keys()]
}

/** Les extensions lisibles par `read {file}` : celles du paquet, puis celles de l'hôte. */
export function readableExtensions(): string[] {
  return [...PACKAGE_BY_EXTENSION.keys(), ...hostExtensions()]
}
