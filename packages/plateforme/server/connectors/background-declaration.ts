// La fonction longue d'un connecteur décrit (`fonctions-longues.md` ; `connectors : docs/conception/format-de-description.md`
// § Fonction longue) : `background: true` dit que le tiers répond en minutes. Ce module la contrôle à la déclaration,
// comme la règle 21 de la fabrique, et donne au catalogue ce qu'en lit `call` pour la mettre en file : son délai, ses
// fichiers d'entrée, son coût et la phrase fixe que le moteur ajoute à sa description servie. L'exécution est celle d'un
// appel synchrone, plus tard, par l'exécutant de l'hôte (`jobs/runner.ts`).
import type { CatalogBackground } from "../catalog/define"
import { costOf, settledQuantity } from "./cost"
import type { ConnectorDefinition, ConnectorFunctionDefinition } from "./definition"

/** Ajoutée par le moteur à la description servie d'une fonction longue ; aucune description ne la réécrit. */
export const BACKGROUND_SENTENCE =
  'Long function: call returns at once a job (status queued) and runs it in the background; read it with the function job.read {"job": "<id>"} after retry_after_s seconds, until its status is done (the answer of the call) or failed (its refusal).'

/**
 * Le problème d'une fonction longue, comme la règle 21 de la fabrique, dans son ordre et sous ses codes ; `null` : aucun,
 * ou une fonction qui ne l'est pas. Son propre délai (`background_no_timeout`, jamais celui du connecteur) ; ni
 * asynchrone (`background_async`), ni relève d'un travail asynchrone, ce qui se lit sur la soumission
 * (`background_collect`), ni paginée (`background_paginated`).
 */
export function backgroundProblem(definition: ConnectorDefinition, fn: ConnectorFunctionDefinition): string | null {
  const flag: unknown = fn.background
  if (flag === undefined) return null
  if (flag !== true) return `${fn.name}: background is true or absent.`
  if (fn.timeoutMs === undefined) {
    return `${fn.name}: a long function declares its own timeout, that of the call itself without the queue, never the connector's (background_no_timeout).`
  }
  if (fn.async !== undefined) return `${fn.name}: a long function is not asynchronous: a job the third party holds has its collect described (background_async).`
  const submission = definition.functions.find((other) => other.async?.collect === fn.name)
  if (submission) return `${fn.name}: a long function is not the collect of an asynchronous job (${submission.name}): a collect answers at once (background_collect).`
  if (fn.pagination !== undefined) return `${fn.name}: a long function is not paginated: one call, one answer (background_paginated).`
  return null
}

/** La description servie d'une fonction : celle de sa description, suivie de la phrase fixe pour une fonction longue. */
export function servedDescription(fn: ConnectorFunctionDefinition): string {
  return fn.background === true ? `${fn.description} ${BACKGROUND_SENTENCE}` : fn.description
}

/** Ce qu'une fonction longue ajoute à sa fonction du catalogue (`CatalogBackground`) ; rien pour une autre. Contrôlée d'abord. */
export function backgroundTraits(fn: ConnectorFunctionDefinition): { background: CatalogBackground } | Record<string, never> {
  const timeoutMs = fn.timeoutMs
  if (fn.background !== true || timeoutMs === undefined) return {}
  return {
    background: {
      timeoutMs,
      files: Object.values(fn.request.files ?? {}),
      worst: (args) => costOf(fn, args),
      settled: (args, answers) => settledQuantity(fn, args, answers),
    },
  }
}
