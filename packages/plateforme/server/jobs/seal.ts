// Ce qu'un travail en tâche de fond garde en base, chiffré par le coffre de l'hôte (`connectors/vault.ts`, la clé des
// secrets de compte) : ses arguments, pour l'exécuter, et son issue, pour `job.read`. Les arguments portent des données
// personnelles (des noms dans un vocabulaire, une liste de contacts) que la base ne garde jamais en clair, comme le
// journal ; ils sont scellés sous l'empreinte du travail, l'issue sous son identifiant. L'empreinte, une HMAC de la clé,
// reconnaît un travail identique en cours sans rien dire de ses arguments.
import { decryptJobText, encryptJobText, jobDigest } from "../connectors/vault"
import { PlatformError } from "../errors"

const ARGUMENTS_COLUMN = "arguments_ciphertext"
const OUTCOME_COLUMN = "outcome_ciphertext"

/** La réponse d'un appel réussi, telle que `call` l'aurait servie : texte, données, suites proposées. */
export type JobAnswer = { text: string; data: Record<string, unknown>; nextActions: string[] }

/** Le refus d'un appel, tel que `call` l'aurait levé : même code, même message, mêmes précisions. */
export type JobRefusal = { code: PlatformError["code"]; message: string; details?: Record<string, unknown> }

/** L'issue d'un travail conclu par l'exécutant. */
export type JobOutcome = { done: JobAnswer } | { refused: JobRefusal }

/** Un JSON aux clés triées à toute profondeur : deux arguments égaux s'écrivent pareil, quel que soit l'ordre reçu. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item !== null && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : item,
  )
}

/** L'empreinte d'un travail : son auteur, sa fonction, son équipe, son compte et ses arguments validés. */
export function jobDigestOf(job: { userId: string; function: string; teamId: string | null; accountId: string | null; args: Record<string, unknown> }): string {
  return jobDigest(canonicalJson({ user: job.userId, function: job.function, team: job.teamId, account: job.accountId, arguments: job.args }))
}

export function sealArguments(digest: string, args: Record<string, unknown>): string {
  return encryptJobText(digest, ARGUMENTS_COLUMN, JSON.stringify(args))
}

/** Les arguments d'un travail ; illisibles, `internal` (`decryptJobText`). */
export function openArguments(digest: string, ciphertext: string): Record<string, unknown> {
  const args: unknown = JSON.parse(decryptJobText(digest, ARGUMENTS_COLUMN, ciphertext))
  if (args === null || typeof args !== "object" || Array.isArray(args)) throw new Error(`[platform] jobs: arguments of ${digest} are not an object`)
  return args as Record<string, unknown>
}

export function sealOutcome(jobId: string, outcome: JobOutcome): string {
  return encryptJobText(jobId, OUTCOME_COLUMN, JSON.stringify(outcome))
}

/** L'issue d'un travail ; illisible, `internal` (`decryptJobText`). */
export function openOutcome(jobId: string, ciphertext: string): JobOutcome {
  // Écrite par `sealOutcome` seul, sous la clé de l'hôte et liée à ce travail : sa forme est celle de `JobOutcome`.
  return JSON.parse(decryptJobText(jobId, OUTCOME_COLUMN, ciphertext)) as JobOutcome
}
