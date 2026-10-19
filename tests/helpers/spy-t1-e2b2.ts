// Espion du lot t1-e2b2 (E01-S10), sorti de `tests/helpers/sql.ts` à la troisième fusion des
// lots de t1 : ce fichier d'ajout tient déjà trois espions (t1-e1, t1-d1, t1-e2a), et `DbCall`, `isWrite`,
// `touches` et `FILTER_METHODS` portent les noms d'aides des lots t1-c1b (`tests/helpers/spy-tables.ts`), t1-b
// (`tests/helpers/spy-t1-b.ts`) et t1-c1a (`tests/helpers/spy-t1-c1a.ts`), pour d'autres contrats
// (un espion par module). La tâche M29 réunit les espions des lots de t1
// en un seul, dans `tests/helpers/sql.ts`.
//
// Un test de service sur la base réelle garde ce que la base simulée lui donnait (E01-S10, AC-x3) : voir
// chaque requête partie, en poser la réponse, la panne ou l'ordre des lignes. `watchDb` enveloppe le client
// d'une personne (`ref.db(person)`) et relève ses requêtes dans l'ordre où elles partent (`tx` : le texte
// de chaque gabarit et ses valeurs) : « aucune écriture partie » ou « aucun brouillon lu » se prouve par
// `touches`, `isWrite` et `callsFunction`. Sa moitié PostgREST (`from`, `rpc`) est partie avec cette face
// (E01-S10 f2). À côté des espions de t1-e1 (`spyDb`), t1-d1
// (`recordDb`) et t1-e2a (`spyRequests`), dans `tests/helpers/sql.ts` : ses tests font servir des fonctions
// par le test (`rpc`) et renversent une lecture (`reverse`), ce qu'aucun d'eux ne fait, et lisent sur un
// même relevé les filtres, une panne et une course. Un seul espion pour tous les lots est la tâche M29 ; le
// nom d'une suite portable vient de `tests/helpers/sql.ts` (`portable`).
import type postgres from "postgres"
import type { PlatformDb } from "../../packages/plateforme/server/db"

/** Une requête partie (`sql` : texte du gabarit, `?` pour chaque valeur liée), ou une fonction servie par le test (`rpc`). */
export type DbCall = { kind: "rpc"; name: string; args: Record<string, unknown> } | { kind: "sql"; text: string; values: unknown[] }

/** Une erreur de la base, telle qu'un service la lit (`fromDatabaseError`) : son code, `57014`, `PT409`… */
export type DbError = { code: string; message?: string }

export type WatchOptions = {
  /**
   * Fonctions servies par le test au lieu de la base, leurs lignes rendues sans requête : à la requête qui
   * appelle `platform.<nom>(…)` par ses arguments nommés (`p_org => ${…}`), fragments dépliés (E01-S10, lot
   * e2b). Elle se relève en appel de fonction (`rpc`), ses arguments par leur nom.
   */
  rpc?: Record<string, (args: Record<string, unknown>) => unknown>
  /** L'erreur rendue à la requête visée, qui ne part pas ; `null` : elle part. */
  fail?: (call: DbCall) => DbError | null
  /** Ce qu'une autre session fait juste avant la requête visée (une course) ; une promesse la retarde d'autant. */
  meanwhile?: (call: DbCall) => Promise<void> | void
  /**
   * Les lignes de la requête visée, rendues à rebours : l'ordre qu'une lecture sans `order` peut recevoir de la
   * base, jamais celui qu'un index lui donne par hasard. Une règle d'ordre du service se prouve ainsi sur la base
   * réelle (`testing-strategy.md § Anti-patterns`, règle d'ordre).
   */
  reverse?: (call: DbCall) => boolean
}

type Spied = { calls: DbCall[]; options: WatchOptions }

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (typeof value === "object" || typeof value === "function") && value !== null && typeof Reflect.get(value, "then") === "function"
}

/**
 * Les listes de lignes déjà mises à rebours. Une requête du pilote a souvent plusieurs lecteurs : dans une
 * transaction, `begin` la guette par `catch`, qui passe par son `then` ; renversée en place par chacun, elle
 * reviendrait à l'endroit (sonde du cycle 1 de t1-e2b2, gardée par `tests/integration/watch-db-sql.test.ts`).
 */
const REVERSED = new WeakSet<object>()

/** Des lignes rendues, à rebours, sur place et une seule fois (`WatchOptions.reverse`) ; ce qui n'est pas une liste ne change pas. */
function reverseRows<T>(rows: T): T {
  if (Array.isArray(rows) && !REVERSED.has(rows)) {
    rows.reverse()
    REVERSED.add(rows)
  }
  return rows
}

/**
 * Une requête postgres.js dont les lignes arrivent à rebours : seul son `then` est enveloppé, la requête reste
 * elle-même (fragment d'une autre requête, `values()`), et ne part qu'attendue, comme toute requête du pilote.
 */
function reversedQuery<Q extends object>(query: Q): Q {
  const then: unknown = Reflect.get(query, "then")
  if (typeof then !== "function") return query
  Reflect.set(query, "then", (onFulfilled?: (rows: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
    Reflect.apply(then, query, [reverseRows]).then(onFulfilled, onRejected),
  )
  return query
}

/** Levée comme le pilote lève une erreur de la base (un code), et seulement quand la requête est attendue. */
function refused(error: DbError) {
  return { then: (_: unknown, onRejected?: (reason: unknown) => unknown) => Promise.reject(Object.assign(new Error(error.message ?? error.code), { code: error.code })).then(undefined, onRejected) }
}

/** Un fragment de postgres.js 3.4.9 passé en valeur d'une requête (`${sql\`…\`}`) : son gabarit et ses valeurs. */
type Fragment = { strings: readonly string[]; args: readonly unknown[] }

function isFragment(value: unknown): value is Fragment {
  return typeof value === "object" && value !== null && Array.isArray(Reflect.get(value, "strings")) && Array.isArray(Reflect.get(value, "args"))
}

/** Le gabarit d'une requête et ses valeurs liées, chaque fragment déplié à sa place : `parts[i]` précède `values[i]`. */
function unfold(strings: readonly string[], values: readonly unknown[]): { parts: string[]; values: unknown[] } {
  const parts = [strings[0]]
  const flat: unknown[] = []
  values.forEach((value, index) => {
    if (isFragment(value)) {
      const inner = unfold(value.strings, value.args)
      parts[parts.length - 1] += inner.parts[0]
      parts.push(...inner.parts.slice(1))
      flat.push(...inner.values)
      parts[parts.length - 1] += strings[index + 1]
    } else {
      flat.push(value)
      parts.push(strings[index + 1])
    }
  })
  return { parts, values: flat }
}

const CALLED_FUNCTION = /\bplatform\.(\w+)\s*\(/g
const NAMED_ARGUMENT = /(\w+)\s*=>\s*$/

/**
 * L'appel d'une fonction que le test sert (`WatchOptions.rpc`), lu dans le texte d'une requête de la face SQL :
 * son nom et ses arguments nommés (`p_org => ?`), fragments dépliés ; `null` quand la requête n'en appelle aucune.
 */
function servedCall(strings: readonly string[], values: readonly unknown[], served: WatchOptions["rpc"]): Extract<DbCall, { kind: "rpc" }> | null {
  if (!served) return null
  const { parts, values: flat } = unfold(strings, values)
  const name = Array.from(parts.join("?").matchAll(CALLED_FUNCTION), (match) => match[1]).find((called) => Object.hasOwn(served, called))
  if (!name) return null
  const args: Record<string, unknown> = {}
  flat.forEach((value, index) => {
    const named = NAMED_ARGUMENT.exec(parts[index])
    if (named) args[named[1]] = value
  })
  return { kind: "rpc", name, args: structuredClone(args) }
}

/** Le gabarit `sql` d'une transaction dont chaque requête est relevée, et refusée, retardée, servie ou rendue à rebours par le test. */
function watchSql(sql: postgres.TransactionSql, spied: Spied): postgres.TransactionSql {
  return new Proxy(sql, {
    apply(target, thisArg, args: unknown[]) {
      const [strings, ...values] = args
      if (!Array.isArray(strings) || !("raw" in strings)) return Reflect.apply(target, thisArg, args)
      // Une fonction servie par le test : relevée en appel de fonction, ses lignes rendues sans requête.
      const served = servedCall(strings, values, spied.options.rpc)
      const handler = served && spied.options.rpc?.[served.name]
      if (served && handler) {
        spied.calls.push(served)
        const failure = spied.options.fail?.(served)
        if (failure) return refused(failure)
        return Promise.resolve(spied.options.meanwhile?.(served)).then(() => structuredClone(handler(served.args)))
      }
      const call: DbCall = { kind: "sql", text: strings.join("?"), values }
      spied.calls.push(call)
      const error = spied.options.fail?.(call)
      if (error) return refused(error)
      const query = () => {
        const built: unknown = Reflect.apply(target, thisArg, args)
        return spied.options.reverse?.(call) && typeof built === "object" && built !== null ? reversedQuery(built) : built
      }
      const pending = spied.options.meanwhile?.(call)
      if (!isThenable(pending)) return query()
      return Promise.resolve(pending).then(query)
    },
  })
}

/**
 * Le client `db` dont chaque requête est relevée dans `calls` (`DbCall`), dans l'ordre où elle part, à la
 * construction de son gabarit. `options` sert des fonctions (`rpc`), pose une panne (`fail`) ou une course
 * (`meanwhile`) sur les requêtes qu'il vise, ou leur rend les lignes à rebours (`reverse`).
 */
export function watchDb(db: PlatformDb, options: WatchOptions = {}): { db: PlatformDb; calls: DbCall[] } {
  const spied: Spied = { calls: [], options }
  return { db: { tx: (fn, session) => db.tx((sql) => fn(watchSql(sql, spied)), session) }, calls: spied.calls }
}

/** La requête lit ou écrit `platform.<table>` : le nom qualifié dans le texte SQL. */
export function touches(call: DbCall, table: string): boolean {
  return call.kind === "sql" && new RegExp(`\\bplatform\\.${table}\\b`).test(call.text)
}

/** La requête appelle la fonction `platform.<name>` : servie par le test (`rpc`), ou `platform.<name>(` dans le texte SQL. */
export function callsFunction(call: DbCall, name: string): boolean {
  if (call.kind === "rpc") return call.name === name
  return call.kind === "sql" && new RegExp(`\\bplatform\\.${name}\\s*\\(`).test(call.text)
}

/** La requête écrit une table : insertion, mise à jour ou suppression. */
export function isWrite(call: DbCall): boolean {
  return call.kind === "sql" && /\b(insert\s+into|update|delete\s+from)\s+platform\./i.test(call.text)
}
