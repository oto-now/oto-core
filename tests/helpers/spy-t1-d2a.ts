// Aides des tests de l'administration sur base réelle (E01-S10, lot t1-d2a : organisations, adresses,
// connecteurs, contrat), dans leur propre module : `tests/helpers/sql.ts`, fichier d'ajout commun aux lots
// de t1, reçoit d'autres lots les mêmes noms privés (`REST_OPS`, `SQL_WRITE`, `isTemplate`, `watchedSql`,
// `Send`, `WRITING_FUNCTIONS`), qu'un même module ne peut tenir (une aide propre
// à un lot vit dans son propre module). La tâche M29 réunit les espions des lots de t1 en un seul,
// dans `tests/helpers/sql.ts`. `isoInstants` y est celui du lot t1-d2b : importé, pas redéclaré (troisième
// fusion des lots de t1).
//
// Ce que la base simulée donnait aux tests de l'administration (`calls` et `writes`,
// `tests/helpers/mcp-admin.ts`), sur une vraie base : chaque requête d'un client du paquet notée quand elle
// part (les refus « sans requête » d'AC-x3), et une écriture jouée juste avant elle par la connexion
// d'administration (`before`, une course). Avec l'espion : le ménage des organisations que crée le service,
// les remises en état d'un test. Sa face PostgREST est partie avec celle du client (E01-S10 f2).
import type postgres from "postgres"
import type { PlatformDb } from "../../packages/plateforme/server/db"
import { hex } from "./plateforme"
import { isTemplate, type SeededData } from "./sql"

/** Une requête SQL d'un `db.tx` (E01-S10, AC-x3, lots de t1), notée quand elle part. */
export type RecordedRequest = {
  /** Les objets de `platform` qu'elle nomme : chaque `platform.<nom>` de son texte. */
  objects: string[]
  /** Elle écrit : `insert`, `update` ou `delete`, ou l'appel d'une fonction qui écrit (`WRITING_FUNCTIONS`). */
  write: boolean
  /** Ses paramètres liés. */
  values: unknown[]
  /** Son texte, `?` à la place de chaque valeur liée. */
  text: string
}

type OnFulfilled = ((value: unknown) => unknown) | null | undefined
type OnRejected = ((reason: unknown) => unknown) | null | undefined
/** Une requête de postgres.js : elle part quand on appelle son `then`, jamais avant. */
type Sendable = { then(onfulfilled?: OnFulfilled, onrejected?: OnRejected): PromiseLike<unknown> }
type Send = (request: RecordedRequest) => Promise<void>

/** Une instruction SQL qui écrit dans une table ; une fonction qui écrit se reconnaît par son nom. */
const SQL_WRITE = /\b(insert\s+into|delete\s+from)\b|\bupdate\s+(only\s+)?platform\./i
/** Les fonctions de `platform` que les services appellent et qui écrivent. */
const WRITING_FUNCTIONS: ReadonlySet<string> = new Set(["accept_invitations", "create_org", "open_draft", "publish_node", "update_my_profile"])

/**
 * `query` part après `send` (noté, puis `before`), à son premier `then` seulement : une requête postgres.js
 * ne s'exécute qu'une fois, et la transaction la relit par son `catch` (postgres.js 3.4.9, `handler` de
 * `begin`). Un fragment SQL jamais attendu n'est pas une requête.
 */
function sentWhenAwaited<T extends Sendable>(query: T, describe: () => RecordedRequest, send: Send): T {
  const then = query.then.bind(query)
  let sent: Promise<void> | undefined
  Object.defineProperty(query, "then", {
    configurable: true,
    value: (onfulfilled?: OnFulfilled, onrejected?: OnRejected) => {
      const ready = (sent ??= send(describe()))
      return ready.then(() => then(onfulfilled, onrejected), onrejected)
    },
  })
  return query
}

/** Les `platform.<nom>` d'une requête SQL, une fois chacun. */
function platformObjects(text: string): string[] {
  return [...new Set(Array.from(text.matchAll(/\bplatform\.(\w+)/g), (match) => match[1]))]
}

/** Le gabarit `sql` d'une transaction, dont chaque requête (appel en gabarit) est notée quand elle part. */
function watchedSql(sql: postgres.TransactionSql, send: Send): postgres.TransactionSql {
  return new Proxy(sql, {
    apply(target, thisArg, args: unknown[]) {
      const query: unknown = Reflect.apply(target, thisArg, args)
      const [strings, ...values] = args
      if (!isTemplate(strings)) return query
      const text = strings.join("?")
      const objects = platformObjects(text)
      const write = SQL_WRITE.test(text) || objects.some((object) => WRITING_FUNCTIONS.has(object))
      // Une requête postgres.js : une promesse paresseuse, qui part à son premier `then`.
      return sentWhenAwaited(query as Sendable, () => ({ objects, write, values, text }), send)
    },
  })
}

/**
 * L'espion des requêtes d'un client du paquet (AC-x3) : `db` les envoie comme le client reçu, et
 * `requests` les note dans l'ordre où elles partent. `before` passe avant chacune : une écriture faite
 * entre la lecture d'un service et la sienne (une course), par la connexion d'administration.
 */
export function recordRequests(
  db: PlatformDb,
  options: { before?: (request: RecordedRequest) => void | Promise<void> } = {},
): { db: PlatformDb; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = []
  const send: Send = async (request) => {
    requests.push(request)
    await options.before?.(request)
  }
  return { db: { tx: (fn, session) => db.tx((sql) => fn(watchedSql(sql, send)), session) }, requests }
}

/**
 * Les écritures parmi les requêtes notées, le journal du MCP admin mis à part (chaque session admin y
 * écrit son ancrage) : ce qu'un refus décidé par le service n'envoie jamais (AC-x3).
 */
export function requestedWrites(requests: readonly RecordedRequest[]): RecordedRequest[] {
  return requests.filter((request) => request.write && !request.objects.includes("admin_journal"))
}

/**
 * Les organisations qu'un test fait créer par le service (`create_org`, E08-S02), hors de
 * `seed.createOrg` : chaque slug est jetable (`t<hex>`) et sert aussi de préfixe, la forme que reconnaît
 * `pnpm test:cleanup` si un passage est interrompu ; `cleanup()` les supprime (cascade : arbre, accès,
 * adresses), avant `seed.cleanup()`, qui ferme la connexion.
 */
export function createdOrgs(seed: SeededData) {
  const slugs: string[] = []
  return {
    /** Un slug jetable, noté pour le ménage : à passer en `org` et en `prefix`. */
    slug(): string {
      const slug = `t${hex(4)}`
      slugs.push(slug)
      return slug
    },
    async cleanup(): Promise<void> {
      if (slugs.length > 0) await seed.admin`delete from platform.orgs where slug in ${seed.admin(slugs)}`
    },
  }
}

/**
 * Les remises en état qu'un test a inscrites (`undo`), jouées après lui dans l'ordre inverse, toutes, même
 * quand l'une échoue, puis leurs erreurs levées ensemble (`AggregateError`) : arrêtée au premier échec, la
 * liste, déjà vidée, perdrait les remises suivantes, et les tests d'après échoueraient pour une cause
 * étrangère (revue 1 du lot t1-d2a).
 */
export async function undoAll(steps: (() => Promise<unknown>)[]): Promise<void> {
  const failures: unknown[] = []
  for (const step of steps.splice(0).reverse()) {
    try {
      await step()
    } catch (failure) {
      failures.push(failure)
    }
  }
  if (failures.length === 0) return
  const messages = failures.map((failure) => (failure instanceof Error ? failure.message : String(failure)))
  throw new AggregateError(failures, `undo: ${failures.length} step(s) failed, the others were played: ${messages.join("; ")}`)
}
