// L'historique des versions d'un contenu (tiroir « Historique des versions » de l'écran) : les versions publiées, lues
// dans leurs instantanés (`node_versions`), de la plus récente à la plus ancienne, avec qui ; l'écart
// d'une version à la précédente gardée ; et le retour à une version, publié comme une révision de plus (`restore.ts`).
// La lecture est décidée avant toute requête (`findTarget`, niveau 1 : `security-patterns.md § Droits dans le service`).
// Les lignes d'un tableau n'ont pas d'historique : ses instantanés ne gardent que son en-tête. Sans lui, personne ne voit
// ce qui a changé d'une version à l'autre, ni qui l'a changé.
import { sectionOfBlock } from "../../schemas"
import {
  HISTORY_DIFF_BLOCKS_MAX,
  HISTORY_PAGE_SIZE,
  nodeHistoryDiffQuerySchema,
  nodeHistoryQuerySchema,
  type HistoryBlockChange,
  type HistoryEntry,
  type HistoryHeaderChange,
  type HistorySummary,
  type NodeHistoryDiffView,
  type NodeHistoryView,
} from "../../schemas/node-history"
import { ACCESS_LEVELS } from "../access"
import type { Json } from "../database"
import type { PlatformDb } from "../db"
import { inTransaction, invalidInput, PlatformError } from "../errors"
import type { Identity } from "../identity"
import { diffBlocks } from "./diff"
import { blockMarkdown, type DocBlock } from "./document"
import { findTarget, type NodeRow } from "./lookup"
import { snapshotBlocks } from "./store"
import { kindOf, memberNames } from "./view"

/** Une version publiée, lue dans son instantané. */
export type Snapshot = { revision: number; at: string; author: string | null; title: string; summary: string; kind: string; meta: Json; blocks: DocBlock[] }

type SnapshotRecord = Omit<Snapshot, "blocks"> & { blocks: Json }

/** Les instantanés de ces révisions, par révision ; une révision absente n'y est pas. */
export async function loadSnapshots(db: PlatformDb, nodeId: string, revisions: readonly number[]): Promise<Map<number, Snapshot>> {
  if (revisions.length === 0) return new Map()
  const rows = await inTransaction(db, "node_versions: history", (sql) => sql<SnapshotRecord[]>`
    select revision, to_json(created_at) #>> '{}' as at, author, title, summary, kind, meta, blocks
      from platform.node_versions where node_id = ${nodeId} and revision in ${sql([...revisions])}`)
  return new Map(rows.map((row) => [row.revision, { ...row, blocks: snapshotBlocks(row.blocks) }]))
}

/** La révision gardée juste avant `revision`, ou `null`. */
async function previousRevision(db: PlatformDb, nodeId: string, revision: number): Promise<number | null> {
  const [row] = await inTransaction(db, "node_versions: previous", (sql) => sql<{ revision: number }[]>`
    select revision from platform.node_versions where node_id = ${nodeId} and revision < ${revision} order by revision desc limit 1`)
  return row?.revision ?? null
}

/** Le nœud lu par l'appelant, décidé avant toute lecture de ses versions ; un nœud invisible est inconnu (H68). */
export async function readableNode(db: PlatformDb, identity: Identity, path: string) {
  return findTarget(db, identity, { path })
}

/** Un tableau n'a pas de blocs : « Ce bloc » ne s'y lit pas. */
function checkBlockScope(node: NodeRow, block: string | undefined): void {
  if (block !== undefined && node.kind === "table") throw new PlatformError("invalid_arguments", `${node.path} is a table: its versions have no blocks.`)
}

/** Le même JSON (lu en `jsonb`, clés déjà ordonnées par la base). */
function sameJson(a: Json, b: Json): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** Une seule section ajoutée ou retirée, et rien d'autre : son titre. */
function lonelySection(added: readonly DocBlock[], deleted: readonly DocBlock[], others: number): HistorySummary["section"] {
  if (others > 0 || (added.length > 0) === (deleted.length > 0)) return null
  const blocks = added.length > 0 ? added : deleted
  const headings = blocks.filter((block) => block.type === "heading")
  if (headings.length !== 1 || blocks[0] !== headings[0]) return null
  return { title: headings[0].text ?? "", change: added.length > 0 ? "added" : "deleted" }
}

/** Ce que `after` a changé depuis `before` (la version gardée juste avant, `null` pour la première). */
export function summaryOf(before: Snapshot | null, after: Snapshot): HistorySummary {
  const none = { title: false, summary: false, kind: false, schema: false, added: 0, changed: 0, moved: 0, deleted: 0, section: null }
  if (!before) return { created: true, ...none }
  const { changes, deleted } = diffBlocks(before.blocks, after.blocks)
  const added = changes.filter((change) => change.kind === "added").map((change) => change.block)
  const changed = changes.filter((change) => change.kind === "changed").length
  const moved = changes.filter((change) => change.kind === "moved").length
  return {
    created: false,
    title: before.title !== after.title,
    summary: before.summary !== after.summary,
    kind: before.kind !== after.kind,
    schema: after.kind === "table" && !sameJson(before.meta, after.meta),
    added: added.length,
    changed,
    moved,
    deleted: deleted.length,
    section: lonelySection(added, deleted, changed + moved),
  }
}

/** La révision d'un bloc dans chaque version, de la plus ancienne à la plus récente (`null` : il n'y est pas). */
async function blockRevisions(db: PlatformDb, nodeId: string, blockId: string): Promise<{ revision: number; block: number | null }[]> {
  return inTransaction(db, "node_versions: block history", (sql) => sql<{ revision: number; block: number | null }[]>`
    select v.revision,
           (select (e ->> 'revision')::int from jsonb_array_elements(v.blocks) e where e ->> 'id' = ${blockId} limit 1) as block
      from platform.node_versions v where v.node_id = ${nodeId} order by v.revision`)
}

/** Les révisions d'une page de la liste, et la précédente gardée de chacune : toutes, ou celles où le bloc a changé. */
async function listedRevisions(db: PlatformDb, nodeId: string, request: { block?: string; cursor?: number }): Promise<{ listed: number[]; previous: Map<number, number | null>; more: boolean }> {
  const { block, cursor } = request
  if (block === undefined) {
    const rows = await inTransaction(db, "node_versions: page", (sql) => sql<{ revision: number }[]>`
      select revision from platform.node_versions
       where node_id = ${nodeId} and (${cursor ?? null}::int is null or revision < ${cursor ?? null}::int)
       order by revision desc limit ${HISTORY_PAGE_SIZE + 1}`)
    const revisions = rows.map((row) => row.revision)
    const listed = revisions.slice(0, HISTORY_PAGE_SIZE)
    return { listed, previous: new Map(listed.map((revision, rank) => [revision, revisions[rank + 1] ?? null])), more: revisions.length > HISTORY_PAGE_SIZE }
  }
  const rows = await blockRevisions(db, nodeId, block)
  const previous = new Map(rows.map((row, rank) => [row.revision, rank > 0 ? rows[rank - 1].revision : null]))
  const changed = rows.filter((row, rank) => row.block !== (rank > 0 ? rows[rank - 1].block : null)).map((row) => row.revision)
  const after = changed.reverse().filter((revision) => cursor === undefined || revision < cursor)
  return { listed: after.slice(0, HISTORY_PAGE_SIZE), previous, more: after.length > HISTORY_PAGE_SIZE }
}

/**
 * `GET nodes/history` : les versions publiées d'un contenu, de la plus récente à la plus ancienne, 20 par page ;
 * `block` : celles où ce bloc a changé (créé, modifié, retiré) ; `cursor` : la page sous cette révision.
 */
export async function nodeHistory(db: PlatformDb, identity: Identity, input: unknown): Promise<NodeHistoryView> {
  const parsed = nodeHistoryQuerySchema.safeParse(input)
  if (!parsed.success) throw invalidInput(parsed.error)
  const { node, level } = await readableNode(db, identity, parsed.data.path)
  checkBlockScope(node, parsed.data.block)
  const { listed, previous, more } = await listedRevisions(db, node.id, parsed.data)
  const wanted = [...new Set(listed.flatMap((revision) => [revision, previous.get(revision) ?? null]).filter((revision) => revision !== null))]
  const [snapshots, names] = await Promise.all([loadSnapshots(db, node.id, wanted), memberNames(db, identity.org.id)])
  const entries = listed.flatMap((revision): HistoryEntry[] => {
    const after = snapshots.get(revision)
    if (!after) return []
    const before = snapshots.get(previous.get(revision) ?? 0) ?? null
    const name = after.author === null ? undefined : names.get(after.author)
    return [{ revision, at: after.at, author: name === undefined ? null : { name }, summary: summaryOf(before, after) }]
  })
  return { path: node.path, kind: kindOf(node.kind), revision: node.revision, writable: level >= ACCESS_LEVELS.write, entries, next: more ? (listed.at(-1) ?? null) : null }
}

/** Les champs de l'en-tête qui ont changé, avant et après. */
function headerChanges(before: Snapshot, after: Snapshot): NodeHistoryDiffView["header"] {
  const fields = ["title", "summary", "kind"] as const
  return Object.fromEntries(
    fields.flatMap((field): [string, HistoryHeaderChange][] => (before[field] === after[field] ? [] : [[field, { before: before[field], after: after[field] }]])),
  )
}

/** Les blocs changés de `before` à `after`, dans l'ordre d'arrivée, puis les retirés. */
function blockChanges(before: readonly DocBlock[], after: readonly DocBlock[]): HistoryBlockChange[] {
  const { changes, deleted } = diffBlocks(before, after)
  const old = new Map(before.flatMap((block) => (block.id ? [[block.id, block] as const] : [])))
  const kept = changes.flatMap(({ kind, block }): HistoryBlockChange[] => {
    if (block.id === null) return []
    const was = old.get(block.id)
    return [{ id: block.id, change: kind, section: sectionOfBlock(after, block.id), before: was ? blockMarkdown(was) : null, after: blockMarkdown(block) }]
  })
  const gone = deleted.flatMap((block): HistoryBlockChange[] =>
    block.id === null ? [] : [{ id: block.id, change: "deleted", section: sectionOfBlock(before, block.id), before: blockMarkdown(block), after: null }],
  )
  return [...kept, ...gone]
}

/**
 * `GET nodes/history/diff` : ce qu'une version a changé depuis la précédente gardée, bloc par bloc (texte d'avant et
 * d'après) et en-tête ; `block` : ce seul bloc. Une révision inconnue est refusée en le disant.
 */
export async function nodeHistoryDiff(db: PlatformDb, identity: Identity, input: unknown): Promise<NodeHistoryDiffView> {
  const parsed = nodeHistoryDiffQuerySchema.safeParse(input)
  if (!parsed.success) throw invalidInput(parsed.error)
  const { revision, block } = parsed.data
  const { node } = await readableNode(db, identity, parsed.data.path)
  checkBlockScope(node, block)
  const previous = await previousRevision(db, node.id, revision)
  const snapshots = await loadSnapshots(db, node.id, previous === null ? [revision] : [revision, previous])
  const after = snapshots.get(revision)
  if (!after) throw new PlatformError("not_found", `Unknown revision ${revision} of ${node.path}.`)
  const before = previous === null ? null : (snapshots.get(previous) ?? null)
  const all = blockChanges(before?.blocks ?? [], after.blocks).filter((change) => block === undefined || change.id === block)
  return {
    revision,
    previous,
    header: block === undefined && before ? headerChanges(before, after) : {},
    schema: block === undefined && before !== null && after.kind === "table" && !sameJson(before.meta, after.meta),
    blocks: all.slice(0, HISTORY_DIFF_BLOCKS_MAX),
    total: all.length,
  }
}
