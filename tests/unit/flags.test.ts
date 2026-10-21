// @vitest-environment node
// Drapeaux (E08-S04) sans base : lecture sûre (AC1), écriture pure (`withFlag`), schémas partagés,
// registre (AC7). Sur la base réelle (E01-S10, lot t1-e2b2), O semée (`seedReferenceOrg`,
// `tests/helpers/reference-org-sql.ts`) et `setFlag` sous le client de la personne (`ref.db`, mode de
// transition) : ses refus rendus avant toute lecture d'`orgs` (AC3, AC4), chaque requête vue par `watchDb`
// (`tests/helpers/spy-t1-e2b2.ts`) et sa décision (E01-S07 AC19). L'écriture d'un administrateur et la course
// entre deux changements (E01-S07 AC27) : `tests/integration/flags-cell.test.ts`.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { flagNameSchema, flagToggleSchema, flagViewSchema } from "@otomata_tech/oto_platform/schemas"
import { FLAGS, isEnabled, setFlag } from "@otomata_tech/oto_platform/server"
import { withFlag } from "../../packages/plateforme/server/flags"
import { ORG } from "../helpers/reference-org"
import { seedReferenceOrg, type ReferenceOrgSql } from "../helpers/reference-org-sql"
import { isWrite, touches, watchDb, type DbCall } from "../helpers/spy-t1-e2b2"
import { sqlConfigured, seedWithAdmin, type SeededData, portable } from "../helpers/sql"

const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 180_000

type Declaration = { name: string; description: string }

const REGISTRY: Declaration[] = [
  { name: "essai_drapeau", description: "Drapeau de test." },
  { name: "second_drapeau", description: "Second drapeau de test." },
]

/** Les requêtes qui lisent ou écrivent `orgs`, et toute écriture : ce qu'un refus décidé avant elles n'envoie jamais. */
const orgsOrWrites = (calls: DbCall[]) => calls.filter((call) => touches(call, "orgs") || isWrite(call))

/** Ce qui ne va pas dans un registre : nom hors de `flagNameSchema`, description hors de 1 à 200 caractères, doublon. */
function registryProblems(registry: readonly Declaration[]): string[] {
  const seen = new Set<string>()
  return registry.flatMap(({ name, description }) => {
    const problems: string[] = []
    if (!flagNameSchema.safeParse(name).success) problems.push(`${name}: invalid name`)
    if (!flagViewSchema.shape.description.safeParse(description).success) problems.push(`${name}: invalid description`)
    if (seen.has(name)) problems.push(`${name}: declared twice`)
    seen.add(name)
    return problems
  })
}

describe("isEnabled (AC1)", () => {
  it("should be true for a stored true", () => {
    expect(isEnabled({ flags: { nouvelle_grille: true } }, "nouvelle_grille")).toBe(true)
  })

  // Une valeur qui n'est pas `true`, des drapeaux absents, des drapeaux qui ne sont pas un objet : les
  // autres permutations (faux, clé absente, nombre, undefined, chaîne) sont retirées (M11b).
  it("should be false, without throwing, for the string true, null flags and an array", () => {
    const cas: [string, unknown][] = [
      ["the string true", { nouvelle_grille: "true" }],
      ["null flags", null],
      ["an array", ["nouvelle_grille"]],
    ]
    expect(Object.fromEntries(cas.map(([label, flags]) => [label, isEnabled({ flags }, "nouvelle_grille")]))).toEqual(Object.fromEntries(cas.map(([label]) => [label, false])))
  })

  it("should not read a name inherited by every object", () => {
    expect(isEnabled({ flags: {} }, "constructor")).toBe(false)
  })
})

// Le drapeau ajouté, puis écrit à faux sa clé gardée : `tests/integration/flags-cell.test.ts` (AC2), sur la base.
describe("withFlag", () => {
  it("should keep the other keys as they are, without changing its input", () => {
    const flags = { cle_inconnue: "garde", compteur: 1, objet: { liste: [1, 2] } }
    expect(withFlag(flags, "essai_drapeau", true)).toEqual({ ...flags, essai_drapeau: true })
    expect(flags).toEqual({ cle_inconnue: "garde", compteur: 1, objet: { liste: [1, 2] } })
  })

  // Un tableau, objet pour `typeof` : null, une chaîne et un nombre sont retirés (M11b).
  it("should start again from an empty object for malformed flags, an array here", () => {
    expect(withFlag(["essai_drapeau"], "essai_drapeau", true)).toEqual({ essai_drapeau: true })
  })
})

// La borne haute de chaque côté, une majuscule et un tiret : les autres noms sont retirés (M11b).
describe("flagNameSchema", () => {
  it("should accept a name of 40 characters", () => {
    expect(flagNameSchema.safeParse("a".repeat(40)).success).toBe(true)
  })

  it("should reject a name of 41 characters, a capital and a dash", () => {
    const noms = ["a".repeat(41), "Nouvelle_grille", "nouvelle-grille"]
    expect(Object.fromEntries(noms.map((name) => [name, flagNameSchema.safeParse(name).success]))).toEqual(Object.fromEntries(noms.map((name) => [name, false])))
  })
})

describe("flagToggleSchema", () => {
  it("should accept a name and a boolean", () => {
    expect(flagToggleSchema.parse({ name: "essai_drapeau", enabled: true })).toEqual({ name: "essai_drapeau", enabled: true })
    expect(flagToggleSchema.parse({ name: "essai_drapeau", enabled: false })).toEqual({ name: "essai_drapeau", enabled: false })
  })

  // Un `enabled` qui n'est pas un booléen et une clé de trop : `null`, l'absence et le nom invalide
  // (prouvé par `flagNameSchema`) sont retirés (M11b).
  it("should reject enabled as a string and an extra key", () => {
    const cas: [string, unknown][] = [
      ["enabled as a string", { name: "essai_drapeau", enabled: "true" }],
      ["an extra key", { name: "essai_drapeau", enabled: true, org: "acme" }],
    ]
    expect(Object.fromEntries(cas.map(([label, input]) => [label, flagToggleSchema.safeParse(input).success]))).toEqual(Object.fromEntries(cas.map(([label]) => [label, false])))
  })
})

describe("flagViewSchema", () => {
  it("should hold a description of 1 to 200 characters", () => {
    const view = (description: string) => flagViewSchema.safeParse({ name: "essai_drapeau", description, enabled: false }).success
    expect([view(""), view("D"), view("D".repeat(200)), view("D".repeat(201))]).toEqual([false, true, true, false])
  })
})

describe("flag registry (AC7)", () => {
  it("should declare valid, unique flags", () => {
    expect(registryProblems(FLAGS)).toEqual([])
    expect(registryProblems(REGISTRY)).toEqual([])
  })

  // 1.4.13 : le premier drapeau arrive avec la fonctionnalité qui le lit, « Retours visibles » (`handlesFeedback`, NH1).
  it("should declare feedback_visible alone, the flag that handlesFeedback reads", () => {
    expect(FLAGS.map((flag) => flag.name)).toEqual(["feedback_visible"])
  })

  it("should catch an invalid name, an invalid description and a duplicate", () => {
    const bad = [
      { name: "Grille", description: "Nom en majuscule." },
      { name: "essai_drapeau", description: "" },
      { name: "essai_drapeau", description: "D".repeat(201) },
    ]
    expect(registryProblems(bad)).toEqual([
      "Grille: invalid name",
      "essai_drapeau: invalid description",
      "essai_drapeau: invalid description",
      "essai_drapeau: declared twice",
    ])
  })
})

describe.skipIf(!sqlConfigured)(portable("setFlag on the real database, O"), { timeout: NETWORK_TIMEOUT }, () => {
  let seed: SeededData
  let ref: ReferenceOrgSql

  beforeAll(async () => {
    seed = seedWithAdmin()
    ref = await seedReferenceOrg(seed)
  }, SETUP_TIMEOUT)

  afterAll(async () => {
    await seed?.cleanup()
  }, SETUP_TIMEOUT)

  // Chaque test part des drapeaux et de la marque de la graine : ceux qu'un autre a écrits ne comptent jamais.
  afterEach(async () => {
    vi.restoreAllMocks()
    await ref.write({ orgs: [{ id: ORG.id, flags: {}, brand: {} }] })
  })

  describe("setFlag refusals before any read (AC3, AC4)", () => {
    // Le schéma refusé par `setFlag` avant toute lecture : un cas suffit, les formes refusées sont
    // celles de `flagToggleSchema` ci-dessus (M11b).
    it("should refuse enabled as a string with invalid_arguments", async () => {
      const { db, calls } = watchDb(await ref.db("ada"))
      await expect(setFlag(db, ref.identityOf("ada"), { name: "essai_drapeau", enabled: "true" }, REGISTRY)).rejects.toMatchObject({
        code: "invalid_arguments",
      })
      expect(calls).toEqual([])
    })

    it("should refuse an undeclared flag and name the declared ones", async () => {
      const { db, calls } = watchDb(await ref.db("ada"))
      const ada = ref.identityOf("ada")
      await expect(setFlag(db, ada, { name: "nouvelle_grille", enabled: true }, REGISTRY.slice(0, 1))).rejects.toMatchObject({
        code: "invalid_arguments",
        message: "Unknown flag nouvelle_grille. Declared flags: essai_drapeau.",
      })
      await expect(setFlag(db, ada, { name: "nouvelle_grille", enabled: true }, REGISTRY)).rejects.toMatchObject({
        message: "Unknown flag nouvelle_grille. Declared flags: essai_drapeau, second_drapeau.",
      })
      expect(calls).toEqual([])
    })

    it("should refuse an unknown flag with the package registry, naming feedback_visible, before any read", async () => {
      const { db, calls } = watchDb(await ref.db("ada"))
      await expect(setFlag(db, ref.identityOf("ada"), { name: "nouvelle_grille", enabled: true })).rejects.toMatchObject({
        code: "invalid_arguments",
        message: "Unknown flag nouvelle_grille. Declared flags: feedback_visible.",
      })
      expect(calls).toEqual([])
    })

    it("should accept feedback_visible with the package registry, then set it back", async () => {
      const db = await ref.db("ada")
      const ada = ref.identityOf("ada")
      try {
        expect((await setFlag(db, ada, { name: "feedback_visible", enabled: true })).data).toMatchObject({ name: "feedback_visible", enabled: true })
      } finally {
        await setFlag(db, ada, { name: "feedback_visible", enabled: false })
      }
    })

    // Marc, membre simple de O : l'annuaire nomme les administrateurs, `orgs` n'est ni lue ni écrite.
    it("should refuse a member and name the administrators of the organisation", async () => {
      const { db, calls } = watchDb(await ref.db("marc"))
      await expect(setFlag(db, ref.identityOf("marc"), { name: "essai_drapeau", enabled: true }, REGISTRY)).rejects.toMatchObject({
        name: "PlatformError",
        code: "forbidden",
        message: "Changing the flags of Acme Test is reserved to the administrators of Acme Test (Ada Martin). Ask them.",
      })
      expect(orgsOrWrites(calls)).toEqual([])
    })
  })

  describe("setFlag decided by isOrgAdmin (E01-S07 AC19)", () => {
    // T : membre simple de O et de l'équipe plateforme, avec un accès en cours (fiche D17, remplace NH9).
    it("should let T set a declared flag, as an administrator", async () => {
      expect(await setFlag(await ref.db("t"), ref.identityOf("t"), { name: "essai_drapeau", enabled: true }, REGISTRY)).toEqual({
        data: { name: "essai_drapeau", description: "Drapeau de test.", enabled: true },
        target: "flags/essai_drapeau",
      })
      const [org] = await seed.admin<{ flags: unknown }[]>`select flags from platform.orgs where id = ${ref.org.id}`
      expect(org.flags).toEqual({ essai_drapeau: true })
    })
  })

  // L'écriture qui ne change aucune ligne après la décision (E01-S07 AC27, HN-E01S07-6), réponse `conflict` et journal :
  // `tests/integration/flags-cell.test.ts`, « should answer conflict to the change that lost the race… ».
})
