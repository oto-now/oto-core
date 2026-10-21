// @vitest-environment node
// Les copies d'objets de la duplication (E10-S02, AC-e3, HN-E10S02-113) : par lots de 8 au plus, chaque lot attendu
// avant le suivant ; une copie en échec laisse sa ligne `pending` sans arrêter les autres, et seules les copies réussies
// passent à `ready`. Stockage et base simulés : la borne est le sujet ; la duplication sur une vraie base est dans
// `tests/integration/files-trash-duplication.test.ts`.
import { afterEach, describe, expect, it, vi } from "vitest"
import type { PlatformDb } from "../../packages/plateforme/server/db"
import { copyFileObjects } from "../../packages/plateforme/server/files/service"
import type { FileStore } from "../../packages/plateforme/server/files/store"
import type { Identity } from "../../packages/plateforme/server/identity"

const storage = vi.hoisted(() => ({ store: null as unknown }))

vi.mock("../../packages/plateforme/server/files/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../packages/plateforme/server/files/store")>()),
  fileStore: () => storage.store,
}))

const ORG = "3d0f6a52-0000-4000-8000-00000000000a"

/** Un stockage dont les copies attendent un tour : il relève combien sont en cours à la fois. */
function countingStore(failing: string) {
  const state = { running: 0, most: 0, copied: [] as string[] }
  const store: Pick<FileStore, "copy"> = {
    async copy(from, to) {
      state.running += 1
      state.most = Math.max(state.most, state.running)
      await new Promise((resolve) => setImmediate(resolve))
      state.running -= 1
      if (to.endsWith(failing)) throw new Error("copy refused")
      state.copied.push(to)
    },
  }
  return { store, state }
}

/** Une base qui relève les identifiants passés à `ready`. */
function recordingDb() {
  const readied: unknown[] = []
  const sql = (_strings: TemplateStringsArray, ...values: unknown[]) => {
    readied.push(values.at(-1))
    return Promise.resolve([])
  }
  // La doublure ne sert que la mise à jour de `copyFileObjects`, un seul gabarit : le type `Tx` complet n'a pas lieu d'être.
  const db = { tx: (fn: (tx: typeof sql) => Promise<unknown>) => fn(sql) } as unknown as PlatformDb
  return { db, readied }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("copyFileObjects (AC-e3)", () => {
  it("should copy 8 objects at once at most, keep the others going after a failure, and ready the copies made only", async () => {
    const pairs = Array.from({ length: 19 }, (_, rank) => [`from-${rank}`, `to-${rank}`] as const)
    const { store, state } = countingStore("to-9")
    storage.store = store
    const { db, readied } = recordingDb()
    vi.spyOn(console, "error").mockImplementation(() => undefined)

    // Seul `org.id` est lu par le service ici.
    await copyFileObjects(db, { org: { id: ORG } } as unknown as Identity, pairs)

    const expected = pairs.map(([, to]) => to).filter((to) => to !== "to-9")
    expect({ most: state.most, copied: state.copied.length, readied }).toEqual({ most: 8, copied: 18, readied: [expected] })
  })
})
