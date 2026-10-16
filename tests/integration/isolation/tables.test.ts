// @vitest-environment node
// Isolation de deux organisations, table par table (E09-S05 : AC1 à AC5), sur une vraie base (la base
// est ici le sujet, testing-strategy.md § Budget de tests ; suite portable, E11-S14). La liste des tables
// vient de la base (catalogue `information_schema`) : une table ajoutée plus tard entre d'elle-même
// dans la preuve ; tables, RLS, policies et privilèges d'`authenticated` viennent des migrations du
// paquet (`packagePolicies`). Les données : A et B de `donnees.ts`. Une écriture tentée sur une ligne
// de B est attendue refusée par le privilège quand `authenticated` ne l'a pas, sinon par l'isolation.
// Le clone d'une insertion porte l'appelant comme auteur et l'état d'une création (HN-E09S05-20) :
// seule l'organisation le refuse, par la policy ou par ce qu'elle ou une garde lisent de B sous la RLS
// (nœud parent, équipe, compte). La policy de `platform_grants` exige d'abord l'équipe plateforme : sa
// condition d'organisation se prouve par `p` (AC5) ; celle du journal admin n'en a pas, et `p` y
// écrit (HN-E09S05-9). Depuis E01-S10 f2, chaque personne et `anon` passent par la face SQL
// (`clientOf`, `withAnonSession`), plus par PostgREST : mêmes rôles, mêmes claims, mêmes refus.
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { PlatformDb } from "../../../packages/plateforme/server/db"
import { withAnonSession, type Tx } from "../../../packages/plateforme/server/sql"
import { hex } from "../../helpers/plateforme"
import { platformFunctions, type Command } from "../../helpers/platform-tables"
import { portable, sqlConfigured } from "../../helpers/sql"
import { keyOf, preparer, type Isolation, type Row, type Scope, type Who } from "./donnees"

const SETUP_TIMEOUT = 300_000
const NETWORK_TIMEOUT = 120_000
const SUITE = "isolation of two organisations, table by table"

/**
 * Portée plateforme (architecture § 4, RLS ; HN-E01S08-3) : toute l'équipe plateforme lit les accès
 * plateforme et le journal admin de toute organisation. `p` y lit donc les lignes de B (HN-E09S05-9).
 */
const PLATFORM_SCOPE = ["platform_grants", "admin_journal"]

/**
 * Portée plateforme en écriture (architecture § 4 : « staff, ses lignes » ; HN-E09S05-9) : la policy
 * d'insertion du journal admin n'exige que l'équipe plateforme et l'auteur, sans appartenance. `p` y
 * écrit donc dans B : attendu, puis retiré avant la relecture de B (question à la fiche, D2).
 */
const PLATFORM_JOURNAL = "admin_journal"

/**
 * Les seules fonctions qu'`anon` exécute, chacune avec sa source : l'organisation d'une adresse
 * (E02-S01, architecture § 4), et la lecture publique d'un lien de partage, bornée au jeton (ADR-013 § 4).
 */
const ANON_FUNCTIONS: Record<string, string> = {
  org_by_host: "E02-S01",
  public_node_by_token: "ADR-013 § 4",
  // E10-S02 (lot c) : un fichier servi par un lien, borné au jeton et aux blocs publiés du périmètre.
  public_file_by_token: "ADR-016 § 7",
  // E10-S02 (lot f) : la consommation d'un ticket de dépôt par lien, bornée à son empreinte et à l'organisation de l'adresse.
  consume_upload_ticket: "ADR-018 § 3",
  // E12-S02 : deux compteurs d'une organisation lus sans session (membres, invitations en attente), rien d'autre.
  org_usage: "ADR-022 § 10",
}

/**
 * Les colonnes que les policies d'insertion comparent à `auth.uid()` : `user_id` (`ctx`, `journal`,
 * `feedback`, `admin_journal`), `created_by` (`nodes`, `blocks`, `access_rules`, `sim_outbox`),
 * `invited_by`, `granted_by`, `activated_by`. Le clone y porte l'appelant : l'auteur de la ligne de B
 * faisait refuser l'insertion quelle que soit l'organisation (revue E09-S05, cycle 1). Dans `members`,
 * `team_members` et `platform_grants`, `user_id` est la personne ajoutée ou le bénéficiaire : l'appelant
 * y est refusé par ce qui refusait la ligne de B (l'organisation, ou l'équipe plateforme pour `a`).
 */
const AUTHORS = ["user_id", "created_by", "invited_by", "granted_by", "activated_by", "excluded_by"]

/**
 * L'état d'une création qu'exigent les policies d'insertion : un retour s'ouvre
 * (`feedback_insert_own`), un envoi naît brouillon (`sim_outbox_insert_writer`). Le clone d'un ticket
 * traité ou d'un envoi parti serait refusé pour son état, quelle que soit l'organisation.
 */
const CREATION: Readonly<Record<string, Row>> = {
  feedback: { state: "open", resolution: null, handled_by: null, handled_at: null },
  sim_outbox: { status: "draft", sent_at: null, sent_by: null },
  // Un fichier joint naît `pending` (`files_insert_member`, E10-S02).
  files: { status: "pending" },
  // Un ticket de dépôt porte deux empreintes uniques (E10-S02 lot f) : le clone en prend des neuves, que seule l'organisation refuse.
  upload_tickets: { token_hash: "0".repeat(64), form_token_hash: "1".repeat(64) },
  // Une demande de consentement est gardée par une empreinte de 64 caractères hexadécimaux : le clone en prend une neuve.
  connector_consents: { state_hash: "2".repeat(64) },
}

type Failure = { code?: string; message?: string }
type Answer = { data: unknown; error: Failure | null }
/** Ce que rendent l'insertion, la modification et la suppression tentées sur une ligne d'une table. */
type Outcomes = { table: string; insert: string; update: string; delete: string }

/** Refus de privilège (table ou colonne non accordée), distinct d'un refus de la RLS ou d'une garde. */
const privilegeRefusal = (error: Failure) => error.code === "42501" && /permission denied/i.test(error.message ?? "")

/**
 * Une contrainte de la table : Postgres ne la contrôle qu'après le `with check` de la RLS (insertion :
 * déclencheurs `BEFORE`, puis RLS, puis `not null` et `check`, puis unicité et clés étrangères). Une
 * ligne de B qui l'atteint a donc passé la RLS : c'est une fuite, jamais un refus.
 */
const CONSTRAINT_VIOLATION = /violates (check|foreign key|unique|not-null|exclusion) constraint|duplicate key value/i

/**
 * Les codes d'un refus de l'isolation (HN-E09S05-12) : la RLS, ou une garde `BEFORE` qui lit sous la
 * RLS (42501) ; un parent que la garde ne voit pas (23503) ; un Contexte dont elle ne voit pas l'équipe
 * (23514).
 */
const ISOLATION_REFUSALS = ["42501", "23503", "23514"]

/**
 * Ce qu'une commande a rendu : un refus de privilège ; une ligne qui a passé la RLS ; un refus de
 * l'isolation ; toute autre erreur telle quelle, qui fait échouer le test (un refus sans rapport avec
 * l'isolation ne prouve rien pour sa table) ; ou des lignes rendues.
 */
function outcomeOf({ data, error }: Answer): string {
  if (error && privilegeRefusal(error)) return "privilege"
  if (error && CONSTRAINT_VIOLATION.test(error.message ?? "")) return `past the row level security: ${error.code} ${error.message}`
  if (error && ISOLATION_REFUSALS.includes(error.code ?? "")) return "refused"
  if (error) return `error ${error.code}: ${error.message}`
  return Array.isArray(data) ? `${data.length} rows` : "written"
}

/**
 * Ce que rend une instruction, à la forme d'une réponse : ses lignes (`returning`), `null` pour une
 * insertion sans `returning` réussie (« written »), ou l'erreur de la base.
 */
function answerOf(run: Promise<readonly unknown[]>, rows: boolean): Promise<Answer> {
  return run.then(
    (found) => ({ data: rows ? [...found] : null, error: null }),
    (error: { code?: string; message?: string }) => ({ data: null, error: { code: error.code, message: error.message } }),
  )
}

describe.skipIf(!sqlConfigured)(
  portable(SUITE),
  { timeout: NETWORK_TIMEOUT },
  () => {
    let data: Isolation & { nettoyer: () => Promise<void> }
    let scopeB: Scope
    let before: Record<string, Row[]>

    beforeAll(async () => {
      data = await preparer()
      scopeB = await data.scopeOf(data.b.id)
      before = await data.snapshot(data.b.id)
    }, SETUP_TIMEOUT)

    afterAll(async () => {
      await data?.nettoyer()
    }, SETUP_TIMEOUT)

    /** Une ligne de B dans la table : la première par clé ; une table vide chez B ne prouve rien (HN-E09S05-2). */
    function rowOfB(table: string): Row {
      const row = before[table]?.[0]
      if (!row) throw new Error(`B n'a aucune ligne dans ${table} : compléter les données de la suite`)
      return row
    }

    /** Les clés des lignes de B que `db` lit, table par table : colonnes de clé et de rattachement seulement. */
    async function readsOf(db: PlatformDb): Promise<Record<string, string[] | string>> {
      const read = await Promise.all(
        data.orgTables.map(async (table) => {
          const key = data.tables[table].primaryKey
          const attached = data.attachments[table]
          const columns = [...new Set([...key, ...("column" in attached ? [attached.column] : [])])]
          const keys = await db.tx((sql) => data.rowsOf(sql, table, scopeB, columns)).then(
            (rows): string[] | string => rows.map((row) => keyOf(key, row)).sort(),
            (error: { code?: string }) => `error ${error.code}`,
          )
          return [table, keys] as const
        }),
      )
      return Object.fromEntries(read)
    }

    /** Une colonne hors clé à modifier : la première qu'`authenticated` peut modifier, sinon la première tout court. */
    function updateColumn(table: string): { column: string; granted: boolean } {
      const posed = data.schema[table]
      const key = data.tables[table].primaryKey
      const candidates = posed.columns.filter((column) => !key.includes(column) && !posed.generated.includes(column) && column !== "org_id")
      const { table: whole, columns } = posed.privileges.update
      const granted = candidates.find((column) => whole || columns.includes(column))
      return granted ? { column: granted, granted: true } : { column: candidates[0], granted: false }
    }

    /**
     * Une valeur de clé neuve : un nombre décalé, un texte suffixé. Un uuid reste : c'est une ligne
     * parente de B (`org_id`, `team_id`, `node_id`), et la cible du clone est B.
     */
    function newKey(value: unknown): unknown {
      if (typeof value === "number") return value + 1_000_000
      if (typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(value)) return value
      return `${String(value)}-${hex(3)}`
    }

    /**
     * Le clone d'une ligne de B (AC4) : les colonnes qu'`authenticated` peut insérer (toutes quand la
     * table n'accorde aucune insertion : le refus est alors le privilège), sans celles que la base
     * fabrique (générées, identités, clé à défaut comme `blocks.id`). Sa clé est neuve : renouvelée, ou
     * fabriquée par la base, qui en garde alors les autres colonnes (`blocks.state`). Il porte l'appelant
     * comme auteur (`AUTHORS`) et l'état d'une création (`CREATION`).
     */
    function cloneOf(table: string, row: Row, caller: string): Row {
      const posed = data.schema[table]
      const key = data.tables[table].primaryKey
      const { table: whole, columns } = posed.privileges.insert
      const insertable = whole || columns.length === 0 ? posed.columns : columns
      const renewed = !key.some((column) => posed.defaulted.includes(column))
      const clone: Row = {}
      for (const column of insertable) {
        if (posed.generated.includes(column) || !(column in row)) continue
        if (key.includes(column) && posed.defaulted.includes(column)) continue
        clone[column] = renewed && key.includes(column) ? newKey(row[column]) : row[column]
      }
      for (const column of AUTHORS) if (column in clone) clone[column] = caller
      return { ...clone, ...CREATION[table] }
    }

    /** Ce que l'isolation doit rendre à chaque commande de `who` sur une ligne de B, d'après les privilèges des migrations. */
    function expectedOf(table: string, who: Who): Outcomes {
      const posed = data.schema[table]
      if (!posed) throw new Error(`${table} : aucune migration du paquet ne la crée (AC1)`)
      const granted = (command: Command) => posed.privileges[command].table || posed.privileges[command].columns.length > 0
      const inserted = who === "p" && table === PLATFORM_JOURNAL ? "written" : "refused"
      return {
        table,
        insert: granted("insert") ? inserted : "privilege",
        update: updateColumn(table).granted ? "0 rows" : "privilege",
        delete: granted("delete") ? "0 rows" : "privilege",
      }
    }

    /** La condition « la ligne de clé `match` » : chaque colonne de la clé égale à sa valeur (en texte, que la base convertit au type de la colonne). */
    function matching(sql: Tx, match: Row) {
      return Object.entries(match).reduce((condition, [column, value]) => sql`${condition} and ${sql(column)} = ${String(value)}`, sql`true`)
    }

    /** Insertion d'un clone, modification d'une colonne hors clé et suppression, par la clé de la ligne, avec `returning`. */
    async function attempt(db: PlatformDb, table: string, caller: string): Promise<Outcomes> {
      const row = rowOfB(table)
      const key = data.tables[table].primaryKey
      const match = Object.fromEntries(key.map((column) => [column, row[column]]))
      const { column } = updateColumn(table)
      const target = (sql: Tx) => sql(`platform.${table}`)
      const clone = cloneOf(table, row, caller)
      return {
        table,
        insert: outcomeOf(await answerOf(db.tx((sql) => sql`insert into ${target(sql)} ${sql(clone)}`), false)),
        update: outcomeOf(
          await answerOf(
            db.tx((sql) => sql`update ${target(sql)} set ${sql({ [column]: row[column] })} where ${matching(sql, match)} returning ${sql(key)}`),
            true,
          ),
        ),
        delete: outcomeOf(await answerOf(db.tx((sql) => sql`delete from ${target(sql)} where ${matching(sql, match)} returning ${sql(key)}`), true)),
      }
    }

    /**
     * Chaque table de B tentée par `who` ; la ligne que `p` écrit dans le journal admin de B retirée par
     * la connexion d'administration (la ligne semée de B est de `b`) ; B relue ensuite, identique.
     */
    async function expectWritesRefused(who: Who): Promise<void> {
      const caller = data.people[who].id
      const db = data.clientOf(who)
      const outcomes = await Promise.all(data.orgTables.map((table) => attempt(db, table, caller)))
      const removed = await data.admin`delete from ${data.admin(`platform.${PLATFORM_JOURNAL}`)} where org_id = ${data.b.id} and user_id = ${caller} returning id`
      expect(outcomes).toEqual(data.orgTables.map((table) => expectedOf(table, who)))
      expect(removed.length).toBe(who === "p" ? 1 : 0)
      expect(await data.snapshot(data.b.id)).toEqual(before)
    }

    it("should find each table of the project created by a package migration, with its row level security and a policy (AC1)", () => {
      const problems = Object.keys(data.tables).flatMap((table) => {
        const posed = data.schema[table]
        if (!posed?.createdIn) return [`${table}: created by no migration of the package`]
        return [...(posed.rls ? [] : [`${table}: row level security not enabled`]), ...(posed.policies.length > 0 ? [] : [`${table}: no policy`])]
      })
      expect(problems).toEqual([])
      // 22 : les tables de `platform` servies par le projet à E09-S04, seuil de `rls-policies.test.ts`
      // contre une spécification vide (une liste vide passerait la boucle sans rien prouver).
      expect(Object.keys(data.tables).length).toBeGreaterThanOrEqual(22)
    })

    it("should give anon no privilege on any table, and no function but org_by_host and public_node_by_token (AC2)", async () => {
      const tables = Object.entries(data.tables)
      const reads = await Promise.all(
        tables.map(async ([table, spec]) => [
          table,
          outcomeOf(await answerOf(withAnonSession((sql) => sql`select ${sql(spec.primaryKey)} from ${sql(`platform.${table}`)} limit 1`), true)),
        ]),
      )
      expect(Object.fromEntries(reads)).toEqual(Object.fromEntries(tables.map(([table]) => [table, "privilege"])))

      // Chaque fonction appelée par ses arguments nommés, tous nuls : le droit d'exécuter se contrôle avant son corps.
      const all = await platformFunctions()
      const functions = Object.entries(all).filter(([name]) => !(name in ANON_FUNCTIONS))
      // Chaque exception existe ; le niveau que la lecture publique calcule pour l'auteur du lien reste fermé.
      expect(Object.keys(ANON_FUNCTIONS).filter((name) => !(name in all))).toEqual([])
      expect(functions.map(([name]) => name)).toContain("node_level_of")
      const calls = await Promise.all(
        functions.map(async ([name, args]) => {
          const named = (sql: Tx) => args.reduce((list, arg, index) => (index === 0 ? sql`${sql(arg)} => null` : sql`${list}, ${sql(arg)} => null`), sql``)
          const { error } = await answerOf(withAnonSession((sql) => sql`select ${sql(`platform.${name}`)}(${named(sql)})`), true)
          return [name, error?.code ?? "answered"]
        }),
      )
      expect(Object.fromEntries(calls)).toEqual(Object.fromEntries(functions.map(([name]) => [name, "42501"])))
      const byHost = await withAnonSession((sql) => sql<{ id: string }[]>`select id from platform.org_by_host(${data.a.host})`)
      expect(byHost.map((org) => org.id)).toEqual([data.a.id])
      // Un jeton inconnu : `anon` exécute la lecture publique, qui ne rend rien.
      const shared = await withAnonSession((sql) => sql<{ node: unknown }[]>`select platform.public_node_by_token(${data.a.id}, ${"x".repeat(43)}) as node`)
      expect(shared).toEqual([{ node: null }])
    })

    it("should let a, member and administrator of A only, read no row of B in any table (AC3)", async () => {
      const unknown = Object.entries(data.attachments).flatMap(([table, attached]) => (attached.kind === "unknown" ? [`table sans rattachement connu : ${table}`] : []))
      expect(unknown).toEqual([])
      const empty = data.orgTables.filter((table) => (before[table] ?? []).length === 0)
      expect(empty.map((table) => `B n'a aucune ligne dans ${table} : compléter les données de la suite`)).toEqual([])

      expect(await readsOf(data.clientOf("a"))).toEqual(Object.fromEntries(data.orgTables.map((table) => [table, []])))
    })

    it("should refuse a every insertion, update and deletion of a row of B, table by table, B unchanged (AC4)", async () => {
      await expectWritesRefused("a")
    })

    it("should hold AC3 and AC4 for p, of the platform team with an access to A only, the platform scope aside, and keep platform_staff from a and b (AC5)", async () => {
      const inScope = (table: string) => (before[table] ?? []).map((row) => keyOf(data.tables[table].primaryKey, row)).sort()
      expect(await readsOf(data.clientOf("p"))).toEqual(Object.fromEntries(data.orgTables.map((table) => [table, PLATFORM_SCOPE.includes(table) ? inScope(table) : []])))
      await expectWritesRefused("p")

      const staff = (who: Who) =>
        data
          .clientOf(who)
          .tx((sql) => sql`select user_id from platform.platform_staff`)
          .then(
            (rows) => `${rows.length} rows`,
            (error: { code?: string }) => `error ${error.code}`,
          )
      expect({ a: await staff("a"), b: await staff("b") }).toEqual({ a: "0 rows", b: "0 rows" })
      const inserts = await Promise.all(
        (["a", "b", "p"] as const).map(async (who) => [
          who,
          outcomeOf(await answerOf(data.clientOf(who).tx((sql) => sql`insert into platform.platform_staff (user_id) values (${data.people[who].id})`), false)),
        ]),
      )
      expect(Object.fromEntries(inserts)).toEqual({ a: "privilege", b: "privilege", p: "privilege" })
    })
  },
)
