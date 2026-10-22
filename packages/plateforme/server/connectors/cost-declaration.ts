// Le coût d'un appel et le travail asynchrone dans la déclaration d'un connecteur décrit (`connecteurs-et-comptes.md`
// § Moteur des connecteurs décrits) : `cost` (pire cas et quantité relue) et `async` (soumission et relève), contrôlés
// comme les règles 12 et 13 de la fabrique du dépôt `connectors`. Tenu à part de `declaration.ts`, qui l'appelle sur
// chaque fonction préparée ; la règle 5 (aucun coût sur une sonde à solde) reste dans `probe-declaration.ts`. Aussi
// les clés d'une fonction : une clé que le paquet n'exécute pas (une fonction longue, `background`, que la tâche de fond
// n'exécute pas encore) est refusée, jamais ignorée, sans quoi la fonction partirait autrement que décrite.
import { isJsonObject } from "../json"
import type { ConnectorDefinition, ConnectorFunctionDefinition } from "./definition"
import { DOTTED_PATH } from "./probe-declaration"

const COST_KEYS = ["per", "quantity", "items", "times", "weights", "unit", "settle"]
const ASYNC_KEYS = ["collect", "jobId", "withinMs", "noDeadline"]
const FUNCTION_KEYS = ["name", "connector", "class", "act", "scopes", "description", "schema", "examples", "refusals", "checks", "expect", "request", "pagination", "output", "timeoutMs", "async", "cost", "confirm"]
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
 * Le poids d'une valeur (`weights`), comme la règle 12 de la fabrique : une table de valeurs à poids entiers d'un ou plus ;
 * `field`, un champ de chaque élément de `items`, requis, une liste d'au moins une valeur sans doublon, dont les valeurs
 * admises (`items.enum`) sont exactement les clés de la table : une valeur sans poids est refusée par le schéma, avant
 * l'appel, jamais comptée pour rien. `null` : bon.
 */
function weightsProblem(fn: ConnectorFunctionDefinition, items: string, weights: unknown): string | null {
  const values = isJsonObject(weights) ? weights.values : undefined
  if (!onlyKeys(weights, ["field", "values"]) || typeof weights.field !== "string" || !isJsonObject(values) || Object.keys(values).length === 0
    || !Object.entries(values).every(([value, weight]) => value !== "" && Number.isInteger(weight) && Number(weight) >= 1)) {
    return `${fn.name}: cost.weights must be {field, values: {value: an integer weight of 1 or more}}, with at least one value.`
  }
  const properties = isJsonObject(fn.schema.properties) ? fn.schema.properties : {}
  const list = properties[items]
  const element = isJsonObject(list) && isJsonObject(list.items) ? list.items : {}
  const field = isJsonObject(element.properties) ? element.properties[weights.field] : undefined
  const required = Array.isArray(element.required) ? element.required : []
  const listed = isJsonObject(field) && field.type === "array" && Number.isInteger(field.minItems) && Number(field.minItems) >= 1 && field.uniqueItems === true
  if (!listed || !required.includes(weights.field)) {
    return `${fn.name}: cost.weights.field ${JSON.stringify(weights.field)} must be a required list of each element of ${items} (type array, minItems 1 or more, uniqueItems true), so that each element counts at least one weight, each value once.`
  }
  const allowed = isJsonObject(field.items) ? field.items.enum : undefined
  const keys = Object.keys(values).sort()
  const same = Array.isArray(allowed) && allowed.every((value) => typeof value === "string") && JSON.stringify([...new Set(allowed)].sort()) === JSON.stringify(keys)
  return same ? null : `${fn.name}: cost.weights.field ${weights.field}: its allowed values (items.enum) must be exactly the weighted values (${keys.join(", ")}), so that a value without a weight is refused before the call.`
}

/**
 * Le problème du coût d'une fonction (`cost`), comme la règle 12 de la fabrique et son schéma : `per` `request`, `page`
 * ou `item` ; `quantity`, un entier de deux ou plus, sur `request` et `page` seulement ; `items` (exigé) et `times` ou
 * `weights` sur `item` seulement, `times` une liste distincte, les deux listes requises et non vides, `weights` exclusif
 * de `times` ; `unit` non vide, exigée par `item`, `settle` et `quantity` ; `settle` un chemin pointé ; ni `item` ni
 * `settle` sur une fonction paginée.
 */
export function costProblem(fn: ConnectorFunctionDefinition): string | null {
  const cost: unknown = fn.cost
  if (cost === undefined) return null
  if (!onlyKeys(cost, COST_KEYS) || !["request", "page", "item"].includes(String(cost.per))) {
    return `${fn.name}: cost must be {per: request, page or item, quantity?, items?, times? or weights?, unit?, settle?}.`
  }
  const quantity = cost.quantity
  if (quantity !== undefined && cost.per === "item") return `${fn.name}: cost.quantity goes with per request or page only: per item counts its items.`
  if (quantity !== undefined && !(Number.isInteger(quantity) && Number(quantity) >= 2)) return `${fn.name}: cost.quantity must be an integer of 2 or more (absent, a request costs one).`
  const settle = cost.settle
  if (settle !== undefined && !(onlyKeys(settle, ["path"]) && typeof settle.path === "string" && DOTTED_PATH.test(settle.path))) {
    return `${fn.name}: cost.settle must be {path}, a dotted path.`
  }
  const needsUnit = cost.per === "item" || settle !== undefined || quantity !== undefined
  if (cost.unit !== undefined ? typeof cost.unit !== "string" || cost.unit === "" : needsUnit) return `${fn.name}: cost.unit must be non-empty, and is required per item, with settle or with quantity.`
  if (cost.per !== "item") {
    return cost.items === undefined && cost.times === undefined && cost.weights === undefined ? paginationProblem(fn, settle !== undefined) : `${fn.name}: cost.items, cost.times and cost.weights go with per item only.`
  }
  const counted = countedListProblem(fn, "items", cost.items)
  if (counted) return counted
  if (cost.weights !== undefined) {
    if (cost.times !== undefined) return `${fn.name}: cost.weights replaces cost.times: declare one of them.`
    return weightsProblem(fn, String(cost.items), cost.weights) ?? paginationProblem(fn, true)
  }
  if (cost.times === undefined) return paginationProblem(fn, true)
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
 * se règle, sauf `noDeadline: true` (l'éditeur ne fixe aucune échéance), exclusif de `withinMs` ; la relève n'est
 * alors ni paginée ni réglée de son côté.
 */
export function asyncProblem(definition: ConnectorDefinition, fn: ConnectorFunctionDefinition): string | null {
  const job: unknown = fn.async
  if (job === undefined) return null
  const jobId = isJsonObject(job) ? job.jobId : undefined
  if (!onlyKeys(job, ASYNC_KEYS) || typeof job.collect !== "string" || !onlyKeys(jobId, ["from", "to"]) || typeof jobId.from !== "string" || !DOTTED_PATH.test(jobId.from) || typeof jobId.to !== "string") {
    return `${fn.name}: async must be {collect, jobId: {from: a dotted path, to}, withinMs? or noDeadline: true?}.`
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
  if (job.noDeadline !== undefined && (job.noDeadline !== true || within !== undefined)) {
    return `${fn.name}: async.noDeadline is true or absent, and excludes async.withinMs: the vendor sets no deadline, or one is declared.`
  }
  const timeout = fn.timeoutMs ?? definition.timeoutMs
  if (within !== undefined && !(Number.isInteger(within) && Number(within) >= COLLECT_MIN_MS && Number(within) <= COLLECT_MAX_MS && Number(within) > timeout)) {
    return `${fn.name}: async.withinMs must be an integer from ${COLLECT_MIN_MS} to ${COLLECT_MAX_MS}, beyond the timeout of the submission (${timeout}).`
  }
  if (fn.cost?.settle === undefined) return null
  if (within === undefined && job.noDeadline !== true) {
    return `${fn.name}: async.withinMs, or async.noDeadline when the vendor sets no deadline, is required when the cost is settled: its quantity is read when collected.`
  }
  if (collect.pagination !== undefined || collect.cost?.settle !== undefined) {
    return `${fn.name}: its quantity is read in the responses of ${collect.name}, which must be neither paginated nor settled on its own.`
  }
  return null
}

/** La première clé d'une fonction que le paquet n'exécute pas ; `null` : aucune. */
export function functionKeysProblem(fn: ConnectorFunctionDefinition): string | null {
  const unknown = Object.keys(fn).find((key) => !FUNCTION_KEYS.includes(key))
  return unknown === undefined ? null : `${fn.name}: unknown key ${unknown}: this package does not execute it, so the function is refused, not run otherwise.`
}
