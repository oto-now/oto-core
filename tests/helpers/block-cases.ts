// Cas de forme des blocs (E01-S06, AC6, AC7, AC36), partagés par le test unitaire des schémas et
// par le test de parité avec la base : au moins un cas valide et deux invalides par type. Un cas
// invalide est refusé par `blockInputSchema` et par la base (`23514`) ; un cas valide passe les deux.
// Les clés des cas valides sont distinctes : ils s'insèrent tous dans le même brouillon.

export type BlockCase = { name: string; valid: boolean; block: Record<string, unknown> }

const long = (length: number, char = "a") => char.repeat(length)

const valid = (name: string, block: Record<string, unknown>): BlockCase => ({ name, valid: true, block })
const invalid = (name: string, block: Record<string, unknown>): BlockCase => ({ name, valid: false, block })

/** Blocs de document (page, procédure, Contexte) : écrits dans un brouillon. */
export const DOCUMENT_CASES: BlockCase[] = [
  valid("a heading of level 2", { type: "heading", text: "Étapes", data: { level: 2 } }),
  valid("a heading with a key", { type: "heading", text: "Règles", data: { level: 1 }, key: "regles" }),
  // E10-S04 (AC-b3) : cinq niveaux.
  valid("a heading of level 5", { type: "heading", text: "Détail", data: { level: 5 } }),
  valid("a collapsible heading", { type: "heading", text: "Annexes", data: { level: 2, collapsible: true } }),
  invalid("a heading of level 6", { type: "heading", text: "Titre", data: { level: 6 } }),
  invalid("a heading without text", { type: "heading", data: { level: 1 } }),
  invalid("a heading on two lines", { type: "heading", text: "Titre\nsuite", data: { level: 1 } }),
  invalid("a blank heading", { type: "heading", text: "   ", data: { level: 1 } }),
  invalid("a heading of 201 characters", { type: "heading", text: long(201), data: { level: 1 } }),
  // N40 : `char_length` compte une paire de substitution pour un caractère.
  valid("a heading of 200 characters outside the basic plane", { type: "heading", text: long(200, "\u{1F600}"), data: { level: 1 } }),
  invalid("a heading of 201 characters outside the basic plane", { type: "heading", text: long(201, "\u{1F600}"), data: { level: 1 } }),

  valid("a paragraph with a link", { type: "paragraph", text: "Voir [[ventes/devis]]." }),
  valid("an empty paragraph", { type: "paragraph", text: "" }),
  valid("a paragraph with free data", { type: "paragraph", text: "Texte.", data: { note: 1 } }),
  invalid("a paragraph without text", { type: "paragraph" }),
  invalid("a paragraph with a null text", { type: "paragraph", text: null }),
  invalid("a paragraph of 100 001 characters", { type: "paragraph", text: long(100_001) }),
  invalid("a paragraph whose data is an array", { type: "paragraph", text: "Texte.", data: [] }),

  valid("an ordered list from 3", { type: "list", data: { items: ["Réserve", "Écris"], ordered: true, start: 3 } }),
  valid("a list starting at 1.5", { type: "list", data: { items: ["a"], start: 1.5 } }),
  invalid("a list with a text", { type: "list", text: "a", data: { items: ["a"] } }),
  invalid("a list without items", { type: "list", data: {} }),
  invalid("a list with no item", { type: "list", data: { items: [] } }),
  invalid("a list with a number item", { type: "list", data: { items: ["a", 1] } }),
  invalid("a list starting at 0", { type: "list", data: { items: ["a"], start: 0 } }),
  invalid("a list whose ordered is a string", { type: "list", data: { items: ["a"], ordered: "yes" } }),
  invalid("a list whose ordered is null", { type: "list", data: { items: ["a"], ordered: null } }),
  // E10-S04 (AC-b1) : un élément est une chaîne ou `{text, children}`, trois niveaux, 500 éléments en tout.
  valid("a list nested on three levels", {
    type: "list",
    data: { items: ["a", { text: "b", children: { items: ["c", { text: "d", children: { items: ["e"], ordered: true, start: 3 } }] } }] },
  }),
  invalid("a list nested on four levels", {
    type: "list",
    data: { items: [{ text: "a", children: { items: [{ text: "b", children: { items: [{ text: "c", children: { items: ["d"] } }] } }] } }] },
  }),
  invalid("a list item with an unknown key", { type: "list", data: { items: [{ text: "a", children: { items: ["b"] }, note: 1 }] } }),
  invalid("a sub-list with an unknown key", { type: "list", data: { items: [{ text: "a", children: { items: ["b"], note: 1 } }] } }),
  invalid("a list item without children", { type: "list", data: { items: [{ text: "a" }] } }),
  invalid("a sub-list without item", { type: "list", data: { items: [{ text: "a", children: { items: [] } }] } }),
  invalid("a sub-list starting at 0", { type: "list", data: { items: [{ text: "a", children: { items: ["b"], start: 0 } }] } }),
  invalid("a list item that is an array", { type: "list", data: { items: [["a"]] } }),
  invalid("a list of 501 items, sub-items included", { type: "list", data: { items: [{ text: "a", children: { items: Array.from({ length: 500 }, () => "b") } }] } }),

  valid("a checklist", { type: "checklist", data: { items: [{ text: "Vérifier", checked: false }] } }),
  invalid("a checklist item without checked", { type: "checklist", data: { items: [{ text: "Vérifier" }] } }),
  invalid("a checklist item checked by a string", { type: "checklist", data: { items: [{ text: "a", checked: "no" }] } }),
  invalid("a checklist item that is a string", { type: "checklist", data: { items: ["a"] } }),

  valid("a code block with a language", { type: "code", text: "x = 1", data: { language: "python" } }),
  valid("a code block without data", { type: "code", text: "select 1" }),
  invalid("a code block without text", { type: "code", data: { language: "sql" } }),
  invalid("a code block whose language is a number", { type: "code", text: "x", data: { language: 3 } }),

  valid("a call", { type: "call", data: { function: "table.claim", args: { table: "ventes/suivi", limit: 3 } } }),
  invalid("a call with a text", { type: "call", text: "x", data: { function: "f", args: {} } }),
  invalid("a call without function", { type: "call", data: { args: {} } }),
  invalid("a call with an empty function", { type: "call", data: { function: "", args: {} } }),
  invalid("a call with a function of 101 characters", { type: "call", data: { function: long(101), args: {} } }),
  invalid("a call whose args is an array", { type: "call", data: { function: "f", args: [] } }),
  invalid("a call without args", { type: "call", data: { function: "f" } }),

  valid("a mermaid block", { type: "mermaid", text: "graph TD; A-->B" }),
  invalid("a blank mermaid block", { type: "mermaid", text: "   " }),
  invalid("a mermaid block without text", { type: "mermaid" }),

  valid("an image with a caption", { type: "image", text: "Légende", data: { src: "https://x.test/a.png", alt: "Plan" } }),
  valid("an image without caption", { type: "image", data: { src: "a.png" } }),
  invalid("an image without src", { type: "image", data: { alt: "Plan" } }),
  invalid("an image with an empty src", { type: "image", data: { src: "" } }),
  invalid("an image whose alt is a number", { type: "image", data: { src: "a.png", alt: 1 } }),
  // E10-S02 (lot b) : une image jointe par son fichier, jamais avec une adresse ; sa largeur (AC-b1, AC-b3).
  valid("an image joined by its file, small", { type: "image", data: { file_id: "f1000000-0000-4000-8000-000000000001", alt: "Plan", width: "small" } }),
  invalid("an image with a source and a file", { type: "image", data: { src: "https://x.test/a.png", file_id: "f1000000-0000-4000-8000-000000000001" } }),
  invalid("an image whose file is not a lowercase uuid", { type: "image", data: { file_id: "F1000000-0000-4000-8000-000000000001" } }),
  invalid("an image of an unknown width", { type: "image", data: { src: "a.png", width: "huge" } }),

  valid("a callout with a tone", { type: "callout", text: "Attention.", data: { tone: "warning" } }),
  valid("a callout without data", { type: "callout", text: "Note." }),
  invalid("a callout without text", { type: "callout", data: { tone: "warning" } }),
  invalid("a callout whose tone is a number", { type: "callout", text: "x", data: { tone: 1 } }),

  valid("a reference to a table view", { type: "reference", data: { path: "ventes/suivi_prospects", view: { limit: 5 } } }),
  valid("a reference to a page", { type: "reference", data: { path: "ventes/devis" } }),
  invalid("a reference to a malformed path", { type: "reference", data: { path: "Ventes/Suivi" } }),
  invalid("a reference with a text", { type: "reference", text: "x", data: { path: "ventes/devis" } }),
  invalid("a reference without path", { type: "reference", data: { view: {} } }),
  invalid("a reference whose view is an array", { type: "reference", data: { path: "ventes/devis", view: [] } }),

  // E10-S04 (AC-a1 à AC-a3) : tableau simple, séparateur, repli.
  valid("a simple table", { type: "simple_table", data: { columns: ["Nom", "a \\| b"], rows: [["x", ""], ["a<br>b", "y\\\\\\|"]], align: [null, "right"] } }),
  valid("a simple table without rows", { type: "simple_table", data: { columns: ["Nom"], rows: [] } }),
  invalid("a simple table with a text", { type: "simple_table", text: "x", data: { columns: ["a"], rows: [] } }),
  invalid("a simple table without column", { type: "simple_table", data: { columns: [], rows: [] } }),
  invalid("a simple table of 21 columns", { type: "simple_table", data: { columns: Array.from({ length: 21 }, () => "c"), rows: [] } }),
  invalid("a simple table of 201 rows", { type: "simple_table", data: { columns: ["c"], rows: Array.from({ length: 201 }, () => ["x"]) } }),
  invalid("a simple table row one cell short", { type: "simple_table", data: { columns: ["a", "b"], rows: [["x"]] } }),
  invalid("a simple table row that is not an array", { type: "simple_table", data: { columns: ["a"], rows: ["x"] } }),
  invalid("a simple table cell with an unescaped bar", { type: "simple_table", data: { columns: ["a\\\\|b"], rows: [] } }),
  invalid("a simple table cell on two lines", { type: "simple_table", data: { columns: ["a"], rows: [["x\ny"]] } }),
  invalid("a simple table cell with a trailing space", { type: "simple_table", data: { columns: ["a "], rows: [] } }),
  invalid("a simple table cell that is a number", { type: "simple_table", data: { columns: ["a"], rows: [[1]] } }),
  invalid("a simple table with an unknown alignment", { type: "simple_table", data: { columns: ["a"], rows: [], align: ["middle"] } }),
  invalid("a simple table with one alignment too many", { type: "simple_table", data: { columns: ["a"], rows: [], align: [null, null] } }),

  valid("a divider", { type: "divider", data: {} }),
  invalid("a divider with a text", { type: "divider", text: "---", data: {} }),
  invalid("a divider whose data is an array", { type: "divider", data: [] }),

  // E10-S02 (lot b) : un fichier joint, de 1 octet à 50 Mo (AC-b2).
  valid("a joined file", { type: "file", data: { file_id: "f2000000-0000-4000-8000-000000000002", name: "Rapport mars.pdf", size: 1200, mime: "application/pdf" } }),
  invalid("a joined file with a text", { type: "file", text: "x", data: { file_id: "f2000000-0000-4000-8000-000000000002", name: "a.pdf", size: 1, mime: "application/pdf" } }),
  invalid("a joined file of no byte", { type: "file", data: { file_id: "f2000000-0000-4000-8000-000000000002", name: "a.pdf", size: 0, mime: "application/pdf" } }),
  invalid("a joined file over 50 MB", { type: "file", data: { file_id: "f2000000-0000-4000-8000-000000000002", name: "a.pdf", size: 52_428_801, mime: "application/pdf" } }),
  invalid("a joined file without name", { type: "file", data: { file_id: "f2000000-0000-4000-8000-000000000002", size: 12, mime: "application/pdf" } }),

  // 1.4.3 : un cadre intégré, une adresse https sans blanc ni guillemet, sa hauteur facultative.
  valid("an embed", { type: "embed", data: { url: "https://www.youtube.com/embed/abc" } }),
  valid("an embed of large height", { type: "embed", data: { url: "https://www.figma.com/embed?node=1", height: "large" } }),
  invalid("an embed in http", { type: "embed", data: { url: "http://exemple.test/a" } }),
  invalid("an embed with a space", { type: "embed", data: { url: "https://exemple.test/a b" } }),
  invalid("an embed with a quote", { type: "embed", data: { url: 'https://exemple.test/"a' } }),
  invalid("an embed of an unknown height", { type: "embed", data: { url: "https://exemple.test/a", height: "huge" } }),
  invalid("an embed with a text", { type: "embed", text: "x", data: { url: "https://exemple.test/a" } }),
  invalid("an embed without address", { type: "embed", data: {} }),

  valid("a toggle", { type: "toggle", text: "Corps [[ventes/devis]].\n\n```\n<b>\n```", data: { summary: "Détails" } }),
  valid("an empty toggle", { type: "toggle", text: "", data: { summary: "Rien" } }),
  invalid("a toggle without text", { type: "toggle", data: { summary: "a" } }),
  invalid("a toggle without summary", { type: "toggle", text: "x", data: {} }),
  invalid("a toggle with a blank summary", { type: "toggle", text: "x", data: { summary: "  " } }),
  invalid("a toggle summary of 201 characters", { type: "toggle", text: "x", data: { summary: long(201) } }),
  invalid("a toggle summary on two lines", { type: "toggle", text: "x", data: { summary: "a\nb" } }),
  invalid("a toggle body starting with a blank line", { type: "toggle", text: "  \nx", data: { summary: "a" } }),
  invalid("a toggle body ending with a blank line", { type: "toggle", text: "x\n", data: { summary: "a" } }),
  invalid("a toggle holding a toggle", { type: "toggle", text: "x\n  <details>\ny", data: { summary: "a" } }),
  invalid("a toggle holding its closing line", { type: "toggle", text: "x\n</details> \ny", data: { summary: "a" } }),

  valid("a block with a key", { type: "paragraph", text: "Clé.", key: "etapes" }),
  invalid("a key with a leading space", { type: "paragraph", text: "x", key: " x" }),
  invalid("a key with a trailing space", { type: "paragraph", text: "x", key: "x " }),
  invalid("an empty key", { type: "paragraph", text: "x", key: "" }),
  invalid("a key of 501 characters", { type: "paragraph", text: "x", key: long(501, "k") }),
  invalid("a key with a control character", { type: "paragraph", text: "x", key: "a\tb" }),
  // N40 : `btrim` ne retire que l'espace U+0020 ; `[[:cntrl:]]` couvre les caractères Cc (U+0000 à
  // U+001F, U+007F à U+009F), U+0085 compris, U+00A0 non.
  valid("a key starting with a no-break space", { type: "paragraph", text: "x", key: " nbsp" }),
  invalid("a key with the control character U+0085", { type: "paragraph", text: "x", key: "a\u0085b" }),
]

/** Lignes de tableau : écrites publiées dans un tableau. */
export const ROW_CASES: BlockCase[] = [
  valid("a row with its values", { type: "row", key: "P-001", data: { ref: "P-001", entreprise: "Boulangerie des Tilleuls", montant: 12000 } }),
  valid("a row without values", { type: "row", key: "P-002" }),
  invalid("a row without key", { type: "row", data: { ref: "P-003" } }),
  invalid("a row with a text", { type: "row", key: "P-004", text: "x" }),
  invalid("a row whose data is an array", { type: "row", key: "P-005", data: ["P-005"] }),
]

export const BLOCK_CASES: BlockCase[] = [...DOCUMENT_CASES, ...ROW_CASES]
