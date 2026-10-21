// Les dates d'un tableur (`lecture-des-fichiers.md` § Ce que rend chaque format) : un nombre dont le format de cellule
// est un format de date (intégré, ECMA-376 partie 1 § 18.8.30, ou personnalisé) se rend en ISO 8601, à la précision
// que le format montre : `2026-10-21`, `2026-10-21T14:30:00`, `14:30:00`. Un tableur range une date en jours depuis
// 1900 (avec le 29 février 1900 fictif de Lotus) ou depuis 1904 (`date1904`). Sans lui, une date se lirait `46316`.

/** Ce que montre un format de nombre : rien d'une date, une date, une date et une heure, une heure. */
export type DateKind = 0 | 1 | 2 | 3
export const NOT_DATE: DateKind = 0
const DATE: DateKind = 1
const DATE_TIME: DateKind = 2
const TIME: DateKind = 3

/** Les formats intégrés de date et d'heure, par identifiant (les identifiants 50 à 58 : formats d'Asie de l'Est). */
const BUILTIN: ReadonlyMap<number, DateKind> = new Map<number, DateKind>([
  ...[14, 15, 16, 17, 27, 28, 29, 30, 31, 34, 35, 36, 50, 51, 52, 53, 54, 55, 56, 57, 58].map((id) => [id, DATE] as const),
  ...[18, 19, 20, 21, 32, 33, 45, 46, 47].map((id) => [id, TIME] as const),
  [22, DATE_TIME],
])

/** La première section d'un format (avant un `;` hors guillemets), sans texte entre guillemets ni caractère échappé. */
function firstSection(code: string): string {
  let out = ""
  for (let at = 0; at < code.length; at++) {
    const char = code[at]
    if (char === '"') {
      const close = code.indexOf('"', at + 1)
      at = close < 0 ? code.length : close
    } else if (char === "\\" || char === "_" || char === "*") {
      at++
    } else if (char === ";") {
      break
    } else {
      out += char
    }
  }
  return out
}

/** Ce que montre un format personnalisé : ses jetons de date (`y`, `d`, `m` seul) et d'heure (`h`, `s`, `[h]`). */
export function customKind(code: string): DateKind {
  // Les crochets : une couleur, une condition ou une langue s'ôtent ; une durée (`[h]`, `[mm]`, `[ss]`) est une heure.
  const section = firstSection(code)
    .toLowerCase()
    .replace(/\[(h+|m+|s+)\]/gu, "h")
    .replace(/\[[^\]]*\]/gu, "")
  const date = /[yd]/u.test(section)
  const time = /[hs]/u.test(section)
  if (date && time) return DATE_TIME
  if (date) return DATE
  if (time) return TIME
  return /m/u.test(section) ? DATE : NOT_DATE
}

/** Ce que montre le format d'identifiant `id`, intégré ou personnalisé (`custom`, identifiant → code du format). */
export function formatKind(id: number, custom: ReadonlyMap<number, string>): DateKind {
  const code = custom.get(id)
  if (code !== undefined) return customKind(code)
  return BUILTIN.get(id) ?? NOT_DATE
}

const DAY_SECONDS = 86_400
const two = (value: number) => String(value).padStart(2, "0")

/** Le temps `seconds` (dans la journée, ou au-delà pour une durée) en `HH:MM:SS`. */
function clock(seconds: number): string {
  return `${two(Math.floor(seconds / 3600))}:${two(Math.floor((seconds % 3600) / 60))}:${two(seconds % 60)}`
}

/**
 * Le nombre `serial` d'une cellule au format `kind`, en ISO 8601 ; `null` quand ce n'est pas une date lisible (négatif,
 * au-delà de l'an 9999), la valeur restant alors le nombre.
 */
export function serialToIso(serial: number, kind: DateKind, date1904: boolean): string | null {
  if (kind === NOT_DATE || !Number.isFinite(serial) || serial < 0) return null
  const total = Math.round(serial * DAY_SECONDS)
  const days = Math.floor(total / DAY_SECONDS)
  const seconds = total - days * DAY_SECONDS
  if (kind === TIME) return clock(days * DAY_SECONDS + seconds)
  let day: string
  if (!date1904 && days === 60) {
    day = "1900-02-29"
  } else {
    // Avant le 1er mars 1900, le calendrier de 1900 compte depuis le 31 décembre 1899 ; ensuite, le 29 février fictif
    // décale tout d'un jour.
    const epoch = date1904 ? Date.UTC(1904, 0, 1) : days < 60 ? Date.UTC(1899, 11, 31) : Date.UTC(1899, 11, 30)
    const date = new Date(epoch + days * DAY_SECONDS * 1000)
    if (date.getUTCFullYear() > 9999) return null
    day = date.toISOString().slice(0, 10)
  }
  return kind === DATE ? day : `${day}T${clock(seconds)}`
}
