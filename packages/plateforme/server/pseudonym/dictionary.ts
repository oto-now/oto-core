// Le dictionnaire d'une organisation (`pseudonymisation.md` § Réversibilité, § Référence fournie par l'hôte) : pour
// chaque entité déclarée, son jeton et ses formes reconnues ; du jeton, la recherche inverse rend `(sorte, id)`. Il se
// bâtit des sources de l'hôte, qui lit sa base ; une source qui lève ou rend une forme invalide, une collision, une
// référence absente, en double, mal écrite ou qui contient une forme de l'entité le refusent : rien n'est servi.
// Une forme partagée par deux entités ne désigne personne : elle reçoit un jeton de valeur, à sens unique.
import type { SensitiveEntity, SensitiveKind, SensitiveOrg, SensitiveValues } from "./declaration"
import { checkedValues, entityForms, entityPhones, titledName, type EntityForm } from "./forms"
import { formRuns, type FormTable, type FormTarget } from "./mentions"
import { normalizedText } from "./normalize"
import { entityBody, REFERENCE_PATTERN, token, valueBody } from "./token"

/** Une panne de construction : sa cause va au log, jamais une valeur d'une personne. */
export class DictionaryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "DictionaryError"
  }
}

/**
 * Au-delà, la construction est refusée. Mesuré (J2, entités synthétiques à cinq valeurs) : 45 µs et 1,35 Ko par entité,
 * soit 2,3 s et 67 Mo à cette borne, par organisation gardée (16 au plus par processus).
 */
export const MAX_ENTITIES = 50_000
/** La construction rend la main à la boucle d'événements toutes les `YIELD_EVERY` entités : elle ne gèle pas le serveur. */
const YIELD_EVERY = 1_000

/** Ce qu'un jeton désigne : une entité, ou une valeur partagée (à sens unique). */
export type TokenTarget = { kind: string; id: string } | { oneWay: true }

export type Dictionary = {
  table: FormTable
  /** Le jeton de chaque cible des formes et des téléphones. */
  tokens: readonly string[]
  /** Un téléphone en E.164 → indice de sa cible. */
  phones: ReadonlyMap<string, number>
  /** La recherche inverse : jeton → ce qu'il désigne. */
  byToken: ReadonlyMap<string, TokenTarget>
  entities: number
}

/** Une forme, un nom après une civilité ou un téléphone, et l'entité qui le porte (`-1` : partagé par deux entités). */
type Owned = { target: number; owner: number; boundary: FormTarget["boundary"] }

type Draft = {
  key: Buffer
  tokens: string[]
  byToken: Map<string, TokenTarget>
  forms: Map<string, Owned>
  titled: Map<string, Owned>
  phones: Map<string, Owned>
  shared: Map<string, number>
  maxRuns: number
  titledRuns: number
}

/** Ce qu'une entité porte, lu et contrôlé une fois. */
type Carried = { forms: EntityForm[]; titled: string | null; phones: string[] }

/** Les formes d'une entité qu'une référence ne doit pas contenir, en `[a-z0-9]` seuls. */
function personalParts(values: SensitiveValues): string[] {
  const alnum = (text: string) => normalizedText(text).replace(/[^a-z0-9]/gu, "")
  const parts = [alnum(values.lastName ?? ""), ...(values.firstNames ?? "").split(/[\s-]+/u).map(alnum)]
  for (const email of values.emails ?? []) parts.push(alnum(email.split("@")[0] ?? ""))
  const out = parts.filter((part) => part.length >= 3)
  for (const phone of values.phones ?? []) {
    const digits = phone.replace(/\D/gu, "")
    for (let index = 0; index + 6 <= digits.length; index++) out.push(digits.slice(index, index + 6))
  }
  return out
}

function referenceBody(kind: string, entity: SensitiveEntity, values: SensitiveValues, seen: Set<string>): string {
  const reference = entity.reference
  if (typeof reference !== "string" || !REFERENCE_PATTERN.test(reference)) {
    throw new DictionaryError(`kind ${kind}: entity ${entity.id} has no reference of [0-9a-z][0-9a-z-]{0,23}`)
  }
  if (seen.has(reference)) throw new DictionaryError(`kind ${kind}: reference of entity ${entity.id} given twice`)
  const bare = reference.replaceAll("-", "")
  if (personalParts(values).some((part) => bare.includes(part))) {
    throw new DictionaryError(`kind ${kind}: reference of entity ${entity.id} contains a form of the entity`)
  }
  seen.add(reference)
  return reference
}

function addTarget(draft: Draft, tokenText: string, target: TokenTarget): number {
  if (draft.byToken.has(tokenText)) {
    throw new DictionaryError("token collision: give the organisation a new salt")
  }
  draft.byToken.set(tokenText, target)
  draft.tokens.push(tokenText)
  return draft.tokens.length - 1
}

/** Une valeur partagée par deux entités : son jeton de valeur, créé une fois. */
function sharedTarget(draft: Draft, detector: string, value: string): number {
  const id = `${detector}|${value}`
  const known = draft.shared.get(id)
  if (known !== undefined) return known
  const target = addTarget(draft, token(detector, valueBody(draft.key, detector, value)), { oneWay: true })
  draft.shared.set(id, target)
  return target
}

type Claim = { value: string; owner: number; detector: string; boundary: FormTarget["boundary"] }

/** `value` à `owner` dans `map` ; déjà à une autre entité, il devient un jeton de valeur, à sens unique. */
function own(draft: Draft, map: Map<string, Owned>, { value, owner, detector, boundary }: Claim): void {
  const known = map.get(value)
  if (!known) map.set(value, { target: owner, owner, boundary })
  else if (known.owner !== owner && known.owner !== -1) map.set(value, { target: sharedTarget(draft, detector, value), owner: -1, boundary })
}

function addCarried(draft: Draft, carried: Carried, owner: number): void {
  for (const { form, boundary, detector } of carried.forms) {
    own(draft, draft.forms, { value: form, owner, detector, boundary })
    draft.maxRuns = Math.max(draft.maxRuns, formRuns(form))
  }
  if (carried.titled !== null) {
    own(draft, draft.titled, { value: carried.titled, owner, detector: "name", boundary: "word" })
    draft.titledRuns = Math.max(draft.titledRuns, formRuns(carried.titled))
  }
  for (const phone of carried.phones) own(draft, draft.phones, { value: phone, owner, detector: "phone", boundary: "word" })
}

/** Ce que porte une entité, ou `DictionaryError` qui nomme le champ mal formé (jamais sa valeur). */
function carriedOf(kind: string, entity: SensitiveEntity): { values: SensitiveValues; carried: Carried } {
  try {
    const values = checkedValues(entity.values)
    return { values, carried: { forms: entityForms(values), titled: titledName(values), phones: entityPhones(values) } }
  } catch (error) {
    throw new DictionaryError(`kind ${kind}: entity ${entity.id}: ${error instanceof Error ? error.message : "invalid values"}`)
  }
}

async function addKind(draft: Draft, kind: SensitiveKind, org: SensitiveOrg, total: { count: number }): Promise<void> {
  const entities = await kind.list(org)
  if (!Array.isArray(entities)) throw new DictionaryError(`kind ${kind.kind}: list(org) did not return a list`)
  total.count += entities.length
  if (total.count > MAX_ENTITIES) throw new DictionaryError(`more than ${MAX_ENTITIES} entities`)
  const references = new Set<string>()
  for (const [index, entity] of entities.entries()) {
    if (index > 0 && index % YIELD_EVERY === 0) await new Promise((resolve) => setImmediate(resolve))
    if (typeof entity?.id !== "string" || entity.id === "") throw new DictionaryError(`kind ${kind.kind}: an entity without id`)
    const { values, carried } = carriedOf(kind.kind, entity)
    const body = kind.tokens === "reference" ? referenceBody(kind.kind, entity, values, references) : entityBody(draft.key, kind.kind, entity.id)
    addCarried(draft, carried, addTarget(draft, token(kind.kind, body), { kind: kind.kind, id: entity.id }))
  }
}

/** Le dictionnaire de `org`, sous la clé de l'organisation `key`, des sortes déclarées. */
export async function buildDictionary(kinds: readonly SensitiveKind[], org: SensitiveOrg, key: Buffer): Promise<Dictionary> {
  const draft: Draft = { key, tokens: [], byToken: new Map(), forms: new Map(), titled: new Map(), phones: new Map(), shared: new Map(), maxRuns: 1, titledRuns: 1 }
  const total = { count: 0 }
  for (const kind of kinds) await addKind(draft, kind, org, total)
  const targets = (map: Map<string, Owned>) => new Map([...map].map(([value, { target, boundary }]): [string, FormTarget] => [value, { target, boundary }]))
  const phones = new Map([...draft.phones].map(([phone, { target }]): [string, number] => [phone, target]))
  const table: FormTable = { forms: targets(draft.forms), maxRuns: draft.maxRuns, titled: targets(draft.titled), titledRuns: draft.titledRuns }
  return { table, tokens: draft.tokens, phones, byToken: draft.byToken, entities: total.count }
}
