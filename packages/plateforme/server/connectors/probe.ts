// La sonde (`connecteurs-et-comptes.md` § Moteur des connecteurs décrits, Sonde) : la fonction `probe` du connecteur
// déclaré jouée avec `{}`, ses chemins `nonEmpty` exigés non vides et, pour un compte payant, son solde (`balance`) lu
// et jugé contre le seuil. Sur un compte (`probeAccount`), le solde décide la marque du compte (§ État d'un compte) et
// l'issue est gardée sur lui (`lastProbe`) ; à blanc, avant l'ajout d'un compte (`probeConnector`), la clé saisie est
// essayée sans rien écrire. Les deux partagent une limite de débit par personne. Tenue à part d'`account-secret.ts`,
// qui ouvre le compte (`liveCredential`). Rien du secret n'est jamais rendu.
import { randomUUID } from "node:crypto"
import { disableAccountSchema, type AccountHealth, type AccountMarkReason, type AccountProbe, type ProbedBalance } from "../../schemas"
import { connectorProbeSchema } from "../../schemas/connectors"
import { declaredConnector, type DeclaredConnector } from "../catalog/connector-source"
import { catalogFunctions } from "../catalog/registry"
import type { PlatformDb } from "../db"
import { inTransaction, invalidInput, isPlatformError, PlatformError } from "../errors"
import type { Identity } from "../identity"
import { checkedSettings, liveCredential, missingField } from "./account-secret"
import { accountOwner, lastProbeOf, managedAccount } from "./accounts"
import { closedConnector, isConnectorClosed, requireActivable } from "./activations"
import type { AccountCredential, AccountMarker, StoredToken } from "./auth"
import type { ConnectorProbeBalance } from "./definition"
import { executeDescribed, nonEmpty, settleMark, valueAt } from "./engine"
import { accountFieldNames, hostFieldsOf, readHostFields } from "./host-fields"
import { accountMode } from "./modes"
import { accountSettings } from "./settings"

export type { AccountHealth, ProbedBalance }

/** Tests au plus par personne et par fenêtre, les deux sondes comptées ensemble, dans le processus. */
const PROBES_PER_WINDOW = 10
const PROBE_WINDOW_MS = 60_000

/** Les dates des derniers tests de chaque personne, dans la fenêtre ; un processus neuf repart de zéro. */
const recentProbes = new Map<string, number[]>()

/** Oublie les tests comptés, comme un processus neuf : pour une suite de tests qui sonde plus de 10 fois par minute. */
export function forgetRecentProbes(): void {
  recentProbes.clear()
}

/**
 * Compte un test de la personne, ou le refuse au-delà de 10 par minute (`rate_limited`, `retry_after_s`) : une sonde
 * appelle le tiers avec une clé, et rien d'autre ne borne leur répétition. La limite vit dans le processus : une
 * instance de plus l'élargit d'autant, ce qui suffit à freiner un essai de clés à la chaîne.
 */
function countProbe(identity: Identity): void {
  const now = Date.now()
  const recent = (recentProbes.get(identity.user.id) ?? []).filter((at) => at > now - PROBE_WINDOW_MS)
  if (recent.length >= PROBES_PER_WINDOW) {
    recentProbes.set(identity.user.id, recent)
    const retryAfter = Math.max(1, Math.ceil((recent[0] + PROBE_WINDOW_MS - now) / 1000))
    throw new PlatformError("rate_limited", `Too many tests: ${PROBES_PER_WINDOW} per minute at most. Retry in ${retryAfter} s.`, { retry_after_s: retryAfter })
  }
  recentProbes.set(identity.user.id, [...recent, now])
}

/** Le refus d'un connecteur dont la sonde ne se joue pas (`invalid_arguments`, `no_probe`). */
function noProbe(connector: string, why = "declares no probe"): PlatformError {
  return new PlatformError("invalid_arguments", `Connector ${connector} ${why}: it cannot be tested.`, { reason: "no_probe" })
}

/** Le solde au chemin déclaré : un nombre JSON fini, sinon `null` (absent, texte, objet) ; jamais deviné. */
function balanceOf(answer: unknown, balance: ConnectorProbeBalance): ProbedBalance {
  const value = valueAt(answer, balance.path)
  return { value: typeof value === "number" && Number.isFinite(value) ? value : null, unit: balance.unit, min: balance.min }
}

/** Pourquoi un solde lu n'est pas sain : absent, illisible ou sous le seuil ; `null` : sain. */
function balanceReason(label: string, answer: unknown, balance: ConnectorProbeBalance, read: ProbedBalance): string | null {
  if (read.value === null) {
    return valueAt(answer, balance.path) === undefined ? `${label} answered without its balance ${balance.path}.` : `${label} answered a balance ${balance.path} that is not a number.`
  }
  return read.value < read.min ? `${label} balance is ${read.value} ${read.unit}, under ${read.min} ${read.unit}.` : null
}

/**
 * La marque qu'un solde lu décide : sous le seuil, crédits épuisés ; suffisant, aucune ; illisible, une marque de
 * crédits épuisés reste (rien ne dit qu'ils sont revenus), une clé refusée se lève (le tiers vient de l'accepter).
 */
function markOfBalance(read: ProbedBalance, current: AccountMarkReason | null): AccountMarkReason | null {
  if (read.value === null) return current === "quota_exhausted" ? current : null
  return read.value < read.min ? "quota_exhausted" : null
}

/**
 * Joue la sonde déclarée avec le compte ouvert (`open`) : sa fonction de lecture appelée avec `{}`, chaque chemin de
 * `nonEmpty` exigé non vide, le solde déclaré lu au chemin dit. Sans marque (à blanc), rien n'est écrit ; avec, le
 * solde la décide. Un refus ou une panne du tiers, un compte mal réglé : non sain, avec la raison ; une panne interne
 * lève.
 */
async function runProbe(declared: DeclaredConnector, accountId: string, open: () => Promise<AccountCredential>, where: string): Promise<AccountHealth> {
  const prepared = declared.probe
  const paths = declared.definition.probe?.nonEmpty
  if (!prepared || !paths) throw noProbe(declared.definition.name)
  const balance = declared.definition.probe?.balance
  const label = declared.definition.label
  try {
    const credential = await open()
    const { answers } = await executeDescribed(prepared, { credential, accountId, ...(balance ? { settlesMark: true as const } : {}) }, {})
    const missing = paths.find((path) => !nonEmpty(valueAt(answers[0], path)))
    const pathProblem = missing === undefined ? null : `${label} answered without ${missing}.`
    if (!balance) return { healthy: pathProblem === null, reason: pathProblem, balance: null }
    const read = balanceOf(answers[0], balance)
    const mark: AccountMarker | undefined = credential.mark
    if (mark) await settleMark(mark, markOfBalance(read, mark.current?.reason ?? null), `${where}: probe`)
    const problem = pathProblem ?? balanceReason(label, answers[0], balance, read)
    return { healthy: problem === null, reason: problem, balance: read }
  } catch (error) {
    if (isPlatformError(error) && error.code !== "internal") return { healthy: false, reason: error.message, balance: null }
    throw error
  }
}

/**
 * Joue la sonde du connecteur déclaré sur un compte, le compte ouvert pour ce seul appel, et garde son issue sur lui
 * (`lastProbe`, par `platform.record_account_probe`). Réservée à qui gère le compte, désactivé compris (on vérifie une
 * clé neuve avant de le réactiver) ; hors `call`, elle n'écrit aucune ligne de journal et ne compte dans aucun quota.
 * Refus : compte inconnu ou non géré ; connecteur sans sonde déclarée (`invalid_arguments`, `no_probe`) ; plus de 10
 * tests par minute de la même personne, les deux sondes comptées ensemble (`rate_limited`, `retry_after_s`). Un compte
 * simulé, sans secret ou mal réglé, un refus ou une panne du tiers : non sain, avec la raison (une clé refusée rend la
 * réponse, jamais un refus de la route) ; une panne du coffre lève. Comme un appel, un refus qui marque le compte pose
 * sa marque, une réponse du tiers la lève ; avec un solde, la réponse la décide (`markOfBalance`) : un solde sous le
 * seuil pose `quota_exhausted`. Un test non sain ne pose aucune autre marque.
 */
export async function probeAccount(db: PlatformDb, identity: Identity, input: unknown): Promise<AccountProbe> {
  // La même saisie que la désactivation : le compte visé, par son identifiant.
  const parsed = disableAccountSchema.safeParse(input)
  if (!parsed.success) throw invalidInput(parsed.error)
  const id = parsed.data.account_id
  const row = await managedAccount(db, identity, id, { service: "probeAccount", gesture: "Probing" })
  const declared = declaredConnector(row.connector)
  if (!declared?.probe) throw noProbe(row.connector)
  countProbe(identity)
  const account = { id, label: row.label, mode: accountMode(row.mode), owner: accountOwner(row) }
  const open = async () => (await liveCredential(db, identity, account, row.connector))()
  const health = await runProbe(declared, id, open, `connector ${row.connector}: account ${id}`)
  const [kept] = await inTransaction(
    db,
    "probeAccount: record_account_probe",
    (sql) => sql<{ probe: unknown }[]>`
      select platform.record_account_probe(${id}, ${health.healthy}, ${health.reason}, ${health.balance ? sql.json(health.balance) : null}::jsonb) as probe`,
    "server",
  )
  const probe = lastProbeOf(kept?.probe)
  if (!probe) {
    console.error(`[platform] probeAccount: the probe of account ${id} was not kept`)
    throw new PlatformError("internal", "Internal error.")
  }
  return probe
}

/** Le jeton d'un échange gardé le temps d'une sonde à blanc, en mémoire : rien n'est écrit sur aucun compte. */
function passingTokens(): AccountCredential["tokens"] {
  let kept: StoredToken | null = null
  return {
    read: async () => kept,
    write: async (token) => {
      kept = token
    },
  }
}

/** Les champs saisis, contrôlés contre la déclaration : aucun inconnu, aucun de l'hôte, aucun exigé qui manque. */
function checkedFields(declared: DeclaredConnector, fields: Record<string, string>): Record<string, string> {
  const { definition } = declared
  const fromHost = hostFieldsOf(definition).find((field) => Object.hasOwn(fields, field.name))
  if (fromHost) throw new PlatformError("invalid_arguments", `Field ${fromHost.name} of ${definition.name} is provided by this application, never entered.`)
  const names = accountFieldNames(definition)
  const unknown = Object.keys(fields).find((name) => !names.includes(name))
  if (unknown !== undefined) throw new PlatformError("invalid_arguments", `Unknown field ${unknown} of ${definition.name}: its fields are ${names.join(", ")}.`)
  const missing = missingField(declared, Object.keys(fields))
  if (missing) throw new PlatformError("invalid_arguments", `Field ${missing} of ${definition.name} is missing.`)
  return fields
}

/**
 * La sonde à blanc, avant l'ajout d'un compte (`POST admin/connectors/<nom>/probe`) : la sonde du connecteur jouée avec
 * les champs et les réglages du formulaire, contrôlés comme `setAccountSecret` les contrôle, sans compte. N'écrit rien :
 * ni compte, ni marque, ni jeton gardé ; la même garde d'adresse qu'un appel (`guardedFetch`). Ouverte à tout membre.
 * Refus : connecteur inconnu (`not_found`) ; fermé par un administrateur (`not_enabled`, `closed`) ; sans sonde, à
 * consentement (`oauth2_user`) ou à compte rattaché (`invalid_arguments`, `no_probe`) ; champ manquant, inconnu ou de
 * l'hôte, réglage inconnu, hors de ses valeurs ou manquant (`invalid_arguments`) ; plus de 10 tests par minute
 * (`rate_limited`). Une clé refusée par le tiers rend une issue non saine, jamais un refus.
 */
export async function probeConnector(db: PlatformDb, identity: Identity, input: unknown): Promise<AccountHealth> {
  const parsed = connectorProbeSchema.safeParse(input)
  if (!parsed.success) throw invalidInput(parsed.error)
  const { connector, input: given } = parsed.data
  requireActivable(connector, catalogFunctions())
  if (await isConnectorClosed(db, identity, connector)) throw await closedConnector(db, identity, connector)
  const declared = declaredConnector(connector)
  if (!declared?.probe) throw noProbe(connector)
  if (declared.auth.kind === "user_consent") throw noProbe(connector, "connects by consent")
  if (declared.definition.accountIdentity) throw noProbe(connector, "connects through its own sign-in")
  const fields = checkedFields(declared, given.fields)
  const settings = accountSettings(declared.definition, Object.fromEntries(Object.entries(checkedSettings(declared, given.settings ?? {})).flatMap(([name, value]) => (value === null ? [] : [[name, value]]))))
  if ("problem" in settings) throw new PlatformError("invalid_arguments", `Setting ${settings.problem.label} ${settings.problem.reason}.`)
  countProbe(identity)
  const open = async (): Promise<AccountCredential> => ({ fields: { ...fields, ...readHostFields(declared, identity.org) }, settings: settings.settings, tokens: passingTokens() })
  return runProbe(declared, `probe-${randomUUID()}`, open, `connector ${connector}: dry-run probe`)
}
