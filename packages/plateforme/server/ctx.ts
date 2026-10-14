// Le code `ctx` (ADR-002 § 2, H27) : émis par `context`, exigé par les cinq autres outils,
// invalidé quand un des Contextes qu'il a servis change de contenu (E11-S03). C'est le levier
// mesuré 9 fois sur 9 au banc (un champ requis dont la valeur vient d'un de nos outils) : sans ce
// module, rien ne force le modèle à relire le contexte à chaque conversation.
//
// Repris de la maquette (`mcp-test/src/proto/services/ctx.ts` l. 12-66) : alphabet de Crockford,
// deux essais sur collision, forme vérifiée avant la base, messages. Ajouté : le contrôle de
// l'organisation du code (N13). Retiré : `ProtoError` (→ `PlatformError`, H04).
//
// Face SQL (E01-S10, partie e1a) : chaque opération tient en une transaction (`db.tx`), sous
// l'appelant de la session.
//
// E11-S19 : `acceptOwnContextWrite(db, identity, { ctx, path, revision })` avance la ligne du code de l'auteur d'un
// Contexte à la révision qu'il vient de publier (appelée par `write`) ; `ctxChanges` sert le mode léger de `context`
// (`since_ctx`). Un code périmé ne refuse plus l'appel : la garde émet un nouveau code et rend les Contextes changés,
// que l'adaptateur dit en tête du résultat (`changedCtxMessage`) ; l'appel court sous le nouveau code.
import { randomInt } from "node:crypto"
import { CTX_PATTERN } from "../schemas"
import { changedContextParts, contextBodies, expectedContextPaths } from "./context/blocks/contexts"
import { CONTEXT_BUDGET, renderContext } from "./context/engine"
import type { Json } from "./database"
import type { PlatformDb } from "./db"
import { boundedList, fromDatabaseError, inTransaction, PlatformError } from "./errors"
import type { Identity } from "./identity"
import { samePublishedContent } from "./nodes/diff"
import { snapshotBlocks } from "./nodes/store"
import type { Tx } from "./sql"

/** Base 32 de Crockford : ni I, L, O, U ; lisible et recopiable par un modèle. */
export const CTX_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

export function newCtxCode(): string {
  const pick = () => Array.from({ length: 4 }, () => CTX_ALPHABET[randomInt(CTX_ALPHABET.length)]).join("")
  return `${pick()}-${pick()}`
}

export function missingCtxMessage(prefix: string): string {
  return `Missing or unknown ctx. Call ${prefix}_context first and pass its ctx code.`
}

/**
 * Le refus d'un code périmé (H27) ; `paths` : les Contextes changés depuis son émission, dans l'ordre des parties,
 * bornés (E11-S03, AC-a5). Sans chemin : un code émis avant la 1.1.0, dont la ligne ne les garde pas.
 */
export function staleCtxMessage(prefix: string, paths: readonly string[] = []): string {
  const changed = paths.length > 0 ? ` (${boundedList(paths)})` : ""
  return `context has changed${changed}: call ${prefix}_context again with the same request, then retry this call.`
}

/** Ce qu'est devenu un appel passé sous un code périmé : couru, refusé par un service (rien d'écrit), ou en panne. */
export type CallOutcome = "ran" | "refused" | "failed"

const OUTCOMES: Record<CallOutcome, (prefix: string) => string> = {
  ran: () => "The call below ran with it: do not repeat it because of this notice.",
  refused: () => "The call below was refused: nothing was written by it; fix it as the refusal says, with the new ctx.",
  failed: (prefix) => `The call below failed: it may have done part of its work; read ${prefix}_read path journal before repeating it, with the new ctx.`,
}

/**
 * L'avis d'un code périmé, dit en tête du résultat de l'appel : les chemins changés, bornés, le nouveau code, puis ce
 * qu'est devenu l'appel — il a couru (ne pas le rejouer : une création rejouée ferait un doublon), il a été refusé par un
 * service (rien n'a été écrit par lui : les écritures d'un assistant sont entières ou rien), ou il est tombé en panne
 * (une partie a pu courir : le journal le dit) —, puis `served`, les parties des Contextes changés telles que `context` les
 * sert. Sans cette ligne, un refus lu sous « the call ran » laissait croire à une écriture.
 */
export function changedCtxMessage(prefix: string, change: { paths: readonly string[]; code: string; served: string }, outcome: CallOutcome = "ran"): string {
  return `context has changed (${boundedList(change.paths)}). New ctx: ${change.code}: pass it to every ${prefix}_ tool from now on. ${OUTCOMES[outcome](prefix)} The changed contexts, as served now:\n\n${change.served}`
}

/** Un Contexte publié à l'un des chemins attendus : son nœud et sa révision (≥ 1). */
type PublishedContext = { id: string; path: string; revision: number }

/**
 * Les Contextes publiés aux chemins attendus de la personne, lus sous l'appelant sans filtre de niveaux
 * (HN-E11S03-7) : l'émission et la garde voient la même chose, un droit changé sans révision n'invalide rien.
 */
function publishedContexts(sql: Tx, identity: Identity, paths: readonly string[]) {
  return sql<PublishedContext[]>`
    select id, path, revision from platform.nodes
     where org_id = ${identity.org.id} and kind = 'context' and status = 'published' and revision >= 1 and path = any(${paths})`
}

/** Ce que garde la ligne `ctx` (AC-a1) : `{<chemin>: <révision>}`, une clé par chemin attendu, 0 sans Contexte publié. */
function keptRevisions(paths: readonly string[], published: readonly PublishedContext[]): Record<string, number> {
  const revisions = new Map(published.map((node) => [node.path, node.revision]))
  return Object.fromEntries(paths.map((path) => [path, revisions.get(path) ?? 0]))
}

/**
 * Les chemins gardés par le code dont le contenu servi a changé (AC-a2 à AC-a4), dans l'ordre de `paths` : un
 * Contexte apparu, retiré, ou republié à un contenu différent ; une republication à l'identique ne compte pas
 * (H28) : les instantanés ne sont lus que pour une clé dont la révision diffère (AC-a8). Un chemin que le code
 * ne garde pas, ou qui n'est plus attendu (équipe rejointe ou quittée), ne compte pas (HN-E11S03-7).
 */
async function changedContexts(sql: Tx, kept: Record<string, unknown>, paths: readonly string[], published: readonly PublishedContext[]): Promise<string[]> {
  const byPath = new Map(published.map((node) => [node.path, node]))
  const differing = paths.filter((path) => path in kept && kept[path] !== (byPath.get(path)?.revision ?? 0))
  const republished = differing.flatMap((path) => {
    const node = byPath.get(path)
    const before = kept[path]
    return node && typeof before === "number" && before >= 1 ? [{ path, node, before }] : []
  })
  if (republished.length === 0) return differing
  const ids = republished.map(({ node }) => node.id)
  const revisions = republished.flatMap(({ node, before }) => [before, node.revision])
  const rows = await sql<{ node_id: string; revision: number; blocks: Json }[]>`
    select node_id, revision, blocks from platform.node_versions where node_id = any(${ids}) and revision = any(${revisions})`
  const snapshot = (id: string, revision: number) => rows.find((row) => row.node_id === id && row.revision === revision)
  const same = new Set(
    republished.flatMap(({ path, node, before }) => {
      const [old, now] = [snapshot(node.id, before), snapshot(node.id, node.revision)]
      return old && now && samePublishedContent(snapshotBlocks(old.blocks), snapshotBlocks(now.blocks)) ? [path] : []
    }),
  )
  return differing.filter((path) => !same.has(path))
}

/**
 * `created_at` du dernier `ctx` de la personne dans l'organisation, ou `null` (E03-S08, AC2, N1) : la
 * borne des nouveautés, lue avant l'émission du code suivant. `org_id` et `user_id` sont posés dans la
 * requête : `ctx_select_member` ouvre à tout membre les `ctx` de son organisation. L'instant est rendu
 * par `to_json`, dans l'écriture qu'avait la lecture de PostgREST (à la microseconde, `+00:00`) : une
 * `Date` du pilote perdrait les microsecondes de la borne.
 */
export async function lastCtxAt(db: PlatformDb, identity: Identity): Promise<string | null> {
  // `at`, pas `created_at` : l'`order by` range alors la colonne de la table, pas son texte JSON.
  const [row] = await inTransaction(db, "lastCtxAt: ctx", (sql) => sql<{ at: string }[]>`select to_json(created_at) as at from platform.ctx
                                     where org_id = ${identity.org.id} and user_id = ${identity.user.id}
                                     order by created_at desc limit 1`)
  return row?.at ?? null
}

/**
 * Crée le code de la conversation, sous RLS, en une transaction : la version des règles (comptée, plus lue
 * par la garde, HN-E11S03-3) et la révision publiée de chaque Contexte attendu (E11-S03, AC-a1), lues
 * ensemble maintenant. Un code déjà pris n'est pas écrit (`on conflict do nothing`) : l'essai suivant en
 * tire un autre, sans erreur qui arrêterait la transaction. `request.contexts` (E11-S19, HN-E11S19-2) : les
 * révisions déjà lues par la garde, gardées telles quelles au lieu d'être relues.
 */
export async function issueCtx(
  db: PlatformDb,
  identity: Identity,
  request: { host: string | null; userAgent: string | null; contexts?: Record<string, number> },
): Promise<string> {
  const paths = expectedContextPaths(identity)
  const seen = request.contexts
  return inTransaction(db, "issueCtx", async (sql) => {
    const [[org], published] = await Promise.all([
      sql<{ rules_version: number }[]>`select rules_version from platform.orgs where id = ${identity.org.id}`.catch((error) => {
        throw fromDatabaseError(error, "issueCtx: orgs")
      }),
      seen
        ? Promise.resolve([])
        : publishedContexts(sql, identity, paths).catch((error) => {
            throw fromDatabaseError(error, "issueCtx: nodes")
          }),
    ])
    // L'organisation de l'identité, que la RLS ne montrerait plus : ce que rendait `.single()` sans ligne.
    if (!org) throw new PlatformError("not_found", "Not found.")
    const contexts = seen ?? keptRevisions(paths, published)
    // 32^8 codes : une collision est improbable, deux de suite impossibles en pratique.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const code = newCtxCode()
      const inserted = await sql`insert into platform.ctx (code, org_id, user_id, rules_version, contexts, host, user_agent)
                                 values (${code}, ${identity.org.id}, ${identity.user.id}, ${org.rules_version}, ${sql.json(contexts)}, ${request.host}, ${request.userAgent})
                                 on conflict (code) do nothing`.catch((error) => {
        throw fromDatabaseError(error, "issueCtx: ctx")
      })
      if (inserted.count > 0) return code
    }
    console.error("[platform] issueCtx: two ctx code collisions in a row")
    throw new PlatformError("internal", "Internal error.")
  })
}

/**
 * L'auteur d'un Contexte n'est pas refusé par sa propre écriture (E11-S19, AC-a1, HN-E11S19-1) : la ligne du code
 * `ctx` de l'appel passe à `revision` pour `path`, quand ce code est à la personne dans l'organisation, garde ce
 * chemin à la révision précédente (le code avait vu tout ce qui précède l'écriture) et que le Contexte y est publié
 * maintenant. Sinon rien ne change : un autre changement survenu entre-temps reste à lire, par l'avis de l'appel
 * suivant. Rend `true` quand la ligne a avancé. Appelée par `write` après la publication d'un Contexte ; la
 * policy `ctx_update_own` et le privilège sur la seule colonne `contexts` bornent l'écriture en base.
 */
export async function acceptOwnContextWrite(
  db: PlatformDb,
  identity: Identity,
  written: { ctx: string; path: string; revision: number },
): Promise<boolean> {
  const { path, revision } = written
  const code = written.ctx.trim().toUpperCase()
  if (!CTX_PATTERN.test(code) || revision < 1 || !expectedContextPaths(identity).includes(path)) return false
  const updated = await inTransaction(db, "acceptOwnContextWrite: ctx", (sql) => sql`
    update platform.ctx set contexts = jsonb_set(contexts, array[${path}::text], to_jsonb(${revision}::int))
     where code = ${code} and org_id = ${identity.org.id} and user_id = ${identity.user.id}
       and (contexts -> ${path}::text) = to_jsonb(${revision - 1}::int)
       and exists (select 1 from platform.nodes n
                    where n.org_id = ${identity.org.id} and n.path = ${path} and n.kind = 'context' and n.status = 'published' and n.revision = ${revision})`)
  return updated.count > 0
}

/** Une ligne `ctx` lue par la garde : la personne, l'organisation, les Contextes gardés, le host et l'agent. */
type CtxRow = { user_id: string; org_id: string; contexts: Record<string, unknown> | null; host: string | null; user_agent: string | null }

/**
 * Ce que la garde a lu d'un code : sa ligne, les Contextes gardés dont le contenu servi a changé depuis son émission
 * (`null` : code émis avant la 1.1.0, qui ne les garde pas), et `seen`, la révision publiée de chaque Contexte attendu
 * lue par cette même garde (vide sans lecture des Contextes) : un code émis ensuite garde celles-là (HN-E11S19-2).
 */
type CtxState = { row: CtxRow; changed: string[] | null; seen: Record<string, number> }

/**
 * Le code `code` s'il est à la personne dans l'organisation, avec ce que la garde a lu (`CtxState`) ; `null` pour un
 * code inconnu, d'une autre personne ou d'une autre organisation. `staleAllowed` : les Contextes ne sont pas lus. Une
 * transaction.
 */
async function ctxState(db: PlatformDb, identity: Identity, code: string, staleAllowed: boolean): Promise<CtxState | null> {
  const paths = expectedContextPaths(identity)
  return inTransaction(db, "requireCtx", async (sql) => {
    // Les deux lectures partent ensemble (AC-a8) ; leurs refus se décident dans l'ordre : le code, puis ses Contextes.
    const [ctx, current] = await Promise.allSettled([
      sql<CtxRow[]>`select user_id, org_id, contexts, host, user_agent from platform.ctx where code = ${code}`,
      staleAllowed ? Promise.resolve([]) : publishedContexts(sql, identity, paths),
    ])
    if (ctx.status === "rejected") throw fromDatabaseError(ctx.reason, "requireCtx: ctx")
    const [row] = ctx.value
    if (!row || row.user_id !== identity.user.id || row.org_id !== identity.org.id) return null
    if (staleAllowed) return { row, changed: [], seen: {} }
    if (current.status === "rejected") throw fromDatabaseError(current.reason, "requireCtx: nodes")
    const seen = keptRevisions(paths, current.value)
    // Émis avant la 1.1.0 : la ligne ne dit pas quels Contextes elle a servis (AC-a5, HN-E11S03-4).
    if (row.contexts === null) return { row, changed: null, seen }
    return { row, changed: await changedContexts(sql, row.contexts, paths, current.value), seen }
  })
}

/**
 * Les parties des Contextes changés, lues maintenant et rendues sous le plafond de `context` (E11-S19, AC-b1, AC-c2) :
 * le même rendu que `context`, en-tête et corps, sans lignes de faits.
 */
async function changedContextsText(db: PlatformDb, identity: Identity, changed: readonly string[]): Promise<string> {
  const bodies = await contextBodies(db, identity, changed)
  return renderContext(changedContextParts(identity, bodies, changed), CONTEXT_BUDGET, identity.org.prefix).text
}

/** Ce que la garde rend d'un code périmé : les Contextes changés et leurs parties, telles que `context` les sert. */
export type CtxChange = { paths: string[]; served: string }

/**
 * Le code qui remplace un code périmé (E11-S19, HN-E11S19-2, ADR-002 § 2 amendé) : émis pour la personne au host et
 * à l'agent de l'ancien, il garde les révisions lues par la garde ; les parties des Contextes changés sont lues
 * ensuite, hors de la transaction de la garde. Un Contexte republié entre les deux lectures est servi plus récent que
 * la révision gardée : le nouveau code reçoit l'avis une fois de plus, jamais gardé au-delà de ce qui a été servi.
 * En panne de l'une ou de l'autre, le refus d'E11-S03 (AC-b3) : rappeler `context`, rien ne dit ce qui a changé.
 */
async function renewedCtx(db: PlatformDb, identity: Identity, state: CtxState & { changed: string[] }): Promise<{ code: string; change: CtxChange }> {
  const { row, changed, seen } = state
  try {
    const [code, served] = await Promise.all([
      issueCtx(db, identity, { host: row.host, userAgent: row.user_agent, contexts: seen }),
      changedContextsText(db, identity, changed),
    ])
    return { code, change: { paths: changed, served } }
  } catch (error) {
    console.error("[platform] requireCtx: changed contexts not served", error)
    throw new PlatformError("ctx_stale", staleCtxMessage(identity.org.prefix, changed))
  }
}

/**
 * Garde des cinq outils autres que `context`. Refuse un code absent, mal formé, inconnu, d'une autre personne ou
 * émis sur une autre organisation (`ctx_missing`, N13). Un code dont un Contexte gardé a changé de contenu servi
 * depuis l'émission ne refuse pas l'appel : la garde rend un nouveau code, sous lequel l'appel court, et `changed`,
 * que l'adaptateur dit en tête du résultat (`renewedCtx`) ; `staleAllowed` (`feedback`, HN-E11S03-1) ne lit pas les
 * Contextes. Restent refusés `ctx_stale` : un code émis avant la 1.1.0, qui ne dit pas ce qu'il a servi, et une panne
 * à l'émission du nouveau code ou à la lecture des Contextes changés. Rend le code normalisé et la signature du host
 * qu'il porte (AC19).
 */
export async function requireCtx(
  db: PlatformDb,
  identity: Identity,
  raw: unknown,
  options: { staleAllowed?: boolean } = {},
): Promise<{ code: string; host: string | null; changed?: CtxChange }> {
  const prefix = identity.org.prefix
  // Forme vérifiée avant la base : un code mal formé, de 100 000 caractères au besoin, ne coûte aucune
  // requête et reçoit la consigne d'appeler context.
  const code = typeof raw === "string" ? raw.trim().toUpperCase() : ""
  if (!CTX_PATTERN.test(code)) throw new PlatformError("ctx_missing", missingCtxMessage(prefix))
  const state = await ctxState(db, identity, code, options.staleAllowed === true)
  if (!state) throw new PlatformError("ctx_missing", missingCtxMessage(prefix))
  const { changed } = state
  if (changed === null) throw new PlatformError("ctx_stale", staleCtxMessage(prefix))
  if (changed.length === 0) return { code, host: state.row.host }
  const renewed = await renewedCtx(db, identity, { ...state, changed })
  return { code: renewed.code, host: state.row.host, changed: renewed.change }
}

/**
 * Ce qu'a changé depuis un code précédent de la personne (E11-S19, `context` léger, AC-c1 à AC-c3) : le code
 * normalisé, son host et son agent, les Contextes gardés changés (vide : aucun) et les révisions lues par la garde,
 * que garde un code émis ensuite (`seen`, HN-E11S19-2). `null` pour un code mal formé, inconnu, d'une autre personne
 * ou d'une autre organisation, ou émis avant la 1.1.0 : `context` sert alors tout.
 */
export async function ctxChanges(
  db: PlatformDb,
  identity: Identity,
  raw: string,
): Promise<{ code: string; host: string | null; userAgent: string | null; changed: string[]; seen: Record<string, number> } | null> {
  const code = raw.trim().toUpperCase()
  if (!CTX_PATTERN.test(code)) return null
  const state = await ctxState(db, identity, code, false)
  if (!state || state.changed === null) return null
  return { code, host: state.row.host, userAgent: state.row.user_agent, changed: state.changed, seen: state.seen }
}
