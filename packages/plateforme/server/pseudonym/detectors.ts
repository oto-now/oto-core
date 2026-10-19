// Les détecteurs par forme (`pseudonymisation.md` § Les détecteurs par forme, J3) : un courriel ou un téléphone que la
// porte trouve dans un texte, que la personne qui le porte soit déclarée ou non. Déclaré, il garde le jeton de son
// entité (le dictionnaire le connaît) ; sinon, il devient un jeton de valeur à sens unique, `email#…` ou `phone#…`, le
// même pour la même valeur dans l'organisation. Les formes sont étroites : un nombre, une date ou une ancre ne s'y
// prennent pas (mesuré sur un corpus public sans personne).
import { phoneDigits } from "./forms"
import { normalizedText } from "./normalize"

/** Les détecteurs écrits, dans l'ordre de la porte. NIR, IBAN et carte suivront, chacun avec sa clé de contrôle. */
export const DETECTORS = ["email", "phone"] as const
export type Detector = (typeof DETECTORS)[number]

/** Une valeur trouvée : sa place dans le texte, son détecteur et sa valeur normalisée (le message du jeton de valeur). */
export type Detected = { start: number; end: number; detector: Detector; value: string }

const LOCAL = "[\\p{L}\\p{N}_%+-](?:[\\p{L}\\p{N}._%+-]{0,62}[\\p{L}\\p{N}_%+-])?"
const LABEL = "[\\p{L}\\p{N}](?:[\\p{L}\\p{N}-]{0,61}[\\p{L}\\p{N}])?"
/**
 * Un courriel : partie locale de 64 caractères au plus, un domaine d'au plus neuf étiquettes et un suffixe de lettres.
 * Bornes : rien de la partie locale avant, ni lettre, chiffre ou tiret après (`a@b.fr.` garde son point final).
 */
const EMAIL = new RegExp(`(?<![\\p{L}\\p{N}._%+-])${LOCAL}@(?:${LABEL}\\.){1,8}\\p{L}{2,24}(?![\\p{L}\\p{N}-])`, "gu")

/**
 * Un téléphone : international (`+` ou `00`, puis 8 à 15 chiffres, `(0)` toléré après l'indicatif), ou français à dix
 * chiffres commençant par `0[1-9]`, par paires, d'un même séparateur (blanc, point, tiret) ou sans : `01.02.2024 10` ou
 * `1914-1918` ne s'y prennent pas. Ni lettre ni chiffre de part et d'autre.
 */
const PHONE = new RegExp(
  "(?<![\\p{L}\\p{N}+])(?:(?:\\+|00)[1-9](?:[ .-]?(?:\\(0\\)[ .-]?)?\\d){7,14}|0[1-9]([ .-]?)\\d\\d(?:\\1\\d\\d){3})(?![\\p{L}\\p{N}])",
  "gu",
)

/** Les courriels et téléphones de `text`, de gauche à droite par détecteur ; les coupes se départagent à la porte. */
export function detectedValues(text: string): Detected[] {
  const out: Detected[] = []
  for (const match of text.matchAll(EMAIL)) {
    out.push({ start: match.index, end: match.index + match[0].length, detector: "email", value: normalizedText(match[0]) })
  }
  for (const match of text.matchAll(PHONE)) {
    const value = phoneDigits(match[0])
    if (value !== null) out.push({ start: match.index, end: match.index + match[0].length, detector: "phone", value })
  }
  return out
}
