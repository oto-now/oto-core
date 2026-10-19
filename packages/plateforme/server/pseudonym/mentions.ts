// La recherche des mentions dans un texte normalisé (`pseudonymisation.md` § Le dictionnaire et la détection) : mots
// entiers seulement, la plus longue mention l'emporte, de gauche à droite, en un passage. Une mention commence au début
// d'une suite de lettres ou de chiffres et finit à la fin d'une autre, au plus `maxRuns` suites plus loin ; chaque
// candidat se cherche dans une table des formes. Une table plutôt qu'un automate : les formes sont bornées par des mots,
// le nombre de candidats par mot est celui des mots de la plus longue forme, et la mémoire est celle des formes seules.

/** Ce qu'une forme désigne : un indice dans la liste des cibles du dictionnaire, et sa règle de bord. */
export type FormTarget = { target: number; boundary: "word" | "email" }

/** Une mention trouvée, en places du texte normalisé : `[start, end)`. */
export type Mention = { start: number; end: number; target: number }

const ALNUM = /[\p{L}\p{N}]/u
/** Ce qui prolonge la partie locale d'un courriel : une mention de courriel n'en coupe pas le milieu. */
const EMAIL_PREFIX = /[._%+-]/u
/** Au-delà, une forme n'est pas gardée : une adresse ou une raison sociale plus longue se reconnaît par ses parties. */
export const MAX_FORM_RUNS = 12

/** Les suites de lettres ou de chiffres d'un texte : début et fin de chacune. */
function runs(text: string): { starts: number[]; ends: number[] } {
  const starts: number[] = []
  const ends: number[] = []
  let inside = false
  for (let index = 0; index < text.length; index++) {
    const alnum = ALNUM.test(text[index])
    if (alnum && !inside) starts.push(index)
    if (!alnum && inside) ends.push(index)
    inside = alnum
  }
  if (inside) ends.push(text.length)
  return { starts, ends }
}

/** Une forme rognée de ce qui n'est ni lettre ni chiffre à ses bords (`acme s.a.` → `acme s.a`), ou `null`. */
export function trimmedForm(form: string): string | null {
  const { starts, ends } = runs(form)
  if (starts.length === 0 || starts.length > MAX_FORM_RUNS) return null
  return form.slice(starts[0], ends[ends.length - 1])
}

/** Le nombre de suites d'une forme rognée. */
export function formRuns(form: string): number {
  return runs(form).starts.length
}

/**
 * Les civilités qu'un nom suit (`mme dupre`, `me. dupre`), normalisées : un nom après l'une d'elles est une mention, sans
 * que chaque couple civilité et nom soit une forme de la table (onze civilités, avec et sans point, par personne).
 */
export const CIVILITIES: ReadonlySet<string> = new Set(["m", "mme", "mlle", "monsieur", "madame", "mademoiselle", "me", "maitre", "dr", "docteur", "pr"])

/**
 * La table des formes d'un dictionnaire et le nombre de suites de la plus longue ; `titled` : les noms reconnus après une
 * civilité, et le nombre de suites du plus long.
 */
export type FormTable = { forms: ReadonlyMap<string, FormTarget>; maxRuns: number; titled: ReadonlyMap<string, FormTarget>; titledRuns: number }

/** Vrai si la mention de `[start, end)` respecte la règle de bord de sa forme. */
function bounded(text: string, start: number, end: number, boundary: FormTarget["boundary"]): boolean {
  const before = start > 0 ? text[start - 1] : ""
  const after = end < text.length ? text[end] : ""
  if (boundary === "email") return !EMAIL_PREFIX.test(before) && after !== "@"
  // Un nom ne se coupe pas dans un nom composé (« Marie-Camille »).
  return before !== "-" && after !== "-"
}

/** Un texte normalisé et ses suites de lettres ou de chiffres. */
type Scan = { text: string; starts: number[]; ends: number[] }
/** Une table où chercher, et le nombre de suites de sa plus longue entrée. */
type Lookup = { forms: ReadonlyMap<string, FormTarget>; maxRuns: number }

/** La plus longue entrée de `lookup` qui commence à la suite `first` ; la mention commence à `start` (sa civilité). */
function longestAt(scan: Scan, lookup: Lookup, start: number, first: number): Mention | null {
  const last = Math.min(scan.ends.length - 1, first + lookup.maxRuns - 1)
  for (let run = last; run >= first; run--) {
    const end = scan.ends[run]
    const hit = lookup.forms.get(scan.text.slice(scan.starts[first], end))
    if (hit && bounded(scan.text, scan.starts[first], end, hit.boundary)) return { start, end, target: hit.target }
  }
  return null
}

/** Une civilité à la suite `first`, puis une espace (après un point peut-être), puis un nom de `titled`. */
function titledAt(scan: Scan, table: FormTable, first: number): Mention | null {
  const { text, starts, ends } = scan
  const start = starts[first]
  if (table.titled.size === 0 || first + 1 >= starts.length || !CIVILITIES.has(text.slice(start, ends[first]))) return null
  const gap = text.slice(ends[first], starts[first + 1])
  if ((gap !== " " && gap !== ". ") || (start > 0 && text[start - 1] === "-")) return null
  return longestAt(scan, { forms: table.titled, maxRuns: table.titledRuns }, start, first + 1)
}

/**
 * Les mentions de `text` (déjà normalisé, sans jeton : la porte le coupe autour des jetons déjà posés), de gauche à
 * droite, la plus longue d'abord, sans chevauchement.
 */
export function findMentions(table: FormTable, text: string): Mention[] {
  const scan: Scan = { text, ...runs(text) }
  const found: Mention[] = []
  let from = 0
  for (let first = 0; first < scan.starts.length; first++) {
    const start = scan.starts[first]
    if (start < from) continue
    const plain = longestAt(scan, table, start, first)
    const titled = titledAt(scan, table, first)
    const mention = titled && (!plain || titled.end > plain.end) ? titled : plain
    if (!mention) continue
    found.push(mention)
    from = mention.end
  }
  return found
}
