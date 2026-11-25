// Entrées des six outils (H22) : une seule source pour la validation (dans l'adaptateur) et pour
// le JSON Schema servi aux hosts (`z.toJSONSchema`). `zod/v4` : Zod 3 n'a pas `toJSONSchema`, et des
// JSON Schema écrits à la main seraient une seconde source qui diverge (H21).
//
// Schémas PLATS (ADR-002 § 5) : ChatGPT ne montre pas au modèle les descriptions imbriquées. Seuls
// `write.ops`, `write.header`, `read.arguments` et `call.arguments` sont des objets ; leur forme est répétée dans la
// description de l'outil. Surface figée dès qu'un host a lu la liste : on ajoute un champ
// facultatif, on ne modifie rien (ADR-002 § 1).
//
// Repris de la maquette (`mcp-test/src/proto/schemas.ts` l. 16-117) : `zod/v4`, `toInputSchema`,
// `parseInput`. Retiré : `triggers` et `neighbors` de `write` (P37) ; `kind` gagne `table`.
//
// `read` et `write` sont composés des entrées partagées avec l'API (`schemas/nodes.ts`, E03-S03) :
// mêmes champs, même ordre, mêmes descriptions ; seuls les ajouts d'E03-S03 changent leur JSON Schema.
import * as z from "zod/v4"
import { feedbackInputSchema, feedbackTypeSchema, readNodeSchema, refinePathOrId, refineReadTarget, strictWriteOpsSchema, writeNodeSchema, writeOpSchema } from "../schemas"
import { boundedList, issuesText } from "../server/errors"
import { cut } from "../server/journal"
import type { ToolKey } from "./tools"

/** Une clé inconnue redite dans un refus : son nom vient de l'appelant, sans borne propre. */
const MAX_KEY_CHARS = 60

function ctxField(prefix: string) {
  return z.string().describe(`ctx code returned by ${prefix}_context, e.g. 7K3Q-M2XA. Required: call ${prefix}_context first.`)
}

export function inputSchemas(prefix: string) {
  const ctx = ctxField(prefix)
  // L'équipe et le compte d'une exécution, les mêmes pour `call` et pour `read` qui exécute une fonction de pure lecture.
  const team = z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .describe("Slug of the team the call runs for, e.g. ventes; only when a result says the team is ambiguous (default: chosen by the server).")
  const account = z
    .string()
    .trim()
    .min(1)
    .max(200)
    .optional()
    .describe(`Label of the connector account to use, e.g. "Mail Ventes"; only when the user names one (default: resolved by the server).`)
  return {
    context: z.object({
      phrase: z
        .string()
        .max(2000)
        .optional()
        .describe(
          `The user's request, verbatim and in their language, e.g. "Relance les devis en attente". Omit when there is no request yet, or when the request does not concern this workspace's work (default: none).`,
        ),
      // E11-S19 (AC-c1 à AC-c3) : `context` léger, ajouté facultatif (ADR-002 § 1).
      since_ctx: z
        .string()
        .max(100)
        .optional()
        .describe(
          `The ctx of an earlier ${prefix}_context call in this conversation: then only the routing of the phrase, the contexts changed since and a ctx come back, not the whole context (default: none, the whole context).`,
        ),
    }),
    find: z.object({
      ctx,
      query: z.string().trim().min(1).max(500).describe(`Words to search for, e.g. "relance devis" or "grille tarifaire".`),
      type: z
        .enum(["procedure", "page", "table", "function"])
        .optional()
        .describe("Restrict to one kind of result: procedure, page, table or function (default: all kinds, functions included)."),
    }),
    // `path` ou `id`, jamais les deux (`refineReadTarget`) : un JSON Schema plat ne le dit pas (ADR-002 § 5), la description le dit.
    // `arguments`, `team` et `account` : `read` exécute une fonction de pure lecture (`runRead`), ajouts facultatifs (ADR-002).
    read: z
      .object({
        ctx,
        ...readNodeSchema.shape,
        arguments: z
          .record(z.string(), z.unknown())
          .optional()
          .describe(
            `With path = a function name: runs it with these arguments, as its contract says, if it only reads and costs nothing; any other function runs with ${prefix}_call (default: none, the contract is returned).`,
          ),
        team,
        account,
      })
      .superRefine(refineReadTarget),
    call: z.object({
      ctx,
      function: z.string().trim().min(1).max(100).describe("Function name, e.g. table.rows or mail.create_draft."),
      arguments: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(`Arguments of the function, as its contract says; read it with ${prefix}_read, path = the function name (default {}).`),
      confirm: z
        .boolean()
        .optional()
        .describe("true only after the user explicitly approved the summary of a sensitive function, or the content it sends (default false)."),
      team,
      account,
    }),
    // `header` garde sa place dans l'objet (la clé existe déjà dans la forme étalée) ; seule sa
    // description, qui cite le préfixe, est posée ici.
    write: z.object({
      ctx,
      ...writeNodeSchema.shape,
      ops: strictWriteOpsSchema,
      header: writeNodeSchema.shape.header.describe(`Header of a table; its contract: ${prefix}_read with path write.table (default: unchanged).`),
    }).superRefine(refinePathOrId()),
    // Les champs de `schemas/feedback.ts` (E03-S05), partagés avec l'administration des retours ;
    // descriptions et ordre des champs inchangés : même JSON Schema qu'en E03-S01.
    feedback: z.object({
      ctx,
      type: feedbackTypeSchema.describe("friction: unclear or slow; gap: missing capability or content; error: a tool failed."),
      text: feedbackInputSchema.shape.text.describe("What happened, what you expected, and the call involved; 4,000 characters max."),
      target: feedbackInputSchema.shape.target.describe(
        "Tool, function or path concerned, e.g. table.rows or ventes/relance_devis (default: none).",
      ),
    }),
  } satisfies Record<ToolKey, z.ZodObject>
}

export type InputSchemas = ReturnType<typeof inputSchemas>
export type ToolInput<K extends ToolKey> = z.output<InputSchemas[K]>

/** JSON Schema servi dans `tools/list`, sans la clé `$schema` que les hosts n'utilisent pas. */
export function toInputSchema(schema: z.ZodObject): Record<string, unknown> {
  const json: Record<string, unknown> = z.toJSONSchema(schema)
  delete json.$schema
  return json
}

/**
 * Lecture des arguments ; les problèmes sont rendus au modèle, chemin par chemin (AC14), les 20
 * premiers seulement, puis leur nombre restant (« … and 980 more », N30) : même formateur que les
 * refus de saisie des services (`issuesText`). Une clé inconnue à la racine est refusée, comme le schéma servi le dit
 * (`additionalProperties: false`), nommée avec les clés de l'outil : retirée en silence, un `text` passé à `write`
 * créait une page vide. De même dans une opération de `write` (`ops.<rang>`), nommée avec les clés d'une opération.
 */
export function parseInput<S extends z.ZodObject>(schema: S, args: unknown): { data: z.output<S> } | { issues: string } {
  const result = schema.strict().safeParse(args)
  // `strict()` ne change que le sort des clés inconnues : la sortie est celle de `schema`, que TypeScript ne relie pas.
  if (result.success) return { data: result.data as z.output<S> }
  const problems = result.error.issues.map((issue) => {
    if (issue.code !== "unrecognized_keys") return issuesText([issue])
    // Seuls la racine et les opérations de `write` sont des objets stricts de ces schémas.
    const accepted = Object.keys(issue.path.length === 0 ? schema.shape : writeOpSchema.shape).join(", ")
    const where = issue.path.length === 0 ? "" : `${issue.path.map(String).join(".")}: `
    return `${where}unknown ${issue.keys.length > 1 ? "keys" : "key"} ${boundedList(issue.keys.map((key) => `« ${cut(key, MAX_KEY_CHARS)} »`))}; keys: ${accepted}`
  })
  return { issues: boundedList(problems, "; ") }
}
