/**
 * org-transfer — carte des tables de `platform` et fonctions pures de l'export-import d'une
 * organisation (E09-S04, H112) : contrôle du fichier, personnes citées, ordre des nœuds,
 * remplacement des identifiants, lots d'insertion, résumé. Rien n'écrit ici : `scripts/org-export.mjs`
 * et `scripts/org-import.mjs` parlent à la base. Pour le plafond de lignes d'ESLint, les arguments et
 * les variables vivent dans `org-transfer-args.mjs`, le plan d'import et l'empreinte dans
 * `org-transfer-plan.mjs`.
 *
 * Outillage du dépôt, à la connexion d'administration (ADR-006 § 3, E01-S10 AC-f4) : jamais importé
 * par le paquet ni par l'hôte.
 */
import { randomBytes, randomInt } from 'node:crypto'
import { UUID } from './env.mjs'

export const FORMAT = 'oto-platform-org-export'
export const VERSION = 1

/**
 * Politique d'une colonne qui désigne une personne absente de la cible : `sauter` (la ligne), `null`,
 * `auteur` (`--auteur-par-defaut`) ; `membre` : la ligne n'entre que si la personne est un membre
 * importé (`nodes_guard` refuse un espace personnel dont le propriétaire n'est pas membre).
 * @typedef {'sauter' | 'null' | 'auteur' | 'membre'} PersonPolicy
 */

/**
 * @typedef {object} TableSpec
 * @property {string} name
 * @property {boolean} journal  groupe journal : exporté et importé sur option (`--with-journal`)
 * @property {{ table: string, column: string } | null} parent  rattachement d'une table sans `org_id`
 * @property {string[]} key  clé primaire, ordre des lignes de l'export
 * @property {'uuid' | 'ctx' | 'sim' | null} newKey  clé fabriquée à l'import (null : composée de
 *   références, ou identité régénérée par la base)
 * @property {string[]} columns  colonnes exportées, une à une
 * @property {string[]} excluded  colonnes que la base calcule ou garde secrètes, jamais lues
 * @property {Record<string, string>} refs  clés remplacées : colonne → table désignée
 * @property {string[]} nullWhenSkipped  références remises à null quand leur cible est sautée
 * @property {Record<string, PersonPolicy>} people  colonnes de personne et leur politique
 * @property {{ column: string, value: string }} [only]  seules les lignes où la colonne vaut cette valeur
 *   s'exportent (fichiers joints : `ready`)
 */

/** @returns {TableSpec} */
function table(name, spec) {
  return { journal: false, parent: null, key: ['id'], newKey: 'uuid', excluded: [], refs: {}, nullWhenSkipped: [], people: {}, ...spec, name }
}

const cols = (text) => text.split(' ')

/**
 * Ordre d'insertion = ordre du tableau (clés étrangères, déclencheurs d'E01-S04 et d'E01-S06).
 * `org_domains` est exportée, jamais importée (`--domain`) ; `platform_staff` n'est jamais exportée.
 * @type {TableSpec[]}
 */
export const TABLES = [
  table('orgs', { columns: cols('id slug name prefix brand settings flags rules_version created_at updated_at') }),
  table('org_domains', { key: ['host'], newKey: null, columns: cols('host org_id created_at'), refs: { org_id: 'orgs' } }),
  table('teams', {
    columns: cols('id org_id slug name lead_user_id created_at'),
    refs: { org_id: 'orgs' },
    people: { lead_user_id: 'null' },
  }),
  table('members', {
    key: ['org_id', 'user_id'],
    newKey: null,
    columns: cols('org_id user_id role default_team_id profile created_at email name last_sign_in_at'),
    refs: { org_id: 'orgs', default_team_id: 'teams' },
    people: { user_id: 'sauter' },
  }),
  table('team_members', {
    parent: { table: 'teams', column: 'team_id' },
    key: ['team_id', 'user_id'],
    newKey: null,
    columns: cols('team_id user_id role created_at'),
    refs: { team_id: 'teams' },
    people: { user_id: 'sauter' },
  }),
  table('accounts', {
    columns: cols('id org_id connector owner_kind owner_team_id owner_user_id label status health mode created_at updated_at'),
    excluded: ['secret_ciphertext'],
    refs: { org_id: 'orgs', owner_team_id: 'teams' },
    people: { owner_user_id: 'sauter' },
  }),
  table('nodes', {
    columns: cols(
      'id org_id parent_id path kind title summary status revision meta owner_kind owner_team_id owner_user_id created_by updated_by created_at updated_at position deleted_at',
    ),
    excluded: ['lpath', 'search_tsv'],
    refs: { org_id: 'orgs', parent_id: 'nodes', owner_team_id: 'teams' },
    people: { owner_user_id: 'membre', created_by: 'auteur', updated_by: 'auteur' },
  }),
  // Fichiers joints (E10-S02, ADR-016 § 8, AC-e4) : les lignes `ready` seules (un envoi en cours ne se transfère
  // pas) ; leurs octets vont dans `<fichier>.files/` (`org-transfer-files.mjs`). L'import leur donne un nouvel
  // identifiant, que `deepReplace` reporte dans le `file_id` des blocs et des instantanés.
  table('files', {
    columns: cols('id org_id node_id name mime size status created_by created_at'),
    refs: { org_id: 'orgs', node_id: 'nodes' },
    people: { created_by: 'null' },
    only: { column: 'status', value: 'ready' },
  }),
  table('node_drafts', {
    parent: { table: 'nodes', column: 'node_id' },
    key: ['node_id'],
    newKey: null,
    columns: cols('node_id base_revision title summary kind meta created_by updated_by created_at updated_at'),
    refs: { node_id: 'nodes' },
    people: { created_by: 'auteur', updated_by: 'auteur' },
  }),
  // Deux lignes par bloc (`published`, `draft`) sous le même `id` : un seul nouvel uuid (`newIds`).
  table('blocks', {
    key: ['id', 'state'],
    columns: cols(
      'id state org_id node_id position type text data key provenance revision claimed_by claimed_by_user lease_until created_by updated_by created_at updated_at',
    ),
    excluded: ['search_tsv'],
    refs: { org_id: 'orgs', node_id: 'nodes' },
    people: { claimed_by_user: 'null', created_by: 'auteur', updated_by: 'auteur' },
  }),
  table('node_versions', {
    parent: { table: 'nodes', column: 'node_id' },
    key: ['node_id', 'revision'],
    newKey: null,
    columns: cols('node_id revision title summary kind meta blocks author created_at'),
    refs: { node_id: 'nodes' },
    people: { author: 'auteur' },
  }),
  table('node_aliases', {
    key: ['org_id', 'old_path'],
    newKey: null,
    columns: cols('org_id old_path node_id created_by created_at'),
    refs: { org_id: 'orgs', node_id: 'nodes' },
    people: { created_by: 'auteur' },
  }),
  table('links', {
    newKey: null,
    columns: cols('org_id source_node_id source_block_id target_path target_key target_node_id'),
    excluded: ['id'],
    refs: { org_id: 'orgs', source_node_id: 'nodes', source_block_id: 'blocks', target_node_id: 'nodes' },
    nullWhenSkipped: ['target_node_id'],
  }),
  table('access_rules', {
    columns: cols('id org_id node_id account_id subject_team_id subject_user_id level created_by created_at subject_org'),
    refs: { org_id: 'orgs', node_id: 'nodes', account_id: 'accounts', subject_team_id: 'teams' },
    people: { subject_user_id: 'sauter', created_by: 'auteur' },
  }),
  // Liens publics (E05-S10, ADR-013) : le jeton est un secret, jamais exporté ; l'import en tire un neuf
  // (défaut de la colonne) et pose le lien désactivé (`finish` du plan) : rien n'est public dans la cible.
  table('node_shares', {
    columns: cols('id org_id node_id include_children created_by created_at revoked_at'),
    excluded: ['token'],
    refs: { org_id: 'orgs', node_id: 'nodes' },
    people: { created_by: 'null' },
  }),
  table('connector_activations', {
    key: ['org_id', 'connector'],
    newKey: null,
    columns: cols('org_id connector state activated_by created_at updated_at'),
    refs: { org_id: 'orgs' },
    people: { activated_by: 'auteur' },
  }),
  table('invitations', {
    columns: cols('id org_id email role team_id invited_by created_at expires_at accepted_at accepted_by declined_at revoked_at'),
    refs: { org_id: 'orgs', team_id: 'teams' },
    people: { invited_by: 'auteur', accepted_by: 'null' },
  }),
  table('platform_grants', {
    columns: cols('id org_id user_id granted_by granted_at revoked_at revoked_by reason user_email user_name'),
    refs: { org_id: 'orgs' },
    // `granted_by` : `null`, jamais l'auteur par défaut, qui n'a pas accordé l'accès (trace d'audit).
    people: { user_id: 'sauter', granted_by: 'null', revoked_by: 'null' },
  }),
  table('ctx', {
    journal: true,
    key: ['code'],
    newKey: 'ctx',
    columns: cols('code org_id user_id rules_version contexts host user_agent created_at'),
    refs: { org_id: 'orgs' },
    people: { user_id: 'sauter' },
  }),
  table('journal', {
    journal: true,
    newKey: null,
    columns: cols('ts org_id user_id team_id ctx method tool target args args_chars result_chars is_error error duration_ms host user_agent account_id'),
    excluded: ['id'],
    refs: { org_id: 'orgs', team_id: 'teams', ctx: 'ctx', account_id: 'accounts' },
    nullWhenSkipped: ['account_id'],
    people: { user_id: 'null' },
  }),
  table('admin_journal', {
    journal: true,
    newKey: null,
    columns: cols('ts org_id user_id ctx method tool op target args args_chars result_chars is_error error duration_ms host user_agent'),
    excluded: ['id'],
    refs: { org_id: 'orgs' },
    people: { user_id: 'null' },
  }),
  table('feedback', {
    journal: true,
    newKey: null,
    columns: cols('org_id number user_id ctx type target text state resolution handled_by handled_at created_at'),
    excluded: ['id'],
    refs: { org_id: 'orgs', ctx: 'ctx' },
    people: { user_id: 'sauter', handled_by: 'null' },
  }),
  table('sim_outbox', {
    journal: true,
    newKey: 'sim',
    columns: cols('id org_id account_id connector function payload status created_by created_at sent_by sent_at'),
    refs: { org_id: 'orgs', account_id: 'accounts' },
    people: { created_by: 'auteur', sent_by: 'null' },
  }),
]

/**
 * Ce que `platform` sert hors de la carte, jamais exporté : les tables sans organisation, et toute vue
 * (ses lignes sont celles de tables de la carte). La spécification OpenAPI liste tables et vues
 * ensemble : la garde d'AC14 les confronte à la carte plus cette liste.
 */
export const NEVER_EXPORTED = ['platform_staff', 'identities']
// Le lexique (E01-S13) a une organisation, mais se dérive de son contenu publié : jamais exporté,
// l'import le reconstruit par les déclencheurs de `nodes` et de `blocks`.
NEVER_EXPORTED.push('lexicon')
// Les tickets de dépôt par lien (E10-S02 lot f, ADR-018) : 15 minutes, un envoi, liés à une conversation ; un ticket
// ne se transfère pas (AC-f10).
// Les vues des pages (1.4.13) : des comptes de consultation par personne et par jour, gardés 90 jours ; l'organisation
// importée recommence à compter.
NEVER_EXPORTED.push('upload_tickets', 'node_views')
// Les exclusions (entrée sans invitation) nomment des personnes qui ne sont plus membres : l'export ne porte pas leur
// email, l'import n'aurait rien pour les rapprocher.
NEVER_EXPORTED.push('member_exclusions')

/** @param {string} name */
function tableSpec(name) {
  return TABLES.find((spec) => spec.name === name) ?? null
}

/**
 * Les lignes d'une organisation dans une table de la carte, en SQL, sur la connexion d'administration
 * (E01-S10, AC-f4) : par `org_id` (`id` pour `orgs`) ; pour une table rattachée à son parent, par les
 * lignes parentes de l'organisation, lues dans la même requête. La colonne qui rattache une table à son
 * organisation ne se lit qu'ici (E01-S08, M15b-1). L'export le lit (`scripts/org-export.mjs`), avec le
 * test qui compte les lignes de la carte (`tests/integration/org-transfer.test.ts`) ; sa forme PostgREST,
 * `orgRows`, est partie avec la face PostgREST du test d'isolation (E01-S10 f2, M47). Chaque identifiant
 * vient de la carte, jamais du fichier ni d'un argument.
 * @param {import('postgres').Sql} sql  connexion d'administration
 * @param {TableSpec} spec
 * @param {string} orgId
 * @returns {import('postgres').PendingQuery<any>}  un fragment de `where`
 */
export function orgRowsSql(sql, spec, orgId) {
  // E10-S02 (AC-e4) : le filtre propre à une table (`only`), lu par l'export et par le compte d'AC1.
  const kept = spec.only ? sql` and ${sql(spec.only.column)} = ${spec.only.value}` : sql``
  if (!spec.parent) return sql`${sql(spec.name === 'orgs' ? 'id' : 'org_id')} = ${orgId}${kept}`
  const parent = tableSpec(spec.parent.table)
  if (!parent) throw new Error(`Table parente absente de la carte : ${spec.parent.table}.`)
  return sql`${sql(spec.parent.column)} in (select "id" from ${sql(`platform.${parent.name}`)} where ${orgRowsSql(sql, parent, orgId)})${kept}`
}

/** Base 32 de Crockford, recopiée de `server/ctx.ts` (E03-S01) : un script n'importe pas le paquet. */
export const CTX_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export function newCtxCode() {
  const pick = () => Array.from({ length: 4 }, () => CTX_ALPHABET[randomInt(CTX_ALPHABET.length)]).join('')
  return `${pick()}-${pick()}`
}

/** Même forme que le défaut de `sim_outbox.id` (E01-S06, N30). */
export function newSimId() {
  return `sim_${randomBytes(4).toString('hex')}`
}

/**
 * Remplace, à toute profondeur, chaque chaîne égale à une clé de `idMap` par sa valeur ; les clés
 * d'objet et les autres chaînes restent (HN-E09S04-2).
 * @param {unknown} value
 * @param {Map<string, string>} idMap
 * @returns {any}
 */
export function deepReplace(value, idMap) {
  if (typeof value === 'string') return idMap.get(value) ?? value
  if (Array.isArray(value)) return value.map((item) => deepReplace(item, idMap))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, deepReplace(item, idMap)]))
  }
  return value
}

/** Profondeur d'un nœud : 0 pour la racine, sinon le nombre de segments de son chemin (H51). */
export function nodeDepth(node) {
  return node.parent_id === null ? 0 : node.path.split('/').length
}

/**
 * Les nœuds, parents d'abord : par profondeur de chemin, puis par chemin.
 * @template {Record<string, any>} T  une ligne de `nodes` (`parent_id`, `path`)
 * @param {T[]} rows
 * @returns {T[]}
 */
export function orderNodes(rows) {
  return [...rows].sort((a, b) => nodeDepth(a) - nodeDepth(b) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

/** Les `by` d'une provenance (document : `{by}` ; ligne : `{<colonne>: {by}}`), à toute profondeur. */
function provenanceAuthors(value, ids) {
  if (!value || typeof value !== 'object') return
  for (const [key, item] of Object.entries(value)) {
    if (key === 'by' && typeof item === 'string' && UUID.test(item)) ids.add(item)
    else provenanceAuthors(item, ids)
  }
}

/**
 * Chaque personne citée par une colonne de personne de la carte ou par `provenance.by` (blocs et
 * instantanés), triée.
 * @param {Record<string, Record<string, any>[]>} tables
 * @returns {string[]}
 */
export function collectPeople(tables) {
  const ids = new Set()
  for (const spec of TABLES) {
    const rows = tables[spec.name] ?? []
    const values = Object.keys(spec.people).flatMap((column) => rows.map((row) => row[column]))
    for (const value of values) if (typeof value === 'string') ids.add(value)
  }
  for (const block of tables.blocks ?? []) provenanceAuthors(block.provenance, ids)
  const entries = (tables.node_versions ?? []).flatMap((version) => (Array.isArray(version.blocks) ? version.blocks : []))
  for (const entry of entries) provenanceAuthors(entry?.provenance, ids)
  return [...ids].sort()
}

/** Première colonne d'une ligne que la carte ne connaît pas, ou null. */
function unknownColumn(spec, rows) {
  const known = new Set(spec.columns)
  for (const row of rows) {
    const column = Object.keys(row ?? {}).find((name) => !known.has(name))
    if (column) return column
  }
  return null
}

/** Tables dont le fichier porte les clés : une référence vers elles doit y trouver sa ligne. */
const KEYED = ['orgs', 'teams', 'nodes', 'accounts']

/**
 * Première référence du fichier vers une ligne qu'il ne porte pas (`<table>.<colonne>`), ou null : un
 * fichier altéré ferait écrire l'import dans une autre organisation (règle d'accès sur un de ses
 * nœuds, membre d'une de ses équipes), ce que `security-patterns.md § Outillage à clé service` exclut.
 * `org_id` est requise : nulle ou absente (nullable dans `journal` et `admin_journal`), la ligne
 * s'écrirait hors de l'organisation créée, et l'annulation ne la supprimerait pas. Seules les clés de
 * type chaîne désignent une ligne : une clé absente ferait passer toute référence absente.
 */
function foreignReference(doc) {
  const keys = Object.fromEntries(
    KEYED.map((name) => [name, new Set((doc.tables[name] ?? []).map((row) => row.id).filter((id) => typeof id === 'string'))]),
  )
  for (const spec of TABLES) {
    const refs = Object.entries(spec.refs).filter(([, target]) => keys[target])
    for (const row of doc.tables[spec.name] ?? []) {
      const found = refs.find(([column, target]) => (row[column] != null || column === 'org_id') && !keys[target].has(row[column]))
      if (found) return `${spec.name}.${found[0]}`
    }
  }
  return null
}

/**
 * Contrôle du fichier avant toute écriture (AC11) : format, version, tables et colonnes de la carte
 * seulement (`rows`, `vocabulary` ou autre : refusé, jamais ignoré, HN-E09S04-12), une organisation
 * identifiée par un uuid, aucune référence hors du fichier ni ligne hors de l'organisation
 * (HN-E09S04-14).
 * @param {any} doc
 */
export function validateDoc(doc) {
  if (!doc || typeof doc !== 'object') throw new Error('Fichier invalide : un objet JSON est attendu.')
  if (doc.format !== FORMAT) throw new Error(`Format inconnu : ${doc.format} (attendu ${FORMAT}).`)
  if (doc.version !== VERSION) throw new Error(`Version inconnue : ${doc.version} (attendue ${VERSION}).`)
  if (!Array.isArray(doc.people) || !doc.tables || typeof doc.tables !== 'object') {
    throw new Error('Fichier invalide : people et tables sont requis.')
  }
  for (const [name, rows] of Object.entries(doc.tables)) {
    const spec = tableSpec(name)
    if (!spec) throw new Error(`Table inconnue dans le fichier : ${name}.`)
    if (!Array.isArray(rows)) throw new Error(`Fichier invalide : tables.${name} doit être un tableau.`)
    const column = unknownColumn(spec, rows)
    if (column) throw new Error(`Colonne inconnue dans le fichier : ${name}.${column}.`)
  }
  if (doc.tables.orgs?.length !== 1) throw new Error('Fichier invalide : tables.orgs porte une organisation, et une seule.')
  const orgId = doc.tables.orgs[0]?.id
  if (typeof orgId !== 'string' || !UUID.test(orgId)) throw new Error('Fichier invalide : tables.orgs.id doit être un uuid.')
  const reference = foreignReference(doc)
  if (reference) throw new Error(`Fichier invalide : ${reference} désigne une ligne absente du fichier.`)
}

/**
 * Lots d'insertion : `maxRows` lignes au plus, et moins quand le JSON d'un lot dépasse `maxBytes`
 * (textes de blocs et instantanés sont longs) ; une ligne plus grosse part seule.
 * @template T
 * @param {T[]} rows
 * @returns {T[][]}
 */
export function batches(rows, maxRows = 500, maxBytes = 1_000_000) {
  const result = []
  let current = []
  let size = 0
  for (const row of rows) {
    const bytes = Buffer.byteLength(JSON.stringify(row))
    if (current.length > 0 && (current.length >= maxRows || size + bytes > maxBytes)) {
      result.push(current)
      current = []
      size = 0
    }
    current.push(row)
    size += bytes
  }
  if (current.length > 0) result.push(current)
  return result
}

/** Nombre de lignes et de tables non vides, d'un export comme d'un import. */
export function countRows(tables) {
  const counts = Object.values(tables).map((rows) => rows.length)
  return { rows: counts.reduce((sum, count) => sum + count, 0), tables: counts.filter((count) => count > 0).length }
}

const ticket = (number) => `FB-${String(number).padStart(4, '0')}`

/**
 * Résumé d'un import (AC6, AC9, AC13) : lignes écrites, personnes absentes (dont les comptes non
 * confirmés de la cible, HN-E09S04-24), lignes sautées par table, invitations laissées, accès
 * plateforme révoqués (autre projet, HN-E09S04-25), tickets renumérotés, adresses posées.
 * @param {{ slug: string, inserted: Record<string, unknown[]>, skipped: Record<string, number>,
 *   absent: string[], unconfirmed: string[], closedInvitations: number, revokedGrants: number,
 *   tickets: [number, number][], domains: string[] }} result
 * @returns {string[]}
 */
export function formatSummary({ slug, inserted, skipped, absent, unconfirmed, closedInvitations, revokedGrants, tickets, domains }) {
  const { rows, tables } = countRows(inserted)
  const lines = [`Organisation ${slug} importée : ${rows} lignes dans ${tables} tables.`]
  if (absent.length > 0) lines.push(`Personnes absentes (${absent.length}) : ${absent.join(', ')}`)
  if (unconfirmed.length > 0) lines.push(`Dont comptes non confirmés dans la cible : ${unconfirmed.join(', ')}`)
  const skips = Object.entries(skipped).filter(([, count]) => count > 0)
  if (skips.length > 0) lines.push(`Lignes sautées : ${skips.map(([name, count]) => `${name} ${count}`).join(', ')}`)
  if (closedInvitations > 0) lines.push(`Invitations closes ou expirées, non importées : ${closedInvitations}`)
  if (revokedGrants > 0) lines.push(`Accès plateforme en cours, révoqués à l'import (autre projet) : ${revokedGrants}`)
  const renumbered = tickets.filter(([before, after]) => before !== after)
  if (renumbered.length > 0) {
    lines.push(`Tickets renumérotés : ${renumbered.map(([before, after]) => `${ticket(before)} → ${ticket(after)}`).join(', ')}`)
  }
  if (domains.length > 0) lines.push(`Adresses posées : ${domains.join(', ')}`)
  return lines
}
