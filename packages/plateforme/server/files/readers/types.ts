// Le contrat d'un lecteur de fichiers (`lecture-des-fichiers.md` § Le registre des lecteurs) : ce qu'il reçoit, ce qu'il
// rend (un document en parties, ou un statut terminal, rendu ou levé) et les bornes communes à tous les lecteurs. Module
// de types et de constantes, qui n'importe que les bornes des fichiers (`schemas/files.ts`) et les statuts (`status.ts`) :
// le registre, les lecteurs du paquet et le service des fichiers le lisent sans cycle. Hors du barrel `schemas` : rien
// ici n'entre dans un bundle du navigateur.
import { FILE_MAX_BYTES, TEXT_FILE_MAX_BYTES } from "../../../schemas/files"
import type { ReaderStatus } from "./status"

/** Les bornes d'une lecture (`lecture-des-fichiers.md` § Bornes), exportées pour le lecteur d'un hôte. */
export const READER_LIMITS = {
  /** Octets lus d'un fichier texte du paquet (`html`, `md`, `txt`, `csv`), comme son dépôt (HN-E10S02-9). */
  textBytes: TEXT_FILE_MAX_BYTES,
  /** Octets lus d'un autre format, la taille admise d'un fichier (fiche D113). */
  binaryBytes: FILE_MAX_BYTES,
  /** Octets décompressés d'une archive, en tout : la borne qu'un lecteur qui ouvre un ZIP tient. */
  decompressedBytes: 67_108_864,
  /** Durée d'une lecture, téléchargement compris. */
  readMs: 10_000,
  /** Caractères servis du texte d'un fichier ; au-delà, coupé par une ligne qui le dit. */
  textChars: 2_000_000,
  /** Parties listées par le plan ; au-delà, leur nombre. */
  partsShown: 200,
  /**
   * Workers de lecteur qui tournent à la fois dans un processus (le tableur) ; une lecture de plus attend son tour dans
   * son échéance, puis rend `timeout`.
   */
  workers: 2,
} as const

export { READER_STATUSES, ReaderStatusError, type ReaderStatus, type ReaderStatusCode } from "./status"

/** Une partie du texte : titre, feuille, diapositive, page ; son nom se passe à `section`. */
export type ReaderPart = { name: string; chars: number }

/** Le texte d'un fichier en parties ; `text(name)` rend celui d'une partie de `parts`. */
export type ReaderDocument = {
  title: string
  summary: string
  parts: readonly ReaderPart[]
  text: (part: string) => string | Promise<string>
}

/** Ce qu'un lecteur reçoit : le nom d'origine, les octets de l'objet, et le signal levé à l'échéance de la lecture. */
export type ReaderInput = { name: string; bytes: Uint8Array; signal: AbortSignal }

/** Un type lu : l'extension du nom (sans point, en minuscules) et le type MIME signé au dépôt. */
export type ReaderType = { extension: string; mime: string }

/** Un lecteur : les types qu'il lit et sa lecture. */
export type Reader = {
  types: readonly ReaderType[]
  read: (input: ReaderInput) => ReaderDocument | ReaderStatus | Promise<ReaderDocument | ReaderStatus>
}
