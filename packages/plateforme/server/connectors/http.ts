// Client HTTP des connecteurs réels (`connecteurs-et-comptes.md`, H85 ; moteur des connecteurs décrits) : une requête
// vers l'API d'un tiers, au rythme que le tiers admet par compte, un délai, un nouvel essai borné après un 429, et la
// table d'erreurs du connecteur traduite en `PlatformError`. Sans lui, le moteur recopierait l'appel, le délai et la
// traduction des statuts. Le secret arrive dans les en-têtes que le moteur pose et ne sort jamais d'ici : ni dans un
// message, ni dans un log, ni comme cause d'une erreur ; aucun en-tête ni aucune adresse n'est journalisé.
import { readBounded } from "../bounded-read"
import { PlatformError, type PlatformErrorCode } from "../errors"

/** Une réponse plus grosse ne se lit pas : le résultat d'un outil tient de toute façon en 45 000 caractères. */
const MAX_ANSWER_BYTES = 4 * 1024 * 1024

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

async function send(api: ConnectorApi, request: ApiRequest, fetcher: Fetch): Promise<Response> {
  const query = request.query?.length ? `?${new URLSearchParams(request.query.map(([key, value]) => [key, value])).toString()}` : ""
  const headers: Record<string, string> = { accept: "application/json", ...request.headers }
  if (request.body !== undefined) headers["content-type"] = "application/json"
  if (request.form !== undefined) headers["content-type"] = "application/x-www-form-urlencoded"
  if (request.raw !== undefined) headers["content-type"] = request.raw.contentType
  const body = request.form !== undefined ? new URLSearchParams(request.form.map(([key, value]) => [key, value])).toString() : request.body
  const sent = request.raw !== undefined ? request.raw.bytes : body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body)
  await pace(request.pacingKey, api.rateLimit)
  try {
    return await fetcher(`${api.baseUrl}${request.path}${query}`, {
      method: request.method,
      headers,
      body: sent,
      redirect: "error",
      signal: AbortSignal.timeout(api.timeoutMs),
    })
  } catch (error) {
    // Un refus du transport (adresse saisie gardée, `address-guard.ts`) se dit tel quel.
    if (error instanceof PlatformError) throw error
    throw unreachable(api, error)
  }
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
 * Envoie la requête au tiers et rend le JSON de sa réponse, `null` pour une réponse vide. Un 429 se rejoue deux fois au
 * plus, après le `Retry-After` du tiers s'il tient en 10 s. Refus : statut hors 2xx, la première ligne de la table
 * d'erreurs du connecteur qui s'applique (une ligne à condition, si son corps la satisfait), sinon `rate_limited` (429)
 * ou `upstream_error` ; un 2xx dont le corps satisfait une ligne à condition de son statut (un refus sous un 200) ;
 * panne, délai dépassé, réponse trop grosse ou illisible : `upstream_error`. `resign` : après un 401, la requête signée
 * de neuf (un jeton renouvelé), envoyée une fois de plus.
 */
export async function requestJson(api: ConnectorApi, request: ApiRequest, fetcher: Fetch = fetch, resign?: () => Promise<ApiRequest>): Promise<unknown> {
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
  const value = await readAnswer(api, answer)
  const refused = rowOf(api, answer.status, value)
  if (refused) {
    console.error(`[platform] connector ${api.label}: status ${answer.status} refused by its body`)
    throw refusalOf(refused)
  }
  return value
}

/** Le JSON d'une réponse, borné à 4 Mo, `null` pour une réponse vide ; trop grosse ou illisible : `upstream_error`. */
async function readAnswer(api: ConnectorApi, answer: Response): Promise<unknown> {
  let bytes: Uint8Array | null
  try {
    bytes = answer.body ? await readBounded(answer.body, MAX_ANSWER_BYTES, () => null) : new Uint8Array()
  } catch (error) {
    // Le délai court jusqu'à la fin de la lecture du corps.
    throw unreachable(api, error)
  }
  if (bytes === null) throw new PlatformError("upstream_error", `${api.label} sent an answer too large to read. Narrow the request.`)
  if (bytes.length === 0) return null
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    console.error(`[platform] connector ${api.label}: answer is not JSON`)
    throw new PlatformError("upstream_error", `${api.label} sent an unreadable answer. Retry later.`)
  }
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
