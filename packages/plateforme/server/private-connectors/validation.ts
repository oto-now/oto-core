// La validation d'une définition de connecteur privé à l'écriture (`connecteurs-prives.md` § Validation) : trois
// contrôles, dont tous les problèmes se rendent d'un coup. 1. Le profil Custom API de la lib (`validate`), qui borne
// aussi la définition à 100 fonctions et 256 Ko. 2. Sa projection (`toDefinition`), puis le contrôle de déclaration
// d'oto-core sur elle seule (`declarationProblem`). 3. Ce qu'oto exige en plus : l'espace servi est le nom, il n'est pas
// déjà servi par l'instance, l'authentification est de la V1, et chaque adresse passe la garde par sa résolution. Sans
// ce module, une définition s'enregistrerait sans que rien ne dise qu'elle se déclarerait ni où elle enverrait.
import { NotGenerated, toDefinition, validate, type Problem } from "@otomata_tech/connectors/custom-api"
import { resolutionFault, type ResolutionFault } from "../connectors/address-guard"
import { declarationProblem } from "../connectors/declaration-check"
import type { ConnectorDefinition } from "../connectors/definition"
import { schemaCompiler } from "../host-api/document"
import { isJsonObject } from "../json"

/** Un problème d'une définition : son code (`custom_api_*` du profil, `private_connector_*` d'oto), sa place, son message. */
export type PrivateConnectorProblem = { code: string; path: string; message: string; rule?: string }

/** Les authentifications d'un connecteur privé en V1 : `oauth2_user`, que le profil admet, attend l'application OAuth d'une organisation. */
export const PRIVATE_AUTH_KINDS = ["none", "api_key", "bearer", "basic", "oauth2_client_credentials"]

const RESOLUTION_MESSAGES: Record<ResolutionFault, string> = {
  internal: "the address resolves to a private, loopback, link-local or reserved address: only public hosts are reached",
  unresolved: "the address does not resolve: a definition names a host on the public internet",
}

const problem = (code: string, path: string, message: string): PrivateConnectorProblem => ({ code, path, message })

/** Les adresses fixes d'une définition, avec leur place : l'API, le jeton, l'autorisation et l'identité. */
function addressesOf(connector: Record<string, unknown>): [string, string][] {
  const auth = isJsonObject(connector.auth) ? connector.auth : {}
  const identity = isJsonObject(auth.identity) ? auth.identity : {}
  const found: [string, unknown][] = [
    ["connector.base_url", connector.base_url],
    ["connector.auth.token_url", auth.token_url],
    ["connector.auth.authorize_url", auth.authorize_url],
    ["connector.auth.identity.url", identity.url],
  ]
  return found.filter((entry): entry is [string, string] => typeof entry[1] === "string")
}

/** Une adresse que la résolution doit juger : `https` et lisible ; le profil nomme déjà les autres. */
function resolvable(url: string): boolean {
  try {
    return new URL(url).protocol === "https:"
  } catch {
    return false
  }
}

/** 2. La projection de la définition, puis le contrôle de déclaration d'oto-core sur elle seule. */
function declarationProblems(document: unknown): PrivateConnectorProblem[] {
  let definition: ConnectorDefinition
  try {
    definition = toDefinition(document) as unknown as ConnectorDefinition
  } catch (error) {
    if (error instanceof NotGenerated) return [problem("private_connector_not_generated", "functions", error.message)]
    throw error
  }
  // Les espaces réservés sont le 3e contrôle, qui nomme sa place : la déclaration ne juge ici que la définition.
  const found = declarationProblem(definition, new Set())
  return found ? [problem("private_connector_declaration", "", found)] : []
}

/** 3. Ce qu'oto exige en plus du profil, sur ce qui se lit de la définition, même refusée par ailleurs. */
async function otoProblems(document: unknown, reserved: ReadonlySet<string>, named: ReadonlySet<string>): Promise<PrivateConnectorProblem[]> {
  if (!isJsonObject(document) || !isJsonObject(document.connector)) return []
  const { connector } = document
  const out: PrivateConnectorProblem[] = []
  const { name, namespace } = connector
  if (typeof name === "string" && typeof namespace === "string" && namespace !== name) {
    out.push(problem("private_connector_namespace_mismatch", "connector.namespace", `the namespace must be the name (${name}): oto serves the functions under the name`))
  }
  if (typeof name === "string" && (reserved.has(name) || reserved.has(`${name}_act`))) {
    out.push(problem("private_connector_namespace_taken", "connector.name", `${name} is already served by this instance: choose another name`))
  }
  const kind = isJsonObject(connector.auth) ? connector.auth.kind : undefined
  if (typeof kind === "string" && !PRIVATE_AUTH_KINDS.includes(kind) && !named.has("connector.auth.kind")) {
    out.push(problem("private_connector_auth_not_supported", "connector.auth.kind", `${kind} is not available to a private connector yet (${PRIVATE_AUTH_KINDS.join(", ")})`))
  }
  const judged = addressesOf(connector).filter(([path, url]) => !named.has(path) && resolvable(url))
  const faults = await Promise.all(judged.map(([, url]) => resolutionFault(url)))
  judged.forEach(([path], i) => {
    const fault = faults[i]
    if (fault) out.push(problem(`private_connector_address_${fault}`, path, RESOLUTION_MESSAGES[fault]))
  })
  return out
}

/**
 * Tous les problèmes d'une définition de connecteur privé, dans l'ordre des trois contrôles ; `[]` : elle peut
 * s'enregistrer. `reserved` : les espaces de noms que l'instance sert déjà. La déclaration ne se juge que sur une
 * définition que le profil accepte ; les contrôles d'oto, sur tout ce qui s'en lit, sauf une place que le profil a déjà
 * nommée.
 */
export async function privateConnectorProblems(document: unknown, reserved: ReadonlySet<string>): Promise<PrivateConnectorProblem[]> {
  const profile: PrivateConnectorProblem[] = validate(document, schemaCompiler()).map(({ code, path, message, rule }: Problem) =>
    rule === undefined ? { code, path, message } : { code, path, message, rule },
  )
  const declaration = profile.length === 0 ? declarationProblems(document) : []
  const oto = await otoProblems(document, reserved, new Set(profile.map((item) => item.path)))
  return [...profile, ...declaration, ...oto]
}
