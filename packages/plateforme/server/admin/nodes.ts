// Propriétaire d'un nœud (E08-S06, AC3, AC4 ; N2, N3, N19) : ce que change un transfert, puis le
// transfert. Le service décide avant toute écriture (H123) : la gestion du nœud (`requireNodeLevel`,
// action `transfer`), puis l'écriture dans l'espace qui le reçoit (règle de JB du 27/11, qui remplace la
// fiche D18 B : `refuseDestination`) ; `nodes_guard` d'E01-S04 et `nodes_gesture_guard` (`20261127150000`)
// restent les secondes barrières.
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
import { ownerRefSchema } from "../../schemas"
import { ACCESS_LEVELS, describeOwner, nodeLevels, requireNodeLevel, reservedTo, ROOT_PATH, unknownPath, type Owner } from "../access"
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

type Decided = { node: NodeRow; owner: Owner | null; plan: TransferPlan }

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

/** Le propriétaire explicite demandé : `null` pour `inherit`, qui retire les colonnes (H52, N32). */
function explicitOwner(ref: ResolvedRef): Owner | null {
  if (ref.kind === "inherit") return null
  if (ref.kind === "team") return { kind: "team", teamId: ref.team.id, userId: null }
  if (ref.kind === "user") return { kind: "user", teamId: null, userId: ref.person.userId }
  return { kind: "org", teamId: null, userId: null }
}

function sameOwner(node: NodeRow, owner: Owner | null): boolean {
  if (!owner) return node.owner_kind === null
  return node.owner_kind === owner.kind && (node.owner_team_id ?? null) === owner.teamId && (node.owner_user_id ?? null) === owner.userId
}

/**
 * Les descendants qui tiennent leur propriétaire du nœud (H52) : sans propriétaire explicite, de parent
 * en enfants jusqu'au prochain qui en porte un ; comptés parmi ceux que l'appelant lit (niveau ≥ 1, en un
 * lot, `security-patterns.md § Droits dans le service`).
 */
async function inheritorsOf(db: PlatformDb, identity: Identity, node: NodeRow): Promise<number> {
  const org = identity.org.id
  const rows = await inTransaction(db, "transfer: descendants", (sql) => sql<{ id: string }[]>`
    with recursive heirs as (
      select n.id from platform.nodes n where n.org_id = ${org} and n.parent_id = ${node.id} and n.owner_kind is null
      union
      select n.id from platform.nodes n join heirs h on n.parent_id = h.id where n.org_id = ${org} and n.owner_kind is null
    )
    select id from heirs`)
  const found = rows.map((row) => row.id)
  const levels = await nodeLevels(db, identity, found)
  return found.filter((id) => (levels.get(id) ?? ACCESS_LEVELS.none) >= ACCESS_LEVELS.read).length
}

/**
 * L'espace qui reçoit le nœud (règle de JB du 27/11, qui remplace la fiche D18 B) : y écrire, comme pour y créer un
 * contenu, administrateur compris. Son propre Privé : toujours ; le Privé d'une autre personne : jamais, décidé sans
 * requête ; Tout le monde : l'écriture sur la racine ; une équipe : l'écriture sur son dossier ; `inherit` : l'écriture
 * sur le parent, dont le nœud tiendra son propriétaire. `nodes_gesture_guard` (`20261127150000`) juge la même règle.
 */
async function refuseDestination(db: PlatformDb, identity: Identity, node: NodeRow, target: { resolved: ResolvedRef; parent: string }): Promise<void> {
  const { resolved } = target
  if (resolved.kind === "user") {
    if (resolved.person.userId === identity.user.id) return
    throw new PlatformError(
      "forbidden",
      `${node.path} cannot go to the private space of ${resolved.person.name}: only they put content there. Give it to yourself, or to a team or the organisation you write in.`,
    )
  }
  const [path, place] =
    resolved.kind === "org" ? [ROOT_PATH, "the organisation (Tout le monde)"] : resolved.kind === "team" ? [resolved.team.slug, `team ${resolved.team.name}`] : [target.parent, `${target.parent} (its parent)`]
  const found = await findNode(db, identity, path)
  // Le dossier d'une équipe porte l'équipe pour propriétaire (`teams_tree_sync`) ; sans lui, rien où écrire.
  const there = resolved.kind === "team" && found?.node.owner_team_id !== resolved.team.id ? null : found
  if (there && there.level >= ACCESS_LEVELS.write) return
  const owner: Owner | null = resolved.kind === "team" ? { kind: "team", teamId: resolved.team.id, userId: null } : there ? await ownerOf(db, there.node.id) : null
  const who = owner ? await describeOwner(db, identity, owner) : "its managers"
  throw new PlatformError("forbidden", `${node.path} cannot go to ${place}: you do not write there. ${reservedTo("write", `in ${place}`, who)}`)
}

/**
 * Les refus dans l'ordre d'AC4, avant toute écriture : `owner` mal formé, racine, nœud inconnu ou
 * invisible (H68 : un espace personnel est introuvable pour l'administrateur, H61, H66), `private` ou un
 * espace personnel, gestion, équipe ou personne inconnue, espace qui le reçoit sans l'écriture ; puis ce
 * qui change.
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
  // Le même propriétaire ne change pas d'espace : rien à juger, rien à écrire.
  if (!sameOwner(node, owner)) await refuseDestination(db, identity, node, { resolved, parent: parent.path })
  const [current, inherited, inheritors] = await Promise.all([ownerOf(db, node.id), owner ? null : ownerOf(db, parent.id), inheritorsOf(db, identity, node)])
  const [before, after] = await Promise.all([ownerDescription(db, identity, current), ownerDescription(db, identity, owner ?? inherited)])
  const plan: TransferPlan = {
    path: node.path,
    before,
    after,
    inheritors,
    person: resolved.kind === "user" ? resolved.person.name : null,
    parent: owner ? null : parent.path,
    unchanged: sameOwner(node, owner),
  }
  return { node, owner, plan }
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
  const { node, owner, plan } = await decide(db, identity, input)
  if (plan.unchanged) return { ...plan, changed: 0 }
  // `updated_at` tel que `findNode` le lit (texte à la microseconde), converti dans la requête.
  const written = await inTransaction(db, "transferOwner: nodes", (sql) => sql`
    update platform.nodes
       set owner_kind = ${owner?.kind ?? null}, owner_team_id = ${owner?.teamId ?? null}, owner_user_id = ${owner?.userId ?? null},
           updated_by = ${identity.user.id}
     where org_id = ${identity.org.id} and id = ${node.id} and updated_at = ${node.updated_at}::text::timestamptz
    returning id`)
  if (written.length === 0) throw changedMeanwhile("transferOwner", node.id, `${node.path} changed meanwhile: retry the transfer.`)
  return { ...plan, changed: plan.inheritors + 1 }
}
