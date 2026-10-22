// `job.read` (`fonctions-longues.md` § Ce que voit l'assistant) : relever un travail qu'une fonction longue a mis en
// file, derrière `call`, comme `file.keep`. Elle ne rappelle aucun tiers : elle passe le ménage des travaux de l'auteur,
// puis lit le sien. En cours, `retry_after_s` ; fini, la réponse qu'aurait rendue l'appel synchrone, ou son refus, même
// code et même message ; effacé, quand et pourquoi. Un travail n'est lisible que par son auteur : inconnu, d'un autre ou
// trop ancien, le même refus.
import * as z from "zod/v4"
import { defineFunction, type FunctionOutput } from "../catalog/define"
import type { PlatformDb } from "../db"
import { inTransaction, PlatformError } from "../errors"
import type { Identity } from "../identity"
import { sweepJobs, unfinishedRefusal } from "./ends"
import { JOB_READ } from "./queue"
import { openOutcome } from "./seal"
import { RETRY_AFTER_S } from "./trigger"

const jobReadSchema = z.strictObject({ job: z.string().describe("The job id that call returned for a long function.") })

type JobRow = {
  id: string
  function: string
  state: "queued" | "claimed" | "sent" | "done" | "failed"
  reason: "refused" | "outcome_unknown" | "not_started" | null
  outcome_ciphertext: string | null
  erased_at: string | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** La réponse d'un travail inconnu, d'un autre auteur ou retiré : celle d'un fichier en transit inconnu. */
function unknownJob(): PlatformError {
  return new PlatformError("not_found", "Unknown job.")
}

/** Le travail `id` de l'auteur de `identity`, après le ménage des siens ; sinon `unknownJob`. */
async function ownJob(db: PlatformDb, identity: Identity, id: string): Promise<JobRow> {
  if (!UUID.test(id)) throw unknownJob()
  await sweepJobs((fn) => inTransaction(db, "jobs: sweep", fn, "server"))
  const [row] = await inTransaction(db, "jobs: read", (sql) => sql<JobRow[]>`
    select id, function, state, reason, outcome_ciphertext, to_json(erased_at) #>> '{}' as erased_at from platform.jobs
     where org_id = ${identity.org.id} and user_id = ${identity.user.id} and id = ${id}`)
  if (!row) throw unknownJob()
  return row
}

/** Ce que rend `job.read` d'un travail ; lève le refus d'un travail échoué ou effacé. */
export async function readJob(db: PlatformDb, identity: Identity, id: string): Promise<FunctionOutput> {
  const row = await ownJob(db, identity, id)
  if (row.state === "queued" || row.state === "claimed" || row.state === "sent") {
    const status = row.state === "queued" ? "queued" : "running"
    return {
      text: `Job ${row.id} (${row.function}) is ${status}: read it again in ${RETRY_AFTER_S} seconds.`,
      data: { job: row.id, status, function: row.function, retry_after_s: RETRY_AFTER_S },
      next: [JOB_READ],
    }
  }
  if (row.erased_at !== null) {
    const at = new Date(row.erased_at).toISOString()
    throw new PlatformError(
      "not_found",
      `Job ${row.id} was erased on ${at.slice(0, 16).replace("T", " ")} UTC: the result of a job is kept 24 hours after it ends. Call ${row.function} again if you still need it.`,
      { reason: "job_erased", erased_at: at },
    )
  }
  if (row.reason === "outcome_unknown" || row.reason === "not_started") throw unfinishedRefusal(row.id, row.function, row.reason)
  if (row.outcome_ciphertext === null) throw new Error(`[platform] jobs: job ${row.id} ended ${row.state} without its outcome`)
  const outcome = openOutcome(row.id, row.outcome_ciphertext)
  if ("refused" in outcome) {
    const { code, message, details } = outcome.refused
    throw new PlatformError(code, message, { ...details, job: row.id, status: "failed", reason: "refused" })
  }
  const { text, data, nextActions } = outcome.done
  return { text, data: { job: row.id, status: "done", ...data }, next: nextActions }
}

export const jobRead = defineFunction({
  name: JOB_READ,
  connector: "job",
  class: "read",
  origin: "paquet",
  description:
    "Reads a job that a long function started: queued or running, read it again after retry_after_s seconds; done, the answer the call would have given at once (its data, the file it returned); failed, its refusal, the same code and message. Only the person who started a job reads it; its result is kept 24 hours after it ends. In French: suivre, relever un travail en cours.",
  schema: jobReadSchema,
  examples: [{ job: "5d1c2b3a-4e5f-4a6b-8c7d-9e0f1a2b3c4d" }],
  refusals: [
    "Unknown job: not a job you started, or ended more than 30 days ago.",
    "A job erased: its result was kept 24 hours; the refusal gives the date.",
    "A failed job: the refusal of the call, the same code and message; outcome unknown when its answer never came back; never started when it waited 24 hours in the queue.",
  ],
  run: (context, args) => readJob(context.db, context.identity, args.job),
})
