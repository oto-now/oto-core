// @vitest-environment node
// L'appelant que les trois portes passent à la base (E01-S10 partie a) : `sub`, `email` et `name` du
// jeton vérifié, le nom lu comme `accept_invitations` le lit, et jamais une valeur de repli
// (HN-E01S09-3) : sans email, `null`, quel que soit le texte que la porte affiche. Depuis E01-S11
// a1-wire, avec l'émetteur qui a vérifié le jeton, que la base traduit. JWKS locale, jeton ES256 signé
// à l'exécution ; ni base ni identité : le client est simulé, la résolution refuse.
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from "jose"
import { beforeAll, describe, expect, it, vi } from "vitest"
import { handlePlateforme } from "../../packages/plateforme/api/handler"
import { openAdminRequest } from "../../packages/plateforme/mcp/admin/handler"
import { makeVerifyToken, verifiedCaller } from "../../packages/plateforme/mcp/auth"
import { resolveMcpRequest } from "../../packages/plateforme/mcp/handler"
import { requireStaff } from "../../packages/plateforme/server/admin/context"
import { createPlatformDb } from "../../packages/plateforme/server/db"
import { PlatformError } from "../../packages/plateforme/server/errors"
import { resolveIdentity } from "../../packages/plateforme/server/identity"

vi.mock("../../packages/plateforme/server/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../packages/plateforme/server/db")>()),
  createPlatformDb: vi.fn(() => ({})),
}))

vi.mock("../../packages/plateforme/server/identity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../packages/plateforme/server/identity")>()),
  resolveIdentity: vi.fn(),
}))

vi.mock("../../packages/plateforme/server/admin/context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../packages/plateforme/server/admin/context")>()),
  requireStaff: vi.fn(),
}))

const ISSUER = "https://project.example.test/auth/v1"
const HOST = "acme.test"
const USER_ID = "5f0c1d7e-0000-4000-8000-000000000001"

let signingKey: CryptoKey
let jwks: JWTVerifyGetKey

beforeAll(async () => {
  const signing = await generateKeyPair("ES256")
  signingKey = signing.privateKey
  jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(signing.publicKey)), kid: "k1", alg: "ES256", use: "sig" }] })
})

/** Jeton au format Supabase, sans email : le nom est dans `user_metadata`, où Supabase Auth le range. */
function token() {
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({ role: "authenticated", user_metadata: { full_name: "Claire Morel" } })
    .setProtectedHeader({ alg: "ES256", kid: "k1", typ: "JWT" })
    .setIssuer(ISSUER)
    .setSubject(USER_ID)
    .setIssuedAt(now - 60)
    .setExpirationTime(now + 3600)
    .sign(signingKey)
}

describe("verified caller at the three gates (E01-S10 part a)", () => {
  it("should give the database the sub, email and name of the token, never the fallback the gate displays", async () => {
    vi.mocked(resolveIdentity).mockRejectedValue(new PlatformError("unknown_org", `No organisation is served at ${HOST}.`))
    vi.mocked(requireStaff).mockRejectedValue(new PlatformError("forbidden", "Platform team only."))
    const verifyToken = makeVerifyToken({ jwks, issuer: ISSUER })
    const bearer = await token()
    const request = new Request(`https://${HOST}/api/platform/invitations`, { headers: { "x-forwarded-proto": "https" } })
    const claims = (await verifyToken(request, bearer))?.extra

    const mcp = await resolveMcpRequest({ accessToken: bearer, claims, host: HOST, origin: `https://${HOST}`, userAgent: null })
    await expect(openAdminRequest({ accessToken: bearer, claims, userAgent: null, origin: "https://cell.example.test" })).rejects.toMatchObject({ code: "forbidden" })
    const api = await handlePlateforme(request, { accessToken: bearer, host: HOST, verifyToken, defer: () => {} })

    expect([mcp.kind, api.status]).toEqual(["unknown_org", 404])
    // L'émetteur qui a vérifié le jeton et son sujet, que la base traduit en identifiant interne (E01-S11).
    const caller = { issuer: ISSUER, issuerKind: "supabase", subject: USER_ID, email: null, name: "Claire Morel" }
    const seen = { caller }
    expect(vi.mocked(createPlatformDb).mock.calls).toEqual([[seen], [seen], [seen]])
    // Le refus d'un non-membre, lui, nomme la personne par son sujet (E03-S01, N19) ; l'identifiant
    // interne se lit dans la session.
    expect(vi.mocked(resolveIdentity).mock.calls[0][2]).toEqual({ email: `user ${USER_ID}` })
  })

  // Un vérificateur que l'hôte injecte (M10) et qui ne dit pas son émetteur garde le contrat d'E01-S10.
  it("should take the sub as the internal id when the verifier does not name its issuer", () => {
    expect(verifiedCaller({ sub: USER_ID, email: "claire@acme.test" })).toEqual({ userId: USER_ID, email: "claire@acme.test", name: null })
    expect(verifiedCaller({ sub: USER_ID, iss: ISSUER, issuer_kind: "other" })).toEqual({ userId: USER_ID, email: null, name: null })
  })
})
