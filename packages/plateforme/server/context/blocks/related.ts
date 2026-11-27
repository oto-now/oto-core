// Bloc « Pages and tables close to the request » de `context` : les pages et tableaux proches de la phrase, classés comme
// les procédures (`rankCandidates` sur leur titre et leur résumé, mêmes seuils et bonus), huit au plus, chacun en une
// ligne, celle des nœuds suivants de `find`. Sans lui, `context` ne montrait que des procédures : la page qui répond à
// une question restait à chercher.
import { SERVED_RELATED } from "../../../schemas"
import { otherLine } from "../../find"
import type { Candidate } from "../../routing"
import type { ContextBlock } from "../engine"
import { servedSentence } from "./contexts"

/** Contenus proches montrés au plus (cinq jusqu'au 2026-10-27, décision de JB : huit, seuil inchangé). */
export const RELATED_MAX = 8

/** Les genres d'un contenu proche : ni procédure (le routage les sert), ni Contexte (déjà servi). */
export const RELATED_KINDS = ["page", "table"] as const

/** Le bloc, ou `null` sans contenu proche : rien ne s'affiche alors. */
export function relatedBlock(related: readonly Candidate[], prefix: string): ContextBlock | null {
  if (related.length === 0) return null
  // Sans score (AC7, il reste aux données de l'aperçu), le résumé à sa première phrase (AC9 bis) ; `find` garde les deux.
  const lines = related.map((candidate) => otherLine({ ...candidate, summary: servedSentence(candidate.summary) }, { score: false }))
  return { name: "related", text: [SERVED_RELATED.title, ...lines, `${SERVED_RELATED.readHint}${prefix}_read {"path": "<path>"}.`].join("\n") }
}
