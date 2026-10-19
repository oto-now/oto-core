// Session OIDC de l'hôte de référence (E01-S11 partie b, ADR-012 § 1). Hors Supabase, la personne se
// connecte chez l'émetteur de l'hôte (fiche D79) ; l'hôte garde ses jetons dans un cookie chiffré
// (`PLATFORM_SESSION_SECRET`, AES-GCM), que les écrans et la route de l'API lisent et que le middleware
// rafraîchit, et sert les trois routes `/auth/oidc/*`. Sans ce module, personne ne se connecte aux
// écrans hors Supabase, et la route de l'API n'a aucun jeton à passer au paquet. Les échanges avec
// l'émetteur sont dans `oidc-client.ts`. Chargé par le middleware (Edge) : aucune API propre à Node.
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import {
  authorizationRequest,
  exchangeCode,
  OidcConfigError,
  oidcConfig,
  oidcFailure,
  refreshSession,
  sessionSecret,
  signOutAtIssuer,
  type OidcConfig,
  type OidcSession,
  type PendingLogin,
} from "@/lib/plateforme/oidc-client"
import { safeRedirect } from "@/lib/schemas/auth"

// `__Host-` : un cookie de cet hôte seul, `Secure` et sur `/`, qu'aucun sous-domaine voisin ne peut
// poser à sa place. Chaque hôte (chaque organisation) a donc sa propre session.
const SESSION_COOKIE = "__Host-plateforme-session"
const LOGIN_COOKIE = "__Host-plateforme-oidc"
const COOKIE = { httpOnly: true, secure: true, sameSite: "lax", path: "/" } as const
/** Durée du cookie ; le jeton de rafraîchissement, réglé chez l'émetteur, borne la session réelle. */
const SESSION_MAX_AGE_S = 14 * 24 * 60 * 60
/** Le temps de se connecter chez l'émetteur. */
const LOGIN_MAX_AGE_S = 10 * 60
// Un cookie tient sous 4 096 octets : la session (trois jetons, ceux de Keycloak dépassent chacun
// 1 Ko) se découpe en morceaux ; au-delà de quatre, l'en-tête des requêtes deviendrait trop gros.
const CHUNK_CHARS = 3_000
const MAX_CHUNKS = 4
/** Rafraîchi une minute avant son expiration : la page, puis l'API, reçoivent un jeton encore valide. */
const REFRESH_MARGIN_MS = 60_000

const REFUSED = "La connexion n'a pas abouti. Recommencez depuis la page de connexion."
const UNAVAILABLE = "La connexion est indisponible pour le moment. Réessayez dans un instant."

const sessionSchema = z.object({
  subject: z.string().min(1),
  email: z.string().nullable(),
  name: z.string().nullable(),
  accessToken: z.string().min(1),
  refreshToken: z.string().nullable(),
  idToken: z.string().nullable(),
  expiresAt: z.number(),
}) satisfies z.ZodType<OidcSession>

const pendingSchema = z.object({
  state: z.string(),
  nonce: z.string(),
  codeVerifier: z.string(),
  redirectUri: z.string(),
  next: z.string(),
}) satisfies z.ZodType<PendingLogin>

type CookieReader = { get(name: string): { value: string } | undefined; getAll(): { name: string }[] }
type CookieWriter = { set(name: string, value: string, options: typeof COOKIE & { maxAge: number }): unknown }

const encoder = new TextEncoder()
let sealingKey: { secret: string; key: Promise<CryptoKey> } | null = null

/** La clé AES-GCM tirée de `PLATFORM_SESSION_SECRET` (HKDF), une fois par instance. */
function keyOf(secret: string): Promise<CryptoKey> {
  if (sealingKey?.secret !== secret) {
    const info = encoder.encode("oto-platform session cookie")
    const key = crypto.subtle
      .importKey("raw", encoder.encode(secret), "HKDF", false, ["deriveKey"])
      .then((material) => crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]))
    sealingKey = { secret, key }
  }
  return sealingKey.key
}

function base64Url(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  try {
    return Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0))
  } catch {
    // Pas du base64url : un cookie altéré, qui ne se déchiffre pas.
    return null
  }
}

/** Chiffré et authentifié (AES-GCM) ; `purpose` lie le texte à son cookie, l'un ne sert pas pour l'autre. */
async function seal(value: unknown, purpose: string, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(purpose) }, await keyOf(secret), encoder.encode(JSON.stringify(value)))
  return `${base64Url(iv)}.${base64Url(new Uint8Array(data))}`
}

async function unseal(sealed: string, purpose: string, secret: string): Promise<unknown> {
  const [iv, data, ...rest] = sealed.split(".").map(fromBase64Url)
  if (!iv || !data || rest.length > 0) return null
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(purpose) }, await keyOf(secret), data)
    return JSON.parse(new TextDecoder().decode(plain))
  } catch {
    // Altéré, chiffré par une autre clé, ou illisible : aucune session, jamais une erreur.
    return null
  }
}

/** La session chiffrée ; `null`, au log, quand elle dépasse ce que ses cookies tiennent. */
async function sealSession(session: OidcSession, secret: string): Promise<string | null> {
  const sealed = await seal(session, "session", secret)
  if (sealed.length <= CHUNK_CHARS * MAX_CHUNKS) return sealed
  console.error(`[oidc] session: ${sealed.length} characters, more than its ${MAX_CHUNKS} cookies hold`)
  return null
}

function chunkName(index: number): string {
  return `${SESSION_COOKIE}.${index}`
}

async function readSession(jar: CookieReader, secret: string): Promise<OidcSession | null> {
  let sealed = ""
  for (let index = 0; index < MAX_CHUNKS; index += 1) {
    const part = jar.get(chunkName(index))?.value
    if (!part) break
    sealed += part
  }
  if (!sealed) return null
  return sessionSchema.safeParse(await unseal(sealed, "session", secret)).data ?? null
}

/** Les morceaux de `sealed` (`""` : aucune session), et `""` pour chaque morceau d'une session précédente à retirer. */
function sessionCookies(sealed: string, existing: CookieReader): Map<string, string> {
  const cookies = new Map<string, string>()
  for (const { name } of existing.getAll()) if (name.startsWith(`${SESSION_COOKIE}.`)) cookies.set(name, "")
  for (let index = 0; index * CHUNK_CHARS < sealed.length; index += 1) {
    cookies.set(chunkName(index), sealed.slice(index * CHUNK_CHARS, (index + 1) * CHUNK_CHARS))
  }
  return cookies
}

// Un cookie `__Host-` ne se retire que par un cookie `Secure` sur `/` : `delete` de Next ne pose ni
// l'un ni l'autre, et le navigateur l'ignorerait.
function applyCookies(jar: CookieWriter, cookies: Map<string, string>): void {
  for (const [name, value] of cookies) jar.set(name, value, { ...COOKIE, maxAge: value ? SESSION_MAX_AGE_S : 0 })
}

/**
 * La session dont le jeton d'accès vaut encore, déchiffrée et relue : celle des écrans et de la route
 * de l'API ; `null` sans cookie, altéré ou expiré. N'en rafraîchit rien (le middleware le fait).
 */
export async function currentOidcSession(jar: CookieReader): Promise<OidcSession | null> {
  const session = await readSession(jar, sessionSecret())
  return session && session.expiresAt > Date.now() ? session : null
}

/**
 * La session de la requête pour le middleware (AC-b3). Un jeton d'accès qui expire dans la minute est
 * rafraîchi en silence, posé sur la requête (la page le lit) et sur la réponse (le navigateur le
 * garde). Sur un refus, la session reste tant que son jeton vaut encore (une requête voisine l'a
 * peut-être déjà rafraîchie), puis se retire. `signedIn` : une session utilisable.
 */
export async function oidcMiddlewareSession(request: NextRequest): Promise<{ response: NextResponse; signedIn: boolean }> {
  const pass = (signedIn: boolean) => ({ response: NextResponse.next({ request }), signedIn })
  // Sans cookie de session (appel d'un assistant au MCP, visiteur), rien à lire : la configuration n'est
  // lue, et une configuration fausse dite au log, qu'à une session.
  if (!request.cookies.has(chunkName(0))) return pass(false)
  let config: OidcConfig
  let session: OidcSession | null
  try {
    config = oidcConfig()
    session = await readSession(request.cookies, config.secret)
  } catch (error) {
    console.error(`[oidc] session: ${oidcFailure(error)}, no session`)
    return pass(false)
  }
  const now = Date.now()
  if (session && session.expiresAt - now > REFRESH_MARGIN_MS) return pass(true)
  const renewed = session ? await refreshSession(config, session) : null
  const sealed = renewed ? await sealSession(renewed, config.secret) : null
  if (!sealed && session && session.expiresAt > now) return pass(true)
  const cookies = sessionCookies(sealed ?? "", request.cookies)
  for (const [name, value] of cookies) {
    if (value) request.cookies.set(name, value)
    else request.cookies.delete(name)
  }
  const response = NextResponse.next({ request })
  applyCookies(response.cookies, cookies)
  return { response, signedIn: Boolean(sealed) }
}

function text(status: number, body: string): NextResponse {
  return new NextResponse(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } })
}

/** Une route `/auth/oidc/*` : une configuration manquante ou fausse répond 500, la variable nommée au log. */
async function oidcRoute(step: string, handle: (config: OidcConfig) => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await handle(oidcConfig())
  } catch (error) {
    if (!(error instanceof OidcConfigError)) throw error
    console.error(`[oidc] ${step}: ${error.message}`)
    return text(500, UNAVAILABLE)
  }
}

/**
 * `/auth/oidc/login` (AC-b1) : redirection vers l'émetteur, et cookie de la connexion en cours (dix
 * minutes) ; `origin` : l'adresse appelée, où l'émetteur ramènera. 502 quand l'émetteur ne répond pas.
 */
export function oidcLogin(origin: string | null, next: string): Promise<NextResponse> {
  return oidcRoute("login", async (config) => {
    if (!origin) return text(400, REFUSED)
    const request = await authorizationRequest(config, origin, safeRedirect(next))
    if (!request) return text(502, UNAVAILABLE)
    const response = NextResponse.redirect(request.url)
    response.cookies.set(LOGIN_COOKIE, await seal(request.pending, "login", config.secret), { ...COOKIE, maxAge: LOGIN_MAX_AGE_S })
    return response
  })
}

/**
 * `/auth/oidc/callback` (AC-b2) : le code échangé contre la connexion en cours de ce navigateur,
 * `accept` appelé avec la session (invitations en attente), puis la page demandée, session posée.
 * Sur tout refus (`state` qui ne correspond pas, `id_token` refusé), 400, et rien n'est posé.
 */
export function oidcCallback(request: NextRequest, origin: string | null, accept: (session: OidcSession) => Promise<void>): Promise<NextResponse> {
  return oidcRoute("callback", async (config) => {
    const sealed = request.cookies.get(LOGIN_COOKIE)?.value
    const pending = sealed ? pendingSchema.safeParse(await unseal(sealed, "login", config.secret)).data : undefined
    if (!pending || !origin) {
      console.error("[oidc] callback: no sign-in in progress in this browser, or no trusted address")
      return text(400, REFUSED)
    }
    const session = await exchangeCode(config, pending, new URL(request.url).searchParams)
    const sessionSealed = session ? await sealSession(session, config.secret) : null
    if (!session || !sessionSealed) return text(400, REFUSED)
    await accept(session)
    // `next` a passé `safeRedirect` au départ (`oidcLogin`) ; le cookie chiffré l'a gardé intact.
    const response = NextResponse.redirect(new URL(pending.next, origin))
    applyCookies(response.cookies, sessionCookies(sessionSealed, request.cookies))
    response.cookies.set(LOGIN_COOKIE, "", { ...COOKIE, maxAge: 0 })
    return response
  })
}

/**
 * `/auth/oidc/logout` (AC-b4) : le jeton de rafraîchissement révoqué, chaque cookie de la session retiré,
 * et la personne envoyée chez l'émetteur.
 */
export function oidcLogout(request: NextRequest, origin: string): Promise<NextResponse> {
  return oidcRoute("logout", async (config) => {
    const session = await readSession(request.cookies, config.secret)
    const response = NextResponse.redirect(await signOutAtIssuer(config, session, origin), 303)
    applyCookies(response.cookies, sessionCookies("", request.cookies))
    return response
  })
}

/**
 * La même déconnexion depuis une Server Action (« Se déconnecter ») : les cookies de `jar`
 * (`cookies()`) retirés, et l'adresse où l'action envoie la personne. Lève `OidcConfigError`.
 */
export async function endOidcSession(jar: CookieReader & CookieWriter, origin: string | null): Promise<string> {
  const config = oidcConfig()
  const session = await readSession(jar, config.secret)
  applyCookies(jar, sessionCookies("", jar))
  return signOutAtIssuer(config, session, origin)
}
