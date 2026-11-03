// L'espace d'un nœud créé par `write` (`droits-d-acces.md` § Propriétaires, déplacements, personnel ; décidé avec JB le
// 03/11) : Privé d'une personne, une équipe ou Tout le monde, écrit sur le nœud à sa création (migration
// 20261103150000), et la ligne de la réponse qui le dit. Une écriture qui ne nomme aucun espace partagé tombe dans le
// Privé de son auteur : le code le garantit, pas une consigne à l'assistant. Sans ce module, un chemin écrit hors d'un
// dossier d'équipe ou du Privé publiait la page à toute l'organisation.
import type { Owner } from "../access"
import type { PlatformDb } from "../db"
import { PlatformError } from "../errors"
import type { Identity } from "../identity"
import type { NodeRow } from "./lookup"
import { ownerTexts } from "./view"
import type { WriteOrigin } from "./write-result"

/** Ce que l'écriture demande : `everyone` (Tout le monde), `private` (le Privé de l'auteur), ou rien. */
export type SpaceAsked = "everyone" | "private" | undefined

/** Le propriétaire écrit sur une ligne de `nodes` ; `null` s'il n'en porte pas (impossible depuis 20261103150000). */
export function rowOwner(row: Pick<NodeRow, "owner_kind" | "owner_team_id" | "owner_user_id">): Owner | null {
  const { owner_kind: kind } = row
  if (kind !== "org" && kind !== "team" && kind !== "user") return null
  return { kind, teamId: row.owner_team_id ?? null, userId: row.owner_user_id ?? null }
}

/**
 * Le propriétaire d'un nœud créé sous `parent` : `null` pour l'espace du parent (la base le recopie), sinon le Privé de
 * l'auteur. Nomment un espace : `space`, un parent dans une équipe ou dans un Privé (le chemin y écrit), et le geste de
 * l'écran, qui crée sous la section où la personne a cliqué. Sinon, sous Tout le monde, c'est le Privé de l'auteur.
 */
export function ownerAtCreation(identity: Identity, input: { parent: NodeRow; space: SpaceAsked; origin: WriteOrigin }): Owner | null {
  const { parent, space, origin } = input
  const inParent = rowOwner(parent)
  const own: Owner = { kind: "user", teamId: null, userId: identity.user.id }
  if (space === "everyone") {
    if (inParent?.kind !== "org") {
      throw new PlatformError(
        "invalid_arguments",
        `space everyone creates in the shared space, and ${parent.path} is not in it: create the content under a folder of the shared space, or share it afterwards with ${identity.org.prefix}_call node.share.`,
      )
    }
    return null
  }
  const named = space === undefined && (inParent?.kind !== "org" || origin.kind === "human")
  if (named) return null
  if (inParent?.kind === "user" && inParent.userId === identity.user.id) return null
  if (!identity.member.profile.handle) {
    throw new PlatformError(
      "invalid_arguments",
      `You have no private space in ${identity.org.name}, where a content written without a space goes: pass space "everyone", or write under a team folder.`,
    )
  }
  return own
}

/**
 * La ligne de la réponse d'une création (décidé avec JB le 02/11 : la portée dite après coup) : l'espace où le nœud est
 * tombé et qui le lit ; `defaulted`, quand l'écriture n'a nommé aucun espace et que le Privé l'a pris.
 */
export async function spaceLine(db: PlatformDb, identity: Identity, owner: Owner | null, defaulted: boolean): Promise<{ text: string; space: "everyone" | "team" | "private" }> {
  const { line } = await ownerTexts(db, identity, owner, false)
  if (owner?.kind === "org") return { text: `Space: everyone (${line}): every member can read it.`, space: "everyone" }
  if (owner?.kind === "team") return { text: `Space: ${line}: its members see it.`, space: "team" }
  if (owner?.userId !== identity.user.id) return { text: `Space: private space of ${line.replace(/ \(personal\)$/, "")}: only its owner and those they share it with see it.`, space: "private" }
  const hint = defaulted ? ` No space was named: to create a content for everyone, write it with space "everyone".` : ""
  return { text: `Space: your private space: only you see it.${hint}`, space: "private" }
}
