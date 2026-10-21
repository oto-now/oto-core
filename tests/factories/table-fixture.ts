// Fixture des tableaux (E07-S01, § Tests attendus ; reprise par E07-S02 à E07-S04) : le tableau
// `ventes/suivi_prospects` de l'équipe Ventes, son en-tête (H91) et douze lignes au format des blocs
// `row` (E01-S06 § Contrat : `key` en texte, `data` avec la colonne clé, `provenance` par colonne,
// bail), fictives (ADR-010) ; plus, pour les droits (AC4, AC20), `support/tickets` (Support, clé
// nombre), le tableau personnel de Claire, un tableau jamais publié et un tableau de P. Lues en
// mémoire, ou posées dans les tables de la base simulée d'E01-S07 par `fixtureTables` : aucune
// écriture sur un projet Supabase. Les lignes d'AC7 sont semées telles quelles (clé `fax` non
// déclarée, `relance_le` nul, montant en texte) : la base ne contrôle aucun type dans `data`.
//
// Reprend de la maquette (`mcp-test/scripts/lib/proto-data.mjs` l. 270-300) les prospects fictifs du
// tableau ; retire la colonne d'état à part et les états `relancé`, `gagné`, `perdu` (→ H91).
import { checkArguments } from "../../packages/plateforme/server/catalog/arguments"
import type { CatalogFunction, FunctionContext, FunctionOutput } from "../../packages/plateforme/server/catalog/define"
import type { RowBlock } from "../../packages/plateforme/server/tables/meta"
import { CONTENT_AT, contentDefaults, contentRpc, contentTables, nodeId, ORG, OTHER_ORG, PEOPLE, referenceRpc, type RuleSpec } from "../helpers/reference-org"
import { liveTables, simulatedDb, type Row, type SimulatedCall, type SimulatedError, type Tables } from "../helpers/simulated-db"

export const STATES = ["à traiter", "en cours", "à revoir", "qualifié", "écarté"]

/** En-tête du tableau de référence : dix colonnes, clé `entreprise`, file sur `statut` avec revue. */
export const PROSPECTS_HEADER = {
  columns: [
    { name: "entreprise", type: "text", required: true, max_length: 200 },
    { name: "contact", type: "text" },
    { name: "email", type: "email" },
    { name: "ville", type: "text" },
    { name: "montant_estime", type: "number" },
    { name: "dernier_contact", type: "date" },
    { name: "relance_le", type: "datetime" },
    { name: "actif", type: "bool" },
    { name: "notes", type: "text" },
    { name: "statut", type: "enum", required: true, options: STATES },
  ],
  key: "entreprise",
  lifecycle: { column: "statut", states: STATES, working: "en cours", review: { state: "à revoir", approve: "qualifié", reject: "écarté" } },
  closed: false,
  // La preuve exigée (fiche D133, HN-E11S01-13) : les tests de M53 et d'HN-M53-10 gardent leurs refus.
  proof: true,
}

export const PROSPECTS = {
  path: "ventes/suivi_prospects",
  title: "Suivi des prospects",
  summary: "Les prospects de l'équipe Ventes et la file des fiches à qualifier.",
}

/** Date des provenances semées ; un bail actif finit loin dans le futur, un bail expiré dans le passé. */
export const WRITTEN_AT = "2026-09-01T08:00:00+00:00"
export const LEASE_ACTIVE = "2999-12-31T00:00:00+00:00"
export const LEASE_EXPIRED = "2026-01-01T00:00:00+00:00"

/** Un membre qui n'est plus dans l'annuaire : sa provenance se lit « former member » (N9). */
const FORMER_USER = "user-former"

const imported = { origin: "import", by: PEOPLE.ada.id, at: WRITTEN_AT }

/** Une ligne : `data` porte la colonne clé ; chaque colonne renseignée a une provenance d'import, sauf `special`. */
function row(data: Record<string, unknown>, special: Record<string, unknown> = {}, extra: Partial<RowBlock> = {}): RowBlock {
  const provenance = Object.fromEntries(Object.keys(data).filter((column) => data[column] !== null).map((column) => [column, imported]))
  return {
    key: String(data.entreprise),
    data,
    provenance: { ...provenance, ...special },
    revision: 1,
    claimed_by: null,
    claimed_by_user: null,
    lease_until: null,
    ...extra,
  }
}

/** Les douze prospects, dans l'ordre naturel de leurs clés (AC6). */
export const PROSPECT_ROWS: RowBlock[] = [
  row({ entreprise: "Atelier 2", contact: "Nina Perrault", email: "nina@atelier2.test", ville: "Valbrune", montant_estime: 2000, dernier_contact: "2026-03-02", relance_le: "2026-09-30T09:00:00Z", actif: true, statut: "à traiter" }),
  row(
    { entreprise: "Atelier 10", contact: "Hugo Lemaire", email: "hugo@atelier10.test", ville: "Brémontier", montant_estime: 100000, dernier_contact: "2026-06-15", actif: true, statut: "en cours" },
    {},
    { revision: 3, claimed_by: "claude-claire", claimed_by_user: PEOPLE.claire.id, lease_until: LEASE_ACTIVE },
  ),
  row(
    { entreprise: "Boulangerie Fournier", contact: "Marius Roche", ville: "Valbrune", montant_estime: 9000, actif: true, statut: "à traiter" },
    { email: { origin: "verified_empty", by: PEOPLE.lea.id, at: WRITTEN_AT, reason: "Aucune adresse sur le site ni à l'annuaire" } },
    { revision: 2 },
  ),
  // Montant rangé en texte par la clé service : une valeur hors type (AC9).
  row({ entreprise: "Brasserie de la Lise", contact: "Léon Faure", ville: "Coudray", montant_estime: "12000", actif: true, statut: "à traiter" }),
  row(
    { entreprise: "Camping Les Pins", contact: "Inès Vidal", email: "ines@campinglespins.test", ville: "Saint-Arlan", montant_estime: 30000, dernier_contact: "2026-05-05", actif: true, statut: "à traiter" },
    { email: { origin: "human", by: PEOPLE.lea.id, at: WRITTEN_AT, imported: { value: "contact@campinglespins.test", at: "2026-08-01T00:00:00+00:00" } } },
    { revision: 2 },
  ),
  row(
    { entreprise: "Clinique des Saules", contact: "Rémi Barthe", email: "remi@saules.test", ville: "Saint-Arlan", montant_estime: 22000, dernier_contact: "2026-07-01", relance_le: "2026-09-26T08:00:00Z", actif: false, notes: "Rappeler en octobre", statut: "à revoir" },
    { notes: { origin: "agent", by: FORMER_USER, at: WRITTEN_AT } },
  ),
  // Relance à 10 h à Paris (+02:00), soit 08:00 UTC : avant celle d'Atelier 2 (09:00 UTC), après elle dans l'ordre des caractères.
  row(
    { entreprise: "École de Valbrune", contact: "Sophie Lacroix", email: "sophie@ecole-valbrune.test", ville: "Valbrune", montant_estime: 10000, dernier_contact: "2026-01-20", relance_le: "2026-09-30T10:00:00+02:00", actif: true, notes: "Visite prévue", statut: "à revoir" },
    { montant_estime: { origin: "human", by: PEOPLE.claire.id, at: WRITTEN_AT, comment: "Devis signé en mairie", link: "https://valbrune.test/deliberation-12" } },
    { revision: 2 },
  ),
  row({ entreprise: "Ferme du Coudray", contact: "Aline Besson", montant_estime: 5000, dernier_contact: "2026-02-10", actif: true, statut: "à traiter" }),
  // `contact` vidé : ni valeur ni provenance.
  row({ entreprise: "Garage des Tilleuls", email: "garage@tilleuls.test", ville: "Brémontier", montant_estime: 45000, actif: false, statut: "qualifié" }, {}, { revision: 4 }),
  // `fax` n'est pas une colonne déclarée (valeur restée sous une colonne retirée, E07-S04).
  row({ entreprise: "Mairie de Coudray", contact: "Anne Delaunay", ville: "Coudray", actif: false, statut: "écarté", fax: "01 23 45 67 89" }),
  // `relance_le` nul, rangé par la clé service.
  row({ entreprise: "Pharmacie du Port", contact: "Tom Rivière", email: "tom@pharmacieduport.test", ville: "Port-Lise", montant_estime: 60000, relance_le: null, actif: true, statut: "à traiter" }),
  row(
    { entreprise: "Scierie Vallon", contact: "Denis Vallon", ville: "Haute-Lise", montant_estime: 15000, actif: true, statut: "en cours" },
    {},
    { revision: 5, claimed_by: "claude-lea", claimed_by_user: PEOPLE.lea.id, lease_until: LEASE_EXPIRED },
  ),
]

/** `support/tickets` : équipe Support, clé `numero` de type nombre (AC7), deux lignes. */
export const TICKETS = {
  path: "support/tickets",
  header: {
    columns: [
      { name: "numero", type: "number", required: true },
      { name: "sujet", type: "text" },
    ],
    key: "numero",
    closed: true,
  },
  rows: [
    { key: "12", data: { numero: 12, sujet: "Panne du portail" }, provenance: {}, revision: 1, claimed_by: null, claimed_by_user: null, lease_until: null },
    { key: "7", data: { numero: 7, sujet: "Facture en double" }, provenance: {}, revision: 1, claimed_by: null, claimed_by_user: null, lease_until: null },
  ] satisfies RowBlock[],
}

/** Tableau personnel de Claire (H61), tableau jamais publié de Ventes, tableau de P (une autre organisation). */
export const PERSONAL_TABLE = "private/claire/notes"
export const DRAFT_TABLE = "ventes/brouillon"
export const FOREIGN_TABLE = { id: "other:node:achats/fournisseurs", path: "achats/fournisseurs" }

/**
 * `count` lignes sans provenance ni bail, pour les bornes de taille (5 000 lignes, 1 000 groupes) : `make` donne les
 * données de chaque rang, la clé étant son `entreprise` ; par défaut « Prospect 0000 »… « à traiter ».
 */
export function manyRows(count: number, make: (index: number) => Record<string, unknown> = (index) => ({ entreprise: `Prospect ${String(index).padStart(4, "0")}`, statut: "à traiter" })): RowBlock[] {
  return Array.from({ length: count }, (_, index) => {
    const data = make(index)
    return { key: String(data.entreprise), data, provenance: {}, revision: 1, claimed_by: null, claimed_by_user: null, lease_until: null }
  })
}

const SMALL_HEADER = { columns: [{ name: "nom", type: "text" }], key: "nom", closed: false }

/** Les lignes de `blocks` d'un tableau : blocs `row` publiés du nœud. */
export function rowBlocks(tableId: string, rows: readonly RowBlock[], orgId: string = ORG.id): Row[] {
  return rows.map((block, index) => ({ id: `${tableId}:row:${index}`, org_id: orgId, node_id: tableId, state: "published", type: "row", text: null, position: null, ...structuredClone(block) }))
}

function setMeta(tables: Tables, path: string, meta: unknown): void {
  const node = tables.nodes.find((candidate) => candidate.id === nodeId(path))
  if (node) node.meta = structuredClone(meta)
}

/**
 * Les tables de la base simulée (organisation O d'E01-S07 et son contenu d'E03-S03) avec les
 * tableaux de la fixture publiés et leurs lignes, `rules` en plus ; `rows` remplace au besoin les
 * douze prospects (tableaux de 5 001 lignes, pages coupées).
 */
export function fixtureTables(rules: RuleSpec[] = [], rows: readonly RowBlock[] = PROSPECT_ROWS): Tables {
  const tables = contentTables(rules, [
    { path: "ventes", title: "Ventes" },
    { path: PROSPECTS.path, kind: "table", title: PROSPECTS.title, summary: PROSPECTS.summary, revision: 3 },
    { path: TICKETS.path, kind: "table", title: "Tickets", summary: "Les tickets du support." },
    { path: PERSONAL_TABLE, kind: "table", title: "Mes notes", summary: "Notes de Claire." },
    { path: DRAFT_TABLE, kind: "table", title: "Brouillon", summary: "Un tableau jamais publié.", status: "draft", revision: 0 },
    { path: "conseil", title: "Conseil" },
    { path: "conseil/grille_tarifaire", title: "Grille tarifaire", summary: "Les tarifs du conseil." },
    { path: "ventes/qualifier_prospects", kind: "procedure", title: "Qualifier les prospects" },
  ])
  setMeta(tables, PROSPECTS.path, PROSPECTS_HEADER)
  setMeta(tables, TICKETS.path, TICKETS.header)
  setMeta(tables, PERSONAL_TABLE, SMALL_HEADER)
  tables.nodes.push({
    id: FOREIGN_TABLE.id,
    org_id: OTHER_ORG.id,
    parent_id: OTHER_ORG.root,
    path: FOREIGN_TABLE.path,
    kind: "table",
    title: "Fournisseurs",
    summary: "Les fournisseurs de P.",
    status: "published",
    revision: 1,
    meta: structuredClone(SMALL_HEADER),
    owner_kind: "org",
    owner_team_id: null,
    owner_user_id: null,
    created_by: null,
    updated_by: null,
    created_at: CONTENT_AT,
    updated_at: CONTENT_AT,
  })
  tables.blocks.push(
    ...rowBlocks(nodeId(PROSPECTS.path), rows),
    ...rowBlocks(nodeId(TICKETS.path), TICKETS.rows),
    ...rowBlocks(nodeId(PERSONAL_TABLE), [{ ...TICKETS.rows[0], key: "idée", data: { nom: "idée" } }]),
    ...rowBlocks(FOREIGN_TABLE.id, [{ ...TICKETS.rows[0], key: "Fournisseur P", data: { nom: "Fournisseur P" } }], OTHER_ORG.id),
  )
  return tables
}

/** La base simulée d'E01-S07 sur ces tables : sans règle d'accès, `member_directory` et `node_owner` rendus comme la base. */
export function fixtureDb(tables: Tables = fixtureTables()) {
  return simulatedDb({ tables, rpc: { ...referenceRpc(), ...contentRpc() } })
}

/** Ce qu'une autre requête fait à la base juste avant celle-ci, ou le refus que la base lui rend (E07-S02). */
export type WriteHook = (call: SimulatedCall, live: Tables) => SimulatedError | null

/**
 * La base simulée des écritures (E07-S02) : celle de `fixtureDb`, où la base pose `id`, `revision` et les
 * dates d'un bloc inséré (`contentDefaults`) ; `hook` voit les tables vivantes à chaque requête, pour une
 * écriture concurrente ou un refus de la base (`23505`).
 */
export function writableDb(tables: Tables = fixtureTables(), hook?: WriteHook) {
  let live = tables
  const simulated = simulatedDb({ tables, rpc: { ...referenceRpc(), ...contentRpc() }, defaults: contentDefaults, fail: (call) => hook?.(call, live) ?? null })
  live = liveTables(simulated)
  return simulated
}

/**
 * Une fonction du catalogue appelée comme `call` l'appellera (E03-S04) : arguments validés par son
 * schéma strict, puis exécutés ; un argument refusé lève avant toute requête.
 */
export async function runFunction(fn: CatalogFunction, context: FunctionContext, args: Record<string, unknown>): Promise<FunctionOutput> {
  const parsed = checkArguments(fn.schema, args)
  if (!parsed.success) throw new Error(`${fn.name}: invalid arguments ${JSON.stringify(parsed.issues)}`)
  // Le type commun du catalogue efface les arguments en `never` ; ceux-ci ont passé le schéma de la fonction.
  return fn.run(context, parsed.data as never)
}
