// Le point d'entrée du worker des lecteurs (`lecture-des-fichiers.md` § Bornes), assemblé avec ce qu'il importe en un
// seul script (`build.mjs` → `generated.ts`) que `run.ts` lance par `eval` : aucun fichier à résoudre chez l'hôte, quel
// que soit son bundler. Il reçoit le fichier au démarrage, puis répond à chaque demande (le plan, une partie) par un
// résultat, un statut ou l'erreur. Il ne lit ni l'environnement (le fil principal lui en donne un vide) ni le réseau.
// Sans lui, la lecture d'un tableur tiendrait le fil de la requête, sans échéance qui l'interrompe.
import { parentPort, workerData } from "node:worker_threads"
import { ReaderStatusError } from "../status"
import { Book } from "../xlsx/book"
import type { WorkerJob, WorkerReply, WorkerRequest } from "./protocol"

const job = workerData as WorkerJob
let book: Book | null = null

function answer(request: WorkerRequest & { id: number }): WorkerReply {
  try {
    book ??= new Book(job.bytes, job.name, job.limits)
    return { id: request.id, result: request.op === "outline" ? book.outline() : book.text(request.part) }
  } catch (error) {
    if (error instanceof ReaderStatusError) return { id: request.id, status: error.reader }
    return { id: request.id, error: error instanceof Error ? (error.stack ?? error.message) : String(error) }
  }
}

parentPort?.on("message", (request: WorkerRequest & { id: number }) => {
  parentPort?.postMessage(answer(request))
})
