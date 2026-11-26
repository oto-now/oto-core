// Mise en forme de `read` (E03-S03, AC4 à AC15) : en-tête, plan, écart depuis une révision, état servi
// par un refus de révision, curseur et coupe en parties sous 45 000 caractères. Fonctions pures, sans
// base. Nom distinct du rendu des blocs (M05) : ce module ne rend aucun bloc, il assemble. Sans lui,
// `read.ts` dépasse la borne de 300 lignes et la pagination n'est pas testable sans base.
//
// Repris de la maquette (`mcp-test/src/proto/services/read.ts` l. 38-44, 60-94 ; `context.ts`
// l. 34-61) : l'en-tête, le plan, les sections citées, la coupe à la ligne. Retiré : `canRead` par
// équipe (→ niveau de `access.ts`), l'écart par section (→ par bloc), les sections `{title, body}`.
import { renderBlock, renderBlocks, sectionOfBlock, splitSections, type RenderOptions } from "../../schemas"
import { ACCESS_LEVELS, type AccessLevel } from "../access"
import { serializedLength } from "../tool-output"
import { diffBlocks } from "./diff"
import { blockMarkdown, formatCount, HEADING_BASE, headingLevel, sectionSizes, type DocBlock } from "./document"
import { CHILDREN_SHOWN, LISTED_MAX } from "./limits"
import type { NodeRow } from "./lookup"
import type { DraftRow } from "./store"

/**
 * La date UTC d'un horodatage ISO de la base (`YYYY-MM-DD`), lu comme un instant : un décalage autre que
 * `+00:00` change le jour près de minuit (M32, HN-E01S10-b1-8). Un texte qui n'est pas un instant est rendu tel quel.
 */
export function day(iso: string): string {
  const instant = new Date(iso)
  return Number.isNaN(instant.getTime()) ? iso : instant.toISOString().slice(0, 10)
}

export type ChildLine = { path: string; title: string; summary: string; kind: string }

export type PendingDraft = { baseRevision: number; savedAt: string; title: string | null; summary: string | null; kind: string | null }

/** Le brouillon en attente que l'en-tête dit, tiré du brouillon lu (`loadDraft`) et de sa date ; ici pour la borne de `read.ts`. */
export function pendingOf(draft: (DraftRow & { savedAt: string }) | null): PendingDraft | null {
  return draft ? { baseRevision: draft.baseRevision, savedAt: draft.savedAt, title: draft.title, summary: draft.summary, kind: draft.kind } : null
}

export type HeaderInput = {
  node: NodeRow
  level: AccessLevel
  prefix: string
  /** La ligne `owner:` : « team Ventes (lead: Claire Morel) », « organisation Acme », « you (personal) »… */
  owner: string
  /** À qui demander de partager, déplacer ou supprimer (niveau 2) : la partie « à qui » d'`access.ts` (H68). */
  publisher: string | null
  parent: { path: string; title: string } | null
  children: ChildLine[]
  childrenTotal: number
  /** Le brouillon en attente, lu à partir du niveau 2 seulement (N35). */
  draft: PendingDraft | null
  draftMode: boolean
  /** La ligne « moved to » d'un nœud lu par un ancien chemin, en tête (E03-S07 AC7) ; `null` sinon. */
  moved: string | null
  /** `links in` et `links out`, après les enfants (E03-S07 AC4). */
  links: string[]
}

/** Rendu d'un bloc `reference` passé à `renderBlocks` (option de M05 ; E03-S07 : clôture puis ligne résolue en commentaire). */
export type ReferenceRender = NonNullable<RenderOptions["reference"]>

/** La ligne d'accès (E11-S02, AC-b4) : écrire publie ; la gestion garde le partage, le déplacement et la corbeille. */
function accessLine(level: AccessLevel, publisher: string | null): string {
  if (level >= ACCESS_LEVELS.manage) return "access: manage (write and publish, share, move, delete)"
  if (level === ACCESS_LEVELS.write) return `access: write (write and publish; sharing, moving and deleting are reserved to ${publisher ?? "its managers"})`
  return "access: read"
}

function childrenLines(input: HeaderInput): string[] {
  if (input.childrenTotal === 0) return ["children: none"]
  const lines = input.children.slice(0, CHILDREN_SHOWN).map((child) => `- ${child.path} (${child.kind}): ${child.summary}`)
  const more = input.childrenTotal - lines.length
  return [
    `children (${formatCount(input.childrenTotal)}):`,
    ...lines,
    ...(more > 0 ? [`- … and ${formatCount(more)} more: open a child or use ${input.prefix}_find.`] : []),
  ]
}

function draftLines(input: HeaderInput): string[] {
  const { draft } = input
  if (!draft) return []
  const pending = `draft: pending on revision ${draft.baseRevision} (saved ${day(draft.savedAt)})`
  if (!input.draftMode) return [`${pending}: read it with draft: true`]
  return [
    pending,
    ...(draft.title === null ? [] : [`pending title: ${draft.title}`]),
    ...(draft.summary === null ? [] : [`pending summary: ${draft.summary}`]),
    ...(draft.kind === null ? [] : [`pending kind: ${draft.kind}`]),
  ]
}

/**
 * L'en-tête de `read` (AC4) : titre, chemin, identifiant stable (`id`, qui ne change pas au déplacement : `read`, `write`
 * et `node.move` le prennent à la place du chemin), résumé, propriétaire, accès, parent, enfants, liens, brouillon.
 */
export function headerLines(input: HeaderInput): string[] {
  const { node } = input
  return [
    ...(input.moved === null ? [] : [input.moved]),
    `# ${node.title}`,
    `path: ${node.path} · ${node.kind} · ${node.status} · revision ${node.revision} · updated ${day(node.updated_at)}`,
    `id: ${node.id}`,
    `summary: ${node.summary}`,
    `owner: ${input.owner}`,
    accessLine(input.level, input.publisher),
    `parent: ${input.parent ? `${input.parent.path} — ${input.parent.title}` : "none"}`,
    ...childrenLines(input),
    ...input.links,
    ...draftLines(input),
  ]
}

export type OutlineEntry = { title: string; level: number; chars: number; blockId: string | null; ref: string | null }

/** Le plan d'un document : chaque titre, dans l'ordre, avec la taille de sa section (sans lignes de référence). */
export function outlineOf(blocks: readonly DocBlock[], refs: Map<DocBlock, string> | null): OutlineEntry[] {
  const sections = splitSections(blocks)
  const sizes = sectionSizes(blocks, sections)
  return sections.flatMap((section, index) => {
    const { heading } = section
    if (!heading) return []
    const level = headingLevel(heading) ?? 1
    return [{ title: heading.text ?? "", level, chars: sizes[index], blockId: heading.id, ref: refs?.get(heading) ?? null }]
  })
}

/** « - Hypothèses (1,020 characters) », indentée de deux espaces par niveau au-delà du premier (AC7, AC13). */
export function outlineLines(entries: readonly OutlineEntry[], withRefs: boolean): string[] {
  return entries.map((entry) => {
    const ref = withRefs && entry.ref ? `, ref ${entry.ref}` : ""
    return `${"  ".repeat(entry.level - 1)}- ${entry.title} (${formatCount(entry.chars)} characters${ref})`
  })
}

/**
 * « - (start of page, 240 characters) » quand des blocs précèdent le premier titre (E11-S03, AC-c3) : un bloc
 * mis en tête y reste visible ; ce n'est pas une section (compte, `data.outline` et plan de l'écran inchangés,
 * HN-E11S03-10). Aucune ligne sans eux.
 */
export function startOfPageLines(blocks: readonly DocBlock[]): string[] {
  const [start] = splitSections(blocks)
  const size = start.heading === null ? sectionSizes(blocks, [start])[0] : 0
  return size > 0 ? [`- (start of page, ${formatCount(size)} characters)`] : []
}

/** L'état d'un nœud servi par un refus de révision (AC21) : titre, révision, début de page, plan borné à 50 titres. */
export function staleState(node: NodeRow, blocks: readonly DocBlock[]): string {
  const entries = outlineOf(blocks, null)
  const lines = outlineLines(entries.slice(0, LISTED_MAX), false)
  const more = entries.length - lines.length
  return [
    `# ${node.title} (revision ${node.revision}, ${node.status})`,
    ...startOfPageLines(blocks),
    ...(lines.length > 0 ? lines : ["- (no section)"]),
    ...(more > 0 ? [`- … and ${formatCount(more)} more`] : []),
  ].join("\n")
}

/** Un état comparé par `since_revision` : ses blocs dans l'ordre, et son en-tête. */
export type Version = { blocks: DocBlock[]; title: string; summary: string; kind: string }

function headerChanges(before: Version | null, after: Version): string[] {
  if (!before) return []
  return [
    ...(before.title === after.title ? [] : [`Title changed: « ${before.title} » → « ${after.title} ».`]),
    ...(before.summary === after.summary ? [] : [`Summary changed: « ${before.summary} » → « ${after.summary} ».`]),
    ...(before.kind === after.kind ? [] : [`Kind changed: ${before.kind} → ${after.kind}.`]),
  ]
}

type ChangeLine = { kind: "added" | "changed" | "moved" | "deleted"; block: DocBlock }

/** Le rendu servi d'un bloc : `reference` pour un bloc `reference` (E03-S07), `fileRoute` pour un fichier joint (E10-S02, AC-d1). */
export type ServedRender = { reference: ReferenceRender; fileRoute?: string }

/**
 * Le markdown d'un bloc servi, un bloc `reference` rendu par `reference` (E03-S07) ; un fichier joint, sur la route
 * `fileRoute` (E10-S02, AC-d1).
 */
function servedMarkdown(block: DocBlock, { reference, fileRoute }: ServedRender): string {
  if (fileRoute !== undefined && (block.type === "file" || block.type === "image")) return renderBlock(block, { headingBase: HEADING_BASE, fileRoute })
  return block.type === "reference" ? renderBlock(block, { headingBase: HEADING_BASE, reference }) : blockMarkdown(block)
}

function changeLines(change: ChangeLine, refs: Map<DocBlock, string> | null, render: ServedRender): string[] {
  const ref = refs?.get(change.block)
  return [`(${change.kind}${ref ? `, ref ${ref}` : ""})`, servedMarkdown(change.block, render)]
}

/**
 * L'écart depuis une révision, au bloc (AC11, N24) : compte, changements d'en-tête, puis les blocs
 * ajoutés, changés et déplacés groupés par section (dans l'ordre du document d'arrivée, l'emplacement
 * lu par `sectionOfBlock` de M05), puis les supprimés, groupés par leur section d'origine. `before`
 * nul : depuis la création (`since_revision: 0`), tout est ajouté.
 */
export function diffLines(
  from: { revision: number; version: Version | null },
  to: { label: string; version: Version },
  refs: Map<DocBlock, string> | null,
  render: ServedRender,
): string[] {
  const before = from.version?.blocks ?? []
  const { changes, deleted } = diffBlocks(before, to.version.blocks)
  const header = headerChanges(from.version, to.version)
  if (changes.length === 0 && deleted.length === 0 && header.length === 0) {
    return [to.label === "the draft" ? `Revision ${from.revision} and the draft have the same content.` : `Revisions ${from.revision} and ${to.label} have the same content.`]
  }
  const count = (kind: string) => changes.filter((change) => change.kind === kind).length
  const lines = [
    `Changes from revision ${from.revision} to ${to.label} (${count("added")} added, ${count("changed")} changed, ${count("moved")} moved, ${deleted.length} deleted):`,
    ...header,
  ]
  let group: string | null | undefined
  for (const change of changes) {
    const section = change.block.id === null ? null : sectionOfBlock(to.version.blocks, change.block.id)
    if (section !== group) lines.push(section === null ? "At the start:" : `In « ${section} »:`)
    group = section
    lines.push(...changeLines(change, refs, render))
  }
  if (deleted.length > 0) lines.push("Deleted:")
  for (const block of deleted) {
    const section = block.id === null ? null : sectionOfBlock(before, block.id)
    lines.push(section === null ? "(from the start)" : `(from « ${section} »)`, servedMarkdown(block, render))
  }
  return lines
}

/**
 * Le markdown servi de blocs, avec la ligne `<!-- ref: … -->` avant chacun quand `refs` est donné
 * (M05), et chaque bloc `reference` rendu par `reference` (E03-S07 AC11) ; les fichiers joints sur la route
 * `fileRoute` (E10-S02, AC-d1).
 */
export function renderServed(blocks: readonly DocBlock[], refs: Map<DocBlock, string> | null, reference: ReferenceRender, fileRoute?: string): string {
  return renderBlocks(blocks, { headingBase: HEADING_BASE, refs: refs ? (block) => refs.get(block) ?? null : undefined, reference, fileRoute })
}

// ------------------------------------------------------------------------------------ Curseur

/** Ce que porte un curseur (N3) : le nœud, la requête, l'empreinte du texte complet et la partie servie. */
export type CursorPayload = { node: string; request: string; text: string; part: number }

/** Empreinte courte d'un texte (cyrb53) : un curseur ne sert que le texte d'où il vient. */
export function fingerprint(text: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index)
    h1 = Math.imul(h1 ^ code, 2654435761)
    h2 = Math.imul(h2 ^ code, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

/** Un jeton opaque (base64url d'un JSON court). */
export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify([payload.node, payload.request, payload.text, payload.part])).toString("base64url")
}

/** Le contenu d'un jeton, ou `null` s'il est illisible. */
export function decodeCursor(token: string): CursorPayload | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(token, "base64url").toString("utf8"))
    if (!Array.isArray(value) || value.length !== 4) return null
    const [node, request, text, part] = value
    if (typeof node !== "string" || typeof request !== "string" || typeof text !== "string") return null
    return Number.isInteger(part) && part >= 1 ? { node, request, text, part } : null
  } catch {
    // Un jeton illisible est refusé par l'appelant, comme un jeton qui ne correspond plus.
    return null
  }
}

/** Un texte coupé par point de code en morceaux dont chacun tient en `budget` caractères sérialisés. */
function cutLine(line: string, budget: number): string[] {
  const pieces: string[] = []
  let piece = ""
  let used = 0
  for (const char of line) {
    const cost = serializedLength(char)
    if (used + cost > budget && piece !== "") {
      pieces.push(piece)
      piece = ""
      used = 0
    }
    piece += char
    used += cost
  }
  return [...pieces, piece]
}

/**
 * Le texte en parties coupées à une fin de ligne (AC14), chacune sous son budget de caractères
 * sérialisés (la première peut avoir un autre budget que les suivantes) : jointes par un saut de
 * ligne, les parties redonnent le texte. Une ligne plus longue qu'un budget est coupée par point de
 * code : ses morceaux se rejoignent sans saut de ligne.
 */
export function cutPages(text: string, firstBudget: number, nextBudget: number): string[] {
  const parts: string[] = []
  let current: string[] = []
  let used = 0
  const budget = () => (parts.length === 0 ? firstBudget : nextBudget)
  const flush = () => {
    parts.push(current.join("\n"))
    current = []
    used = 0
  }
  for (const line of text.split("\n")) {
    const cost = serializedLength(line)
    if (current.length > 0 && used + 2 + cost > budget()) flush()
    if (cost > budget()) {
      const pieces = cutLine(line, budget())
      pieces.slice(0, -1).forEach((piece) => parts.push(piece))
      current = [pieces[pieces.length - 1]]
      used = serializedLength(current[0])
      continue
    }
    used += (current.length > 0 ? 2 : 0) + cost
    current.push(line)
  }
  parts.push(current.join("\n"))
  return parts
}
