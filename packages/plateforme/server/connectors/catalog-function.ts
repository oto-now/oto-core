// Une fonction d'un connecteur décrit telle que le moteur la court et que le catalogue de `call` la sert
// (`connecteurs-et-comptes.md` § Moteur des connecteurs décrits) : son tiers (délai, table d'erreurs), l'identité lue à
// une adresse, préparée comme une lecture ; au catalogue, origine `connecteur`, ses refus, son exécution par le moteur
// sous l'accès du compte de l'appel (§ Plusieurs accès). Tirée de `declaration.ts`, qui la prépare ; sans elle, chaque
// fonction redirait le compte et l'accès de l'appel.
import type { JsonSchemaArguments } from "../catalog/arguments"
import { declaredConnector } from "../catalog/connector-source"
import type { CatalogFunction, FunctionContext } from "../catalog/define"
import { actName } from "../catalog/registry"
import { PlatformError } from "../errors"
import { accountAccess, type AccessView } from "./accesses"
import { backgroundTraits, servedDescription } from "./background-declaration"
import type { ConnectorDefinition, ConnectorFunctionDefinition, ConnectorView } from "./definition"
import { describedSummary, runDescribed, type DescribedCall, type PreparedFunction } from "./engine"
import { errorTable } from "./error-table"
import { callerTransitFiles } from "./multipart"
import type { UserConsentAuth } from "./oauth-user"

/** Le tiers d'une fonction : le délai de la fonction s'il en déclare un, sinon celui du connecteur ; sa table d'erreurs. */
export function functionApi(definition: ConnectorView, fn: ConnectorFunctionDefinition): PreparedFunction["api"] {
  return { label: definition.label, timeoutMs: fn.timeoutMs ?? definition.timeoutMs, errors: errorTable(definition, fn), rateLimit: definition.rateLimit }
}

/**
 * L'identité lue à une adresse complète, préparée comme une lecture sans argument : un `GET` sur l'adresse, avec le
 * jeton d'accès, par le même moteur qu'une fonction (client HTTP, redirection refusée, délai et table
 * d'erreurs du connecteur, renouvellement sur un 401). Elle n'entre pas au catalogue : l'agent ne l'appelle jamais.
 */
export function identityAddress(definition: ConnectorView, auth: UserConsentAuth, url: string): PreparedFunction {
  const fn: ConnectorFunctionDefinition = {
    name: `${definition.name}.identity`,
    connector: definition.name,
    class: "read",
    act: false,
    description: "Who consented, read at the identity address.",
    schema: { type: "object", additionalProperties: false, properties: {} },
    examples: [{ title: "Who consented", input: {} }],
    refusals: [],
    request: { method: "GET", path: "", pathParams: [], query: {}, body: {}, headers: {} },
  }
  return { connector: definition, fn, api: functionApi(definition, fn), address: { template: url }, auth, cursorArgument: null }
}

/**
 * Les refus que `read` sert : ceux de la fonction, le compte (selon que ses accès se connectent par consentement, par
 * clé, ou les deux), puis la table du connecteur.
 */
export function refusalLines(definition: ConnectorDefinition, accesses: readonly AccessView[], fn: ConnectorFunctionDefinition): string[] {
  const consents = accesses.filter((access) => access.view.auth.kind === "oauth2_user").length
  const account =
    consents === accesses.length
      ? `No ${definition.name} account connected for you, or one to connect again: each person connects their own, the refusal says how.`
      : consents === 0
        ? `No ${definition.name} account you can use, or one without its secret: the refusal says whom to ask.`
        : `No ${definition.name} account you can use, or one to connect again or without its secret: connect your own, or ask for one; the refusal says how.`
  return [
    ...fn.refusals.map((refusal) => `${refusal.code}: ${refusal.message}${typeof refusal.when === "number" ? ` (HTTP ${refusal.when})` : ""}`),
    account,
    ...definition.errors.map((error) => `${error.code}: ${error.message}`),
  ]
}

/** Le compte de l'appel, résolu par `runCall` pour toute fonction d'origine `connecteur` : sans lui, câblage fautif. */
function describedCall(prepared: PreparedFunction, context: FunctionContext): DescribedCall {
  if (!context.account) {
    console.error(`[platform] call: ${prepared.fn.name} without a resolved account`)
    throw new PlatformError("internal", "Internal error.")
  }
  const files = prepared.fn.request.files !== undefined || prepared.fn.output?.file !== undefined
  const answered = context.answered ? { answered: context.answered } : {}
  return { credential: context.credential, accountId: context.account.id, ...(files ? { files: callerTransitFiles(context, prepared.fn.name) } : {}), ...answered }
}

/**
 * La fonction préparée pour l'accès du compte de l'appel (`null` : le seul d'un connecteur à un seul accès). Un compte
 * sans accès déclaré est refusé dès son ouverture (`liveCredential`, `accountAccess`) ; arrivé ici, câblage fautif.
 */
function preparedFor(byAccess: ReadonlyMap<string | null, PreparedFunction>, fn: ConnectorFunctionDefinition, context: FunctionContext): PreparedFunction {
  const account = context.account
  const prepared = account ? byAccess.get(account.access ?? null) : undefined
  if (prepared) return prepared
  const connector = declaredConnector(fn.connector)
  if (account && connector) accountAccess(connector, account)
  console.error(`[platform] call: ${fn.name} without a resolved account of a declared access`)
  throw new PlatformError("internal", "Internal error.")
}

/** Ce que le catalogue sert d'une fonction décrite : la fonction, préparée pour chaque accès, son schéma et ses refus. */
type ServedFunction = {
  connector: ConnectorDefinition
  fn: ConnectorFunctionDefinition
  byAccess: ReadonlyMap<string | null, PreparedFunction>
  schema: JsonSchemaArguments
  refusals: string[]
}

/**
 * Une fonction décrite au contrat du catalogue : origine `connecteur`, exemples sans titre, exécution par le moteur,
 * préparée pour chaque accès du connecteur (`byAccess`), courue par celui du compte de l'appel.
 */
export function catalogFunction({ connector, fn, byAccess, schema, refusals }: ServedFunction): CatalogFunction {
  const summary = fn.confirm?.summary
  return {
    // Une fonction qui engage ou détruit est servie sous `<connecteur>_act.<fonction>` ; `connector` reste le connecteur.
    name: fn.act ? (actName(fn.name) ?? fn.name) : fn.name,
    connector: connector.name,
    class: fn.class,
    origin: "connecteur",
    // Une fonction longue : la phrase fixe du moteur, et ce qu'en lit `call` pour la mettre en file.
    description: servedDescription(fn),
    ...backgroundTraits(fn),
    schema,
    examples: fn.examples.map((example) => ({ ...example.input })),
    refusals,
    run: (context, args: Record<string, unknown>) => {
      const prepared = preparedFor(byAccess, fn, context)
      return runDescribed(prepared, describedCall(prepared, context), args)
    },
    summarize: fn.class === "sensitive" && summary !== undefined ? async (_context, args: Record<string, unknown>) => describedSummary(summary, args) : undefined,
  }
}
