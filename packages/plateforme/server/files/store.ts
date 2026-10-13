// Le port de stockage d'objets (ADR-016 § 1, § 2 ; E10-S02 AC-a1) : le troisième port du paquet, après
// l'identité et la base (ADR-012). Cinq opérations, un adaptateur S3 signé en SigV4 (`s3.ts`) et un
// adaptateur en mémoire pour les tests (`memory.ts`). L'hôte le configure par cinq variables ; sans l'une
// d'elles, `fileStore()` rend `null` et les fichiers sont désactivés, tout le reste fonctionne. Les clés
// d'accès restent dans `server/` : jamais dans `ui/`, jamais la clé secrète de la base, réservée à l'outillage.
import { PlatformError } from "../errors"
import { s3FileStore } from "./s3"

/** Ce que le bucket dit d'un objet (`HEAD`) : sa taille en octets et son type. */
export type ObjectHead = { size: number; mime: string }

/** Ce que l'URL de lecture fixe dans sa signature (ADR-016 § 5) : jamais lu de l'objet. */
export type ObjectResponse = { contentType: string; disposition: string; /** Durée de l'URL, `READ_URL_SECONDS` à défaut : une heure pour l'export d'un arbre. */ seconds?: number }

export type FileStore = {
  /**
   * URL présignée d'envoi (`PUT`), valable `UPLOAD_URL_SECONDS` ; `content-length` et `content-type` y sont
   * signés (ADR-016 § 4). `headers` : ce que l'envoi doit porter (le navigateur pose seul `content-length`).
   */
  uploadUrl(key: string, object: ObjectHead): Promise<{ url: string; headers: Record<string, string> }>
  /** URL présignée de lecture (`GET`), valable `READ_URL_SECONDS`, type et disposition signés. */
  readUrl(key: string, response: ObjectResponse): Promise<string>
  /**
   * Taille et type de l'objet ; `null` quand il est absent ; `size` nul quand le stockage ne l'a pas dite (ni
   * `content-length` non compressé, ni `content-range`), jamais `NaN`.
   */
  head(key: string): Promise<{ size: number | null; mime: string } | null>
  /** Copie côté bucket (duplication d'une page, fiche D118). */
  copy(from: string, to: string): Promise<void>
  /** Supprime l'objet ; un objet déjà absent n'est pas une erreur. */
  remove(key: string): Promise<void>
  /** Écrit un objet produit par le serveur lui-même (l'export d'un arbre), sans URL d'envoi. */
  put(key: string, bytes: Uint8Array, mime: string): Promise<void>
}

/** 5 minutes pour envoyer (ADR-016 § 4). */
export const UPLOAD_URL_SECONDS = 300

/** 60 secondes pour lire (ADR-016 § 5) : une URL rejouable par qui la détient, le temps d'une redirection. */
export const READ_URL_SECONDS = 60

/** Les cinq variables de l'hôte (ADR-016 § 2), toutes exigées. */
export const STORAGE_VARIABLES = [
  "PLATFORM_STORAGE_ENDPOINT",
  "PLATFORM_STORAGE_BUCKET",
  "PLATFORM_STORAGE_REGION",
  "PLATFORM_STORAGE_ACCESS_KEY_ID",
  "PLATFORM_STORAGE_SECRET_ACCESS_KEY",
] as const

/** La clé d'un objet : `<org_id>/<id>`, jamais le nom d'origine (`uploads-patterns.md § Nommage du chemin`). */
export function objectKey(orgId: string, fileId: string): string {
  return `${orgId}/${fileId}`
}

/**
 * Le stockage de l'hôte, lu dans l'environnement à chaque appel ; `null` sans l'une des cinq variables
 * (AC-a1). `env` : l'environnement lu, `process.env` par défaut.
 */
export function fileStore(env: Record<string, string | undefined> = process.env): FileStore | null {
  const [endpoint, bucket, region, accessKeyId, secretAccessKey] = STORAGE_VARIABLES.map((name) => env[name]?.trim() ?? "")
  if (!endpoint || !bucket || !region || !accessKeyId || !secretAccessKey) return null
  return s3FileStore({ endpoint, bucket, region, accessKeyId, secretAccessKey })
}

/** Le refus d'un geste de fichier sans stockage configuré (AC-a1) : il nomme les cinq variables. */
export function storageNotEnabled(): PlatformError {
  return new PlatformError(
    "not_enabled",
    `Files are not enabled on this platform: the host sets ${STORAGE_VARIABLES.slice(0, -1).join(", ")} and ${STORAGE_VARIABLES[STORAGE_VARIABLES.length - 1]}.`,
  )
}
