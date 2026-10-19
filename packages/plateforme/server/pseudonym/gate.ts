// La porte (`pseudonymisation.md` § La porte) : une fonction pure du dictionnaire, qui remplace dans un texte, ou dans
// chaque chaîne d'une valeur JSON à toute profondeur, chaque mention d'une personne déclarée par son jeton. Les clés
// d'objet ne sont pas touchées ; rien n'est cherché dans un jeton déjà posé. Un téléphone se reconnaît en chiffres, quel
// que soit son format.
import type { Dictionary } from "./dictionary"
import { findMentions } from "./mentions"
import { normalized } from "./normalize"
import { phoneDigits } from "./forms"
import { TOKEN_PATTERN } from "./token"

/** Une suite qui ressemble à un numéro de téléphone : 8 à 15 chiffres, séparés au plus d'un blanc, point, tiret ou parenthèse. */
const PHONE_LIKE = /(?<![\d+])(?:\+|00)?\d(?:[\s.()-]{0,2}\d){7,14}(?!\d)/gu

type Cut = { start: number; end: number; token: string }

function phoneCuts(dictionary: Dictionary, text: string): Cut[] {
  if (dictionary.phones.size === 0) return []
  const cuts: Cut[] = []
  for (const match of text.matchAll(PHONE_LIKE)) {
    const digits = phoneDigits(match[0])
    const target = digits === null ? undefined : dictionary.phones.get(digits)
    if (target !== undefined) cuts.push({ start: match.index, end: match.index + match[0].length, token: dictionary.tokens[target] })
  }
  return cuts
}

/** Un morceau de texte sans jeton, ses mentions remplacées. */
function segment(dictionary: Dictionary, text: string): string {
  if (text === "") return text
  const norm = normalized(text)
  const cuts: Cut[] = findMentions(dictionary.table, norm.text).map((mention) => ({
    start: norm.starts[mention.start],
    end: norm.ends[mention.end - 1],
    token: dictionary.tokens[mention.target],
  }))
  const all = [...cuts, ...phoneCuts(dictionary, text)].sort((a, b) => a.start - b.start || b.end - a.end)
  if (all.length === 0) return text
  let out = ""
  let at = 0
  for (const cut of all) {
    if (cut.start < at) continue
    out += text.slice(at, cut.start) + cut.token
    at = cut.end
  }
  return out + text.slice(at)
}

/** `text`, chaque mention d'une personne déclarée remplacée par son jeton ; les jetons déjà posés gardés tels quels. */
export function pseudonymizedText(dictionary: Dictionary, text: string): string {
  let out = ""
  let at = 0
  for (const match of text.matchAll(TOKEN_PATTERN)) {
    out += segment(dictionary, text.slice(at, match.index)) + match[0]
    at = match.index + match[0].length
  }
  return out + segment(dictionary, text.slice(at))
}

/** Une valeur JSON, chaque chaîne pseudonymisée à toute profondeur, clés d'objet comprises telles quelles. */
export function pseudonymizedJson<T>(dictionary: Dictionary, value: T): T {
  if (typeof value === "string") return pseudonymizedText(dictionary, value) as T
  if (Array.isArray(value)) return value.map((item) => pseudonymizedJson(dictionary, item)) as T
  if (value === null || typeof value !== "object") return value
  // Une date, un tampon : ni texte ni objet JSON, gardés tels quels.
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, pseudonymizedJson(dictionary, item)])) as T
}
