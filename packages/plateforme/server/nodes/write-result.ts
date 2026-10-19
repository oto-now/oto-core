// Ce que `write` écrit dans `nodes` et ce qu'il répond (E03-S03, AC19, AC25, AC27 à AC29, AC37) : la
// création d'un nœud, la provenance d'un bloc écrit selon la porte, le texte et les données de la
// réponse (références des blocs neufs connues après leur écriture). Fichier à part de `write.ts` pour la
// borne de 300 lignes (`coding-standards.md § Complexité`).
import type { AccessLevel } from "../access"
import type { PlatformDb } from "../db"
import { boundedList, fromDatabaseError, isUniqueViolation, PlatformError } from "../errors"
import type { Identity } from "../identity"
import type { ToolOutput } from "../tool-output"
import { displayRefs } from "./document"
import { TOUCHED_BLOCKS_MAX } from "./limits"
import { NODE_COLUMNS, notAvailable, type NodeRow } from "./lookup"
import { plural, type OpState, type Touched, type WorkBlock } from "./op-kit"
import type { PublishResult } from "./publish"

/**
 * La porte d'une écriture (AC28) : le MCP, avec le code `ctx` de la conversation, ou l'écran (API). `file` : un `.md`
 * déposé par lien (E10-S02 lot f, AC-f7, AC-f8), écrit sous la provenance de l'assistant et le `ctx` de son ticket ; posé
 * par le seul service du dépôt (`server/uploads-write.ts`), jamais par une porte.
 */
/** `places` : la porte d'un assistant quand l'hôte déclare des personnes, pour `find` de `replace_text` (`OpState`). */
export type WriteOrigin = { kind: "agent"; ctx: string | null; file?: { replace: boolean }; places?: OpState["places"] } | { kind: "human" }

/**
 * Un brouillon écrit : ses blocs (ids posés), son tampon, ce que chaque opération a touché, l'en-tête
 * écrit ; `headerChange`, ce que l'écriture change à l'en-tête d'un tableau (E07-S04, AC3).
 */
export type Saved = {
  blocks: WorkBlock[]
  stamp: string | null
  touched: Touched[]
  header: { title?: string; summary?: string; kind?: string } | null
  headerChange?: string
  /** Les constructions gardées en texte par le mode tolérant (E10-S01, AC-a2) ; 0 en mode strict. */
  keptAsText?: number
}

/**
 * La provenance d'un bloc écrit (N20) : `{origin: "agent", by, ctx, at}` par le MCP (même forme que la
 * provenance d'une cellule écrite par `table.write`, E07-S02), `{origin: "human", by, at}` par l'API.
 */
export function provenanceOf(identity: Identity, origin: WriteOrigin): Record<string, unknown> {
  const at = new Date().toISOString()
  return origin.kind === "agent" ? { origin: "agent", by: identity.user.id, ctx: origin.ctx, at } : { origin: "human", by: identity.user.id, at }
}

/**
 * Les colonnes de `NODE_COLUMNS` pour la face SQL (E01-S10), identifiants de `sql(…)` pris dans cette
 * liste fermée ; `NODE_COLUMNS` (`lookup.ts`, lot b1) reste la liste PostgREST qu'on lit encore ailleurs.
 */
const NODE_SQL_COLUMNS = NODE_COLUMNS.split(", ")

/**
 * Le nœud neuf (AC19) : brouillon à la révision 0, propriétaire hérité (colonnes nulles, H52),
 * `sections` et `draft` jamais écrits. Violation d'unicité (course, nœud que la RLS de niveau cache
 * encore, ou ancien chemin d'un autre nœud depuis M02) → le refus « not available » (N31) ; `23503` →
 * le parent a disparu. La ligne rendue est celle que rendait PostgREST (`to_json` : dates en texte, à la
 * microseconde), les colonnes de `NODE_COLUMNS`.
 */
export async function insertNode(
  db: PlatformDb,
  identity: Identity,
  spec: { path: string; parent: NodeRow; kind: string; title: string; summary: string },
): Promise<NodeRow> {
  const node = {
    org_id: identity.org.id,
    parent_id: spec.parent.id,
    path: spec.path,
    kind: spec.kind,
    title: spec.title,
    summary: spec.summary,
    created_by: identity.user.id,
    updated_by: identity.user.id,
  }
  const [inserted] = await db
    .tx((sql) => sql<{ node: NodeRow }[]>`
      insert into platform.nodes ${sql(node)}
      returning (select to_json(r) from (select ${sql(NODE_SQL_COLUMNS)}) r) as node`)
    .catch((error: { code?: string }) => {
      if (isUniqueViolation(error)) throw notAvailable(spec.path)
      if (error.code === "23503") throw new PlatformError("not_found", `Cannot create ${spec.path}: its parent ${spec.parent.path} does not exist.`)
      throw fromDatabaseError(error, "nodes: insert")
    })
  if (!inserted) throw new PlatformError("internal", "Internal error.")
  return inserted.node
}

function headerFragments(header: Saved["header"]): string[] {
  if (!header) return []
  return [
    ...(header.title === undefined ? [] : [`title « ${header.title} »`]),
    ...(header.summary === undefined ? [] : [`summary « ${header.summary} »`]),
    ...(header.kind === undefined ? [] : [`kind « ${header.kind} »`]),
  ]
}

type ResultInput = {
  identity: Identity
  edit: { node: NodeRow; level: AccessLevel; created: boolean }
  saved: Saved | null
  published: PublishResult | null
  teamId: string | null
}

/**
 * Ce qu'un Contexte publié change pour les conversations qui l'ont reçu (E11-S03, AC-a7) ; `own` : le `ctx` de l'appel
 * a suivi la publication (E11-S18, AC-14) ; les autres le reçoivent, avec un nouveau code, en tête de leur appel suivant.
 */
export function contextChangedLine(prefix: string, path: string, own: boolean): string {
  return own
    ? `Context ${path} changed: every other conversation it was served to gets it, with a new ctx, on its next call; this one keeps its ctx.`
    : `Context ${path} changed: every conversation it was served to gets it, with a new ctx, on its next call, this one included if it was.`
}

/**
 * La ligne d'une publication (E11-S18, AC-4) : la révision publiée, ses comptes, puis ce que l'écriture a fait (`done`),
 * et la révision de la prochaine écriture ; un tableau dit ce que sa publication a changé à son en-tête.
 */
function publishedLines(input: ResultInput, published: PublishResult, done: readonly string[]): string[] {
  const { node } = input.edit
  const counts = `${published.sections} ${plural(published.sections, "section")}, ${published.blocks} ${plural(published.blocks, "block")}`
  // Un tableau dit ce que sa publication a changé à son en-tête (E07-S04, AC1, AC8). La révision de la
  // prochaine écriture suit : `write` publiant par défaut, l'assistant la reprend (E11-S02, HN-E11S02-27).
  const parts = [...done, ...(node.kind === "table" && published.table?.summary ? [published.table.summary] : [])]
  const what = parts.length > 0 ? `: ${parts.join(", ")}` : ""
  const next = `Next write: base_revision ${published.revision}.`
  return [
    node.kind === "table"
      ? `Published ${node.path} revision ${published.revision}${what}. ${next}`
      : `Published ${node.path} revision ${published.revision} (${counts})${what}. ${next}`,
    // Seules les conversations qui ont reçu ce Contexte périment (E11-S03, AC-a7), son auteur excepté (E11-S18, AC-14).
    ...(published.rulesChanged ? [contextChangedLine(input.identity.org.prefix, node.path, false)] : []),
    // Ce que la publication signale (E03-S07 AC2, AC12) : 20 lignes au plus, puis leur nombre restant.
    ...(published.warnings.length > 0 ? ["Warnings:", boundedList(published.warnings.map((warning) => `- ${warning}`), "\n")] : []),
  ]
}

/**
 * La réponse de `write` (AC19, AC25, AC27, AC29) : ce que le brouillon a reçu, puis la publication ou
 * comment publier (dès le niveau écriture, E11-S02) ; en champs, les blocs écrits de chaque opération (`id`, référence, révision ; 20 au plus)
 * et le tampon du brouillon (AC37).
 */
export function savedResult(input: ResultInput): ToolOutput {
  const { identity, edit, saved, published } = input
  const { node } = edit
  const prefix = identity.org.prefix
  const refs = displayRefs(saved?.blocks ?? [])
  const byUid = new Map((saved?.blocks ?? []).map((block) => [block.uid, block]))
  const refOf = (uid: number) => {
    const block = byUid.get(uid)
    return block ? (refs.get(block) ?? "new") : "?"
  }
  const lines: string[] = []
  // Un tableau publié dans l'appel : la ligne de publication dit ce que l'en-tête change (E07-S04, AC1), à la place
  // de ce que le brouillon en a reçu.
  const tablePublished = published !== null && node.kind === "table"
  const change = saved?.headerChange && !tablePublished ? [saved.headerChange] : []
  const fragments = saved ? [...saved.touched.map((touched) => touched.describe(refOf)), ...headerFragments(saved.header), ...change] : []
  // Une écriture publiée se dit en une ligne, sans brouillon (E11-S18, AC-4) ; `publish: false` garde les deux.
  if (published) lines.push(...publishedLines(input, published, fragments))
  else {
    if (saved) {
      const what = fragments.length > 0 ? fragments.join(", ") : "no content yet"
      lines.push(edit.created ? `Draft of ${node.path} created (revision 0): ${what}.` : `Draft of ${node.path} saved on revision ${node.revision}: ${what}.`)
    }
    lines.push(`Publish it with ${prefix}_write {"path": "${node.path}", "base_revision": ${node.revision}, "publish": true}.`)
  }
  const touched = (saved?.touched ?? []).map((one) => ({
    op: one.op,
    text: one.describe(refOf),
    blocks: one.uids
      .flatMap((uid) => {
        const block = byUid.get(uid)
        return block?.id ? [{ id: block.id, ref: refs.get(block) ?? block.id, revision: block.revision }] : []
      })
      .slice(0, TOUCHED_BLOCKS_MAX),
  }))
  const data = published
    ? {
        path: node.path,
        revision: published.revision,
        status: "published",
        has_draft: false,
        touched,
        blocks_total: published.blocks,
        draft_stamp: null,
        rules_changed: published.rulesChanged,
        // Les avertissements d'un en-tête de tableau publié, en champs (E07-S04, AC6).
        ...(published.table ? { warnings: published.table.warnings } : {}),
      }
    : { path: node.path, revision: node.revision, status: node.status, has_draft: true, touched, blocks_total: saved?.blocks.length ?? 0, draft_stamp: saved?.stamp ?? null }
  // Le compte du mode tolérant (E10-S01, AC-a2), pour l'écran seul : en mode strict, les champs de `write` ne changent pas.
  const kept = saved?.keptAsText ? { kept_as_text: saved.keptAsText } : {}
  return { text: lines.join("\n"), data: { ...data, ...kept }, nextActions: [`${prefix}_read`], target: node.path, teamId: input.teamId }
}
