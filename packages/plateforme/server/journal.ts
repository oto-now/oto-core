// Journal des portes (H07) : une ligne par requête MCP traitée et par mutation de l'API, écrite
// après la réponse, sous l'appelant de la session, dans sa propre transaction (face SQL, E01-S10,
// HN-E01S10-2). Le journal fait foi, jamais le récit du modèle (banc : ChatGPT annonce des succès
// qui n'ont pas eu lieu) ; sans ce module, chaque porte aurait son écrivain et son format.
//
// Repris de la maquette (`mcp-test/src/proto/services/journal.ts` l. 10-49) : arguments bornés à
// 2 ko, signature de l'`initialize` lue dans le corps, écriture qui n'échoue jamais, `is_error`
// posé sur chaque ligne. Retiré : la colonne `client_name` (→ `host`, H29). Repris d'Oto
// (`oto_mcp/calllog.py`) : masquage par nom de clé, à profondeur bornée ; retiré : HMAC corrélable
// et `run_id`.
import type { StaffCaller } from "./admin/context"
import type { Database, Json } from "./database"
import type { PlatformDb } from "./db"
import type { Identity } from "./identity"
import { isJsonObject, jsonLeaves } from "./json"
import type { ToolOutput } from "./tool-output"

export type JournalEntry = Database["platform"]["Tables"]["journal"]["Insert"]

/** Arguments stockés : 2 ko suffisent à relire un appel ; la taille réelle va dans `args_chars`. */
export const MAX_LOGGED_ARGS_CHARS = 2048

/**
 * Profondeur des clés contrôlées, un niveau par objet ou tableau traversé, comme Oto
 * (`_masque_en_profondeur`) : au-delà, une valeur est gardée telle quelle (N29), et la lecture la
 * montre en texte coupé, ses clés secrètes masquées (E05-S05).
 */
export const MASK_DEPTH = 6
const MASKED = "[masked]"
// Nom de clé comparé sans casse, sans `-` ni `_` (N5) : `api_key`, `x-api-key`, `passwd` et
// `private_key` compris. `key` seul n'y est pas : c'est la clé métier des lignes de tableau.
const SECRET_KEY = /secret|token|passw|authorization|apikey|privatekey/
// `source_url` d'`upload.link` (E10-S02, AC-f14) : l'adresse d'un fichier, parfois signée, jamais gardée au journal.
// Nom normalisé comparé en entier : `resource_url` ou `datasource_url` restent lisibles.
const MASKED_NAMES: ReadonlySet<string> = new Set(["sourceurl"])
const MAX_SIGNATURE_CHARS = 200
/** `journal.error` : « <code>: <message> » coupé à 500 caractères (N4), aux deux portes et à la lecture (E05-S05). */
export const MAX_ERROR_CHARS = 500
/**
 * `journal.target` venu d'un texte libre (phrase de `context`, requête de `find`) : 200 caractères au
 * plus, par `clip` (colonne indexée) ; la phrase que `context` reprend dans sa ligne de routage aussi.
 */
export const MAX_TARGET_CHARS = 200

/**
 * Coupe sûre de ce qui va au journal, et des noms servis aux hosts (N31) : au plus `max` unités
 * UTF-16, sans moitié de paire de substitution. Une moitié seule, laissée par une coupe dans un
 * emoji ou venue du host, fait refuser à PostgREST tout le corps (400 PGRST102) : l'insertion
 * groupée perdrait toutes les lignes de la requête. La moitié coupée est retirée ; une moitié
 * venue du texte devient U+FFFD.
 */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text.toWellFormed()
  const last = text.charCodeAt(max - 1)
  return text.slice(0, last >= 0xd800 && last <= 0xdbff ? max - 1 : max).toWellFormed()
}

/**
 * `max` caractères au plus, « … » compris quand le texte est coupé, jamais au milieu d'un emoji
 * (`clip`) : noms, libellés et lignes servis aux hosts et au modèle (N31).
 */
export function cut(text: string, max: number): string {
  return text.length <= max ? text : `${clip(text, max - 1)}…`
}

/** La colonne `error` d'une ligne, à l'identique aux deux portes : code H04, message, borne. */
export function journalError(code: string, message: string): string {
  return clip(`${code}: ${message}`, MAX_ERROR_CHARS)
}

/**
 * Chaque chaîne d'une valeur JSON, clés comprises, sans moitié de paire (N31) : les arguments gardés
 * au journal, et toute entrée écrite en base (`write`, E03-S03 AC28).
 */
export function wellFormed<T>(value: T): T {
  if (typeof value === "string") {
    // Une chaîne rendue bien formée reste une chaîne : son type est celui reçu.
    return value.toWellFormed() as T
  }
  if (Array.isArray(value)) {
    // Un tableau dont chaque élément garde son type garde le sien.
    return value.map(wellFormed) as T
  }
  if (value === null || typeof value !== "object") return value
  // Un objet reconstruit clé par clé, chaque valeur de même type, garde sa forme : son type est celui reçu.
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key.toWellFormed(), wellFormed(item)])) as T
}

function isSecretKey(key: string): boolean {
  const name = key.toLowerCase().replace(/[-_]/g, "")
  return SECRET_KEY.test(name) || MASKED_NAMES.has(name)
}

function masked(value: unknown, depth: number): unknown {
  if (depth === 0 || value === null || typeof value !== "object") return value
  if (Array.isArray(value)) return value.map((item) => masked(item, depth - 1))
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, isSecretKey(key) ? MASKED : masked(item, depth - 1)]),
  )
}

/**
 * Les valeurs secrètes masquées (H07) sur `depth` niveaux, six par défaut : la fonction même de
 * `loggedArgs`, rejouée à la lecture du journal (E05-S05) pour les lignes écrites hors de
 * `writeJournal` (script Démo, import), et sans borne sur ce que la lecture montre en texte au-delà
 * de six niveaux (HN-E05S05-20) ; aucune seconde liste de clés.
 */
export function maskSecretArgs(args: unknown, depth = MASK_DEPTH): unknown {
  return masked(args, depth)
}

/**
 * Les arguments tels que journalisés : valeurs secrètes masquées, puis 2 048 caractères sérialisés
 * au plus ; au-delà, `{ _truncated: true, head: <2 048 premiers caractères> }`. Aucune moitié de
 * paire de substitution ne passe (N31) : la sérialisation échappe celles du host, que la relecture
 * rendrait telles quelles.
 */
export function loggedArgs(args: unknown): Json {
  const text = JSON.stringify(maskSecretArgs(args)) ?? "null"
  if (text.length <= MAX_LOGGED_ARGS_CHARS) return wellFormed(JSON.parse(text))
  return { _truncated: true, head: clip(text, MAX_LOGGED_ARGS_CHARS) }
}

/**
 * Le début de la ligne d'une requête d'un membre (H07) : qui, quoi, arguments masqués et bornés, et leur taille réelle.
 * Commun à la porte MCP et à l'appel d'une fonction par le serveur de l'hôte (`callFunction`).
 */
export function openedEntry(identity: Identity, request: { method: string; params: unknown; userAgent: string | null }): JournalEntry & { args_chars: number } {
  return {
    org_id: identity.org.id,
    user_id: identity.user.id,
    user_agent: request.userAgent,
    method: request.method,
    args: loggedArgs(request.params ?? {}),
    args_chars: JSON.stringify(request.params ?? {}).length,
  }
}

/**
 * Où un outil a été servi, pour sa ligne : le `ctx` et le client (`host`) de la conversation, nuls hors d'une
 * conversation d'assistant, et la taille de ce qui a été rendu.
 */
export type ServedEntry = { ctx: string | null; host: string | null; resultChars: number }

/** Ce qui remplace, dans une ligne de journal, la valeur d'un argument marqué « donnée personnelle ». */
export const PERSONAL = "[personal]"

/** Au-dessous, une valeur personnelle n'est retirée que là où elle est seule : retirée d'un texte, elle le hacherait. */
const MIN_PERSONAL_CHARS = 3

/** `text` sans aucune des `values` : seule, elle devient `[personal]` ; dans un texte, chaque occurrence aussi. */
function scrubbed(text: string, values: readonly string[]): string {
  if (values.includes(text)) return PERSONAL
  let out = text
  for (const value of values) if (value.length >= MIN_PERSONAL_CHARS) out = out.split(value).join(PERSONAL)
  return out
}

function scrubbedJson(value: unknown, values: readonly string[]): unknown {
  if (typeof value === "string") return scrubbed(value, values)
  if (typeof value === "number") return values.includes(String(value)) ? PERSONAL : value
  if (Array.isArray(value)) return value.map((item) => scrubbedJson(item, values))
  if (value === null || typeof value !== "object") return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrubbedJson(item, values)]))
}

/**
 * Les valeurs du corps d'une requête HTTP que la liste blanche de sa route (`journalArgs`) n'a pas gardées : la porte
 * les retire de la cible, comme celles d'un argument marqué (`pseudonymisation.md` § Les quatre primitives).
 */
export function withheldValues(body: unknown, kept: Json | null): string[] {
  const journaled = jsonLeaves(kept)
  return [...jsonLeaves(body)].filter((value) => !journaled.has(value))
}

/** `text` sans aucune des `values` retenues hors du journal (`withheldValues`) ; `null` reste `null`. */
export function withoutWithheld(text: string | null, values: readonly string[]): string | null {
  return text === null || values.length === 0 ? text : scrubbed(text, values)
}

/**
 * La ligne sans les valeurs des arguments marqués « donnée personnelle » (`pseudonymisation.md` § Les quatre
 * primitives) : dans les arguments gardés (leur `head` coupé compris), la cible et le message d'erreur, où qu'un tiers
 * les ait recopiées. Une valeur égale à toute une chaîne ou à un nombre devient `[personal]` ; une valeur d'au moins
 * trois caractères est retirée de tout texte.
 */
function withoutPersonal(entry: JournalEntry, values: readonly string[] | undefined): void {
  if (!values || values.length === 0) return
  entry.args = scrubbedJson(entry.args, values) as Json
  if (typeof entry.target === "string") entry.target = scrubbed(entry.target, values)
  if (typeof entry.error === "string") entry.error = clip(scrubbed(entry.error, values), MAX_ERROR_CHARS)
}

/** Les clés réservées des arguments d'une ligne de `call` : ce que la fonction a fait, et à qui était le compte servi. */
function reservedArgs(entry: JournalEntry, output: Pick<ToolOutput, "outcome" | "lentBy">): void {
  if (!isJsonObject(entry.args)) return
  if (output.outcome) entry.args = { ...entry.args, _outcome: output.outcome }
  if (output.lentBy) entry.args = { ...entry.args, _lent_by: output.lentBy }
}

/**
 * La ligne d'un outil qui a répondu (H07) : `ctx` et client rendus par le service, sinon ceux de l'appel ; fonction,
 * chemin ou phrase touchés ; équipe et compte (E03-S04, AC16) ; et, en clés réservées des arguments après leur masquage
 * et leur coupe, ce qu'une fonction de `call` a fait (E11-S02, AC-h2, HN-E11S02-16), que le fil de l'accueil relit, et
 * la personne qui a partagé le compte servi (`_lent_by`).
 */
export function servedEntry(entry: JournalEntry, output: ToolOutput, served: ServedEntry): void {
  Object.assign(entry, {
    ctx: output.ctx ?? served.ctx,
    host: output.host ?? served.host,
    target: output.target ?? null,
    team_id: output.teamId ?? null,
    account_id: output.accountId ?? null,
    result_chars: served.resultChars,
  })
  withoutPersonal(entry, output.personal)
  reservedArgs(entry, output)
}

/**
 * La ligne d'un outil refusé ou en panne (H07) : l'équipe et le compte qu'un `call` avait établis avant d'échouer
 * (`trace`, E03-S04 AC16), le code et le message de l'erreur (`journalError`), et ce que l'échec a fait (la marque
 * posée sur le compte) et à qui était le compte, en clés réservées des arguments comme une ligne servie.
 */
export function failedEntry(
  entry: JournalEntry,
  failure: { code: string; message: string },
  served: ServedEntry & { trace: Pick<ToolOutput, "teamId" | "accountId" | "outcome" | "lentBy" | "personal"> },
): void {
  Object.assign(entry, {
    ctx: served.ctx,
    host: served.host,
    team_id: served.trace.teamId ?? null,
    account_id: served.trace.accountId ?? null,
    is_error: true,
    error: journalError(failure.code, failure.message),
    result_chars: served.resultChars,
  })
  withoutPersonal(entry, served.trace.personal)
  reservedArgs(entry, served.trace)
}

function signaturePart(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "?"
}

function clientInfoOf(message: unknown): { name?: unknown; version?: unknown } | null {
  if (!message || typeof message !== "object" || !("method" in message) || message.method !== "initialize") return null
  const params = "params" in message ? message.params : undefined
  const info = params && typeof params === "object" && "clientInfo" in params ? params.clientInfo : undefined
  return info && typeof info === "object" ? info : {}
}

/**
 * Signatures `client_name@version` des `initialize` d'un corps de requête (message seul ou lot) :
 * aucun handler à nous ne voit passer `initialize`, seul le corps dit quel client s'annonce (H29).
 * Une valeur absente devient `?` ; un corps illisible n'en a aucune.
 */
export function initializeSignatures(body: string): string[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    // Corps illisible : la porte répond l'erreur JSON-RPC, il n'y a rien à journaliser.
    return []
  }
  return (Array.isArray(parsed) ? parsed : [parsed])
    .map(clientInfoOf)
    .filter((info) => info !== null)
    .map((info) => clip(`${signaturePart(info.name)}@${signaturePart(info.version)}`, MAX_SIGNATURE_CHARS))
}

/**
 * Signature du dernier `initialize` journalisé pour cette personne, au même agent utilisateur (N3) ;
 * `null` sinon. Un membre : dans le `journal` de son organisation ; l'équipe plateforme : dans
 * `admin_journal`, sans organisation (fiche D99, M54, P6). claude.ai ouvre une conversation sans
 * `initialize` (banc E03, preuve 10) : le `ctx` hérite de la signature de la connexion.
 */
export async function lastHostSignature(db: PlatformDb, caller: Identity | StaffCaller, userAgent: string | null): Promise<string | null> {
  if (!userAgent) return null
  const member = "org" in caller
  try {
    const [row] = await db.tx((sql) =>
      "org" in caller
        ? sql<{ host: string | null }[]>`select host from platform.journal
                                          where org_id = ${caller.org.id} and user_id = ${caller.user.id}
                                            and method = 'initialize' and user_agent = ${userAgent}
                                          order by ts desc, id desc limit 1`
        : sql<{ host: string | null }[]>`select host from platform.admin_journal
                                          where user_id = ${caller.userId} and method = 'initialize' and user_agent = ${userAgent}
                                          order by ts desc, id desc limit 1`,
    )
    return row?.host ?? null
  } catch (error) {
    // La signature ne sert que le journal : sa lecture en panne ne refuse ni `context` ni `admin_context`.
    console.error(`[platform] ${member ? "journal" : "admin journal"}: initialize read failed`, codeOf(error))
    return null
  }
}

/** Ce qu'un échec du journal laisse au log : le code d'une erreur de la base, jamais son message ; sinon l'erreur. */
function codeOf(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : error
}

type JournalColumn = keyof JournalEntry

/**
 * Insertion groupée, qui ne lève jamais : un journal en panne ne change pas la réponse servie
 * (H07). Chaque ligne reçoit toutes les colonnes du lot, nulles quand elle ne les donne pas, comme
 * les écrivait PostgREST (`sql(lignes)` ne prendrait que celles de la première) ; `is_error`, `not
 * null`, est donc posé sur chaque ligne. `args` part par `sql.json` (`supabase-patterns.md § Couplage
 * à Supabase (ADR-012)`).
 */
export async function writeJournal(db: PlatformDb, entries: readonly JournalEntry[]): Promise<void> {
  if (entries.length === 0) return
  const lines = entries.map((entry) => ({ is_error: false, ...entry }))
  // `Object.keys` rend des `string` : ce sont ici les clés d'une ligne du journal.
  const columns = [...new Set(lines.flatMap((line) => Object.keys(line) as JournalColumn[]))]
  try {
    await db.tx((sql) => {
      const rows = lines.map((line) =>
        Object.fromEntries(
          columns.map((column) => {
            const value = line[column] ?? null
            return [column, column === "args" && value !== null ? sql.json(value) : value]
          }),
        ),
      )
      return sql`insert into platform.journal ${sql(rows, columns)}`
    })
  } catch (error) {
    console.error("[platform] journal: insert failed", codeOf(error))
  }
}
