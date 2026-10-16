// La source des connecteurs décrits que l'hôte déclare (`registerConnectors`, `connectors/declaration.ts`) : leurs
// définitions et les fonctions qu'en tire le moteur, lues par le registre à chaque appel (`catalogFunctions`). Module à
// part, sans import à l'exécution, comme `erp-source.ts` : logée dans `declaration.ts`, qui lit le registre pour
// valider, elle ferait s'importer registre et déclaration.
import type { PreparedAuth } from "../connectors/auth"
import type { ConnectorDefinition, OAuthApplication } from "../connectors/definition"
import type { PreparedFunction } from "../connectors/engine"
import type { CatalogFunction } from "./define"

/**
 * Un connecteur déclaré : sa définition telle que l'hôte l'a passée, son authentification préparée (les champs du compte
 * qu'elle exige), ses fonctions au contrat du catalogue, et la fonction préparée de sa sonde (`probeAccount`), `null`
 * sans sonde. Pour `oauth2_user` : la fonction préparée qui nomme qui a consenti (`identity`) et l'application OAuth
 * que l'hôte a fournie (`application`, `null` sans elle) ; `null` toutes deux pour une autre authentification.
 */
export type DeclaredConnector = {
  definition: ConnectorDefinition
  auth: PreparedAuth
  functions: readonly CatalogFunction[]
  probe: PreparedFunction | null
  identity: PreparedFunction | null
  application: OAuthApplication | null
}

let declared: readonly DeclaredConnector[] = []

/** Les connecteurs déclarés, dans l'ordre de la déclaration. */
export function declaredConnectors(): readonly DeclaredConnector[] {
  return declared
}

/** Le connecteur déclaré de ce nom, ou `null`. */
export function declaredConnector(name: string): DeclaredConnector | null {
  return declared.find((connector) => connector.definition.name === name) ?? null
}

/** Remplace toute la source ; seul appelant : `registerConnectors`, la liste entière validée. */
export function replaceDeclaredConnectors(connectors: readonly DeclaredConnector[]): void {
  declared = [...connectors]
}
