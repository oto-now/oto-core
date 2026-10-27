// Les nouveautés de `context` (E03-S08, AC2, AC3 ; H34, FR-CONC-04) : depuis la conversation précédente de la personne
// (son dernier `ctx`, sinon 14 jours), les versions publiées des nœuds qu'elle lit et les connecteurs activés. Depuis le
// 2026-10-27 (décision de JB), elles ne sont plus un bloc : le bloc des contenus récents (`recent.ts`) les sert avec les
// contenus de la personne, une ligne par contenu, une nouveauté marquée comme telle. Les nouveautés se calculent, elles
// n'ont pas de table (architecture § 4). Sans elles, une publication n'arrive pas à la conversation suivante (FR-CONC-04).
//
// Repris de la maquette (`mcp-test/src/proto/services/context.ts` l. 179-215) : versions depuis la borne, dates
// `AAAA-MM-JJ`. Retiré : les nœuds lisibles lus par clé de service (→ jointure filtrée par l'organisation, niveaux en un lot).
import { ACCESS_LEVELS, nodeLevels } from "../../access"
import type { PlatformDb } from "../../db"
import { inTransaction, READ_PAGE_ROWS } from "../../errors"
import type { Identity } from "../../identity"

/** Une version publiée depuis la borne : le nœud (chemin courant, genre), sa dernière version, sa date (ISO). */
export type NewVersion = { path: string; kind: string; revision: number; title: string; at: string }

/** Un connecteur activé depuis la borne, daté (ISO). */
export type Activation = { connector: string; at: string }

export type News = { versions: NewVersion[]; activations: Activation[] }

/** Connecteurs lus au plus : le bloc des contenus récents n'en sert pas davantage (`RECENT_MAX`). */
const ACTIVATIONS_MAX = 20

/**
 * Les versions publiées depuis `since` des nœuds de l'organisation (jointure sur `nodes`, filtrée par `org_id` dans la
 * requête), les plus récentes d'abord, une page de `READ_PAGE_ROWS` ; Contextes, procédures et tableaux compris. Le niveau
 * de leurs nœuds est calculé en un lot, après la transaction, et un nœud de niveau 0 est retiré (HN-E01S07-8). `since`
 * passe en texte, converti dans la requête : une borne lue en base (le dernier `ctx`) garde ses microsecondes.
 */
async function versionsSince(db: PlatformDb, identity: Identity, since: string): Promise<NewVersion[]> {
  const rows = await inTransaction(
    db,
    "context: node_versions",
    (sql) => sql<{ node_id: string; revision: number; title: string; created_at: Date; path: string; kind: string }[]>`
      select v.node_id, v.revision, v.title, v.created_at, n.path, n.kind
        from platform.node_versions v
        join platform.nodes n on n.id = v.node_id
       where n.org_id = ${identity.org.id} and v.created_at > ${since}::text::timestamptz
       order by v.created_at desc
       limit ${READ_PAGE_ROWS}`,
  )
  const levels = await nodeLevels(db, identity, [...new Set(rows.map((row) => row.node_id))])
  // Une ligne par nœud, sa dernière version (E11-S16, AC-b1) : les lignes arrivent les plus récentes d'abord,
  // la première vue de chaque nœud est la sienne. Sans cela, un document réécrit cinq fois prend cinq lignes.
  const seen = new Set<string>()
  // Un filtre de liste compare `nodeLevels` à 1 seulement (`security-patterns.md § Droits dans le service`).
  return rows
    .filter((row) => (levels.get(row.node_id) ?? ACCESS_LEVELS.none) >= ACCESS_LEVELS.read)
    .filter((row) => !seen.has(row.node_id) && seen.add(row.node_id))
    .map((row) => ({ path: row.path, kind: row.kind, revision: row.revision, title: row.title, at: row.created_at.toISOString() }))
}

/** Les connecteurs actifs de l'organisation activés ou réactivés depuis `since` (N2 : `updated_at`), 20 au plus. */
async function activationsSince(db: PlatformDb, identity: Identity, since: string): Promise<Activation[]> {
  const rows = await inTransaction(
    db,
    "context: connector_activations",
    (sql) => sql<{ connector: string; updated_at: Date }[]>`
      select connector, updated_at from platform.connector_activations
       where org_id = ${identity.org.id} and state = 'active' and updated_at > ${since}::text::timestamptz
       order by updated_at desc
       limit ${ACTIVATIONS_MAX}`,
  )
  return rows.map((row) => ({ connector: row.connector, at: row.updated_at.toISOString() }))
}

/** Les nouveautés depuis `since` : versions publiées et connecteurs activés, lus en parallèle. */
export async function newsItems(db: PlatformDb, identity: Identity, since: string): Promise<News> {
  const [versions, activations] = await Promise.all([versionsSince(db, identity, since), activationsSince(db, identity, since)])
  return { versions, activations }
}
