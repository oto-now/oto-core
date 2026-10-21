// @vitest-environment node
// Émetteur configurable, côté base (E01-S11, partie a1-core : AC-a4 à AC-a7, AC-a12, AC-a13), la base
// étant le sujet : `platform.identities`, `platform.identity_for_caller()`, l'oubli d'une personne
// (`forget_user`) et la copie de `members` qui suit un changement de personne (HN-M08-5). Portable
// (fiche D76) : sans Supabase Auth, par la connexion d'administration des suites portables
// (`tests/helpers/sql.ts`) et des sessions aux claims choisis, ceux que le serveur de l'hôte pose après
// avoir vérifié le jeton : sur le projet, et sur le Postgres nu du job `bare-postgres`. Données
// jetables (`t<hex>`, `test-<hex>@example.invalid`), oubliées après le passage ; chaque session aux
// claims choisis est annulée à sa fin, avec ce qu'elle a écrit.
import { randomBytes, randomUUID } from "crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { adminAsCaller, asClaims, type AdminTx } from "../helpers/admin-sql"
import { SQL_SKIP_REASON, sqlConfigured, testAdminSql, type TestSql } from "../helpers/sql"

const NETWORK_TIMEOUT = 60_000
const ready = sqlConfigured
const skipReason = SQL_SKIP_REASON

const hex = () => randomBytes(4).toString("hex")
const email = () => `test-${hex()}@example.invalid`
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
/** Une date passée, pour une invitation close. */
const PAST = new Date(Date.now() - 3_600_000)

/** Un émetteur OIDC et un projet Supabase propres à ce passage : leurs lignes ne croisent aucun autre test. */
const OIDC = `https://issuer-${hex()}.example.test/oidc`
const SUPABASE = `https://project-${hex()}.example.test/auth/v1`

/** Les claims que le serveur pose avant la traduction : émetteur, sujet, genre, email vérifié s'il y en a un. */
const oidcCaller = (subject: string, verified?: string) => ({ iss: OIDC, ext_sub: subject, issuer_kind: "oidc", ...(verified ? { email: verified } : {}) })
const supabaseCaller = (sub: string) => ({ iss: SUPABASE, ext_sub: sub, issuer_kind: "supabase" })

async function translate(tx: AdminTx): Promise<string | null> {
  const [{ id }] = await tx`select platform.identity_for_caller() as id`
  return id
}

/** Les claims de la session remplacés, comme `asClaims` les pose : un texte (`set_config`), pas un `jsonb`. */
async function setClaims(session: Pick<AdminTx, "unsafe">, claims: Record<string, unknown>): Promise<void> {
  await session.unsafe("select pg_catalog.set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: "authenticated", ...claims })])
}

/** Les lignes d'un sujet, lues hors de la RLS (le rôle de la session rendu à l'administration). */
async function rowsOf(tx: AdminTx, issuer: string, subject: string) {
  await tx.unsafe("reset role")
  return [...(await tx`select issuer, subject, user_id from platform.identities where issuer = ${issuer} and subject = ${subject}`)]
}

/** `write` sous le rôle d'administration, dans la session : ses lignes sont annulées avec elle. */
async function asAdmin(tx: AdminTx, write: () => Promise<unknown>): Promise<void> {
  await tx.unsafe("reset role")
  await write()
  await tx.unsafe("set local role authenticated")
}

/** Attend que la session `pid` attende un verrou ; au plus 10 s. */
async function lockWaitOf(tx: AdminTx, pid: number): Promise<void> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const [{ waiting }] = await tx`select exists (select 1 from pg_catalog.pg_locks where pid = ${pid} and not granted) as waiting`
    if (waiting) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`identity_for_caller never waited for a lock (backend ${pid})`)
}

describe.skipIf(!ready)(ready ? "issuer identities (E01-S11)" : `issuer identities (E01-S11) (${skipReason})`, { timeout: NETWORK_TIMEOUT }, () => {
  let sql: TestSql
  const org = { id: randomUUID(), slug: `t${hex()}` }
  const invited = email()
  const people = { ada: { id: randomUUID(), email: email() }, bob: { id: randomUUID(), email: email() } }
  /** Chaque personne à oublier au ménage, identifiants nés pendant le passage compris. */
  const forgotten = new Set<string>([people.ada.id, people.bob.id])

  beforeAll(async () => {
    sql = testAdminSql()
    await sql`insert into platform.orgs (id, name, slug, prefix) values (${org.id}, ${`test_${org.slug}`}, ${org.slug}, ${org.slug})`
    await sql`insert into platform.invitations (org_id, email) values (${org.id}, ${invited})`
    await sql`insert into platform.members (org_id, user_id, role, email, name) values
                (${org.id}, ${people.ada.id}, 'admin', ${people.ada.email}, 'Ada'),
                (${org.id}, ${people.bob.id}, 'member', ${people.bob.email}, 'Bob')`
  })

  afterAll(async () => {
    try {
      await sql`delete from platform.orgs where id = ${org.id}`
      for (const id of forgotten) await sql`select platform.forget_user(${id})`
    } finally {
      await sql?.end({ timeout: 5 })
    }
  })

  it("should give an invited person a new internal id at her first call, the same at the next, under which accept_invitations makes her a member (AC-a4)", async () => {
    const subject = `abc-${hex()}`
    const outcome = await asClaims(sql, oidcCaller(subject, invited.toUpperCase()), async (tx) => {
      const first = await translate(tx)
      const again = await translate(tx)
      // Ce que le serveur fait ensuite : `sub` posé à l'identifiant interne, puis l'acceptation.
      await setClaims(tx, { sub: first, email: invited })
      const [{ joined }] = await tx`select platform.accept_invitations() as joined`
      const rows = await rowsOf(tx, OIDC, subject)
      const members = [...(await tx`select user_id, email from platform.members where org_id = ${org.id} and user_id = ${first}`)]
      return { first, again, joined, rows, members }
    })

    expect(outcome.first).toMatch(UUID)
    expect(outcome.again).toBe(outcome.first)
    expect(outcome.rows).toEqual([{ issuer: OIDC, subject, user_id: outcome.first }])
    expect(outcome.joined).toEqual([expect.objectContaining({ org_id: org.id, role: "member" })])
    expect(outcome.members).toEqual([{ user_id: outcome.first, email: invited }])
  })

  it("should give two simultaneous first calls of one subject the same internal id, in one row (AC-a4)", async () => {
    const subject = `race-${hex()}`
    const other = await sql.reserve()
    let racing: Promise<string | null> = Promise.resolve(null)
    let won: string | null = null
    try {
      const [{ pid }] = await other`select pg_catalog.pg_backend_pid() as pid`
      await sql.begin(async (tx) => {
        await tx.unsafe("set local role authenticated")
        await setClaims(tx, oidcCaller(subject, invited))
        won = await translate(tx)
        // La seconde session trouve la ligne de la première, pas encore validée : elle l'attend.
        racing = (async () => {
          await other.unsafe("begin")
          try {
            await other.unsafe("set local role authenticated")
            await setClaims(other, oidcCaller(subject, invited))
            const [{ id }] = await other`select platform.identity_for_caller() as id`
            await other.unsafe("commit")
            return id
          } catch (error) {
            // La connexion revient au pool hors de toute transaction, même après un échec.
            await other.unsafe("rollback")
            throw error
          }
        })()
        await lockWaitOf(tx, pid)
      })
      if (won) forgotten.add(won)
      expect(await racing).toBe(won)
      const rows = [...(await sql`select user_id from platform.identities where issuer = ${OIDC} and subject = ${subject}`)]
      expect(rows).toEqual([{ user_id: won }])
    } finally {
      await racing.catch(() => null)
      other.release()
    }
  })

  it("should give no id and write no row for a person neither invited nor of the platform team (AC-a5)", async () => {
    const subject = `z-${hex()}`
    const outcome = await asClaims(sql, oidcCaller(subject, email()), async (tx) => ({ id: await translate(tx), rows: await rowsOf(tx, OIDC, subject) }))

    expect(outcome).toEqual({ id: null, rows: [] })
  })

  // Le filtre « invitation ouverte » : chaque condition seule écarte son invitation, les autres vraies.
  it.each([
    { state: "accepted", closed: { accepted_at: PAST } },
    { state: "declined", closed: { declined_at: PAST } },
    { state: "revoked", closed: { revoked_at: PAST } },
    { state: "expired", closed: { expires_at: PAST } },
  ])("should give no id and write no row for a person whose only invitation is $state (AC-a4, AC-a5)", async ({ closed }) => {
    const address = email()
    const subject = `closed-${hex()}`
    const outcome = await asClaims(sql, oidcCaller(subject, address), async (tx) => {
      await asAdmin(tx, () => tx`insert into platform.invitations ${tx({ org_id: org.id, email: address, ...closed })}`)
      return { id: await translate(tx), rows: await rowsOf(tx, OIDC, subject) }
    })

    expect(outcome).toEqual({ id: null, rows: [] })
  })

  it("should give no id and accept no invitation without a verified email (AC-a6)", async () => {
    const subject = `unverified-${hex()}`
    const outcome = await asClaims(sql, oidcCaller(subject), async (tx) => {
      const id = await translate(tx)
      const rows = await rowsOf(tx, OIDC, subject)
      const [{ open }] = await tx`select count(*)::int as open from platform.invitations where org_id = ${org.id} and email = ${invited} and accepted_at is null`
      return { id, rows, open }
    })

    expect(outcome).toEqual({ id: null, rows: [], open: 1 })
  })

  it("should keep the Supabase sub as the internal id, its row born once, the members unchanged (AC-a7)", async () => {
    const before = [...(await sql`select * from platform.members where user_id = ${people.ada.id}`)]
    const outcome = await asClaims(sql, supabaseCaller(people.ada.id), async (tx) => {
      const first = await translate(tx)
      const again = await translate(tx)
      const rows = await rowsOf(tx, SUPABASE, people.ada.id)
      const members = [...(await tx`select * from platform.members where user_id = ${people.ada.id}`)]
      return { first, again, rows, members }
    })

    expect(outcome.first).toBe(people.ada.id)
    expect(outcome.again).toBe(people.ada.id)
    expect(outcome.rows).toEqual([{ issuer: SUPABASE, subject: people.ada.id, user_id: people.ada.id }])
    expect(outcome.members).toEqual(before)
  })

  it("should let a person read her rows only, write none directly (42501), and anon translate nobody (AC-a12)", async () => {
    const someone = randomUUID()
    const denied = (write: Promise<unknown>) => write.then(() => "written", (error: { code?: string }) => error.code)
    const rows = (tx: AdminTx) => tx`insert into platform.identities (issuer, subject, user_id) values
                 (${OIDC}, ${`bob-${hex()}`}, ${people.bob.id}), (${SUPABASE}, ${people.bob.id}, ${people.bob.id}),
                 (${OIDC}, ${`other-${hex()}`}, ${someone})`
    const outcome = await adminAsCaller(sql, people.bob.id, [rows], async (tx) => {
      const read = [...(await tx`select issuer, user_id from platform.identities order by issuer`)]
      const writes = {
        insert: await denied(tx.savepoint((sp) => sp`insert into platform.identities (issuer, subject, user_id) values (${OIDC}, ${`mine-${hex()}`}, ${people.bob.id})`)),
        update: await denied(tx.savepoint((sp) => sp`update platform.identities set user_id = ${someone} where user_id = ${people.bob.id}`)),
        delete: await denied(tx.savepoint((sp) => sp`delete from platform.identities where user_id = ${people.bob.id}`)),
      }
      await tx.unsafe("set local role anon")
      const anon = await denied(tx.savepoint((sp) => sp`select platform.identity_for_caller()`))
      return { read, writes, anon }
    })

    expect(outcome.read).toEqual([
      { issuer: OIDC, user_id: people.bob.id },
      { issuer: SUPABASE, user_id: people.bob.id },
    ])
    expect(outcome.writes).toEqual({ insert: "42501", update: "42501", delete: "42501" })
    expect(outcome.anon).toBe("42501")
  })

  it("should link a verified email of the platform team to its oldest platform_staff row, before an open invitation of that email, and to one subject only (AC-a13)", async () => {
    const address = email()
    const subject = `staff-${hex()}`
    const second = `staff-again-${hex()}`
    // Trois lignes de l'équipe plateforme au même email, écrites à rebours de l'ordre attendu : la plus
    // récente d'abord, puis deux de même date, la plus grande clé avant la plus petite, qui est la bonne.
    const [oldest, tied] = [randomUUID(), randomUUID()].sort()
    const newest = randomUUID()
    const outcome = await asClaims(sql, oidcCaller(subject, address), async (tx) => {
      await asAdmin(tx, async () => {
        await tx`insert into platform.platform_staff (user_id, email, name, added_at) values
                   (${newest}, ${address}, 'Stella', now()),
                   (${tied}, ${address}, 'Stella', now() - interval '1 hour'),
                   (${oldest}, ${address}, 'Stella', now() - interval '1 hour')`
        await tx`insert into platform.invitations (org_id, email) values (${org.id}, ${address})`
      })
      const id = await translate(tx)
      // Un second sujet au même email vérifié (compte recréé chez l'émetteur, adresse reprise) : l'identifiant est déjà lié.
      await setClaims(tx, oidcCaller(second, address))
      const again = await translate(tx)
      await tx.unsafe("reset role")
      const rows = [...(await tx`select subject, user_id from platform.identities where issuer = ${OIDC} and subject in (${subject}, ${second})`)]
      return { id, again, rows }
    })

    expect(outcome).toEqual({ id: oldest, again: null, rows: [{ subject, user_id: oldest }] })
  })

  it("should forget the issuer rows of a person with forget_user (E01-S09 AC6)", async () => {
    const person = randomUUID()
    forgotten.add(person)
    await sql`insert into platform.identities (issuer, subject, user_id) values (${OIDC}, ${`gone-${hex()}`}, ${person}), (${SUPABASE}, ${person}, ${person})`

    await sql`select platform.forget_user(${person})`

    expect([...(await sql`select issuer from platform.identities where user_id = ${person}`)]).toEqual([])
  })

  it("should drop the copies of the previous person when a member row changes person under a token, and only then (HN-M08-5)", async () => {
    const replacement = randomUUID()
    const underToken = await asClaims(sql, { sub: people.ada.id, email: people.ada.email }, async (tx) => {
      const [moved] = await tx`update platform.members set user_id = ${replacement} where org_id = ${org.id} and user_id = ${people.bob.id} returning email, name, last_sign_in_at`
      const [same] = await tx`update platform.members set user_id = ${people.ada.id} where org_id = ${org.id} and user_id = ${people.ada.id} returning email, name`
      return { moved, same }
    })
    const byTooling = await sql
      .begin(async (tx) => {
        const [kept] = await tx`update platform.members set user_id = ${replacement} where org_id = ${org.id} and user_id = ${people.bob.id} returning email, name`
        throw Object.assign(new Error("rollback"), { kept })
      })
      .catch((error: { kept?: unknown }) => error.kept)

    expect(underToken).toEqual({
      moved: { email: null, name: null, last_sign_in_at: null },
      same: { email: people.ada.email, name: "Ada" },
    })
    expect(byTooling).toEqual({ email: people.bob.email, name: "Bob" })
  })
})
