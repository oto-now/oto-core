// @vitest-environment node
// Client HTTP des connecteurs (stories prise-des-connecteurs, AC16, et moteur-des-connecteurs-decrits) : `fetch` simulé,
// aucun réseau. Le jeton est tiré à l'exécution ; chaque refus et chaque log se relisent pour prouver qu'il n'y passe
// jamais. Le rythme par compte se lit sous une horloge simulée, sans attente réelle.
import { randomBytes } from "crypto"
import { afterEach, describe, expect, it, vi } from "vitest"
import { requestJson, type ApiRequest, type ConnectorApi, type Fetch } from "../../packages/plateforme/server/connectors/http"
import { PlatformError } from "../../packages/plateforme/server/errors"
import { loggedText } from "../helpers/logs"

const API: ConnectorApi = {
  label: "Tiers",
  baseUrl: "https://api.example.test/v1",
  timeoutMs: 5_000,
  errors: [
    { status: 400, code: "invalid_arguments", message: "Tiers rejected the request." },
    { status: 401, code: "upstream_error", message: "Tiers rejected the token." },
    { status: 429, code: "rate_limited", message: "Tiers rate exceeded: retry later." },
    { status: [500, 503], code: "upstream_error", message: "Tiers is unavailable: retry later.", refusal: "upstream_unavailable" },
  ],
}

/** Une requête signée du jeton, au compte `key` (clé du rythme). */
const request = (secret: string, more: Partial<ApiRequest> = {}): ApiRequest => ({
  method: "GET",
  path: "/x",
  headers: { authorization: `Bearer ${secret}` },
  pacingKey: `account-${randomBytes(4).toString("hex")}`,
  ...more,
})

const token = () => `tok_${randomBytes(12).toString("hex")}`
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

async function refusal(run: Promise<unknown>): Promise<PlatformError> {
  const error = await run.then(
    () => null,
    (reason: unknown) => reason,
  )
  if (!(error instanceof PlatformError)) throw new Error(`expected a PlatformError, got ${String(error)}`)
  return error
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("requestJson", () => {
  it("should send the headers it is given, the query pairs in order, a JSON body even on DELETE, and a deadline", async () => {
    const secret = token()
    const send = vi.fn<Fetch>(async () => json({ ok: true }))
    const query: [string, string][] = [["ids[]", "a"], ["ids[]", "b"], ["q", "x y"]]
    const answer = await requestJson(API, request(secret, { method: "DELETE", path: "/items", query, body: { reason: "dup" } }), send)
    expect(answer).toEqual({ ok: true })
    const [url, init] = send.mock.calls[0]
    expect(url).toBe("https://api.example.test/v1/items?ids%5B%5D=a&ids%5B%5D=b&q=x+y")
    expect(init.method).toBe("DELETE")
    expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${secret}`)
    expect(new Headers(init.headers).get("content-type")).toBe("application/json")
    expect(init.body).toBe(JSON.stringify({ reason: "dup" }))
    expect(init.redirect).toBe("error")
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it("should read an empty answer as null, and send no body nor content type when none is given", async () => {
    const send = vi.fn<Fetch>(async () => new Response(null, { status: 204 }))
    expect(await requestJson(API, request(token()), send)).toBeNull()
    const [, init] = send.mock.calls[0]
    expect([init.body, new Headers(init.headers).has("content-type")]).toEqual([undefined, false])
  })

  it.each([
    [400, "invalid_arguments", "Tiers rejected the request.", undefined],
    [401, "upstream_error", "Tiers rejected the token.", undefined],
    [503, "upstream_error", "Tiers is unavailable: retry later.", { refusal: "upstream_unavailable" }],
    [418, "upstream_error", "Tiers answered with an unexpected status (418). Retry later.", undefined],
  ])("should translate status %i through the connector's table, without the token anywhere", async (status, code, message, details) => {
    const secret = token()
    const errors = vi.spyOn(console, "error").mockImplementation(() => {})
    const error = await refusal(requestJson(API, request(secret), async () => json({ message: `echo ${secret}` }, status)))
    expect({ code: error.code, message: error.message, details: error.details }).toEqual({ code, message, details })
    expect(`${error.message} ${JSON.stringify(error.details ?? {})} ${String(error.cause ?? "")}`).not.toContain(secret)
    expect(loggedText(errors)).not.toContain(secret)
  })

  it("should retry a 429 after its Retry-After, twice at most, and answer rate_limited beyond", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const busy = () => new Response(null, { status: 429, headers: { "retry-after": "0" } })
    const once = vi.fn<Fetch>().mockResolvedValueOnce(busy()).mockResolvedValueOnce(json({ ok: true }))
    expect(await requestJson(API, request(token()), once)).toEqual({ ok: true })
    const always = vi.fn<Fetch>(async () => busy())
    expect((await refusal(requestJson(API, request(token()), always))).code).toBe("rate_limited")
    expect(always).toHaveBeenCalledTimes(3)
  })

  it("should not retry a 429 whose Retry-After exceeds 10 s, and answer rate_limited without a table entry", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const later = vi.fn<Fetch>(async () => new Response(null, { status: 429, headers: { "retry-after": "120" } }))
    const error = await refusal(requestJson({ ...API, errors: [] }, request(token()), later))
    expect({ code: error.code, message: error.message }).toEqual({ code: "rate_limited", message: "Tiers request rate exceeded: retry later." })
    expect(later).toHaveBeenCalledTimes(1)
  })

  it("should hold the third request of an account limited to 2 per second until the window frees, other accounts unaffected", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] })
    try {
      const limited = { ...API, rateLimit: { requests: 2, intervalMs: 1_000 } }
      const send = vi.fn<Fetch>(async () => json({}))
      const one = request(token())
      await requestJson(limited, one, send)
      await requestJson(limited, one, send)
      const third = requestJson(limited, one, send)
      await requestJson(limited, request(token()), send)
      await vi.advanceTimersByTimeAsync(999)
      expect(send).toHaveBeenCalledTimes(3)
      await vi.advanceTimersByTimeAsync(1)
      await third
      expect(send).toHaveBeenCalledTimes(4)
    } finally {
      vi.useRealTimers()
    }
  })

  it("should turn a deadline or a network failure into upstream_error, carrying neither the request nor the token", async () => {
    const secret = token()
    const errors = vi.spyOn(console, "error").mockImplementation(() => {})
    const timeout = Object.assign(new Error(`aborted Bearer ${secret}`), { name: "TimeoutError" })
    const late = await refusal(requestJson(API, request(secret), async () => Promise.reject(timeout)))
    expect({ code: late.code, message: late.message }).toEqual({ code: "upstream_error", message: "Tiers did not answer within 5 s. Retry later." })
    const down = await refusal(requestJson(API, request(secret), async () => Promise.reject(new TypeError(`fetch failed ${secret}`))))
    expect({ code: down.code, message: down.message }).toEqual({ code: "upstream_error", message: "Tiers could not be reached. Retry later." })
    for (const error of [late, down]) expect(error.cause).toBeUndefined()
    expect(loggedText(errors)).not.toContain(secret)
  })

  it("should apply a body row only when its body matches, the first that applies, plain rows otherwise, and never log the body", async () => {
    const secret = token()
    const errors = vi.spyOn(console, "error").mockImplementation(() => {})
    const graph = (codes: unknown[]) => (answer: unknown) => codes.includes((answer as { error?: { code?: unknown } } | null)?.error?.code)
    const api: ConnectorApi = {
      ...API,
      errors: [
        { status: 400, code: "credential_rejected", message: "Tiers no longer accepts this authorization.", refusal: "authorization_expired", body: graph([190, 102]) },
        { status: 400, code: "invalid_arguments", message: "Tiers rejected the request.", refusal: "invalid_request" },
        { status: 200, code: "quota_exhausted", message: "Tiers credits are spent.", refusal: "no_credits", body: graph(["NO_CREDITS"]) },
      ],
    }
    const expired = await refusal(requestJson(api, request(secret), async () => json({ error: { code: 190, message: `token ${secret}` } }, 400)))
    expect({ code: expired.code, message: expired.message, details: expired.details }).toEqual({ code: "credential_rejected", message: "Tiers no longer accepts this authorization.", details: { refusal: "authorization_expired" } })
    const invalid = await refusal(requestJson(api, request(secret), async () => json({ error: { code: 100 } }, 400)))
    expect({ code: invalid.code, refusal: invalid.details?.refusal }).toEqual({ code: "invalid_arguments", refusal: "invalid_request" })
    // Un corps illisible ne satisfait aucune condition : la ligne sans condition s'applique.
    const unreadable = await refusal(requestJson(api, request(secret), async () => new Response("<html>", { status: 400 })))
    expect(unreadable.details?.refusal).toBe("invalid_request")
    const spent = await refusal(requestJson(api, request(secret), async () => json({ error: { code: "NO_CREDITS" } })))
    expect({ code: spent.code, refusal: spent.details?.refusal }).toEqual({ code: "quota_exhausted", refusal: "no_credits" })
    expect(await requestJson(api, request(secret), async () => json({ data: { ok: true } }))).toEqual({ data: { ok: true } })
    expect(loggedText(errors)).not.toContain(secret)
    expect(loggedText(errors)).not.toContain("NO_CREDITS")
  })

  it("should not read the body of a status that no body row covers", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const cancel = vi.fn(async () => {})
    const body = new ReadableStream({ start: (controller) => controller.enqueue(new TextEncoder().encode("{}")) })
    const answer = new Response(body, { status: 503 })
    Object.defineProperty(answer, "body", { value: Object.assign(body, { cancel }) })
    const api: ConnectorApi = { ...API, errors: [...API.errors, { status: 400, code: "credential_rejected", message: "Refused.", body: () => true }] }
    const down = await refusal(requestJson(api, request(token()), async () => answer))
    expect(down.details?.refusal).toBe("upstream_unavailable")
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it("should refuse an answer that is not JSON as upstream_error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const unreadable = await refusal(requestJson(API, request(token()), async () => new Response("<html>", { status: 200 })))
    expect(unreadable.code).toBe("upstream_error")
  })
})
