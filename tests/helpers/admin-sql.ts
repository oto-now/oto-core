// Connexion d'administration des tests d'intégration au projet Supabase d'oto-platform (E01-S09) :
// ce que PostgREST ne sert pas, les lectures du catalogue (clés, fonctions, déclencheurs) et les
// sessions aux claims choisis (`set local role authenticated`, `request.jwt.claims`). L'URL,
// `SUPABASE_DB_URL` de `.env.local` (rôle `postgres`), n'est jamais imprimée ; comme la clé secrète,
// elle ne sert qu'aux tests et à l'outillage, jamais au paquet ni à l'hôte.
import postgres from "postgres"
// La règle TLS sans `cli/db-prepare.mjs`, qui lit un fichier à son chargement : ce module est chargé par
// `plateforme.ts`, que des écrans testés sous jsdom importent (M47, `testing-strategy.md § Anti-patterns`).
import { sslOption } from "../../packages/plateforme/cli/ssl-option.mjs"

const url = process.env.SUPABASE_DB_URL

export const adminSqlConfigured = Boolean(url)

/** Raison du saut, sans aucune valeur. */
export const ADMIN_SQL_SKIP_REASON = "skipped: set SUPABASE_DB_URL in .env.local"

export type AdminSql = postgres.Sql
export type AdminTx = postgres.TransactionSql

/** Une connexion d'administration à `target`, en TLS sauf `sslmode` écrit dans l'URL ; `end()` en `afterAll`. */
function connect(target: string | undefined): AdminSql {
  return postgres(target ?? "", { max: 2, ...sslOption(target ?? ""), onnotice: () => {}, connection: { application_name: "oto-platform tests" } })
}

/** Une connexion à la base du projet (`SUPABASE_DB_URL`). */
export function adminSql(): AdminSql {
  return connect(url)
}

/**
 * La connexion d'administration des suites portables (`PLATFORM_ADMIN_DATABASE_URL`, E01-S10) : sur le
 * projet, la même base que `SUPABASE_DB_URL` (HN-E01S10-12) ; une seule fabrique (`connect`) pour les deux.
 */
export function platformAdminSql(): AdminSql {
  return connect(process.env.PLATFORM_ADMIN_DATABASE_URL)
}

const ROLLBACK = new Error("rollback")

/**
 * `run` dans une transaction annulée à la fin, sous le rôle `authenticated` et les claims donnés : ce
 * que fait PostgREST pour une session Supabase, et le pilote Postgres d'ADR-012 pour tout émetteur.
 */
export async function asClaims<T>(sql: AdminSql, claims: Record<string, unknown>, run: (tx: AdminTx) => Promise<T>): Promise<T> {
  const outcome: { value?: T } = {}
  await sql
    .begin(async (tx) => {
      await tx.unsafe("set local role authenticated")
      await tx.unsafe("select pg_catalog.set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: "authenticated", ...claims })])
      outcome.value = await run(tx)
      throw ROLLBACK
    })
    .catch((error: unknown) => {
      if (error !== ROLLBACK) throw error
    })
  if (!("value" in outcome)) throw new Error("asClaims: the transaction ended before its run")
  // `value` est posé par `run` avant l'annulation, seule sortie sans erreur : `in` ne le type pas.
  return outcome.value as T
}

/**
 * `run` sous l'appelant `userId`, dans une transaction annulée de la connexion d'administration :
 * `definitions` s'y exécutent d'abord sous le rôle de la connexion (une fonction d'avant recréée dans
 * `pg_temp`, qui n'existe que pour cette connexion ; ou des lignes, écrites en valeurs liées, annulées avec
 * la transaction), puis le rôle `authenticated` et ses claims, comme les pose `server/sql.ts` (E01-S13 :
 * l'ancienne et la nouvelle version d'une fonction, même appelant ; M29 : `identites.test.ts`).
 */
export function adminAsCaller<T>(
  admin: AdminSql,
  userId: string,
  definitions: readonly (string | ((tx: AdminTx) => Promise<unknown>))[],
  run: (tx: AdminTx) => Promise<T>,
): Promise<T> {
  return asClaims(admin, { sub: userId }, async (tx) => {
    await tx.unsafe("reset role")
    for (const definition of definitions) await (typeof definition === "string" ? tx.unsafe(definition) : definition(tx))
    await tx.unsafe("set local role authenticated")
    return run(tx)
  })
}
