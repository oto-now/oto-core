// @vitest-environment node
// Retraits de la V1 (E01-S12 partie c, AC-c1 ; `20260927200000_platform_retraits_v1.sql`, repliée dans la
// ligne de base V1 par la partie d) sur une vraie base, la base étant le sujet : colonnes, rôle, fonctions de
// niveau, garde des comptes, policies neutralisées et privilèges de `service_role` retirés ; les droits
// laissés au service (un lecteur ouvre un brouillon, un rédacteur publie, sous leur session), l'isolation
// gardée. Les invariants de structure de l'arbre restent prouvés par `droits-noeuds.test.ts`. Portable : sur
// le projet comme sur un Postgres nu.
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { readPublicNode, resolveIdentity, shareNode } from "@otomata_tech/oto_platform/server"
import { hex } from "../helpers/plateforme"
import { codeOf, createSqlFixtures, SQL_SKIP_REASON, sqlConfigured, type SqlFixtures, type SqlReferenceOrg } from "../helpers/sql"
import { privateFolderPending, privateFolderSuite } from "../helpers/pending-migrations"

// Ces tests supposent le dossier `private` en base (fiche D107) : sautés, la version nommée, tant que
// 20260928120000 n'est pas appliquée au projet (`database-patterns.md § Règles`).
const privatePending = await privateFolderPending()

const SETUP_TIMEOUT = 180_000
const NETWORK_TIMEOUT = 60_000
const SUITE = "V1 removals (E01-S12 part c)"
const ready = sqlConfigured
const skipReason = SQL_SKIP_REASON

describe.skipIf(!ready || privatePending)(privateFolderSuite(ready ? SUITE : `${SUITE} (${skipReason})`, privatePending), { timeout: NETWORK_TIMEOUT }, () => {
  let fx: SqlFixtures
  let o: SqlReferenceOrg

  beforeAll(async () => {
    fx = createSqlFixtures()
    o = await fx.buildReferenceOrg()
  }, SETUP_TIMEOUT)

  afterAll(async () => {
    await fx?.cleanup()
  }, SETUP_TIMEOUT)

  it("should leave neither the removed columns, functions, trigger and policies, nor any privilege of service_role, and keep the level functions of the search (AC-c1)", async () => {
    const [columns, functions, triggers, policies] = await Promise.all([
      fx.admin<{ name: string }[]>`
        select table_name || '.' || column_name as name from information_schema.columns
         where table_schema = 'platform' and (table_name, column_name) in (('nodes', 'sections'), ('nodes', 'draft'), ('teams', 'rules'))`,
      fx.admin<{ name: string }[]>`
        select distinct p.proname as name from pg_catalog.pg_proc p
         where p.pronamespace = 'platform'::regnamespace
           and p.proname in ('node_level', 'account_level', 'account_level_for', 'accounts_guard', 'node_level_for', 'node_level_of', 'level_rank', 'is_org_admin')
         order by 1`,
      fx.admin<{ name: string }[]>`select t.tgname as name from pg_catalog.pg_trigger t where t.tgrelid = 'platform.accounts'::regclass and t.tgname = 'accounts_guard'`,
      fx.admin<{ name: string }[]>`select policyname as name from pg_catalog.pg_policies where schemaname = 'platform' and (qual = 'false' or with_check = 'false') order by 1`,
    ])
    expect({ columns, functions: functions.map((row) => row.name), triggers, policies }).toEqual({
      columns: [],
      functions: ["is_org_admin", "level_rank", "node_level_for", "node_level_of"],
      triggers: [],
      // La lecture fermée du lexique (E01-S13) : sa table n'en a pas d'autre. Les trois suppressions retirées
      // (`20261019140000_platform_suppressions.sql`) restent sous leur nom à `false`, `check:migrations` refusant
      // un `drop` sans recréation ; la prochaine ligne de base les omettra.
      policies: [
        { name: "accounts_delete_admin" },
        { name: "connector_activations_delete_admin" },
        { name: "lexicon_select_none" },
        { name: "orgs_delete_admin" },
      ],
    })
    // `service_role` n'existe que sur Supabase : ailleurs, rien à retirer.
    const [role] = await fx.admin<{ present: boolean }[]>`select exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role') as present`
    const granted = role.present
      ? await fx.admin<{ name: string }[]>`
          select 'schema' as name where has_schema_privilege('service_role', 'platform', 'usage')
          union all
          select c.relname from pg_catalog.pg_class c
           where c.relnamespace = 'platform'::regnamespace and c.relkind in ('r', 'v', 'S')
             and exists (select 1 from aclexplode(c.relacl) a where a.grantee = 'service_role'::regrole)
          union all
          select p.proname from pg_catalog.pg_proc p
           where p.pronamespace = 'platform'::regnamespace
             and exists (select 1 from aclexplode(p.proacl) a where a.grantee = 'service_role'::regrole)`
      : []
    expect(granted).toEqual([])
  })

  it("should refuse the service role on members, admitting admin and member (AC-c1)", async () => {
    const set = (role: string) => codeOf(fx.admin`update platform.members set role = ${role} where org_id = ${o.org.id} and user_id = ${o.people.marc.id}`)
    expect([await set("service"), await set("admin"), await set("member")]).toEqual(["23514", null, null])
  })

  // Les contrôles de niveau quittent la base (ADR-012 § 3), le service décidant chacun avant sa requête ; ils y
  // reviennent, le niveau du service et pas plus : Léa, qui écrit dans Ventes sans la gérer, publie une page puis la
  // renomme (son chemin, comme `followTitle` ; le titre ne s'écrit que par la publication depuis 20261021110000). Marc, qui lit `contexte` sans l'écrire, n'en ouvre plus le brouillon : depuis 20261021100000, `open_draft`
  // reprend le niveau d'`openDraft` (l'écriture, 42501). Marc, membre simple sans équipe qu'il dirige, n'invite plus : depuis
  // 20261020190000, `invitations_insert_admin` reprend la règle d'`inviteMember` (administrateur, ou responsable dans
  // son équipe), un rôle et non un niveau (42501). Claire, responsable de Ventes, ne fait plus sien un compte de son
  // équipe : depuis 20261019130000, `authenticated` ne modifie plus le propriétaire d'un compte, que le service
  // n'écrit jamais (42501). L'isolation reste : un nœud d'une autre organisation est refusé (42501).
  it("should leave to the base the level of the service, no more: a reader no longer opens a draft nor invites, a writer publishes and renames, a lead cannot change the owner of her team's account; a node of another organisation is refused (AC-c1)", async () => {
    const opened = await codeOf(fx.as(o.people.marc).tx((sql) => sql`select created from platform.open_draft(${o.nodes.contexte})`))
    const segment = `page_${hex(3)}`
    const page = await fx.createNode(o.org.id, { parentId: o.nodes.ventes, path: `ventes/${segment}`, title: "Page" })
    const written = await fx.as(o.people.lea).tx(async (sql) => {
      await sql`select * from platform.open_draft(${page})`
      const [row] = await sql<{ revision: number }[]>`select platform.publish_node(${page}, 0, null::jsonb) as revision`
      const renamed = await sql`update platform.nodes set path = ${`ventes/${segment}_renommee`} where id = ${page} returning id`
      return { revision: row.revision, renamed: renamed.length }
    })
    const email = `test-${hex(4)}@example.invalid`
    const invited = await codeOf(
      fx.as(o.people.marc).tx((sql) => sql`insert into platform.invitations (org_id, email, role, invited_by) values (${o.org.id}, ${email}, 'member', ${o.people.marc.id})`),
    )
    const account = await fx.createAccount(o.org.id, { ownerKind: "team", ownerTeamId: o.teams.ventes, label: `Mail ${hex(3)}` })
    const personal = await codeOf(
      fx.as(o.people.claire).tx(
        (sql) => sql`update platform.accounts set owner_kind = 'user', owner_team_id = null, owner_user_id = ${o.people.claire.id} where id = ${account} returning id`,
      ),
    )
    const elsewhere = await fx.buildReferenceOrg(o.people)
    await fx.admin`delete from platform.members where org_id = ${elsewhere.org.id} and user_id = ${o.people.lea.id}`
    const outside = await Promise.all([
      codeOf(fx.as(o.people.lea).tx((sql) => sql`select * from platform.open_draft(${elsewhere.nodes.ventes})`)),
      codeOf(fx.as(o.people.lea).tx((sql) => sql`select platform.publish_node(${elsewhere.nodes.ventes}, 0, null::jsonb)`)),
    ])
    expect({ opened, written, invited, personal, outside }).toEqual({
      opened: "42501",
      written: { revision: 1, renamed: 1 },
      invited: "42501",
      personal: "42501",
      outside: ["42501", "42501"],
    })
  })

  // Décision de JB du 2026-09-28 (« montrer les lignes ») : la page publique d'un tableau porte ses colonnes
  // publiées et ses lignes publiées, triées par clé ; d'une ligne, la clé et les valeurs des colonnes
  // déclarées, rien d'autre (ni provenance, ni réservation, ni auteur, ni valeur d'une colonne retirée) ; une
  // colonne ajoutée au brouillon de l'en-tête n'est pas servie ; un tableau hors de la portée du lien, rien.
  it("should show a shared table's published columns and rows sorted by key, with no internal key, pending column nor undeclared value; nothing out of reach (HN-E01S12c-12)", async () => {
    const ada = o.people.ada
    const db = fx.as(ada)
    const identity = await resolveIdentity(db, o.host, { userId: ada.id, email: ada.email })
    const path = `ventes/suivi_${hex(3)}`
    const table = await fx.createNode(o.org.id, { parentId: o.nodes.ventes, path, kind: "table", title: "Suivi" })
    const columns = [
      { name: "ref", type: "text", max_length: 20 },
      { name: "statut", type: "enum", options: ["à traiter", "qualifié"] },
    ]
    await fx.publishBlocks(table, [], { meta: { columns, key: "ref" } })
    const until = new Date(Date.now() + 3_600_000).toISOString()
    await fx.addRows(table, [
      { key: "P-002", data: { ref: "P-002", statut: "qualifié", ancienne: "retirée" }, provenance: { source: "mail", proof: "p" }, claim: { worker: "w", userId: ada.id, until } },
      { key: "P-001", data: { ref: "P-001" } },
    ])
    await fx.admin`select * from platform.open_draft(${table})`
    await fx.admin`update platform.node_drafts set meta = ${fx.admin.json({ columns: [...columns, { name: "note", type: "text" }], key: "ref" })} where node_id = ${table}`
    const hiddenPath = `ventes/cache_${hex(3)}`
    const hidden = await fx.createNode(o.org.id, { parentId: o.nodes.ventes, path: hiddenPath, kind: "table", title: "Caché" })
    await fx.publishBlocks(hidden, [], { meta: { columns, key: "ref" } })
    await fx.addRows(hidden, [{ key: "H-001", data: { ref: "H-001" } }])

    const token = (await shareNode(db, identity, { path, include_children: false })).data.share.token
    const view = await readPublicNode(o.host, token)
    const keys = (value: object) => Object.keys(value).sort().join(",")
    expect({
      table: view.table,
      shapes: view.table ? [keys(view.table), ...new Set(view.table.columns.map(keys)), ...new Set(view.table.rows.map(keys))] : [],
      blocks: view.blocks,
    }).toEqual({
      table: {
        columns: [
          { name: "ref", type: "text" },
          { name: "statut", type: "enum" },
        ],
        rows: [
          { key: "P-001", cells: { ref: "P-001" } },
          { key: "P-002", cells: { ref: "P-002", statut: "qualifié" } },
        ],
        truncated: false,
      },
      shapes: ["columns,rows,truncated", "name,type", "cells,key"],
      blocks: [],
    })
    // Le tableau voisin, publié, n'est pas couvert par le lien : rien, la réponse de tout refus.
    await expect(readPublicNode(o.host, token, hiddenPath)).rejects.toMatchObject({ code: "not_found" })
  })

  it("should cut the rows of a public table at 500, sorted by key, and say it (truncated)", async () => {
    const ada = o.people.ada
    const db = fx.as(ada)
    const identity = await resolveIdentity(db, o.host, { userId: ada.id, email: ada.email })
    const path = `ventes/grand_${hex(3)}`
    const table = await fx.createNode(o.org.id, { parentId: o.nodes.ventes, path, kind: "table", title: "Grand" })
    await fx.publishBlocks(table, [], { meta: { columns: [{ name: "ref", type: "text" }], key: "ref" } })
    const keyOf = (index: number) => `R-${String(index).padStart(4, "0")}`
    await fx.addRows(
      table,
      Array.from({ length: 501 }, (_, index) => ({ key: keyOf(500 - index), data: { ref: keyOf(500 - index) } })),
    )
    const token = (await shareNode(db, identity, { path, include_children: false })).data.share.token
    const view = await readPublicNode(o.host, token)
    expect({ count: view.table?.rows.length, first: view.table?.rows[0]?.key, last: view.table?.rows.at(-1)?.key, truncated: view.table?.truncated }).toEqual({
      count: 500,
      first: keyOf(0),
      last: keyOf(499),
      truncated: true,
    })
  })
})
