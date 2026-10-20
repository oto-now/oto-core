// Les libellés français de l'écran « Équipes et droits » (E05-S03, porté sur oto-frontend par E05-S09
// partie d1) : rôles, niveaux, propriétaires, et les phrases des tableaux, des menus et des dialogues. Les
// refus vont dans la table de `messageDErreur` (`ui/api/messages.ts`) ; ici, seules les phrases de refus
// qui nomment l'organisation, que la table ne connaît pas, quand deux gestes les disent.
import type { AccessLevelName, EquipesTab, MemberRoleView, NodeRulesView } from "../../schemas"
import type { ErreurPlateforme } from "../api/client"
import type { MessagesDuGeste } from "../api/messages"
import { SECTION_PERSO } from "../arbre/depuis-l-arbre"

/** La saisie d'un nom d'équipe refusée avant l'envoi (AC11) : la phrase, jamais le message de Zod. */
export const NOM_D_EQUIPE_INVALIDE = "Le nom compte de 1 à 60 caractères."

/** Un refus qui se corrige en changeant le nom se rend sous le champ ; le reste est global. */
export function surLeNom(erreur: ErreurPlateforme): boolean {
  return erreur.raison === "name_taken" || erreur.raison === "slug_taken" || erreur.raison === "reserved_slug" || erreur.raison === "path_taken"
}

/** Les refus d'un nom d'équipe qui nomment l'organisation, à la création comme au renommage (AC11, AC12). */
export function refusDuNom(nomOrganisation: string): MessagesDuGeste {
  return {
    name_taken: `Une équipe de ${nomOrganisation} porte déjà ce nom.`,
    slug_taken: `Une autre équipe de ${nomOrganisation} utilise déjà le chemin de ce nom : choisissez-en un autre.`,
  }
}

/** Le refus de rétrograder ou de retirer le dernier administrateur (AC7, AC9). */
export function refusDuDernierAdministrateur(nomOrganisation: string): MessagesDuGeste {
  return { last_admin: `C'est le dernier administrateur de ${nomOrganisation} : nommez-en un autre avant.` }
}

export const ROLES: Record<MemberRoleView, string> = {
  admin: "Administrateur",
  member: "Membre",
}

export const ROLES_D_EQUIPE: Record<"lead" | "member", string> = { lead: "Responsable", member: "Membre" }

export const NIVEAUX: Record<AccessLevelName, string> = {
  none: "Aucun accès",
  read: "Lecture",
  write: "Écriture",
  manage: "Gestion",
}

/** Ni « espace » ni « dossier » à l'écran (P39) : l'équipe, l'organisation, ou la personne et sa section Privé. */
export function proprietaire(owner: NodeRulesView["owner"]): string {
  if (owner.kind === "team") {
    const equipe = `équipe ${owner.teamName ?? "inconnue"}`
    // `leadName` joint les responsables par « , » (E05-S13, AC-23) ; le mot suit leur nombre, un nom
    // pouvant lui-même porter une virgule.
    return owner.leadName ? `${equipe} (${(owner.leadCount ?? 1) > 1 ? "responsables" : "responsable"} : ${owner.leadName})` : `${equipe} (sans responsable)`
  }
  if (owner.kind === "user") return `${owner.userName ?? "un ancien membre"} (${SECTION_PERSO})`
  return "l'organisation"
}

/** La règle qui s'applique sans règle posée, selon le propriétaire (H66 (3)). */
export const REGLE_PAR_DEFAUT: Record<NodeRulesView["owner"]["kind"], string> = {
  org: "Sans règle : lecture pour tous les membres.",
  team: "Sans règle : écriture pour l'équipe, gestion pour ses responsables, rien pour les autres.",
  user: "Sans règle : son propriétaire seul.",
}

/** Le motif posé à l'accord d'un accès plateforme ; `creation` est celui du créateur de l'organisation. */
export function motifDAcces(reason: string | null): string | undefined {
  if (!reason) return undefined
  return reason === "creation" ? "création de l'organisation" : reason
}

/** « 1 personne », « 3 personnes » : le nombre et le mot accordé (`pluralize` d'oto-frontend). */
export function pluriel(nombre: number, singulier: string, plurielDuMot: string): string {
  return `${nombre} ${nombre > 1 ? plurielDuMot : singulier}`
}

/**
 * Le titre de l'écran, et celui de ses deux onglets (E05-S13, AC-5 : les droits se règlent contenu par
 * contenu dans « Partager », les accès plateforme depuis la console de l'équipe Oto).
 */
export const ECRAN = "Équipes & accès"

export const ONGLETS: readonly { cle: EquipesTab; libelle: string }[] = [
  { cle: "members", libelle: "Membres" },
  { cle: "teams", libelle: "Équipes" },
]

/** Les responsables d'une équipe à l'écran (E05-S13, AC-24 : une équipe en a zéro, un ou plusieurs). */
export const RESPONSABLES = {
  colonne: "Responsables",
  aucun: "—",
  nommer: "Nommer responsable",
  retirer: "Retirer des responsables",
} as const

/** Les phrases du tableau des personnes (porté d'oto-frontend, `members-table.tsx`, `members-counters.tsx`). */
export const PERSONNES = {
  chercher: "Chercher une personne",
  compteurs: "Les personnes en chiffres",
  personnes: "personnes",
  personne: "personne",
  dansLOrganisation: (organisation: string) => `dans ${organisation}`,
  invitations: "invitations",
  invitation: "invitation",
  enAttente: "en attente de réponse",
  legende: (organisation: string) => `Les personnes de ${organisation}`,
  aucunResultat: "Personne ne correspond",
  aucunResultatTexte: "D'autres personnes font partie de l'organisation, sous un autre état ou sous un autre nom.",
  voirTout: "Voir tout le monde",
  seul: "Vous êtes seul ici",
  seulTexte: "Les personnes que vous inviterez apparaîtront ici, avec les équipes dont elles font partie.",
  membre: "Membre",
  invitee: "Invitée",
  vous: " · vous",
  aucune: "Aucune",
  jamais: "Jamais",
  expire: (date: string) => `expire le ${date}`,
  invitePar: (nom: string | null) => (nom ? `invitée par ${nom}` : "invitée hors de l'organisation"),
} as const

/** Les colonnes du tableau des personnes, dans l'ordre. */
export const COLONNES_DES_PERSONNES = {
  personne: "Personne",
  statut: "Statut",
  role: "Rôle",
  equipes: "Équipes",
  connexion: "Dernière connexion",
  actions: "Actions",
} as const

/** Le niveau de chaque membre sur le dossier de l'équipe, dans « Les personnes de … » (1.4.12). */
export const NIVEAUX_DU_DOSSIER = {
  explication: "Le niveau d'un membre vaut pour toutes les pages de l'équipe ; « Partager » le change sur une page.",
} as const
