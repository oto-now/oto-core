// @vitest-environment node
// Le nom d'une personne qui arrive dans un espace (retour RET-010, migration `members_profile_on_arrival`) : son
// profil reprend le nom, le prénom et le nom de famille de son profil dans un autre espace ; sans profil nommé ailleurs,
// rien n'est copié, et l'identité la nomme par le nom de son compte, comme l'annuaire ; un profil qui porte déjà un nom
// n'est pas touché, et un nom changé ensuite ne change pas les autres espaces.
// Suite portable : semée par la connexion d'administration, le job `bare-postgres` la joue.
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { Json } from "../../packages/plateforme/server/database"
import { identityInOrg } from "../../packages/plateforme/server/identity"
import { pendingMigrations, pendingReason } from "../helpers/pending-migrations"
import { asCaller, seedWithAdmin, SQL_SKIP_REASON, sqlConfigured, type SeededData, type SeededOrg } from "../helpers/sql"

const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 180_000
const VERSION = "20261119170000"
const SUITE = "members_profile_on_arrival"

describe.skipIf(!sqlConfigured)(sqlConfigured ? SUITE : `${SUITE} (${SQL_SKIP_REASON})`, { timeout: NETWORK_TIMEOUT }, () => {
  let seed: SeededData
  let principal: SeededOrg
  let nouvel: SeededOrg

  beforeAll(async () => {
    seed = seedWithAdmin()
    principal = await seed.createOrg()
    nouvel = await seed.createOrg()
  }, SETUP_TIMEOUT)

  afterAll(async () => {
    await seed?.cleanup()
  }, SETUP_TIMEOUT)

  const profil = async (orgId: string, userId: string) => {
    const [row] = await seed.admin<{ profile: Json }[]>`select profile from platform.members where org_id = ${orgId} and user_id = ${userId}`
    return row?.profile
  }

  it("should take the names of the person's profile in another space, copy nothing else, and leave a named profile as it is", async (ctx) => {
    const pending = (await pendingMigrations()).filter((version) => version >= VERSION)
    ctx.skip(pending.length > 0, pendingReason(pending))
    const ailleurs = seed.person()
    await seed.admin`insert into platform.members (org_id, user_id, role, profile, email, name)
                     values (${principal.id}, ${ailleurs.id}, 'admin', ${seed.admin.json({ handle: "alex", name: "Alex Martin", first_name: "Alex", last_name: "Martin", language: "en" })}, ${ailleurs.email}, null)`
    await seed.admin`insert into platform.members (org_id, user_id, role, email, name) values (${nouvel.id}, ${ailleurs.id}, 'admin', ${ailleurs.email}, 'alex')`
    const compte = seed.person()
    await seed.admin`insert into platform.members (org_id, user_id, role, email, name) values (${nouvel.id}, ${compte.id}, 'member', ${compte.email}, ' Camille Durand ')`
    const sansNom = seed.person()
    await seed.admin`insert into platform.members (org_id, user_id, role, email) values (${nouvel.id}, ${sansNom.id}, 'member', ${sansNom.email})`
    const nomme = seed.person()
    await seed.admin`insert into platform.members (org_id, user_id, role, profile, email) values (${principal.id}, ${nomme.id}, 'member', ${seed.admin.json({ name: "Ancien" })}, ${nomme.email})`
    await seed.admin`insert into platform.members (org_id, user_id, role, profile, email) values (${nouvel.id}, ${nomme.id}, 'member', ${seed.admin.json({ name: "Choisi" })}, ${nomme.email})`

    expect([await profil(nouvel.id, ailleurs.id), await profil(nouvel.id, compte.id), await profil(nouvel.id, sansNom.id), await profil(nouvel.id, nomme.id)]).toEqual([
      { name: "Alex Martin", first_name: "Alex", last_name: "Martin" },
      {},
      {},
      { name: "Choisi" },
    ])

    // Sans nom de profil, l'identité nomme la personne par le nom de son compte, sinon par le début de son email.
    const nommer = async (qui: { id: string; email: string }) =>
      (await identityInOrg(asCaller(qui.id, qui.email), { ...nouvel, brand: {}, domains: null }, { userId: qui.id, email: qui.email })).user.name
    expect([await nommer(ailleurs), await nommer(compte), await nommer(sansNom)]).toEqual(["Alex Martin", "Camille Durand", sansNom.email.split("@")[0]])

    // Un nom changé ensuite dans le nouvel espace ne change pas l'autre.
    await asCaller(ailleurs.id, ailleurs.email).tx((sql) => sql`select platform.update_my_profile(${nouvel.id}, ${sql.json({ name: "Alex M." })})`)
    expect([(await profil(nouvel.id, ailleurs.id)) as Record<string, Json>, (await profil(principal.id, ailleurs.id)) as Record<string, Json>].map((un) => un.name)).toEqual(["Alex M.", "Alex Martin"])
  })
})
