// La porte de la pseudonymisation dans le serveur MCP (`pseudonymisation.md` § La porte : inventaire des sorties vers
// l'assistant) : le résultat d'un outil avant `formatResult` (texte, données, suite), pour que la coupe à 45 000
// caractères se mesure sur ce qui part ; le message d'un refus ; les prompts (titre, description, message ; un nom
// qui nomme une personne n'est pas servi). `next_actions` (des noms de fonctions), la vue et `new_ctx` (un code) ne
// passent pas. Sans ce module, tout ce que lit l'assistant partirait en clair chez le fournisseur du modèle.
import type { PlatformDb } from "../server/db"
import type { Identity } from "../server/identity"
import { PlatformError } from "../server/errors"
import { getPrompt, type ProcedurePrompt, unknownPromptMessage } from "../server/prompts"
import type { Pseudonymizer } from "../server/pseudonym/service"
import type { ToolOutput } from "../server/tool-output"

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
