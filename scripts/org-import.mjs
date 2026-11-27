#!/usr/bin/env node
/**
 * org-import — crée une organisation neuve à partir d'un fichier de `pnpm org:export` (E09-S04,
 * H112, AC6 à AC13), dans le même projet Supabase (autre slug) ou dans celui d'un ERP (`--env`).
 *
 * Ce que ça empêche : recopier un client à la main, table par table, ou le republier (nouvelles
 * révisions, nouvelle provenance, auteur = l'opérateur) au lieu de le recopier.
 *
 * Usage : `pnpm org:import --in <fichier> --slug <slug> --prefix <préfixe> [--name <nom>]
 * [--auteur-par-defaut <email>] [--domain <hôte>]… [--env <fichier>]`.
 *
 * Tout est vérifié avant la première écriture : fichier, slug, préfixe et adresses libres, personnes
 * rapprochées par email confirmé, auteur par défaut ; le plan (`planImport`) fabrique chaque
 * identifiant. Puis, dans une seule transaction, l'organisation est créée sans `create_org`, chaque
 * table insérée dans l'ordre de la carte, les adresses en dernier : dans une organisation encore sans
 * arbre, les déclencheurs d'E01-S04 n'écrivent rien (E01-S04, AC26), et les nœuds Contexte du fichier
 * entrent comme les autres (P39). Outillage (ADR-006 § 3, `security-patterns.md § Outillage à clé
 * service`) : `platform` par la connexion d'administration, les comptes de la cible par l'API
 * d'administration d'Auth (E01-S10, AC-f4). Il n'écrit que dans l'organisation qu'il crée ; une
 * insertion refusée annule la transaction, l'organisation comprise (AC12) : rien n'est supprimé.
 * E10-S02 (AC-e4) : après le commit, les octets des fichiers joints (`<fichier>.files/`) sont envoyés au stockage
 * des variables `PLATFORM_STORAGE_*` sous les nouveaux identifiants ; un document qui porte des fichiers ne s'importe
 * pas sans elles : le script le dit en les nommant, avant la connexion et toute écriture ; un envoi en échec
 * est nommé et le code de sortie vaut 1.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import postgres from 'postgres'
import { adminSql, codeOf, identifiers, maskValues, messageOf, serviceKeyClient } from './lib/env.mjs'
import { parseImportArgs, readOrFail, readVariables } from './lib/org-transfer-args.mjs'
import { planImport } from './lib/org-transfer-plan.mjs'
import { batches, formatSummary, nodeDepth, TABLES, validateDoc } from './lib/org-transfer.mjs'
import { importObjects, requireTransferStore, transferStore } from './lib/org-transfer-files.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const USERS_PER_PAGE = 1000

function readDoc(file) {
  let doc
  try {
    doc = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    throw new Error(`Fichier illisible : ${file}.`)
  }
  validateDoc(doc)
  return doc
}

/**
 * Comptes du projet cible : `byEmail`, email confirmé en minuscules → identifiant ; `unconfirmed`, les
 * autres emails, comptés absents (HN-E09S04-24 : le paquet ne fait confiance qu'à un email confirmé,
 * `accept_invitations`). Jusqu'à une page vide : le projet peut servir moins de comptes par page.
 */
export async function targetPeople(admin) {
  const byEmail = new Map()
  const unconfirmed = new Set()
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: USERS_PER_PAGE })
    if (error) throw new Error(`Lecture des comptes impossible (${codeOf(error)}).`)
    if (data.users.length === 0) return { byEmail, unconfirmed }
    for (const user of data.users.filter((candidate) => candidate.email)) {
      if (user.email_confirmed_at) byEmail.set(user.email.toLowerCase(), user.id)
      else unconfirmed.add(user.email.toLowerCase())
    }
  }
}

/** Slug, préfixe et adresses libres dans la cible (AC11, AC13). */
async function checkTarget(sql, options) {
  for (const [column, value, label] of [['slug', options.slug, 'Slug'], ['prefix', options.prefix, 'Préfixe']]) {
    const taken = await readOrFail(sql`select id from platform.orgs where ${sql(column)} = ${value} limit 1`, 'des organisations')
    if (taken.length > 0) throw new Error(`${label} déjà pris : ${value}.`)
  }
  if (options.domains.length === 0) return
  const served = await readOrFail(sql`select host from platform.org_domains where host in ${sql(options.domains)}`, 'des adresses')
  if (served.length > 0) throw new Error(`Adresse déjà servie : ${served.map((row) => row.host).sort().join(', ')}.`)
}

/**
 * Le plan, après tous les contrôles qui ne demandent aucune écriture (AC10, AC11, AC13), et les
 * personnes du fichier dont le compte de la cible n'est pas confirmé. `targetHost` : l'hôte du projet
 * cible ; un autre que celui de l'export révoque les accès plateforme en cours (HN-E09S04-25).
 * @param {{ sql: import('postgres').Sql, admin: import('@supabase/supabase-js').SupabaseClient<any, any> }} db
 *   `platform` par la connexion d'administration ; les comptes par l'API d'administration d'Auth
 */
async function prepare({ sql, admin }, doc, options, targetHost) {
  await checkTarget(sql, options)
  const { byEmail, unconfirmed } = await targetPeople(admin)
  const emails = doc.people.map((person) => [person.id, person.email?.toLowerCase() ?? null])
  const people = new Map(emails.map(([id, email]) => [id, byEmail.get(email) ?? null]))
  const defaultAuthor = options.defaultAuthor ? (byEmail.get(options.defaultAuthor) ?? null) : null
  if (options.defaultAuthor && !defaultAuthor) throw new Error(`Auteur par défaut inconnu : ${options.defaultAuthor}.`)
  const org = { slug: options.slug, prefix: options.prefix, name: options.name }
  const plan = planImport(doc, { people, defaultAuthor, org, otherProject: doc.source?.host !== targetHost })
  const { rows, emails: authors } = plan.needsDefaultAuthor
  if (rows > 0 && !defaultAuthor) {
    throw new Error(
      `Auteur par défaut requis : ${rows} lignes ont pour auteur une personne absente (${authors.join(', ')}). ` +
        'Relancez avec --auteur-par-defaut <email>.',
    )
  }
  return { plan, unconfirmed: emails.map(([, email]) => email).filter((email) => unconfirmed.has(email)).sort() }
}

/**
 * Tables dont une ligne du fichier peut déjà être en base, écrite par un déclencheur d'une table insérée avant : la
 * première équipe d'une invitation (`invitation_teams_from_team_id`). Le doublon se saute, jamais une autre erreur.
 */
const SKIPPED_DUPLICATES = new Set(['invitation_teams'])

/** Les colonnes de la carte (`TABLES`) que porte une ligne : jamais un nom venu du fichier. */
function columnsOf(table, row) {
  return TABLES.find((spec) => spec.name === table).columns.filter((column) => Object.hasOwn(row, column))
}

/**
 * L'insertion de lignes aux mêmes colonnes : un seul paramètre JSON (`sql.json`, que postgres.js
 * sérialise lui-même), que Postgres convertit au type de chaque colonne (`jsonb_populate_recordset`,
 * comme PostgREST le faisait), jamais une valeur écrite dans la requête ; une colonne hors de la liste
 * prend son défaut.
 */
function insertQuery(tx, table, columns, rows) {
  const target = tx(`platform.${table}`)
  const list = identifiers(tx, columns)
  const duplicates = SKIPPED_DUPLICATES.has(table) ? tx`on conflict do nothing` : tx``
  return tx`insert into ${target} (${list}) select ${list} from jsonb_populate_recordset(null::${target}, ${tx.json(rows)}) ${duplicates}`
}

/** Une écriture ; son refus se dit « <table> : <code> », la cause gardée pour dire ce qu'il laisse. */
async function writing(table, query) {
  try {
    return await query
  } catch (error) {
    throw new Error(`${table} : ${codeOf(error)}`, { cause: error })
  }
}

/**
 * Par lots (500 lignes, moins au-delà d'1 Mo de JSON), chaque lot par jeu de colonnes : une colonne
 * absente d'une ligne prend son défaut, comme `defaultToNull: false` le faisait sur PostgREST.
 */
async function insertRows(tx, table, rows) {
  for (const batch of batches(rows)) {
    const groups = Map.groupBy(batch, (row) => columnsOf(table, row).join(','))
    for (const group of groups.values()) await writing(table, insertQuery(tx, table, columnsOf(table, group[0]), group))
  }
}

/** Un niveau de profondeur par requête : `nodes_guard` relit le parent de chaque nœud, déjà inséré. */
async function insertNodes(tx, rows) {
  const depths = [...new Set(rows.map(nodeDepth))].sort((a, b) => a - b)
  for (const depth of depths) await insertRows(tx, 'nodes', rows.filter((row) => nodeDepth(row) === depth))
}

/** Un ticket à la fois, dans l'ordre des numéros : `feedback_number` pose le numéro dans l'organisation. */
async function insertFeedback(tx, rows, numbers) {
  const tickets = []
  for (const [index, row] of rows.entries()) {
    const [inserted] = await writing('feedback', tx`${insertQuery(tx, 'feedback', columnsOf('feedback', row), [row])} returning number`)
    tickets.push([numbers[index], inserted.number])
  }
  return tickets
}

/**
 * HN-E09S04-10 : les responsables d'un ancien export posés après `team_members`, par leur rôle (E05-S13,
 * AC-25 : `team_members.role` est la seule source ; la personne entre dans l'équipe au besoin).
 */
async function setLeads(tx, leads) {
  for (const { id, lead } of leads) {
    await writing(
      'team_members',
      tx`insert into platform.team_members (team_id, user_id, role) values (${id}, ${lead}, 'lead')
         on conflict (team_id, user_id) do update set role = 'lead'`,
    )
  }
}

/**
 * Toutes les lignes du plan après `orgs`, dans l'ordre de la carte, puis les adresses de `--domain` :
 * l'hôte ne sert l'organisation qu'une fois écrite. Rend les tickets renumérotés.
 */
async function writeTables(tx, plan, domains) {
  let tickets = []
  for (const spec of TABLES) {
    const rows = spec.name === 'orgs' ? [] : (plan.rows[spec.name] ?? [])
    if (spec.name === 'nodes') await insertNodes(tx, rows)
    else if (spec.name === 'feedback') tickets = await insertFeedback(tx, rows, plan.tickets)
    else if (rows.length > 0) await insertRows(tx, spec.name, rows)
    if (spec.name === 'team_members') await setLeads(tx, plan.teamLeads)
  }
  const orgId = plan.rows.orgs[0].id
  if (domains.length > 0) await insertRows(tx, 'org_domains', domains.map((host) => ({ host, org_id: orgId })))
  return tickets
}

/**
 * Ce que laisse l'échec d'un import. Rien, la transaction étant annulée : un refus de la base, ou une
 * connexion perdue avant le `commit`, que Postgres annule avec la session ; le texte d'AC12 dit alors
 * l'organisation créée « supprimée ». Une connexion perdue pendant le `commit` ne dit pas s'il a abouti.
 */
function leftBy(error, { created, committing }, slug) {
  if (committing && !(error instanceof postgres.PostgresError)) return `État inconnu : vérifiez si l'organisation ${slug} existe.`
  return created ? `L'organisation ${slug} a été supprimée.` : "Rien n'a été écrit."
}

/**
 * Écrit le plan dans une seule transaction (AC12) : l'organisation, puis chaque table ; une insertion
 * refusée annule tout, l'organisation comprise. Rend les tickets renumérotés. Exportée pour son test.
 * @param {import('postgres').Sql} sql  connexion d'administration
 * @param {ReturnType<typeof planImport>} plan
 * @param {{ slug: string, domains: string[] }} options
 * @returns {Promise<[number, number][]>}
 */
export async function writePlan(sql, plan, { slug, domains }) {
  const state = { created: false, committing: false }
  try {
    return await sql.begin(async (tx) => {
      await insertRows(tx, 'orgs', plan.rows.orgs)
      state.created = true
      const tickets = await writeTables(tx, plan, domains)
      state.committing = true
      return tickets
    })
  } catch (error) {
    const cause = state.committing ? `commit : ${codeOf(error)}` : messageOf(error)
    throw new Error(`Import annulé : ${cause}. ${leftBy(error, state, slug)}`)
  }
}

/**
 * Importe le fichier : plan et contrôles, puis organisation et tables en une transaction ; rend le
 * plan, les tickets et les personnes au compte non confirmé.
 * @param {{ sql: import('postgres').Sql, admin: import('@supabase/supabase-js').SupabaseClient<any, any> }} db
 *   `platform` par la connexion d'administration ; les comptes par l'API d'administration d'Auth
 * @param {any} doc  fichier contrôlé par `validateDoc`
 * @param {ReturnType<typeof parseImportArgs>} options
 * @param {string} targetHost  hôte du projet cible
 */
async function importOrg(db, doc, options, targetHost) {
  const { plan, unconfirmed } = await prepare(db, doc, options, targetHost)
  return { plan, unconfirmed, tickets: await writePlan(db.sql, plan, options) }
}

async function main(argv) {
  let options
  let doc
  let values
  let store
  try {
    options = parseImportArgs(argv)
    doc = readDoc(options.in)
    values = readVariables(options.env, process.env, ROOT)
    // AC-e4 : avant la connexion, la lecture des comptes de la cible (`prepare`) et toute écriture.
    store = requireTransferStore(transferStore(values), (doc.tables.files ?? []).length, 'importer')
  } catch (error) {
    console.error(messageOf(error))
    return 1
  }
  const hidden = Object.values(values)
  let sql
  try {
    sql = adminSql(values)
    const targetHost = new URL(values.NEXT_PUBLIC_SUPABASE_URL).host
    const { plan, unconfirmed, tickets } = await importOrg({ sql, admin: serviceKeyClient(values) }, doc, options, targetHost)
    const summary = formatSummary({
      slug: options.slug,
      inserted: plan.rows,
      skipped: plan.skipped,
      absent: plan.absent,
      unconfirmed,
      closedInvitations: plan.closedInvitations,
      revokedGrants: plan.revokedGrants,
      tickets,
      domains: options.domains,
    })
    const files = await importObjects(store, { orgId: plan.rows.orgs[0].id, files: plan.files, file: options.in })
    for (const line of [...summary, ...files.lines]) console.log(maskValues(line, hidden))
    return files.failed > 0 ? 1 : 0
  } catch (error) {
    console.error(maskValues(messageOf(error), hidden))
    return 1
  } finally {
    await sql?.end()
  }
}

// Pas de process.exit : sous Windows, il arrête Node sur une assertion libuv quand une connexion HTTP
// se ferme encore (constaté au banc, `mcp-test/scripts/oauth-admin.mjs`).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code
  })
}
