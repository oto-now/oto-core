import { cache } from "react"
import { cookies, headers } from "next/headers"
import { unstable_rethrow } from "next/navigation"
import type { Session, User } from "@supabase/supabase-js"
import {
  acceptInvitations,
  callerName,
  createPlatformDb,
  isPlatformError,
  rawRequestHost,
  requestOrigin,
  resolveIdentity,
  type Caller,
  type Identity,
  type PlatformDb,
} from "@otomata_tech/oto_platform/server"
import { oidcEnabled, type OidcSession } from "@/lib/plateforme/oidc-client"
import { currentOidcSession } from "@/lib/plateforme/oidc-session"
import { createClient } from "@/lib/supabase/server"

// Ce que les pages, le layout et les actions de l'hôte savent de la session pour parler au paquet :
// l'utilisateur vérifié, son jeton, l'hôte de la requête et le client du paquet. L'hôte compose ses
// deux clients (starter et `createPlatformDb`), il n'en crée pas un troisième ; il ne résout pas
// l'identité lui-même : le paquet le fait (ADR-008 § 4). La session vient de Supabase Auth, ou, en
// mode OIDC (E01-S11 b), du cookie chiffré de l'hôte : la même forme dans les deux modes (AC-b6).

export type PlatformSession = {
  /**
   * La personne de la session de l'hôte : l'identifiant de son compte Supabase Auth, ou son sujet chez
   * l'émetteur OIDC, et son email. Jamais l'identifiant interne du paquet, qui se lit dans l'identité
   * (`resolveIdentity`) : en mode OIDC, la base le traduit du sujet (E01-S11 a1-wire).
   */
  user: { id: string; email: string }
  accessToken: string
  /** Hôte brut de la requête ; le paquet le normalise. */
  host: string | null
  db: PlatformDb
}

export type PlatformIdentityResult =
  | { data: { identity: Identity; session: PlatformSession }; error?: never }
  | { data?: never; error: { code: "unauthenticated" | "unknown_org" | "not_member" } }

/**
 * L'appelant vérifié du compte de la session, que la base verra (E01-S10) : son identifiant, son email
 * et son nom (`callerName`), jamais une valeur de repli.
 */
function callerOf(user: Pick<User, "id" | "email" | "user_metadata">): Caller {
  return { userId: user.id, email: user.email || null, name: callerName(user) ?? null }
}

/**
 * L'appelant vérifié d'une session OIDC : l'émetteur, le sujet et le profil de l'`id_token` que le
 * rappel a validé (AC-b2), l'email seulement vérifié ; la base traduit le sujet en identifiant interne
 * (`identity_for_caller`, E01-S11 a1-wire). L'émetteur est `PLATFORM_OIDC_ISSUER` telle quelle, comme le
 * paquet la compare à `iss` : `oidcConfig()` la rend analysée, barre finale ajoutée à une origine seule.
 */
function oidcCaller(session: OidcSession): Caller {
  return { issuer: process.env.PLATFORM_OIDC_ISSUER ?? "", issuerKind: "oidc", subject: session.subject, email: session.email, name: session.name }
}

async function platformSession(accessToken: string, caller: Caller): Promise<PlatformSession> {
  return {
    user: { id: "userId" in caller ? caller.userId : caller.subject, email: caller.email ?? "" },
    accessToken,
    host: rawRequestHost(await headers()),
    db: createPlatformDb({ caller }),
  }
}

/** Session de la requête, une fois par rendu (`cache`) ; `null` sans utilisateur vérifié. */
export const getPlatformSession = cache(async (): Promise<PlatformSession | null> => {
  if (oidcEnabled()) {
    // Le cookie chiffré de l'hôte, que le middleware a rafraîchi : l'`id_token` qu'il garde a été
    // validé au rappel, rien de ce que le navigateur envoie ne s'y substitue.
    const session = await currentOidcSession(await cookies())
    return session ? platformSession(session.accessToken, oidcCaller(session)) : null
  }
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  // `getSession()` lit le jeton des cookies sans le vérifier : `getUser()` vient de le faire.
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) return null
  return platformSession(session.access_token, callerOf(user))
})

/**
 * Le jeton de la session, pour la porte de l'API (`handlePlateforme`), qui le vérifie : lu ici sans
 * vérification, dans les cookies (`getSession()` de Supabase, ou la session OIDC de l'hôte, AC-b6).
 */
export async function getSessionAccessToken(): Promise<string | null> {
  if (oidcEnabled()) return (await currentOidcSession(await cookies()))?.accessToken ?? null
  const supabase = await createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()
  return session?.access_token ?? null
}

/**
 * Identité de la personne dans l'organisation de l'adresse. `unknown_org` et `not_member` sont
 * rendus, jamais levés : le layout redirige hors de tout `try`. Une panne, elle, lève.
 */
export const getPlatformIdentity = cache(async (): Promise<PlatformIdentityResult> => {
  const session = await getPlatformSession()
  if (!session) return { error: { code: "unauthenticated" } }
  try {
    // L'identifiant interne est celui de la session du paquet, traduit par la base en mode OIDC.
    const identity = await resolveIdentity(session.db, session.host, { email: session.user.email })
    return { data: { identity, session } }
  } catch (error) {
    if (isPlatformError(error) && (error.code === "unknown_org" || error.code === "not_member")) {
      return { error: { code: error.code } }
    }
    // L'entrée sans invitation au plafond de membres (`forbidden`, `reason: "limit"`) : la personne n'est pas entrée.
    if (isPlatformError(error) && error.code === "forbidden" && error.details?.reason === "limit") return { error: { code: "not_member" } }
    throw error
  }
})

/**
 * `getPlatformIdentity()`, ou `null` sur une panne (base, configuration), journalisée sous
 * `context` : pour ce qui se dégrade au lieu de tomber (layout `(dashboard)`, page « aucune
 * organisation »).
 */
export async function getPlatformIdentitySafely(context: string): Promise<PlatformIdentityResult | null> {
  try {
    return await getPlatformIdentity()
  } catch (error) {
    unstable_rethrow(error)
    console.error(`${context} : résolution de l'identité impossible`, error)
    return null
  }
}

/** Origine appelée par le navigateur (`https://acme.oto.cx`), pour les liens des emails (N2). */
export async function getRequestOrigin(): Promise<string | null> {
  const requestHeaders = await headers()
  const host = rawRequestHost(requestHeaders)
  return host ? requestOrigin(requestHeaders, host, "https") : null
}

/**
 * Accepte les invitations en attente au retour de connexion (lien, code, mot de passe : N3), pour le
 * compte de la session ouverte (`data.session` de Supabase Auth).
 * Ne lève jamais : un échec part au log serveur et n'empêche pas la connexion. Rend le nom des organisations rejointes
 * (aucune après un échec) : un lien d'invitation mène alors à l'accueil (`/welcome`).
 */
export async function acceptPendingInvitations(session: Pick<Session, "access_token" | "user"> | null | undefined): Promise<string[]> {
  // En mode OIDC, seul le retour de l'émetteur accepte (`acceptOidcInvitations`) : une action de Supabase
  // Auth reste appelable par son identifiant, et la session qu'elle ouvrirait prendrait sous un
  // identifiant de Supabase l'invitation qu'attend une personne de l'émetteur (HN-E01S11b-12).
  if (!session?.access_token || oidcEnabled()) return []
  return acceptFor(callerOf(session.user))
}

/** La même acceptation au retour de l'émetteur OIDC (`/auth/oidc/callback`, AC-b2), par le service du paquet. */
export async function acceptOidcInvitations(session: OidcSession): Promise<void> {
  await acceptFor(oidcCaller(session))
}

async function acceptFor(caller: Caller): Promise<string[]> {
  try {
    return (await acceptInvitations(createPlatformDb({ caller }))).map((rejointe) => rejointe.name)
  } catch (error) {
    console.error("acceptPendingInvitations: l'acceptation a échoué", isPlatformError(error) ? error.code : error)
    return []
  }
}
