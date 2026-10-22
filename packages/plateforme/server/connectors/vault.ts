// Coffre du paquet (`connecteurs-et-comptes.md` § Coffre et secret à l'appel ; NFR-ADMIN-01) : le secret d'un compte
// réel (ses champs) et le jeton d'un échange, chiffrés par le serveur de l'hôte avant d'être écrits, déchiffrés pour le
// seul appel au tiers. Le format vit dans `cli/vault.mjs`, partagé avec la commande `oto-platform accounts secret` ; ce
// module lit la clé de l'hôte à l'usage (jamais au démarrage : un hôte sans connecteur réel ne la pose pas) et traduit
// les refus du coffre en erreurs du paquet. Pas de Supabase Vault : le paquet reste portable sur un Postgres nu (ADR-012).
import { createHmac } from "node:crypto"
import { open, openCredential, parseVaultKey, seal, sealCredential, TOKEN_COLUMN, VAULT_KEY_VARIABLE, VaultError } from "../../cli/vault.mjs"
import { PlatformError } from "../errors"
import { PlatformConfigError } from "../sql"

type Env = Record<string, string | undefined>

/** Le secret d'un compte ouvert : ses champs, ou le secret brut d'un seul champ posé au format v1. */
export type OpenedCredential = { fields: Record<string, string> } | { single: string }

/** La clé de l'hôte ; absente ou mal écrite, `PlatformConfigError` qui nomme la variable (la porte la journalise). */
function vaultKey(env: Env): Buffer {
  try {
    return parseVaultKey(env[VAULT_KEY_VARIABLE])
  } catch (error) {
    if (error instanceof VaultError) throw new PlatformConfigError(error.message)
    throw error
  }
}

/**
 * Un chiffré illisible (clé changée, chiffré d'un autre compte ou d'une autre colonne) est une panne de l'hôte : sa
 * cause part au log serveur, sans le chiffré, et l'appel échoue en `internal`.
 */
function opened<T>(accountId: string, what: string, work: () => T): T {
  try {
    return work()
  } catch (error) {
    if (!(error instanceof VaultError)) throw error
    console.error(`[platform] vault: ${what} of account ${accountId} unreadable (another key, another account or an unknown format)`)
    throw new PlatformError("internal", "Internal error.")
  }
}

/** Le chiffré des champs du secret de `accountId`, à écrire dans `accounts.secret_ciphertext`. */
export function encryptCredential(accountId: string, fields: Readonly<Record<string, string>>, env: Env = process.env): string {
  return sealCredential(vaultKey(env), accountId, fields)
}

/** Le secret de `accountId`, lu dans `accounts.secret_ciphertext`. */
export function decryptCredential(accountId: string, ciphertext: string, env: Env = process.env): OpenedCredential {
  const key = vaultKey(env)
  return opened(accountId, "secret", () => openCredential(key, accountId, ciphertext))
}

/** Le chiffré du jeton d'un échange, à écrire dans `accounts.token_ciphertext`. */
export function encryptToken(accountId: string, token: string, env: Env = process.env): string {
  return seal(vaultKey(env), accountId, TOKEN_COLUMN, token)
}

/** Le jeton d'un échange de `accountId`, lu dans `accounts.token_ciphertext`. */
export function decryptToken(accountId: string, ciphertext: string, env: Env = process.env): string {
  const key = vaultKey(env)
  return opened(accountId, "token", () => open(key, accountId, TOKEN_COLUMN, ciphertext).text)
}

/**
 * La preuve PKCE (`code_verifier`) d'un consentement, tirée de son `state` par la clé de l'hôte (HMAC-SHA-256, préfixe
 * `pkce/`) : 43 caractères base64url, rien à garder en base, et nul ne la refait sans la clé.
 */
export function consentVerifier(state: string, env: Env = process.env): string {
  return createHmac("sha256", vaultKey(env)).update(`pkce/${state}`, "utf8").digest("base64url")
}

/**
 * Le chiffré d'un texte d'un travail en tâche de fond (`jobs/seal.ts`) : ses arguments ou son issue, sous `subject` (son
 * empreinte, son identifiant) et `column`, liés au chiffré comme l'est un compte : un chiffré d'un autre travail ou d'une
 * autre colonne ne s'ouvre pas.
 */
export function encryptJobText(subject: string, column: string, text: string, env: Env = process.env): string {
  return seal(vaultKey(env), subject, column, text)
}

/** Le texte d'un travail ; illisible (autre clé, autre travail, autre colonne), panne de l'hôte, sans le chiffré au log. */
export function decryptJobText(subject: string, column: string, ciphertext: string, env: Env = process.env): string {
  const key = vaultKey(env)
  try {
    return open(key, subject, column, ciphertext).text
  } catch (error) {
    if (!(error instanceof VaultError)) throw error
    console.error(`[platform] vault: ${column} of job ${subject} unreadable (another key, another job or an unknown format)`)
    throw new PlatformError("internal", "Internal error.")
  }
}

/**
 * L'empreinte d'un texte par la clé de l'hôte (HMAC-SHA-256, préfixe `job/`) : deux travaux identiques ont la même, et nul
 * ne la refait sans la clé, ni ne retrouve les arguments d'un travail depuis elle.
 */
export function jobDigest(text: string, env: Env = process.env): string {
  return createHmac("sha256", vaultKey(env)).update(`job/${text}`, "utf8").digest("base64url")
}
