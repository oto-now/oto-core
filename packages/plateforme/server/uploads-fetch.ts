// Le téléchargement d'une adresse fournie (E10-S02 lot f : AC-f12 à AC-f14 ; ADR-018 § 7) : la seule requête du paquet
// vers une adresse choisie par un appelant (`source_url` d'`upload.link`, pour un assistant sans shell). Contrôlés avant
// toute requête et à chaque redirection : le schéma `https`, le port 443, et chaque adresse que l'hôte résout, refusée
// si elle est privée, de bouclage, lien-local, réservée ou de métadonnées d'hébergeur. La résolution contrôlée est celle
// de la connexion (`lookup` de la requête) : une réponse DNS qui change entre le contrôle et la connexion ne passe pas.
// 3 redirections au plus, 10 s, 1 Mo lus au plus (`mcp-patterns.md § 6 bis`). Sans lui, un assistant sans shell n'aurait
// que le formulaire de dépôt.
import { lookup as dnsLookup } from "node:dns/promises"
import { request as httpsRequest } from "node:https"
import { BlockList, isIP, type LookupFunction } from "node:net"
import { UPLOAD_BYTES_MAX } from "../schemas"
import { readBounded } from "./bounded-read"

const TIMEOUT_MS = 10_000
const REDIRECTS_MAX = 3
const REDIRECTS: ReadonlySet<number> = new Set([301, 302, 303, 307, 308])

/** Les causes d'un échec, en une phrase, sans l'adresse ni le contenu (AC-f14). */
export const SOURCE_FAILURES = {
  unreadable: "source_url is not a valid address",
  scheme: "source_url must be an https address",
  port: "source_url must use the port 443",
  address: "source_url leads to a private, loopback, link-local or metadata address",
  redirects: `source_url redirects more than ${REDIRECTS_MAX} times`,
  timeout: `source_url did not answer within ${TIMEOUT_MS / 1000} s`,
  tooLarge: "source_url serves more than 1 MB",
  unreachable: "source_url could not be reached",
} as const

/**
 * Ce qu'aucune adresse fournie ne joint : réseaux privés et partagés (RFC 1918, 100.64/10, qui porte aussi les
 * métadonnées d'Alibaba), bouclage, lien-local (169.254/16, dont les métadonnées d'AWS, de GCP et d'Azure ; fe80::/10),
 * adresses non spécifiées, de documentation, réservées et de multidiffusion, ULA (fc00::/7, dont fd00:ec2::254), et les
 * formes IPv6 qui portent une adresse IPv4 (compatible, mappée, NAT64 et NAT64 local, 6to4, Teredo), refusées entières.
 * Une liste par famille : une seule `BlockList` confronte aussi une adresse IPv4 aux règles IPv6 par sa forme mappée,
 * et `::ffff:0:0/96` y refuserait toute adresse IPv4.
 */
const BLOCKED = { ipv4: new BlockList(), ipv6: new BlockList() } as const
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
  BLOCKED.ipv4.addSubnet(network, prefix, "ipv4")
}
for (const [network, prefix] of [
  ["::", 96],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 32],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  BLOCKED.ipv6.addSubnet(network, prefix, "ipv6")
}

/** Une adresse publique : ni bloquée ni illisible. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 0) return false
  const type = family === 6 ? "ipv6" : "ipv4"
  return !BLOCKED[type].check(address, type)
}

/** Une adresse résolue, comme la rend `dns.lookup` avec `all: true`. */
export type ResolvedAddress = { address: string; family: number }

/** La résolution d'un nom d'hôte, toutes ses adresses. */
export type Resolve = (hostname: string) => Promise<ResolvedAddress[]>

/** Une réponse : son statut, sa redirection, sa taille et son type annoncés, son corps, et de quoi l'abandonner. */
export type SourceAnswer = { status: number; location: string | null; length: number | null; type: string | null; body: AsyncIterable<Uint8Array>; discard: () => void }

/** Une requête `GET`, dont la connexion résout son hôte par `lookup` ; `signal` l'arrête. */
export type SourceGet = (url: URL, lookup: LookupFunction, signal: AbortSignal) => Promise<SourceAnswer>

/** Les octets téléchargés et le type annoncé (`Content-Type`, `null` sans lui), ou la cause d'un échec. */
export type Fetched = { bytes: Uint8Array; type: string | null } | { failure: string }

/** Un type servi, cité par un échec : 100 caractères au plus. */
const clipType = (media: string) => (media.length > 100 ? `${media.slice(0, 100)}…` : media)

/**
 * Ce qu'un `.md` ou un CSV téléchargé peut être (FB-0014, HN-E10S02-118) : un type `text/*` autre que `text/html`,
 * `application/octet-stream`, ou aucun type annoncé ; paramètres (`; charset=…`) ignorés, sans casse. Sinon la cause
 * d'échec qui nomme le type servi, jamais l'adresse (AC-f14).
 */
export function textSourceFailure(type: string | null): string | null {
  const media = (type ?? "").split(";")[0].trim().toLowerCase()
  if (media === "" || media === "application/octet-stream" || (media.startsWith("text/") && media !== "text/html")) return null
  return `source_url serves ${clipType(media)}, not a text file: a markdown file or a CSV is read from text/markdown, text/plain or text/csv`
}

const systemResolve: Resolve = (hostname) => dnsLookup(hostname, { all: true, verbatim: true })

const httpsGet: SourceGet = (url, lookup, signal) =>
  new Promise((resolve, reject) => {
    const outgoing = httpsRequest(url, { method: "GET", lookup, signal, headers: { accept: "*/*", "user-agent": "oto-platform upload.link" } }, (incoming) => {
      const length = incoming.headers["content-length"]
      resolve({
        status: incoming.statusCode ?? 0,
        location: incoming.headers.location ?? null,
        length: length === undefined ? null : Number(length),
        type: incoming.headers["content-type"] ?? null,
        body: incoming,
        discard: () => incoming.destroy(),
      })
    })
    outgoing.on("error", reject)
    outgoing.end()
  })

/**
 * La résolution de la connexion, contrôlée : toutes les adresses de l'hôte doivent être publiques, sinon la connexion
 * échoue et `refused` le dit. C'est l'adresse contrôlée que la connexion joint.
 */
function checkedLookup(resolve: Resolve, refused: { address: boolean }): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname).then(
      (addresses) => {
        if (addresses.length === 0 || !addresses.every((one) => isPublicAddress(one.address))) {
          refused.address = true
          callback(Object.assign(new Error("address refused"), { code: "EADDRREFUSED" }), "", 0)
          return
        }
        if (options.all) callback(null, addresses)
        else callback(null, addresses[0].address, addresses[0].family)
      },
      (error: NodeJS.ErrnoException) => callback(error, "", 0),
    )
  }
}

/** Ce qu'une adresse refuse avant toute requête : schéma, port, adresse IP littérale non publique. */
function refusal(url: URL): string | null {
  if (url.protocol !== "https:") return SOURCE_FAILURES.scheme
  if (url.port !== "" && url.port !== "443") return SOURCE_FAILURES.port
  const host = url.hostname.replace(/^\[(.*)\]$/, "$1")
  return isIP(host) !== 0 && !isPublicAddress(host) ? SOURCE_FAILURES.address : null
}

/** Ce qu'une source sert au-delà de la borne de son appel. */
function tooLarge(maxBytes: number): string {
  return maxBytes === UPLOAD_BYTES_MAX ? SOURCE_FAILURES.tooLarge : `source_url serves more than ${Math.round(maxBytes / (1024 * 1024))} MB`
}

/** Le corps, lu par morceaux et coupé au-delà de la borne (`readBounded`), 1 Mo à défaut. */
async function boundedBody(answer: SourceAnswer, maxBytes: number): Promise<Fetched> {
  const read = await readBounded(answer.body, maxBytes, () => {
    answer.discard()
    return { failure: tooLarge(maxBytes) }
  })
  return read instanceof Uint8Array ? { bytes: read, type: answer.type } : read
}

type Hop = { next: URL } | Fetched

/** Une requête de la chaîne : une redirection à suivre, ou l'issue (octets, cause). */
async function hop(url: URL, deps: { resolve: Resolve; get: SourceGet; signal: AbortSignal; maxBytes: number }): Promise<Hop> {
  const refused = { address: false }
  let answer: SourceAnswer
  try {
    answer = await deps.get(url, checkedLookup(deps.resolve, refused), deps.signal)
  } catch {
    // La cause se lit sur l'état, jamais dans le message d'une erreur réseau (qui citerait l'adresse).
    if (refused.address) return { failure: SOURCE_FAILURES.address }
    return { failure: deps.signal.aborted ? SOURCE_FAILURES.timeout : SOURCE_FAILURES.unreachable }
  }
  if (REDIRECTS.has(answer.status) && answer.location) {
    answer.discard()
    return { next: new URL(answer.location, url) }
  }
  if (answer.status < 200 || answer.status > 299) {
    answer.discard()
    return { failure: `source_url answered ${answer.status}` }
  }
  if (answer.length !== null && answer.length > deps.maxBytes) {
    answer.discard()
    return { failure: tooLarge(deps.maxBytes) }
  }
  return boundedBody(answer, deps.maxBytes)
}

/**
 * Télécharge une adresse fournie (AC-f12, AC-f13) : chaque adresse de la chaîne contrôlée avant sa requête, 3
 * redirections au plus, 10 s en tout, 1 Mo lus au plus (`maxBytes` : la borne d'un autre appelant, l'import d'un arbre). Rend les octets, ou la cause d'un échec, en une phrase sans
 * l'adresse (AC-f14). `deps` : la résolution, la requête et le délai, que les tests remplacent (aucun réseau, aucune
 * attente de 10 s).
 */
export async function fetchSource(source: string, deps: { resolve?: Resolve; get?: SourceGet; timeoutMs?: number; maxBytes?: number } = {}): Promise<Fetched> {
  const signal = AbortSignal.timeout(deps.timeoutMs ?? TIMEOUT_MS)
  const chain = { resolve: deps.resolve ?? systemResolve, get: deps.get ?? httpsGet, signal, maxBytes: deps.maxBytes ?? UPLOAD_BYTES_MAX }
  try {
    let url = new URL(source)
    for (let redirects = 0; ; redirects++) {
      const refused = refusal(url)
      if (refused) return { failure: refused }
      const outcome = await hop(url, chain)
      if (!("next" in outcome)) return outcome
      if (redirects === REDIRECTS_MAX) return { failure: SOURCE_FAILURES.redirects }
      url = outcome.next
    }
  } catch (error) {
    // Une adresse illisible (la première ou une redirection), ou un corps coupé en cours de lecture.
    if (signal.aborted) return { failure: SOURCE_FAILURES.timeout }
    const invalid = typeof error === "object" && error !== null && "code" in error && error.code === "ERR_INVALID_URL"
    return { failure: invalid ? SOURCE_FAILURES.unreadable : SOURCE_FAILURES.unreachable }
  }
}
