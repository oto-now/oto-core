// Opérations d'`admin_connector` sur l'API de l'hôte d'une organisation (`fonctions-d-un-hote.md` § Administration) :
// la lire (adresse, version, rafraîchissement, problèmes du dernier refus) et la régler ou la rafraîchir, en deux temps.
// Aucun droit ne se décide ici : le service réserve l'écriture à l'équipe plateforme et la base le tient (RLS).
import * as z from "zod/v4"
import { orgSlugSchema } from "../../../schemas"
import type { HostDocumentProblem } from "../../../server/host-api/document"
import { hostApi, refreshHostApi, type HostApiView } from "../../../server/host-api/service"
import { listLines, nothingWas, targetOf, type AdminOutput, type OpCall, type OpTable } from "../ops"

/** Au plus, les problèmes d'un refus montrés. */
const PROBLEMS_SHOWN = 50

const problemLine = (problem: HostDocumentProblem) => `- ${problem.code}${problem.path ? ` at ${problem.path}` : ""}: ${problem.message}`

/** L'état de l'API de l'hôte, ligne par ligne : servi, puis le dernier refus et ses problèmes. */
function stateLines(org: string, view: HostApiView | null): string[] {
  if (!view) return [`${org} has no host API set.`]
  const served = view.address ? `Served: ${view.address} (version ${view.version}, since ${view.servedAt}).` : "Served: nothing yet."
  const refused = view.refused
    ? [`Last refusal: ${view.refused.address} at ${view.refused.at}:`, ...listLines(view.refused.problems, problemLine, { max: PROBLEMS_SHOWN })]
    : ["No refusal since the last served document."]
  return [served, `Last refresh: ${view.refreshedAt}.`, ...refused]
}

const dataOf = (view: HostApiView | null) => ({ host_api: view })

async function read(call: OpCall): Promise<AdminOutput> {
  const identity = targetOf(call)
  const view = await hostApi(call.deps.db, identity)
  return { text: stateLines(identity.org.slug, view).join("\n"), data: dataOf(view), target: "host_api", nextActions: ["admin_connector refresh_host_api"] }
}

async function refresh(call: OpCall): Promise<AdminOutput> {
  const { db } = call.deps
  const identity = targetOf(call)
  const org = identity.org.slug
  const address = typeof call.input.address === "string" ? call.input.address : undefined
  if (call.input.confirm !== true) {
    const view = await hostApi(db, identity)
    const target = address ?? view?.address ?? "(no address: pass address)"
    const head = `About to read ${target}/openapi.json and, if the host profile accepts it, serve its functions to everyone in ${org} from now on. A refused document keeps the current one served.`
    return { text: [head, ...stateLines(org, view), nothingWas("read nor changed")].join("\n"), data: dataOf(view), target: "host_api", nextActions: [] }
  }
  const outcome = await refreshHostApi(db, identity, address ? { address } : {})
  const head =
    outcome.kind === "served"
      ? `Host API of ${org} served: version ${outcome.view.version}; its functions are in the catalogue at once.`
      : outcome.kind === "unchanged"
        ? `Host API of ${org} unchanged (version ${outcome.view.version}); refreshed.`
        : `The document was refused; ${outcome.view.address ? "the previous version stays served" : "nothing is served"}.`
  return { text: [head, ...stateLines(org, outcome.view)].join("\n"), data: { ...dataOf(outcome.view), outcome: outcome.kind }, target: "host_api", nextActions: ["admin_connector host_api"] }
}

const address = z.string().trim().min(1).max(2000)

export const HOST_API_OPS: OpTable = {
  host_api: {
    schema: z.object({ org: orgSlugSchema }),
    org: "target",
    twoStep: false,
    summary: "Shows the host API of the organisation: its address, served version, last refresh, and the problems of its last refused document.",
    example: { org: "acme" },
    refusals: [],
    run: read,
  },
  refresh_host_api: {
    schema: z.object({ org: orgSlugSchema, address: address.optional(), confirm: z.boolean().optional() }),
    org: "target",
    twoStep: true,
    summary:
      "Sets the address of the host API (https, no trailing slash) or refreshes the served one: reads <address>/openapi.json, judges it by the host profile and serves it if accepted; a refused document keeps the previous version served, and its problems are recorded.",
    example: { org: "acme", address: "https://erp.example.test" },
    refusals: [
      "forbidden: Setting the API of a host is reserved to the platform team.",
      "invalid_arguments: The address of the host's API must start with https:// (or another address problem).",
      "invalid_arguments: No address of the host's API is set yet: pass address (https://…).",
    ],
    run: refresh,
  },
}
