// La fin d'un travail en tâche de fond (`fonctions-longues.md` § Les états et les pannes) : sa ligne de journal, reliée à
// celle de la mise en file par l'identifiant du travail, avec la durée de l'appel, l'erreur, le compte et la quantité ;
// le refus d'un travail échoué sans issue écrite (envoyé sans réponse gardée, jamais lancé) ; et le ménage
// (`sweep_jobs`), qui conclut ces travaux-là et écrit leur ligne. Une ligne s'écrit sous l'auteur du travail, comme
// toute ligne du journal ; un journal en panne ne change rien (`writeJournal`).
import { createPlatformDb } from "../db"
import { PlatformError } from "../errors"
import { clip, failedEntry, MAX_TARGET_CHARS, servedEntry, writeJournal, type JournalEntry } from "../journal"
import type { Tx } from "../sql"

/** Les heures qu'un travail attend en file avant de finir `not_started` ; la base garde la même durée (`sweep_jobs`). */
export const QUEUE_HOURS = 24

/** La ligne de fin d'un travail : un travail n'est la requête d'aucune porte (`method`), il conclut un `call` (`tool`). */
export const JOB_JOURNAL = { method: "job", tool: "call" } as const

/** Une quantité de la ligne de fin, son unité et d'où elle vient (`response`, `requests`, `worst_case`, `unreadable`). */
export type JobCost = { quantity: number; unit: string; from: string }

/** Ce que dit la ligne de fin d'un travail. */
export type JobEnd = {
  job: string
  orgId: string
  userId: string
  email: string | null
  function: string
  /** L'équipe de la ligne de journal de la mise en file : une équipe de l'auteur, sinon aucune. */
  teamId: string | null
  accountId: string | null
  ctx: string | null
  durationMs: number | null
  failure: { code: string; message: string } | null
  cost: JobCost | null
  personal?: readonly string[]
  lentBy?: string | null
}

/** Le refus d'un travail échoué sans issue écrite, tel que `job.read` le lève et que sa ligne de fin le garde. */
export function unfinishedRefusal(job: string, fn: string, reason: "outcome_unknown" | "not_started"): PlatformError {
  const details = { job, status: "failed", reason }
  if (reason === "outcome_unknown") {
    return new PlatformError(
      "upstream_error",
      `Job ${job} failed: the call of ${fn} was sent, and its answer never came back to this application (outcome unknown). It may have reached the third party; nothing was kept and nothing is retried on its own: check with the third party, then call ${fn} again if needed.`,
      details,
    )
  }
  return new PlatformError(
    "internal",
    `Job ${job} was never started: it waited ${QUEUE_HOURS} hours in the queue without the runner of this application taking it. Nothing was sent and nothing is counted. Call ${fn} again, and tell whoever runs this application.`,
    details,
  )
}

/** Écrit la ligne de fin d'un travail sous son auteur ; ne lève jamais. */
export async function journalJobEnd(end: JobEnd): Promise<void> {
  const db = createPlatformDb({ caller: { userId: end.userId, ...(end.email ? { email: end.email } : {}) } })
  const entry: JournalEntry = {
    org_id: end.orgId,
    user_id: end.userId,
    user_agent: null,
    method: JOB_JOURNAL.method,
    tool: JOB_JOURNAL.tool,
    target: clip(end.function, MAX_TARGET_CHARS),
    args: {},
    duration_ms: end.durationMs,
  }
  const trace = { teamId: end.teamId, accountId: end.accountId, job: end.job, personal: end.personal, lentBy: end.lentBy, ...(end.cost ? { cost: end.cost } : {}) }
  if (end.failure) failedEntry(entry, end.failure, { ctx: end.ctx, host: null, trace, resultChars: end.failure.message.length })
  else servedEntry(entry, { text: "", target: entry.target, ...trace }, { ctx: end.ctx, host: null, resultChars: 0 })
  await writeJournal(db, [entry])
}

type SweptRow = {
  job_id: string
  org_id: string
  user_id: string
  email: string | null
  function: string
  team_id: string | null
  account_id: string | null
  ctx: string | null
  reason: "outcome_unknown" | "not_started"
  worst_quantity: number | null
  cost_unit: string | null
}

/**
 * Le ménage (`sweep_jobs`) dans la transaction que `run` ouvre : celle de l'exécutant, sans appelant, pour tous les
 * travaux, ou celle du serveur pour l'auteur qui lit les siens (`job.read`). Chaque travail qu'il conclut a sa ligne de
 * fin : `outcome_unknown` au pire cas de son coût, `not_started` sans quantité.
 */
export async function sweepJobs(run: (fn: (sql: Tx) => Promise<SweptRow[]>) => Promise<SweptRow[]>): Promise<void> {
  const ended = await run((sql) => sql<SweptRow[]>`
    select job_id, org_id, user_id, email, function, team_id, account_id, ctx, reason, worst_quantity::float8 as worst_quantity, cost_unit
      from platform.sweep_jobs()`)
  for (const row of ended) {
    const refusal = unfinishedRefusal(row.job_id, row.function, row.reason)
    const worst = row.reason === "outcome_unknown" && row.worst_quantity !== null && row.cost_unit !== null
    await journalJobEnd({
      job: row.job_id,
      orgId: row.org_id,
      userId: row.user_id,
      email: row.email,
      function: row.function,
      teamId: row.team_id,
      accountId: row.account_id,
      ctx: row.ctx,
      durationMs: null,
      failure: { code: refusal.code, message: refusal.message },
      cost: worst ? { quantity: Number(row.worst_quantity), unit: String(row.cost_unit), from: "worst_case" } : null,
    })
  }
}
