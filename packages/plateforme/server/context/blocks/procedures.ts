// Les procédures utiles de l'accueil (E03-S08, AC4 ; H35, P37 ; E05-S12, AC-18) : les procédures publiées que la
// personne lit, triées par l'usage de la personne et de ses équipes sur 90 jours, puis par chemin. Jusqu'au 2026-10-27,
// `context` les servait aussi en bloc (« Procedures you can run, most used first », 60 au plus) : retiré par JB, les
// procédures proches de la demande suffisant à l'assistant ; l'accueil (« Lancer avec Claude ») les lit encore.
//
// Repris de la maquette (`mcp-test/src/proto/services/context.ts` l. 149-172, 218-226) : usage compté
// sur les cibles du journal de 90 jours, tri par usage puis par chemin. Retiré : l'usage de
// toute l'organisation (→ la personne et ses équipes, dans la portée de H74, N3), les trois
// déclencheuses par procédure (→ le résumé, P37), la lecture par clé de service.
import type { UsefulProcedure } from "../../../schemas/activity"
import { ACCESS_LEVELS, isOrgAdmin, leadsTeam, nodeLevels } from "../../access"
import type { PlatformDb } from "../../db"
import { inTransaction, READ_PAGE_ROWS } from "../../errors"
import type { Identity } from "../../identity"
import { daysAgo } from "../engine"
import { byPath } from "./contexts"

/** Fenêtre de l'usage compté (H35). */
const USAGE_DAYS = 90

/**
 * Les équipes dont les lignes comptent (N3) : celles de la personne que H74 lui ouvre — toutes pour
 * `isOrgAdmin`, celles qu'elle mène sinon ; aucune pour un simple membre.
 */
function countedTeams(identity: Identity): string[] {
  return identity.teams.filter((team) => isOrgAdmin(identity) || leadsTeam(identity, team.id)).map((team) => team.id)
}

/** Une ligne de journal comptée : son identifiant (`bigint`, rendu en texte par le pilote) et sa cible. */
type UsageLine = { id: string; target: string | null }

/**
 * L'usage par chemin sur 90 jours (AC4, N3) : les lignes de journal à `target` non nul choisies par la
 * requête, celles de la personne puis celles des équipes de `countedTeams` (aucune lecture sans équipe),
 * les `READ_PAGE_ROWS` plus récentes de chaque lecture (une page : l'usage ne fait que trier), dans une
 * transaction ; une ligne lue deux fois compte une fois.
 */
async function usageByPath(db: PlatformDb, identity: Identity): Promise<Map<string, number>> {
  const since = daysAgo(USAGE_DAYS)
  const org = identity.org.id
  const teams = countedTeams(identity)
  const reads = await inTransaction(db, "context: journal usage", (sql) => {
    const queries = [
      sql<UsageLine[]>`
        select id, target from platform.journal
         where org_id = ${org} and ts >= ${since} and target is not null and user_id = ${identity.user.id}
         order by ts desc
         limit ${READ_PAGE_ROWS}`,
    ]
    if (teams.length > 0) {
      queries.push(sql<UsageLine[]>`
        select id, target from platform.journal
         where org_id = ${org} and ts >= ${since} and target is not null and team_id = any(${teams})
         order by ts desc
         limit ${READ_PAGE_ROWS}`)
    }
    return Promise.all(queries)
  })
  const targets = new Map<string, string>()
  for (const rows of reads) for (const row of rows) if (row.target) targets.set(row.id, row.target)
  const uses = new Map<string, number>()
  for (const target of targets.values()) uses.set(target, (uses.get(target) ?? 0) + 1)
  return uses
}

/** L'ordre des procédures utiles : l'usage sur 90 jours, décroissant, puis le chemin. */
function byUsage(uses: ReadonlyMap<string, number>): (a: { path: string }, b: { path: string }) => number {
  const count = (procedure: { path: string }) => uses.get(procedure.path) ?? 0
  return (a, b) => count(b) - count(a) || byPath(a, b)
}

/**
 * Les procédures utiles de l'accueil (E05-S12, AC-18) : les `limit` premières, par leur titre, lues avec l'usage
 * (filtre de lecture niveau ≥ 1, `nodeLevels`).
 */
export async function usefulProcedures(db: PlatformDb, identity: Identity, limit: number): Promise<UsefulProcedure[]> {
  // Les procédures, l'usage et les niveaux dans une transaction (`supabase-patterns.md § Couplage à Supabase (ADR-012)`).
  return inTransaction(db, "home: useful procedures", async (sql) => {
    const [rows, uses] = await Promise.all([
      sql<(UsefulProcedure & { id: string })[]>`
        select id, path, title from platform.nodes
         where org_id = ${identity.org.id} and status = 'published' and kind = 'procedure'`,
      usageByPath(db, identity),
    ])
    const levels = await nodeLevels(db, identity, rows.map((row) => row.id))
    return rows
      .filter((row) => (levels.get(row.id) ?? ACCESS_LEVELS.none) >= ACCESS_LEVELS.read)
      .sort(byUsage(uses))
      .slice(0, limit)
      .map(({ path, title }) => ({ path, title }))
  })
}
