// Le catalogue d'une organisation (`fonctions-d-un-hote.md` § Source par organisation) : celui de l'instance
// (`assistantFunctions`), puis les fonctions de l'API de l'hôte de l'organisation (`host-api/`), qui y entrent comme des
// fonctions de l'ERP. Lu par les portes qui servent un assistant dans une organisation : `find`, `read`, `call` et le
// contrôle d'une procédure. Module à part : le registre reste synchrone et sans base.
import { loadActiveConnectors } from "../connectors/activations"
import type { PlatformDb } from "../db"
import { hostApiFunctions } from "../host-api/service"
import type { Identity } from "../identity"
import { oidcMode } from "../issuer"
import type { CatalogFunction } from "./define"
import { assistantFunctions, isActive } from "./registry"

/**
 * Ce que voit l'assistant dans l'organisation de `identity` : l'instance, puis l'API de son hôte. Sans émetteur OIDC, une
 * instance n'a aucune API d'hôte (l'échange de jeton en exige un, le rafraîchissement refuse le document) : rien n'est lu.
 */
export async function orgAssistantFunctions(db: PlatformDb, identity: Identity): Promise<CatalogFunction[]> {
  if (!oidcMode()) return assistantFunctions()
  return [...assistantFunctions(), ...(await hostApiFunctions(db, identity))]
}

/** Les fonctions actives de ce catalogue, connecteurs actifs relus (`read functions`). */
export async function activeOrgFunctions(db: PlatformDb, identity: Identity): Promise<CatalogFunction[]> {
  const [functions, active] = await Promise.all([orgAssistantFunctions(db, identity), loadActiveConnectors(db, identity.org.id)])
  return functions.filter((fn) => isActive(fn, active))
}
