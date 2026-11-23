// Opérations d'`admin_cell` (E08-S06, AC19 ; N16) : l'état de cette cellule par `cellStatus` d'E08-S04,
// réservé à l'équipe plateforme par le service. Aucune organisation (`org` y est un champ en trop,
// E08-S02 AC8), aucune valeur de variable, jamais : leur présence seulement.
import * as z from "zod/v4"
import { cellStatus } from "../../../server/cell"
import { plural, renderHelp, type AdminOutput, type OpCall, type OpTable } from "../ops"
import { ADMIN_SERVER_VERSION } from "../tools"

/** Nom du paquet (ADR-010). */
const PACKAGE_NAME = "@otomata_tech/oto_platform"
/** Les migrations du paquet se reconnaissent à leur nom, `<horodatage>_platform_<sujet>` (E08-S04, N16). */
const PLATFORM_MIGRATION = "platform_"

async function version(call: OpCall): Promise<AdminOutput> {
  const cell = await cellStatus(call.deps.db)
  const text = `Package ${PACKAGE_NAME} ${cell.packageVersion}; admin connector ${ADMIN_SERVER_VERSION}.`
  return { text, data: { cell: { package: PACKAGE_NAME, package_version: cell.packageVersion, admin_connector_version: ADMIN_SERVER_VERSION } }, target: "cell", nextActions: ["admin_cell migrations", "admin_cell health"] }
}

async function migrations(call: OpCall): Promise<AdminOutput> {
  const cell = await cellStatus(call.deps.db)
  // Triées par version (`applied_migrations`) ; un nom nul (CLI qui ne l'écrivait pas) n'est pas reconnu comme du paquet.
  const platform = cell.migrations.filter((migration) => migration.name?.startsWith(PLATFORM_MIGRATION))
  const last = platform.at(-1)
  const lastText = last ? `; last: ${last.version} ${last.name}` : ""
  const text = `${plural(platform.length, "platform migration", "platform migrations")} applied (${cell.migrations.length} in all)${lastText}.`
  const data = { cell: { platform_migrations: platform.length, migrations: cell.migrations.length, last: last ?? null } }
  return { text, data, target: "cell", nextActions: ["admin_cell health"] }
}

async function health(call: OpCall): Promise<AdminOutput> {
  const cell = await cellStatus(call.deps.db)
  const settings = cell.health.env.map((variable) => `${variable.name} ${variable.present ? "present" : "missing"}${variable.optional ? " (optional)" : ""}`).join(", ")
  const text = [`Database: reachable (${cell.health.database.latencyMs} ms).`, `Settings: ${settings}.`, `Checked at ${cell.checkedAt}.`].join("\n")
  return { text, data: { cell: { health: cell.health, checked_at: cell.checkedAt } }, target: "cell", nextActions: ["admin_cell version"] }
}

const noField = z.object({})
const unreachable = "internal: Database unreachable."

export const CELL_OPS: OpTable = {
  help: {
    schema: noField,
    org: "none",
    twoStep: false,
    summary: "Gives the fields of each operation of admin_cell.",
    example: {},
    refusals: [],
    run: async () => ({ text: renderHelp("admin_cell", CELL_OPS), nextActions: [] }),
  },
  version: {
    schema: noField,
    org: "none",
    twoStep: false,
    summary: "Gives the version of the package that runs in this cell and of this admin connector.",
    example: {},
    refusals: [unreachable],
    run: version,
  },
  migrations: {
    schema: noField,
    org: "none",
    twoStep: false,
    summary: "Counts the platform migrations applied to this cell's database and names the last one.",
    example: {},
    refusals: [unreachable],
    run: migrations,
  },
  health: {
    schema: noField,
    org: "none",
    twoStep: false,
    summary: "Says whether the database answers and which required settings are present, never their values.",
    example: {},
    refusals: [unreachable],
    run: health,
  },
}
