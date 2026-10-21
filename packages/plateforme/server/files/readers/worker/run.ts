// Le worker des lecteurs, côté fil principal (`lecture-des-fichiers.md` § Bornes) : un `worker_threads` par lecture,
// lancé du script assemblé (`generated.ts`) par `eval`, ce qui ne demande aucun fichier à l'hôte (ni chemin à résoudre
// par son bundler, ni fichier à tracer dans un build `standalone`). Sa mémoire est bornée (`resourceLimits`), son
// environnement vide ; l'échéance de la lecture le termine (`terminate()`) : préemptive, elle interrompt une boucle.
// Le plan et chaque partie d'une même lecture passent par le même worker, qui garde le classeur ouvert ; inactif une
// seconde, il est terminé, et une demande suivante en relance un. Un worker qui meurt rend `too_large` s'il manquait de
// mémoire, `failed` sinon. Un worker tient une place du processus (`slots.ts`, deux au plus), prise avant son lancement
// et rendue à la sortie de son thread, quelle qu'en soit la cause. Sans lui, un fichier piégé tiendrait le serveur aussi
// longtemps et aussi lourd qu'il veut.
import { Worker } from "node:worker_threads"
import { READER_LIMITS, ReaderStatusError } from "../types"
import { READER_WORKER_SOURCE } from "./generated"
import type { WorkerJob, WorkerReply, WorkerRequest } from "./protocol"
import { WORKER_SLOTS, type WorkerSlots } from "./slots"

/**
 * La mémoire d'un worker. Le pire cas admis par les bornes : 64 Mo décompressés, lus en chaînes JavaScript (jusqu'à
 * 128 Mo quand le texte n'est pas latin, deux octets par caractère), les chaînes partagées gardées, et un texte servi de
 * 2 millions de caractères ; 256 Mo de tas le couvrent avec de la marge. Au-delà, le fichier est hors bornes : le
 * worker meurt seul, le serveur ne le sent pas. Les octets du fichier (50 Mo au plus) sont hors du tas.
 */
export const WORKER_RESOURCE_LIMITS = { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 } as const

/** Un worker sans demande pendant ce délai est terminé : il ne garde pas sa mémoire au-delà de la lecture. */
const IDLE_MS = 1_000

type Pending = { resolve: (value: unknown) => void; reject: (error: ReaderStatusError) => void }

const timeout = () => new ReaderStatusError({ status: "timeout" })

/**
 * Le statut d'un worker mort, ou d'une erreur inattendue qu'il rapporte : `too_large` s'il manquait de mémoire, `failed`
 * sinon (cause au log serveur).
 */
function deathOf(job: WorkerJob, error: unknown): ReaderStatusError {
  if ((error as { code?: unknown } | null)?.code === "ERR_WORKER_OUT_OF_MEMORY") {
    return new ReaderStatusError({ status: "too_large", detail: `reading it needs more than ${WORKER_RESOURCE_LIMITS.maxOldGenerationSizeMb} MB of memory` })
  }
  console.error(`[platform] files: the reader worker of ${job.name} failed: ${error instanceof Error ? error.message : String(error)}`)
  return new ReaderStatusError({ status: "failed" })
}

/** Le worker d'une lecture : ses demandes, sa terminaison à l'échéance ou à l'inactivité. */
export class ReaderWorker {
  private worker: Worker | null = null
  /** Le lancement en cours (place attendue), partagé par les demandes qui arrivent pendant ce temps. */
  private starting: Promise<Worker> | null = null
  /** Change à chaque `end()` : un lancement commencé avant ne lance plus rien. */
  private generation = 0
  private readonly pending = new Map<number, Pending>()
  private nextId = 1
  private idle: ReturnType<typeof setTimeout> | null = null

  /**
   * `source` : le script du worker ; un test y met le sien (une boucle sans fin, une allocation sans borne). `slots` :
   * les places du processus.
   */
  constructor(
    private readonly job: WorkerJob,
    private readonly signal: AbortSignal,
    private readonly source: string = READER_WORKER_SOURCE,
    private readonly slots: WorkerSlots = WORKER_SLOTS,
  ) {
    signal.addEventListener("abort", () => this.end(timeout()), { once: true })
  }

  /** La réponse du worker à une demande ; un statut lève `ReaderStatusError`. */
  ask(request: WorkerRequest): Promise<unknown> {
    if (this.signal.aborted) return Promise.reject(timeout())
    if (this.idle !== null) clearTimeout(this.idle)
    this.idle = null
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ready().then(
        (worker) => worker.postMessage({ ...request, id }),
        (error: unknown) => this.end(error instanceof ReaderStatusError ? error : deathOf(this.job, error)),
      )
    })
  }

  /** Termine le worker, en levant `reason` sur les demandes en cours ; sa place se rend à la sortie de son thread. */
  end(reason: ReaderStatusError = timeout()): void {
    this.generation++
    this.starting = null
    if (this.idle !== null) clearTimeout(this.idle)
    this.idle = null
    const worker = this.worker
    this.worker = null
    if (worker) void worker.terminate()
    for (const one of this.pending.values()) one.reject(reason)
    this.pending.clear()
  }

  /** Le worker de la lecture : celui qui tourne, ou un nouveau, lancé quand une place se libère dans l'échéance. */
  private ready(): Promise<Worker> {
    if (this.worker) return Promise.resolve(this.worker)
    if (this.starting) return this.starting
    const generation = this.generation
    this.starting = this.slots.take(this.signal).then((slot) => {
      // Terminé pendant l'attente : la place revient aussitôt, aucun worker n'est lancé.
      if (generation !== this.generation) {
        slot.release()
        throw timeout()
      }
      this.starting = null
      try {
        return this.spawn(slot.release)
      } catch (error) {
        slot.release()
        throw error
      }
    })
    return this.starting
  }

  private spawn(release: () => void): Worker {
    // Une copie des octets, transférée : le worker en a la seule vue, et rien n'est copié deux fois.
    const bytes = this.job.bytes.slice()
    const worker = new Worker(this.source, {
      eval: true,
      workerData: { ...this.job, bytes },
      transferList: [bytes.buffer],
      resourceLimits: WORKER_RESOURCE_LIMITS,
      env: {},
    })
    worker.unref()
    // La place se rend à la sortie du thread, sur tout chemin : terminé (échéance, inactivité, erreur), mort de
    // mémoire ou d'une exception ; `exit` vient après `error`.
    worker.once("exit", release)
    worker.on("message", (reply: WorkerReply) => this.settle(reply))
    worker.on("error", (error) => {
      if (this.worker === worker) this.end(deathOf(this.job, error))
    })
    worker.on("exit", (code) => {
      if (this.worker === worker) this.end(deathOf(this.job, new Error(`exited with code ${code}`)))
    })
    this.worker = worker
    return worker
  }

  private settle(reply: WorkerReply): void {
    const one = this.pending.get(reply.id)
    if (!one) return
    this.pending.delete(reply.id)
    if ("result" in reply) one.resolve(reply.result)
    else if ("status" in reply) one.reject(new ReaderStatusError(reply.status))
    else one.reject(deathOf(this.job, new Error(reply.error)))
    if (this.pending.size === 0) {
      this.idle = setTimeout(() => this.end(), IDLE_MS)
      this.idle.unref?.()
    }
  }
}

/** Les bornes que le worker tient, prises de celles du paquet. */
export const WORKER_LIMITS = { decompressedBytes: READER_LIMITS.decompressedBytes, textChars: READER_LIMITS.textChars }
