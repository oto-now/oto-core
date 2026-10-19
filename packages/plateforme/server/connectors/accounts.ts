// Comptes de connecteurs (H67, H85, FR-ADMIN-02, FR-ADMIN-03) : créer un compte, simulé ou réel selon son
// connecteur, lister les comptes qu'une personne peut utiliser, désactiver ; et la lecture commune aux résolutions
// (équipe porteuse, compte), au bloc `team` et au secret d'un compte (`account-secret.ts`). Sans ce module, aucun
// compte ne se pose hors de l'outillage. Aucun secret n'est rendu (NFR-ADMIN-01) : chaque requête liste ses colonnes,
// `secret_ciphertext` et `token_ciphertext` ne sont pas accordées en lecture à `authenticated`, et leurs chiffrés ne se
// lisent que par `platform.account_secret` et `platform.account_token`, pour l'appel au tiers. Chaque droit et chaque
// filtre se décident ici, avant la requête, par `access.ts` (E01-S07 AC23) : la RLS n'est qu'un
// garde-fou. Face SQL (E01-S10, lot d1) : chaque lecture ou écriture dans une transaction `db.tx`, les
// décisions d'`access.ts` et l'annuaire hors d'elle.
//
// Repris d'Oto (`docs\roles-and-resolution.md`) : un libellé déjà pris est refusé. Retiré : compte par
// défaut `is_default`, paliers tenant et plateforme (architecture § 10).
import {
  ACCOUNT_LEVEL_NAMES,
  connectorRefSchema,
  createAccountSchema,
  disableAccountSchema,
  type AccountLevelName,
  type AccountMark,
  type AccountMarkReason,
  type AccountMode,
  type AccountView,
} from "../../schemas"
import {
  ACCOUNT_LEVELS,
  accountLevel,
  accountLevels,
  administrators,
  describeOwner,
  isOrgAdmin,
  leadsTeam,
  type AccountLevel,
  type Owner,
} from "../access"
import { declaredConnector } from "../catalog/connector-source"
import { catalogFunctions } from "../catalog/registry"
import type { PlatformDb } from "../db"
import { leadNames, leadWord, memberDirectory, teamsWithLeads } from "../directory"
import { fromDatabaseError, inTransaction, invalidInput, isUniqueViolation, PlatformError } from "../errors"
import type { Identity } from "../identity"
import { isJsonObject } from "../json"
import type { Tx } from "../sql"
import { requireActivable } from "./activations"
import { keepDeclaredConnector } from "./declaration"
import { accountMode, isSimulatedConnector, modeLabel } from "./modes"

/**
 * Niveau sur un compte tel que le lit le modèle : 1 lecture, 2 écriture, 3 sensible, 4 gestion (`ACCOUNT_LEVELS`) ; les
 * noms d'`ACCOUNT_LEVEL_NAMES`.
 */
export type LevelName = Exclude<AccountLevelName, "none">

/** Propriétaire d'un compte, décrit comme le lit le modèle : « team Ventes », « organisation », « personal ». */
export type AccountOwner = Owner & { description: string }

/** Un compte tel que les services le rendent : jamais de secret. */
export type AccountSummary = { id: string; label: string; connector: string; mode: AccountMode; owner: AccountOwner }

/**
 * Un compte visible de la personne, avec son état, la raison d'un état `error` (un consentement à reconnecter), sa
 * marque (clé refusée, crédits épuisés), son niveau, et, pour un compte personnel, si sa personne a quitté
 * l'organisation (`ownerLeft`, relu à chaque lecture : son compte ne sert plus aux autres) : ce que lisent les résolutions.
 */
export type ConnectorAccount = AccountSummary & {
  status: string
  statusReason?: string | null
  mark?: AccountMark | null
  level: AccountLevel
  ownerLeft?: boolean
}

/** Les mots d'une raison de marque, dans la langue de la porte. */
const MARK_WORDS: Record<AccountMarkReason, string> = { credential_rejected: "key refused", quota_exhausted: "credits spent" }

/** La marque d'un compte telle que la dit le texte servi : « key refused since 2026-10-17 09:12 UTC ». */
export function markWords(mark: AccountMark): string {
  return `${MARK_WORDS[mark.reason]} since ${mark.at.slice(0, 10)} ${mark.at.slice(11, 16)} UTC`
}

/**
 * La marque lue en base (`health -> 'mark'`, écrite par `platform.mark_account` seule, date en UTC) ; `null` : aucune.
 * Une autre forme ne vient que d'une écriture hors de la fonction : panne nommée, jamais ignorée.
 */
export function markOf(value: unknown): AccountMark | null {
  if (value === null || value === undefined) return null
  const reason = isJsonObject(value) ? value.reason : undefined
  const at = isJsonObject(value) ? value.at : undefined
  if ((reason === "credential_rejected" || reason === "quota_exhausted") && typeof at === "string" && !Number.isNaN(Date.parse(at))) {
    return { reason, at: new Date(at).toISOString() }
  }
  console.error("[platform] accounts: health.mark of an unknown shape")
  throw new PlatformError("internal", "Internal error.")
}

/**
 * Un compte lu, et le nom de son équipe propriétaire (`team_name`, sous RLS : `null` quand elle ne se lit pas) ; ses
 * réglages en clair, les noms des champs posés de son secret et la date de la dernière saisie, jamais le secret.
 */
export type AccountRow = {
  id: string
  label: string
  connector: string
  mode: string
  status: string
  owner_kind: string
  owner_team_id: string | null
  owner_user_id: string | null
  team_name: string | null
  settings: Record<string, string>
  secret_fields: string[]
  secret_updated_at: string | null
  status_reason: string | null
  /** `health -> 'mark'`, lu par `markOf`. */
  mark: unknown
  /**
   * Compte personnel dont la personne n'est plus membre de l'organisation (`droits-d-acces.md` § Partage d'un compte
   * de connecteur) : il cesse de servir aux autres, rien n'est supprimé. Seul point qui dit qu'un propriétaire n'est
   * plus là : une pause, quand elle existera, s'y ajoutera.
   */
  owner_left: boolean
}

/**
 * Les comptes de l'organisation : ceux d'un connecteur, un seul par son identifiant, les comptes personnels d'une
 * personne, ou tous (un filtre absent, `null`, ne retient rien). Colonnes listées, jamais `secret_ciphertext`, que la
 * base n'accorde pas à `authenticated`.
 */
export function accountRows(sql: Tx, orgId: string, only: { connector?: string; id?: string; ownerUserId?: string } = {}) {
  return sql<AccountRow[]>`
    select a.id, a.label, a.connector, a.mode, a.status, a.owner_kind, a.owner_team_id, a.owner_user_id, t.name as team_name,
           a.settings, a.secret_fields, to_json(a.secret_updated_at) #>> '{}' as secret_updated_at, a.status_reason, a.health -> 'mark' as mark,
           a.owner_kind = 'user' and not exists (select 1 from platform.members m where m.org_id = a.org_id and m.user_id = a.owner_user_id) as owner_left
      from platform.accounts a left join platform.teams t on t.id = a.owner_team_id
     where a.org_id = ${orgId}
       and a.connector = coalesce(${only.connector ?? null}, a.connector)
       and a.id = coalesce(${only.id ?? null}::uuid, a.id)
       and (${only.ownerUserId ?? null}::uuid is null or (a.owner_kind = 'user' and a.owner_user_id = ${only.ownerUserId ?? null}::uuid))`
}

/** Niveau d'un compte visible (1 au moins) : `read`, `write`, `sensitive` ou `manage`, le nom de son rang (N34). */
export function levelName(level: AccountLevel): LevelName {
  const name = ACCOUNT_LEVEL_NAMES[level]
  return name === "none" ? "read" : name
}

export function accountOwner(row: AccountRow): AccountOwner {
  if (row.owner_kind === "team") {
    return { kind: "team", teamId: row.owner_team_id, userId: null, description: `team ${row.team_name ?? "?"}` }
  }
  if (row.owner_kind === "user") return { kind: "user", teamId: null, userId: row.owner_user_id, description: "personal" }
  return { kind: "org", teamId: null, userId: null, description: "organisation" }
}

export function summary(row: AccountRow): AccountSummary {
  return { id: row.id, label: row.label, connector: row.connector, mode: accountMode(row.mode), owner: accountOwner(row) }
}

/**
 * Les comptes du connecteur que la personne voit (niveau 1 au moins), tous états, avec son niveau
 * sur chacun, triés par libellé. Les niveaux se lisent en un lot (`accountLevels`,
 * database-patterns.md § N+1 Queries).
 */
export async function connectorAccounts(db: PlatformDb, identity: Identity, connector: string): Promise<ConnectorAccount[]> {
  const rows = await inTransaction(db, "connectorAccounts: accounts", (sql) => accountRows(sql, identity.org.id, { connector }))
  const levels = await accountLevels(db, identity, rows.map((row) => row.id))
  return (
    rows
      .map((row) => ({
        ...summary(row),
        status: row.status,
        statusReason: row.status_reason,
        mark: markOf(row.mark),
        level: levels.get(row.id) ?? ACCOUNT_LEVELS.none,
        ownerLeft: row.owner_left,
      }))
      // Niveau 0 : un compte que la personne ne voit pas n'est ni servi, ni retenu, ni nommé (H83).
      .filter((account) => account.level >= ACCOUNT_LEVELS.read)
      .sort((a, b) => a.label.localeCompare(b.label, "fr"))
  )
}

/**
 * Qui crée quoi (AC5, AC7), décidé avant l'insertion : un administrateur (`isOrgAdmin`), des comptes
 * d'organisation et d'équipe ; chaque responsable (`leadsTeam`, E05-S13 : une équipe peut en avoir
 * plusieurs), ceux de son équipe ; chacun, son propre compte personnel (N15).
 */
async function requireCreationRight(db: PlatformDb, identity: Identity, account: { owner_kind: string; team_id?: string }): Promise<void> {
  if (account.owner_kind === "user") return
  const isAdmin = isOrgAdmin(identity)
  if (account.owner_kind === "org") {
    if (isAdmin) return
    const who = administrators(identity, await memberDirectory(db, identity.org.id))
    throw new PlatformError("forbidden", `Creating an organisation account is reserved to ${who}.`)
  }
  // `createAccountSchema` exige `team_id` pour un compte d'équipe et le refuse avec son message ;
  // TypeScript ne le sait pas, ce cas est une erreur de câblage.
  if (!account.team_id) {
    console.error("[platform] createAccount: team account without team_id after validation")
    throw new PlatformError("internal", "Internal error.")
  }
  const teamId = account.team_id
  const [team] = await inTransaction(db, "createAccount: teams", (sql) => teamsWithLeads(sql, identity.org.id, teamId))
  if (!team) throw new PlatformError("invalid_arguments", `Unknown team ${account.team_id} in ${identity.org.name}.`)
  if (isAdmin || leadsTeam(identity, account.team_id)) return
  const directory = await memberDirectory(db, identity.org.id)
  const names = leadNames(team.leads, (userId) => directory.find((person) => person.userId === userId)?.name)
  const leads = names.length > 0 ? `its ${leadWord(names.length)} (${names.join(", ")}) and ` : ""
  throw new PlatformError("forbidden", `Creating an account for team ${team.name} is reserved to ${leads}${administrators(identity, directory)}.`)
}

/**
 * Le mode qu'un compte du connecteur admet (H85) : `simule` pour un connecteur simulé, `reel` pour un connecteur
 * réel (son secret se pose ensuite, `setAccountSecret`) ; `sandbox` n'est pas encore admis.
 */
function requireCreatableMode(connector: string, mode: AccountMode): void {
  if (isSimulatedConnector(connector)) {
    if (mode === "simule") return
    throw new PlatformError(
      "unavailable_in_v1",
      `${connector} is simulated in this version: its accounts are simulated, a ${modeLabel(mode)} account is not available. Create it with mode simule.`,
    )
  }
  if (mode === "reel") return
  if (mode === "sandbox") {
    throw new PlatformError("unavailable_in_v1", `Sandbox accounts are not available yet. Create a live account of ${connector} with mode reel.`)
  }
  throw new PlatformError("invalid_arguments", `${connector} is a live connector: its accounts are live, never simulated. Create it with mode reel.`)
}

/**
 * Un connecteur à consentement (`oauth2_user`) n'a pas de compte créé à la main, quel qu'en soit le titulaire : ses
 * jetons ne naissent que du consentement d'une personne, qui en fait un compte personnel. Ce compte se partage ensuite
 * comme tout compte personnel (règles d'accès, sans règle propre).
 */
export function requireNotConsent(connector: string): void {
  if (declaredConnector(connector)?.auth.kind !== "user_consent") return
  throw new PlatformError("invalid_arguments", `Accounts of ${connector} are not created by hand: each person connects their own by consenting (Connect my account), then may share it like any personal account.`)
}

/**
 * L'identifiant d'un compte chez un tiers (`linked_id`) ne s'écrit que par le branchement hébergé, qui le vérifie
 * auprès du tiers (`link_hosted_account`) : une saisie qui le porte est refusée, jamais ignorée en silence.
 */
export function refuseLinkedId(input: unknown, at: Record<string, unknown> | null = null): void {
  const carries = (value: unknown) => typeof value === "object" && value !== null && "linked_id" in value
  if (!carries(input) && !carries(at)) return
  throw new PlatformError("invalid_arguments", "linked_id is never set by hand: it is written only when a person connects their own account (Connect my account).")
}

/**
 * Crée un compte pour un connecteur activable, actif ou non (N12), au mode que son connecteur admet
 * (`requireCreatableMode`). Le mode est posé explicitement : le défaut de la colonne est `reel`. Un libellé déjà
 * pris dans l'organisation, sans casse, tous connecteurs et comptes invisibles compris, est refusé par l'index
 * unique d'E01-S06 (`23505` → `conflict`). L'identifiant chez un tiers (`linked_id`) n'est jamais une saisie. Écrit sous
 * le rôle du serveur, qui tient la liste des connecteurs (`keepDeclaredConnector`) ; l'état prend sa valeur par défaut,
 * actif : `authenticated` n'insère que ce que la personne fournit.
 */
export async function createAccount(db: PlatformDb, identity: Identity, input: unknown): Promise<AccountSummary> {
  refuseLinkedId(input)
  const parsed = createAccountSchema.safeParse(input)
  if (!parsed.success) throw invalidInput(parsed.error)
  const account = parsed.data
  requireActivable(account.connector, catalogFunctions())
  requireNotConsent(account.connector)
  requireCreatableMode(account.connector, account.mode)
  await requireCreationRight(db, identity, account)
  const teamId = account.owner_kind === "team" ? (account.team_id ?? null) : null
  const userId = account.owner_kind === "user" ? identity.user.id : null
  // Une moitié de paire de substitution ne s'écrit jamais telle quelle : U+FFFD.
  const label = account.label.toWellFormed()
  const orgId = identity.org.id
  const row = await db
    .tx(async (sql) => {
      await keepDeclaredConnector(sql, account.connector)
      const [created] = await sql<{ id: string }[]>`
        insert into platform.accounts (org_id, connector, owner_kind, owner_team_id, owner_user_id, label, mode)
        values (${orgId}, ${account.connector}, ${account.owner_kind}, ${teamId}, ${userId}, ${label}, ${account.mode})
        returning id`
      const [written] = await accountRows(sql, orgId, { id: created.id })
      // Relue dans la transaction qui l'écrit, la ligne ne manque que si sa lecture la refuse : une panne,
      // annulée avec l'insertion, jamais un succès sans compte (M32, revue de d1).
      if (!written) {
        console.error(`[platform] createAccount: account ${created.id} written but not read back`)
        throw new PlatformError("internal", "Internal error.")
      }
      return written
    }, "server")
    .catch((error) => {
      if (isUniqueViolation(error)) {
        throw new PlatformError("conflict", `An account labelled ${account.label} already exists in ${identity.org.name}.`)
      }
      throw fromDatabaseError(error, "createAccount: accounts")
    })
  return summary(row)
}

/** État lu en base (colonne texte sous contrainte `check`) ; une valeur inconnue compte comme en erreur. */
function accountStatus(value: string): AccountView["status"] {
  return value === "active" || value === "disabled" ? value : "error"
}

function accountView(row: AccountRow, level: AccountLevel): AccountView {
  const { kind } = accountOwner(row)
  return {
    id: row.id,
    label: row.label,
    connector: row.connector,
    owner: kind === "team" && row.team_name !== null ? { kind, teamName: row.team_name } : { kind },
    mode: accountMode(row.mode),
    status: accountStatus(row.status),
    secret: { fields: row.secret_fields, updatedAt: row.secret_updated_at },
    settings: row.settings,
    statusReason: row.status_reason,
    mark: markOf(row.mark),
    viewerLevel: levelName(level),
  }
}

/**
 * Les comptes de l'organisation que l'appelant voit, désactivés compris, triés par libellé (E08-S03,
 * AC6, AC11 ; `admin_connector` d'E08-S06) : tous lus, puis filtrés au niveau 1 au moins par
 * `accountLevels`, en un lot, jamais par la RLS (H123) : un compte de niveau 0 n'est ni servi ni nommé.
 */
export async function listOrgAccounts(db: PlatformDb, identity: Identity): Promise<AccountView[]> {
  const rows = await inTransaction(db, "listOrgAccounts: accounts", (sql) => accountRows(sql, identity.org.id))
  return visibleViews(db, identity, rows)
}

/**
 * Les comptes personnels de l'appelant, ceux dont il est le propriétaire, désactivés compris, triés par libellé : ce que
 * l'écran Connecteurs montre à un membre (`connecteurs-et-comptes.md` § Écran Connecteurs). Filtrés au niveau 1 au
 * moins comme `listOrgAccounts` : un compte qu'une règle lui fermerait ne se montre pas. Ni le compte d'un autre, même
 * partagé avec lui, ni ceux de ses équipes ou de l'organisation.
 */
export async function listOwnAccounts(db: PlatformDb, identity: Identity): Promise<AccountView[]> {
  const rows = await inTransaction(db, "listOwnAccounts: accounts", (sql) => accountRows(sql, identity.org.id, { ownerUserId: identity.user.id }))
  return visibleViews(db, identity, rows)
}

/** La vue des comptes lus que l'appelant voit (niveau 1 au moins, `accountLevels` en un lot), triée par libellé. */
async function visibleViews(db: PlatformDb, identity: Identity, rows: AccountRow[]): Promise<AccountView[]> {
  const levels = await accountLevels(db, identity, rows.map((row) => row.id))
  return rows
    .flatMap((row) => {
      const level = levels.get(row.id) ?? ACCOUNT_LEVELS.none
      return level >= ACCOUNT_LEVELS.read ? [accountView(row, level)] : []
    })
    .sort((a, b) => a.label.localeCompare(b.label, "fr"))
}

/**
 * Les comptes actifs du connecteur que la personne peut utiliser (AC8) : ceux qu'elle voit
 * (`connectorAccounts`), avec son niveau (`read`, `write`, `sensitive`, `manage`), le mode et le propriétaire décrit ;
 * jamais le compte d'une personne partie, qui ne sert plus (`ownerLeft`). Un connecteur inconnu ou natif est refusé
 * comme à la création d'un compte (N35).
 */
export async function listUsableAccounts(
  db: PlatformDb,
  identity: Identity,
  input: unknown,
): Promise<(AccountSummary & { level: LevelName })[]> {
  const parsed = connectorRefSchema.safeParse(input)
  if (!parsed.success) throw invalidInput(parsed.error)
  requireActivable(parsed.data.connector, catalogFunctions())
  const accounts = await connectorAccounts(db, identity, parsed.data.connector)
  return accounts
    .filter((account) => account.status === "active" && account.ownerLeft !== true)
    .map(({ id, label, connector: name, mode, owner, level }) => ({ id, label, connector: name, mode, owner, level: levelName(level) }))
}

/**
 * Le compte nommé, si l'appelant le gère (gestion, `ACCOUNT_LEVELS.manage` : responsable d'un compte d'équipe, administrateur d'un compte
 * d'organisation, propriétaire d'un compte personnel), décidé avant toute écriture ou tout appel au tiers. Inconnu ou
 * invisible (niveau 0) : `not_found` ; sous le niveau : `forbidden`, qui dit qui le gère.
 */
export async function managedAccount(db: PlatformDb, identity: Identity, id: string, use: { service: string; gesture: string }): Promise<AccountRow> {
  const [row] = await inTransaction(db, `${use.service}: accounts`, (sql) => accountRows(sql, identity.org.id, { id }))
  const level = row ? await accountLevel(db, identity, id) : ACCOUNT_LEVELS.none
  if (!row || level === ACCOUNT_LEVELS.none) throw new PlatformError("not_found", `Unknown account ${id}.`)
  if (level < ACCOUNT_LEVELS.manage) {
    const who = await describeOwner(db, identity, accountOwner(row))
    throw new PlatformError("forbidden", `${use.gesture} « ${row.label} » is reserved to those who manage it: ${who}.`)
  }
  return row
}

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
