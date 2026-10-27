// @vitest-environment node
// Contrat `write.procedure` servi par `read` (E03-S06, AC8) sur la base simulée : première ligne, ordre
// des parties, plafond, suite et cible du journal ; ses exemples sont des entrées de `write` dont les
// clôtures ```call deviennent des blocs `call` par l'analyse d'E03-S03, et `call` le refuse toujours.
import { describe, expect, it } from "vitest"
import { readNodeSchema, writeNodeSchema } from "../../packages/plateforme/schemas"
import { runCall } from "../../packages/plateforme/server/calls"
import { parseMarkdown } from "../../packages/plateforme/server/nodes/markdown-parse"
import { readNode } from "../../packages/plateforme/server/nodes/read"
import { contentRpc, contentTables, identityOf, referenceRpc } from "../helpers/reference-org"
import { simulatedDb } from "../helpers/simulated-db"

describe("write.procedure contract (AC8)", () => {
  it("should serve write.procedure to a member through read, like a function contract with nothing to call", async () => {
    const simulated = simulatedDb({ tables: contentTables(), rpc: { ...referenceRpc(), ...contentRpc() } })
    const identity = identityOf("marc")
    const output = await readNode(simulated.db, identity, { path: "write.procedure" })
    const lines = output.text.split("\n")
    expect(lines[0]).toBe("Contract write.procedure: how to write a procedure with acme_write (not a function; nothing to call).")
    expect(output.text.length).toBeLessThan(45_000)
    expect([output.nextActions, output.target, output.data]).toEqual([["acme_write"], "write.procedure", { contract: "write.procedure" }])
    expect(output.text).not.toContain("Header (JSON Schema):")
    expect(simulated.calls).toEqual([])

    // Description, puis « Call blocks: » (règles 1 à 8), « Examples: », « Possible refusals: », dans cet ordre.
    const at = (line: string) => lines.indexOf(line)
    const [rules, examples, refusals] = [at("Call blocks:"), at("Examples:"), at("Possible refusals:")]
    expect(lines[1].startsWith("A procedure is a node of kind procedure")).toBe(true)
    expect(1 < rules && rules < examples && examples < refusals).toBe(true)
    expect(lines.slice(rules + 1, examples).map((line) => line.slice(0, 3))).toEqual(["1. ", "2. ", "3. ", "4. ", "5. ", "6. ", "7. ", "8. "])
    expect(lines[rules + 8]).toBe(
      '8. To run a step, copy its call block into acme_call {"function": "<function>", "arguments": <arguments JSON>}, replacing each "<…>" value with the real one.',
    )
    // Une ligne par refus : la clôture mal formée à l'écriture, puis R2, la clôture hors d'un bloc de texte (E10-S04), R4, R7 à R13 à la publication.
    const listed = lines.slice(refusals + 1)
    expect(listed.map((line) => line.split(":")[0])).toEqual(["- On write", ...Array.from({ length: 10 }, () => "- On publish")])

    // Chaque exemple est une entrée valide ; ses clôtures ```call deviennent des blocs `call` (E03-S03).
    const examplesOf = (tool: string) => lines.slice(examples + 1, refusals).filter((line) => line.startsWith(`acme_${tool} `)).map((line) => JSON.parse(line.slice(`acme_${tool} `.length)))
    const writes = examplesOf("write")
    expect(writes.map((input) => writeNodeSchema.safeParse(input).success)).toEqual([true, true, true])
    expect(examplesOf("read").map((input) => readNodeSchema.safeParse(input).success)).toEqual([true])
    // Créer par `add_section`, ajouter une étape par `append`, puis par `insert_after` sur une référence lue avec `refs: true`.
    expect(writes.map((input) => writeNodeSchema.parse(input).ops?.[0]?.op)).toEqual(["add_section", "append", "insert_after"])
    expect(examplesOf("read").map((input) => readNodeSchema.parse(input).refs)).toEqual([true])
    const calls = writes.flatMap((input) =>
      writeNodeSchema.parse(input).ops?.flatMap((op) => {
        const parsed = parseMarkdown(op.text ?? "")
        return "blocks" in parsed ? parsed.blocks.flatMap((block) => (block.type === "call" ? [block.data.function] : [])) : [parsed.problem]
      }) ?? [],
    )
    expect(calls).toEqual(["mail.create_draft", "mail.send_draft", "table.rows", "mail.create_draft"])

    // Pas une fonction : `call` le refuse comme une fonction inconnue (E03-S04).
    const call = runCall({ db: simulated.db, identity, ctxCode: null, origin: "https://acme.test", activeConnectors: async () => new Set() }, { function: "write.procedure" })
    await expect(call).rejects.toMatchObject({ code: "not_found", message: "Unknown function write.procedure. Use acme_find with type function." })
  })
})
