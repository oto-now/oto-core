// Les jetons dans les arguments (`pseudonymisation.md` § Les jetons dans les arguments) : un jeton reçu se cherche dans
// le dictionnaire avant le service. Inconnu : `unknown_pseudonym` ; jeton de valeur là où une personne est désignée :
// `one_way_pseudonym`. Puis, selon l'argument : une requête ou une phrase reçoit la désignation de l'entité ; un chemin,
// la forme en chemin qui, pseudonymisée, redonne le chemin reçu ; un argument d'entité d'une fonction de l'hôte,
// l'identifiant ; une fonction de connecteur refuse tout jeton (`pseudonym_not_accepted`). Un contenu écrit garde le
// jeton tel quel. Sans ce module, l'assistant recevrait des jetons qu'il ne pourrait employer nulle part.
import { isRecord } from "../../schemas/tables"
import { PlatformError } from "../errors"
import type { Dictionary } from "./dictionary"
import { pseudonymizedText } from "./gate"
import { DETECTORS } from "./detectors"
import { HMAC_BODY_SOURCE, TOKEN_PATTERN, tokenMatches, tokenSource } from "./token"

/** Ce que l'argument fait d'un jeton : un contenu le garde, jeton de valeur compris ; une désignation vise une entité. */
export type TokenUse = "content" | "designation"

/** Au plus, les chemins en clair essayés pour un chemin reçu : le produit des formes en chemin de ses jetons. */
export const MAX_PATH_CANDIDATES = 16

/** Un jeton seul, sans rien autour. */
const LONE_TOKEN = new RegExp(`^${tokenSource()}$`, "u")
/**
 * Un jeton de valeur d'un détecteur (`email#…`, `phone#…`) : posé par la porte sans passer par le dictionnaire, il ne
 * désigne personne, et nul ne le résout ; reçu, il vaut comme tout jeton à sens unique.
 */
const DETECTED_VALUE = new RegExp(`^${tokenSource(`(?:${DETECTORS.join("|")})`, HMAC_BODY_SOURCE)}$`, "u")

type EntityTarget = { kind: string; id: string }

/**
 * Vrai si `text` porte au moins une suite qui a la forme d'un jeton : un aiguillage (filtre, `replace_text`, chemin),
 * pas une preuve. Sans enveloppe fermante, l'ancre d'une adresse (`guide#installation`) a aussi cette forme.
 */
export function hasToken(text: string): boolean {
  return text.search(TOKEN_PATTERN) !== -1
}

/** Les jetons de `text` : les suites qui en ont la forme et dont la sorte est déclarée ou réservée ; le reste est du texte. */
function tokensIn(dictionary: Dictionary, text: string): RegExpExecArray[] {
  return [...tokenMatches(text, (_found, kind) => dictionary.kinds.has(kind))]
}

function unknownPseudonym(found: string): PlatformError {
  return new PlatformError(
    "invalid_arguments",
    `Unknown token ${found}: no person of this workspace has it now (never served here, or erased since). Use a token exactly as a result gave it.`,
    { reason: "unknown_pseudonym" },
  )
}

function oneWayPseudonym(found: string): PlatformError {
  return new PlatformError(
    "invalid_arguments",
    `${found} stands for a value, not a person (shared by several people, or of someone this workspace does not declare): it designates no one and cannot be used here. Use the token of one person.`,
    { reason: "one_way_pseudonym" },
  )
}

/** L'entité d'un jeton reçu ; `null` pour un jeton de valeur dans un contenu. Inconnu, ou de valeur pour désigner : refusé. */
function targetOf(dictionary: Dictionary, found: string, use: TokenUse): EntityTarget | null {
  const target = dictionary.byToken.get(found) ?? (DETECTED_VALUE.test(found) ? { oneWay: true as const } : undefined)
  if (!target) throw unknownPseudonym(found)
  if ("oneWay" in target) {
    if (use === "designation") throw oneWayPseudonym(found)
    return null
  }
  return target
}

/** Les chaînes d'une valeur JSON, à toute profondeur ; les clés d'objet n'en sont pas. */
function* stringsOf(value: unknown): Generator<string> {
  if (typeof value === "string") yield value
  else if (Array.isArray(value)) for (const item of value) yield* stringsOf(item)
  else if (isRecord(value)) for (const item of Object.values(value)) yield* stringsOf(item)
}

/** Vrai si une chaîne de `value`, à toute profondeur, porte une suite qui a la forme d'un jeton d'une sorte de `kinds`. */
export function carriesToken(value: unknown, kinds: ReadonlySet<string>): boolean {
  for (const text of stringsOf(value)) if (!tokenMatches(text, (_found, kind) => kinds.has(kind)).next().done) return true
  return false
}

/** Chaque jeton d'une valeur JSON (texte compris), contrôlé pour l'usage `use`. */
export function checkTokens(dictionary: Dictionary, value: unknown, use: TokenUse): void {
  for (const text of stringsOf(value)) for (const match of tokensIn(dictionary, text)) targetOf(dictionary, match[0], use)
}

/**
 * `text`, chaque jeton d'entité remplacé par sa désignation (« prénoms nom ») ; une entité sans désignation garde son
 * jeton, comme un jeton de valeur sous l'usage `content` (la phrase de `context`).
 */
export function designatedText(dictionary: Dictionary, text: string, use: TokenUse = "designation"): string {
  let out = ""
  let at = 0
  for (const match of tokensIn(dictionary, text)) {
    const found = match[0]
    out += text.slice(at, match.index) + (targetOf(dictionary, found, use) ? (dictionary.details.get(found)?.designation ?? found) : found)
    at = match.index + found.length
  }
  return out + text.slice(at)
}

/**
 * Les chemins en clair qu'un chemin reçu peut désigner, dans l'ordre des formes en chemin de ses entités (`prenoms_nom`
 * d'abord), `MAX_PATH_CANDIDATES` au plus : chacun redonne, pseudonymisé, le chemin reçu. Sans jeton : le chemin seul.
 */
export function pathCandidates(dictionary: Dictionary, path: string): string[] {
  let heads = [""]
  let at = 0
  for (const match of tokensIn(dictionary, path)) {
    targetOf(dictionary, match[0], "designation")
    const slugs = dictionary.details.get(match[0])?.slugs ?? []
    const between = path.slice(at, match.index)
    heads = heads.flatMap((head) => slugs.map((slug) => head + between + slug)).slice(0, MAX_PATH_CANDIDATES)
    at = match.index + match[0].length
  }
  if (at === 0) return [path]
  return heads.map((head) => head + path.slice(at)).filter((candidate) => pseudonymizedText(dictionary, candidate) === path)
}

/** La valeur d'un argument d'entité : un jeton seul de la sorte attendue devient l'identifiant ; un texte sans jeton passe. */
function entityId(dictionary: Dictionary, value: unknown, argument: { path: string; kind: string }): unknown {
  if (typeof value !== "string" || tokensIn(dictionary, value).length === 0) return value
  if (!LONE_TOKEN.test(value)) throw new PlatformError("invalid_arguments", `${argument.path} takes one ${argument.kind} token alone, as a result gave it.`)
  // Une désignation : un jeton de valeur est refusé avant, l'entité n'est donc jamais nulle ici.
  const target = targetOf(dictionary, value, "designation") as EntityTarget
  if (target.kind !== argument.kind) throw new PlatformError("invalid_arguments", `${argument.path} takes a ${argument.kind} token; ${value} is a ${target.kind}.`)
  return target.id
}

/** `value`, la valeur au chemin `keys` remplacée ; un tableau sur le chemin l'est élément par élément. */
function replacedAt(value: unknown, keys: readonly string[], replace: (found: unknown) => unknown): unknown {
  if (keys.length === 0) return replace(value)
  if (Array.isArray(value)) return value.map((item) => replacedAt(item, keys, replace))
  if (!isRecord(value) || !(keys[0] in value)) return value
  return { ...value, [keys[0]]: replacedAt(value[keys[0]], keys.slice(1), replace) }
}

/**
 * Les arguments d'une fonction de l'hôte, chaque argument d'entité (`entityArguments` : chemin pointé → sorte) devenu
 * l'identifiant de son jeton ; les autres jetons, connus, passent tels quels (l'hôte peut appeler `reidentify`, J4).
 */
export function withEntityIds(
  dictionary: Dictionary,
  args: Record<string, unknown>,
  entityArguments: Readonly<Record<string, string>>,
): Record<string, unknown> {
  let out: unknown = args
  for (const [path, kind] of Object.entries(entityArguments)) out = replacedAt(out, path.split("."), (value) => entityId(dictionary, value, { path, kind }))
  checkTokens(dictionary, out, "content")
  return out as Record<string, unknown>
}

/**
 * Une fonction de connecteur ne reçoit aucun jeton : la réidentifier pour lui ferait sortir la valeur par un outil
 * d'envoi. Le premier jeton trouvé est refusé (`forbidden`, raison `pseudonym_not_accepted`) ; une valeur en clair passe.
 */
export function refuseTokens(dictionary: Dictionary, functionName: string, args: unknown): void {
  for (const text of stringsOf(args)) {
    const [match] = tokensIn(dictionary, text)
    if (match === undefined) continue
    const found = match[0]
    targetOf(dictionary, found, "content")
    throw new PlatformError(
      "forbidden",
      `${functionName} does not take a token such as ${found}: a connector never receives the value a token stands for. Ask the user for the value itself, or use a function of this workspace that takes the token.`,
      { reason: "pseudonym_not_accepted" },
    )
  }
}
