// La source des connecteurs décrits que l'hôte déclare (`registerConnectors`, `connectors/declaration.ts`) : leurs
// définitions et les fonctions qu'en tire le moteur, lues par le registre à chaque appel (`catalogFunctions`). Module à
// part, sans import à l'exécution, comme `erp-source.ts` : logée dans `declaration.ts`, qui lit le registre pour
// valider, elle ferait s'importer registre et déclaration.
import type { PreparedAuth } from "../connectors/auth"
import type { ConnectorDefinition, ConnectorView, HostCredentialReader, HostedLinkProvider, OAuthApplication } from "../connectors/definition"
import type { PreparedFunction } from "../connectors/engine"
import type { CatalogFunction } from "./define"

/**
 * Un accès d'un connecteur déclaré, ce par quoi un compte s'ouvre : son nom et son libellé (`null` tous deux pour un
 * connecteur à un seul accès), le connecteur tel qu'il le voit (`definition` : son `auth`, son `credential`, ses
 * `modes`), son authentification préparée (les champs du compte qu'elle exige), et la fonction préparée de sa sonde
 * (`probeAccount`), `null` sans sonde. Pour `oauth2_user` : la fonction préparée qui nomme qui a consenti (`identity`) et
 * l'application OAuth que l'hôte a fournie (`application`, `null` sans elle) ; `null` toutes deux pour une autre
 * authentification. Le lecteur des champs `holder: host` (`hostCredentials`) et le port du branchement hébergé d'un
 * connecteur à `accountIdentity` (`hostedLinks`), fournis par l'hôte ; `null` sans eux.
 */
export type DeclaredAccess = {
  name: string | null
  label: string | null
  definition: ConnectorView
  auth: PreparedAuth
  probe: PreparedFunction | null
  identity: PreparedFunction | null
  application: OAuthApplication | null
  hostCredentials: HostCredentialReader | null
  hostedLinks: HostedLinkProvider | null
}

/**
 * Un connecteur déclaré : sa définition telle que l'hôte l'a passée, ses accès (un seul, sans nom, ou chacun de ceux
 * de `accesses`, dans leur ordre) et ses fonctions au contrat du catalogue, communes à ses accès.
 */
export type DeclaredConnector = {
  definition: ConnectorDefinition
  accesses: readonly DeclaredAccess[]
  functions: readonly CatalogFunction[]
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

/** L'accès de ce nom d'un connecteur déclaré (`null` : celui d'un connecteur à un seul accès), ou `null`. */
export function declaredAccess(connector: DeclaredConnector, access: string | null): DeclaredAccess | null {
  return connector.accesses.find((candidate) => candidate.name === access) ?? null
}

/** Remplace toute la source ; seul appelant : `registerConnectors`, la liste entière validée. */
export function replaceDeclaredConnectors(connectors: readonly DeclaredConnector[]): void {
  declared = [...connectors]
}
