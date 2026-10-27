// Contrats non appelables servis par `read` (E03-S06, H62, N14) : la forme d'une écriture, que le
// modèle lit avant d'écrire comme le contrat d'une fonction (`describeFunction`), sans rien à appeler.
// `write.procedure`, et `write.table` (E07-S04) dont la partie « Header (JSON Schema): » est une partie
// comme les autres. Sans lui, la description figée de `write` (`mcp/tools.ts`, ADR-002) renvoie à un
// contrat introuvable.
//
// Repris de la maquette (`mcp-test/src/proto/functions/registry.ts` l. 22-36) : la disposition d'un
// contrat (titre, description, exemples, refus possibles). Retiré : le schéma d'arguments et les
// exemples d'appel par `<p>_call` (rien à appeler).
import * as z from "zod/v4"
import { tableHeaderPatchSchema } from "../../schemas/tables"
import { UPLOAD_RULE } from "../../schemas/uploads"

/** Le contenu d'un contrat au préfixe de l'organisation (`acme_write`…), dans l'ordre de `renderContract`. */
type ContractContent = {
  /** Suite de la première ligne, après « Contract <nom>: ». */
  summary: string
  description: string[]
  /** Parties propres au contrat, chacune sous son titre (« Call blocks: »). */
  parts: { title: string; lines: string[] }[]
  examples: string[]
  refusals: string[]
}

export type Contract = { name: string; content: (prefix: string) => ContractContent }

/** Une clôture `call` telle que `write` la lit et que `read` la rend (H59), dans le texte JSON d'une opération. */
const callFence = (call: string) => `\`\`\`call\\n${call}\\n\`\`\``

const writeProcedure: Contract = {
  name: "write.procedure",
  content: (p) => ({
    summary: `how to write a procedure with ${p}_write (not a function; nothing to call).`,
    description: [
      `A procedure is a node of kind procedure, read and written like a page: a title, a summary of 1 to 200 characters that says what it does and how people ask for it (${p}_context matches requests on the title and the summary), then blocks: headings, paragraphs, lists, callouts, and call blocks that hold the exact calls to make.`,
      `Recommended: a heading « Étapes » followed by numbered steps, each step that calls a function followed by its call block; headings « Quand l'utiliser » and « Règles » when useful. No section is required: call blocks are checked wherever they are.`,
      `A procedure has no header (header is for tables only). Create it with kind "procedure", a title and a summary; each write publishes it. Publishing checks every block first and, if anything is wrong, lists every problem at once with where its block is: nothing is written, and a draft saved before with publish: false stays as it was. Writing it in several calls: pass publish: false until the last one.`,
      "A procedure never goes under another procedure: only the main procedure is a procedure, routed and listed; each of its sub-steps is a page (kind page) under it, which its steps link to with [[path]].",
    ],
    parts: [
      {
        title: "Call blocks:",
        lines: [
          "1. A call block holds one exact call: a function name and its arguments as one JSON object. Nothing else in the block is read.",
          `2. Write it in the text of an operation, by section (add_section, append, replace_section…) or by block (insert_after, replace_block on the reference of a block read with refs: true), as a fence: a line \`\`\`call, then <function> <arguments JSON> (the JSON may span several lines; a name alone means {}; the fence may be indented under a numbered step), then a line \`\`\`. ${p}_read shows each call block as this same fence: what you read can be written back as is.`,
          `3. The function name looks like table.rows or mail.create_draft: lowercase, one dot, never prefixed by the organisation nor written ${p}_call.`,
          `4. A string value that is exactly "<…>" (e.g. "<email du contact>", "<id>") is a placeholder filled in when the procedure runs: its key is checked, its value is not, at every level (nested objects and lists). A key is never a placeholder.`,
          `5. confirm, team and account are options of ${p}_call, never arguments in a block: say it in the step's text instead, e.g. « call again with confirm: true after the user's explicit approval ».`,
          "6. Only call blocks are checked. A code block marked call, or a text line starting with a call fence, is refused: write a call block instead. Any other code block, or a sentence that names a function, is left as is.",
          "7. A problem says where its block is, e.g. section « Étapes », call block 2 (step 3): the nearest heading before the block, the rank of the block among the call blocks after that heading, and the number of the numbered step just before it.",
          `8. To run a step, copy its call block into ${p}_call {"function": "<function>", "arguments": <arguments JSON>}, replacing each "<…>" value with the real one.`,
        ],
      },
    ],
    examples: [
      "Create a procedure whose steps call functions:",
      `${p}_write {"path": "ventes/relance_devis", "kind": "procedure", "title": "Relancer les devis en attente", "summary": "Relance par email les devis envoyés sans réponse depuis 7 jours, sur demande « relance les devis en attente ».", "ops": [{"op": "add_section", "section": "Étapes", "text": "1. Annonce en une phrase ce que tu vas faire.\\n2. Prépare un brouillon pour chaque devis :\\n\\n${callFence('mail.create_draft {\\"to\\": \\"<email du contact>\\", \\"subject\\": \\"Votre devis\\", \\"body\\": \\"<texte>\\"}')}\\n\\n3. Après l'accord explicite de la personne, envoie chaque brouillon ; rappelle avec confirm: true :\\n\\n${callFence('mail.send_draft {\\"id\\": \\"<id du brouillon>\\"}')}"}]}`,
      "Add a step at the end of « Étapes »:",
      `${p}_write {"path": "ventes/relance_devis", "base_revision": 3, "ops": [{"op": "append", "section": "Étapes", "text": "4. Relis le suivi des prospects :\\n\\n${callFence('table.rows {\\"table\\": \\"ventes/suivi_prospects\\"}')}"}]}`,
      "Add a call block after a given block, by its reference:",
      `${p}_read {"path": "ventes/relance_devis", "section": "Étapes", "refs": true}`,
      `${p}_write {"path": "ventes/relance_devis", "base_revision": 3, "ops": [{"op": "insert_after", "block": "3f9a2c1b", "text": "${callFence('mail.create_draft {\\"to\\": \\"<email du contact>\\", \\"subject\\": \\"Relance\\", \\"body\\": \\"<texte>\\"}')}"}]}`,
    ],
    refusals: [
      "On write: a call fence that is not <function> followed by a JSON object, or that is never closed; nothing is written.",
      "On publish: a code block marked call, or a text line starting with a call fence; write a call block.",
      "On publish: a call fence never stands in a table, a toggle or a sub-item; write a call block after it.",
      "On publish: a call block that does not start with a function name such as table.rows.",
      `On publish: an unknown function; ${p}_find with type function lists the functions.`,
      "On publish: a function whose connector is not enabled for the organisation; an administrator enables it on the dashboard.",
      "On publish: confirm, team, account, ctx, function or arguments written as an argument.",
      "On publish: an unknown argument; the refusal lists the function's arguments.",
      `On publish: a missing argument; write "<…>" for a value known only when the procedure runs.`,
      "On publish: a literal value that the function's schema refuses.",
      "On publish: a check of the function itself, e.g. a state that table.release does not accept.",
    ],
  }),
}

/** Le JSON Schema du `header` d'un tableau, rendu comme les arguments d'une fonction (`describeFunction`). */
function headerSchema(): string {
  const schema: Record<string, unknown> = z.toJSONSchema(tableHeaderPatchSchema)
  delete schema.$schema
  return JSON.stringify(schema)
}

/** `write.table` (E07-S04, AC13, H62) : l'en-tête d'un tableau, écrit par deltas nommés, publié après ses contrôles. */
const writeTable: Contract = {
  name: "write.table",
  content: (p) => ({
    summary: `the header of ${p}_write for a table (not a function; nothing to call).`,
    description: [
      `A table is a node of kind table: its header declares the typed columns, the key column whose value addresses each row, the work queue of the rows (lifecycle), whether new rows can be created (closed) and whether each new value needs its proof (proof). Create it with ${p}_write, kind "table", a title, a summary and header; change it with ${p}_write, base_revision and header. Its rows are written with ${p}_call table.write, never with ${p}_write.`,
      "header holds changes, never the whole header: what it does not name stays as it is. The draft keeps the complete target header, checked at every write; publishing (the default) applies it after checking the rows already there.",
      // E10-S01 (AC-c2) : un fichier donné par la personne, ce qu'il devient.
      "A CSV or a spreadsheet the user gives you becomes a table: use table.import, in pieces of 40,000 characters, each starting with the header line.",
      // E11-S18 (AC-9, AC-11, AC-12) : l'opération qui l'écrit, le frontmatter, plusieurs fichiers.
      `A markdown file the user gives you becomes a page with write: its first # heading is the title, the rest goes in ops [{"op": "set_markdown", "text": "<the rest>"}]; a YAML front matter (--- … ---) is not content: take title and summary from it. Several files: ${p}_call node.write_many, 50 pages per call, parents first.`,
      // E10-S02 (lot f, AC-f2) : un fichier que l'assistant a déjà, déposé par lien.
      `Use ${p}_call upload.link ${UPLOAD_RULE}.`,
    ],
    parts: [
      { title: "Header (JSON Schema):", lines: [headerSchema()] },
      {
        title: "Rules:",
        lines: [
          "1. columns are merged by name: an existing column receives the attributes given (type, options, required, allow_verified_empty, max_length) and keeps the others; a new column needs its type and is added at the end; the order of the existing columns never changes.",
          "2. remove_columns names the columns to remove; the key column cannot be removed, and a name cannot be both in columns and remove_columns.",
          "3. key, lifecycle, closed and proof replace their value; lifecycle is replaced whole, and the options of its state column change in the same header as its states.",
          `4. Columns cannot be renamed: add the new column, copy the values with ${p}_call table.write, then remove the old one.`,
          "5. The type of a column changes only while it holds no value; otherwise add a new column of the new type, copy the values, then remove the old one. A new type drops the attributes it does not take (options, max_length) unless they are given again.",
          "6. The key changes only while the table has no row; otherwise create a new table keyed by the new column and copy the rows.",
          "7. A header change never rewrites a row: making a column required, removing an option or shortening max_length only warns, with the number of rows concerned and sample keys.",
          '8. Removing a column that holds values takes two steps: publishing answers needs_confirmation with the rows it would erase, and nothing is written; ask the user, and only after their explicit agreement call again with the same header plus "confirm_remove": true. confirm_remove only applies when the write publishes and is never saved; 2,000 rows at most are erased per publication.',
          "9. Header changes that check the rows work on tables of 5,000 rows at most.",
          `10. A header refused on publish is not written. A header saved with publish: false stays in the draft, and every later header write starts from it; to go back to the published header, discard the draft: ${p}_call node.discard_draft {"path": "<path>"}.`,
        ],
      },
    ],
    examples: [
      "Create a table:",
      `${p}_write {"path": "ventes/salons", "kind": "table", "title": "Salons professionnels", "summary": "Les salons où l'équipe Ventes expose ou prospecte.", "header": {"columns": [{"name": "nom", "type": "text", "required": true, "max_length": 200}, {"name": "ville", "type": "text"}, {"name": "date", "type": "date"}, {"name": "statut", "type": "enum", "options": ["à contacter", "en cours", "à revoir", "inscrit", "écarté"]}], "key": "nom", "lifecycle": {"column": "statut", "states": ["à contacter", "en cours", "à revoir", "inscrit", "écarté"], "working": "en cours", "review": {"state": "à revoir", "approve": "inscrit", "reject": "écarté"}}}}`,
      "Add a column:",
      `${p}_write {"path": "ventes/suivi_prospects", "base_revision": 3, "header": {"columns": [{"name": "secteur", "type": "text"}]}}`,
      "Remove a column in two steps (the second call only after the user agreed to erase its values):",
      `${p}_write {"path": "ventes/suivi_prospects", "base_revision": 3, "header": {"remove_columns": ["notes"]}}`,
      `${p}_write {"path": "ventes/suivi_prospects", "base_revision": 3, "header": {"remove_columns": ["notes"], "confirm_remove": true}}`,
    ],
    refusals: [
      "On create: no header, a new column without type, an unknown key or type, or a header the checks refuse (key missing or of type enum, states different from the options…); the refusal lists the problems found and nothing is written.",
      "A column with rename, new_name, renamed_to or old_name: columns cannot be renamed.",
      "On write: remove_columns naming an unknown column or the key, a name both in columns and remove_columns, a column named twice in columns, confirm_remove with publish: false, an unknown key; nothing is written.",
      "On publish: a type change on a column that holds values (conflict); nothing is written.",
      "On publish: removing a column that holds values without confirm_remove (needs_confirmation, with the rows it would erase and the call to make again); nothing is written.",
      "On publish: more than 2,000 rows to erase, or changes that check the rows of a table of more than 5,000 rows (too_large); nothing is written.",
      "On publish: a key change on a table that has rows (conflict); nothing is written.",
    ],
  }),
}

const CONTRACTS: readonly Contract[] = [writeProcedure, writeTable]

/** Le contrat de ce nom (`write.procedure`), ou `null` : `read` le cherche hors du catalogue (AC8). */
export function getContract(name: string): Contract | null {
  const wanted = name.trim()
  return CONTRACTS.find((contract) => contract.name === wanted) ?? null
}

/** Les noms des contrats : leur espace (`write`) est fermé aux fonctions de l'ERP (E08-S05, AC3). */
export function contractNames(): string[] {
  return CONTRACTS.map((contract) => contract.name)
}

/** Le texte d'un contrat, dans la disposition de `describeFunction` ; données en champs : son nom. */
export function renderContract(contract: Contract, prefix: string): { text: string; data: Record<string, unknown> } {
  const { summary, description, parts, examples, refusals } = contract.content(prefix)
  const text = [
    `Contract ${contract.name}: ${summary}`,
    ...description,
    ...parts.flatMap((part) => [part.title, ...part.lines]),
    "Examples:",
    ...examples,
    "Possible refusals:",
    ...refusals.map((refusal) => `- ${refusal}`),
  ].join("\n")
  return { text, data: { contract: contract.name } }
}
