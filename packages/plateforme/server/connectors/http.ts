// Client HTTP des connecteurs réels (`connecteurs-et-comptes.md`, H85 ; moteur des connecteurs décrits) : une requête
// vers l'API d'un tiers, au rythme que le tiers admet par compte, un délai, un nouvel essai borné après un 429, et la
// table d'erreurs du connecteur traduite en `PlatformError`. Sans lui, le moteur recopierait l'appel, le délai et la
// traduction des statuts. Le secret arrive dans les en-têtes que le moteur pose et ne sort jamais d'ici : ni dans un
// message, ni dans un log, ni comme cause d'une erreur ; aucun en-tête ni aucune adresse n'est journalisé. Un fichier
// rendu par un tiers (`file-output.ts`) s'y lit en octets, corps de la réponse (`requestFile`) ou adresse téléchargée
// (`requestDownload`), sous le même délai, lecture du corps comprise, et sous sa borne.
import { readBounded } from "../bounded-read"
import { PlatformError, type PlatformErrorCode } from "../errors"

/** Une réponse plus grosse ne se lit pas : le résultat d'un outil tient de toute façon en 45 000 caractères. */
export const MAX_ANSWER_BYTES = 4 * 1024 * 1024

/** Après un 429 : deux nouveaux essais au plus, chacun après le `Retry-After` du tiers s'il ne dépasse pas 10 s. */
const MAX_RETRIES = 2
const MAX_RETRY_WAIT_MS = 10_000
/** Sans `Retry-After` lisible, l'attente avant un nouvel essai. */
const DEFAULT_RETRY_WAIT_MS = 1_000

/**
 * Une ligne de la table d'erreurs d'un connecteur : le statut du tiers, le code et le message servis, et le refus nommé
 * par la description (`details.refusal`) ; `body`, la condition sur le corps JSON de la réponse sans laquelle la ligne
 * ne s'applique pas (seule une ligne à condition s'applique à un 2xx).
 */
export type ApiError = { status: number | readonly number[]; code: PlatformErrorCode; message: string; refusal?: string; body?: (answer: unknown) => boolean }

/** L'API d'un tiers, telle que sa description la donne. */
export type ConnectorApi = {
  /** Le nom du tiers dans les messages : « Notion ». */
  label: string
  /** Adresse de base, sans barre finale : `https://api.notion.com/v1`. */
  baseUrl: string
  /**
   * Le délai de chaque requête : celui de la fonction appelée si elle en déclare un, sinon celui du connecteur, seul lu
   * par un point de jeton.
   */
  timeoutMs: number
  errors: readonly ApiError[]
  /** Débit maximal du tiers, par compte : `requests` requêtes par fenêtre de `intervalMs`. */
  rateLimit?: { requests: number; intervalMs: number }
}

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE"

/** Un corps déjà encodé (un corps `multipart/form-data` qui porte un fichier), envoyé tel quel avec son type. */
export type RawBody = { readonly bytes: Uint8Array; readonly contentType: string }

export type ApiRequest = {
  method: HttpMethod
  /** Chemin sous `baseUrl`, barre initiale comprise, paramètres déjà encodés : `/pages/1f2e`. */
  path: string
  /** Paires de la query, dans l'ordre ; une clé peut revenir (listes en `repeat`). */
  query?: readonly (readonly [string, string])[]
  /** En-têtes complets, authentification comprise. */
  headers: Readonly<Record<string, string>>
  /** Corps JSON, quelle que soit la méthode ; absent, rien n'est envoyé. */
  body?: unknown
  /** Corps en formulaire (point de jeton d'un échange), à la place d'un corps JSON. */
  form?: readonly (readonly [string, string])[]
  /** Corps déjà encodé, à la place d'un corps JSON ou en formulaire ; jamais journalisé. */
  raw?: RawBody
  /** La clé du rythme : le compte dont le secret signe la requête. */
  pacingKey: string
}

/** Ce qu'il faut à `fetch` ici : tests et hôte passent la leur. */
export type Fetch = (input: string, init: RequestInit) => Promise<Response>

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Instants des requêtes récentes, par compte : le rythme que le tiers admet par secret, tenu dans ce processus. Un
 * hôte à plusieurs instances le dépasse au pire de leur nombre ; le 429 et son nouvel essai couvrent ce reste.
 */
const sentAt = new Map<string, number[]>()

/** Attend une place dans la fenêtre du compte, puis la prend. */
async function pace(key: string, limit: ConnectorApi["rateLimit"]): Promise<void> {
  if (!limit) return
  for (;;) {
    const now = Date.now()
    const recent = (sentAt.get(key) ?? []).filter((at) => at > now - limit.intervalMs)
    if (recent.length < limit.requests) {
      sentAt.set(key, [...recent, now])
      return
    }
    sentAt.set(key, recent)
    await wait(recent[0] + limit.intervalMs - now)
  }
}

const covers = (error: ApiError, status: number) => (typeof error.status === "number" ? error.status === status : error.status.includes(status))

/** La première ligne de la table qui s'applique au statut et, si elle a une condition, au corps lu (`null` : non lu). */
function rowOf(api: ConnectorApi, status: number, answer: unknown): ApiError | undefined {
  return api.errors.find((error) => covers(error, status) && (error.body === undefined || error.body(answer)))
}

const refusalOf = (row: ApiError) => new PlatformError(row.code, row.message, row.refusal ? { refusal: row.refusal } : undefined)

function errorOf(api: ConnectorApi, status: number, answer: unknown): PlatformError {
  const known = rowOf(api, status, answer)
  if (known) return refusalOf(known)
  if (status === 429) return new PlatformError("rate_limited", `${api.label} request rate exceeded: retry later.`)
  return new PlatformError("upstream_error", `${api.label} answered with an unexpected status (${status}). Retry later.`)
}

/** Une panne de `fetch` (réseau, délai) : une erreur neuve, sans cause, qui n'emporte ni la requête ni le jeton. */
function unreachable(api: ConnectorApi, error: unknown): PlatformError {
  const name = error instanceof Error ? error.name : "unknown"
  console.error(`[platform] connector ${api.label}: request failed (${name})`)
  if (name === "TimeoutError") {
    return new PlatformError("upstream_error", `${api.label} did not answer within ${Math.round(api.timeoutMs / 1000)} s. Retry later.`)
  }
  return new PlatformError("upstream_error", `${api.label} could not be reached. Retry later.`)
}

/** L'attente que demande `Retry-After` (secondes ou date HTTP), `null` au-delà de la borne. */
function retryWait(answer: Response): number | null {
  const header = answer.headers.get("retry-after")
  if (header === null) return DEFAULT_RETRY_WAIT_MS
  const seconds = Number(header)
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now()
  if (Number.isNaN(ms)) return DEFAULT_RETRY_WAIT_MS
  return ms <= MAX_RETRY_WAIT_MS ? Math.max(ms, 0) : null
}

/**
 * Le délai de chaque réponse reçue : il court jusqu'à la fin de la lecture de son corps, et une lecture coupée par lui se
 * dit comme le délai, quel que soit le transport (le transport gardé ne lève pas `TimeoutError` sur un corps coupé).
 */
const deadlines = new WeakMap<Response, AbortSignal>()

/** L'erreur d'une lecture de corps : la raison du délai s'il est échu, sinon l'erreur telle quelle. */
function readFailure(answer: Response, error: unknown): unknown {
  const deadline = deadlines.get(answer)
  return deadline?.aborted ? deadline.reason : error
}

/** Le transport d'une requête, et le refus d'un transfert coupé hors délai (un téléchargement), au lieu de la panne. */
type Transport = { fetcher: Fetch; interrupted?: () => PlatformError }

/**
 * Une requête sous le délai du tiers, sans redirection ; une panne de `fetch` se dit sans la requête, ou par
 * `interrupted` si le transport en donne un et que le délai n'est pas échu (une redirection refusée, une coupure).
 */
async function deliver(api: ConnectorApi, url: string, init: Pick<RequestInit, "method" | "headers" | "body">, transport: Transport): Promise<Response> {
  const signal = AbortSignal.timeout(api.timeoutMs)
  try {
    const answer = await transport.fetcher(url, { ...init, redirect: "error", signal })
    deadlines.set(answer, signal)
    return answer
  } catch (error) {
    // Un refus du transport (adresse saisie gardée, `address-guard.ts`) se dit tel quel.
    if (error instanceof PlatformError) throw error
    if (transport.interrupted && !signal.aborted) throw transport.interrupted()
    throw unreachable(api, error)
  }
}

async function send(api: ConnectorApi, request: ApiRequest, fetcher: Fetch): Promise<Response> {
  const query = request.query?.length ? `?${new URLSearchParams(request.query.map(([key, value]) => [key, value])).toString()}` : ""
  const headers: Record<string, string> = { accept: "application/json", ...request.headers }
  if (request.body !== undefined) headers["content-type"] = "application/json"
  if (request.form !== undefined) headers["content-type"] = "application/x-www-form-urlencoded"
  if (request.raw !== undefined) headers["content-type"] = request.raw.contentType
  const body = request.form !== undefined ? new URLSearchParams(request.form.map(([key, value]) => [key, value])).toString() : request.body
  const sent = request.raw !== undefined ? request.raw.bytes : body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body)
  await pace(request.pacingKey, api.rateLimit)
  return deliver(api, `${api.baseUrl}${request.path}${query}`, { method: request.method, headers, body: sent }, { fetcher })
}

/**
 * Le corps d'une réponse hors 2xx, lu seulement si une ligne à condition couvre son statut ; sinon, ou illisible,
 * `null` : un corps d'erreur illisible ne dit rien de plus que son statut. Jamais journalisé.
 */
async function errorBody(api: ConnectorApi, answer: Response): Promise<unknown> {
  if (!api.errors.some((error) => error.body !== undefined && covers(error, answer.status))) {
    await answer.body?.cancel()
    return null
  }
  try {
    return await readAnswer(api, answer)
  } catch {
    return null
  }
}

/**
 * La réponse 2xx du tiers à la requête : un 401 rejoué une fois sur une requête signée de neuf (`resign`), un 429 deux
 * fois au plus ; hors 2xx, le refus de la table d'erreurs (`errorOf`).
 */
async function answered(api: ConnectorApi, request: ApiRequest, fetcher: Fetch, resign?: () => Promise<ApiRequest>): Promise<Response> {
  let answer = await send(api, request, fetcher)
  if (answer.status === 401 && resign) {
    await answer.body?.cancel()
    answer = await send(api, await resign(), fetcher)
  }
  for (let retry = 0; answer.status === 429 && retry < MAX_RETRIES; retry++) {
    const ms = retryWait(answer)
    if (ms === null) break
    await answer.body?.cancel()
    await wait(ms)
    answer = await send(api, request, fetcher)
  }
  if (!answer.ok) {
    const body = await errorBody(api, answer)
    console.error(`[platform] connector ${api.label}: status ${answer.status}`)
    throw errorOf(api, answer.status, body)
  }
  return answer
}

/** La borne d'une réponse JSON, et le refus au-delà ; les 4 Mo d'une réponse ordinaire à défaut. */
export type AnswerBound = { maxBytes: number; tooLarge: () => PlatformError }

/**
 * Ce qui s'ajoute à une requête : sa signature de neuf après un 401 (`resign`), une autre borne que 4 Mo (`bound`), et
 * un autre refus d'une réponse qui n'est pas du JSON (`unreadable`).
 */
export type RequestOptions = { resign?: () => Promise<ApiRequest>; bound?: AnswerBound; unreadable?: () => PlatformError }

/**
 * Envoie la requête au tiers et rend le JSON de sa réponse, `null` pour une réponse vide. Un 429 se rejoue deux fois au
 * plus, après le `Retry-After` du tiers s'il tient en 10 s. Refus : statut hors 2xx, la première ligne de la table
 * d'erreurs du connecteur qui s'applique (une ligne à condition, si son corps la satisfait), sinon `rate_limited` (429)
 * ou `upstream_error` ; un 2xx dont le corps satisfait une ligne à condition de son statut (un refus sous un 200) ;
 * panne, délai dépassé, réponse trop grosse ou illisible : `upstream_error`. `resign` : après un 401, la requête signée
 * de neuf (un jeton renouvelé), envoyée une fois de plus. `bound` : une autre borne que 4 Mo (un fichier en base64).
 * `unreadable` : le refus d'une réponse illisible (un fichier JSON, `file_unreadable`).
 */
export async function requestJson(api: ConnectorApi, request: ApiRequest, fetcher: Fetch = fetch, options: RequestOptions = {}): Promise<unknown> {
  const answer = await answered(api, request, fetcher, options.resign)
  const value = await readAnswer(api, answer, options)
  const refused = rowOf(api, answer.status, value)
  if (refused) {
    console.error(`[platform] connector ${api.label}: status ${answer.status} refused by its body`)
    throw refusalOf(refused)
  }
  return value
}

/**
 * Le JSON d'une réponse, borné à 4 Mo (ou à `bound`), `null` pour une réponse vide ; trop grosse (le refus de `bound`) ou
 * illisible (le refus d'`unreadable`) : `upstream_error` à défaut.
 */
async function readAnswer(api: ConnectorApi, answer: Response, { bound, unreadable }: RequestOptions = {}): Promise<unknown> {
  let bytes: Uint8Array | null
  try {
    bytes = answer.body ? await readBounded(answer.body, bound?.maxBytes ?? MAX_ANSWER_BYTES, () => null) : new Uint8Array()
  } catch (error) {
    // Le délai court jusqu'à la fin de la lecture du corps.
    throw unreachable(api, readFailure(answer, error))
  }
  if (bytes === null) throw bound ? bound.tooLarge() : new PlatformError("upstream_error", `${api.label} sent an answer too large to read. Narrow the request.`)
  if (bytes.length === 0) return null
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    console.error(`[platform] connector ${api.label}: answer is not JSON`)
    throw unreadable ? unreadable() : new PlatformError("upstream_error", `${api.label} sent an unreadable answer. Retry later.`)
  }
}

/**
 * Un fichier lu dans une réponse : ses octets (`null` au-delà de la borne, annoncée par `content-length` ou comptée à la
 * lecture), le type annoncé (`content-type`, tel quel) et les en-têtes, où se lit son nom.
 */
export type FileAnswer = { bytes: Uint8Array | null; type: string | null; headers: Headers }

/**
 * La lecture d'un fichier : sa borne ; `before`, le contrôle de la tête de la réponse (son type annoncé, son nom) avant
 * toute lecture du corps ; `interrupted`, le refus d'un transfert coupé hors délai, au lieu de la panne.
 */
export type FileReading = { maxBytes: number; before: (head: Omit<FileAnswer, "bytes">) => void; interrupted?: () => PlatformError }

/**
 * Les octets d'une réponse 2xx, `maxBytes` au plus, après `before` : un `content-length` au-delà refuse sans rien lire,
 * sinon la lecture s'arrête au premier octet de trop. Sous le délai de la requête, lecture comprise ; une panne :
 * `upstream_error`, ou `interrupted`.
 */
async function readFileAnswer(api: ConnectorApi, answer: Response, reading: FileReading): Promise<FileAnswer> {
  const found = { type: answer.headers.get("content-type"), headers: answer.headers }
  const announced = Number(answer.headers.get("content-length") ?? Number.NaN)
  const cancel = async () => answer.body?.cancel().catch(() => undefined)
  try {
    reading.before(found)
  } catch (refused) {
    await cancel()
    throw refused
  }
  if (Number.isFinite(announced) && announced > reading.maxBytes) {
    await cancel()
    return { ...found, bytes: null }
  }
  try {
    return { ...found, bytes: answer.body ? await readBounded(answer.body, reading.maxBytes, () => null) : new Uint8Array() }
  } catch (error) {
    if (reading.interrupted && !deadlines.get(answer)?.aborted) throw reading.interrupted()
    throw unreachable(api, readFailure(answer, error))
  }
}

/**
 * Un fichier pour corps de la réponse du tiers (`output.file`, `from: body`) : la requête de `requestJson` (rythme, 429,
 * 401 renouvelé, table d'erreurs), et sur un 2xx ses octets bornés à `maxBytes`, son type annoncé et ses en-têtes.
 */
export async function requestFile(api: ConnectorApi, request: ApiRequest, fetcher: Fetch, reading: FileReading & { resign?: () => Promise<ApiRequest> }): Promise<FileAnswer> {
  return readFileAnswer(api, await answered(api, request, fetcher, reading.resign), reading)
}

/**
 * Le téléchargement d'une adresse rendue par le tiers (`output.file`, `from: url`), par `fetcher` (le transport gardé),
 * en `GET`, sous le délai du tiers, sans redirection ni rythme : hors 2xx, son statut seul, le corps jamais lu ; sinon le
 * fichier borné à `maxBytes`. Ni l'adresse ni les en-têtes ne sont journalisés.
 */
export async function requestDownload(
  api: ConnectorApi,
  target: { url: string; headers: Readonly<Record<string, string>> },
  fetcher: Fetch,
  reading: FileReading,
): Promise<{ status: number; file: FileAnswer | null }> {
  const answer = await deliver(api, target.url, { method: "GET", headers: target.headers }, { fetcher, interrupted: reading.interrupted })
  if (!answer.ok) {
    await answer.body?.cancel().catch(() => undefined)
    return { status: answer.status, file: null }
  }
  return { status: answer.status, file: await readFileAnswer(api, answer, reading) }
}

/** La réponse d'un point de jeton : son JSON, ou son statut et le code d'erreur OAuth qu'elle porte (`invalid_grant`). */
export type TokenAnswer = { ok: true; answer: unknown } | { ok: false; status: number; error: string | null }

/** Un code d'erreur OAuth (RFC 6749 § 5.2) n'a que ces caractères ; autre chose ne se lit pas. */
const OAUTH_ERROR = /^[\x20-\x21\x23-\x5B\x5D-\x7E]{1,64}$/

/**
 * Une requête au point de jeton d'un consentement (`consent.ts`) : comme `requestJson` (délai, rythme, 429), mais une
 * réponse hors 2xx rend son statut et le code `error` de son corps (RFC 6749 § 5.2), pour distinguer un consentement
 * révoqué (`invalid_grant`) d'une application refusée ou d'une panne. Rien d'autre du corps n'est lu ni journalisé.
 */
export async function requestToken(api: ConnectorApi, request: ApiRequest, fetcher: Fetch): Promise<TokenAnswer> {
  let answer = await send(api, request, fetcher)
  for (let retry = 0; answer.status === 429 && retry < MAX_RETRIES; retry++) {
    const ms = retryWait(answer)
    if (ms === null) break
    await answer.body?.cancel()
    await wait(ms)
    answer = await send(api, request, fetcher)
  }
  if (answer.ok) return { ok: true, answer: await readAnswer(api, answer) }
  console.error(`[platform] connector ${api.label}: token endpoint status ${answer.status}`)
  let error: string | null = null
  try {
    const body: unknown = await readAnswer(api, answer)
    const code = typeof body === "object" && body !== null && "error" in body ? body.error : undefined
    error = typeof code === "string" && OAUTH_ERROR.test(code) ? code : null
  } catch {
    // Un corps d'erreur illisible ne dit rien de plus que son statut.
  }
  return { ok: false, status: answer.status, error }
}
