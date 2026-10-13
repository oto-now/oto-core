// Les huit outils du MCP admin (E08-S02, AC4 ; H105) : un outil par objet, le verbe en `op`. Noms sans
// préfixe (N1) : un connecteur admin sert une cellule, pas une organisation. Les cinq derniers sont
// déclarés dès maintenant, leurs opérations rendues par E08-S06 ; leur déclaration n'évolue que par
// ajout (le MCP admin n'est pas gelé par ADR-002, mais ses hosts figent la liste lue).
//
// Repris de la maquette (`mcp-test/src/proto/mcp/tools.ts` l. 20-42, 62-76) : le prérequis en consigne
// impérative, la borne de l'outil qui émet le code, les instructions en une phrase ; retiré : le
// préfixe par organisation. Repris d'Oto (`oto_mcp/capabilities/procedure_console.py:109`) : un outil
// par objet, le verbe en `op` ; retiré : les consoles `oto_admin_*` dans la liste des outils métier.
import { toInputSchema } from "../schemas"
import type { ToolDefinition } from "../tools"
import { ADMIN_INPUTS } from "./inputs"

export const ADMIN_TOOL_KEYS = [
  "admin_context",
  "admin_org",
  "admin_team",
  "admin_node",
  "admin_connector",
  "admin_journal",
  "admin_feedback",
  "admin_cell",
] as const

export type AdminToolKey = (typeof ADMIN_TOOL_KEYS)[number]

/**
 * Version du contrat admin : aucun host ne la montre, elle date le journal (mcp-patterns.md § 2) ; `admin_cell
 * version` la sert (E08-S06). Ici, avec la déclaration des outils, pour que `tools/cell.ts` la lise sans
 * importer `server.ts`, qui importe les tables d'opérations.
 */
export const ADMIN_SERVER_VERSION = "1.0.0"

/** Première phrase des sept outils autres qu'`admin_context` : le prérequis, en consigne impérative (H25). */
const ADMIN_PREREQUISITE = "Requires the ctx code from admin_context; call it first."

/** Une phrase (mcp-patterns.md § 2) ; rien de vital n'y est seul : claude.ai ne la montre jamais. */
export const ADMIN_INSTRUCTIONS =
  "Platform admin: call admin_context first in every conversation, because every other admin_ tool requires the ctx code it returns, and pass org = the organisation slug on every call."

const req = ADMIN_PREREQUISITE

const DESCRIPTIONS: Record<AdminToolKey, string> = {
  admin_context: `Opens a platform admin session and returns the admin ctx code that every other admin_ tool requires; call it first in every admin conversation. op ctx (default): who you are, the admin tools and their operations, and the organisations you can act on. op orgs: all of them, with how you reach each one (platform access or membership) and since when. op help: the fields of each operation. A code stays valid 24 hours; nothing else is remembered between calls, so pass org = the organisation slug to every other admin_ tool. Call it only for platform administration (organisations, teams, nodes, connectors, journal, feedback, this cell). Otherwise do not call it.`,
  admin_org: `${req} Manages organisations: list, get, create (its tool prefix never changes; admin_email names its first administrator: your own email makes you a member with the admin role, another email is invited), update name, work domains, brand or routing thresholds, add or remove an address (host), grant or revoke a platform access, name an administrator (add_admin, same rule). Pass org = the organisation slug (for create, the new slug) and people by email. create, remove_host and revoke_access first return a summary and change nothing: show it to the user, get their explicit approval, then call again with confirm: true. Call with op help for the fields of each operation.`,
  admin_team: `${req} Manages the teams of an organisation: list, create (from a name; the result gives the slug), rename, set the only lead or clear the leads, add or remove a lead (a team can have several), add or remove a member, delete. Pass org = the organisation slug, team = the team slug (e.g. ventes) and people by email; a person must already be a member of the organisation. delete is refused while the team owns pages or accounts, and otherwise first returns a summary and deletes nothing: show it to the user, get their explicit approval, then call again with confirm: true. Call with op help for the fields of each operation.`,
  admin_node: `${req} Administers the tree of an organisation: move a node (its old path stays as an alias), publish its pending draft, transfer its owner, and list, add or remove access rules on it. Pass org = the organisation slug and path = the node path (e.g. ventes/relance_devis); an owner or a rule subject is written team:<slug>, user:<email>, org or inherit. transfer_owner first returns a summary of who gains and loses control and changes nothing: show it to the user, get their explicit approval, then call again with confirm: true. Personal spaces are out of reach. Call with op help for the fields.`,
  admin_connector: `${req} Administers the connectors of an organisation: the catalogue and what is active, activate or deactivate a connector, list, create or disable simulated accounts (V1 has simulated accounts only), and list, add or remove access rules on an account. Pass org = the organisation slug; connectors by name (mail), accounts by label, teams by slug, people by email. deactivate and disable_account first return a summary and change nothing: show it to the user, get their explicit approval, then call again with confirm: true. Call with op help for the fields.`,
  admin_journal: `${req} Reads what happened, read-only: the conversations of an organisation grouped by ctx code (person, host, procedure served, calls, errors), the calls of one conversation, and the journal of this admin connector. Filters: team, person (email), errors only, last 7, 30 or 90 days; long lists come with a cursor. Argument values whose key looks like a secret are masked. Pass org = the organisation slug (optional for admin_log). Call with op help for the fields.`,
  admin_feedback: `${req} Handles the tickets that assistants filed with <prefix>_feedback in an organisation: list them (by state, type, last 7, 30 or 90 days) and change a ticket's state to acknowledged, resolved, declined or back to open; declined needs a resolution, which the reporter will read. Pass org = the organisation slug and ticket = the ticket number, e.g. FB-0012. Check the conversation in admin_journal before deciding: an assistant's report can be rebuilt after the fact. Call with op help for the fields.`,
  admin_cell: `${req} Reports on this cell, the application you are connected to and its database, read-only: the package version, the platform migrations applied, and its health (database reachable, required settings present, never their values). No org is needed. Call with op help for the fields.`,
}

const TITLES: Record<AdminToolKey, string> = {
  admin_context: "Platform admin: Load admin context",
  admin_org: "Platform admin: Organisations",
  admin_team: "Platform admin: Teams",
  admin_node: "Platform admin: Nodes",
  admin_connector: "Platform admin: Connectors",
  admin_journal: "Platform admin: Journal",
  admin_feedback: "Platform admin: Feedback",
  admin_cell: "Platform admin: Cell",
}

// Honnêtes (mcp-patterns.md § 3) : `destructiveHint` nulle part, le défaut (`true`) vaut pour les cinq
// outils qui modifient ou retirent ; `admin_context` écrit sa ligne d'ancrage comme `context` son
// `ctx` : lecture, même arbitrage qu'H23.
const READ_ONLY: ReadonlySet<AdminToolKey> = new Set(["admin_context", "admin_journal", "admin_cell"])

/**
 * `orgCreation` : l'hôte branche un point de création (E09-S02). Le paquet ignore ce qu'il fait et
 * suppose qu'il sort de la plateforme : `admin_org` est alors déclaré `openWorldHint: true` (P29).
 */
export function buildAdminTools({ orgCreation = false }: { orgCreation?: boolean } = {}): ToolDefinition[] {
  return ADMIN_TOOL_KEYS.map((key) => ({
    name: key,
    title: TITLES[key],
    description: DESCRIPTIONS[key],
    inputSchema: toInputSchema(ADMIN_INPUTS[key]),
    annotations: { readOnlyHint: READ_ONLY.has(key), openWorldHint: orgCreation && key === "admin_org" },
    // Sans cette déclaration, ChatGPT n'affiche jamais « Se connecter » (mcp-patterns.md § 3).
    _meta: { securitySchemes: [{ type: "oauth2" }] },
  }))
}

/** `admin_org` → `admin_org` ; tout autre nom → `null`. */
export function adminToolKey(name: string): AdminToolKey | null {
  return ADMIN_TOOL_KEYS.find((key) => key === name) ?? null
}
