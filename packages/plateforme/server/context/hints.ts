// Ce que `context` propose quand aucune procédure ne convient à la demande (1.4.3) : les fonctions dont la description y
// répond (`searchFunctions`, trois au plus) et la section du guide de la plateforme la plus proche (`help`). Sans lui,
// « exporte toutes les pages de l'équipe SAV » répondait « no procedure matches », alors que `node.export_tree` le fait.
// 1.4.12 : une demande qui mène à la section des procédures (en écrire, en modifier une) reçoit sa notice entière, pas
// seulement le chemin pour la lire.
import type { CatalogFunction } from "../catalog/define"
import { assistantFunctions, isActive, searchFunctions } from "../catalog/registry"
import { loadActiveConnectors } from "../connectors/activations"
import type { PlatformDb } from "../db"
import { firstSentence } from "../find"
import { closestHelpSection } from "../help"
import type { Identity } from "../identity"

/** La part des mots de la demande qu'une fonction doit couvrir pour être proposée : un mot sur quatre. */
const FUNCTION_SCORE_MIN = 0.25
/**
 * Et au moins deux mots : un seul mot commun ne dit pas de quoi parle la demande, « créer une tâche » proposait
 * `node.export_tree` et `node.import_tree`.
 */
const FUNCTION_WORDS_MIN = 2

export type RoutingHints = { functions: { name: string; sentence: string }[]; help: { id: string; title: string; text?: string } | null }

/**
 * Les fonctions actives de l'organisation qui répondent à la demande, et la section du guide la plus proche ; une panne de
 * lecture des connecteurs ne prive que des fonctions.
 */
export async function routingHints(db: PlatformDb, identity: Identity, phrase: string): Promise<RoutingHints> {
  const active = await loadActiveConnectors(db, identity.org.id).catch((error: unknown) => {
    console.error("[platform] context: active connectors read failed", error)
    return null
  })
  const functions = active === null ? [] : proposedFunctions(assistantFunctions().filter((fn) => isActive(fn, active)), phrase)
  return { functions, help: closestHelpSection(phrase) }
}

/** Les fonctions proposées pour une demande, trois au plus, parmi celles reçues : la règle seule, sans lecture. */
export function proposedFunctions(functions: readonly CatalogFunction[], phrase: string): RoutingHints["functions"] {
  return searchFunctions(functions, phrase, 3)
    .filter(({ score, hits }) => score >= FUNCTION_SCORE_MIN && hits >= FUNCTION_WORDS_MIN)
    .map(({ fn }) => ({ name: fn.name, sentence: firstSentence(fn.description) }))
}

/** Les lignes des propositions, après la ligne du routage ; rien quand il n'y a rien à proposer. */
export function hintLines(hints: RoutingHints | undefined, prefix: string): string[] {
  if (!hints) return []
  const functions =
    hints.functions.length === 0
      ? []
      : [`Functions that may do it (read a contract with ${prefix}_read path <function>, run it with ${prefix}_call):`, ...hints.functions.map((one) => `- ${one.name}: ${one.sentence}`)]
  const help = !hints.help
    ? []
    : hints.help.text
      ? [`From the platform guide (section ${hints.help.id}):`, hints.help.text.replaceAll("<p>", prefix)]
      : [`Platform guide: ${prefix}_read {"path": "help", "section": "${hints.help.id}"} (${hints.help.title}).`]
  return [...functions, ...help]
}
