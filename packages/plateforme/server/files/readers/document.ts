// Un lecteur couru sous les bornes communes (`lecture-des-fichiers.md` § Bornes) : l'échéance de 10 secondes, le
// document contrôlé (un lecteur de l'hôte qui rend une forme fausse est un échec, pas un texte servi), le caractère NUL
// retiré, le texte coupé à 2 millions de caractères. L'échéance n'est pas préemptive : un lecteur asynchrone est
// abandonné à l'échéance, et le signal qu'il reçoit lui dit de s'arrêter ; une étape synchrone qui la dépasse rend
// `timeout` à son retour, sans être interrompue (un worker viendra avec les lecteurs du tableur et du PDF). Sans lui,
// un lecteur lent, bavard ou mal écrit tiendrait la requête ou servirait ce que la base refuse.
import { PlatformError, type PlatformErrorCode } from "../../errors"
import { READER_LIMITS, READER_STATUSES, type Reader, type ReaderDocument, type ReaderPart, type ReaderStatus, type ReaderStatusCode } from "./types"

/** Le caractère NUL, que Postgres refuse dans `text` et `jsonb` : retiré de tout ce qu'un lecteur rend. */
const NUL = String.fromCharCode(0)

/** Longueurs de ce qu'un lecteur rend : un nom se passe à `section` (200 caractères), un titre et un résumé s'affichent. */
const NAME_MAX = 200
const TITLE_MAX = 200
const SUMMARY_MAX = 300

/** L'échéance d'une lecture : son signal, levé à l'échéance, et l'heure dépassée, lue même quand la boucle a été tenue. */
export type Deadline = { signal: AbortSignal; expired: () => boolean; clear: () => void }

/** Une échéance dans `ms` millisecondes, 10 secondes à défaut ; `clear` la retire en fin de lecture. */
export function startDeadline(ms: number = READER_LIMITS.readMs): Deadline {
  const at = Date.now() + ms
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new DOMException("The file was not read in time.", "TimeoutError")), ms)
  return { signal: controller.signal, expired: () => controller.signal.aborted || Date.now() >= at, clear: () => clearTimeout(timer) }
}

/** Ce que dit un statut, sans détail du lecteur. */
const STATUS_TEXT: Record<ReaderStatusCode, string> = {
  unsupported: "this variant of the format is not read",
  encrypted: "it is encrypted",
  empty: "it holds no text",
  too_large: "its text is over the reading bounds",
  rejected_dtd: "its XML declares entities, which are refused",
  failed: "its reader failed; retry later",
  timeout: `it was not read within ${READER_LIMITS.readMs / 1000} seconds; retry later`,
}

/** Le code d'erreur d'un statut : un fichier illisible, trop gros, ou une lecture à retenter. */
const STATUS_CODE: Record<ReaderStatusCode, PlatformErrorCode> = {
  unsupported: "invalid_arguments",
  encrypted: "invalid_arguments",
  empty: "invalid_arguments",
  too_large: "too_large",
  rejected_dtd: "invalid_arguments",
  failed: "conflict",
  timeout: "conflict",
}

/** Le refus d'une lecture qui finit sur un statut terminal ; la raison porte le statut. */
export function statusError(name: string, status: ReaderStatus): PlatformError {
  return new PlatformError(STATUS_CODE[status.status], `${name} cannot be read: ${status.detail ?? STATUS_TEXT[status.status]} (${status.status}).`, { reason: status.status })
}

function failed(name: string, why: string): PlatformError {
  console.error(`[platform] files: the reader of ${name} failed: ${why}`)
  return statusError(name, { status: "failed" })
}

/** `run` sous l'échéance : abandonné à l'échéance, `timeout` s'il la dépasse, `failed` s'il lève. */
async function bounded<T>(deadline: Deadline, name: string, run: () => T | Promise<T>): Promise<T> {
  const timedOut = () => statusError(name, { status: "timeout" })
  if (deadline.expired()) throw timedOut()
  let onAbort = () => {}
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(timedOut())
    deadline.signal.addEventListener("abort", onAbort, { once: true })
  })
  try {
    const result = await Promise.race([
      Promise.resolve()
        .then(run)
        .catch((error: unknown) => {
          throw failed(name, error instanceof Error ? error.message : String(error))
        }),
      aborted,
    ])
    if (deadline.expired()) throw timedOut()
    return result
  } finally {
    deadline.signal.removeEventListener("abort", onAbort)
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

/** Une chaîne sans NUL, bornée ; `null` si ce n'est pas une chaîne ou qu'elle passe la borne. */
function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null
  const clean = value.split(NUL).join("")
  return clean.length <= max ? clean : null
}

/** Un statut bien formé que rend un lecteur, sinon `null` (ce n'est pas un statut). */
function statusOf(outcome: Record<string, unknown>, name: string): ReaderStatus | null {
  if (!("status" in outcome)) return null
  const status = READER_STATUSES.find((one) => one === outcome.status)
  const detail = outcome.detail === undefined ? undefined : cleanText(outcome.detail, SUMMARY_MAX)
  if (!status || detail === null) throw failed(name, `status ${JSON.stringify(outcome.status)} is not one of ${READER_STATUSES.join(", ")} with a detail of ${SUMMARY_MAX} characters at most`)
  return detail === undefined ? { status } : { status, detail }
}

/**
 * Les parties contrôlées : un nom sans NUL, de 1 à 200 caractères, unique, et une taille entière ; `source`, le nom que
 * le lecteur a rendu, que `text` reçoit.
 */
function partsOf(parts: unknown, name: string): { part: ReaderPart; source: string }[] {
  if (!Array.isArray(parts)) throw failed(name, "parts must be a list")
  const seen = new Set<string>()
  return parts.map((part: unknown, index) => {
    const source = isRecord(part) ? part.name : undefined
    const partName = cleanText(source, NAME_MAX)?.trim()
    const chars = isRecord(part) ? part.chars : undefined
    if (typeof source !== "string" || !partName || seen.has(partName) || typeof chars !== "number" || !Number.isSafeInteger(chars) || chars < 0) {
      throw failed(name, `part ${index + 1} must have a unique name of 1 to ${NAME_MAX} characters and a whole number of chars`)
    }
    seen.add(partName)
    return { part: { name: partName, chars }, source }
  })
}

/** Le texte d'un fichier tel que `read {file}` le sert : ses parties gardées, sous la borne de 2 millions de caractères. */
export type ReadText = {
  title: string
  summary: string
  /** Les parties servies, dans l'ordre ; la dernière gardée peut être coupée. */
  parts: ReaderPart[]
  /** Caractères servis, et ceux que le lecteur annonce : différents quand le texte est coupé. */
  chars: number
  declaredChars: number
  /** Le texte d'une partie servie, sans NUL, coupé à sa part de la borne. */
  text: (part: string) => Promise<string>
  /** Tout le texte servi : les parties jointes par un saut de ligne, coupé à la borne. */
  whole: () => Promise<string>
}

/** Les parties sous la borne de caractères : chaque partie garde ce qui reste, les suivantes partent. */
function withinChars(parts: readonly ReaderPart[]): { kept: ReaderPart[]; limits: Map<string, number> } {
  const kept: ReaderPart[] = []
  const limits = new Map<string, number>()
  let room: number = READER_LIMITS.textChars
  for (const part of parts) {
    if (room <= 0) break
    const chars = Math.min(part.chars, room)
    kept.push({ name: part.name, chars })
    limits.set(part.name, room)
    room -= chars
  }
  return { kept, limits }
}

/**
 * Court le lecteur sur les octets d'un fichier sous l'échéance, puis contrôle ce qu'il rend. Un statut, une forme
 * fausse, une erreur levée ou l'échéance dépassée : le refus de `statusError`, sa raison le statut.
 */
export async function readText(reader: Reader, file: { name: string; bytes: Uint8Array }, deadline: Deadline): Promise<ReadText> {
  const { name } = file
  const outcome: unknown = await bounded(deadline, name, () => reader.read({ name, bytes: file.bytes, signal: deadline.signal }))
  if (!isRecord(outcome)) throw failed(name, "it returned neither a document nor a status")
  const status = statusOf(outcome, name)
  if (status) throw statusError(name, status)
  const title = cleanText(outcome.title, TITLE_MAX)
  const summary = cleanText(outcome.summary, SUMMARY_MAX)
  if (title === null || summary === null || typeof outcome.text !== "function") {
    throw failed(name, `a document has a title of ${TITLE_MAX} characters at most, a summary of ${SUMMARY_MAX} and a text function`)
  }
  const document = outcome as ReaderDocument
  const checked = partsOf(outcome.parts, name)
  const parts = checked.map((one) => one.part)
  const sources = new Map(checked.map((one) => [one.part.name, one.source]))
  const { kept, limits } = withinChars(parts)
  const text = async (part: string): Promise<string> => {
    const limit = limits.get(part)
    const source = sources.get(part)
    if (limit === undefined || source === undefined) return ""
    const served: unknown = await bounded(deadline, name, () => document.text(source))
    if (typeof served !== "string") throw failed(name, `the text of part ${JSON.stringify(part)} is not a string`)
    return served.split(NUL).join("").slice(0, limit)
  }
  return {
    title,
    summary,
    parts: kept,
    chars: kept.reduce((sum, part) => sum + part.chars, 0),
    declaredChars: parts.reduce((sum, part) => sum + part.chars, 0),
    text,
    whole: async () => {
      const texts: string[] = []
      for (const part of kept) texts.push(await text(part.name))
      return texts.join("\n").slice(0, READER_LIMITS.textChars)
    },
  }
}
