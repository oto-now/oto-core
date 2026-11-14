// Capacités d'une organisation (E12-S02, ADR-022) : le registre fermé des limites que les services vérifient avant
// d'écrire et que les écrans lisent pour griser un geste. Les valeurs viennent de l'hôte (`registerOrgLimits`,
// `server/limits.ts`) ; une clé absente ne limite rien. Aucune clé n'est un nom d'offre. Sans lui, service, écran et
// hôte tiendraient chacun leur liste de limites.
import * as z from "zod/v4"

/** Les propriétaires d'un compte de connecteur (`accounts.owner_kind`). */
export const ACCOUNT_OWNER_KINDS = ["org", "team", "user"] as const

const count = (description: string) => z.number().int().min(0).max(1_000_000).describe(description)

/**
 * Le registre : chaque clé, son type et ce qu'elle limite, toutes facultatives. `strictObject` : une clé inconnue est
 * une erreur de l'hôte, jamais ignorée.
 */
export const orgLimitsSchema = z
  .strictObject({
    members_max: count("Members at most, pending invitations included; checked when inviting."),
    teams_max: count("Teams at most; 0 closes team creation."),
    connectors_max: count("Active connectors at most; checked when activating one."),
    storage_bytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).describe("Bytes of attached files at most; 10 GB when absent."),
    account_owner_kinds: z
      .array(z.enum(ACCOUNT_OWNER_KINDS))
      .max(ACCOUNT_OWNER_KINDS.length)
      .describe("Who may own a connector account; checked when creating or enabling an account (ADR-022 § 8)."),
    accounts_per_owner_max: count("Accounts of one connector per owner at most, disabled ones aside; checked when creating or enabling an account (ADR-022 § 8)."),
  })
  .partial()

export type OrgLimits = z.infer<typeof orgLimitsSchema>

/** Une limite comptée, telle qu'un écran la lit : le plafond et ce qui est déjà pris. */
export type LimitState = { max: number; used: number }

/** Ce que les écrans lisent des capacités (`orgLimitsView`) ; `null` : pas de limite. `raiseUrl` : où un administrateur la relève. */
export type OrgLimitsView = {
  members: LimitState | null
  teams: LimitState | null
  connectors: LimitState | null
  raiseUrl: string | null
}

/** Vrai quand un ajout de plus serait refusé. */
export function limitReached(state: LimitState | null | undefined): boolean {
  return state !== null && state !== undefined && state.used >= state.max
}
