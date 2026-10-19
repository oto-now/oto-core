// Suites portables du port de base (E01-S10) : sur le projet Supabase comme sur un Postgres nu (job
// `bare-postgres`), avec deux variables seulement, `PLATFORM_DATABASE_URL` (le serveur, rôle
// `platform_app`) et `PLATFORM_ADMIN_DATABASE_URL` (tests et outillage, jamais le paquet ni l'hôte :
// `tests/unit/cle-service-hors-paquet.test.ts`). Aucune valeur n'est imprimée. Fichier d'ajout des
// parties b à e2 d'E01-S10 : une fabrique ou une aide s'y ajoute ; la partie f2 en a retiré la face
// PostgREST des espions et le mode de transition des fixtures.
import { AsyncLocalStorage } from "node:async_hooks"
import { randomUUID } from "crypto"
import type postgres from "postgres"
import { decodeJwt } from "jose"
import type { PlatformDb } from "../../packages/plateforme/server/db"
import { callerName, withCallerSession, withServerSession, type Caller, type Tx } from "../../packages/plateforme/server/sql"
import { platformAdminSql } from "./admin-sql"
import { hex, platformSeeds, referencePeople, SKIP_REASON, step, supabaseConfigured, type AccountCopy, type ReferenceOrg } from "./plateforme"

const appUrl = process.env.PLATFORM_DATABASE_URL
const adminUrl = process.env.PLATFORM_ADMIN_DATABASE_URL

export const sqlConfigured = Boolean(appUrl && adminUrl)

/** Raison du saut, sans aucune valeur. */
export const SQL_SKIP_REASON = "skipped: set PLATFORM_DATABASE_URL and PLATFORM_ADMIN_DATABASE_URL in .env.local"

/**
 * Le nom d'une suite portable (`describe.skipIf(!sqlConfigured)`), qui dit pourquoi elle se saute sans les
 * deux connexions (E01-S10 f2 : les suites des lots t1 quittent `projectConfigured` et `onProject`).
 */
export function portable(name: string): string {
  return sqlConfigured ? name : `${name} (${SQL_SKIP_REASON})`
}

export type TestSql = postgres.Sql

/**
 * La connexion d'administration des tests (sur Supabase, le rôle `postgres`), en TLS sauf `sslmode`
 * écrit dans l'URL : données jetables et relectures, sans RLS ; `end()` en `afterAll`.
 */
export function testAdminSql(): TestSql {
  return platformAdminSql()
}

/**
 * Le client du paquet d'un appelant : ce que les suites portables passent aux services, à la place de
 * `sessionFor` (qui exige Supabase Auth). `name` : le nom que l'hôte tire de la session (`callerName`),
 * que `accept_invitations` copie dans `members` (HN-E01S10-9).
 */
export function asCaller(userId: string, email?: string, name?: string): PlatformDb {
  const caller = { userId, email: email ?? null, name: name ?? null }
  return { tx: (fn, session) => (session === "server" ? withServerSession(caller, fn) : withCallerSession(caller, fn)) }
}

/** Une personne réduite à son identifiant (E01-S09 : aucune clé vers un annuaire) et une adresse jetable. */
export type SeededPerson = { id: string; email: string }

/** Une organisation jetable `t<hex>` et son adresse `t<hex>.example.invalid`. */
export type SeededOrg = { id: string; slug: string; prefix: string; name: string; host: string }

/**
 * Données jetables sur la connexion d'administration : la forme de `createFixtures`
 * (`tests/helpers/plateforme.ts`) sans Supabase Auth, pour les suites portables. `cleanup()` en
 * `afterAll`, même après un échec : organisations (cascade), puis `forget_user` de chaque personne,
 * puis la connexion.
 */
export function seedWithAdmin() {
  const admin = testAdminSql()
  const orgIds: string[] = []
  const personIds: string[] = []

  function person(): SeededPerson {
    const id = randomUUID()
    personIds.push(id)
    return { id, email: `test-${hex(6)}@example.invalid` }
  }

  async function createOrg(): Promise<SeededOrg> {
    const suffix = hex(4)
    const [org] = await admin<Omit<SeededOrg, "host">[]>`
      insert into platform.orgs (name, slug, prefix)
      values (${`test_${suffix}`}, ${`t${suffix}`}, ${`t${suffix}`})
      returning id, slug, prefix, name`
    orgIds.push(org.id)
    const host = `t${suffix}.example.invalid`
    await admin`insert into platform.org_domains (host, org_id) values (${host}, ${org.id})`
    return { ...org, host }
  }

  async function addMember(orgId: string, member: SeededPerson, role: "admin" | "member" = "member"): Promise<void> {
    await admin`insert into platform.members (org_id, user_id, role, email) values (${orgId}, ${member.id}, ${role}, ${member.email})`
  }

  async function cleanup(): Promise<void> {
    try {
      if (orgIds.length > 0) await admin`delete from platform.orgs where id in ${admin(orgIds)}`
      for (const id of personIds) await admin`select platform.forget_user(${id})`
    } finally {
      await admin.end({ timeout: 5 })
    }
  }

  return { admin, person, createOrg, addMember, cleanup }
}

export type SeededData = ReturnType<typeof seedWithAdmin>

/** Une personne semée par `createSqlFixtures` : son identifiant, son adresse jetable, le nom de son compte (ou aucun). */
export type SqlUser = { id: string; email: string; name: string | null }

/** L'organisation O des AC d'E01-S04 (`ReferenceOrg`), ses personnes semées sans compte d'Auth. */
export type SqlReferenceOrg = ReferenceOrg<SqlUser>

/**
 * Données jetables des suites portables (E01-S10 f2, lot f2-int ; réunie à `createFixtures` par M47) : les
 * lignes de `platform` de `platformSeeds` (`tests/helpers/plateforme.ts`), mêmes noms et mêmes lignes que
 * `createFixtures`, sans Supabase Auth ; une personne est un identifiant tiré au hasard et une adresse
 * jetable, qui agit par `as(person)`, la face SQL sous son appelant (avec le nom que sa session porterait :
 * `accept_invitations` le copie). `admin` : la connexion d'administration. `cleanup()` en `afterAll`, même
 * après un échec : organisations (cascade), puis `forget_user` de chaque personne, puis la connexion.
 */
export function createSqlFixtures() {
  const admin = testAdminSql()
  const users: SqlUser[] = []
  const accountOf = (userId: string): AccountCopy => {
    const user = users.find((known) => known.id === userId)
    return { email: user?.email ?? null, name: user?.name ?? null }
  }
  const { referenceOrgOf, removeRows, ...seeds } = platformSeeds(admin, accountOf)

  /** Une personne jetable ; `fullName` : le nom de son compte, que l'outillage copie dans `members` et `platform_staff`. */
  async function createUser(options: { fullName?: string; email?: string } = {}): Promise<SqlUser> {
    const user = { id: randomUUID(), email: options.email ?? `test-${hex(6)}@example.invalid`, name: options.fullName ?? null }
    users.push(user)
    return user
  }

  /** La face SQL du paquet sous la personne : son identifiant, son adresse et son nom, comme les poserait sa session. */
  function as(user: { id: string; email: string; name?: string | null }): PlatformDb {
    return asCaller(user.id, user.email, user.name ?? undefined)
  }

  /** L'organisation O ; `existing` : les personnes d'une O déjà construite, pour une seconde organisation. */
  async function buildReferenceOrg(existing?: SqlReferenceOrg["people"]): Promise<SqlReferenceOrg> {
    return referenceOrgOf(existing ?? (await referencePeople(createUser)))
  }

  async function cleanup(): Promise<void> {
    const failures: string[] = []
    await removeRows(users.map((user) => user.id), failures)
    await step("admin connection end", () => admin.end({ timeout: 5 }), failures)
    if (failures.length > 0) throw new Error(`cleanup incomplete: ${failures.join("; ")}`)
  }

  return { admin, createUser, as, ...seeds, buildReferenceOrg, cleanup }
}

export type SqlFixtures = ReturnType<typeof createSqlFixtures>

/**
 * L'erreur de la base (son code, `42501`, `23505`…, et son message), ou `null` si la requête a réussi : ce
 * que les tests lisaient dans `error` d'une réponse de PostgREST. Une erreur sans code lève : ce n'est pas
 * un refus de la base.
 */
export function failureOf(query: PromiseLike<unknown>): Promise<{ code: string; message: string } | null> {
  return Promise.resolve(query).then(
    () => null,
    (error: unknown) => {
      const code: unknown = error instanceof Error ? Reflect.get(error, "code") : undefined
      if (typeof code !== "string" || !(error instanceof Error)) throw error
      return { code, message: error.message }
    },
  )
}

/** Le code de l'erreur de la base, ou `null` si la requête a réussi (`failureOf`). */
export async function codeOf(query: PromiseLike<unknown>): Promise<string | null> {
  return (await failureOf(query))?.code ?? null
}

/**
 * Le niveau d'un nœud que la base calcule pour la personne de la session (`node_level_for`, que la
 * recherche emploie, E01-S13) ; 0 pour un nœud qu'elle ne lit pas (hors de ses organisations, ou
 * inconnu), comme la fonction de niveau par identifiant, retirée par E01-S12 partie c.
 */
export async function sqlNodeLevel(db: PlatformDb, nodeId: string): Promise<number> {
  const [row] = await db.tx((sql) => sql<{ level: number }[]>`
    select coalesce((select platform.node_level_for(n.org_id, n.lpath, n.owner_kind, n.owner_team_id, n.owner_user_id)
                       from platform.nodes n where n.id = ${nodeId}), 0) as level`)
  return row.level
}

/**
 * `PLATFORM_ADMIN_DATABASE_URL` et son mot de passe, que l'outillage exige et masque (E01-S10, AC-f4) :
 * ce que les tests de fumée cherchent dans la sortie d'un script, en comparant des noms, jamais une
 * valeur (`testing-strategy.md § Anti-patterns`). `URL.canParse` d'abord : une URL illisible lèverait
 * une erreur que Vitest imprimerait, l'URL entière avec.
 */
export function adminConnectionSecrets(): { adminDbUrl?: string; adminDbPassword?: string } {
  const adminDbPassword = adminUrl && URL.canParse(adminUrl) ? decodeURIComponent(new URL(adminUrl).password) : undefined
  return { adminDbUrl: adminUrl, adminDbPassword }
}

// ----------------------------------------------------------- Espion des requêtes (E01-S10, lot t1-e1)
// Sur une vraie base, ce que la base simulée donnait par `calls`, `meanwhile` et `fail`
// (`tests/helpers/simulated-db.ts`) : `spyDb` voit chaque requête qu'un service envoie par `db.tx`, la
// retient le temps qu'une autre transaction change sa cible (`before` : la course entre la décision du
// service et son écriture, HN-E01S07-6), ou rend à sa place une erreur que la base ne produit pas à la
// demande (`fail`). Un refus décidé avant la requête se prouve par une liste vide (AC-x3). Une seule face
// depuis E01-S10 f2 : la face PostgREST du client est partie, et avec elle celle des espions.

/**
 * Une requête envoyée par un `db.tx`. `call` : une fonction de `platform` lue par `select`. `target` : la
 * table ou la fonction, sans schéma ; nulle quand le texte SQL ne la nomme pas.
 */
export type SentQuery = {
  face: "sql"
  op: "select" | "insert" | "update" | "upsert" | "delete" | "call"
  target: string | null
  /** Le texte SQL : ce que montre un échec. */
  detail: unknown
}

export type SpyOptions = {
  /** Ce qu'une autre transaction change juste avant l'envoi de la requête : attendu avant qu'elle parte. */
  before?: (query: SentQuery) => Promise<unknown> | void
  /** L'erreur de base (`57014`, `22023`…) rendue à la requête sans l'envoyer ; `null` : elle part. */
  fail?: (query: SentQuery) => { code: string } | null
}

const WRITE_OPS: ReadonlySet<SentQuery["op"]> = new Set(["insert", "update", "upsert", "delete"])

/** Les écritures parmi les requêtes envoyées : l'espion d'un refus décidé avant elles. */
export function writesOf(sent: readonly SentQuery[]): SentQuery[] {
  return sent.filter((query) => WRITE_OPS.has(query.op))
}

const SQL_HEAD = /^\s*(\w+)/
const SQL_WRITE = /\b(insert\s+into|update|delete\s+from|merge\s+into)\s+(?:platform\.)?(\w+)/i
const SQL_FROM_CALL = /\bfrom\s+platform\.(\w+)\s*\(/i
const SQL_FROM = /\bfrom\s+platform\.(\w+)/i
const SQL_CALL = /\bplatform\.(\w+)\s*\(/i
const SQL_WRITE_OPS: Record<string, SentQuery["op"]> = { insert: "insert", update: "update", delete: "delete", merge: "upsert" }

/**
 * Une requête de la face SQL, lue dans son texte ; `null` pour un fragment (`and x = ${y}`), qui ne part
 * jamais seul. Une écriture se reconnaît à son premier mot, ou à celui de sa clause `with`.
 */
function sqlQuery(text: string): SentQuery | null {
  const head = SQL_HEAD.exec(text)?.[1].toLowerCase() ?? ""
  const detail = text.replace(/\s+/g, " ").trim()
  const write = SQL_WRITE.exec(text)
  if (Object.hasOwn(SQL_WRITE_OPS, head)) return { face: "sql", op: SQL_WRITE_OPS[head], target: write?.[2] ?? null, detail }
  if (head === "with" && write) return { face: "sql", op: SQL_WRITE_OPS[write[1].split(/\s/)[0].toLowerCase()] ?? "update", target: write[2], detail }
  if (head !== "select" && head !== "with") return null
  const call = SQL_FROM_CALL.exec(text) ?? (SQL_FROM.test(text) ? null : SQL_CALL.exec(text))
  if (call) return { face: "sql", op: "call", target: call[1], detail }
  return { face: "sql", op: "select", target: SQL_FROM.exec(text)?.[1] ?? null, detail }
}

/** Un appel de gabarit : une instruction ou un fragment ; `sql(nom)` et `sql(lignes)` n'en sont pas. Lu aussi par `spy-t1-d2a.ts` (M29). */
export function isTemplate(value: unknown): value is TemplateStringsArray {
  return Array.isArray(value) && "raw" in value && Array.isArray(value.raw)
}

/** Une requête de postgres.js 3.4.9 : paresseuse, elle part à son premier `then` (`handle`) ; `reject` la rejette sans l'envoyer. */
type PendingQuery = { handle(): Promise<void>; reject(error: unknown): void }

/**
 * Relève `pending` dans `sent` au moment où il part, pas à sa construction : un fragment passé à une autre
 * requête, ou une requête jamais attendue, n'y entre pas. Puis retient l'envoi jusqu'à la fin de `before`,
 * ou le remplace par l'erreur de `fail`.
 */
function gate(pending: PendingQuery, query: SentQuery, sent: SentQuery[], options: SpyOptions): void {
  if (typeof pending.handle !== "function" || typeof pending.reject !== "function") {
    throw new Error("spyDb: a postgres.js query without handle and reject (postgres.js changed)")
  }
  const send = pending.handle.bind(pending)
  const start = () => {
    sent.push(query)
    return Promise.resolve(options.before?.(query)).then(
      () => {
        const failure = options.fail?.(query)
        return failure ? pending.reject(Object.assign(new Error(`${failure.code} (injected by spyDb)`), { code: failure.code })) : send()
      },
      (error: unknown) => pending.reject(error),
    )
  }
  let gated: Promise<void> | undefined
  pending.handle = () => (gated ??= start())
}

/** La transaction d'un `db.tx`, dont chaque requête est vue quand elle part, retenue ou refusée avant son envoi. */
function watchedSql(sql: postgres.TransactionSql, sent: SentQuery[], options: SpyOptions): postgres.TransactionSql {
  return new Proxy(sql, {
    apply(target, thisArg, args: unknown[]) {
      const result = Reflect.apply(target, thisArg, args)
      const [strings] = args
      const query = isTemplate(strings) ? sqlQuery(strings.join("?")) : null
      if (query) gate(result, query, sent, options)
      return result
    },
  })
}

/**
 * Le client `db` dont chaque requête est vue (`sent`, dans l'ordre) : un refus sans requête, une écriture
 * devancée par une autre transaction, la panne d'une lecture.
 */
export function spyDb(db: PlatformDb, options: SpyOptions = {}): { db: PlatformDb; sent: SentQuery[] } {
  const sent: SentQuery[] = []
  return { db: { tx: (fn, session) => db.tx((sql) => fn(watchedSql(sql, sent, options)), session) }, sent }
}

/**
 * L'appelant d'une session de Supabase Auth, tiré de son jeton comme les portes le tirent (`verify` puis
 * `verifiedCaller`, `mcp/auth.ts`) et l'hôte du compte de la session (`callerOf`,
 * `src/lib/plateforme/session.ts`) : `sub`, `email`, et le nom de `user_metadata` (`callerName`). Un test
 * d'intégration qui construit le client du paquet sous une session de Supabase Auth le lui passe,
 * `createPlatformDb({ caller: sessionCaller(accessToken) })` ; sans le nom, `accept_invitations`
 * effacerait `members.name` (HN-E01S10-9). Le jeton n'est pas revérifié : il sort de Supabase Auth dans
 * le même test.
 */
export function sessionCaller(accessToken: string): Caller {
  const claims = decodeJwt(accessToken)
  if (typeof claims.sub !== "string" || !claims.sub) throw new Error("sessionCaller: the token carries no sub")
  const email = typeof claims.email === "string" && claims.email ? claims.email : null
  return { userId: claims.sub, email, name: callerName({ user_metadata: claims.user_metadata, name: claims.name }) ?? null }
}

// ------------------------------------------------------ Suites qui parlent aussi à Supabase Auth, espion
// Une suite qui ouvre une session de Supabase Auth (lien magique, consentement, compte) tourne sur le projet
// (Supabase et les deux connexions) et se saute ailleurs en disant pourquoi ; une suite qui ne parle qu'à la
// base se garde par `sqlConfigured` et entre au job `bare-postgres` (E01-S10 f2 : le mode de transition des
// fixtures, lot t1-0b, est tombé avec la face PostgREST). `recordDb` relève les instructions d'un client.

/** Le projet Supabase et les deux connexions : une suite qui parle aussi à Supabase Auth. */
export const projectConfigured = supabaseConfigured && sqlConfigured

/** Le nom d'une suite qui parle aussi à Supabase Auth, qui dit pourquoi elle se saute hors du projet. */
export function onProject(name: string): string {
  if (!sqlConfigured) return `${name} (${SQL_SKIP_REASON})`
  return supabaseConfigured ? name : `${name} (${SKIP_REASON})`
}

/**
 * Une requête d'un client du paquet, dans l'ordre où elle part : une instruction (`op` : son premier mot),
 * puis la fin de sa transaction (`wrote` : la transaction a écrit, Postgres lui a attribué un identifiant).
 */
export type SentRequest = { kind: "statement"; op: string; text: string; names: string[] } | { kind: "transaction"; wrote: boolean }

/** Un nom de `platform` dans le texte d'une instruction : table, vue ou fonction. */
const PLATFORM_NAME = /\bplatform\.([a-z_][a-z0-9_]*)/gi

/** Les transactions qui ont écrit : l'espion d'un refus décidé avant la requête (AC-x3). */
export function recordedWritesOf(requests: readonly SentRequest[]): SentRequest[] {
  return requests.filter((request) => request.kind === "transaction" && request.wrote)
}

/** Les tables et fonctions de `platform` qu'une instruction nomme. */
export function namesOf(request: SentRequest): string[] {
  return request.kind === "statement" ? request.names : []
}

/** L'opération d'une requête : `select`, `insert`… d'une instruction ; `commit`. */
export function opOf(request: SentRequest): string {
  return request.kind === "transaction" ? "commit" : request.op
}

/** La transaction a-t-elle écrit ? Postgres ne lui attribue un identifiant qu'à sa première écriture. */
async function wroteIn(sql: Tx): Promise<boolean> {
  const [row] = await sql<{ wrote: boolean }[]>`select pg_catalog.pg_current_xact_id_if_assigned() is not null as wrote`
  return row.wrote
}

/** La transaction `sql`, chaque instruction relevée à sa construction. */
function recordedStatements(sql: Tx, requests: SentRequest[]): Tx {
  return new Proxy(sql, {
    apply(target, thisArg, args: unknown[]) {
      const [strings] = args
      if (isTemplate(strings)) {
        const text = strings.join("$")
        const names = [...new Set(Array.from(text.matchAll(PLATFORM_NAME), (match) => match[1].toLowerCase()))]
        requests.push({ kind: "statement", op: /^\s*(\w+)/.exec(text)?.[1].toLowerCase() ?? "", text, names })
      }
      return Reflect.apply(target, thisArg, args)
    },
  })
}

/**
 * `fn` dans une transaction de la face SQL, chaque instruction relevée, puis sa fin, et si elle a écrit. Un
 * `tx` appelé pendant elle la reprend (`server/sql.ts`) : `recordDb` en relève les instructions, pas la fin,
 * qui n'en est pas une (M32).
 */
async function recordedTransaction<T>(sql: Tx, fn: (sql: Tx) => Promise<T>, requests: SentRequest[]): Promise<T> {
  let wrote = true
  try {
    const value = await fn(recordedStatements(sql, requests))
    wrote = await wroteIn(sql)
    return value
  } catch (error) {
    // Une transaction qu'une erreur de la base a interrompue ne se lit plus : une écriture a pu partir.
    wrote = await wroteIn(sql).catch(() => true)
    throw error
  } finally {
    requests.push({ kind: "transaction", wrote })
  }
}

/**
 * Le client du paquet, espionné : ses instructions et la fin de chaque transaction externe, dans l'ordre ;
 * `writes` rend les transactions qui ont écrit. Une instruction est relevée à sa construction.
 */
export function recordDb(db: PlatformDb) {
  const requests: SentRequest[] = []
  // Le contexte d'une transaction de ce client : un `tx` appelé pendant elle la reprend. Reconnu par le
  // contexte, pas par l'objet `sql` reçu, qu'un espion enveloppé (`spyDb`) rend neuf à chaque `tx`.
  const inside = new AsyncLocalStorage<true>()
  const recorded: PlatformDb = {
    tx: (fn, session) =>
      inside.getStore()
        ? db.tx((sql) => fn(recordedStatements(sql, requests)), session)
        : db.tx((sql) => inside.run(true, () => recordedTransaction(sql, fn, requests)), session),
  }
  return { db: recorded, requests, writes: () => recordedWritesOf(requests) }
}

export type RecordedDb = ReturnType<typeof recordDb>

/**
 * Un espion par personne sur les clients qu'ouvre `open` (`ref.db` d'une fixture) : un cas qui fait agir
 * plusieurs personnes relève les requêtes de chacune, dans leur ordre, et leurs écritures ensemble.
 */
export function recordPeople<Person extends string>(open: (person: Person) => Promise<PlatformDb>) {
  const recorders = new Map<Person, RecordedDb>()
  async function db(person: Person): Promise<PlatformDb> {
    const known = recorders.get(person) ?? recordDb(await open(person))
    recorders.set(person, known)
    return known.db
  }
  const requests = () => [...recorders.values()].flatMap((recorder) => recorder.requests)
  return { db, requests, writes: () => recordedWritesOf(requests()) }
}

// ------------------------------------------------------ Espion des requêtes (E01-S10, AC-x3, lot t1-e2a)

/**
 * Une requête qu'un service envoie à la base : l'instruction SQL, chaque valeur liée en `?`, les tables de
 * `platform` qu'elle nomme, et si elle écrit une table. Un appel de fonction n'y compte pas pour une
 * écriture, comme dans les tests sur base simulée, qui ne relevaient que les requêtes de table.
 */
export type SpiedRequest = { text: string; tables: string[]; write: boolean }

// `insert into`, `delete from`, `merge into`, `update [only] <table> [[as] <alias>] set`, dans une clause
// `with` comprise : un `select … for update` n'écrit pas. Un nom passé en valeur (`sql(nom)`) laisse sa
// place `?`, que `\S+` couvre.
const SPIED_SQL_WRITE = /\b(?:insert\s+into|delete\s+from|merge\s+into)\b|\bupdate\s+(?:only\s+)?\S+(?:\s+(?:as\s+)?(?!set\b)\w+)?\s+set\b/i
const SQL_TABLE = /\bplatform\.(\w+)/g

/**
 * L'espion d'AC-x3 : `db`, dont chaque instruction d'un `db.tx` est relevée dans `requests` (la transaction
 * qu'ouvre `withCallerSession`, imbriquée comprise). Sans lui, un test sur base réelle ne voit qu'une ligne
 * relue identique, jamais une lecture évitée. `db` n'est pas modifié : l'espion l'enveloppe.
 */
export function spyRequests(db: PlatformDb): { db: PlatformDb; requests: SpiedRequest[] } {
  const requests: SpiedRequest[] = []
  const recorded = (sql: Tx): Tx =>
    new Proxy(sql, {
      apply(target, self, args) {
        const [strings] = args
        // Un gabarit : une instruction, ou un fragment d'instruction ; `sql(nom)` et `sql(lignes)` n'en sont pas.
        if (isTemplate(strings)) {
          const text = strings.join("?")
          requests.push({ text, tables: [...text.matchAll(SQL_TABLE)].map((match) => match[1]), write: SPIED_SQL_WRITE.test(text) })
        }
        return Reflect.apply(target, self, args)
      },
    })
  return { db: { tx: (fn, session) => db.tx((sql) => fn(recorded(sql)), session) }, requests }
}

// ------------------------------------------------------------ Instants sur les deux faces (E01-S10, lot t1-d2b)

/** Un horodatage en texte : celui de `toISOString` (`…000Z`), ou celui de PostgREST (`+00:00`, à la microseconde). */
const INSTANT_TEXT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/

/**
 * `value` où chaque horodatage en texte s'écrit comme `toISOString`, à toute profondeur : PostgREST rend
 * `2026-09-20T08:00:00+00:00`, une `Date` de postgres.js `2026-09-20T08:00:00.000Z`. Un attendu écrit une
 * fois vaut sur les deux faces, et les lots de t1 comparent des instants, pas leur graphie (E01-S10, t1-d2b).
 */
export function isoInstants<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value), (_key, field: unknown) => (typeof field === "string" && INSTANT_TEXT.test(field) ? new Date(field).toISOString() : field))
}
