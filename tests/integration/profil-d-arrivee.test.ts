// @vitest-environment node
// Le nom d'une personne qui arrive dans un espace (retour RET-010, migration `members_profile_on_arrival`) : dans un
// espace qu'elle crée, son profil reprend le nom, le prénom et le nom de famille de son profil dans un autre espace,
// chacun coupé à 80 caractères ; rejoindre l'espace d'un autre laisse le profil vierge, et l'identité la nomme par le nom
// de son compte, comme l'annuaire ; sans profil nommé ailleurs, rien n'est copié ; un profil qui porte déjà un nom n'est
// pas touché, et un nom changé ensuite ne change pas les autres espaces.
// Suite portable : semée par la connexion d'administration, le job `bare-postgres` la joue.
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { Json } from "../../packages/plateforme/server/database"
import { identityInOrg } from "../../packages/plateforme/server/identity"
import { pendingMigrations, pendingReason } from "../helpers/pending-migrations"
import { hex } from "../helpers/plateforme"
import { asCaller, seedWithAdmin, SQL_SKIP_REASON, sqlConfigured, type SeededData, type SeededOrg, type SeededPerson } from "../helpers/sql"

const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 180_000
const VERSION = "20261125160000"
const SUITE = "members_profile_on_arrival"

describe.skipIf(!sqlConfigured)(sqlConfigured ? SUITE : `${SUITE} (${SQL_SKIP_REASON})`, { timeout: NETWORK_TIMEOUT }, () => {
  let seed: SeededData
  let principal: SeededOrg
  let autre: SeededOrg
  /** Les organisations créées hors de `seed.createOrg` (inscription, transaction de l'outillage), retirées en fin de suite. */
  const created: string[] = []

  beforeAll(async () => {
    seed = seedWithAdmin()
    principal = await seed.createOrg()
    autre = await seed.createOrg()
  }, SETUP_TIMEOUT)

  afterAll(async () => {
    if (seed && created.length > 0) await seed.admin`delete from platform.orgs where id in ${seed.admin(created)}`
    await seed?.cleanup()
  }, SETUP_TIMEOUT)

  const skipPending = async (ctx: { skip: (condition: boolean, note: string) => void }) => {
    const pending = (await pendingMigrations()).filter((version) => version >= VERSION)
    ctx.skip(pending.length > 0, pendingReason(pending))
  }

  /** Le profil, sans le handle que la base pose à l'arrivée. */
  const profil = async (orgId: string, userId: string) => {
    const [row] = await seed.admin<{ profile: Json }[]>`select profile - 'handle' as profile from platform.members where org_id = ${orgId} and user_id = ${userId}`
    return row?.profile
  }

  const ailleursNomme = async (qui: SeededPerson, profile: Record<string, Json>) => {
    await seed.admin`insert into platform.members (org_id, user_id, role, profile, email) values (${principal.id}, ${qui.id}, 'member', ${seed.admin.json(profile)}, ${qui.email})`
  }

  /** La personne crée son propre espace par l'inscription (`signup_org`), le nom de ses claims donné ou non. */
  const creer = async (qui: SeededPerson, name?: string) => {
    const slug = `t${hex(5)}`
    const [row] = await asCaller(qui.id, qui.email, name).tx(
      (sql) => sql<{ id: string }[]>`select platform.signup_org(p_name => ${`test_${slug}`}, p_slug => ${slug}, p_prefix => ${slug}, p_hosts => ${[]}::text[]) as id`,
      "server",
    )
    created.push(row.id)
    return row.id
  }

  it("should take the names of the person's profile in another space into a space she creates, cut to 80 characters, and leave a named profile as it is", async (ctx) => {
    await skipPending(ctx)
    const ailleurs = seed.person()
    await ailleursNomme(ailleurs, { name: "Alex Martin", first_name: "Alex", last_name: "Martin", language: "en" })
    const long = seed.person()
    await ailleursNomme(long, { name: "N".repeat(85), first_name: ` ${"P".repeat(90)}`, last_name: 42 })
    const nomme = seed.person()
    await ailleursNomme(nomme, { name: "Ancien" })
    const sansNom = seed.person()

    const espaces = [await creer(ailleurs), await creer(long), await creer(nomme, "Choisi"), await creer(sansNom)]
    expect(
      await Promise.all(
        [ailleurs, long, nomme, sansNom].map((qui, rang) => profil(espaces[rang], qui.id)),
      ),
    ).toEqual([
      { name: "Alex Martin", first_name: "Alex", last_name: "Martin" },
      { name: "N".repeat(80), first_name: "P".repeat(80) },
      { name: "Choisi" },
      {},
    ])

    // Un nom changé ensuite dans le nouvel espace ne change pas l'autre.
    await asCaller(ailleurs.id, ailleurs.email).tx((sql) => sql`select platform.update_my_profile(${espaces[0]}, ${sql.json({ name: "Alex M." })})`)
    expect([(await profil(espaces[0], ailleurs.id)) as Record<string, Json>, (await profil(principal.id, ailleurs.id)) as Record<string, Json>].map((un) => un.name)).toEqual(["Alex M.", "Alex Martin"])
  })

  it("should leave the profile blank when the person joins someone else's space, and name her by her account", async (ctx) => {
    await skipPending(ctx)
    // Une organisation née plus tôt, encore vide : l'arrivée n'est pas sa création.
    const rejoint = seed.person()
    await ailleursNomme(rejoint, { name: "Alex Martin", first_name: "Alex", last_name: "Martin" })
    await seed.admin`insert into platform.members (org_id, user_id, role, email) values (${autre.id}, ${rejoint.id}, 'member', ${rejoint.email})`
    const compte = seed.person()
    await seed.admin`insert into platform.members (org_id, user_id, role, email, name) values (${autre.id}, ${compte.id}, 'member', ${compte.email}, ' Camille Durand ')`

    // Une organisation née dans la transaction, dont la personne n'est pas le premier membre (outillage).
    const premier = seed.person()
    await ailleursNomme(premier, { name: "Dana Roux" })
    const second = seed.person()
    await ailleursNomme(second, { name: "Eli Noir" })
    const suffix = hex(4)
    const outille = await seed.admin.begin(async (sql) => {
      const [org] = await sql<{ id: string }[]>`insert into platform.orgs (name, slug, prefix) values (${`test_${suffix}`}, ${`t${suffix}`}, ${`t${suffix}`}) returning id`
      await sql`insert into platform.members (org_id, user_id, role, email) values (${org.id}, ${premier.id}, 'admin', ${premier.email}), (${org.id}, ${second.id}, 'member', ${second.email})`
      return org.id
    })
    created.push(outille)

    expect([await profil(autre.id, rejoint.id), await profil(autre.id, compte.id), await profil(outille, premier.id), await profil(outille, second.id)]).toEqual([
      {},
      {},
      { name: "Dana Roux" },
      {},
    ])

    // Sans nom de profil, l'identité nomme la personne par le nom de son compte, sinon par le début de son email.
    const nommer = async (qui: SeededPerson) =>
      (await identityInOrg(asCaller(qui.id, qui.email), { ...autre, brand: {}, domains: null }, { userId: qui.id, email: qui.email })).user.name
    expect([await nommer(rejoint), await nommer(compte)]).toEqual([rejoint.email.split("@")[0], "Camille Durand"])
  })
})
