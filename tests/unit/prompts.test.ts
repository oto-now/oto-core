// @vitest-environment node
// Noms des prompts des procédures (E03-S05, AC9, N3, N7) : calcul pur, sans base. Procédures servies
// selon le niveau décidé par le service (E01-S07 AC24), sur la base réelle (E01-S10, lot t1-e2b2) : O semée
// avec ses procédures (`seedReferenceOrg`, `tests/helpers/reference-org-sql.ts`), la liste lue sous le
// client de Léa (`ref.db`).
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { getPrompt, listPrompts, PROMPT_NAME_MAX, promptNames } from "../../packages/plateforme/server/prompts"
import { seedReferenceOrg, type ReferenceOrgSql } from "../helpers/reference-org-sql"
import { sqlConfigured, seedWithAdmin, type SeededData, portable } from "../helpers/sql"

const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 180_000

describe("promptNames (AC9)", () => {
  it("should name each prompt by the last segment of its path, two colliding ones by their whole path, / turned into _", () => {
    expect(promptNames(["support/relance", "ventes/relance", "ventes/relance_devis"])).toEqual([
      "support_relance",
      "ventes_relance",
      "relance_devis",
    ])
  })

  it("should cut every name at 64 characters", () => {
    const long = `ventes/${"r".repeat(100)}`
    const [name] = promptNames([long])
    expect(name).toBe("r".repeat(PROMPT_NAME_MAX))
    const deep = [`a/${"b".repeat(80)}/relance`, "c/relance"]
    expect(promptNames(deep)).toEqual([`a_${"b".repeat(80)}_relance`.slice(0, 64), "c_relance"])
    for (const each of promptNames(deep)) expect(each.length).toBeLessThanOrEqual(64)
  })

  it("should number a name still taken, in the order of the paths (N7)", () => {
    // `ventes/relance` croise `support/relance`, et son chemin entier est le dernier segment d'un autre.
    expect(promptNames(["support/relance", "ventes/relance", "x/ventes_relance"])).toEqual([
      "support_relance",
      "ventes_relance",
      "ventes_relance_2",
    ])
    // Deux chemins longs coupés au même endroit.
    const shared = `a/${"b".repeat(70)}`
    const names = promptNames([`${shared}/x/relance`, `${shared}/y/relance`])
    expect(names[0]).toBe(`${shared}/x/relance`.replaceAll("/", "_").slice(0, 64))
    expect(names[1]).toBe(`${names[0].slice(0, 62)}_2`)
    expect(new Set(names).size).toBe(2)
  })

  it("should give no name to an empty list", () => {
    expect(promptNames([])).toEqual([])
  })
})

describe.skipIf(!sqlConfigured)(portable("listPrompts and getPrompt decided by the service (E01-S07 AC24)"), { timeout: NETWORK_TIMEOUT }, () => {
  // Les dix de Support, que Léa ne lit pas, viennent d'abord par chemin : bornée avant le filtre,
  // la liste ne lui en laisserait que dix.
  const hidden = Array.from({ length: 10 }, (_, n) => `support/cachee_${String(n).padStart(2, "0")}`)
  const readable = Array.from({ length: 21 }, (_, n) => `ventes/lisible_${String(n).padStart(2, "0")}`)
  let seed: SeededData
  let ref: ReferenceOrgSql

  beforeAll(async () => {
    seed = seedWithAdmin()
    // Publiées en révision 1, propriétaire hérité : l'équipe Support ou Ventes de leur dossier.
    const procedure = (path: string) => ({ path, kind: "procedure" as const, title: `Titre ${path}`, summary: `Résumé ${path}` })
    ref = await seedReferenceOrg(seed, { nodes: [...hidden, ...readable].map(procedure) })
  }, SETUP_TIMEOUT)

  afterAll(async () => {
    await seed?.cleanup()
  }, SETUP_TIMEOUT)

  // 21 procédures lisibles (M11b, repris de `feedback-prompts.test.ts`, E03-S05 AC8 et AC10) : la borne
  // de 20 elle-même, un prompt servi, et un nom au-delà des 20 inconnu comme un invisible.
  it("should serve the first 20 of the 21 procedures Léa reads out of 31, by path, the bound of 20 applied after the filter", async () => {
    const db = await ref.db("lea")
    const lea = ref.identityOf("lea")

    const prompts = await listPrompts(db, lea)

    expect(prompts.map((prompt) => prompt.name)).toEqual(readable.slice(0, 20).map((path) => path.slice("ventes/".length)))
    expect(prompts[0]).toEqual({ name: "lisible_00", title: "Titre ventes/lisible_00", description: "Résumé ventes/lisible_00" })
    expect(await getPrompt(db, lea, "lisible_00")).toEqual({ description: "Résumé ventes/lisible_00", text: "Titre ventes/lisible_00" })
    await expect(getPrompt(db, lea, "lisible_20")).rejects.toMatchObject({ code: "not_found", message: "Unknown prompt lisible_20." })
    await expect(getPrompt(db, lea, "cachee_00")).rejects.toMatchObject({ code: "not_found", message: "Unknown prompt cachee_00." })
  })
})
