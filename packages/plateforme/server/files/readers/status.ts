// Les statuts terminaux d'une lecture (`lecture-des-fichiers.md` § L'aperçu au dépôt) et l'erreur qui en lève un. Module
// sans import : le worker des lecteurs (`worker/entry.ts`) le lit sans tirer les schémas du paquet (zod) dans son
// script. Sans lui, un lecteur qui court dans le worker n'aurait pas de quoi dire qu'un fichier est illisible.

/** Les statuts terminaux d'une lecture (`lecture-des-fichiers.md` § L'aperçu au dépôt), et `timeout`. */
export const READER_STATUSES = ["unsupported", "encrypted", "empty", "too_large", "rejected_dtd", "failed", "timeout"] as const

export type ReaderStatusCode = (typeof READER_STATUSES)[number]

/** Un fichier illisible : son statut, et ce qui le dit à l'assistant (300 caractères au plus). */
export type ReaderStatus = { status: ReaderStatusCode; detail?: string }

/**
 * Un statut levé : par `text(part)`, qui rend une chaîne et n'a pas d'autre moyen de dire qu'une partie est illisible
 * (trop grosse, mémoire), et par le code d'un lecteur qui le lève au lieu de le rendre. Le paquet le sert comme un
 * statut rendu par `read` ; toute autre erreur levée vaut `failed`.
 */
export class ReaderStatusError extends Error {
  readonly reader: ReaderStatus

  constructor(reader: ReaderStatus) {
    super(reader.detail ? `${reader.status}: ${reader.detail}` : reader.status)
    this.name = "ReaderStatusError"
    this.reader = reader
  }
}
