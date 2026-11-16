/**
 * Le retrait déclaré de `migrations check` (database-patterns.md § Expand/contract sur base partagée) : l'objet que
 * touche chaque opération non additive, les mentions `-- retrait: … ; plus lu depuis vX.Y.Z` de l'en-tête d'une
 * migration, et les erreurs d'un fichier sous ses mentions.
 */
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { IDENT, QUALIFIED, objectAt, unquote } from './migrations-names.mjs'

/** `platform.<nom>[.<sous-nom>]` d'un objet de `platform` ; `null` pour un autre schéma ou un nom sans schéma. */
const platformObject = (schema, ...names) => (schema === 'platform' ? ['platform', ...names].join('.') : null)

/** La table d'une instruction `alter table` (`platform.<table>`), `null` hors de `platform`. */
export function alteredTable(body) {
  const head = body.match(/^alter\s+table\s+/i)
  const { schema, name } = objectAt(body, head[0].length)
  return platformObject(schema, name)
}

const COLUMN_BEFORE = new RegExp(String.raw`\balter\s+(?:column\s+)?(${IDENT})\s+$`, 'i')

/** La colonne d'une clause `alter [column] c …` qui finit juste avant `at` (`set not null`, `drop default`) ; `null` sans elle. */
export function columnBefore(body, at, table) {
  const m = body.slice(0, at).match(COLUMN_BEFORE)
  return m && table ? `${table}.${unquote(m[1])}` : null
}

const ALTER_OTHER = /^alter\s+(index|function|procedure|view|materialized\s+view|sequence|type|domain|policy|trigger)\s+(?:if\s+exists\s+)?/i
const DROP_HEAD = /^drop\s+(index|function|procedure|view|materialized\s+view|table|sequence|type|domain|policy|trigger)\s+(?:concurrently\s+)?(?:if\s+exists\s+)?/i

/** `platform.<nom>` d'une policy ou d'un déclencheur nommé à `at`, sur une table de `platform` (`p on platform.t`). */
function namedOnPlatformTable(body, at) {
  const m = body.slice(at).match(new RegExp(String.raw`^(${IDENT})\s+on\s+`, 'i'))
  if (!m) return null
  return objectAt(body, at + m[0].length).schema === 'platform' ? `platform.${unquote(m[1])}` : null
}

/** L'objet renommé par le `rename` à `at` ; `null` s'il ne se détermine pas. */
export function renamedObject(body, at, table) {
  const after = body.slice(at + 'rename'.length)
  if (table !== undefined) {
    if (!table) return null
    if (/^\s+to\b/i.test(after)) return table
    const constraint = after.match(new RegExp(String.raw`^\s+constraint\s+(${IDENT})`, 'i'))
    if (constraint) return `platform.${unquote(constraint[1])}`
    const column = after.match(new RegExp(String.raw`^\s+(?:column\s+)?(${IDENT})\s+to\b`, 'i'))
    return column ? `${table}.${unquote(column[1])}` : null
  }
  const head = body.match(ALTER_OTHER)
  if (!head) return null
  if (/^(policy|trigger)$/i.test(head[1])) return namedOnPlatformTable(body, head[0].length)
  const { schema, name } = objectAt(body, head[0].length)
  return platformObject(schema, name)
}

/** Les objets retirés par une instruction `drop …` (plusieurs : `drop table platform.a, platform.b`) ; `null` si l'un ne se détermine pas. */
export function droppedObjects(body) {
  const head = body.match(DROP_HEAD)
  if (!head) return null
  if (/^(policy|trigger)$/i.test(head[1])) {
    const object = namedOnPlatformTable(body, head[0].length)
    return object && [object]
  }
  // Les listes d'arguments d'une fonction ne nomment aucun objet.
  let list = body.slice(head[0].length)
  while (/\([^()]*\)/.test(list)) list = list.replace(/\([^()]*\)/g, '')
  list = list.replace(/\s+(?:cascade|restrict)\s*$/i, '')
  const objects = list.split(',').map((item) => {
    const m = item.trim().match(new RegExp(String.raw`^${QUALIFIED.source.slice(1)}\s*$`, 'i'))
    return m && m[2] ? platformObject(unquote(m[1]), unquote(m[2])) : null
  })
  return objects.every(Boolean) ? objects : null
}

/** L'objet retiré par le `drop` à `at` d'une instruction `alter table` : colonne, contrainte, défaut ou identité d'une colonne. */
export function droppedInAlterTable(body, at, table, dropColumn) {
  if (!table) return null
  const rest = body.slice(at)
  const constraint = rest.match(new RegExp(String.raw`^drop\s+constraint\s+(?:if\s+exists\s+)?(${IDENT})`, 'i'))
  if (constraint) return `platform.${unquote(constraint[1])}`
  if (dropColumn) {
    const column = rest.match(new RegExp(String.raw`^drop\s+(?:column\s+)?(?:if\s+exists\s+)?(${IDENT})`, 'i'))
    return column ? `${table}.${unquote(column[1])}` : null
  }
  return columnBefore(body, at, table)
}

const MENTION = /^\s*--\s*retrait\s*:(.*)$/i
const MENTION_BODY = /^\s*(.+?)\s*;\s*plus\s+lu\s+depuis\s+(\S+)\s*$/i
const MENTION_OBJECT = new RegExp(String.raw`^platform\.(${IDENT})(?:\.(${IDENT}))?$`, 'i')
const VERSION = /^v(\d+)\.(\d+)\.(\d+)$/
const MENTION_FORM = 'attendu « -- retrait: platform.<objet>[, platform.<objet>…] ; plus lu depuis vX.Y.Z »'

/**
 * Les mentions de retrait de l'en-tête d'une migration (ses lignes de commentaire `--` et ses lignes blanches, jusqu'à la
 * première autre ligne) : ses lignes `-- retrait: …`. Chacune
 * rend sa ligne (`line`), son texte (`text`), ses objets normalisés comme le contrôle les lit (`objects`, guillemets
 * retirés, minuscules hors guillemets) et sa version (`since`) ; une mention mal écrite rend `problem`, et ses objets
 * quand ils se lisent. Exportée pour la réunion des migrations d'une version (`scripts/lib/reunion-des-migrations.mjs`).
 */
export function retraitMentions(sql) {
  const lines = sql.split('\n')
  const end = lines.findIndex((raw) => !/^\s*(?:--.*)?$/.test(raw))
  return lines
    .slice(0, end === -1 ? lines.length : end)
    .flatMap((raw, k) => {
      const mention = raw.match(MENTION)
      if (!mention) return []
      const line = k + 1
      const body = mention[1].match(MENTION_BODY)
      if (!body) return [{ line, text: raw, problem: MENTION_FORM }]
      const objects = []
      for (const name of body[1].split(',').map((item) => item.trim())) {
        const object = name.match(MENTION_OBJECT)
        if (!object) return [{ line, text: raw, problem: `objet « ${name} » : attendu platform.<nom> ou platform.<table>.<colonne>` }]
        objects.push(['platform', unquote(object[1]), ...(object[2] ? [unquote(object[2])] : [])].join('.'))
      }
      if (!VERSION.test(body[2])) return [{ line, text: raw, objects, problem: `version « ${body[2]} » : attendu vX.Y.Z` }]
      return [{ line, text: raw, objects, since: body[2] }]
    })
}

/**
 * Les erreurs d'un fichier sous ses mentions de retrait. Sans mention, elles restent telles quelles. Avec, une opération
 * non additive dont la mention nomme tous les objets n'est plus signalée ; une autre devient `retrait-uncovered`. Chaque
 * mention est contrôlée : forme (`retrait-malformed`), version étiquetée (`retrait-untagged`, ou
 * `retrait-untagged-unverifiable` quand `tags()` rend `null`), objets retirés par le fichier (`retrait-unused`).
 */
export function underRetraits(errors, mentions, tags) {
  const plain = ({ line, rule, detail }) => ({ line, rule, detail })
  if (!mentions.length) return errors.map(plain)
  const used = new Map(mentions.flatMap((mention) => (mention.objects ?? []).map((object) => [object, false])))
  const out = []
  for (const error of errors) {
    if (!error.nonAdditive) {
      out.push(plain(error))
      continue
    }
    const { line, rule, objects } = error.nonAdditive
    if (!objects) {
      out.push({ line, rule: 'retrait-uncovered', detail: `${rule} : objet indéterminé, qu'aucune mention ne peut couvrir` })
      continue
    }
    for (const object of objects) if (used.has(object)) used.set(object, true)
    const missing = objects.filter((object) => !used.has(object))
    if (missing.length) out.push({ line, rule: 'retrait-uncovered', detail: `${rule} de ${missing.join(', ')}, absent de la mention de retrait` })
  }
  for (const mention of mentions) {
    const { line } = mention
    if (mention.problem) out.push({ line, rule: 'retrait-malformed', detail: mention.problem })
    else {
      const known = tags()
      if (!known) out.push({ line, rule: 'retrait-untagged-unverifiable', detail: `${mention.since} : étiquettes introuvables, ni dépôt git autour du fichier, ni --tags` })
      else if (!known.includes(mention.since)) out.push({ line, rule: 'retrait-untagged', detail: `${mention.since} n'est pas une étiquette d'oto-core` })
    }
    for (const object of mention.objects ?? []) {
      if (!used.get(object)) out.push({ line, rule: 'retrait-unused', detail: `${object} : le fichier ne le retire pas` })
    }
  }
  return out
}

/**
 * Les étiquettes `v*` du dépôt git qui contient `file` ; `null` hors d'un dépôt, sans git, ou pour un fichier que le dépôt
 * ignore : le paquet installé dans `node_modules` d'un hôte n'est pas dans le dépôt de l'hôte, dont les étiquettes ne
 * sont pas celles d'oto-core.
 */
export function gitTags(file) {
  const git = (...args) => execFileSync('git', ['-C', dirname(file), ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  try {
    git('check-ignore', '-q', file)
    return null
  } catch (error) {
    // `check-ignore` sort en 1 pour un fichier suivi ou suivable, en 128 hors d'un dépôt.
    if (error.status !== 1) return null
  }
  try {
    return git('tag', '--list', 'v*').split('\n').map((tag) => tag.trim()).filter(Boolean)
  } catch {
    return null
  }
}

/** Les étiquettes d'un fichier : la liste explicite `tags`, sinon `listTags(fichier)`, lue une fois par dossier. */
export function tagSource({ tags, listTags }) {
  const byDir = new Map()
  return (file) => {
    if (tags) return tags
    const dir = dirname(resolve(file))
    if (!byDir.has(dir)) byDir.set(dir, listTags(resolve(file)))
    return byDir.get(dir)
  }
}

/** La plus haute de versions `vX.Y.Z` (ordre semver) ; `null` sans aucune. */
export function highestVersion(versions) {
  const parts = (version) => version.match(VERSION).slice(1).map(Number)
  const later = (a, b) => {
    const [pa, pb] = [parts(a), parts(b)]
    const k = pa.findIndex((n, j) => n !== pb[j])
    return k !== -1 && pa[k] > pb[k]
  }
  return versions.reduce((best, version) => (best === null || later(version, best) ? version : best), null)
}
