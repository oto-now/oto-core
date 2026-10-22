// L'exécutant des travaux en tâche de fond (`fonctions-longues.md` § Le moteur) : `runJobs`, que le déclencheur de
// l'hôte appelle (`jobs/trigger.ts`). Il passe le ménage, réclame des travaux sans doublon (`claim_jobs`, `for update
// skip locked`), puis mène chacun à sa fin en trois transactions courtes : réclamer ; marquer « envoyé » juste avant
// l'appel ; conclure. L'appel au tiers court entre les deux dernières, hors transaction, par `runCall`, sous l'identité
// de l'auteur reconstruite depuis la ligne et relue en base : son compte et son secret résolus à l'exécution, son fichier
// d'entrée relu et le fichier rendu rangé en transit sous ses droits, sans rôle de service. L'exécutant n'a aucun droit
// propre : sa session (`withRunnerSession`) ne fait que réclamer et ranger par les fonctions de la file.
import { runCall, type CallTrace } from "../calls"
import { catalogFunctions, findFunction } from "../catalog/registry"
import { loadActiveConnectors } from "../connectors/activations"
import { createPlatformDb, type PlatformDb } from "../db"
import { inTransaction, isPlatformError } from "../errors"
import { identityInOrg, type Identity, type IdentityOrg } from "../identity"
import { withRunnerSession } from "../sql"
import { journalJobEnd, sweepJobs, type JobCost } from "./ends"
import { openArguments, sealOutcome, type JobOutcome, type JobRefusal } from "./seal"

/** Ce que l'hôte passe à `runJobs` : le nombre de travaux à mener ensemble, de 1 à 50 (ses voies). */
export type RunJobsOptions = { limit: number }

/** Ce que `runJobs` a fait : le nombre de travaux réclamés et menés à leur fin. */
export type RunJobsReport = { ran: number }

const MAX_LIMIT = 50

type Claimed = { job_id: string; org_id: string; user_id: string; email: string | null; lease_token: string }

type StoredJob = {
  function: string
  team_id: string | null
  team_slug: string | null
  account_id: string | null
  ctx: string | null
  origin: string
  digest: string
  arguments_ciphertext: string | null
}

type OrgRow = Omit<IdentityOrg, "domains"> & { domains: string | null }

/** Le bail d'un travail perdu avant l'appel (expiré, repris par le ménage) : rien ne part, rien ne s'écrit. */
class LeaseLost extends Error {
  override name = "LeaseLost"
}

/**
 * Mène jusqu'à `limit` travaux en file, ensemble, à leur fin ; rend combien. Le ménage passe d'abord (baux expirés,
 * travaux en file depuis 24 heures) et écrit la ligne de fin de ce qu'il conclut. Un travail qui échoue ne fait pas
 * échouer les autres : son refus est son issue. Lève sur une `limit` hors bornes ou une base injoignable.
 */
export async function runJobs(options: RunJobsOptions): Promise<RunJobsReport> {
  const { limit } = options
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new Error(`[platform] runJobs: limit must be an integer from 1 to ${MAX_LIMIT}, not ${limit}`)
  await sweepJobs(withRunnerSession)
  const claimed = await withRunnerSession((sql) => sql<Claimed[]>`
    select job_id, org_id, user_id, email, lease_token from platform.claim_jobs(${limit})`)
  await Promise.all(claimed.map(runClaimed))
  return { ran: claimed.length }
}

/** Le travail réclamé, lu sous son auteur (la RLS ne le montre qu'à lui), et son organisation. */
async function storedJob(db: PlatformDb, claim: Claimed): Promise<{ job: StoredJob; org: IdentityOrg }> {
  return inTransaction(db, "jobs: run", async (sql) => {
    const [job] = await sql<StoredJob[]>`
      select function, team_id, team_slug, account_id, ctx, origin, digest, arguments_ciphertext from platform.jobs where id = ${claim.job_id}`
    const [org] = await sql<OrgRow[]>`
      select id, slug, name, prefix, brand, settings ->> 'domains' as domains from platform.orgs where id = ${claim.org_id}`
    if (!job || !org) throw new Error(`[platform] jobs: job ${claim.job_id} claimed, unreadable by its author`)
    return { job, org: { ...org, domains: org.domains ?? "" } }
  })
}

/** Le refus d'un appel tel que `call` l'aurait levé ; toute autre erreur, une panne (`internal`), sa cause au log. */
function refusalOf(job: string, error: unknown): JobRefusal {
  if (isPlatformError(error)) return { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) }
  console.error(`[platform] jobs: job ${job} failed`, error)
  return { code: "internal", message: "Internal error." }
}

/** Conclut le travail sous son jeton ; faux quand un autre l'a conclu (le ménage, son bail expiré). */
async function concluded(claim: Claimed, refused: boolean, outcome: JobOutcome): Promise<boolean> {
  const sealed = sealOutcome(claim.job_id, outcome)
  const [row] = await withRunnerSession((sql) => sql<{ ok: boolean }[]>`
    select platform.finish_job(${claim.job_id}, ${claim.lease_token}, ${refused ? "refused" : null}, ${sealed}) as ok`)
  return row?.ok === true
}

/**
 * Un travail réclamé, de bout en bout : la ligne et l'identité de l'auteur, l'appel par `runCall` (`confirm` donné à la
 * mise en file), puis l'issue et la ligne de fin, avec la quantité réglée lue dans ses réponses. Rien ne lève.
 */
async function runClaimed(claim: Claimed): Promise<void> {
  const db = createPlatformDb({ caller: { userId: claim.user_id, ...(claim.email ? { email: claim.email } : {}) } })
  const functions = catalogFunctions()
  const trace: CallTrace = {}
  const started = Date.now()
  // Posés par `runCall` pendant l'appel : l'instant de l'envoi, puis les réponses reçues.
  const call: { sentAt: number | null; answers: readonly unknown[] | null } = { sentAt: null, answers: null }
  let stored: StoredJob | null = null
  let args: Record<string, unknown> = {}
  let outcome: JobOutcome
  try {
    const read = await storedJob(db, claim)
    stored = read.job
    if (stored.arguments_ciphertext === null) throw new Error(`[platform] jobs: job ${claim.job_id} claimed without its arguments`)
    args = openArguments(stored.digest, stored.arguments_ciphertext)
    const identity: Identity = await identityInOrg(db, read.org, { userId: claim.user_id, email: claim.email ?? "" })
    const job = {
      beforeSend: async () => {
        const [row] = await withRunnerSession((sql) => sql<{ ok: boolean }[]>`select platform.mark_job_sent(${claim.job_id}, ${claim.lease_token}) as ok`)
        if (row?.ok !== true) throw new LeaseLost()
        call.sentAt = Date.now()
      },
      answered: (answers: readonly unknown[]) => {
        call.answers = answers
      },
    }
    const deps = { db, identity, ctxCode: stored.ctx, origin: stored.origin, activeConnectors: () => loadActiveConnectors(db, identity.org.id), functions, trace, job }
    const input = { function: stored.function, arguments: args, confirm: true, ...(stored.team_slug ? { team: stored.team_slug } : {}), ...(stored.account_id ? { account: stored.account_id } : {}) }
    const output = await runCall(deps, input)
    outcome = { done: { text: output.text, data: output.data, nextActions: output.nextActions } }
  } catch (error) {
    if (error instanceof LeaseLost) {
      console.error(`[platform] jobs: job ${claim.job_id} lost its lease before the call: nothing was sent`)
      return
    }
    outcome = { refused: refusalOf(claim.job_id, error) }
  }
  const refused = "refused" in outcome
  if (!(await concluded(claim, refused, outcome))) {
    console.error(`[platform] jobs: job ${claim.job_id} concluded elsewhere (its lease ran out): this outcome is not kept`)
    return
  }
  // La quantité : celle des réponses reçues, même quand la suite a échoué (le tiers a répondu, l'appel est facturé).
  const background = stored ? findFunction(functions, stored.function)?.background : undefined
  const settled = call.answers !== null && background ? background.settled(args, call.answers) : null
  const cost: JobCost | null = settled ? { quantity: settled.quantity, unit: settled.unit, from: settled.from } : null
  const failure = "refused" in outcome ? { code: outcome.refused.code, message: outcome.refused.message } : null
  await journalJobEnd({
    job: claim.job_id,
    orgId: claim.org_id,
    userId: claim.user_id,
    email: claim.email,
    function: stored?.function ?? "job",
    teamId: stored?.team_id ?? null,
    accountId: trace.accountId ?? stored?.account_id ?? null,
    ctx: stored?.ctx ?? null,
    durationMs: Date.now() - (call.sentAt ?? started),
    failure,
    cost,
    personal: trace.personal,
    lentBy: trace.lentBy,
  })
}
