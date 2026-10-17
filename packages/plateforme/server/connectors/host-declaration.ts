// Ce que le compte de l'hôte et le compte rattaché ajoutent à la déclaration des connecteurs (`connecteurs-et-comptes.md`
// § Compte de l'hôte et compte rattaché) : le titulaire d'un champ (`holder`), l'identité d'un compte rattaché
// (`accountIdentity`) et sa place dans l'adresse de base, `act` de chaque fonction, et ce que l'hôte passe à
// `registerConnectors` pour eux (le lecteur de ses champs, le port du branchement). Lu par `declaration.ts` seule :
// module à part pour garder la déclaration à sa taille ; il n'en importe rien.
import { CatalogRegistrationError } from "../catalog/erp"
import { isJsonObject } from "../json"
import type { ConnectorDefinition, ConnectorFunctionDefinition, HostCredentialReader, HostedLinkProvider, OAuthApplication } from "./definition"
import { addressProblem, citesIdentity, type AddressSpec } from "./settings"

const HOLDERS = ["account", "host"]
/** Le motif d'un nom de champ, de réglage ou d'identité. */
export const FIELD_NAME = /^[a-z][a-z0-9_]{0,39}$/
/** Comme le libellé d'un connecteur. */
const IDENTITY_LABEL_MAX = 80

/** Le premier champ du credential (déjà contrôlé) dont le titulaire n'est ni `account` ni `host` ; `null` : aucun. */
export function holderProblem(definition: ConnectorDefinition): string | null {
  const bad = definition.credential.find((field) => field.holder !== undefined && !HOLDERS.includes(field.holder))
  return bad ? `${definition.name}: credential field ${bad.name} has holder ${JSON.stringify(String(bad.holder))}: account or host.` : null
}

/**
 * L'identité d'un compte rattaché (`accountIdentity`) : refusée avec `oauth2_user` ; un nom de champ, un libellé, un
 * motif ancré qui se compile. `null` : aucun problème, ou aucune identité.
 */
export function accountIdentityProblem(definition: ConnectorDefinition): string | null {
  const identity = definition.accountIdentity
  if (identity === undefined) return null
  const head = `${definition.name}: accountIdentity`
  if (definition.auth?.kind === "oauth2_user") return `${head} does not go with oauth2_user: a consent's account is the person's own.`
  if (!isJsonObject(identity) || typeof identity.name !== "string" || !FIELD_NAME.test(identity.name)) return `${head} needs a name in lowercase ASCII letters, digits and _.`
  if (typeof identity.label !== "string" || !identity.label.trim() || identity.label.length > IDENTITY_LABEL_MAX) return `${head} needs a label of 1 to ${IDENTITY_LABEL_MAX} characters.`
  if (typeof identity.pattern !== "string" || !identity.pattern.startsWith("^") || !identity.pattern.endsWith("$")) return `${head}: pattern must be anchored (^…$).`
  try {
    new RegExp(identity.pattern)
  } catch {
    return `${head}: pattern is not a valid regular expression.`
  }
  return null
}

/** L'adresse de base contrôlée, l'identité admise après l'hôte et exigée quand le connecteur en déclare une. */
export function baseAddressProblem(definition: ConnectorDefinition, address: AddressSpec): string | null {
  const identity = definition.accountIdentity?.name
  const fault = addressProblem(`${definition.name}: baseUrl`, address, definition.settings ?? [], identity)
  if (fault) return fault
  return identity !== undefined && !citesIdentity(address, identity) ? `${definition.name}: baseUrl must cite the account identity {${identity}}, after the host.` : null
}

/**
 * `act` d'une fonction (booléen ; jamais vrai pour `read`, toujours pour `sensitive`) et l'identité du compte, qu'aucun
 * argument ne porte. `null` : aucun problème.
 */
export function functionHostProblem(definition: ConnectorDefinition, fn: ConnectorFunctionDefinition): string | null {
  if (typeof fn.act !== "boolean") return `${fn.name}: act must be true (the function engages or destroys) or false.`
  if (fn.act && fn.class === "read") return `${fn.name}: a read function never engages: act must be false.`
  if (!fn.act && fn.class === "sensitive") return `${fn.name}: a sensitive function engages: act must be true.`
  const identity = definition.accountIdentity?.name
  if (identity !== undefined && isJsonObject(fn.schema.properties) && Object.hasOwn(fn.schema.properties, identity)) {
    return `${fn.name}: no argument may carry the account identity ${identity}: it comes from the account, never from the agent.`
  }
  return null
}

/** Ce que l'hôte passe à `registerConnectors` pour ses champs et ses comptes rattachés. */
export type HostOptions = {
  /**
   * Le lecteur des champs `holder: host` de chaque connecteur qui en déclare, par nom de connecteur : appelé à chaque
   * appel, jamais gardé par le paquet. Sans lui, l'appel et le branchement d'un compte sont refusés nommément.
   */
  hostCredentials?: Readonly<Record<string, HostCredentialReader>>
  /**
   * Le port du branchement hébergé de chaque connecteur à `accountIdentity`, par nom de connecteur, construit par l'hôte
   * avec sa clé. Sans lui, « Connecter mon compte » est refusé nommément.
   */
  hostedLinks?: Readonly<Record<string, HostedLinkProvider>>
}

/** Ce que l'hôte fournit à un connecteur : son application OAuth, le lecteur de ses champs, le port de son branchement. */
export type HostGiven = { application: OAuthApplication | null; hostCredentials: HostCredentialReader | null; hostedLinks: HostedLinkProvider | null }

/**
 * Les lecteurs des champs de l'hôte et les ports du branchement hébergé, contrôlés : chacun d'un connecteur déclaré qui
 * déclare un champ `holder: host` (un lecteur, une fonction) ou une `accountIdentity` (un port, ses trois méthodes).
 */
export function checkedHostGifts(definitions: readonly ConnectorDefinition[], options: HostOptions): { readers: Map<string, HostCredentialReader>; ports: Map<string, HostedLinkProvider> } {
  const readers = new Map<string, HostCredentialReader>()
  for (const [name, reader] of Object.entries(options.hostCredentials ?? {})) {
    const definition = definitions.find((candidate) => candidate.name === name)
    if (!definition?.credential?.some((field) => field.holder === "host")) throw new CatalogRegistrationError(`Host credentials for ${name}: no connector of this name with a host field is declared.`)
    if (typeof reader !== "function") throw new CatalogRegistrationError(`Host credentials for ${name} must be a function that returns the host fields.`)
    readers.set(name, reader)
  }
  const ports = new Map<string, HostedLinkProvider>()
  for (const [name, port] of Object.entries(options.hostedLinks ?? {})) {
    const definition = definitions.find((candidate) => candidate.name === name)
    if (definition?.accountIdentity === undefined) throw new CatalogRegistrationError(`Hosted links for ${name}: no connector of this name with an accountIdentity is declared.`)
    const methods = ["createLink", "listAccounts", "probe"] as const
    if (typeof port !== "object" || port === null || methods.some((method) => typeof port[method] !== "function")) {
      throw new CatalogRegistrationError(`Hosted links for ${name} need createLink, listAccounts and probe.`)
    }
    ports.set(name, port)
  }
  return { readers, ports }
}
