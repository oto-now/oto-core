// La sonde d'un compte (`connecteurs-et-comptes.md` § Moteur des connecteurs décrits, Sonde) : la fonction `probe` du
// connecteur déclaré jouée avec `{}` sur le compte, ses chemins `nonEmpty` exigés non vides et, pour un compte payant,
// son solde (`balance`) lu et jugé contre le seuil, qui décide la marque du compte (§ État d'un compte). Tenue à part
// d'`account-secret.ts`, qui ouvre le compte (`liveCredential`). Rien du secret n'est jamais rendu.
import { disableAccountSchema, type AccountMarkReason } from "../../schemas"
import { declaredConnector } from "../catalog/connector-source"
import type { PlatformDb } from "../db"
import { invalidInput, isPlatformError, PlatformError } from "../errors"
import type { Identity } from "../identity"
import { liveCredential } from "./account-secret"
import { accountOwner, managedAccount } from "./accounts"
import type { ConnectorProbeBalance } from "./definition"
import { executeDescribed, nonEmpty, settleMark, valueAt } from "./engine"
import { accountMode } from "./modes"

/** Le solde lu par une sonde à solde : sa valeur (`null` : absente, ou qui n'est pas un nombre), son unité et le seuil. */
export type ProbedBalance = { value: number | null; unit: string; min: number }

/**
 * La santé d'un compte selon la sonde de son connecteur : sain, ou non sain et pourquoi, jamais le secret ; avec le
 * solde lu (`balance`) quand le connecteur en déclare un et que le tiers a répondu.
 */
export type AccountHealth = ({ healthy: true } | { healthy: false; reason: string }) & { balance?: ProbedBalance }

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
 * Joue la sonde du connecteur déclaré (`probe`) sur un compte : sa fonction de lecture appelée avec `{}`, le compte
 * ouvert pour ce seul appel, puis chaque chemin de `nonEmpty` exigé non vide dans la réponse, et le solde déclaré
 * (`balance`) lu au chemin dit : sous le seuil, absent ou qui n'est pas un nombre, non sain. Réservée à qui gère le
 * compte (niveau 3, comme `setAccountSecret`) ; hors `call`, elle n'écrit aucune ligne de journal et ne compte dans
 * aucun quota. Refus : compte inconnu ou non géré ; connecteur sans sonde déclarée (`invalid_arguments`). Un compte
 * simulé, sans secret ou mal réglé, un refus ou une panne du tiers : non sain, avec la raison ; une panne du coffre lève.
 * Comme un appel, un refus qui marque le compte pose sa marque, une réponse du tiers la lève ; avec un solde, la
 * réponse la décide (`markOfBalance`) : un solde sous le seuil pose `quota_exhausted`.
 */
export async function probeAccount(db: PlatformDb, identity: Identity, input: unknown): Promise<AccountHealth> {
  // La même saisie que la désactivation : le compte visé, par son identifiant.
  const parsed = disableAccountSchema.safeParse(input)
  if (!parsed.success) throw invalidInput(parsed.error)
  const id = parsed.data.account_id
  const row = await managedAccount(db, identity, id, { service: "probeAccount", gesture: "Probing" })
  const connector = declaredConnector(row.connector)
  const paths = connector?.definition.probe?.nonEmpty
  if (!connector?.probe || !paths) throw new PlatformError("invalid_arguments", `Connector ${row.connector} declares no probe.`)
  const balance = connector.definition.probe?.balance
  const label = connector.definition.label
  const account = { id, label: row.label, mode: accountMode(row.mode), owner: accountOwner(row) }
  try {
    const open = await liveCredential(db, identity, account, row.connector)
    const credential = await open()
    const { answers } = await executeDescribed(connector.probe, { credential, accountId: id, ...(balance ? { settlesMark: true as const } : {}) }, {})
    const missing = paths.find((path) => !nonEmpty(valueAt(answers[0], path)))
    const pathProblem = missing === undefined ? null : `${label} answered without ${missing}.`
    if (!balance) return pathProblem === null ? { healthy: true } : { healthy: false, reason: pathProblem }
    const read = balanceOf(answers[0], balance)
    const mark = credential.mark
    if (mark) await settleMark(mark, markOfBalance(read, mark.current?.reason ?? null), `connector ${row.connector}: account ${id}: probe`)
    const problem = pathProblem ?? balanceReason(label, answers[0], balance, read)
    return problem === null ? { healthy: true, balance: read } : { healthy: false, reason: problem, balance: read }
  } catch (error) {
    if (isPlatformError(error) && error.code !== "internal") return { healthy: false, reason: error.message }
    throw error
  }
}
