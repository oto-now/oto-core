// Déplacement d'un nœud (E03-S07, AC6, AC9, AC15 ; H51, H58, H71, P12, P13 ; N5 à N7, N11) : chaque
// refus est décidé par le service, dans l'ordre de l'AC9 et avant la mise à jour (H123, `access.ts`) ;
// puis **une** mise à jour du nœud (`parent_id`, `path`) sous la session de la personne (face SQL,
// E01-S10), gardée par sa révision et son `updated_at`. Dans la même transaction, la base réécrit le
// chemin des descendants (`nodes_path_cascade`, E01-S04) et inscrit l'ancien chemin de chacun
// (`nodes_aliases_on_move`, E01-S06) ; le service n'écrit aucun alias. `nodes_guard` et M02 restent des
// secondes barrières, traduites. La réponse ne nomme que les nœuds déplacés que la personne lit (niveaux
// en un lot). Sans lui, un nœud ne change pas de place (H51, H71).
//
// Repris d'Oto (`oto_mcp/db/nodes.py` l. 1058-1093, `move_page`) : le cycle refusé avant d'écrire,
// l'identité du nœud gardée (ce qui pend au nœud le suit) ; le propriétaire explicite qui suit le nœud
// (H71). Retiré : le rang (`after_id`), la remontée récursive (→ préfixe du chemin), le `False` muet
// d'un nœud absent (→ `not_found`).
import { moveNodeSchema, type MoveNodeInput } from "../../schemas"
import { ACCESS_LEVELS, describeOwner, nodeLevels, requireNodeLevel, reservedTo } from "../access"
import type { PlatformDb } from "../db"
import { fromDatabaseError, inTransaction, invalidInput, isPlatformError, isUniqueViolation, PlatformError } from "../errors"
import type { Identity } from "../identity"
import { formatCount } from "./document"
import { LISTED_MAX } from "./limits"
import { closestExisting, findNode, notAvailable, parentPath, refuseUnderRoot, ROOT_PATH, unknownNode, type NodeRow } from "./lookup"
import { freePath, lastSegment } from "./segments"
import { currentRevision } from "./store"
import { ownerOf, teamOf } from "./view"

/** Un déplacement fait : chaque nœud visible, de son ancien chemin à son nouveau (AC6). */
export type Move = { from: string; to: string }

/** Ce que rend `moveNode` : le texte, les déplacements nommés, la cible et l'équipe du journal (H07). */
export type MoveResult = { text: string; moves: Move[]; target: string; teamId: string | null }

/** Ce que le service a décidé : le nœud, sa destination et son nouveau parent. */
type Plan = { node: NodeRow; parent: NodeRow; newPath: string }

/** Un déplacement demandé (gestion) ou le chemin qui suit un titre publié (écriture, E11-S02). */
type MoveAction = "move" | "rename"

const PRIVATE = "private"

function invalid(message: string): PlatformError {
  return new PlatformError("invalid_arguments", message)
}

/** Une destination sous le nœud lui-même (AC9), par son chemin courant ou par un ancien chemin. */
function underItself(node: NodeRow, newPath: string): PlatformError {
  return invalid(`Cannot move ${node.path} under itself: ${newPath} is inside ${node.path}.`)
}

/** Le nom d'une équipe dont `path` est le dossier (P39 : `<slug>` porte `<slug>/contexte`), sinon `null`. */
async function teamOfFolder(db: PlatformDb, identity: Identity, path: string): Promise<string | null> {
  const [team] = await inTransaction(
    db,
    "move: team folder",
    (sql) => sql<{ name: string }[]>`select name from platform.teams where org_id = ${identity.org.id} and slug = ${path}`,
  )
  return team?.name ?? null
}

/**
 * Ce que l'arbre tient en place (AC9, H50, H61, P39) : la racine, `private`, un espace personnel, un
 * Contexte, le dossier d'une équipe (son nom) ; `null` pour un nœud qui bouge. Lu aussi par la corbeille,
 * la duplication, l'adresse qui suit le titre et l'accès général (E05-S10), qui disent leur refus.
 */
export async function structureOf(
  db: PlatformDb,
  identity: Identity,
  node: Pick<NodeRow, "path" | "kind">,
): Promise<{ kind: "root" | "private" | "space" | "context" } | { kind: "team"; team: string } | null> {
  if (node.path === ROOT_PATH) return { kind: "root" }
  if (node.path === PRIVATE) return { kind: "private" }
  if (/^private\/[^/]+$/.test(node.path)) return { kind: "space" }
  if (node.kind === "context") return { kind: "context" }
  const team = node.path.includes("/") ? null : await teamOfFolder(db, identity, node.path)
  return team === null ? null : { kind: "team", team }
}

/** Ce qui ne bouge pas (AC9, H50, H61, P39) : la racine, `private`, un espace personnel, un Contexte et le dossier qui le porte. */
async function refuseStructure(db: PlatformDb, identity: Identity, node: NodeRow): Promise<void> {
  const cannot = (reason: string) => invalid(`${node.path} cannot move: ${reason}`)
  const structure = await structureOf(db, identity, node)
  if (structure?.kind === "root") throw cannot("it is the root of the tree.")
  if (structure?.kind === "private") throw cannot("it holds the personal spaces.")
  if (structure?.kind === "space") throw cannot("it is a personal space; move the pages inside it instead.")
  if (structure?.kind === "context") throw cannot("a Contexte stays at the head of its team; move the pages inside it instead.")
  if (structure?.kind === "team") throw cannot(`it holds the Contexte of team ${structure.team}; move the pages inside it instead.`)
}

/**
 * La destination (fiche D125, M68) : le chemin demandé s'il est libre, sinon le premier chemin libre de son
 * segment sous le nouveau parent (`freePath` : nœuds et anciens chemins de l'organisation, visibles ou non,
 * corbeille comprise, N6, AC15) ; l'alias du nœud lui-même se reprend. Un nom pris ne refuse jamais le geste.
 */
async function freeDestination(db: PlatformDb, identity: Identity, node: NodeRow, place: { parent: NodeRow; newPath: string }): Promise<string> {
  const path = await freePath(db, identity, { parent: place.parent.path, segment: lastSegment(place.newPath), nodeId: node.id })
  // Le premier chemin libre est le sien (`ventes/b_2` demandé à `ventes/b`, pris) : rien ne bouge.
  if (path === node.path) throw invalid(`${place.newPath} is taken and ${node.path} is already the first free path after it: nothing to move.`)
  return path
}

/**
 * Le parent de destination (AC9), résolu comme tout chemin par `findNode` (N8) : il doit exister et être
 * lu (niveau 0 = absent, H68), ne pas être un ancien chemin (N17 : rien ne se pose dessous, le refus
 * donne le chemin à suivre), ni `private`, et recevoir l'écriture de la personne.
 */
async function destinationParent(db: PlatformDb, identity: Identity, node: NodeRow, newPath: string): Promise<NodeRow> {
  const parentAt = parentPath(newPath) ?? ROOT_PATH
  const parent = await findNode(db, identity, parentAt)
  if (!parent) {
    const closest = (await closestExisting(db, identity, newPath)).path
    throw new PlatformError("not_found", `Cannot move ${node.path} to ${newPath}: ${parentAt} does not exist. Closest existing page: ${closest}.`)
  }
  if (parent.movedFrom) {
    const instead = `${parent.node.path}${newPath.slice(parentAt.length)}`
    // L'ancien chemin du nœud ou de l'un de ses descendants : la destination est sous le nœud lui-même.
    if (instead.startsWith(`${node.path}/`)) throw underItself(node, newPath)
    throw invalid(`Cannot move ${node.path} to ${newPath}: ${parentAt} moved to ${parent.node.path}. Move it to ${instead} instead.`)
  }
  if (parent.node.path === PRIVATE) {
    const segment = node.path.slice(node.path.lastIndexOf("/") + 1)
    const handle = identity.member.profile.handle ?? "<your handle>"
    throw invalid(`private holds one personal space per member: move ${node.path} inside a space, e.g. private/${handle}/${segment}.`)
  }
  if (parent.level < ACCESS_LEVELS.write) {
    const owner = await ownerOf(db, parent.node.id)
    const who = owner ? await describeOwner(db, identity, owner) : "its managers"
    throw new PlatformError("forbidden", reservedTo("write", `under ${parentAt}`, who))
  }
  return parent.node
}

/**
 * Les contrôles de l'AC9 après le format des chemins, dans son ordre, sans rien écrire ; rend ce qui est
 * décidé. `action` : `move` exige la gestion, `rename` (le chemin qui suit un titre publié) l'écriture
 * (E11-S02, HN-E11S02-18).
 */
async function decide(db: PlatformDb, identity: Identity, request: MoveNodeInput, action: MoveAction): Promise<Plan> {
  const found = await findNode(db, identity, request.path)
  if (!found) throw unknownNode(request.path, identity.org.prefix)
  const { node } = found
  if (request.new_path === node.path) throw invalid(`new_path is already the path of ${node.path}.`)
  await refuseStructure(db, identity, node)
  if (found.level < ACCESS_LEVELS.manage) await requireNodeLevel(db, identity, { id: node.id, path: node.path }, action)
  if (request.new_path.startsWith(`${node.path}/`)) throw underItself(node, request.new_path)
  const parent = await destinationParent(db, identity, node, request.new_path)
  // La gestion sur le nœud et l'écriture sur la destination suffisent : un déplacement ne change pas l'espace écrit sur
  // le nœud (migration 20261126172651), seul un partage ou un transfert le fait.
  return { node, parent, newPath: await freeDestination(db, identity, node, { parent, newPath: request.new_path }) }
}

/**
 * Le nœud et ses descendants que la personne lit (niveau ≥ 1, un lot), lus de parent en enfants, une
 * requête par génération dans une transaction, triés par chemin (AC6).
 */
async function visibleSubtree(db: PlatformDb, identity: Identity, node: NodeRow): Promise<{ id: string; path: string }[]> {
  const rows = [{ id: node.id, path: node.path }]
  const seen = new Set([node.id])
  await inTransaction(db, "move: subtree", async (sql) => {
    for (let frontier = [node.id]; frontier.length > 0; ) {
      const children = await sql<{ id: string; path: string }[]>`
        select id, path from platform.nodes where org_id = ${identity.org.id} and parent_id in ${sql(frontier)}`
      const fresh = children.filter((child) => !seen.has(child.id))
      fresh.forEach((child) => seen.add(child.id))
      rows.push(...fresh)
      frontier = fresh.map((child) => child.id)
    }
  })
  // Un filtre de liste compare `nodeLevels` à 1 seulement (`security-patterns.md § Droits dans le service`).
  const levels = await nodeLevels(db, identity, rows.map((row) => row.id))
  return rows.filter((row) => (levels.get(row.id) ?? ACCESS_LEVELS.none) >= ACCESS_LEVELS.read).sort((a, b) => (a.path < b.path ? -1 : 1))
}

function treeChanging(identity: Identity): PlatformError {
  return new PlatformError("conflict", `The tree of ${identity.org.name} was changing at the same time: retry the move.`)
}

/**
 * Le refus d'une mise à jour que la base refuse (seconde barrière, N15) : le code part d'abord au log
 * serveur, course comprise ; les contrôles rejoués sur l'état d'après donnent le message de l'AC9 qui
 * correspond ; sinon celui du code (`23505` : chemin pris ou ancien chemin d'un autre nœud, M02 ;
 * `42501` : les règles d'accès, sans nommer personne, N25 ; le reste : l'arbre a bougé ou le refuse).
 * Jamais le message de la base.
 */
async function refusal(db: PlatformDb, identity: Identity, request: MoveNodeInput, failure: { plan: Plan; action: MoveAction; error: { code?: string } }): Promise<PlatformError> {
  const { plan } = failure
  const { code } = failure.error
  console.error("[platform] move: refused by the database", code)
  const redecided = await decide(db, identity, request, failure.action).then(
    () => null,
    (error: unknown) => error,
  )
  if (isPlatformError(redecided)) return redecided
  if (redecided !== null) throw redecided
  const cannot = `Cannot move ${plan.node.path} to ${plan.newPath}`
  if (isUniqueViolation({ code })) return notAvailable(plan.newPath)
  if (code === "42501") return new PlatformError("forbidden", `${cannot}: the access rules of ${identity.org.name} refuse it there. Choose another path.`)
  if (code === "23514" || code === "23503") return invalid(`${cannot}: the tree refuses this place. Choose another path.`)
  // L'erreur elle-même : ce qui ne vient pas de la base (configuration) passe tel quel (HN-E01S10-15).
  return fromDatabaseError(failure.error, "move")
}

/**
 * La mise à jour, une seule (N5) : `parent_id` et `path`, gardée par la révision et l'`updated_at`
 * lus (0 ligne : le nœud a changé entre-temps) ; un interblocage de l'arbre (`40P01`, E01-S04 N36) la
 * rejoue une fois. Chaque essai est sa transaction ; la cascade des chemins et les alias sont les
 * déclencheurs de la base, dans la même. L'`updated_at` lu repasse par un texte : une `Date` perdrait
 * ses microsecondes, et la garde le compare à l'égalité.
 */
async function applyMove(db: PlatformDb, identity: Identity, request: MoveNodeInput, decided: { plan: Plan; action: MoveAction }): Promise<void> {
  const { plan } = decided
  for (let attempt = 1; ; attempt++) {
    const { rows, error } = await db
      .tx((sql) => sql<{ id: string }[]>`
        update platform.nodes set parent_id = ${plan.parent.id}, path = ${plan.newPath}, updated_by = ${identity.user.id}
         where org_id = ${identity.org.id} and id = ${plan.node.id} and revision = ${plan.node.revision}
           and updated_at = ${plan.node.updated_at}::text::timestamptz
        returning id`)
      .then(
        (updated) => ({ rows: updated, error: null }),
        (failed: { code?: string }) => ({ rows: [], error: failed }),
      )
    if (!error && rows.length > 0) return
    if (!error) {
      // Aucune ligne après une décision positive : la course se journalise d'abord, les portes ne le font pas.
      console.error("[platform] move: node changed before its update", plan.node.id)
      // La révision relue, que porte tout `stale_revision` d'un nœud (E03-S03 N76).
      const revision = (await currentRevision(db, plan.node.id)) ?? plan.node.revision
      throw new PlatformError("stale_revision", `${plan.node.path} changed while it was being moved: read it again, then retry.`, { revision })
    }
    if (error.code !== "40P01") throw await refusal(db, identity, request, { ...decided, error })
    if (attempt > 1) throw treeChanging(identity)
  }
}

/** Les chemins courants des nœuds nommés, relus après la mise à jour (la cascade de la base fait foi). */
async function currentPaths(db: PlatformDb, identity: Identity, ids: readonly string[]): Promise<Map<string, string>> {
  const rows = await inTransaction(
    db,
    "move: moved nodes",
    (sql) => sql<{ id: string; path: string }[]>`select id, path from platform.nodes where org_id = ${identity.org.id} and id in ${sql(ids)}`,
  )
  return new Map(rows.map((row) => [row.id, row.path]))
}

/** Le texte de l'AC6 : chaque nœud nommé, puis ce que deviennent les anciens chemins ; 50 lignes au plus. */
function movedText(plan: Plan, moves: readonly Move[]): string {
  if (moves.length <= 1) return `Moved ${plan.node.path} to ${plan.newPath}.\nThe old path stays valid: tools called with it are redirected.`
  const listed = moves.slice(0, LISTED_MAX).map((move) => `- ${move.from} → ${move.to}`)
  const more = moves.length - listed.length
  return [
    `Moved ${plan.node.path} to ${plan.newPath} with its descendants:`,
    ...listed,
    ...(more > 0 ? [`- … and ${formatCount(more)} more`] : []),
    "The old paths stay valid: tools called with them are redirected.",
  ].join("\n")
}

/**
 * Déplace un nœud et son sous-arbre (AC6, AC9) : `input` validé par `moveNodeSchema` (chemins H51),
 * `path` résolu par `findNode` (alias compris), chaque refus de l'AC9 décidé avant la mise à jour ;
 * rend le texte, les déplacements des nœuds que la personne lit, et la cible du journal (le nouveau
 * chemin). Aucun alias écrit ici : la base les inscrit (P13). `action` : `rename` pour le chemin qui suit
 * un titre publié (`rename.ts`), au niveau écriture (E11-S02).
 */
export async function moveNode(db: PlatformDb, identity: Identity, input: unknown, action: MoveAction = "move"): Promise<MoveResult> {
  const parsed = moveNodeSchema.safeParse(input)
  if (!parsed.success) throw invalidInput(parsed.error)
  const request = parsed.data
  refuseUnderRoot(request.new_path)
  const plan = await decide(db, identity, request, action)
  const named = await visibleSubtree(db, identity, plan.node)
  await applyMove(db, identity, request, { plan, action })
  const paths = await currentPaths(db, identity, named.map((row) => row.id))
  const moves = named.flatMap((row) => {
    const to = paths.get(row.id)
    return to === undefined ? [] : [{ from: row.path, to }]
  })
  const owner = await ownerOf(db, plan.node.id)
  return { text: movedText(plan, moves), moves, target: plan.newPath, teamId: teamOf(owner) }
}
