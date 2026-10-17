// Les réglages d'un compte et les adresses qui les citent (`connecteurs-et-comptes.md` § Comptes à plusieurs champs et
// réglages) : contrôle d'un réglage et d'un gabarit à la déclaration, d'une valeur à la saisie, puis résolution de
// l'adresse à chaque appel. Sans ce module, une adresse saisie (le serveur d'un standard, le sous-domaine d'un tenant,
// une région) ne se dirait pas, et une valeur libre se glisserait dans une adresse sans garde. Une adresse libre
// (réglage `url`, ou `text` dans un gabarit) est en plus gardée à chaque appel par `address-guard.ts`. L'identité d'un
// compte rattaché (`accountIdentity`) se cite comme un réglage, dans l'adresse de base seulement, après l'hôte.
import { isIP } from "node:net"
import { PlatformError } from "../errors"
import type { ConnectorDefinition, ConnectorSetting, ConnectorUrlsBySetting } from "./definition"
import { isPublicAddress } from "./address-guard"

/** Ce qu'une valeur `text` ou `choice` peut porter pour entrer dans une adresse : lettres, chiffres, `-` et `_`. */
const SUBSTITUTABLE = /^[A-Za-z0-9_-]+$/
const SETTING_NAME = /^[a-z][a-z0-9_]{0,39}$/
const PLACEHOLDER = /\{([^{}]*)\}/g
/** Au plus, en caractères, une valeur de réglage : une adresse tient largement. */
export const SETTING_VALUE_MAX = 2000

/** Les réglages d'un compte, par nom, en clair. */
export type AccountSettings = Readonly<Record<string, string>>

/** Une adresse déclarée : un gabarit (adresse fixe comprise) ou une adresse par valeur d'un réglage `choice`. */
export type AddressSpec = { template: string } | { bySetting: ConnectorUrlsBySetting }

/** Une adresse résolue ; `guarded` : son hôte vient d'une saisie (réglage `url` ou `text`), gardé à chaque appel. */
export type ResolvedAddress = { url: string; guarded: boolean }

/** Une adresse `https://` sans `/` final, sans identifiants, sans query ni fragment ; `null` : bien formée. */
export function httpsAddressProblem(value: string): string | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return "is not an address"
  }
  if (url.protocol !== "https:") return "must start with https://"
  if (url.username || url.password || url.search || url.hash || value.endsWith("/")) return "must have no credentials, query, fragment nor trailing slash"
  const host = url.hostname.replace(/^\[|\]$/g, "")
  if (isIP(host) && !isPublicAddress(host)) return "must not be a private, loopback, link-local or metadata address"
  return null
}

/** Le problème d'un réglage déclaré ; `null` : aucun. */
export function settingProblem(connector: string, setting: ConnectorSetting): string | null {
  const head = `${connector}: setting ${JSON.stringify(String(setting?.name))}`
  if (typeof setting?.name !== "string" || !SETTING_NAME.test(setting.name)) return `${head} needs a name in lowercase ASCII letters, digits and _.`
  if (typeof setting.label !== "string" || !setting.label.trim() || setting.label.length > 80) return `${head} needs a label of 1 to 80 characters.`
  if (setting.type === "url") return null
  if (setting.type === "choice") {
    const { choices } = setting
    if (!Array.isArray(choices) || choices.length < 2 || new Set(choices).size !== choices.length || !choices.every((choice) => typeof choice === "string" && SUBSTITUTABLE.test(choice))) {
      return `${head}: choices must list at least two distinct values of letters, digits, - and _.`
    }
    if (setting.default !== undefined && !choices.includes(setting.default)) return `${head}: default must be one of its choices.`
    return null
  }
  if (setting.type === "text") {
    if (typeof setting.pattern !== "string" || !setting.pattern.startsWith("^") || !setting.pattern.endsWith("$")) return `${head}: pattern must be anchored (^…$).`
    try {
      new RegExp(setting.pattern)
    } catch {
      return `${head}: pattern is not a valid regular expression.`
    }
    return null
  }
  return `${head}: type must be choice, text or url.`
}

/** L'hôte d'une adresse d'essai, `null` si elle ne se lit pas. */
function hostOf(address: string): string | null {
  try {
    return new URL(address).host
  } catch {
    return null
  }
}

/**
 * Le problème d'une adresse où l'identité du compte (`{identity}`) remplace l'une ou l'autre valeur d'essai : elle ne se
 * cite qu'après l'hôte, qui ne doit pas changer avec elle ; `null` : aucun.
 */
function identityPlaceProblem(where: string, sampleWith: (value: string) => string, identity: string): string | null {
  const [left, right] = [hostOf(sampleWith("x")), hostOf(sampleWith("y"))]
  return left !== null && left === right ? null : `${where}: the account identity {${identity}} may only follow the host.`
}

/**
 * Le problème d'une adresse déclarée (`baseUrl`, `tokenUrl`, ou leur forme par réglage) ; `null` : aucun. Un réglage
 * `url` ne se cite qu'en tête, à la place du schéma et de l'hôte ; un autre réglage, qu'après `https://`. `identity` :
 * le nom de l'identité d'un compte rattaché, que l'adresse de base seule peut citer, après l'hôte.
 */
export function addressProblem(where: string, spec: AddressSpec, settings: readonly ConnectorSetting[], identity?: string): string | null {
  const byName = new Map(settings.map((setting) => [setting.name, setting]))
  if ("bySetting" in spec) {
    const setting = byName.get(spec.bySetting.setting)
    if (setting?.type !== "choice") return `${where} must name a choice setting.`
    const values = spec.bySetting.values ?? {}
    const keys = Object.keys(values).sort()
    if (keys.join(",") !== [...setting.choices].sort().join(",")) return `${where} must give one address to each choice of ${setting.name}.`
    for (const value of Object.values(values)) {
      const named = typeof value === "string" ? [...value.matchAll(PLACEHOLDER)].map((match) => match[1]) : []
      const other = named.find((name) => name !== identity)
      if (other !== undefined) return `${where} cites {${other}}, which only the account identity may be in an address by setting.`
      const sampleWith = (sample: string) => String(value).replace(PLACEHOLDER, sample)
      if (typeof value !== "string" || httpsAddressProblem(sampleWith("x")) !== null) {
        return `${where}: ${JSON.stringify(String(value))} must be an https:// address without a trailing slash.`
      }
      const misplaced = named.length > 0 && identity !== undefined ? identityPlaceProblem(where, sampleWith, identity) : null
      if (misplaced) return misplaced
    }
    return null
  }
  const { template } = spec
  if (typeof template !== "string") return `${where} must be an https:// address.`
  const names = [...template.matchAll(PLACEHOLDER)].map((match) => match[1])
  const unknown = names.find((name) => !byName.has(name) && name !== identity)
  if (unknown !== undefined) return `${where} cites {${unknown}}, which is not a setting.`
  const fromSettings = names.filter((name) => name !== identity)
  const url = fromSettings.find((name) => byName.get(name)?.type === "url")
  if (url !== undefined && (!template.startsWith(`{${url}}`) || fromSettings.length > 1)) return `${where}: url setting {${url}} must open the address, alone.`
  if (url === undefined && !template.startsWith("https://")) return `${where} must start with https:// or with a url setting.`
  if (template.endsWith("/")) return `${where} must have no trailing slash.`
  // Valeurs d'essai, au motif de chaque réglage : la forme de l'adresse se contrôle comme une adresse fixe.
  const sampleWith = (forIdentity: string) =>
    template.replace(PLACEHOLDER, (_whole, name: string) => (name === identity ? forIdentity : byName.get(name)?.type === "url" ? "https://example.com" : "x"))
  if (httpsAddressProblem(sampleWith("x")) !== null) return `${where} must be an https:// address without a trailing slash.`
  return identity !== undefined && names.includes(identity) ? identityPlaceProblem(where, sampleWith, identity) : null
}

/** Vrai si l'adresse déclarée cite l'identité `name` (dans chaque adresse, pour une adresse par réglage). */
export function citesIdentity(spec: AddressSpec, name: string): boolean {
  const cites = (address: string) => [...address.matchAll(PLACEHOLDER)].some((match) => match[1] === name)
  return "bySetting" in spec ? Object.values(spec.bySetting.values).every(cites) : cites(spec.template)
}

/** Le problème d'une valeur saisie pour un réglage ; `null` : aucun. */
export function settingValueProblem(setting: ConnectorSetting, value: string): string | null {
  if (value.length > SETTING_VALUE_MAX) return `is longer than ${SETTING_VALUE_MAX} characters`
  if (setting.type === "url") return httpsAddressProblem(value)
  if (!SUBSTITUTABLE.test(value)) return "may only hold letters, digits, - and _"
  if (setting.type === "choice") return setting.choices.includes(value) ? null : `must be one of ${setting.choices.join(", ")}`
  if (setting.type === "text") return new RegExp(setting.pattern).test(value) ? null : `must match ${setting.pattern}`
  return "is not a known kind of setting"
}

/**
 * Les réglages d'un compte tels que l'appel les lit : chaque réglage déclaré, sa valeur gardée ou son défaut. Rend le
 * premier réglage manquant ou devenu invalide (la déclaration a pu changer depuis la saisie), avec la raison.
 */
export function accountSettings(definition: ConnectorDefinition, stored: AccountSettings): { settings: AccountSettings } | { problem: { label: string; reason: string } } {
  const settings: Record<string, string> = {}
  for (const setting of definition.settings ?? []) {
    const value = Object.hasOwn(stored, setting.name) ? stored[setting.name] : setting.type === "choice" ? setting.default : undefined
    if (value === undefined) return { problem: { label: setting.label, reason: "is not set" } }
    const problem = settingValueProblem(setting, value)
    if (problem !== null) return { problem: { label: setting.label, reason: problem } }
    settings[setting.name] = value
  }
  return { settings }
}

/** L'adresse déclarée d'un connecteur : `baseUrl` ou `baseUrls`. */
export function baseAddress(definition: ConnectorDefinition): AddressSpec | null {
  if (definition.baseUrls !== undefined) return definition.baseUrl === undefined ? { bySetting: definition.baseUrls } : null
  return typeof definition.baseUrl === "string" ? { template: definition.baseUrl } : null
}

/** L'identité d'un compte rattaché, telle que l'adresse de base la cite : son nom et la valeur du compte (`linked_id`). */
export type AddressIdentity = { name: string; value: string }

/** La valeur de l'identité, encodée ; absente alors que l'adresse la cite : le compte n'a pas été ouvert pour elle. */
function identityValue(name: string, identity: AddressIdentity | undefined): string {
  if (identity?.name === name) return encodeURIComponent(identity.value)
  console.error(`[platform] connector address cites {${name}} without the account identity`)
  throw new PlatformError("internal", "Internal error.")
}

/**
 * L'adresse résolue sur les réglages du compte (déjà contrôlés par `accountSettings`) et sur l'identité d'un compte
 * rattaché (déjà contrôlée contre son motif). Gardée (`guarded`) dès qu'un réglage `url` ou `text` y entre : son hôte
 * vient d'une saisie ; l'identité, citée après l'hôte, ne le change pas.
 */
export function resolveAddress(spec: AddressSpec, settings: AccountSettings, declared: readonly ConnectorSetting[], identity?: AddressIdentity): ResolvedAddress {
  if ("bySetting" in spec) {
    const url = spec.bySetting.values[settings[spec.bySetting.setting]].replace(PLACEHOLDER, (_whole, name: string) => identityValue(name, identity))
    return { url, guarded: false }
  }
  let guarded = false
  const url = spec.template.replace(PLACEHOLDER, (_whole, name: string) => {
    const type = declared.find((setting) => setting.name === name)?.type
    // Un nom qui n'est pas un réglage est l'identité du compte (la déclaration n'en admet pas d'autre).
    if (type === undefined) return identityValue(name, identity)
    if (type !== "choice") guarded = true
    return settings[name]
  })
  return { url, guarded }
}
