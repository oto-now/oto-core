// Les lignes du tableau des personnes (E05-S09, partie d1) : chaque membre et chaque invitation en attente,
// une ligne chacun, comme dans oto-frontend (`members-table.tsx` : une personne invitée est une ligne
// « Invitée ») ; cherchées, filtrées et triées ici, sur la liste entière que la page de l'hôte a lue
// (`listMembers` et `listInvitations` rendent tout, sans page). Repris d'oto-frontend
// (`members-columns.tsx`, `trierLesPersonnes`) : le tri par nom en `localeCompare` français, jamais `<`.
// Retiré : les pages enchaînées (`useAllMembers`), le filtre `active` sans tuile.
import type { InvitationRole, MemberRoleView, MemberView, ReglagesDesListes } from "../../schemas"
import type { InvitationEnAttente, Moi } from "./types"

export type LigneDeMembre = {
  genre: "membre"
  id: string
  nom: string
  email: string
  soi: boolean
  role: MemberRoleView
  equipes: { id: string; nom: string }[]
  derniereConnexion: string | null
}

export type LigneDInvitation = {
  genre: "invitation"
  id: string
  email: string
  role: InvitationRole
  /** Le nom de l'équipe où la personne entrera ; `null` : aucune. */
  equipe: string | null
  /** Le nom de qui l'a envoyée, ou `null` : hors de l'organisation. */
  invitePar: string | null
  /** `null` : une inscription sans email, qui n'expire pas. */
  expiration: string | null
  /** L'administrateur, ou qui l'a envoyée (E02-S01). */
  annulable: boolean
}

export type LigneDePersonne = LigneDeMembre | LigneDInvitation

/** Ce qu'il faut pour nommer les invitations : la personne qui invite et l'équipe, lues ailleurs. */
export type InvitationsLues = { invitations: InvitationEnAttente[]; nomsDesEquipes: ReadonlyMap<string, string> }

// Minuscules et sans accents : « Émile » se trouve en tapant « emile ».
function normaliser(texte: string): string {
  return texte.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("fr")
}

function versLigneDeMembre(membre: MemberView): LigneDeMembre {
  return {
    genre: "membre",
    id: membre.userId,
    nom: membre.name,
    email: membre.email,
    soi: membre.isSelf,
    role: membre.role,
    equipes: membre.teams.map((equipe) => ({ id: equipe.id, nom: equipe.name })),
    derniereConnexion: membre.lastSignInAt,
  }
}

function versLignesDInvitation(lues: InvitationsLues, noms: ReadonlyMap<string, string>, moi: Moi): LigneDInvitation[] {
  return lues.invitations.map((invitation) => ({
    genre: "invitation",
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    equipe: invitation.teamId ? (lues.nomsDesEquipes.get(invitation.teamId) ?? null) : null,
    invitePar: (invitation.invitedBy && noms.get(invitation.invitedBy)) || null,
    expiration: invitation.expiresAt,
    annulable: moi.estAdmin || invitation.invitedBy === moi.userId,
  }))
}

/** Le nom qui range une ligne : celui de la personne, l'adresse d'une invitation. */
export function nomDeLaLigne(ligne: LigneDePersonne): string {
  return ligne.genre === "membre" ? ligne.nom : ligne.email
}

/** Une ligne répond à la recherche par son nom ou son adresse. */
function repond(ligne: LigneDePersonne, recherche: string): boolean {
  if (recherche === "") return true
  const cherche = normaliser(recherche)
  return [nomDeLaLigne(ligne), ligne.email].some((texte) => normaliser(texte).includes(cherche))
}

/**
 * Les lignes montrées : les membres et, quand elles sont lues, les invitations ; `filtre=invitations`
 * garde les seules invitations ; la recherche porte sur le nom et l'adresse ; triées par nom.
 */
export function lignesDesPersonnes(membres: MemberView[], invitations: InvitationsLues | null, moi: Moi, reglages: ReglagesDesListes): LigneDePersonne[] {
  const noms = new Map(membres.map((membre) => [membre.userId, membre.name]))
  const deMembres = reglages.filter === "invitations" ? [] : membres.map(versLigneDeMembre)
  const dInvitations = invitations ? versLignesDInvitation(invitations, noms, moi) : []
  const sens = reglages.order === "desc" ? -1 : 1
  return [...deMembres, ...dInvitations]
    .filter((ligne) => repond(ligne, reglages.q))
    .sort((a, b) => sens * nomDeLaLigne(a).localeCompare(nomDeLaLigne(b), "fr"))
}
