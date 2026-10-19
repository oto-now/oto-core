// La porte (`pseudonymisation.md` § La porte) : une fonction pure du dictionnaire, qui remplace dans un texte, ou dans
// chaque chaîne d'une valeur JSON à toute profondeur, chaque mention d'une personne déclarée par son jeton. Les clés
// d'objet ne sont pas touchées ; rien n'est cherché dans un jeton déjà posé. Un téléphone se reconnaît en chiffres, quel
// que soit son format. Un courriel ou un téléphone qu'aucune personne déclarée ne porte devient un jeton de valeur.
import { detectedValues } from "./detectors"
import type { Dictionary } from "./dictionary"
import { findMentions } from "./mentions"
import { normalized } from "./normalize"
import { phoneDigits } from "./forms"
import { tokenMatches } from "./token"

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

/** Les courriels et téléphones trouvés par forme : le jeton de l'entité qui les porte, sinon leur jeton de valeur. */
function detectedCuts(dictionary: Dictionary, text: string): Cut[] {
  return detectedValues(text).map(({ start, end, detector, value }) => {
    const target = detector === "phone" ? dictionary.phones.get(value) : dictionary.table.forms.get(value)?.target
    return { start, end, token: target === undefined ? dictionary.valueToken(detector, value) : dictionary.tokens[target] }
  })
}

/** Les coupes d'un morceau de texte sans jeton, décalées de `offset`, de gauche à droite, sans chevauchement. */
function segmentCuts(dictionary: Dictionary, text: string, offset: number): Cut[] {
  if (text === "") return []
  const norm = normalized(text)
  const cuts: Cut[] = findMentions(dictionary.table, norm.text).map((mention) => ({
    start: norm.starts[mention.start],
    end: norm.ends[mention.end - 1],
    token: dictionary.tokens[mention.target],
  }))
  // À même place, la mention d'une personne déclarée passe avant la valeur détectée (le tri est stable).
  const all = [...cuts, ...phoneCuts(dictionary, text), ...detectedCuts(dictionary, text)].sort((a, b) => a.start - b.start || b.end - a.end)
  const kept: Cut[] = []
  let at = 0
  for (const cut of all) {
    if (cut.start < at) continue
    kept.push({ start: cut.start + offset, end: cut.end + offset, token: cut.token })
    at = cut.end
  }
  return kept
}

/**
 * Les coupes de `text` : chaque mention d'une personne déclarée et son jeton ; rien dans un jeton déjà posé, que le
 * dictionnaire connaît. Une suite qui en a seulement la forme (l'ancre d'une adresse, `fiche#camille_dupre`) se masque
 * comme tout texte : sans enveloppe fermante, la forme seule ne prouve pas le jeton.
 */
function textCuts(dictionary: Dictionary, text: string): Cut[] {
  const cuts: Cut[] = []
  let at = 0
  for (const match of tokenMatches(text, (found) => dictionary.byToken.has(found))) {
    cuts.push(...segmentCuts(dictionary, text.slice(at, match.index), at))
    at = match.index + match[0].length
  }
  cuts.push(...segmentCuts(dictionary, text.slice(at), at))
  return cuts
}

/** `text`, chaque mention d'une personne déclarée remplacée par son jeton ; les jetons déjà posés gardés tels quels. */
export function pseudonymizedText(dictionary: Dictionary, text: string): string {
  let out = ""
  let at = 0
  for (const cut of textCuts(dictionary, text)) {
    out += text.slice(at, cut.start) + cut.token
    at = cut.end
  }
  return out + text.slice(at)
}

/**
 * Un texte pseudonymisé et le chemin retour vers le texte en clair : `clearAt(i)`, la place en clair de la place `i` du
 * texte pseudonymisé ; `null` strictement dans un jeton posé, où le bord d'une coupe ne peut pas tomber.
 */
export type Places = { text: string; clearAt(index: number): number | null }

/** `text` pseudonymisé, avec sa table de places : un texte trouvé dans l'espace pseudonymisé se coupe dans le clair. */
export function pseudonymizedPlaces(dictionary: Dictionary, text: string): Places {
  const marks: { at: number; end: number; clearStart: number; clearEnd: number }[] = []
  let out = ""
  let from = 0
  for (const cut of textCuts(dictionary, text)) {
    out += text.slice(from, cut.start)
    marks.push({ at: out.length, end: out.length + cut.token.length, clearStart: cut.start, clearEnd: cut.end })
    out += cut.token
    from = cut.end
  }
  out += text.slice(from)
  const clearAt = (index: number): number | null => {
    // La dernière coupe qui commence à `index` ou avant, par dichotomie.
    let low = 0
    let high = marks.length - 1
    let found = -1
    while (low <= high) {
      const middle = (low + high) >> 1
      if (marks[middle].at <= index) {
        found = middle
        low = middle + 1
      } else high = middle - 1
    }
    if (found === -1) return index
    const mark = marks[found]
    if (index === mark.at) return mark.clearStart
    if (index < mark.end) return null
    return mark.clearEnd + (index - mark.end)
  }
  return { text: out, clearAt }
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
