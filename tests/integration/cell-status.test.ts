// @vitest-environment node
// `cellStatus` (E08-S04, AC8, AC9, AC11) sur une base réelle (E01-S10, lot e2b) : l'équipe plateforme de la
// graine de référence (`seedReferenceOrg`), Théo appelant par `asCaller`, Léa hors de l'équipe. Les migrations
// servies sont celles que la base a appliquées, relues par la connexion d'administration (aucune sur un
// Postgres nu, que la CLI Supabase n'a jamais touché). Portable (AC-x3, fiche D76) : le job `bare-postgres` joue
// ce fichier. Déplacé de `tests/unit/cell.test.ts`, où `cellStatus` lisait deux RPC simulées.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import pkg from "@otomata_tech/oto_platform/package.json"
import { cellStatus } from "../../packages/plateforme/server/cell"
import { orgLimits, registerOrgLimits } from "../../packages/plateforme/server/limits"
import { seedReferenceOrg, type ReferenceOrgSql } from "../helpers/reference-org-sql"
import { asCaller, seedWithAdmin, spyDb, SQL_SKIP_REASON, sqlConfigured, type SeededData } from "../helpers/sql"

const SETUP_TIMEOUT = 120_000

const WITNESSES = {
  NEXT_PUBLIC_SUPABASE_URL: "valeur-temoin-1",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "valeur-temoin-2",
  NEXT_PUBLIC_SITE_URL: "valeur-temoin-3",
}

let seed: SeededData
let ref: ReferenceOrgSql

/** Le client d'une personne de la graine, face SQL seule. */
const clientOf = (person: "t" | "lea") => asCaller(ref.people[person].id, ref.people[person].email)

/** L'historique des migrations de la base, tel que `applied_migrations()` le lit ; vide sans la table de la CLI. */
async function appliedMigrations(): Promise<{ version: string; name: string | null }[]> {
  const [table] = await seed.admin<{ exists: boolean }[]>`select to_regclass('supabase_migrations.schema_migrations') is not null as exists`
  if (!table.exists) return []
  const rows = await seed.admin<{ version: string; name: string | null }[]>`
    select m.version::text as version, to_jsonb(m) ->> 'name' as name from supabase_migrations.schema_migrations m order by m.version`
  return [...rows]
}

describe.skipIf(!sqlConfigured)(sqlConfigured ? "cellStatus on a real database" : `cellStatus on a real database (${SQL_SKIP_REASON})`, { timeout: SETUP_TIMEOUT }, () => {
  beforeAll(async () => {
    seed = seedWithAdmin()
    ref = await seedReferenceOrg(seed)
  }, SETUP_TIMEOUT)

  afterAll(async () => {
    await seed?.cleanup()
  }, SETUP_TIMEOUT)

  it("should give the platform team the version, the applied migrations and the health, without any value (AC8)", async () => {
    const status = await cellStatus(clientOf("t"), WITNESSES)

    expect(status).toEqual({
      packageVersion: pkg.version,
      migrations: await appliedMigrations(),
      health: {
        database: { ok: true, latencyMs: expect.any(Number) },
        env: [
          { name: "NEXT_PUBLIC_SUPABASE_URL", present: true },
          { name: "NEXT_PUBLIC_SUPABASE_ANON_KEY", present: true },
          { name: "NEXT_PUBLIC_SITE_URL", present: true },
        ],
        ok: true,
        warnings: [],
      },
      checkedAt: expect.any(String),
    })
    expect(status.health.database.latencyMs).toBeGreaterThanOrEqual(0)
    expect(Number.isNaN(Date.parse(status.checkedAt))).toBe(false)
    const text = JSON.stringify(status)
    expect(Object.values(WITNESSES).filter((witness) => text.includes(witness))).toEqual([])
  })

  it("should name connectors_max, deprecated, once the host's limits set it, without touching the health (decision of 2026-11-25)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      registerOrgLimits({ read: ({ slug }) => (slug === ref.org.slug ? { connectors_max: 3 } : {}) })
      // Chargées deux fois : un seul avertissement, qui nomme la clé et l'organisation.
      await orgLimits(ref.org)
      await orgLimits(ref.org)
      const said = `connectors_max has no effect any more; the key will be refused at the next major version (set for ${ref.org.slug}).`
      expect(warn.mock.calls).toEqual([[`[platform] limits: ${said}`]])
      const status = await cellStatus(clientOf("t"), WITNESSES)
      expect([status.health.warnings, status.health.ok]).toEqual([[said], true])
    } finally {
      registerOrgLimits(null)
      warn.mockRestore()
    }
  })

  it("should not be healthy when a required variable is missing", async () => {
    const { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY } = WITNESSES
    const status = await cellStatus(clientOf("t"), { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY })
    expect(status.health.ok).toBe(false)
    expect(status.health.database.ok).toBe(true)
  })

  it("should refuse someone outside the platform team, without reading the migrations (AC9)", async () => {
    const { db, sent } = spyDb(clientOf("lea"))
    await expect(cellStatus(db, WITNESSES)).rejects.toMatchObject({
      code: "forbidden",
      message: "The cell status is reserved to the platform team.",
    })
    expect(sent.map((query) => query.target)).toEqual(["is_staff"])
  })

  it("should answer internal « Database unreachable. » without the database text when is_staff, applied_migrations or the connection fails (AC11)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const failures: [string, string][] = [
      ["is_staff", "57014"],
      ["applied_migrations", "42P01"],
      // Une connexion perdue : postgres.js la lève sous son propre code, sans SQLSTATE.
      ["is_staff", "CONNECTION_CLOSED"],
    ]
    for (const [target, code] of failures) {
      const { db } = spyDb(clientOf("t"), { fail: (query) => (query.target === target ? { code } : null) })
      await expect(cellStatus(db, WITNESSES), code).rejects.toMatchObject({
        name: "PlatformError",
        code: "internal",
        message: "Database unreachable.",
        details: undefined,
      })
    }
    vi.restoreAllMocks()
  })
})
