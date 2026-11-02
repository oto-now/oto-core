// La supervision de la plateforme (administration et cellule, N9) : ce que l'équipe plateforme lit de chaque
// organisation sans accès daté, partagé par le service (`server/admin/supervision.ts`), le MCP admin et l'écran
// (`EcranSupervision`), que `ui/` ne peut pas tirer de `server/`. Ni clé, ni libellé ni identifiant de compte, ni
// contenu : y entrer exige l'accès daté et journalisé.
import type { AccountMode } from "./connectors"
import type { MemberRoleView } from "./teams"

/** Un membre d'une organisation : email et nom nuls pour une ligne écrite sans email. */
export type SupervisedMember = { userId: string; email: string | null; name: string | null; role: MemberRoleView; since: string }

/** Les comptes d'une organisation regroupés par connecteur, titulaire, état et mode ; `ownerLabel` nul pour l'organisation. */
export type SupervisedAccounts = {
  connector: string
  ownerKind: "org" | "team" | "user"
  ownerLabel: string | null
  status: "active" | "disabled" | "error"
  mode: AccountMode
  accounts: number
}

/** La fenêtre des appels comptés, en jours : celle du service, du MCP admin et des libellés de l'écran. */
export const SUPERVISION_DAYS = 30

/** Une organisation de la plateforme : son identité, ses chiffres (appels des `SUPERVISION_DAYS` derniers jours), ses membres et ses comptes. */
export type SupervisedOrg = {
  id: string
  slug: string
  name: string
  prefix: string
  createdAt: string
  members: number
  teams: number
  calls: number
  activeConnectors: number
  accounts: number
  people: SupervisedMember[]
  accountGroups: SupervisedAccounts[]
}
