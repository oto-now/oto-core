// Le catalogue d'une organisation (`fonctions-d-un-hote.md` § Source par organisation) : celui de l'instance
// (`assistantFunctions`), puis les fonctions de l'API de l'hôte de l'organisation (`host-api/`), qui y entrent comme des
// fonctions de l'ERP. Lu par les portes qui servent un assistant dans une organisation : `read` d'une fonction, `call` et
// le contrôle d'une procédure, entier ; `find`, `read functions` et `context`, filtré par la liste de la personne
// (`visibleOrgFunctions`, § Visibilité par personne). Module à part : le registre reste synchrone et sans base.
import { loadOpenConnectors } from "../connectors/activations"
import type { PlatformDb } from "../db"
import { functionCatalog } from "../find"
import { hostCatalogLines, visibleHostFunctions } from "../host-api/index-view"
import { hostApiFunctions } from "../host-api/service"
import { hostVisibility, type HostViewer, type HostVisibility } from "../host-api/visibility"
import type { Identity } from "../identity"
import { oidcMode } from "../issuer"
import type { ToolOutput } from "../tool-output"
import { contractNames } from "./contracts"
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

/**
 * Le catalogue que la personne voit : celui de l'instance, les fonctions de l'hôte de sa liste, et cette visibilité
 * (`visibility`), dont l'index dit la raison quand la liste est indisponible.
 */
export type VisibleOrgFunctions = { instance: CatalogFunction[]; host: CatalogFunction[]; visibility: HostVisibility }

/**
 * Ce que l'index montre à la personne (`find`, `read functions`, `context`) : l'instance, puis les seules fonctions de
 * l'hôte que sa liste (`/me/functions`) nomme ; une liste indisponible n'en montre aucune. Le routage seul : `call` lit
 * `orgAssistantFunctions`, et l'hôte décide.
 */
export async function visibleOrgFunctions(db: PlatformDb, identity: Identity, viewer: HostViewer): Promise<VisibleOrgFunctions> {
  const visibility = await hostVisibility(db, identity, viewer)
  const host = visibility.kind === "visible" ? visibleHostFunctions(await hostApiFunctions(db, identity), visibility) : []
  return { instance: assistantFunctions(), host, visibility }
}

/**
 * `read functions` : les fonctions actives de l'instance, puis celles de l'hôte que la liste de la personne nomme, par
 * famille (`fonctions-d-un-hote-index.md` § Visibilité par personne) ; une liste indisponible dit sa raison.
 */
export async function readFunctionCatalog(db: PlatformDb, identity: Identity, viewer: HostViewer): Promise<ToolOutput> {
  const [{ instance, host, visibility }, active] = await Promise.all([visibleOrgFunctions(db, identity, viewer), loadOpenConnectors(db, identity.org.id)])
  const prefix = identity.org.prefix
  return functionCatalog(instance.filter((fn) => isActive(fn, active)), contractNames(), prefix, { functions: host, lines: hostCatalogLines(visibility, prefix) })
}
