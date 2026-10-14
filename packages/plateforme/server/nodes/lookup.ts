// Recherche commune d'un nœud par son chemin, dans l'organisation de l'identité, avec son niveau
// calculé par `access.ts` (E03-S03, H68, H123, N47). Sans lui, `read`, `write`, les tableaux et le
// déplacement liraient chacun un nœud, et décideraient chacun sa visibilité, à leur façon. Un ancien
// chemin s'y résout, en ce seul point (E03-S07, H58, N8).
//
// Repris d'Oto (`docs/alias-deprecies.md` l. 42) : un nom servi ne disparaît jamais sec, l'ancien
// répond avec un avis. Retiré : la date de retrait (l'alias reste en V1, H58).
//
// Face SQL (E01-S10, lot b1) : les lectures de `nodes/` passent par `db.tx` (`inTransaction`, `server/errors.ts`),
// sous l'appelant de la requête ; la décision reste celle d'`access.ts`. E05-S10 (partie c) : le nœud et son
// niveau se lisent dans une seule transaction (chacune coûte quatre allers-retours de plus que ses requêtes) ;
// elle ne tient que ses requêtes et le calcul du niveau (`supabase-patterns.md § Couplage à Supabase (ADR-012)`).
import { NODE_PATH_PATTERN } from "../../schemas"
import { ACCESS_LEVELS, ancestorPaths, nodeDepth, nodeLevel, nodeLevels, ROOT_PATH, type AccessLevel } from "../access"
import type { PlatformDb } from "../db"
import { inTransaction, PlatformError } from "../errors"
import type { Identity } from "../identity"
import { cut } from "../journal"
import { day } from "./read-format"

/** La racine de l'arbre (H50) : ses enfants ont un chemin sans préfixe (celle d'`access.ts`). */
export { ROOT_PATH }

/** Colonnes de `nodes` lues par les services de `nodes/` ; `sections` et `draft` ne sont plus lues (ADR-011 § 1). */
export const NODE_COLUMNS =
  "id, org_id, parent_id, path, kind, title, summary, status, revision, meta, owner_kind, owner_team_id, owner_user_id, created_by, updated_by, created_at, updated_at"

/**
 * `NODE_COLUMNS` sur la face SQL (E01-S10), pour `sql(NODE_SQL_COLUMNS)` : les mêmes colonnes. Une ligne
 * lue par elles passe par `to_json` (`to_json(n) as node from (select … ) n`) pour garder la forme que
 * PostgREST rendait : `created_at` et `updated_at` en texte ISO à la microseconde, qu'une garde compare à
 * la colonne (`move.ts`, `admin/nodes.ts`), jamais une `Date` coupée à la milliseconde.
 */
export const NODE_SQL_COLUMNS: readonly string[] = NODE_COLUMNS.split(", ")

/** Une ligne de `nodes` telle que la rend `to_json` : la forme de PostgREST. */
type NodeJson = { node: NodeRow }

export type NodeRow = {
  id: string
  org_id: string
  parent_id: string | null
  path: string
  kind: string
  title: string
  summary: string
  status: string
  revision: number
  meta: unknown
  owner_kind: string | null
  owner_team_id: string | null
  owner_user_id: string | null
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
}

/** Longueur d'un chemin de nœud (H51) : 1 000 caractères de `[a-z0-9_/]` au plus, qui tiennent dans l'adresse d'un filtre. */
const PATH_MAX = 1_000

/**
 * Refuse un chemin mal formé ou trop long avant toute requête (AC17, AC35, N74) : un chemin sans
 * borne ferait échouer le filtre qui le porte (`supabase-patterns.md § Error Handling`).
 */
export function checkNodePath(path: string): void {
  if (path.length <= PATH_MAX && NODE_PATH_PATTERN.test(path)) return
  throw new PlatformError(
    "invalid_arguments",
    `Invalid path « ${cut(path, 200)} »: lowercase letters, digits and _ separated by /, e.g. ventes/relance_devis.`,
  )
}

/** Le chemin du parent : `ventes/x` → `ventes`, `ventes` → `guide` ; `null` pour la racine. */
export function parentPath(path: string): string | null {
  if (path === ROOT_PATH) return null
  const slash = path.lastIndexOf("/")
  return slash === -1 ? ROOT_PATH : path.slice(0, slash)
}

async function readNodeRow(db: PlatformDb, identity: Identity, path: string): Promise<NodeRow | null> {
  checkNodePath(path)
  // `(org_id, path)` est unique (`nodes_org_id_path_key`) : une ligne au plus.
  const [row] = await inTransaction(db, "nodes: lookup", (sql) => sql<NodeJson[]>`
    select to_json(n) as node from (select ${sql(NODE_SQL_COLUMNS)} from platform.nodes where org_id = ${identity.org.id} and path = ${path}) n`)
  return row?.node ?? null
}

/**
 * Le nœud du chemin dans l'organisation de l'identité et le niveau de l'appelant, 0 compris : `write`
 * refuse ainsi un chemin occupé par un nœud invisible (N31) ; `null` seulement quand le chemin est libre.
 */
export async function lookupNode(db: PlatformDb, identity: Identity, path: string): Promise<{ node: NodeRow; level: AccessLevel } | null> {
  // Un chemin mal formé est refusé avant d'ouvrir la transaction (N74).
  checkNodePath(path)
  return inTransaction(db, "nodes: lookup", async () => {
    const node = await readNodeRow(db, identity, path)
    if (!node) return null
    return { node, level: await nodeLevel(db, identity, node.id) }
  })
}

/** Un nœud atteint par un ancien chemin : cet ancien chemin et la date de l'alias (`node_aliases.created_at`). */
export type MovedNode = { node: NodeRow; level: AccessLevel; movedFrom: string; movedAt: string }

/**
 * Le nœud dont `path` est un ancien chemin dans l'organisation (`node_aliases`, écrit par la base au
 * déplacement, E01-S06), puis son niveau calculé comme pour un chemin courant, 0 compris : `write`
 * refuse ainsi un ancien chemin d'un nœud invisible (AC15) ; `null` quand ce n'est pas un alias.
 */
export async function lookupAlias(db: PlatformDb, identity: Identity, path: string): Promise<MovedNode | null> {
  const org = identity.org.id
  // L'alias (clé `(org_id, old_path)`), puis le nœud qu'il désigne, dans une transaction : une ligne au plus
  // chacun ; la date de l'alias en texte, comme PostgREST la rendait.
  const moved = await inTransaction(db, "node_aliases: lookup", async (sql) => {
    const [alias] = await sql<{ node_id: string; created_at: string }[]>`
      select node_id, to_json(created_at) as created_at from platform.node_aliases where org_id = ${org} and old_path = ${path}`
    if (!alias) return null
    const [row] = await sql<NodeJson[]>`
      select to_json(n) as node from (select ${sql(NODE_SQL_COLUMNS)} from platform.nodes where org_id = ${org} and id = ${alias.node_id}) n`
    return row ? { node: row.node, movedAt: alias.created_at } : null
  })
  if (!moved) return null
  return { node: moved.node, level: await nodeLevel(db, identity, moved.node.id), movedFrom: path, movedAt: moved.movedAt }
}

/**
 * Le nœud lu par son chemin dans l'organisation de l'identité, sinon par un ancien chemin (alias,
 * E03-S07 N8), puis son niveau calculé (`nodeLevel`, E01-S07) ; niveau 0 → `null`, comme un nœud
 * absent (H68, H123). `level` (1 à 3) sert la décision de l'appelant sans second calcul (N47) ;
 * `movedFrom` et `movedAt` : l'ancien chemin et la date de l'alias, nuls pour un chemin courant.
 * Un chemin mal formé est refusé avant la requête (`invalid_arguments`, N74).
 */
export async function findNode(
  db: PlatformDb,
  identity: Identity,
  path: string,
): Promise<{ node: NodeRow; level: AccessLevel; movedFrom: string | null; movedAt: string | null } | null> {
  checkNodePath(path)
  return inTransaction(db, "nodes: find", async () => {
    const current = await lookupNode(db, identity, path)
    const found = current ? { ...current, movedFrom: null, movedAt: null } : await lookupAlias(db, identity, path)
    if (!found || found.level === ACCESS_LEVELS.none) return null
    return found
  })
}

/** La ligne servie en tête de ce qu'on sert par un ancien chemin (AC7) : « ventes/a/x moved to ventes/b/x on 2026-09-24: use the new path. » */
export function movedNotice(movedFrom: string, node: { path: string }, movedAt: string): string {
  return `${movedFrom} moved to ${node.path} on ${day(movedAt)}: use the new path.`
}

/** Un chemin inconnu ou invisible (H68), avec l'outil qui le trouve : `read` et le déplacement. */
export function unknownNode(path: string, prefix: string): PlatformError {
  return new PlatformError("not_found", `Unknown path ${path}. Use ${prefix}_find to locate it.`)
}

/**
 * Un chemin pris par un nœud, visible ou non, ou ancien chemin d'un autre nœud (E03-S03 N31, E03-S07
 * AC9, AC15, M02) : le refus dit les causes possibles, jamais laquelle (H68 : un nœud qu'on ne voit pas ne se révèle
 * pas). Création et déplacement.
 */
export function notAvailable(path: string): PlatformError {
  return new PlatformError("conflict", `Path ${path} is not available: a content holds it (perhaps one you cannot see), a moved content had it, or the name is reserved. Choose another path.`)
}

/** Un chemin sous `guide/` (H50) : la racine n'a que des enfants sans préfixe ; `write` et le déplacement. */
export function refuseUnderRoot(path: string): void {
  if (!path.startsWith(`${ROOT_PATH}/`)) return
  throw new PlatformError(
    "invalid_arguments",
    "guide is the organisation's guide, the root of the tree: its children have paths without prefix, e.g. ventes/notes.",
  )
}

/**
 * Le plus proche ancêtre de `path` que l'appelant lit (niveau ≥ 1) : ancêtres lus par chemin dans
 * l'organisation, en une lecture (aucune pour la racine, qui n'en a pas), niveaux en un lot
 * (`nodeLevels`), la racine au pis. Un ancêtre de niveau 0 vaut absent (H68).
 */
export async function closestExisting(db: PlatformDb, identity: Identity, path: string): Promise<NodeRow> {
  const paths = ancestorPaths(path)
  const read =
    paths.length === 0
      ? []
      : await inTransaction(db, "nodes: ancestors", (sql) => sql<NodeJson[]>`
          select to_json(n) as node from (select ${sql(NODE_SQL_COLUMNS)} from platform.nodes where org_id = ${identity.org.id} and path = any(${paths})) n`)
  const rows = read.map((row) => row.node)
  // Un filtre de liste compare `nodeLevels` à 1 seulement (`security-patterns.md § Droits dans le service`).
  const levels = await nodeLevels(db, identity, rows.map((row) => row.id))
  const visible = rows.filter((row) => (levels.get(row.id) ?? ACCESS_LEVELS.none) >= ACCESS_LEVELS.read)
  // Le plus profond, par son nombre de segments (N60), jamais par sa longueur : `guide` et `private` sont d'un segment chacun.
  const deepest = visible.sort((a, b) => nodeDepth(b.path) - nodeDepth(a.path))[0] ?? rows.find((row) => row.path === ROOT_PATH)
  if (!deepest) throw new PlatformError("internal", "Internal error.")
  return deepest
}
