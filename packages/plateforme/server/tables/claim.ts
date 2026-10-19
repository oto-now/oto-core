// `table.claim` (E07-S02, AC20 à AC23 ; H98, N11, N12, N14) : la file de travail d'un tableau. Le tableau
// est chargé et l'écriture décidée avant toute lecture de lignes (`loadTable`, `requireWrite`) ; puis le
// quota du travailleur (baux actifs de la même personne et du même libellé), les candidats (baux
// expirés, puis l'attente la plus longue, puis la clé), resserrés par le filtre d'E07-S01, et des mises
// à jour une à une gardées par la révision : deux réservations ne rendent jamais la même ligne. Le bail
// est lié à la personne (`claimed_by_user`) et au libellé (`claimed_by`), posés avec `lease_until`. Sans
// lui, pas de file de travail (H98). Face SQL (E01-S10, lot c1) : les réservations d'un appel tiennent
// dans une transaction (AC-x4) ; une panne de la base au milieu n'en laisse aucune.
//
// Repris de la maquette (`mcp-test/src/proto/functions/table.ts` l. 286-330) : baux expirés d'abord, mise
// à jour gardée par la révision, bornes 5 et 60, texte « Claimed … Release each one … ». Retiré : le bail
// tenu par le seul libellé. Repris d'Oto (`db/rowlock.py` l. 60-85, 150-271 ; `datastore/file_de_travail.py`
// l. 71-136) : la plus ancienne ligne éligible, deux réservations jamais sur la même ligne, bail expiré =
// ligne libre. Retiré : le bail non borné, la titularité par `run`, le plafond de reprises (V2).
import type { TableLifecycle } from "../../schemas"
import { DEFAULT_LEASE_MINUTES, tableClaimArgsSchema, type TableClaimArgs } from "../../schemas/table-write"
import { isRecord } from "../../schemas/tables"
import { defineFunction, type FunctionContext, type FunctionOutput } from "../catalog/define"
import type { PlatformDb } from "../db"
import { boundedList, inTransaction, PlatformError } from "../errors"
import { wellFormed } from "../journal"
import { checkClaimArgs } from "./check"
import { matchesRow, parseFilter, type FilterClause } from "./filters"
import { loadTable, rowCells, type LoadedTable } from "./meta"
import { requireWrite, tableResult, tableTeamId, utcClock } from "./output"
import { asJson, countWaiting, leaseActive, queueRows, updateRow, type StoredRow } from "./row-store"
import { countRows, FILTERED_ROWS_MAX, toReadRow, tooManyRows } from "./rows"
import { cellProvenance, type RowActor } from "./write-row"

/** Baux actifs au plus par personne, travailleur et tableau (H98, N11). */
const MAX_LEASES = 5

/** Candidats lus par état sans filtre : de quoi servir 5 lignes quand d'autres réservations en prennent en même temps. */
const CANDIDATES = 50

/** Un tableau sans cycle n'a pas de file (AC20). */
function noQueue(path: string, fn: "table.claim" | "table.release"): PlatformError {
  return new PlatformError("invalid_arguments", `Table ${path} has no work queue (no lifecycle): ${fn} does not apply.`)
}

/** Le cycle d'un tableau, exigé par la file (AC20, AC24). */
export function queueOf(table: LoadedTable, fn: "table.claim" | "table.release"): TableLifecycle {
  if (!table.header.lifecycle) throw noQueue(table.node.path, fn)
  return table.header.lifecycle
}

/** Baux actifs de la personne et du travailleur sur ce tableau (AC21), comptés par la base. */
async function heldLeases(db: PlatformDb, table: LoadedTable, holder: { userId: string; worker: string }, at: string): Promise<number> {
  const [held] = await inTransaction(db, "tables: claim leases", (sql) => sql<{ count: number }[]>`
      select count(*)::int as count from platform.blocks
       where node_id = ${table.node.id} and state = ${"published"} and type = ${"row"}
         and claimed_by_user = ${holder.userId} and claimed_by = ${holder.worker} and lease_until > ${at}`)
  return held?.count ?? 0
}

/** Depuis quand une ligne attend (N12) : sa dernière écriture ; sans date lisible, en dernier, comme l'ordre de Postgres. */
function waitedSince(row: StoredRow): number {
  const at = Date.parse(row.updated_at)
  return Number.isNaN(at) ? Number.POSITIVE_INFINITY : at
}

/** L'ordre de la file (N12) : l'attente la plus longue d'abord, puis la clé. */
function byWait(rows: readonly StoredRow[]): StoredRow[] {
  return [...rows].sort((a, b) => {
    const [left, right] = [waitedSince(a), waitedSince(b)]
    if (left !== right) return left < right ? -1 : 1
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
  })
}

/**
 * Les lignes éligibles (AC20, AC23, N12, N14) : l'état de travail dont le bail est passé (index
 * `idx_blocks_node_id_lease_until`), puis le premier état ; chacun dans l'ordre de l'attente
 * (`updated_at`), puis de la clé. Sans filtre, les `CANDIDATES` premières de chaque état, rangées par
 * la base. Avec un filtre, calculé dans le service (N6 d'E07-S01), toutes (5 000 lignes au plus, le
 * tableau compté avant), rangées ici : une ligne qui répond au filtre au-delà des premières reste
 * atteignable.
 */
async function candidates(db: PlatformDb, table: LoadedTable, lifecycle: TableLifecycle, scope: { at: string; filtered: boolean }): Promise<StoredRow[]> {
  const limit = scope.filtered ? undefined : CANDIDATES
  const [late, fresh] = await Promise.all([
    queueRows(db, table.node.id, { column: lifecycle.column, state: lifecycle.working, expiredBefore: scope.at, limit }),
    queueRows(db, table.node.id, { column: lifecycle.column, state: lifecycle.states[0], limit }),
  ])
  return scope.filtered ? [...byWait(late), ...byWait(fresh)] : [...late, ...fresh]
}

type Claim = { worker: string; actor: RowActor; until: string; lifecycle: TableLifecycle }

/**
 * Une ligne prise (AC20) : état de travail, provenance de l'état, bail posé d'un coup (`claimed_by`,
 * `claimed_by_user`, `lease_until` : la base refuse l'un sans l'autre, `23514`), révision + 1, sous la
 * garde de la révision lue ; `null` : une autre réservation ou écriture l'a changée (AC22). La
 * provenance de l'état garde la révision qu'elle pose (`claim_revision`) : sans elle, une libération ne
 * saurait pas si la ligne a changé depuis (AC25, N13).
 */
async function take(db: PlatformDb, row: StoredRow, claim: Claim): Promise<StoredRow | null> {
  const { lifecycle, actor } = claim
  const data = { ...(isRecord(row.data) ? row.data : {}), [lifecycle.column]: lifecycle.working }
  const revision = row.revision + 1
  const provenance = isRecord(row.provenance) ? row.provenance : {}
  const stateProvenance = cellProvenance(actor, provenance[lifecycle.column], { claim_revision: revision })
  return updateRow(db, row, {
    data: asJson(data),
    provenance: asJson({ ...provenance, [lifecycle.column]: stateProvenance }),
    claimed_by: claim.worker,
    claimed_by_user: actor.userId,
    lease_until: claim.until,
    revision,
    updated_by: actor.userId,
  }, { skipLocked: true })
}

function filterClauses(table: LoadedTable, args: TableClaimArgs, masked?: (text: string) => string): FilterClause[] {
  const filter = parseFilter(args.filter, table.header, masked)
  if ("problems" in filter) throw new PlatformError("invalid_arguments", boundedList(filter.problems, " "))
  return filter.clauses
}

async function claimRows(context: FunctionContext, validated: TableClaimArgs): Promise<FunctionOutput> {
  // Aucune moitié de paire de substitution vers la base (`supabase-patterns.md § Error Handling`) :
  // le libellé écrit et celui que `table.release` compare restent le même.
  const args = wellFormed(validated)
  const table = await loadTable(context, args.table)
  await requireWrite(context, table)
  const lifecycle = queueOf(table, "table.claim")
  const clauses = filterClauses(table, args, context.pseudonymized)
  const { db, identity } = context
  const path = table.node.path
  const filtered = clauses.length > 0
  // Un filtre se calcule dans le service sur 5 000 lignes au plus, comme celui de `table.rows` (N6 d'E07-S01).
  if (filtered) {
    const count = await countRows(db, table.node.id)
    if (count > FILTERED_ROWS_MAX) throw tooManyRows(path, count)
  }
  const teamId = await tableTeamId(db, table)
  const now = Date.now()
  const at = new Date(now).toISOString()
  const worker = args.worker
  const held = await heldLeases(db, table, { userId: identity.user.id, worker }, at)
  if (held >= MAX_LEASES) {
    throw new PlatformError("conflict", `Worker ${worker} already holds ${MAX_LEASES} leases on ${path} (the maximum): release some before claiming more.`)
  }
  const requested = args.limit ?? 1
  const wanted = Math.min(requested, MAX_LEASES - held)
  const until = new Date(now + (args.lease_minutes ?? DEFAULT_LEASE_MINUTES) * 60_000).toISOString()
  const found = await candidates(db, table, lifecycle, { at, filtered })
  const eligible = found.filter((row) => !leaseActive(row, now) && matchesRow(rowCells(row, table.header), clauses))
  const claim: Claim = { worker, actor: { userId: identity.user.id, ctx: context.ctx ?? null, at, host: context.host ?? null, worker }, until, lifecycle }
  // Les réservations de l'appel en une transaction (AC-x4 d'E01-S10) : une panne de la base au milieu les
  // annule toutes ; une panne de son ouverture ou de sa validation se traduit comme les autres (HN-E01S10-15).
  const claimed = await inTransaction(db, "tables: claim", async () => {
    const taken: StoredRow[] = []
    // Une à une, gardées par la révision : une ligne prise entre-temps, ou qu'une écriture ouverte tient encore
    // (`skipLocked`, M32), est passée, la suivante essayée.
    for (const row of eligible) {
      if (taken.length >= wanted) break
      const one = await take(db, row, claim)
      if (one) taken.push(one)
    }
    return taken
  })
  const names = new Map([[identity.user.id, identity.user.name]])
  const rows = claimed.map((row) => toReadRow(row, table.header, names, { now }))
  const quota = requested > wanted ? [`${wanted} of ${requested} requested: worker ${worker} may hold ${MAX_LEASES} leases on this table.`] : []
  if (rows.length === 0) {
    const text = [`No row « ${lifecycle.states[0]} » left to claim in ${path}.`, ...quota].join("\n")
    return tableResult(table, { text, data: { table: path, worker, until, claimed: rows } }, teamId)
  }
  // Ce qui reste dans la file après cet appel, toute la file (sans le filtre) : le modèle sait s'il y revient (fiche D99, M53).
  const left = await countWaiting(db, table.node.id, { column: lifecycle.column, entry: lifecycle.states[0], working: lifecycle.working, at })
  const text = [
    `Claimed ${rows.length} row(s) for ${worker} until ${utcClock(until)}:`,
    ...rows.map((row) => JSON.stringify(row)),
    "Release each one with table.release when done.",
    `Left in the queue: ${left} row(s) to process.`,
    ...quota,
  ]
  // Une ligne réservée se lit comme une fiche (widget, story widgets-dans-la-conversation) ; plusieurs, en texte.
  const view = rows.length === 1 ? { view: "record" as const } : {}
  return tableResult(table, { text: text.join("\n"), data: { table: path, worker, until, claimed: rows, left }, ...view }, teamId)
}

export const tableClaim = defineFunction({
  name: "table.claim",
  connector: "table",
  class: "write",
  origin: "paquet",
  description:
    "Reserves rows of a table's work queue for a worker, in the order of the queue: rows whose lease expired first, then rows in the first state, the longest waiting first (by their last change), then by key; they move to the working state under a lease (15 minutes by default, 60 at most). Use it to take the next rows to process; two claims never return the same row, and the answer says how many rows are left to process. Release each row with table.release when done.",
  schema: tableClaimArgsSchema,
  examples: [
    { table: "ventes/suivi_prospects", worker: "claude-claire", limit: 3 },
    { table: "ventes/suivi_prospects", worker: "claude-claire", limit: 5, lease_minutes: 30, filter: { ville: "Valbrune" } },
  ],
  refusals: [
    "Unknown table: not a table you can read; the refusal lists the tables you can read.",
    "Writing is reserved to the team that owns the table: the refusal says whom to ask.",
    "A table without work queue (no lifecycle).",
    "More than 5 rows or a lease of more than 60 minutes; a worker name empty or longer than 40 characters.",
    "A worker that already holds 5 leases on the table: release some first.",
    "A filter refused like the filter of table.rows, on a table of more than 5,000 rows too.",
  ],
  next: ["table.write", "table.release"],
  checkArgs: checkClaimArgs,
  run: claimRows,
})
