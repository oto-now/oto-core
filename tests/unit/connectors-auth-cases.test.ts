// @vitest-environment node
// Les cas communs de l'authentification (`connectors/_cases/auth.yaml`), partagés avec la lib Python du dépôt
// `connectors`, copiés (`tests/factories/auth-cases.ts`) en attendant `@otomata_tech/connectors/auth-cases` : chaque cas
// joué contre la signature du paquet (`prepareAuth`, puis `sign` : les en-têtes et la query exacts qu'elle pose), puis
// par le chemin réel d'appel d'une fonction décrite, sur un `fetch` simulé (l'en-tête et le paramètre envoyés au tiers).
// Un écart est un désalignement à corriger du côté qui s'écarte du format, jamais un cas à retirer.
import { afterEach, describe, expect, it, vi } from "vitest"
import { declaredConnector } from "../../packages/plateforme/server/catalog/connector-source"
import { prepareAuth, requiredFields, sign } from "../../packages/plateforme/server/connectors/auth"
import { registerConnectors } from "../../packages/plateforme/server/connectors/declaration"
import type { ConnectorDefinition } from "../../packages/plateforme/server/connectors/definition"
import type { Fetch } from "../../packages/plateforme/server/connectors/http"
import { authCases, type AuthCase } from "../factories/auth-cases"
import { describedConnector, memoryTokens } from "../factories/described-connector"

afterEach(() => {
  registerConnectors([])
  vi.unstubAllGlobals()
})

/** Le connecteur de test sous l'authentification et le credential du cas. */
const connectorOf = (c: AuthCase): ConnectorDefinition => ({ ...describedConnector(), auth: c.auth, credential: c.credential })

const credentialOf = (c: AuthCase) => ({ fields: c.values, settings: {}, tokens: memoryTokens() })

describe("common authentication cases", () => {
  it.each(authCases.map((c) => [c.name, c] as const))("%s: the signature is exactly the expected headers and query", async (_name, c) => {
    const definition = connectorOf(c)
    const auth = prepareAuth(definition)
    if (typeof auth === "string") throw new Error(auth)
    expect(requiredFields(auth).sort()).toEqual(Object.keys(c.values).sort())
    const signature = await sign({ auth, definition, credential: credentialOf(c), accountId: "account-1", fetcherFor: () => fetch })
    expect(signature).toEqual({ headers: c.headers, query: Object.entries(c.query) })
  })

  it.each(authCases.map((c) => [c.name, c] as const))("%s: the request sent carries the expected headers and query", async (_name, c) => {
    registerConnectors([connectorOf(c)])
    const send = vi.fn<Fetch>(async () => new Response(JSON.stringify({ scopes: ["a"] }), { status: 200, headers: { "content-type": "application/json" } }))
    vi.stubGlobal("fetch", send)
    const fn = declaredConnector("crm")?.functions.find((candidate) => candidate.name === "crm.get_company")
    if (!fn) throw new Error("crm.get_company is not declared")
    await fn.run({ credential: credentialOf(c), account: { id: "account-1" } } as never, {} as never)
    const [url, init] = send.mock.calls[0]
    const headers = Object.fromEntries(new Headers(init?.headers))
    for (const [name, value] of Object.entries(c.headers)) expect(headers[name]).toBe(value)
    if (Object.keys(c.headers).length === 0) expect(headers.authorization).toBeUndefined()
    expect(Object.fromEntries(new URL(String(url)).searchParams)).toEqual(c.query)
  })

  it.todo("should play the authentication cases of @otomata_tech/connectors/auth-cases, shared with the Python lib, once the connectors pin brings them")
})
