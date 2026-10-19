// Espion des requêtes du lot t1-c1b (E01-S10), sorti de `tests/helpers/sql.ts` à la fusion des lots de t1 :
// son `spyDb` et celui du lot t1-e1 (`tests/helpers/sql.ts`) portent le même nom pour deux contrats
// (`calls` et `DbCall` ici, `sent` et `SentQuery` là), qu'un même module ne peut tenir. La tâche M29 réunit
// les espions des lots de t1 en un seul, dans `tests/helpers/sql.ts`.
//
// Ce que la base simulée d'E01-S07 donnait par `calls`, `meanwhile` et `fail`, sur une vraie base : chaque
// requête d'un service vue au départ (`db.tx`), une écriture concurrente jouée juste avant elle, une panne
// de la base rendue à sa place. Sans lui, un refus « sans requête » (AC-x3) ne se prouverait que par la
// ligne relue, et aucune course ne se jouerait entre la lecture d'un service et son écriture. L'espion lit
// les tables et les fonctions dans le texte de la requête (`platform.<nom>`), où les services les nomment ;
// une partie qui les écrirait autrement ne serait pas vue. Sa face PostgREST est partie avec celle du
// client (E01-S10 f2).
import type { PlatformDb } from "../../packages/plateforme/server/db"
import type { Tx } from "../../packages/plateforme/server/sql"

/** Une requête vers la base : une table et ce qu'on y fait (`count` : un comptage), ou une fonction ; `values`, ses paramètres liés. */
export type DbCall =
  | { kind: "table"; table: string; op: "select" | "insert" | "update" | "delete"; count?: true; values: unknown[] }
  | { kind: "rpc"; name: string; values: unknown[] }

/** L'erreur que la base rend à une requête (`57014`…), que le service traduit par son code. */
export type DbFailure = { code: string }

/**
 * `meanwhile` : ce qu'une autre écriture fait juste avant la requête (attendu avant qu'elle parte) ;
 * `fail` : l'erreur que la base lui rend à sa place, ou `null`.
 */
export type DbHooks = {
  meanwhile?: (call: DbCall) => void | Promise<void>
  fail?: (call: DbCall) => DbFailure | null
}

type Spy = { calls: DbCall[]; hooks: DbHooks }

/** Les requêtes vues dans l'ordre où elles partent, chacune après son écriture concurrente ; la première panne demandée. */
async function observe(spy: Spy, calls: readonly DbCall[]): Promise<DbFailure | null> {
  let failure: DbFailure | null = null
  for (const call of calls) {
    spy.calls.push(call)
    await spy.hooks.meanwhile?.(call)
    const failed = spy.hooks.fail?.(call) ?? null
    failure = failure ?? failed
  }
  return failure
}

/** `platform.<nom>` dans le texte d'une requête : une table, ou une fonction (suivie d'une parenthèse). */
const MENTION = /\bplatform\.([a-z_][a-z0-9_]*)(\s*\()?/gi

type Fragment = { strings: readonly string[]; args: readonly unknown[] }

/** Un fragment du gabarit (`sql\`…\`` passé en valeur d'une requête), que postgres.js insère dans le texte. */
function isFragment(value: unknown): value is Fragment {
  return typeof value === "object" && value !== null && Array.isArray(Reflect.get(value, "strings")) && Array.isArray(Reflect.get(value, "args"))
}

/** Le texte d'une requête, fragments compris, et ses paramètres liés. */
function statement(strings: readonly string[], args: readonly unknown[]): { text: string; values: unknown[] } {
  const nested = args.filter(isFragment).map((fragment) => statement(fragment.strings, fragment.args))
  return {
    text: [strings.join(" ? "), ...nested.map((part) => part.text)].join(" "),
    values: [...args.filter((arg) => !isFragment(arg)), ...nested.flatMap((part) => part.values)],
  }
}

/** Ce qu'une requête fait à une table : l'écriture qui la nomme juste avant elle, sinon une lecture. */
function opBefore(text: string): "select" | "insert" | "update" | "delete" {
  if (/\binsert\s+into\s*$/i.test(text)) return "insert"
  if (/\bupdate\s*$/i.test(text)) return "update"
  if (/\bdelete\s+from\s*$/i.test(text)) return "delete"
  return "select"
}

/** Les tables et les fonctions de `platform` qu'une requête nomme, chacune une fois. */
function sqlCalls(text: string, values: unknown[]): DbCall[] {
  const counting = /\bcount\s*\(/i.test(text)
  const calls = new Map<string, DbCall>()
  for (const match of text.matchAll(MENTION)) {
    const [, name, parenthesis] = match
    const op = opBefore(text.slice(0, match.index))
    const call: DbCall =
      op === "select" && parenthesis
        ? { kind: "rpc", name, values }
        : { kind: "table", table: name, op, ...(counting && op === "select" ? { count: true as const } : {}), values }
    calls.set(`${call.kind} ${name} ${op}`, call)
  }
  return [...calls.values()]
}

/**
 * La requête du gabarit, envoyée après `before` : postgres.js n'envoie une requête qu'à son premier
 * `then`, que celui-ci précède ; une panne demandée la remplace, comme une erreur de la base (son code).
 * `before` ne joue qu'une fois par requête : dans une transaction, postgres.js appelle aussi le `catch`
 * de la requête qu'il envoie, qui repasse par `then` (vu à l'essai : chaque requête comptée deux fois).
 */
function deferred(query: unknown, before: () => Promise<DbFailure | null>): unknown {
  if (typeof query !== "object" || query === null) return query
  const send: unknown = Reflect.get(query, "then")
  if (typeof send !== "function") return query
  let sent: Promise<unknown> | null = null
  const then = (onFulfilled?: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) => {
    sent ??= before().then((failure) =>
      failure ? Promise.reject(Object.assign(new Error(`simulated ${failure.code}`), { code: failure.code })) : send.call(query),
    )
    return sent.then(onFulfilled, onRejected)
  }
  Object.defineProperty(query, "then", { configurable: true, value: then })
  return query
}

/** Le gabarit `sql` d'une transaction : chaque requête vue au départ ; tout le reste (`sql.json`, identifiants) tel quel. */
function spiedSql(sql: Tx, spy: Spy): Tx {
  return new Proxy(sql, {
    apply(target, thisArg, args: unknown[]) {
      const query: unknown = Reflect.apply(target, thisArg, args)
      const [strings, ...rest] = args
      if (!Array.isArray(strings) || !Array.isArray(Reflect.get(strings, "raw"))) return query
      const { text, values } = statement(strings, rest)
      const calls = sqlCalls(text, values)
      return calls.length === 0 ? query : deferred(query, () => observe(spy, calls))
    },
  })
}

/**
 * Le client d'un service, espionné : chaque requête dans `calls`, dans l'ordre où elle part, et les crochets
 * de `hooks` (même appelant, même session). Un client espionné par test : ses requêtes seules, jamais celles
 * de la mise en place.
 */
export function spyDb(db: PlatformDb, hooks: DbHooks = {}): { db: PlatformDb; calls: DbCall[] } {
  const spy: Spy = { calls: [], hooks }
  return { db: { tx: (fn, session) => db.tx((sql) => fn(spiedSql(sql, spy)), session) }, calls: spy.calls }
}
