// Schémas servis des huit outils admin (E08-S02, AC4) : plats (ADR-002 § 5 : ChatGPT ne montre pas
// les descriptions imbriquées), chaque champ décrit (mcp-patterns.md § 3), tout facultatif sauf `ctx`
// et `op`, que la garde et la table de l'outil exigent. La validation fine est celle de l'opération
// (`tools/<outil>.ts`) ; ces schémas ne font que la présenter au modèle (N40). Le MCP admin n'est pas figé
// (ADR-002, Neutres), mais il évolue par ajout : un champ facultatif, une opération, jamais un retrait.
// Un champ borné par un schéma partagé en est tiré (`.shape`), jamais recopié : sa borne n'a qu'une source.
import * as z from "zod/v4"
import { createTeamSchema, orgSettingsSchema, platformAccessSchema, themeSchema } from "../../schemas"
import type { AdminToolKey } from "./tools"

const ctx = z.string().describe("Admin ctx code returned by admin_context, e.g. 7K3Q-M2XA. Required: call admin_context first.")
const org = z.string().optional().describe("Organisation slug, e.g. acme (admin_context op orgs lists yours)")
const cursor = z.string().optional().describe("next_cursor returned by the previous page")
const level = z.enum(["none", "read", "write", "manage"])

function op<const T extends readonly [string, ...string[]]>(ops: T) {
  return z.enum(ops).describe("Operation; op help gives the fields of each one")
}

function confirm(ops: string) {
  return z
    .boolean()
    .optional()
    .describe(`true only after the user explicitly approved the summary returned by a first call of the same operation (${ops})`)
}

/** Les opérations déclarées de chaque outil, dans l'ordre du contrat ; `help` d'abord. */
export const ADMIN_OPS = {
  admin_context: ["ctx", "orgs", "help"],
  admin_org: ["help", "list", "get", "create", "update", "add_host", "remove_host", "grant_access", "revoke_access", "add_admin"],
  admin_team: ["help", "list", "create", "rename", "set_lead", "add_lead", "remove_lead", "add_member", "remove_member", "delete"],
  admin_node: ["help", "move", "publish", "transfer_owner", "rules", "add_rule", "remove_rule"],
  admin_connector: [
    "help",
    "catalogue",
    "activate",
    "deactivate",
    "accounts",
    "create_account",
    "disable_account",
    "account_rules",
    "add_account_rule",
    "remove_account_rule",
  ],
  admin_journal: ["help", "conversations", "conversation", "admin_log"],
  admin_feedback: ["help", "list", "set_state"],
  admin_cell: ["help", "version", "migrations", "health"],
} as const satisfies Record<AdminToolKey, readonly [string, ...string[]]>

const days = (text: string) => z.literal([7, 30, 90]).optional().describe(text)

export const ADMIN_INPUTS = {
  admin_context: z.object({
    op: z
      .enum(ADMIN_OPS.admin_context)
      .optional()
      .describe("What to return: ctx (default) opens a session, orgs lists your organisations, help gives the fields of each operation"),
  }),
  admin_org: z.object({
    ctx,
    op: op(ADMIN_OPS.admin_org),
    org: z
      .string()
      .optional()
      .describe(
        "Organisation slug, e.g. acme (admin_context op orgs lists yours); for create, the new slug: 2 to 40 lowercase letters, digits or hyphens",
      ),
    name: orgSettingsSchema.shape.name.describe("Organisation name, e.g. Acme Énergies (create, update)"),
    prefix: z.string().optional().describe("Tool prefix, 2 to 12 lowercase letters or digits starting with a letter, e.g. acme (create only; it never changes)"),
    host: z.string().optional().describe("Address without scheme, port or path, e.g. app.acme.com (create: its first address; add_host, remove_host)"),
    domains: orgSettingsSchema.shape.domains.describe(
      "Work domains of the organisation, in English, cited by the description of <prefix>_context, e.g. sales, support, energy projects; replaces them; not its addresses (update)",
    ),
    // Nom affiché et logo : le `transform` de `brandInputSchema` (vide → `null`) n'a pas d'équivalent JSON
    // Schema ; la borne de 80 du nom affiché y est donc recopiée, et `orgSettingsSchema` reste seul juge.
    display_name: z.string().max(80).optional().describe("Name shown on its screens and consent page; empty string removes it (update)"),
    theme: themeSchema.optional().describe("Screen theme (update)"),
    logo_url: z.string().optional().describe("https URL of its logo; empty string removes it (update)"),
    routing_threshold: orgSettingsSchema.shape.routing_threshold.describe(
      "Score from 0 to 1 from which <prefix>_context serves a procedure's steps, default 0.65 (update)",
    ),
    routing_gap: orgSettingsSchema.shape.routing_gap.describe("Minimum lead of the first candidate over the second, from 0 to 1, default 0.1 (update)"),
    email: z.string().optional().describe("Email of a platform team colleague (grant_access, revoke_access)"),
    // `revoke_access` : `platform_grants` n'a pas de motif de révocation, la ligne du journal admin le garde (N35).
    reason: platformAccessSchema.shape.reason.describe("Why, kept with the dated access line (grant_access) or in the admin journal (revoke_access)"),
    confirm: confirm("create, remove_host, revoke_access"),
    // Décision du 2026-10-14 : ajouté en dernier, le schéma servi n'évoluant que par ajout.
    admin_email: z
      .string()
      .optional()
      .describe(
        "Email of the administrator to name (create: its first administrator, required; add_admin). Your own email makes you a member with the admin role at once, without email; another email is invited with the admin role",
      ),
  }),
  admin_team: z.object({
    ctx,
    op: op(ADMIN_OPS.admin_team),
    org,
    team: z.string().optional().describe("Team slug, e.g. ventes (every op but help, list and create)"),
    name: createTeamSchema.shape.name.optional().describe("Team name, e.g. Ventes; create derives the slug from it (create, rename)"),
    email: z
      .string()
      .optional()
      .describe(
        "Email of a member of the organisation (create: its lead, optional; set_lead: the only lead, or an empty string for no lead; add_lead, remove_lead, add_member, remove_member)",
      ),
    confirm: confirm("delete"),
  }),
  admin_node: z.object({
    ctx,
    op: op(ADMIN_OPS.admin_node),
    org,
    path: z.string().optional().describe("Node path, e.g. ventes/relance_devis"),
    new_path: z.string().optional().describe("New path for move; its parent must exist, e.g. conseil/relance_devis"),
    owner: z.string().optional().describe("New owner for transfer_owner: team:<slug>, user:<email>, org, or inherit (from the parent)"),
    subject: z.string().optional().describe("Who a rule applies to: team:<slug> or user:<email> (add_rule, remove_rule)"),
    level: level.optional().describe("Rule level (add_rule)"),
    confirm: confirm("transfer_owner"),
  }),
  admin_connector: z.object({
    ctx,
    op: op(ADMIN_OPS.admin_connector),
    org,
    connector: z.string().optional().describe("Connector name, e.g. mail"),
    account: z.string().optional().describe("Account label, e.g. Mail Ventes (the new label for create_account)"),
    owner: z
      .string()
      .optional()
      .describe("Owner of a new account: org or team:<slug> (create_account; a personal account is created by its owner, not here)"),
    mode: z
      .enum(["simule", "reel", "sandbox"])
      .optional()
      .describe("Account mode; V1 has simulated accounts only (create_account, default simule)"),
    subject: z.string().optional().describe("Who a rule applies to: team:<slug> or user:<email> (add_account_rule, remove_account_rule)"),
    level: level.optional().describe("Rule level (add_account_rule)"),
    confirm: confirm("deactivate, disable_account"),
  }),
  admin_journal: z.object({
    ctx,
    op: op(ADMIN_OPS.admin_journal),
    org: z.string().optional().describe("Organisation slug (conversations, conversation; optional filter for admin_log)"),
    code: z
      .string()
      .optional()
      .describe("ctx code of one conversation, e.g. 7K3Q-M2XA (conversation), or of one admin session (admin_log)"),
    team: z.string().optional().describe("Team slug filter (conversations)"),
    email: z.string().optional().describe("Person filter, by email (conversations, admin_log)"),
    errors: z.boolean().optional().describe("true: only conversations with at least one error (conversations)"),
    days: days("Period in days: 7, 30 or 90 (default 7)"),
    cursor,
  }),
  admin_feedback: z.object({
    ctx,
    op: op(ADMIN_OPS.admin_feedback),
    org,
    ticket: z.string().optional().describe("Ticket number, e.g. FB-0012 (set_state)"),
    state: z
      .enum(["open", "acknowledged", "resolved", "declined"])
      .optional()
      .describe("list: only this state; set_state: the new state"),
    type: z.enum(["friction", "gap", "error"]).optional().describe("Only this type (list)"),
    resolution: z.string().max(2000).optional().describe("What was decided, read by the reporter; required to decline (set_state)"),
    days: days("Period in days (list, default 30)"),
    cursor,
  }),
  admin_cell: z.object({ ctx, op: op(ADMIN_OPS.admin_cell) }),
} satisfies Record<AdminToolKey, z.ZodObject>
