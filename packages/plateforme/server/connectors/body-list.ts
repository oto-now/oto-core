// Le corps en liste d'une fonction décrite (`connecteurs-et-comptes.md` § Moteur des connecteurs décrits ; `connectors :
// docs/conception/corps-de-requete.md` § Le corps en liste, décidé le 2026-11-11) : `request.bodyList` envoie le corps
// construit, table ou argument entier, seul élément d'une liste JSON (`engine.ts`) ; et sa déclaration contrôlée comme
// la règle 23 de la fabrique, avec ses codes. Sans ce module, un tiers dont le corps est un tableau nu d'une tâche
// (DataForSEO) ne se décrirait pas.
import { bodyArgument, bodyTable } from "./body-argument"
import type { ConnectorFunctionDefinition } from "./definition"

/**
 * Le problème d'un corps en liste, comme la règle 23 de la fabrique et dans son ordre, le message finissant par son
 * code ; `null` : aucun, ou pas de drapeau. La fonction a un corps (une table non vide, l'argument entier ou une
 * constante du corps), une méthode qui en envoie un, et aucune partie fichier.
 */
export function bodyListProblem(fn: ConnectorFunctionDefinition): string | null {
  const spec = fn.request
  if (spec.bodyList === undefined) return null
  const at = `${fn.name}: request.bodyList`
  if (spec.bodyList !== true) return `${at} is true or absent (body_list_not_true).`
  const hasBody = bodyArgument(spec) !== null || Object.keys(bodyTable(spec)).length > 0 || spec.constants?.body !== undefined
  if (!hasBody) return `${at} sends the body as a list, and the function has no body to put in it (body_list_without_body).`
  if (spec.method === "GET") return `${at} needs a method that sends a body, not GET (body_list_method).`
  if (spec.files !== undefined) return `${at}: a multipart body (files) is a form, never a JSON list (body_list_multipart).`
  return null
}
