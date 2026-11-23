// Les fonctions de l'API d'un hôte au contrat du catalogue (`fonctions-d-un-hote.md` § Exécution) : chacune entre comme
// une fonction de l'ERP (origine `erp`, toujours active, sans compte, de la classe que le document déclare) et court par
// le moteur des connecteurs décrits (validation, répartition des arguments, `output`). La requête part vers
// `<adresse de l'organisation><serveur relatif><chemin>`, par le transport gardé, avec le jeton échangé pour la personne
// (`exchange.ts`, jamais le sien) et les en-têtes `Oto-Ctx`, `Oto-Client` et `Oto-Org`. Une fonction sensible se
// confirme par les deux temps de l'API (`confirm: { by: host }`) : sans `confirm`, l'hôte répond
// `202 { status: "needs_confirmation", summary }` ; avec, la requête porte `?confirm=true`.
import type { JsonSchemaArguments } from "../catalog/arguments"
import type { CatalogFunction, FunctionContext, FunctionSummary } from "../catalog/define"
import { actName } from "../catalog/registry"
import type { AccountCredential } from "../connectors/auth"
import { functionApi } from "../connectors/catalog-function"
import type { ConnectorDefinition, ConnectorFunctionDefinition, ConnectorView } from "../connectors/definition"
import { executeDescribed, runDescribed, type AnswerReader, type DescribedCall, type PreparedFunction } from "../connectors/engine"
import { requestAnswer } from "../connectors/http"
import { PlatformError } from "../errors"
import { cut } from "../journal"
import { isJsonObject } from "../json"
import { assistantName } from "../usage-statistics"
import type { ImportedHost } from "./document"
import { hostToken } from "./exchange"
import { hostProblems } from "./problem-json"

/** Au plus, en caractères, la valeur d'un en-tête `Oto-*`. */
const HEADER_MAX = 200
/** Au plus, en caractères, le récapitulatif de l'hôte relayé avant l'accord. */
const SUMMARY_MAX = 2000

/** Une valeur d'en-tête sûre : ASCII imprimable, coupée ; `null` si rien n'en reste. */
function headerValue(value: string | null | undefined): string | null {
  const text = (value ?? "").replace(/[^\x20-\x7E]+/g, " ").trim().slice(0, HEADER_MAX)
  return text === "" ? null : text
}

/**
 * Les en-têtes que l'hôte reçoit à chaque appel : `Oto-Ctx` (le code de la conversation), `Oto-Client` (la famille du
 * client MCP : Claude, ChatGPT…) et `Oto-Org` (l'identifiant de l'organisation, un uuid stable, jamais son préfixe, qui
 * peut changer). Un en-tête sans valeur connue n'est pas envoyé.
 */
export function hostHeaders(context: FunctionContext): Record<string, string> {
  const entries: [string, string | null][] = [
    ["oto-ctx", headerValue(context.ctx)],
    ["oto-client", headerValue(assistantName(context.host ?? null))],
    ["oto-org", context.identity.org.id],
  ]
  return Object.fromEntries(entries.filter((entry): entry is [string, string] => entry[1] !== null))
}

/** Le scope demandé à l'émetteur : les familles du document, jointes par une espace (provisoire, voir la conception). */
export function hostScope(imported: ImportedHost): string {
  return imported.families.join(" ")
}

/** Aucun jeton de compte : le jeton de l'hôte s'échange à chaque appel (`exchange.ts`), jamais rangé dans un compte. */
const noTokens: AccountCredential["tokens"] = {
  read: async () => null,
  write: async () => {
    console.error("[platform] host api: a token write reached the functions of a host")
    throw new PlatformError("internal", "Internal error.")
  },
}

/** Le jeton vérifié de l'appelant, que `runCall` passe aux fonctions d'origine `erp` ; sans lui, câblage fautif. */
function subjectToken(context: FunctionContext, fn: string): string {
  if (context.accessToken) return context.accessToken
  console.error(`[platform] host api: ${fn} called without the caller's verified token`)
  throw new PlatformError("internal", "Internal error.")
}

type HostFunction = { imported: ImportedHost; address: string; definition: ConnectorDefinition; fn: ConnectorFunctionDefinition; schema: JsonSchemaArguments }

/**
 * La fonction préparée pour un appel : l'adresse de l'organisation, les en-têtes `Oto-*` posés après ceux du connecteur,
 * le jeton échangé pour la personne qui appelle, et les refus `problem+json` de l'hôte. `confirmed` : le second temps
 * d'une fonction sensible (`?confirm=true`).
 */
function prepared(host: HostFunction, context: FunctionContext, confirmed: boolean): { prepared: PreparedFunction; call: DescribedCall } {
  const { imported, address, definition, fn } = host
  const connector: ConnectorView = { ...(definition as ConnectorView), headers: { ...definition.headers, ...hostHeaders(context) } }
  const request = confirmed ? { ...fn.request, constants: { ...fn.request.constants, query: { ...fn.request.constants?.query, confirm: "true" } } } : fn.request
  const served: ConnectorFunctionDefinition = { ...fn, request }
  const exchange = {
    orgId: context.identity.org.id,
    userId: context.identity.user.id,
    subjectToken: subjectToken(context, fn.name),
    issuer: imported.issuer,
    resource: imported.resource,
    scope: hostScope(imported),
  }
  const api = { ...functionApi(connector, served), problems: hostProblems(definition.label) }
  const auth = { kind: "host_delegated" as const, token: () => hostToken(definition.label, exchange) }
  const credential: AccountCredential = { fields: {}, settings: { address }, tokens: noTokens }
  return {
    prepared: { connector, fn: served, api, address: { template: definition.baseUrl ?? "" }, auth, cursorArgument: fn.pagination?.requestParam ?? null },
    call: { credential, accountId: `host:${context.identity.org.id}` },
  }
}

/**
 * Le premier temps d'une fonction sensible : seule une réponse `202 { status: "needs_confirmation", summary }` le
 * tient. Toute autre réponse réussie rompt le contrat de l'API : l'hôte a pu agir, et le refus le dit, sans jamais
 * prétendre que rien n'a été fait (au journal : le statut, jamais le corps).
 */
function firstStep(label: string, name: string): AnswerReader {
  return async (exchange) => {
    const { status, value } = await requestAnswer(exchange.api, exchange.request, exchange.fetcher, { resign: exchange.resign })
    if (status === 202 && isJsonObject(value) && value.status === "needs_confirmation" && typeof value.summary === "string" && value.summary.trim() !== "") return value
    console.error(`[platform] host api ${label}: ${name} broke the two steps (status ${status} on the first step)`)
    throw new PlatformError(
      "upstream_error",
      `${label} answered the first step of ${name} without asking for confirmation (HTTP ${status}), against its contract: it may have carried out the action. Check in ${label} before calling again.`,
      { reason: "host_confirmation_broken" },
    )
  }
}

/** Les refus que `read` sert d'une fonction de l'hôte : le consentement, la table standard, puis ceux que l'hôte écrit. */
function refusalLines(definition: ConnectorDefinition): string[] {
  return [
    `forbidden: The functions of ${definition.label} require the person's consent from this client (details.reason host_consent_required).`,
    ...definition.errors.map((error) => `${error.code}: ${error.message}`),
    `Any refusal ${definition.label} writes (problem+json) comes with its own message, and its code in details.refusal.`,
  ]
}

/** Une fonction de l'hôte au contrat du catalogue ; une fonction qui écrit est servie sous `<espace>_act.<verbe>`. */
function catalogFunction(host: HostFunction): CatalogFunction {
  const { definition, fn, schema } = host
  return {
    name: fn.act ? (actName(fn.name) ?? fn.name) : fn.name,
    connector: definition.name,
    class: fn.class,
    origin: "erp",
    description: fn.description,
    schema,
    examples: fn.examples.map((example) => ({ ...example.input })),
    refusals: refusalLines(definition),
    run: (context, args: Record<string, unknown>) => {
      const { prepared: ready, call } = prepared(host, context, fn.class === "sensitive")
      return runDescribed(ready, call, args)
    },
    summarize:
      fn.class === "sensitive"
        ? async (context, args: Record<string, unknown>): Promise<FunctionSummary> => {
            const { prepared: ready, call } = prepared(host, context, false)
            const { answers } = await executeDescribed(ready, call, args, firstStep(definition.label, fn.name))
            const summary = String((answers[0] as { summary: string }).summary)
            return { text: cut(summary.trim(), SUMMARY_MAX), data: { arguments: args, confirmed_by: "host" } }
          }
        : undefined,
  }
}

/** Les fonctions de l'API d'un hôte servie à `address`, dans l'ordre du document. */
export function hostCatalogFunctions(imported: ImportedHost, address: string): CatalogFunction[] {
  return imported.connectors.flatMap(({ definition, schemas }) =>
    definition.functions.map((fn) => {
      const schema = schemas.get(fn.name)
      if (!schema) throw new Error(`[platform] host api: ${fn.name} without its compiled schema`)
      return catalogFunction({ imported, address, definition, fn, schema })
    }),
  )
}
