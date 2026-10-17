// Le signal de refus du service dans la déclaration d'un connecteur décrit (`connecteurs-et-comptes.md` § État d'un
// compte) : `body`, la condition sur le corps de la réponse, et `marksAccount`, la marque que pose une ligne de la table
// d'erreurs ou un refus de fonction, contrôlés comme la règle 10 de la fabrique du dépôt `connectors`. Tenu à part de
// `declaration.ts`, qui l'appelle sur la table du connecteur et sur les refus de chaque fonction.
import { isJsonObject } from "../json"
import type { ConnectorAccountMark, ConnectorApiError, ConnectorRefusal } from "./definition"

/** Les marques qu'une ligne d'erreur ou un refus pose sur le compte (`marksAccount`), liste fermée. */
const ACCOUNT_MARKS: readonly ConnectorAccountMark[] = ["credential_rejected", "quota_exhausted"]

/** Le problème d'une condition sur le corps (`body`) : un chemin, et une liste non vide de valeurs distinctes, texte, nombre ou booléen. */
function bodyProblem(body: unknown): string | null {
  const scalar = (value: unknown) => typeof value === "string" || typeof value === "number" || typeof value === "boolean"
  if (!isJsonObject(body) || Object.keys(body).some((key) => key !== "path" && key !== "equals")) return "body must be {path, equals}"
  if (typeof body.path !== "string" || !body.path) return "body needs a path"
  const equals = body.equals
  if (!Array.isArray(equals) || equals.length === 0 || !equals.every(scalar) || new Set(equals).size !== equals.length) {
    return "body equals must list distinct text, number or boolean values"
  }
  return null
}

/**
 * Le problème du signal de refus d'une table (la table d'erreurs du connecteur, ou les refus d'une fonction), comme la
 * règle 10 de la fabrique : `body` et `marksAccount` de forme fermée, sur un statut HTTP seulement ; un 2xx sans
 * condition sur le corps refuserait tout succès ; un 403 seul ne dit pas une clé refusée (un droit manque), un 429 seul
 * pas des crédits épuisés (un débit) ; une ligne qui marque ne se rejoue pas ; une ligne à condition après une ligne
 * sans condition du même statut ne serait jamais lue. `null` : aucun.
 */
export function signalProblem(entries: readonly (ConnectorApiError | ConnectorRefusal)[], at: string): string | null {
  const plain = new Set<number>()
  for (const entry of entries) {
    const label = `${at} ${entry.code}`
    const status = "status" in entry ? entry.status : entry.when
    const mark = entry.marksAccount
    const body = entry.body !== undefined
    if (typeof status === "string") {
      if (body || mark !== undefined) return `${label}: a refusal with body or marksAccount needs an HTTP status in when, not a text condition.`
      continue
    }
    if (mark !== undefined && !ACCOUNT_MARKS.includes(mark)) return `${label}: marksAccount must be ${ACCOUNT_MARKS.join(" or ")}.`
    const shape = body ? bodyProblem(entry.body) : null
    if (shape) return `${label}: ${shape}.`
    const statuses = typeof status === "number" ? [status] : status
    if (!body && statuses.some((code) => code >= 200 && code < 300)) return `${label}: a 2xx status needs a body condition, or every success would be refused.`
    if (mark === "credential_rejected" && !body && statuses.includes(403)) {
      return `${label}: a 403 without a body condition cannot mark credential_rejected (a missing right is not a refused key).`
    }
    if (mark === "quota_exhausted" && !body && statuses.includes(429)) {
      return `${label}: a 429 without a body condition cannot mark quota_exhausted (a rate limit is not spent credits).`
    }
    if (mark !== undefined && "retryable" in entry && entry.retryable === true) return `${label}: an entry that marks the account is not retryable.`
    const shadowed = statuses.filter((code) => plain.has(code))
    if (body && shadowed.length > 0) return `${label}: its body condition comes after an entry without one for status ${shadowed.join(", ")}, so it is never read.`
    if (!body) for (const code of statuses) plain.add(code)
  }
  return null
}
