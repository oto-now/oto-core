// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  fromDatabaseError,
  HTTP_STATUS,
  isPlatformError,
  PLATFORM_ERROR_CODES,
  PlatformError,
} from "@otomata_tech/oto_platform/server"
// Hors de la face `./server` : formateurs des refus, lus par les services et par `mcp/`.
import { boundedList, invalidInput, isUniqueViolation, issuesText } from "../../packages/plateforme/server/errors"

const DB_ERROR = {
  code: "42501",
  message: 'permission denied for table "invitations"',
  details: "Failing row contains (secret-column)",
  hint: "grant select on platform.invitations",
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("PLATFORM_ERROR_CODES", () => {
  it("should hold the closed list of H04", () => {
    expect([...PLATFORM_ERROR_CODES].sort()).toEqual(
      [
        "not_found",
        "forbidden",
        "unauthorized",
        "invalid_arguments",
        "stale_revision",
        "ctx_missing",
        "ctx_stale",
        "not_member",
        "unknown_org",
        "not_enabled",
        "ambiguous_team",
        "ambiguous_account",
        "needs_confirmation",
        "unavailable_in_v1",
        "too_large",
        "conflict",
        "internal",
        "rate_limited",
        "upstream_error",
        "credential_rejected",
        "quota_exhausted",
      ].sort(),
    )
  })

  it("should give every code an HTTP status", () => {
    for (const code of PLATFORM_ERROR_CODES) {
      expect(HTTP_STATUS[code], code).toBeGreaterThanOrEqual(400)
    }
    expect(HTTP_STATUS).toMatchObject({
      not_found: 404,
      forbidden: 403,
      unauthorized: 401,
      invalid_arguments: 400,
      not_member: 403,
      unknown_org: 404,
      unavailable_in_v1: 501,
      too_large: 413,
      conflict: 409,
      internal: 500,
      rate_limited: 429,
      upstream_error: 502,
      credential_rejected: 502,
      quota_exhausted: 502,
    })
  })
})

// Son code, son message et ses détails, rendus par la porte : `api-handler.test.ts`, « should render a service refusal
// with its status and details ».
describe("PlatformError", () => {
  it("should be recognised by isPlatformError, a plain Error should not", () => {
    expect(isPlatformError(new PlatformError("internal", "x"))).toBe(true)
    expect(isPlatformError(new Error("x"))).toBe(false)
    expect(isPlatformError({ code: "internal", message: "x" })).toBe(false)
  })
})

describe("fromDatabaseError", () => {
  it.each([
    // Jeton refusé par PostgREST après la porte (M10) : expiré, ou claims refusées.
    ["PGRST301", "unauthorized"],
    ["PGRST303", "unauthorized"],
    ["42501", "forbidden"],
    ["23505", "conflict"],
    ["23503", "invalid_arguments"],
    ["23514", "invalid_arguments"],
    ["22023", "invalid_arguments"],
    ["PGRST116", "not_found"],
    ["XX000", "internal"],
  ])("should map %s to %s", (dbCode, code) => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    expect(fromDatabaseError({ ...DB_ERROR, code: dbCode }, "test").code).toBe(code)
  })

  it("should map a missing error to internal", () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    expect(fromDatabaseError(null, "test").code).toBe("internal")
  })

  it("should never copy the database message, details or hint", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    const error = fromDatabaseError(DB_ERROR, "invitations insert")

    for (const leak of [DB_ERROR.message, DB_ERROR.details, DB_ERROR.hint]) {
      expect(error.message).not.toContain(leak)
      expect(JSON.stringify(error.details ?? {})).not.toContain(leak)
      expect(JSON.stringify(log.mock.calls)).not.toContain(leak)
    }
  })

  it("should log the context and the database code on the server", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    fromDatabaseError(DB_ERROR, "invitations insert")
    expect(JSON.stringify(log.mock.calls)).toContain("invitations insert")
    expect(JSON.stringify(log.mock.calls)).toContain("42501")
  })
})

// Un refus bâti sur une liste tient sous le plafond de 45 000 caractères (mcp-patterns.md § 4,
// E03-S01 N30, E04-S01 N32).
describe("boundedList", () => {
  it("should keep a short list whole, and give an empty text for no item", () => {
    expect(boundedList(["a", "b"])).toBe("a, b")
    expect(boundedList(["a", "b"], " or ")).toBe("a or b")
    expect(boundedList([])).toBe("")
  })

  it("should name 20 items at most, then count the others", () => {
    const items = Array.from({ length: 1000 }, (_, index) => `item${index}`)
    const text = boundedList(items)
    expect(text).toBe(`${items.slice(0, 20).join(", ")}, … and 980 more`)
    expect(boundedList(items.slice(0, 21))).toBe(`${items.slice(0, 20).join(", ")}, … and 1 more`)
    expect(boundedList(items.slice(0, 20))).toBe(items.slice(0, 20).join(", "))
  })
})

describe("issuesText and invalidInput", () => {
  it("should name each problem by its path, (root) for the input itself", () => {
    const issues = [
      { path: ["team_id"], message: "Invalid UUID" },
      { path: ["ops", 1, "op"], message: "Invalid option" },
      { path: [], message: "Invalid input: expected object, received null" },
    ]
    expect(issuesText(issues)).toBe("team_id: Invalid UUID; ops.1.op: Invalid option; (root): Invalid input: expected object, received null")
    const error = invalidInput({ issues })
    expect(error.code).toBe("invalid_arguments")
    expect(error.message).toBe(`Invalid arguments: ${issuesText(issues)}.`)
  })

  it("should list 20 problems out of 1,000, then their count", () => {
    const issues = Array.from({ length: 1000 }, (_, index) => ({ path: ["ops", index, "op"], message: "Invalid option" }))
    const { message } = invalidInput({ issues })
    expect(message.startsWith("Invalid arguments: ops.0.op: Invalid option; ops.1.op: ")).toBe(true)
    expect(message.endsWith("; ops.19.op: Invalid option; … and 980 more.")).toBe(true)
    expect(message.length).toBeLessThan(1000)
  })
})

describe("isUniqueViolation", () => {
  it("should recognise 23505 only", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true)
    expect(isUniqueViolation({ code: "23503" })).toBe(false)
    expect(isUniqueViolation(null)).toBe(false)
    expect(isUniqueViolation(undefined)).toBe(false)
  })
})
