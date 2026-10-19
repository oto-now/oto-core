// Le dépôt par lien à usage unique (E10-S02 lot f ; ADR-018) : le ticket qu'`upload.link` crée sous la session d'une
// conversation (AC-f1, AC-f3), sa consommation atomique sous `anon` (AC-f5), l'identité reconstruite du ticket et les
// droits relus à l'envoi (AC-f6), la ligne de journal de l'envoi (AC-f9), et le formulaire de dépôt sous la session de
// la personne du ticket (AC-f15). Le ticket prouve qui et où, jamais le droit (`security-patterns.md § Droits dans le
// service`) ; ses deux jetons, celui de `curl` et celui du formulaire, ne sont gardés qu'en empreinte, jamais
// journalisés, et chacun n'ouvre que sa porte (HN-E10S02-108). Sans lui, un assistant réécrirait dans un appel MCP un
// fichier qu'il a déjà (fiche D117).
import { createHash, randomBytes } from "node:crypto"
import {
  UPLOAD_BYTES_MAX,
  UPLOAD_FORM_ROUTE,
  UPLOAD_TOKEN_PATTERN,
  UPLOAD_TTL_MINUTES,
  UPLOADS_ROUTE,
  type UploadFormView,
  type UploadKind,
  type UploadLinkArgs,
  type UploadMode,
} from "../schemas"
import { webUrl } from "../schemas/oauth"
import type { FunctionContext } from "./catalog/define"
import { createAnonPlatformDb, createPlatformDb, type PlatformDb } from "./db"
import { inTransaction, isPlatformError, PlatformError } from "./errors"
import { requireQuota } from "./files/rows"
import { admittedType, requireStore } from "./files/service"
import { identityInOrg, resolveOrg, type Identity, type IdentityOrg } from "./identity"
import { orgStorageQuota } from "./limits"
import { clip, journalError, MAX_TARGET_CHARS, wellFormed, writeJournal, type JournalEntry } from "./journal"
import { checkDestination, writeUpload, type UploadResult, type UploadTicket } from "./uploads-write"

export { checkDestination, type UploadResult, type UploadTicket } from "./uploads-write"

/** Les tickets de l'organisation expirés depuis plus longtemps sont supprimés à chaque `upload.link` (AC-f3). */
const TICKETS_KEPT_HOURS = 24

/** Un jeton neuf : 32 octets aléatoires en base64url, 43 caractères (ADR-018 § 2), jamais stocké ni journalisé. */
export function newUploadToken(): string {
  return randomBytes(32).toString("base64url")
}

/** L'empreinte d'un jeton, seule gardée en base : SHA-256 en hexadécimal (AC-f3). */
export function uploadTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

/** La même réponse pour un jeton mal formé, inconnu, expiré, servi ou d'une autre organisation (AC-f5, AC-f11). */
export function unknownUploadLink(): PlatformError {
  return new PlatformError("not_found", "Unknown upload link: it may have expired (15 minutes) or already been used. Ask for a new link.")
}

/**
 * Un ticket émis : le jeton de `curl` (rendu une fois, à l'assistant), son adresse d'envoi, celle du formulaire, qui
 * porte le second jeton, et l'expiration.
 */
export type IssuedTicket = { token: string; path: string; url: string; formUrl: string; expiresAt: string }

/**
 * `upload.link` (AC-f1, AC-f3) : décide tout de suite ce qui sera décidé à l'envoi, avant toute écriture — pour un
 * fichier le stockage (`not_enabled`), la destination (`checkDestination`), le type par l'extension de `name` et le quota
 * d'un envoi de 1 Mo ; puis, dans une transaction, supprime les tickets de l'organisation expirés depuis plus de 24 heures
 * et crée le ticket, lié à la personne, au `ctx` de l'appel et à la destination, valable 15 minutes. Deux jetons : celui
 * de `curl` et celui du formulaire (`form_url`), qui n'ouvrent chacun que leur porte ; le ticket sert une fois, par l'un
 * ou par l'autre.
 */
export async function createUploadTicket(context: FunctionContext, input: UploadLinkArgs): Promise<IssuedTicket> {
  const { db, identity } = context
  const args = wellFormed(input)
  // L'adresse d'envoi et le formulaire se bâtissent sur l'origine de la requête (`security-patterns.md § XSS Prevention`).
  const url = webUrl(context.origin)
  const origin = url ? new URL(url).origin : null
  if (!origin) {
    console.error("[platform] uploads: no origin to build the upload link")
    throw new PlatformError("internal", "Internal error.")
  }
  if (args.kind === "file") requireStore()
  const path = await checkDestination(db, identity, { kind: args.kind, mode: args.mode, path: args.path, baseRevision: args.base_revision ?? null })
  if (args.kind === "file") {
    const name = args.name ?? ""
    admittedType(name)
    const quota = await orgStorageQuota(identity.org)
    await inTransaction(db, "uploads: quota", (sql) => requireQuota(sql, identity, { adding: UPLOAD_BYTES_MAX, what: name, quota }))
  }
  const token = newUploadToken()
  const formToken = newUploadToken()
  const expiresAt = await inTransaction(db, "uploads: ticket", async (sql) => {
    await sql`delete from platform.upload_tickets where org_id = ${identity.org.id} and expires_at < now() - make_interval(hours => ${TICKETS_KEPT_HOURS})`
    const [row] = await sql<{ expires_at: string }[]>`
      insert into platform.upload_tickets (org_id, user_id, ctx, token_hash, form_token_hash, kind, mode, target_path, name, title, summary, key, base_revision, publish, expires_at)
      values (${identity.org.id}, ${identity.user.id}, ${context.ctx ?? null}, ${uploadTokenHash(token)}, ${uploadTokenHash(formToken)}, ${args.kind}, ${args.mode}, ${path},
              ${args.name ?? null}, ${args.title ?? null}, ${args.summary ?? null}, ${args.key ?? null}, ${args.base_revision ?? null},
              ${args.publish ?? null}, now() + make_interval(mins => ${UPLOAD_TTL_MINUTES}))
      returning to_json(expires_at) #>> '{}' as expires_at`
    return row.expires_at
  })
  return { token, path, url: `${origin}${UPLOADS_ROUTE}/${token}`, formUrl: `${origin}${UPLOAD_FORM_ROUTE}/${formToken}`, expiresAt }
}

type TicketJson = {
  user_id: string
  email: string | null
  ctx: string | null
  kind: UploadKind
  mode: UploadMode
  target_path: string
  name: string | null
  title: string | null
  summary: string | null
  key: string | null
  base_revision: number | null
  publish: boolean | null
}

/** La porte d'un envoi : `link`, la porte sans session (jeton de `curl`) ; `form`, la route du formulaire (son jeton). */
export type UploadChannel = "link" | "form"

/**
 * La consommation (AC-f5) : `consume_upload_ticket` sous `anon`, dans sa propre transaction, validée avant toute écriture,
 * bornée à l'empreinte, à la porte qui l'a reçue et à l'organisation de l'adresse. `null` : inconnu, expiré, servi (par
 * l'une ou l'autre porte), d'une autre organisation, ou jeton de l'autre porte.
 */
async function consumeTicket(orgId: string, hash: string, via: UploadChannel): Promise<UploadTicket | null> {
  const [row] = await inTransaction(createAnonPlatformDb(), "uploads: consume", (sql) => sql<{ ticket: TicketJson | null }[]>`
    select platform.consume_upload_ticket(${orgId}, ${hash}, ${via === "form"}) as ticket`)
  const ticket = row?.ticket
  if (!ticket) return null
  return {
    userId: ticket.user_id,
    email: ticket.email,
    ctx: ticket.ctx,
    kind: ticket.kind,
    mode: ticket.mode,
    path: ticket.target_path,
    name: ticket.name,
    title: ticket.title,
    summary: ticket.summary,
    key: ticket.key,
    baseRevision: ticket.base_revision,
    publish: ticket.publish,
  }
}

/** Un envoi : l'empreinte de son jeton et sa porte, ses octets, l'origine de l'adresse et le client, l'exécution après la réponse. */
export type UploadRequest = {
  hash: string
  via: UploadChannel
  bytes: Uint8Array
  origin: string
  userAgent: string | null
  /** Exécute une tâche après la réponse (`after` de l'hôte) ; sans elle, la ligne de journal est attendue. */
  defer?: (task: () => Promise<void>) => void
}

/**
 * La ligne de journal d'un envoi qui a servi son ticket (AC-f9) : sous le `ctx` du ticket, `method` `api`, `tool`
 * `uploads`, la cible, et `{ kind, mode, bytes }` en arguments, jamais le jeton ; l'issue et sa durée.
 */
function journalUpload(db: PlatformDb, identity: Identity, sent: { ticket: UploadTicket; request: UploadRequest }, outcome: { started: number; target: string; failure: unknown }): Promise<void> {
  const { ticket, request } = sent
  const failure = outcome.failure === null ? null : isPlatformError(outcome.failure) ? outcome.failure : new PlatformError("internal", "Internal error.")
  const line: JournalEntry = {
    org_id: identity.org.id,
    user_id: identity.user.id,
    method: "api",
    tool: "uploads",
    target: clip(outcome.target, MAX_TARGET_CHARS),
    args: { kind: ticket.kind, mode: ticket.mode, bytes: request.bytes.byteLength },
    is_error: failure !== null,
    error: failure ? journalError(failure.code, failure.message) : null,
    duration_ms: Date.now() - outcome.started,
    user_agent: request.userAgent,
    ctx: ticket.ctx,
    host: null,
  }
  // L'écrivain commun des portes (H07) : il ne lève jamais, un journal en panne ne change rien.
  const task = () => writeJournal(db, [line])
  if (!request.defer) return task()
  request.defer(task)
  return Promise.resolve()
}

/**
 * L'identité de la personne du ticket (AC-f6) : l'appelant bâti sur la ligne du ticket, puis l'appartenance relue dans
 * l'organisation de l'adresse. Qui n'en est plus membre : `not_member`, au log serveur, pas au journal (sa policy la
 * refuserait, AC-f9).
 */
async function ticketIdentity(org: IdentityOrg, ticket: UploadTicket): Promise<{ db: PlatformDb; identity: Identity }> {
  const db = createPlatformDb({ caller: { userId: ticket.userId, email: ticket.email } })
  try {
    return { db, identity: await identityInOrg(db, org, { userId: ticket.userId, email: ticket.email ?? "" }) }
  } catch (error) {
    if (!isPlatformError(error) || error.code !== "not_member") throw error
    console.error(`[platform] uploads: ticket of ${ticket.userId} served, no longer a member of ${org.id}; not journaled`)
    throw new PlatformError("not_member", `The person who asked for this link is no longer a member of ${org.name}: nothing was written.`)
  }
}

/**
 * Un envoi (AC-f4, étapes 5 à 8) : le ticket consommé, l'identité reconstruite, puis l'écriture, qui relit la destination,
 * contrôle le contenu et écrit (`writeUpload`) ; la ligne de journal suit, réussie ou non. À partir de la consommation, le
 * ticket est servi, quelle que soit l'issue.
 */
export async function receiveUpload(org: IdentityOrg, request: UploadRequest): Promise<UploadResult> {
  const ticket = await consumeTicket(org.id, request.hash, request.via)
  if (!ticket) throw unknownUploadLink()
  const started = Date.now()
  const { db, identity } = await ticketIdentity(org, ticket)
  try {
    const result = await writeUpload(db, identity, ticket, request)
    await journalUpload(db, identity, { ticket, request }, { started, target: result.data.path, failure: null })
    return result
  } catch (error) {
    await journalUpload(db, identity, { ticket, request }, { started, target: ticket.path, failure: error })
    throw error
  }
}

/**
 * La porte sans session (AC-f4, étape 5) : l'organisation de l'adresse, lue sous `anon` ; une adresse qui n'en sert
 * aucune rend la même réponse qu'un ticket inconnu. Le jeton se contrôle avant (route), et encore ici.
 */
export async function receiveLinkUpload(host: string | null, token: string, request: Omit<UploadRequest, "hash" | "via">): Promise<UploadResult> {
  if (!UPLOAD_TOKEN_PATTERN.test(token)) throw unknownUploadLink()
  const org = await resolveOrg(createAnonPlatformDb(), host).catch((error: unknown) => {
    throw isPlatformError(error) && error.code === "unknown_org" ? unknownUploadLink() : error
  })
  return receiveUpload(org, { ...request, hash: uploadTokenHash(token), via: "link" })
}

type OwnTicket = { kind: UploadKind; mode: UploadMode; target_path: string; name: string | null; expires_at: string }

/**
 * Le ticket de la personne connectée (AC-f15), encore libre et valable, lu sous sa session sans être consommé, par le
 * jeton du formulaire seul ; celui d'une autre personne, servi, expiré, inconnu, ou le jeton de `curl` : la même réponse
 * qu'un ticket inconnu.
 */
async function ownTicket(db: PlatformDb, identity: Identity, token: unknown): Promise<OwnTicket> {
  if (typeof token !== "string" || !UPLOAD_TOKEN_PATTERN.test(token)) throw unknownUploadLink()
  const [row] = await inTransaction(db, "uploads: form", (sql) => sql<OwnTicket[]>`
    select kind, mode, target_path, name, to_json(expires_at) #>> '{}' as expires_at from platform.upload_tickets
     where org_id = ${identity.org.id} and form_token_hash = ${uploadTokenHash(token)} and user_id = ${identity.user.id}
       and used_at is null and expires_at > now()`)
  if (!row) throw unknownUploadLink()
  return row
}

/** Ce que montre le formulaire de dépôt (AC-f15) : la destination du ticket de la personne, sans le consommer. */
export async function uploadForm(db: PlatformDb, identity: Identity, token: unknown): Promise<UploadFormView> {
  const row = await ownTicket(db, identity, token)
  return { path: row.target_path, kind: row.kind, mode: row.mode, name: row.name, expiresAt: row.expires_at }
}

/**
 * Un fichier déposé par le formulaire (AC-f15, ADR-018 § 8), sous la session de la personne du ticket : son ticket relu
 * d'abord, par le jeton du formulaire (une autre personne n'en consomme aucun), puis l'envoi, comme par `curl`.
 */
export async function receiveFormUpload(db: PlatformDb, identity: Identity, token: string, request: Omit<UploadRequest, "hash" | "via">): Promise<UploadResult> {
  await ownTicket(db, identity, token)
  return receiveUpload(identity.org, { ...request, hash: uploadTokenHash(token), via: "form" })
}
