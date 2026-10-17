// Le moteur des connecteurs décrits (`connecteurs-et-comptes.md` § Moteur des connecteurs décrits) : il exécute une
// fonction déclarée par l'hôte à partir de sa seule définition. Contrôles des arguments (`checks`) avant tout envoi ;
// requête composée (en-têtes du connecteur, puis constantes et arguments de la fonction, authentification en dernier ;
// chemin aux `{param}` encodés ; query, listes selon `queryArrays` ; corps JSON quelle que soit la méthode ; `encode:
// json`) ; pagination suivie quand l'agent passe `all_pages` ; contrôles de la réponse (`expect`) ; sortie taillée
// (`output`) et texte du résultat composé ici ; adresse résolue sur les réglages du compte et sur son identité chez le
// tiers (`linkedId`, compte rattaché). Sans lui, chaque connecteur s'écrirait à la main. Le secret ne va que dans
// l'authentification de la requête (`auth.ts`) : jamais dans un argument, un texte, une erreur ni un log.
import type { FunctionOutput, FunctionSummary } from "../catalog/define"
import { PlatformError, type PlatformErrorCode } from "../errors"
import { cut } from "../journal"
import { isJsonObject } from "../json"
import { guardedFetch } from "./address-guard"
import { renewsOnUnauthorized, sign, type AccountCredential, type PreparedAuth, type Signature, type Signer } from "./auth"
import type { ConnectorDefinition, ConnectorFunctionDefinition, ConnectorPagination } from "./definition"
import { requestJson, type ApiError, type ApiRequest, type ConnectorApi, type Fetch } from "./http"
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

/** Ce qu'il faut pour un appel : le compte résolu (champs, réglages, jeton), son identifiant (clé du rythme), et `fetch`. */
export type DescribedCall = { credential: AccountCredential | undefined; accountId: string; fetcher?: Fetch }

/** Le code du paquet d'un statut du tiers (H04, liste fermée) ; le refus nommé par la description reste dans le message. */
export function platformCode(status: number): PlatformErrorCode {
  if (status === 400 || status === 422) return "invalid_arguments"
  if (status === 404) return "not_found"
  if (status === 409) return "conflict"
  if (status === 429) return "rate_limited"
  return "upstream_error"
}

/** La table d'erreurs d'une fonction : ses refus dont `when` est un statut passent avant la table du connecteur. */
export function errorTable(connector: ConnectorDefinition, fn: ConnectorFunctionDefinition): ApiError[] {
  const own = fn.refusals.flatMap((refusal) => (typeof refusal.when === "number" ? [{ status: refusal.when, code: refusal.code, message: refusal.message }] : []))
  return [...own, ...connector.errors].map((error) => {
    const statuses = typeof error.status === "number" ? [error.status] : error.status
    return { status: error.status, code: platformCode(statuses[0]), message: `${error.message} (${error.code})`, refusal: error.code }
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

/** La requête d'une page, composée des seuls arguments donnés ; l'authentification en dernier, rien ne la remplace. */
function buildRequest(prepared: PreparedFunction, args: Record<string, unknown>, signature: Signature, accountId: string): ApiRequest {
  const { connector, fn } = prepared
  const spec = fn.request
  const placed = (argument: string): unknown => (spec.encode?.[argument] === "json" ? JSON.stringify(args[argument]) : args[argument])
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
 * Exécute la fonction et rend ses réponses, une par page, et le curseur de la suite. Sans `all_pages`, une page ; avec,
 * jusqu'à `max_pages` (borné par `maxPages`). Refus : un contrôle des arguments, rien d'envoyé ; une erreur du tiers
 * traduite par la table ; un contrôle de la réponse ; une adresse saisie qui mène à un hôte interne. Sans secret :
 * `internal` (le compte réel en a un, `runCall` l'a vérifié). Une adresse issue d'une saisie part par le transport gardé
 * (`address-guard.ts`) ; un échange (`oauth2_client_credentials`) rejoue une fois un 401 sur un jeton neuf.
 */
export async function executeDescribed(
  prepared: PreparedFunction,
  call: DescribedCall,
  args: Record<string, unknown>,
): Promise<{ answers: unknown[]; next: string | null }> {
  const { connector, fn } = prepared
  const { credential } = call
  if (!credential) {
    console.error(`[platform] connector ${connector.name}: ${fn.name} called without the secret of a live account`)
    throw new PlatformError("internal", "Internal error.")
  }
  runChecks(fn, args)
  // `fetch` lu à l'appel, jamais au chargement : l'hôte (et un test) peut le remplacer.
  const fetcherFor = (guarded: boolean): Fetch => call.fetcher ?? (guarded ? guardedFetch() : (input, init) => fetch(input, init))
  const identity = connector.accountIdentity && credential.linkedId !== undefined ? { name: connector.accountIdentity.name, value: credential.linkedId } : undefined
  const address = resolveAddress(prepared.address, credential.settings, connector.settings ?? [], identity)
  const api: ConnectorApi = { ...prepared.api, baseUrl: address.url }
  const signer: Signer = { auth: prepared.auth, definition: connector, credential, accountId: call.accountId, fetcherFor }
  const pagination = fn.pagination
  const wanted = typeof args.max_pages === "number" ? args.max_pages : (pagination?.maxPages ?? 1)
  const pages = pagination && args.all_pages === true ? Math.max(1, Math.min(wanted, pagination.maxPages)) : 1
  const answers: unknown[] = []
  let current = args
  let next: string | null = null
  for (let page = 0; page < pages; page++) {
    const pageArgs = current
    const signed = async (fresh: boolean) => buildRequest(prepared, pageArgs, await sign(signer, fresh), call.accountId)
    const resign = renewsOnUnauthorized(prepared.auth) ? () => signed(true) : undefined
    const answer = await requestJson(api, await signed(false), fetcherFor(address.guarded), resign)
    runExpectations(fn, answer)
    answers.push(answer)
    next = nextCursor(answer, pagination)
    if (next === null || prepared.cursorArgument === null) break
    current = { ...current, [prepared.cursorArgument]: next }
  }
  return { answers, next }
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
