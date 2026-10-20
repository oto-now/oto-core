// @vitest-environment node
// Fondation du port de base (E01-S10 partie a) sur une vraie base : sessions d'un appelant et
// anonyme (AC-a1, AC-a2), rôle `platform_app` limité (AC-a3), transaction imbriquée, reprise sous la
// même session et refusée sous une autre (AC-a8), en suites portables (`sqlConfigured` : le projet
// Supabase, ou le Postgres nu du job `bare-postgres`, AC-a7). Les deux faces d'un même client (AC-a4)
// sont parties avec la face PostgREST (E01-S10 f2, AC-f2).
// Données jetables : `seedWithAdmin` (connexion d'administration des tests).
import { randomUUID } from "crypto"
import type postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import type { PlatformDb } from "../../packages/plateforme/server/db"
import { withAnonSession, withCallerSession, withServerSession } from "../../packages/plateforme/server/sql"
import { asCaller, seedWithAdmin, SQL_SKIP_REASON, sqlConfigured, type SeededData, type SeededOrg, type SeededPerson } from "../helpers/sql"

const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 180_000
// AC-a8 : quelques centaines de millisecondes mesurées ; au-delà, la transaction imbriquée attend la
// seule connexion du pool, l'attente que l'AC exclut (mutation jouée : délai dépassé).
const NESTED_TIMEOUT = 20_000

// Toute connexion postgres.js de ce fichier réduite à une seule : le pool du paquet devient « un pool
// d'une connexion » (AC-a8), et il est gardé pour les lectures faites sur cette connexion hors de
// toute session (AC-a1, AC-a3). Le pilote réel sert chaque requête. Sur le pooler de Supabase (mode
// transaction), cette connexion unique ne garde pas la même connexion serveur d'une transaction à
// l'autre : la lecture de la connexion rendue (AC-a1) n'y est qu'indicative ; elle fait preuve sur le
// Postgres nu du job `bare-postgres`, en connexion directe.
const pools = vi.hoisted((): { url: string; sql: postgres.Sql }[] => [])

vi.mock("postgres", async (importOriginal) => {
  // Le module ESM de postgres.js (`src/index.js`) n'a qu'un export par défaut ; ses types le déclarent en `export =`.
  const actual = await importOriginal<{ default: typeof import("postgres") }>()
  const oneConnection = (url: string, options: object = {}) => {
    const sql = actual.default(url, { ...options, max: 1 })
    pools.push({ url, sql })
    return sql
  }
  return { ...actual, default: Object.assign(oneConnection, actual.default) }
})

/** Le pool du paquet (`PLATFORM_DATABASE_URL`, rôle `platform_app`), ouvert par une session vide. */
async function packagePool(): Promise<postgres.Sql> {
  await withAnonSession(async () => null)
  const found = pools.find((pool) => pool.url === process.env.PLATFORM_DATABASE_URL)
  if (!found) throw new Error("the package pool was not created")
  return found.sql
}

afterAll(async () => {
  const opened = pools.filter((pool) => pool.url === process.env.PLATFORM_DATABASE_URL)
  // Le pool du paquet ne se ferme qu'ici : `sql.ts` le garde pour tout le processus.
  await Promise.all(opened.map((pool) => pool.sql.end({ timeout: 5 })))
})

describe.skipIf(!sqlConfigured)(
  sqlConfigured ? "SQL sessions of the package, portable" : `SQL sessions of the package, portable (${SQL_SKIP_REASON})`,
  { timeout: NETWORK_TIMEOUT },
  () => {
    let seed: SeededData
    let org: SeededOrg
    let lea: SeededPerson

    beforeAll(async () => {
      seed = seedWithAdmin()
      org = await seed.createOrg()
      lea = seed.person()
      await seed.addMember(org.id, lea)
    }, SETUP_TIMEOUT)

    afterAll(async () => {
      await seed?.cleanup()
    })

    it("should open a caller session with its id, email and name, no email when it has none, and give back a clean connection (AC-a1)", async () => {
      const caller = { userId: lea.id, email: lea.email, name: "Léa Roux" }
      const [seen] = await withCallerSession(caller, (sql) => sql`
        select auth.uid() as uid, current_user as role, auth.jwt() ->> 'email' as email, auth.jwt() ->> 'name' as name`)
      expect(seen).toEqual({ uid: lea.id, role: "authenticated", email: lea.email, name: "Léa Roux" })

      const [withoutEmail] = await withCallerSession({ userId: lea.id }, (sql) => sql`
        select auth.jwt() ->> 'email' as email, auth.jwt() ->> 'name' as name`)
      expect(withoutEmail).toEqual({ email: null, name: null })

      const pool = await packagePool()
      const [after] = await pool`select current_user as role, nullif(current_setting('request.jwt.claims', true), '') as claims`
      expect(after).toEqual({ role: "platform_app", claims: null })
    })

    it("should keep the caller whatever claim an earlier client of the pooler left on the connection (AC-a1)", async () => {
      const pool = await packagePool()
      const begin = pool.begin
      const other = randomUUID()
      // Ce qu'un autre client de `platform_app` aurait laissé sur la connexion, que le pooler ne remet
      // pas à zéro, rejoué en tête de chaque transaction et pour elle seule (rien ne reste au pooler) :
      // sur Supabase, `auth.uid()` et `auth.jwt()` lisent ces réglages avant `request.jwt.claims`.
      const inheriting = (fn: (sql: postgres.TransactionSql) => Promise<unknown>) =>
        begin(async (sql) => {
          await sql`select set_config('request.jwt.claim.sub', ${other}, true),
                           set_config('request.jwt.claim', ${JSON.stringify({ sub: other, email: "other@example.invalid" })}, true)`
          return fn(sql)
        })
      Object.assign(pool, { begin: inheriting })
      try {
        const [seen] = await withCallerSession({ userId: lea.id, email: lea.email }, (sql) => sql`
          select auth.uid() as uid, auth.jwt() ->> 'email' as email`)
        expect(seen).toEqual({ uid: lea.id, email: lea.email })
      } finally {
        Object.assign(pool, { begin })
      }
    })

    it("should turn JIT off in a session, for it alone, and leave the setting of the server on the connection given back", async () => {
      // Les policies évaluent le niveau du nœud par sous-requête, que le planificateur compte pour chaque ligne :
      // JIT actif, la lecture d'un tableau de milliers de lignes était compilée.
      const [inCaller] = await withCallerSession({ userId: lea.id }, (sql) => sql`select current_setting('jit') as jit`)
      expect(inCaller).toEqual({ jit: "off" })
      const [inServer] = await withServerSession({ userId: lea.id }, (sql) => sql`select current_setting('jit') as jit`)
      expect(inServer).toEqual({ jit: "off" })
      const [inAnon] = await withAnonSession((sql) => sql`select current_setting('jit') as jit`)
      expect(inAnon).toEqual({ jit: "off" })

      const pool = await packagePool()
      const [after] = await pool`select current_setting('jit') as jit, (select reset_val from pg_settings where name = 'jit') as server`
      expect(after.jit).toBe(after.server)
    })

    it("should render an instant read by to_json in UTC whatever time zone the connection carries (M32, HN-E01S10-b1-8)", async () => {
      const pool = await packagePool()
      const begin = pool.begin
      // Un serveur réglé sur un autre fuseau, rejoué en tête de chaque transaction et pour elle seule.
      const elsewhere = (fn: (sql: postgres.TransactionSql) => Promise<unknown>) =>
        begin(async (sql) => {
          await sql`select set_config('TimeZone', 'Asia/Tokyo', true)`
          return fn(sql)
        })
      Object.assign(pool, { begin: elsewhere })
      try {
        const [seen] = await withCallerSession({ userId: lea.id }, (sql) => sql`
          select to_json(${"2026-09-27T23:30:00.000Z"}::text::timestamptz) #>> '{}' as at`)
        expect(seen).toEqual({ at: "2026-09-27T23:30:00+00:00" })
      } finally {
        Object.assign(pool, { begin })
      }
    })

    it("should find the organisation of an address without a caller, and read no table of platform (AC-a2)", async () => {
      const found = await withAnonSession((sql) => sql`select id, current_user as role from platform.org_by_host(${org.host})`)
      expect(found.map((row) => ({ ...row }))).toEqual([{ id: org.id, role: "anon" }])

      const read = await withAnonSession((sql) => sql`select id from platform.orgs`).then(
        (rows) => ({ rows: rows.length }),
        (error: { code?: string }) => ({ code: error.code }),
      )
      expect([{ code: "42501" }, { rows: 0 }]).toContainEqual(read)
    })

    it("should refuse platform_app a table of platform without a session: it inherits nothing (AC-a3)", async () => {
      const pool = await packagePool()
      await expect(pool`select id from platform.orgs limit 1`).rejects.toMatchObject({ code: "42501" })
    })

    it("should run a service's tx in the transaction of its caller on a one-connection pool, and roll both back when it fails (AC-a8)", async () => {
      const db = asCaller(lea.id, lea.email)
      /** Un service qui ouvre sa propre transaction, appelé par un autre. */
      const txidOf = (service: PlatformDb) => service.tx(async (sql) => (await sql`select txid_current()::text as txid`)[0].txid)

      const [outer, inner] = await db.tx(async (sql) => [(await sql`select txid_current()::text as txid`)[0].txid, await txidOf(db)])
      expect(inner).toBe(outer)

      const write = (sql: postgres.TransactionSql, tool: string) =>
        sql`insert into platform.journal (org_id, user_id, method, tool) values (${org.id}, ${lea.id}, 'tools/call', ${tool})`
      const failed = db.tx(async (sql) => {
        await write(sql, "outer")
        await db.tx(async (nested) => {
          await write(nested, "inner")
          throw new Error("inner service failed")
        })
      })
      await expect(failed).rejects.toThrow("inner service failed")
      const written = await seed.admin`select tool from platform.journal where org_id = ${org.id}`
      expect(written.map((row) => row.tool)).toEqual([])
    }, NESTED_TIMEOUT)

    it("should refuse the transaction of another session inside an open one, instead of waiting for a second connection (AC-a8)", async () => {
      const nested = withCallerSession({ userId: lea.id, email: lea.email }, () => withAnonSession(async () => "ran"))
      await expect(nested).rejects.toThrow(/autre session/)
    }, NESTED_TIMEOUT)
  },
)
