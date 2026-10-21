// @vitest-environment node
// Drapeaux (E08-S04) sur une vraie base : les services reçoivent le client du paquet sous la session de la
// personne, comme dans l'hôte. Organisation et personne jetables (H120) : A administratrice. Les drapeaux
// de départ de chaque test sont posés par la connexion d'administration. Les refus avant toute lecture, le
// drapeau posé par l'équipe plateforme avec un accès en cours (E01-S07 AC19 ; son cas sur la vraie base
// est retiré par M11b) et l'état de la cellule sont prouvés sans base (`tests/unit/flags.test.ts`,
// `tests/unit/cell.test.ts`). L'écriture d'un drapeau (vrai, puis faux, les autres clés gardées) et la course
// perdue, journal compris, ne sont prouvées qu'ici. Suite portable depuis E01-S10 f2 (la personne par `fx.as`, sans Supabase
// Auth ni PostgREST) : le job `bare-postgres` la joue.
import { afterAll, beforeAll, describe, expect, it, onTestFinished, vi } from "vitest"
import type { FlagView } from "@otomata_tech/oto_platform/schemas"
import { listFlags, resolveIdentity, setFlag, type Identity, type PlatformDb } from "@otomata_tech/oto_platform/server"
import type { Json } from "../../packages/plateforme/server/database"
import { hex, type TestOrg } from "../helpers/plateforme"
import { createSqlFixtures, spyDb, SQL_SKIP_REASON, sqlConfigured, type SqlFixtures } from "../helpers/sql"

const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 180_000
const SUITE = "flags and cell status"

const REGISTRY = [
  { name: "essai_drapeau", description: "Drapeau de test." },
  { name: "second_drapeau", description: "Second drapeau de test." },
]
const CONFLICT = "The flags of Acme Test changed meanwhile. Reload them and retry."

type Session = { db: PlatformDb; identity: Identity }

describe.skipIf(!sqlConfigured)(sqlConfigured ? SUITE : `${SUITE} (${SQL_SKIP_REASON})`, { timeout: NETWORK_TIMEOUT }, () => {
  let fx: SqlFixtures
  let org: TestOrg
  let a: Session

  /** `orgs.flags` lu par la connexion d'administration : ce qui est réellement écrit. */
  async function stored(): Promise<{ flags: Json }> {
    const [row] = await fx.admin<{ flags: Json }[]>`select flags from platform.orgs where id = ${org.id}`
    return row
  }

  /** Les drapeaux de départ d'un test, posés par la connexion d'administration (outillage). */
  async function store(flags: Json): Promise<void> {
    await fx.admin`update platform.orgs set flags = ${fx.admin.json(flags)} where id = ${org.id}`
  }

  beforeAll(async () => {
    fx = createSqlFixtures()
    const host = `t${hex(4)}.example.invalid`
    org = await fx.createOrg({ name: "Acme Test", hosts: [host] })
    const user = await fx.createUser({ fullName: "Ada Martin" })
    await fx.addMember(org.id, user.id, { role: "admin", profile: { name: "Ada Martin" } })
    const db = fx.as(user)
    a = { db, identity: await resolveIdentity(db, host, { userId: user.id, email: user.email }) }
  }, SETUP_TIMEOUT)

  afterAll(async () => {
    await fx?.cleanup()
  }, SETUP_TIMEOUT)

  describe("setFlag", () => {
    it("should set a declared flag, keep the other keys and give the journal target (AC2)", async () => {
      await store({ cle_inconnue: "garde", compteur: 1 })

      const set = await setFlag(a.db, a.identity, { name: "essai_drapeau", enabled: true }, REGISTRY)

      expect(set).toEqual({
        data: { name: "essai_drapeau", description: "Drapeau de test.", enabled: true },
        target: "flags/essai_drapeau",
      })
      expect((await stored()).flags).toEqual({ cle_inconnue: "garde", compteur: 1, essai_drapeau: true })
      const unset = await setFlag(a.db, a.identity, { name: "essai_drapeau", enabled: false }, REGISTRY)
      expect(unset.data).toEqual({ name: "essai_drapeau", description: "Drapeau de test.", enabled: false })
      expect((await stored()).flags).toEqual({ cle_inconnue: "garde", compteur: 1, essai_drapeau: false })
    })

    it("should answer conflict to the change that lost the race, log it and keep the winner's value (AC5 ; E01-S07 AC27, HN-E01S07-6)", async () => {
      await store({})
      const log = vi.spyOn(console, "error").mockImplementation(() => {})
      onTestFinished(() => log.mockRestore())
      // Le second changement passe entre la lecture et l'écriture du premier : la course perdue, sans dépendre
      // du hasard. `setFlag` écrit par la face SQL (E01-S10, partie e2) : l'espion retient son écriture le temps
      // que le gagnant écrive, par la connexion d'administration ; un `setFlag` de la même session y reprendrait
      // la transaction du premier (HN-E01S10-7), ce ne serait plus une course.
      const { db: racing } = spyDb(a.db, {
        before: async (query) => {
          if (query.target === "orgs" && query.op === "update") await store({ second_drapeau: true })
        },
      })

      await expect(setFlag(racing, a.identity, { name: "essai_drapeau", enabled: true }, REGISTRY)).rejects.toMatchObject({
        code: "conflict",
        message: CONFLICT,
      })
      expect(log).toHaveBeenCalledWith(`[platform] setFlag: no row written for organisation ${org.id}`)
      expect((await stored()).flags).toEqual({ second_drapeau: true })
    })
  })

  describe("listFlags (AC6)", () => {
    it("should list the declared flags in registry order, enabled only for a stored true", async () => {
      await store({ second_drapeau: true, essai_drapeau: "true", cle_inconnue: true })
      const expected: FlagView[] = [
        { name: "essai_drapeau", description: "Drapeau de test.", enabled: false },
        { name: "second_drapeau", description: "Second drapeau de test.", enabled: true },
      ]

      expect(await listFlags(a.db, a.identity, REGISTRY)).toEqual(expected)
      expect((await stored()).flags).toEqual({ second_drapeau: true, essai_drapeau: "true", cle_inconnue: true })
    })
  })
})
