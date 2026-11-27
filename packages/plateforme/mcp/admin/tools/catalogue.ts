// `admin_connector catalogue` (E08-S06, AC7 ; N15) : les connecteurs activables de `listConnectorsForOrg`, puis les
// fonctions toujours actives lues au registre. Le catalogue entier dépasse le plafond de 45 000 caractères (H26) : il
// se sert par pages qui y tiennent (`fittedPage`, comme `admin_journal`), la suite par `next_cursor`, le nom du premier
// connecteur de la page suivante, et la coupe dit le total ; un filtre le resserre, sans casse ni accents.
import type { OrgConnector } from "../../../schemas"
import type { CatalogFunction } from "../../../server/catalog/define"
import { catalogFunctions } from "../../../server/catalog/registry"
import { listConnectorsForOrg } from "../../../server/connectors/activations"
import { isSimulatedConnector } from "../../../server/connectors/modes"
import { fittedPage, type PagePiece } from "../../../server/journal-model"
import { normalizedText } from "../../../server/pseudonym/normalize"
import { day, targetOf, type AdminOutput, type OpCall } from "../ops"

/** Un curseur qui ne nomme plus aucun connecteur : la première page, dite comme celle d'`admin_journal`. */
const CURSOR_RESTARTED = "The cursor is no longer valid: this is the first page again."

type Fn = { name: string; class: string }
type ConnectorData = { name: string; kind: "simulated" | "live" | "built_in" | "application"; activable: boolean; state: string; since: string | null; functions: Fn[] }
type CatalogueEntry = PagePiece & { name: string; searched: string }

const fnText = (functions: readonly Fn[]) => functions.map((fn) => `${fn.name} (${fn.class})`).join(", ")

export function activableData(connector: OrgConnector): ConnectorData {
  const { state, activatedAt, functions } = connector
  return { name: connector.connector, kind: kindOf(connector.connector), activable: true, state, since: activatedAt, functions }
}

/** Un connecteur activable est simulé (`mail`) ou réel (H85). */
const kindOf = (connector: string) => (isSimulatedConnector(connector) ? "simulated" : "live")

/**
 * « - mail (simulated): active since <date> by <nom> — mail.create_draft (write), … » (AC7) ; un connecteur réel dit
 * `live` (H85). Jamais touché : `open by default` ; bloqué par un administrateur : `inactive`.
 */
function activableLine(connector: OrgConnector): string {
  const functions = fnText(connector.functions)
  const kind = kindOf(connector.connector)
  if (connector.state !== "active") return `- ${connector.connector} (${kind}): inactive — ${functions}`
  if (!connector.activatedAt) return `- ${connector.connector} (${kind}): open by default — ${functions}`
  const by = connector.activatedBy?.name ? ` by ${connector.activatedBy.name}` : ""
  return `- ${connector.connector} (${kind}): active since ${day(connector.activatedAt)}${by} — ${functions}`
}

/** Les fonctions toujours actives, lues au registre (H81, N15) : natives par connecteur, puis celles de l'application (ERP). */
function alwaysActive(functions: readonly CatalogFunction[]): { lines: string[]; data: ConnectorData[] } {
  const fnOf = (fn: CatalogFunction): Fn => ({ name: fn.name, class: fn.class })
  const native = new Map<string, Fn[]>()
  for (const fn of functions.filter((candidate) => candidate.origin === "paquet")) native.set(fn.connector, [...(native.get(fn.connector) ?? []), fnOf(fn)])
  const application = functions.filter((fn) => fn.origin === "erp").map(fnOf)
  const fixed = (name: string, kind: ConnectorData["kind"], list: Fn[]): ConnectorData => ({ name, kind, activable: false, state: "always_active", since: null, functions: list })
  const data = [...native].map(([name, list]) => fixed(name, "built_in", list))
  const lines = data.map((entry) => `- ${entry.name} (built in): always active — ${fnText(entry.functions)}`)
  if (application.length === 0) return { lines, data }
  return { lines: [...lines, `- application functions: always active — ${fnText(application)}`], data: [...data, fixed("application", "application", application)] }
}

/** Les lignes du catalogue dans leur ordre, chacune avec ce que cherche le filtre : nom, libellé, domaine et description de l'outil. */
function catalogueEntries(connectors: readonly OrgConnector[], fixed: { lines: string[]; data: ConnectorData[] }): CatalogueEntry[] {
  const searched = (parts: (string | undefined)[]) => normalizedText(parts.filter((part) => part !== undefined).join(" "))
  const activable = connectors.map((connector) => ({
    name: connector.connector,
    searched: searched([connector.connector, connector.label, connector.logoDomain, connector.description]),
    lines: [activableLine(connector)],
    data: activableData(connector),
  }))
  return [...activable, ...fixed.data.map((data, index) => ({ name: data.name, searched: searched([data.name]), lines: [fixed.lines[index]], data }))]
}

export async function catalogue(call: OpCall): Promise<AdminOutput> {
  const identity = targetOf(call)
  const connectors = await listConnectorsForOrg(call.deps.db, identity)
  const all = catalogueEntries(connectors, alwaysActive(catalogFunctions()))
  const nextActions = ["admin_connector accounts", "admin_connector activate"]
  if (all.length === 0) return { text: "No connector in the catalogue.", data: { connectors: [], total: 0, next_cursor: null }, nextActions }
  const filter = typeof call.input.filter === "string" && call.input.filter !== "" ? call.input.filter : null
  const wanted = filter === null ? null : normalizedText(filter)
  const matching = wanted === null ? all : all.filter((entry) => entry.searched.includes(wanted))
  if (matching.length === 0) return { text: `No connector matches "${filter}" among ${all.length}.`, data: { connectors: [], total: 0, next_cursor: null }, nextActions }
  const cursor = typeof call.input.cursor === "string" ? call.input.cursor : null
  const found = cursor === null ? 0 : matching.findIndex((entry) => entry.name === cursor)
  const start = Math.max(found, 0)
  const head = [...(found < 0 ? [CURSOR_RESTARTED] : []), ...(filter === null ? [] : [`${matching.length} of ${all.length} connectors match "${filter}".`])]
  const pieces = matching.slice(start)
  const again = filter === null ? "with this cursor" : "with this cursor and the same filter"
  const page = fittedPage(
    {
      head,
      tail: [],
      data: { total: matching.length },
      items: "connectors",
      nextActions,
      cursorFor: (count) => (count < pieces.length ? pieces[count].name : null),
      continueLine: (next) => `Shown ${start + 1} to ${start + pieces.findIndex((entry) => entry.name === next)} of ${matching.length} connectors. next_cursor: ${next} (call catalogue again ${again} for the rest).`,
    },
    pieces,
  )
  return { text: page.text, data: page.data, nextActions }
}
