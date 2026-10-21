// Les tableaux de la fixture sur une vraie base (E01-S10, lot t1-c1b), pour les tests réécrits sur la fixture
// semée (`seedTableFixture`, une graine par fichier). Chaque test
// repart du tableau semé (`freshTable`), comme un test simulé repartait de `fixtureTables()` ; un service
// tourne sous la personne (`ref.db`), ses requêtes vues par `spyDb` ; l'état qu'il
// laisse se relit par la connexion d'administration, en identifiants simulés (`readable`). `publish_node`
// n'y est plus simulé : c'est celui de la base. Sans ce module, les cinq fichiers du lot qui écrivent un
// tableau ou le relisent répéteraient chacun ces lectures et cette remise à zéro.
import type { Identity } from "../../packages/plateforme/server/identity"
import { writeNode, type WriteOrigin } from "../../packages/plateforme/server/nodes/write"
import type { RowBlock } from "../../packages/plateforme/server/tables/meta"
import { identityOf, nodeId, openDraftRow, type Person, type RuleSpec } from "../helpers/reference-org"
import type { ReferenceOrgSql } from "../helpers/reference-org-sql"
import type { Row } from "../helpers/simulated-db"
import { spyDb, type DbCall, type DbHooks } from "../helpers/spy-tables"
import { type SeededData } from "../helpers/sql"
import { fixtureTables, PROSPECTS } from "./table-fixture"

/**
 * L'identité d'une personne de O sur la base réelle, sous l'affichage de O de la base simulée (slug et
 * préfixe `acme` ; ceux de l'organisation semée sont jetables) : les textes servis au modèle restent mot
 * pour mot ceux des tests simulés ; l'organisation, la personne et ses équipes sont les réelles.
 */
export function acmeIdentity(ref: ReferenceOrgSql, person: Person, overrides: Partial<Identity> = {}): Identity {
  return ref.identityOf(person, { org: identityOf(person).org, ...overrides })
}

/**
 * Le tableau de la fixture (`ventes/suivi_prospects`) remis à son état semé : supprimé par la connexion
 * d'administration (lignes, brouillon, révisions, règles et alias partent avec lui), puis écrit de nouveau
 * depuis `fixtureTables(rules, rows)` avec ses lignes et ses règles ; `draft` : un brouillon ouvert sur sa
 * révision, son en-tête en attente (`meta`) ou aucun (`null`).
 */
export async function freshTable(
  seed: SeededData,
  ref: ReferenceOrgSql,
  options: { rows?: readonly RowBlock[]; rules?: RuleSpec[]; draft?: { meta: Record<string, unknown> | null } } = {},
): Promise<void> {
  await seed.admin`delete from platform.nodes where id = ${ref.nodeId(PROSPECTS.path)}`
  const tables = fixtureTables(options.rules, options.rows)
  if (options.draft) {
    openDraftRow(tables, PROSPECTS.path)
    tables.node_drafts[0].meta = options.draft.meta
  }
  const table = nodeId(PROSPECTS.path)
  const own = (rows: Row[]) => rows.filter((row) => row.id === table || row.node_id === table)
  await ref.write({ nodes: own(tables.nodes), blocks: own(tables.blocks), access_rules: own(tables.access_rules), node_drafts: own(tables.node_drafts) })
}

const AGENT: WriteOrigin = { kind: "agent", ctx: "7K3Q-M2XA" }

/**
 * `write` de `person` : son résultat ou son refus, et les requêtes parties (`hooks` : course ou panne jouée).
 * `write` publiant par défaut (E11-S02, AC-b1), une entrée qui ne nomme pas `publish` garde le brouillon
 * (`publish: false`), comme avant ; le défaut se teste en passant `publish: undefined`. `origin` : l'écran
 * (`human`) garde les deux temps d'une publication, qu'une écriture d'assistant tient en un (E11-S18, AC-1).
 */
export async function writeAs(ref: ReferenceOrgSql, person: Person, input: Record<string, unknown>, options: DbHooks & { origin?: WriteOrigin } = {}) {
  const { origin = AGENT, ...hooks } = options
  const { db, calls } = spyDb(await ref.db(person), hooks)
  const body = "publish" in input ? input : { ...input, publish: false }
  const outcome = await writeNode(db, acmeIdentity(ref, person), body, origin).then(
    (result) => ({ result, error: null }),
    (error: unknown) => ({ result: null, error }),
  )
  return { ...outcome, calls }
}

/** Écritures parties vers la base : insertions, mises à jour, suppressions, `open_draft`, `publish_node`. */
export function writesOf(calls: readonly DbCall[]): DbCall[] {
  return calls.filter((call) => (call.kind === "table" && call.op !== "select") || (call.kind === "rpc" && ["open_draft", "publish_node"].includes(call.name)))
}

/** Les appels de `publish_node`. */
export function publishCalls(calls: readonly DbCall[]): DbCall[] {
  return calls.filter((call) => call.kind === "rpc" && call.name === "publish_node")
}

/** Les lignes du tableau telles que la base les garde, rangées par clé, en identifiants simulés. */
export async function tableRows(seed: SeededData, ref: ReferenceOrgSql): Promise<Row[]> {
  const rows = await seed.admin<Row[]>`
    select key, data, provenance, revision, claimed_by, claimed_by_user, lease_until, updated_by, updated_at
      from platform.blocks
     where node_id = ${ref.nodeId(PROSPECTS.path)} and state = 'published' and type = 'row'
     order by key`
  return ref.readable([...rows])
}

/** Le nœud de O à ce chemin (identifiant, genre, statut, révision, en-tête), en identifiants simulés ; aucun : `undefined`. */
export async function nodeAt(seed: SeededData, ref: ReferenceOrgSql, path: string): Promise<Row | undefined> {
  const [node] = await seed.admin<Row[]>`select id, kind, status, revision, meta from platform.nodes where org_id = ${ref.org.id} and path = ${path}`
  return node === undefined ? undefined : ref.readable(node)
}

/** Le brouillon ouvert du nœud de O à ce chemin (`node_id`, `meta`), en identifiants simulés ; aucun : `[]`. */
export async function draftsAt(seed: SeededData, ref: ReferenceOrgSql, path: string): Promise<Row[]> {
  const drafts = await seed.admin<Row[]>`
    select d.node_id, d.meta from platform.node_drafts d join platform.nodes n on n.id = d.node_id
     where n.org_id = ${ref.org.id} and n.path = ${path}`
  return ref.readable([...drafts])
}
