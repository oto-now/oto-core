// `node.write_many` (E11-S18, AC-12 ; HN-E11S18-11) : plusieurs écritures de `write` en un appel, dans l'ordre, sous le
// `ctx` de l'appel, chacune par `writeNode`, entière ou rien (`write-atomic.ts`) ; un refus n'arrête pas les suivantes,
// et le résultat donne une ligne par page. Sans elle, importer une base de fiches coûte un appel par page. Aucune
// écriture propre : droits, bornes et refus sont ceux de `write`, page par page.
import { writeManyArgsSchema } from "../../schemas/nodes"
import { defineFunction } from "../catalog/define"
import { isPlatformError } from "../errors"
import { cut } from "../journal"
import { publishedAnywayLine, withoutDraftRequest } from "./publish-always"
import { writeNodeLazily } from "./write-lazy"
import type { WriteOrigin } from "./write-result"

/**
 * Caractères au plus de la ligne d'une page dans le texte, et du refus d'une page dans les données : 50 pages tiennent
 * sous le plafond d'un résultat, texte et données ensemble.
 */
const PAGE_LINE_MAX = 400

/** Les pages déjà écrites, dites quand une panne arrête le lot : le lot ne se rejoue pas à l'aveugle. */
function writtenSoFar(outcomes: readonly PageOutcome[]): string {
  const written = outcomes.filter((outcome) => outcome.status !== "refused").map((outcome) => outcome.path)
  return written.length > 0 ? `Written before it stopped: ${written.join(", ")}.` : "No page was written."
}

/** Ce qu'une page est devenue, en champs. */
type PageOutcome = { path: string; status: "published" | "draft" | "refused"; revision?: number; code?: string; message?: string }

export const nodeWriteMany = defineFunction({
  name: "node.write_many",
  connector: "node",
  class: "write",
  origin: "paquet",
  description:
    "Writes several pages, procedures or tables in one call, each exactly as write would (create or edit, ops), in the given order, 50 at most: use it to import many markdown files or to write a whole folder, a parent before its children. Each page is written whole or not at all; a refused page does not stop the others, and the result gives one line per page. For a markdown file, give title and summary, and ops [{op: set_markdown, text}] with its body.",
  schema: writeManyArgsSchema,
  examples: [
    {
      pages: [
        { path: "sav/fiches", kind: "page", title: "Fiches", summary: "Les fiches du SAV." },
        { path: "sav/fiches/garantie", kind: "page", title: "Garantie", summary: "Ce que couvre la garantie.", ops: [{ op: "set_markdown", text: "## Durée" }] },
      ],
    },
  ],
  refusals: [
    "More than 50 pages, or an unknown key in a page (a markdown body goes in ops, with set_markdown).",
    "Each page: the refusals of write (path, parent missing, rights, stale base_revision, operations, publication); the page is written whole or not at all, and the next pages are still written.",
  ],
  run: async (context, args) => {
    const origin: WriteOrigin = { kind: "agent", ctx: context.ctx ?? null }
    const outcomes: PageOutcome[] = []
    const lines: string[] = []
    let teamId: string | null = null
    let stopped: string | null = null
    // Comme `write` : `publish: false` d'une page est retiré, et le résultat le dit une fois (`publish-always.ts`).
    let draftAsked = false
    for (const [rank, page] of args.pages.entries()) {
      try {
        const { input: body, asked } = withoutDraftRequest(page)
        draftAsked ||= asked
        const output = await writeNodeLazily(context.db, context.identity, body, origin)
        const data = output.data ?? {}
        const path = typeof data.path === "string" ? data.path : page.path
        outcomes.push({ path, status: data.has_draft === true ? "draft" : "published", ...(typeof data.revision === "number" ? { revision: data.revision } : {}) })
        lines.push(`${rank + 1}. ${cut(output.text.replace(/\n+/g, " "), PAGE_LINE_MAX)}`)
        teamId ??= output.teamId ?? null
      } catch (error) {
        if (!isPlatformError(error)) {
          // Une panne hors refus (un bogue) arrête le lot ; la réponse dit ce qui est déjà écrit (revue E11-S18).
          console.error("[platform] node.write_many: stopped on", page.path, error)
          stopped = `Stopped at page ${rank + 1} (${page.path}) by an internal error; the pages after it were not written. ${writtenSoFar(outcomes)}`
          break
        }
        // L'appel à refaire d'un retrait à confirmer se garde entier ; tout autre refus se coupe à la ligne.
        const message = error.code === "needs_confirmation" ? error.message.replace(/\n+/g, " ") : cut(error.message.replace(/\n+/g, " "), PAGE_LINE_MAX)
        outcomes.push({ path: page.path, status: "refused", code: error.code, message })
        lines.push(`${rank + 1}. ${page.path} refused (${error.code}): ${message}`)
      }
    }
    const refused = outcomes.filter((outcome) => outcome.status === "refused").length
    const pages = args.pages.length
    const head = `${outcomes.length - refused} of ${pages} ${pages === 1 ? "page" : "pages"} written, ${refused} refused.`
    const said = draftAsked ? [publishedAnywayLine(context.identity.org.prefix)] : []
    return { text: [head, ...lines, ...(stopped ? [stopped] : []), ...said].join("\n"), data: { pages: outcomes, ...(stopped ? { stopped: true } : {}) }, teamId }
  },
})
