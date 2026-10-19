// `find` (ADR-011 § 4, H44) : la longue traîne, au-delà de ce que `context` reconnaît. Nœuds et contenu
// par `search_content` (E01-S06, classement de M06) : titre, puis résumé, puis blocs publiés, lignes de
// tableau comprises. Le service ne garde que les nœuds que la personne lit (`nodeLevels`, H123, N22),
// les regroupe en trois nœuds au plus avec leurs emplacements, puis cherche les fonctions actives du
// catalogue, un nom exact en tête. Sans ce module, `find` répond « Not available yet ».
//
// Repris de la maquette (`mcp-test/src/proto/services/find.ts` l. 10-66) : textes des fonctions, nom
// exact en tête, fonctions sans `type`, « No match » en résultat. Retiré : `rankCandidates` pour les
// nœuds (→ `search_content`), « its "Étapes" section », la ligne « The best match is weak » (N14).
// Repris d'Oto (`oto_mcp/search.py` l. 63-65 et 223-235) : un extrait sur une ligne, une liste coupée
// qui le dit (N15, N16). Retiré : fusion de sources, sémantique, `limit` en argument, projets.
import { blockRef, orderBlocks, sectionOfBlock } from "../schemas"
import { ACCESS_LEVELS, nodeLevels } from "./access"
import type { CatalogFunction } from "./catalog/define"
import { findFunction, isActive, looksLikeFunction, searchFunctions } from "./catalog/registry"
import type { PlatformDb } from "./db"
import { inTransaction } from "./errors"
import type { Identity } from "./identity"
import { clip, cut, MAX_TARGET_CHARS } from "./journal"
import { FUNCTIONS_PATH } from "./reserved-paths"
import { formatScore, roundScore } from "./routing"
import type { ToolOutput } from "./tool-output"

/** Nœuds servis en détail et fonctions servies au plus : la description de `find` le promet (N13). */
const FIND_LIMIT = 3
/**
 * Les nœuds suivants, servis en une ligne chacun (chemin, genre, score, titre et début du résumé) : sans eux, l'agent
 * savait qu'il en existait d'autres sans pouvoir juger s'ils étaient meilleurs (« créer une tâche » cachait la bonne
 * procédure au-delà du troisième rang).
 */
const OTHERS_MAX = 10
/** Le titre et le résumé d'un nœud suivant, sur une ligne. */
const OTHER_LINE_MAX = 160
/** `p_limit` de `search_content`, sa borne : les emplacements des trois premiers nœuds y sont presque toujours. */
const SEARCH_ROWS = 50
/** Un rang de `search_content` est dans [0, 3] (titre, résumé, bloc) ; le score d'un nœud, dans [0, 1]. */
const RANK_SPAN = 3

export type FindType = "procedure" | "page" | "table" | "function"

/** Genres cherchés par `type` ; un Contexte se cherche comme une page (N12). */
const KINDS: Record<Exclude<FindType, "function">, string[]> = {
  procedure: ["procedure"],
  page: ["page", "context"],
  table: ["table"],
}

/** Une ligne de `search_content` (E01-S06, « Contrat » § 4) ; colonnes de bloc nulles pour un titre ou un résumé. */
type SearchRow = {
  node_id: string
  path: string
  title: string
  summary: string
  kind: string
  match: string
  block_id: string | null
  block_type: string | null
  block_key: string | null
  column_name: string | null
  snippet: string | null
  rank: number
  /** Les blocs trouvés du nœud, avant la coupe à trois de `search_content` ; nul sur un titre ou un résumé. */
  block_total: number | null
}

/**
 * Où la requête a été trouvée dans un nœud (AC16) ; `block` est la référence courte du bloc. `section` (E11-S19,
 * AC-e4) : le titre de la section d'un bloc de page, nul avant le premier titre ; absent pour une ligne de tableau.
 * `blockId` : l'identifiant du bloc, lu par le service, jamais servi.
 */
type Place = { match: string; block: string | null; block_type: string | null; column: string | null; snippet: string; section?: string | null; blockId: string | null }

/**
 * Un nœud trouvé ; `revision` (E11-S19, AC-e5) : sa révision publiée, lue pour un nœud dont des blocs de page sont
 * montrés ; `editable` : la personne l'écrit. `nodeId` et `editable` ne sont jamais servis en données. `blocksTotal` :
 * les blocs que la recherche trouve dans le nœud, montrés ou non (`block_total`), absent d'un nœud trouvé sans bloc.
 */
type NodeMatch = { nodeId: string; path: string; kind: string; title: string; summary: string; score: number; places: Place[]; revision?: number; editable?: boolean; blocksTotal?: number }

type FunctionMatch = { fn: CatalogFunction; score: number }

/** Un extrait sur une ligne : blancs et sauts de ligne réduits à une espace (N16). */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

/** Un emplacement ; `block`, `block_type` et `column` sont nuls hors d'un bloc (AC16). */
function placeOf(row: SearchRow): Place {
  const snippet = oneLine(row.snippet ?? "")
  if (row.match !== "block" || row.block_id === null) return { match: row.match, block: null, block_type: null, column: null, snippet, blockId: null }
  const block = blockRef({ id: row.block_id, key: row.block_key })
  return { match: row.match, block, block_type: row.block_type, column: row.column_name, snippet, blockId: row.block_id }
}

/**
 * Les lignes regroupées par nœud (N11) : trois nœuds servis en détail, dans l'ordre de leur première ligne,
 * chacun avec ses emplacements dans l'ordre des lignes et son score (meilleur rang / 3, N13), les dix suivants
 * (`others`), et le nombre des nœuds vus au-delà des trois premiers. Sur les lignes que le filtre de niveau a gardées (HN-E01S07-8).
 */
function groupMatches(rows: readonly SearchRow[]): { nodes: NodeMatch[]; others: NodeMatch[]; moreNodes: number } {
  const byNode = new Map<string, NodeMatch>()
  for (const row of rows) {
    const found = byNode.get(row.node_id)
    const node = found ?? { nodeId: row.node_id, path: row.path, kind: row.kind, title: row.title, summary: row.summary, score: 0, places: [] }
    node.score = Math.max(node.score, Math.min(1, row.rank / RANK_SPAN))
    node.places.push(placeOf(row))
    if (row.block_total != null) node.blocksTotal = row.block_total
    if (!found) byNode.set(row.node_id, node)
  }
  const nodes = [...byNode.values()]
  return { nodes: nodes.slice(0, FIND_LIMIT), others: nodes.slice(FIND_LIMIT, FIND_LIMIT + OTHERS_MAX), moreNodes: Math.max(0, nodes.length - FIND_LIMIT) }
}

/** Première phrase d'une description : jusqu'au premier point suivi d'une espace ou de la fin, point final redit. */
export function firstSentence(description: string): string {
  const end = description.search(/\.(?:\s|$)/)
  return `${(end === -1 ? description : description.slice(0, end)).trim()}.`
}

// Le chemin réservé vit dans un module feuille (`reserved-paths.ts`) ; redit ici pour ses lecteurs d'avant.
export { FUNCTIONS_PATH }

/** La phrase d'une fonction dans la liste (E11-S19, AC-e3) : une description de l'ERP sans point ne l'allonge pas au-delà. */
const FUNCTION_LINE_MAX = 200

/**
 * `read {"path": "functions"}` (E11-S19, AC-e3) : toutes les fonctions actives, groupées par connecteur (ordre
 * alphabétique des connecteurs, puis des noms), chacune avec sa classe et la première phrase de sa description, puis
 * les contrats à lire avant d'écrire. Sans elle, `find` en rend trois au plus : une absence ne s'affirmait pas.
 */
export function functionCatalog(active: readonly CatalogFunction[], contracts: readonly string[], prefix: string): ToolOutput {
  const sorted = [...active].sort((a, b) => a.connector.localeCompare(b.connector) || a.name.localeCompare(b.name))
  const connectors = [...new Set(sorted.map((fn) => fn.connector))]
  const lines = [
    `${sorted.length} functions you can run, by connector:`,
    ...connectors.flatMap((connector) => [
      `${connector}:`,
      ...sorted.filter((fn) => fn.connector === connector).map((fn) => `- ${fn.name} (${fn.class}): ${cut(firstSentence(fn.description), FUNCTION_LINE_MAX)}`),
    ]),
    ...(contracts.length > 0 ? [`Contracts to read before writing: ${contracts.join(", ")}.`] : []),
    `Read a contract with ${prefix}_read {"path": "<function>"}, then run it with ${prefix}_call.`,
  ]
  return {
    text: lines.join("\n"),
    data: { functions: sorted.map((fn) => ({ name: fn.name, connector: fn.connector, class: fn.class })), contracts: [...contracts] },
    nextActions: [`${prefix}_read`],
    target: FUNCTIONS_PATH,
  }
}

function functionLines(functions: readonly FunctionMatch[], prefix: string): string[] {
  return [
    ...functions.map(
      ({ fn, score }, index) => `${index + 1}. ${fn.name} (${fn.class}, score ${formatScore(score)}): ${firstSentence(fn.description)}`,
    ),
    `Read a contract with ${prefix}_read {"path": "<function>"}, then run it with ${prefix}_call.`,
  ]
}

function blockLine(place: Place): string {
  return place.block_type === "row"
    ? `   - row ${place.block}: ${place.snippet}`
    : `   - block ${place.block} (${place.block_type})${place.section ? ` in « ${place.section} »` : ""}: ${place.snippet}`
}

/**
 * Un nœud en une ligne, titre ou résumé remplacé par son extrait quand la requête y est, puis ses blocs, puis, pour
 * une personne qui l'écrit et des blocs de page montrés, l'appel qui l'édite (E11-S19, AC-e5), comme `read` le finit.
 */
function nodeLines(node: NodeMatch, index: number, prefix: string): string[] {
  const title = node.places.find((place) => place.match === "title")?.snippet ?? oneLine(node.title)
  const summary = node.places.find((place) => place.match === "summary")?.snippet ?? oneLine(node.summary)
  const blocks = node.places.filter((place) => place.match === "block").map(blockLine)
  // Les blocs de page que la coupe à trois ne montre pas, comptés ; les lignes d'un tableau ont leur consigne (`renderFind`).
  const hidden =
    node.kind !== "table" && node.blocksTotal !== undefined && node.blocksTotal > blocks.length && blocks.length > 0
      ? [`   ${blocks.length} of ${node.blocksTotal} matching blocks shown: read the page for the others, or search more exact words.`]
      : []
  const edit =
    node.editable && node.revision !== undefined
      ? [`   To edit: ${prefix}_write {"path": "${node.path}", "base_revision": ${node.revision}, "ops": [...]}.`]
      : []
  return [`${index + 1}. ${node.path} (${node.kind}, score ${formatScore(node.score)}): ${title}. ${summary}`, ...blocks, ...hidden, ...edit]
}

/** Un nœud suivant en une ligne : chemin, genre, score, titre et début du résumé. */
function otherLine(node: NodeMatch): string {
  return `- ${node.path} (${node.kind}, score ${formatScore(node.score)}): ${cut(`${oneLine(node.title)}. ${oneLine(node.summary)}`, OTHER_LINE_MAX)}`
}

/**
 * Le texte de `find` (AC10 à AC15) : l'en-tête, les nœuds, les suivants en une ligne, « More nodes match … » si d'autres
 * nœuds ont été vus au-delà, la consigne de lecture s'il y a un nœud, la borne des lignes si une ligne de tableau est
 * montrée, puis les fonctions ; « No match » quand rien n'est trouvé, un résultat et non une erreur (N6).
 */
function renderFind(result: {
  query: string
  type?: FindType
  nodes: readonly NodeMatch[]
  others: readonly NodeMatch[]
  moreNodes: number
  functions: readonly FunctionMatch[]
  prefix: string
}): string {
  const { query, nodes, functions, prefix } = result
  if (result.type === "function") {
    if (functions.length === 0) return `No function matches « ${query} ». Ask the user what they want to do; do not guess.`
    return [`Top functions for « ${query} »:`, ...functionLines(functions, prefix)].join("\n")
  }
  if (nodes.length === 0 && functions.length === 0) {
    return `No match for « ${query} ». Ask the user to rephrase or to say what they are looking for; do not guess.`
  }
  const lines = [`Top matches for « ${query} »:`, ...nodes.flatMap((node, index) => nodeLines(node, index, prefix))]
  if (result.others.length > 0) lines.push("Other matches:", ...result.others.map(otherLine))
  const beyond = result.moreNodes - result.others.length
  if (beyond > 0) lines.push(`More nodes match (at least ${beyond}): add words or set type to narrow the search.`)
  if (nodes.length > 0) lines.push(`Read one with ${prefix}_read {"path": "<path>"}; a procedure's steps are in its sections.`)
  if (nodes.some((node) => node.places.some((place) => place.block_type === "row"))) {
    lines.push(`At most 3 rows per table are shown: for every matching row, run ${prefix}_call table.rows with a filter or q.`)
  }
  if (functions.length > 0) lines.push("Functions:", ...functionLines(functions, prefix))
  return lines.join("\n")
}

/** Fonctions actives par leurs mots, trois au plus, un nom exact toujours en tête avec le score 1 (H44). */
function matchFunctions(active: readonly CatalogFunction[], query: string): FunctionMatch[] {
  const exact = looksLikeFunction(query) ? findFunction(active, query) : null
  const found = searchFunctions(active, query, FIND_LIMIT).filter((result) => result.fn !== exact)
  return (exact ? [{ fn: exact, score: 1 }, ...found] : found).slice(0, FIND_LIMIT)
}

/**
 * Les lignes de `search_content` pour la requête, telle quelle, et le genre demandé (`p_kinds` omis :
 * tous), un appel sous la session de la personne, arguments nommés, dans l'ordre où la fonction les
 * rend (son `order by`) ; puis seulement celles des nœuds qu'elle lit, niveaux calculés en un lot, hors
 * de la transaction, avant tout regroupement (N22).
 */
async function readableRows(db: PlatformDb, identity: Identity, query: string, type: Exclude<FindType, "function"> | undefined) {
  const rows = await inTransaction(db, "find: search_content", (sql) => {
    const kinds = type === undefined ? sql`` : sql`p_kinds => ${KINDS[type]}, `
    return sql<SearchRow[]>`
      select s.node_id, s.path, s.title, s.summary, s.kind, s.match, s.block_id, s.block_type, s.block_key, s.column_name, s.snippet, s.rank, s.block_total
        from platform.search_content(p_org => ${identity.org.id}, p_query => ${query}, ${kinds}p_limit => ${SEARCH_ROWS}) s`
  })
  const levels = await nodeLevels(db, identity, [...new Set(rows.map((row) => row.node_id))])
  return { rows: rows.filter((row) => (levels.get(row.node_id) ?? ACCESS_LEVELS.none) >= ACCESS_LEVELS.read), levels }
}

/** Un bloc de page trouvé (pas une ligne de tableau), dont la section se lit. */
function isPageBlock(place: Place): place is Place & { blockId: string } {
  return place.match === "block" && place.block_type !== "row" && place.blockId !== null
}

/**
 * La section de chaque bloc de page montré et la révision de son nœud (E11-S19, AC-e4, AC-e5), en une transaction :
 * les titres publiés et les blocs trouvés de ces nœuds seulement, puis `sectionOfBlock` dans l'ordre du document ; aucune
 * lecture sans bloc de page montré. `editable` : niveau écriture, déjà calculé pour le filtre (`levels`).
 */
async function withSections(db: PlatformDb, identity: Identity, nodes: NodeMatch[], levels: ReadonlyMap<string, number>): Promise<void> {
  const shown = nodes.filter((node) => node.places.some(isPageBlock))
  if (shown.length === 0) return
  const ids = shown.map((node) => node.nodeId)
  const blockIds = shown.flatMap((node) => node.places.filter(isPageBlock).map((place) => place.blockId))
  const org = identity.org.id
  const [blocks, revisions] = await inTransaction(db, "find: sections", (sql) =>
    Promise.all([
      sql<{ node_id: string; id: string; type: string; text: string | null; data: unknown; position: number | null }[]>`
        select node_id, id, type, text, data, position from platform.blocks
         where org_id = ${org} and state = 'published' and node_id = any(${ids}) and (type = 'heading' or id = any(${blockIds}))`,
      sql<{ id: string; revision: number }[]>`select id, revision from platform.nodes where org_id = ${org} and id = any(${ids})`,
    ]),
  )
  for (const node of shown) {
    const ordered = orderBlocks(blocks.filter((block) => block.node_id === node.nodeId))
    for (const place of node.places.filter(isPageBlock)) {
      place.section = ordered.some((block) => block.id === place.blockId) ? sectionOfBlock(ordered, place.blockId) : null
    }
    node.revision = revisions.find((row) => row.id === node.nodeId)?.revision
    node.editable = node.kind !== "table" && (levels.get(node.nodeId) ?? ACCESS_LEVELS.none) >= ACCESS_LEVELS.write
  }
}

/** Un nœud en données (AC16) : ses champs servis, sans l'identifiant du nœud ni ceux des blocs. */
function matchData(node: NodeMatch) {
  const places = node.places.map((place) => ({
    match: place.match,
    block: place.block,
    block_type: place.block_type,
    column: place.column,
    snippet: place.snippet,
    ...(place.section === undefined ? {} : { section: place.section }),
  }))
  const revision = node.revision === undefined ? {} : { revision: node.revision }
  const blocksTotal = node.blocksTotal === undefined ? {} : { blocks_total: node.blocksTotal }
  return { path: node.path, kind: node.kind, title: node.title, summary: node.summary, score: roundScore(node.score), places, ...revision, ...blocksTotal }
}

/**
 * `find` : nœuds par `search_content` (aucun appel avec `type: "function"`), fonctions actives du
 * catalogue sans `type` ou avec `type: "function"` (jamais avec un genre de nœud). Données en champs
 * (AC16) ; la cible du journal est la requête.
 */
export async function find(
  db: PlatformDb,
  identity: Identity,
  input: { query: string; type?: FindType },
  catalog: { functions: readonly CatalogFunction[]; activeConnectors: ReadonlySet<string> },
): Promise<ToolOutput> {
  const { query, type } = input
  const prefix = identity.org.prefix
  const readable = type === "function" ? null : await readableRows(db, identity, query, type)
  const { nodes, others, moreNodes } = readable === null ? { nodes: [], others: [], moreNodes: 0 } : groupMatches(readable.rows)
  if (readable) await withSections(db, identity, nodes, readable.levels)
  const active = catalog.functions.filter((fn) => isActive(fn, catalog.activeConnectors))
  const functions = type === undefined || type === "function" ? matchFunctions(active, query) : []
  return {
    text: renderFind({ query, type, nodes, others, moreNodes, functions, prefix }),
    data: {
      matches: nodes.map(matchData),
      others: others.map((node) => ({ path: node.path, kind: node.kind, title: node.title, score: roundScore(node.score) })),
      more_nodes: moreNodes,
      functions: functions.map(({ fn, score }) => ({ name: fn.name, class: fn.class, connector: fn.connector, score: roundScore(score) })),
    },
    nextActions: nodes.length + functions.length > 0 ? [`${prefix}_read`] : [],
    target: clip(query, MAX_TARGET_CHARS),
  }
}
