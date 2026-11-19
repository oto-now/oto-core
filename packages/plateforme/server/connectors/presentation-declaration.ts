// Ce que l'assistant et l'écran Connecteurs montrent d'un outil, au-delà de son libellé : sa description, écrite pour
// l'assistant, et son domaine, d'où l'écran tire son logo (`connector.description` et `connector.logo_domain` du format
// de `connectors`). Contrôlés à la déclaration (`registerConnectors`) : sans ce module, une description vide ou
// démesurée serait servie telle quelle avec chaque contrat, et un domaine mal formé irait jusqu'à l'écran.
import type { ConnectorDefinition } from "./definition"

/** La description d'un connecteur, plus longue que celle d'une fonction (1 000). */
export const CONNECTOR_DESCRIPTION_MAX = 2000

/**
 * Le domaine d'un outil : un nom de domaine en minuscules, deux étiquettes au moins, la dernière en lettres ; ni
 * schéma, ni port, ni chemin, ni point final.
 */
const LOGO_DOMAIN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

/** Le problème de la description ou du domaine d'un connecteur, tous deux facultatifs ; `null` : aucun. */
export function presentationProblem(definition: ConnectorDefinition): string | null {
  const { name, description, logoDomain } = definition
  if (description !== undefined && (typeof description !== "string" || !description.trim() || description.length > CONNECTOR_DESCRIPTION_MAX)) {
    return `${name}: description must be 1 to ${CONNECTOR_DESCRIPTION_MAX} characters.`
  }
  if (logoDomain !== undefined && (typeof logoDomain !== "string" || !LOGO_DOMAIN.test(logoDomain))) {
    return `${name}: logoDomain must be a lowercase domain name, without scheme, port or path (example.com).`
  }
  return null
}
