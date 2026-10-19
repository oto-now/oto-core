// Moteur de blocs de `context` (H30, ADR-002 § 7) : des blocs ordonnés par priorité dans un budget
// de caractères, coupés par la fin. Sans lui, un Contexte trop long (E03-S08) dépasserait ce que
// les hosts lisent en entier.
//
// Repris de la maquette (`mcp-test/src/proto/services/context.ts` l. 11-61) : réserve de la ligne
// finale, coupe à la ligne, blocs suivants omis et nommés. Repris d'Oto
// (`oto_mcp/capabilities/agent_context.py`) : un bloc au corps vide est omis ; le poids en caractères
// de chaque bloc, pour l'aperçu (« on mesure, on n'ampute pas », l. 44-52). Retiré d'Oto : notice,
// toolbox, projets et `run_*` (architecture § 10).

import { CONTEXT_INDEX, SERVED_BUDGET } from "../../schemas"
import { formatCount } from "../nodes/document"

/**
 * Le plafond de `context` (ADR-002 § 7, fiche D134) : 35 000 caractères ≈ 10 000 tokens, où Claude Code commence à
 * avertir d'un résultat d'outil MCP ; les blocs y sont servis entiers, sans taille par bloc (E11-S03, AC-b1).
 */
export const CONTEXT_BUDGET = 35_000

/** Place gardée pour la ligne finale qui nomme les blocs omis. */
const NOTICE_RESERVE = 240

const DAY_MS = 86_400_000

export type ContextBlock = {
  name: string
  text: string
  /**
   * Remplaçant d'un bloc qui ne tient pas (N2) : un bloc qui en a un n'est jamais coupé. La procédure
   * servie y met un pointeur vers `read` (E03-S02, AC9).
   */
  fallback?: string
  /**
   * Déjà arrêté à sa borne en lignes (listes d'un Contexte 20, procédures utiles 60 ; E11-S03, HN-E11S03-15),
   * l'arrêt dit dans son texte : rapporté `cut` même quand le plafond le garde entier. Sans lui, l'aperçu
   * d'E05-S04 dirait « complet » d'un bloc dont une partie n'est pas listée.
   */
  cut?: boolean
  /** Chemin du nœud Contexte d'où vient le bloc (E03-S08), recopié dans le rapport pour l'écran d'E05-S04. */
  path?: string
  /**
   * Caractères de la tête d'une partie de Contexte (E05-S12, AC-4) : en-tête, ligne de faits, connecteurs.
   * Sans lui, l'écran ne saurait où finit ce que l'assistant lit toujours et où commence le Contexte écrit.
   */
  head?: number
  /**
   * L'ordre dans lequel le budget se répartit, plus petit d'abord ; sans lui, l'ordre d'affichage. Le texte garde
   * l'ordre d'affichage : seule la coupe suit la priorité. Sans elle, les procédures et les contenus récents,
   * affichés en dernier, partaient les premiers quand onze Contextes d'équipe remplissaient le budget.
   */
  priority?: number
}

/** Ce que le moteur a fait d'un bloc : gardé entier, coupé, remplacé par son `fallback`, omis. */
export type BlockStatus = "full" | "cut" | "replaced" | "omitted"

/**
 * Une ligne du rapport (E03-S08, AC8) : `chars` = caractères du bloc tel qu'inclus, 0 s'il est omis ;
 * `head` = la part de sa tête incluse (E05-S12, AC-4), 0 pour un bloc sans tête. `renderContext` le pose
 * toujours ; optionnel au type pour les doublures d'écran écrites avant lui (HN-E05S12-A1).
 */
export type BlockReport = { name: string; chars: number; status: BlockStatus; path: string | null; head?: number }

/** Le début de `text` qui tient en `max` caractères, coupé à une fin de ligne ; `""` si rien ne tient. */
function linesThatFit(text: string, max: number): string {
  if (text.length <= max) return text
  if (max <= 0) return ""
  const end = text.lastIndexOf("\n", max)
  return end === -1 ? "" : text.slice(0, end)
}

/** Le texte sans un bloc clôturé resté ouvert à sa fin : la coupe recule avant son ouverture (E03-S08, AC1). */
function beforeOpenFence(text: string): string {
  let open: { fence: string; at: number } | null = null
  let at = 0
  for (const line of text.split("\n")) {
    const run = /^`{3,}/.exec(line)?.[0]
    if (open === null && run !== undefined) open = { fence: run, at }
    else if (open !== null && line.trimEnd() === open.fence) open = null
    at += line.length + 1
  }
  return open === null ? text : text.slice(0, open.at)
}

/** La fin commune des deux pointeurs d'un Contexte servi en partie (E11-S03, AC-b2, AC-b4) : `Read the rest: <p>_read {"path": …}.` */
export function readRest(prefix: string, path: string): string {
  return `${CONTEXT_INDEX.readRest} ${prefix}_read {"path": "${path}"}.`
}

/**
 * Une partie de Contexte au corps servi, coupée par le plafond (E11-S03, AC-b4, HN-E11S03-14) : à la dernière
 * ligne entière qui tient avec son pointeur (`max` le compte), jamais dans un bloc clôturé resté ouvert, puis
 * le pointeur, qui remplace celui de ses listes. `""` quand même sa tête ne tient pas : la partie est omise.
 */
function cutContextPart(block: ContextBlock & { path: string }, max: number, budget: number, prefix: string): string {
  const pointer = `${CONTEXT_INDEX.bodyCut}${formatCount(budget)} characters. ${readRest(prefix, block.path)}`
  const kept = beforeOpenFence(linesThatFit(block.text, max - pointer.length - 1)).trimEnd()
  return kept.length < (block.head ?? 0) || kept === "" ? "" : `${kept}\n${pointer}`
}

/**
 * L'instant d'il y a `days` jours (ISO) : la borne des lectures datées des blocs (E03-S08 : nouveautés
 * sans conversation antérieure, usage des procédures utiles, documents récents).
 */
export function daysAgo(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString()
}

/** La ligne finale, dans sa réserve : au-delà, les derniers noms sont comptés (« and 3 more »). */
function budgetNotice(omitted: string[], prefix: string): string {
  const notice = (list: string) =>
    `\n\n${SERVED_BUDGET.start}${list}${SERVED_BUDGET.end}${prefix}_find or ${prefix}_read for more.]`
  let text = notice(omitted.join(", "))
  for (let kept = omitted.length - 1; text.length > NOTICE_RESERVE && kept > 0; kept -= 1) {
    text = notice(`${omitted.slice(0, kept).join(", ")}${SERVED_BUDGET.moreStart}${omitted.length - kept}${SERVED_BUDGET.moreEnd}`)
  }
  return text
}

/**
 * Le rapport d'un texte reculé à `kept` caractères (une ligne finale plus longue que sa réserve) :
 * chaque bloc inclus garde la part qui en reste, les blocs étant séparés par une ligne vide.
 */
function recededReport(report: BlockReport[], kept: number): BlockReport[] {
  let start = 0
  return report.map((entry) => {
    if (entry.chars === 0) return entry
    const chars = Math.max(0, Math.min(entry.chars, kept - start))
    start += entry.chars + 2
    if (chars === entry.chars) return entry
    return { ...entry, chars, status: chars === 0 ? "omitted" : "cut", head: Math.min(entry.head ?? 0, chars) }
  })
}

/** Ce qu'un bloc devient dans le budget : son texte inclus (`""` s'il est omis) et son statut. */
type Placement = { text: string; status: BlockStatus }

/**
 * Le budget réparti dans l'ordre de `priority` (l'ordre d'affichage à défaut), chaque bloc compté avec sa ligne vide :
 * un bloc qui tient entre entier ; sinon son `fallback` s'il en a un et qu'il tient, sinon il est omis avec ceux qui le
 * suivent en priorité ; un bloc sans `fallback` est coupé à la dernière ligne qui tient, ceux qui le suivent omis.
 */
function placements(blocks: readonly ContextBlock[], budget: number, prefix: string): Placement[] {
  const room = budget - NOTICE_RESERVE
  const order = blocks.map((block, rank) => ({ block, rank })).sort((a, b) => (a.block.priority ?? a.rank) - (b.block.priority ?? b.rank) || a.rank - b.rank)
  const placed: Placement[] = blocks.map(() => ({ text: "", status: "omitted" }))
  let used = 0
  let stopped = false
  for (const { block, rank } of order) {
    if (stopped) continue
    const separator = used > 0 ? 2 : 0
    if (used + separator + block.text.length <= room) {
      placed[rank] = { text: block.text, status: block.cut ? "cut" : "full" }
      used += separator + block.text.length
      continue
    }
    if (block.fallback !== undefined) {
      if (used + separator + block.fallback.length <= room) {
        placed[rank] = { text: block.fallback, status: "replaced" }
        used += separator + block.fallback.length
      } else stopped = true
      continue
    }
    const max = room - used - separator
    const partial = block.path === undefined ? linesThatFit(block.text, max) : cutContextPart({ ...block, path: block.path }, max, budget, prefix)
    if (partial.trim()) placed[rank] = { text: partial, status: "cut" }
    stopped = true
  }
  return placed
}

/**
 * Assemble les blocs dans l'ordre d'affichage, séparés par une ligne vide, ceux que le budget garde (`placements`) :
 * entiers, remplacés par leur `fallback`, ou coupés à la dernière ligne qui tient ; une dernière ligne nomme ceux qui
 * sont coupés ou omis (« <nom> (cut) » pour le bloc coupé) ; une partie de Contexte au corps servi finit par son
 * pointeur (`cutContextPart`, E11-S03 AC-b4). Le texte fait au plus `budget`. Le rapport dit, pour chaque bloc non
 * vide, sa taille incluse et ce qu'il est devenu (E03-S08, AC8) : l'aperçu d'E05-S04 le montre.
 */
export function renderContext(blocks: ContextBlock[], budget: number, prefix: string): { text: string; report: BlockReport[] } {
  const shown = blocks.filter((candidate) => candidate.text.trim() !== "")
  const placed = placements(shown, budget, prefix)
  const omitted: string[] = []
  const report: BlockReport[] = []
  const parts: string[] = []
  shown.forEach((block, rank) => {
    const { text: part, status } = placed[rank]
    if (part.trim()) parts.push(part)
    if (status === "omitted") omitted.push(block.name)
    // Un bloc déjà arrêté à sa borne en lignes (`cut`) et servi entier n'est pas coupé par le budget.
    else if (status === "cut" && part !== block.text) omitted.push(`${block.name}${SERVED_BUDGET.cut}`)
    report.push({ name: block.name, chars: part.trim() ? part.length : 0, status, path: block.path ?? null, head: Math.min(block.head ?? 0, part.trim() ? part.length : 0) })
  })
  const text = parts.join("\n\n")

  if (omitted.length === 0) return { text, report }
  const notice = budgetNotice(omitted, prefix)
  // Un seul nom plus long que la réserve la dépasserait encore : le texte recule d'autant.
  const kept = linesThatFit(text, budget - notice.length)
  return { text: kept + notice, report: kept.length < text.length ? recededReport(report, kept.length) : report }
}
