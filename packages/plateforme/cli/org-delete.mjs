/**
 * org delete — retire une organisation de `platform` et du stockage (`administration-et-cellule.md` § Suppression d'une
 * organisation), par l'outillage de l'hôte, sur une connexion d'administration : aucune porte de l'application ne le
 * fait. Sans `--yes`, la commande compte et n'écrit rien ; avec `--yes`, au nom d'un membre de l'équipe plateforme
 * (`--by`), elle supprime les objets sous `<org_id>/`, puis la base en une transaction (journal admin anonymisé, ligne
 * « organisation supprimée »), puis repasse sur le stockage. Relancée, elle reprend où elle s'est arrêtée, et ne change
 * rien à ce qui est déjà supprimé. Rien du mot de passe de l'URL ni des clés du stockage n'est jamais écrit. TLS sauf
 * `sslmode` écrit dans l'URL (`ssl-option.mjs`).
 */
import postgres from 'postgres'
import { mask, urlPassword } from './masking.mjs'
import { countOrgRows, ORG_TABLES } from './org-tables.mjs'
import { sslOption } from './ssl-option.mjs'
import { bucketObjects, STORAGE_VARIABLES, storageConfig } from './storage.mjs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
/** Le slug d'une organisation (E08-S02 N18). */
const SLUG = /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/
/** Suppressions d'objets menées ensemble. */
const CONCURRENCY = 8
/** La ligne « organisation supprimée » du journal admin. */
const DELETION = { method: 'cli', tool: 'org', op: 'delete' }

/** Un refus dit à l'opérateur : rien n'est écrit. */
export class OrgDeleteRefusal extends Error {}

/**
 * @typedef {{ list(prefix: string): Promise<string[]>, remove(key: string): Promise<void> }} Bucket
 * @typedef {{ id: string, slug: string, name: string }} Org
 * @typedef {{ state: 'present', org: Org } | { state: 'deleted', orgId: string, at: string }} Target
 */

/**
 * L'organisation du slug ; à défaut, celle qu'une ligne « organisation supprimée » nomme, pour une relance. Une ligne
 * qui nommerait une organisation existante est refusée : l'équipe plateforme peut écrire le journal admin, et le
 * stockage d'une autre organisation ne se vide pas sur sa foi.
 * @param {import('postgres').Sql} sql
 * @param {string} slug
 * @returns {Promise<Target>}
 */
async function findTarget(sql, slug) {
  const [org] = await sql`select id, slug, name from platform.orgs where slug = ${slug}`
  if (org) return { state: 'present', org }
  const [line] = await sql`
    select args ->> 'org_id' as org_id, to_json(ts) #>> '{}' as at from platform.admin_journal
     where method = ${DELETION.method} and tool = ${DELETION.tool} and op = ${DELETION.op} and target = ${`org:${slug}`} and not is_error
     order by ts desc, id desc limit 1`
  if (!line) throw new OrgDeleteRefusal(`organisation inconnue : ${slug}`)
  const [alive] = UUID.test(line.org_id ?? '') ? await sql`select 1 from platform.orgs where id = ${line.org_id}` : [true]
  if (alive) throw new OrgDeleteRefusal(`la ligne « organisation supprimée » de ${slug} ne nomme pas une organisation supprimée`)
  return { state: 'deleted', orgId: line.org_id, at: line.at }
}

/**
 * Le membre de l'équipe plateforme au nom de qui la suppression se fait, par son email.
 * @param {import('postgres').Sql} sql
 * @param {string} email
 * @returns {Promise<string>} son identifiant
 */
async function staffOf(sql, email) {
  const found = await sql`select user_id from platform.platform_staff where email = ${email.trim().toLowerCase()} limit 2`
  if (found.length !== 1) throw new OrgDeleteRefusal(`--by : ${email} n'est pas un membre de l'équipe plateforme (platform_staff)`)
  return found[0].user_id
}

/**
 * Les membres de l'organisation qui ne le sont d'aucune autre ni de l'équipe plateforme : ils gardent leur ligne
 * `identities`, que seul `forget_user` retire.
 * @param {import('postgres').Sql} sql
 * @param {string} orgId
 */
async function soleMembers(sql, orgId) {
  const [row] = await sql`
    select count(*)::int as people from platform.members m
     where m.org_id = ${orgId}
       and not exists (select 1 from platform.members o where o.user_id = m.user_id and o.org_id <> ${orgId})
       and not exists (select 1 from platform.platform_staff s where s.user_id = m.user_id)`
  return row.people
}

/**
 * Supprime les objets sous `<org_id>/`, page après page, jusqu'à un préfixe vide. Rend le nombre d'objets supprimés.
 * @param {Bucket | null} store
 * @param {string} orgId  un uuid : son préfixe ne couvre jamais celui d'une autre organisation
 */
export async function sweepObjects(store, orgId) {
  if (!store) return 0
  if (!UUID.test(orgId)) throw new Error(`identifiant d'organisation invalide : ${orgId}`)
  const removed = new Set()
  for (;;) {
    const keys = await store.list(`${orgId}/`)
    if (keys.length === 0) return removed.size
    const again = keys.find((key) => removed.has(key))
    if (again !== undefined) throw new Error(`le stockage liste encore un objet supprimé (${again})`)
    for (let at = 0; at < keys.length; at += CONCURRENCY) await Promise.all(keys.slice(at, at + CONCURRENCY).map((key) => store.remove(key)))
    for (const key of keys) removed.add(key)
  }
}

/**
 * La base, en une transaction : l'organisation verrouillée, le journal admin anonymisé, les comptes de connecteur puis
 * l'organisation supprimés (les cascades emportent le reste), le contrôle qu'aucune table de la carte ne garde une
 * ligne, la ligne « organisation supprimée ». Les tables rattachées à leur parent suivent sa clé étrangère.
 * @param {import('postgres').Sql} sql
 * @param {{ org: Org, staff: string, started: number }} deletion
 */
async function deleteRows(sql, { org, staff, started }) {
  return sql.begin(async (tx) => {
    const [locked] = await tx`select id from platform.orgs where id = ${org.id} and slug = ${org.slug} for update`
    if (!locked) throw new OrgDeleteRefusal(`l'organisation ${org.slug} a changé pendant la commande : relancez-la`)
    const rows = await countOrgRows(tx, org.id)
    await tx`update platform.admin_journal set args = null, target = null, error = null, ctx = null, org_id = null where org_id = ${org.id}`
    // Les comptes d'abord : leurs règles partent avec eux sans écrire au journal des partages (`account_share_journal`).
    await tx`delete from platform.accounts where org_id = ${org.id}`
    await tx`delete from platform.orgs where id = ${org.id}`
    const left = Object.entries(await countOrgRows(tx, org.id)).filter(([, count]) => count > 0)
    if (left.length > 0) throw new Error(`lignes restantes après la suppression, rien n'est supprimé : ${left.map(([name, count]) => `${name} ${count}`).join(', ')}`)
    const line = { user_id: staff, ...DELETION, target: `org:${org.slug}`, args: tx.json({ org_id: org.id }), duration_ms: Date.now() - started }
    await tx`insert into platform.admin_journal ${tx(line)}`
    return rows
  })
}

/**
 * Le service : ce que la suppression ferait (`apply` faux, rien n'est écrit) ou ce qu'elle a fait. `store` : le bucket,
 * `null` pour un hôte sans stockage (refusé si l'organisation porte une ligne `files`).
 * @param {{ sql: import('postgres').Sql, store: Bucket | null }} deps
 * @param {{ slug: string, by?: string, apply: boolean }} request
 */
export async function deleteOrg({ sql, store }, { slug, by, apply }) {
  const started = Date.now()
  const target = await findTarget(sql, slug)
  const staff = apply ? await staffOf(sql, by ?? '') : null
  if (target.state === 'deleted') {
    const objects = apply ? await sweepObjects(store, target.orgId) : store ? (await store.list(`${target.orgId}/`)).length : 0
    return { state: 'deleted', slug, orgId: target.orgId, at: target.at, applied: apply, objects }
  }
  const { org } = target
  const rows = await countOrgRows(sql, org.id)
  if (!store && rows.files > 0) throw new OrgDeleteRefusal(`--without-storage, mais ${org.slug} porte ${rows.files} fichier(s) joint(s) : posez ${STORAGE_VARIABLES.join(', ')}`)
  const people = await soleMembers(sql, org.id)
  const report = { state: 'present', org, applied: apply, rows, anonymized: rows.admin_journal, people }
  if (!apply) return { ...report, objects: store ? (await store.list(`${org.id}/`)).length : 0 }
  const before = await sweepObjects(store, org.id)
  const deletedRows = await deleteRows(sql, { org, staff, started })
  let after
  try {
    after = await sweepObjects(store, org.id)
  } catch (error) {
    throw new Error(`base supprimée, stockage en échec (${error?.message ?? error}) : relancez la commande pour retirer les objets restants`)
  }
  return { ...report, rows: deletedRows, anonymized: deletedRows.admin_journal, objects: before + after }
}

/**
 * Le compte rendu, une ligne par table de la carte.
 * @param {Awaited<ReturnType<typeof deleteOrg>>} report
 * @returns {string[]}
 */
export function reportLines(report) {
  if (report.state === 'deleted') {
    const objects = report.applied ? `${report.objects} objet(s) supprimé(s)` : `${report.objects} objet(s) restant(s), rien n'est supprimé sans --yes`
    return [`org delete : organisation ${report.slug} déjà supprimée le ${report.at} (${report.orgId}) ; stockage : ${objects}.`]
  }
  const { org, applied, rows } = report
  const head = applied ? `org delete : organisation ${org.slug} (${org.name}, ${org.id}) supprimée.` : `org delete : organisation ${org.slug} (${org.name}, ${org.id}) : rien n'est supprimé sans --yes. Seraient supprimés :`
  const tables = ORG_TABLES.filter((table) => table.fate === 'deleted').map((table) => `  ${table.name} : ${rows[table.name]} ligne(s)`)
  return [
    head,
    ...tables,
    `  admin_journal : ${report.anonymized} ligne(s) ${applied ? 'anonymisée(s), et la ligne « organisation supprimée »' : 'à anonymiser'}`,
    `  stockage : ${report.objects} objet(s) sous ${org.id}/${applied ? ' supprimé(s)' : ''}`,
    `  personnes membres de cette seule organisation : ${report.people} (gardées dans identities ; forget_user pour les oublier)`,
  ]
}

/**
 * Le bucket de la commande : celui des cinq variables ; aucun avec `--without-storage`, refusé si elles sont posées.
 * @param {Record<string, string | undefined>} env
 * @param {boolean} withoutStorage
 * @returns {Bucket | null}
 */
function commandStore(env, withoutStorage) {
  const config = storageConfig(env)
  if (withoutStorage) {
    if (config) throw new OrgDeleteRefusal(`--without-storage, mais ${STORAGE_VARIABLES.join(', ')} sont posées`)
    return null
  }
  if (!config) throw new OrgDeleteRefusal(`stockage non configuré : posez ${STORAGE_VARIABLES.join(', ')}, ou --without-storage pour un hôte sans stockage`)
  const bucket = bucketObjects(config)
  if ('problem' in bucket) throw new OrgDeleteRefusal(bucket.problem)
  return bucket.store
}

/**
 * La commande. `connect` : le client postgres.js ; `store` : le bucket, à la place de celui des variables (tests).
 * Rend le code de sortie : 0 compté, supprimé ou déjà supprimé ; 1 refusé ou en échec (message sur `printError`).
 * @param {{ dbUrl: string, org: string, by?: string, yes: boolean, withoutStorage: boolean, env: Record<string, string | undefined>,
 *   print: (line: string) => void, printError: (line: string) => void, connect?: typeof postgres, store?: Bucket | null }} options
 */
export async function orgDeleteCommand({ dbUrl, org, by, yes, withoutStorage, env, print, printError, connect = postgres, store }) {
  const secrets = [urlPassword(dbUrl), env.PLATFORM_STORAGE_SECRET_ACCESS_KEY, env.PLATFORM_STORAGE_ACCESS_KEY_ID]
  let bucket
  try {
    if (!SLUG.test(org)) throw new OrgDeleteRefusal(`--org attend le slug d'une organisation (« ${org.slice(0, 40)} »)`)
    bucket = store === undefined ? commandStore(env, withoutStorage) : store
  } catch (error) {
    printError(mask(`org delete : ${error?.message ?? error}`, secrets))
    return 1
  }
  const sql = connect(dbUrl, { max: 1, ...sslOption(dbUrl), connection: { application_name: 'oto-platform org delete' } })
  try {
    const report = await deleteOrg({ sql, store: bucket }, { slug: org, by, apply: yes })
    for (const line of reportLines(report)) print(line)
    return 0
  } catch (error) {
    printError(mask(`org delete : ${error?.message ?? error}`, secrets))
    return 1
  } finally {
    await sql.end({ timeout: 5 }).catch((error) => printError(mask(`org delete : connexion mal fermée : ${error?.message ?? error}`, secrets)))
  }
}
