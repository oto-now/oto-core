// Les fonctions de l'API d'un hôte que la personne peut appeler (`fonctions-d-un-hote-index.md` § Visibilité par personne) :
// oto les demande à l'hôte, `GET <adresse><x-oto.functions>` (`/me/functions`) sous le jeton de la personne pour l'API,
// et ne se fie pas aux rôles déclarés (`x-oto-roles`), qui servent l'affichage : la visibilité réelle dépend de droits
// plus fins que l'hôte seul connaît. La liste est gardée en mémoire cinq minutes par organisation, personne, adresse et
// version du document. Elle sert le routage (`context`, `find`, `read functions`), jamais la sécurité : `call` ne la lit
// pas, et une fonction absente de la liste part quand même vers l'hôte, qui décide et dont le refus est relayé. Sans ce
// module, l'index montrerait à chacun les 78 fonctions d'un hôte, y compris celles qu'il ne peut pas appeler.
import type { FunctionContext } from "../catalog/define"
import { guardedFetch } from "../connectors/address-guard"
import { requestAnswer, type ConnectorApi } from "../connectors/http"
import type { PlatformDb } from "../db"
import { PlatformError } from "../errors"
import type { Identity } from "../identity"
import { oidcMode } from "../issuer"
import { cut } from "../journal"
import { isJsonObject } from "../json"
import { hostBearer } from "./consent"
import { hostHeaders } from "./functions"
import { hostProblems } from "./problem-json"
import { servedHost, type ServedHost } from "./served"

/** Combien de temps la liste d'une personne est gardée. */
export const VISIBILITY_KEPT_MS = 5 * 60_000
/** Délai de la lecture de la liste, corps compris. */
const VISIBILITY_TIMEOUT_MS = 10_000
/**
 * Au plus, en caractères, la raison d'une liste indisponible, dite dans l'index : assez pour le lien d'autorisation
 * entier d'un consentement à donner (plus de 400 caractères), qu'une coupe rendrait inutilisable.
 */
export const UNAVAILABLE_REASON_MAX = 1_000
/**
 * Le scope du jeton de la liste : aucun. La liste ne lit que l'identité de la personne ; le jeton porte l'audience de
 * l'API (`resource`), jamais le droit d'appeler une fonction.
 */
export const VISIBILITY_SCOPE = ""

/** Ce que l'appelant apporte pour lire sa liste : son jeton vérifié, l'origine appelée, la conversation et son client. */
export type HostViewer = Pick<FunctionContext, "accessToken" | "origin" | "ctx" | "host">

/**
 * La visibilité des fonctions de l'hôte pour une personne : pas d'API servie (`none`) ; la liste, en noms du document
 * (`operationId`) ; ou indisponible, avec sa raison, que l'index dit au lieu de tout montrer.
 */
export type HostVisibility =
  | { kind: "none" }
  | { kind: "visible"; host: ServedHost; names: ReadonlySet<string> }
  | { kind: "unavailable"; host: ServedHost; reason: string }

const kept = new Map<string, { names: ReadonlySet<string>; until: number }>()

/** Vide les listes gardées ; les tests seuls. */
export function forgetHostVisibility(): void {
  kept.clear()
}

/** Les noms de la réponse de l'hôte, `{ "functions": ["projet.lister", …] }` ; une autre forme est une panne de l'hôte. */
function namesOf(value: unknown, host: ServedHost): ReadonlySet<string> {
  const { title, index } = host.imported
  const listed = isJsonObject(value) ? value.functions : undefined
  if (!Array.isArray(listed) || !listed.every((name): name is string => typeof name === "string")) {
    console.error(`[platform] host api ${title}: unreadable list of the person's functions`)
    throw new PlatformError("upstream_error", `${title} sent an unreadable list of your functions (expected {"functions": [names]}).`)
  }
  const known = new Set(index.map((entry) => entry.operationId))
  const unknown = listed.filter((name) => !known.has(name))
  // Un nom que le document servi ne porte pas (un document plus récent chez l'hôte, pas encore rafraîchi) : rien à montrer.
  if (unknown.length > 0) console.error(`[platform] host api ${title}: ${unknown.length} listed functions are not in the served document ${host.imported.version}`)
  return new Set(listed.filter((name) => known.has(name)))
}

/** La liste de l'hôte, lue sous le jeton de la personne pour l'API (`hostBearer`, au scope vide). */
async function readList(context: FunctionContext, host: ServedHost, subjectToken: string): Promise<ReadonlySet<string>> {
  const { imported, address } = host
  const token = await hostBearer(context, imported, VISIBILITY_SCOPE, subjectToken)
  // Les refus de l'hôte arrivent en `problem+json` ; toute autre réponse hors 2xx suit la règle commune (`upstream_error`).
  const api: ConnectorApi = { label: imported.title, baseUrl: address, timeoutMs: VISIBILITY_TIMEOUT_MS, errors: [], problems: hostProblems(imported.title) }
  const headers = { accept: "application/json", authorization: `Bearer ${token}`, ...hostHeaders(context) }
  // `guardedFetch` lu à l'appel : l'adresse de l'organisation est une saisie, gardée à chaque requête.
  const { value } = await requestAnswer(api, { method: "GET", path: imported.functionsPath, headers, pacingKey: `host:${context.identity.org.id}` }, guardedFetch())
  return namesOf(value, host)
}

/**
 * La visibilité des fonctions de l'hôte pour la personne de `identity`. Sans émetteur OIDC ni API servie : `none`. Un
 * refus ou une panne (jeton, consentement à donner, hôte injoignable, réponse illisible) rend `unavailable` avec son
 * message, jamais la liste entière ; seule une liste lue est gardée.
 */
export async function hostVisibility(db: PlatformDb, identity: Identity, viewer: HostViewer): Promise<HostVisibility> {
  if (!oidcMode()) return { kind: "none" }
  const host = await servedHost(db, identity)
  if (!host) return { kind: "none" }
  if (!viewer.accessToken) return { kind: "unavailable", host, reason: "no verified session of the person to ask for them" }
  const key = JSON.stringify([identity.org.id, identity.user.id, host.address, host.imported.version])
  const now = Date.now()
  const known = kept.get(key)
  if (known && known.until > now) return { kind: "visible", host, names: known.names }
  try {
    const names = await readList({ db, identity, ...viewer }, host, viewer.accessToken)
    kept.set(key, { names, until: now + VISIBILITY_KEPT_MS })
    return { kind: "visible", host, names }
  } catch (error) {
    if (!(error instanceof PlatformError)) throw error
    return { kind: "unavailable", host, reason: cut(error.message, UNAVAILABLE_REASON_MAX) }
  }
}
