// Espion des requêtes du lot t1-c1a (E01-S10), sorti de `tests/helpers/sql.ts` à la troisième fusion des
// lots de t1 : ses aides internes `WRITE_OPS`, `REST_OPS` et `gate` y portent les noms d'aides du lot t1-e1
// pour d'autres corps, et son `SpiedCall`, son `SpyHook` et son `isWrite` ceux du lot t1-b
// (`tests/helpers/spy-t1-b.ts`) pour un autre contrat (`face`, `tables`, `op` ; crochet `before` sur les deux
// faces) ; l'espion et ses aides vivent donc dans leur module (un espion par
// module). La tâche M29 réunit les espions des lots de t1 en un seul, dans `tests/helpers/sql.ts`.
//
// Ce qu'un service envoie à la base par le client d'une personne : chaque instruction de `db.tx` (qui ouvre
// `withCallerSession`), au moment où elle part. Un test réécrit sur base réelle garde ainsi la preuve
// d'AC-x3 (« refusé sans requête envoyée ») et celle d'un filtre posé avant toute lecture de lignes : la
// table se lit dans le texte de l'instruction (`platform.<table>`, fragments et noms `sql(nom)` compris).
// `before` passe juste avant chaque instruction : une écriture concurrente posée par la connexion
// d'administration, des requêtes retenues pour qu'elles se croisent, ou la panne que la base rendrait
// (`{ code }`), rendue à la place de l'instruction, qui ne part pas (ce que donnait `fail` de la base
// simulée). Sa face PostgREST est partie avec celle du client (E01-S10 f2).
import type { PlatformDb } from "../../packages/plateforme/server/db"

/** Une instruction vue par l'espion. */
export type SpiedCall = {
  face: "sql"
  /** Les tables (et fonctions) de `platform` qu'elle nomme : chaque `platform.<nom>` de l'instruction. */
  tables: string[]
  /** Son verbe d'écriture (`insert`, `update`, `delete`), sinon `select`. */
  op: string
  /** Ses paramètres liés, dans l'ordre, fragments compris. */
  values?: unknown
  /** Un comptage : `count(` dans l'instruction. */
  count: boolean
  /** Le texte de l'instruction, fragments et noms à leur place, paramètres en `?`. */
  text?: string
}

/** La panne que la base rend à une requête (`57014`…) : le service la traduit par son code. */
export type SpiedFailure = { code: string }

/** Juste avant chaque requête, attendu : rien, ou la panne rendue à sa place. */
export type SpyHook = (call: SpiedCall) => void | SpiedFailure | null | Promise<void | SpiedFailure | null>

export type DbSpy = {
  /** Les requêtes des clients enveloppés, dans l'ordre où elles partent. */
  calls: SpiedCall[]
  /** Le client `db`, dont chaque requête passe par l'espion. */
  wrap(db: PlatformDb): PlatformDb
}

/** Le gabarit `sql` que `db.tx` passe à sa fonction. */
type TxSql = Parameters<Parameters<PlatformDb["tx"]>[0]>[0]

type SpyState = { calls: SpiedCall[]; before?: SpyHook }

const WRITE_OPS: ReadonlySet<string> = new Set(["insert", "update", "upsert", "delete"])

/** Une écriture : `insert`, `update` ou `delete`. */
export function isWrite(call: SpiedCall): boolean {
  return WRITE_OPS.has(call.op)
}

function isFailure(value: unknown): value is SpiedFailure {
  return typeof value === "object" && value !== null && typeof Reflect.get(value, "code") === "string"
}

/** Le crochet d'une requête, attendu : la panne à rendre à sa place, ou `null` pour qu'elle parte. */
async function gate(state: SpyState, call: SpiedCall): Promise<SpiedFailure | null> {
  const result: unknown = await state.before?.(call)
  return isFailure(result) ? result : null
}

/** L'erreur que postgres.js lève pour une instruction que la base refuse : une `Error` à son code. */
function sqlFailure(failure: SpiedFailure): Error {
  return Object.assign(new Error(`simulated ${failure.code}`), { code: failure.code })
}

/** Un fragment passé en valeur d'une instruction (`sql\`…\``, une requête de postgres.js) : inséré dans son texte. */
type Fragment = { strings: readonly string[]; args: readonly unknown[] }

function isFragment(value: unknown): value is Fragment {
  return typeof value === "object" && value !== null && Array.isArray(Reflect.get(value, "strings")) && Array.isArray(Reflect.get(value, "args"))
}

/** Un nom passé par `sql(nom)` (`Identifier` de postgres.js, déjà entre guillemets) : écrit dans le texte. */
function identifierOf(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null
  const kind: unknown = Reflect.get(value, "constructor")
  const name: unknown = Reflect.get(value, "value")
  return typeof kind === "function" && kind.name === "Identifier" && typeof name === "string" ? name : null
}

/** Ce qu'une valeur du gabarit met dans le texte : un fragment ou une liste de fragments, un nom, sinon un paramètre `?`. */
function pieceOf(arg: unknown, values: unknown[]): string {
  if (isFragment(arg)) {
    const nested = statementOf(arg.strings, arg.args)
    values.push(...nested.values)
    return nested.text
  }
  if (Array.isArray(arg) && arg.length > 0 && arg.every(isFragment)) return arg.map((fragment) => pieceOf(fragment, values)).join(" ")
  const name = identifierOf(arg)
  if (name !== null) return name
  values.push(arg)
  return "?"
}

/** Le texte d'une instruction comme postgres.js le compose, paramètres en `?`, et ses paramètres liés. */
function statementOf(strings: readonly string[], args: readonly unknown[]): { text: string; values: unknown[] } {
  const values: unknown[] = []
  const text = strings.reduce((composed, string, index) => (index === 0 ? string : composed + pieceOf(args[index - 1], values) + string), "")
  return { text, values }
}

/** Une instruction de la face SQL : les noms de `platform` qu'elle cite (guillemets retirés), son verbe d'écriture, ses paramètres. */
function sqlCall(strings: readonly string[], args: readonly unknown[]): SpiedCall {
  const { text, values } = statementOf(strings, args)
  const bare = text.replace(/"/g, "")
  const tables = [...new Set(Array.from(bare.matchAll(/\bplatform\.(\w+)/g), (match) => match[1]))]
  const written = /\b(insert\s+into|update|delete\s+from)\s+platform\./i.exec(bare)
  const op = written ? written[1].split(/\s+/)[0].toLowerCase() : "select"
  return { face: "sql", tables, op, values, count: /\bcount\s*\(/i.test(bare), text }
}

/** Une méthode d'une requête de postgres.js, liée à elle ; une version qui ne l'aurait plus arrête l'espion au lieu de le rendre aveugle. */
function queryMethod(query: object, name: "handle" | "reject"): (...args: unknown[]) => unknown {
  const method: unknown = Reflect.get(query, name)
  if (typeof method !== "function") throw new Error(`dbSpy: a postgres.js query without ${name}(): the spy cannot see when it is sent`)
  return (...args) => Reflect.apply(method, query, args)
}

/**
 * L'instruction envoyée par `handle()`, où postgres.js 3.4.9 (version exacte, `tech-stack.md`) envoie
 * toute requête, quelle que soit la forme qui la déclenche : `then` (un `await`), `catch`, `finally`,
 * `execute`, `forEach` ou `cursor` ; un fragment, jamais déclenché, ne part pas seul. Elle entre dans
 * `calls` en partant, puis passe le crochet ; une panne rendue par le crochet, ou l'erreur qu'il lève,
 * rejette la requête à sa place (`reject`), comme une erreur de la base, et l'instruction ne part pas.
 */
function deferred(state: SpyState, query: unknown, call: SpiedCall): unknown {
  if (typeof query !== "object" || query === null) return query
  const send = queryMethod(query, "handle")
  let gated = false
  const handle = async (): Promise<unknown> => {
    if (gated) return undefined
    gated = true
    state.calls.push(call)
    const refused: unknown = await gate(state, call).then(
      (failure) => (failure ? sqlFailure(failure) : null),
      (error: unknown) => error,
    )
    if (refused === null) return send()
    return queryMethod(query, "reject")(refused)
  }
  Object.defineProperty(query, "handle", { configurable: true, value: handle })
  return query
}

/** Le gabarit d'une transaction : chaque instruction vue en partant ; le reste (`sql.json`, `sql(nom)`, `sql(lignes)`) tel quel. */
function spiedSql(state: SpyState, sql: TxSql): TxSql {
  return new Proxy(sql, {
    apply(target, thisArg, args: unknown[]) {
      const query: unknown = Reflect.apply(target, thisArg, args)
      const [strings, ...rest] = args
      if (!Array.isArray(strings) || !Object.hasOwn(strings, "raw")) return query
      return deferred(state, query, sqlCall(strings, rest))
    },
  })
}

/**
 * Un espion pour un ou plusieurs clients (deux personnes qui écrivent en même temps partagent le même) :
 * `wrap(db)` rend le client dont chaque instruction s'inscrit dans `calls` ; `before` est attendu avant
 * chacune, et la panne qu'il rend répond à sa place.
 */
export function dbSpy(before?: SpyHook): DbSpy {
  const state: SpyState = { calls: [], before }
  const wrap = (db: PlatformDb): PlatformDb => ({ tx: (fn, session) => db.tx((sql) => fn(spiedSql(state, sql)), session) })
  return { calls: state.calls, wrap }
}
