/**
 * org-transfer-plan — plan d'import d'un fichier d'export et empreinte d'une organisation (E09-S04,
 * AC6 à AC10, AC13). Fonctions pures, testées sans base : le plan dit ce que `scripts/org-import.mjs`
 * écrira, avant la première écriture (AC10, AC11) ; l'empreinte compare deux exports (AC8).
 */
import { randomUUID } from 'node:crypto'
import { deepReplace, newCtxCode, newSimId, orderNodes, TABLES } from './org-transfer.mjs'

/** Fabrique d'une clé neuve, par sorte de clé de la carte (`TableSpec.newKey`). */
const KEY_FACTORIES = { uuid: () => randomUUID(), ctx: newCtxCode, sim: newSimId }

/**
 * Tables dont une ligne sautée emporte les lignes qui la désignent (AC9) : les nœuds personnels d'une
 * personne absente (et leurs descendants), ses comptes personnels ; les fils de commentaires d'un nœud sauté, dont les
 * commentaires suivent.
 */
const CASCADING = ['nodes', 'accounts', 'comment_threads']

/** Colonnes hors de l'empreinte (AC8) : ce que l'import change, et les clés propres que rien ne désigne. */
const UNCOMPARED = {
  orgs: ['slug', 'prefix', 'name', 'rules_version', 'updated_at'],
  access_rules: ['id'],
  invitations: ['id'],
  platform_grants: ['id'],
  // Un lien public reçoit un nouvel identifiant et arrive désactivé dans la copie (HN-E05S10e-9).
  node_shares: ['id', 'revoked_at'],
  // E05-S13 (fiche D128) : ni l'un ni l'autre n'est plus lu ; un ancien export les porte, sa copie non.
  teams: ['lead_user_id'],
  members: ['default_team_id'],
  // Un commentaire reçoit un nouvel identifiant, que rien ne désigne ; son fil se compare par son rang (`naturalRefs`).
  comments: ['id'],
}

/**
 * Une invitation importée (AC13) : en attente (ni acceptée, ni refusée, ni révoquée, ni expirée), et
 * pour une adresse qui n'est pas celle d'un membre importé, que `invitations_guard` refuserait
 * (`already_member`, HN-E09S04-13).
 * @param {Record<string, any>} row
 * @param {Set<string>} memberEmails
 * @param {Date} now
 */
function importedInvitation(row, memberEmails, now) {
  const pending = row.accepted_at == null && row.declined_at == null && row.revoked_at == null
  return pending && Date.parse(row.expires_at) > now.getTime() && !memberEmails.has(row.email)
}

/** Blocs publiés du fichier : identifiant → nœud. */
function publishedBlocks(doc) {
  const published = (doc.tables.blocks ?? []).filter((block) => block.state === 'published')
  return new Map(published.map((block) => [block.id, block.node_id]))
}

/**
 * Un lien importé part d'un bloc publié de son nœud, ce que `publish_node` contrôle à la publication :
 * la clé unique des liens vaut pour toute la base, et un lien parti du bloc d'une autre organisation
 * ferait échouer la publication de celle-ci (`23505`). Un lien dont le bloc a disparu depuis (une
 * publication sans `p_links` laisse les liens) est sauté, comme lui (HN-E09S04-23).
 * @param {Record<string, any>} row
 * @param {Map<string, string>} published  `publishedBlocks`
 */
function importedLink(row, published) {
  return row.source_node_id != null && published.get(row.source_block_id) === row.source_node_id
}

/**
 * Une ligne du fichier prête à insérer (AC6, AC9, AC10) : colonnes de personne selon leur politique,
 * toute autre valeur égale à un ancien identifiant remplacée (clé propre, clés étrangères, jsonb à
 * toute profondeur, HN-E09S04-2). Rend null quand une politique `sauter` ou `membre` écarte la ligne ;
 * `authors` : les personnes absentes remplacées par l'auteur par défaut.
 * @param {Record<string, any>} row
 * @param {import('./org-transfer.mjs').TableSpec} spec
 * @param {{ ids: Map<string, string>, people: Map<string, string | null>, members: Set<string>,
 *   defaultAuthor: string | null }} context
 * @returns {{ row: Record<string, any>, authors: string[] } | null}
 */
function remapRow(row, spec, context) {
  /** @type {Record<string, any>} */
  const out = {}
  const authors = []
  for (const [column, value] of Object.entries(row)) {
    const policy = spec.people[column]
    if (!policy || typeof value !== 'string') {
      out[column] = deepReplace(value, context.ids)
      continue
    }
    const target = context.people.get(value) ?? null
    const kept = policy === 'membre' ? target && context.members.has(value) : target || policy !== 'sauter'
    if (!kept) return null
    if (target) out[column] = target
    else if (policy === 'null') out[column] = null
    else {
      out[column] = context.defaultAuthor
      authors.push(value)
    }
  }
  return { row: out, authors }
}

/** Un nouvel identifiant par clé du fichier (un seul par bloc, pour ses deux états) ; personnes présentes. */
function newIds(doc, people) {
  const ids = new Map()
  for (const [oldId, target] of people) if (target) ids.set(oldId, target)
  for (const spec of TABLES) {
    const factory = KEY_FACTORIES[spec.newKey]
    const rows = factory ? (doc.tables[spec.name] ?? []) : []
    // Une clé déjà vue garde son nouvel identifiant : les deux lignes d'un bloc (`published`, `draft`).
    for (const row of rows) if (!ids.has(row[spec.key[0]])) ids.set(row[spec.key[0]], factory())
  }
  return ids
}

/** Nœuds parents d'abord ; tickets dans l'ordre de leur numéro (`feedback_number` les repose). */
function orderedRows(name, rows) {
  if (name === 'nodes') return orderNodes(rows)
  if (name === 'feedback') return [...rows].sort((a, b) => a.number - b.number)
  return rows
}

/** La ligne, ses références à une ligne sautée remises à null ou, sinon, null (la ligne est sautée). */
function detach(row, spec, skippedKeys) {
  let result = row
  for (const [column, target] of Object.entries(spec.refs)) {
    if (!skippedKeys[target]?.has(row[column])) continue
    if (!spec.nullWhenSkipped.includes(column)) return null
    result = { ...result, [column]: null }
  }
  return result
}

/**
 * Ce qui suit l'insertion d'une ligne : identité de l'organisation, membres, responsables, tickets,
 * accès plateforme vers un autre projet.
 */
function finish(name, source, out, state) {
  if (name === 'orgs') Object.assign(out, { slug: state.org.slug, prefix: state.org.prefix, name: state.org.name ?? out.name })
  if (name === 'members') {
    state.context.members.add(source.user_id)
    // E01-S09 (AC15) : sans clé vers `auth.users`, la base ne copie plus l'email du compte ; un fichier
    // d'avant M08 n'en porte pas, celui de la personne, rapprochée par lui, le donne.
    out.email ??= state.emailOf.get(source.user_id)?.toLowerCase() ?? null
    // E05-S13 (fiche D128) : l'équipe par défaut n'est plus lue ni écrite ; celle d'un ancien export tombe.
    out.default_team_id = null
  }
  // HN-E09S04-10 : le responsable d'un ancien export (`teams.lead_user_id`, avant E05-S13) se pose après
  // `team_members`, par son rôle (`team_members.role`, seule source depuis E05-S13, AC-25).
  if (name === 'teams' && out.lead_user_id) {
    state.plan.teamLeads.push({ id: out.id, lead: out.lead_user_id })
    out.lead_user_id = null
  }
  if (name === 'feedback') {
    state.plan.tickets.push(source.number)
    delete out.number
  }
  // HN-E09S04-25 : vers un autre projet, aucun accès en cours ne passe (`member_orgs`, `is_org_admin`).
  if (name === 'platform_grants' && state.otherProject && out.revoked_at == null) {
    Object.assign(out, { revoked_at: state.now.toISOString(), revoked_by: null })
    state.plan.revokedGrants += 1
  }
  // HN-E05S10e-9 : un lien public arrive désactivé (son jeton n'est pas exporté) ; on le recrée au besoin.
  if (name === 'node_shares' && out.revoked_at == null) out.revoked_at = state.now.toISOString()
  // E10-S02 (AC-e4) : l'objet d'un fichier importé, lu sous son ancien identifiant, s'envoie sous le nouveau.
  if (name === 'files') state.plan.files.push({ from: source.id, to: out.id, mime: out.mime })
}

function planRow(spec, row, state) {
  const { plan, context } = state
  if (spec.name === 'invitations') {
    state.memberEmails ??= new Set([...context.members].map((id) => state.emailOf.get(id)))
    if (!importedInvitation(row, state.memberEmails, state.now)) {
      plan.closedInvitations += 1
      return
    }
  }
  const linked = spec.name !== 'links' || importedLink(row, state.published)
  const detached = linked && detach(row, spec, state.skippedKeys)
  const mapped = detached && remapRow(detached, spec, context)
  if (!mapped) {
    plan.skipped[spec.name] += 1
    state.skippedKeys[spec.name]?.add(row.id)
    return
  }
  finish(spec.name, row, mapped.row, state)
  if (mapped.authors.length > 0) plan.needsDefaultAuthor.rows += 1
  for (const author of mapped.authors) state.authors.add(author)
  plan.rows[spec.name].push(mapped.row)
}

/**
 * Plan d'import d'un fichier contrôlé par `validateDoc`, sans rien écrire : les lignes de chaque table
 * prêtes à insérer, dans l'ordre de la carte, avec de nouveaux identifiants (AC6, AC7) ; les lignes
 * sautées pour une personne absente, en cascade (AC9) ; les lignes dont l'auteur est absent (AC10) ;
 * les invitations laissées (AC13) ; les accès plateforme révoqués (autre projet) ; les responsables à
 * poser après `team_members` ; les numéros des tickets dans l'ordre d'insertion ; les fichiers importés, ancien et
 * nouvel identifiant (E10-S02, AC-e4).
 * @param {any} doc
 * @param {{ people: Map<string, string | null>, defaultAuthor?: string | null,
 *   org: { slug: string, prefix: string, name?: string | null }, now?: Date, otherProject?: boolean }} options
 *   `people` : ancien identifiant → identifiant dans la cible, null si la personne en est absente ;
 *   `otherProject` : la cible n'est pas le projet de l'export (les accès en cours y sont révoqués)
 */
export function planImport(doc, { people, defaultAuthor = null, org, now = new Date(), otherProject = false }) {
  const plan = {
    /** @type {Record<string, Record<string, any>[]>} */
    rows: {},
    /** @type {Record<string, number>} */
    skipped: {},
    /** @type {{ id: string, lead: string }[]} */
    teamLeads: [],
    /** @type {number[]} */
    tickets: [],
    /** @type {{ from: string, to: string, mime: string }[]} */
    files: [],
    closedInvitations: 0,
    revokedGrants: 0,
    absent: doc.people.filter((person) => !people.get(person.id)).map((person) => person.email ?? person.id).sort(),
    needsDefaultAuthor: { rows: 0, emails: /** @type {string[]} */ ([]) },
  }
  const state = {
    plan,
    org,
    now,
    otherProject,
    published: publishedBlocks(doc),
    context: { ids: newIds(doc, people), people, members: new Set(), defaultAuthor },
    skippedKeys: Object.fromEntries(CASCADING.map((name) => [name, new Set()])),
    emailOf: new Map(doc.people.map((person) => [person.id, person.email])),
    authors: new Set(),
    memberEmails: null,
  }
  for (const spec of TABLES) {
    if (spec.name === 'org_domains' || !doc.tables[spec.name]) continue
    plan.rows[spec.name] = []
    plan.skipped[spec.name] = 0
    for (const row of orderedRows(spec.name, doc.tables[spec.name])) planRow(spec, row, state)
  }
  plan.needsDefaultAuthor.emails = [...state.authors].map((id) => state.emailOf.get(id) ?? id).sort()
  return plan
}

/** JSON à clés triées : deux lignes égales ont la même écriture, quel que soit l'ordre de leurs clés. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

/** Rang par date de création : un code `ctx` ou un `sim_…` est désigné par sa place (AC8). */
function rank(refs, rows, key, label) {
  const ordered = rows.map((row) => ({ row, order: `${row.created_at}|${canonical(deepReplace({ ...row, [key]: null }, refs))}` }))
  ordered.sort((a, b) => compare(a.order, b.order))
  ordered.forEach(({ row }, index) => refs.set(row[key], `${label}:${index + 1}`))
}

/**
 * Référence naturelle de chaque identifiant du fichier (AC8, HN-E09S04-11) : nœud → chemin, équipe →
 * slug, personne → email, compte → libellé, `ctx` et `sim_outbox` → rang, bloc → chemin de son nœud,
 * état (publié s'il l'est), puis `#<clé>` ou `@<position>`.
 */
function naturalRefs(doc) {
  const tables = doc.tables
  const refs = new Map()
  for (const org of tables.orgs ?? []) refs.set(org.id, 'org')
  for (const person of doc.people) refs.set(person.id, `person:${person.email ?? person.id}`)
  for (const team of tables.teams ?? []) refs.set(team.id, `team:${team.slug}`)
  for (const account of tables.accounts ?? []) refs.set(account.id, `account:${account.label}`)
  const paths = new Map((tables.nodes ?? []).map((node) => [node.id, node.path]))
  for (const [id, path] of paths) refs.set(id, `node:${path}`)
  // E10-S02 (AC-e4) : un fichier joint, par son nœud et son nom ; son identifiant change à l'import.
  for (const file of tables.files ?? []) refs.set(file.id, `file:${paths.get(file.node_id)}/${file.name}`)
  const blocks = [...(tables.blocks ?? [])].sort((a, b) => compare(a.state, b.state))
  for (const block of blocks) {
    const anchor = block.key == null ? `@${block.position}` : `#${block.key}`
    refs.set(block.id, `block:${paths.get(block.node_id)}/${block.state}${anchor}`)
  }
  rank(refs, tables.ctx ?? [], 'code', 'ctx')
  rank(refs, tables.sim_outbox ?? [], 'id', 'sim')
  rank(refs, tables.comment_threads ?? [], 'id', 'thread')
  return refs
}

function omit(row, columns) {
  return Object.fromEntries(Object.entries(row).filter(([column]) => !columns.includes(column)))
}

/**
 * Empreinte d'un export (AC8) : pour chaque table, les lignes où chaque identifiant est remplacé par sa
 * référence naturelle, dans les colonnes comme dans les instantanés, triées ; `org_domains`, les
 * invitations non importées et les liens sautés hors de l'empreinte, comme les colonnes de
 * `UNCOMPARED`. Deux organisations dont l'une est la copie de l'autre ont la même empreinte.
 * @param {any} doc
 * @param {Date} [now]
 * @returns {Record<string, Record<string, any>[]>}
 */
export function fingerprint(doc, now = new Date()) {
  const refs = naturalRefs(doc)
  const emailOf = new Map(doc.people.map((person) => [person.id, person.email]))
  const memberEmails = new Set((doc.tables.members ?? []).map((row) => emailOf.get(row.user_id)))
  const published = publishedBlocks(doc)
  /** @type {Record<string, (row: Record<string, any>) => boolean>} */
  const importable = { invitations: (row) => importedInvitation(row, memberEmails, now), links: (row) => importedLink(row, published) }
  /** @type {Record<string, Record<string, any>[]>} */
  const result = {}
  for (const spec of TABLES) {
    const rows = doc.tables[spec.name]
    if (!rows || spec.name === 'org_domains') continue
    const kept = importable[spec.name] ? rows.filter(importable[spec.name]) : rows
    result[spec.name] = kept
      .map((row) => deepReplace(omit(row, UNCOMPARED[spec.name] ?? []), refs))
      .sort((a, b) => compare(canonical(a), canonical(b)))
  }
  return result
}
