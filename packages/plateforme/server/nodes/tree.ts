// L'arbre des écrans (E03-S03, AC36, N32) : les nœuds de l'organisation que la personne lit, brouillons
// compris, chacun rattaché à son ancêtre visible le plus proche, les frères dans leur ordre (par position,
// puis par chemin, E05-S10 AC-b9). Visible = niveau ≥ 1 calculé par `access.ts` en un lot (un nœud à la
// corbeille vaut 0, E05-S10) ; la base rend tous les nœuds de l'organisation sous la RLS d'isolation
// d'E01-S08 : le filtre est ici (H123). Sans lui, l'arbre d'E05-S02 n'a pas de données.
//
// E11-S10 (lot b, HN-E11S10-5) : l'arbre des écrans se calcule sur l'identité de membre de la personne,
// sans le pouvoir d'administrateur ni l'accès plateforme ; un administrateur n'y voit que ce qu'un membre
// verrait (ses équipes, ce qui lui est partagé), ses droits réels ne changeant pas ailleurs.
import type { TreeNode } from "../../schemas"
import { ACCESS_LEVELS, nodeLevels } from "../access"
import type { PlatformDb } from "../db"
import { inTransaction } from "../errors"
import type { Identity } from "../identity"
import { TREE_MAX } from "./limits"
import { parentPath } from "./lookup"
import { comparePaths, compareSiblings, kindOf, statusOf } from "./view"

/** Les frères de chaque liste de l'arbre rangés dans leur ordre, à toute profondeur. */
function orderSiblings(nodes: TreeNode[], positions: ReadonlyMap<string, number | null>): void {
  const placed = (node: TreeNode) => ({ path: node.path, position: positions.get(node.path) ?? null })
  nodes.sort((a, b) => compareSiblings(placed(a), placed(b)))
  for (const node of nodes) orderSiblings(node.children, positions)
}

/**
 * L'identité de membre (HN-E11S10-5) : ni rôle d'administrateur, ni équipe plateforme, ni accès en cours ;
 * ses niveaux ne dépassent jamais ceux de l'identité réelle (`security-patterns.md § Droits dans le service`).
 */
export function asMember(identity: Identity): Identity {
  return { ...identity, member: { ...identity.member, role: "member" }, isStaff: false, hasOpenGrant: false }
}

/**
 * `{ tree, truncated }` (AC36) : `tree` porte les nœuds visibles sans ancêtre visible (la racine
 * `guide` d'ordinaire), chacun avec ses enfants visibles, les frères dans leur ordre ; un nœud visible
 * sous un parent invisible est rattaché à son ancêtre visible le plus proche. 5 000 nœuds au plus,
 * comptés après le filtre et pris dans l'ordre des chemins (un parent avant ses enfants, HN-E01S07-8) ;
 * au-delà, `truncated`. Visible : au niveau de lecture de la personne comme membre (`asMember`).
 */
export async function visibleTree(db: PlatformDb, identity: Identity): Promise<{ tree: TreeNode[]; truncated: boolean }> {
  // Les nœuds de l'organisation, en une lecture : la face SQL n'a pas la coupe de `max_rows` (N48) ; puis leurs
  // niveaux, dans la même transaction (E05-S10, partie c).
  const { rows, levels } = await inTransaction(db, "nodes: tree", async (sql) => {
    const read = await sql<{ id: string; path: string; title: string; kind: string; status: string; position: number | null }[]>`
      select id, path, title, kind, status, position from platform.nodes where org_id = ${identity.org.id}`
    // Un filtre de liste compare `nodeLevels` à 1 seulement (`security-patterns.md § Droits dans le service`).
    return { rows: read, levels: await nodeLevels(db, asMember(identity), read.map((row) => row.id)) }
  })
  const visible = rows.filter((row) => (levels.get(row.id) ?? ACCESS_LEVELS.none) >= ACCESS_LEVELS.read).sort(comparePaths)
  const kept = visible.slice(0, TREE_MAX)
  const byPath = new Map<string, TreeNode>(
    kept.map((row) => [row.path, { path: row.path, title: row.title, kind: kindOf(row.kind), status: statusOf(row.status), children: [] }]),
  )
  const tree: TreeNode[] = []
  for (const row of kept) {
    const node = byPath.get(row.path)
    if (!node) continue
    let ancestor = parentPath(row.path)
    while (ancestor !== null && !byPath.has(ancestor)) ancestor = parentPath(ancestor)
    const holder = ancestor === null ? undefined : byPath.get(ancestor)
    if (holder) holder.children.push(node)
    else tree.push(node)
  }
  orderSiblings(tree, new Map(kept.map((row) => [row.path, row.position])))
  return { tree, truncated: visible.length > TREE_MAX }
}
