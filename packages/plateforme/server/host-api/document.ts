// Le document OpenAPI de l'API d'un hôte (`fonctions-d-un-hote.md` § Source par organisation) : lu à
// `<adresse>/openapi.json`, sans authentification, en `https`, sans redirection, 5 Mo au plus, par le transport gardé
// (`address-guard.ts` : IP publiques seules) ; jugé par le profil hôte de la lib de connecteurs (`fromHostOpenApi`), puis
// par ce qu'oto exige en plus : l'émetteur de l'API est celui de l'instance, chaque schéma d'entrée se compile. Sans ce
// module, le catalogue d'une organisation ne saurait rien de l'API de son hôte.
import { fromHostOpenApi, toDefinition, type SchemaCompiler, type SchemaIssue } from "@otomata_tech/connectors/custom-api"
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020"
import { readBounded } from "../bounded-read"
import { JsonSchemaArguments, PERSONAL_KEYWORD } from "../catalog/arguments"
import { guardedFetch } from "../connectors/address-guard"
import type { ConnectorDefinition } from "../connectors/definition"
import type { Fetch } from "../connectors/http"
import { PlatformError } from "../errors"
import { issuerProblem } from "./exchange"

/** Au plus, en octets, le document d'un hôte. */
export const HOST_DOCUMENT_MAX_BYTES = 5 * 1024 * 1024
/** Le chemin du document sous l'adresse de l'hôte. */
export const HOST_DOCUMENT_PATH = "/openapi.json"
/** Délai de la lecture du document, corps compris. */
const DOCUMENT_TIMEOUT_MS = 10_000
/** Au plus, en caractères, un `ETag` gardé (la colonne `host_apis.etag`). */
const ETAG_MAX = 500

/** Un problème du document : son code (`host_*`, `openapi_*`), sa place dans le document et son message. */
export type HostDocumentProblem = { code: string; path: string; message: string }

/** La lecture du document : inchangé depuis l'`ETag` donné, lu, ou refusé avec ses problèmes. */
export type DocumentReading =
  | { kind: "not_modified" }
  | { kind: "document"; document: unknown; etag: string | null }
  | { kind: "refused"; problems: HostDocumentProblem[] }

const refused = (code: string, message: string): DocumentReading => ({ kind: "refused", problems: [{ code, path: "", message }] })

/**
 * Lit le document de l'hôte à `address` (déjà contrôlée par `httpsAddressProblem`). `etag` : celui du document servi,
 * envoyé en `If-None-Match` quand l'adresse n'a pas changé. Chaque échec de lecture est un refus nommé, jamais une
 * exception : un document injoignable laisse la version précédente servie, et le refus se lit à l'administration.
 */
export async function readHostDocument(address: string, etag: string | null): Promise<DocumentReading> {
  // `guardedFetch` lu à l'appel : un test le remplace par son serveur local.
  const fetcher: Fetch = guardedFetch()
  const signal = AbortSignal.timeout(DOCUMENT_TIMEOUT_MS)
  let answer: Response
  try {
    answer = await fetcher(`${address}${HOST_DOCUMENT_PATH}`, {
      method: "GET",
      headers: { accept: "application/json", ...(etag ? { "if-none-match": etag } : {}) },
      redirect: "error",
      signal,
    })
  } catch (error) {
    if (error instanceof PlatformError) return refused("host_address_refused", `the address is refused: ${error.message}`)
    return refused("host_document_unreachable", `the document could not be read (${error instanceof Error ? error.name : "error"})`)
  }
  if (answer.status === 304 && etag) {
    await answer.body?.cancel()
    return { kind: "not_modified" }
  }
  if (answer.status !== 200) {
    await answer.body?.cancel()
    const redirect = answer.status >= 300 && answer.status < 400 ? ": redirections are not followed" : ""
    return refused("host_document_status", `the document answered HTTP ${answer.status}${redirect}`)
  }
  let bytes: Uint8Array | null
  try {
    bytes = answer.body ? await readBounded(answer.body, HOST_DOCUMENT_MAX_BYTES, () => null) : new Uint8Array()
  } catch (error) {
    return refused("host_document_unreachable", `the document could not be read (${error instanceof Error ? error.name : "error"})`)
  }
  if (bytes === null) return refused("host_document_too_large", `the document is larger than ${HOST_DOCUMENT_MAX_BYTES / 1024 / 1024} MB`)
  let document: unknown
  try {
    document = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return refused("host_document_not_json", "the document is not JSON")
  }
  const tag = answer.headers.get("etag")
  return { kind: "document", document, etag: tag && tag.length <= ETAG_MAX ? tag : null }
}

/**
 * Ce qu'oto garde d'un document accepté : son titre et sa version, l'API à l'émetteur, le scope de chaque fonction, ses
 * connecteurs, compilés.
 */
export type ImportedHost = {
  /** `info.title`, le nom de l'API dans les messages et sur le compte d'un consentement. */
  title: string
  version: string
  issuer: string
  resource: string
  /** Le scope OAuth demandé pour le jeton de chaque fonction (celui de sa famille), par nom de fonction. */
  scopes: ReadonlyMap<string, string>
  /**
   * Les scopes des fonctions, sans doublon, dans l'ordre du document : ce qu'une personne consent en une fois ; une
   * famille sans fonction n'y ajoute rien.
   */
  consentScopes: string[]
  /** Un connecteur par espace de noms, dans la forme que le moteur court, et le schéma compilé de chaque fonction. */
  connectors: { definition: ConnectorDefinition; schemas: ReadonlyMap<string, JsonSchemaArguments> }[]
}

/**
 * Un validateur JSON Schema 2020-12 neuf : un par import, que le ramasse-miettes reprend avec le document. Comme celui
 * des arguments (`catalog/arguments.ts`), `format` reste une annotation et `personal` un mot connu ; `strict` suit le
 * cas : relâché pour juger les documents du format, tenu pour les arguments servis.
 */
function validator(strict: boolean): Ajv2020 {
  const ajv = new Ajv2020({ allErrors: true, strict, strictRequired: false, validateFormats: false, allowUnionTypes: true })
  ajv.addKeyword({ keyword: PERSONAL_KEYWORD, schemaType: "boolean" })
  return ajv
}

/** Le validateur que le profil reçoit : chaque schéma compilé une fois par import. */
function schemaCompiler(): SchemaCompiler {
  const ajv = validator(false)
  const compiled = new WeakMap<object, ValidateFunction>()
  return (schema) => {
    const key = schema as object
    const validate = compiled.get(key) ?? ajv.compile(schema as object)
    compiled.set(key, validate)
    return (value) => (validate(value) ? [] : ((validate.errors ?? []) as readonly SchemaIssue[]))
  }
}

/**
 * Juge un document par le profil hôte, puis ce qu'oto exige en plus. `reserved` : les espaces de noms que l'instance sert
 * déjà. Rend le document importé, ou ses problèmes (au moins un).
 */
export function importHostDocument(document: unknown, reserved: Iterable<string>): { imported: ImportedHost } | { problems: HostDocumentProblem[] } {
  let result: ReturnType<typeof fromHostOpenApi>
  try {
    result = fromHostOpenApi(document, { compile: schemaCompiler(), reserved })
  } catch (error) {
    // Un document qui fait échouer le profil lui-même est refusé comme un autre, la panne nommée au log.
    console.error(`[platform] host api: the host profile failed on a document (${error instanceof Error ? error.name : "error"})`)
    return { problems: [{ code: "host_document_unreadable", path: "", message: "the document could not be judged by the host profile" }] }
  }
  if (!result.definition) return { problems: result.problems.map(({ code, path, message }) => ({ code, path, message })) }
  const root = (document as { "x-oto": { issuer: string; resource: string } })["x-oto"]
  const issuer = issuerProblem(root.issuer)
  if (issuer) return { problems: [{ code: "host_issuer_not_instance", path: "x-oto.issuer", message: issuer }] }
  const info = (document as { info: { title: unknown; version: unknown } }).info
  const strict = validator(true)
  const scoped = scopesOf(result.definition.functions as Record<string, { family: string; scope: string | null }>)
  if ("problems" in scoped) return scoped
  const problems: HostDocumentProblem[] = []
  const connectors: ImportedHost["connectors"] = []
  for (const doc of result.definition.connectors as unknown[]) {
    const definition = toDefinition(doc) as unknown as ConnectorDefinition
    const schemas = new Map<string, JsonSchemaArguments>()
    for (const fn of definition.functions) {
      try {
        schemas.set(fn.name, new JsonSchemaArguments(fn.schema, strict.compile(fn.schema)))
      } catch (error) {
        problems.push({ code: "host_schema_invalid", path: fn.name, message: `the input schema does not compile (${error instanceof Error ? error.message : "error"})` })
      }
    }
    connectors.push({ definition, schemas })
  }
  if (problems.length > 0) return { problems }
  return {
    imported: { title: String(info.title).trim(), version: String(info.version), issuer: root.issuer, resource: root.resource, ...scoped, connectors },
  }
}

/**
 * Le scope de chaque fonction, celui de sa famille (`x-oto.families.<clé>.scope`), et l'union de ces scopes. Le profil
 * hôte admet une famille écrite par son seul libellé, sans scope : oto refuse à l'import chacune de ses fonctions, nommée,
 * parce que le jeton d'une fonction se demande à son scope et qu'aucun ne se devine. À l'import et non à l'appel :
 * l'administration lit le refus au rafraîchissement, et la version précédente reste servie.
 */
function scopesOf(functions: Record<string, { family: string; scope: string | null }>): Pick<ImportedHost, "scopes" | "consentScopes"> | { problems: HostDocumentProblem[] } {
  const entries = Object.entries(functions)
  const missing = entries.filter(([, meta]) => meta.scope === null)
  if (missing.length > 0) {
    return {
      problems: missing.map(([name, meta]) => ({
        code: "host_scope_missing",
        path: `x-oto.families.${meta.family}`,
        message: `${name}: its family ${meta.family} has no OAuth scope; write it as {label, scope}`,
      })),
    }
  }
  const scopes = new Map(entries.map(([name, meta]) => [name, meta.scope as string]))
  return { scopes, consentScopes: [...new Set([...scopes.values()].flatMap((scope) => scope.split(" ")))] }
}
