// Les fonctions d'un connecteur décrit réservées au serveur de l'hôte (`pseudonymisation.md` § Les quatre primitives) :
// l'hôte nomme, connecteur par connecteur, tout le connecteur (`"all"`) ou certaines de ses fonctions (celles qui
// prennent une adresse, par exemple) ; `callFunction` les court, l'assistant ne les voit jamais (`assistantFunctions`).
// Le choix est celui de l'hôte, pas de la description partagée : la sensibilité d'une fonction dépend de son usage.
// Module à part de `declaration.ts`, contrôlé comme les autres dons de l'hôte : au premier problème,
// `CatalogRegistrationError` et rien n'est déclaré.
import type { DeclaredConnector } from "../catalog/connector-source"
import { CatalogRegistrationError } from "../catalog/erp"

/** Par connecteur : `"all"`, ou les noms servis de ses fonctions réservées (`<connecteur>.<f>`, `<connecteur>_act.<f>`). */
export type ServerOnlyOption = Readonly<Record<string, "all" | readonly string[]>>

/** Les noms réservés d'un connecteur, contrôlés contre ses fonctions servies. */
function reservedNames(connector: DeclaredConnector, given: unknown): ReadonlySet<string> {
  const name = connector.definition.name
  const served = connector.functions.map((fn) => fn.name)
  if (given === "all") return new Set(served)
  if (!Array.isArray(given) || given.length === 0) {
    throw new CatalogRegistrationError(`serverOnly for ${name}: expected "all" or a non-empty list of its function names.`)
  }
  for (const fn of given) {
    if (typeof fn !== "string" || !served.includes(fn)) {
      throw new CatalogRegistrationError(`serverOnly for ${name}: ${JSON.stringify(fn)} is not one of its functions (${served.join(", ")}).`)
    }
  }
  return new Set(given)
}

/** Les connecteurs déclarés, leurs fonctions réservées marquées `serverOnly` ; un connecteur inconnu est refusé. */
export function withServerOnly(connectors: readonly DeclaredConnector[], option: ServerOnlyOption | undefined): DeclaredConnector[] {
  const byName = new Map(connectors.map((connector) => [connector.definition.name, connector]))
  for (const name of Object.keys(option ?? {})) {
    if (!byName.has(name)) throw new CatalogRegistrationError(`serverOnly for ${name}: no connector of this name is declared.`)
  }
  return connectors.map((connector) => {
    const given = option?.[connector.definition.name]
    if (given === undefined) return connector
    const reserved = reservedNames(connector, given)
    return { ...connector, functions: connector.functions.map((fn) => (reserved.has(fn.name) ? { ...fn, serverOnly: true } : fn)) }
  })
}
