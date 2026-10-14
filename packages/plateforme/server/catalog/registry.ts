// Catalogue des fonctions derrière `call` (H80, H81) : recherche, activation, contrat servi par
// `read` (E03-S03), exemples cités par la description de `call` (H25). Sans lui, `find` n'a aucune
// fonction à trouver ni `read` de contrat à servir. Fonctions pures sur un tableau passé en
// argument : les tests passent leurs fonctions, la route passe `catalogFunctions()`.
//
// Repris de la maquette (`mcp-test/src/proto/functions/registry.ts` l. 13-59) : recherche par mots,
// contrat, forme du nom. Retiré : le catalogue en dur (sources : E07-S01, E04-S01, E08-S05).
import * as z from "zod/v4"
import { normalizeTitle } from "../../schemas"
import { mailCreateDraft, mailSendDraft } from "../connectors/simulated/mail"
import { nodeDiscardDraft } from "../nodes/discard"
import { nodeMove } from "../nodes/move-function"
import { nodeTrash } from "../nodes/trash"
import { nodeWriteMany } from "../nodes/write-many"
import { tableAggregate } from "../tables/aggregate"
import { tableClaim } from "../tables/claim"
import { tableDeleteRows } from "../tables/delete-rows"
import { tableImport } from "../tables/import"
import { tableRelease } from "../tables/release"
import { tableRows } from "../tables/rows"
import { tableSchema } from "../tables/schema"
import { tableWrite } from "../tables/write"
import { nodeExportTree, nodeImportTree } from "../transfer/functions"
import { nodeCheck, nodeTree } from "../transfer/inspect"
import type { CatalogFunction } from "./define"
import { erpFunctions } from "./erp-source"
import { uploadLink } from "./upload-link"

/** Le connecteur natif du paquet (H80) : toujours actif et sans compte, même avant ses fonctions (E07-S01). */
export const NATIVE_CONNECTOR = "table"

/**
 * Catalogue de la V1 (H80) : `mail` simulé (E04-S01), lecture des tableaux (E07-S01), écriture et file
 * de travail (E07-S02), import d'un CSV (E10-S01), suppression de lignes, abandon d'un brouillon et
 * corbeille (E11-S02, connecteur natif `node`) ; ERP (E08-S05) s'y ajoute ; le dépôt par lien (E10-S02 lot f, connecteur
 * `upload`, ADR-018) ; déplacement et écriture par lot (E11-S18, connecteur `node`) ; export et import d'une arborescence d'un MCP Oto à un autre (connecteur `node`).
 */
export function catalogFunctions(): CatalogFunction[] {
  return [
    mailCreateDraft,
    mailSendDraft,
    tableSchema,
    tableRows,
    tableAggregate,
    tableWrite,
    tableClaim,
    tableRelease,
    tableImport,
    tableDeleteRows,
    nodeDiscardDraft,
    nodeTrash,
    nodeMove,
    nodeWriteMany,
    nodeExportTree,
    nodeImportTree,
    nodeTree,
    nodeCheck,
    uploadLink,
    ...erpFunctions(),
  ]
}

/**
 * Les noms des fonctions du catalogue : la description d'un tableau (`read`, `table.schema`) ne cite
 * `table.write`, `table.claim` ou `table.release` que s'ils y sont (E07-S01, N15).
 */
export function catalogNames(): ReadonlySet<string> {
  return new Set(catalogFunctions().map((fn) => fn.name))
}

export function findFunction(functions: readonly CatalogFunction[], name: string): CatalogFunction | null {
  const wanted = name.trim()
  return functions.find((fn) => fn.name === wanted) ?? null
}

/** Nom de fonction (`table.rows`) plutôt que chemin de nœud (`ventes/relance_devis`). */
export function looksLikeFunction(path: string): boolean {
  return /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/.test(path.trim())
}

/** Native et ERP : toujours actives ; connecteur distant : seulement s'il est activé (H81). */
export function isActive(fn: CatalogFunction, activeConnectors: ReadonlySet<string>): boolean {
  return fn.origin !== "service_connecteurs" || activeConnectors.has(fn.connector)
}

/** Mots de 3 lettres au moins, sans casse ni accent (`normalizeTitle`, comme les noms d'équipes et de comptes). */
function words(text: string): string[] {
  return normalizeTitle(text)
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2)
}

/** Un mot de 3 lettres se compare entier ; un mot plus long, par préfixe dans les deux sens. */
function matches(wanted: string, found: string): boolean {
  return found === wanted || (wanted.length > 3 && (found.startsWith(wanted) || wanted.startsWith(found)))
}

/**
 * Recherche lexicale (nom, connecteur, description) : score = part des mots de la requête
 * trouvés ; à score égal, par nom.
 */
export function searchFunctions(
  functions: readonly CatalogFunction[],
  query: string,
  limit: number,
): { fn: CatalogFunction; score: number }[] {
  const wanted = [...new Set(words(query))]
  if (wanted.length === 0) return []
  return functions
    .map((fn) => {
      const haystack = words(`${fn.name} ${fn.connector} ${fn.description}`)
      const hits = wanted.filter((word) => haystack.some((found) => matches(word, found)))
      return { fn, score: hits.length / wanted.length }
    })
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score || a.fn.name.localeCompare(b.fn.name))
    .slice(0, limit)
}

/** Contrat servi par `read` (path = nom de la fonction) : ce qu'il faut pour appeler juste. */
export function describeFunction(fn: CatalogFunction, prefix: string): { text: string; data: Record<string, unknown> } {
  // Rendu des entrées des outils (`mcp/schemas.ts`), sans la clé `$schema`, mais côté entrée : ce que le
  // modèle écrit et que `call` valide, un champ à défaut facultatif (E08-S05, NH8 ; identique pour le paquet).
  const schema: Record<string, unknown> = z.toJSONSchema(fn.schema, { io: "input" })
  delete schema.$schema
  const text = [
    `Function ${fn.name} (connector ${fn.connector}, origin ${fn.origin}, class ${fn.class}${fn.class === "sensitive" ? ": two-step confirmation" : ""})`,
    fn.description,
    "Arguments (JSON Schema):",
    JSON.stringify(schema),
    "Examples:",
    ...fn.examples.map((args) => `${prefix}_call {"function": "${fn.name}", "arguments": ${JSON.stringify(args)}}`),
    "Possible refusals:",
    ...fn.refusals.map((refusal) => `- ${refusal}`),
  ].join("\n")
  const data = {
    function: fn.name,
    connector: fn.connector,
    class: fn.class,
    origin: fn.origin,
    arguments_schema: schema,
    examples: fn.examples,
  }
  return { text, data }
}

/** Au plus deux connecteurs cités, puis `table.rows` : trois noms au plus (N15). */
const MAX_EXAMPLE_CONNECTORS = 2

/**
 * Exemples cités par la description de `call` (H25, N15) : parmi les fonctions actives, par
 * connecteur activé trié par nom, la première fonction non sensible par nom, pour deux connecteurs au
 * plus ; puis `table.rows` s'il est actif. Jamais une fonction sensible, ni une fonction de l'ERP, qui
 * se trouve par `find` (E08-S05, NH6) : la description reste celle de l'organisation sans ERP.
 */
export function callExamples(functions: readonly CatalogFunction[], activeConnectors: ReadonlySet<string>): string[] {
  const active = functions.filter((fn) => isActive(fn, activeConnectors))
  const connectors = [...new Set(active.filter((fn) => fn.origin === "service_connecteurs").map((fn) => fn.connector))].sort()
  const examples: string[] = []
  for (const connector of connectors) {
    if (examples.length === MAX_EXAMPLE_CONNECTORS) break
    const first = active
      .filter((fn) => fn.connector === connector && fn.class !== "sensitive")
      .map((fn) => fn.name)
      .sort()[0]
    if (first) examples.push(first)
  }
  if (active.some((fn) => fn.name === "table.rows" && fn.class !== "sensitive")) examples.push("table.rows")
  return examples
}
