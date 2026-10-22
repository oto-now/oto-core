/**
 * La carte des tables d'une organisation pour sa suppression (`administration-et-cellule.md` § Suppression d'une
 * organisation) : chaque table de `platform` qui tient l'organisation, par `org_id` (`id` pour `orgs`) ou par sa ligne
 * parente, avec ce que la suppression en fait ; les autres tables, avec la raison qui les laisse. La suite
 * `tests/integration/suppression-organisation.test.ts` confronte la carte au catalogue de la base et sème une ligne
 * dans chaque table : une table ajoutée à `platform` y échoue tant qu'elle n'est pas rangée ici.
 */

/**
 * @typedef {object} OrgTable
 * @property {string} name
 * @property {{ table: string, column: string } | null} parent  rattachement d'une table sans `org_id`
 * @property {'deleted' | 'anonymized'} fate  supprimée (cascade depuis `orgs`), ou anonymisée et gardée
 */

/** @returns {OrgTable} */
const deleted = (name, parent = null) => ({ name, parent, fate: 'deleted' })

/** Dans l'ordre du compte rendu : l'organisation et ses personnes, le contenu, les connecteurs, le journal. */
export const ORG_TABLES = [
  deleted('orgs'),
  deleted('org_domains'),
  deleted('members'),
  deleted('member_exclusions'),
  deleted('invitations'),
  deleted('teams'),
  deleted('team_members', { table: 'teams', column: 'team_id' }),
  deleted('platform_grants'),
  deleted('nodes'),
  deleted('node_drafts', { table: 'nodes', column: 'node_id' }),
  deleted('node_versions', { table: 'nodes', column: 'node_id' }),
  deleted('blocks'),
  deleted('node_aliases'),
  deleted('links'),
  deleted('node_shares'),
  deleted('files'),
  deleted('erased_files'),
  deleted('upload_tickets'),
  deleted('node_views'),
  deleted('lexicon'),
  deleted('accounts'),
  deleted('access_rules'),
  deleted('account_share_events'),
  deleted('connector_activations'),
  deleted('connector_consents'),
  deleted('hosted_link_requests'),
  deleted('sim_outbox'),
  deleted('jobs'),
  deleted('ctx'),
  deleted('journal'),
  deleted('feedback'),
  deleted('pseudonym_orgs'),
  // Décision d'Alexis : la trace de l'équipe plateforme reste, sans ce qui nomme le contenu de l'organisation.
  { name: 'admin_journal', parent: null, fate: 'anonymized' },
]

/** Les tables de `platform` qui ne tiennent aucune organisation, et pourquoi la suppression les laisse. */
export const NOT_DELETED = {
  platform_staff: "l'équipe plateforme de la cellule, sans organisation",
  identities:
    "le lien d'une personne à son émetteur, sans organisation : une personne membre d'une autre organisation ou de l'équipe plateforme en a besoin ; l'oublier est forget_user",
  connectors: "la liste des connecteurs de l'hôte, sans organisation",
}

/**
 * Les lignes de l'organisation dans une table de la carte, en SQL : par `org_id` (`id` pour `orgs`), ou par les lignes
 * parentes de l'organisation. Chaque identifiant vient de la carte, jamais d'un argument.
 * @param {import('postgres').Sql} sql
 * @param {OrgTable} table
 * @param {string} orgId
 * @returns {import('postgres').PendingQuery<any>}  un fragment de `where`
 */
export function orgRowsWhere(sql, table, orgId) {
  if (table.parent) return sql`${sql(table.parent.column)} in (select "id" from ${sql(`platform.${table.parent.table}`)} where "org_id" = ${orgId})`
  return sql`${sql(table.name === 'orgs' ? 'id' : 'org_id')} = ${orgId}`
}

/**
 * Le nombre de lignes de l'organisation dans chaque table de la carte, en une requête.
 * @param {import('postgres').Sql} sql
 * @param {string} orgId
 * @returns {Promise<Record<string, number>>}
 */
export async function countOrgRows(sql, orgId) {
  const counts = ORG_TABLES.map(
    (table) => sql`(select count(*)::int from ${sql(`platform.${table.name}`)} where ${orgRowsWhere(sql, table, orgId)}) as ${sql(table.name)}`,
  )
  const [row] = await sql`select ${counts.reduce((list, count) => sql`${list}, ${count}`)}`
  return row
}
