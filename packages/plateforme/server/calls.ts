// `call` (E03-S04, ADR-002, ADR-003) : la seule porte vers les fonctions du catalogue. Dans l'ordre de
// la maquette : la fonction (nom normalisé, N6), son activation (H81), ses arguments (schéma strict),
// l'équipe porteuse (H84) et le compte (H83) d'E04-S01, le secret d'un compte réel d'un connecteur réel (H85 :
// refus d'un compte simulé ou sans secret), le récapitulatif d'une fonction sensible sans `confirm` (H86, N1), puis
// l'exécution, le secret déchiffré pour elle seule, et son compte-rendu (N4). Le service ne lit aucune table et ne
// décide aucun droit lui-même : les services qu'il orchestre décident avant leur requête, et il sert leurs refus tels
// quels (H123). Sans lui, `<p>_call` répond `unavailable_in_v1` et aucune fonction ne court.
//
// Repris de la maquette (`mcp-test/src/proto/services/call.ts` l. 27-56) : l'ordre, les textes « Unknown
// function … », « Invalid arguments for … Read the contract with … », « Nothing was sent. Show this … »,
// l'équipe rendue par la fonction qui prime. Retiré : « la première équipe qui a le droit » (→ E04-S01,
// H84) et `teams.connectors`. Repris d'Oto (`oto_mcp\middleware\error_envelope.py` l. 24-66) : un code
// stable, le même sur toutes les faces (H04) ; retiré : `retryable`, `hint` et l'enveloppe `data.oto`,
// comme le `confirm=<N>` et l'envoi d'essai d'`oto_mcp\capabilities\outreach.py` (H86).
import { ERP_VIEW_PREFIX } from "../schemas/views"
import { administratorNames } from "./access"
import { checkArguments } from "./catalog/arguments"
import type { CatalogFunction, FunctionContext } from "./catalog/define"
import { personalValues } from "./catalog/personal"
import { actName, assistantFunctions, findFunction, isActive, NATIVE_CONNECTOR } from "./catalog/registry"
import { liveCredential } from "./connectors/account-secret"
import type { AccountCredential } from "./connectors/auth"
import { isSimulatedConnector, modeLabel } from "./connectors/modes"
import { resolveAccount, runningTeam, type ResolvedAccount, type RunningTeam } from "./connectors/resolution"
import type { PlatformDb } from "./db"
import { memberDirectory } from "./directory"
import { issuesText, PlatformError } from "./errors"
import type { Identity } from "./identity"
import type { Dictionary } from "./pseudonym/dictionary"
import { pseudonymizedText } from "./pseudonym/gate"
import { resolvedCallArguments } from "./pseudonym/inputs"
import { withEntityTokens } from "./pseudonym/outputs"
import type { ToolOutput } from "./tool-output"

/**
 * L'entrée de `call` sans `ctx` (H22). Tenue ici, `server/` n'important pas `mcp/` (architecture § 3) :
 * la ligne `call` de la porte y passe l'entrée validée par le schéma d'E03-S01, et un test de types
 * (`mcp-call.test.ts`, N10) refuse tout écart entre les deux, champ ajouté au schéma compris.
 */
export type CallInput = {
  function: string
  arguments?: Record<string, unknown>
  confirm?: boolean
  team?: string
  account?: string
}

/**
 * Ce que l'appel a établi pour sa ligne de journal, rempli à mesure (AC16, N7) : la porte le garde
 * quand l'appel échoue ensuite. Vide tant que le refus précède le choix de l'équipe ; `outcome` : la
 * marque posée sur le compte par l'échec (`account_marked`), ou sa pose qui a échoué (`account_mark_failed`) ;
 * `lentBy` : la personne qui a partagé le compte personnel servi ; `personal` : les valeurs des arguments marqués
 * « donnée personnelle », que la ligne retire, posées dès la fonction connue.
 */
export type CallTrace = Pick<ToolOutput, "teamId" | "accountId" | "outcome" | "lentBy" | "personal">

/** L'équipe sous laquelle l'appel court (F8), telle que ses données la rendent. */
export type CallTeam = { slug: string; name: string }

/**
 * À qui est le compte servi (`droits-d-acces.md` § Partage d'un compte de connecteur, l'équivalent du `lent_by` d'oto 1) :
 * l'organisation, une équipe (« team Ventes »), ou une personne, l'appelant (`yours`) ou celle qui le lui a partagé.
 */
export type CallAccountOwner = { kind: "org" | "team"; description: string } | { kind: "user"; userId: string; name: string; yours: boolean }

/** Le compte d'une fonction de connecteur, son mode (F5) et à qui il est, tels que les données de l'appel le rendent. */
export type CallAccount = { id: string; label: string; mode: ResolvedAccount["mode"]; owner: CallAccountOwner }

/**
 * Données en champs d'un `call` (F7) : la fonction, l'équipe, le compte d'une fonction de connecteur, puis le résultat
 * de l'exécution, ou le récapitulatif d'une fonction sensible appelée sans `confirm` (H86), où rien n'a couru.
 */
export type CallData = { function: string; team: CallTeam | null; account?: CallAccount } & (
  | { status: "needs_confirmation"; summary: Record<string, unknown> }
  | { status?: never; result: Record<string, unknown> }
)

/** Ce que rend `runCall` : une sortie d'outil aux données d'un `call` et à ses suites proposées. */
export type CallOutput = ToolOutput & { data: CallData; nextActions: string[] }

export type CallDeps = {
  db: PlatformDb
  identity: Identity
  /** Code `ctx` validé par la garde de la porte (H27) : dernière procédure (H84) et provenance (N9). */
  ctxCode: string | null
  /** Client MCP du même `ctx` (`ctx.host`), pour la provenance d'une écriture (E11-S01, AC-d2) ; facultatif. */
  ctxHost?: string | null
  /** Origine de l'adresse appelée (`https://acme.oto.cx`) : lien du tableau de bord d'un refus (AC8). */
  origin: string
  /** Jeton vérifié de la requête, passé au contexte des seules fonctions de l'ERP, qui s'exécutent sous lui (E08-S05, NH4, NH19). */
  accessToken?: string
  /** Connecteurs actifs de l'organisation, lus une fois pour la requête (`McpDeps`, E04-S01 N27). */
  activeConnectors: () => Promise<ReadonlySet<string>>
  /**
   * Le catalogue (défaut : `assistantFunctions()`, ce que l'assistant voit ; `callFunction` passe `catalogFunctions()`,
   * fonctions réservées au serveur comprises). Les tests passent leurs fonctions : sans elles, la matrice des classes ne
   * se teste pas, faute de fonction de lecture ou native en V1 avant E07.
   */
  functions?: readonly CatalogFunction[]
  trace?: CallTrace
  /** Le dictionnaire de l'organisation quand la porte MCP pseudonymise : les jetons des arguments se résolvent par lui. */
  dictionary?: Dictionary | null
}

const NOTHING_SENT = "Nothing was sent. Show this to the user and ask for explicit approval, then call again with confirm: true."

/** Refus d'une fonction dont le connecteur est inactif (AC2), qui nomme les administrateurs qui l'activent. */
async function notEnabled(db: PlatformDb, identity: Identity, fn: CatalogFunction): Promise<PlatformError> {
  const org = identity.org.name
  const names = administratorNames(await memberDirectory(db, identity.org.id))
  const who = names ? ` (${names})` : ""
  return new PlatformError(
    "not_enabled",
    `Function ${fn.name} is not enabled at ${org}: the ${fn.connector} connector is off. Ask an administrator of ${org}${who} to activate it.`,
  )
}

/**
 * Arguments validés par le schéma strict de la fonction (AC3), Zod ou JSON Schema d'un connecteur décrit : chaque
 * problème par son chemin, 20 au plus.
 */
function checkedArguments(fn: CatalogFunction, args: Record<string, unknown>, prefix: string): Record<string, unknown> {
  const checked = checkArguments(fn.schema, args)
  if (checked.success) return checked.data
  throw new PlatformError(
    "invalid_arguments",
    `Invalid arguments for ${fn.name}: ${issuesText(checked.issues)}. Read the contract with ${prefix}_read {"path": "${fn.name}"}.`,
  )
}

/**
 * Équipe de la ligne de journal (fiche D38, option A) : une équipe de la personne, sinon aucune ; le
 * responsable d'une équipe dont elle n'est pas membre ne lit pas les arguments de ses appels.
 */
function journalTeam(identity: Identity, teamId: string | null | undefined): string | null {
  return teamId && identity.teams.some((team) => team.id === teamId) ? teamId : null
}

/**
 * Suites proposées (H87, N3) : `next` rendu par l'exécution, sinon celui de la fonction, sans fonction
 * sensible (`mcp-patterns.md § 3`), inactive ni absente du catalogue (aucune impasse, § 4).
 */
function nextActions(names: readonly string[], functions: readonly CatalogFunction[], active: ReadonlySet<string>): string[] {
  return names.filter((name) => {
    const next = findFunction(functions, name)
    return next !== null && next.class !== "sensitive" && isActive(next, active)
  })
}

/** À qui est le compte servi, pour les données de l'appel ; un compte personnel porte toujours son nom (`resolveAccount`). */
function accountOwner(identity: Identity, account: ResolvedAccount): CallAccountOwner {
  const { owner } = account
  if (owner.kind !== "user") return { kind: owner.kind, description: owner.description }
  // `resolveAccount` nomme toujours la personne d'un compte personnel servi : sans nom, le câblage est fautif.
  if (!owner.userId || account.ownerName === undefined) {
    console.error(`[platform] call: personal account ${account.id} served without its owner`)
    throw new PlatformError("internal", "Internal error.")
  }
  return { kind: "user", userId: owner.userId, name: account.ownerName, yours: owner.userId === identity.user.id }
}

/** La personne qui a partagé le compte personnel servi, s'il n'est pas à l'appelant. */
function lender(owner: CallAccountOwner): Extract<CallAccountOwner, { kind: "user" }> | null {
  return owner.kind === "user" && !owner.yours ? owner : null
}

/** Données en champs (F7) : la fonction, l'équipe de l'appel, et le compte d'une fonction de connecteur et son propriétaire (AC4, AC13). */
function callData(identity: Identity, fn: CatalogFunction, team: RunningTeam | null, account: ResolvedAccount | undefined): Pick<CallData, "function" | "team" | "account"> {
  return {
    function: fn.name,
    team: team ? { slug: team.slug, name: team.name } : null,
    ...(account ? { account: { id: account.id, label: account.label, mode: account.mode, owner: accountOwner(identity, account) } } : {}),
  }
}

/**
 * Dernières lignes du compte-rendu d'une fonction de connecteur (N4) : l'équipe de l'appel (F8), le compte et son mode
 * (F5) ; puis, quand le compte est celui d'une autre personne, à qui il est.
 */
function accountLines(team: RunningTeam | null, account: CallAccount): string[] {
  const lent = lender(account.owner)
  return [
    `${team ? `Team ${team.name}` : "No team"} · account « ${account.label} » (${modeLabel(account.mode)}).`,
    ...(lent ? [lentLine(account.label, lent.name)] : []),
  ]
}

/** « Account « Mail Claire » belongs to Claire Morel, who shared it with you. » */
function lentLine(label: string, name: string): string {
  return `Account « ${label} » belongs to ${name}, who shared it with you.`
}

/**
 * Récapitulatif d'une fonction sensible appelée sans `confirm` (H86, N1) : un résultat, pas une erreur,
 * et rien d'exécuté. Une fonction sensible sans `summarize` ne court jamais sans accord : câblage fautif.
 */
async function confirmationRequest(
  fn: CatalogFunction,
  context: FunctionContext,
  args: Record<string, unknown>,
  served: { team: RunningTeam | null; account: CallAccount | undefined },
) {
  if (!fn.summarize) {
    console.error(`[platform] call: sensitive function ${fn.name} has no summarize`)
    throw new PlatformError("internal", "Internal error.")
  }
  // Arguments validés par `fn.schema` : le type commun du catalogue les efface en `never`.
  const summary = await fn.summarize(context, args as never)
  // Le compte d'une autre personne se dit avant l'accord : l'utilisateur sait au nom de qui il agirait.
  const lent = served.account ? lender(served.account.owner) : null
  const text = [summary.text, ...(served.team ? [`Team: ${served.team.name}`] : []), ...(served.account && lent ? [lentLine(served.account.label, lent.name)] : []), "", NOTHING_SENT].join("\n")
  return { text, summary: summary.data ?? {} }
}

/**
 * Le refus d'une fonction inconnue. Appelée sous son nom simple, une fonction de connecteur qui engage ou détruit est
 * nommée sous son nom servi, `<connecteur>_act.<fonction>` ; elle ne court jamais sous l'autre.
 */
function unknownFunction(functions: readonly CatalogFunction[], name: string, prefix: string): PlatformError {
  const served = actName(name.trim().toLowerCase())
  const engaging = served === null ? null : findFunction(functions, served)
  if (engaging?.origin === "connecteur") {
    return new PlatformError("not_found", `Unknown function ${name}: it engages or destroys, so it is served as ${engaging.name}. Call ${engaging.name}.`)
  }
  return new PlatformError("not_found", `Unknown function ${name}. Use ${prefix}_find with type function.`)
}

const MARK_OUTCOMES = { marked: "account_marked", lifted: "account_mark_lifted", mark_failed: "account_mark_failed", lift_failed: "account_mark_lift_failed" } as const

/** Ce que l'appel a fait de la marque de son compte, pour sa ligne de journal (`args._outcome`) ; vide : rien. */
function markOutcome(credential: AccountCredential | undefined): Record<string, number> {
  const effect = credential?.mark?.effect
  return effect ? { [MARK_OUTCOMES[effect]]: 1 } : {}
}

/** Le texte tel que l'assistant le lit, sous le dictionnaire de la requête. */
const pseudonymizerOf = (dictionary: Dictionary) => (text: string): string => pseudonymizedText(dictionary, text)

/**
 * `call` : fonction, activation, arguments, équipe, compte, puis récapitulatif (sensible sans
 * `confirm`) ou exécution. Chaque refus est levé tel que le service qui le décide l'a écrit ; `trace`
 * garde l'équipe et le compte établis avant lui. `confirm` ne sert qu'aux fonctions sensibles (N2).
 */
export async function runCall(deps: CallDeps, input: CallInput): Promise<CallOutput> {
  const { db, identity } = deps
  const prefix = identity.org.prefix
  const functions = deps.functions ?? assistantFunctions()
  const fn = findFunction(functions, input.function.trim().toLowerCase())
  if (!fn) throw unknownFunction(functions, input.function, prefix)
  const trace: CallTrace = deps.trace ?? {}
  // Dès la fonction connue : un refus qui suit (activation, arguments, tiers) ne garde pas ses valeurs au journal.
  const personal = personalValues(fn, input.arguments ?? {})
  if (personal.length > 0) trace.personal = personal
  const active = await deps.activeConnectors()
  if (!isActive(fn, active)) throw await notEnabled(db, identity, fn)
  // Les jetons de l'assistant (pseudonymisation) : résolus avant le contrôle du schéma, qui attend un identifiant.
  const received = deps.dictionary ? await resolvedCallArguments({ db, identity, dictionary: deps.dictionary }, fn, input.arguments ?? {}) : (input.arguments ?? {})
  const args = checkedArguments(fn, received, prefix)
  const tablePath = fn.connector === NATIVE_CONNECTOR && typeof args.table === "string" ? args.table : undefined
  const team = await runningTeam(db, identity, { fn, team: input.team, tablePath, ctxCode: deps.ctxCode })
  trace.teamId = journalTeam(identity, team?.id)
  const account =
    fn.origin === "connecteur"
      ? await resolveAccount(db, identity, { fn, team, account: input.account, origin: deps.origin })
      : undefined
  trace.accountId = account?.id ?? null
  const data = callData(identity, fn, team, account)
  trace.lentBy = data.account ? (lender(data.account.owner)?.userId ?? null) : null
  // Un connecteur réel ne court que sur un compte réel qui a son secret, ses champs et ses réglages (H85), refusé avant
  // la fonction ; un connecteur simulé (`mail`) garde lui-même ses comptes simulés.
  const openCredential = account && !isSimulatedConnector(fn.connector) ? await liveCredential(db, identity, account, fn.connector) : undefined
  const context: FunctionContext = {
    db,
    identity,
    account,
    ctx: deps.ctxCode,
    host: deps.ctxHost ?? null,
    origin: deps.origin,
    accessToken: fn.origin === "erp" ? deps.accessToken : undefined,
    ...(deps.dictionary ? { pseudonymized: pseudonymizerOf(deps.dictionary) } : {}),
  }
  const journal = { target: fn.name, teamId: trace.teamId, accountId: trace.accountId, lentBy: trace.lentBy, personal: trace.personal }
  if (fn.class === "sensitive" && input.confirm !== true) {
    const { text, summary } = await confirmationRequest(fn, context, args, { team, account: data.account })
    return { text, data: { ...data, status: "needs_confirmation", summary }, nextActions: [], ...journal }
  }
  // Le secret ne va qu'à `run`, déchiffré au dernier moment : jamais au récapitulatif, ni au journal, ni au texte.
  const credential = openCredential ? await openCredential() : undefined
  // Arguments validés par `fn.schema` : le type commun du catalogue les efface en `never`.
  const ran = await fn.run({ ...context, credential }, args as never).catch((error: unknown) => {
    // Un refus qui a marqué le compte le dit à la ligne de l'échec.
    const marked = markOutcome(credential)
    if (Object.keys(marked).length > 0) trace.outcome = marked
    throw error
  })
  // Pour l'assistant seulement (le dictionnaire ne vient que du MCP) : les champs déclarés deviennent des jetons.
  const entityFields = fn.output?.entityFields
  const output = deps.dictionary && entityFields ? { ...ran, ...withEntityTokens(deps.dictionary, ran, entityFields) } : ran
  const outcome = { ...output.outcome, ...markOutcome(credential) }
  return {
    text: data.account ? [output.text, ...accountLines(team, data.account)].join("\n") : output.text,
    data: { ...data, result: output.data ?? {} },
    nextActions: nextActions(output.next ?? fn.next ?? [], functions, active),
    ...journal,
    // L'équipe rendue par la fonction prime (N8) : un tableau suivi par un ancien chemin (E07-S02).
    teamId: output.teamId === undefined ? journal.teamId : journalTeam(identity, output.teamId),
    // Ce que la fonction a fait, pour sa ligne de journal (E11-S02, AC-h2), et la marque du compte levée.
    ...(Object.keys(outcome).length > 0 ? { outcome } : {}),
    // La vue du widget, dont les données sont déjà en `result` : celle que rend la fonction, sinon la vue de l'ERP
    // qu'elle déclare (story widgets-dans-la-conversation).
    ...(output.view ? { view: output.view } : fn.view ? { view: `${ERP_VIEW_PREFIX}${fn.view}` as const } : {}),
  }
}
