// Propriétaire d'un nœud (E08-S06, AC3, AC4 ; N2, N3, N19) : ce que change un transfert, puis le
// transfert. Le service décide avant toute écriture (H123) : la gestion du nœud (`requireNodeLevel`,
// action `transfer`), qui suffit aussi pour le rendre personnel (fiche D18 B, M26) ; `nodes_guard`
// d'E01-S04 reste la seconde barrière.
// Seul `nodes` s'écrit : blocs publiés, brouillons et lignes suivent le niveau du nœud (ADR-011 § 2).
// Sans ce module, aucun service ne change le propriétaire d'un nœud ; un futur écran s'en sert aussi.
//
// Repris d'Oto (`oto_mcp/capabilities/resources.py` l. 537-547) : prévenir avant une perte de contrôle ;
// retiré : l'exemption du super-admin et « le meilleur partage gagne » (ici la règle la plus proche,
// H66). (`oto_mcp/ownership.py` l. 396-439) : une équipe hors de l'organisation est impossible (`findTeam`
// ne lit que la sienne) ; retiré : l'ancien propriétaire personne qui garde l'écriture (H52).
//
// Face SQL (E01-S10, lot d2) : les héritiers en une lecture récursive, l'écriture gardée par l'`updated_at`
// lu en texte (`findNode`), chacune dans sa transaction (`inTransaction`, `members.ts`).
// Depuis que l'espace est écrit sur chaque nœud (migration 20261103150000) : les héritiers sont les descendants qui
// portent le même propriétaire que le nœud, sans interruption, et le transfert l'écrit sur eux aussi ; `inherit` écrit
// celui du parent. Un transfert est le geste explicite qui change un espace ; un déplacement ne le change pas.
import { ownerRefSchema } from "../../schemas"
import { ACCESS_LEVELS, describeOwner, nodeLevels, requireNodeLevel, ROOT_PATH, unknownPath, type Owner } from "../access"
import type { PlatformDb } from "../db"
import { memberDirectory } from "../directory"
import { changedMeanwhile, inTransaction, PlatformError } from "../errors"
import type { Identity } from "../identity"
import { findNode, parentPath, type NodeRow } from "../nodes/lookup"
import { ownerOf } from "../nodes/view"
import { readRef, resolveRef, type ResolvedRef } from "./context"

/** Ce qu'un transfert change (AC3) : la gestion avant et après, décrite, et les descendants qui héritent. */
export type TransferPlan = {
  path: string
  before: string
  after: string
  /** Descendants que l'appelant lit et qui tiennent leur propriétaire du nœud (H52). */
  inheritors: number
  /** Le nouveau propriétaire est une personne : son nom (N2 : administrateurs et équipe plateforme perdent l'accès). */
  person: string | null
  /** `inherit` : le parent dont le nœud tiendra son propriétaire. */
  parent: string | null
  /** Le propriétaire demandé est déjà celui du nœud : rien à écrire. */
  unchanged: boolean
}

/** Un transfert fait : `changed`, les nœuds qui ont reçu le propriétaire (le nœud et ses héritiers), 0 sans écriture. */
export type Transfer = TransferPlan & { changed: number }

type TransferInput = { path: string; owner: unknown }

/** `owner` : le propriétaire écrit, celui du parent pour `inherit` ; `heirs` : les descendants qui le suivent. */
type Decided = { node: NodeRow; owner: Owner | null; heirs: string[]; plan: TransferPlan }

/**
 * Un propriétaire tel que le MCP admin le décrit (AC1, AC3 à AC5) : l'équipe et son responsable ou les
 * administrateurs de l'organisation (`describeOwner`, E01-S04), la personne par son nom, « (personal) ».
 */
export async function ownerDescription(db: PlatformDb, identity: Identity, owner: Owner | null): Promise<string> {
  if (!owner) return "no known owner"
  if (owner.kind !== "user") return describeOwner(db, identity, owner)
  const person = (await memberDirectory(db, identity.org.id)).find((entry) => entry.userId === owner.userId)
  return `${person?.name ?? "a former member"} (personal)`
}

/** Le propriétaire effectif du nœud du chemin, décrit (« Owner now », AC1) ; un chemin qu'on ne lit plus : aucun. */
export async function describeNodeOwner(db: PlatformDb, identity: Identity, path: string): Promise<string> {
  const found = await findNode(db, identity, path)
  return ownerDescription(db, identity, found ? await ownerOf(db, found.node.id) : null)
}

/** La racine appartient à l'organisation (N3, H52 ; `nodes_root_owner_check`). */
function rootRefusal(): PlatformError {
  return new PlatformError("invalid_arguments", "The root guide always belongs to the organisation.")
}

/**
 * `private` et un espace personnel gardent leur propriétaire (H61), comme `moveNode` les garde en place
 * (E03-S07 AC9) ; `nodes_guard` refuse aussi, depuis M26, un autre propriétaire pour `private/<handle>`
 * (seconde barrière). Chemin lu en base, déjà validé ; motif ancré, une seule lecture par caractère.
 */
function refuseStructure(path: string): void {
  if (path === "private") throw new PlatformError("invalid_arguments", "The owner of private cannot change: it holds the personal spaces.")
  if (/^private\/[^/]+$/.test(path)) throw new PlatformError("invalid_arguments", `The owner of ${path} cannot change: it is a personal space.`)
}

/** Le propriétaire explicite demandé : `null` pour `inherit`, qui écrit celui du parent (H52). */
function explicitOwner(ref: ResolvedRef): Owner | null {
  if (ref.kind === "inherit") return null
  if (ref.kind === "team") return { kind: "team", teamId: ref.team.id, userId: null }
  if (ref.kind === "user") return { kind: "user", teamId: null, userId: ref.person.userId }
  return { kind: "org", teamId: null, userId: null }
}

function sameOwner(node: NodeRow, owner: Owner | null): boolean {
  if (!owner) return false
  return node.owner_kind === owner.kind && (node.owner_team_id ?? null) === owner.teamId && (node.owner_user_id ?? null) === owner.userId
}

/**
 * Les descendants qui partagent l'espace du nœud (H52) : de parent en enfants, tant qu'ils portent le même
 * propriétaire que lui ; un descendant d'un autre espace (rendu personnel, transféré) et ce qu'il range gardent le leur.
 */
async function heirsOf(db: PlatformDb, identity: Identity, node: NodeRow): Promise<string[]> {
  const org = identity.org.id
  const owner = [node.owner_kind, node.owner_team_id ?? null, node.owner_user_id ?? null]
  const rows = await inTransaction(db, "transfer: descendants", (sql) => sql<{ id: string }[]>`
    with recursive heirs as (
      select n.id from platform.nodes n
       where n.org_id = ${org} and n.parent_id = ${node.id}
         and (n.owner_kind, n.owner_team_id, n.owner_user_id) is not distinct from (${owner[0]}::text, ${owner[1]}::uuid, ${owner[2]}::uuid)
      union
      select n.id from platform.nodes n join heirs h on n.parent_id = h.id
       where n.org_id = ${org}
         and (n.owner_kind, n.owner_team_id, n.owner_user_id) is not distinct from (${owner[0]}::text, ${owner[1]}::uuid, ${owner[2]}::uuid)
    )
    select id from heirs`)
  return rows.map((row) => row.id)
}

/** Les héritiers que l'appelant lit (niveau ≥ 1, en un lot, `security-patterns.md § Droits dans le service`). */
async function readableCount(db: PlatformDb, identity: Identity, ids: string[]): Promise<number> {
  const levels = await nodeLevels(db, identity, ids)
  return ids.filter((id) => (levels.get(id) ?? ACCESS_LEVELS.none) >= ACCESS_LEVELS.read).length
}

/**
 * Les refus dans l'ordre d'AC4, avant toute écriture : `owner` mal formé, racine, nœud inconnu ou
 * invisible (H68 : un espace personnel est introuvable pour l'administrateur, H61, H66), `private` ou un
 * espace personnel, gestion, équipe ou personne inconnue ; puis ce qui change.
 */
async function decide(db: PlatformDb, identity: Identity, input: TransferInput): Promise<Decided> {
  const ref = readRef(ownerRefSchema, input.owner)
  if (input.path === ROOT_PATH) throw rootRefusal()
  const found = await findNode(db, identity, input.path)
  if (!found) throw new PlatformError("not_found", unknownPath(input.path))
  const { node } = found
  if (!node.parent_id) throw rootRefusal()
  refuseStructure(node.path)
  if (found.level < ACCESS_LEVELS.manage) await requireNodeLevel(db, identity, node, "transfer")
  const resolved = await resolveRef(db, identity, ref)
  const owner = explicitOwner(resolved)
  // Le chemin du parent se déduit du chemin (`nodes_guard` : le chemin est celui du parent plus un segment).
  const parent = { id: node.parent_id, path: parentPath(node.path) ?? ROOT_PATH }
  // Fiche D18 B (M26) : rendre le nœud personnel n'est plus réservé à l'administrateur ; la gestion suffit.
  const [current, inherited, heirs] = await Promise.all([ownerOf(db, node.id), owner ? null : ownerOf(db, parent.id), heirsOf(db, identity, node)])
  const [before, after, inheritors] = await Promise.all([ownerDescription(db, identity, current), ownerDescription(db, identity, owner ?? inherited), readableCount(db, identity, heirs)])
  const plan: TransferPlan = {
    path: node.path,
    before,
    after,
    inheritors,
    person: resolved.kind === "user" ? resolved.person.name : null,
    parent: owner ? null : parent.path,
    unchanged: sameOwner(node, owner ?? inherited),
  }
  return { node, owner: owner ?? inherited, heirs, plan }
}

/** Le premier temps de `transfer_owner` (AC3, N2) : ce qui changerait, sans rien écrire. */
export async function describeTransfer(db: PlatformDb, identity: Identity, input: TransferInput): Promise<TransferPlan> {
  return (await decide(db, identity, input)).plan
}

/**
 * Le second temps (AC4) : les colonnes du propriétaire écrites sous le jeton de l'appelant, gardées par
 * l'`updated_at` lu (une course n'écrase rien) ; le même propriétaire n'écrit rien ; zéro ligne après la
 * décision → `conflict`, journalisé (HN-E01S07-6).
 */
export async function transferOwner(db: PlatformDb, identity: Identity, input: TransferInput): Promise<Transfer> {
  const { node, owner, heirs, plan } = await decide(db, identity, input)
  if (plan.unchanged) return { ...plan, changed: 0 }
  if (!owner) throw new PlatformError("internal", "Internal error.")
  // `updated_at` tel que `findNode` le lit (texte à la microseconde), converti dans la requête ; les héritiers dans la
  // même transaction, sous les mêmes droits (la gestion de chacun, `nodes_gesture_guard`).
  const written = await inTransaction(db, "transferOwner: nodes", async (sql) => {
    const set = sql`owner_kind = ${owner.kind}, owner_team_id = ${owner.teamId}, owner_user_id = ${owner.userId}, updated_by = ${identity.user.id}`
    const done = await sql`
      update platform.nodes set ${set}
       where org_id = ${identity.org.id} and id = ${node.id} and updated_at = ${node.updated_at}::text::timestamptz
      returning id`
    if (done.length > 0 && heirs.length > 0) await sql`update platform.nodes set ${set} where org_id = ${identity.org.id} and id in ${sql(heirs)}`
    return done
  })
  if (written.length === 0) throw changedMeanwhile("transferOwner", node.id, `${node.path} changed meanwhile: retry the transfer.`)
  return { ...plan, changed: plan.inheritors + 1 }
}
