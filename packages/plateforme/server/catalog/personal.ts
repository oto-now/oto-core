// Les arguments « donnée personnelle » d'une fonction du catalogue (`pseudonymisation.md` § Les quatre primitives) :
// une propriété marquée `personal: true` dans le JSON Schema d'un connecteur décrit, ou `.meta({ personal: true })` dans
// le schéma Zod d'une fonction de l'hôte, n'est jamais journalisée. Ce module rend les valeurs que l'appel porte à ces
// places ; le journal les retire de sa ligne (`server/journal.ts`, `withoutPersonal`), où qu'un tiers les recopie. Sans
// lui, l'adresse ou le nom qu'une fonction reçoit resterait au journal, lu par l'administrateur et l'équipe plateforme.
import { isJsonObject, jsonLeaves } from "../json"
import { argumentsJsonSchema, PERSONAL_KEYWORD } from "./arguments"
import type { CatalogFunction } from "./define"

/**
 * Un pas d'un chemin dans les arguments : une clé, ou tout élément d'une liste ou toute clé d'un dictionnaire, sauf
 * celles d'`except` : les clés que `properties` déclare à côté d'`additionalProperties`, qui suivent leur propre schéma
 * (les clés libres d'un objet sont marquées, pas ses clés déclarées).
 */
type Step = { key: string } | { any: true; except?: readonly string[] }
type Path = readonly Step[]

/** Au-delà, les `$ref` ne sont plus suivis : un schéma récursif reste borné. */
const MAX_REF_DEPTH = 8

const paths = new WeakMap<object, readonly Path[]>()

/** Le nœud désigné par un `$ref` local (`#/$defs/<nom>`), ou `null`. */
function resolved(root: Record<string, unknown>, ref: unknown): Record<string, unknown> | null {
  if (typeof ref !== "string" || !ref.startsWith("#/")) return null
  let node: unknown = root
  for (const segment of ref.slice(2).split("/")) {
    if (!isJsonObject(node)) return null
    node = node[segment.replaceAll("~1", "/").replaceAll("~0", "~")]
  }
  return isJsonObject(node) ? node : null
}

/** Le schéma entier, d'où se résolvent les `$ref`, et les chemins trouvés. */
type Search = { root: Record<string, unknown>; found: Path[] }

/** Les chemins des propriétés marquées, sous `node`, à profondeur de `$ref` bornée. */
function collect(search: Search, node: unknown, path: Path, depth: number): void {
  const { root, found } = search
  if (!isJsonObject(node)) return
  if (node[PERSONAL_KEYWORD] === true) {
    found.push(path)
    return
  }
  const target = depth < MAX_REF_DEPTH ? resolved(root, node.$ref) : null
  if (target) collect(search, target, path, depth + 1)
  const declared = isJsonObject(node.properties) ? Object.keys(node.properties) : []
  if (isJsonObject(node.properties)) {
    for (const [key, child] of Object.entries(node.properties)) collect(search, child, [...path, { key }], depth)
  }
  collect(search, node.items, [...path, { any: true }], depth)
  collect(search, node.additionalProperties, [...path, declared.length > 0 ? { any: true, except: declared } : { any: true }], depth)
  if (Array.isArray(node.prefixItems)) for (const child of node.prefixItems) collect(search, child, [...path, { any: true }], depth)
  for (const key of ["anyOf", "oneOf", "allOf"]) {
    const list = node[key]
    if (Array.isArray(list)) for (const child of list) collect(search, child, path, depth)
  }
}

/** Les chemins des arguments marqués d'une fonction, calculés une fois par schéma. */
export function personalPaths(fn: Pick<CatalogFunction, "schema">): readonly Path[] {
  const known = paths.get(fn.schema)
  if (known) return known
  const root = argumentsJsonSchema(fn.schema)
  const found: Path[] = []
  collect({ root, found }, root, [], 0)
  paths.set(fn.schema, found)
  return found
}

function walk(value: unknown, path: Path, into: Set<string>): void {
  if (path.length === 0) {
    jsonLeaves(value, into)
    return
  }
  const [step, ...rest] = path
  if ("key" in step) {
    if (isJsonObject(value) && step.key in value) walk(value[step.key], rest, into)
    return
  }
  if (Array.isArray(value)) for (const item of value) walk(item, rest, into)
  else if (isJsonObject(value)) {
    for (const [key, item] of Object.entries(value)) if (!step.except?.includes(key)) walk(item, rest, into)
  }
}

/**
 * Les valeurs que les arguments de l'appel portent aux places marquées, telles qu'envoyées (avant toute validation) :
 * chaînes et nombres, à toute profondeur sous la place ; vide sans argument marqué.
 */
export function personalValues(fn: Pick<CatalogFunction, "schema">, args: unknown): string[] {
  const marked = personalPaths(fn)
  if (marked.length === 0) return []
  const values = new Set<string>()
  for (const path of marked) walk(args, path, values)
  return [...values]
}
