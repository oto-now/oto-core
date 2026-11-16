/**
 * migrations check — contrôle « `platform` seulement, additif » des migrations du paquet
 * (ADR-006, FR-INST-04).
 *
 * Ce que ça empêche : qu'une migration du paquet, copiée et appliquée par l'hôte, crée un objet
 * hors du schéma `platform` ou retire quelque chose (drop, rename, set not null, changement de
 * type) dans une base qui porte aussi les données de l'hôte ; qu'une fonction de `platform`
 * garde l'`EXECUTE` par défaut de `public`, donc d'`anon`, qui a l'usage du schéma (E02-S01) ; et
 * qu'une migration remette une dépendance à Supabase ou à une extension que l'hôte refuse (E01-S09) :
 * clé ou lecture vers `auth.users`, extension hors de `pg_trgm`, `unaccent` et `ltree` ; et qu'une
 * fonction pose un paramètre de `pg_trgm` avant que la session ait chargé sa bibliothèque ; et qu'une fonction
 * redéfinie donne `EXECUTE` à un rôle qu'elle n'avait pas (`migrations-execute-grants.mjs`, suivi de fichier en fichier).
 * Seule exception au retrait d'un index : un index unique remplacé, dans le même fichier, par un index unique plus large
 * (`uniqueIndexTracker`), qui admet toute ligne qu'admettait l'ancien.
 *
 * Retrait déclaré (second temps d'un expand/contract sur base partagée, database-patterns.md § Expand/contract sur base
 * partagée) : une opération non additive (`drop`, `drop-column`, `rename`, `set-not-null`, `alter-column-type`) n'est
 * admise que si l'en-tête du fichier (ses lignes de commentaire avant la première instruction) la déclare, une ligne par
 * groupe : `-- retrait: platform.foo.bar, platform.baz ; plus lu depuis v1.8.0`. Un objet s'écrit `platform.<table>`,
 * `platform.<table>.<colonne>`, ou `platform.<nom>` pour un index, une fonction, une contrainte, une policy ou un
 * déclencheur ; la version, `vX.Y.Z`, est une étiquette d'oto-core. Sans mention, rien ne change. Avec une mention, les
 * opérations qu'elle couvre ne sont plus signalées, et cinq refus s'ajoutent : `retrait-malformed` (mention mal écrite ou
 * version hors de `vX.Y.Z`), `retrait-untagged` (version qui n'est pas une étiquette), `retrait-untagged-unverifiable`
 * (étiquettes introuvables : ni dépôt git qui suive le fichier, ni `--tags`), `retrait-uncovered` (opération non additive
 * sur un objet hors de la mention, ou dont l'objet ne se détermine pas) et `retrait-unused` (objet de la mention que le
 * fichier ne retire pas). Une mention après la première ligne qui n'est ni blanche ni un commentaire `--` n'est pas lue.
 * Objets et mentions : `migrations-retrait.mjs`.
 *
 * Sortie : `fichier:ligne règle` par erreur, suivie de son explication quand la règle en donne une ; code 1 s'il y en a une.
 * Avec `json`, un seul objet JSON sur la sortie standard (`{ ok, files: [{ file, retraits, errors }], requires }`, où
 * `requires` est la plus haute version déclarée), et rien d'autre.
 */
import { existsSync, readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { executeGrantTracker } from './migrations-execute-grants.mjs'
import { IDENT, objectAt, unquote } from './migrations-names.mjs'
import { printResults } from './migrations-report.mjs'
import { alteredTable, columnBefore, droppedInAlterTable, droppedObjects, gitTags, renamedObject, retraitMentions, tagSource, underRetraits } from './migrations-retrait.mjs'


/**
 * Remplace commentaires et littéraux '…' par des espaces, en gardant longueur et retours à la
 * ligne (les positions restent celles du fichier). Les corps `$$ … $$` sont gardés : un `drop`
 * dans un bloc DO reste un drop. Renvoie aussi les bornes des corps dollar, où `;` ne coupe pas.
 * Exportée avec `splitStatements` pour le test des policies finales (E01-S08, AC2), qui lit les
 * migrations comme ce contrôle.
 */
export function clean(sql) {
  const out = sql.split('')
  const dollarRanges = []
  const blank = (from, to) => {
    for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' '
  }
  let i = 0
  let dollar = null
  while (i < sql.length) {
    if (dollar) {
      if (sql.startsWith(dollar.tag, i)) {
        dollarRanges.push([dollar.start, i])
        i += dollar.tag.length
        dollar = null
        continue
      }
    }
    if (sql.startsWith('--', i)) {
      const end = sql.indexOf('\n', i)
      const stop = end === -1 ? sql.length : end
      blank(i, stop)
      i = stop
      continue
    }
    if (sql.startsWith('/*', i)) {
      const end = sql.indexOf('*/', i + 2)
      const stop = end === -1 ? sql.length : end + 2
      blank(i, stop)
      i = stop
      continue
    }
    if (sql[i] === "'") {
      let j = i + 1
      while (j < sql.length && !(sql[j] === "'" && sql[j + 1] !== "'")) j += sql[j] === "'" ? 2 : 1
      blank(i + 1, j)
      i = j + 1
      continue
    }
    const tag = !dollar && sql.slice(i).match(/^\$[a-z_]*\$/i)
    if (tag) {
      dollar = { tag: tag[0], start: i }
      i += tag[0].length
      continue
    }
    i++
  }
  return { text: out.join(''), dollarRanges }
}

export function splitStatements(text, dollarRanges) {
  const inDollar = (k) => dollarRanges.some(([a, b]) => k > a && k < b)
  const statements = []
  let start = 0
  for (let k = 0; k <= text.length; k++) {
    if (k === text.length || (text[k] === ';' && !inDollar(k))) {
      const body = text.slice(start, k)
      if (body.trim()) statements.push({ offset: start, body })
      start = k + 1
    }
  }
  return statements
}

const CREATE = /\bcreate\s+(?:or\s+replace\s+)?(?:unique\s+)?(?:(?:temp|temporary|unlogged|materialized|constraint)\s+)?(table|view|function|type|index|trigger|policy|sequence|schema|extension)\b/gi
const ALLOWED_DROP = /^\s*drop\s+(policy|trigger|function)\s+if\s+exists\s+(\S+)/i

/**
 * Portabilité (E01-S09, ADR-012 § 1) : les extensions qu'admet aussi le Postgres managé de Scaleway
 * (relevé de JB du 2026-09-25), et les seules fonctions qui peuvent lire le schéma d'Auth de Supabase
 * (le hook d'inscription, H11 ; les lectures OAuth, fiche D10). `auth.users` n'existe que sur Supabase.
 */
const ALLOWED_EXTENSIONS = ['pg_trgm', 'unaccent', 'ltree']
const SUPABASE_ONLY_FUNCTIONS = ['hook_before_user_created', 'oauth_pending_resource', 'oauth_clients_activity']
const AUTH_USERS = /\bauth\s*\.\s*users\b/i
const REFERENCES_AUTH_USERS = /\breferences\s+auth\s*\.\s*users\b/i

/** Pour index, trigger, policy : la table visée est après le premier `on`. */
function targetOf(kind, body, after) {
  if (['index', 'trigger', 'policy'].includes(kind)) {
    const on = body.slice(after).match(/\bon\s+/i)
    return on ? objectAt(body, after + on.index + on[0].length) : { schema: null }
  }
  return objectAt(body, after)
}

function schemaErrors(stmt, report) {
  for (const m of stmt.body.matchAll(CREATE)) {
    const kind = m[1].toLowerCase()
    const after = m.index + m[0].length
    const tail = stmt.body.slice(after)
    if (kind === 'schema') {
      if (!/^\s*(?:if\s+not\s+exists\s+)?platform\s*$/i.test(tail)) report(stmt.offset + m.index, 'create-schema-not-platform')
      continue
    }
    if (kind === 'extension') {
      if (!/\bwith\s+schema\s+extensions\s*$/i.test(tail)) report(stmt.offset + m.index, 'extension-outside-extensions')
      if (!ALLOWED_EXTENSIONS.includes(objectAt(stmt.body, after).name)) report(stmt.offset + m.index, 'extension-not-allowed')
      continue
    }
    if (targetOf(kind, stmt.body, after).schema !== 'platform') report(stmt.offset + m.index, `${kind}-outside-platform`)
  }
  for (const m of stmt.body.matchAll(/\balter\s+table\b/gi)) {
    if (objectAt(stmt.body, m.index + m[0].length).schema !== 'platform') report(stmt.offset + m.index, 'alter-table-outside-platform')
  }
}

/** `drop policy|trigger|function if exists X` suivi immédiatement de la recréation de X. */
function isDropBeforeRecreate(stmt, next) {
  const drop = stmt.body.match(ALLOWED_DROP)
  if (!drop || !next) return false
  const kind = drop[1].toLowerCase()
  const name = drop[2].replace(/\(.*$/, '').toLowerCase()
  const create = next.body.match(new RegExp(String.raw`^\s*create\s+(?:or\s+replace\s+)?${kind}\s+(\S+)`, 'i'))
  return Boolean(create) && create[1].replace(/\(.*$/, '').toLowerCase() === name
}

/**
 * Positions des `drop constraint X, add constraint X check` d'une instruction `alter table` : une
 * contrainte CHECK remplacée par une autre du même nom, dans la même instruction et sans `if exists`
 * (E01-S06, N16). Ce retrait est admis ; la revue vérifie que la nouvelle contrainte admet tout ce
 * qu'admettait l'ancienne. De même une clé étrangère remplacée par une clé du même nom (`add constraint
 * X foreign key`, M26, fiche D42 B : `on delete cascade` devenue différée sans action) : la revue
 * vérifie la décision qui change son action.
 */
const REPLACED_CHECK = new RegExp(String.raw`\bdrop\s+constraint\s+(${IDENT})\s*,\s*add\s+constraint\s+(${IDENT})\s+(?:check|foreign\s+key)\b`, 'gi')

function replacedCheckDrops(body) {
  const positions = new Set()
  for (const m of body.matchAll(REPLACED_CHECK)) if (unquote(m[1]) === unquote(m[2])) positions.add(m.index)
  return positions
}

/**
 * Positions des `alter column X drop not null` d'une instruction `alter table` : une colonne qui devient facultative
 * admet toute ligne qu'elle admettait, rien n'est retiré (le fichier en transit, sans nœud : `files.node_id`). Le
 * contraire, `set not null`, reste refusé.
 */
const RELAXED_NOT_NULL = new RegExp(String.raw`\balter\s+(?:column\s+)?${IDENT}\s+(drop)\s+not\s+null\b`, 'gi')

function relaxedNotNullDrops(body) {
  const positions = new Set()
  for (const m of body.matchAll(RELAXED_NOT_NULL)) positions.add(m.index + m[0].toLowerCase().lastIndexOf('drop'))
  return positions
}

/** Les morceaux d'une liste séparée par des virgules de premier niveau (hors parenthèses), en minuscules, sans blanc ni guillemet. */
function topLevelItems(list) {
  const items = []
  let level = 0
  let start = 0
  for (let j = 0; j <= list.length; j++) {
    const c = list[j]
    if (c === '(') level++
    else if (c === ')') level--
    else if (j === list.length || (c === ',' && level === 0)) {
      items.push(list.slice(start, j).replace(/\s+/g, '').replace(/"/g, '').toLowerCase())
      start = j + 1
    }
  }
  return items.filter(Boolean)
}

/** Les colonnes et expressions clés d'un index entre parenthèses, la première ouvrant à `open` ; `null` sans fermeture. */
function indexKeys(body, open) {
  let depth = 0
  for (let k = open; k < body.length; k++) {
    if (body[k] === '(') depth++
    else if (body[k] === ')' && --depth === 0) return topLevelItems(body.slice(open + 1, k))
  }
  return null
}

const UNIQUE_INDEX = new RegExp(String.raw`^\s*create\s+unique\s+index\s+(?:if\s+not\s+exists\s+)?(${IDENT})\s+on\s+(?:only\s+)?(?:(${IDENT})\s*\.\s*)?(${IDENT})\s*(?:using\s+\w+\s*)?\(`, 'i')
const DROP_INDEX = new RegExp(String.raw`^\s*drop\s+index\s+(?:if\s+exists\s+)?(?:(${IDENT})\s*\.\s*)?(${IDENT})\s*$`, 'i')

/** Un index unique créé par l'instruction : son nom, sa table (`schéma.table`) et ses clés ; `null` pour une autre. */
function uniqueIndexOf(body) {
  const m = body.match(UNIQUE_INDEX)
  if (!m) return null
  const keys = indexKeys(body, m[0].length - 1)
  return keys && { name: unquote(m[1]), table: `${m[2] ? unquote(m[2]) : 'public'}.${unquote(m[3])}`, keys }
}

/**
 * Les index uniques de `platform`, suivis de migration en migration, et l'exception étroite à « aucun retrait » : un
 * `drop index` d'un index unique connu est admis seulement si le même fichier crée un index unique sur la même table
 * dont les clés couvrent toutes les siennes et en ajoutent (le libellé d'un compte unique par propriétaire, et non plus
 * dans toute l'organisation). Un index plus large admet toute ligne qu'admettait l'ancien : rien de ce qu'une base
 * porte n'est refusé ensuite. Un index inconnu (créé hors des fichiers lus) n'est pas admis : rien n'en dit les clés.
 */
export function uniqueIndexTracker() {
  const known = new Map()
  return {
    /** Les positions (rang d'instruction) des `drop index` admis du fichier ; les index du fichier sont retenus. */
    file(statements) {
      const created = statements.map((stmt) => uniqueIndexOf(stmt.body)).filter(Boolean)
      const admitted = new Set()
      statements.forEach((stmt, k) => {
        const index = uniqueIndexOf(stmt.body)
        if (index) known.set(index.name, index)
        const drop = stmt.body.match(DROP_INDEX)
        if (!drop) return
        const name = unquote(drop[2])
        const dropped = known.get(name)
        const wider = dropped && created.some((other) => other.name !== name && other.table === dropped.table && dropped.keys.every((key) => other.keys.includes(key)) && other.keys.length > dropped.keys.length)
        if (wider) {
          admitted.add(k)
          known.delete(name)
        }
      })
      return admitted
    },
  }
}

const DROPPED_INDEX_DETAIL = 'un index unique ne se retire que remplacé, dans le même fichier, par un index unique de la même table dont les clés couvrent les siennes et en ajoutent'

/**
 * Les opérations non additives de l'instruction. Chacune porte, pour le retrait déclaré, les objets qu'elle touche
 * (`objects`, `null` quand ils ne se déterminent pas) : une mention qui les nomme tous la couvre.
 */
function additiveErrors(stmt, next, report, admittedDrop = false) {
  const isAlterTable = /^\s*alter\s+table\b/i.test(stmt.body)
  const table = isAlterTable ? alteredTable(stmt.body) : undefined
  const nonAdditive = (m, rule, object, detail) => report(stmt.offset + m.index, rule, detail, { objects: object ? (Array.isArray(object) ? object : [object]) : null })
  for (const m of stmt.body.matchAll(/\brename\b/gi)) nonAdditive(m, 'rename', renamedObject(stmt.body, m.index, table))
  for (const m of stmt.body.matchAll(/\bset\s+not\s+null\b/gi)) nonAdditive(m, 'set-not-null', isAlterTable ? columnBefore(stmt.body, m.index, table) : null)
  if (isAlterTable) {
    for (const m of stmt.body.matchAll(/\balter\s+(?:column\s+)?(?!table\b)([\w"]+)\s+(?:set\s+data\s+)?type\b/gi)) {
      nonAdditive(m, 'alter-column-type', table && `${table}.${unquote(m[1])}`)
    }
  }
  if (isDropBeforeRecreate(stmt, next) || admittedDrop) return
  const replaced = isAlterTable ? new Set([...replacedCheckDrops(stmt.body), ...relaxedNotNullDrops(stmt.body)]) : new Set()
  const droppedIndex = DROP_INDEX.test(stmt.body)
  for (const m of stmt.body.matchAll(/\bdrop\b/gi)) {
    if (replaced.has(m.index)) continue
    const dropColumn = isAlterTable && /^drop\s+(?:column\b|(?!constraint\b|default\b|not\b|identity\b|expression\b)[a-z_"])/i.test(stmt.body.slice(m.index))
    const objects = isAlterTable ? droppedInAlterTable(stmt.body, m.index, table, dropColumn) : m.index === 0 ? droppedObjects(stmt.body) : null
    nonAdditive(m, dropColumn ? 'drop-column' : 'drop', objects, droppedIndex ? DROPPED_INDEX_DETAIL : undefined)
  }
}

const REVOKE_FUNCTION = /^\s*revoke\s+(?:execute|all(?:\s+privileges)?)\s+on\s+(?:function|routine)s?\s+([\s\S]+?)\s+from\s+([\s\S]+?)\s*$/i
const FUNCTION_REF = new RegExp(String.raw`platform\s*\.\s*(${IDENT})`, 'gi')

/** Noms des fonctions de `platform` dont un `revoke … from public` du fichier retire l'`EXECUTE`. */
function revokedFromPublic(statements) {
  const revoked = new Set()
  for (const { body } of statements) {
    const m = body.match(REVOKE_FUNCTION)
    if (!m || !m[2].split(',').some((role) => role.trim().toLowerCase() === 'public')) continue
    // Les listes d'arguments (types compris, `varchar(80)`) ne nomment aucune fonction.
    let list = m[1]
    while (/\([^()]*\)/.test(list)) list = list.replace(/\([^()]*\)/g, '')
    for (const ref of list.matchAll(FUNCTION_REF)) revoked.add(unquote(ref[1]))
  }
  return revoked
}

/**
 * Toute fonction créée dans `platform` révoque `EXECUTE` à `public` dans le même fichier, sauf une
 * fonction de déclencheur, qu'on ne peut pas appeler seule.
 */
function executeErrors(statements, report) {
  const revoked = revokedFromPublic(statements)
  for (const stmt of statements) {
    const create = stmt.body.match(/^(\s*)create\s+(?:or\s+replace\s+)?function\s+/i)
    if (!create) continue
    const { schema, name } = objectAt(stmt.body, create[0].length)
    const returns = stmt.body.match(/\breturns\s+(?:setof\s+)?(\w+)/i)?.[1]?.toLowerCase()
    if (schema !== 'platform' || returns === 'trigger' || revoked.has(name)) continue
    report(stmt.offset + create[1].length, 'function-execute-not-revoked')
  }
}

/**
 * Aucune clé vers `auth.users`, et aucune lecture de `auth.users` hors des fonctions propres à Supabase
 * (fonction, vue, requête ou bloc) : la ligne de base s'installe aussi sur un Postgres sans Supabase.
 */
function portabilityErrors(stmt, report) {
  const references = stmt.body.match(REFERENCES_AUTH_USERS)
  if (references) {
    report(stmt.offset + references.index, 'auth-users-foreign-key')
    return
  }
  if (!AUTH_USERS.test(stmt.body)) return
  const create = stmt.body.match(/^create\s+(?:or\s+replace\s+)?function\s+/i)
  const name = create && objectAt(stmt.body, create[0].length).name
  if (!SUPABASE_ONLY_FUNCTIONS.includes(name)) report(stmt.offset, 'auth-users-read')
}

/**
 * Les deux fichiers publiés avant cette règle, figés : la migration préalable `20260928090000` charge la
 * bibliothèque dans la session qui les applique sur un hôte neuf.
 */
const PG_TRGM_LOADED_BEFORE = ['20260928100000_platform_base_v1.sql', '20260930100000_v1_1_0.sql']
const SETS_PG_TRGM = /\bset\s+"?pg_trgm\./i
const LOADS_PG_TRGM = /^\s*do\b[\s\S]*\bperform\s+extensions\s*\.\s*similarity\s*\(/i

/**
 * Une fonction dont l'en-tête pose un paramètre de `pg_trgm` (`set "pg_trgm.similarity_threshold"`) vient après
 * une instruction du même fichier qui charge la bibliothèque (`do $$ begin perform extensions.similarity('a', 'a');
 * end $$`) : un rôle non superutilisateur ne pose le paramètre d'une bibliothèque que si la session l'a chargée,
 * et `create extension if not exists` ne la charge pas. Sans elle, `supabase db push` s'arrête sur 42501.
 */
function pgTrgmErrors(statements, report) {
  let loaded = false
  for (const stmt of statements) {
    if (LOADS_PG_TRGM.test(stmt.body)) loaded = true
    const create = stmt.body.match(/^(\s*)create\s+(?:or\s+replace\s+)?function\s+/i)
    if (!create || loaded) continue
    // L'en-tête seul : le corps `$…$` peut nommer le paramètre sans le poser à la création.
    const body = stmt.body.search(/\$[a-z_]*\$/i)
    const header = body === -1 ? stmt.body : stmt.body.slice(0, body)
    if (SETS_PG_TRGM.test(header)) report(stmt.offset + create[1].length, 'pg-trgm-parameter-before-load')
  }
}

function checkSql(sql, { pgTrgmLoadedBefore = false, grants, indexes = uniqueIndexTracker(), mentions = [], tags = () => null } = {}) {
  const { text, dollarRanges } = clean(sql)
  const errors = []
  const lineOf = (offset) => text.slice(0, offset).split('\n').length
  const report = (offset, rule, detail, retrait) =>
    errors.push({ line: lineOf(offset), rule, detail, nonAdditive: retrait && { line: lineOf(offset), rule, objects: retrait.objects } })
  const statements = splitStatements(text, dollarRanges)
  const admittedDrops = indexes.file(statements)
  statements.forEach((stmt, k) => {
    // La position utile est celle du premier mot, pas des blancs qui le précèdent.
    const lead = stmt.body.match(/^\s*/)[0].length
    const trimmed = { offset: stmt.offset + lead, body: stmt.body.slice(lead) }
    schemaErrors(trimmed, report)
    additiveErrors(trimmed, statements[k + 1], report, admittedDrops.has(k))
    portabilityErrors(trimmed, report)
  })
  executeErrors(statements, report)
  if (!pgTrgmLoadedBefore) pgTrgmErrors(statements, report)
  grants?.file(statements, report)
  return underRetraits(errors, mentions, tags).sort((a, b) => a.line - b.line)
}

/**
 * `tags` : la liste explicite des étiquettes d'oto-core (`--tags`) ; sans elle, celles du dépôt git qui contient chaque
 * fichier (`listTags`, lue seulement pour un fichier qui déclare un retrait). `json` : un seul objet JSON sur stdout.
 */
export function checkMigrations({ files, tags = null, json = false, listTags = gitTags }) {
  const missing = files.find((file) => !existsSync(file))
  if (missing) {
    console.error(`check:migrations — fichier introuvable : ${resolve(missing)}`)
    return 1
  }
  const tagsOf = tagSource({ tags, listTags })
  // Les fichiers dans l'ordre où ils s'appliquent (`sqlFiles` les trie) : le droit d'une fonction est celui d'avant.
  const grants = executeGrantTracker()
  const indexes = uniqueIndexTracker()
  const results = files.map((file) => {
    const sql = readFileSync(file, 'utf8')
    const pgTrgmLoadedBefore = PG_TRGM_LOADED_BEFORE.includes(basename(file))
    const mentions = retraitMentions(sql)
    return { file, mentions, errors: checkSql(sql, { pgTrgmLoadedBefore, grants, indexes, mentions, tags: () => tagsOf(file) }) }
  })
  return printResults(results, { json })
}
