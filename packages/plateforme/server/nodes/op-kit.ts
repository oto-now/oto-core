// Ce que partagent les opérations de `write` (E03-S03) : le bloc de travail, l'état du document pendant
// les opérations, le refus d'une opération, l'analyse d'un texte, les listes citées. Fichier à part :
// `ops.ts` importe `section-ops.ts` et `block-ops.ts`, qui en ont besoin ; sans lui, les trois
// modules s'importeraient en cycle.
import type { Places } from "../pseudonym/gate"
import type { BlockInput, WriteOpBody } from "../../schemas"
import type { PlatformErrorCode } from "../errors"
import type { DocBlock } from "./document"
import { LISTED_MAX } from "./limits"
import { parseMarkdown } from "./markdown-parse"

/**
 * Un bloc pendant les opérations : `uid` le suit d'une opération à l'autre et jusqu'à l'écriture (un
 * bloc changé est un autre objet, jamais modifié en place ; un bloc neuf n'a pas encore d'id).
 */
export type WorkBlock = DocBlock & { uid: number }

/**
 * Le document pendant les opérations d'un appel ; `nextUid` numérote les blocs neufs ; `revision`, celle
 * du nœud, que porte un refus de révision (`details.revision`, AC37). `tolerant` : le texte des opérations se
 * lit en mode tolérant, et `keptAsText` compte ce qu'il a gardé en texte (E10-S01, AC-a2 ; corps de l'API seul).
 */
/**
 * `places` : le markdown d'une portée pseudonymisé, avec sa table de places, quand la porte MCP pseudonymise ; `find` de
 * `replace_text` qui porte un jeton s'y cherche (`replace-text.ts`).
 */
export type OpState = { blocks: WorkBlock[]; path: string; nextUid: number; revision?: number; tolerant?: boolean; keptAsText?: number; places?: (text: string) => Places }

/**
 * Ce qu'une opération a touché : les blocs qu'elle a écrits (`uid`), et son fragment de réponse,
 * rendu une fois le brouillon écrit et les références des blocs neufs connues.
 */
export type Touched = { op: WriteOpBody["op"]; uids: number[]; describe: (refOf: (uid: number) => string) => string }

export type OpOutcome = { blocks: WorkBlock[]; touched: Touched }

/**
 * Refus d'une opération : `applyOps` le préfixe de « Op <rang> (…): » et le finit par « Nothing was
 * written. » ; `bare` : texte complet, servi tel quel (révision de bloc périmée, AC24) ; `details`,
 * repris par le refus (`revision`, AC37).
 */
export class OpProblem extends Error {
  constructor(
    readonly code: PlatformErrorCode,
    message: string,
    readonly bare = false,
    readonly details?: Record<string, unknown>,
  ) {
    super(message)
  }
}

/** Un bloc neuf, sans id ni position, révision 1, sa provenance posée à l'écriture. */
export function newBlock(state: OpState, input: BlockInput): WorkBlock {
  return {
    id: null,
    type: input.type,
    text: input.text ?? null,
    data: { ...(input.data ?? {}) },
    key: input.key ?? null,
    position: null,
    revision: 1,
    provenance: {},
    uid: state.nextUid++,
  }
}

/**
 * Les blocs d'un texte d'opération (`parseMarkdown`), ou le refus de l'analyse (AC3) ; au mode de l'état
 * (E10-S01, AC-a2), dont le compte des constructions gardées en texte avance.
 */
export function parseOpText(text: string, state: Pick<OpState, "tolerant" | "keptAsText">): { blocks: BlockInput[]; lines: number[] } {
  const parsed = parseMarkdown(text, { tolerant: state.tolerant === true })
  if ("problem" in parsed) throw new OpProblem("invalid_arguments", parsed.problem)
  if (parsed.keptAsText) state.keptAsText = (state.keptAsText ?? 0) + parsed.keptAsText
  return parsed
}

/** « « A », « B » », 50 au plus puis « and <n> more ». */
export function quotedList(titles: readonly string[]): string {
  const shown = titles.slice(0, LISTED_MAX).map((title) => `« ${title} »`)
  const more = titles.length - shown.length
  return more > 0 ? `${shown.join(", ")} and ${more} more` : shown.join(", ")
}

/** « block » pour un, « blocks » au-delà. */
export function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`
}
