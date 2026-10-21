// Les places de worker d'un processus (`lecture-des-fichiers.md` § Bornes) : une lecture en prend une pour la vie de son
// worker (`run.ts`) et la rend quand le thread s'arrête, quelle qu'en soit la raison ; une lecture de plus attend son
// tour, dans son échéance, et la quitte sans place si l'échéance tombe avant. Sans elles, dix lectures simultanées
// tiendraient dix workers de 256 Mo dans le même serveur.
import { READER_LIMITS, ReaderStatusError } from "../types"

/** Une place prise : `release()` la rend, une seule fois quel que soit le nombre d'appels. */
export type WorkerSlot = { release: () => void }

type Waiter = { grant: () => void }

export class WorkerSlots {
  private used = 0
  private readonly waiters: Waiter[] = []

  constructor(readonly size: number) {}

  /** Places prises. */
  get busy(): number {
    return this.used
  }

  /** Lectures qui attendent une place. */
  get waiting(): number {
    return this.waiters.length
  }

  /**
   * Une place, tout de suite s'il en reste, sinon à la première rendue ; `timeout` si `signal` tombe avant, la lecture
   * retirée de la file sans avoir pris de place.
   */
  take(signal: AbortSignal): Promise<WorkerSlot> {
    if (signal.aborted) return Promise.reject(new ReaderStatusError({ status: "timeout" }))
    if (this.used < this.size) {
      this.used++
      return Promise.resolve(this.slot())
    }
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        grant: () => {
          signal.removeEventListener("abort", leave)
          resolve(this.slot())
        },
      }
      const leave = () => {
        const at = this.waiters.indexOf(waiter)
        if (at >= 0) this.waiters.splice(at, 1)
        reject(new ReaderStatusError({ status: "timeout" }))
      }
      signal.addEventListener("abort", leave, { once: true })
      this.waiters.push(waiter)
    })
  }

  /** Une place prise, passée telle quelle à la première lecture qui attend quand elle est rendue. */
  private slot(): WorkerSlot {
    let held = true
    return {
      release: () => {
        if (!held) return
        held = false
        const next = this.waiters.shift()
        if (next) next.grant()
        else this.used--
      },
    }
  }
}

/** Les places du processus : `READER_LIMITS.workers`, sans réglage de l'hôte. */
export const WORKER_SLOTS = new WorkerSlots(READER_LIMITS.workers)
