// Qui crée un compte pour quel propriétaire (AC5, AC7, N15) : la règle de la création, une seule, que lisent la création
// d'un compte (`requireCreationRight` d'`accounts.ts`) et l'écran Connecteurs (`accountOwnerChoices`, pour qui la
// personne peut créer). Sans elle, l'écran redirait la règle.
import type { AccountOwnerChoices } from "../../schemas"
import { isOrgAdmin, leadsTeam } from "../access"
import type { PlatformDb } from "../db"
import { teamsWithLeads } from "../directory"
import { inTransaction } from "../errors"
import type { Identity } from "../identity"

/** Le propriétaire d'un compte à créer, tel que la règle de la création le lit. */
export type CreatedOwner = { kind: "user" } | { kind: "org" } | { kind: "team"; teamId: string }

/**
 * Qui crée quoi (AC5, AC7), la seule règle, que lisent la création (`requireCreationRight`) et l'écran
 * (`accountOwnerChoices`) : un administrateur (`isOrgAdmin`), des comptes d'organisation et d'équipe ; chaque
 * responsable (`leadsTeam`, E05-S13 : une équipe peut en avoir plusieurs), ceux de son équipe ; chacun, son propre
 * compte personnel (N15).
 */
export function mayCreateAccountFor(identity: Identity, owner: CreatedOwner): boolean {
  if (owner.kind === "user") return true
  if (isOrgAdmin(identity)) return true
  return owner.kind === "team" && leadsTeam(identity, owner.teamId)
}

/**
 * Pour qui la personne peut créer un compte, d'après la règle de la création (`mayCreateAccountFor`) : elle-même ;
 * l'organisation ; les équipes de l'organisation qu'elle peut doter, par nom (une lecture des équipes, sous l'appelant).
 * Ce que l'écran Connecteurs propose au choix du propriétaire, avant les `ownerKinds` du connecteur.
 */
export async function accountOwnerChoices(db: PlatformDb, identity: Identity): Promise<AccountOwnerChoices> {
  const teams = await inTransaction(db, "accountOwnerChoices: teams", (sql) => teamsWithLeads(sql, identity.org.id))
  return {
    user: true,
    org: mayCreateAccountFor(identity, { kind: "org" }),
    teams: teams
      .filter((team) => mayCreateAccountFor(identity, { kind: "team", teamId: team.id }))
      .map(({ id, name }) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "fr")),
  }
}
