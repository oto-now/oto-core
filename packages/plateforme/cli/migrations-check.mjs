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
 * fonction pose un paramètre de `pg_trgm` avant que la session ait chargé sa bibliothèque.
 *
 * Sortie : `fichier:ligne règle` par erreur, code 1 s'il y en a une.
 */
import { existsSync, readFileSync } from 'node:fs'
import { basename, isAbsolute, relative, resolve, sep } from 'node:path'

const IDENT = String.raw`(?:"[^"]+"|[a-z_][a-z0-9_$]*)`
const QUALIFIED = new RegExp(String.raw`^(${IDENT})(?:\s*\.\s*(${IDENT}))?`, 'i')
const unquote = (s) => (s.startsWith('"') ? s.slice(1, -1) : s.toLowerCase())

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

/** Schéma et nom de l'objet qui commence à `pos` dans `body` (après les mots-clés). */
function objectAt(body, pos) {
  const rest = body.slice(pos).replace(/^\s*(?:if\s+(?:not\s+)?exists\s+)?(?:only\s+)?/i, '')
  const m = rest.match(QUALIFIED)
  if (!m) return { schema: null, name: null }
  return m[2] ? { schema: unquote(m[1]), name: unquote(m[2]) } : { schema: null, name: unquote(m[1]) }
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

function additiveErrors(stmt, next, report) {
  const isAlterTable = /^\s*alter\s+table\b/i.test(stmt.body)
  const rules = [
    [/\brename\b/gi, 'rename'],
    [/\bset\s+not\s+null\b/gi, 'set-not-null'],
  ]
  if (isAlterTable) {
    rules.push([/\balter\s+(?:column\s+)?(?!table\b)[\w"]+\s+(?:set\s+data\s+)?type\b/gi, 'alter-column-type'])
  }
  for (const [re, rule] of rules) for (const m of stmt.body.matchAll(re)) report(stmt.offset + m.index, rule)
  if (isDropBeforeRecreate(stmt, next)) return
  const replaced = isAlterTable ? new Set([...replacedCheckDrops(stmt.body), ...relaxedNotNullDrops(stmt.body)]) : new Set()
  for (const m of stmt.body.matchAll(/\bdrop\b/gi)) {
    if (replaced.has(m.index)) continue
    const dropColumn = isAlterTable && /^drop\s+(?:column\b|(?!constraint\b|default\b|not\b|identity\b|expression\b)[a-z_"])/i.test(stmt.body.slice(m.index))
    report(stmt.offset + m.index, dropColumn ? 'drop-column' : 'drop')
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

function checkSql(sql, { pgTrgmLoadedBefore = false } = {}) {
  const { text, dollarRanges } = clean(sql)
  const errors = []
  const report = (offset, rule) => errors.push({ line: text.slice(0, offset).split('\n').length, rule })
  const statements = splitStatements(text, dollarRanges)
  statements.forEach((stmt, k) => {
    // La position utile est celle du premier mot, pas des blancs qui le précèdent.
    const lead = stmt.body.match(/^\s*/)[0].length
    const trimmed = { offset: stmt.offset + lead, body: stmt.body.slice(lead) }
    schemaErrors(trimmed, report)
    additiveErrors(trimmed, statements[k + 1], report)
    portabilityErrors(trimmed, report)
  })
  executeErrors(statements, report)
  if (!pgTrgmLoadedBefore) pgTrgmErrors(statements, report)
  return errors.sort((a, b) => a.line - b.line)
}

/** Chemin affiché : relatif au répertoire courant quand le fichier y est, absolu sinon. */
function shown(file) {
  const absolute = resolve(file)
  const rel = relative(process.cwd(), absolute)
  const outside = rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)
  return outside ? absolute : rel.split(sep).join('/')
}

export function checkMigrations({ files }) {
  const missing = files.find((file) => !existsSync(file))
  if (missing) {
    console.error(`check:migrations — fichier introuvable : ${resolve(missing)}`)
    return 1
  }
  let failures = 0
  for (const file of files) {
    const pgTrgmLoadedBefore = PG_TRGM_LOADED_BEFORE.includes(basename(file))
    for (const { line, rule } of checkSql(readFileSync(file, 'utf8'), { pgTrgmLoadedBefore })) {
      console.log(`${shown(file)}:${line} ${rule}`)
      failures++
    }
  }
  if (failures) {
    console.error(`check:migrations — ${failures} erreur(s)`)
    return 1
  }
  console.log(`check:migrations — ${files.length} fichier(s) conforme(s)`)
  return 0
}
