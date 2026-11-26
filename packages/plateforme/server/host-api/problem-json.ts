// Les refus de l'API d'un hôte (`fonctions-d-un-hote.md` § Erreurs) : un `application/problem+json` (RFC 9457) devient
// une `PlatformError` lisible par l'assistant, son code tiré du statut, son message tiré du `detail` (à défaut du
// `title`), borné, et le code de l'hôte dans `details.refusal`. Sans ce module, un refus écrit pour l'assistant par
// l'hôte se perdrait derrière la table d'erreurs standard (« a répondu un statut inattendu »).
import { PlatformError, type PlatformErrorCode } from "../errors"
import { cut } from "../journal"
import { isJsonObject } from "../json"

/** Au plus, en caractères, le message d'un refus de l'hôte servi à l'assistant. */
export const PROBLEM_MESSAGE_MAX = 500
/** Au plus, en caractères, le code d'un refus de l'hôte (`details.refusal`). */
const REFUSAL_MAX = 100

/** Le code de la plateforme d'un statut de l'hôte ; un 5xx ou un autre statut : une panne de l'hôte (`upstream_error`). */
function codeOf(status: number): PlatformErrorCode {
  if (status === 400 || status === 422) return "invalid_arguments"
  if (status === 401) return "unauthorized"
  if (status === 403) return "forbidden"
  if (status === 404) return "not_found"
  if (status === 409) return "conflict"
  if (status === 413) return "too_large"
  if (status === 429) return "rate_limited"
  return "upstream_error"
}

/** Un texte non vide du problème, sur une ligne, sans caractère de contrôle. */
function textOf(value: unknown): string | null {
  if (typeof value !== "string") return null
  // Les caractères de contrôle (C0, DEL, C1) d'un texte écrit par l'hôte ne passent pas dans un refus.
  const text = value.replace(/[\u0000-\u001F\u007F-\u009F]+/g, " ").trim()
  return text === "" ? null : text
}

/**
 * La traduction d'un `problem+json` de l'hôte nommé `label`. Un 401 dit de se reconnecter, quoi que dise l'hôte : le
 * jeton échangé pour la personne a été refusé. Au journal : le statut, le code de l'hôte et le message borné, jamais le
 * corps.
 */
export function hostProblems(label: string): (status: number, problem: unknown) => PlatformError {
  return (status, problem) => {
    const body = isJsonObject(problem) ? problem : {}
    const code = codeOf(status)
    const refusal = textOf(body.code)
    const said = textOf(body.detail) ?? textOf(body.title)
    const message =
      code === "unauthorized"
        ? `${label} refused your session for its functions. Sign in again to this connector, then call again.`
        : cut(said ?? `${label} refused the call (HTTP ${status}).`, PROBLEM_MESSAGE_MAX)
    const details = refusal ? { refusal: cut(refusal, REFUSAL_MAX) } : undefined
    console.error(`[platform] host api ${label}: problem ${status}${details ? ` ${details.refusal}` : ""}: ${message}`)
    return new PlatformError(code, message, details)
  }
}
