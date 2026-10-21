// Fonctions de test de `call` (E03-S04) et du contrôle des procédures (E03-S06) : une classe, une
// origine, une sortie, un contrôle propre (`checkArgs`) ou des arguments imbriqués que le catalogue de
// la V1 (le `mail` simulé seul, avant E07) n'a pas. Chacune rend ce qu'elle a reçu (compte, `ctx`), de
// quoi prouver ce que `runCall` lui passe.
import * as z from "zod/v4"
import { defineFunction, type CatalogFunction, type FunctionContext } from "../../packages/plateforme/server/catalog/define"

/** Ce qu'une fonction de test a reçu de `runCall` : le libellé du compte résolu et le code `ctx` (N9). */
function received(context: FunctionContext) {
  return { account: context.account?.label ?? null, ctx: context.ctx ?? null }
}

/** `test.read` : lecture, origine ERP (toujours active, sans compte). */
export const testRead = defineFunction({
  name: "test.read",
  connector: "test",
  class: "read",
  origin: "erp",
  description: "Reads test data.",
  schema: z.strictObject({}),
  examples: [{}],
  refusals: [],
  run: async (context) => ({ text: "Test data read.", data: received(context) }),
})

/**
 * `test.write` : écriture qui propose `test.read`, `test.send` (sensible) et `test.off` (inactive) ;
 * `next` et `team_id` passés en arguments deviennent le `next` et le `teamId` de sa sortie (AC14, N8).
 */
export const testWrite = defineFunction({
  name: "test.write",
  connector: "test",
  class: "write",
  origin: "erp",
  description: "Writes test data.",
  schema: z.strictObject({ next: z.array(z.string()).optional(), team_id: z.string().optional() }),
  examples: [{}],
  refusals: [],
  next: ["test.read", "test.send", "test.off"],
  run: async (context, args) => ({ text: "Test data written.", data: received(context), next: args.next, teamId: args.team_id }),
})

/** `test.send` : sensible, avec son récapitulatif (H86). */
export const testSend = defineFunction({
  name: "test.send",
  connector: "test",
  class: "sensitive",
  origin: "erp",
  description: "Sends test data.",
  schema: z.strictObject({ to: z.string() }),
  examples: [{ to: "sophie@valbrune.test" }],
  refusals: [],
  summarize: async (_context, args) => ({ text: `About to send test data to ${args.to}.`, data: { to: args.to } }),
  run: async (_context, args) => ({ text: `Test data sent to ${args.to}.`, data: { sent_to: args.to } }),
})

/** `test.off` : fonction d'un connecteur qu'aucune organisation de test n'active (H81). */
export const testOff = defineFunction({
  name: "test.off",
  connector: "off",
  class: "read",
  origin: "connecteur",
  description: "Reads through a connector that no test organisation activates.",
  schema: z.strictObject({}),
  examples: [{}],
  refusals: [],
  run: async () => ({ text: "Never run." }),
})

/** `table.test_read` : native du connecteur `table` (origine `paquet`), sans compte ; son tableau porte l'appel (H84). */
export const tableTestRead = defineFunction({
  name: "table.test_read",
  connector: "table",
  class: "read",
  origin: "paquet",
  description: "Reads a test table.",
  schema: z.strictObject({ table: z.string() }),
  examples: [{ table: "support/suivi" }],
  refusals: [],
  run: async (context, args) => ({ text: `Rows of ${args.table}.`, data: received(context) }),
})

/** `test.big` : 600 lignes de 100 caractères, au-dessus du plafond de 45 000 (H26). */
export const testBig = defineFunction({
  name: "test.big",
  connector: "test",
  class: "read",
  origin: "erp",
  description: "Returns more than 60,000 characters.",
  schema: z.strictObject({}),
  examples: [{}],
  refusals: [],
  run: async () => ({ text: Array.from({ length: 600 }, (_, index) => `${String(index).padStart(3, "0")} ${"x".repeat(96)}`).join("\n") }),
})

/** `test.fail` : lève une erreur qui n'est pas une `PlatformError`, un détail interne dans son message (AC17). */
export const testFail = defineFunction({
  name: "test.fail",
  connector: "test",
  class: "read",
  origin: "erp",
  description: "Fails.",
  schema: z.strictObject({}),
  examples: [{}],
  refusals: [],
  run: async () => {
    throw new Error("socket hang up at 10.0.0.12:5432")
  },
})

/** Refus du contrôle propre de `test.release` : l'état `busy` n'est posé que par une réservation (E03-S06, R13). */
export const BUSY_REFUSAL = "state « busy » is set only by test.claim; states accepted by test.release: open, done"

/** `test.release` : un contrôle propre (`checkArgs`), comme `table.release` refusera l'état de travail (E07-S02). */
export const testRelease = defineFunction({
  name: "test.release",
  connector: "test",
  class: "write",
  origin: "paquet",
  description: "Releases a claimed test row.",
  schema: z.strictObject({ table: z.string(), key: z.string(), worker: z.string(), state: z.string() }),
  examples: [{ table: "ventes/suivi", key: "p1", worker: "Léa", state: "done" }],
  refusals: [],
  run: async (context) => ({ text: "Test row released.", data: received(context) }),
  checkArgs: async (_context, args, isPlaceholder) => (!isPlaceholder(["state"]) && args.state === "busy" ? [BUSY_REFUSAL] : []),
})

/**
 * `test.invoice` : inscrite par l'hôte (origine `erp`), des lignes imbriquées (E03-S06, AC4) et des
 * étiquettes dont la clé, choisie par qui écrit, entre dans le chemin d'un refus (R12).
 */
export const testInvoice = defineFunction({
  name: "test.invoice",
  connector: "erp",
  class: "write",
  origin: "erp",
  description: "Creates a test invoice.",
  schema: z.strictObject({
    customer: z.string().regex(/^C-\d+$/),
    lines: z.array(z.strictObject({ sku: z.string().regex(/^SKU-\d+$/), qty: z.number().int().min(1) })),
    tags: z.record(z.string(), z.string()).optional(),
  }),
  examples: [{ customer: "C-1", lines: [{ sku: "SKU-1", qty: 1 }] }],
  refusals: [],
  run: async (context) => ({ text: "Test invoice created.", data: received(context) }),
})

export const TEST_FUNCTIONS: CatalogFunction[] = [testRead, testWrite, testSend, testOff, tableTestRead, testBig, testFail, testRelease, testInvoice]

type Registry = typeof import("../../packages/plateforme/server/catalog/registry")

/**
 * La fabrique de `vi.mock` du registre : le catalogue réel complété de `TEST_FUNCTIONS`, celui de l'assistant aussi
 * (les portes qui servent un assistant lisent `assistantFunctions`). Appelée par un import dynamique dans la
 * fabrique, que `vi.mock` hisse au-dessus des imports du fichier.
 */
export async function withTestFunctions(importOriginal: <T = unknown>() => Promise<T>): Promise<Registry> {
  const original = await importOriginal<Registry>()
  return {
    ...original,
    catalogFunctions: () => [...original.catalogFunctions(), ...TEST_FUNCTIONS],
    assistantFunctions: () => [...original.assistantFunctions(), ...TEST_FUNCTIONS],
  }
}
