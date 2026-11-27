// Le contrôle de déclaration d'une seule définition, sans rien déclarer ni lire de l'état du processus : celui que
// `registerConnectors` fait passer à chacune (`declared`), sans application OAuth, ni champ tenu par l'hôte, ni
// branchement hébergé, et avec les seuls espaces réservés que l'appelant donne. Pour une définition qui ne vient pas de
// l'hôte (un connecteur privé, `private-connectors/validation.ts`).
import { CatalogRegistrationError } from "../catalog/erp"
import { declared } from "./declaration"
import type { ConnectorDefinition } from "./definition"
import type { HostGiven } from "./host-declaration"

/** Ce qu'aucun hôte ne donne : ni application OAuth, ni lecteur de champs tenus par l'hôte, ni branchement hébergé. */
const NOTHING_GIVEN: HostGiven = { application: null, hostCredentials: null, hostedLinks: null }

/** Le message qui refuserait la définition à la déclaration ; `null` : elle se déclarerait. */
export function declarationProblem(definition: ConnectorDefinition, reserved: ReadonlySet<string>): string | null {
  try {
    declared(definition, reserved, new Set(), NOTHING_GIVEN)
    return null
  } catch (error) {
    if (error instanceof CatalogRegistrationError) return error.message
    throw error
  }
}
