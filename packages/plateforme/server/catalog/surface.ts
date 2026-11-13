// La déclaration d'hôte de ce qu'un assistant reçoit, en liste fermée. Sans elle, une fonction ou une capacité MCP qu'une
// mise à jour du paquet ajoute est servie d'office : un hôte qui doit classer chaque sortie avant de l'ouvrir ne le
// pouvait qu'en enveloppant les portes, et le paquet continuait de citer les fonctions qu'il avait fermées.
import { boundedList } from "../errors"
import { CatalogRegistrationError } from "./erp"
import { packageFunctions } from "./registry"
import { OPTIONAL_CAPABILITIES, replaceHostSurface, type HostSurface } from "./surface-source"

/**
 * Déclare ce que l'hôte sert à un assistant ; `null` retire la déclaration (tout est servi, le défaut). Toute la
 * déclaration est validée d'abord : un nom qui n'est pas une fonction du paquet, ou une capacité inconnue, lève
 * `CatalogRegistrationError` et rien n'est déclaré. La déclaration remplace la précédente.
 */
export function registerHostSurface(surface: HostSurface | null): void {
  if (surface === null) return replaceHostSurface(null)
  const known = new Set(packageFunctions().map((fn) => fn.name))
  const unknown = surface.functions.filter((name) => !known.has(name))
  if (unknown.length > 0) {
    throw new CatalogRegistrationError(`registerHostSurface: not a function of the package: ${boundedList(unknown)}. Functions of the package: ${boundedList([...known].sort())}.`)
  }
  const capabilities: readonly string[] = OPTIONAL_CAPABILITIES
  const refused = surface.capabilities.filter((capability) => !capabilities.includes(capability))
  if (refused.length > 0) throw new CatalogRegistrationError(`registerHostSurface: unknown capability ${boundedList(refused)}. Capabilities: ${OPTIONAL_CAPABILITIES.join(", ")}.`)
  replaceHostSurface(surface)
}
