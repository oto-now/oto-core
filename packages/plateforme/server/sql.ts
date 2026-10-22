// Port de base (E01-S10, ADR-012 § 1) : `server/` parle à Postgres par un pilote, sur la connexion
// réservée au serveur (`PLATFORM_DATABASE_URL`, rôle `platform_app`). Chaque opération tourne dans
// une transaction où le rôle est `authenticated` (ou `anon`) et où `request.jwt.claims` porte
// l'appelant vérifié : la RLS d'isolation, `auth.uid()` et `auth.jwt()` fonctionnent sans changement,
// sur Supabase comme sur un Postgres nu (`oto-platform db prepare`). Sans ce module, aucune requête ne
// porterait l'appelant, et la RLS refuserait tout : `platform_app` ne peut que devenir l'un de ces deux
// rôles (`noinherit`), jamais contourner la RLS. Une écriture que le serveur seul affirme (un fait venu d'un tiers ou du
// serveur : la liaison d'un compte hébergé, la marque, les jetons et l'état d'un compte, l'entrée dans une organisation,
// le passage d'un fichier à `ready`…) court sous `platform_server` (`withServerSession`), aux mêmes claims : ce rôle
// hérite d'`authenticated` (mêmes policies, mêmes droits), reçoit en plus ces fonctions et colonnes, et seul
// `platform_app` peut le prendre. Ce module est le seul à poser un rôle.
import { AsyncLocalStorage } from "node:async_hooks"
import postgres from "postgres"
import { PlatformError } from "./errors"
import { isJsonObject } from "./json"

/** Configuration manquante ou fausse de l'hôte : nommée, jamais sa valeur. */
export class PlatformConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "PlatformConfigError"
  }
}

type CallerProfile = {
  /** L'email du jeton, seulement vérifié ; `null` sans email, jamais une valeur de repli (HN-E01S09-3). */
  email?: string | null
  /** Le nom du jeton (`callerName`) ; `null` sans nom. */
  name?: string | null
}

/**
 * L'appelant qu'une porte a vérifié, avant sa traduction (E01-S11, ADR-012 § 1) : l'émetteur de son
 * jeton (`iss`), son genre et son sujet chez lui. `identity_for_caller()` le traduit en identifiant
 * interne à la première transaction de la requête : le sujet d'un émetteur OIDC n'est pas un `uuid`.
 */
export type IssuedCaller = CallerProfile & { issuer: string; issuerKind: "supabase" | "oidc"; subject: string }

/**
 * L'appelant vérifié d'une requête, tel que la base le verra dans ses claims : son identifiant interne
 * quand l'hôte le connaît déjà (le compte d'une session de Supabase Auth, dont le `sub` est
 * l'identifiant interne, HN-E01S11-4 ; l'outillage), sinon l'appelant émis que la base traduit.
 */
export type Caller = (CallerProfile & { userId: string }) | IssuedCaller

/** Un appelant émis, traduit : son identifiant interne, `null` quand la base n'en connaît aucun (AC-a5). */
export type TranslatedCaller = IssuedCaller & { userId: string | null }

/** La transaction d'une session : les requêtes y passent par le gabarit `sql`, valeurs liées. */
export type Tx = postgres.TransactionSql

/**
 * Le nom d'une personne dans les claims d'un jeton ou dans le compte d'une session Supabase, lu comme
 * le lisent `accept_invitations` et `members_identity_copy` : `user_metadata.full_name`, sinon
 * `user_metadata.name` (où Supabase Auth le range), sinon le claim `name` (OpenID Connect), s'il est
 * un texte non vide. Sans lui, la base recevrait un nom vide à chaque connexion.
 */
export function callerName(source: { user_metadata?: unknown; name?: unknown }): string | undefined {
  const metadata = isJsonObject(source.user_metadata) ? source.user_metadata : {}
  const named = metadata.full_name ?? metadata.name ?? source.name
  return typeof named === "string" && named ? named : undefined
}

// Taille bornée : une instance de l'hôte ne garde jamais plus de connexions ; le pooler de Supabase en
// mode transaction (port 6543) les partage entre instances.
const POOL_MAX = 5
/** Secondes d'attente d'une connexion avant l'échec. */
const CONNECT_TIMEOUT_S = 10
/** Secondes d'inactivité avant qu'une connexion se ferme : une instance au repos ne garde rien ouvert. */
const IDLE_TIMEOUT_S = 20
// Les délais que PostgREST applique aujourd'hui, lus sur les rôles de notre projet (HN-E01S10-6) :
// `statement_timeout` de `authenticated` (8 s) et d'`anon` (3 s), `lock_timeout` du rôle de PostgREST
// (8 s). Devenir un rôle n'applique pas ses réglages : la session les pose elle-même. Le rôle du serveur prend ceux
// d'`authenticated`, dont il hérite.
const STATEMENT_TIMEOUT = { authenticated: "8s", platform_server: "8s", anon: "3s" } as const
const LOCK_TIMEOUT = "8s"
// PostgREST n'a jamais de transaction inactive ; une transaction de la face SQL attend son JavaScript
// entre deux requêtes. Au-delà de cette borne, la base la coupe : elle ne tient plus sa connexion du
// pooler, ni des verrous que les autres ont cessé d'attendre (`LOCK_TIMEOUT`) (HN-E01S10-6).
const IDLE_IN_TRANSACTION_TIMEOUT = "8s"
/**
 * Une base sur la même machine (job de CI, poste de développement) : seule à se joindre sans TLS.
 * `URL` rend une adresse IPv6 entre crochets.
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"])
/** Modes de l'URL plus stricts que `require` : ils vérifient aussi le certificat, ils sont gardés. */
const VERIFYING_TLS = new Set(["verify-ca", "verify-full"])

/** TLS exigé hors de la machine locale, même si l'URL dit `sslmode=disable`. */
function tlsOptions(url: URL): { ssl?: "require" } {
  if (LOCAL_HOSTS.has(url.hostname)) return {}
  return VERIFYING_TLS.has(url.searchParams.get("sslmode") ?? "") ? {} : { ssl: "require" }
}

let pool: postgres.Sql | null = null

/** Le pool du serveur, créé à la première session : `pnpm build` passe sans la variable. */
function platformSql(): postgres.Sql {
  const url = process.env.PLATFORM_DATABASE_URL
  if (!url) throw new PlatformConfigError("PLATFORM_DATABASE_URL manquante dans l'environnement du serveur de l'hôte")
  if (pool) return pool
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    // L'erreur d'analyse porterait l'URL, mot de passe compris : seul le nom de la variable sort.
    throw new PlatformConfigError("PLATFORM_DATABASE_URL n'est pas une URL de connexion Postgres")
  }
  pool = postgres(url, {
    // Le pooler en mode transaction ne garde pas les requêtes préparées (HN-E01S10-3).
    prepare: false,
    max: POOL_MAX,
    connect_timeout: CONNECT_TIMEOUT_S,
    idle_timeout: IDLE_TIMEOUT_S,
    onnotice: () => {},
    connection: { application_name: "oto-platform" },
    ...tlsOptions(parsed),
  })
  return pool
}

type Role = keyof typeof STATEMENT_TIMEOUT

/** La session d'une transaction ouverte, que retrouve un `tx` appelé pendant qu'elle court. */
type OpenSession = { role: Role; claims: string; sql: Tx; open: boolean }

const openSession = new AsyncLocalStorage<OpenSession>()

/**
 * `fn` dans une transaction où la base voit `role` et `claims`. Un appel fait pendant une transaction
 * de même rôle et mêmes claims (un service appelé par un autre) la reprend : ni seconde connexion ni
 * attente, et l'échec de l'un annule tout (AC-a8). Pendant la transaction d'une autre session (autre
 * appelant, client sans session), l'appel est refusé : il tiendrait sa connexion du pool en attendant
 * une seconde, que le pilote attend sans délai, et sous charge les transactions ouvertes tiendraient
 * tout le pool en s'attendant (`supabase-patterns.md § Couplage à Supabase (ADR-012)`).
 */
async function inSession<T>(role: Role, claims: Record<string, unknown>, fn: (sql: Tx) => Promise<T>): Promise<T> {
  const text = JSON.stringify(claims)
  const outer = openSession.getStore()
  if (outer?.open) {
    if (outer.role === role && outer.claims === text) return fn(outer.sql)
    throw new Error("[platform] db.tx : la transaction d'une autre session est ouverte ; ouvrir celle-ci avant ou après, jamais pendant")
  }
  const { value } = await platformSql().begin(async (sql) => {
    // `set_config(…, true)` équivaut à `set local` : rôle, claims et délais ne valent que pour cette
    // transaction, la connexion revient au pool sans eux (AC-a1). Les réglages que lisent `auth.uid()` et
    // `auth.jwt()` de Supabase avant `request.jwt.claims` sont vidés : un reste laissé sur la connexion
    // par un autre client du pooler ne remplace jamais l'appelant. Le fuseau est UTC : `to_json` d'un
    // `timestamptz` rend l'instant dans celui de la session, et les services le servent tel quel, en texte
    // (`+00:00`, comme PostgREST sur un serveur en UTC), quel que soit le fuseau du serveur (M32, HN-E01S10-b1-8).
    // Le JIT est coupé : les policies évaluent le niveau du nœud par sous-requête, que le planificateur compte pour
    // chaque ligne, et la compilation multipliait la lecture d'un tableau de milliers de lignes.
    await sql`select pg_catalog.set_config('role', ${role}, true),
                     pg_catalog.set_config('TimeZone', 'UTC', true),
                     pg_catalog.set_config('request.jwt.claims', ${text}, true),
                     pg_catalog.set_config('request.jwt.claim.sub', '', true),
                     pg_catalog.set_config('request.jwt.claim', '', true),
                     pg_catalog.set_config('statement_timeout', ${STATEMENT_TIMEOUT[role]}, true),
                     pg_catalog.set_config('lock_timeout', ${LOCK_TIMEOUT}, true),
                     pg_catalog.set_config('idle_in_transaction_session_timeout', ${IDLE_IN_TRANSACTION_TIMEOUT}, true),
                     pg_catalog.set_config('jit', 'off', true)`
    const session: OpenSession = { role, claims: text, sql, open: true }
    try {
      return { value: await openSession.run(session, () => fn(sql)) }
    } finally {
      // Une tâche lancée dans `fn` et qui lui survit n'écrira pas dans une transaction finie.
      session.open = false
    }
  })
  return value
}

/**
 * Les claims de l'appelant vérifié (ADR-012 § 1) : `sub` (l'identifiant interne, une fois connu), `iss`, `ext_sub` et
 * `issuer_kind` d'un appelant émis (ce que lit `identity_for_caller()`), `email` et `name` ; un claim absent n'est pas
 * posé : sans identifiant interne, `auth.uid()` est nul et la RLS ne lui montre rien.
 */
function callerClaims(caller: Caller | TranslatedCaller): Record<string, unknown> {
  const userId = "userId" in caller ? caller.userId : null
  return {
    ...(userId ? { sub: userId } : {}),
    role: "authenticated",
    ...("issuer" in caller ? { iss: caller.issuer, ext_sub: caller.subject, issuer_kind: caller.issuerKind } : {}),
    ...(caller.email ? { email: caller.email } : {}),
    ...(caller.name ? { name: caller.name } : {}),
  }
}

/** `fn` dans une transaction sous l'appelant vérifié : rôle `authenticated`, ses claims (`callerClaims`). */
export function withCallerSession<T>(caller: Caller | TranslatedCaller, fn: (sql: Tx) => Promise<T>): Promise<T> {
  return inSession("authenticated", callerClaims(caller), fn)
}

/**
 * `fn` dans une transaction du serveur pour l'appelant vérifié : rôle `platform_server`, les mêmes claims que
 * `withCallerSession` ; la RLS, `auth.uid()` et `auth.jwt()` y voient le même appelant. Pour une écriture que le serveur
 * seul affirme, après la décision du service : les fonctions et colonnes réservées à ce rôle la refusent sous
 * `authenticated`. Les déclencheurs qui distinguent `authenticated` (`nodes_guard`, `platform_grants_guard`,
 * `team_members_guard`) ne voient jamais ce rôle : aucune écriture directe de ces tables ne court sous lui. Pendant une
 * transaction de l'appelant, l'appel est refusé comme toute autre session (`inSession`) : ouvrir l'une après l'autre.
 */
export function withServerSession<T>(caller: Caller | TranslatedCaller, fn: (sql: Tx) => Promise<T>): Promise<T> {
  return inSession("platform_server", callerClaims(caller), fn)
}

/** Un sujet plus long que la table ne l'admet (`identities_subject_check`, 255 caractères) : personne à traduire. */
const CHECK_VIOLATION = "23514"
/**
 * Un premier passage du même sujet tient sa ligne au-delà des délais de la session : `LOCK_TIMEOUT`
 * (55P03), ou `statement_timeout` (57014), de même durée, armé avant l'attente : mesuré, c'est lui qui
 * échoit (E01-S11 a1-wire). `identity_for_caller()` n'attend rien d'autre que cette ligne.
 */
const HELD_BY_ANOTHER_CALL = new Set(["55P03", "57014"])

/**
 * L'identifiant interne d'un appelant émis (E01-S11) : `identity_for_caller()`, dans sa propre
 * transaction, sous ses claims sans `sub`. `null` quand la base ne le connaît pas et ne l'attend pas
 * (ni invitation ouverte de son email vérifié, ni équipe plateforme) : les portes le servent comme un
 * non-membre (AC-a5), comme un sujet trop long pour la table, jamais comme une panne. Un premier
 * passage du même sujet qui tient encore sa ligne est un conflit à rejouer, pas une panne.
 */
export async function translateCaller(caller: IssuedCaller): Promise<string | null> {
  try {
    const [row] = await withCallerSession(caller, (sql) => sql<{ id: string | null }[]>`select platform.identity_for_caller() as id`)
    return row?.id ?? null
  } catch (error) {
    const code = error instanceof postgres.PostgresError ? error.code : undefined
    if (code === CHECK_VIOLATION) {
      // Ni le sujet ni l'email au log : un sujet de plus de 255 caractères ne désigne personne ici.
      console.error("[platform] identity: subject longer than the identities table admits, caller served as unknown")
      return null
    }
    if (code && HELD_BY_ANOTHER_CALL.has(code)) {
      console.error("[platform] identity: first call of this subject still held by another request")
      throw new PlatformError("conflict", "Your first connection is being recorded by another request. Retry the request.")
    }
    throw error
  }
}

/** `fn` dans une transaction sans appelant, sous le rôle `anon` : ce que lisait la clé publique. */
export function withAnonSession<T>(fn: (sql: Tx) => Promise<T>): Promise<T> {
  return inSession("anon", { role: "anon" }, fn)
}

/**
 * `fn` dans une transaction du serveur sans appelant : rôle `platform_server`, `auth.uid()` nul. Pour l'exécutant des
 * travaux en tâche de fond seul (`jobs/store.ts`), qui réclame et range les travaux de tous les auteurs par les fonctions
 * réservées à ce rôle (`claim_jobs`, `mark_job_sent`, `finish_job`, `sweep_jobs`) ; la RLS n'y montre aucune ligne.
 */
export function withRunnerSession<T>(fn: (sql: Tx) => Promise<T>): Promise<T> {
  return inSession("platform_server", { role: "platform_server" }, fn)
}
