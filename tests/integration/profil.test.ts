// @vitest-environment node
// La personne écrit sa fiche (E01-S06 : AC33, H31 amendé, P39) : nom et langue seulement, par
// `update_my_profile`, sous sa session. Une organisation jetable, Léa membre de son équipe Ventes, et une
// personne hors de l'organisation. Suite portable depuis E01-S10 f2 : semée par la connexion
// d'administration (`seedWithAdmin`), chaque appel sous l'appelant (`asCaller`), sans Supabase Auth ni
// PostgREST ; le job `bare-postgres` la joue.
import { isDeepStrictEqual } from "node:util"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { OTO_THEMES } from "@otomata_tech/oto_platform/schemas"
import type { Json } from "../../packages/plateforme/server/database"
import { pendingMigrations, pendingReason } from "../helpers/pending-migrations"
import { asCaller, seedWithAdmin, SQL_SKIP_REASON, sqlConfigured, type SeededData, type SeededOrg, type SeededPerson } from "../helpers/sql"

const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 180_000
const SUITE = "update_my_profile"

describe.skipIf(!sqlConfigured)(sqlConfigured ? SUITE : `${SUITE} (${SQL_SKIP_REASON})`, { timeout: NETWORK_TIMEOUT }, () => {
  let seed: SeededData
  let org: SeededOrg
  let lea: SeededPerson
  let outsider: SeededPerson

  /** `update_my_profile` sous la personne : la fiche rendue, ou l'erreur de la base. */
  const update = (who: SeededPerson, patch: Json, orgId = org.id) =>
    asCaller(who.id, who.email)
      .tx((sql) => sql<{ profile: Json }[]>`select platform.update_my_profile(${orgId}, ${sql.json(patch)}) as profile`)
      .then(([row]) => row.profile)

  async function member() {
    const [row] = await seed.admin<{ role: string; default_team_id: string | null; profile: Json }[]>`
      select role, default_team_id, profile from platform.members where org_id = ${org.id} and user_id = ${lea.id}`
    if (!row) throw new Error("members read failed: no row")
    return row
  }

  beforeAll(async () => {
    seed = seedWithAdmin()
    org = await seed.createOrg()
    const [ventes] = await seed.admin<{ id: string }[]>`insert into platform.teams (org_id, slug, name) values (${org.id}, 'ventes', 'Ventes') returning id`
    lea = seed.person()
    await seed.admin`insert into platform.members (org_id, user_id, role, default_team_id, profile, email, name)
                     values (${org.id}, ${lea.id}, 'member', ${ventes.id}, ${seed.admin.json({ handle: "lea", name: "Léa", tone: "Tutoiement." })}, ${lea.email}, 'Léa Roux')`
    outsider = seed.person()
  }, SETUP_TIMEOUT)

  afterAll(async () => {
    await seed?.cleanup()
  }, SETUP_TIMEOUT)

  it("should write the trimmed name and language, keep the other keys, and return the profile", async () => {
    const before = await member()
    const profile = await update(lea, { name: " Léa Roux ", language: "fr" })
    expect(profile).toEqual({ handle: "lea", name: "Léa Roux", tone: "Tutoiement.", language: "fr" })
    const after = await member()
    expect(after.profile).toEqual(profile)
    expect({ role: after.role, team: after.default_team_id }).toEqual({ role: before.role, team: before.default_team_id })
  })

  it("should remove a key given an empty string", async () => {
    await update(lea, { language: "en" })
    const profile = await update(lea, { language: "" })
    expect(profile).not.toHaveProperty("language")
    expect(profile).toMatchObject({ handle: "lea" })
  })

  it("should refuse the keys role and handle (22023)", async () => {
    for (const key of ["role", "handle"]) await expect(update(lea, { [key]: "x" }), key).rejects.toMatchObject({ code: "22023" })
  })

  it("should refuse a language other than fr or en (22023)", async () => {
    await expect(update(lea, { language: "de" })).rejects.toMatchObject({ code: "22023" })
  })

  it("should refuse someone who is not a member of the organisation (42501)", async () => {
    await expect(update(outsider, { name: "Pierre" })).rejects.toMatchObject({ code: "42501" })
  })

  // E05-S11 (AC-5) : prénom, nom de famille et couleur, `20260928110000_platform_profil.sql`. Sur le projet, la
  // migration n'est appliquée que juste avant la fusion du lot a : d'ici là, ces cas se sautent en la nommant.
  describe("first name, last name and theme (E05-S11, AC-5)", () => {
    const VERSION = "20260928110000"
    const skipIfPending = async (ctx: { skip: (condition: boolean, note: string) => void }) => {
      const pending = (await pendingMigrations()).filter((version) => version >= VERSION)
      ctx.skip(pending.length > 0, pendingReason(pending))
    }

    it("should write the first name, the last name and the theme, and compose the name from both names, over a name of the same patch", async (ctx) => {
      await skipIfPending(ctx)
      await update(lea, { first_name: "", last_name: "", theme: "", language: "" })
      expect(await update(lea, { name: "Autre", first_name: " Léa ", theme: "foret" })).toEqual({
        handle: "lea",
        tone: "Tutoiement.",
        name: "Léa",
        first_name: "Léa",
        theme: "foret",
      })
      const profile = await update(lea, { last_name: "Roux", language: "en" })
      expect(profile).toMatchObject({ name: "Léa Roux", first_name: "Léa", last_name: "Roux", theme: "foret", language: "en" })
      expect((await member()).profile).toEqual(profile)
      // Écrit seul, le nom ne touche ni au prénom ni au nom de famille.
      expect(await update(lea, { name: "Léa R." })).toMatchObject({ name: "Léa R.", first_name: "Léa", last_name: "Roux" })
    })

    it("should remove the name with both names emptied, and the theme given an empty string", async (ctx) => {
      await skipIfPending(ctx)
      await update(lea, { first_name: "Léa", last_name: "Roux", theme: "cobalt", language: "" })
      const profile = await update(lea, { first_name: "", last_name: "", theme: "" })
      expect(Object.keys(profile as object).sort()).toEqual(["handle", "tone"])
    })

    // Parité de la liste SQL (`v_themes`) et de `OTO_THEMES` (Zod) : chacun des huit thèmes s'écrit.
    it("should write each of the eight themes", async (ctx) => {
      await skipIfPending(ctx)
      const written: Record<string, unknown> = {}
      for (const theme of OTO_THEMES) {
        const profile = await update(lea, { theme })
        written[theme] = profile && typeof profile === "object" && !Array.isArray(profile) ? profile.theme : profile
      }
      expect(written).toEqual(Object.fromEntries(OTO_THEMES.map((theme) => [theme, theme])))
    })

    it("should refuse an unknown key, a theme outside the eight or not a string, and a name over 80 characters (22023), writing nothing", async (ctx) => {
      await skipIfPending(ctx)
      const refused: [string, Json][] = [
        ["an unknown key", { nickname: "Lé" }],
        ["a theme outside the eight", { theme: "rose" }],
        ["a first name over 80 characters", { first_name: "x".repeat(81) }],
        ["a last name over 80 characters", { last_name: "x".repeat(81) }],
        ["a theme that is not a string", { theme: 3 }],
      ]
      const verdicts: Record<string, { code: unknown; profileKept: boolean }> = {}
      for (const [name, patch] of refused) {
        const before = await member()
        const code = await update(lea, patch).then(
          () => "accepted",
          (error: { code?: unknown }) => error.code,
        )
        verdicts[name] = { code, profileKept: isDeepStrictEqual((await member()).profile, before.profile) }
      }
      expect(verdicts).toEqual(Object.fromEntries(refused.map(([name]) => [name, { code: "22023", profileKept: true }])))
    })
  })
})
