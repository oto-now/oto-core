// Le classement et le regroupement des activités de l'accueil (E05-S12, lot B, AC-12 à AC-15 ; HN-E05S12-15,
// -16) : fonctions pures de `server/activities.ts`, sans base. Une ligne de journal devient un geste pour son
// lecteur (verbe, chemin coupé sur l'espace personnel d'autrui, D44), puis les gestes relus se regroupent.
// La portée, les niveaux et la requête sont éprouvés sur une vraie base par `activities-sql.test.ts`.
import { describe, expect, it } from "vitest"
import { classifyRow, groupGestures, type ActivityRow, type Gesture, type Resolution } from "../../packages/plateforme/server/activities"
import type { JournalReader } from "../../packages/plateforme/server/journal-rows"
import { TEMPS_LINEAIRE_MS } from "../helpers/temps-lineaire"

const LEA = "user-lea"
const ADA = "user-ada"
const READER: JournalReader = { userId: LEA, handle: "lea" }
const PREFIX = "acme"

const row = (surcharge: Partial<ActivityRow>): ActivityRow => ({
  id: 1,
  ts: "2026-09-26T10:00:00.000000+00:00",
  user_id: LEA,
  ctx: null,
  method: "api",
  tool: "POST nodes",
  target: "ventes/tarifs",
  publish: false,
  revised: false,
  truncated: false,
  kind: null,
  table: null,
  ...surcharge,
})

const verbOf = (surcharge: Partial<ActivityRow>) => classifyRow(row(surcharge), READER, PREFIX)?.verb ?? null

describe("classifyRow: the verb of a journal line (AC-12, HN-E05S12-15)", () => {
  const VERBS: [string, Partial<ActivityRow>, string | null][] = [
    ["a screen write without base_revision", {}, "created"],
    ["a screen write with base_revision", { revised: true }, "edited"],
    ["a screen write with publish: true", { revised: true, publish: true }, "published"],
    ["a screen creation published at once", { publish: true }, "published"],
    ["a screen write whose arguments were cut", { truncated: true, publish: true }, "edited"],
    ["a move", { tool: "POST nodes/move" }, "moved"],
    ["a duplication", { tool: "POST nodes/duplicate" }, "duplicated"],
    ["a trashing", { tool: "POST trash" }, "trashed"],
    ["a restoration", { tool: "POST trash/restore" }, "restored"],
    ["a review decision", { tool: "POST tables/review" }, "reviewed"],
    ["a sibling reordering", { tool: "POST nodes/position" }, null],
    ["a general access change", { tool: "POST nodes/access" }, null],
    ["an assistant write", { method: "tools/call", tool: "acme_write", revised: true }, "edited"],
    ["an assistant write under the bare name", { method: "tools/call", tool: "write" }, "created"],
    ["an assistant table.write", { method: "tools/call", tool: "acme_call", target: "table.write", table: "ventes/salons" }, "wrote_rows"],
    ["a table.write whose table could not be read", { method: "tools/call", tool: "acme_call", target: "table.write", table: null }, null],
    ["another function", { method: "tools/call", tool: "acme_call", target: "mail.create_draft", table: "ventes/salons" }, null],
    // E11-S02 (AC-h3) : les exécutions confirmées de la corbeille et de la suppression de lignes ; ni le
    // récapitulatif sans `confirm`, ni l'abandon d'un brouillon.
    ["a confirmed node.trash", { method: "tools/call", tool: "acme_call", target: "node.trash", confirmed: true, path: "ventes/essai" }, "trashed"],
    ["the summary of node.trash", { method: "tools/call", tool: "acme_call", target: "node.trash", confirmed: false, path: "ventes/essai" }, null],
    ["a confirmed table.delete_rows", { method: "tools/call", tool: "acme_call", target: "table.delete_rows", confirmed: true, table: "ventes/salons" }, "deleted_rows"],
    ["the summary of table.delete_rows", { method: "tools/call", tool: "acme_call", target: "table.delete_rows", table: "ventes/salons" }, null],
    ["a confirmed node.discard_draft", { method: "tools/call", tool: "acme_call", target: "node.discard_draft", confirmed: true, path: "ventes/salons" }, null],
    // E11-S18 (HN-E11S18-14) : un déplacement par `node.move`, sans confirmation ; son ancien chemin mène au nœud.
    ["a node.move", { method: "tools/call", tool: "acme_call", target: "node.move", path: "ventes/relance_devis" }, "moved"],
    ["a node.write_many, whose pages the journal cuts", { method: "tools/call", tool: "acme_call", target: "node.write_many", truncated: true }, null],
    ["a context routed to a path", { method: "tools/call", tool: "acme_context", target: "ventes/relance_devis", ctx: "K7M2-9QXR" }, "ran"],
    ["a context phrase", { method: "tools/call", tool: "acme_context", target: "relance les devis" }, null],
    ["a find", { method: "tools/call", tool: "acme_find", target: "ventes" }, null],
    ["a line of another method", { method: "initialize", tool: null }, null],
  ]

  it("should classify every line", () => {
    expect(Object.fromEntries(VERBS.map(([cas, surcharge]) => [cas, verbOf(surcharge)]))).toEqual(Object.fromEntries(VERBS.map(([cas, , verb]) => [cas, verb])))
  })

  it("should take the path of node.trash and the table of table.delete_rows from the arguments, and the rows to review of an execution (E11-S02, AC-h3)", () => {
    const trashed = row({ method: "tools/call", tool: "acme_call", target: "node.trash", confirmed: true, path: "ventes/essai" })
    expect(classifyRow(trashed, READER, PREFIX)).toMatchObject({ verb: "trashed", path: "ventes/essai" })
    const deleted = row({ method: "tools/call", tool: "acme_call", target: "table.delete_rows", confirmed: true, table: "ventes/salons", review: 2 })
    expect(classifyRow(deleted, READER, PREFIX)).toMatchObject({ verb: "deleted_rows", path: "ventes/salons", inReview: 2 })
    expect(classifyRow({ ...deleted, review: null }, READER, PREFIX)).not.toHaveProperty("inReview")
  })

  it("should take the table of a table.write from its arguments, and the kind of a creation from its arguments", () => {
    expect(classifyRow(row({ method: "tools/call", tool: "acme_call", target: "table.write", table: "ventes/salons" }), READER, PREFIX)?.path).toBe("ventes/salons")
    expect(classifyRow(row({ kind: "table" }), READER, PREFIX)).toMatchObject({ verb: "created", path: "ventes/tarifs", kind: "table" })
    expect(classifyRow(row({ kind: "agent" }), READER, PREFIX)?.kind).toBeNull()
  })
})

describe("classifyRow: another person's personal space (AC-15, D44)", () => {
  it("should cut the path of another person's line to private/<handle>, and drop the kind its arguments give", () => {
    expect(classifyRow(row({ user_id: ADA, target: "private/ada/notes/salon", kind: "page" }), READER, PREFIX)).toMatchObject({ path: "private/ada", kind: null })
    const table = row({ user_id: ADA, method: "tools/call", tool: "acme_call", target: "table.write", table: "private/ada/suivi" })
    expect(classifyRow(table, READER, PREFIX)?.path).toBe("private/ada")
  })

  it("should never take the kind from the arguments of another person's line, even on a shared path: they may name a personal space elsewhere", () => {
    expect(classifyRow(row({ user_id: ADA, target: "ventes/tarifs", kind: "page" }), READER, PREFIX)).toMatchObject({ path: "ventes/tarifs", kind: null })
  })

  it("should keep the whole path of the reader's own space, and of a line the reader wrote", () => {
    expect(classifyRow(row({ user_id: ADA, target: "private/lea/notes" }), READER, PREFIX)?.path).toBe("private/lea/notes")
    expect(classifyRow(row({ target: "private/ada/notes" }), READER, PREFIX)?.path).toBe("private/ada/notes")
  })

  it("should read a hostile target of the largest size in linear time", () => {
    const hostile = [`private/${"p".repeat(100_000)}`, "private/".repeat(20_000), `${"a/".repeat(50_000)}!`]
    for (const target of hostile) {
      const started = performance.now()
      classifyRow(row({ user_id: ADA, method: "tools/call", tool: "acme_context", target }), READER, PREFIX)
      classifyRow(row({ user_id: ADA, target }), READER, PREFIX)
      expect(performance.now() - started).toBeLessThan(TEMPS_LINEAIRE_MS)
    }
  })
})

const gesture = (id: number, at: string, surcharge: Partial<Gesture> = {}): Gesture => ({ id, at, userId: LEA, ctx: null, verb: "edited", path: "ventes/tarifs", kind: null, ...surcharge })

const TARIFS: Resolution = { node: { id: "n-tarifs", path: "ventes/tarifs_2026", title: "Tarifs 2026", summary: "Grille.", kind: "page" } }
const NAMES = new Map([
  [LEA, "Léa Roux"],
  [ADA, "Ada Martin"],
])
const group = (gestures: Gesture[], resolutions: Map<string, Resolution> = new Map([["ventes/tarifs", TARIFS]]), limit = 20) => groupGestures(gestures, resolutions, NAMES, limit)

describe("groupGestures: one activity per person, content and verb within an hour (AC-14, HN-E05S12-16)", () => {
  it("should chain the gestures less than an hour apart into one activity at the time of the newest, with their count", () => {
    const [activity] = group([gesture(3, "2026-09-26T10:50:00Z"), gesture(2, "2026-09-26T10:00:00Z"), gesture(1, "2026-09-26T09:10:00Z")])
    expect(activity).toMatchObject({ id: 3, at: "2026-09-26T10:50:00Z", count: 3, path: "ventes/tarifs_2026", title: "Tarifs 2026", kind: "page", userName: "Léa Roux" })
  })

  it("should keep apart a gesture made an hour or more before, or with another verb, person or content, each condition alone", () => {
    const others: [string, Gesture][] = [
      ["an hour or more before", gesture(1, "2026-09-26T09:00:00Z")],
      ["another verb", gesture(1, "2026-09-26T09:50:00Z", { verb: "published" })],
      ["another person", gesture(1, "2026-09-26T09:50:00Z", { userId: ADA })],
      ["another content", gesture(1, "2026-09-26T09:50:00Z", { path: "ventes/devis" })],
    ]
    const verdicts = Object.fromEntries(others.map(([cas, other]) => [cas, group([gesture(2, "2026-09-26T10:00:00Z"), other]).map((activity) => [activity.id, activity.count])]))
    expect(verdicts).toEqual(
      Object.fromEntries(
        others.map(([cas]) => [
          cas,
          [
            [2, 1],
            [1, 1],
          ],
        ]),
      ),
    )
  })

  it("should group the gestures made on the old and the new path of the same content", () => {
    const resolutions = new Map([
      ["ventes/tarifs", TARIFS],
      ["ventes/tarifs_2026", TARIFS],
    ])
    const activities = group([gesture(2, "2026-09-26T10:00:00Z", { path: "ventes/tarifs_2026" }), gesture(1, "2026-09-26T09:30:00Z")], resolutions)
    expect(activities.map((activity) => [activity.path, activity.count])).toEqual([["ventes/tarifs_2026", 2]])
  })

  it("should sum the rows to review of grouped deletions of rows, and add none when none was (E11-S02, AC-h3)", () => {
    const activities = group([
      gesture(3, "2026-09-26T10:00:00Z", { verb: "deleted_rows", inReview: 2 }),
      gesture(2, "2026-09-26T09:40:00Z", { verb: "deleted_rows" }),
      gesture(1, "2026-09-26T09:20:00Z", { verb: "deleted_rows", inReview: 1 }),
    ])
    expect(activities.map(({ verb, count, inReview }) => [verb, count, inReview])).toEqual([["deleted_rows", 3, 3]])
    const [none] = group([gesture(1, "2026-09-26T09:20:00Z", { verb: "deleted_rows" })])
    expect(none).not.toHaveProperty("inReview")
  })

  it("should give at most the limit, newest first", () => {
    const gestures = Array.from({ length: 4 }, (_, rank) => gesture(4 - rank, "2026-09-26T10:00:00Z", { path: `ventes/page_${rank}` }))
    expect(group(gestures, new Map(), 3).map((activity) => activity.id)).toEqual([4, 3, 2])
  })
})

describe("groupGestures: what a line shows of its content (AC-13, AC-15)", () => {
  it("should keep the path as the journal shows it, without title, for a content the person does not read, the nature from the trash, the verb or the arguments", () => {
    const resolutions = new Map<string, Resolution>([["ventes/ancienne", { trashedKind: "table" }]])
    const activities = group(
      [
        gesture(4, "2026-09-26T10:00:00Z", { verb: "trashed", path: "ventes/ancienne", kind: "page" }),
        gesture(3, "2026-09-26T10:00:00Z", { verb: "wrote_rows", path: "ventes/cachee" }),
        gesture(2, "2026-09-26T10:00:00Z", { verb: "created", path: "ventes/purgee", kind: "procedure" }),
        gesture(1, "2026-09-26T10:00:00Z", { verb: "edited", path: "private/ada", userId: "user-parti" }),
      ],
      resolutions,
    )
    expect(activities.map(({ path, title, kind, userName }) => [path, title, kind, userName])).toEqual([
      ["ventes/ancienne", null, "table", "Léa Roux"],
      ["ventes/cachee", null, "table", "Léa Roux"],
      ["ventes/purgee", null, "procedure", "Léa Roux"],
      ["private/ada", null, null, null],
    ])
  })

  it("should make a launched procedure of a context line only when the person reads a procedure at its target, with its conversation", () => {
    const relance: Resolution = { node: { id: "n-relance", path: "ventes/relance_devis", title: "Relancer les devis", summary: "…", kind: "procedure" } }
    const page: Resolution = { node: { id: "n-page", path: "ventes/tarifs", title: "Tarifs", summary: "…", kind: "page" } }
    const resolutions = new Map([
      ["ventes/relance_devis", relance],
      ["ventes/tarifs", page],
    ])
    const activities = group(
      [
        gesture(3, "2026-09-26T10:00:00Z", { verb: "ran", path: "ventes/relance_devis", ctx: "K7M2-9QXR" }),
        gesture(2, "2026-09-26T10:00:00Z", { verb: "ran", path: "ventes/tarifs", ctx: "AAAA-0002" }),
        gesture(1, "2026-09-26T10:00:00Z", { verb: "ran", path: "ventes/inconnue", ctx: "AAAA-0001" }),
        gesture(0, "2026-09-26T10:00:00Z", { verb: "edited", path: "ventes/tarifs", ctx: "AAAA-0000" }),
      ],
      resolutions,
    )
    expect(activities.map(({ verb, kind, title, ctx }) => [verb, kind, title, ctx])).toEqual([
      ["ran", "procedure", "Relancer les devis", "K7M2-9QXR"],
      ["edited", "page", "Tarifs", null],
    ])
  })
})
