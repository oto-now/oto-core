// @vitest-environment node
// Policies finales de `platform` (E01-S08, AC2 ; HN-E01S08-13), sans base : chaque migration du
// paquet, dans l'ordre de ses fichiers, lue comme la lit `check:migrations` (commentaires et
// littéraux blanchis, instructions coupées hors des corps `$$`) ; la dernière définition d'un nom
// fait foi, un `drop policy` qui la suit la retire (E01-S12 partie c). Une migration future qui remettrait un niveau ou un rôle dans une policy fait échouer ce
// test : les droits sont décidés par les services (`security-patterns.md § Droits dans le service`),
// la RLS ne garde que la frontière entre organisations et les invariants, sauf la liste fermée des policies qui
// reprennent le rôle exigé par leur service (`ROLE_REQUIRED`, migration `20261019150000`). Depuis E01-S09, la ligne de
// base porte les 70 policies que la chaîne laissait (la migration d'isolation qui en recréait 51 est
// dans git) : ce test lit les définitions finales, sans l'histoire des fichiers.
import fs from "fs"
import path from "path"
import { describe, expect, it } from "vitest"
import { clean, splitStatements } from "../../packages/plateforme/cli/migrations-check.mjs"

const MIGRATIONS = path.resolve(__dirname, "../../packages/plateforme/migrations")

/**
 * Les policies que la migration d'isolation d'E01-S08 a recréées sous leur nom (51), moins les cinq
 * neutralisées (`false`) que retire E01-S12 partie c.
 */
const RECREATED = [
  "orgs_update_admin",
  "orgs_delete_admin",
  "members_insert_admin",
  "members_update_admin",
  "members_delete_admin",
  "teams_insert_admin",
  "teams_update_admin",
  "teams_delete_admin",
  "team_members_insert_admin",
  "team_members_update_admin",
  "team_members_delete_admin",
  "org_domains_insert_admin",
  "org_domains_delete_admin",
  "invitations_select_admin",
  "invitations_insert_admin",
  "invitations_update_revoke",
  "nodes_select_level",
  "nodes_insert_writer",
  "nodes_update_writer",
  "nodes_delete_manager",
  "node_drafts_select_writer",
  "node_drafts_update_writer",
  "blocks_insert_writer",
  "blocks_update_writer",
  "blocks_delete_writer",
  "access_rules_select_level",
  "access_rules_insert_manager",
  "access_rules_update_manager",
  "access_rules_delete_manager",
  "accounts_select_member",
  "accounts_insert_admin",
  "accounts_update_admin",
  "accounts_delete_admin",
  "connector_activations_insert_admin",
  "connector_activations_update_admin",
  "connector_activations_delete_admin",
  "sim_outbox_select_level",
  "sim_outbox_insert_writer",
  "sim_outbox_update_writer",
  "journal_select_member",
  "feedback_select_own_admin",
  "feedback_update_admin",
  "platform_grants_select_staff_admin",
  "platform_grants_insert_staff",
  "platform_grants_update_revoke",
  "admin_journal_select_staff_admin",
]

/**
 * Les policies sans droit, laissées par E01-S08 telles que leur migration les posait (19, HN-E01S08-5),
 * moins celle de l'insertion d'un espace personnel dans `nodes`, neutralisée puis retirée par E01-S12
 * partie c.
 */
const UNCHANGED = [
  "orgs_select_member",
  "members_select_member",
  "teams_select_member",
  "team_members_select_member",
  "org_domains_select_member",
  "connector_activations_select_member",
  "ctx_select_member",
  "ctx_insert_own",
  "journal_insert_own",
  "feedback_insert_own",
  "accounts_insert_own",
  "invitations_select_own",
  "platform_staff_select_staff",
  "admin_journal_insert_staff",
  "blocks_select_level",
  "node_versions_select_level",
  "node_aliases_select_level",
  "links_select_level",
]

/** Posées après la ligne de base, avec leur table : chacun lit ses correspondances d'émetteur (E01-S11). */
const ADDED = ["identities_select_own"]
// La lecture fermée du lexique (`false`, E01-S13, HN-E01S13-8), que seules les fonctions du paquet lisent.
ADDED.push("lexicon_select_none")
// Les liens publics (E05-S10, ADR-013) : isolation par organisation, attribution à l'appelant, nœud de l'organisation.
ADDED.push("node_shares_select_member", "node_shares_insert_member", "node_shares_update_member")
// Les fichiers joints (E10-S02, ADR-016) : isolation par organisation, attribution à l'appelant, nœud de l'organisation.
ADDED.push("files_select_member", "files_insert_member", "files_update_member", "files_delete_member")
// Les tickets de dépôt par lien (E10-S02 lot f, ADR-018) : isolation par organisation, attribution à l'appelant, ménage des expirés.
ADDED.push("upload_tickets_select_member", "upload_tickets_insert_own", "upload_tickets_delete_expired")
// Les vues des pages (1.4.13) : lues dans l'organisation, écrites par la personne pour elle-même, ménage au-delà de 90 jours.
ADDED.push("node_views_select_member", "node_views_insert_own", "node_views_update_own", "node_views_delete_expired")
// Les exclusions de l'entrée sans invitation : lues et inscrites dans son organisation, jamais modifiées ni retirées par une session.
ADDED.push("member_exclusions_select_member", "member_exclusions_insert_member")
// La ligne `ctx` de l'appelant avancée par l'auteur d'un Contexte (E11-S19, lot a) : isolation par organisation, attribution à l'appelant.
ADDED.push("ctx_update_own")
// Les connecteurs de l'hôte (prise des connecteurs) : une liste de noms sans organisation, lue par toute session.
ADDED.push("connectors_select_authenticated")
// Les demandes de consentement à un connecteur `oauth2_user` : isolation par organisation, attribution à l'appelant,
// consommation par la personne, ménage des expirées.
ADDED.push("connector_consents_select_own", "connector_consents_insert_own", "connector_consents_delete_own_or_expired")
// Les demandes de branchement hébergé (`accountIdentity`) : même règle que les demandes de consentement.
ADDED.push("hosted_link_requests_select_own", "hosted_link_requests_insert_own", "hosted_link_requests_delete_own_or_expired")
// Le journal des partages d'un compte (partage des comptes) : lu dans son organisation, écrit par le seul déclencheur
// d'`access_rules` ; qui le lit, le service le décide (la personne qui gère le compte).
ADDED.push("account_share_events_select_member")
// L'état de pseudonymisation d'une organisation (sel, témoin, génération ; aucune personne) : lu dans son organisation,
// jamais écrit par une session (`pseudonym_org` et `invalidate_pseudonyms`, `security definer`).
ADDED.push("pseudonym_orgs_select_member")

/** Portée plateforme : les seules policies où `is_staff()` reste (HN-E01S08-3). */
const PLATFORM_SCOPE = [
  "admin_journal_insert_staff",
  "admin_journal_select_staff_admin",
  "platform_grants_select_staff_admin",
  "platform_staff_select_staff",
]

/**
 * Les policies qui exigent le rôle que leur service exige (migration `20261019150000`, décision d'Alexis du 19/10) :
 * avec son seul jeton, un membre simple y aurait fait ce que le service réserve. Chacune reprend la règle de son
 * service, ni plus dure ni plus large ; une policy nouvelle qui porte un rôle s'ajoute ici en nommant ce service.
 */
const ROLE_REQUIRED: Record<string, string> = {
  members_delete_admin: "removeMember (server/members.ts): requireAdmin, isOrgAdmin",
  teams_delete_admin: "deleteTeam (server/teams.ts): requireAdmin, isOrgAdmin",
  team_members_delete_admin: "removeTeamMember (server/teams.ts): isOrgAdmin, or a lead of the team removing a member (leadsTeam)",
  org_domains_delete_admin: "removeHost (server/admin/hosts.ts): requireStaffAdmin, isStaff and isOrgAdmin",
  orgs_update_admin: "updateOrg, updateBrand, setFlag, setOpenEntry (server/admin/orgs.ts, brand.ts, flags.ts, open-entry.ts): isOrgAdmin",
}

/** Les policies du rôle exigé qui lisent l'équipe plateforme, hors de la portée plateforme. */
const STAFF_ROLE_REQUIRED = ["org_domains_delete_admin"]

/** Un niveau ou un rôle calculé en base. */
const RIGHT_FUNCTION = /\b(node_level_for|node_level_of|is_org_admin|leads_team)\s*\(/i
/** Le responsable d'équipe comparé à l'appelant, dans un sens ou dans l'autre. */
const LEAD_IS_CALLER = /lead_user_id\s*=\s*\(?\s*(select\s+)?auth\.uid\(\)|auth\.uid\(\)\s*\)?\s*=\s*(\w+\.)?lead_user_id/i
const CREATE_POLICY = /^create policy (\w+) on platform\.(\w+)(?: as \w+)?(?: for (\w+))?/i
const DROP_POLICY = /^drop policy (?:if exists )?(\w+) on platform\.(\w+)$/i
const CREATE_TABLE = /^create table platform\.(\w+)/i
const ENABLE_RLS = /^alter table platform\.(\w+) enable row level security$/i
/** Une sous-requête, `(select auth.uid())` compris : Postgres y développe les policies des tables lues. */
const SUBLINK = /\(\s*select\b|\bexists\s*\(/i
const READ_TABLE = /\b(?:from|join)\s+platform\.(\w+)/gi
const COMMANDS = ["select", "insert", "update", "delete"]

type Policy = { name: string; table: string; command: string; body: string }
/** Une définition, ou son retrait (`drop policy`), dans l'ordre des migrations. */
type PolicyEvent = Policy & { dropped?: true }

/** Instructions de chaque migration, blancs réduits, dans l'ordre des fichiers. */
function readMigrations(): { file: string; statements: string[] }[] {
  return fs
    .readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => {
      const { text, dollarRanges } = clean(fs.readFileSync(path.join(MIGRATIONS, file), "utf8"))
      const statements: { body: string }[] = splitStatements(text, dollarRanges)
      return { file, statements: statements.map((statement) => statement.body.trim().replace(/\s+/g, " ")) }
    })
}

/** Chaque `create policy` et chaque `drop policy`, dans l'ordre des migrations. */
function definitionsOf(migrations: { statements: string[] }[]): PolicyEvent[] {
  return migrations.flatMap(({ statements }) =>
    statements.flatMap((body): PolicyEvent[] => {
      const created = body.match(CREATE_POLICY)
      if (created) return [{ name: created[1], table: created[2], command: (created[3] ?? "all").toLowerCase(), body }]
      const dropped = body.match(DROP_POLICY)
      return dropped ? [{ name: dropped[1], table: dropped[2], command: "drop", body, dropped: true }] : []
    }),
  )
}

const sortedNames = (policies: Policy[]) => policies.map((policy) => policy.name).sort()

/** La dernière définition de chaque nom, sans les policies retirées après elle. */
function lastOf(events: PolicyEvent[]): Map<string, Policy> {
  const final = new Map<string, Policy>()
  for (const event of events) {
    if (event.dropped) final.delete(event.name)
    else final.set(event.name, event)
  }
  return final
}

/** Le `using` d'une policy, sans son `with check`. */
const usingOf = (body: string) => (body.split(/\bwith check\b/i)[0].match(/\busing\b(.*)$/i)?.[1] ?? "").trim()

/**
 * Détection de récursion du réécrivain de Postgres (`fireRIRrules`) : quand les policies appliquées
 * à une table portent une sous-requête, Postgres développe les policies de lecture de chaque table
 * qu'elle lit, et lève 42P17 s'il revient sur une table dont il développe déjà les sous-requêtes.
 * Rend le premier cycle trouvé, ou null.
 */
function recursion(table: string, applied: Policy[], selectOf: (table: string) => Policy[], stack: string[] = []): string | null {
  if (!applied.some((policy) => SUBLINK.test(policy.body))) return null
  if (stack.includes(table)) return [...stack, table].join(" > ")
  for (const policy of applied) {
    for (const [, read] of policy.body.matchAll(READ_TABLE)) {
      const cycle = recursion(read, selectOf(read), selectOf, [...stack, table])
      if (cycle) return `${cycle} (${policy.name})`
    }
  }
  return null
}

describe("final policies of platform", () => {
  it("should keep no level nor role in any policy outside the closed list of the role its service requires, the organisation boundary and the invariants otherwise (AC2)", () => {
    const migrations = readMigrations()
    const definitions = definitionsOf(migrations)
    const final = [...lastOf(definitions).values()]
    const statements = migrations.flatMap((migration) => migration.statements)
    const tables = statements.flatMap((statement) => statement.match(CREATE_TABLE)?.[1] ?? [])
    const enabled = new Set(statements.flatMap((statement) => statement.match(ENABLE_RLS)?.[1] ?? []))
    const readable = new Set(final.filter((policy) => ["select", "all"].includes(policy.command)).map((policy) => policy.table))

    expect(tables.length).toBeGreaterThanOrEqual(22)
    expect({
      rights: sortedNames(final.filter((policy) => RIGHT_FUNCTION.test(policy.body) || LEAD_IS_CALLER.test(policy.body))),
      staff: sortedNames(final.filter((policy) => /\bis_staff\s*\(/i.test(policy.body))),
      updateWithoutCheck: sortedNames(final.filter((policy) => policy.command === "update" && !/\bwith check\b/i.test(policy.body))),
      // Un `using` de mise à jour ou de suppression (`for all` compris) qui ne borne pas l'organisation
      // ne se voit pas en base : le filtre et le retour de la commande y appliquent la policy de
      // lecture, qui cache encore les lignes (revue d'E01-S08, cycle 1).
      usingWithoutMembership: sortedNames(
        final.filter(
          (policy) =>
            ["update", "delete", "all"].includes(policy.command) &&
            !/^\(\s*false\s*\)$/i.test(usingOf(policy.body)) &&
            !/\bmember_orgs\s*\(/i.test(usingOf(policy.body)),
        ),
      ),
      names: sortedNames(final),
      withoutRls: tables.filter((table) => !enabled.has(table)),
      disabled: statements.filter((statement) => /\bdisable row level security\b/i.test(statement)),
      withoutRead: tables.filter((table) => !readable.has(table)),
    }).toEqual({
      rights: Object.keys(ROLE_REQUIRED).sort(),
      staff: [...PLATFORM_SCOPE, ...STAFF_ROLE_REQUIRED].sort(),
      updateWithoutCheck: [],
      usingWithoutMembership: [],
      names: [...RECREATED, ...UNCHANGED, ...ADDED].sort(),
      withoutRls: [],
      disabled: [],
      withoutRead: [],
    })
  })

  // Garde d'E01-S08 (HN-E01S08-14, `supabase-patterns.md § RLS Patterns`) : la migration d'isolation
  // faisait échouer toute insertion dans `nodes` sous un jeton, avant tout déclencheur.
  it("should leave no policy whose subqueries come back to a table whose policies Postgres is expanding (42P17)", () => {
    const final = [...lastOf(definitionsOf(readMigrations())).values()]
    const applying = (table: string, command: string) => final.filter((policy) => policy.table === table && [command, "all"].includes(policy.command))
    const selectOf = (table: string) => applying(table, "select")
    // Une mise à jour, une suppression ou un `insert … returning` appliquent aussi les policies de lecture.
    const cycles = [...new Set(final.map((policy) => policy.table))].flatMap((table) =>
      COMMANDS.flatMap((command) => {
        const cycle = recursion(table, command === "select" ? selectOf(table) : [...applying(table, command), ...selectOf(table)], selectOf)
        return cycle ? [`${table} ${command}: ${cycle}`] : []
      }),
    )
    expect(cycles).toEqual([])
  })
})
