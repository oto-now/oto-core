// Équipes, membres et accès plateforme (E05-S03) : un schéma pour le formulaire (ui/), l'API (api/)
// et les services (server/) — un schéma, une source de vérité (H02). Les types de sortie sont ceux
// que les services rendent et que l'écran `/teams` reçoit tels quels.
import * as z from "zod/v4"

/** Nom d'une équipe : 60 caractères au plus, espaces retirés (AC11). */
const teamNameSchema = z.string().trim().min(1).max(60)

export const createTeamSchema = z.object({ name: teamNameSchema })

export type CreateTeam = z.output<typeof createTeamSchema>

/**
 * Au moins un champ. `leadUserId` fait de la personne le seul responsable de l'équipe, `null` n'en laisse
 * aucun (`admin_team set_lead`, E05-S13 AC-25) ; les écrans nomment les responsables un à un
 * (`teamRoleSchema`). `rules` n'est plus écrit (P39).
 */
export const updateTeamSchema = z
  .object({ name: teamNameSchema.optional(), leadUserId: z.uuid().nullable().optional() })
  .refine((value) => value.name !== undefined || value.leadUserId !== undefined, {
    message: "Give a name or a leadUserId.",
  })

export type UpdateTeam = z.output<typeof updateTeamSchema>

export const teamMemberSchema = z.object({ userId: z.uuid() })

/** Le rôle d'une personne dans une équipe : responsable, ou membre (E05-S13, AC-24 ; plusieurs responsables). */
export const teamRoleSchema = z.object({ role: z.enum(["lead", "member"]) })

/** Le rôle d'un membre de l'organisation (AC7) ; l'équipe par défaut ne s'écrit plus (E05-S13, fiche D128). */
export const updateMemberSchema = z.object({ role: z.enum(["admin", "member"]) })

/** Les onglets d'« Équipes & accès » (E05-S13, AC-5 : « Règles d'accès » et « Accès plateforme » retirés). */
const EQUIPES_TABS = ["members", "teams"] as const

/**
 * Paramètres de l'adresse `/teams`, en anglais (E11-S07), lus par la page, jamais passés bruts à une requête
 * (`api-patterns.md § Search & Filter`). Une valeur illisible retombe sur le défaut : un onglet
 * inconnu, ou retiré, montre « Membres » (AC1, AC-5).
 */
export const equipesSearchSchema = z.object({
  tab: z.enum(EQUIPES_TABS).catch("members"),
})

export type EquipesTab = (typeof EQUIPES_TABS)[number]

export type MemberRoleView = "admin" | "member"

export type MemberView = {
  userId: string
  email: string
  name: string
  role: MemberRoleView
  teams: { id: string; name: string; role: "lead" | "member" }[]
  lastSignInAt: string | null
  isSelf: boolean
}

export type TeamView = {
  id: string
  slug: string
  name: string
  /** Les noms des responsables, par ordre alphabétique, joints par « , » ; `null` : aucun (AC-23). */
  leadName: string | null
  /** Les responsables d'abord, puis par nom. */
  members: { userId: string; name: string; email: string; role: "lead" | "member" }[]
}

/**
 * Une équipe lue par le « ⋯ » de sa section du rail (`GET teams/<slug>`) : elle, les personnes de l'organisation, et ce
 * que la personne peut y faire (composer : l'administrateur ou un responsable ; `admin` : nommer les responsables, supprimer).
 */
export type TeamPanel = {
  team: TeamView
  people: { id: string; name: string; email: string }[]
  compose: boolean
  admin: boolean
}

/**
 * Ce que la suppression d'une équipe emporterait, ou ce qui la bloque (E08-S02, AC21 ; 1.4.13), lu par la confirmation
 * de l'écran (`GET teams/<slug>/deletion`) et par `admin_team delete`.
 */
export type TeamDeletionView = {
  team: { id: string; slug: string; name: string }
  /** Ce qu'elle possède encore de vivant (H69), lu comme le refus `team_owns_objects` ; `null` : rien. */
  blockedBy: { nodes: { path: string }[]; accounts: { label: string }[] } | null
  members: { name: string; email: string }[]
  /** Règles d'accès qui la nomment, qui tombent avec elle (cascade, H69). */
  rules: number
  /** Ses pages à la corbeille, sous-pages comprises, effacées définitivement avec elle. */
  trashed: number
}

/** Un nom ou un email `null` : la personne n'est plus lisible (compte supprimé entre-temps). */
export type PlatformAccessView = {
  id: string
  userId: string
  name: string | null
  email: string | null
  grantedAt: string
  grantedByName: string | null
  revokedAt: string | null
  revokedByName: string | null
  /** Motif posé à l'accord (`creation` pour l'accès du créateur de l'organisation). */
  reason: string | null
}

/**
 * Un membre de l'organisation ajouté par l'équipe plateforme (fiche D17, option A) : lui-même
 * porteur d'un accès plateforme (`via: "staff"`), ou entré par une invitation d'un porteur.
 */
export type StaffAddedMemberView = {
  userId: string
  name: string
  email: string
  role: MemberRoleView
  via: "staff" | "invitation"
  invitedByName: string | null
  joinedAt: string | null
}

export type PlatformAccessOverview = {
  accesses: PlatformAccessView[]
  addedByStaff: StaffAddedMemberView[]
}
