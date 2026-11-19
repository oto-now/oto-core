// Les gestes sur un compte existant, réservés à qui le gère (`managedAccount`, décidé avant l'écriture) : le désactiver
// (AC9), le réactiver, le renommer et le décrire (`connecteurs-et-comptes.md` § Écran Connecteurs). Chaque écriture
// passe sous le rôle du serveur, qui seul modifie l'état, le libellé et la description d'un compte ; la réactivation
// revérifie ce que vérifie la création (`createAccount`, `accounts.ts`) : connecteur ouvert et capacités de l'hôte.
import { disableAccountSchema, type AccountView } from "../../schemas"
import { updateAccountSchema } from "../../schemas/connectors"
import { ACCOUNT_LEVELS } from "../access"
import type { PlatformDb } from "../db"
import { fromDatabaseError, inTransaction, invalidInput, isUniqueViolation, PlatformError } from "../errors"
import type { Identity } from "../identity"
import { orgLimits, requireAdmittedAccountOwner, requireUnderAccountsPerOwner, type LimitScope } from "../limits"
import { ownerNames } from "../directory"
import { accountOwner, accountRows, accountView, labelTaken, managedAccount, summary, type AccountSummary } from "./accounts"
import { closedConnector, openConnectorForAccount } from "./activations"

/**
 * Désactive un compte (AC9) : réservé à qui le gère (la gestion : responsable d'un compte d'équipe,
 * administrateur d'un compte d'organisation, propriétaire d'un compte personnel), décidé avant
 * l'écriture. Inconnu ou invisible (niveau 0) : `not_found`. Déjà désactivé : rien n'est écrit. Une
 * écriture qui ne rend aucune ligne après la décision est un conflit (HN-E01S07-6). L'état d'un compte ne s'écrit
 * que sous le rôle du serveur.
 */
export async function disableAccount(
  db: PlatformDb,
  identity: Identity,
  input: unknown,
): Promise<AccountSummary & { status: "disabled" }> {
  const parsed = disableAccountSchema.safeParse(input)
  if (!parsed.success) throw invalidInput(parsed.error)
  const id = parsed.data.account_id
  const row = await managedAccount(db, identity, id, { service: "disableAccount", gesture: "Disabling" })
  if (row.status !== "disabled") {
    const updated = await inTransaction(
      db,
      "disableAccount: accounts update",
      (sql) => sql`update platform.accounts set status = 'disabled' where id = ${id} returning id`,
      "server",
    )
    // Aucune ligne après la décision : le compte a changé entre la lecture et l'écriture.
    if (updated.length === 0) {
      console.error(`[platform] disableAccount: no row written for account ${id}`)
      throw new PlatformError("conflict", `Account « ${row.label} » changed meanwhile. Reload it and retry.`)
    }
  }
  return { ...summary(row), status: "disabled" }
}

/** Le compte relu après une écriture du service, vu par qui le gère ; une ligne qui manque est une panne. */
async function managedView(db: PlatformDb, identity: Identity, id: string, service: string): Promise<AccountView> {
  const [row] = await inTransaction(db, `${service}: accounts`, (sql) => accountRows(sql, identity.org.id, { id }))
  if (!row) {
    console.error(`[platform] ${service}: account ${id} written but not read back`)
    throw new PlatformError("internal", "Internal error.")
  }
  return accountView(row, ACCOUNT_LEVELS.manage, await ownerNames(db, identity.org.id, [row]))
}

/**
 * Renomme un compte, pose ou efface sa description (`PATCH admin/accounts/<id>`) : réservé à qui le gère, décidé avant
 * l'écriture (`managedAccount`). Aucun alias : l'ancien libellé ne désigne plus rien (un appel qui le nomme rend
 * `unknown_named`, avec les comptes utilisables). Refus : inconnu ou invisible (`not_found`), non géré (`forbidden`),
 * libellé vide ou de plus de 80 caractères, description de plus de 200 (`invalid_arguments`), libellé déjà pris par le
 * même propriétaire (`conflict`, `label_taken`). Écrit sous le rôle du serveur ; rend le compte tel que l'écran le lit.
 */
export async function updateAccount(db: PlatformDb, identity: Identity, input: unknown): Promise<AccountView> {
  const parsed = updateAccountSchema.safeParse(input)
  if (!parsed.success) throw invalidInput(parsed.error)
  const id = parsed.data.account_id
  const change = parsed.data.input
  await managedAccount(db, identity, id, { service: "updateAccount", gesture: "Changing" })
  // Une moitié de paire de substitution ne s'écrit jamais telle quelle : U+FFFD.
  const label = change.label?.toWellFormed() ?? null
  const description = change.description === undefined ? undefined : change.description ? change.description.toWellFormed() : null
  // `db.tx` et non `inTransaction` : la violation d'unicité se lit avant sa traduction (`label_taken`).
  const updated = await db
    .tx(
      (sql) => sql`
        update platform.accounts
           set label = coalesce(${label}::text, label),
               description = case when ${description !== undefined} then ${description ?? null}::text else description end
         where id = ${id} and org_id = ${identity.org.id}
         returning id`,
      "server",
    )
    .catch((error) => {
      if (isUniqueViolation(error)) throw labelTaken(label ?? "", identity.org.name)
      throw fromDatabaseError(error, "updateAccount: accounts update")
    })
  // Aucune ligne après la décision : le compte a disparu entre la lecture et l'écriture.
  if (updated.length === 0) {
    console.error(`[platform] updateAccount: no row written for account ${id}`)
    throw new PlatformError("conflict", `Account ${id} changed meanwhile. Reload it and retry.`)
  }
  return managedView(db, identity, id, "updateAccount")
}

/**
 * Réactive un compte désactivé (`POST admin/accounts/<id>/enable`), le pendant de `disableAccount` : réservé à qui le
 * gère ; son secret a été gardé, rien à ressaisir. Revérifie, dans la transaction qui l'écrit, ce que vérifie la
 * création : le connecteur ouvert (`openConnectorForAccount` : fermé par un administrateur, `not_enabled`, `closed`) et
 * les capacités de l'hôte (`account_owner_kinds`, `accounts_per_owner_max`). Refus : inconnu ou invisible (`not_found`),
 * non géré (`forbidden`), pas désactivé (`conflict`, `not_disabled`). Écrit sous le rôle du serveur.
 */
export async function enableAccount(db: PlatformDb, identity: Identity, input: unknown): Promise<AccountView> {
  const parsed = disableAccountSchema.safeParse(input)
  if (!parsed.success) throw invalidInput(parsed.error)
  const id = parsed.data.account_id
  const row = await managedAccount(db, identity, id, { service: "enableAccount", gesture: "Enabling" })
  if (row.status !== "disabled") {
    throw new PlatformError("conflict", `Account « ${row.label} » is not disabled: there is nothing to enable.`, { reason: "not_disabled" })
  }
  const owner = accountOwner(row)
  const scope: LimitScope = { db, identity, limits: await orgLimits(identity.org) }
  requireAdmittedAccountOwner(scope, owner.kind)
  const enabled = await inTransaction(
    db,
    "enableAccount: accounts update",
    async (sql) => {
      if ((await openConnectorForAccount(sql, scope, row.connector)) === "closed") return null
      await requireUnderAccountsPerOwner(sql, scope, { connector: row.connector, owner })
      return sql`update platform.accounts set status = 'active' where id = ${id} and status = 'disabled' returning id`
    },
    "server",
  )
  if (enabled === null) throw await closedConnector(db, identity, row.connector)
  // Aucune ligne après la décision : le compte a changé entre la lecture et l'écriture.
  if (enabled.length === 0) {
    console.error(`[platform] enableAccount: no row written for account ${id}`)
    throw new PlatformError("conflict", `Account « ${row.label} » changed meanwhile. Reload it and retry.`)
  }
  return managedView(db, identity, id, "enableAccount")
}
