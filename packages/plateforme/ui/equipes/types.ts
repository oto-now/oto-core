import type { InvitationRole } from "../../schemas"
import type { LienDeLHote } from "../arbre/navigateur-d-arbre"

/** Ce que l'écran sait de qui le regarde, tiré de l'identité par la page de l'hôte. */
export type Moi = { userId: string; estAdmin: boolean; equipesDirigees: string[] }

/** Les liens d'un onglet : le composant de lien de l'hôte, et l'adresse de l'onglet (« Réessayer »). */
export type Navigation = { Lien: LienDeLHote; ici: string }

/** Une invitation en attente, telle que `listInvitations` (E02-S01) la rend. */
export type InvitationEnAttente = {
  id: string
  email: string
  role: InvitationRole
  /** Les équipes où la personne entrera, celles que qui regarde voit : toutes pour l'administrateur, les siennes pour un responsable. */
  teamIds: string[]
  invitedBy: string | null
  /** `null` : une inscription sans email, qui n'expire pas. */
  expiresAt: string | null
}

/** Ce que `invitationOptions` (E02-S01) rend ; `null` : l'appelant n'invite pas (simple membre). */
export type OptionsDInvitation = { roles: InvitationRole[]; teams: { id: string; name: string }[]; teamRequired: boolean }

/** Les sujets possibles d'une règle : les équipes et les membres de l'organisation. */
export type SujetsDeRegle = { equipes: { id: string; nom: string }[]; personnes: { id: string; nom: string }[] }
