// Opérations d'`admin_connector` sur les connecteurs privés d'une organisation (`connecteurs-prives.md` § Administration) :
// les lister, en lire un et ses versions, en enregistrer un (son premier temps est le contrôle à blanc), revenir à une
// version, le retirer ; les trois écritures en deux temps. Chaque écriture se lit au journal d'administration, sa cible
// nommant l'espace et la version. Aucun droit ne se décide ici : le service réserve l'écriture à l'équipe plateforme.
import * as z from "zod/v4"
import { orgSlugSchema } from "../../../schemas"
import { PlatformError } from "../../../server/errors"
import {
  checkPrivateConnector,
  PRIVATE_CONNECTOR_FORBIDDEN,
  listPrivateConnectors,
  readPrivateConnector,
  removePrivateConnector,
  restorePrivateConnector,
  savePrivateConnector,
  type PrivateConnectorOutcome,
  type PrivateConnectorView,
} from "../../../server/private-connectors/service"
import type { PrivateConnectorProblem } from "../../../server/private-connectors/validation"
import { listLines, nothingWas, targetOf, type AdminOutput, type OpCall, type OpTable } from "../ops"

/** Au plus, les problèmes d'un refus montrés. */
const PROBLEMS_SHOWN = 50
const AFTER_WRITE = ["admin_connector private_connector"]

const problemLine = (problem: PrivateConnectorProblem) =>
  `- ${problem.code}${problem.rule ? ` (${problem.rule})` : ""}${problem.path ? ` at ${problem.path}` : ""}: ${problem.message}`

const problemLines = (problems: readonly PrivateConnectorProblem[]) => listLines(problems, problemLine, { max: PROBLEMS_SHOWN })

/** La ligne d'un connecteur privé : espace, libellé, version servie, fonctions, ou retiré. */
function viewLine(view: PrivateConnectorView): string {
  const state = view.removedAt ? `removed on ${view.removedAt}` : `served since ${view.savedAt}`
  return `${view.namespace} (${view.label}): version ${view.version}, ${view.functions} function${view.functions === 1 ? "" : "s"}, ${state}`
}

/** Un connecteur privé dans les données d'une réponse, sans sa définition (`private_connector` la sert). */
const summaryOf = (view: PrivateConnectorView) => ({ ...view, document: undefined })

const FORBIDDEN_REFUSAL = `forbidden: ${PRIVATE_CONNECTOR_FORBIDDEN}`

/** La cible d'une écriture au journal : l'espace et la version servie après elle. */
const targetOfView = (view: PrivateConnectorView) => `private_connector:${view.namespace} v${view.version}`

async function list(call: OpCall): Promise<AdminOutput> {
  const identity = targetOf(call)
  const views = await listPrivateConnectors(call.deps.db, identity)
  const text = views.length === 0 ? `${identity.org.slug} has no private connector.` : [`Private connectors of ${identity.org.slug}:`, ...listLines(views, viewLine)].join("\n")
  return { text, data: { private_connectors: views.map(summaryOf) }, target: "private_connectors", nextActions: AFTER_WRITE }
}

async function read(call: OpCall): Promise<AdminOutput> {
  const identity = targetOf(call)
  const namespace = String(call.input.namespace)
  const version = typeof call.input.version === "number" ? call.input.version : undefined
  const detail = await readPrivateConnector(call.deps.db, identity, namespace, version)
  const shown = version ?? detail.version
  const lines = [
    viewLine(detail),
    "Versions:",
    ...listLines(detail.versions, (item) => `- ${item.version}, saved ${item.savedAt}${item.restoredFrom ? `, back to version ${item.restoredFrom}` : ""}`),
    `Definition of version ${shown}:`,
    JSON.stringify(detail.document, null, 2),
  ]
  return { text: lines.join("\n"), data: { private_connector: detail }, target: `private_connector:${namespace}`, nextActions: [] }
}

/** Le texte d'une écriture faite, refusée, ou sans effet. */
function outcomeOutput(org: string, outcome: PrivateConnectorOutcome, done: string): AdminOutput {
  if (outcome.kind === "refused") {
    const kept = outcome.current && !outcome.current.removedAt ? `version ${outcome.current.version} stays served` : "nothing is served under this namespace"
    const text = [`Refused: nothing was saved, ${kept}. Problems:`, ...problemLines(outcome.problems)].join("\n")
    return { text, data: { outcome: "refused", problems: outcome.problems }, target: "private_connector", nextActions: [] }
  }
  const head =
    outcome.kind === "saved"
      ? `${done}: ${outcome.view.namespace} of ${org} is served at version ${outcome.view.version}.`
      : `${outcome.view.namespace} of ${org} already serves this definition (version ${outcome.view.version}): nothing changed.`
  return { text: head, data: { outcome: outcome.kind, private_connector: summaryOf(outcome.view) }, target: targetOfView(outcome.view), nextActions: AFTER_WRITE }
}

async function save(call: OpCall): Promise<AdminOutput> {
  const { db } = call.deps
  const identity = targetOf(call)
  const org = identity.org.slug
  const definition = parsedDefinition(String(call.input.definition))
  if (call.input.confirm !== true) {
    const checked = await checkPrivateConnector(db, identity, definition)
    if (checked.problems.length > 0) {
      const text = [`The definition is refused (${checked.problems.length} problem${checked.problems.length === 1 ? "" : "s"}); nothing was saved. Fix them all, then call again.`, ...problemLines(checked.problems)].join("\n")
      return { text, data: { problems: checked.problems }, target: "private_connector", nextActions: [] }
    }
    const current = checked.current
    const head = current
      ? `About to save a new version of ${checked.namespace} (served: version ${current.version}${current.removedAt ? ", removed" : ""}); it will be served to ${org} at once.`
      : `About to create the private connector ${checked.namespace} in ${org}, served at once; its members then set its keys in the Connectors screen.`
    return { text: [`The definition is valid. ${head}`, nothingWas("saved")].join("\n"), data: { problems: [], namespace: checked.namespace }, target: "private_connector", nextActions: [] }
  }
  return outcomeOutput(org, await savePrivateConnector(db, identity, definition), "Saved")
}

async function restore(call: OpCall): Promise<AdminOutput> {
  const { db } = call.deps
  const identity = targetOf(call)
  const namespace = String(call.input.namespace)
  const version = Number(call.input.version)
  if (call.input.confirm !== true) {
    const detail = await readPrivateConnector(db, identity, namespace, version)
    const head = `About to serve again version ${version} of ${namespace} as a new version (served: version ${detail.version}${detail.removedAt ? ", removed" : ""}); it is checked again first.`
    return { text: [head, nothingWas("changed")].join("\n"), data: { namespace, version }, target: `private_connector:${namespace}`, nextActions: [] }
  }
  return outcomeOutput(identity.org.slug, await restorePrivateConnector(db, identity, namespace, version), `Back to version ${version}`)
}

async function remove(call: OpCall): Promise<AdminOutput> {
  const { db } = call.deps
  const identity = targetOf(call)
  const namespace = String(call.input.namespace)
  if (call.input.confirm !== true) {
    const detail = await readPrivateConnector(db, identity, namespace)
    const head = `About to stop serving ${namespace} (version ${detail.version}) in ${identity.org.slug}; its versions are kept, and saving it again serves it back.`
    return { text: [head, nothingWas("changed")].join("\n"), data: { namespace }, target: `private_connector:${namespace}`, nextActions: [] }
  }
  const view = await removePrivateConnector(db, identity, namespace)
  return { text: `${namespace} of ${identity.org.slug} is no longer served; its versions are kept.`, data: { private_connector: summaryOf(view) }, target: `${targetOfView(view)} removed`, nextActions: AFTER_WRITE }
}

/**
 * La définition passée en texte JSON : un schéma d'outil plat n'a ni objet ni liste (ADR-002 § 5). Un texte qui n'est
 * pas du JSON est refusé ici ; sa forme, par le contrôle du service, qui nomme chaque problème.
 */
function parsedDefinition(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    throw new PlatformError("invalid_arguments", "definition is not JSON: pass the definition as JSON text, {\"connector\": {…}, \"functions\": […]}.")
  }
}

const namespace = z.string().trim().min(1).max(40)
const version = z.number().int().min(1)
/** Le plafond des arguments d'un appel MCP borne déjà le texte ; le profil, la définition (256 Ko). */
const definition = z.string().min(2)

export const PRIVATE_CONNECTOR_OPS: OpTable = {
  private_connectors: {
    schema: z.object({ org: orgSlugSchema }),
    org: "target",
    twoStep: false,
    summary: "Lists the private connectors of the organisation: namespace, label, served version, number of functions, or removed.",
    example: { org: "acme" },
    refusals: [],
    run: list,
  },
  private_connector: {
    schema: z.object({ org: orgSlugSchema, namespace, version: version.optional() }),
    org: "target",
    twoStep: false,
    summary: "Shows one private connector: its versions and the definition served (or of the version given).",
    example: { org: "acme", namespace: "custom_erp" },
    refusals: ["not_found: No private connector <namespace> in this organisation.", "not_found: <namespace> has no version <version>."],
    run: read,
  },
  save_private_connector: {
    schema: z.object({ org: orgSlugSchema, definition, confirm: z.boolean().optional() }),
    org: "target",
    twoStep: true,
    summary:
      "Checks a private connector definition (a Custom API connector.yaml as JSON text, namespace custom_…) and names all its problems; with confirm: true, saves it as the served version of its namespace. A refused definition keeps the previous version served.",
    example: { org: "acme", definition: '{"connector": {"name": "custom_erp", "namespace": "custom_erp", …}, "functions": […]}' },
    refusals: [FORBIDDEN_REFUSAL, "invalid_arguments: definition is not JSON: pass the definition as JSON text, {\"connector\": {…}, \"functions\": […]}."],
    run: save,
  },
  restore_private_connector: {
    schema: z.object({ org: orgSlugSchema, namespace, version, confirm: z.boolean().optional() }),
    org: "target",
    twoStep: true,
    summary: "Serves a past version of a private connector again, checked again first, as a new version.",
    example: { org: "acme", namespace: "custom_erp", version: 2 },
    refusals: [FORBIDDEN_REFUSAL, "not_found: No private connector <namespace> in this organisation.", "not_found: <namespace> has no version <version>."],
    run: restore,
  },
  remove_private_connector: {
    schema: z.object({ org: orgSlugSchema, namespace, confirm: z.boolean().optional() }),
    org: "target",
    twoStep: true,
    summary: "Stops serving a private connector; its versions are kept, and saving or restoring it serves it again.",
    example: { org: "acme", namespace: "custom_erp" },
    refusals: [FORBIDDEN_REFUSAL, "not_found: No private connector <namespace> served in this organisation."],
    run: remove,
  },
}
