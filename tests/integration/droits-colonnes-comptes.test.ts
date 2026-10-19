// @vitest-environment node
// Droits de colonnes de `platform.accounts` pour `authenticated`, lus sur une vraie base (garde mécanique ;
// `packages/plateforme/migrations/README.md` § Règles). Depuis `20261017090000`, l'insertion est accordée colonne
// par colonne pour tenir `linked_id` hors de portée : une colonne ajoutée sans son `GRANT INSERT(…)` casserait la
// création d'un compte en silence, et une colonne ajoutée sans son `GRANT SELECT(…)` sa lecture. Toute colonne
// s'insère et se lit, sauf les listes fermées ci-dessous, chacune avec sa raison. Depuis `20261017150000`, `health` (la
// marque d'un compte) se lit mais ne s'insère ni ne se met à jour : `platform.mark_account` seule l'écrit. Depuis
// `20261019130000`, `authenticated` n'insère que ce que la personne fournit et ne modifie aucune colonne ; l'état, sa
// raison, les réglages, le secret, les jetons et les droits accordés se modifient sous le rôle du serveur seul.
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { pendingMigrations, pendingReason } from "../helpers/pending-migrations"
import { SQL_SKIP_REASON, sqlConfigured, testAdminSql, type TestSql } from "../helpers/sql"

const VERSION = "20261017090000"
const MARK_VERSION = "20261017150000"
const SERVER_VERSION = "20261019130000"
const VERSIONS = [VERSION, MARK_VERSION, SERVER_VERSION]
const missing = await pendingMigrations()
const pending = VERSIONS.some((version) => missing.includes(version))

/** Ce que pose le serveur, jamais la personne : un compte neuf en prend la valeur par défaut. */
const BY_THE_SERVER = "set by the server only, under platform_server; a new account takes its default"

/** Colonnes qu'`authenticated` n'insère pas : la base ou le serveur seuls les écrivent. */
const NOT_INSERTED: Record<string, string> = {
  id: "drawn by the database",
  created_at: "set by the database",
  updated_at: "set by the database",
  linked_id: "written only by platform.link_hosted_account (a person connects their own account)",
  linked_at: "written only by platform.link_hosted_account, with linked_id",
  health: "written only by platform.mark_account (the mark of an account); a new account takes its default",
  status: BY_THE_SERVER,
  status_reason: BY_THE_SERVER,
  settings: BY_THE_SERVER,
  secret_ciphertext: BY_THE_SERVER,
  secret_fields: BY_THE_SERVER,
  secret_updated_at: BY_THE_SERVER,
  token_ciphertext: BY_THE_SERVER,
  token_expires_at: BY_THE_SERVER,
  granted_scopes: BY_THE_SERVER,
}

/** Colonnes que `platform_server` modifie, et lui seul : `authenticated` ne modifie aucune colonne d'un compte. */
const UPDATED_BY_SERVER = ["status", "status_reason", "settings", "secret_ciphertext", "secret_fields", "secret_updated_at", "token_ciphertext", "token_expires_at", "granted_scopes"]

/** Colonnes qu'`authenticated` ne lit pas : chiffrés, et l'identifiant d'un compte rattaché. */
const NOT_READ: Record<string, string> = {
  secret_ciphertext: "a ciphertext, read only by the engine's own query",
  token_ciphertext: "a ciphertext, read only by the engine's own query",
  linked_id: "read only through platform.account_linked_id, at the call",
  linked_at: "goes with linked_id",
}

/** Colonnes qu'`authenticated` ne peut ni insérer, ni lire, ni modifier : la clé de l'hôte atteint tout compte rattaché. */
const NEVER = ["linked_id", "linked_at"]

/** Colonnes qu'`authenticated` lit sans les écrire : une seule fonction les écrit. */
const WRITTEN_BY_FUNCTION: Record<string, string> = { health: "platform.mark_account" }

type Privileges = { column_name: string; can_insert: boolean; can_select: boolean; can_update: boolean; server_updates: boolean }

const suite = !sqlConfigured
  ? `accounts column privileges (${SQL_SKIP_REASON})`
  : pending
    ? `accounts column privileges (${pendingReason(VERSIONS.filter((version) => missing.includes(version)))})`
    : "column privileges of platform.accounts for authenticated"

describe.skipIf(!sqlConfigured || pending)(suite, () => {
  let admin: TestSql
  let columns: Privileges[]

  beforeAll(async () => {
    admin = testAdminSql()
    columns = await admin<Privileges[]>`
      select column_name,
             has_column_privilege('authenticated', 'platform.accounts', column_name, 'INSERT') as can_insert,
             has_column_privilege('authenticated', 'platform.accounts', column_name, 'SELECT') as can_select,
             has_column_privilege('authenticated', 'platform.accounts', column_name, 'UPDATE') as can_update,
             has_column_privilege('platform_server', 'platform.accounts', column_name, 'UPDATE') as server_updates
        from information_schema.columns
       where table_schema = 'platform' and table_name = 'accounts'
       order by ordinal_position`
  })

  afterAll(async () => {
    await admin?.end({ timeout: 5 })
  })

  it("should name only columns that exist in the closed lists", () => {
    const existing = new Set(columns.map((column) => column.column_name))
    const stale = [...Object.keys(NOT_INSERTED), ...Object.keys(NOT_READ), ...NEVER, ...Object.keys(WRITTEN_BY_FUNCTION)].filter((name) => !existing.has(name))
    expect(stale.map((name) => `platform.accounts.${name} is in a closed list of this test but no longer exists: remove it from the list.`)).toEqual([])
  })

  it("should let authenticated insert and read every column of accounts, outside the closed lists", () => {
    const problems = columns.flatMap((column) => [
      ...(!column.can_insert && !(column.column_name in NOT_INSERTED)
        ? [
            `platform.accounts.${column.column_name}: authenticated cannot INSERT it, so creating an account breaks. Add it to the GRANT INSERT(…) ON platform.accounts TO authenticated in its migration, or, if only the database writes it, to NOT_INSERTED in this test with the reason.`,
          ]
        : []),
      ...(!column.can_select && !(column.column_name in NOT_READ)
        ? [
            `platform.accounts.${column.column_name}: authenticated cannot SELECT it, so reading an account breaks. Add it to the GRANT SELECT(…) ON platform.accounts TO authenticated in its migration, or, if it must stay unread, to NOT_READ in this test with the reason.`,
          ]
        : []),
      ...(column.can_insert && column.column_name in NOT_INSERTED ? [`platform.accounts.${column.column_name}: authenticated can INSERT it, though ${NOT_INSERTED[column.column_name]}. Take it out of the GRANT INSERT(…) in its migration.`] : []),
      ...(column.can_select && column.column_name in NOT_READ ? [`platform.accounts.${column.column_name}: authenticated can SELECT it, though ${NOT_READ[column.column_name]}. Take it out of the GRANT SELECT(…) in its migration.`] : []),
    ])
    expect(problems).toEqual([])
  })

  it("should let authenticated neither insert, read nor update linked_id", () => {
    const reachable = columns
      .filter((column) => NEVER.includes(column.column_name))
      .flatMap((column) =>
        (["insert", "select", "update"] as const)
          .filter((privilege) => column[`can_${privilege}`])
          .map((privilege) => `platform.accounts.${column.column_name}: authenticated can ${privilege.toUpperCase()} it. Revoke it in its migration: only platform.link_hosted_account writes it, and the host's key reaches every linked account.`),
      )
    expect(reachable).toEqual([])
    expect(columns.filter((column) => NEVER.includes(column.column_name)).map((column) => column.column_name)).toEqual(NEVER)
  })

  it("should let authenticated read health but neither insert nor update it: only its function writes it", () => {
    const problems = columns
      .filter((column) => column.column_name in WRITTEN_BY_FUNCTION)
      .flatMap((column) => [
        ...(!column.can_select ? [`platform.accounts.${column.column_name}: authenticated cannot SELECT it, so the mark of an account is not shown.`] : []),
        ...(["insert", "update"] as const)
          .filter((privilege) => column[`can_${privilege}`])
          .map((privilege) => `platform.accounts.${column.column_name}: authenticated can ${privilege.toUpperCase()} it. Revoke it in its migration: only ${WRITTEN_BY_FUNCTION[column.column_name]} writes it.`),
      ])
    expect(problems).toEqual([])
  })

  it("should let authenticated update no column of accounts, and platform_server only the state, settings, secret, tokens and granted scopes", () => {
    expect(columns.filter((column) => column.can_update).map((column) => `platform.accounts.${column.column_name}: authenticated can UPDATE it. Grant it to platform_server only: the service writes an account under the server role.`)).toEqual([])
    expect(columns.filter((column) => column.server_updates).map((column) => column.column_name).sort()).toEqual([...UPDATED_BY_SERVER].sort())
  })
})
