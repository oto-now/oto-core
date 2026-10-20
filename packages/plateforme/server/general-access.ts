// L'accès général d'un nœud (E05-S10, AC-b13 ; ADR-014) : « toute l'organisation », à un niveau, ou
// « seulement les personnes ajoutées », depuis « Partager ». C'est la règle d'accès de sujet organisation
// du nœud (`access_rules.subject_org`) : la poser ou changer son niveau ouvre le nœud à chaque membre,
// la retirer le referme à ceux que les autres règles et son propriétaire désignent. Décidé par le
// service avant sa requête : la gestion du nœud (`share`), l'administrateur seul pour l'accès complet
// (`manage`, fiche D4), et jamais dans un espace « Privé » (ADR-014 § 2). Sans lui, l'accès général ne se
// change pas.
import { ACCESS_LEVEL_NAMES, generalAccessSchema, type AccessLevelName, type GeneralAccess } from "../schemas"
import { ACCESS_LEVELS, requireNodeLevel } from "./access"
import type { PlatformDb } from "./db"
import { changedMeanwhile, inTransaction, invalidInput, PlatformError } from "./errors"
import type { Identity } from "./identity"
import { requireAdmin, type Mutation } from "./members"
import { findNode, unknownNode } from "./nodes/lookup"
import { saveRule } from "./rules"
import { ownerOf, teamOf } from "./nodes/view"

/**
 * Change l'accès général d'un nœud (AC-b13) : `input` validé par `generalAccessSchema` ; le nœud lu par
 * `findNode` ; la gestion exigée, et l'administrateur pour `manage` ; un nœud d'un espace personnel
 * refusé. `organisation` pose la règle de toute l'organisation au niveau demandé (`read` par défaut) ou
 * change son niveau ; `restricted` la retire. Déjà tel : rien d'écrit (`changed: false`).
 */
export async function setGeneralAccess(
  db: PlatformDb,
  identity: Identity,
  input: unknown,
): Promise<Mutation<{ path: string; access: GeneralAccess; level: AccessLevelName | null; changed: boolean }>> {
  const parsed = generalAccessSchema.safeParse(input)
  if (!parsed.success) throw invalidInput(parsed.error)
  const { path, access } = parsed.data
  const level = access === "organisation" ? (parsed.data.level ?? "read") : null
  const found = await findNode(db, identity, path)
  if (!found) throw unknownNode(path, identity.org.prefix)
  const { node } = found
  if (found.level < ACCESS_LEVELS.manage) await requireNodeLevel(db, identity, { id: node.id, path: node.path }, "share")
  if (level === "manage") requireAdmin(identity, "open a content to the whole organisation with full access")
  const owner = await ownerOf(db, node.id)
  if (owner?.kind === "user") {
    throw new PlatformError("invalid_arguments", `${node.path} is in a private space: share it with people or teams, not with the whole organisation.`)
  }
  const teamId = teamOf(owner)
  const done = (changed: boolean) => ({ data: { path: node.path, access, level, changed }, target: node.path, teamId })
  const meanwhile = `The general access of ${node.path} changed meanwhile: reload it and try again.`
  return inTransaction(db, "setGeneralAccess", async (sql) => {
    const [current] = await sql<{ id: string; level: string }[]>`
      select id, level from platform.access_rules where org_id = ${identity.org.id} and node_id = ${node.id} and subject_org`
    if (level !== null) {
      if (current?.level === level) return done(false)
      await saveRule(sql, identity, { target: { column: "node_id", id: node.id }, subject: { kind: "org" }, level }, { context: "setGeneralAccess", message: meanwhile })
      // L'équipe propriétaire suit (1.4.13) : sa règle sur ce nœud passerait devant celle de l'organisation, ses membres
      // auraient moins que les autres ; elle monte au niveau de l'organisation.
      if (teamId !== null && level !== "none") {
        const below = ACCESS_LEVEL_NAMES.slice(0, ACCESS_LEVEL_NAMES.indexOf(level))
        await sql`update platform.access_rules set level = ${level} where node_id = ${node.id} and subject_team_id = ${teamId} and level = any(${below})`
      }
      return done(true)
    }
    if (!current) return done(false)
    const deleted = await sql`delete from platform.access_rules where id = ${current.id} returning id`
    if (deleted.length === 0) throw changedMeanwhile("setGeneralAccess", current.id, meanwhile)
    return done(true)
  })
}
