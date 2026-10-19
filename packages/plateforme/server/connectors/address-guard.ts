// La garde d'une adresse saisie (`connecteurs-et-comptes.md` § Comptes à plusieurs champs et réglages) : quand l'hôte
// d'une requête vient d'un réglage de compte (une adresse libre, un sous-domaine), la requête ne part qu'en `https`, vers
// un hôte qui ne résout jamais vers une adresse privée, de bouclage, lien-local ou de métadonnées, et aucune
// redirection n'est suivie. La résolution est contrôlée au moment même de la connexion (`lookup` de `node:https`), à
// chaque appel : une adresse vérifiée puis résolue autrement (DNS à durée nulle) ne passe pas. Sans ce module, un
// administrateur pourrait faire appeler par le serveur de l'hôte son réseau interne ou le service de métadonnées de
// son hébergeur. `fetch` ne laisse pas contrôler sa résolution sans dépendance (`undici`) : ce transport-ci la tient
// avec `node:https` seul, à la forme de `Fetch`.
import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from "node:dns"
import { request } from "node:https"
import { BlockList, isIP } from "node:net"
import { Readable } from "node:stream"
import { PlatformError } from "../errors"
import type { Fetch } from "./http"

/** Plages jamais jointes depuis une adresse saisie : privées, bouclage, lien-local (métadonnées), réservées. */
const INTERNAL = new BlockList()
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  INTERNAL.addSubnet(network, prefix, "ipv4")
}
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  INTERNAL.addSubnet(network, prefix, "ipv6")
}

/** L'IPv4 que porte une IPv6 (`::ffff:10.0.0.1`, `64:ff9b::a00:1`), contrôlée comme une IPv4. */
function embeddedIpv4(address: string): string | null {
  const dotted = /^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/i.exec(address)
  if (dotted) return dotted[1]
  const hex = /^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(address)
  if (!hex) return null
  const [high, low] = [parseInt(hex[1], 16), parseInt(hex[2], 16)]
  return [high >> 8, high & 255, low >> 8, low & 255].join(".")
}

/** Vrai pour une adresse IP publique ; faux pour une adresse interne, ou pour ce qui n'est pas une adresse IP. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 0) return false
  const v4 = family === 6 ? embeddedIpv4(address) : address
  if (v4 !== null) return !INTERNAL.check(v4, "ipv4")
  return !INTERNAL.check(address, "ipv6")
}

type Lookup = typeof dnsLookup
type LookupDone = (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void

/** Le refus d'un hôte interne : nommé, jamais avec l'adresse demandée (elle peut porter une clé en query). */
const internalHost = (host: string) =>
  new PlatformError("not_enabled", `The address of this account resolves to a private or internal host (${host}): refused. Ask whoever manages the account to fix its settings.`)

/** La résolution de `node:https`, refusée dès qu'une adresse rendue est interne. */
function guardedLookup(resolve: Lookup) {
  return (hostname: string, options: LookupOptions, done: LookupDone) => {
    resolve(hostname, { ...options, all: true }, (error, addresses) => {
      if (error) return done(error, [])
      if (addresses.length === 0 || addresses.some((entry) => !isPublicAddress(entry.address))) return done(internalHost(hostname) as unknown as NodeJS.ErrnoException, [])
      if (options.all) return done(null, addresses)
      done(null, addresses[0].address, addresses[0].family)
    })
  }
}

/** En-têtes Node vers `Headers` ; un en-tête répété garde chaque valeur. */
function headersOf(raw: NodeJS.Dict<string | string[]>): Headers {
  const headers = new Headers()
  for (const [name, value] of Object.entries(raw)) {
    for (const item of [value ?? []].flat()) headers.append(name, item)
  }
  return headers
}

/**
 * Le corps qu'envoie le transport gardé : un texte (JSON, formulaire) ou des octets (corps multipart déjà encodé). Une
 * autre forme (flux, `FormData`) ne part jamais en silence sans son contenu : elle lève.
 */
function sentBody(body: RequestInit["body"]): string | Uint8Array | undefined {
  if (body === undefined || body === null) return undefined
  if (typeof body === "string" || body instanceof Uint8Array) return body
  throw new Error("[platform] connectors: the guarded transport sends a text or bytes body only")
}

/**
 * Un `fetch` gardé pour une adresse saisie : `https` seul, hôte en adresse IP ou résolu contrôlé à la connexion, aucune
 * redirection suivie (une réponse 3xx est rendue telle quelle, le client la refuse comme tout statut hors 2xx).
 * `resolve` : la résolution, remplacée par les tests.
 */
export function guardedFetch(resolve: Lookup = dnsLookup): Fetch {
  return (input, init) =>
    new Promise<Response>((settle, fail) => {
      const url = new URL(input)
      const host = url.hostname.replace(/^\[|\]$/g, "")
      if (url.protocol !== "https:") return fail(new PlatformError("not_enabled", "The address of this account must use https: refused."))
      if (isIP(host) && !isPublicAddress(host)) return fail(internalHost(host))
      const headers = Object.fromEntries(new Headers(init.headers))
      // Avant toute connexion : un corps d'une autre forme rejette l'appel sans rien ouvrir.
      const payload = sentBody(init.body)
      const sent = request(url, { method: init.method, headers, signal: init.signal ?? undefined, lookup: guardedLookup(resolve) }, (answer) => {
        const status = answer.statusCode ?? 502
        const body = status === 204 || status === 304 ? null : (Readable.toWeb(answer) as ReadableStream<Uint8Array>)
        settle(new Response(body, { status, headers: headersOf(answer.headers) }))
      })
      // Un délai dépassé se dit comme `fetch` le dit (`TimeoutError`), pour le message du client.
      sent.on("error", (error) => fail(init.signal?.aborted ? init.signal.reason : error))
      sent.end(payload)
    })
}
