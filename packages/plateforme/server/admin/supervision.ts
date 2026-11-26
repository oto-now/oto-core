// La supervision de la plateforme (administration et cellule, N9) : l'équipe plateforme liste toutes les organisations
// de la cellule, sans accès daté, avec leurs membres et rôles, leurs appels des 30 derniers jours, leurs connecteurs
// actifs et leurs comptes par connecteur et titulaire. Une seule brique de données, que lisent l'écran de supervision
// (`EcranSupervision`) et le MCP admin (`admin_org overview`, `members`). Le droit se décide ici, avant toute lecture
// (`requireStaff`, H123) ; les trois fonctions `staff_org_*` le redécident en base (`is_staff()`, sinon 42501). Le
// contenu, l'administration et la fiche `get` restent derrière l'accès daté (`resolveAdminOrg`).
//
// Face SQL : `db.tx` sous l'appelant (`inTransaction`) ; les trois lectures dans une transaction.
import { SUPERVISION_DAYS, type SupervisedAccounts, type SupervisedMember, type SupervisedOrg } from "../../schemas"
import type { PlatformDb } from "../db"
import { inTransaction, PlatformError } from "../errors"
import { memberRole } from "../identity"
import type { Tx } from "../sql"
import { requireStaff } from "./context"

type OverviewRow = {
  id: string
  slug: string
  name: string
  prefix: string
  created_at: string
  members: number
  teams: number
  calls: number
  active_connectors: number
  accounts: number
}
type MemberRow = { org_id: string; user_id: string; email: string | null; name: string | null; role: string; since: string }
type AccountsRow = { org_id: string; connector: string; owner_kind: string; owner_label: string | null; status: string; mode: string; accounts: number }

const DAY_MS = 24 * 3600 * 1000

/** Le début de la fenêtre des appels comptés, à la milliseconde (`supabase-patterns.md § Couplage à Supabase`). */
function windowStart(): Date {
  return new Date(Date.now() - SUPERVISION_DAYS * DAY_MS)
}

// Les colonnes sous contrainte `check` de la base (`accounts_owner_kind_check`, `accounts_status_check`,
// `accounts_mode_check`), relues dans leur union.
function ownerKind(value: string): SupervisedAccounts["ownerKind"] {
  return value === "team" || value === "user" ? value : "org"
}

function accountStatus(value: string): SupervisedAccounts["status"] {
  return value === "disabled" || value === "error" ? value : "active"
}

function accountMode(value: string): SupervisedAccounts["mode"] {
  return value === "simule" || value === "sandbox" ? value : "reel"
}

function memberOf(row: MemberRow): SupervisedMember {
  return { userId: row.user_id, email: row.email, name: row.name, role: memberRole(row.role), since: row.since }
}

function accountsOf(row: AccountsRow): SupervisedAccounts {
  return {
    connector: row.connector,
    ownerKind: ownerKind(row.owner_kind),
    ownerLabel: row.owner_label,
    status: accountStatus(row.status),
    mode: accountMode(row.mode),
    accounts: row.accounts,
  }
}

/** Les membres et les comptes d'une organisation (`org`), ou de toutes (`null`), en deux lectures de la même transaction. */
async function readDetails(sql: Tx, org: string | null): Promise<{ members: MemberRow[]; accounts: AccountsRow[] }> {
  const members = await sql<MemberRow[]>`
    select m.org_id, m.user_id, m.email, m.name, m.role, to_json(m.since) #>> '{}' as since
      from platform.staff_org_members(${org}::uuid) m`
  const accounts = await sql<AccountsRow[]>`
    select a.org_id, a.connector, a.owner_kind, a.owner_label, a.status, a.mode, a.accounts
      from platform.staff_org_accounts(${org}::uuid) a`
  return { members, accounts }
}

function supervisedOrg(row: OverviewRow, members: readonly MemberRow[], accounts: readonly AccountsRow[]): SupervisedOrg {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    prefix: row.prefix,
    createdAt: row.created_at,
    members: row.members,
    teams: row.teams,
    calls: row.calls,
    activeConnectors: row.active_connectors,
    accounts: row.accounts,
    people: members.filter((member) => member.org_id === row.id).map(memberOf),
    accountGroups: accounts.filter((group) => group.org_id === row.id).map(accountsOf),
  }
}

function overviewOf(sql: Tx, slug: string | null) {
  // `slug` nul : toutes les organisations ; rangées par slug par la fonction.
  return sql<OverviewRow[]>`
    select o.id, o.slug, o.name, o.prefix, to_json(o.created_at) #>> '{}' as created_at,
           o.members, o.teams, o.calls, o.active_connectors, o.accounts
      from platform.staff_org_overview(${windowStart()}) o
     where ${slug}::text is null or o.slug = ${slug}::text
     order by o.slug`
}

/**
 * Toutes les organisations de la plateforme (N9), rangées par slug, chacune avec ses chiffres, ses membres et ses
 * comptes : réservé à l'équipe plateforme (`forbidden` sinon, avant toute lecture), sans accès daté.
 */
export async function listPlatformOrgs(db: PlatformDb, caller: { email: string }): Promise<SupervisedOrg[]> {
  await requireStaff(db, caller)
  const { overview, details } = await inTransaction(db, "listPlatformOrgs: staff_org_overview, staff_org_members, staff_org_accounts", async (sql) => ({
    overview: await overviewOf(sql, null),
    details: await readDetails(sql, null),
  }))
  return overview.map((row) => supervisedOrg(row, details.members, details.accounts))
}

/**
 * Une organisation de la plateforme par son slug (N9) : ses chiffres, ses membres et rôles, ses comptes par
 * connecteur et titulaire. Réservé à l'équipe plateforme (`forbidden`), sans accès daté ; un slug inconnu : `not_found`.
 */
export async function readPlatformOrg(db: PlatformDb, caller: { email: string }, slug: string): Promise<SupervisedOrg> {
  await requireStaff(db, caller)
  return inTransaction(db, "readPlatformOrg: staff_org_overview, staff_org_members, staff_org_accounts", async (sql) => {
    // `slug` est unique (`orgs_slug_key`) : une ligne au plus.
    const [row] = await overviewOf(sql, slug)
    if (!row) throw new PlatformError("not_found", `Unknown organisation ${slug}. List them all with admin_org {"op": "overview"}.`)
    const { members, accounts } = await readDetails(sql, row.id)
    return supervisedOrg(row, members, accounts)
  })
}
