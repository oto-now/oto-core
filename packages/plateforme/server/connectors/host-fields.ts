// Les champs d'un connecteur que fournit l'hôte (`holder: host`, `connecteurs-et-comptes.md` § Compte de l'hôte et
// compte rattaché) : une clé de l'application, une fois pour toutes ses organisations, lue par le lecteur que l'hôte
// passe à `registerConnectors` (`hostCredentials`), à chaque appel, jamais gardée par le paquet ni sur un compte. Lu par
// l'appel (`account-secret.ts`, qui l'ajoute aux champs du compte) et par le branchement hébergé (`hosted-link.ts`, qui
// en exige la présence) ; sans ce module, chacun redirait le partage des champs et le refus d'un champ absent. Aucune
// valeur n'en sort ailleurs que dans la requête au tiers : ni texte, ni erreur, ni log.
import type { DeclaredConnector } from "../catalog/connector-source"
import { PlatformError } from "../errors"
import type { IdentityOrg } from "../identity"
import type { ConnectorDefinition } from "./definition"

/** Les champs du credential que l'hôte fournit. */
export function hostFieldsOf(definition: ConnectorDefinition): ConnectorDefinition["credential"] {
  return definition.credential.filter((field) => field.holder === "host")
}

/** Les noms des champs que garde un compte : tous, sauf ceux de l'hôte. */
export function accountFieldNames(definition: ConnectorDefinition): string[] {
  return definition.credential.filter((field) => field.holder !== "host").map((field) => field.name)
}

/** Le refus d'un champ de l'hôte qui manque : l'application ne l'a pas fourni, aucune organisation n'y peut rien. */
function hostFieldMissing(definition: ConnectorDefinition, field: { name: string; label: string }): PlatformError {
  console.error(`[platform] connector ${definition.name}: host field ${field.name} not given to registerConnectors`)
  return new PlatformError(
    "not_enabled",
    `${definition.label} needs the ${field.label} of this application, which is not configured. Ask whoever runs this application to configure it.`,
  )
}

/** Le refus d'une organisation à qui l'hôte ne donne pas sa clé : l'application l'ouvre, pas l'organisation. */
function hostFieldsClosed(definition: ConnectorDefinition, org: IdentityOrg): PlatformError {
  return new PlatformError(
    "not_enabled",
    `${definition.label} is not open to ${org.name} with the key of this application. Ask whoever runs this application to open it.`,
    { reason: "host_closed" },
  )
}

/**
 * Les champs de l'hôte d'un connecteur, lus par son lecteur à cet appel, pour l'organisation `org` ; `{}` sans champ de
 * l'hôte. Un lecteur absent, qui lève, ou qui ne rend pas un champ (ou le rend vide) : `not_enabled`, qui nomme le champ ;
 * un lecteur qui rend `null` : `not_enabled` (`host_closed`), l'hôte ne donnant pas sa clé à cette organisation.
 */
export function readHostFields(declared: DeclaredConnector, org: IdentityOrg): Record<string, string> {
  const { definition, hostCredentials } = declared
  const wanted = hostFieldsOf(definition)
  if (wanted.length === 0) return {}
  if (!hostCredentials) throw hostFieldMissing(definition, wanted[0])
  let given: Record<string, string> | null
  try {
    given = hostCredentials({ org: { id: org.id, slug: org.slug } })
  } catch (error) {
    console.error(`[platform] connector ${definition.name}: the host credentials reader failed (${error instanceof Error ? error.name : typeof error})`)
    throw hostFieldMissing(definition, wanted[0])
  }
  if (given === null) throw hostFieldsClosed(definition, org)
  const fields: Record<string, string> = {}
  for (const field of wanted) {
    const value = typeof given === "object" && given !== null ? given[field.name] : undefined
    if (typeof value !== "string" || value.trim() === "") throw hostFieldMissing(definition, field)
    fields[field.name] = value
  }
  return fields
}
