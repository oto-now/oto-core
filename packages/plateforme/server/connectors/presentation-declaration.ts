// Ce que l'assistant et l'écran Connecteurs montrent d'un outil, au-delà de son libellé : sa description, écrite pour
// l'assistant, son logo, et son domaine, d'où l'écran tire son logo à défaut (`connector.description` et
// `connector.logo_domain` du format de `connectors`). Contrôlés à la déclaration (`registerConnectors`) : sans ce module,
// une description vide ou démesurée serait servie telle quelle avec chaque contrat, et un logo qui n'est pas une image
// PNG, ou un domaine mal formé, irait jusqu'à l'écran.
import type { ConnectorDefinition } from "./definition"

/** La description d'un connecteur, plus longue que celle d'une fonction (1 000). */
export const CONNECTOR_DESCRIPTION_MAX = 2000

/** Le logo déclaré d'un connecteur, une fois décodé : 16 Ko au plus. */
export const DECLARED_LOGO_BYTES_MAX = 16 * 1024
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]
/** La longueur base64 de `DECLARED_LOGO_BYTES_MAX` octets : au-delà, le texte n'est pas décodé. */
const DECLARED_LOGO_TEXT_MAX = Math.ceil(DECLARED_LOGO_BYTES_MAX / 3) * 4

/**
 * Les octets d'un logo déclaré (base64 sans préfixe `data:`), ou `null` : pas du texte, pas du base64 canonique (le
 * décodage réencodé ne rend pas le texte), pas une image PNG (ses 8 premiers octets), ou plus de 16 Ko.
 */
export function declaredLogoBytes(logo: unknown): Uint8Array | null {
  if (typeof logo !== "string" || logo.length === 0 || logo.length > DECLARED_LOGO_TEXT_MAX) return null
  const bytes = Buffer.from(logo, "base64")
  if (bytes.toString("base64") !== logo || bytes.byteLength > DECLARED_LOGO_BYTES_MAX) return null
  return PNG_SIGNATURE.every((octet, rang) => bytes[rang] === octet) ? new Uint8Array(bytes) : null
}

/**
 * Le domaine d'un outil : un nom de domaine en minuscules, deux étiquettes au moins, la dernière en lettres ; ni
 * schéma, ni port, ni chemin, ni point final.
 */
const LOGO_DOMAIN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

/** Le problème de la description, du logo ou du domaine d'un connecteur, tous facultatifs ; `null` : aucun. */
export function presentationProblem(definition: ConnectorDefinition): string | null {
  const { name, description, logo, logoDomain } = definition
  if (description !== undefined && (typeof description !== "string" || !description.trim() || description.length > CONNECTOR_DESCRIPTION_MAX)) {
    return `${name}: description must be 1 to ${CONNECTOR_DESCRIPTION_MAX} characters.`
  }
  if (logo !== undefined && !declaredLogoBytes(logo)) return `${name}: logo must be a base64 PNG of 16 KB at most.`
  if (logoDomain !== undefined && (typeof logoDomain !== "string" || !LOGO_DOMAIN.test(logoDomain))) {
    return `${name}: logoDomain must be a lowercase domain name, without scheme, port or path (example.com).`
  }
  return null
}
