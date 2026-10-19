// Types de `storage.mjs`, que le serveur du paquet importe (`server/files/s3.ts`, `server/files/store.ts`) : un hôte
// compile le paquet sans `allowJs`, et sans ce fichier l'import y prend le type `any` implicite, refusé par `next build`.
import type { AwsClient } from "aws4fetch"

export declare const STORAGE_VARIABLES: readonly [
  "PLATFORM_STORAGE_ENDPOINT",
  "PLATFORM_STORAGE_BUCKET",
  "PLATFORM_STORAGE_REGION",
  "PLATFORM_STORAGE_ACCESS_KEY_ID",
  "PLATFORM_STORAGE_SECRET_ACCESS_KEY",
]
export declare const OPERATION_TIMEOUT_MS: number

export type StorageConfig = { endpoint: string; bucket: string; region: string; accessKeyId: string; secretAccessKey: string }

export declare function storageConfig(env: Record<string, string | undefined>): StorageConfig | null
export declare function bucketBase(config: StorageConfig): { base: string } | { problem: string }
export declare function s3Client(config: StorageConfig): AwsClient
export declare function storageFailure(operation: string, status: number): Error
export declare function listKeys(client: AwsClient, base: string, prefix: string): Promise<string[]>
export declare function removeObject(client: AwsClient, base: string, key: string): Promise<void>
export declare function bucketObjects(
  config: StorageConfig,
): { store: { list(prefix: string): Promise<string[]>; remove(key: string): Promise<void> } } | { problem: string }
