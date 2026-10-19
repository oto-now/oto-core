// Accès du paquet à la base — le client de server/, distinct de celui du starter.
//
// Une seule face depuis E01-S10 (partie f2) : `db.tx(fn)` ouvre une transaction sur la connexion du
// serveur (`PLATFORM_DATABASE_URL`, `server/sql.ts`) sous l'appelant vérifié que l'hôte passe
// (`caller`), ou sous `anon` pour le client sans session. La RLS d'isolation, `auth.uid()` et
// `auth.jwt()` voient cet appelant, sur Supabase comme sur un Postgres nu. Plus aucun client PostgREST :
// `platform` n'est plus servi par le Data API de Supabase (fiche D80). Le client du starter
// (`src/lib/supabase/server.ts`, cookies, schéma `public`) reste celui des pages de l'hôte. Le paquet
// n'importe jamais `src/`.
//
// Jamais de clé de service ici (architecture §6) : sans appelant, `tx` lève une erreur nommée, il ne se
// replie sur rien. Une écriture que le serveur seul affirme passe par `tx(fn, "server")` : même appelant, rôle
// `platform_server` (`withServerSession`).
import { PlatformConfigError, translateCaller, withAnonSession, withCallerSession, withServerSession, type Caller, type TranslatedCaller, type Tx } from "./sql"

// Déclarée dans `sql.ts`, que `db.ts` importe : l'inverse ferait deux modules qui s'importent.
export { PlatformConfigError }

export const PLATFORM_SCHEMA = "platform" as const

/**
 * La session d'une transaction : `"server"`, celle du serveur pour l'appelant de la requête (rôle `platform_server`,
 * mêmes claims), pour une écriture que le serveur seul affirme ; omise, celle de l'appelant.
 */
export type TxSession = "server"

export type PlatformDb = {
  /**
   * `fn` dans une transaction où la base voit l'appelant de la requête, ou `anon` pour le client sans
   * session ; avec `"server"`, sous le rôle du serveur pour ce même appelant (jamais sans appelant). Un `tx`
   * appelé pendant un autre, sous la même session, reprend sa transaction ; sous une autre, il est refusé.
   */
  tx<T>(fn: (sql: Tx) => Promise<T>, session?: TxSession): Promise<T>
  /**
   * Oublie la traduction de l'appelant gardée par ce client : la transaction suivante le retraduit. Pour une entrée faite
   * pendant la requête (`join_org`), qui crée l'identité d'un sujet que la base ne connaissait pas.
   */
  retranslate?(): void
}

/** Un appelant qui désigne quelqu'un : un identifiant interne, ou un émetteur et un sujet. */
function designates(caller: Caller | undefined): caller is Caller {
  if (!caller) return false
  return "userId" in caller ? Boolean(caller.userId) : Boolean(caller.issuer && caller.subject)
}

/**
 * Le client d'une requête sous `caller`, l'appelant vérifié de la session ; `undefined` (jeton sans
 * sujet) : `tx` lève `PlatformConfigError`. Un appelant émis (E01-S11) est traduit par
 * `identity_for_caller()` avant la première transaction de ce client, une fois : un client par requête,
 * donc une traduction par requête (`retranslate` l'oublie, après une entrée qui crée l'identité) ; chaque transaction
 * porte ensuite son identifiant interne en `sub`.
 */
export function createPlatformDb(session: { caller: Caller | undefined }): PlatformDb {
  const { caller } = session
  let translated: Promise<Caller | TranslatedCaller> | undefined
  const sessionCaller = (known: Caller) =>
    (translated ??= "userId" in known ? Promise.resolve(known) : translateCaller(known).then((userId) => ({ ...known, userId })))
  return {
    tx: async <T>(fn: (sql: Tx) => Promise<T>, session?: TxSession): Promise<T> => {
      if (!designates(caller)) throw new PlatformConfigError("caller absent : l'hôte doit passer l'appelant vérifié de la session")
      const known = await sessionCaller(caller)
      return session === "server" ? withServerSession(known, fn) : withCallerSession(known, fn)
    },
    retranslate: () => {
      translated = undefined
    },
  }
}

/**
 * Client sans session : ce que voit `anon`, sous qui seule `org_by_host` s'exécute (E02-S01). Sans
 * lui, la page de connexion et les métadonnées OAuth (E02-S02) ne liraient pas l'organisation de
 * l'adresse avant la connexion. Jamais de clé de service.
 */
export function createAnonPlatformDb(): PlatformDb {
  return {
    tx: <T>(fn: (sql: Tx) => Promise<T>, session?: TxSession): Promise<T> => {
      // Le rôle du serveur écrit pour un appelant vérifié, jamais pour le client sans session.
      if (session === "server") throw new PlatformConfigError("session du serveur sans appelant : elle exige l'appelant vérifié de la session")
      return withAnonSession(fn)
    },
  }
}
