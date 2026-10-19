// Bloc « Procedures you can run » de `context` (E03-S08, AC4, AC6 ; H35, P37) : les procédures publiées
// que la personne lit, les 15 premières par leur résumé, qui dit comment on la demande, les suivantes par leur
// titre (E11-S16), triées par l'usage de la
// personne et de ses équipes sur 90 jours, puis par chemin ; 60 lignes au plus (sans taille, E11-S03), la
// dernière ligne comptant celles qui ne sont pas listées. Sans lui, le modèle ne sait pas quelles
// procédures existent hors de la phrase routée.
//
// Repris de la maquette (`mcp-test/src/proto/services/context.ts` l. 149-172, 218-226) : usage compté
// sur les cibles du journal de 90 jours, tri par usage puis par chemin, 60 au plus. Retiré : l'usage de
// toute l'organisation (→ la personne et ses équipes, dans la portée de H74, N3), les trois
// déclencheuses par procédure (→ le résumé, P37), la lecture par clé de service.
import type { UsefulProcedure } from "../../../schemas/activity"
import { SERVED_PROCEDURES } from "../../../schemas"
import { ACCESS_LEVELS, isOrgAdmin, leadsTeam, nodeLevels } from "../../access"
import type { PlatformDb } from "../../db"
import { inTransaction, READ_PAGE_ROWS } from "../../errors"
import type { Identity } from "../../identity"
import { daysAgo, type ContextBlock } from "../engine"
import { byPath } from "./contexts"

/** Procédures listées au plus (H35). */
const PROCEDURES_MAX = 60

/**
 * Les plus utilisées, listées par leur résumé ; les suivantes, par leur titre seul (E11-S16, décision de JB) :
 * les 40 premières du jeu à l'échelle (`tests/integration/fixtures/scale-routing.cases.ts`) tiennent en 3 932 caractères
 * au lieu de 6 836, et chacune reste visible.
 */
const PROCEDURES_WITH_SUMMARY = 15

/** Fenêtre de l'usage compté (H35). */
const USAGE_DAYS = 90

type Procedure = { id: string; path: string; title: string; summary: string }

/**
 * Les procédures publiées de l'organisation que la personne lit (niveau ≥ 1 en un lot, après la
 * transaction), toutes, en une lecture sans borne : `<n>` les compte.
 */
async function readableProcedures(db: PlatformDb, identity: Identity): Promise<Procedure[]> {
  const rows = await inTransaction(
    db,
    "context: procedures",
    (sql) => sql<Procedure[]>`
      select id, path, title, summary from platform.nodes
       where org_id = ${identity.org.id} and status = 'published' and kind = 'procedure'`,
  )
  const levels = await nodeLevels(db, identity, rows.map((row) => row.id))
  // Un filtre de liste compare `nodeLevels` à 1 seulement (`security-patterns.md § Droits dans le service`).
  return rows.filter((row) => (levels.get(row.id) ?? ACCESS_LEVELS.none) >= ACCESS_LEVELS.read)
}

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

/**
 * Le texte du bloc (AC4, AC6) : « ## Procedures you can run (<n>) », puis une ligne par procédure dans
 * l'ordre reçu, 60 au plus, sans taille (E11-S03, AC-b1) : les 15 premières par leur résumé, les suivantes par
 * leur titre (E11-S16) ; dès qu'une procédure n'est pas listée, la dernière ligne la compte. Aucune : « None
 * published yet. ». Formats de `SERVED_PROCEDURES`, que l'écran relit (E05-S13, AC-16) : une ligne par titre
 * garde la forme d'une ligne par résumé ; exporté pour son test de parité, sans base.
 */
export function proceduresText(procedures: readonly Pick<Procedure, "path" | "title" | "summary">[], prefix: string): ContextBlock {
  const { title, item, separator, none, moreStart, moreEnd } = SERVED_PROCEDURES
  const header = `${title} (${procedures.length})`
  if (procedures.length === 0) return { name: "procedures", text: `${header}\n${none}` }
  const lines = procedures.map((procedure, rank) => `${item}${procedure.path}${separator}${rank < PROCEDURES_WITH_SUMMARY ? procedure.summary : procedure.title}`)
  const text = (shown: number) => {
    const more = shown < lines.length ? [`${moreStart}${lines.length - shown}${moreEnd}${prefix}_find, type procedure.`] : []
    return [header, ...lines.slice(0, shown), ...more].join("\n")
  }
  const shown = Math.min(lines.length, PROCEDURES_MAX)
  // Au budget, la liste par leurs titres seuls : chaque procédure reste nommée plutôt que coupée sans un mot.
  const titles = procedures.slice(0, shown).map((procedure) => `${item}${procedure.path}${separator}${procedure.title}`)
  const more = shown < lines.length ? [`${moreStart}${lines.length - shown}${moreEnd}${prefix}_find, type procedure.`] : []
  return { name: "procedures", text: text(shown), fallback: [header, ...titles, ...more].join("\n"), ...(shown < lines.length ? { cut: true } : {}) }
}

/** L'ordre des procédures utiles : l'usage sur 90 jours, décroissant, puis le chemin ; le même pour le bloc et l'accueil (E05-S12, AC-18). */
function byUsage(uses: ReadonlyMap<string, number>): (a: { path: string }, b: { path: string }) => number {
  const count = (procedure: { path: string }) => uses.get(procedure.path) ?? 0
  return (a, b) => count(b) - count(a) || byPath(a, b)
}

/** Le bloc des procédures utiles : procédures lisibles et usage lus en parallèle, triées par usage puis par chemin. */
export async function proceduresBlock(db: PlatformDb, identity: Identity): Promise<ContextBlock> {
  const [procedures, uses] = await Promise.all([readableProcedures(db, identity), usageByPath(db, identity)])
  const ordered = [...procedures].sort(byUsage(uses))
  return proceduresText(ordered, identity.org.prefix)
}

/**
 * Les procédures utiles de l'accueil (E05-S12, AC-18) : les `limit` premières dans l'ordre même du bloc
 * servi, par leur titre. Sa propre lecture (le titre en plus), la requête du bloc restant celle que ses
 * tests relisent ; même filtre de lecture (niveau ≥ 1, `nodeLevels`), même usage, même comparateur.
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
