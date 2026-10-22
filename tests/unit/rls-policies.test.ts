// @vitest-environment node
// Policies finales de `platform` (E01-S08, AC2 ; HN-E01S08-13), sans base : chaque migration du
// paquet, dans l'ordre de ses fichiers, lue comme la lit `check:migrations` (commentaires et
// littéraux blanchis, instructions coupées hors des corps `$$`) ; la dernière définition d'un nom
// fait foi, un `drop policy` qui la suit la retire (E01-S12 partie c). Une migration future qui remettrait un niveau ou un rôle dans une policy fait échouer ce
// test : les droits sont décidés par les services (`security-patterns.md § Droits dans le service`),
// la RLS ne garde que la frontière entre organisations et les invariants, sauf la liste fermée des policies qui
// reprennent le rôle exigé par leur service (`ROLE_REQUIRED`, migrations `20261019150000`, `20261020190000`, `20261021090000`, `20261021120000`, `20261021130000`, `20261021140000`, `20261021150000` et `20261021170000`, lectures comprises). Depuis E01-S09, la ligne de
// base porte les 70 policies que la chaîne laissait (la migration d'isolation qui en recréait 51 est
// dans git) : ce test lit les définitions finales, sans l'histoire des fichiers. Il garde aussi les fonctions
// `security definer` qu'une session exécute et qui écrivent un nœud (`LEVEL_REQUIRED_FUNCTIONS`, migration `20261021100000` ;
// la purge de la corbeille, `TRASH_FUNCTIONS`, migration `20261021140000`), et celles qui suppriment des lignes de fichier
// (`FILE_PURGE_FUNCTIONS`, migration `20261021170000`).
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
 * partie c. Les lectures du contenu (`blocks_select_level`, `node_versions_select_level`, `links_select_level`)
 * reprennent depuis `20261021130000` le niveau de leur service (`ROLE_REQUIRED`).
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
// Les vues des pages (1.4.13) : depuis `20261021150000`, ses propres lignes lues, écrites par la personne pour elle-même
// sur une page qu'elle lit (`ROLE_REQUIRED`), aucune suppression sous une session (`false` ; le ménage par `sweep_node_views`).
ADDED.push("node_views_select_member", "node_views_insert_own", "node_views_update_own", "node_views_delete_expired")
// Les exclusions de l'entrée sans invitation : lues dans son organisation, inscrites par l'administrateur (`ROLE_REQUIRED`), jamais
// modifiées ni retirées par une session.
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
// La trace d'un fichier en transit effacé (`20261021190000`) : lue par son seul auteur, jamais écrite par une session
// (le déclencheur `files_erased_trace` et `purge_transit_files`, `security definer`).
ADDED.push("erased_files_select_own")
// Les travaux en tâche de fond des fonctions longues (`20261022230000`) : lus par leur seul auteur, jamais écrits par une
// session (`enqueue_job`, `claim_jobs`, `mark_job_sent`, `finish_job`, `sweep_jobs`, `security definer`, au rôle du serveur).
ADDED.push("jobs_select_own")

/** Portée plateforme : les seules policies où `is_staff()` reste (HN-E01S08-3). */
const PLATFORM_SCOPE = [
  "admin_journal_insert_staff",
  "admin_journal_select_staff_admin",
  "platform_grants_select_staff_admin",
  "platform_staff_select_staff",
]

/**
 * Les policies qui exigent le rôle que leur service exige (migrations `20261019150000` pour les suppressions,
 * `20261020190000` pour les ajouts et modifications, `20261021090000` pour les nœuds, `20261021120000` pour les blocs,
 * `20261021130000` pour la lecture du contenu, `20261021150000` pour les vues, `20261021170000` pour la suppression des
 * fichiers, décisions d'Alexis du 19/10 et du 20/10) : avec son seul jeton, un membre simple y aurait fait ce que le service réserve. Chacune reprend la règle de son service, ni plus dure ni plus
 * large ; une policy nouvelle qui porte un rôle s'ajoute ici en nommant ce service. `nodes_delete_manager` en est sortie
 * avec `20261021150000` : elle ne garde que le retrait d'une création jamais publiée par son auteur (`undoCreation`),
 * sans rôle ; la corbeille se purge par `purge_trash` et `erase_team_trash`.
 */
const ROLE_REQUIRED: Record<string, string> = {
  members_delete_admin: "removeMember (server/members.ts): requireAdmin, isOrgAdmin",
  teams_delete_admin: "deleteTeam (server/teams.ts): requireAdmin, isOrgAdmin",
  team_members_delete_admin: "removeTeamMember (server/teams.ts): isOrgAdmin, or a lead of the team removing a member (leadsTeam)",
  org_domains_delete_admin: "removeHost (server/admin/hosts.ts): requireStaffAdmin, isStaff and isOrgAdmin",
  orgs_update_admin: "updateOrg, updateBrand, setFlag, setOpenEntry (server/admin/orgs.ts, brand.ts, flags.ts, open-entry.ts): isOrgAdmin",
  platform_grants_insert_staff: "grantAccess (server/admin/grants.ts): requireStaffAdmin, isStaff and isOrgAdmin",
  platform_grants_update_revoke: "revokePlatformAccess (server/members.ts): requireAccessManager, isOrgAdmin or isStaff",
  members_insert_admin: "no service under a session (accept_invitations, join_org, signup_org, seat_org_admin are security definer): isOrgAdmin",
  members_update_admin: "updateMember (server/members.ts): requireAdmin, isOrgAdmin",
  invitations_insert_admin: "inviteMember (server/invitations.ts): invitationOptions, isOrgAdmin, or a lead inviting a member into a team she leads (leadsTeam)",
  invitations_update_revoke: "revokeInvitation, withdraw (server/invitations.ts): its sender or isOrgAdmin",
  teams_insert_admin: "createTeam (server/teams.ts): requireAdmin, isOrgAdmin",
  teams_update_admin: "updateTeam (server/teams.ts): requireAdmin, isOrgAdmin",
  team_members_insert_admin: "addTeamMember (server/teams.ts): requireComposer, isOrgAdmin, or a lead adding a member (leadsTeam); setSoleLead: isOrgAdmin",
  team_members_update_admin: "setTeamMemberRole, setSoleLead (server/teams.ts): requireAdmin, isOrgAdmin",
  org_domains_insert_admin: "addHost (server/admin/hosts.ts): requireStaffAdmin, isStaff and isOrgAdmin",
  access_rules_insert_manager: "setNodeRule, setGeneralAccess, setAccountRule (server/rules.ts, general-access.ts): the share level of the node (node_level_for >= 3), manage by isOrgAdmin; an account rule otherwise left to membership (accountLevelOf)",
  access_rules_update_manager: "saveRule for setNodeRule, setGeneralAccess, setAccountRule (server/rules.ts, general-access.ts): as access_rules_insert_manager",
  access_rules_delete_manager: "removeRule, setGeneralAccess (server/rules.ts, general-access.ts): the share level of the node (node_level_for >= 3); an account rule left to membership (accountLevelOf)",
  accounts_insert_admin: "createAccount (server/connectors/accounts.ts): requireCreationRight, isOrgAdmin, or a lead of the owning team (leadsTeam)",
  connector_activations_insert_admin: "activateConnector (server/connectors/activations.ts): checkedConnector, isOrgAdmin",
  connector_activations_update_admin: "activateConnector, deactivateConnector (server/connectors/activations.ts): checkedConnector, isOrgAdmin",
  feedback_update_admin: "setFeedbackState (server/feedback.ts): handlesFeedback, isOrgAdmin, and isStaff or the feedback_visible flag",
  node_drafts_update_writer: "writeNode, saveDraft (server/nodes/write.ts, store.ts): requireNodeLevel write, node_level_for >= 2",
  node_shares_insert_member: "shareNode (server/shares.ts): managedNode, the share level of the node (node_level_for >= 3)",
  node_shares_update_member: "shareNode, revokeShare (server/shares.ts): the share level of the node (node_level_for >= 3), or isOrgAdmin to revoke",
  member_exclusions_insert_member: "removeMember (server/members.ts): requireAdmin, isOrgAdmin",
  // L'ajout d'un bloc n'y est plus (`20261021180000`) : l'écriture de son nœud se juge une fois par instruction, par le
  // déclencheur `blocks_write_guard` (`tests/integration/ecriture-des-blocs-par-instruction.test.ts`).
  blocks_update_writer:
    "updateRow (server/tables/row-store.ts), writeDecision (server/tables/review.ts) after requireWrite for table.write, table.claim, table.release, the review and the import; writePurge (server/tables/evolution-publish.ts) after requireNodeLevel publish: a row, node_level_for >= 2 on that row alone; writeUpdate of saveDraft (server/nodes/store.ts): a draft block, its draft (blocks_select_level) and blocks_write_guard",
  blocks_delete_writer:
    "deleteJudged (server/tables/delete-rows.ts) after requireWrite: a row, node_level_for >= 2 on that row alone; deleteBlocks of saveDraft (server/nodes/store.ts) after requireNodeLevel write: a draft block, its draft (blocks_select_level) and blocks_write_guard",
  // Les lectures du contenu (migration `20261021130000`) ; `nodes_select_level` reste à l'appartenance, en attente d'une décision.
  blocks_select_level:
    "a published block: findNode, lookupNode (server/nodes/lookup.ts), the lists filtered by nodeLevels (server/access.ts), requireRead of the tables: node_level_for >= 1, a row only through a table; a draft block: its draft (node_drafts_select_writer, node_level_for >= 2)",
  node_drafts_select_writer: "loadDraft (server/nodes/store.ts) behind level >= write (server/nodes/read.ts, server/procedures.ts), requireNodeLevel write: node_level_for >= 2",
  node_versions_select_level: "the revisions of read (server/nodes/read.ts), the news (server/context/blocks/news.ts, server/home-contents.ts), the ctx (server/ctx.ts): node_level_for >= 1",
  links_select_level: "the outgoing links of a node read, the incoming links filtered by nodeLevels (server/nodes/link-lines.ts), the links of the Contextes read: node_level_for >= 1",
  files_select_member:
    "readableFile (server/files/service.ts): node_level_for >= 1, in the trash too (20261021140000: the purge goes through purge_trash and erase_team_trash); its author (pendingFile, a transit file)",
  files_delete_member:
    "confirmObject (server/files/service.ts), a pending row of the wrong size, and undoCreation (server/uploads-write.ts), the files of the page just created: node_level_for >= 2 on the node of an attached file; expireTransitFile (server/files/transit.ts): the author of a transit file (20261021170000: the abandoned uploads go through purge_pending_files)",
  node_shares_select_member:
    "managedNode (server/shares.ts), activeShareAt for node.access: node_level_for >= 3; listShares, revokeShare: isOrgAdmin",
  // Les vues des pages (migration `20261021150000`) ; les comptes de l'organisation passent par `node_view_counts`.
  node_views_insert_own: "recordNodeView (server/node-views.ts): findNode, node_level_for >= 1, for the caller herself",
  node_views_update_own: "recordNodeView (server/node-views.ts), on conflict do update: her own row, node_level_for >= 1",
}

/** Les policies du rôle exigé qui lisent l'équipe plateforme, hors de la portée plateforme. */
const STAFF_ROLE_REQUIRED = [
  "org_domains_delete_admin",
  "org_domains_insert_admin",
  "platform_grants_insert_staff",
  "platform_grants_update_revoke",
  "feedback_update_admin",
]

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

/**
 * Les fonctions `security definer` qu'une session exécute (`authenticated`, `platform_server` qui en hérite, `anon`) et qui
 * écrivent dans `nodes`, `blocks` ou `node_drafts` (migration `20261021100000`, décision d'Alexis du 20/10) : chacune
 * exige en base, par `node_level_for`, le niveau que son service exige, ni plus dur ni plus large. Une fonction nouvelle
 * de cette sorte s'ajoute ici en nommant ce service. La surcharge de `publish_node` sans tampon n'écrit rien elle-même :
 * elle appelle celle-ci. Une fonction qui n'est accordée à aucune session (`org_skeleton`, `ensure_private_space`, les
 * fonctions de déclencheur) n'est pas vue, même appelée par une fonction accordée (`create_org`, `signup_org` : les nœuds
 * d'une organisation neuve).
 */
const LEVEL_REQUIRED_FUNCTIONS: Record<string, string> = {
  "open_draft(p_node uuid)": "openDraft (server/nodes/store.ts), after requireNodeLevel write (edit, write.ts) or the write level of the parent of a creation (create): node_level_for >= 2",
  "publish_node(p_node uuid, p_base_revision integer, p_draft_stamp timestamp with time zone, p_links jsonb)":
    "publishNode (server/nodes/publish.ts): requireNodeLevel publish, node_level_for >= 2",
  "discard_draft(p_node uuid, p_draft_stamp timestamp with time zone)": "discardPlan (server/nodes/discard.ts): requireNodeLevel write, node_level_for >= 2; a page never published refused",
  "duplicate_subtree(p_source uuid, p_nodes uuid[], p_segment text, p_title text, p_position double precision)":
    "duplicateNode (server/nodes/duplicate.ts): findNode and copiedDescendants, node_level_for >= 1; its parent, node_level_for >= 2",
}

/**
 * Les fonctions `security definer` de la purge de la corbeille (migration `20261021140000`) : elles suppriment des nœuds
 * sans niveau, une rétention de l'organisation ou l'effacement d'une équipe, bornées aux nœuds à la corbeille
 * (`deleted_at`) et au rôle que leur service exige (`member_orgs` ou `is_org_admin`). Une fonction nouvelle de cette sorte
 * s'ajoute ici en nommant ce service.
 */
const TRASH_FUNCTIONS: Record<string, string> = {
  "purge_trash(p_org uuid)": "purgeTrash (server/nodes/trash.ts), from listTrash and trashNode: any member (member_orgs), trashed for more than 30 days",
  "erase_team_trash(p_org uuid, p_team uuid)": "eraseTrashedNodes for deleteTeam (server/team-trash.ts, server/teams.ts): requireAdmin, is_org_admin, trashed",
}

/**
 * Les fonctions `security definer` qu'une session exécute et qui suppriment des lignes de `files` sans la policy de
 * suppression (migration `20261021170000`) : chacune vérifie le rôle que son service exige (`member_orgs` ou
 * `is_org_admin`) et ne rend que des identifiants. Une fonction nouvelle de cette sorte s'ajoute ici en nommant ce service.
 */
const FILE_PURGE_FUNCTIONS: Record<string, string> = {
  "purge_trash(p_org uuid)": "purgeTrash (server/nodes/trash.ts): the files of the expired trashed nodes",
  "erase_team_trash(p_org uuid, p_team uuid)": "eraseTrashedNodes for deleteTeam (server/team-trash.ts): the files of the trashed pages of a team",
  "purge_transit_files(p_org uuid)": "purgeTransitFiles (server/files/transit.ts), under platform_server: the expired transit files of the organisation",
  "purge_pending_files(p_org uuid)": "purgePendingFiles (server/files/service.ts), from requestFileUpload, listTrash and trashNode: any member (member_orgs), pending for more than an hour",
}

/** Les rôles d'une session. */
const SESSION_ROLES = ["authenticated", "platform_server", "anon"]
const CREATE_FUNCTION = /^create (?:or replace )?function platform\.(\w+)\s*\((.*?)\)\s*returns\b/i
const GRANTED_FUNCTION = /^(grant|revoke) (?:execute|all(?: privileges)?) on function platform\.(\w+)\s*\((.*)\) (?:to|from) (.+)$/i
const WRITES_NODES = /\b(?:insert into|update|delete from) platform\.(?:nodes|blocks|node_drafts)\b/i
const DELETES_FILES = /\bdelete from platform\.files\b/i

/** La signature d'une fonction : son nom et ses arguments, sans leurs valeurs par défaut. */
const signatureOf = (name: string, args: string) =>
  `${name.toLowerCase()}(${args
    .split(",")
    .map((arg) => arg.replace(/\s+default\s+.*$/i, "").trim())
    .join(", ")
    .toLowerCase()})`

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

describe("security definer functions of platform", () => {
  /** La dernière définition de chaque fonction `security definer` qu'un rôle de session exécute, par signature. */
  function sessionDefiners(): [string, string][] {
    const statements = readMigrations().flatMap((migration) => migration.statements)
    // La dernière définition de chaque signature, et les rôles de session qui exécutent chaque nom.
    const bodies = new Map<string, string>()
    const granted = new Map<string, Set<string>>()
    for (const statement of statements) {
      const created = statement.match(CREATE_FUNCTION)
      if (created && /\bsecurity definer\b/i.test(statement)) bodies.set(signatureOf(created[1], created[2]), statement)
      else if (created) bodies.delete(signatureOf(created[1], created[2]))
      const grant = statement.match(GRANTED_FUNCTION)
      if (!grant) continue
      const signature = signatureOf(grant[2], grant[3])
      const roles = granted.get(signature) ?? new Set<string>()
      for (const role of grant[4].split(",").map((each) => each.trim().toLowerCase())) {
        if (grant[1].toLowerCase() === "grant") roles.add(role)
        else roles.delete(role)
      }
      granted.set(signature, roles)
    }
    return [...bodies].filter(([signature]) => SESSION_ROLES.some((role) => granted.get(signature)?.has(role)))
  }

  it("should make every security definer function a session runs that writes a node, its blocks or its draft require the level of its service (20261021100000)", () => {
    const writers = sessionDefiners().filter(([, body]) => WRITES_NODES.test(body))
    const trash = writers.filter(([signature]) => signature in TRASH_FUNCTIONS)
    expect({
      writers: writers.map(([signature]) => signature).sort(),
      withoutLevel: writers.filter(([signature, body]) => !(signature in TRASH_FUNCTIONS) && !/\bnode_level_for\s*\(/i.test(body)).map(([signature]) => signature),
      trashWithoutBound: trash
        .filter(([, body]) => !/\bdeleted_at\b/i.test(body) || !/\b(member_orgs|is_org_admin)\s*\(/i.test(body))
        .map(([signature]) => signature),
    }).toEqual({ writers: Object.keys({ ...LEVEL_REQUIRED_FUNCTIONS, ...TRASH_FUNCTIONS }).sort(), withoutLevel: [], trashWithoutBound: [] })
  })

  it("should keep every security definer function a session runs that deletes file rows in a closed list, each checking the role of its service (20261021170000)", () => {
    const purges = sessionDefiners().filter(([, body]) => DELETES_FILES.test(body))
    expect({
      purges: purges.map(([signature]) => signature).sort(),
      withoutRole: purges.filter(([, body]) => !/\b(member_orgs|is_org_admin)\s*\(/i.test(body)).map(([signature]) => signature),
    }).toEqual({ purges: Object.keys(FILE_PURGE_FUNCTIONS).sort(), withoutRole: [] })
  })
})
