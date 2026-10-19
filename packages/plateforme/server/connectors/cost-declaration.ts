// Le coût d'un appel et le travail asynchrone dans la déclaration d'un connecteur décrit (`connecteurs-et-comptes.md`
// § Moteur des connecteurs décrits) : `cost` (pire cas et quantité relue) et `async` (soumission et relève), contrôlés
// comme les règles 12 et 13 de la fabrique du dépôt `connectors`. Tenu à part de `declaration.ts`, qui l'appelle sur
// chaque fonction préparée ; la règle 5 (aucun coût sur une sonde à solde) reste dans `probe-declaration.ts`.
import { isJsonObject } from "../json"
import type { ConnectorDefinition, ConnectorFunctionDefinition } from "./definition"
import { DOTTED_PATH } from "./probe-declaration"

const COST_KEYS = ["per", "items", "times", "unit", "settle"]
const ASYNC_KEYS = ["collect", "jobId", "withinMs"]
/** Le délai de relève : des secondes entières dans la description (`within_s`), d'une seconde à un jour. */
const COLLECT_MIN_MS = 1_000
const COLLECT_MAX_MS = 86_400_000

const onlyKeys = (value: unknown, keys: readonly string[]): value is Record<string, unknown> => isJsonObject(value) && Object.keys(value).every((key) => keys.includes(key))

/** Un argument que le coût compte : une liste (`type: array`) requise, d'au moins un élément ; `null` : bon. */
function countedListProblem(fn: ConnectorFunctionDefinition, key: "items" | "times", name: unknown): string | null {
  const properties = isJsonObject(fn.schema.properties) ? fn.schema.properties : {}
  const required = Array.isArray(fn.schema.required) ? fn.schema.required : []
  const property = typeof name === "string" && Object.hasOwn(properties, name) ? properties[name] : undefined
  const listed = isJsonObject(property) && property.type === "array" && Number.isInteger(property.minItems) && Number(property.minItems) >= 1
  if (listed && required.includes(name)) return null
  return `${fn.name}: cost.${key} ${JSON.stringify(name)} must be a required list argument (type array, minItems 1 or more), so that the worst case is never zero nor guessed.`
}

/**
 * Le problème du coût d'une fonction (`cost`), comme la règle 12 de la fabrique et son schéma : `per` `request`, `page`
 * ou `item` ; `items` (exigé) et `times` sur `item` seulement, deux listes distinctes, requises et non vides ; `unit`
 * non vide, exigée par `item` et `settle` ; `settle` un chemin pointé ; ni `item` ni `settle` sur une fonction paginée.
 */
export function costProblem(fn: ConnectorFunctionDefinition): string | null {
  const cost: unknown = fn.cost
  if (cost === undefined) return null
  if (!onlyKeys(cost, COST_KEYS) || !["request", "page", "item"].includes(String(cost.per))) {
    return `${fn.name}: cost must be {per: request, page or item, items?, times?, unit?, settle?}.`
  }
  const settle = cost.settle
  if (settle !== undefined && !(onlyKeys(settle, ["path"]) && typeof settle.path === "string" && DOTTED_PATH.test(settle.path))) {
    return `${fn.name}: cost.settle must be {path}, a dotted path.`
  }
  const needsUnit = cost.per === "item" || settle !== undefined
  if (cost.unit !== undefined ? typeof cost.unit !== "string" || cost.unit === "" : needsUnit) return `${fn.name}: cost.unit must be non-empty, and is required per item or with settle.`
  if (cost.per !== "item") return cost.items === undefined && cost.times === undefined ? paginationProblem(fn, settle !== undefined) : `${fn.name}: cost.items and cost.times go with per item only.`
  const counted = countedListProblem(fn, "items", cost.items)
  if (counted || cost.times === undefined) return counted ?? paginationProblem(fn, true)
  if (cost.times === cost.items) return `${fn.name}: cost.times names the items argument ${String(cost.items)} again.`
  return countedListProblem(fn, "times", cost.times) ?? paginationProblem(fn, true)
}

function paginationProblem(fn: ConnectorFunctionDefinition, itemOrSettle: boolean): string | null {
  if (!itemOrSettle || fn.pagination === undefined) return null
  return `${fn.name}: a paginated function costs per request or per page, without settle: each page is a request, and one response does not tell the quantity of the call.`
}

/**
 * Le problème du travail asynchrone d'une fonction (`async`), comme la règle 13 de la fabrique et son schéma : `collect`
 * nomme une autre lecture du connecteur, non asynchrone, dont `jobId.to` est le seul argument requis ; `jobId.from` un
 * chemin pointé ; `withinMs` un entier d'une seconde à un jour, au-delà du délai de la soumission, exigé quand le coût
 * se règle, la relève n'étant alors ni paginée ni réglée de son côté.
 */
export function asyncProblem(definition: ConnectorDefinition, fn: ConnectorFunctionDefinition): string | null {
  const job: unknown = fn.async
  if (job === undefined) return null
  const jobId = isJsonObject(job) ? job.jobId : undefined
  if (!onlyKeys(job, ASYNC_KEYS) || typeof job.collect !== "string" || !onlyKeys(jobId, ["from", "to"]) || typeof jobId.from !== "string" || !DOTTED_PATH.test(jobId.from) || typeof jobId.to !== "string") {
    return `${fn.name}: async must be {collect, jobId: {from: a dotted path, to}, withinMs?}.`
  }
  const collect = definition.functions.find((candidate) => candidate.name === job.collect)
  if (!collect || collect === fn) return `${fn.name}: async.collect ${job.collect} is not another function of the connector.`
  if (collect.class !== "read" || collect.async !== undefined) return `${fn.name}: async.collect ${collect.name} must be a read function, not asynchronous itself.`
  const required = Array.isArray(collect.schema.required) ? collect.schema.required : []
  const properties = isJsonObject(collect.schema.properties) ? collect.schema.properties : {}
  if (required.length !== 1 || required[0] !== jobId.to || !Object.hasOwn(properties, jobId.to)) {
    return `${fn.name}: async.jobId.to ${jobId.to} must be the only required argument of ${collect.name}.`
  }
  const within = job.withinMs
  const timeout = fn.timeoutMs ?? definition.timeoutMs
  if (within !== undefined && !(Number.isInteger(within) && Number(within) >= COLLECT_MIN_MS && Number(within) <= COLLECT_MAX_MS && Number(within) > timeout)) {
    return `${fn.name}: async.withinMs must be an integer from ${COLLECT_MIN_MS} to ${COLLECT_MAX_MS}, beyond the timeout of the submission (${timeout}).`
  }
  if (fn.cost?.settle === undefined) return null
  if (within === undefined) return `${fn.name}: async.withinMs is required when the cost is settled: its quantity is read when collected.`
  if (collect.pagination !== undefined || collect.cost?.settle !== undefined) {
    return `${fn.name}: its quantity is read in the responses of ${collect.name}, which must be neither paginated nor settled on its own.`
  }
  return null
}
