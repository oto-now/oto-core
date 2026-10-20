// Le guide de la plateforme (`read {"path": "help"}`), servi par le paquet, le même dans toutes les organisations, comme
// `functions` et `journal` : son plan, puis une section par appel. Il dit ce qu'un assistant doit savoir pour écrire du
// premier coup une page, un tableau ou une procédure, ranger des contenus et copier une arborescence ; il renvoie aux
// contrats (`write.procedure`, `write.table`) au lieu de les recopier. Sans lui, ces règles ne se lisent que dispersées
// dans les descriptions des outils, et un assistant les apprend par ses erreurs. Texte servi en anglais (ADR-020).
import { PROCEDURE_MAX_CHARS } from "../schemas/procedures"
import { PlatformError } from "./errors"
import { formatCount } from "./nodes/document"
import type { ToolOutput } from "./tool-output"

/** Le chemin réservé de `read` qui sert le guide de la plateforme, comme `functions` (E11-S19) et `journal` (P22). */
export const HELP_PATH = "help"

/** `stems` : les débuts de mots, anglais et français, qui mènent une demande à la section (`closestHelpSection`). */
type HelpSection = { id: string; title: string; summary: string; stems: readonly string[]; lines: readonly string[] }

/** Les sections du guide, dans l'ordre du plan ; `<p>` devient le préfixe de l'organisation. */
const SECTIONS: readonly HelpSection[] = [
  {
    id: "pages",
    title: "Pages and blocks",
    summary: "every block type and its markdown, sections, block operations, long contents",
    stems: ["block", "bloc", "markdown", "section", "heading", "titre", "iframe", "embed", "intégr", "integr"],
    lines: [
      "A page is made of blocks, written in markdown with <p>_write. Each block type and how to write it:",
      "- heading: ## Title (### to ###### for levels 2 to 5); a section is a heading and what follows, until the next heading of the same level or above; section titles are unique in a page; on screen people can fold any section under its heading, you always read it whole.",
      "- paragraph: plain text; **bold**, *italic*, `code`, [label](https://…), [[path]] or [[path|title]] to link another content.",
      "- list: - item (or 1. item), up to three levels, two spaces per level; checklist: - [ ] to do / - [x] done.",
      "- code: a fence ```language … ```; mermaid: a fence ```mermaid … ``` (a diagram drawn on screen).",
      "- callout: > text on each line, opened by > [!NOTE] for a tone (NOTE, TIP, WARNING…).",
      "- simple table: a markdown table (| a | b | then | --- | --- |), 20 columns and 200 rows at most; beyond, a data table.",
      "- divider: --- on its own line; toggle: <details><summary>Summary</summary> body </details>.",
      "- image: ![alt](https://…); an attached file or image comes from upload.link or the screen, never from markdown alone.",
      "- reference: a fence ```reference <path>``` shows another content in place.",
      "- embed: a fence ```embed https://…``` shows another site's page in a frame; add {\"height\": \"small\" | \"medium\" | \"large\"} after the address.",
      "- call (procedures only): a fence ```call <function> {\"argument\": …}``` (see the procedures section).",
      "Edit by section (replace_section, append, add_section, delete_section), by block (read with refs: true, then replace_block, insert_after, delete_block, move_block), by text (replace_text with find and count), or the whole body (set_markdown).",
      "Long contents: <p>_read cuts at 45,000 characters and gives a cursor for the rest; read one section with section. Write in parts of 20,000 characters with append; a file you already have goes through upload.link.",
    ],
  },
  {
    id: "tables",
    title: "Tables",
    summary: "key, column types, proofs, writing rows, the work queue",
    stems: ["table", "tableau", "ligne", "row", "colonne", "column", "preuve", "proof", "clé"],
    lines: [
      "A table has a header (columns, a key column, options) and rows. Before writing rows, <p>_call table.schema: its key, columns and whether each value needs a proof.",
      "Column types: text, number, date, datetime, bool, enum (fixed options), email, url; the key is a text, email, url, number or date column, unique per row.",
      "Read with table.rows (filters, q for words, 50 rows per page) and table.aggregate (counts, sums); write with table.write, 50 rows per call, matched on the key (create_only refuses an existing key).",
      "A table that requires proofs takes each value as {\"value\": …, \"comment\": \"…\"} or {\"value\": …, \"link\": \"https://…\"}; an empty value proven empty goes in verified_empty with its reason.",
      "A work queue (lifecycle column): table.claim takes rows to work on, table.release gives them back; a closed table refuses writes.",
      "Creating a table or changing its header: <p>_read path write.table first (the contract, with its refusals).",
    ],
  },
  {
    id: "procedures",
    title: "Procedures",
    summary: "what makes a procedure valid, and what makes it work well",
    stems: ["procédure", "procedure", "étape", "step", "appel"],
    lines: [
      "A procedure is a page of steps an assistant follows. Its title and summary route requests to it: the summary says what it does and how people ask for it.",
      "Valid: read <p>_read path write.procedure before writing. Each step that runs a function has a call block right after it: ```call <function> {\"argument\": \"<value known when it runs>\"}```; confirm, team and account never go in the arguments; a procedure holds " +
        formatCount(PROCEDURE_MAX_CHARS) +
        " characters at most once rendered; every call is checked at publication against the functions and the tables that exist.",
      "Sub-procedures: never a procedure under a procedure, which would be routed in place of the main one; each sub-step is a page under the main procedure, whose steps link to it with [[path]].",
      "Works well: a part « When to use it », with the cases where not to use it and where to go instead; numbered steps, one action each; each step says what to do with the result (a condition to stop, a branch, a value to report); the expected output, in its format; who to ask when the case is not covered.",
      "External tools: a procedure that needs a connector of the assistant (outside this platform) says so in a part « Prerequisites »; without it, the assistant tells the person instead of failing at that step.",
      "In a text, name the tools without the organisation prefix (read, write, find, call): the text stays right when it is copied to another organisation.",
    ],
  },
  {
    id: "paths",
    title: "Paths and spaces",
    summary: "spaces, context pages, how a path changes, reserved names",
    stems: ["chemin", "path", "déplac", "move", "renomm", "rename", "espace", "space", "dossier", "folder", "range"],
    lines: [
      "Every content has a path: lowercase letters, digits and _ separated by /. The organisation's contents sit at the root, a team's under its folder (<team>/…), yours under private/<handle>/.",
      "A context page is served to assistants: contexte for the organisation, <team>/contexte for a team, your space's for you. Do not create another page named contexte for that purpose: it is not served.",
      "Publishing a new title moves the path to follow it. To move or rename on purpose, <p>_call node.move: the old path keeps leading there. Never recreate a content then trash the old one: its links and history would be lost.",
      "Reserved paths, served by <p>_read: journal (what was done), functions (every function), help (this guide).",
      "A path refused as not available is held by a content (perhaps one you cannot see), was the path of a moved content, or is a reserved name: choose another.",
    ],
  },
  {
    id: "transfer",
    title: "Import and export",
    summary: "copying a tree between organisations, what follows, what to check",
    stems: ["export", "import", "copi", "copy", "transf", "arborescence", "tree", "sauvegard", "backup"],
    lines: [
      "node.export_tree writes one or several roots to a signed address valid one hour: json is faithful (blocks, table headers, rows and proofs, attached files) and meant for node.import_tree on another platform; zip gives .md and .csv files for a person.",
      "node.import_tree reads that address (or a zip, a .md, a .csv, a file attached to a page) under an existing page. Rewritten on the way: links, reference blocks, the arguments of call blocks and the table cells that name an imported path; the tools named with the source organisation's prefix take this one's.",
      "A path taken: skip (default) keeps it unless it is empty, overwrite updates it, suffix puts the imported root next to it. A context page at the arrival is never replaced: the imported node goes next to it. A long import answers continue_from: call again with it.",
      "The report counts every node of the source: created, updated, kept or left out, refused (with the whole refusal), kept as drafts (a procedure whose publication is refused). Then run node.check on the imported root: broken links, invalid calls, cells naming a missing path.",
    ],
  },
  {
    id: "pitfalls",
    title: "Known pitfalls",
    summary: "mistakes that cost the most, and how to avoid them",
    stems: ["erreur", "error", "refus", "refused", "piège", "pitfall"],
    lines: [
      "- Editing without base_revision, or with an old one: read first, then pass the revision you read (or the one your last write returned).",
      "- A result that starts with « context has changed » ran: do not repeat the call; use the new ctx it gives.",
      "- A table that requires proofs refuses a bare value: give a comment or a link with each value.",
      "- A title published moves the path: links follow, but a path written in a table cell or a call argument does not.",
      "- find returns a few results: to list a folder, read it, or <p>_call node.tree for a whole tree.",
      "- Something unclear, missing or wrong in a tool, a procedure or this guide: tell it with <p>_feedback.",
    ],
  },
]

/** Les sections que `context` sert entières quand la demande y mène (1.4.12) : la notice d'une procédure. */
const SERVED_IN_FULL = new Set(["procedures"])

function sectionText(section: HelpSection, prefix: string): string {
  return [`## ${section.title}`, ...section.lines].join("\n").replaceAll("<p>", prefix)
}

/**
 * `read {"path": "help"}` : le plan du guide (chaque section, son nom et ce qu'elle dit) ; avec `section` (son nom, ou
 * son titre sans casse), cette section entière. Une section inconnue est refusée, avec les noms admis.
 */
export function helpGuide(section: string | undefined, prefix: string): ToolOutput {
  if (section === undefined || section.trim() === "") {
    const lines = [
      "Platform guide, the same in every organisation. Read one section at a time:",
      ...SECTIONS.map((one) => `- ${one.id}: ${one.title} — ${one.summary}.`),
      `Read a section with ${prefix}_read {"path": "help", "section": "<name>"}.`,
    ]
    return { text: lines.join("\n"), data: { sections: SECTIONS.map((one) => ({ name: one.id, title: one.title })) }, nextActions: [`${prefix}_read`], target: HELP_PATH }
  }
  const wanted = section.trim().toLowerCase()
  const found = SECTIONS.find((one) => one.id === wanted || one.title.toLowerCase() === wanted)
  if (!found) throw new PlatformError("invalid_arguments", `Unknown section ${section} of help. Sections: ${SECTIONS.map((one) => one.id).join(", ")}.`)
  return { text: sectionText(found, prefix), data: { section: found.id }, nextActions: [`${prefix}_read`, `${prefix}_write`], target: HELP_PATH }
}

/**
 * La section du guide la plus proche d'une demande : celle dont le plus de mots de la demande commencent par un de ses
 * débuts de mots (`exporte` mène à Import and export) ; `null` sans aucun. Les mots se lisent en un passage.
 */
export function closestHelpSection(phrase: string): { id: string; title: string; text?: string } | null {
  const words = phrase.toLowerCase().split(/[^a-zà-ÿ0-9]+/).filter((word) => word.length > 2)
  const scored = SECTIONS.map((one) => ({ one, score: words.filter((word) => one.stems.some((stem) => word.startsWith(stem))).length }))
  const best = scored.sort((a, b) => b.score - a.score)[0]
  if (!best || best.score === 0) return null
  // Une demande qui mène aux procédures reçoit leur notice entière, préfixe à remplacer par l'appelant (`<p>`).
  return { id: best.one.id, title: best.one.title, ...(SERVED_IN_FULL.has(best.one.id) ? { text: sectionText(best.one, "<p>") } : {}) }
}
