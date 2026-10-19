// Les opérations de `write` sur le brouillon en mémoire (E03-S03 ; H54 amendée, N6, N15, N17) :
// répartition entre opérations par section (`section-ops.ts`) et par bloc (`block-ops.ts`), champs
// propres à chaque opération, bornes chiffrées. Elles s'appliquent dans l'ordre ; la première qui
// échoue refuse tout le lot, avant toute écriture. Sans elles, rien ne s'écrit par opérations.
//
// Repris d'Oto (`oto_mcp/doc_patch.py` l. 232-245) : un argument inutilisé est refusé en le nommant
// (un argument avalé ne se voit pas). Retiré : les modes `region=` et `prepend`.
import { SECTION_OPS, splitSections, type WriteOpBody } from "../../schemas"
import { isUnknownBlock } from "../../schemas/blocks-render"
import { splitFrontmatter } from "../../schemas/frontmatter"
import { PlatformError } from "../errors"
import { cut } from "../journal"
import { applyBlockOp } from "./block-ops"
import { blocksSize, charCount, formatCount, sectionSizes, type DocBlock } from "./document"
import { BLOCKS_MAX, OP_TEXT_MAX, OPS_MAX, PAGE_MAX, SECTION_MAX } from "./limits"
import { OpProblem, parseOpText, plural, type OpOutcome, type OpState, type Touched, type WorkBlock } from "./op-kit"
import { replaceText } from "./replace-text"
import { applySectionOp, matchByForm } from "./section-ops"

type Op = WriteOpBody["op"]

type Field = "section" | "text" | "find" | "count" | "after" | "block" | "after_block" | "revision" | "input"

/** Les champs d'une opération, dans l'ordre où un champ inutilisé est nommé (AC22, AC24, N17). */
const FIELDS: readonly Field[] = ["section", "text", "find", "count", "after", "block", "after_block", "revision", "input"]

const USES: Record<Op, readonly Field[]> = {
  replace_section: ["section", "text"],
  append: ["section", "text"],
  add_section: ["section", "text", "after"],
  delete_section: ["section"],
  // E11-S18 (AC-10) : dans une section, un bloc ou toute la page, `count` occurrences.
  replace_text: ["section", "block", "text", "find", "count"],
  replace_block: ["block", "text", "revision", "input"],
  insert_after: ["block", "text", "input"],
  delete_block: ["block", "revision"],
  move_block: ["block", "after_block", "section", "revision"],
  // E11-S18 (AC-11) : tout le corps.
  set_markdown: ["text"],
}

const SECTION_OP_NAMES: ReadonlySet<string> = new Set(SECTION_OPS)

/** Le bloc visé est obligatoire, sauf pour `insert_after` (en tête sans lui). */
const NEEDS_BLOCK: ReadonlySet<Op> = new Set(["replace_block", "delete_block", "move_block"])

/** La section est obligatoire, sauf pour `replace_text` (le bloc ou toute la page sans elle, E11-S18). */
const NEEDS_SECTION: ReadonlySet<Op> = new Set(["replace_section", "append", "add_section", "delete_section"])

const isSectionOp = (op: WriteOpBody) => SECTION_OP_NAMES.has(op.op)

/** Un titre cité dans le préfixe d'un refus : sur une ligne, coupé à 60 caractères (`cut`, jamais dans un emoji). */
function shown(title: string): string {
  return cut(title.replace(/\s+/g, " ").trim(), 60)
}

/** « Op 2 (append « Corps »): », « Op 1 (insert_after 3f9a2c1b): », « Op 2 (append): ». */
function prefixOf(rank: number, op: WriteOpBody): string {
  if (op.section !== undefined && isSectionOp(op)) return `Op ${rank} (${op.op} « ${shown(op.section)} »): `
  return `Op ${rank} (${op.op}${op.block === undefined ? "" : ` ${op.block}`}): `
}

/** Champs requis, champs inutilisés, texte ou bloc structuré, borne du texte (AC22 à AC24). */
function checkFields(op: WriteOpBody): void {
  if (NEEDS_SECTION.has(op.op) && op.section === undefined) throw new OpProblem("invalid_arguments", "section is required (the title of a section).")
  if (op.op === "replace_text" && op.section !== undefined && op.block !== undefined) throw new OpProblem("invalid_arguments", "give section or block, not both.")
  if (NEEDS_BLOCK.has(op.op) && op.block === undefined) {
    throw new OpProblem("invalid_arguments", "block is required (a reference from read with refs: true).")
  }
  const unused = FIELDS.find((field) => op[field] !== undefined && !USES[op.op].includes(field))
  if (unused) throw new OpProblem("invalid_arguments", `${unused} is not used by ${op.op}; remove it.`)
  if (op.text !== undefined && op.input !== undefined) throw new OpProblem("invalid_arguments", "give text or input, not both.")
  // `move_block` (E11-S03, AC-c1) : après un bloc, ou à la fin d'une section ; les deux destinations ensemble se contredisent.
  if (op.after_block !== undefined && op.section !== undefined) throw new OpProblem("invalid_arguments", "give after_block or section, not both.")
  if (USES[op.op].includes("text") && op.text === undefined && op.input === undefined) throw new OpProblem("invalid_arguments", "text is required.")
  if (op.op === "replace_text" && op.find === undefined) throw new OpProblem("invalid_arguments", "find is required (the exact words to replace).")
  if (op.text !== undefined && charCount(op.text) > OP_TEXT_MAX) {
    throw new OpProblem(
      "too_large",
      `text is ${formatCount(charCount(op.text))} characters; ${formatCount(OP_TEXT_MAX)} at most per operation: send it in parts of about 20,000 with append.`,
    )
  }
}

/** Taille de chaque section, par le `uid` de son titre (−1 : le début de page). */
function sizesByHeading(blocks: readonly WorkBlock[]): Map<number, { size: number; title: string | null }> {
  const sections = splitSections(blocks)
  const sizes = sectionSizes(blocks, sections)
  return new Map(sections.map((section, index) => [section.heading?.uid ?? -1, { size: sizes[index], title: section.heading?.text ?? null }]))
}

/**
 * Bornes d'une page après une opération (N6) : section, page, nombre de blocs. Seule une opération
 * qui fait grandir au-delà est refusée : un document déjà trop grand reste modifiable. `wholeFile` : un `.md`
 * déposé par lien (E10-S02, AC-f7), écrit entier, que la borne de section ne coupe pas.
 */
function checkBounds(before: readonly WorkBlock[], after: readonly WorkBlock[], path: string, wholeFile: boolean): void {
  const previous = sizesByHeading(before)
  for (const [uid, { size, title }] of wholeFile ? [] : sizesByHeading(after)) {
    if (size <= SECTION_MAX || size <= (previous.get(uid)?.size ?? 0)) continue
    const which = title === null ? "the start of the page" : `section « ${title} »`
    throw new OpProblem(
      "too_large",
      `${which} would reach ${formatCount(size)} characters; a section holds at most ${formatCount(SECTION_MAX)}: continue in a new section with add_section.`,
    )
  }
  const size = blocksSize(after)
  if (size > PAGE_MAX && size > blocksSize(before)) {
    throw new OpProblem("too_large", `${path} would reach ${formatCount(size)} characters; a page holds at most ${formatCount(PAGE_MAX)}.`)
  }
  if (after.length > BLOCKS_MAX && after.length > before.length) {
    throw new OpProblem("too_large", `${path} would hold ${formatCount(after.length)} blocks; a page holds at most ${formatCount(BLOCKS_MAX)}.`)
  }
}

/**
 * `set_markdown` (E11-S18, AC-11) : tout le corps remplacé par le texte, lu comme celui d'une opération (au mode de
 * l'appel) ; un frontmatter YAML de tête n'en est pas (AC-9 : ses lignes deviennent vides, les numéros de ligne d'un
 * refus restent ceux du texte). Les blocs de même forme gardent leur id (N12) ; un bloc d'une version plus récente, que
 * le texte ne peut pas redire, refuse (M67).
 */
function setMarkdown(state: OpState, op: WriteOpBody): OpOutcome {
  const lines = (op.text ?? "").replace(/\r\n?/g, "\n").split("\n")
  const front = splitFrontmatter(lines)
  const text = front ? [...lines.slice(0, front.end).map(() => ""), ...lines.slice(front.end)].join("\n") : lines.join("\n")
  if (text.trim() === "") throw new OpProblem("invalid_arguments", "text is empty; set_markdown writes the whole body of the page.")
  const newer = state.blocks.find(isUnknownBlock)
  if (newer) {
    throw new OpProblem(
      "conflict",
      `${state.path} holds a ${newer.type} block newer than this platform version, which set_markdown would lose: update the platform, or edit the other blocks with section or block operations.`,
    )
  }
  const blocks = matchByForm(state, state.blocks, parseOpText(text, state).blocks)
  const fresh = blocks.filter((block) => !state.blocks.includes(block))
  const sections = splitSections(blocks).length - 1
  const describe = () => `replaced the whole body (${formatCount(sections)} ${plural(sections, "section")}, ${formatCount(blocksSize(blocks))} characters)`
  return { blocks, touched: { op: op.op, uids: fresh.map((block) => block.uid), describe } }
}

/**
 * Le brouillon après les opérations, dans l'ordre, et ce que chacune a touché (AC22 à AC24). Les
 * blocs gardés gardent leur id ; un bloc neuf n'a ni id ni position ; un bloc déplacé perd sa position
 * (`placeBlocks` les pose). Lève les refus des AC, préfixés de « Op <rang> (…): » et finis par
 * « Nothing was written. » : rien n'est écrit. `revision`, celle du nœud, que porte un refus de révision
 * de bloc (`details.revision`, AC37). `tolerant` (E10-S01, AC-a2) : les textes se lisent en mode tolérant, et
 * `keptAsText` compte ce qu'ils ont gardé en texte (0 sans lui). `wholeFile` (E10-S02, AC-f7) : un `.md` déposé par lien,
 * sans borne de section ; celles de la page et du nombre de blocs restent. `opsMax` : les opérations d'un appel, que
 * `write.ts` décide selon la porte (fiche D153) ; `OPS_MAX` sans lui.
 */
export function applyOps(
  blocks: readonly DocBlock[],
  ops: readonly WriteOpBody[],
  options: { path: string; revision?: number; tolerant?: boolean; wholeFile?: boolean; opsMax?: number; places?: OpState["places"] },
): { blocks: WorkBlock[]; touched: Touched[]; keptAsText: number } {
  const opsMax = options.opsMax ?? OPS_MAX
  if (ops.length > opsMax) {
    throw new PlatformError("invalid_arguments", `${formatCount(ops.length)} operations; ${formatCount(opsMax)} at most per call: split them over several calls.`)
  }
  const state: OpState = {
    blocks: blocks.map((block, uid) => ({ ...block, uid })),
    path: options.path,
    nextUid: blocks.length,
    revision: options.revision,
    tolerant: options.tolerant,
    keptAsText: 0,
    places: options.places,
  }
  const touched: Touched[] = []
  ops.forEach((op, index) => {
    try {
      checkFields(op)
      const outcome =
        op.op === "set_markdown" ? setMarkdown(state, op) : op.op === "replace_text" ? replaceText(state, op) : isSectionOp(op) ? applySectionOp(state, op) : applyBlockOp(state, op)
      checkBounds(state.blocks, outcome.blocks, state.path, options.wholeFile === true)
      state.blocks = outcome.blocks
      touched.push(outcome.touched)
    } catch (error) {
      if (!(error instanceof OpProblem)) throw error
      throw new PlatformError(error.code, error.bare ? error.message : `${prefixOf(index + 1, op)}${error.message} Nothing was written.`, error.details)
    }
  })
  return { blocks: state.blocks, touched, keptAsText: state.keptAsText ?? 0 }
}
