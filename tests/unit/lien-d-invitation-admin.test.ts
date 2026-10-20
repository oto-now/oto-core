// @vitest-environment node
// Le lien de l'invitation d'un administrateur nommé par l'équipe plateforme (`admin_org`, MCP admin) : une adresse de
// l'organisation, bâtie par `linkOrigin`. Le protocole de l'adresse appelée vient de `x-forwarded-proto`
// (`calledOrigin`, `requestOrigin`), qu'un proxy peut transmettre du client : il ne fait jamais descendre le lien en
// `http`, ni ne lui donne un port, hors du poste local (`identite-et-connexion.md` § Web : invitation et connexion).
import { describe, expect, it } from "vitest"
import { calledOrigin } from "../../packages/plateforme/mcp/admin/handler"
import { invitationLink } from "../../packages/plateforme/server/admin/first-admin"

const REFUSAL = "no address"

/** L'origine de la route du MCP admin appelée en `https` derrière un proxy, avec les en-têtes donnés. */
const called = (url: string, headers: Record<string, string> = {}) => calledOrigin(new Request(url, { headers }))

describe("invitationLink", () => {
  it("should not lower the link to http when x-forwarded-proto says http", () => {
    const origin = called("https://cell.example.test/api/mcp-admin", { "x-forwarded-proto": "http" })
    expect(origin).toBe("http://cell.example.test")
    expect(invitationLink(origin, ["acme.example.test"], REFUSAL)).toBe("https://acme.example.test")
  })

  it("should drop the port of the called address outside the local machine, and keep http and the port on it", () => {
    expect(invitationLink(called("http://cell.example.test:3000/api/mcp-admin"), ["acme.example.test"], REFUSAL)).toBe("https://acme.example.test")
    expect(invitationLink(called("http://localhost:3000/api/mcp-admin"), ["acme.localhost", "acme.example.test"], REFUSAL)).toBe("http://acme.localhost:3000")
  })

  it("should refuse an organisation without an address", () => {
    expect(() => invitationLink(called("https://cell.example.test/api/mcp-admin"), [], REFUSAL)).toThrow(REFUSAL)
  })
})
