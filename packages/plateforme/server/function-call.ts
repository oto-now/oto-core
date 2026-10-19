// L'appel d'une fonction du catalogue par le serveur de l'hôte : un écran de l'application hôte (des contrôles
// automatiques lancés depuis un dossier, par exemple) court une fonction sous l'identité de la personne connectée.
// Mêmes contrôles que `<p>_call`, puisque c'est `runCall` qui court, sur tout le catalogue, fonctions réservées au serveur
// (`serverOnly`) comprises : fonction, activation de son connecteur,
// arguments, équipe, compte et niveau sur lui (la classe `write` comprise), secret d'un compte réel, récapitulatif sans
// rien exécuter d'une fonction sensible appelée sans `confirm` ; chaque refus remonte tel quel (`PlatformError`). Même
// ligne de journal que la porte MCP (`openedEntry`, `servedEntry`, `failedEntry`), à l'origine près : `method` `api`,
// celle des portes des écrans, au lieu de `tools/call`, et ni `ctx` ni `host`, aucune conversation d'assistant n'étant
// en jeu. Sans ce module, l'hôte n'atteindrait une fonction que par le MCP, sous le jeton d'un assistant.
import { catalogFunctions } from "./catalog/registry"
import { runCall, type CallAccount, type CallInput, type CallOutput, type CallTeam, type CallTrace } from "./calls"
import { loadActiveConnectors } from "./connectors/activations"
import type { PlatformDb } from "./db"
import { isPlatformError } from "./errors"
import type { Identity } from "./identity"
import { clip, failedEntry, MAX_TARGET_CHARS, openedEntry, servedEntry, writeJournal, type JournalEntry } from "./journal"

/** La ligne de journal d'un appel venu de l'hôte : la `method` des portes des écrans (H07), l'outil `call`. */
export const HOST_CALL_JOURNAL = { method: "api", tool: "call" } as const

/** L'entrée de `<p>_call` sans `ctx` : la fonction, ses arguments, `confirm`, l'équipe et le compte choisis. */
export type FunctionCallInput = CallInput

export type FunctionCallOptions = {
  /** Origine de l'adresse de l'organisation (`https://acme.oto.cx`) : lien du tableau de bord dans un refus. */
  origin: string
  /** Jeton vérifié de la session, sous lequel s'exécutent les seules fonctions de l'ERP ; sans lui, aucune ne court. */
  accessToken?: string
  /** Agent utilisateur de la requête de l'écran, pour la ligne de journal. */
  userAgent?: string | null
  /** Exécute une tâche après la réponse (`after` de `next/server`) ; sans elle, la ligne de journal est attendue. */
  defer?: (task: () => Promise<void>) => void
}

type FunctionCallFields = {
  /** Nom normalisé de la fonction. */
  function: string
  /** Le compte-rendu, ou le récapitulatif d'une fonction sensible, tel que `<p>_call` le sert. */
  text: string
  team: CallTeam | null
  /** Le compte d'une fonction de connecteur ; nul pour une fonction sans compte. */
  account: CallAccount | null
}

/**
 * Ce que rend `callFunction` : `done`, la fonction a couru, avec son résultat et les fonctions proposées ensuite (ni
 * sensibles ni inactives) ; `needs_confirmation`, fonction sensible appelée sans `confirm: true`, rien n'a couru, et son
 * récapitulatif est à montrer à la personne avant de rappeler avec `confirm: true`.
 */
export type FunctionCallResult =
  | (FunctionCallFields & { status: "done"; result: Record<string, unknown>; nextActions: string[] })
  | (FunctionCallFields & { status: "needs_confirmation"; summary: Record<string, unknown> })

function resultOf(output: CallOutput): FunctionCallResult {
  const { data } = output
  const fields: FunctionCallFields = { function: data.function, text: output.text, team: data.team, account: data.account ?? null }
  if (data.status === "needs_confirmation") return { ...fields, status: "needs_confirmation", summary: data.summary }
  return { ...fields, status: "done", result: data.result, nextActions: output.nextActions }
}

/** Le code et le message d'un échec pour la ligne : un refus tel quel, toute autre erreur en `internal`. */
function failureOf(error: unknown): { code: string; message: string } {
  return isPlatformError(error) ? { code: error.code, message: error.message } : { code: "internal", message: "Internal error." }
}

/**
 * Court une fonction du catalogue pour la personne de `identity`, avec les contrôles et le journal de `<p>_call`
 * (voir l'en-tête). Les connecteurs actifs de l'organisation sont relus à chaque appel. Lève le refus du service qui
 * le décide (`not_found`, `not_enabled`, `invalid_arguments`, `forbidden`, `ambiguous_team`, `ambiguous_account`…),
 * après l'avoir journalisé.
 */
export async function callFunction(db: PlatformDb, identity: Identity, input: FunctionCallInput, options: FunctionCallOptions): Promise<FunctionCallResult> {
  const started = Date.now()
  const entry: JournalEntry = {
    ...openedEntry(identity, { method: HOST_CALL_JOURNAL.method, params: input, userAgent: options.userAgent ?? null }),
    tool: HOST_CALL_JOURNAL.tool,
    // La fonction demandée, posée avant les contrôles : un appel refusé la garde (E03-S04, N7).
    target: clip(input.function.trim(), MAX_TARGET_CHARS),
  }
  const served = { ctx: null, host: null }
  const trace: CallTrace = {}
  try {
    const output = await runCall(
      {
        db,
        identity,
        ctxCode: null,
        origin: options.origin,
        accessToken: options.accessToken,
        activeConnectors: () => loadActiveConnectors(db, identity.org.id),
        // Tout le catalogue : une fonction réservée au serveur (`serverOnly`) ne court que par ici.
        functions: catalogFunctions(),
        trace,
      },
      input,
    )
    servedEntry(entry, output, { ...served, resultChars: output.text.length })
    return resultOf(output)
  } catch (error) {
    const failure = failureOf(error)
    failedEntry(entry, failure, { ...served, trace, resultChars: failure.message.length })
    throw error
  } finally {
    entry.duration_ms = Date.now() - started
    // L'écrivain commun des portes (H07) : il ne lève jamais, un journal en panne ne change rien.
    const task = () => writeJournal(db, [entry])
    if (options.defer) options.defer(task)
    else await task()
  }
}
