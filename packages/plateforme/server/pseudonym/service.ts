// Le dictionnaire d'une organisation au moment d'une requête (`pseudonymisation.md` § Cache, invalidation et plusieurs
// instances) : l'état de l'organisation lu en base (`platform.pseudonym_org` : sel, témoin, génération), un dictionnaire
// par organisation et par processus, gardé tant que la génération et la déclaration n'ont pas changé et 5 minutes au
// plus, une seule construction à la fois. Fermé en cas de panne : une clé absente, un témoin faux, une source de l'hôte
// qui lève ou une collision refusent l'appel (`internal`, raison `pseudonymization_unavailable`), jamais en clair.
// Une organisation que le prédicat `enabled(org)` de l'hôte éteint est servie comme sans déclaration ; seuls les jetons
// qu'un assistant lui renvoie (une conversation commencée allumée) se résolvent encore.
import { randomBytes } from "node:crypto"
import type { Json } from "../database"
import type { PlatformDb } from "../db"
import { PlatformError } from "../errors"
import { carriesToken } from "./arguments"
import { declarationVersion, sensitiveKinds, sensitiveOptions, type SensitiveOrg } from "./declaration"
import { buildDictionary, type Dictionary } from "./dictionary"
import { pseudonymizedJson, pseudonymizedPlaces, pseudonymizedText, type Places } from "./gate"
import { keyWitness, orgKey, pseudonymKey, RESERVED_KINDS } from "./token"

/** Au-delà, un dictionnaire se rebâtit : une invalidation oubliée se rattrape en 5 minutes. */
export const DICTIONARY_TTL_MS = 5 * 60_000
/** Les organisations gardées en mémoire par processus ; la plus anciennement servie sort la première. */
const MAX_CACHED_ORGS = 16

type OrgState = { slug: string; key_version: number; salt: string; witness: string; generation: string }
type Cached = { generation: string; salt: string; declaration: number; builtAt: number; dictionary: Dictionary }

const cache = new Map<string, Cached>()
const building = new Map<string, Promise<Dictionary>>()

/** La porte d'une organisation pour une requête : ses textes et ses données pseudonymisés. */
export type Pseudonymizer = {
  dictionary: Dictionary
  text(value: string): string
  json<T>(value: T): T
  /** Un texte pseudonymisé et sa table de places vers le clair (`find` de `replace_text`). */
  places(value: string): Places
}

/** La panne nommée au log, l'appel refusé en `internal` sans rien de la cause. */
function unavailable(orgId: string, cause: string): PlatformError {
  console.error(`[platform] pseudonymization unavailable for organisation ${orgId}: ${cause}`)
  return new PlatformError("internal", "Internal error.", { reason: "pseudonymization_unavailable" })
}

async function orgState(db: PlatformDb, orgId: string, witness: string): Promise<OrgState> {
  const salt = randomBytes(18).toString("base64url")
  const rows = await db.tx((sql) => sql<OrgState[]>`
    select slug, key_version, salt, witness, generation::text as generation
      from platform.pseudonym_org(${orgId}, ${salt}, ${witness})`, "server")
  if (rows.length !== 1) throw new Error("no state row")
  return rows[0]
}

function remembered(orgId: string, entry: Cached): void {
  cache.delete(orgId)
  cache.set(orgId, entry)
  while (cache.size > MAX_CACHED_ORGS) cache.delete(cache.keys().next().value as string)
}

async function dictionaryFor(db: PlatformDb, orgId: string): Promise<Dictionary> {
  let master: Buffer
  try {
    master = pseudonymKey()
  } catch (error) {
    throw unavailable(orgId, error instanceof Error ? error.message : "key unreadable")
  }
  const witness = keyWitness(master)
  let state: OrgState
  try {
    state = await orgState(db, orgId, witness)
  } catch (error) {
    if (error instanceof PlatformError && error.code !== "internal") throw error
    throw unavailable(orgId, "organisation state unreadable")
  }
  if (state.witness !== witness) throw unavailable(orgId, `master key changed (witness ${state.witness}, key ${witness})`)
  const declaration = declarationVersion()
  const known = cache.get(orgId)
  if (known && known.generation === state.generation && known.salt === state.salt && known.declaration === declaration && Date.now() - known.builtAt < DICTIONARY_TTL_MS) {
    remembered(orgId, known)
    return known.dictionary
  }
  const pending = building.get(orgId)
  if (pending) return pending
  const org: SensitiveOrg = { id: orgId, slug: state.slug }
  const work = buildDictionary(sensitiveKinds(), org, orgKey(master, orgId, state.salt))
    .then((dictionary) => {
      remembered(orgId, { generation: state.generation, salt: state.salt, declaration, builtAt: Date.now(), dictionary })
      return dictionary
    })
    .catch((error: unknown) => {
      throw unavailable(orgId, error instanceof Error ? `${error.name}: ${error.message}` : "build failed")
    })
    .finally(() => building.delete(orgId))
  building.set(orgId, work)
  return work
}

async function pseudonymizerOf(db: PlatformDb, orgId: string): Promise<Pseudonymizer> {
  const dictionary = await dictionaryFor(db, orgId)
  return {
    dictionary,
    text: (value) => pseudonymizedText(dictionary, value),
    json: (value) => pseudonymizedJson(dictionary, value),
    places: (value) => pseudonymizedPlaces(dictionary, value),
  }
}

/** Vrai si le prédicat de l'hôte allume l'organisation (vrai sans prédicat) ; qui lève ou ne rend pas un booléen ferme l'appel. */
async function enabledFor(orgId: string): Promise<boolean> {
  const enabled = sensitiveOptions().enabled
  if (!enabled) return true
  let answer: unknown
  try {
    answer = await enabled({ id: orgId })
  } catch (error) {
    throw unavailable(orgId, `enabled(org) failed: ${error instanceof Error ? error.message : "unknown"}`)
  }
  if (typeof answer !== "boolean") throw unavailable(orgId, "enabled(org) did not return a boolean")
  return answer
}

/**
 * La pseudonymisation d'une organisation pour une requête : `gate`, la porte de ce qui part vers l'assistant, `null`
 * quand rien n'est déclaré ou que `enabled(org)` l'éteint ; `entry(input)`, ce qui résout les jetons qu'il envoie : la
 * porte, ou, éteinte, le dictionnaire bâti seulement quand `input` porte la forme d'un jeton d'une sorte déclarée ou
 * réservée (une conversation commencée allumée garde ses jetons).
 */
export type Pseudonymization = { gate: Pseudonymizer | null; entry(input: unknown): Promise<Pseudonymizer | null> }

const NONE: Pseudonymization = { gate: null, entry: async () => null }

export async function pseudonymizationFor(db: PlatformDb, orgId: string): Promise<Pseudonymization> {
  const kinds = sensitiveKinds()
  if (kinds.length === 0) return NONE
  if (await enabledFor(orgId)) {
    const gate = await pseudonymizerOf(db, orgId)
    return { gate, entry: async () => gate }
  }
  const tokenKinds = new Set([...kinds.map((kind) => kind.kind), ...RESERVED_KINDS])
  return { gate: null, entry: async (input) => (carriesToken(input, tokenKinds) ? pseudonymizerOf(db, orgId) : null) }
}

/** La porte de l'organisation `orgId`, ou `null` quand l'hôte ne déclare aucune sorte ou l'éteint (`enabled`). */
export async function pseudonymizerFor(db: PlatformDb, orgId: string): Promise<Pseudonymizer | null> {
  return (await pseudonymizationFor(db, orgId)).gate
}

/**
 * Pseudonymise une valeur JSON pour l'organisation `org`, comme la porte du MCP : pour l'hôte qui repasse à un
 * assistant un résultat de `callFunction`, rendu en clair. Sans sorte déclarée, ou l'organisation éteinte, la valeur
 * revient telle quelle.
 */
export async function pseudonymize<T extends Json>(db: PlatformDb, org: SensitiveOrg, payload: T): Promise<T> {
  const gate = await pseudonymizerFor(db, org.id)
  return gate ? gate.json(payload) : payload
}

/**
 * Après toute écriture d'une entité déclarée (création, changement, effacement) : la génération de l'organisation
 * avance, et chaque instance rebâtit son dictionnaire à sa requête suivante.
 */
export async function invalidateSensitiveEntities(db: PlatformDb, org: { id: string }): Promise<void> {
  await db.tx((sql) => sql`select platform.invalidate_pseudonyms(${org.id})`)
  cache.delete(org.id)
}

/** Pour les tests : oublie tous les dictionnaires gardés. */
export function forgetDictionaries(): void {
  cache.clear()
}
