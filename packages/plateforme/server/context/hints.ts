// Ce que `context` propose pour une demande (1.4.3) : les fonctions dont la description y répond (`rankFunctions`, trois
// au plus), et, quand aucune procédure ne convient, la section du guide de la plateforme la plus proche (`help`). Sans
// lui, « exporte toutes les pages de l'équipe SAV » répondait « no procedure matches », alors que `node.export_tree` le
// fait. 1.4.12 : une demande qui mène à la section des procédures (en écrire, en modifier une) reçoit sa notice entière,
// pas seulement le chemin pour la lire. Les fonctions sont proposées aussi sous une procédure servie : une demande que la
// procédure ne couvre pas en entier (« mets à jour mon template Brevo » sous une procédure d'envoi) n'en recevait aucune.
import type { CatalogFunction } from "../catalog/define"
import { firstSentence, MISSING_MARK, missingLines, rankFunctions, usableFirst, type Missing } from "../catalog/ranking"
import { assistantFunctions, catalogNames, isActive } from "../catalog/registry"
import { loadOpenConnectors } from "../connectors/activations"
import { usablePredicate } from "../connectors/usable-accounts"
import type { PlatformDb } from "../db"
import { closestHelpSection } from "../help"
import type { Identity } from "../identity"

/** Les fonctions proposées au plus. */
const PROPOSED_MAX = 3

/** `missing` : ce qui manque pour appeler la fonction (`usableFirst`), un compte à brancher ou un accès à demander. */
export type RoutingHints = { functions: { name: string; sentence: string; missing?: Exclude<Missing, null> }[]; help: { id: string; title: string; text?: string } | null }

/**
 * Les fonctions ouvertes de l'organisation (tout connecteur déclaré non bloqué) qui répondent à la demande, trois au plus,
 * et, sans procédure servie (`served` faux), la section du guide la plus proche ; une panne de lecture des connecteurs, ou
 * du classement, ne prive que des fonctions. Le catalogue ouvert n'entre jamais entier dans `context` : seules ces pistes
 * bornées, choisies par la demande.
 * `used` : les cibles récentes de la personne que le routage a déjà lues (`usedPaths`), le bonus d'usage des fonctions.
 * Les connecteurs dont elle sert un compte (`usablePredicate`) se lisent en même temps, s'il y a une fonction à compte au
 * catalogue : celles qu'elle peut appeler passent devant ; leur panne ne fait que ne plus départager.
 */
export async function routingHints(
  db: PlatformDb,
  identity: Identity,
  phrase: string,
  request: { served: boolean; used: Promise<ReadonlySet<string>> },
): Promise<RoutingHints> {
  const catalog = assistantFunctions()
  const [active, used, usable] = await Promise.all([
    loadOpenConnectors(db, identity.org.id).catch((error: unknown) => {
      console.error("[platform] context: open connectors read failed", error)
      return null
    }),
    request.used,
    usablePredicate(db, identity, catalog, "context"),
  ])
  const functions = active === null ? [] : safelyProposed(catalog.filter((fn) => isActive(fn, active)), phrase, used, usable)
  return { functions, help: request.served ? null : closestHelpSection(phrase) }
}

/** Les propositions, ou aucune si le classement lève : `context` répond toujours (N17). */
function safelyProposed(
  functions: readonly CatalogFunction[],
  phrase: string,
  used: ReadonlySet<string>,
  usable: ((fn: CatalogFunction) => Missing) | undefined,
): RoutingHints["functions"] {
  try {
    return proposedFunctions(functions, phrase, used, usable)
  } catch (error) {
    console.error("[platform] context: function ranking failed", error)
    return []
  }
}

/**
 * Les fonctions proposées pour une demande, trois au plus, parmi celles reçues, celles que la personne peut appeler
 * devant (`usable`, absent : toutes) : la règle seule, sans lecture.
 */
export function proposedFunctions(
  functions: readonly CatalogFunction[],
  phrase: string,
  used?: ReadonlySet<string>,
  usable?: (fn: CatalogFunction) => Missing,
): RoutingHints["functions"] {
  return usableFirst(rankFunctions(functions, phrase, functions.length, used), PROPOSED_MAX, usable).map(({ fn, missing }) => ({
    name: fn.name,
    sentence: firstSentence(fn.description),
    ...(missing ? { missing } : {}),
  }))
}

/**
 * Les lignes des propositions, après la ligne du routage ; rien quand il n'y a rien à proposer. Sous une procédure servie
 * (`served`), les fonctions se disent en recours, pour ne pas détourner l'assistant de la procédure.
 */
export function hintLines(hints: RoutingHints | undefined, prefix: string, served = false): string[] {
  if (!hints) return []
  const how = `read a contract with ${prefix}_read path <function>, run it with ${prefix}_call`
  const header = served ? `Functions close to the request, for what the procedure does not cover (${how}):` : `Functions that may do it (${how}):`
  const connect = missingLines(prefix, catalogNames().has("connector.connect"), hints.functions.map((one) => one.missing ?? null))
  const functions =
    hints.functions.length === 0 ? [] : [header, ...hints.functions.map((one) => `- ${one.name}${one.missing ? ` (${MISSING_MARK[one.missing]})` : ""}: ${one.sentence}`), ...connect]
  const help = !hints.help
    ? []
    : hints.help.text
      ? [`From the platform guide (section ${hints.help.id}):`, hints.help.text.replaceAll("<p>", prefix)]
      : [`Platform guide: ${prefix}_read {"path": "help", "section": "${hints.help.id}"} (${hints.help.title}).`]
  return [...functions, ...help]
}
