// Ce que se disent le fil principal (`run.ts`) et le worker des lecteurs (`entry.ts`) : le travail donné au démarrage,
// les demandes et les réponses. Types seuls, lus des deux côtés. Sans lui, chaque côté supposerait la forme de l'autre.
import type { ReaderStatus } from "../status"
import type { BookLimits } from "../xlsx/book"

/** Le travail d'un worker, passé au démarrage (`workerData`) : le format, le nom et les octets du fichier, les bornes. */
export type WorkerJob = { format: "xlsx"; name: string; bytes: Uint8Array; limits: BookLimits }

/** Une demande : le plan, ou le texte d'une partie. */
export type WorkerRequest = { op: "outline" } | { op: "text"; part: string }

/** Une réponse à la demande `id` : son résultat, un statut, ou l'erreur inattendue (journalisée, servie `failed`). */
export type WorkerReply = { id: number } & ({ result: unknown } | { status: ReaderStatus } | { error: string })
