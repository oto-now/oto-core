// Ce que coûte un appel d'une fonction décrite, en fonctions pures (`connecteurs-et-comptes.md` § Moteur des connecteurs
// décrits, Coût) : le pire cas avant l'appel (`costOf`), la quantité à régler après (`settledQuantity`) et la relève
// d'un travail asynchrone (`collectionOf`), selon `cost` et `async` de la définition, tels que les décrit le format
// (`connectors : docs/conception/format-de-description.md` § Coût d'un appel, § Travail asynchrone). Le moteur ne s'en
// sert pas : rien n'est réservé, réglé ni relevé par le paquet ; un service de l'hôte peut s'en servir. Aucune
// lecture de base, aucun appel.
import type { ConnectorFunctionCost, ConnectorFunctionDefinition } from "./definition"
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
 * encore » avant son échéance).
 */
export type ConnectorSettlement = ConnectorCostQuantity & { readonly from: "response" | "requests" | "worst_case" | "unreadable" }

/** La relève d'un travail soumis : la fonction qualifiée à appeler, ses arguments, et le délai de relève (`null` : non déclaré). */
export type ConnectorCollection = { readonly function: string; readonly args: Readonly<Record<string, string | number>>; readonly withinMs: number | null }

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
 * Le pire cas d'un appel, sur ses arguments validés : `request` et `page`, les requêtes qu'il peut envoyer (une, ou les
 * pages d'une lecture avec `all_pages`) ; `item`, la taille de `items` fois celle de `times` (une sans `times`). `null`
 * pour une fonction sans coût ; `ConnectorCostError` si une liste comptée manque ou est vide.
 */
export function costOf(fn: ConnectorFunctionDefinition, args: Record<string, unknown>): ConnectorCostQuantity | null {
  const cost = fn.cost
  if (cost === undefined) return null
  if (cost.per !== "item") return { quantity: pageCount(fn, args), unit: unitOf(cost) }
  const times = cost.times === undefined ? 1 : listLength(fn, args, cost.times)
  return { quantity: listLength(fn, args, cost.items) * times, unit: unitOf(cost) }
}

/**
 * La quantité à régler après un appel réussi, sur ses arguments et `answers`, les réponses JSON du tiers telles qu'il
 * les a envoyées : celles de l'appel, une par page ; pour un travail asynchrone qui se règle, celles de sa relève reçues
 * jusqu'ici. Avec `settle`, la première valeur lisible au chemin (un nombre JSON fini, positif ou nul), sinon le pire
 * cas (`unreadable`) ; sans `settle`, les requêtes envoyées (`request`, `page`) ou le pire cas (`item`). `null` pour une
 * fonction sans coût.
 */
export function settledQuantity(fn: ConnectorFunctionDefinition, args: Record<string, unknown>, answers: readonly unknown[]): ConnectorSettlement | null {
  const worst = costOf(fn, args)
  const cost = fn.cost
  if (worst === null || cost === undefined) return null
  if (cost.settle !== undefined) {
    const path = cost.settle.path
    const read = answers.map((answer) => valueAt(answer, path)).find((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0)
    return read === undefined ? { ...worst, from: "unreadable" } : { quantity: read, unit: worst.unit, from: "response" }
  }
  if (cost.per === "item") return { ...worst, from: "worst_case" }
  if (answers.length === 0) throw new ConnectorCostError(`${fn.name}: a settled call has at least one response.`)
  return { quantity: answers.length, unit: worst.unit, from: "requests" }
}

/**
 * La relève d'un travail que la fonction a soumis, lue dans `answer`, la réponse de la soumission : la fonction de relève
 * (nom qualifié), son argument `jobId.to` portant l'identifiant lu à `jobId.from` (un texte non vide ou un nombre fini),
 * et le délai de relève. `null` pour une fonction qui n'est pas asynchrone ; `ConnectorCostError` sans identifiant.
 */
export function collectionOf(fn: ConnectorFunctionDefinition, answer: unknown): ConnectorCollection | null {
  const job = fn.async
  if (job === undefined) return null
  const id = valueAt(answer, job.jobId.from)
  if (!((typeof id === "string" && id !== "") || (typeof id === "number" && Number.isFinite(id)))) {
    throw new ConnectorCostError(`${fn.name}: the submission answered without its job id at ${job.jobId.from}.`)
  }
  return { function: job.collect, args: { [job.jobId.to]: id }, withinMs: job.withinMs ?? null }
}
