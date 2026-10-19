// `replace_text` de `write` (E03-S01 ; E11-S18, AC-10) : les mots exacts `find` remplacés par `text`, dans une section
// (son titre), dans un bloc (sa référence, lue par `read` avec `refs: true` ou rendue par `find`) ou dans toute la page ;
// `count` occurrences, une par défaut, un autre nombre trouvé refusé en le disant. Un remplacement dans un bloc ne
// réécrit que lui (un seul bloc garde l'id, N12) ; à cheval sur plusieurs blocs, seul le corps d'une section se réécrit
// (M67). Fonction pure, sur le document en mémoire. Fichier à part de `section-ops.ts`, pour la borne de 300 lignes
// (`coding-standards.md § Complexité`) et parce que l'opération ne vise plus seulement une section.
import type { WriteOpBody } from "../../schemas"
import { cut } from "../journal"
import { hasToken } from "../pseudonym/arguments"
import { target } from "./block-ops"
import { blockMarkdown, blocksSize, formatCount, headingLevel } from "./document"
import { PAGE_MAX, SECTION_MAX } from "./limits"
import { newBlock, OpProblem, parseOpText, plural, type OpOutcome, type OpState, type WorkBlock } from "./op-kit"
import { checkHeadings, keepNewerBlocks, locate, matchByForm, type Located } from "./section-ops"

/** Le rendu d'un bloc dans celui de la portée : ses indices de chaîne. */
type Span = { block: WorkBlock; start: number; end: number }

/** Une occurrence de `find` dans le markdown en clair de la portée : `[start, end)`. */
type Range = { start: number; end: number }

/** Où cherche l'opération : ses blocs à partir de l'indice `from`, comme un refus la nomme (`label`), et sa section. */
type Scope = { from: number; blocks: WorkBlock[]; label: string; section: Located | null; max: number }

/** Les blocs réécrits de la portée, et ceux qui y sont neufs ou changés. */
type Replaced = { blocks: WorkBlock[]; edited: WorkBlock[] }

function scopeOf(state: OpState, op: WriteOpBody): Scope {
  if (op.section !== undefined) {
    const at = locate(state, op.section, "section")
    return { from: at.start, blocks: state.blocks.slice(at.start, at.end), label: `« ${at.title} »`, section: at, max: SECTION_MAX }
  }
  if (op.block !== undefined) {
    const block = target(state, op.block, "block")
    return { from: state.blocks.indexOf(block), blocks: [block], label: `block ${op.block}`, section: null, max: SECTION_MAX }
  }
  return { from: 0, blocks: state.blocks, label: state.path, section: null, max: PAGE_MAX }
}

/** Le markdown des blocs, et l'étendue (indices de chaîne) du rendu de chacun. */
function spansOf(blocks: readonly WorkBlock[]): { markdown: string; spans: Span[] } {
  const spans: Span[] = []
  let markdown = ""
  for (const block of blocks) {
    const rendered = blockMarkdown(block)
    if (rendered === "") continue
    if (markdown !== "") markdown += "\n\n"
    spans.push({ block, start: markdown.length, end: markdown.length + rendered.length })
    markdown += rendered
  }
  return { markdown, spans }
}

/** Les places des occurrences de `find` dans `text`, sans chevauchement, de gauche à droite (comme `split`). */
function indicesOf(text: string, find: string): number[] {
  const found: number[] = []
  for (let at = text.indexOf(find); at !== -1; at = text.indexOf(find, at + find.length)) found.push(at)
  return found
}

/**
 * Les occurrences de `find` dans le markdown en clair. Un `find` qui porte un jeton (pseudonymisation) se cherche dans le
 * markdown pseudonymisé (`state.places`), puis chaque occurrence revient au clair par la table de places : « ⟦client:…⟧
 * a rappelé » remplace « Camille Dupré a rappelé ». Une occurrence dont un bord tombe dans un jeton ne compte pas.
 */
function occurrences(state: OpState, markdown: string, find: string): Range[] {
  if (!state.places || !hasToken(find)) return indicesOf(markdown, find).map((start) => ({ start, end: start + find.length }))
  const places = state.places(markdown)
  return indicesOf(places.text, find).flatMap((at) => {
    const start = places.clearAt(at)
    const end = places.clearAt(at + find.length)
    return start === null || end === null ? [] : [{ start, end }]
  })
}

/** Le nombre d'occurrences attendu (`count`, 1 par défaut) ; un autre est refusé en disant celui trouvé. */
function checkCount(find: string, found: number, op: WriteOpBody, label: string): void {
  const expected = op.count ?? 1
  if (found === expected) return
  const quoted = `« ${cut(find, 100)} »`
  if (op.count !== undefined) throw new OpProblem("invalid_arguments", `${quoted} appears ${found} times in ${label}, not ${expected} (count).`)
  const all = found > 1 ? ` To replace all ${found}, give count: ${found}.` : ""
  throw new OpProblem("invalid_arguments", `${quoted} appears ${found} times in ${label}; quote words that appear exactly once.${all}`)
}

/**
 * La taille qu'aurait la portée après le remplacement (`count` fois le texte neuf à la place de `find`), refusée au-delà
 * de sa borne (une section ou un bloc : `SECTION_MAX` ; la page : `PAGE_MAX`) avant toute construction : 1 000
 * occurrences d'un texte de 40 000 caractères ne s'assemblent jamais (HN-E11S18-10). Un remplacement qui ne fait pas
 * grandir passe, comme les autres opérations.
 */
function checkProjected(scope: Scope, size: number, at: readonly Range[], text: string): void {
  const count = at.length
  const projected = size + at.reduce((sum, range) => sum + text.length - (range.end - range.start), 0)
  if (projected <= scope.max || projected <= size) return
  throw new OpProblem(
    "too_large",
    `replacing ${formatCount(count)} ${plural(count, "occurrence")} would bring ${scope.label} to about ${formatCount(projected)} characters; ${formatCount(scope.max)} at most: replace fewer at a time, or with a shorter text.`,
  )
}

/** Le titre dont relève un bloc : celui de la section de l'opération, sinon le plus proche avant lui dans la page. */
function enclosing(state: OpState, scope: Scope, block: WorkBlock): { level: number; title: string } | null {
  if (scope.section) return { level: scope.section.level, title: scope.section.title }
  const heading = state.blocks.slice(0, state.blocks.indexOf(block)).findLast((candidate) => headingLevel(candidate) !== null)
  return heading ? { level: headingLevel(heading) ?? 1, title: heading.text ?? "" } : null
}

/**
 * Un bloc dont le rendu contient des occurrences : ses blocs après remplacement (un seul garde l'id, N12). Le titre de
 * la section visée, ou tout titre hors d'une section visée, reste un titre de son niveau ; un autre bloc ne fait naître
 * aucun titre au niveau de sa section ou au-dessus (N9).
 */
function editBlock(state: OpState, scope: Scope, span: Span, edit: { at: readonly Range[]; text: string }): WorkBlock[] {
  // En une passe : les morceaux entre les occurrences, joints par le texte neuf (jamais une copie par occurrence).
  const rendered = blockMarkdown(span.block)
  const pieces: string[] = []
  let from = 0
  for (const range of edit.at) {
    pieces.push(rendered.slice(from, range.start - span.start))
    from = range.end - span.start
  }
  pieces.push(rendered.slice(from))
  const markdown = pieces.join(edit.text)
  const parsed = parseOpText(markdown, state)
  const level = headingLevel(span.block)
  if (scope.section ? span.block === scope.section.heading : level !== null) {
    const [first] = parsed.blocks
    if (parsed.blocks.length !== 1 || first.type !== "heading" || first.data.level !== level) {
      throw new OpProblem("invalid_arguments", `the title of « ${span.block.text ?? ""} » must stay a heading of its level; use replace_block to change it.`)
    }
  } else {
    const around = enclosing(state, scope, span.block)
    if (around) checkHeadings(parsed, markdown, around.level, around.title)
  }
  if (parsed.blocks.length !== 1) return parsed.blocks.map((input) => newBlock(state, input))
  const [only] = parsed.blocks
  return [{ ...span.block, type: only.type, text: only.text ?? null, data: { ...(only.data ?? {}) } }]
}

/** Chaque occurrence dans un seul bloc : seuls ces blocs se réécrivent. */
function inBlocks(state: OpState, scope: Scope, hits: readonly Span[], edit: { at: readonly Range[]; text: string }): Replaced {
  const bySpan = new Map<Span, Range[]>()
  hits.forEach((span, rank) => {
    const indices = bySpan.get(span) ?? []
    indices.push(edit.at[rank])
    bySpan.set(span, indices)
  })
  const touched = [...bySpan.keys()]
  keepNewerBlocks(
    touched.map((span) => span.block),
    scope.section?.title ?? enclosing(state, scope, touched[0].block)?.title ?? state.path,
  )
  const edited: WorkBlock[] = []
  const blocks = scope.blocks.flatMap((block) => {
    const span = touched.find((one) => one.block === block)
    if (!span) return [block]
    const fresh = editBlock(state, scope, span, { ...edit, at: bySpan.get(span) ?? [] })
    edited.push(...fresh)
    return fresh
  })
  return { blocks, edited }
}

/** Une occurrence à cheval sur plusieurs blocs : le corps d'une section se réécrit ; ailleurs, refus. */
function acrossBlocks(state: OpState, scope: Scope, found: { markdown: string; spans: Span[]; at: readonly Range[] }, edit: { find: string; text: string }): Replaced {
  const at = scope.section
  if (!at) {
    throw new OpProblem(
      "invalid_arguments",
      `« ${cut(edit.find, 100)} » spans several blocks of ${scope.label}; replace it within one block or one section (give section), or rewrite the page with set_markdown.`,
    )
  }
  const from = found.spans[1]?.start ?? found.markdown.length
  keepNewerBlocks(scope.blocks.slice(1), at.title)
  if (found.at[0].start < from) throw new OpProblem("invalid_arguments", `« find » spans the title of « ${at.title} »; use replace_section.`)
  // Les morceaux du corps entre les occurrences, joints par le texte neuf.
  const pieces: string[] = []
  let cursor = from
  for (const range of found.at) {
    pieces.push(found.markdown.slice(cursor, range.start))
    cursor = range.end
  }
  pieces.push(found.markdown.slice(cursor))
  const newBody = pieces.join(edit.text)
  const parsed = parseOpText(newBody, state)
  checkHeadings(parsed, newBody, at.level, at.title)
  const oldBody = scope.blocks.slice(1)
  const matched = matchByForm(state, oldBody, parsed.blocks)
  return { blocks: [at.heading, ...matched], edited: matched.filter((block) => !oldBody.includes(block)) }
}

/** Ce que dit la réponse : la section éditée (sa taille), le bloc édité, ou le nombre d'occurrences dans la page. */
function described(op: WriteOpBody, scope: Scope, replaced: Replaced, count: number): string {
  const times = count > 1 ? `${formatCount(count)} occurrences` : ""
  if (scope.section) {
    const title = replaced.blocks[0]?.text ?? scope.section.title
    return `edited « ${title} » (${formatCount(blocksSize(replaced.blocks))} characters${times ? `, ${times}` : ""})`
  }
  if (op.block !== undefined) return `edited block ${op.block}${times ? ` (${times})` : ""}`
  return `replaced ${formatCount(count)} ${plural(count, "occurrence")} of « ${cut(op.find ?? "", 60)} »`
}

/** `replace_text` (champs déjà contrôlés par `applyOps`) : dans la section, le bloc ou la page, `count` occurrences. */
export function replaceText(state: OpState, op: WriteOpBody): OpOutcome {
  const scope = scopeOf(state, op)
  const edit = { find: op.find ?? "", text: op.text ?? "" }
  const { markdown, spans } = spansOf(scope.blocks)
  const at = occurrences(state, markdown, edit.find)
  checkCount(edit.find, at.length, op, scope.label)
  checkProjected(scope, markdown.length, at, edit.text)
  const hits = at.map((range) => spans.find((span) => span.start <= range.start && range.end <= span.end))
  const within = hits.flatMap((span) => (span ? [span] : []))
  const replaced = within.length === hits.length ? inBlocks(state, scope, within, { at, text: edit.text }) : acrossBlocks(state, scope, { markdown, spans, at }, edit)
  const blocks = [...state.blocks.slice(0, scope.from), ...replaced.blocks, ...state.blocks.slice(scope.from + scope.blocks.length)]
  const text = described(op, scope, replaced, at.length)
  return { blocks, touched: { op: op.op, uids: replaced.edited.map((block) => block.uid), describe: () => text } }
}
