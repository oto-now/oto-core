// La déclaration des connecteurs décrits par l'hôte (`connecteurs-et-comptes.md` § Moteur des connecteurs décrits) :
// l'hôte passe à `registerConnectors` les définitions des connecteurs qu'il utilise, partagés (sortie de la fabrique du
// dépôt `connectors`) ou propres ; le paquet n'en contient aucun. Chaque définition est contrôlée, son schéma compilé,
// puis ses fonctions entrent au catalogue de `call` avec l'origine `connecteur`, exécutées par le moteur (`engine.ts`).
// La liste `platform.connectors` en est tenue : le nom d'un connecteur déclaré s'y ajoute à son premier usage
// (`keepDeclaredConnector`), jamais retiré. Sans ce module, un connecteur réel ne s'ajouterait qu'en code du paquet.
import { compileJsonArguments, checkArguments, type JsonSchemaArguments } from "../catalog/arguments"
import { declaredConnector, declaredConnectors, replaceDeclaredConnectors, type DeclaredConnector } from "../catalog/connector-source"
import { contractNames } from "../catalog/contracts"
import type { CatalogFunction, FunctionContext } from "../catalog/define"
import { CatalogRegistrationError } from "../catalog/erp"
import { ACT_SUFFIX, actName, catalogFunctions, looksLikeFunction } from "../catalog/registry"
import { issuesText, PlatformError } from "../errors"
import { isJsonObject } from "../json"
import type { Tx } from "../sql"
import { authHeader, prepareAuth, RUN_AUTH_KINDS, type PreparedAuth } from "./auth"
import type { ConnectorDefinition, ConnectorFunctionDefinition, OAuthApplication } from "./definition"
import { describedSummary, errorTable, runDescribed, type DescribedCall, type PreparedFunction } from "./engine"
import { accountIdentityProblem, baseAddressProblem, checkedHostGifts, FIELD_NAME, functionHostProblem, holderProblem, type HostGiven, type HostOptions } from "./host-declaration"
import { isScopeList, type UserConsentAuth } from "./oauth-user"
import { baseAddress, settingProblem } from "./settings"

/** La contrainte de `platform.connectors.name`. */
const CONNECTOR_NAME = /^[a-z][a-z0-9_]{0,39}$/
const LABEL_MAX = 80
const NAME_MAX = 64
const DESCRIPTION_MAX = 1000
const TIMEOUT_MAX_MS = 300_000
const CLASSES = ["read", "write", "sensitive"]
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"]
const QUERY_ARRAYS = ["repeat", "brackets", "comma"]

const namespaceOf = (name: string): string => name.split(".")[0]
const isPositiveInteger = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value > 0

/** Le problème du connecteur lui-même (hors fonctions), dans l'ordre de ses champs ; `null` : aucun. */
function connectorProblem(definition: ConnectorDefinition, reserved: ReadonlySet<string>, seen: ReadonlySet<string>): string | null {
  const { name } = definition
  if (typeof name !== "string" || !CONNECTOR_NAME.test(name)) {
    return `Invalid connector name ${JSON.stringify(String(name))}: lowercase ASCII letters, digits and _, starting with a letter, 40 characters at most.`
  }
  if (name.endsWith(ACT_SUFFIX)) return `Connector ${name}: a name ending in ${ACT_SUFFIX} is kept for the functions of a connector that engage.`
  if (reserved.has(name) || reserved.has(`${name}${ACT_SUFFIX}`)) return `Connector ${name}: the namespace is already served by another source.`
  if (seen.has(name)) return `Duplicate connector ${name} in registerConnectors.`
  if (typeof definition.label !== "string" || !definition.label.trim() || definition.label.length > LABEL_MAX) return `${name}: label must be 1 to ${LABEL_MAX} characters.`
  if (!isPositiveInteger(definition.timeoutMs) || definition.timeoutMs > TIMEOUT_MAX_MS) return `${name}: timeoutMs must be 1 to ${TIMEOUT_MAX_MS}.`
  if (definition.queryArrays !== undefined && !QUERY_ARRAYS.includes(definition.queryArrays)) return `${name}: queryArrays must be repeat, brackets or comma.`
  if (Object.values(definition.headers ?? {}).some((value) => typeof value !== "string")) return `${name}: constant headers must be text.`
  const limit = definition.rateLimit
  if (limit !== undefined && !(isPositiveInteger(limit.requests) && isPositiveInteger(limit.intervalMs))) {
    return `${name}: rateLimit needs positive integers requests and intervalMs.`
  }
  const errors = Array.isArray(definition.errors) ? definition.errors : null
  const statusOk = (status: unknown) => isPositiveInteger(status) || (Array.isArray(status) && status.length > 0 && status.every(isPositiveInteger))
  if (!errors || errors.some((error) => !statusOk(error?.status) || typeof error.code !== "string" || typeof error.message !== "string")) {
    return `${name}: errors must list {status, code, message}.`
  }
  if (!Array.isArray(definition.functions) || definition.functions.length === 0) return `${name}: needs at least one function.`
  return null
}

/**
 * Le problème de ce qu'est un compte : les champs du secret, puis les réglages ; `null` : aucun. Un compte `oauth2_user`
 * n'a aucun champ : ses jetons viennent du consentement, son application OAuth de l'hôte.
 */
function accountProblem(definition: ConnectorDefinition): string | null {
  const { name, credential } = definition
  if (definition.auth?.kind === "oauth2_user") {
    return Array.isArray(credential) && credential.length === 0 ? null : `${name}: credential must be empty with oauth2_user: the tokens of a consent are not fields, and the OAuth application is the host's.`
  }
  const fields = Array.isArray(credential) ? credential : []
  const badField = fields.find((field) => typeof field?.name !== "string" || !FIELD_NAME.test(field.name) || typeof field.label !== "string" || typeof field.secret !== "boolean")
  if (fields.length === 0 || badField) return `${name}: credential must list its fields {name, label, secret}, names in lowercase ASCII letters, digits and _.`
  const settings = definition.settings ?? []
  if (!Array.isArray(settings)) return `${name}: settings must be a list.`
  const names = [...fields.map((field) => field.name), ...settings.map((setting) => setting?.name), ...(definition.accountIdentity ? [definition.accountIdentity.name] : [])]
  if (new Set(names).size !== names.length) return `${name}: credential fields, settings and the account identity need distinct names.`
  for (const setting of settings) {
    const problem = settingProblem(name, setting)
    if (problem) return problem
  }
  return null
}

/** Les noms d'en-têtes qu'une fonction pose, du connecteur à ses arguments, sans casse. */
function headerNames(definition: ConnectorDefinition, fn: ConnectorFunctionDefinition): string[] {
  return [...Object.keys(definition.headers ?? {}), ...Object.keys(fn.request.constants?.headers ?? {}), ...Object.keys(fn.request.headers)].map((header) =>
    header.toLowerCase(),
  )
}

/** Le type JSON Schema d'un argument (`type`), en liste. */
function typesOf(property: unknown): unknown[] {
  if (!isJsonObject(property)) return []
  return Array.isArray(property.type) ? property.type : [property.type]
}

/** Le problème de la requête d'une fonction ; `null` : aucun. */
function requestProblem(definition: ConnectorDefinition, fn: ConnectorFunctionDefinition, auth: PreparedAuth): string | null {
  const spec = fn.request
  if (!isJsonObject(spec) || !METHODS.includes(spec.method) || typeof spec.path !== "string" || !spec.path.startsWith("/")) {
    return `${fn.name}: request needs a method (GET, POST, PUT, PATCH, DELETE) and a path starting with /.`
  }
  if (!isJsonObject(spec.query) || !isJsonObject(spec.body) || !isJsonObject(spec.headers) || !Array.isArray(spec.pathParams)) {
    return `${fn.name}: request needs pathParams, query, body and headers.`
  }
  const properties = isJsonObject(fn.schema.properties) ? fn.schema.properties : {}
  const inPath = [...spec.path.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1])
  const placed = [...inPath, ...Object.values(spec.query), ...Object.values(spec.body), ...Object.values(spec.headers)]
  const unknown = placed.find((argument) => !Object.hasOwn(properties, argument))
  if (unknown !== undefined) return `${fn.name}: request places ${unknown}, which the schema does not declare.`
  const unlisted = inPath.find((argument) => !spec.pathParams.includes(argument))
  if (unlisted !== undefined) return `${fn.name}: path parameter ${unlisted} is not in pathParams.`
  const header = authHeader(auth)
  if (header !== null && headerNames(definition, fn).includes(header)) return `${fn.name}: a constant or argument header would replace the authentication header ${header}.`
  if (auth.kind === "query" && [...Object.keys(spec.query), ...Object.keys(spec.constants?.query ?? {})].includes(auth.param)) {
    return `${fn.name}: a constant or argument query parameter would replace the authentication parameter ${auth.param}.`
  }
  const encoded = Object.entries(spec.encode ?? {})
  const badEncode = encoded.find(([argument, how]) => how !== "json" || !placed.includes(argument))
  if (badEncode) return `${fn.name}: encode ${badEncode[0]} must be json, on a placed argument.`
  for (const argument of Object.values(spec.query)) {
    if (spec.encode?.[argument] === "json") continue
    const types = typesOf(properties[argument])
    if (types.includes("object")) return `${fn.name}: object argument ${argument} in the query needs encode json.`
    if (types.includes("array") && definition.queryArrays === undefined) return `${fn.name}: list argument ${argument} in the query needs the connector's queryArrays.`
  }
  return null
}

/**
 * L'argument qui porte le curseur (`requestParam`, un argument de la fonction, comme la fabrique l'exige), placé en
 * query ou en corps ; ou le problème.
 */
function cursorArgument(fn: ConnectorFunctionDefinition): string | null | { problem: string } {
  const pagination = fn.pagination
  if (pagination === undefined) return null
  if (!["cursor", "page"].includes(pagination.kind) || typeof pagination.next !== "string" || !isPositiveInteger(pagination.maxPages)) {
    return { problem: `${fn.name}: pagination needs kind cursor or page, next and a positive maxPages.` }
  }
  const argument = pagination.requestParam
  const placed = Object.values(fn.request.query).includes(argument) || Object.values(fn.request.body).includes(argument)
  return placed ? argument : { problem: `${fn.name}: pagination requestParam ${argument} is not an argument placed in the query or the body.` }
}

/** Le problème des contrôles (`checks`, `expect`) et du récapitulatif d'une fonction sensible ; `null` : aucun. */
function controlsProblem(fn: ConnectorFunctionDefinition): string | null {
  const codes = fn.refusals.map((refusal) => refusal.code)
  for (const check of fn.checks ?? []) {
    if (check.kind !== "equal_sums" || !codes.includes(check.refusal) || typeof check.items !== "string" || check.fields?.length !== 2) {
      return `${fn.name}: check ${String(check.kind)} is not supported, or names no refusal of the function (equal_sums with items and two fields).`
    }
  }
  for (const expectation of fn.expect ?? []) {
    if (expectation.kind !== "non_empty" || !codes.includes(expectation.refusal) || typeof expectation.path !== "string") {
      return `${fn.name}: expect ${String(expectation.kind)} is not supported, or names no refusal of the function (non_empty with a path).`
    }
  }
  if (fn.class === "sensitive" && (typeof fn.confirm?.summary !== "string" || !fn.confirm.summary.trim())) {
    return `${fn.name}: a sensitive function needs confirm.summary (two-step confirmation).`
  }
  return null
}

/** Le premier problème d'une fonction, puis son schéma compilé ; les examples sont joués contre lui. */
function compiledFunction(definition: ConnectorDefinition, fn: ConnectorFunctionDefinition, seen: ReadonlySet<string>): JsonSchemaArguments | string {
  const { name } = fn
  if (typeof name !== "string" || name.length > NAME_MAX || !looksLikeFunction(name) || namespaceOf(name) !== definition.name || fn.connector !== definition.name) {
    return `Invalid function name ${JSON.stringify(String(name))} in ${definition.name}: expected ${definition.name}.<name> in lowercase ASCII letters, digits and _, ${NAME_MAX} characters at most.`
  }
  if (seen.has(name)) return `Duplicate function ${name} in registerConnectors.`
  if (!CLASSES.includes(fn.class)) return `${name}: class must be read, write or sensitive.`
  if (typeof fn.description !== "string" || !fn.description.trim() || fn.description.length > DESCRIPTION_MAX) return `${name}: description must be 1 to ${DESCRIPTION_MAX} characters.`
  if (!isJsonObject(fn.schema) || fn.schema.type !== "object" || fn.schema.additionalProperties !== false) {
    return `${name}: schema must be a strict object (type object, additionalProperties false): unknown keys are refused, not ignored.`
  }
  const hostFault = functionHostProblem(definition, fn)
  if (hostFault) return hostFault
  if (!Array.isArray(fn.refusals) || fn.refusals.some((refusal) => typeof refusal?.code !== "string" || typeof refusal.message !== "string")) {
    return `${name}: refusals must list {code, when, message}.`
  }
  let schema: JsonSchemaArguments
  try {
    schema = compileJsonArguments(fn.schema)
  } catch (error) {
    return `${name}: schema is not a valid JSON Schema 2020-12 (${error instanceof Error ? error.message : String(error)}).`
  }
  if (!Array.isArray(fn.examples) || fn.examples.length === 0) return `${name}: needs at least one example.`
  for (const [index, example] of fn.examples.entries()) {
    const checked = checkArguments(schema, { ...example?.input })
    if (!checked.success) return `${name}: examples[${index}] does not match the schema (${issuesText(checked.issues)}).`
  }
  return schema
}

/** Les refus que `read` sert : ceux de la fonction, le compte, puis la table du connecteur. */
function refusalLines(definition: ConnectorDefinition, fn: ConnectorFunctionDefinition): string[] {
  const account =
    definition.auth.kind === "oauth2_user"
      ? `No ${definition.name} account connected for you, or one to connect again: each person connects their own, the refusal says how.`
      : `No ${definition.name} account you can use, or one without its secret: the refusal says whom to ask.`
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
  return { credential: context.credential, accountId: context.account.id }
}

/** Une fonction décrite au contrat du catalogue : origine `connecteur`, exemples sans titre, exécution par le moteur. */
function catalogFunction(prepared: PreparedFunction, schema: JsonSchemaArguments): CatalogFunction {
  const { connector, fn } = prepared
  const summary = fn.confirm?.summary
  return {
    // Une fonction qui engage ou détruit est servie sous `<connecteur>_act.<fonction>` ; `connector` reste le connecteur.
    name: fn.act ? (actName(fn.name) ?? fn.name) : fn.name,
    connector: connector.name,
    class: fn.class,
    origin: "connecteur",
    description: fn.description,
    schema,
    examples: fn.examples.map((example) => ({ ...example.input })),
    refusals: refusalLines(connector, fn),
    run: (context, args: Record<string, unknown>) => runDescribed(prepared, describedCall(prepared, context), args),
    summarize: fn.class === "sensitive" && summary !== undefined ? async (_context, args: Record<string, unknown>) => describedSummary(summary, args) : undefined,
  }
}

/** La sonde (`probe`) : une lecture du connecteur, sans argument requis, et des chemins à trouver non vides. */
function probeProblem(definition: ConnectorDefinition): string | null {
  const probe = definition.probe
  if (probe === undefined) return null
  const fn = definition.functions.find((candidate) => candidate.name === probe.function)
  const required = fn && Array.isArray(fn.schema.required) ? fn.schema.required : []
  if (!fn || fn.class !== "read" || required.length > 0 || !Array.isArray(probe.nonEmpty) || probe.nonEmpty.some((path) => typeof path !== "string")) {
    return `${definition.name}: probe must name a read function of the connector without required arguments, and list nonEmpty paths.`
  }
  return null
}

/**
 * L'identité d'un consentement (`oauth2_user`) par une fonction : une lecture du connecteur, sans argument requis, comme
 * la sonde. Celle à une adresse est contrôlée avec l'authentification (`oauth-user.ts`).
 */
function identityProblem(definition: ConnectorDefinition, auth: PreparedAuth): string | null {
  if (auth.kind !== "user_consent" || !("function" in auth.identity)) return null
  const name = auth.identity.function
  const fn = definition.functions.find((candidate) => candidate.name === name)
  const required = fn && Array.isArray(fn.schema.required) ? fn.schema.required : []
  if (!fn || fn.class !== "read" || required.length > 0) return `${definition.name}: identity must name a read function of the connector without required arguments.`
  return null
}

/**
 * Les droits qu'une fonction exige (`scopes`) : exigés dans un connecteur à niveaux d'accès, refusés ailleurs, comme le
 * format le dit. Gardés sans être appliqués (issue oto-now/oto-core#71).
 */
function functionScopesProblem(fn: ConnectorFunctionDefinition, auth: PreparedAuth): string | null {
  const levels = auth.kind === "user_consent" ? auth.accessLevels : null
  if (levels === null) return fn.scopes === undefined ? null : `${fn.name}: scopes need the connector's accessLevels.`
  return isScopeList(fn.scopes, true) ? null : `${fn.name}: scopes must list the scopes the function needs, in a connector with access levels.`
}

/**
 * L'identité lue à une adresse complète, préparée comme une lecture sans argument : un `GET` sur l'adresse, avec le
 * jeton d'accès, par le même moteur qu'une fonction (client HTTP, redirection refusée, délai, table d'erreurs du
 * connecteur, renouvellement sur un 401). Elle n'entre pas au catalogue : l'agent ne l'appelle jamais.
 */
function identityAddress(definition: ConnectorDefinition, auth: UserConsentAuth, url: string): PreparedFunction {
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
  const api = { label: definition.label, timeoutMs: definition.timeoutMs, errors: errorTable(definition, fn), rateLimit: definition.rateLimit }
  return { connector: definition, fn, api, address: { template: url }, auth, cursorArgument: null }
}

/** Un connecteur contrôlé et préparé ; au premier problème, `CatalogRegistrationError`. */
function declared(definition: ConnectorDefinition, reserved: ReadonlySet<string>, seen: Set<string>, given: HostGiven): DeclaredConnector {
  // Une authentification que le moteur n'exécute pas se refuse par son nom, avant ses champs (`oauth2_user` n'en a pas).
  const kindProblem = RUN_AUTH_KINDS.includes(String(definition.auth?.kind)) ? null : prepareAuth(definition)
  const problem =
    connectorProblem(definition, reserved, seen) ?? (typeof kindProblem === "string" ? kindProblem : null) ?? accountProblem(definition) ?? holderProblem(definition) ?? accountIdentityProblem(definition)
  if (problem) throw new CatalogRegistrationError(problem)
  const address = baseAddress(definition)
  if (!address) throw new CatalogRegistrationError(`${definition.name}: needs baseUrl or baseUrls, not both.`)
  const addressFault = baseAddressProblem(definition, address)
  if (addressFault) throw new CatalogRegistrationError(addressFault)
  const auth = prepareAuth(definition)
  if (typeof auth === "string") throw new CatalogRegistrationError(auth)
  seen.add(definition.name)
  let probe: PreparedFunction | null = null
  let identity: PreparedFunction | null = null
  const functions = definition.functions.map((fn) => {
    const schema = compiledFunction(definition, fn, seen)
    if (typeof schema === "string") throw new CatalogRegistrationError(schema)
    const cursor = cursorArgument(fn)
    const later = requestProblem(definition, fn, auth) ?? (typeof cursor === "object" && cursor !== null ? cursor.problem : null) ?? controlsProblem(fn) ?? functionScopesProblem(fn, auth)
    if (later) throw new CatalogRegistrationError(later)
    seen.add(fn.name)
    const api = { label: definition.label, timeoutMs: definition.timeoutMs, errors: errorTable(definition, fn), rateLimit: definition.rateLimit }
    const prepared: PreparedFunction = { connector: definition, fn, api, address, auth, cursorArgument: typeof cursor === "string" ? cursor : null }
    if (fn.name === definition.probe?.function) probe = prepared
    if (auth.kind === "user_consent" && "function" in auth.identity && fn.name === auth.identity.function) identity = prepared
    return catalogFunction(prepared, schema)
  })
  const problemOfProbe = probeProblem(definition) ?? identityProblem(definition, auth)
  if (problemOfProbe) throw new CatalogRegistrationError(problemOfProbe)
  if (auth.kind === "user_consent" && "url" in auth.identity) identity = identityAddress(definition, auth, auth.identity.url)
  return { definition, auth, functions, probe, identity, ...given, application: auth.kind === "user_consent" ? given.application : null }
}

/** Ce que l'hôte passe à `registerConnectors` en plus de ses définitions. */
export type ConnectorOptions = HostOptions & {
  /**
   * L'application OAuth de chaque connecteur `oauth2_user`, par nom de connecteur : l'identifiant et le secret du client
   * que l'hôte a enregistrés chez le tiers, lus par l'hôte (son environnement, son coffre), jamais par le paquet. Sans
   * elle, la connexion d'un compte et l'appel sont refusés nommément.
   */
  oauthApplications?: Readonly<Record<string, OAuthApplication>>
}

/** Les applications OAuth contrôlées : chacune d'un connecteur `oauth2_user` déclaré, identifiant et secret non vides. */
function checkedApplications(definitions: readonly ConnectorDefinition[], given: ConnectorOptions["oauthApplications"]): Map<string, OAuthApplication> {
  const applications = new Map<string, OAuthApplication>()
  for (const [name, application] of Object.entries(given ?? {})) {
    const definition = definitions.find((candidate) => candidate.name === name)
    if (definition?.auth.kind !== "oauth2_user") throw new CatalogRegistrationError(`OAuth application for ${name}: no oauth2_user connector of this name is declared.`)
    const filled = (value: unknown): value is string => typeof value === "string" && value.trim() !== ""
    if (!isJsonObject(application) || !filled(application.clientId) || !filled(application.clientSecret)) {
      throw new CatalogRegistrationError(`OAuth application for ${name} needs a non-empty clientId and clientSecret.`)
    }
    applications.set(name, { clientId: application.clientId, clientSecret: application.clientSecret })
  }
  return applications
}

/**
 * Déclare les connecteurs décrits de l'hôte, partagés ou propres (`ConnectorDefinition`), à appeler au montage de
 * chaque route qui monte une porte du paquet, comme `registerFunctions`. Toute la liste est contrôlée d'abord : nom du
 * connecteur (celui de `platform.connectors`), espace de noms libre, doublon, libellé, délai, table d'erreurs, champs
 * du secret et réglages, adresse (fixe, gabarit ou par réglage), authentification (`api_key`, `bearer`, `basic`,
 * `oauth2_client_credentials`, `oauth2_user`, avec `scopes` ou des niveaux d'accès) ; puis chaque fonction : nom,
 * classe, description, schéma strict et compilé (JSON Schema 2020-12), exemples, requête, pagination, contrôles,
 * récapitulatif d'une fonction sensible, droits exigés d'un connecteur à niveaux ; enfin la sonde et l'identité d'un
 * consentement (une fonction, ou une adresse complète). `options.oauthApplications` : l'application OAuth de chaque
 * connecteur `oauth2_user` ; `options.hostCredentials` : le lecteur des champs `holder: host` ; `options.hostedLinks` :
 * le port du branchement hébergé d'un connecteur à `accountIdentity` ; tous fournis par l'hôte. Au premier refus,
 * `CatalogRegistrationError` et rien n'est déclaré ;
 * sinon la liste remplace toute la déclaration précédente (un rechargement à chaud ne double rien).
 */
export function registerConnectors(definitions: readonly ConnectorDefinition[], options: ConnectorOptions = {}): void {
  const current = new Set(declaredConnectors().flatMap((connector) => connector.functions))
  const others = catalogFunctions().filter((fn) => !current.has(fn))
  const reserved = new Set([...others.map((fn) => fn.name), ...contractNames()].map(namespaceOf))
  const seen = new Set<string>()
  const applications = checkedApplications(definitions, options.oauthApplications)
  const { readers, ports } = checkedHostGifts(definitions, options)
  const gift = (name: string): HostGiven => ({ application: applications.get(name) ?? null, hostCredentials: readers.get(name) ?? null, hostedLinks: ports.get(name) ?? null })
  const connectors = definitions.map((definition) => declared(definition, reserved, seen, gift(definition.name)))
  replaceDeclaredConnectors(connectors)
}

/**
 * Tient la liste `platform.connectors` depuis la déclaration : le nom d'un connecteur déclaré et son libellé s'y
 * ajoutent avant la première ligne qui le cite (activation, compte), dans la transaction de cette écriture ; un nom
 * présent ne change pas, et rien n'est jamais retiré. Un connecteur non déclaré (`mail`, natif) n'écrit rien.
 */
export async function keepDeclaredConnector(sql: Tx, name: string): Promise<void> {
  const connector = declaredConnector(name)
  if (!connector) return
  await sql`select platform.declare_connector(${name}, ${connector.definition.label})`
}
