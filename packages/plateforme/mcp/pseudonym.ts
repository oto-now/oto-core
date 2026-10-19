// La porte de la pseudonymisation dans le serveur MCP (`pseudonymisation.md` § La porte : inventaire des sorties vers
// l'assistant) : le résultat d'un outil avant `formatResult` (texte, données, suite), pour que la coupe à 45 000
// caractères se mesure sur ce qui part ; le message d'un refus ; les prompts (titre, description, message ; un nom
// qui nomme une personne n'est pas servi). `next_actions` (des noms de fonctions), la vue et `new_ctx` (un code) ne
// passent pas. Sans ce module, tout ce que lit l'assistant partirait en clair chez le fournisseur du modèle.
import type { PlatformDb } from "../server/db"
import type { Identity } from "../server/identity"
import { PlatformError } from "../server/errors"
import { getPrompt, type ProcedurePrompt, unknownPromptMessage } from "../server/prompts"
import { checkTokens, designatedText } from "../server/pseudonym/arguments"
import { resolvedPath, type TokenInputs } from "../server/pseudonym/inputs"
import type { Pseudonymizer } from "../server/pseudonym/service"
import type { ToolOutput } from "../server/tool-output"
import type { ToolKey } from "./tools"

/** Le résultat d'un outil tel qu'il part : texte, données et suite pseudonymisés ; le reste (journal, vue) intact. */
export function gatedOutput(gate: Pseudonymizer | null, output: ToolOutput): ToolOutput {
  if (!gate) return output
  return {
    ...output,
    text: gate.text(output.text),
    ...(output.data ? { data: gate.json(output.data) } : {}),
    ...(output.continuation ? { continuation: gate.text(output.continuation) } : {}),
  }
}

/**
 * `prompts/list` : titre et description pseudonymisés. Le nom d'un prompt (le dernier segment du chemin) est de l'ASCII
 * que Claude Code met dans une commande (`PROMPT_NAME_MAX`) : un nom qui nomme une personne déclarée ne peut porter de
 * jeton ; le prompt n'est pas listé (la procédure reste lisible par `read` et `find`, son chemin pseudonymisé).
 */
export function gatedPrompts(gate: Pseudonymizer | null, prompts: ProcedurePrompt[]): ProcedurePrompt[] {
  if (!gate) return prompts
  return prompts.filter((prompt) => gate.text(prompt.name) === prompt.name).map((prompt) => ({ ...prompt, title: gate.text(prompt.title), description: gate.text(prompt.description) }))
}

/** `prompts/get` : un nom qui nomme une personne déclarée est inconnu, comme à la liste ; description et message pseudonymisés. */
export async function gatedPrompt(db: PlatformDb, identity: Identity, gate: Pseudonymizer | null, name: string) {
  if (gate && gate.text(name) !== name) throw new PlatformError("not_found", unknownPromptMessage(gate.text(name)))
  const prompt = await getPrompt(db, identity, name)
  return {
    description: gate ? gate.text(prompt.description) : prompt.description,
    messages: [{ role: "user" as const, content: { type: "text" as const, text: gate ? gate.text(prompt.text) : prompt.text } }],
  }
}

/**
 * Les arguments d'un outil tels que reçus, avant leur schéma, leurs jetons résolus (`pseudonymisation.md` § Les jetons dans les
 * arguments) : la phrase de `context` et la requête de `find` reçoivent la désignation de l'entité ; le chemin de `read`
 * et de `write` sa forme en chemin ; le contenu de `write` garde ses jetons, connus. `call` se résout dans `runCall`, qui
 * connaît la fonction ; le texte d'un retour garde ses jetons tels quels.
 */
export async function resolvedToolInput(inputs: TokenInputs | null, key: ToolKey, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!inputs) return input
  const { dictionary } = inputs
  if (key === "context") return typeof input.phrase === "string" ? { ...input, phrase: designatedText(dictionary, input.phrase, "content") } : input
  if (key === "find" && typeof input.query === "string") return { ...input, query: designatedText(dictionary, input.query) }
  if ((key === "read" || key === "write") && typeof input.path === "string") {
    const resolved = { ...input, path: await resolvedPath(inputs, input.path) }
    checkTokens(dictionary, resolved, "content")
    return resolved
  }
  return input
}
