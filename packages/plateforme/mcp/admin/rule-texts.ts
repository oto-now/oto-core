// Règles d'accès servies par le MCP admin (E08-S06, AC5, AC6, AC13) : un nœud et un compte se lisent et
// se changent avec les mêmes textes, cible « <chemin> » ou « account <libellé> ». Sans ce module,
// `admin_node` et `admin_connector` écriraient chacun leurs lignes de règles et leurs sujets.
import { subjectRefSchema, type AccessLevelName, type AccountLevelName, type NodeRulesView, type RuleSubject } from "../../schemas"
import { readRef, resolveRef } from "../../server/admin/context"
import type { PlatformDb } from "../../server/db"
import { memberDirectory } from "../../server/directory"
import { PlatformError } from "../../server/errors"
import type { Identity } from "../../server/identity"
import { listLines } from "./ops"

/** Le niveau d'une règle : de l'échelle des nœuds, ou de celle des comptes (`sensitive` compris). */
type RuleLevel = AccessLevelName | AccountLevelName

/** Une règle d'un nœud ou d'un compte, telle que la rendent `listNodeRules` et `listAccountRules`. */
type Rule = Omit<NodeRulesView["rules"][number], "level"> & { level: RuleLevel }

/** Un sujet résolu (N1) et sa description : « team Conseil », « user Claire Morel <claire@…> ». */
export type Subject = { subject: RuleSubject; text: string }

/** Le sujet d'une règle : `subject` lu (`subjectRefSchema`, refus exact d'AC6), puis résolu dans l'organisation. */
export async function readSubject(db: PlatformDb, identity: Identity, raw: unknown): Promise<Subject> {
  const resolved = await resolveRef(db, identity, readRef(subjectRefSchema, raw))
  if (resolved.kind === "team") return { subject: { kind: "team", id: resolved.team.id }, text: `team ${resolved.team.name}` }
  if (resolved.kind === "user") return { subject: { kind: "user", id: resolved.person.userId }, text: `user ${resolved.person.name} <${resolved.person.email}>` }
  // `subjectRefSchema` ne rend qu'une équipe ou une personne.
  throw new PlatformError("internal", "Internal error.")
}

/** La règle du sujet parmi les règles lues, s'il en a une. */
export function ruleOf(rules: readonly Rule[], subject: RuleSubject): Rule | undefined {
  return rules.find((rule) => rule.subject.kind === subject.kind && rule.subject.id === subject.id)
}

/**
 * Les règles lues (AC5) : « - team Conseil: read », « - user Claire Morel <email>: write » (email par
 * l'annuaire, `memberDirectory`), 200 au plus, puis celle de toute l'organisation (`general`, ADR-014) :
 * « - organisation Acme: write » ; puis `closing` (propriétaire et défauts). Sans règle : « No rule on
 * <cible>. » puis `closing`.
 */
export async function rulesOutput(
  db: PlatformDb,
  identity: Identity,
  view: { target: string; rules: readonly Rule[]; general?: { id: string; level: RuleLevel } | null; closing: string },
) {
  const users = view.rules.some((rule) => rule.subject.kind === "user") ? await memberDirectory(db, identity.org.id) : []
  const emails = new Map(users.map((person) => [person.userId, person.email]))
  const subjectOf = (rule: Rule) => {
    if (rule.subject.kind === "team") return { kind: "team", name: rule.subject.name }
    return { kind: "user", name: rule.subject.name, email: emails.get(rule.subject.id) ?? null }
  }
  const line = (rule: Rule) => {
    const subject = subjectOf(rule)
    return subject.kind === "team" ? `- team ${subject.name}: ${rule.level}` : `- user ${subject.name} <${subject.email ?? "no email"}>: ${rule.level}`
  }
  const general = view.general ? [{ subject: { kind: "org", name: identity.org.name }, level: view.general.level }] : []
  const lines = [...listLines(view.rules, line), ...general.map((rule) => `- organisation ${rule.subject.name}: ${rule.level}`)]
  const rules = [...view.rules.map((rule) => ({ subject: subjectOf(rule), level: rule.level })), ...general]
  return { text: [...(lines.length > 0 ? lines : [`No rule on ${view.target}.`]), view.closing].join("\n"), rules }
}

/**
 * Une règle posée (AC6) : « <sujet> now has <level> on <portée>. », et le niveau d'avant s'il y en avait
 * un. `scope` : « <chemin> and below, unless a closer rule says otherwise » ou « account <libellé> ».
 */
export function ruleSetText(subject: Subject, change: { level: RuleLevel; scope: string; previous: RuleLevel | null }): string {
  const was = change.previous === null ? "" : ` It was ${change.previous}.`
  return `${subject.text} now has ${change.level} on ${change.scope}.${was}`
}

/** Aucune règle de ce sujet sur la cible (AC6) : `not_found`. */
export function noRuleFor(subject: Subject, target: string): PlatformError {
  return new PlatformError("not_found", `No rule for ${subject.text} on ${target}.`)
}
