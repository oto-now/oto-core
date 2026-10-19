// La normalisation des textes comparés par la pseudonymisation (`pseudonymisation.md` § Le dictionnaire et la
// détection) : NFKD, diacritiques retirés, casse repliée, ligatures (`œ`, `æ`, `ß`), apostrophes et tirets unifiés,
// blancs resserrés. Chaque caractère normalisé garde sa place dans le texte d'origine : une mention trouvée dans le
// texte normalisé se coupe dans l'original. Sans ce module, « Hélène » et « HELENE » seraient deux personnes, et une
// coupe tomberait au mauvais endroit dès qu'un accent change la longueur du texte.

/** Les ligatures que NFKD ne décompose pas, et `ß`, que la casse repliée de JavaScript garde. */
const LIGATURES: Readonly<Record<string, string>> = { "œ": "oe", "æ": "ae", "ß": "ss", "ø": "o", "đ": "d", "ł": "l", "ı": "i" }
const APOSTROPHES = /['’‘ʼ`´]/u
const DASHES = /[‐‑‒–—―−]/u
const COMBINING = /\p{M}/u
const BLANK = /\s/u

/** Un texte normalisé : `text`, et pour chaque unité de `text`, sa place `[start, end)` dans le texte d'origine. */
export type Normalized = { text: string; starts: number[]; ends: number[] }

/** La forme normalisée d'un seul caractère d'origine (un point de code), peut-être vide (un accent seul). */
function normalizedChar(char: string): string {
  // L'ASCII, presque tout ce que lit la porte, sans NFKD : seule la casse change, et l'apostrophe inverse.
  if (char.charCodeAt(0) < 0x80) return char === "`" ? "'" : char.toLowerCase()
  if (APOSTROPHES.test(char)) return "'"
  if (DASHES.test(char)) return "-"
  let out = ""
  for (const part of char.normalize("NFKD").toLowerCase()) {
    if (COMBINING.test(part)) continue
    out += LIGATURES[part] ?? part
  }
  return out
}

/** Le texte normalisé et sa table de positions ; les blancs consécutifs deviennent une espace, sans blanc de bord. */
export function normalized(text: string): Normalized {
  const out: Normalized = { text: "", starts: [], ends: [] }
  let index = 0
  let pendingBlank: { start: number; end: number } | null = null
  for (const char of text) {
    const start = index
    index += char.length
    if (BLANK.test(char)) {
      pendingBlank = pendingBlank ? { start: pendingBlank.start, end: index } : { start, end: index }
      continue
    }
    const form = normalizedChar(char)
    if (form === "") {
      // Un signe combinant seul prolonge le caractère qui le précède.
      if (out.ends.length > 0) out.ends[out.ends.length - 1] = index
      continue
    }
    if (pendingBlank && out.text !== "") {
      out.text += " "
      out.starts.push(pendingBlank.start)
      out.ends.push(pendingBlank.end)
    }
    pendingBlank = null
    // Par unité UTF-16, comme les places que compare l'automate.
    out.text += form
    for (let unit = 0; unit < form.length; unit++) {
      out.starts.push(start)
      out.ends.push(index)
    }
  }
  return out
}

/** La seule forme normalisée d'un texte, sans table : celle des formes du dictionnaire. */
export function normalizedText(text: string): string {
  // Le même résultat que `normalized`, sans table, en un passage pour l'ASCII : les formes du dictionnaire en sont presque toutes.
  if (/^[\x00-\x7f]*$/u.test(text)) return text.toLowerCase().replaceAll("`", "'").replace(/\s+/gu, " ").trim()
  return normalized(text).text
}
