// @vitest-environment node
// Les lecteurs de fichiers, lot 1 (`lecture-des-fichiers.md` : registre, types de l'hôte, bornes, parties des lecteurs
// texte), sans base : l'inscription contrôlée (un type du paquet, une page, un script ou un type MIME rendu par le
// navigateur refusés, rien d'inscrit au premier refus), l'ouverture au dépôt du seul type inscrit et son service en
// téléchargement, les parties d'un `md` et d'un `txt`, puis un lecteur couru sous les bornes : NUL retiré, texte coupé à
// 2 millions de caractères, statut, forme fausse, échéance d'un lecteur asynchrone et d'une étape synchrone.
import { afterEach, describe, expect, it, vi } from "vitest"
import { readText, startDeadline } from "../../packages/plateforme/server/files/readers/document"
import { defineReader, registerReaders } from "../../packages/plateforme/server/files/readers/registry"
import { TEXT_READERS } from "../../packages/plateforme/server/files/readers/text"
import { READER_LIMITS, type Reader, type ReaderDocument } from "../../packages/plateforme/server/files/readers/types"
import { admittedType, checkSize, readResponse } from "../../packages/plateforme/server/files/service"
import { PlatformError } from "../../packages/plateforme/server/errors"

const NUL = String.fromCharCode(0)
const bytesOf = (text: string) => new TextEncoder().encode(text)

/** Un lecteur de plans `.dxf` : un document fait des parties qu'on lui donne. */
function planReader(parts: Record<string, string>, head: Partial<ReaderDocument> = {}): Reader {
  return defineReader({
    types: [{ extension: "dxf", mime: "image/vnd.dxf" }],
    read: () => ({
      title: "Plan",
      summary: "A plan.",
      parts: Object.entries(parts).map(([name, text]) => ({ name, chars: text.length })),
      text: (part: string) => parts[part] ?? "",
      ...head,
    }),
  })
}

/** Le refus d'une promesse, ou `null` si elle aboutit. */
const refusal = (run: Promise<unknown>) => run.then(() => null, (error: unknown) => error)

/** Le code, le message et la raison d'un refus de la plateforme. */
const said = (error: unknown) => (error instanceof PlatformError ? { code: error.code, message: error.message, reason: error.details?.reason } : error)

/** Le lecteur du paquet d'une extension. */
const packageReader = (extension: string): Reader => {
  const found = TEXT_READERS.find((reader) => reader.types.some((type) => type.extension === extension))
  if (!found) throw new Error(`no package reader for ${extension}`)
  return found
}

/** Le texte lu par un lecteur du paquet, sous une échéance large. */
async function readPackage(extension: string, text: string) {
  const deadline = startDeadline()
  try {
    const read = await readText(packageReader(extension), { name: `f.${extension}`, bytes: bytesOf(text) }, deadline)
    return { read, whole: await read.whole() }
  } finally {
    deadline.clear()
  }
}

afterEach(() => {
  registerReaders([])
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("registerReaders", () => {
  it("should open at deposit the type a host reader reads, at its declared mime, and nothing else", () => {
    expect(() => admittedType("plan.dxf")).toThrow("plan.dxf: this type of file is not admitted.")
    registerReaders([planReader({})])
    expect([admittedType("Plan RDC.DXF"), admittedType("rapport.pdf")]).toEqual([
      { type: "dxf", mime: "image/vnd.dxf" },
      { type: "pdf", mime: "application/pdf" },
    ])
    expect(() => admittedType("plan.dwg")).toThrow(/plan\.dwg: this type of file is not admitted\. Admitted extensions: .*, dxf\./u)
    // 50 Mo pour un type d'hôte, comme un format binaire : la borne de 4 Mo ne vaut que pour un texte du paquet.
    expect(() => checkSize("plan.dxf", "dxf", READER_LIMITS.textBytes + 1)).not.toThrow()
  })

  it("should serve a host type as a download at its declared mime, disposition=inline ignored", () => {
    registerReaders([planReader({})])
    expect([readResponse({ name: "plan.dxf" }, true), readResponse({ name: "plan.dwg" }, true)]).toEqual([
      { contentType: "image/vnd.dxf", disposition: "attachment; filename*=UTF-8''plan.dxf" },
      { contentType: "application/octet-stream", disposition: "attachment; filename*=UTF-8''plan.dwg" },
    ])
  })

  it("should refuse a type of the package, a page, a script or a program, a mime a browser renders, a malformed one and a type read twice, inscribing nothing", () => {
    registerReaders([planReader({})])
    const read = () => ({ status: "failed" as const })
    const attempts: [string, unknown][] = [
      ["md", "text/markdown"],
      ["htm", "text/plain"],
      ["exe", "application/octet-stream"],
      ["plan", "text/html"],
      ["plan", "image/svg+xml"],
      ["plan", "Model/STL"],
      ["plan", "model/stl; charset=utf-8"],
      ["Plan", "model/stl"],
      [".stl", "model/stl"],
    ]
    const messages = attempts.map(([extension, mime]) => {
      try {
        registerReaders([defineReader({ types: [{ extension, mime: mime as string }], read })])
        return null
      } catch (error) {
        return error instanceof TypeError ? error.message : String(error)
      }
    })
    expect(messages).toEqual([
      "registerReaders: reader 1: .md is a type of the package: a host reader cannot redefine it.",
      "registerReaders: reader 1: .htm is a page, a script or a program: it is never admitted.",
      "registerReaders: reader 1: .exe is a page, a script or a program: it is never admitted.",
      "registerReaders: reader 1: .plan: text/html is rendered or run by a browser: declare the type of the format itself.",
      "registerReaders: reader 1: .plan: image/svg+xml is rendered or run by a browser: declare the type of the format itself.",
      'registerReaders: reader 1: .plan: mime "Model/STL" must be a lowercase media type such as model/stl, without parameters.',
      'registerReaders: reader 1: .plan: mime "model/stl; charset=utf-8" must be a lowercase media type such as model/stl, without parameters.',
      'registerReaders: reader 1: extension "Plan": 1 to 16 lowercase ASCII letters or digits, without the dot.',
      'registerReaders: reader 1: extension ".stl": 1 to 16 lowercase ASCII letters or digits, without the dot.',
    ])
    const twice = [planReader({}), planReader({})]
    expect(() => registerReaders(twice)).toThrow("registerReaders: reader 2: .dxf is read by two readers.")
    expect(() => registerReaders([defineReader({ types: [], read })])).toThrow("registerReaders: reader 1 must list at least one type.")
    // Rien d'inscrit au premier refus : la liste d'avant tient.
    expect(admittedType("plan.dxf")).toEqual({ type: "dxf", mime: "image/vnd.dxf" })
    registerReaders([])
    expect(() => admittedType("plan.dxf")).toThrow("not admitted")
  })
})

describe("text readers of the package", () => {
  it("should cut a markdown at its #, ## and ### headings, outside its frontmatter and code blocks, the joined parts giving the text back", async () => {
    const text = [
      "---",
      "title: Guide",
      "summary: Pour installer.",
      "---",
      "Intro.",
      "# Installation",
      "```sh",
      "# a comment",
      "```",
      "## Étapes ##",
      "#### Détail",
      "### Étapes",
      "#Collé",
      "# Étapes",
    ].join("\n")
    const { read, whole } = await readPackage("md", text)
    expect(read.parts.map((part) => part.name)).toEqual(["(start of file)", "Installation", "Étapes", "Étapes (2)", "Étapes (3)"])
    expect([read.title, read.summary, whole]).toEqual(["Guide", "Pour installer.", text])
    expect(await read.text("Étapes")).toBe("## Étapes ##\n#### Détail")
  })

  it("should cut a text without headings in runs of lines of one page at most, named by their lines", async () => {
    const lines = Array.from({ length: 600 }, (_, index) => `ligne ${String(index).padStart(4, "0")} ${"x".repeat(40)}`)
    const { read, whole } = await readPackage("txt", lines.join("\n"))
    expect(read.parts.slice(0, 2).map((part) => part.name)).toEqual(["lines 1-230", "lines 231-460"])
    expect(read.parts.every((part) => part.chars <= 12_000)).toBe(true)
    expect([read.summary, whole]).toEqual(["600 lines", lines.join("\n")])
    expect((await packageReader("csv").read({ name: "a.csv", bytes: bytesOf("a;b"), signal: new AbortController().signal })) as ReaderDocument).toMatchObject({ parts: [{ name: "line 1", chars: 3 }] })
  })

  it("should refuse a text that is not UTF-8 with the status unsupported", async () => {
    const deadline = startDeadline()
    const error = await refusal(readText(packageReader("txt"), { name: "ancien.txt", bytes: new Uint8Array([0x45, 0x74, 0xe9]) }, deadline))
    deadline.clear()
    expect(said(error)).toEqual({ code: "invalid_arguments", message: "ancien.txt cannot be read: the file is not UTF-8; download it instead (unsupported).", reason: "unsupported" })
  })
})

describe("a reader run under the common bounds", () => {
  const run = async (reader: Reader) => {
    const deadline = startDeadline()
    try {
      return await readText(reader, { name: "plan.dxf", bytes: bytesOf("x") }, deadline)
    } finally {
      deadline.clear()
    }
  }

  it("should take the NUL character out of the title, the summary, the part names and the text", async () => {
    const read = await run(planReader({ [`Niveau${NUL} 1`]: `Mur${NUL} porteur` }, { title: `Plan${NUL} RDC`, summary: `Un${NUL} plan.` }))
    expect([read.title, read.summary, read.parts, await read.text("Niveau 1")]).toEqual(["Plan RDC", "Un plan.", [{ name: "Niveau 1", chars: 12 }], "Mur porteur"])
  })

  it("should cut the text at 2,000,000 characters, the part astride cut and the following ones left out", async () => {
    const big = "a".repeat(1_500_000)
    const read = await run(planReader({ "Niveau 1": big, "Niveau 2": big, "Niveau 3": "b" }))
    expect([read.parts, read.chars, read.declaredChars]).toEqual([[{ name: "Niveau 1", chars: 1_500_000 }, { name: "Niveau 2", chars: 500_000 }], 2_000_000, 3_000_001])
    expect([(await read.text("Niveau 2")).length, (await read.whole()).length, await read.text("Niveau 3")]).toEqual([500_000, 2_000_000, ""])
  })

  it("should refuse with the status a reader returns, and as failed a reader that throws or returns a wrong shape", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const reader = (read: Reader["read"]) => defineReader({ types: [{ extension: "dxf", mime: "image/vnd.dxf" }], read })
    const errors = await Promise.all([
      refusal(run(reader(() => ({ status: "encrypted" })))),
      refusal(run(reader(() => ({ status: "too_large", detail: "over 64 MB unzipped" })))),
      refusal(run(reader(() => Promise.reject(new Error("the converter crashed"))))),
      refusal(run(planReader({ a: "x" }, { parts: [{ name: "a", chars: 1 }, { name: "a", chars: 1 }] }))),
      refusal(run(reader(() => ({ status: "lost" }) as unknown as { status: "failed" }))),
    ])
    expect(errors.map(said)).toEqual([
      { code: "invalid_arguments", message: "plan.dxf cannot be read: it is encrypted (encrypted).", reason: "encrypted" },
      { code: "too_large", message: "plan.dxf cannot be read: over 64 MB unzipped (too_large).", reason: "too_large" },
      ...Array(3).fill({ code: "conflict", message: "plan.dxf cannot be read: its reader failed; retry later (failed).", reason: "failed" }),
    ])
  })

  it("should give up an asynchronous reader at the deadline with the status timeout, its signal aborted", async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | null = null
    const slow = defineReader({
      types: [{ extension: "dxf", mime: "image/vnd.dxf" }],
      read: (input) => {
        signal = input.signal
        return new Promise(() => {})
      },
    })
    const pending = refusal(run(slow))
    await vi.advanceTimersByTimeAsync(READER_LIMITS.readMs)
    expect([said(await pending), (signal as AbortSignal | null)?.aborted]).toEqual([
      { code: "conflict", message: "plan.dxf cannot be read: it was not read within 10 seconds; retry later (timeout).", reason: "timeout" },
      true,
    ])
  })

  it("should refuse with the status timeout a synchronous reader that overran the deadline, once it returns", async () => {
    vi.useFakeTimers()
    const blocking = planReader({ a: "x" })
    const overrun = defineReader({
      types: blocking.types,
      read: (input) => {
        // L'horloge avance sans que la boucle tourne : une étape synchrone de 11 secondes.
        vi.setSystemTime(Date.now() + READER_LIMITS.readMs + 1_000)
        return blocking.read(input)
      },
    })
    expect(said(await refusal(run(overrun)))).toMatchObject({ code: "conflict", reason: "timeout" })
  })
})
