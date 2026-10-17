// Le branchement hébergé du compte d'une personne à un connecteur à `accountIdentity` (`connecteurs-et-comptes.md`
// § Compte de l'hôte et compte rattaché) : le départ, pour la personne connectée, qui pose une demande datée et rend
// l'adresse du lien d'authentification hébergée du tiers (ou relie sans lui un identifiant déjà à elle) ; puis le
// retour sur l'adresse de retour du paquet, qui liste les comptes de la clé de l'hôte, applique les gardes, sonde les
// candidats et ne lie que s'il en reste un seul vivant. Le tiers n'est joint que par le port que l'hôte a fourni à
// `registerConnectors` (`hostedLinks`), construit avec sa clé : aucun champ de l'hôte ni secret n'y passe par le
// paquet. L'écriture de `accounts.linked_id` revient à `platform.link_hosted_account` seule, qui refait les gardes sous
// verrou : ce module décide des candidats, la base garde le point d'écriture. Sans lui, un compte rattaché ne se
// connecterait pas. Un refus ne dit jamais combien de comptes porte la clé ni à qui est un compte.
import { hostedLinkReturnSchema, hostedLinkSchema } from "../../schemas/connectors"
import { declaredConnector, type DeclaredConnector } from "../catalog/connector-source"
import type { PlatformDb } from "../db"
import { fromDatabaseError, inTransaction, invalidInput, isUniqueViolation, PlatformError, type PlatformErrorCode } from "../errors"
import type { Identity } from "../identity"
import type { Tx } from "../sql"
import { accountRows, summary, type AccountSummary } from "./accounts"
import { CONSENT_DEFAULT_RETURN, consentLabel } from "./consent"
import { keepDeclaredConnector } from "./declaration"
import type { ConnectorAccountIdentity, HostedLinkProvider } from "./definition"
import { readHostFields } from "./host-fields"
import { returnAddress } from "./return-address"

/** Le chemin de l'adresse de retour du branchement, sous la porte du paquet. */
export const HOSTED_LINK_CALLBACK_PATH = "/api/platform/hosted-link/callback"
/** Durée d'une demande de branchement, et du lien que le tiers en tire. */
const HOSTED_LINK_TTL_MINUTES = 60
/** L'écart admis entre la création d'un compte chez le tiers et la demande qui le revendique (horloges, saisie). */
const PROVENANCE_SLACK_MS = 5 * 60 * 1000
/** La liste blanche d'un identifiant chez le tiers, comme le contrôle de `accounts.linked_id`. */
const LINKED_ID = /^[A-Za-z0-9_-]{1,128}$/

/** L'adresse de retour d'une demande de branchement, pour l'adresse de l'organisation (`https://acme.example.com`). */
export function hostedLinkReturnUrl(origin: string, requestId: string): string {
  return `${origin}${HOSTED_LINK_CALLBACK_PATH}?request=${encodeURIComponent(requestId)}`
}

/** Un connecteur à compte rattaché déclaré, avec son port ; sinon le refus nommé. */
type HostedConnector = DeclaredConnector & { identityOf: ConnectorAccountIdentity; port: HostedLinkProvider }

function hostedConnector(name: string): HostedConnector {
  const declared = declaredConnector(name)
  const identityOf = declared?.definition.accountIdentity
  if (!declared || !identityOf) throw new PlatformError("invalid_arguments", `Connector ${name} does not connect an account hosted by a third party.`)
  if (!declared.hostedLinks) {
    console.error(`[platform] connector ${name}: no hostedLinks given to registerConnectors`)
    throw new PlatformError(
      "not_enabled",
      `${declared.definition.label} accounts cannot be connected in this application yet. Ask whoever runs this application to configure it.`,
    )
  }
  // Les champs de l'hôte sont exigés au branchement comme à l'appel : un compte lié qu'aucun appel ne pourrait servir
  // ne se branche pas.
  readHostFields(declared)
  return { ...declared, identityOf, port: declared.hostedLinks }
}

/** Un identifiant chez le tiers admis : la liste blanche de `linked_id` et le motif de la description. */
function acceptedId(connector: HostedConnector, id: unknown): id is string {
  return typeof id === "string" && LINKED_ID.test(id) && new RegExp(connector.identityOf.pattern).test(id)
}

/** La panne du tiers, sans rien de ce qu'il a dit : au log serveur, le nom de l'erreur seul. */
function upstream(connector: HostedConnector, step: string, error?: unknown): PlatformError {
  const name = error === undefined ? "invalid answer" : error instanceof Error ? error.name : typeof error
  console.error(`[platform] connector ${connector.definition.name}: hostedLinks.${step} failed (${name})`)
  return new PlatformError("upstream_error", `${connector.definition.label} is unavailable. Nothing was saved; retry later.`)
}

/** Une méthode du port, dont toute exception devient `upstream_error`. */
async function viaPort<T>(connector: HostedConnector, step: keyof HostedLinkProvider, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    throw upstream(connector, step, error)
  }
}

/** L'état d'un identifiant chez le tiers, par la sonde du port. */
type Probe = { state: "alive"; label: string } | { state: "dead" } | { state: "unavailable" }

async function probe(connector: HostedConnector, id: string): Promise<Probe> {
  const answer = await viaPort(connector, "probe", () => connector.port.probe(id))
  if (answer?.state === "alive" && typeof answer.label === "string" && answer.label.trim()) return { state: "alive", label: answer.label.trim() }
  if (answer?.state === "dead" || answer?.state === "unavailable") return { state: answer.state }
  throw upstream(connector, "probe")
}

/**
 * Une date de création chez le tiers, en ISO 8601 avec fuseau (`2026-10-17T09:30:00Z`, fraction de toute longueur,
 * décalage `+02:00`) ; `null` pour une date absente ou illisible, qui refuse la provenance. Les autres formes du tiers
 * (Unix, sans fuseau) sont traduites par le port.
 */
export function hostedCreatedAt(value: string | null): Date | null {
  if (value === null) return null
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?)(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/.exec(value)
  if (!match) return null
  const [, base, fraction = "", zone] = match
  const at = new Date(`${base}${fraction.slice(0, 4)}${zone}`)
  return Number.isNaN(at.getTime()) ? null : at
}

/** Les raisons d'un refus du branchement : le code du paquet, et le message que lit la personne. */
const REFUSALS = {
  not_found: "not_found",
  expired: "invalid_arguments",
  invalid_arguments: "invalid_arguments",
  no_candidate: "not_found",
  candidates_dead: "not_enabled",
  ambiguous_candidates: "conflict",
  forbidden: "forbidden",
} as const satisfies Record<string, PlatformErrorCode>

export type HostedRefusal = keyof typeof REFUSALS

function refusalMessage(refusal: HostedRefusal, label: string): string {
  switch (refusal) {
    case "not_found":
      return "This connection request is unknown or already used. Connect the account again."
    case "expired":
      return "This connection request has expired. Connect the account again."
    case "invalid_arguments":
      return `${label} came back with an account reference that is not valid. Connect the account again.`
    case "no_candidate":
      return `No ${label} account connected during this request was found. Connect the account again.`
    case "candidates_dead":
      return `The ${label} session of this account is disconnected. Connect the account again.`
    case "ambiguous_candidates":
      return `Several ${label} accounts could match this request. Nothing was saved; connect the account again in a few minutes.`
    case "forbidden":
      return `This ${label} account cannot be connected by you.`
  }
}

/** Le refus nommé d'un branchement : son code, et la raison en `details.refusal` quand elle n'est pas le code. */
export function hostedRefusal(refusal: HostedRefusal, label: string): PlatformError {
  const code = REFUSALS[refusal]
  const details = refusal === code ? undefined : { refusal }
  return new PlatformError(code, details ? `${refusalMessage(refusal, label)} (${refusal})` : refusalMessage(refusal, label), details)
}

/** Un compte de la clé, tel que le port le liste et que le paquet en lit la date. */
export type HostedListed = { id: string; createdAt: Date | null }

/** Ce que la base dit des candidats : les identifiants déjà à la personne, et ceux d'une autre personne. */
export type HostedOwnership = { mine: ReadonlySet<string>; elsewhere: ReadonlySet<string> }

/**
 * Les candidats d'un retour, avant toute sonde : les comptes de la clé, restreints à l'indice quand le tiers en a donné
 * un ; jamais l'identifiant d'une autre personne ; un identifiant déjà à la personne, ou un compte créé chez le tiers
 * au plus tôt cinq minutes avant la demande (date absente ou illisible : écarté). L'indice ne lève aucune garde : un
 * indice d'une autre personne refuse (`forbidden`), un indice absent de la liste ou sans provenance aussi
 * (`no_candidate`). Aucun candidat : `no_candidate`.
 */
export function hostedCandidates(
  listed: readonly HostedListed[],
  ownership: HostedOwnership,
  request: { createdAt: Date; hint?: string },
): { refusal: HostedRefusal } | { candidates: HostedListed[] } {
  const offered = request.hint === undefined ? listed : listed.filter((account) => account.id === request.hint)
  if (request.hint !== undefined && ownership.elsewhere.has(request.hint)) return { refusal: "forbidden" }
  const earliest = request.createdAt.getTime() - PROVENANCE_SLACK_MS
  const candidates = offered.filter(
    (account) => !ownership.elsewhere.has(account.id) && (ownership.mine.has(account.id) || (account.createdAt !== null && account.createdAt.getTime() >= earliest)),
  )
  return candidates.length === 0 ? { refusal: "no_candidate" } : { candidates }
}

/**
 * Le candidat à lier, d'après les sondes : le seul vivant. Deux vivants : `ambiguous_candidates`. Une sonde
 * indisponible ne dit rien de l'état ni de l'unicité : `upstream_error` (`unavailable`), jamais « mort ». Tous morts :
 * `candidates_dead`.
 */
export function chooseHostedCandidate(
  probed: ReadonlyArray<{ account: HostedListed; probe: Probe }>,
): { refusal: HostedRefusal } | { unavailable: true } | { account: HostedListed; label: string } {
  const alive = probed.filter((entry) => entry.probe.state === "alive")
  if (alive.length > 1) return { refusal: "ambiguous_candidates" }
  if (probed.some((entry) => entry.probe.state === "unavailable")) return { unavailable: true }
  const [chosen] = alive
  if (!chosen || chosen.probe.state !== "alive") return { refusal: "candidates_dead" }
  return { account: chosen.account, label: chosen.probe.label }
}

/** Les identifiants déjà rattachés à la personne pour ce connecteur, dans toutes ses organisations. */
type MyHosted = { org_id: string; account_id: string; linked_id: string; status: string }

const myHostedAccounts = (sql: Tx, connector: string) =>
  sql<MyHosted[]>`select org_id, account_id, linked_id, status from platform.my_hosted_accounts(${connector})`

/** Une demande posée : son identifiant, sa date et son échéance, posées par la base. */
type PostedRequest = { id: string; created_at: Date; expires_at: Date }

/**
 * Lie l'identifiant sur le compte personnel de la personne, par `platform.link_hosted_account`, qui refait les gardes
 * sous verrou et consomme les demandes ouvertes. Rend le compte lié ; un refus de la base, nommé.
 */
async function link(db: PlatformDb, identity: Identity, connector: HostedConnector, linking: { requestId: string; id: string; createdAt: Date | null; who: string }): Promise<AccountSummary> {
  const name = connector.definition.name
  const label = consentLabel(linking.who, name)
  return db
    .tx(async (sql) => {
      const [outcome] = await sql<{ account_id: string | null; refusal: string | null }[]>`
        select account_id, refusal from platform.link_hosted_account(${linking.requestId}::uuid, ${linking.id}, ${linking.createdAt?.toISOString() ?? null}::timestamptz, ${label})`
      if (outcome?.refusal) {
        if (!(outcome.refusal in REFUSALS)) {
          console.error(`[platform] link_hosted_account: unknown refusal ${outcome.refusal}`)
          throw new PlatformError("internal", "Internal error.")
        }
        throw hostedRefusal(outcome.refusal as HostedRefusal, connector.definition.label)
      }
      const [written] = outcome?.account_id ? await accountRows(sql, identity.org.id, { id: outcome.account_id }) : []
      if (!written) {
        console.error(`[platform] link_hosted_account: account ${outcome?.account_id ?? "?"} linked but not read back`)
        throw new PlatformError("internal", "Internal error.")
      }
      return summary(written)
    })
    .catch((error) => {
      if (isUniqueViolation(error)) throw new PlatformError("conflict", `An account labelled ${label} already exists in ${identity.org.name}, held by someone else. Ask an administrator of ${identity.org.name}.`)
      throw fromDatabaseError(error, "linkHostedAccount: link_hosted_account")
    })
}

/**
 * Ce que le départ fait d'un identifiant déjà à la personne : le relier s'il est vivant (dans cette organisation ou
 * une autre) ; reconnecter le premier mort, ceux de cette organisation d'abord ; `null` sans identifiant. Une sonde
 * indisponible sans vivant : `upstream_error`.
 */
async function ownedPlan(identity: Identity, connector: HostedConnector, owned: MyHosted[]): Promise<{ relink: string; who: string } | { reconnect: string } | null> {
  const ids = [...new Set([...owned].sort((a, b) => Number(b.org_id === identity.org.id) - Number(a.org_id === identity.org.id)).map((row) => row.linked_id))]
  let dead: string | null = null
  let unavailable = false
  for (const id of ids) {
    if (!acceptedId(connector, id)) {
      console.error(`[platform] connector ${connector.definition.name}: a linked account id does not match account_identity.pattern`)
      continue
    }
    const state = await probe(connector, id)
    if (state.state === "alive") return { relink: id, who: state.label }
    if (state.state === "dead") dead ??= id
    else unavailable = true
  }
  if (dead !== null) return { reconnect: dead }
  if (unavailable) throw upstream(connector, "probe")
  return null
}

/**
 * Démarre le branchement hébergé de la personne connectée à un connecteur à `accountIdentity` (`POST hosted-link`) et
 * rend l'adresse où l'envoyer. Une demande datée d'une heure est posée (les demandes échues de l'organisation purgées
 * au passage) ; un identifiant déjà à la personne et vivant se relie sans repasser par le tiers, et l'adresse rendue
 * est alors l'écran de retour, `?hosted=connected&account=<libellé>` ; un identifiant à elle dont la session est morte
 * se reconnecte (`reconnect`), sinon le lien crée un compte (`create`). `return_to` : l'écran de l'hôte où revenir
 * (l'écran Connecteurs par défaut). Refus : saisie invalide, connecteur sans compte rattaché (`invalid_arguments`),
 * port ou champ de l'hôte absent (`not_enabled`), panne du tiers ou adresse qui n'est pas `https` (`upstream_error`).
 */
export async function startHostedLink(db: PlatformDb, identity: Identity, input: unknown, options: { origin: string }): Promise<{ url: string }> {
  const parsed = hostedLinkSchema.safeParse(input)
  if (!parsed.success) throw invalidInput(parsed.error)
  const connector = hostedConnector(parsed.data.connector)
  const name = connector.definition.name
  const returnTo = parsed.data.return_to ?? CONSENT_DEFAULT_RETURN
  const owned = await inTransaction(db, "startHostedLink: my_hosted_accounts", async (sql) => {
    await sql`delete from platform.hosted_link_requests where org_id = ${identity.org.id} and expires_at < now()`
    return myHostedAccounts(sql, name)
  })
  const plan = await ownedPlan(identity, connector, owned)
  const kind = plan !== null && "reconnect" in plan ? "reconnect" : "create"
  const posted = await inTransaction(db, "startHostedLink: hosted_link_requests", async (sql) => {
    await keepDeclaredConnector(sql, name)
    const [row] = await sql<PostedRequest[]>`
      insert into platform.hosted_link_requests (org_id, user_id, connector, kind, return_to, expires_at)
      values (${identity.org.id}, ${identity.user.id}, ${name}, ${kind}, ${parsed.data.return_to ?? null}, now() + make_interval(mins => ${HOSTED_LINK_TTL_MINUTES}))
      returning id, created_at, expires_at`
    return row
  })
  if (plan !== null && "relink" in plan) {
    const account = await link(db, identity, connector, { requestId: posted.id, id: plan.relink, createdAt: null, who: plan.who })
    return { url: returnAddress(options.origin, returnTo, { hosted: "connected", account: account.label }) }
  }
  try {
    const answer = await viaPort(connector, "createLink", () =>
      connector.port.createLink({
        requestId: posted.id,
        kind,
        ...(plan !== null && "reconnect" in plan ? { linkedId: plan.reconnect } : {}),
        returnUrl: hostedLinkReturnUrl(options.origin, posted.id),
        expiresAt: new Date(posted.expires_at),
      }),
    )
    if (typeof answer?.url !== "string" || !URL.canParse(answer.url) || new URL(answer.url).protocol !== "https:") throw upstream(connector, "createLink")
    return { url: answer.url }
  } catch (error) {
    // Une demande sans lien ne doit pas rester ouverte : elle couvrirait, une heure, les comptes d'autres personnes.
    await inTransaction(db, "startHostedLink: hosted_link_requests", (sql) => sql`delete from platform.hosted_link_requests where id = ${posted.id}`)
    throw error
  }
}

/** Une demande de branchement lue au retour. */
type PendingRequest = { connector: string; return_to: string | null; created_at: Date; expires: boolean; consumed: boolean }

/** Les comptes de la clé, tels que le port les liste : leur forme contrôlée, les identifiants hors motif écartés. */
async function listedAccounts(connector: HostedConnector): Promise<HostedListed[]> {
  const answer: unknown = await viaPort(connector, "listAccounts", () => connector.port.listAccounts())
  if (!Array.isArray(answer)) throw upstream(connector, "listAccounts")
  const listed: HostedListed[] = []
  let rejected = 0
  for (const entry of answer) {
    if (typeof entry !== "object" || entry === null || !("createdAt" in entry) || (entry.createdAt !== null && typeof entry.createdAt !== "string")) {
      throw upstream(connector, "listAccounts")
    }
    if (!("id" in entry) || !acceptedId(connector, entry.id)) {
      rejected += 1
      continue
    }
    listed.push({ id: entry.id, createdAt: hostedCreatedAt(entry.createdAt as string | null) })
  }
  if (rejected > 0) console.error(`[platform] connector ${connector.definition.name}: hostedLinks.listAccounts gave ids outside account_identity.pattern`)
  return listed
}

/**
 * Le retour du tiers sur l'adresse de retour (`GET hosted-link/callback?request=<demande>`) : la demande lue à la
 * personne et à l'organisation de l'appel, non consommée, non échue ; l'indice du tiers (sous le nom de
 * `accountIdentity`) contrôlé avant tout appel au tiers ; les comptes de la clé listés, les gardes appliquées
 * (`hostedCandidates`), chaque candidat sondé (`chooseHostedCandidate`), puis le seul vivant lié sur le compte
 * personnel de la personne, nommé « <qui> (<connecteur>) ». Rend le compte et l'écran où revenir, que l'appelant reçoit
 * aussi sur un refus postérieur à la lecture de la demande (`details.returnTo`). Refus : `not_found` (demande inconnue,
 * d'une autre personne ou consommée ; `no_candidate`), `invalid_arguments` (indice hors liste blanche ; `expired`),
 * `not_enabled` (`candidates_dead`, port ou champ de l'hôte absent), `conflict` (`ambiguous_candidates`, libellé pris),
 * `forbidden`, `upstream_error`. Rien n'est rangé sur un refus, et la demande reste ouverte.
 */
export async function linkHostedAccount(db: PlatformDb, identity: Identity, query: Record<string, string>): Promise<{ account: AccountSummary; returnTo: string }> {
  const parsed = hostedLinkReturnSchema.safeParse(query)
  if (!parsed.success) throw hostedRefusal("not_found", "")
  const [pending] = await inTransaction(db, "linkHostedAccount: hosted_link_requests", (sql) => sql<PendingRequest[]>`
    select connector, return_to, created_at, expires_at <= now() as expires, consumed_at is not null as consumed
      from platform.hosted_link_requests
     where id = ${parsed.data.request} and org_id = ${identity.org.id} and user_id = ${identity.user.id}`)
  if (!pending || pending.consumed) throw hostedRefusal("not_found", "")
  const returnTo = pending.return_to ?? CONSENT_DEFAULT_RETURN
  try {
    const declaredLabel = declaredConnector(pending.connector)?.definition.label ?? pending.connector
    if (pending.expires) throw hostedRefusal("expired", declaredLabel)
    const connector = hostedConnector(pending.connector)
    const label = connector.definition.label
    const hint = query[connector.identityOf.name]
    if (hint !== undefined && !acceptedId(connector, hint)) throw hostedRefusal("invalid_arguments", label)
    const listed = await listedAccounts(connector)
    const name = connector.definition.name
    const ownership = await inTransaction(db, "linkHostedAccount: ownership", async (sql) => {
      const mine = await myHostedAccounts(sql, name)
      const elsewhere = await sql<{ id: string }[]>`select id from platform.hosted_linked_elsewhere(${name}, ${listed.map((account) => account.id)}::text[]) as id`
      return { mine: new Set(mine.map((row) => row.linked_id)), elsewhere: new Set(elsewhere.map((row) => row.id)) }
    })
    const found = hostedCandidates(listed, ownership, { createdAt: new Date(pending.created_at), ...(hint !== undefined ? { hint } : {}) })
    if ("refusal" in found) throw hostedRefusal(found.refusal, label)
    const probed = []
    for (const account of found.candidates) probed.push({ account, probe: await probe(connector, account.id) })
    const chosen = chooseHostedCandidate(probed)
    if ("unavailable" in chosen) throw upstream(connector, "probe")
    if ("refusal" in chosen) throw hostedRefusal(chosen.refusal, label)
    const createdAt = ownership.mine.has(chosen.account.id) ? null : chosen.account.createdAt
    const account = await link(db, identity, connector, { requestId: parsed.data.request, id: chosen.account.id, createdAt, who: chosen.label })
    return { account, returnTo }
  } catch (error) {
    if (error instanceof PlatformError) throw new PlatformError(error.code, error.message, { ...error.details, returnTo })
    throw error
  }
}
