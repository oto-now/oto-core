// `read` (E03-S03, AC4 à AC18) et le nœud complet des écrans (`loadNode`, AC35) : les blocs rendus en
// markdown par M05, en-tête, plan, section, écart depuis une révision, brouillon, références courtes,
// contrat d'une fonction, curseur au-delà de 45 000 caractères. Le niveau vient de `findNode`
// (`access.ts`) ; le brouillon ne se lit qu'à partir du niveau 2, décidé avant sa lecture (H123, N35).
// Sans lui, rien ne se lit.
import { FILES_ROUTE, type BlockView, type NodeView, type ReadNodeInput } from "../../schemas"
import { ACCESS_LEVELS, describeOwner, type AccessLevel } from "../access"
import { contractNames, getContract, renderContract } from "../catalog/contracts"
import { assistantFunctions, catalogNames, describeFunction, findFunction, isActive, looksLikeFunction } from "../catalog/registry"
import { loadActiveConnectors } from "../connectors/activations"
import type { Json } from "../database"
import type { PlatformDb } from "../db"
import { inTransaction, PlatformError } from "../errors"
import { functionCatalog, FUNCTIONS_PATH } from "../find"
import { helpGuide, HELP_PATH } from "../help"
import type { Identity } from "../identity"
import { readJournal } from "../journal-model"
import { JOURNAL_PATH } from "../../schemas/journal"
import { webUrl } from "../../schemas/oauth"
import { countRows } from "../tables/rows"
import { tableReadBody } from "../tables/schema"
import type { ToolOutput } from "../tool-output"
import { displayRefs, type DocBlock } from "./document"
import { OUTLINE_DATA_MAX, REFERENCES_DATA_MAX, REVISIONS_LISTED } from "./limits"
import { linkHeader } from "./link-lines"
import { checkNodePath, findNode, movedNotice, unknownNode, type NodeRow } from "./lookup"
import { serveBody, type Served } from "./read-body"
import { readNodeFile } from "./read-file"
import { headerLines, outlineOf, type PendingDraft, type Version } from "./read-format"
import { checkCursor, paginate } from "./read-pages"
import { withPageView } from "./read-view"
import { readReference, referenceLines, resolveReferences, type ResolvedReference } from "./references"
import { draftSavedAt, loadBlocks, loadDraft, snapshotBlocks, type DraftRow } from "./store"
import { familyOf, kindOf, memberNames, ownerOf, ownerTexts, ownerView, statusOf, teamOf, type Family } from "./view"

/**
 * Le contrat d'une fonction active : ses connecteurs actifs relus à l'appel (AC16, E04-S01 N9). Un nom
 * absent du catalogue est d'abord cherché parmi les contrats non appelables (`write.procedure`, E03-S06).
 */
async function readFunction(db: PlatformDb, identity: Identity, name: string): Promise<ToolOutput> {
  const prefix = identity.org.prefix
  const fn = findFunction(assistantFunctions(), name)
  const contract = fn ? null : getContract(name)
  if (contract) return { ...renderContract(contract, prefix), nextActions: [`${prefix}_write`], target: contract.name }
  if (!fn || !isActive(fn, await loadActiveConnectors(db, identity.org.id))) {
    throw new PlatformError("not_found", `Unknown function ${name}. Use ${prefix}_find with type function.`)
  }
  const { text, data } = describeFunction(fn, prefix)
  return { text, data, nextActions: [`${prefix}_call`], target: fn.name }
}

function checkRequest(input: ReadNodeInput, path: string): void {
  checkNodePath(path)
  const modes = [input.section !== undefined, input.outline === true, input.since_revision !== undefined].filter(Boolean)
  // `file` (E10-S02, AC-d2) : le texte d'un fichier seul, sans section, plan, écart ni brouillon.
  if (input.file !== undefined && (modes.length > 0 || input.draft === true)) {
    throw new PlatformError("invalid_arguments", "Give only one of section, outline, since_revision or file; file reads the text of a file, without draft.")
  }
  if (modes.length > 1) throw new PlatformError("invalid_arguments", "Give only one of section, outline or since_revision.")
}

/** Un tableau n'a pas de sections (texte de l'AC18 d'E07-S01, posé ici). */
function checkTable(input: ReadNodeInput, node: NodeRow, prefix: string): void {
  const modes = input.section !== undefined || input.outline === true || input.since_revision !== undefined || input.cursor !== undefined
  if (node.kind !== "table" || !modes) return
  throw new PlatformError(
    "invalid_arguments",
    `A table has no sections: read its rows with ${prefix}_call {"function": "table.rows", "arguments": {"table": "${node.path}"}}.`,
  )
}

/** Un état publié d'une révision, lu dans `node_versions` (clé `(node_id, revision)`) ; `null` si elle n'y est pas (AC11). */
async function versionOf(db: PlatformDb, node: NodeRow, revision: number): Promise<Version | null> {
  const [data] = await inTransaction(db, "node_versions: read", (sql) => sql<{ title: string; summary: string; kind: string; blocks: Json }[]>`
    select title, summary, kind, blocks from platform.node_versions where node_id = ${node.id} and revision = ${revision}`)
  if (!data) return null
  return { blocks: snapshotBlocks(data.blocks), title: data.title, summary: data.summary, kind: data.kind }
}

/** Les révisions connues d'un nœud, les 20 dernières, dans l'ordre (refus de l'AC11). */
async function knownRevisions(db: PlatformDb, nodeId: string): Promise<number[]> {
  const rows = await inTransaction(db, "node_versions: revisions", (sql) => sql<{ revision: number }[]>`
    select revision from platform.node_versions where node_id = ${nodeId} order by revision desc limit ${REVISIONS_LISTED}`)
  return rows.map((row) => row.revision).reverse()
}

/** La révision de départ d'un écart : l'état publié de `since`, `null` pour 0, ou le refus de l'AC11. */
async function sinceVersion(db: PlatformDb, node: NodeRow, since: number): Promise<Version | null> {
  if (since === 0) return null
  const version = since > node.revision ? null : await versionOf(db, node, since)
  if (version) return version
  const known = await knownRevisions(db, node.id)
  throw new PlatformError("not_found", `Unknown revision ${since} of ${node.path}. Revisions: ${known.length > 0 ? known.join(", ") : "none"}.`)
}

type Context = {
  node: NodeRow
  level: AccessLevel
  owner: { line: string; publisher: string | null; teamId: string | null }
  parent: { path: string; title: string } | null
  children: Pick<Family, "children" | "total">
  draft: (DraftRow & { savedAt: string }) | null
  /** Liens sortants et entrants de l'en-tête (E03-S07 AC4) ; ancien chemin par lequel le nœud a été lu (AC7). */
  links: Awaited<ReturnType<typeof linkHeader>>
  movedFrom: string | null
}

async function contextOf(db: PlatformDb, identity: Identity, found: NonNullable<Awaited<ReturnType<typeof findNode>>>): Promise<Context> {
  const { node, level } = found
  const writer = level >= ACCESS_LEVELS.write
  const [owner, { parent, ...children }, draft, links] = await Promise.all([
    ownerOf(db, node.id),
    familyOf(db, identity, node),
    // Le brouillon ne se lit qu'à partir du niveau 2, décidé ici avant toute lecture (N35, H123).
    writer ? loadDraft(db, node.id) : Promise.resolve(null),
    linkHeader(db, identity, node),
  ])
  const texts = await ownerTexts(db, identity, owner, level === ACCESS_LEVELS.write)
  const savedAt = draft ? await draftSavedAt(db, node.id, draft.stamp) : null
  return {
    node,
    level,
    owner: { ...texts, teamId: teamOf(owner) },
    parent,
    children,
    draft: draft && savedAt ? { ...draft, savedAt } : null,
    links,
    movedFrom: found.movedFrom,
  }
}

/**
 * La route des fichiers joints servie à un assistant (E10-S02, AC-d1, HN-E10S02-3) : sur l'origine de la requête, lue
 * par `webUrl` (`http:` ou `https:`, sans identifiants : `security-patterns.md § XSS Prevention`) ; relative sinon.
 */
function fileRouteOf(origin: string | undefined): string {
  const url = webUrl(origin)
  return url ? `${new URL(url).origin}${FILES_ROUTE}` : FILES_ROUTE
}

function pendingOf(draft: Context["draft"]): PendingDraft | null {
  return draft ? { baseRevision: draft.baseRevision, savedAt: draft.savedAt, title: draft.title, summary: draft.summary, kind: draft.kind } : null
}

/**
 * `read` (AC4 à AC18) : un nom de fonction sert son contrat ; `journal` sert le journal des appels
 * (E05-S05) ; `functions`, toutes les fonctions actives (E11-S19) ; `help`, le guide de la plateforme (1.4.3) ; un chemin sert l'en-tête du nœud et ses blocs rendus selon le mode demandé, coupés en
 * parties au-delà de 45 000 caractères. Un nœud invisible répond comme un chemin inconnu (H68).
 * `origin` (E10-S02, AC-d1) : l'origine de la requête MCP, qui rend absolue l'adresse d'un fichier joint ;
 * `file` (AC-d2) : le texte d'un fichier joint au nœud. `views` : les widgets sont allumés, une page servie
 * entière porte ses blocs et la vue `page` (`withPageView`).
 */
export async function readNode(db: PlatformDb, identity: Identity, input: ReadNodeInput, options: { origin?: string; views?: boolean } = {}): Promise<ToolOutput> {
  const prefix = identity.org.prefix
  const path = input.path.trim()
  if (looksLikeFunction(path)) return readFunction(db, identity, path)
  if (path === JOURNAL_PATH) return readJournal(db, identity, input)
  if (path === FUNCTIONS_PATH) {
    const active = await loadActiveConnectors(db, identity.org.id)
    return functionCatalog(assistantFunctions().filter((fn) => isActive(fn, active)), contractNames(), prefix)
  }
  // Le guide de la plateforme, servi par le paquet : son plan, ou la section demandée.
  if (path === HELP_PATH) return helpGuide(input.section, prefix)
  checkRequest(input, path)
  const found = await findNode(db, identity, path)
  if (!found) throw unknownNode(path, prefix)
  if (input.file !== undefined) {
    // Un curseur périmé est refusé avant la lecture de l'objet (AC14).
    checkCursor(input, found.node)
    return readNodeFile(db, identity, { input, file: input.file, node: found.node, prefix })
  }
  checkTable(input, found.node, prefix)
  checkCursor(input, found.node)
  if (input.draft && found.level < ACCESS_LEVELS.write) {
    const owner = await ownerOf(db, found.node.id)
    const who = owner ? await describeOwner(db, identity, owner) : "its writers"
    throw new PlatformError("forbidden", `Drafts of ${path} are shown to its writers: ${who}. Read the published revision without draft.`)
  }
  const context = await contextOf(db, identity, found)
  const draftMode = input.draft === true
  const header = headerLines({
    node: context.node,
    level: context.level,
    prefix,
    owner: context.owner.line,
    publisher: context.owner.publisher,
    parent: context.parent,
    children: context.children.children,
    childrenTotal: context.children.total,
    draft: pendingOf(context.draft),
    draftMode: draftMode && context.draft !== null,
    moved: found.movedFrom && found.movedAt ? movedNotice(found.movedFrom, found.node, found.movedAt) : null,
    links: context.links.lines,
  })
  const served = await servedOf(db, identity, { input, context, prefix, draftMode, fileRoute: fileRouteOf(options.origin) })
  const data = dataOf(context, served, input)
  const nextActions = context.level >= ACCESS_LEVELS.write ? [`${prefix}_write`] : []
  const output = paginate({ input, node: context.node, prefix, header: header.join("\n"), served, data, nextActions, teamId: context.owner.teamId })
  // Un tableau sert sa description, sans bloc : `served.blocks` est vide, aucune vue.
  return options.views ? withPageView(output, served, input) : output
}

type Body = Served & { references: ResolvedReference[] }

/**
 * Le corps servi : les blocs de l'état demandé, rendus selon le mode (`read-body.ts`) ; chaque bloc
 * `reference` rendu par sa clôture suivie de sa ligne résolue pour le lecteur, en commentaire (E03-S07
 * AC11), écart depuis une révision compris ; pour un tableau, sa description (`tableReadBody`, E07-S01
 * AC18), aucun bloc.
 */
async function servedOf(db: PlatformDb, identity: Identity, request: { input: ReadNodeInput; context: Context; prefix: string; draftMode: boolean; fileRoute: string }): Promise<Body> {
  const { input, context, draftMode } = request
  const { node } = context
  if (draftMode && !context.draft) return { body: `No pending draft on ${node.path}.`, footer: [], blocks: [], references: [] }
  if (node.kind === "table") {
    // Le brouillon d'un tableau : son en-tête en attente, lu au niveau 2 seulement (E07-S04, AC12).
    const draft = draftMode ? context.draft : null
    return { body: await tableReadBody(db, node, { prefix: request.prefix, functions: catalogNames(), draft }), footer: [], blocks: [], references: [] }
  }
  const state = draftMode ? "draft" : "published"
  const blocks = await loadBlocks(db, node.id, state)
  const since = input.since_revision === undefined ? null : await sinceVersion(db, node, input.since_revision)
  // Les blocs supprimés d'un écart ont leur ligne aussi ; un bloc gardé prend celle de son état courant.
  const current = new Set(blocks.flatMap((block) => (block.id === null ? [] : [block.id])))
  const deleted = (since?.blocks ?? []).filter((block) => block.id !== null && !current.has(block.id))
  // Les cibles déjà relues pour l'en-tête (liens sortants) ne le sont pas une seconde fois (E03-S07 N24).
  const resolved = await resolveReferences(db, identity, [...blocks, ...deleted], context.links.targets)
  const reference = readReference(referenceLines(resolved))
  const references = resolved.filter((one) => current.has(one.blockId))
  return { ...serveBody({ ...request, blocks, since, draft: context.draft, reference }), references }
}

/**
 * Les données en champs de `read`. Le plan (`outline`) n'y est pas quand une section est demandée ou que le texte le
 * porte déjà (E11-S19, AC-e1, AC-e2, HN-E11S19-9 ; `mcp-patterns.md § 4`) : `sections_total` reste.
 */
function dataOf(context: Context, served: Body, input: ReadNodeInput): Record<string, unknown> {
  const { node } = context
  const refs = served.refs ?? null
  const outline = outlineOf(served.blocks, refs)
  const outlineData = input.section !== undefined || served.outlined
    ? {}
    : { outline: outline.slice(0, OUTLINE_DATA_MAX).map((entry) => ({ title: entry.title, level: entry.level, chars: entry.chars, ...(refs ? { ref: entry.ref } : {}) })) }
  const references = served.references.slice(0, REFERENCES_DATA_MAX).map((one) => ({
    kind: one.kind,
    path: one.path,
    ...(one.title === undefined ? {} : { title: one.title }),
    status: one.status,
    ...(one.movedTo === undefined ? {} : { moved_to: one.movedTo }),
  }))
  return {
    ...(context.movedFrom === null ? {} : { moved_from: context.movedFrom }),
    path: node.path,
    title: node.title,
    summary: node.summary,
    kind: node.kind,
    status: node.status,
    revision: node.revision,
    updated_at: node.updated_at,
    owner: context.owner.line,
    level: context.level,
    parent: context.parent,
    children: context.children.children.map((child) => ({ path: child.path, title: child.title, kind: child.kind })),
    children_total: context.children.total,
    ...outlineData,
    sections_total: outline.length,
    blocks_total: served.blocks.length,
    has_draft: context.draft !== null,
    ...context.links.data,
    references,
  }
}

/** Un bloc tel que l'écran le lit : sa référence servie comprise (AC35). */
function blockViews(blocks: readonly DocBlock[]): BlockView[] {
  const refs = displayRefs(blocks)
  return blocks.flatMap((block) =>
    block.id === null
      ? []
      : [
          {
            id: block.id,
            ref: refs.get(block) ?? block.id,
            // Un bloc lu en base porte l'un des types de `blocks_type_check` (E01-S06), ceux de `BlockType`.
            type: block.type as BlockView["type"],
            text: block.text,
            data: block.data,
            key: block.key,
            position: block.position ?? 0,
            revision: block.revision,
            provenance: block.provenance,
          },
        ],
  )
}

/**
 * Le nœud complet pour l'écran (AC35) : tous les blocs publiés, sans plan servi ni plafond ; le
 * brouillon complet à partir du niveau 2 seulement, jamais lu en dessous ; mêmes refus que `read`.
 * Un tableau n'a pas de bloc de document : ses lignes sont comptées (E07-S03, AC1), jamais lues.
 */
export async function loadNode(db: PlatformDb, identity: Identity, request: { path: string }): Promise<NodeView> {
  return inTransaction(db, "nodes: load", () => loadNodeIn(db, identity, request))
}

async function loadNodeIn(db: PlatformDb, identity: Identity, request: { path: string }): Promise<NodeView> {
  const found = await findNode(db, identity, request.path)
  if (!found) throw new PlatformError("not_found", `Unknown path ${request.path}.`)
  const { node, level } = found
  const writer = level >= ACCESS_LEVELS.write
  const table = node.kind === "table"
  const [owner, names, { parent, ...children }, published, draft, rowsTotal] = await Promise.all([
    ownerOf(db, node.id),
    memberNames(db, identity.org.id),
    familyOf(db, identity, node),
    table ? Promise.resolve([]) : loadBlocks(db, node.id, "published"),
    writer ? loadDraft(db, node.id) : Promise.resolve(null),
    table ? countRows(db, node.id) : Promise.resolve(undefined),
  ])
  const draftBlocks = draft && !table ? await loadBlocks(db, node.id, "draft") : []
  const savedAt = draft ? await draftSavedAt(db, node.id, draft.stamp) : null
  return {
    id: node.id,
    path: node.path,
    title: node.title,
    summary: node.summary,
    kind: kindOf(node.kind),
    status: statusOf(node.status),
    revision: node.revision,
    updatedAt: node.updated_at,
    updatedByName: node.updated_by ? (names.get(node.updated_by) ?? null) : null,
    owner: await ownerView(db, identity, owner, names),
    // `findNode` ne rend jamais le niveau 0 : un nœud servi est lu, écrit ou géré.
    level: level as NodeView["level"],
    parent,
    children: children.children.map(({ path, title, summary, kind, status }) => ({ path, title, summary, kind, status })),
    childrenTotal: children.total,
    blocks: blockViews(published),
    outline: outlineOf(published, null).map((entry) => ({ blockId: entry.blockId ?? "", title: entry.title, level: entry.level, chars: entry.chars })),
    draft:
      draft && savedAt
        ? {
            baseRevision: draft.baseRevision,
            savedAt,
            draftStamp: draft.stamp,
            blocks: blockViews(draftBlocks),
            title: draft.title,
            summary: draft.summary,
            kind: draft.kind === "page" || draft.kind === "procedure" ? draft.kind : null,
            meta: draft.meta,
          }
        : null,
    meta: node.meta !== null && typeof node.meta === "object" && !Array.isArray(node.meta) ? { ...node.meta } : {},
    ...(rowsTotal === undefined ? {} : { rowsTotal }),
  }
}
