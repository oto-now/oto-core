// La table d'erreurs d'une fonction décrite (`connecteurs-et-comptes.md` § Moteur des connecteurs décrits) : ses refus
// à statut HTTP, puis la table du connecteur, chaque ligne traduite pour le client HTTP (`http.ts`) : son code du
// paquet, son refus nommé, et sa condition sur le corps (`equals`, `contains`) devenue le prédicat qui la fait
// s'appliquer. Tenue à part du moteur (`engine.ts`), qui lit les réponses ; préparée une fois à la déclaration.
import type { PlatformErrorCode } from "../errors"
import type { ConnectorBodyCondition, ConnectorDefinition, ConnectorFunctionDefinition } from "./definition"
import { valueAt } from "./engine"
import type { ApiError } from "./http"

/** Le code du paquet d'un statut du tiers (H04, liste fermée) ; le refus nommé par la description reste dans le message. */
export function platformCode(status: number): PlatformErrorCode {
  if (status === 400 || status === 422) return "invalid_arguments"
  if (status === 404) return "not_found"
  if (status === 409) return "conflict"
  if (status === 429) return "rate_limited"
  return "upstream_error"
}

/**
 * Vrai si la valeur au chemin `path` du corps est égale (stricte) à l'une de `equals`, ou, pour `contains`, un texte qui
 * contient l'un des textes listés, les deux en minuscules (`toLowerCase()`, sans locale) ; une valeur qui n'est pas un
 * texte ne contient rien, ni un corps illisible (`null`).
 */
function bodyMatches(condition: ConnectorBodyCondition): (answer: unknown) => boolean {
  if (condition.contains !== undefined) {
    const texts = condition.contains.map((text) => text.toLowerCase())
    return (answer) => {
      const value = valueAt(answer, condition.path)
      return typeof value === "string" && texts.some((text) => value.toLowerCase().includes(text))
    }
  }
  const { equals } = condition
  return (answer) => {
    const value = valueAt(answer, condition.path)
    return equals.some((expected) => expected === value)
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
