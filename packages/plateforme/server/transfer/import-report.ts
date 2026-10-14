// Le rapport d'un import (`node.import_tree`) et le curseur d'une reprise : ce qui est dit de chaque nœud, chaque liste
// bornée à 30 lignes dans le texte (entière dans les données de la réponse), le refus d'un nœud avec son détail entier, et
// l'étape d'où repartir avec les places déjà choisies. Fichier à part d'`import.ts`, pour la borne de 300 lignes.
import { isPlatformError, PlatformError } from "../errors"

/** Lignes au plus du texte par liste du rapport : le reste se compte, la liste entière est dans les données. */
const REPORT_LINES_MAX = 30

export type ImportReport = {
  created: string[]
  updated: string[]
  skipped: { path: string; reason: string }[]
  refused: { path: string; reason: string }[]
  /** Une procédure que la publication refuse (une fonction absente du catalogue, un appel invalide) : son texte gardé en brouillon. */
  drafts: { path: string; reason: string }[]
  orphans: { from: string; to: string }[]
  /** Ce que l'import a réécrit : chemins (cellules, appels) et mentions d'outils préfixés par l'organisation source. */
  rewritten: { paths: number; prefixes: number }
  notes: string[]
}

export function emptyReport(notes: readonly string[]): ImportReport {
  return { created: [], updated: [], skipped: [], refused: [], drafts: [], orphans: [], rewritten: { paths: 0, prefixes: 0 }, notes: [...notes] }
}

/**
 * Le refus d'un nœud, entier sur une ligne : son code, puis chaque ligne du message (une publication refusée en donne une
 * par problème) ; une panne hors refus reste « internal error ».
 */
export function refusalOf(error: unknown): string {
  if (!isPlatformError(error)) return "internal error"
  const lines = error.message
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
  return `${error.code}: ${lines.join(" ")}`
}

/** Les lignes d'une liste du rapport, bornées : les 30 premières, puis le compte du reste, entier dans les données. */
export function reportLines(items: readonly string[]): string[] {
  if (items.length <= REPORT_LINES_MAX) return [...items]
  return [...items.slice(0, REPORT_LINES_MAX), `… and ${items.length - REPORT_LINES_MAX} more (the whole list is in the data of this answer)`]
}

/**
 * Où repartir : l'étape, et les chemins d'arrivée déjà choisis pour un chemin de la source (un nœud du haut placé à côté
 * d'un chemin pris par `suffix`, un nœud dont le chemin était tenu), qu'un appel suivant ne recalculerait pas.
 */
export type Cursor = { step: number; placed: Record<string, string> }

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url")
}

export function decodeCursor(token: string | undefined): Cursor {
  if (token === undefined) return { step: 0, placed: {} }
  try {
    const parsed: unknown = JSON.parse(Buffer.from(token, "base64url").toString("utf8"))
    const placed = typeof parsed === "object" && parsed !== null && "placed" in parsed ? parsed.placed : null
    const strings = typeof placed === "object" && placed !== null && !Array.isArray(placed) && Object.values(placed).every((value) => typeof value === "string")
    if (typeof parsed === "object" && parsed !== null && "step" in parsed && Number.isInteger(parsed.step) && strings) {
      // Forme contrôlée juste au-dessus ; une place forgée n'est reprise que sous le parent (`destinationOf`).
      return parsed as Cursor
    }
  } catch {
    // Illisible : le refus ci-dessous.
  }
  throw new PlatformError("invalid_arguments", "continue_from is not a step given by a previous answer: call again without it.")
}
