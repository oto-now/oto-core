// @vitest-environment node
// Le middleware devant la page publique d'un lien de partage (E05-S10, AC-d2, AC-d6 ; ADR-013 § 4, § 5) : `/p/*`
// passe sans session, sans lire ni rafraîchir de session, et n'est jamais indexé ; rien d'autre ne s'ouvre.
// Le client Supabase est simulé, comme dans `middleware.test.ts`.
import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createServerClient } from "@supabase/ssr"
import { middleware } from "@/middleware"

const session = vi.hoisted((): { user: { id: string } | null } => ({ user: null }))

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({ auth: { getUser: async () => ({ data: { user: session.user }, error: null }) } })),
}))

const ORIGIN = "http://localhost:3000"
const JETON = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde"

const requete = (path: string, method = "GET") => new NextRequest(`${ORIGIN}${path}`, { method })

beforeEach(() => {
  session.user = null
})

afterEach(() => {
  vi.clearAllMocks()
})

describe("middleware in front of a public link (AC-d2, AC-d6)", () => {
  it.each([`/p/${JETON}/ventes/tarifs`, "/p/inconnu"])("should let %s through without a session, never indexed, reading no session", async (chemin) => {
    const response = await middleware(requete(chemin))

    expect(response.headers.get("location")).toBeNull()
    expect(response.headers.get("x-middleware-next")).toBe("1")
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow")
    expect(createServerClient).not.toHaveBeenCalled()
  })

  // Seul le préfixe `/p/` s'ouvre : un chemin voisin reste derrière la connexion.
  it.each(["/p", "/pages", "/n/p/x"])("should still send %s to the login without a session", async (chemin) => {
    const response = await middleware(requete(chemin))

    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe(`${ORIGIN}/login?redirect=${encodeURIComponent(chemin)}`)
    expect(response.headers.get("X-Robots-Tag")).toBeNull()
  })

  // Un voisin encodé ne passe pas non plus : `%2e%2e` se résout avant le middleware (`/admin`), `%70` et `%2F`
  // restent encodés et ne commencent pas par `/p/`.
  it.each(["/p/%2e%2e/admin", "/%70/x", "/p%2Fx"])("should still send the encoded neighbour %s to the login without a session", async (chemin) => {
    const response = await middleware(requete(chemin))

    expect(response.status).toBe(307)
    expect(response.headers.get("location")?.startsWith(`${ORIGIN}/login?redirect=`)).toBe(true)
    expect(response.headers.get("X-Robots-Tag")).toBeNull()
  })
})
