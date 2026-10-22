// La mise en file d'une fonction longue (`fonctions-longues.md` § Le moteur) : `runCall` a fait les contrôles d'un appel
// synchrone (fonction active, arguments, équipe, compte et son secret, récapitulatif d'une fonction sensible) ; ce module
// refuse sans déclencheur de l'hôte, vérifie que chaque fichier d'entrée existe et est à l'auteur, puis écrit le travail,
// arguments scellés, au lieu d'appeler le tiers. Un travail identique en cours (même auteur, fonction, équipe, compte et
// arguments) est rendu, sans second travail. L'exécutant de l'hôte (`runJobs`) le prend ensuite.
import type { CatalogBackground } from "../catalog/define"
import type { PlatformDb } from "../db"
import { inTransaction, PlatformError } from "../errors"
import { readyTransitFile } from "../files/transit"
import type { Identity } from "../identity"
import { jobDigestOf, sealArguments } from "./seal"
import { requireBackgroundRunner, RETRY_AFTER_S } from "./trigger"

/** La fonction native qui relève un travail. */
export const JOB_READ = "job.read"

/** Ce que `runCall` a établi pour le travail : la fonction, ses arguments validés, l'équipe, le compte, la conversation. */
export type JobRequest = {
  function: string
  background: CatalogBackground
  args: Record<string, unknown>
  /** L'équipe sous laquelle l'appel court, reprise par l'exécutant ; nulle sans équipe. */
  teamSlug: string | null
  /** L'équipe de la ligne de journal (une équipe de l'auteur), reprise par la ligne de fin. */
  journalTeamId: string | null
  accountId: string | null
  ctx: string | null
  /** L'origine de l'adresse appelée : l'exécutant y retrouve l'organisation, et la sert aux liens comme l'appel. */
  origin: string
}

export type QueuedJob = { job: string; created: boolean }

/**
 * Met le travail en file pour l'auteur de `identity` ; rend son identifiant, ou celui d'un travail identique en cours
 * (`created` faux). Refus : aucun déclencheur déclaré (`unavailable_in_v1`) ; un accès de l'équipe plateforme
 * (`forbidden`, un travail est celui d'un membre) ; un fichier d'entrée inconnu, d'un autre ou effacé (le refus d'un
 * fichier en transit).
 */
export async function enqueueJob(db: PlatformDb, identity: Identity, request: JobRequest): Promise<QueuedJob> {
  requireBackgroundRunner(request.function)
  if (identity.viaGrant) {
    throw new PlatformError("forbidden", `${request.function} runs in the background for a member of ${identity.org.name}: an access of the platform team queues nothing.`)
  }
  for (const name of request.background.files) await readyTransitFile(db, identity, request.args[name])
  const digest = jobDigestOf({ userId: identity.user.id, function: request.function, teamId: request.journalTeamId, accountId: request.accountId, args: request.args })
  const sealed = sealArguments(digest, request.args)
  const worst = request.background.worst(request.args)
  const [row] = await inTransaction(
    db,
    "jobs: enqueue",
    (sql) => sql<{ job_id: string; created: boolean }[]>`
      select job_id, created from platform.enqueue_job(${identity.org.id}, ${request.function}, ${request.journalTeamId}, ${request.teamSlug},
        ${request.accountId}, ${request.ctx}, ${request.origin}, ${request.background.timeoutMs}, ${digest}, ${sealed},
        ${worst?.quantity ?? null}, ${worst?.unit ?? null})`,
    "server",
  )
  if (!row) throw new Error(`[platform] jobs: ${request.function} queued without a job`)
  return { job: row.job_id, created: row.created }
}

/** Ce que lit l'assistant d'un travail mis en file, ou d'un travail identique déjà en cours. */
export function queuedText(fn: string, queued: QueuedJob): string {
  const read = `Read its result with ${JOB_READ} {"job": "${queued.job}"} in ${RETRY_AFTER_S} seconds, until it is done or failed.`
  return queued.created
    ? `Job ${queued.job} queued: ${fn} runs in the background. ${read}`
    : `A job of ${fn} with the same arguments is already under way: job ${queued.job}, nothing new was queued. ${read}`
}
