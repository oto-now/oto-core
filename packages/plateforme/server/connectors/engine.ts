// Le moteur des connecteurs décrits (`connecteurs-et-comptes.md` § Moteur des connecteurs décrits) : il exécute une
// fonction déclarée par l'hôte à partir de sa seule définition. Contrôles des arguments (`checks`) avant tout envoi ;
// requête composée (en-têtes du connecteur, puis constantes et arguments de la fonction, authentification en dernier ;
// chemin aux `{param}` encodés ; query, listes selon `queryArrays` ; corps JSON quelle que soit la méthode ; `encode:
// json`) ; pagination suivie quand l'agent passe `all_pages` ; contrôles de la réponse (`expect`) ; sortie taillée
// (`output`) et texte du résultat composé ici ; adresse résolue sur les réglages du compte et sur son identité chez le
// tiers (`linkedId`, compte rattaché) ; corps multipart d'une fonction qui envoie un fichier en transit de l'appelant
// (`multipart.ts`), consommé après un appel réussi ; fichier rendu par la fonction (`output.file`, `file-output.ts`), rangé
// en transit de l'appelant. Sans lui, chaque connecteur s'écrirait à la main. Le secret ne va que dans
// l'authentification de la requête (`auth.ts`) : jamais dans un argument, un texte, une erreur ni un log.
import type { AccountMarkReason } from "../../schemas"
import type { FunctionOutput, FunctionSummary } from "../catalog/define"
import { PlatformError, type PlatformErrorCode } from "../errors"
import { cut } from "../journal"
import { isJsonObject } from "../json"
import { guardedFetch } from "./address-guard"
import { renewsOnUnauthorized, sign, type AccountCredential, type AccountMarker, type PreparedAuth, type Signature, type Signer } from "./auth"
import type { ConnectorBodyCondition, ConnectorDefinition, ConnectorFunctionDefinition, ConnectorPagination } from "./definition"
import { runFileOutput } from "./file-output"
import { requestJson, type ApiError, type ApiRequest, type ConnectorApi, type Fetch } from "./http"
import { consumeSent, uploadOf, type TransitFiles, type Upload } from "./multipart"
import { resolveAddress, type AddressSpec } from "./settings"

/** Une fonction décrite prête à courir, préparée une fois à la déclaration (`declaration.ts`). */
export type PreparedFunction = {
  connector: ConnectorDefinition
  fn: ConnectorFunctionDefinition
  /** Le tiers, avec la table d'erreurs de la fonction : ses refus à statut HTTP, puis ceux du connecteur ; l'adresse se résout à l'appel. */
  api: Omit<ConnectorApi, "baseUrl">
  /** L'adresse déclarée, résolue sur les réglages du compte à chaque appel. */
  address: AddressSpec
  /** L'authentification déclarée : les champs du compte qu'elle lit, et où elle les pose. */
  auth: PreparedAuth
  /** L'argument qui porte le curseur de la page suivante (`pagination.requestParam`), s'il y a pagination. */
  cursorArgument: string | null
}

/**
 * Ce qu'il faut pour un appel : le compte résolu (champs, réglages, jeton), son identifiant (clé du rythme), et `fetch`.
 * `settlesMark` : l'appelant lève ou pose la marque du compte lui-même après un succès (la sonde à solde, qui juge le
 * solde lu) ; un refus qui marque la pose toujours ici. `files` : les fichiers en transit de l'appelant, pour une
 * fonction qui en envoie (`request.files`) ou qui en rend un (`output.file`, `keep`).
 */
export type DescribedCall = { credential: AccountCredential | undefined; accountId: string; fetcher?: Fetch; settlesMark?: true; files?: TransitFiles }

/** Le code du paquet d'un statut du tiers (H04, liste fermée) ; le refus nommé par la description reste dans le message. */
export function platformCode(status: number): PlatformErrorCode {
  if (status === 400 || status === 422) return "invalid_arguments"
  if (status === 404) return "not_found"
  if (status === 409) return "conflict"
  if (status === 429) return "rate_limited"
  return "upstream_error"
}

/** Vrai si la valeur au chemin `path` du corps est égale (stricte) à l'une de `equals`. */
function bodyMatches(condition: ConnectorBodyCondition): (answer: unknown) => boolean {
  return (answer) => {
    const value = valueAt(answer, condition.path)
    return condition.equals.some((expected) => expected === value)
  }
}

/**
 * La table d'erreurs d'une fonction : ses refus dont `when` est un statut passent avant la table du connecteur. Une
 * ligne qui marque le compte rend le code de sa marque (`credential_rejected`, `quota_exhausted`), les autres le code
 * de leur statut ; une condition sur le corps devient le prédicat que lit le client HTTP.
 */
export function errorTable(connector: ConnectorDefinition, fn: ConnectorFunctionDefinition): ApiError[] {
  const own = fn.refusals.flatMap((refusal) => (typeof refusal.when === "number" ? [{ ...refusal, status: refusal.when }] : []))
  return [...own, ...connector.errors].map((error) => {
    const statuses = typeof error.status === "number" ? [error.status] : error.status
    return {
      status: error.status,
      code: error.marksAccount ?? platformCode(statuses[0]),
      message: `${error.message} (${error.code})`,
      refusal: error.code,
      ...(error.body ? { body: bodyMatches(error.body) } : {}),
    }
  })
}

/** La valeur au chemin pointé (`items`, `data.next_cursor`, `lines.0.id`), `undefined` s'il manque. */
export function valueAt(value: unknown, path: string): unknown {
  let current = value
  for (const segment of path.split(".")) {
    if (isJsonObject(current)) current = current[segment]
    else if (Array.isArray(current) && /^\d+$/.test(segment)) current = current[Number(segment)]
    else return undefined
  }
  return current
}

/** Ni absente, ni nulle, ni chaîne, liste ou objet vides (`expect` et sonde). */
export function nonEmpty(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return false
  if (Array.isArray(value)) return value.length > 0
  return !isJsonObject(value) || Object.keys(value).length > 0
}

/** Le refus nommé d'une fonction (`checks`, `expect`) : son message et son code ; la déclaration a vérifié qu'il existe. */
function namedRefusal(fn: ConnectorFunctionDefinition, code: string, as: PlatformErrorCode, suffix = ""): PlatformError {
  const refusal = fn.refusals.find((candidate) => candidate.code === code)
  return new PlatformError(as, `${refusal?.message ?? code}${suffix} (${code})`, { refusal: code })
}

const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/

/** Un montant décimal exact : `"700.10"` → 70010 unités à l'échelle 2 ; absent : zéro ; illisible : `null`. */
function decimal(value: unknown): { units: bigint; scale: number } | null {
  if (value === undefined || value === null) return { units: BigInt(0), scale: 0 }
  const text = typeof value === "number" ? String(value) : value
  if (typeof text !== "string") return null
  const match = DECIMAL.exec(text.trim())
  if (!match) return null
  const fraction = match[3] ?? ""
  return { units: BigInt(`${match[1]}${match[2]}${fraction}`), scale: fraction.length }
}

/** La somme exacte d'un champ sur les éléments, à l'échelle commune ; `null` dès qu'une valeur est illisible. */
function exactSum(items: readonly unknown[], field: string): { units: bigint; scale: number } | null {
  const values = items.map((item) => decimal(isJsonObject(item) ? item[field] : undefined))
  if (values.some((value) => value === null)) return null
  const read = values.filter((value) => value !== null)
  const scale = Math.max(0, ...read.map((value) => value.scale))
  const units = read.reduce((total, value) => total + value.units * BigInt(10) ** BigInt(scale - value.scale), BigInt(0))
  return { units, scale }
}

/** Les contrôles des arguments (`checks`), joués avant tout envoi : le premier qui échoue rend son refus nommé. */
function runChecks(fn: ConnectorFunctionDefinition, args: Record<string, unknown>): void {
  for (const check of fn.checks ?? []) {
    const items = valueAt(args, check.items)
    const list = Array.isArray(items) ? items : []
    const [left, right] = check.fields.map((field) => exactSum(list, field))
    const scale = Math.max(left?.scale ?? 0, right?.scale ?? 0)
    const balanced =
      left !== null &&
      right !== null &&
      left.units * BigInt(10) ** BigInt(scale - left.scale) === right.units * BigInt(10) ** BigInt(scale - right.scale)
    if (!balanced) throw namedRefusal(fn, check.refusal, "invalid_arguments", " Nothing was sent.")
  }
}

/**
 * Une requête de l'appel, telle que le moteur la passe à la lecture de sa réponse : le tiers, la requête signée, son
 * transport, sa signature de neuf après un 401 ; `signature`, celle de la dernière requête signée ; `download`, le
 * transport gardé d'une adresse rendue par le tiers ; `expect`, les contrôles de la réponse JSON.
 */
export type Exchange = {
  api: ConnectorApi
  request: ApiRequest
  fetcher: Fetch
  resign?: () => Promise<ApiRequest>
  signature: () => Signature
  download: Fetch
  expect: (answer: unknown) => void
}

/** La lecture de la réponse d'une page : le JSON contrôlé (`readJson`), ou le fichier d'une sortie `output.file`. */
export type AnswerReader = (exchange: Exchange) => Promise<unknown>

/** La lecture d'une réponse JSON : `requestJson`, puis les contrôles de la réponse. */
const readJson: AnswerReader = async (exchange) => {
  const answer = await requestJson(exchange.api, exchange.request, exchange.fetcher, { resign: exchange.resign })
  exchange.expect(answer)
  return answer
}

/** Les contrôles de la réponse (`expect`) : le premier qui échoue rend son refus nommé au lieu de la réponse. */
function runExpectations(fn: ConnectorFunctionDefinition, answer: unknown): void {
  for (const expectation of fn.expect ?? []) {
    if (!nonEmpty(valueAt(answer, expectation.path))) throw namedRefusal(fn, expectation.refusal, "not_found")
  }
}

/** Une valeur dans une query, un chemin ou un en-tête : texte tel quel, nombre et booléen écrits, le reste en JSON. */
function asText(value: unknown): string {
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return JSON.stringify(value)
}

/** Un argument tel qu'il part : sérialisé en JSON si `encode` le dit. */
function placedValue(fn: ConnectorFunctionDefinition, args: Record<string, unknown>, argument: string): unknown {
  return fn.request.encode?.[argument] === "json" ? JSON.stringify(args[argument]) : args[argument]
}

/** Les parties texte d'un corps multipart : constantes du corps, puis arguments donnés, en texte. */
function textParts(fn: ConnectorFunctionDefinition, args: Record<string, unknown>): [string, string][] {
  const constants = Object.entries(fn.request.constants?.body ?? {}).map(([name, value]): [string, string] => [name, asText(value)])
  const given = Object.entries(fn.request.body).filter(([, argument]) => args[argument] !== undefined)
  return [...constants, ...given.map(([name, argument]): [string, string] => [name, asText(placedValue(fn, args, argument))])]
}

/**
 * Le corps multipart d'une fonction qui envoie des fichiers (`request.files`), lus avant tout envoi ; `null` pour une
 * autre. Sans les fichiers de l'appelant, câblage fautif.
 */
async function uploadFor(fn: ConnectorFunctionDefinition, call: DescribedCall, args: Record<string, unknown>): Promise<Upload | null> {
  if (fn.request.files === undefined) return null
  if (!call.files) {
    console.error(`[platform] connector ${fn.connector}: ${fn.name} called without the transit files of the caller`)
    throw new PlatformError("internal", "Internal error.")
  }
  return uploadOf(fn, args, call.files, textParts(fn, args))
}

/**
 * La requête d'une page, composée des seuls arguments donnés ; l'authentification en dernier, rien ne la remplace ;
 * `sending` : le compte (clé du rythme) et, pour une fonction qui envoie des fichiers, le corps multipart déjà encodé,
 * à la place du corps JSON.
 */
function buildRequest(prepared: PreparedFunction, args: Record<string, unknown>, signature: Signature, sending: { accountId: string; upload: Upload | null }): ApiRequest {
  const { accountId, upload } = sending
  const { connector, fn } = prepared
  const spec = fn.request
  const placed = (argument: string): unknown => placedValue(fn, args, argument)
  const path = spec.path.replace(/\{([^{}]+)\}/g, (_whole, name: string) => {
    if (args[name] === undefined || args[name] === null) throw new PlatformError("invalid_arguments", `${fn.name}: argument ${name} is required.`)
    return encodeURIComponent(asText(args[name]))
  })
  const headers: Record<string, string> = {}
  const setHeader = (name: string, value: string) => {
    headers[name.toLowerCase()] = value
  }
  for (const [name, value] of Object.entries(connector.headers ?? {})) setHeader(name, value)
  for (const [name, value] of Object.entries(spec.constants?.headers ?? {})) setHeader(name, value)
  for (const [name, argument] of Object.entries(spec.headers)) if (args[argument] !== undefined) setHeader(name, asText(placed(argument)))
  for (const [name, value] of Object.entries(signature.headers)) setHeader(name, value)
  const query: [string, string][] = Object.entries(spec.constants?.query ?? {}).map(([name, value]) => [name, String(value)])
  for (const [name, argument] of Object.entries(spec.query)) {
    if (args[argument] === undefined) continue
    const value = placed(argument)
    if (!Array.isArray(value)) query.push([name, asText(value)])
    else if (connector.queryArrays === "comma") query.push([name, value.map(asText).join(",")])
    else if (connector.queryArrays === "brackets") query.push(...value.map((item): [string, string] => [`${name}[]`, asText(item)]))
    else if (connector.queryArrays === "repeat") query.push(...value.map((item): [string, string] => [name, asText(item)]))
    else {
      // La déclaration refuse une liste en query sans `queryArrays` : une liste ici vient d'un schéma qui ne la dit pas.
      console.error(`[platform] connector ${connector.name}: list argument ${argument} of ${fn.name} without queryArrays`)
      throw new PlatformError("internal", "Internal error.")
    }
  }
  query.push(...signature.query)
  if (upload) return { method: spec.method, path, query, headers, raw: upload.body, pacingKey: accountId }
  const withBody = Object.keys(spec.body).length > 0 || spec.constants?.body !== undefined
  const body: Record<string, unknown> = { ...spec.constants?.body }
  for (const [name, argument] of Object.entries(spec.body)) if (args[argument] !== undefined) body[name] = placed(argument)
  return { method: spec.method, path, query, headers, body: withBody ? body : undefined, pacingKey: accountId }
}

/** Le curseur de la page suivante, `null` à la dernière page (`more` faux, ou `next` absent ou vide). */
function nextCursor(answer: unknown, pagination: ConnectorPagination | undefined): string | null {
  if (!pagination) return null
  if (pagination.more !== undefined && valueAt(answer, pagination.more) === false) return null
  const next = valueAt(answer, pagination.next)
  if (typeof next === "number") return String(next)
  return typeof next === "string" && next !== "" ? next : null
}

/**
 * Les pages qu'un appel lit au plus : une ; avec `all_pages`, `max_pages` de l'appel borné par `maxPages` (celui-ci quand
 * l'appel n'en donne pas). Partagé par l'exécution et le pire cas d'un coût (`cost.ts`).
 */
export function pageCount(fn: ConnectorFunctionDefinition, args: Record<string, unknown>): number {
  const pagination = fn.pagination
  const wanted = typeof args.max_pages === "number" ? args.max_pages : (pagination?.maxPages ?? 1)
  return pagination && args.all_pages === true ? Math.max(1, Math.min(wanted, pagination.maxPages)) : 1
}

/**
 * Exécute la fonction et rend ses réponses, une par page, et le curseur de la suite. Sans `all_pages`, une page ; avec,
 * jusqu'à `max_pages` (borné par `maxPages`). Refus : un contrôle des arguments, rien d'envoyé ; une erreur du tiers
 * traduite par la table ; un contrôle de la réponse ; une adresse saisie qui mène à un hôte interne. Sans secret :
 * `internal` (le compte réel en a un, `runCall` l'a vérifié). Une adresse issue d'une saisie part par le transport gardé
 * (`address-guard.ts`) ; un échange (`oauth2_client_credentials`) rejoue une fois un 401 sur un jeton neuf. État du
 * compte : un refus de la table qui marque le compte pose sa marque, un appel réussi la lève (`credential.mark`), sauf
 * quand l'appelant la décide (`settlesMark`). Fichiers (`request.files`) : lus avant tout envoi, consommés après un
 * appel réussi seulement, jamais après un refus ni un envoi ambigu (délai, panne, 5xx). `read` : la lecture de chaque
 * réponse, JSON à défaut (le fichier d'une sortie `output.file`, `file-output.ts`, lu dans le même appel).
 */
export async function executeDescribed(
  prepared: PreparedFunction,
  call: DescribedCall,
  args: Record<string, unknown>,
  read: AnswerReader = readJson,
): Promise<{ answers: unknown[]; next: string | null }> {
  const { connector, fn } = prepared
  const { credential } = call
  if (!credential) {
    console.error(`[platform] connector ${connector.name}: ${fn.name} called without the secret of a live account`)
    throw new PlatformError("internal", "Internal error.")
  }
  runChecks(fn, args)
  const upload = await uploadFor(fn, call, args)
  // `fetch` lu à l'appel, jamais au chargement : l'hôte (et un test) peut le remplacer.
  const fetcherFor = (guarded: boolean): Fetch => call.fetcher ?? (guarded ? guardedFetch() : (input, init) => fetch(input, init))
  const identity = connector.accountIdentity && credential.linkedId !== undefined ? { name: connector.accountIdentity.name, value: credential.linkedId } : undefined
  const address = resolveAddress(prepared.address, credential.settings, connector.settings ?? [], identity)
  const api: ConnectorApi = { ...prepared.api, baseUrl: address.url }
  const signer: Signer = { auth: prepared.auth, definition: connector, credential, accountId: call.accountId, fetcherFor }
  const pagination = fn.pagination
  const pages = pageCount(fn, args)
  const answers: unknown[] = []
  let current = args
  let next: string | null = null
  try {
    for (let page = 0; page < pages; page++) {
      const pageArgs = current
      let signature: Signature = { headers: {}, query: [] }
      const signed = async (fresh: boolean) => {
        signature = await sign(signer, fresh)
        return buildRequest(prepared, pageArgs, signature, { accountId: call.accountId, upload })
      }
      const resign = renewsOnUnauthorized(prepared.auth) ? () => signed(true) : undefined
      const request = await signed(false)
      const expect = (json: unknown) => runExpectations(fn, json)
      const answer = await read({ api, request, fetcher: fetcherFor(address.guarded), resign, signature: () => signature, download: fetcherFor(true), expect })
      answers.push(answer)
      next = nextCursor(answer, pagination)
      if (next === null || prepared.cursorArgument === null) break
      current = { ...current, [prepared.cursorArgument]: next }
    }
  } catch (error) {
    throw await markedRefusal(credential.mark, error, `connector ${connector.name}: account ${call.accountId}`)
  }
  if (upload && call.files) await consumeSent(call.files, upload.sent, `connector ${connector.name}: ${fn.name}`)
  // Le premier appel réussi lève la marque du compte ; une levée qui échoue ne rend jamais l'appel en échec.
  const mark = credential.mark
  if (mark && !call.settlesMark) await settleMark(mark, null, `connector ${connector.name}: account ${call.accountId}`)
  return { answers, next }
}

/**
 * Pose (une raison) ou lève (`null`) la marque d'un compte après une réponse du tiers : une écriture qui échoue ne change
 * jamais l'issue que le tiers a rendue (`markWriteFailed`).
 */
export async function settleMark(mark: AccountMarker, reason: AccountMarkReason | null, where: string): Promise<void> {
  await mark.set(reason).catch((error: unknown) => markWriteFailed(mark, reason === null ? "lift_failed" : "mark_failed", where, error))
}

const isMarkReason = (code: PlatformErrorCode): code is AccountMarkReason => code === "credential_rejected" || code === "quota_exhausted"

/**
 * Un refus du tiers qui marque le compte (`marksAccount` : `credential_rejected`, `quota_exhausted`) pose la marque,
 * puis se dit avec elle, sa date et à qui demander ; tout autre refus passe tel quel. Sans marque ouverte (l'identité
 * lue au consentement, avant le compte), le refus passe tel quel. Une pose qui échoue rend le refus du tiers tel quel,
 * sans la phrase de la marque, qui n'est pas posée.
 */
async function markedRefusal(mark: AccountMarker | undefined, error: unknown, where: string): Promise<unknown> {
  if (!mark || !(error instanceof PlatformError) || !isMarkReason(error.code)) return error
  try {
    await mark.set(error.code)
  } catch (failure) {
    markWriteFailed(mark, "mark_failed", where, failure)
    return error
  }
  return new PlatformError(error.code, `${error.message} ${await mark.remedy()}`, error.details)
}

/**
 * L'écriture de la marque a échoué après la réponse du tiers : l'appel garde l'issue que le tiers a rendue (un succès
 * reste un succès : rejoué, un envoi partirait deux fois). L'échec se voit au log serveur (nom de l'erreur et compte,
 * sans secret) et à la ligne de journal de l'appel (`effect`, lu par `runCall`).
 */
function markWriteFailed(mark: AccountMarker, effect: "mark_failed" | "lift_failed", where: string, failure: unknown): void {
  const name = failure instanceof PlatformError ? failure.code : failure instanceof Error ? failure.name : typeof failure
  console.error(`[platform] ${where}: mark ${effect === "lift_failed" ? "not lifted" : "not set"} (${name})`)
  mark.effect = effect
}

/** Un enregistrement taillé par `output` : clés de `strip` retirées, puis seules celles de `projection` gardées. */
function shaped(record: unknown, fn: ConnectorFunctionDefinition): unknown {
  const { strip, projection } = fn.output ?? {}
  if (!isJsonObject(record) || (!strip && !projection)) return record
  return Object.fromEntries(Object.entries(record).filter(([key]) => !strip?.includes(key) && (!projection || projection.includes(key))))
}

/** Les éléments de la liste de chaque page (`output.items`) ; une page sans liste est une réponse inattendue. */
function itemsOf(prepared: PreparedFunction, answers: readonly unknown[], path: string): unknown[] {
  return answers.flatMap((answer) => {
    const list = valueAt(answer, path)
    if (Array.isArray(list)) return list.map((item) => shaped(item, prepared.fn))
    console.error(`[platform] connector ${prepared.connector.name}: ${prepared.fn.name} answer without its list ${path}`)
    throw new PlatformError("upstream_error", `${prepared.connector.label} sent an unexpected answer. Retry later.`)
  })
}

/**
 * Le résultat d'une fonction décrite, composé par le moteur : une ligne de tête, une ligne JSON par élément d'une liste
 * (le formateur coupe à la ligne au-delà de 45 000 caractères), puis la suite de la pagination ; les mêmes données en
 * champs.
 */
export async function runDescribed(prepared: PreparedFunction, call: DescribedCall, args: Record<string, unknown>): Promise<FunctionOutput> {
  const { fn, connector } = prepared
  const file = fn.output?.file
  if (file) return runFileOutput(prepared, call, args, file)
  const { answers, next } = await executeDescribed(prepared, call, args)
  const more =
    next !== null && prepared.cursorArgument !== null
      ? [
          `More results: call again with ${prepared.cursorArgument}: ${JSON.stringify(next)}${args.all_pages === true ? "" : `, or with all_pages: true (${fn.pagination?.maxPages} pages at most)`}.`,
        ]
      : []
  const path = fn.output?.items
  if (path !== undefined) {
    const items = itemsOf(prepared, answers, path)
    const pages = answers.length > 1 ? ` from ${answers.length} pages` : ""
    const head = `${fn.name}: ${items.length} ${items.length === 1 ? "item" : "items"}${pages}${items.length > 0 ? ":" : "."}`
    return {
      text: [head, ...items.map((item) => `- ${JSON.stringify(item)}`), ...more].join("\n"),
      data: { items, next_cursor: next, pages: answers.length },
    }
  }
  const value = shaped(answers[0], fn)
  if (value === null) return { text: `${fn.name}: done; ${connector.label} returned no content.`, data: {} }
  return { text: [`${fn.name}:`, JSON.stringify(value), ...more].join("\n"), data: isJsonObject(value) ? value : { value } }
}

/** Au plus, en caractères, une valeur citée dans un récapitulatif. */
const SUMMARY_VALUE_MAX = 300

/** Le récapitulatif d'une fonction sensible (son `confirm.summary`), ses `{argument}` remplacés par les valeurs données. */
export function describedSummary(template: string, args: Record<string, unknown>): FunctionSummary {
  const text = template.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_whole, name: string) =>
    args[name] === undefined ? "(not given)" : cut(asText(args[name]), SUMMARY_VALUE_MAX),
  )
  return { text, data: { arguments: args } }
}
