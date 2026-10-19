// Fonctions métier de l'ERP au catalogue (E08-S05, H108, FR-INST-06) : l'hôte qui porte un ERP inscrit
// ses fonctions par `registerFunctions([...])` depuis `src/lib/fonctions-metier.ts` ; elles se trouvent
// par `find`, se lisent par `read` et s'exécutent par `call` comme les fonctions natives, sans outil de
// plus (ADR-001, ADR-002). Sans ce module, un besoin de l'ERP n'a aucune place au catalogue.
//
// Repris de la maquette (`mcp-test/src/proto/functions/define.ts` l. 15-45) : la forme d'une fonction et
// son schéma `z.strictObject` ; ajouté : l'origine `erp` et le jeton de l'appelant dans le contexte (NH4).
// Repris d'Oto (`docs/fonctions.md` l. 32-37) : refuser une fonction mal déclarée avant qu'elle serve ;
// retiré : les versions de fonction et le rejeu de tests à la publication. Repris d'Oto
// (`docs/unipile.md` l. 33, 38) : un espace de noms par source, les noms sont un contrat ; retiré : rien.
// Repris d'Oto (`docs/tool-visibility.md` l. 36, 109) : un contrat servi ne se durcit pas en place, il se
// double sous un autre nom (README du paquet) ; retiré : la surface bêta.
import * as z from "zod/v4"
import { isRecord } from "../../schemas/tables"
import { isPlatformError, issuesText, PlatformError } from "../errors"
import { VIEW_NAME_PATTERN } from "../../schemas/views"
import { contractNames } from "./contracts"
import {
  defineFunction,
  type FunctionClass,
  type FunctionContext,
  type FunctionOutput,
  type FunctionSummary,
  type StrictSchema,
  type ZodCatalogFunction,
} from "./define"
import { erpWidgetBundle, replaceErpFunctions, replaceErpWidgetBundle, type ErpWidgetBundle } from "./erp-source"
import { catalogFunctions, looksLikeFunction } from "./registry"

/** Une fonction de l'ERP : une fonction du catalogue d'origine `erp` (H80), de connecteur son espace de noms. */
export type ErpFunction = ZodCatalogFunction & { origin: "erp" }

/**
 * Ce que reçoit une fonction de l'ERP (NH4) : la base de la plateforme, l'appelant et son jeton vérifié.
 * Les données de l'ERP se lisent et s'écrivent par un client construit sur `accessToken`, sous la RLS de
 * l'ERP, jamais par `db`, client du schéma `platform`.
 */
export type ErpFunctionContext = Pick<FunctionContext, "db" | "identity"> & { accessToken: string }

type Schema = StrictSchema

/** Une fonction telle que l'ERP la déclare (H108) : le contrat des autres fonctions, sans origine ni connecteur. */
type ErpFunctionInput<S extends Schema> = {
  name: string
  class: FunctionClass
  description: string
  schema: S
  examples: z.input<S>[]
  refusals?: string[]
  next?: string[]
  /** La vue de l'hôte qui rend `data` dans la conversation, inscrite par `registerWidgetViews` (story widgets-dans-la-conversation). */
  view?: string
  /** Réservée au serveur de l'hôte : `callFunction` la court, l'assistant ne la voit jamais (`pseudonymisation.md`). */
  serverOnly?: boolean
  run: (context: ErpFunctionContext, args: z.output<S>) => Promise<FunctionOutput>
  summarize?: (context: ErpFunctionContext, args: z.output<S>) => Promise<FunctionSummary>
}

/** Refus d'une inscription (AC3), levé au chargement de la route : rien n'est inscrit (NH3). */
export class CatalogRegistrationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CatalogRegistrationError"
  }
}

/** Au plus, en caractères : le nom (ce que les hosts acceptent, `mcp-patterns.md § 3`) et la description. */
const NAME_MAX = 64
const DESCRIPTION_MAX = 1000
const CLASSES = ["read", "write", "sensitive"] as const satisfies readonly FunctionClass[]

const namespaceOf = (name: string): string => name.split(".")[0]

/**
 * Le contexte d'une fonction de l'ERP. La porte MCP passe toujours le jeton vérifié de la requête
 * (`McpDeps.accessToken`) : sans lui, câblage fautif, la fonction ne court pas, jamais sans appelant.
 */
function erpContext(name: string, context: FunctionContext): ErpFunctionContext {
  if (!context.accessToken) {
    console.error(`[platform] call: ERP function ${name} without the caller's token`)
    throw new PlatformError("internal", "Internal error.")
  }
  return { db: context.db, identity: context.identity, accessToken: context.accessToken }
}

/**
 * `run` ou `summarize` de l'ERP sous son contexte. Une panne `internal` qu'il lève est servie comme la
 * consigne de H04, et la porte ne journalise pas une `PlatformError` : sa cause s'écrit ici au log
 * serveur, sinon elle se perdrait (NH18). Toute autre erreur, la porte la journalise (AC10).
 */
async function inErpContext<T>(name: string, context: FunctionContext, work: (erp: ErpFunctionContext) => Promise<T>): Promise<T> {
  const erp = erpContext(name, context)
  try {
    return await work(erp)
  } catch (error) {
    if (isPlatformError(error) && error.code === "internal") console.error(`[platform] call: ERP function ${name} failed`, error)
    throw error
  }
}

/**
 * Une fonction de l'ERP au type commun du catalogue, par `defineFunction` (E03-S01) : origine `erp`,
 * connecteur = l'espace de son nom, aucun refus déclaré par défaut ; `run` et `summarize` reçoivent le
 * contexte de l'ERP (NH4).
 */
export function defineErpFunction<S extends Schema>(input: ErpFunctionInput<S>): ErpFunction {
  const { run, summarize, refusals, ...contract } = input
  const fn = defineFunction({
    ...contract,
    connector: namespaceOf(input.name),
    origin: "erp",
    refusals: refusals ?? [],
    run: (context, args) => inErpContext(input.name, context, (erp) => run(erp, args)),
    summarize: summarize && ((context, args) => inErpContext(input.name, context, (erp) => summarize(erp, args))),
  })
  // `defineFunction` rend le type commun, toute origine permise : celle-ci vient d'être fixée à `erp`.
  return fn as ErpFunction
}

/** Chaque exemple est accepté par le schéma : le contrat servi par `read` ne cite jamais un appel refusé. */
function examplesProblem(fn: ErpFunction): string | null {
  if (!Array.isArray(fn.examples) || fn.examples.length === 0) return `${fn.name}: needs at least one example.`
  for (const [index, example] of fn.examples.entries()) {
    const parsed = fn.schema.safeParse(example)
    if (!parsed.success) return `${fn.name}: examples[${index}] does not match the schema (${issuesText(parsed.error.issues)}).`
  }
  return null
}

/** Les sous-schémas d'un nœud du JSON Schema que rend Zod : propriétés, éléments, variantes, définitions. */
function subSchemas(node: Record<string, unknown>): unknown[] {
  const children: unknown[] = [node.items, node.additionalProperties]
  for (const key of ["anyOf", "oneOf", "allOf", "prefixItems"]) {
    const list = node[key]
    if (Array.isArray(list)) children.push(...list)
  }
  for (const key of ["properties", "$defs"]) {
    const map = node[key]
    if (isRecord(map)) children.push(...Object.values(map))
  }
  return children
}

/**
 * Un objet aux propriétés déclarées qui n'est pas fermé, à tout niveau : Zod y ôterait sans refus une clé
 * mal écrite (NH17). Un `z.record`, sans propriétés déclarées, garde ses clés libres.
 */
function hasOpenObject(node: unknown): boolean {
  if (!isRecord(node)) return false
  if (isRecord(node.properties) && node.additionalProperties !== false) return true
  return subSchemas(node).some(hasOpenObject)
}

/**
 * Le schéma tel que `read` le sert, côté entrée (`describeFunction`, NH8) : écrit en JSON Schema, sinon
 * le contrat ne se lirait pas (NH16), et fermé à chaque niveau (AC3, NH17). Côté entrée seulement, un
 * `z.object` qui ôte les clés inconnues se montre ouvert : en sortie, il se déclare fermé lui aussi.
 */
function schemaProblem(fn: ErpFunction): string | null {
  let json: Record<string, unknown>
  try {
    json = z.toJSONSchema(fn.schema, { io: "input" })
  } catch (error) {
    return `${fn.name}: schema must be representable in JSON Schema (${error instanceof Error ? error.message : String(error)}).`
  }
  if (json.additionalProperties !== false) return `${fn.name}: schema must be a z.strictObject (unknown keys are refused, not ignored).`
  if (hasOpenObject(json)) return `${fn.name}: nested objects must be z.strictObject too (unknown keys are refused, not ignored).`
  return null
}

/**
 * Le premier problème d'une fonction, dans l'ordre des contrôles ci-dessous (nom, espace, déclaration,
 * classe, description, schéma, exemples, récapitulatif) ; `null` : aucun. Le doublon et les suites se
 * contrôlent sur toute la liste (`registerFunctions`).
 */
function functionProblem(fn: ErpFunction, reserved: ReadonlySet<string>): string | null {
  const { name } = fn
  // `looksLikeFunction` est la forme que `read` et `find` reconnaissent : un autre nom serait illisible.
  if (typeof name !== "string" || name.length > NAME_MAX || name !== name.trim() || !looksLikeFunction(name)) {
    return `Invalid function name ${JSON.stringify(String(name))}: expected <namespace>.<name> in lowercase ASCII letters, digits and _, 64 characters at most.`
  }
  const namespace = namespaceOf(name)
  if (reserved.has(namespace)) return `Namespace "${namespace}" of ${name} is already served by another source.`
  if (fn.origin !== "erp" || fn.connector !== namespace) return `${name}: declare it with defineErpFunction (origin erp, connector ${namespace}).`
  if (!CLASSES.includes(fn.class)) return `${name}: class must be read, write or sensitive.`
  if (typeof fn.description !== "string" || !fn.description.trim() || fn.description.length > DESCRIPTION_MAX) {
    return `${name}: description must be 1 to ${DESCRIPTION_MAX} characters.`
  }
  const schema = schemaProblem(fn)
  if (schema) return schema
  const examples = examplesProblem(fn)
  if (examples) return examples
  if (fn.class === "sensitive" && typeof fn.summarize !== "function") return `${name}: a sensitive function needs summarize (two-step confirmation).`
  if (fn.serverOnly !== undefined && typeof fn.serverOnly !== "boolean") return `${name}: serverOnly must be true or false.`
  return viewProblem(fn)
}

/** La vue déclarée est dans le bundle inscrit : sinon le widget recevrait un nom qu'il ne sait pas rendre. */
function viewProblem(fn: ErpFunction): string | null {
  if (fn.view === undefined) return null
  if (typeof fn.view !== "string" || !VIEW_NAME_PATTERN.test(fn.view)) return `${fn.name}: view must be lowercase ASCII letters, digits and _, 64 characters at most.`
  if (erpWidgetBundle()?.views.includes(fn.view)) return null
  return `${fn.name}: view ${fn.view} is not in the widget bundle; build it with oto-platform widgets build and pass it to registerWidgetViews before registerFunctions.`
}

/** Le premier problème d'un bundle de l'hôte ; `null` : aucun. */
function bundleProblem(bundle: ErpWidgetBundle): string | null {
  if (typeof bundle?.html !== "string" || !bundle.html.trimStart().toLowerCase().startsWith("<!doctype html>")) {
    return "registerWidgetViews: html must be the HTML document built by oto-platform widgets build."
  }
  if (!Array.isArray(bundle.views)) return "registerWidgetViews: views must list the view names of the bundle."
  const invalid = bundle.views.find((view) => typeof view !== "string" || !VIEW_NAME_PATTERN.test(view))
  if (invalid !== undefined) return `registerWidgetViews: invalid view name ${JSON.stringify(String(invalid))}.`
  const duplicate = bundle.views.find((view, index) => bundle.views.indexOf(view) !== index)
  return duplicate === undefined ? null : `registerWidgetViews: duplicate view ${duplicate}.`
}

/**
 * Inscrit le bundle du widget construit par l'hôte (`oto-platform widgets build`), qui porte les vues du paquet et
 * celles de l'ERP : le MCP le sert à la place de celui du paquet. À appeler avant `registerFunctions`, qui refuse une
 * fonction dont la vue n'y est pas. Au premier problème, `CatalogRegistrationError` et le bundle servi ne change pas.
 */
export function registerWidgetViews(bundle: ErpWidgetBundle): void {
  const problem = bundleProblem(bundle)
  if (problem) throw new CatalogRegistrationError(problem)
  replaceErpWidgetBundle(bundle)
}

/**
 * Inscrit les fonctions de l'ERP (H108). Toute la liste est validée d'abord : forme du nom, espace de
 * noms libre (ni celui d'une autre source, ni celui des contrats non appelables), doublon, origine,
 * classe, description, schéma (écrit en JSON Schema, fermé à chaque niveau), exemples, récapitulatif
 * d'une fonction sensible, suites connues du catalogue. Au premier refus, `CatalogRegistrationError` et rien n'est inscrit (NH3) ; sinon la liste
 * remplace toute la source ERP, et un rechargement à chaud ne double rien (NH1).
 */
export function registerFunctions(functions: readonly ErpFunction[]): void {
  const others = catalogFunctions().filter((fn) => fn.origin !== "erp")
  const reserved = new Set([...others.map((fn) => fn.name), ...contractNames()].map(namespaceOf))
  const seen = new Set<string>()
  for (const fn of functions) {
    const problem = functionProblem(fn, reserved) ?? (seen.has(fn.name) ? `Duplicate function ${fn.name} in registerFunctions.` : null)
    if (problem) throw new CatalogRegistrationError(problem)
    seen.add(fn.name)
  }
  const known = new Set([...others, ...functions].map((fn) => fn.name))
  for (const fn of functions) {
    const unknown = (fn.next ?? []).find((next) => !known.has(next))
    if (unknown !== undefined) throw new CatalogRegistrationError(`${fn.name}: next cites unknown function ${unknown}.`)
  }
  replaceErpFunctions(functions)
}
