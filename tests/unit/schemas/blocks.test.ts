import { describe, expect, it } from "vitest"
import {
  BLOCK_TYPES,
  blockInputSchema,
  blockKeySchema,
  blockRef,
  blockTypeSchema,
} from "../../../packages/plateforme/schemas"
import { BLOCK_CASES } from "../../helpers/block-cases"

// Formes des blocs (E01-S06, AC6, AC7, AC36) : les mêmes cas passent ensuite par la base
// (`tests/integration/blocs-zod.test.ts`).

describe("BLOCK_TYPES", () => {
  it("should list the eleven block types of the contract, in its order, then those of E10-S04, E10-S02 and 1.4.3", () => {
    expect(BLOCK_TYPES).toEqual([
      "heading",
      "paragraph",
      "list",
      "checklist",
      "code",
      "call",
      "mermaid",
      "image",
      "callout",
      "reference",
      "row",
      "simple_table",
      "divider",
      "toggle",
      "file",
      "embed",
    ])
    expect(blockTypeSchema.safeParse("table").success).toBe(false)
  })

  it("should cover every type with one valid case and two invalid ones at least", () => {
    for (const type of BLOCK_TYPES) {
      const cases = BLOCK_CASES.filter((c) => c.block.type === type)
      expect(cases.filter((c) => c.valid).length, type).toBeGreaterThanOrEqual(1)
      expect(cases.filter((c) => !c.valid).length, type).toBeGreaterThanOrEqual(2)
    }
  })
})

describe("blockInputSchema", () => {
  // Un test pour l'AC36 (M11) : le verdict de chaque cas, dont les frontières N40 (un caractère hors
  // du plan de base compte pour un, comme dans la base).
  it("should give its verdict on every block case", () => {
    const verdicts = Object.fromEntries(BLOCK_CASES.map((c) => [c.name, blockInputSchema.safeParse(c.block).success]))
    expect(verdicts).toEqual(Object.fromEntries(BLOCK_CASES.map((c) => [c.name, c.valid])))
  })

  it("should keep the unknown keys of data, and drop a block id or a position", () => {
    const parsed = blockInputSchema.parse({
      type: "heading",
      text: "Étapes",
      data: { level: 2, anchor: "etapes" },
      id: "3f2a9c1e-0000-4000-8000-000000000000",
      position: 1024,
    })
    expect(parsed).toEqual({ type: "heading", text: "Étapes", data: { level: 2, anchor: "etapes" } })
  })
})

describe("blockKeySchema", () => {
  it("should refuse a key with a leading or trailing space, a control character, a tab, 501 characters or nothing", () => {
    for (const key of [" etapes", "etapes ", "eta\u0085pes", "eta\tpes", "k".repeat(501), ""]) {
      expect(blockKeySchema.safeParse(key).success, JSON.stringify(key)).toBe(false)
    }
  })

  it("should accept a key of 500 characters, inner spaces and a no-break space", () => {
    for (const key of ["k".repeat(500), "P-001", "étape 3", " nbsp"]) expect(blockKeySchema.safeParse(key).success, key).toBe(true)
  })
})

describe("blockRef", () => {
  const id = "3f2a9c1e-5b7d-4c1a-9e2f-8a6b4c2d0e1f"

  it("should give the key of a block that has one, the first 8 hexadecimal characters of its id otherwise", () => {
    expect(blockRef({ id, key: "etapes" })).toBe("etapes")
    expect(blockRef({ id, key: null })).toBe("3f2a9c1e")
  })
})
