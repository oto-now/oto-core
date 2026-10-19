/**
 * Le bucket de l'hôte (ADR-016 § 1, § 2), ce qu'en partagent l'adaptateur S3 du serveur (`server/files/s3.ts`) et la
 * commande `oto-platform org delete` (`org-delete.mjs`) : les cinq variables, l'adresse du bucket, le client SigV4
 * (`aws4fetch`), la liste des clés sous un préfixe et la suppression d'un objet. Sans ce module partagé, la commande
 * parlerait au bucket par une copie qui divergerait du serveur. Adresses en chemin (`<endpoint>/<bucket>/<clé>`), que
 * sert tout stockage compatible S3. Aucun message ne cite une adresse signée ni une clé d'accès.
 */
import { AwsClient } from 'aws4fetch'

/** Les cinq variables de l'hôte (ADR-016 § 2), toutes exigées. */
export const STORAGE_VARIABLES = /** @type {const} */ ([
  'PLATFORM_STORAGE_ENDPOINT',
  'PLATFORM_STORAGE_BUCKET',
  'PLATFORM_STORAGE_REGION',
  'PLATFORM_STORAGE_ACCESS_KEY_ID',
  'PLATFORM_STORAGE_SECRET_ACCESS_KEY',
])

/** Délai d'une opération sur le bucket (`HEAD`, copie, liste, suppression). */
export const OPERATION_TIMEOUT_MS = 10_000

/** Un envoi de plus : `aws4fetch` rejoue une réponse 5xx ou 429 ; dix fois par défaut, trop long dans une requête. */
const RETRIES = 1

/** Pages de 1 000 clés au plus lues par `listKeys`. */
const LIST_PAGES_MAX = 10

/**
 * @typedef {{ endpoint: string, bucket: string, region: string, accessKeyId: string, secretAccessKey: string }} StorageConfig
 */

/**
 * La configuration lue dans l'environnement, chaque valeur sans blancs autour ; `null` sans l'une des cinq variables.
 * @param {Record<string, string | undefined>} env
 * @returns {StorageConfig | null}
 */
export function storageConfig(env) {
  const [endpoint, bucket, region, accessKeyId, secretAccessKey] = STORAGE_VARIABLES.map((name) => env[name]?.trim() ?? '')
  if (!endpoint || !bucket || !region || !accessKeyId || !secretAccessKey) return null
  return { endpoint, bucket, region, accessKeyId, secretAccessKey }
}

/**
 * L'adresse du bucket, `<endpoint sans barre finale>/<bucket>`, ou ce qui ne va pas dans `PLATFORM_STORAGE_ENDPOINT`.
 * @param {StorageConfig} config
 * @returns {{ base: string } | { problem: string }}
 */
export function bucketBase(config) {
  let endpoint = config.endpoint
  while (endpoint.endsWith('/')) endpoint = endpoint.slice(0, -1)
  if (!URL.canParse(endpoint)) return { problem: 'PLATFORM_STORAGE_ENDPOINT is not an address' }
  const { protocol } = new URL(endpoint)
  if (protocol !== 'https:' && protocol !== 'http:') return { problem: 'PLATFORM_STORAGE_ENDPOINT is not an http(s) address' }
  return { base: `${endpoint}/${encodeURIComponent(config.bucket)}` }
}

/**
 * Le client SigV4 d'une configuration, service `s3`.
 * @param {StorageConfig} config
 */
export function s3Client(config) {
  return new AwsClient({ accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey, service: 's3', region: config.region, retries: RETRIES })
}

/**
 * L'échec d'une opération sur le bucket : son nom et le statut rendu, jamais l'adresse signée.
 * @param {string} operation
 * @param {number} status
 */
export function storageFailure(operation, status) {
  return new Error(`storage ${operation} answered HTTP ${status}`)
}

const XML_ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" }

/**
 * Les valeurs des balises `<name>` d'une réponse XML du bucket, entités décodées, par un parcours linéaire.
 * @param {string} xml
 * @param {string} name
 * @returns {string[]}
 */
function xmlValues(xml, name) {
  const values = []
  const open = `<${name}>`
  const close = `</${name}>`
  for (let at = xml.indexOf(open); at !== -1; at = xml.indexOf(open, at)) {
    const end = xml.indexOf(close, at + open.length)
    if (end === -1) break
    values.push(xml.slice(at + open.length, end).replace(/&(?:amp|lt|gt|quot|apos);/g, (entity) => XML_ENTITIES[entity] ?? entity))
    at = end + close.length
  }
  return values
}

/**
 * Une requête signée au bucket, sous le délai d'une opération.
 * @param {AwsClient} client
 * @returns {(url: string, method: string) => Promise<Response>}
 */
function sender(client) {
  return (url, method) => client.fetch(url, { method, signal: AbortSignal.timeout(OPERATION_TIMEOUT_MS) })
}

/**
 * Les clés sous un préfixe (ListObjectsV2), page par page, 10 000 au plus : les `<Key>` de la réponse, lus à la main
 * (une réponse du bucket, pas d'un client).
 * @param {AwsClient} client
 * @param {string} base  l'adresse du bucket (`bucketBase`)
 * @param {string} prefix
 * @returns {Promise<string[]>}
 */
export async function listKeys(client, base, prefix) {
  const send = sender(client)
  const keys = []
  let token = null
  for (let page = 0; page < LIST_PAGES_MAX; page++) {
    const query = new URLSearchParams({ 'list-type': '2', prefix, ...(token ? { 'continuation-token': token } : {}) })
    const answer = await send(`${base}?${query.toString()}`, 'GET')
    const body = await answer.text()
    if (!answer.ok) throw storageFailure('list', answer.status)
    keys.push(...xmlValues(body, 'Key'))
    token = xmlValues(body, 'NextContinuationToken')[0] ?? null
    if (token === null) break
  }
  return keys
}

/**
 * Supprime un objet ; un objet déjà absent (404) n'est pas une erreur.
 * @param {AwsClient} client
 * @param {string} base  l'adresse du bucket (`bucketBase`)
 * @param {string} key
 */
export async function removeObject(client, base, key) {
  const answer = await sender(client)(`${base}/${key}`, 'DELETE')
  await answer.body?.cancel()
  if (!answer.ok && answer.status !== 404) throw storageFailure('DELETE', answer.status)
}

/**
 * Le bucket vu par la commande : lister un préfixe, supprimer un objet ; ou ce qui ne va pas dans la configuration.
 * @param {StorageConfig} config
 * @returns {{ store: { list(prefix: string): Promise<string[]>, remove(key: string): Promise<void> } } | { problem: string }}
 */
export function bucketObjects(config) {
  const at = bucketBase(config)
  if ('problem' in at) return at
  const client = s3Client(config)
  return { store: { list: (prefix) => listKeys(client, at.base, prefix), remove: (key) => removeObject(client, at.base, key) } }
}
