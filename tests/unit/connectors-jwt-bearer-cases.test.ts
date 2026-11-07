// @vitest-environment node
// Les cas communs du compte de service (`connectors/_cases/jwt_bearer.yaml`), partagés avec la référence du dépôt
// `connectors`, copiés (`tests/factories/jwt-bearer-cases.ts`) en attendant `@otomata_tech/connectors/jwt-bearer-cases` :
// chaque cas joué contre la signature du paquet (`prepareAuth`, puis `sign`) sur un `fetch` simulé et une horloge
// posée : la requête de jeton exacte (l'assertion signée comprise), puis l'en-tête et l'échéance du jeton, ou le refus
// nommé ; chaque clé refusée l'est avant tout envoi, sans qu'un morceau de la clé ne sorte. Un écart est un désalignement
// à corriger du côté qui s'écarte du format, jamais un cas à retirer.
import { afterEach, describe, expect, it, vi } from "vitest"
import { prepareAuth, sign, type Signer } from "../../packages/plateforme/server/connectors/auth"
import type { ConnectorDefinition } from "../../packages/plateforme/server/connectors/definition"
import type { Fetch } from "../../packages/plateforme/server/connectors/http"
import { PlatformError } from "../../packages/plateforme/server/errors"
import { describedConnector, memoryTokens } from "../factories/described-connector"
import { credentialValue, jwtBearerCases, jwtBearerRefusedKeys, testKeyPkcs8, type JwtBearerCase, type JwtBearerRefusedKey } from "../factories/jwt-bearer-cases"
import { loggedText } from "../helpers/logs"

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const segment = (value: object) => Buffer.from(JSON.stringify(value), "utf8").toString("base64url")

/** L'assertion attendue d'un cas : en-tête et revendications sérialisés dans l'ordre du cas, puis sa signature. */
const assertionOf = (c: JwtBearerCase) => `${segment(c.assertion.header)}.${segment(c.assertion.claims)}.${c.assertion.signature}`

/** La signature du paquet sous l'authentification et le credential du cas, la clé du cas dans son seul champ. */
function signerOf(c: JwtBearerCase | JwtBearerRefusedKey, fetcher: Fetch) {
  const definition: ConnectorDefinition = { ...describedConnector(), auth: c.auth, credential: c.credential }
  const auth = prepareAuth(definition)
  if (typeof auth === "string") throw new Error(auth)
  const tokens = memoryTokens()
  const signer: Signer = { auth, definition, credential: { fields: { [c.credential[0].name]: credentialValue(c) }, settings: {}, tokens }, accountId: "account-1", fetcherFor: () => fetcher }
  return { signer, tokens }
}

const answerOf = (c: JwtBearerCase) =>
  c.tokenAnswer.body === null
    ? new Response(null, { status: c.tokenAnswer.status, headers: c.tokenAnswer.headers })
    : new Response(JSON.stringify(c.tokenAnswer.body), { status: c.tokenAnswer.status, headers: { "content-type": "application/json", ...c.tokenAnswer.headers } })

/** Ce que rend une signature ou son refus : `PlatformError` attendu, toute autre erreur relevée telle quelle. */
async function settled<T>(work: Promise<T>): Promise<{ value: T } | { error: PlatformError }> {
  try {
    return { value: await work }
  } catch (error) {
    if (!(error instanceof PlatformError)) throw error
    return { error }
  }
}

describe("common service account cases", () => {
  it.each(jwtBearerCases.map((c) => [c.name, c] as const))("%s: the exact token request, then the token or the named refusal", async (_name, c) => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(c.now * 1000)
    vi.spyOn(console, "error").mockImplementation(() => {})
    const send = vi.fn<Fetch>(async () => answerOf(c))
    const { signer, tokens } = signerOf(c, send)
    const result = await settled(sign(signer))
    const sent = send.mock.calls.map(([url, init]) => ({ url, method: init.method, redirect: init.redirect, type: new Headers(init.headers).get("content-type"), body: init.body }))
    expect(sent).toEqual([
      { url: c.tokenRequest.url, method: "POST", redirect: "error", type: c.tokenRequest.contentType, body: c.tokenRequest.body.replace("{assertion}", assertionOf(c)) },
    ])
    const outcome =
      "value" in result
        ? { headers: result.value.headers, expiresAt: (tokens.written[0]?.expiresAt?.getTime() ?? Number.NaN) / 1000 }
        : { refusal: result.error.code }
    expect(outcome).toEqual(c.outcome)
  })

  it.each(jwtBearerRefusedKeys.map((c) => [c.name, c] as const))("%s: refused before anything is sent, naming the refusal", async (_name, c) => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {})
    const send = vi.fn<Fetch>()
    const { signer } = signerOf(c, send)
    const result = await settled(sign(signer))
    if (!("error" in result)) throw new Error(`${c.name}: the key was not refused`)
    expect([result.error.code, result.error.details, send.mock.calls.length]).toEqual(["not_enabled", { refusal: c.refusal }, 0])
    const served = [result.error.message, loggedText(errors)].join("\n")
    expect(testKeyPkcs8.split("\n").some((line) => line !== "" && served.includes(line))).toBe(false)
  })

  it.todo("should play the service account cases of @otomata_tech/connectors/jwt-bearer-cases once the connectors pin brings them")
})
