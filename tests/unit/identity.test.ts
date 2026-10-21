// @vitest-environment node
// L'hôte et l'origine d'une requête, sans base. La résolution de l'identité, qui lit la base, est prouvée
// sur une vraie base par `tests/integration/identity.test.ts` (E01-S10, partie e1a).
import { afterEach, describe, expect, it, vi } from "vitest"
import { linkOrigin } from "@otomata_tech/oto_platform/schemas"
import { normalizeHost, PlatformError, rawRequestHost, requestHost, requestOrigin, trustedRequestOrigin, type PlatformDb } from "@otomata_tech/oto_platform/server"
import { orgDomainsDb } from "../helpers/org-domains"

describe("normalizeHost", () => {
  it("should lower-case the host and drop the port", () => {
    expect(normalizeHost("Demo.LocalHost:3000")).toBe("demo.localhost")
  })

  it("should drop a trailing dot", () => {
    expect(normalizeHost("acme.oto.cx.")).toBe("acme.oto.cx")
  })

  it("should return null for an empty value", () => {
    expect(normalizeHost("")).toBeNull()
    expect(normalizeHost("   ")).toBeNull()
    expect(normalizeHost(null)).toBeNull()
  })

  it("should return null for an IPv6 literal", () => {
    expect(normalizeHost("[::1]:3000")).toBeNull()
  })
})

describe("requestHost", () => {
  it("should take the first x-forwarded-host element", () => {
    const headers = new Headers({ "x-forwarded-host": "Acme.oto.cx, proxy.internal", host: "localhost:3000" })
    expect(requestHost(headers)).toBe("acme.oto.cx")
    expect(rawRequestHost(headers)).toBe("Acme.oto.cx")
  })

  it("should fall back on host", () => {
    expect(requestHost(new Headers({ host: "demo.localhost:3000" }))).toBe("demo.localhost")
  })

  it("should return null without host", () => {
    expect(requestHost(new Headers())).toBeNull()
  })
})

describe("requestOrigin", () => {
  it("should prefer x-forwarded-proto and keep the port of the raw host", () => {
    expect(requestOrigin(new Headers({ "x-forwarded-proto": "https" }), "acme.oto.cx", "http")).toBe("https://acme.oto.cx")
    expect(requestOrigin(new Headers(), "localhost:3000", "http")).toBe("http://localhost:3000")
  })

  // Un proxy peut transmettre ce que le client envoie : le lien d'un email d'invitation ne porte jamais
  // un autre protocole (E01-S11 a2-wire, `security-patterns.md § XSS Prevention`).
  it.each(["javascript", "https://evil.example.test/?"])("should ignore an x-forwarded-proto of %s for the protocol given", (forwarded) => {
    expect(requestOrigin(new Headers({ "x-forwarded-proto": forwarded }), "acme.oto.cx", "https")).toBe("https://acme.oto.cx")
  })
})

describe("linkOrigin", () => {
  it("should build https on the normalized host, without its port", () => {
    expect(linkOrigin("Acme.oto.cx:8443")).toBe("https://acme.oto.cx")
    expect(linkOrigin("acme.oto.cx.")).toBe("https://acme.oto.cx")
  })

  it.each([
    ["localhost:3000", "http://localhost:3000"],
    ["demo.localhost:3000", "http://demo.localhost:3000"],
    ["127.0.0.1:3000", "http://127.0.0.1:3000"],
    ["localhost", "http://localhost"],
  ])("should keep http and the port of the local machine (%s)", (host, origin) => {
    expect(linkOrigin(host)).toBe(origin)
  })

  it.each(["", null, "[::1]:3000", "evil.test/@x", "evil.test\\x", "a b", "evil.test?x"])("should build no origin for %j, which is not a host name", (host) => {
    expect(linkOrigin(host)).toBeNull()
  })
})

// Le lien d'un email part de l'adresse appelée seulement si elle sert une organisation ou est une adresse d'entrée :
// derrière un proxy qui transmet `x-forwarded-host` tel quel, l'en-tête forgé ne choisit pas sa destination.
describe("trustedRequestOrigin", () => {
  const DB = orgDomainsDb(["acme.oto.cx"])

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("should build no link for a forwarded host that serves no organisation, and log it normalized and bounded", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    const forged = `Evil.example.test${"x".repeat(300)}`

    await expect(trustedRequestOrigin(DB, new Headers({ "x-forwarded-host": forged, host: "acme.oto.cx" }), { entryHosts: ["oto.example.test"] })).resolves.toBeNull()
    const line = String(log.mock.calls[0]?.[0])
    expect(line).toContain("[platform] trustedRequestOrigin")
    expect(line).toContain("evil.example.test")
    expect(line).not.toContain(forged.toLowerCase())
  })

  it("should build no link without a host", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})

    await expect(trustedRequestOrigin(DB, new Headers())).resolves.toBeNull()
  })

  it("should let a database failure through, never a link nor a silent null", async () => {
    const down: PlatformDb = { tx: async () => Promise.reject(new PlatformError("internal", "Database unreachable.")) }

    await expect(trustedRequestOrigin(down, new Headers({ host: "acme.oto.cx" }))).rejects.toMatchObject({ code: "internal" })
  })
})
