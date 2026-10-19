// Ce que coûte un appel d'une fonction décrite, en fonctions pures (`connecteurs-et-comptes.md` § Moteur des connecteurs
// décrits, Coût) : le pire cas avant l'appel (`costOf`), la quantité à régler après (`settledQuantity`) et la relève
// d'un travail asynchrone (`collectionOf`), selon `cost` et `async` de la définition, tels que les décrit le format
// (`connectors : docs/conception/format-de-description.md` § Coût d'un appel, § Travail asynchrone). Le moteur ne s'en
// sert pas : rien n'est réservé, réglé ni relevé par le paquet ; un service de l'hôte peut s'en servir. Aucune
// lecture de base, aucun appel.
import { isJsonObject } from "../json"
import type { ConnectorCostWeights, ConnectorFunctionCost, ConnectorFunctionDefinition } from "./definition"
import { pageCount, valueAt } from "./engine"

/** Un coût qui ne se calcule pas : des arguments que le schéma n'a pas validés, une soumission sans identifiant de travail. */
export class ConnectorCostError extends Error {
  override name = "ConnectorCostError"
}

/** Une quantité, dans l'unité que nomme le coût de la fonction. */
export type ConnectorCostQuantity = { readonly quantity: number; readonly unit: string }

/**
 * La quantité à régler et d'où elle vient : `response`, lue au chemin `settle` ; `requests`, les requêtes envoyées
 * (une réponse par page), pour `request` et `page` sans `settle` ; `worst_case`, le pire cas, pour `item` sans
 * `settle` ; `unreadable`, le pire cas faute de valeur lisible au chemin `settle` (pour un travail asynchrone, « pas
 * encore » avant son échéance). `exceeded` : une quantité lue au-dessus du pire cas, réglée telle quelle (l'éditeur l'a
 * facturée) et à signaler, la description sous-estimant (une offre sur mesure plus chère que le barème publié).
 */
export type ConnectorSettlement = ConnectorCostQuantity & { readonly from: "response" | "requests" | "worst_case" | "unreadable"; readonly exceeded: boolean }

/**
 * La relève d'un travail soumis : la fonction qualifiée à appeler, ses arguments, le délai de relève (`null` : non
 * déclaré) et `noDeadline`, l'éditeur ne fixant aucune échéance (le plafond est alors celui du service qui réserve).
 */
export type ConnectorCollection = {
  readonly function: string
  readonly args: Readonly<Record<string, string | number>>
  readonly withinMs: number | null
  readonly noDeadline: boolean
}

/** L'unité d'un coût : déclarée, sinon des requêtes (`request`) ou des pages (`page`). */
function unitOf(cost: ConnectorFunctionCost): string {
  if (cost.unit !== undefined) return cost.unit
  return cost.per === "page" ? "pages" : "requests"
}

function listLength(fn: ConnectorFunctionDefinition, args: Record<string, unknown>, name: string): number {
  const value = args[name]
  if (!Array.isArray(value) || value.length === 0) {
    throw new ConnectorCostError(`${fn.name}: cost argument ${name} is not a non-empty list: validate the arguments against the schema first.`)
  }
  return value.length
}

/**
 * La somme, sur les éléments de `items`, des poids des valeurs que chacun liste dans `weights.field` ;
 * `ConnectorCostError` sur un élément sans liste de valeurs, ou une valeur sans poids : jamais comptée pour rien.
 */
function weighted(fn: ConnectorFunctionDefinition, args: Record<string, unknown>, items: string, weights: ConnectorCostWeights): number {
  const elements = args[items]
  if (!Array.isArray(elements) || elements.length === 0) {
    throw new ConnectorCostError(`${fn.name}: cost argument ${items} is not a non-empty list: validate the arguments against the schema first.`)
  }
  let total = 0
  for (const element of elements) {
    const listed: unknown = isJsonObject(element) ? element[weights.field] : undefined
    if (!Array.isArray(listed) || listed.length === 0) {
      throw new ConnectorCostError(`${fn.name}: each element of ${items} lists its ${weights.field}: validate the arguments against the schema first.`)
    }
    for (const value of listed) {
      const weight = typeof value === "string" && Object.hasOwn(weights.values, value) ? weights.values[value] : undefined
      if (weight === undefined) throw new ConnectorCostError(`${fn.name}: ${weights.field} value ${JSON.stringify(value)} has no weight: validate the arguments against the schema first.`)
      total += weight
    }
  }
  return total
}

/**
 * Le pire cas d'un appel, sur ses arguments validés : `request` et `page`, les requêtes qu'il peut envoyer (une, ou les
 * pages d'une lecture avec `all_pages`) ; `item`, la taille de `items` fois celle de `times` (une sans `times`), ou la
 * somme des poids des valeurs que liste chaque élément (`weights`). `null` pour une fonction sans coût ;
 * `ConnectorCostError` si une liste comptée manque ou est vide, ou si une valeur n'a pas de poids.
 */
export function costOf(fn: ConnectorFunctionDefinition, args: Record<string, unknown>): ConnectorCostQuantity | null {
  const cost = fn.cost
  if (cost === undefined) return null
  if (cost.per !== "item") return { quantity: pageCount(fn, args), unit: unitOf(cost) }
  if (cost.weights !== undefined) return { quantity: weighted(fn, args, cost.items, cost.weights), unit: unitOf(cost) }
  const times = cost.times === undefined ? 1 : listLength(fn, args, cost.times)
  return { quantity: listLength(fn, args, cost.items) * times, unit: unitOf(cost) }
}

/**
 * La quantité à régler après un appel réussi, sur ses arguments et `answers`, les réponses JSON du tiers telles qu'il
 * les a envoyées : celles de l'appel, une par page ; pour un travail asynchrone qui se règle, celles de sa relève reçues
 * jusqu'ici. Avec `settle`, la première valeur lisible au chemin (un nombre JSON fini, positif ou nul), sinon le pire
 * cas (`unreadable`) ; sans `settle`, les requêtes envoyées (`request`, `page`) ou le pire cas (`item`). `exceeded`, une
 * valeur lue au-dessus du pire cas. `null` pour une fonction sans coût.
 */
export function settledQuantity(fn: ConnectorFunctionDefinition, args: Record<string, unknown>, answers: readonly unknown[]): ConnectorSettlement | null {
  const worst = costOf(fn, args)
  const cost = fn.cost
  if (worst === null || cost === undefined) return null
  if (cost.settle !== undefined) {
    const path = cost.settle.path
    const read = answers.map((answer) => valueAt(answer, path)).find((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0)
    return read === undefined ? { ...worst, from: "unreadable", exceeded: false } : { quantity: read, unit: worst.unit, from: "response", exceeded: read > worst.quantity }
  }
  if (cost.per === "item") return { ...worst, from: "worst_case", exceeded: false }
  if (answers.length === 0) throw new ConnectorCostError(`${fn.name}: a settled call has at least one response.`)
  return { quantity: answers.length, unit: worst.unit, from: "requests", exceeded: false }
}

/**
 * La relève d'un travail que la fonction a soumis, lue dans `answer`, la réponse de la soumission : la fonction de relève
 * (nom qualifié), son argument `jobId.to` portant l'identifiant lu à `jobId.from` (un texte non vide ou un nombre fini),
 * le délai de relève et l'absence d'échéance. `null` pour une fonction qui n'est pas asynchrone ; `ConnectorCostError`
 * sans identifiant.
 */
export function collectionOf(fn: ConnectorFunctionDefinition, answer: unknown): ConnectorCollection | null {
  const job = fn.async
  if (job === undefined) return null
  const id = valueAt(answer, job.jobId.from)
  if (!((typeof id === "string" && id !== "") || (typeof id === "number" && Number.isFinite(id)))) {
    throw new ConnectorCostError(`${fn.name}: the submission answered without its job id at ${job.jobId.from}.`)
  }
  return { function: job.collect, args: { [job.jobId.to]: id }, withinMs: job.withinMs ?? null, noDeadline: job.noDeadline === true }
}
