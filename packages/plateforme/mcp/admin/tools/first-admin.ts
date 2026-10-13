// Textes du premier administrateur d'`admin_org create` et opération `add_admin` (décision du 2026-10-14) : chaque
// texte dit lequel des deux cas se produit, l'appelant membre `admin` sans email, ou une invitation `admin` ; les droits
// et l'écriture sont dans `server/admin/first-admin.ts` (H123). À part de `org.ts`, qui passerait sinon la borne de
// lignes d'ESLint.
import { addAdmin, type AdminNamed, type FirstAdminPlan } from "../../../server/admin/first-admin"
import type { FirstAdminOutcome } from "../../../server/admin/orgs"
import { day, targetOf, type AdminOutput, type OpCall } from "../ops"

/** La ligne du récapitulatif de `create` (premier temps) : lequel des deux cas va se produire. */
export function firstAdminSummary(plan: FirstAdminPlan): string {
  if (plan.self) return `First administrator: you (${plan.email}), a member with the admin role as soon as it is created; no invitation, no email.`
  return `First administrator: ${plan.email}, invited with the admin role once it is created, by the invitation email of the web app (Équipes), with a link to ${plan.link}, valid 7 days; they become a member when they sign in with that address.`
}

/** Ce que le premier administrateur est devenu, une fois l'organisation créée. */
export function firstAdminLine(slug: string, outcome: FirstAdminOutcome): string {
  if (outcome.outcome === "invitation_failed") {
    return `Organisation ${slug} is created, but the invitation of its first administrator ${outcome.email} failed: ${outcome.failure} Send it again with admin_org {"op": "add_admin"}.`
  }
  if (outcome.outcome === "invited") {
    return `First administrator: invitation sent to ${outcome.email} (role admin, valid until ${day(outcome.expiresAt)}); they become a member when they sign in at ${outcome.link} with that address.`
  }
  return `You (${outcome.email}) are its first administrator: a member with the admin role.`
}

/** `first_admin` des données de `create` : l'email, le cas, et l'invitation ou son échec. */
export function firstAdminData(outcome: FirstAdminPlan | FirstAdminOutcome): Record<string, unknown> {
  const { email, self } = outcome
  const link = "link" in outcome ? { link: outcome.link } : {}
  const result = "outcome" in outcome ? { outcome: outcome.outcome } : {}
  const expires = "expiresAt" in outcome ? { expires_at: outcome.expiresAt } : {}
  const failure = "failure" in outcome ? { failure: outcome.failure } : {}
  return { email, self, ...result, ...link, ...expires, ...failure }
}

function namedText(org: string, named: AdminNamed): string {
  const who = named.self ? `You (${named.email}) are` : `${named.email} is`
  switch (named.outcome) {
    case "invited":
      return `Invitation to administer ${org} sent to ${named.email} (role admin, valid until ${day(named.expiresAt)}); they become a member when they sign in at ${named.link} with that address. It can be revoked from the web app (Équipes).`
    case "joined":
      return `You (${named.email}) are now a member of ${org} with the admin role.`
    case "promoted":
      return `${who} now an administrator of ${org}: ${named.self ? "you were" : "they were"} a member.`
    case "unchanged":
      return `${who} already an administrator of ${org}: nothing changed.`
  }
}

/** `add_admin` : nomme un administrateur d'une organisation existante, selon la règle de `create`. */
export async function adminAdded(call: OpCall): Promise<AdminOutput> {
  const identity = targetOf(call)
  const named = await addAdmin(call.deps.db, identity, call.input, { origin: call.deps.origin })
  return { text: namedText(identity.org.slug, named), data: { admin: firstAdminData(named) }, nextActions: ["admin_org get"] }
}
