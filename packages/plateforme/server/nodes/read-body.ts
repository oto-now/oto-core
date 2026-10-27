// Le corps de `read` selon le mode demandé (E03-S03, AC4 à AC13) : page entière, plan servi d'office
// au-delà de 12 000 caractères (jamais pour une procédure, servie entière), plan demandé, section par titre (homonymes compris), écart depuis une
// révision, et les lignes de fin (`To edit`, `Publish it`). Fonction pure sur les
// blocs déjà lus. Fichier à part de `read.ts` et de `read-format.ts` : ensemble, ils dépasseraient la
// borne de 300 lignes (`coding-standards.md § Complexité`).
import { findSections, splitSections, type ReadNodeInput } from "../../schemas"
import { ACCESS_LEVELS, type AccessLevel } from "../access"
import { PlatformError } from "../errors"
import { blocksSize, displayRefs, formatCount, type DocBlock } from "./document"
import { PAGE_FULL_MAX } from "./limits"
import type { NodeRow } from "./lookup"
import { plural, quotedList } from "./op-kit"
import { diffLines, outlineLines, outlineOf, renderServed, startOfPageLines, type ReferenceRender, type Version } from "./read-format"
import type { DraftRow } from "./store"

/**
 * Ce que `read` sert après l'en-tête : le corps (coupé en parties au besoin), les lignes de fin, les blocs lus ;
 * `outlined` (E11-S19, AC-e2) : le corps porte le plan, que les données ne redisent pas.
 */
export type Served = { body: string; footer: string[]; blocks: DocBlock[]; refs?: Map<DocBlock, string> | null; outlined?: true }

export type BodyRequest = {
  input: ReadNodeInput
  context: { node: NodeRow; level: AccessLevel }
  prefix: string
  draftMode: boolean
  blocks: DocBlock[]
  /** L'état de départ d'un écart (`since_revision`) ; `null` pour 0 ou sans écart. */
  since: Version | null
  draft: DraftRow | null
  /** Rendu des blocs `reference` : clôture et ligne résolue en commentaire (E03-S07 AC11). */
  reference: ReferenceRender
  /** La route des fichiers joints, sur l'origine de la requête (E10-S02, AC-d1) ; sans elle, relative. */
  fileRoute?: string
}

/** « {"path": "x", "section": "y"} » : les arguments d'un appel cité, dans l'ordre de l'entrée de `read`. */
export function callArguments(fields: Record<string, unknown>): string {
  const entries = Object.entries(fields).filter(([, value]) => value !== undefined)
  return `{${entries.map(([key, value]) => `"${key}": ${JSON.stringify(value)}`).join(", ")}}`
}

function footerOf(request: BodyRequest): string[] {
  const { node, level } = request.context
  if (level < ACCESS_LEVELS.write) return []
  const { prefix } = request
  const lines = [`To edit: ${prefix}_write {"path": "${node.path}", "base_revision": ${node.revision}, "ops": [...]}.`]
  // Dès le niveau écriture, qui publie (E11-S02, AC-b4).
  if (request.draftMode && request.draft) {
    lines.push(`Publish it with ${prefix}_write ${callArguments({ path: node.path, base_revision: node.revision, publish: true })}.`)
  }
  return lines
}

/** Le plan servi (AC7, AC8) : compte, une ligne par titre, puis comment lire une section. */
function outlineText(request: BodyRequest, refs: Map<DocBlock, string> | null, over: boolean): string {
  const { blocks, prefix, input } = request
  const entries = outlineOf(blocks, refs)
  const limit = over ? `, over the ${formatCount(PAGE_FULL_MAX)}-character page limit` : ""
  const flags = { draft: request.draftMode || undefined, refs: input.refs || undefined }
  return [
    `outline (${formatCount(entries.length)} ${plural(entries.length, "section")}, ${formatCount(blocksSize(blocks))} characters${limit}):`,
    ...startOfPageLines(blocks),
    ...outlineLines(entries, refs !== null),
    `Read one with ${prefix}_read ${callArguments({ path: request.context.node.path, ...flags, section: "<title>" })}.`,
  ].join("\n")
}

/** L'écart depuis une révision (AC11) : jusqu'au brouillon en mode brouillon, jusqu'à la révision courante sinon. */
function diffText(request: BodyRequest, refs: Map<DocBlock, string> | null): string {
  const { node } = request.context
  const since = request.input.since_revision ?? 0
  if (!request.draftMode && since === node.revision) return `No change since revision ${since}.`
  const header = request.draftMode
    ? { title: request.draft?.title ?? node.title, summary: request.draft?.summary ?? node.summary, kind: request.draft?.kind ?? node.kind }
    : { title: node.title, summary: node.summary, kind: node.kind }
  const to = { label: request.draftMode ? "the draft" : String(node.revision), version: { blocks: request.blocks, ...header } }
  return diffLines({ revision: since, version: request.since }, to, refs, { reference: request.reference, fileRoute: request.fileRoute }).join("\n")
}

/** Les sections d'un titre, toutes (N10), ou le refus qui liste les titres (AC9). */
function sectionText(request: BodyRequest, refs: Map<DocBlock, string> | null): string {
  const title = request.input.section ?? ""
  const sections = findSections(request.blocks, title)
  if (sections.length === 0) {
    const titles = splitSections(request.blocks).flatMap((section) => (section.heading ? [section.heading.text ?? ""] : []))
    const listed = titles.length > 0 ? quotedList(titles) : "none"
    throw new PlatformError("not_found", `Unknown section « ${title} » in ${request.context.node.path}. Sections: ${listed}.`)
  }
  return sections.map((section) => renderServed(section.blocks, refs, request.reference, request.fileRoute)).join("\n\n")
}

/**
 * Le corps de `read` pour le mode demandé (AC4 à AC13) ; les tailles et le seuil de 12 000 ignorent
 * les lignes de référence (N14). Une page sans titre est servie entière (N1).
 */
export function serveBody(request: BodyRequest): Served {
  const { input, blocks, draftMode } = request
  const { node } = request.context
  const refs = input.refs ? displayRefs(blocks) : null
  const footer = footerOf(request)
  const served = (body: string, withFooter = true): Served => ({ body, footer: withFooter ? footer : [], blocks, refs })
  if (input.since_revision !== undefined) return served(diffText(request, refs))
  if (!draftMode && node.revision === 0) return served("No published revision yet.")
  if (input.section !== undefined) return served(sectionText(request, refs))
  if (input.outline) return { ...served(outlineText(request, refs, false), false), outlined: true }
  const sections = splitSections(blocks)
  // Une procédure se sert entière, au-delà de 12 000 caractères aussi (2026-10-27) : ses étapes se suivent en entier,
  // `context` ne les sert plus ; seul le curseur de `read` la découpe au-delà de 45 000.
  const kind = (draftMode ? request.draft?.kind : null) ?? node.kind
  if (kind !== "procedure" && blocksSize(blocks) > PAGE_FULL_MAX && sections.length > 1) {
    const start = renderServed(sections[0].blocks, refs, request.reference, request.fileRoute)
    return { ...served([start, outlineText(request, refs, true)].filter((part) => part !== "").join("\n\n"), false), outlined: true }
  }
  return served(renderServed(blocks, refs, request.reference, request.fileRoute))
}
