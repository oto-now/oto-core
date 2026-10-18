// Refus de compte d'un appel (H83, N3 à N7 ; partage des comptes) : le texte et le code servis au modèle pour chaque
// décision de `chooseAccount` qui n'est pas un compte, et ce qu'ils nomment (à qui demander, les administrateurs, la
// personne à qui est chaque compte personnel partagé), lu en base une fois la décision prise. Séparé de la résolution
// (`resolution.ts`), dont il ne lit que des types.
import { administratorNames, describeOwner, requiredAccountLevel } from "../access"
import type { PlatformDb } from "../db"
import { memberDirectory, type DirectoryEntry } from "../directory"
import { boundedList, PlatformError } from "../errors"
import type { Identity } from "../identity"
import { levelName, type ConnectorAccount } from "./accounts"
import { consentRefusal } from "./consent-accounts"
import { modeLabel } from "./modes"
import type { AccountRefusal, FunctionTraits } from "./resolution"

/**
 * Consigne d'une liste de candidats pour une action (N31) : l'utilisateur choisit, le modèle ne
 * devine pas (mcp-patterns.md § 3 « Résolution par nom », § 4 ; H37).
 */
export const ASK_WHICH = "Show them to the user and ask which one to use; do not pick one yourself."

/**
 * Ce que disent les refus qui nomment des personnes : à qui demander (`describeOwner`), les noms
 * des administrateurs, l'origine de l'adresse appelée (lien du tableau de bord), et le nom de la personne à qui est
 * chaque compte personnel nommé (`owners`, par identifiant).
 */
export type RefusalWords = { orgName: string; administrators: string; origin: string; ask: string; owners?: ReadonlyMap<string, string> }

const mention = (account: ConnectorAccount) => `« ${account.label} » (${account.owner.description}, ${modeLabel(account.mode)})`

/**
 * À qui est un compte personnel partagé, dans un refus : le nom lu dans l'annuaire (`RefusalWords.owners`). Un compte
 * partagé n'est jamais celui d'une personne partie (`chooseAccount`) : un propriétaire absent de l'annuaire est une faute
 * de câblage, jamais un nom deviné.
 */
function ownerOf(account: ConnectorAccount, words: RefusalWords): string {
  const name = words.owners?.get(account.owner.userId ?? "")
  if (name === undefined) {
    console.error(`[platform] accountRefusal: no directory name for the owner of shared account ${account.id}`)
    throw new PlatformError("internal", "Internal error.")
  }
  return name
}

/**
 * La phrase d'un refus faute de compte qui nomme les comptes personnels partagés avec l'appelant, chacun avec son
 * propriétaire, et la consigne de les montrer sans choisir (N31) ; leurs libellés, identifiants et propriétaires en
 * précisions (`details.shared_accounts`). Vide sans compte partagé.
 */
function sharedMention(shared: readonly ConnectorAccount[], words: RefusalWords): { text: string; details?: Record<string, unknown> } {
  if (shared.length === 0) return { text: "" }
  const named = boundedList(shared.map((account) => `« ${account.label} » (owner ${ownerOf(account, words)}, ${modeLabel(account.mode)})`))
  return {
    text: ` Personal accounts shared with you, used only when named: ${named}. ${ASK_WHICH} Then call again with account: "<label>".`,
    details: { shared_accounts: shared.map((account) => ({ id: account.id, label: account.label, owner: ownerOf(account, words) })) },
  }
}

/**
 * Texte et code d'un refus de compte (AC15, AC16), une fois connus ceux à qui demander ; 20
 * comptes nommés au plus (N32), consigne de demander à l'utilisateur sur une ambiguïté (N31).
 */
export function accountRefusal(refusal: AccountRefusal, fn: FunctionTraits, words: RefusalWords): PlatformError {
  const needs = levelName(requiredAccountLevel(fn.class))
  switch (refusal.kind) {
    case "unknown_named": {
      const usable = boundedList(refusal.usable.map(mention)) || "none"
      return new PlatformError(
        "not_found",
        `Unknown account « ${refusal.wanted} » for ${fn.connector}. Accounts you can use: ${usable}. No other account was tried.`,
      )
    }
    case "ambiguous_named": {
      const named = boundedList(refusal.accounts.map((account) => `« ${account.label} » (${account.owner.description}, id ${account.id})`))
      return new PlatformError(
        "ambiguous_account",
        `Several ${fn.connector} accounts are named « ${refusal.wanted} »: ${named}. ${ASK_WHICH} Then call again with account: "<id>".`,
      )
    }
    case "named_below_level":
      return new PlatformError(
        "forbidden",
        `Account « ${refusal.account.label} » cannot run ${fn.name} for you (${needs} access needed). Ask ${words.ask} for access.`,
      )
    case "named_owner_left":
      return new PlatformError(
        "not_enabled",
        `Account « ${refusal.account.label} » no longer serves: its owner has left ${words.orgName}. Name another account.`,
      )
    case "named_unavailable":
      return new PlatformError(
        "not_enabled",
        refusal.account.status === "error"
          ? `Account « ${refusal.account.label} » is in error. Ask ${words.ask} to fix it, or name another account.`
          : `Account « ${refusal.account.label} » is disabled. Ask ${words.ask} to enable it, or name another account.`,
      )
    case "ambiguous_step": {
      const personal = refusal.accounts.every((account) => account.owner.kind === "user")
      const whose = refusal.team ? `of team ${refusal.team.name}` : personal ? "of yours" : "of the organisation"
      const labels = boundedList(refusal.accounts.map((account) => `« ${account.label} »`))
      return new PlatformError(
        "ambiguous_account",
        `Several ${fn.connector} accounts ${whose} can run ${fn.name}: ${labels}. ${ASK_WHICH} Then call again with account: "<label>".`,
      )
    }
    case "below_level": {
      const seen = boundedList(
        refusal.accounts.map((account) => `« ${account.label} » (${account.owner.description}, ${levelName(account.level)} for you)`),
      )
      const shared = sharedMention(refusal.shared, words)
      return new PlatformError(
        "forbidden",
        `${fn.name} needs ${needs} access to a ${fn.connector} account. Accounts you can see but not use this way: ${seen}. Ask ${words.ask} for access.${shared.text}`,
        shared.details,
      )
    }
    case "none": {
      const steps = refusal.team ? `your own, team ${refusal.team.name}, then the organisation` : "your own, then the organisation"
      const names = words.administrators ? ` (${words.administrators})` : ""
      const shared = sharedMention(refusal.shared, words)
      return new PlatformError(
        "not_enabled",
        `No ${fn.connector} account is connected for you (${steps}). Ask an administrator of ${words.orgName}${names} to connect one on the dashboard: ${words.origin}/admin/connectors.${shared.text}`,
        shared.details,
      )
    }
    case "connect_needed":
      return consentRefusal(fn.connector, refusal.account, sharedMention(refusal.shared, words))
  }
}


/** Les noms des personnes à qui sont les comptes personnels de `accounts`, lus dans l'annuaire. */
function ownerNames(directory: readonly DirectoryEntry[], accounts: readonly ConnectorAccount[]): Map<string, string> {
  const wanted = new Set(accounts.flatMap((account) => (account.owner.userId ? [account.owner.userId] : [])))
  return new Map(directory.flatMap((person) => (wanted.has(person.userId) ? [[person.userId, person.name] as const] : [])))
}

/**
 * Qui gère les comptes d'un refus (`describeOwner`, une fois par propriétaire : deux au plus, l'équipe
 * porteuse et l'organisation, les étapes de `chooseAccount`) ; administrateurs nommés si aucun compte ; le nom de qui
 * possède chaque compte personnel partagé que le refus mentionne, lu dans l'annuaire (un membre : le compte d'une
 * personne partie ne se mentionne pas).
 */
export async function refusalWords(db: PlatformDb, identity: Identity, refusal: AccountRefusal, origin: string): Promise<RefusalWords> {
  const accounts =
    refusal.kind === "named_below_level" || refusal.kind === "named_unavailable"
      ? [refusal.account]
      : refusal.kind === "below_level"
        ? refusal.accounts
        : []
  const personal = "shared" in refusal ? refusal.shared : []
  const owners = [...new Map(accounts.map((account) => [JSON.stringify([account.owner.kind, account.owner.teamId, account.owner.userId]), account.owner])).values()]
  const needsDirectory = refusal.kind === "none" || personal.length > 0
  const [asks, directory] = await Promise.all([
    Promise.all(owners.map((owner) => describeOwner(db, identity, owner))),
    needsDirectory ? memberDirectory(db, identity.org.id) : Promise.resolve([]),
  ])
  return {
    orgName: identity.org.name,
    administrators: refusal.kind === "none" ? administratorNames(directory) : "",
    origin,
    ask: boundedList([...new Set(asks)], " or "),
    owners: ownerNames(directory, personal),
  }
}
