// Émetteur des jetons de l'hôte (E01-S11, ADR-012 § 1) : un hôte, un émetteur (HN-E01S11-1), lu
// dans sa configuration à chaque vérification, jamais à l'import (`pnpm build` passe sans variable).
// Sans `PLATFORM_OIDC_ISSUER`, Supabase Auth, déduit de `NEXT_PUBLIC_SUPABASE_URL`, comme avant
// (AC-a1) ; avec elle, un émetteur OpenID Connect, dont la découverte donne les clés et le point
// `userinfo` (AC-a2), et dont chaque jeton porte `PLATFORM_OIDC_AUDIENCE` (AC-a3). Sans ce module,
// aucun jeton d'un autre émetteur que Supabase Auth n'est accepté, et les métadonnées ne désignent que
// lui. Une configuration fausse se dit par le nom de sa variable, jamais par sa valeur (AC-a11).
//
// Repris d'Oto 1 (`oto-backend/docs/auth-logto.md`) : l'émetteur comparé exactement, tel que
// l'instance le grave (barre finale comprise). Retiré : la façade d'enregistrement dynamique, le relais
// d'autorisation et les jetons maison, aucune façade devant l'émetteur (ADR-004, ADR-012 § 2).
import { isJsonObject } from "./json"
import { PlatformConfigError } from "./sql"

/** L'émetteur des jetons : Supabase Auth du projet (`aud` non vérifiée), ou un émetteur OIDC et son audience. */
type IssuerConfig = { kind: "supabase"; issuer: string } | { kind: "oidc"; issuer: string; audience: string }

/**
 * Ce que le paquet lit de la découverte d'un émetteur OIDC ; `tokenEndpoint` : son point de jeton, où s'échange le jeton
 * d'une personne contre celui de l'API d'un hôte (`host-api/exchange.ts`), `null` s'il n'en publie pas.
 */
type Discovery = { jwksUri: string; userinfoEndpoint: string | null; tokenEndpoint: string | null }

/** La machine locale, seule à se joindre en `http` (un émetteur de développement). `URL` rend une adresse IPv6 entre crochets. */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"])
/** Délai d'une lecture de la découverte : au-delà, le jeton est refusé et la panne dite au log. */
const DISCOVERY_TIMEOUT_MS = 5_000
/** Durée de vie de la découverte gardée : un changement de ses points se voit au plus tard après elle. */
const DISCOVERY_TTL_MS = 60 * 60 * 1000
/**
 * Durée de vie d'un échec gardé : pendant une panne de l'émetteur, un flot de jetons, même faux, ne
 * relance pas une lecture chacun ; passé ce délai, la requête suivante relit.
 */
const DISCOVERY_FAILURE_TTL_MS = 10_000

/** Une adresse d'émetteur ou de l'un de ses points : `https`, ou `http` sur la machine locale ; `null` sinon. */
function secureUrl(value: string): URL | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    // Une adresse illisible se nomme par sa variable ou son champ, jamais par l'erreur d'analyse.
    return null
  }
  const local = url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname)
  return url.protocol === "https:" || local ? url : null
}

/**
 * Le mode OIDC de l'hôte : `PLATFORM_OIDC_ISSUER` posée (HN-E01S11-1). Sans contrôle de sa valeur, que
 * la vérification de chaque jeton fait (`issuerConfig`) : ce que Supabase Auth porte seul chez un hôte
 * Supabase (lien magique, consentement) s'arrête dès qu'un autre émetteur est déclaré. `env` : celui que
 * l'état de la cellule contrôle (`cell.ts`, M50).
 */
export function oidcMode(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.PLATFORM_OIDC_ISSUER)
}

/**
 * L'émetteur configuré. Lève `PlatformConfigError`, qui nomme la variable, quand il n'y en a aucun
 * (ni `PLATFORM_OIDC_ISSUER` ni `NEXT_PUBLIC_SUPABASE_URL`), quand `PLATFORM_OIDC_ISSUER` n'est pas
 * une adresse `https` sans requête ni fragment (OpenID Connect Discovery, § 2), ou quand
 * `PLATFORM_OIDC_AUDIENCE` manque en mode OIDC (AC-a3).
 */
export function issuerConfig(): IssuerConfig {
  const oidc = process.env.PLATFORM_OIDC_ISSUER
  if (!oidc) {
    const project = process.env.NEXT_PUBLIC_SUPABASE_URL
    if (!project) throw new PlatformConfigError("NEXT_PUBLIC_SUPABASE_URL missing, and no PLATFORM_OIDC_ISSUER: no issuer")
    return { kind: "supabase", issuer: `${project.replace(/\/+$/, "")}/auth/v1` }
  }
  const url = secureUrl(oidc)
  if (!url || url.search || url.hash) throw new PlatformConfigError("PLATFORM_OIDC_ISSUER is not an https address without query nor fragment")
  const audience = process.env.PLATFORM_OIDC_AUDIENCE
  if (!audience) throw new PlatformConfigError("PLATFORM_OIDC_AUDIENCE missing: required with PLATFORM_OIDC_ISSUER")
  return { kind: "oidc", issuer: oidc, audience }
}

/**
 * Adresses de la découverte, dans l'ordre (AC-a2) : OpenID Connect Discovery (§ 4, barre finale de
 * l'émetteur retirée avant d'ajouter le suffixe), puis les métadonnées d'un serveur OAuth (RFC 8414,
 * § 3.1 : suffixe inséré entre l'hôte et le chemin de l'émetteur).
 */
function discoveryUrls(issuer: URL): string[] {
  const path = issuer.pathname.replace(/\/$/, "")
  return [`${issuer.origin}${path}/.well-known/openid-configuration`, `${issuer.origin}/.well-known/oauth-authorization-server${path}`]
}

function optionalEndpoint(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== "string" || !secureUrl(value)) throw new PlatformConfigError(`PLATFORM_OIDC_ISSUER: discovery ${field} is not an https address`)
  return value
}

/** Le document lu : l'émetteur exact (OpenID Connect Discovery, § 4.3 ; RFC 8414, § 3.3), `jwks_uri` exigée (AC-a11). */
function discoveryOf(issuer: string, document: unknown): Discovery {
  if (!isJsonObject(document)) throw new PlatformConfigError("PLATFORM_OIDC_ISSUER: discovery document is not a JSON object")
  if (document.issuer !== issuer) throw new PlatformConfigError("PLATFORM_OIDC_ISSUER: discovery names another issuer (compare the trailing slash)")
  const jwksUri = optionalEndpoint(document.jwks_uri, "jwks_uri")
  if (!jwksUri) throw new PlatformConfigError("PLATFORM_OIDC_ISSUER: discovery has no jwks_uri")
  return {
    jwksUri,
    userinfoEndpoint: optionalEndpoint(document.userinfo_endpoint, "userinfo_endpoint"),
    tokenEndpoint: optionalEndpoint(document.token_endpoint, "token_endpoint"),
  }
}

async function readDiscovery(issuer: string): Promise<Discovery> {
  const url = secureUrl(issuer)
  if (!url) throw new PlatformConfigError("PLATFORM_OIDC_ISSUER is not an https address")
  for (const address of discoveryUrls(url)) {
    let response: Response
    try {
      response = await fetch(address, { headers: { accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS) })
    } catch (error) {
      throw new PlatformConfigError(`PLATFORM_OIDC_ISSUER unreachable (${error instanceof Error ? error.name : "error"})`)
    }
    if (response.status === 404) continue
    if (!response.ok) throw new PlatformConfigError(`PLATFORM_OIDC_ISSUER: discovery answered HTTP ${response.status}`)
    let document: unknown
    try {
      document = await response.json()
    } catch {
      // Un corps illisible est une configuration fausse, pas une panne à relancer.
      throw new PlatformConfigError("PLATFORM_OIDC_ISSUER: discovery document is not JSON")
    }
    return discoveryOf(issuer, document)
  }
  throw new PlatformConfigError("PLATFORM_OIDC_ISSUER: no discovery document (openid-configuration, oauth-authorization-server)")
}

// Une entrée : un hôte n'a qu'un émetteur. Une lecture en cours sert aussi les requêtes qui arrivent
// pendant elle ; un échec est gardé `DISCOVERY_FAILURE_TTL_MS`, la même erreur rendue à chacune.
let discovered: { issuer: string; until: number; value: Promise<Discovery> } | null = null

/**
 * La découverte de l'émetteur, gardée une heure (AC-a2). Lève `PlatformConfigError`, qui nomme
 * `PLATFORM_OIDC_ISSUER`, quand l'émetteur est injoignable, sans document, ou sans `jwks_uri` (AC-a11) ;
 * cet échec est gardé dix secondes.
 */
export function discover(issuer: string): Promise<Discovery> {
  if (discovered?.issuer === issuer && Date.now() < discovered.until) return discovered.value
  const entry = { issuer, until: Date.now() + DISCOVERY_TTL_MS, value: readDiscovery(issuer) }
  discovered = entry
  entry.value.catch(() => {
    entry.until = Date.now() + DISCOVERY_FAILURE_TTL_MS
  })
  return entry.value
}
