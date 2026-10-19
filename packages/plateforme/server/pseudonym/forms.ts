// Les formes reconnues d'une personne déclarée (`pseudonymisation.md` § Le dictionnaire et la détection) : ses noms dans
// les deux ordres, premier prénom et nom, initiale et nom, le nom après une civilité, chaque courriel, chaque désignation libre, la
// ligne de voie de chaque adresse, la forme en chemin de chacune (`jean_dupont`, `acme_sa`), pour un chemin de page, et sa
// forme à tirets (`jean-dupont`, d'une adresse web). Un téléphone se compare en chiffres (E.164, `+33` par défaut). Le nom
// seul est une forme s'il a au moins 3 lettres et n'est ni un mot commun ni un prénom courant (J3) : « Lefort » seul se
// masque, « Martin » ou « Rose » seuls restent en clair. Sans ce module, seule la forme exacte que l'hôte déclare serait
// reconnue.
import { isCommonWord } from "./common-words"
import { normalizedText } from "./normalize"
import { trimmedForm } from "./mentions"
import type { SensitiveValues } from "./declaration"

/** Une forme normalisée et rognée, avec sa règle de bord et le détecteur de son jeton de valeur si elle est partagée. */
export type EntityForm = { form: string; boundary: "word" | "email"; detector: "name" | "email" }

/** Au-dessous, une forme seule masquerait trop de mots : une désignation de deux lettres n'est pas cherchée. */
const MIN_FORM_CHARS = 3
const MIN_PHONE_DIGITS = 8

function words(text: string | undefined): string[] {
  return text ? normalizedText(text).split(/[\s-]+/u).filter((word) => word !== "") : []
}

/** Les noms d'une entité : prénoms et nom, dans les deux ordres, avec le premier prénom et l'initiale. */
function nameForms(values: SensitiveValues): string[] {
  const last = normalizedText(values.lastName ?? "")
  const firsts = words(values.firstNames)
  if (last === "" || firsts.length === 0) return []
  const all = firsts.join(" ")
  const first = firsts[0]
  const hyphenated = normalizedText(values.firstNames ?? "")
  const forms = [`${all} ${last}`, `${last} ${all}`, `${hyphenated} ${last}`, `${last} ${hyphenated}`, `${first} ${last}`, `${last} ${first}`]
  forms.push(`${first[0]}. ${last}`, `${first[0]} ${last}`)
  return forms
}

/** Le nom seul d'une entité (J3), ou `null` : moins de 3 lettres, mot commun ou prénom courant, qui restent en clair. */
function lastNameAlone(values: SensitiveValues): string | null {
  const last = trimmedForm(normalizedText(values.lastName ?? ""))
  if (last === null || (last.match(/\p{L}/gu)?.length ?? 0) < MIN_FORM_CHARS || isCommonWord(last)) return null
  return last
}

/** Le nom d'une entité tel qu'il suit une civilité (`mme dupre` : `dupre`), ou `null` sans nom ni prénom. */
export function titledName(values: SensitiveValues): string | null {
  const last = trimmedForm(normalizedText(values.lastName ?? ""))
  return last !== null && last.length >= 2 && words(values.firstNames).length > 0 ? last : null
}

/** La ligne de voie d'une adresse : sa première ligne, ou ce qui précède la première virgule. */
function streetLine(address: string): string {
  return address.split(/[\n,]/u)[0] ?? ""
}

/** Les formes d'une entité, sans doublon ; une valeur mal typée lève (la source de l'hôte rend une forme invalide). */
export function entityForms(values: SensitiveValues): EntityForm[] {
  const out = new Map<string, EntityForm>()
  const keep = (form: string, boundary: EntityForm["boundary"], detector: EntityForm["detector"]) => {
    if (form.length >= MIN_FORM_CHARS && !out.has(form)) out.set(form, { form, boundary, detector })
  }
  const add = (raw: string, boundary: EntityForm["boundary"], detector: EntityForm["detector"]) => {
    const form = trimmedForm(normalizedText(raw))
    if (form === null) return
    keep(form, boundary, detector)
    if (boundary !== "word") return
    // La forme en chemin d'une page (`jean_dupont`, `acme_sa`) : les segments sont faits de `[a-z0-9_]`.
    keep(form.replace(/[^a-z0-9]+/gu, "_"), boundary, detector)
    // Celle d'une adresse web (`jean-dupont`) : le tiret n'est pas un blanc, à cause des prénoms composés.
    keep(form.replace(/[^a-z0-9]+/gu, "-"), boundary, detector)
  }
  for (const form of nameForms(values)) add(form, "word", "name")
  const alone = lastNameAlone(values)
  if (alone !== null) add(alone, "word", "name")
  for (const email of strings(values.emails, "emails")) add(email, "email", "email")
  for (const alias of strings(values.aliases, "aliases")) add(alias, "word", "name")
  for (const address of strings(values.addresses, "addresses")) add(streetLine(address), "word", "name")
  return [...out.values()]
}

/** Au plus, les formes en chemin d'une entité qu'un chemin reçu essaie à la place de son jeton. */
const MAX_SLUGS = 8
const SLUG = /^[a-z0-9]+(?:_[a-z0-9]+)*$/u

/** Les formes d'une entité qui peuvent être un segment de chemin, ou en faire partie (`clients/jean_dupont`). */
export function slugForms(forms: readonly EntityForm[]): string[] {
  return forms.filter(({ form, boundary }) => boundary === "word" && SLUG.test(form)).slice(0, MAX_SLUGS).map(({ form }) => form)
}

/**
 * La désignation d'une entité, ce que reçoit une requête de `find` ou la phrase de `context` à la place de son jeton :
 * « prénoms nom », sinon sa première désignation libre, sinon son nom ; `null` sans aucun des trois.
 */
export function designationOf(values: SensitiveValues): string | null {
  const name = [values.firstNames, values.lastName].map((part) => part?.trim() ?? "").filter((part) => part !== "")
  if (name.length === 2) return name.join(" ")
  const alias = (values.aliases ?? []).find((item) => item.trim() !== "")
  return alias?.trim() ?? (name[0] || null)
}

/** Les téléphones d'une entité, en chiffres E.164 ; un numéro trop court n'est pas cherché. */
export function entityPhones(values: SensitiveValues): string[] {
  return strings(values.phones, "phones").map(phoneDigits).filter((digits): digits is string => digits !== null)
}

/**
 * Un numéro en E.164 (`+33612345678`), `+33` par défaut pour un numéro national à 10 chiffres, ou `null`. Le `(0)` d'un
 * numéro international (`+33 (0)6…`) ne compte pas.
 */
export function phoneDigits(text: string): string | null {
  const trimmed = text.trim().replaceAll("(0)", "")
  const digits = trimmed.replace(/\D/gu, "")
  let e164: string
  if (trimmed.startsWith("+")) e164 = `+${digits}`
  else if (digits.startsWith("00")) e164 = `+${digits.slice(2)}`
  else if (digits.length === 10 && digits.startsWith("0")) e164 = `+33${digits.slice(1)}`
  else e164 = `+${digits}`
  return e164.length - 1 >= MIN_PHONE_DIGITS ? e164 : null
}

function strings(list: readonly string[] | undefined, field: string): readonly string[] {
  if (list === undefined) return []
  if (!Array.isArray(list) || list.some((item) => typeof item !== "string")) throw new TypeError(`${field} must be a list of strings`)
  return list
}

/** Les champs simples d'une entité, contrôlés : des chaînes ou rien. */
export function checkedValues(values: unknown): SensitiveValues {
  if (typeof values !== "object" || values === null) throw new TypeError("values must be an object")
  const record = values as Record<string, unknown>
  for (const field of ["lastName", "firstNames"]) {
    if (record[field] !== undefined && typeof record[field] !== "string") throw new TypeError(`${field} must be a string`)
  }
  return record as SensitiveValues
}
