// Les formes reconnues d'une personne déclarée (`pseudonymisation.md` § Le dictionnaire et la détection) : ses noms dans
// les deux ordres, premier prénom et nom, initiale et nom, le nom après une civilité, chaque courriel, chaque désignation libre, la
// ligne de voie de chaque adresse, et la forme en chemin (`jean_dupont`) des noms, pour un chemin de page. Un téléphone
// se compare en chiffres (E.164, `+33` par défaut). Le nom seul n'est pas une forme tant que la liste des mots courants
// n'est pas livrée (J3) : « Martin » ou « Rose » seuls restent en clair. Sans ce module, seule la forme exacte que l'hôte
// déclare serait reconnue.
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
  // La forme en chemin d'une page : les segments sont faits de `[a-z0-9_]`.
  for (const name of [`${all} ${last}`, `${first} ${last}`, `${last} ${first}`]) forms.push(name.replace(/[\s'-]+/gu, "_"))
  return forms
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
  const add = (raw: string, boundary: EntityForm["boundary"], detector: EntityForm["detector"]) => {
    const form = trimmedForm(normalizedText(raw))
    if (form !== null && form.length >= MIN_FORM_CHARS && !out.has(form)) out.set(form, { form, boundary, detector })
  }
  for (const form of nameForms(values)) add(form, "word", "name")
  for (const email of strings(values.emails, "emails")) add(email, "email", "email")
  for (const alias of strings(values.aliases, "aliases")) add(alias, "word", "name")
  for (const address of strings(values.addresses, "addresses")) add(streetLine(address), "word", "name")
  return [...out.values()]
}

/** Les téléphones d'une entité, en chiffres E.164 ; un numéro trop court n'est pas cherché. */
export function entityPhones(values: SensitiveValues): string[] {
  return strings(values.phones, "phones").map(phoneDigits).filter((digits): digits is string => digits !== null)
}

/** Un numéro en E.164 (`+33612345678`), `+33` par défaut pour un numéro national à 10 chiffres, ou `null`. */
export function phoneDigits(text: string): string | null {
  const trimmed = text.trim()
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
