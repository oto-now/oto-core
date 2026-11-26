// L'adresse de connexion d'un connecteur (`connect-link.ts`, `connexion-par-l-agent.md`) : bâtie sur l'adresse publique
// de l'organisation, son connecteur et son espace, sans secret ; une adresse publique absente ou douteuse est une erreur
// de configuration dite, jamais un repli sur une adresse relative.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { connectionUrl, parseSpace, spaceParam } from "../../packages/plateforme/server/connectors/connect-link"
import { PlatformError } from "../../packages/plateforme/server/errors"

const NOT_KNOWN = "The public address of this organisation is not known, so the connection link cannot be built. Ask whoever runs this application to set its public address."

describe("connection link of a connector", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("should build the link from the origin, the connector and the space, with the access and activation only when asked", () => {
    expect(connectionUrl("https://acme.example.test", "crm", { kind: "user" })).toBe("https://acme.example.test/connect/crm?space=me")
    expect(connectionUrl("https://acme.example.test", "crm", { kind: "team", slug: "ventes" }, { access: "full", activate: true })).toBe(
      "https://acme.example.test/connect/crm?space=team%3Aventes&access=full&activate=1",
    )
  })

  it("should read back every space it writes", () => {
    for (const space of [{ kind: "user" }, { kind: "org" }, { kind: "team", slug: "ventes" }] as const) expect(parseSpace(spaceParam(space))).toEqual(space)
  })

  it.each([[undefined], [null], [""], ["acme.example.test"], ["https://acme.example.test/app"], ["javascript:alert(1)"]])(
    "should refuse to build a link without a usable public address (%s), as a configuration error",
    (origin) => {
      let error: unknown
      try {
        connectionUrl(origin, "crm", { kind: "org" })
      } catch (thrown) {
        error = thrown
      }
      expect(error).toBeInstanceOf(PlatformError)
      expect([(error as PlatformError).code, (error as PlatformError).message]).toEqual(["internal", NOT_KNOWN])
    },
  )
})
