// @vitest-environment node
// Le choix de l'accès d'un connecteur à plusieurs accès (`connexion-par-l-agent.md` § Page), sans base : il ne se sert
// qu'après les contrôles du plan de chaque accès. Un connecteur que l'organisation ne peut pas activer est refusé comme
// sans choix (`requireActivable`, remplacé ici pour le rendre non activable), avant toute lecture de la base, et sa
// liste d'accès n'est jamais rendue. Le refus d'un espace et l'espace gardé dans les liens se testent sur une vraie
// base (`connecteur-a-plusieurs-acces.test.ts`).
import { describe, expect, it, vi } from "vitest"
import { accessChoices } from "../../packages/plateforme/server/connectors/connect-link"
import { connectionStep } from "../../packages/plateforme/server/connectors/connect-page"
import { registerConnectors } from "../../packages/plateforme/server/connectors/declaration"
import { PlatformError } from "../../packages/plateforme/server/errors"
import { keyOrSignInConnector, TEST_APPLICATION } from "../factories/described-connector"

vi.mock("../../packages/plateforme/server/connectors/activations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../packages/plateforme/server/connectors/activations")>()
  const { PlatformError: Refusal } = await import("../../packages/plateforme/server/errors")
  return {
    ...actual,
    requireActivable: vi.fn((connector: string) => {
      throw new Refusal("not_found", `Unknown connector ${connector}. Connectors you can activate: none.`)
    }),
  }
})

describe("connection page of a connector with several accesses: the choice after the checks", () => {
  it("should refuse a connector that cannot be activated before listing its accesses, the database never read", async () => {
    registerConnectors([keyOrSignInConnector()], { oauthApplications: { crm: TEST_APPLICATION } })
    expect(accessChoices("crm").length).toBe(2)
    // Une base qui refuse toute lecture : le refus vient du contrôle du connecteur, avant elle.
    const db = new Proxy({}, { get: () => () => Promise.reject(new Error("the database was read")) }) as never
    for (const space of [undefined, "org", "me"]) {
      const outcome = await connectionStep(db, {} as never, { connector: "crm", ...(space ? { space } : {}) }, { origin: "https://acme.example.test" }).then(
        (step) => step,
        (error: unknown) => error,
      )
      expect(outcome).toBeInstanceOf(PlatformError)
      expect((outcome as PlatformError).code).toBe("not_found")
    }
  })
})
