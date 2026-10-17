// Opérations d'`admin_connector` (E08-S06, AC7 à AC13) : catalogue, activations et comptes d'E04-S01,
// impact d'une désactivation et comptes de l'organisation d'E08-S03, règles d'un compte
// (`server/rules.ts`) ; un compte s'adresse par son libellé (N6), une équipe par son slug. Aucun droit
// ne se décide ici (H123) : chaque service décide le sien, et son refus est rendu tel quel.
import * as z from "zod/v4"
import { accountOwnerRefSchema, connectorRefSchema, createAccountSchema, orgSlugSchema, setAccountRuleSchema, type AccountView, type OrgConnector } from "../../../schemas"
import { findAccount, readRef, resolveRef } from "../../../server/admin/context"
import { ownerDescription } from "../../../server/admin/nodes"
import type { CatalogFunction } from "../../../server/catalog/define"
import { catalogFunctions } from "../../../server/catalog/registry"
import { createAccount, disableAccount, listOrgAccounts, markWords } from "../../../server/connectors/accounts"
import { activateConnector, deactivateConnector, deactivationImpact, listConnectorsForOrg } from "../../../server/connectors/activations"
import { isSimulatedConnector, modeLabel } from "../../../server/connectors/modes"
import { listAccountRules, removeAccountRule, setAccountRule } from "../../../server/rules"
import { day, firstOf, listLines, nothingWas, renderHelp, targetOf, type AdminOutput, type OpCall, type OpTable } from "../ops"
import { noRuleFor, readSubject, ruleOf, rulesOutput, ruleSetText } from "../rule-texts"

/** Chemins de procédures nommés au plus par le récapitulatif d'une désactivation (AC9). */
const PROCEDURES_NAMED = 10
const ACCOUNT_DEFAULTS = "Without a rule, members read an organisation account, its team writes a team account, its owner manages a personal one."
const AFTER_ACCOUNT_RULES = ["admin_connector account_rules"]

type Fn = { name: string; class: string }
type ConnectorData = { name: string; kind: "simulated" | "live" | "built_in" | "application"; activable: boolean; state: string; since: string | null; functions: Fn[] }

const fnText = (functions: readonly Fn[]) => functions.map((fn) => `${fn.name} (${fn.class})`).join(", ")

function activableData(connector: OrgConnector): ConnectorData {
  const { state, activatedAt, functions } = connector
  return { name: connector.connector, kind: kindOf(connector.connector), activable: true, state, since: activatedAt, functions }
}

/** Un connecteur activable est simulé (`mail`) ou réel (H85). */
const kindOf = (connector: string) => (isSimulatedConnector(connector) ? "simulated" : "live")

/** « - mail (simulated): active since <date> by <nom> — mail.create_draft (write), … » (AC7) ; un connecteur réel dit `live` (H85). */
function activableLine(connector: OrgConnector): string {
  const functions = fnText(connector.functions)
  const kind = kindOf(connector.connector)
  if (connector.state !== "active" || !connector.activatedAt) return `- ${connector.connector} (${kind}): inactive — ${functions}`
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

async function catalogue(call: OpCall): Promise<AdminOutput> {
  const identity = targetOf(call)
  const connectors = await listConnectorsForOrg(call.deps.db, identity)
  const fixed = alwaysActive(catalogFunctions())
  const text = [...connectors.map(activableLine), ...fixed.lines].join("\n") || "No connector in the catalogue."
  return { text, data: { connectors: [...connectors.map(activableData), ...fixed.data] }, nextActions: ["admin_connector accounts", "admin_connector activate"] }
}

/** L'état du connecteur nommé dans l'organisation, lu avant d'écrire (AC8, AC9) ; `undefined` : ni activable ni connu. */
async function stateOf(call: OpCall, connector: string): Promise<OrgConnector | undefined> {
  return (await listConnectorsForOrg(call.deps.db, targetOf(call))).find((candidate) => candidate.connector === connector)
}

async function activate(call: OpCall): Promise<AdminOutput> {
  const identity = targetOf(call)
  const connector = String(call.input.connector)
  const org = identity.org.slug
  const next = ["admin_connector create_account", "admin_connector catalogue"]
  const current = await stateOf(call, connector)
  if (current?.state === "active") return { text: `${connector} is already active in ${org}; nothing changed.`, data: { connectors: [activableData(current)] }, target: connector, nextActions: next }
  const activated = await activateConnector(call.deps.db, identity, { connector })
  return { text: `${connector} is now active in ${org}: its functions are callable at once.`, data: { connectors: [activableData(activated)] }, target: connector, nextActions: next }
}

/** « 2 published procedures call it in their call blocks (…) and will fail at those steps » (AC9). */
function proceduresText(paths: readonly string[]): string {
  if (paths.length === 0) return "no published procedure calls it in a call block"
  const named = `(${firstOf(paths, PROCEDURES_NAMED)}) and will fail at those steps`
  return paths.length === 1 ? `1 published procedure calls it in its call blocks ${named}` : `${paths.length} published procedures call it in their call blocks ${named}`
}

function accountsKept(count: number): string {
  return count === 0 ? "it has no account" : count === 1 ? "its 1 account is kept" : `its ${count} accounts are kept`
}

async function deactivate(call: OpCall): Promise<AdminOutput> {
  const { db } = call.deps
  const identity = targetOf(call)
  const connector = String(call.input.connector)
  const org = identity.org.slug
  const current = await stateOf(call, connector)
  if (current && current.state !== "active") return { text: `${connector} is not active in ${org}; nothing changed.`, target: connector, nextActions: ["admin_connector catalogue"] }
  if (call.input.confirm !== true) {
    const impact = await deactivationImpact(db, identity, connector)
    const head = `About to deactivate ${connector} in ${org}: its functions (${impact.functions.join(", ")}) stop at once for everyone (not_enabled); ${proceduresText(impact.procedures)}; ${accountsKept(impact.accounts)}.`
    return { text: [head, nothingWas("deactivated")].join("\n"), data: { summary: { connector, ...impact } }, target: connector, nextActions: [] }
  }
  const deactivated = await deactivateConnector(db, identity, { connector })
  return { text: `${connector} deactivated in ${org}: its functions answer not_enabled from now on.`, data: { connectors: [activableData(deactivated)] }, target: connector, nextActions: ["admin_connector catalogue"] }
}

/** « team Ventes », « organisation », « personal » : le propriétaire d'un compte tel qu'une ligne le dit (AC10, AC12). */
function ownerShort(owner: AccountView["owner"]): string {
  if (owner.kind === "team") return `team ${owner.teamName ?? "?"}`
  return owner.kind === "user" ? "personal" : "organisation"
}

const accountData = (account: AccountView) => ({
  label: account.label,
  connector: account.connector,
  owner: ownerShort(account.owner),
  mode: account.mode,
  status: account.status,
  ...(account.mark ? { mark: account.mark } : {}),
})

async function accounts(call: OpCall): Promise<AdminOutput> {
  const identity = targetOf(call)
  const connector = typeof call.input.connector === "string" ? call.input.connector : null
  const all = await listOrgAccounts(call.deps.db, identity)
  const shown = connector ? all.filter((account) => account.connector === connector) : all
  const output = { target: connector, nextActions: ["admin_connector create_account"] }
  if (shown.length === 0) {
    const text = `${identity.org.slug} has no ${connector ? `${connector} ` : ""}account yet. Create one with admin_connector {"op": "create_account"}.`
    return { ...output, text, data: { accounts: [] } }
  }
  const line = (account: AccountView) =>
    `- ${account.label} · ${account.connector} · ${ownerShort(account.owner)} · ${modeLabel(account.mode)} · ${account.status}${account.mark ? ` · marked: ${markWords(account.mark)}` : ""}`
  return { ...output, text: listLines(shown, line).join("\n"), data: { accounts: shown.map(accountData) } }
}

async function createAccountOp(call: OpCall): Promise<AdminOutput> {
  const { db } = call.deps
  const identity = targetOf(call)
  const owner = await resolveRef(db, identity, readRef(accountOwnerRefSchema, call.input.owner))
  const team = owner.kind === "team" ? { owner_kind: "team", team_id: owner.team.id } : { owner_kind: "org" }
  const { connector, account: label, mode } = call.input
  const created = await createAccount(db, identity, { connector, label, mode, ...team })
  const owned = await ownerDescription(db, identity, created.owner)
  const after =
    created.mode === "simule"
      ? "Nothing it does leaves the server."
      : "Its secret and settings are entered by whoever manages it on the dashboard's Connectors screen, never here; calls are refused until then."
  const text = `${created.mode === "simule" ? "Simulated" : "Live"} account ${created.label} (${created.connector}) created in ${identity.org.slug}, owned by ${owned}. ${after}`
  return { text, data: { accounts: [{ label: created.label, connector: created.connector, owner: owned, mode: created.mode, status: "active" }] }, target: `account:${created.label}`, nextActions: AFTER_ACCOUNT_RULES }
}

async function disable(call: OpCall): Promise<AdminOutput> {
  const { db } = call.deps
  const identity = targetOf(call)
  const account = await findAccount(db, identity, { label: String(call.input.account) })
  const output = { data: { accounts: [accountData(account)] }, target: `account:${account.label}` }
  if (account.status === "disabled") return { ...output, text: `Account ${account.label} is already disabled; nothing changed.`, nextActions: ["admin_connector accounts"] }
  if (call.input.confirm !== true) {
    const head = `About to disable account ${account.label} (${account.connector}, ${ownerShort(account.owner)}): calls that resolve to it fail from now on. V1 cannot enable an account again: create a new one if needed.`
    return { ...output, text: [head, nothingWas("disabled")].join("\n"), nextActions: [] }
  }
  await disableAccount(db, identity, { account_id: account.id })
  return { ...output, text: `Account ${account.label} disabled.`, data: { accounts: [{ ...accountData(account), status: "disabled" }] }, nextActions: ["admin_connector accounts"] }
}

async function accountRules(call: OpCall): Promise<AdminOutput> {
  const { db } = call.deps
  const identity = targetOf(call)
  const account = await findAccount(db, identity, { label: String(call.input.account) })
  const view = await listAccountRules(db, identity, account.id)
  const owner = await ownerDescription(db, identity, view.owner)
  const served = await rulesOutput(db, identity, { target: `account ${view.label}`, rules: view.rules, closing: `Owner: ${owner}. ${ACCOUNT_DEFAULTS}` })
  return { text: served.text, data: { account: view.label, owner, rules: served.rules }, target: `account:${view.label}`, nextActions: ["admin_connector add_account_rule"] }
}

async function addAccountRule(call: OpCall): Promise<AdminOutput> {
  const { db } = call.deps
  const identity = targetOf(call)
  const account = await findAccount(db, identity, { label: String(call.input.account) })
  const subject = await readSubject(db, identity, call.input.subject)
  const previous = ruleOf((await listAccountRules(db, identity, account.id)).rules, subject.subject)?.level ?? null
  const set = await setAccountRule(db, identity, { accountId: account.id, subject: subject.subject, level: call.input.level })
  const { level } = set.data
  const text = ruleSetText(subject, { level, scope: `account ${account.label}`, previous })
  return { text, data: { rules: [{ subject: subject.text, level, previous }] }, target: set.target, nextActions: AFTER_ACCOUNT_RULES }
}

async function removeAccountRuleOp(call: OpCall): Promise<AdminOutput> {
  const { db } = call.deps
  const identity = targetOf(call)
  const account = await findAccount(db, identity, { label: String(call.input.account) })
  const subject = await readSubject(db, identity, call.input.subject)
  const rule = ruleOf((await listAccountRules(db, identity, account.id)).rules, subject.subject)
  if (!rule) throw noRuleFor(subject, `account ${account.label}`)
  const removed = await removeAccountRule(db, identity, rule.id)
  const text = `${subject.text} no longer has a rule on account ${account.label} (it was ${rule.level}). ${ACCOUNT_DEFAULTS}`
  return { text, data: { rules: [{ subject: subject.text, removed: rule.level }] }, target: removed.target, nextActions: AFTER_ACCOUNT_RULES }
}

const connectorField = connectorRefSchema.shape.connector
const label = createAccountSchema.shape.label
const onConnector = { org: orgSlugSchema, connector: connectorField }
const onAccount = { org: orgSlugSchema, account: label }
/** Une référence brute, lue par le service (`readRef`) : son refus est le message exact d'AC11 et d'AC13. */
const ref = z.string()
const builtIn = "invalid_arguments: table is built in: it is always active and has no accounts."
const unknownConnector = "not_found: Unknown connector <x>. Connectors you can activate: <list>."
const unknownAccount = "not_found: No account labelled <label> in <org>. Accounts: <list>."

export const CONNECTOR_OPS: OpTable = {
  help: {
    schema: z.object({}),
    org: "none",
    twoStep: false,
    summary: "Gives the fields of each operation of admin_connector.",
    example: {},
    refusals: [],
    run: async () => ({ text: renderHelp("admin_connector", CONNECTOR_OPS), nextActions: [] }),
  },
  catalogue: {
    schema: z.object({ org: orgSlugSchema }),
    org: "target",
    twoStep: false,
    summary: "Lists the connectors you can activate with their state and functions, then the functions that are always active.",
    example: { org: "acme" },
    refusals: [],
    run: catalogue,
  },
  activate: {
    schema: z.object(onConnector),
    org: "target",
    twoStep: false,
    summary: "Activates a connector in the organisation: its functions are callable at once.",
    example: { org: "acme", connector: "mail" },
    refusals: [unknownConnector, builtIn, "forbidden: Activating or deactivating connectors at <org> is reserved to its administrators."],
    run: activate,
  },
  deactivate: {
    schema: z.object({ ...onConnector, confirm: z.boolean().optional() }),
    org: "target",
    twoStep: true,
    summary: "Deactivates a connector: its functions answer not_enabled, the procedures that call it fail at those steps, its accounts are kept.",
    example: { org: "acme", connector: "mail" },
    refusals: [unknownConnector, builtIn],
    run: deactivate,
  },
  accounts: {
    schema: z.object({ org: orgSlugSchema, connector: connectorField.optional() }),
    org: "target",
    twoStep: false,
    summary: "Lists the accounts of the organisation, disabled ones included, optionally for one connector.",
    example: { org: "acme", connector: "mail" },
    refusals: [],
    run: accounts,
  },
  create_account: {
    schema: z.object({ ...onConnector, account: label, owner: ref, mode: createAccountSchema.shape.mode }),
    org: "target",
    twoStep: false,
    summary:
      "Creates an account of the organisation or of a team (owner org or team:<slug>): simulated for a simulated connector (nothing leaves the server), live (mode reel) for a live one.",
    example: { org: "acme", connector: "mail", account: "Mail Ventes", owner: "team:ventes" },
    refusals: [
      "invalid_arguments: owner must be org or team:<slug>: a personal account is created by its owner, not by the platform team.",
      "unavailable_in_v1: a live account of a simulated connector, or a sandbox account.",
      "invalid_arguments: a simulated account of a live connector: create it with mode reel.",
      "conflict: An account labelled <label> already exists in <org>.",
      unknownConnector,
    ],
    run: createAccountOp,
  },
  disable_account: {
    schema: z.object({ ...onAccount, confirm: z.boolean().optional() }),
    org: "target",
    twoStep: true,
    summary: "Disables an account: calls that resolve to it fail from now on; V1 cannot enable it again.",
    example: { org: "acme", account: "Mail Ventes" },
    refusals: [unknownAccount],
    run: disable,
  },
  account_rules: {
    schema: z.object(onAccount),
    org: "target",
    twoStep: false,
    summary: "Lists the access rules set on an account and names its owner.",
    example: { org: "acme", account: "Mail Ventes" },
    refusals: [unknownAccount],
    run: accountRules,
  },
  add_account_rule: {
    schema: z.object({ ...onAccount, subject: ref, level: setAccountRuleSchema.shape.level }),
    org: "target",
    twoStep: false,
    summary: "Sets the access level of a team or a person on an account, replacing the rule of that subject if there is one.",
    example: { org: "acme", account: "Mail Ventes", subject: "team:support", level: "read" },
    refusals: [unknownAccount, "invalid_arguments: subject must be team:<slug> or user:<email>.", "forbidden: Using account « <label> » is reserved to <who>."],
    run: addAccountRule,
  },
  remove_account_rule: {
    schema: z.object({ ...onAccount, subject: ref }),
    org: "target",
    twoStep: false,
    summary: "Removes the rule of a team or a person on an account.",
    example: { org: "acme", account: "Mail Ventes", subject: "team:support" },
    refusals: [unknownAccount, "not_found: No rule for <subject> on account <label>."],
    run: removeAccountRuleOp,
  },
}
