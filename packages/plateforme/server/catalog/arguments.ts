// Les arguments d'une fonction du catalogue sous ses deux formes (`connecteurs-et-comptes.md` § Moteur des connecteurs
// décrits) : un schéma Zod strict pour une fonction native ou de l'ERP, un JSON Schema 2020-12 pour une fonction de
// connecteur décrit, validé tel quel par Ajv et servi tel quel par `read`, sans traduction en Zod. Sans ce module,
// `call`, `read` et le contrôle d'une procédure ne liraient que la forme Zod.
import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020"
import * as z from "zod/v4"
import type { CatalogFunction } from "./define"

/** Le mot d'un JSON Schema, ou la clé de `.meta()` d'un schéma Zod, qui marque un argument « donnée personnelle ». */
export const PERSONAL_KEYWORD = "personal"

/** Le JSON Schema d'entrée d'une fonction de connecteur décrit, compilé une fois à la déclaration. */
export class JsonSchemaArguments {
  constructor(
    readonly json: Readonly<Record<string, unknown>>,
    readonly validate: ValidateFunction,
  ) {}
}

/** Un problème d'arguments, chemin par chemin : `code` vaut `unrecognized_keys` pour une clé inconnue, comme Zod. */
export type ArgumentIssue = { path: PropertyKey[]; message: string; code: string }

export type ArgumentsCheck = { success: true; data: Record<string, unknown> } | { success: false; issues: ArgumentIssue[] }

let validator: Ajv2020 | null = null

/**
 * Ajv 2020 : `format` reste une annotation (comme le test des descriptions du dépôt `connectors`), `required` peut nommer
 * une propriété que `properties` ne déclare pas (`strictRequired: false`), un `type` en liste (`["string", "null"]`,
 * permis par JSON Schema) passe sans avertissement (`allowUnionTypes`), toutes les erreurs sont rendues.
 */
function ajv(): Ajv2020 {
  if (validator) return validator
  validator = new Ajv2020({ allErrors: true, strictRequired: false, validateFormats: false, allowUnionTypes: true })
  // `personal: true` marque un argument « donnée personnelle », jamais journalisé (`personal.ts`) : une annotation, sans
  // effet sur la validation ; sans elle, le mode strict d'Ajv refuserait le mot inconnu à la déclaration.
  validator.addKeyword({ keyword: PERSONAL_KEYWORD, schemaType: "boolean" })
  return validator
}

/** Compile un JSON Schema d'entrée ; lève l'erreur d'Ajv, que `registerConnectors` rend en refus nommé. */
export function compileJsonArguments(json: Readonly<Record<string, unknown>>): JsonSchemaArguments {
  return new JsonSchemaArguments(json, ajv().compile(json))
}

/** `/ledger_entry_lines/0/debit` → `["ledger_entry_lines", 0, "debit"]` (pointeur JSON, RFC 6901). */
function pointerPath(pointer: string): PropertyKey[] {
  if (!pointer) return []
  return pointer
    .slice(1)
    .split("/")
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"))
    .map((segment) => (/^\d+$/.test(segment) ? Number(segment) : segment))
}

function ajvIssue(error: ErrorObject): ArgumentIssue {
  const path = pointerPath(error.instancePath)
  if (error.keyword === "required") return { path: [...path, String(error.params.missingProperty)], message: "Required", code: "required" }
  if (error.keyword === "additionalProperties") {
    return { path, message: `Unrecognized key: "${String(error.params.additionalProperty)}"`, code: "unrecognized_keys" }
  }
  return { path, message: error.message ?? `fails ${error.keyword}`, code: error.keyword }
}

/** Les arguments validés : la sortie de Zod (défauts posés), ou les arguments tels quels pour un JSON Schema. */
export function checkArguments(schema: CatalogFunction["schema"], args: Record<string, unknown>): ArgumentsCheck {
  if (schema instanceof JsonSchemaArguments) {
    if (schema.validate(args)) return { success: true, data: args }
    return { success: false, issues: (schema.validate.errors ?? []).map(ajvIssue) }
  }
  const parsed = schema.safeParse(args)
  if (parsed.success) return { success: true, data: parsed.data }
  return { success: false, issues: parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message, code: issue.code })) }
}

/**
 * Le JSON Schema servi par `read`, sans `$schema` : celui de la description tel quel, ou celui de Zod côté entrée, un
 * champ à défaut facultatif (E08-S05, NH8).
 */
export function argumentsJsonSchema(schema: CatalogFunction["schema"]): Record<string, unknown> {
  const json: Record<string, unknown> = schema instanceof JsonSchemaArguments ? structuredClone({ ...schema.json }) : z.toJSONSchema(schema, { io: "input" })
  delete json.$schema
  return json
}

/** Les noms des arguments de premier niveau, dans l'ordre du schéma. */
export function argumentNames(schema: CatalogFunction["schema"]): string[] {
  if (!(schema instanceof JsonSchemaArguments)) return Object.keys(schema.shape)
  const properties = schema.json.properties
  return typeof properties === "object" && properties !== null ? Object.keys(properties) : []
}
