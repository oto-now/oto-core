// Le déclencheur des travaux en tâche de fond (`fonctions-longues.md` § Ce que fournit l'hôte) : le moteur tient la file
// et l'exécute (`runJobs`), l'hôte ne fournit que ce qui l'appelle, et le déclare à `registerConnectors`. Sans
// déclencheur, un travail mis en file attendrait 24 heures pour finir `not_started` : la mise en file est refusée.
import { PlatformError } from "../errors"

/**
 * `"process"` : un processus de l'hôte à part du serveur web, qui boucle sur `runJobs` (un redémarrage du web ne tue pas
 * un travail). Le déclencheur d'un hôte serverless (une route d'exécution appelée par `defer`) n'est pas écrit.
 */
export type BackgroundRunner = "process"

const RUNNERS: readonly string[] = ["process"]

/** Le délai conseillé avant de relire un travail en cours, en secondes, rendu à la mise en file et par `job.read`. */
export const RETRY_AFTER_S = 15

let declared: BackgroundRunner | null = null

/** Le problème du déclencheur que l'hôte passe à `registerConnectors` ; `null` : aucun, ou aucun déclencheur. */
export function backgroundRunnerProblem(runner: unknown): string | null {
  return runner === undefined || (typeof runner === "string" && RUNNERS.includes(runner))
    ? null
    : `backgroundRunner must be "process" (a process of the host that loops on runJobs) or absent.`
}

/** Retient le déclencheur que l'hôte déclare, contrôlé d'abord (`backgroundRunnerProblem`) ; absent, aucun. */
export function declareBackgroundRunner(runner: BackgroundRunner | undefined): void {
  declared = runner ?? null
}

/** Le déclencheur déclaré ; sans lui, la mise en file de `fn` est refusée, en le disant (`unavailable_in_v1`). */
export function requireBackgroundRunner(fn: string): BackgroundRunner {
  if (declared !== null) return declared
  throw new PlatformError(
    "unavailable_in_v1",
    `${fn} runs in the background, and this application has declared no runner for background jobs: nothing was queued nor sent. Tell whoever runs this application.`,
  )
}
