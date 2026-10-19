// Le jeton d'une personne (`pseudonymisation.md` § Le jeton) : `⟦<sorte>:<corps>⟧`. Le corps est, par défaut, les 64
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

/** Un jeton, de corps HMAC ou de référence : la sorte et le corps. */
export const TOKEN_PATTERN = /⟦([a-z][a-z0-9]{1,9}):([0-9a-z][0-9a-z-]{0,23})⟧/gu
/** Le corps d'une référence fournie par l'hôte. */
export const REFERENCE_PATTERN = /^[0-9a-z][0-9a-z-]{0,23}$/u
/** Une sorte déclarable : ASCII minuscule, 2 à 10 caractères. */
export const KIND_PATTERN = /^[a-z][a-z0-9]{1,9}$/u
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

export function token(kind: string, body: string): string {
  return `⟦${kind}:${body}⟧`
}
