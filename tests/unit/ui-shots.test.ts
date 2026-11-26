import { describe, expect, it } from "vitest"
import { landedOnLogin } from "../../scripts/lib/ui-shots-login.mjs"

// `pnpm ui:shots` ne prend jamais la page de connexion pour l'écran demandé : une route protégée renvoyée sur
// `/login` est refusée, la route `/login` elle-même se capture.
describe("ui-shots landedOnLogin", () => {
  it("should tell a protected route sent to /login from the login page itself and from any other landing", () => {
    expect([
      landedOnLogin("/admin/connectors", "http://localhost:3000/login?next=%2Fadmin%2Fconnectors"),
      landedOnLogin("/n/ventes/devis", "http://t1a2b.localhost:3000/login"),
      landedOnLogin("/login", "http://localhost:3000/login"),
      landedOnLogin("/admin/connectors", "http://localhost:3000/admin/connectors"),
      landedOnLogin("/", "http://localhost:3000/login-aide"),
    ]).toEqual([true, true, false, false, false])
  })
})
