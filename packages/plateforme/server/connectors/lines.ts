// Lignes « connecteurs » des parties de `context` (AC21, N8) : pour chaque connecteur actif, le
// compte que prennent ses appels, avec son mode. Sans elles, le modèle n'apprend le mode simulé qu'après
// l'envoi (banc E04, F5) et ne sait pas quelle équipe porte l'appel (F8). E05-S13 (fiche D128) : plus
// d'équipe par défaut ; chaque équipe de la personne qui a un compte du connecteur a sa ligne, dans la
// partie de cette équipe (ce qu'obtient un appel qu'elle porte) ; un connecteur dont aucune de ses équipes
// n'a de compte a la sienne dans la partie de Tout le monde (sans équipe). Le compte est décidé comme par
// `call` (`chooseAccount`) : une seule source. Un compte marqué (clé refusée, crédits épuisés) se dit avec sa marque.
import type { AccountMark, AccountMode } from "../../schemas"
import type { CatalogFunction } from "../catalog/define"
import { catalogFunctions } from "../catalog/registry"
import type { PlatformDb } from "../db"
import type { Identity } from "../identity"
import { cut } from "../journal"
import { connectorAccounts, markWords, type ConnectorAccount, type LevelName } from "./accounts"
import { activableConnectors, loadActiveConnectors } from "./activations"
import { modeLabel } from "./modes"
import { isPersonalConnector } from "./consent-accounts"
import { chooseAccount, type TeamRef } from "./resolution"

/** Une ligne par connecteur, jamais plus (le moteur de blocs coupe le bloc, H30). */
const MAX_LINE_CHARS = 200
const MAX_LABEL_CHARS = 40

/** Ce que la personne obtient par défaut pour un besoin (lecture ou écriture) d'un connecteur. */
export type NeedOutcome =
  | { kind: "account"; team: TeamRef | null; account: { label: string; mode: AccountMode; level: LevelName; mark?: AccountMark } }
  | { kind: "no_account"; team: TeamRef | null }
  | { kind: "read_only"; team: TeamRef | null; labels: string[] }
  | { kind: "several_accounts"; team: TeamRef | null; labels: string[] }
  /** Connecteur à consentement : la personne n'a pas de compte actif à elle ; elle connecte le sien. */
  | { kind: "to_connect"; team: TeamRef | null }

export type ConnectorOutlook = { connector: string; read?: NeedOutcome; write?: NeedOutcome }

type Need = "read" | "write"

const NEEDS: Need[] = ["read", "write"]

/** Ce qu'obtient un appel de `caller` que porte `team` (`null` : aucune équipe), pour la fonction donnée. */
function needOutcome(fn: CatalogFunction, accounts: readonly ConnectorAccount[], team: TeamRef | null, caller: { id: string; personal: boolean }): NeedOutcome {
  const choice = chooseAccount({ fn, accounts, team, caller: caller.id, personal: caller.personal })
  if (choice.kind === "account") {
    const { id, label, mode, level } = choice.account
    // La marque du compte (clé refusée, crédits épuisés) : il est pris quand même, le modèle l'apprend avant l'appel.
    const mark = accounts.find((account) => account.id === id)?.mark
    return { kind: "account", team, account: { label, mode, level, ...(mark ? { mark } : {}) } }
  }
  if (choice.kind === "ambiguous_step") return { kind: "several_accounts", team, labels: choice.accounts.map((account) => account.label) }
  // Comptes visibles mais sous le niveau exigé : le remède est un accès, pas un compte de plus (N39).
  if (choice.kind === "below_level") return { kind: "read_only", team, labels: choice.accounts.map((account) => account.label) }
  if (choice.kind === "connect_needed") return { kind: "to_connect", team }
  return { kind: "no_account", team }
}

/**
 * Pour un connecteur actif, ce qu'obtient un appel que porte `team` (`null` : aucune équipe) : pour la
 * lecture (fonctions de classe `read`) et pour l'écriture (`write`, `sensitive`), selon les fonctions
 * qu'il a.
 */
export function connectorOutlook(input: {
  connector: string
  functions: readonly CatalogFunction[]
  accounts: readonly ConnectorAccount[]
  team: TeamRef | null
  /** L'appelant, dont le compte personnel porte l'appel en tête (H83). */
  caller: string
  /** Un connecteur dont chaque personne connecte le sien (`isPersonalConnector`) : faute de compte, elle connecte le sien. */
  personal?: boolean
}): ConnectorOutlook {
  const outlook: ConnectorOutlook = { connector: input.connector }
  for (const need of NEEDS) {
    const fn = input.functions.find((candidate) => (candidate.class === "read") === (need === "read"))
    if (fn) outlook[need] = needOutcome(fn, input.accounts, input.team, { id: input.caller, personal: input.personal === true })
  }
  return outlook
}

const teamWords = (team: TeamRef | null) => (team ? `team ${cut(team.name, MAX_LABEL_CHARS)}` : "no team")
const accountWords = (account: { label: string; mode: AccountMode; mark?: AccountMark }) =>
  `account « ${cut(account.label, MAX_LABEL_CHARS)} » (${modeLabel(account.mode)})${account.mark ? `, marked: ${markWords(account.mark)}` : ""}`
const labelList = (labels: readonly string[]) => labels.map((label) => `« ${cut(label, MAX_LABEL_CHARS)} »`).join(", ")

/**
 * La ligne quand lecture et écriture ont la même issue : `team Ventes (write), account « … » (simulated)`.
 * Sur une ambiguïté, la consigne de demander à l'utilisateur (N31) précède la liste, que la coupe à
 * 200 caractères raccourcit la première.
 */
function wholeLine(outcome: NeedOutcome): string {
  switch (outcome.kind) {
    case "account":
      return `${teamWords(outcome.team)} (${outcome.account.level === "read" ? "read" : "write"}), ${accountWords(outcome.account)}`
    case "no_account":
      return `no account you can use${outcome.team ? ` (${teamWords(outcome.team)})` : ""}: calls will be refused until an administrator connects one.`
    case "read_only":
      // Un compte visible se lit toujours (niveau 1) : seul l'accès en écriture peut manquer. La liste
      // vient en dernier : la coupe à 200 caractères la raccourcit, pas le remède.
      return `no account you can use${outcome.team ? ` (${teamWords(outcome.team)})` : ""}: calls will be refused until you are given write access; you can only read ${labelList(outcome.labels)}.`
    case "several_accounts":
      return `${outcome.team ? `${teamWords(outcome.team)}, several accounts` : "several organisation accounts"}; ask the user which one and pass account in the call: ${labelList(outcome.labels)}.`
    case "to_connect":
      return "no account of yours: calls will be refused until the user connects their own account (Connect my account)."
  }
}

/** Une moitié de ligne quand lecture et écriture diffèrent : `read with team Conseil, account « … » (simulated)`. */
function needPart(need: Need, outcome: NeedOutcome): string {
  switch (outcome.kind) {
    case "account":
      return `${need} with ${outcome.team ? `${teamWords(outcome.team)}, ` : ""}${accountWords(outcome.account)}`
    case "no_account":
      return `${need}: no account you can use${outcome.team ? ` (${teamWords(outcome.team)})` : ""}`
    case "read_only":
      return `${need}: read access only${outcome.team ? ` (${teamWords(outcome.team)})` : ""}`
    case "several_accounts":
      return `${need}: several accounts (${labelList(outcome.labels)})`
    case "to_connect":
      return `${need}: no account of yours`
  }
}

/**
 * Les lignes du bloc `team` (AC21) : `mail: team Ventes (write), account « Mail Ventes » (simulated)`,
 * ou une ligne en deux parties quand l'équipe ou le compte diffèrent entre lecture et écriture ;
 * 200 caractères au plus, libellés coupés à 40.
 */
export function connectorLines(outlooks: readonly ConnectorOutlook[]): string[] {
  return outlooks.flatMap((outlook) => {
    const parts = NEEDS.flatMap((need) => {
      const outcome = outlook[need]
      return outcome ? [{ need, outcome }] : []
    })
    if (parts.length === 0) return []
    const same = parts.every((part) => JSON.stringify(part.outcome) === JSON.stringify(parts[0].outcome))
    const text = same ? wholeLine(parts[0].outcome) : parts.map((part) => needPart(part.need, part.outcome)).join("; ")
    return [cut(`${outlook.connector}: ${text}`, MAX_LINE_CHARS)]
  })
}

/** Les lignes connecteurs de la personne, par partie : celle de Tout le monde, puis par équipe (id). */
export type ConnectorLinesByPart = { everyone: string[]; teams: Map<string, string[]> }

/**
 * Lignes connecteurs de la personne : connecteurs activables et actifs, relus à chaque appel (N9),
 * leurs comptes visibles et niveaux lus en parallèle. Une équipe de la personne « a un compte » d'un
 * connecteur quand elle possède un compte actif qu'elle voit (quel que soit son niveau : un compte en
 * lecture seule se dit aussi) ; ses lignes vont dans sa partie, par nom d'équipe comme `identity.teams`.
 */
export async function teamConnectorLines(db: PlatformDb, identity: Identity): Promise<ConnectorLinesByPart> {
  const lines: ConnectorLinesByPart = { everyone: [], teams: new Map() }
  const activable = activableConnectors(catalogFunctions())
  if (activable.size === 0) return lines
  const active = await loadActiveConnectors(db, identity.org.id)
  const connectors = await Promise.all(
    [...activable.entries()]
      .filter(([connector]) => active.has(connector))
      .map(async ([connector, functions]) => ({ connector, functions, accounts: await connectorAccounts(db, identity, connector) })),
  )
  for (const { connector, functions, accounts } of connectors) {
    const owning = identity.teams.filter((team) =>
      accounts.some((account) => account.status === "active" && account.owner.kind === "team" && account.owner.teamId === team.id),
    )
    const caller = { caller: identity.user.id, personal: isPersonalConnector(connector) }
    for (const { id, slug, name } of owning) {
      const outlook = connectorOutlook({ connector, functions, accounts, team: { id, slug, name }, ...caller })
      lines.teams.set(id, [...(lines.teams.get(id) ?? []), ...connectorLines([outlook])])
    }
    if (owning.length === 0) lines.everyone.push(...connectorLines([connectorOutlook({ connector, functions, accounts, team: null, ...caller })]))
  }
  return lines
}
