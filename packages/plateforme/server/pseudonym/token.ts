// Le jeton d'une personne (`pseudonymisation.md` § Le jeton) : `<sorte>#<corps>`, dans l'enveloppe `TOKEN_ENVELOPE`. Le corps est, par défaut, les 64
// premiers bits d'un HMAC-SHA-256 de l'identifiant sous la clé de l'organisation, en 13 caractères de base32 de
// Crockford minuscule ; ou la référence que l'hôte fournit pour une sorte (`tokens: "reference"`). La clé de
// l'organisation dérive de la clé maître (`PLATFORM_PSEUDONYM_KEY`) et d'un sel propre à l'organisation. Sans clé, nul
// ne calcule le jeton d'un nom connu.
import { createHash, createHmac } from "node:crypto"
import { PlatformConfigError } from "../sql"

export const PSEUDONYM_KEY_VARIABLE = "PLATFORM_PSEUDONYM_KEY"
const KEY_BYTES = 32
/** Le témoin d'une clé maître : six octets de son empreinte SHA-256, comme l'identifiant d'une clé du coffre. */
const WITNESS_BYTES = 6

const CROCKFORD = "0123456789abcdefghjkmnpqrstvwxyz"
export const HMAC_BODY_CHARS = 13

/**
 * L'enveloppe d'un jeton, seule définition de sa forme écrite : l'expression qui le reconnaît et son rendu en dérivent.
 * `client#…`, retenu le 19/10 sur le banc de fidélité, le moins coûteux à fidélité égale. Changer de format (`⟦client:…⟧`,
 * `‹client:…›`), c'est changer ces trois chaînes, et rien d'autre. Sans fermeture, la forme seule ne prouve pas le jeton
 * (l'ancre d'une adresse, `guide#installation`, l'a aussi) : la porte ne garde que les jetons que le dictionnaire connaît,
 * l'entrée que ceux d'une sorte déclarée ou réservée.
 */
export const TOKEN_ENVELOPE: { readonly open: string; readonly separator: string; readonly close: string } = { open: "", separator: "#", close: "" }

/** L'expression d'une sorte, d'un corps HMAC et d'un corps quelconque (HMAC ou référence fournie par l'hôte). */
export const KIND_SOURCE = "[a-z][a-z0-9]{1,9}"
export const HMAC_BODY_SOURCE = "[0-9a-hjkmnp-tv-z]{13}"
const BODY_SOURCE = "[0-9a-z][0-9a-z-]{0,23}"

const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")

/**
 * L'expression, sans drapeaux, des jetons d'une sorte et d'un corps donnés (par défaut : tous). Une enveloppe sans
 * ouverture ou sans fermeture (`client#…`) borne le jeton au mot : ni lettre ni chiffre avant la sorte, ni après le corps.
 */
export function tokenSource(kind: string = KIND_SOURCE, body: string = BODY_SOURCE): string {
  const { open, separator, close } = TOKEN_ENVELOPE
  const before = open === "" ? "(?<![0-9A-Za-z])" : escaped(open)
  const after = close === "" ? "(?![0-9a-z-])" : escaped(close)
  return `${before}${kind}${escaped(separator)}${body}${after}`
}

/** Un jeton, de corps HMAC ou de référence : la sorte et le corps. */
export const TOKEN_PATTERN = new RegExp(tokenSource(`(${KIND_SOURCE})`, `(${BODY_SOURCE})`), "gu")
/**
 * Les jetons de `text` que `accept` retient (par la suite trouvée et sa sorte), de gauche à droite. Une suite écartée ne
 * mange pas ce qui la suit : dans `fiche#client#…`, `fiche#client` écarté, `client#…` est encore trouvé.
 */
export function* tokenMatches(text: string, accept: (found: string, kind: string) => boolean): Generator<RegExpExecArray> {
  const pattern = new RegExp(TOKEN_PATTERN.source, "gu")
  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    if (accept(match[0], match[1])) yield match
    else pattern.lastIndex = match.index + 1
  }
}

/** Le corps d'une référence fournie par l'hôte. */
export const REFERENCE_PATTERN = new RegExp(`^${BODY_SOURCE}$`, "u")
/** Une sorte déclarable : ASCII minuscule, 2 à 10 caractères. */
export const KIND_PATTERN = new RegExp(`^${KIND_SOURCE}$`, "u")
/** Les sortes des jetons de valeur, à sens unique : réservées, jamais déclarées par l'hôte. */
export const RESERVED_KINDS: ReadonlySet<string> = new Set(["email", "phone", "iban", "nir", "card", "name"])

type Env = Record<string, string | undefined>

/** La clé maître ; absente ou mal écrite, `PlatformConfigError` qui nomme la variable. */
export function pseudonymKey(env: Env = process.env): Buffer {
  const text = env[PSEUDONYM_KEY_VARIABLE]?.trim()
  if (!text) throw new PlatformConfigError(`${PSEUDONYM_KEY_VARIABLE} is missing from the host server environment`)
  const key = Buffer.from(text, "base64")
  if (key.length !== KEY_BYTES || key.toString("base64") !== text) {
    throw new PlatformConfigError(`${PSEUDONYM_KEY_VARIABLE} is not a 32-byte key in base64 (openssl rand -base64 32)`)
  }
  return key
}

/** Le témoin de la clé maître, gardé par organisation : une clé changée par erreur se voit avant de servir. */
export function keyWitness(key: Buffer): string {
  return createHash("sha256").update(key).digest().subarray(0, WITNESS_BYTES).toString("base64url")
}

/** La clé d'une organisation : `HMAC-SHA-256(clé maître, "oto/pseudonym|" + org + "|" + sel)`. */
export function orgKey(master: Buffer, orgId: string, salt: string): Buffer {
  return createHmac("sha256", master).update(`oto/pseudonym|${orgId}|${salt}`).digest()
}

/** Les 64 premiers bits d'une empreinte, en 13 caractères de base32 de Crockford (le premier ne porte qu'un bit). */
function crockford64(digest: Buffer): string {
  let value = digest.readBigUInt64BE(0)
  const mask = BigInt(31)
  const shift = BigInt(5)
  let out = ""
  for (let index = 0; index < HMAC_BODY_CHARS; index++) {
    out = CROCKFORD[Number(value & mask)] + out
    value >>= shift
  }
  return out
}

/** Le corps du jeton d'une entité : `entity|<sorte>|<id>`. */
export function entityBody(key: Buffer, kind: string, id: string): string {
  return crockford64(createHmac("sha256", key).update(`entity|${kind}|${id}`).digest())
}

/** Le corps d'un jeton de valeur, à sens unique : `value|<détecteur>|<valeur normalisée>`. */
export function valueBody(key: Buffer, detector: string, value: string): string {
  return crockford64(createHmac("sha256", key).update(`value|${detector}|${value}`).digest())
}

/** Le rendu d'un jeton, dans l'enveloppe. */
export function token(kind: string, body: string): string {
  return `${TOKEN_ENVELOPE.open}${kind}${TOKEN_ENVELOPE.separator}${body}${TOKEN_ENVELOPE.close}`
}
