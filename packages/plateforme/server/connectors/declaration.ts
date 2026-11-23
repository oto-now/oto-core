// La déclaration des connecteurs décrits par l'hôte (`connecteurs-et-comptes.md` § Moteur des connecteurs décrits) :
// l'hôte passe à `registerConnectors` les définitions des connecteurs qu'il utilise, partagés (sortie de la fabrique du
// dépôt `connectors`) ou propres ; le paquet n'en contient aucun. Chaque définition est contrôlée, son schéma compilé,
// puis ses fonctions entrent au catalogue de `call` avec l'origine `connecteur`, exécutées par le moteur (`engine.ts`).
// Un connecteur à plusieurs accès (`accesses`) est jugé accès par accès, sur le connecteur tel que chacun le voit
// (`accesses.ts`) ; ses fonctions, communes, se préparent pour chaque accès, et l'appel prend celle de l'accès du compte.
// La liste `platform.connectors` en est tenue : le nom d'un connecteur déclaré s'y ajoute à son premier usage
// (`keepDeclaredConnector`), jamais retiré. Sans ce module, un connecteur réel ne s'ajouterait qu'en code du paquet.
import { compileJsonArguments, checkArguments, type JsonSchemaArguments } from "../catalog/arguments"
import { declaredConnector, declaredConnectors, replaceDeclaredConnectors, type DeclaredAccess, type DeclaredConnector } from "../catalog/connector-source"
import { contractNames } from "../catalog/contracts"
import { CatalogRegistrationError } from "../catalog/erp"
import { ACT_SUFFIX, catalogFunctions, looksLikeFunction } from "../catalog/registry"
import { issuesText } from "../errors"
import { backgroundRunnerProblem, declareBackgroundRunner, type BackgroundRunner } from "../jobs/trigger"
import { isJsonObject } from "../json"
import type { Tx } from "../sql"
import { accessesProblem, accessProblem, accessViews, type AccessView } from "./accesses"
import { modesProblem } from "./account-owners"
import { authHeader, prepareAuth, RUN_AUTH_KINDS, type PreparedAuth } from "./auth"
import { bodyArgumentProblem } from "./body-argument"
import { bodyListProblem } from "./body-list"
import { bodyArguments, bodyTableProblem, bodyTableShaped } from "./body-table"
import { HOST_CONSENT_CONNECTOR, type ConnectorDefinition, type ConnectorFunctionDefinition, type ConnectorView, type OAuthApplication } from "./definition"
import { catalogFunction, functionApi, identityAddress, refusalLines } from "./catalog-function"
import type { PreparedFunction } from "./engine"
import { backgroundProblem } from "./background-declaration"
import { asyncProblem, costProblem, functionKeysProblem } from "./cost-declaration"
import { fileOutputProblem } from "./file-output"
import { accountIdentityProblem, baseAddressProblem, checkedApplications, checkedHostGifts, FIELD_NAME, functionHostProblem, holderProblem, type HostGiven, type HostOptions } from "./host-declaration"
import { filesProblem } from "./multipart"
import { declaredLevels, functionScopesProblem, type AccessLevels } from "./levels"
import { stripProblem } from "./output"
import { presentationProblem } from "./presentation-declaration"
import { identityProblem, probeProblem } from "./probe-declaration"
import { withServerOnly, type ServerOnlyOption } from "./server-only"
import { signalProblem } from "./signal-declaration"
import { baseAddress, settingProblem } from "./settings"

/** La contrainte de `platform.connectors.name`. */
const CONNECTOR_NAME = /^[a-z][a-z0-9_]{0,39}$/
const LABEL_MAX = 80
const NAME_MAX = 64
const DESCRIPTION_MAX = 1000
const TIMEOUT_MAX_MS = 300_000
/** Le délai d'une fonction : des secondes entières dans la description (`timeout_s` ≥ 1), donc une seconde au moins. */
const FUNCTION_TIMEOUT_MIN_MS = 1_000
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
  return signalProblem(errors, `${name}: error`)
}

/**
 * Le problème de ce qu'est un compte : les champs du secret, puis les réglages ; `null` : aucun. Un compte `oauth2_user`
 * n'a aucun champ : ses jetons viennent du consentement, son application OAuth de l'hôte.
 */
function accountProblem(definition: ConnectorView): string | null {
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

/** Le problème de la requête d'une fonction, son corps entier (`body-argument.ts`), emboîté (`body-table.ts`) ou en liste (`body-list.ts`) compris ; `null` : aucun. */
function requestProblem(definition: ConnectorView, fn: ConnectorFunctionDefinition, auth: PreparedAuth): string | null {
  const spec = fn.request
  if (!isJsonObject(spec) || !METHODS.includes(spec.method) || typeof spec.path !== "string" || !spec.path.startsWith("/")) {
    return `${fn.name}: request needs a method (GET, POST, PUT, PATCH, DELETE) and a path starting with /.`
  }
  const shaped = isJsonObject(spec.query) && (bodyTableShaped(spec.body) || typeof spec.body === "string") && isJsonObject(spec.headers) && Array.isArray(spec.pathParams)
  const shape = shaped ? (bodyArgumentProblem(fn) ?? bodyTableProblem(fn) ?? bodyListProblem(fn)) : `${fn.name}: request needs pathParams, query, body (a map, or the argument that is the whole body) and headers.`
  if (shape) return shape
  const properties = isJsonObject(fn.schema.properties) ? fn.schema.properties : {}
  const inPath = [...spec.path.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1])
  // Un corps entier n'a pas de table : son argument est déjà jugé (`bodyArgumentProblem`), déclaré et jamais encodé.
  const placed = [...inPath, ...Object.values(spec.query), ...bodyArguments(spec), ...Object.values(spec.headers)]
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
 * query ou en corps, emboîté ou non (`body-table.ts`) ; ou le problème.
 */
function cursorArgument(fn: ConnectorFunctionDefinition): string | null | { problem: string } {
  const pagination = fn.pagination
  if (pagination === undefined) return null
  if (!["cursor", "page"].includes(pagination.kind) || typeof pagination.next !== "string" || !isPositiveInteger(pagination.maxPages)) {
    return { problem: `${fn.name}: pagination needs kind cursor or page, next and a positive maxPages.` }
  }
  const argument = pagination.requestParam
  const placed = Object.values(fn.request.query).includes(argument) || bodyArguments(fn.request).includes(argument)
  return placed ? argument : { problem: `${fn.name}: pagination requestParam ${argument} is not an argument placed in the query or the body.` }
}

/**
 * Le problème des contrôles (`checks`, `expect`), du récapitulatif d'une fonction sensible, puis du signal de refus de
 * ses refus (`signal-declaration.ts`) ; `null` : aucun.
 */
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
  // Les deux temps tenus par l'API elle-même (`by: host`) n'appartiennent qu'aux fonctions de l'API d'un hôte (`host-api/`).
  if (fn.confirm?.by !== undefined) return `${fn.name}: confirm by host is reserved to the functions of a host's API, not to a declared connector.`
  if (fn.class === "sensitive" && (typeof fn.confirm?.summary !== "string" || !fn.confirm.summary.trim())) {
    return `${fn.name}: a sensitive function needs confirm.summary (two-step confirmation).`
  }
  return signalProblem(fn.refusals, `${fn.name}: refusal`)
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

/**
 * Le délai propre à une fonction (`timeoutMs`), comme la fabrique le contrôle : un entier de millisecondes, d'une seconde
 * au moins, borné comme celui du connecteur ; plus court ou plus long que lui, jamais égal (il ne dirait rien).
 */
function functionTimeoutProblem(definition: ConnectorDefinition, fn: ConnectorFunctionDefinition): string | null {
  const timeout = fn.timeoutMs
  if (timeout === undefined) return null
  const bounded = Number.isInteger(timeout) && timeout >= FUNCTION_TIMEOUT_MIN_MS && timeout <= TIMEOUT_MAX_MS
  if (!bounded) return `${fn.name}: timeoutMs must be an integer from ${FUNCTION_TIMEOUT_MIN_MS} to ${TIMEOUT_MAX_MS}.`
  return timeout === definition.timeoutMs ? `${fn.name}: timeoutMs equals the connector's (${timeout}): it says nothing, drop it.` : null
}

/** Les niveaux d'accès d'une authentification : ceux d'un consentement ou d'un compte de service ; `null` ailleurs. */
const levelsOf = (auth: PreparedAuth): AccessLevels | null => (auth.kind === "user_consent" || auth.kind === "service_account" ? declaredLevels(auth) : null)

/**
 * Le problème d'un accès, sur le connecteur tel qu'il le voit, dans l'ordre : ses `modes`, une authentification que le
 * moteur n'exécute pas (refusée par son nom, avant ses champs : `oauth2_user` n'en a pas), les champs de son secret et
 * les réglages, leurs titulaires, l'identité d'un compte rattaché ; pour un connecteur à plusieurs accès, des niveaux
 * d'accès, les droits de ses fonctions étant communs. Puis son authentification préparée. Un refus nomme l'accès.
 */
function preparedAccess(access: AccessView): PreparedAuth {
  const { view } = access
  const kindProblem = RUN_AUTH_KINDS.includes(String(view.auth?.kind)) ? null : prepareAuth(view)
  const problem =
    modesProblem(view) ?? (typeof kindProblem === "string" ? kindProblem : null) ?? accountProblem(view) ?? holderProblem(view) ?? accountIdentityProblem(view)
  if (problem) throw new CatalogRegistrationError(accessProblem(access, problem) ?? problem)
  const auth = prepareAuth(view)
  if (typeof auth === "string") throw new CatalogRegistrationError(accessProblem(access, auth) ?? auth)
  if (access.name !== null && levelsOf(auth) === null) {
    const levels = `${view.name}: auth ${String(view.auth.kind)} needs access levels (accessLevels): the accesses of a connector share the scopes its functions declare.`
    throw new CatalogRegistrationError(accessProblem(access, levels) ?? levels)
  }
  return auth
}

/** Un accès préparé : sa vue, son authentification, sa sonde et l'identité d'un consentement. */
type PreparedAccess = { access: AccessView; auth: PreparedAuth; probe: PreparedFunction | null; identity: PreparedFunction | null }

/** Le premier problème d'un des accès, nommé ; `null` : aucun. */
function firstAccessProblem(accesses: readonly PreparedAccess[], check: (access: PreparedAccess) => string | null): string | null {
  for (const access of accesses) {
    const problem = accessProblem(access.access, check(access))
    if (problem) return problem
  }
  return null
}

/** Un connecteur contrôlé et préparé, chacun de ses accès compris ; au premier problème, `CatalogRegistrationError`. */
function declared(definition: ConnectorDefinition, reserved: ReadonlySet<string>, seen: Set<string>, given: HostGiven): DeclaredConnector {
  const shape = connectorProblem(definition, reserved, seen) ?? presentationProblem(definition) ?? accessesProblem(definition)
  if (shape) throw new CatalogRegistrationError(shape)
  const views = accessViews(definition)
  const prepared: PreparedAccess[] = views.map((access) => ({ access, auth: preparedAccess(access), probe: null, identity: null }))
  const address = baseAddress(definition)
  if (!address) throw new CatalogRegistrationError(`${definition.name}: needs baseUrl or baseUrls, not both.`)
  const addressFault = baseAddressProblem(definition, address)
  if (addressFault) throw new CatalogRegistrationError(addressFault)
  seen.add(definition.name)
  const functions = definition.functions.map((fn) => {
    const schema = compiledFunction(definition, fn, seen)
    if (typeof schema === "string") throw new CatalogRegistrationError(schema)
    const cursor = cursorArgument(fn)
    const later =
      functionKeysProblem(fn) ??
      firstAccessProblem(prepared, ({ access, auth }) => requestProblem(access.view, fn, auth)) ??
      (typeof cursor === "object" && cursor !== null ? cursor.problem : null) ??
      controlsProblem(fn) ??
      firstAccessProblem(prepared, ({ auth }) => functionScopesProblem(fn, levelsOf(auth))) ??
      functionTimeoutProblem(definition, fn) ??
      backgroundProblem(definition, fn) ??
      costProblem(fn) ??
      asyncProblem(definition, fn) ??
      filesProblem(fn) ??
      fileOutputProblem(definition, fn) ??
      stripProblem(fn)
    if (later) throw new CatalogRegistrationError(later)
    seen.add(fn.name)
    const byAccess = new Map<string | null, PreparedFunction>()
    for (const access of prepared) {
      const { view } = access.access
      const { auth } = access
      const one: PreparedFunction = { connector: view, fn, api: functionApi(view, fn), address, auth, cursorArgument: typeof cursor === "string" ? cursor : null }
      byAccess.set(access.access.name, one)
      if (fn.name === definition.probe?.function) access.probe = one
      if (auth.kind === "user_consent" && "function" in auth.identity && fn.name === auth.identity.function) access.identity = one
    }
    return catalogFunction({ connector: definition, fn, byAccess, schema, refusals: refusalLines(definition, views, fn) })
  })
  const problemOfProbe = probeProblem(definition) ?? firstAccessProblem(prepared, ({ access, auth }) => identityProblem(access.view, auth))
  if (problemOfProbe) throw new CatalogRegistrationError(problemOfProbe)
  const accesses = prepared.map(({ access, auth, probe, identity }): DeclaredAccess => {
    const consent = auth.kind === "user_consent"
    const read = consent && "url" in auth.identity ? identityAddress(access.view, auth, auth.identity.url) : identity
    return {
      name: access.name,
      label: access.label,
      definition: access.view,
      auth,
      probe,
      identity: read,
      application: consent ? given.application : null,
      hostCredentials: given.hostCredentials,
      hostedLinks: given.hostedLinks,
    }
  })
  return { definition, accesses, functions }
}

/** Ce que l'hôte passe à `registerConnectors` en plus de ses définitions. */
export type ConnectorOptions = HostOptions & {
  /**
   * L'application OAuth de chaque connecteur `oauth2_user`, par nom de connecteur : l'identifiant et le secret du client
   * que l'hôte a enregistrés chez le tiers, lus par l'hôte (son environnement, son coffre), jamais par le paquet. Sans
   * elle, la connexion d'un compte et l'appel sont refusés nommément.
   */
  oauthApplications?: Readonly<Record<string, OAuthApplication>>
  /**
   * Les fonctions réservées au serveur de l'hôte, par connecteur : `"all"`, ou les noms servis de certaines
   * (`<connecteur>.<f>`, `<connecteur>_act.<f>`). `callFunction` les court ; l'assistant ne les voit jamais.
   */
  serverOnly?: ServerOnlyOption
  /**
   * Le déclencheur des travaux en tâche de fond (`jobs/trigger.ts`) : `"process"`, un processus à part qui boucle sur
   * `runJobs`. Sans lui, une fonction longue (`background`) est déclarée, et refusée à la mise en file.
   */
  backgroundRunner?: BackgroundRunner
}

/**
 * Déclare les connecteurs décrits de l'hôte, partagés ou propres (`ConnectorDefinition`), à appeler au montage de
 * chaque route qui monte une porte du paquet, comme `registerFunctions`. Toute la liste est contrôlée d'abord : nom du
 * connecteur (celui de `platform.connectors`), espace de noms libre, doublon, libellé, description et domaine (`presentation-declaration.ts`), délai, table d'erreurs (et son
 * signal de refus, `body` et `marksAccount`, comme les refus de chaque fonction), champs
 * du secret et réglages, adresse (fixe, gabarit ou par réglage), authentification (`api_key`, `bearer`, `basic`,
 * `oauth2_client_credentials`, `oauth2_user` et `oauth2_jwt_bearer`, avec `scopes` ou des niveaux d'accès) ; puis chaque fonction : nom,
 * classe, description, schéma strict et compilé (JSON Schema 2020-12), exemples, requête, pagination, contrôles,
 * récapitulatif d'une fonction sensible, droits exigés d'un connecteur à niveaux (accordés par un niveau au moins), délai propre (toute clé inconnue d'une
 * fonction refusée), fonction longue (`background`, comme la règle 21 de la fabrique), coût (`cost`) et travail
 * asynchrone (`async`, sa relève une lecture du connecteur ; `cost-declaration.ts`), fichiers envoyés (`request.files`)
 * et sortie (`output`, toute clé inconnue refusée ; son fichier, `output.file`, `file-output.ts` ; ses chemins `strip`,
 * comme la règle 18 de la fabrique) ; enfin la sonde et
 * l'identité d'un consentement (une fonction, ou une adresse complète). Un connecteur à plusieurs accès (`accesses`,
 * `accesses.ts`) : chaque accès contrôlé comme un connecteur à un seul, son refus nommé, ses fonctions préparées pour
 * chacun et servies une fois. `options.oauthApplications` : l'application OAuth de chaque
 * connecteur `oauth2_user` ; `options.hostCredentials` : le lecteur des champs `holder: host` ; `options.hostedLinks` :
 * le port du branchement hébergé d'un connecteur à `accountIdentity` ; `options.serverOnly` : les fonctions réservées au
 * serveur de l'hôte (`server-only.ts`) ; `options.backgroundRunner` : le déclencheur des travaux en tâche de fond ; tous
 * fournis par l'hôte. Au premier refus, `CatalogRegistrationError` et rien n'est déclaré ;
 * sinon la liste remplace toute la déclaration précédente (un rechargement à chaud ne double rien).
 */
export function registerConnectors(definitions: readonly ConnectorDefinition[], options: ConnectorOptions = {}): void {
  const current = new Set(declaredConnectors().flatMap((connector) => connector.functions))
  const others = catalogFunctions().filter((fn) => !current.has(fn))
  // Le connecteur des consentements à l'API d'un hôte n'est jamais déclaré : son nom est pris.
  const reserved = new Set([...[...others.map((fn) => fn.name), ...contractNames()].map(namespaceOf), HOST_CONSENT_CONNECTOR])
  const seen = new Set<string>()
  const applications = checkedApplications(definitions, options.oauthApplications)
  const runnerProblem = backgroundRunnerProblem(options.backgroundRunner)
  if (runnerProblem) throw new CatalogRegistrationError(runnerProblem)
  const { readers, ports } = checkedHostGifts(definitions, options)
  const gift = (name: string): HostGiven => ({ application: applications.get(name) ?? null, hostCredentials: readers.get(name) ?? null, hostedLinks: ports.get(name) ?? null })
  const connectors = definitions.map((definition) => declared(definition, reserved, seen, gift(definition.name)))
  declareBackgroundRunner(options.backgroundRunner)
  replaceDeclaredConnectors(withServerOnly(connectors, options.serverOnly))
}

/**
 * Tient la liste `platform.connectors` depuis la déclaration : le nom d'un connecteur déclaré et son libellé s'y
 * ajoutent avant la première ligne qui le cite (activation, compte), dans la transaction de cette écriture, qui court
 * sous le rôle du serveur (`declare_connector` lui est réservée : le libellé est celui que déclare l'hôte) ; un nom
 * présent ne change pas, et rien n'est jamais retiré. Un connecteur non déclaré (`mail`, natif) n'écrit rien.
 */
export async function keepDeclaredConnector(sql: Tx, name: string): Promise<void> {
  const connector = declaredConnector(name)
  if (!connector) return
  await sql`select platform.declare_connector(${name}, ${connector.definition.label})`
}
