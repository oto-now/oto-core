// @vitest-environment node
// Ce que les réglages lisent et écrivent dans `orgs` (E01-S10, lot e2b), sur une base réelle : la marque
// (E09-S01 ; E01-S07 AC15), les drapeaux (E08-S04) et le réglage du routage (E08-S03, H40). O et P de la
// graine de référence (`seedReferenceOrg`) ; Léa est membre des deux, et l'isolation seule (E01-S08) lui laisse
// lire et écrire l'une et l'autre : chaque service lit et écrit l'organisation de l'identité, filtrée dans sa
// requête (`security-patterns.md § Droits dans le service`). Léa y paraît en administratrice de O quand le cas
// l'exige : le droit se décide sur l'identité (`isOrgAdmin`), avant toute requête ; la base l'exige aussi depuis
// `20261019150000` (`orgs_update_admin`), Léa est donc administratrice de O en base, membre simple de P. Portable
// (AC-x3, fiche D76) : `asCaller` et la connexion d'administration ; le job `bare-postgres` joue ce fichier.
// Les cas de la marque viennent de `tests/unit/server-brand.test.ts`, où ils tournaient sur une base simulée.
import { randomUUID } from "crypto"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import type { Identity } from "../../packages/plateforme/server"
import { brandSettings, updateBrand } from "../../packages/plateforme/server/brand"
import { listFlags, setFlag } from "../../packages/plateforme/server/flags"
import { loadRoutingSettings, loadStoredRouting } from "../../packages/plateforme/server/routing"
import { ORG, OTHER_ORG } from "../helpers/reference-org"
import { seedReferenceOrg, type ReferenceOrgSql } from "../helpers/reference-org-sql"
import { asCaller, seedWithAdmin, spyDb, SQL_SKIP_REASON, sqlConfigured, type SeededData } from "../helpers/sql"

const SETUP_TIMEOUT = 120_000
const REGISTRY = [{ name: "essai_drapeau", description: "Drapeau de test." }]
const INPUT = { theme: "foret", logo_url: "https://example.com/logo.png", display_name: "Démo Forêt" }
/** La marque, les drapeaux et le réglage de P, que rien ne doit lire ni écrire sous une identité de O. */
const P_ROW = { brand: { theme: "cobalt" }, flags: { essai_drapeau: true }, settings: { routing: { threshold: 0.2 } } }

let seed: SeededData
let ref: ReferenceOrgSql

const lea = () => asCaller(ref.people.lea.id, ref.people.lea.email)

/** L'identité de Léa dans O ou dans P, en administratrice quand `admin` le demande. */
function leaIn(org: "O" | "P", admin = false): Identity {
  const member = admin ? { member: { role: "admin" as const, profile: {} } } : {}
  const other = { org: { id: OTHER_ORG.id, slug: "other", name: "Other Test", prefix: "other", brand: {}, domains: null } }
  return ref.identityOf("lea", { ...member, ...(org === "P" ? other : {}) })
}

/** `brand`, `flags` et `settings` de O puis de P, relus par la connexion d'administration. */
async function stored(): Promise<Record<string, unknown>[]> {
  const rows = await seed.admin<{ id: string; brand: unknown; flags: unknown; settings: unknown }[]>`
    select id, brand, flags, settings from platform.orgs where id in ${seed.admin([ref.org.id, ref.other.id])}`
  return [ref.org.id, ref.other.id].map((id) => {
    const { brand, flags, settings } = rows.find((row) => row.id === id) ?? {}
    return { brand, flags, settings }
  })
}

describe.skipIf(!sqlConfigured)(sqlConfigured ? "the settings of orgs on a real database" : `the settings of orgs on a real database (${SQL_SKIP_REASON})`, { timeout: SETUP_TIMEOUT }, () => {
  // O sans réglage, P réglée : chaque cas en part.
  const reset = () => ref.write({ orgs: [{ id: ORG.id, brand: {}, flags: {}, settings: {} }, { id: OTHER_ORG.id, ...P_ROW }] })

  beforeAll(async () => {
    seed = seedWithAdmin()
    ref = await seedReferenceOrg(seed)
    // La policy `orgs_update_admin` exige l'administrateur (20261019150000) : l'identité seule ne suffit plus à écrire.
    await seed.admin`update platform.members set role = 'admin' where org_id = ${ref.org.id} and user_id = ${ref.people.lea.id}`
    await reset()
  }, SETUP_TIMEOUT)

  afterAll(async () => {
    await seed?.cleanup()
  }, SETUP_TIMEOUT)

  afterEach(async () => {
    vi.restoreAllMocks()
    await reset()
  })

  describe("updateBrand", () => {
    it("should write the whole brand of the identity's organisation, emptied fields as null, and never touch another organisation of the caller", async () => {
      expect(await updateBrand(lea(), leaIn("O", true), { ...INPUT, extra: "ignored" })).toEqual({ data: INPUT, target: "brand" })
      expect(await stored()).toEqual([{ brand: INPUT, flags: {}, settings: {} }, P_ROW])

      await updateBrand(lea(), leaIn("O", true), { theme: "cobalt", logo_url: "", display_name: " " })
      expect((await stored())[0].brand).toEqual({ theme: "cobalt", logo_url: null, display_name: null })
    })

    // E05-S11 (AC-36) : la langue de l'organisation, que le formulaire de marque et `admin_org update` n'envoient pas.
    it("should write the language when given, keep the stored one when it is absent, and remove it on null", async () => {
      expect(await updateBrand(lea(), leaIn("O", true), { ...INPUT, language: "en" })).toEqual({ data: { ...INPUT, language: "en" }, target: "brand" })
      expect((await stored())[0].brand).toEqual({ ...INPUT, language: "en" })

      await updateBrand(lea(), leaIn("O", true), { ...INPUT, theme: "cobalt" })
      expect((await stored())[0].brand).toEqual({ ...INPUT, theme: "cobalt", language: "en" })

      await updateBrand(lea(), leaIn("O", true), { ...INPUT, language: null })
      expect((await stored())[0].brand).toEqual(INPUT)
    })

    // E01-S07 AC15 : le refus est décidé avant l'écriture, que la base accepterait de Léa (isolation seule) ;
    // « aucune ligne écrite » après la décision est un conflit, jamais un refus.
    it("should refuse a member without any request, and answer conflict when the write of an administrator finds no row", async () => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {})
      const member = spyDb(lea())
      await expect(updateBrand(member.db, leaIn("O"), INPUT)).rejects.toMatchObject({
        code: "forbidden",
        message: `Only an administrator of ${ORG.name} can change its brand.`,
      })
      expect(member.sent).toEqual([])

      // L'organisation de l'identité disparue entre sa résolution et l'écriture.
      const gone = { ...leaIn("O", true), org: { ...leaIn("O").org, id: randomUUID() } }
      await expect(updateBrand(lea(), gone, INPUT)).rejects.toMatchObject({
        code: "conflict",
        message: `The brand of ${ORG.name} changed meanwhile. Reload it and retry.`,
      })
      expect(log).toHaveBeenCalledWith(`[platform] updateBrand: no row written for organisation ${gone.org.id}`)
      expect((await stored())[0].brand).toEqual({})
    })

    it("should hide a database error behind internal, logging it", async () => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {})
      const { db } = spyDb(lea(), { fail: (query) => (query.op === "update" ? { code: "57014" } : null) })

      await expect(updateBrand(db, leaIn("O", true), INPUT)).rejects.toMatchObject({ code: "internal", message: "The brand could not be saved." })
      expect(log).toHaveBeenCalled()
    })
  })

  describe("brandSettings", () => {
    // E01-S07 AC15 : `canEdit` vaut `isOrgAdmin`, décidé sans demander à la base qui administre.
    it("should read the brand of the identity's organisation, and give canEdit to an administrator only, without any function call", async () => {
      await ref.write({ orgs: [{ id: ORG.id, brand: { theme: "lagune" } }] })
      const { db, sent } = spyDb(lea())

      expect(await brandSettings(db, leaIn("O", true))).toEqual({ brand: { theme: "lagune", logoUrl: null, displayName: ORG.name }, orgName: ORG.name, canEdit: true })
      expect((await brandSettings(db, leaIn("O"))).canEdit).toBe(false)
      expect((await brandSettings(db, leaIn("P"))).brand.theme).toBe("cobalt")
      expect(sent.filter((query) => query.op === "call")).toEqual([])
    })

    it("should turn a database error into a PlatformError without its message", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {})
      const { db } = spyDb(lea(), { fail: () => ({ code: "XX000" }) })

      const error = await brandSettings(db, leaIn("O")).then(
        () => null,
        (reason: unknown) => reason,
      )
      expect(error).toMatchObject({ name: "PlatformError", code: "internal", message: "Internal error." })
    })
  })

  describe("flags", () => {
    it("should list and set the flags of the identity's organisation only", async () => {
      expect(await listFlags(lea(), leaIn("O"), REGISTRY)).toEqual([{ ...REGISTRY[0], enabled: false }])
      expect(await listFlags(lea(), leaIn("P"), REGISTRY)).toEqual([{ ...REGISTRY[0], enabled: true }])

      await ref.write({ orgs: [{ id: OTHER_ORG.id, flags: { essai_drapeau: true, garde: 1 } }] })
      // O et P écrites dans une même transaction : même `updated_at`, la garde de version ne les distingue plus,
      // seul le filtre de l'organisation écarte P.
      await seed.admin`update platform.orgs set flags = flags where id in ${seed.admin([ref.org.id, ref.other.id])}`
      await setFlag(lea(), leaIn("O", true), { name: "essai_drapeau", enabled: true }, REGISTRY)
      expect((await stored()).map((row) => row.flags)).toEqual([{ essai_drapeau: true }, { essai_drapeau: true, garde: 1 }])
    })
  })

  describe("routing settings", () => {
    it("should read the setting of the organisation asked, and say an unknown one", async () => {
      await ref.write({ orgs: [{ id: ORG.id, settings: { routing: { threshold: 0.8 } } }] })

      expect(await loadRoutingSettings(lea(), ref.org.id)).toEqual({ threshold: 0.8, gap: 0.1 })
      expect(await loadRoutingSettings(lea(), ref.other.id)).toEqual({ threshold: 0.2, gap: 0.1 })
      expect(await loadStoredRouting(lea(), ref.org.id)).toEqual({ threshold: 0.8, gap: null })
      expect(await loadStoredRouting(lea(), ref.other.id)).toEqual({ threshold: 0.2, gap: null })
      await expect(loadStoredRouting(lea(), randomUUID())).rejects.toMatchObject({ code: "not_found" })
    })
  })
})
