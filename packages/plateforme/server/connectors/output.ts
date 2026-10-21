// La sortie taillée d'une fonction décrite (`connecteurs-et-comptes.md` § Moteur des connecteurs décrits ; `connectors :
// docs/conception/format-de-description.md` § Retirer de la sortie) : chaque chemin de `strip` (`call.recording`)
// retiré, à travers les listes, puis les clés de premier niveau de `projection` gardées ; et `strip` contrôlé à la
// déclaration comme la règle 18 de la fabrique. Sans ce module, une clé désignée par un chemin (l'adresse signée d'une
// réponse emballée) sortirait vers l'assistant.
import { isJsonObject } from "../json"
import type { ConnectorFunctionDefinition } from "./definition"

/**
 * `value` sans la clé au bout de `keys` (les segments d'un chemin de `strip`), copiée là où elle change, jamais modifiée
 * sur place : une liste se traverse, le chemin valant pour chacun de ses éléments ; une valeur absente, nulle ou qui
 * n'est pas un objet n'a rien à retirer ; une clé présente part quelle que soit sa valeur. Un segment n'est jamais un
 * indice.
 */
function without(value: unknown, keys: readonly string[]): unknown {
  if (Array.isArray(value)) return value.map((element) => without(element, keys))
  const [key, ...rest] = keys
  if (!isJsonObject(value) || !Object.hasOwn(value, key)) return value
  if (rest.length === 0) return Object.fromEntries(Object.entries(value).filter(([name]) => name !== key))
  return Object.fromEntries(Object.entries(value).map(([name, inner]) => [name, name === key ? without(inner, rest) : inner]))
}

/**
 * Un enregistrement taillé par `output` (un élément de `items`, ou la réponse entière) : chaque chemin de `strip`
 * retiré, puis seules les clés de premier niveau de `projection` gardées ; la réponse du tiers n'est pas modifiée.
 */
export function shaped(record: unknown, fn: ConnectorFunctionDefinition): unknown {
  const { strip, projection } = fn.output ?? {}
  const stripped = (strip ?? []).reduce((value, path) => without(value, path.split(".")), record)
  if (!projection || !isJsonObject(stripped)) return stripped
  return Object.fromEntries(Object.entries(stripped).filter(([key]) => projection.includes(key)))
}

/**
 * Le problème de `output.strip`, comme la règle 18 de la fabrique (`connectors : docs/conception/fabrique.md`), avec
 * son code, celui des cas communs : chaque chemin, des clés non vides séparées par des points
 * (`strip_path_malformed`), déclaré une fois (`strip_path_twice`), jamais sous un autre chemin de la liste, qui le
 * retire déjà en entier (`strip_path_overlaps`) ; `null` : aucun. Qu'un chemin désigne une clé de la réponse n'est pas
 * jugé : rien ne déclare la forme de la réponse avant `strip`.
 */
export function stripProblem(fn: ConnectorFunctionDefinition): string | null {
  const strip: unknown = fn.output?.strip
  if (strip === undefined) return null
  if (!Array.isArray(strip)) return `${fn.name}: output.strip must be a list of paths.`
  const at = (path: unknown) => `${fn.name}: output.strip ${JSON.stringify(path)}`
  const seen = new Set<string>()
  for (const path of strip as unknown[]) {
    if (typeof path !== "string" || path.split(".").includes("")) return `${at(path)} is malformed: keys separated by dots, each non-empty (strip_path_malformed).`
    if (seen.has(path)) return `${at(path)} is declared twice (strip_path_twice).`
    seen.add(path)
  }
  for (const path of seen) {
    const above = [...seen].find((other) => path.startsWith(`${other}.`))
    if (above !== undefined) return `${at(path)} lies under ${JSON.stringify(above)}, which is already removed whole (strip_path_overlaps).`
  }
  return null
}
