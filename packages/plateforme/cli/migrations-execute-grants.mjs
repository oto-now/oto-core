/**
 * Le droit d'exécuter une fonction de `platform`, suivi de migration en migration : qui a `EXECUTE` sur chaque
 * fonction (par sa signature) après chaque fichier. Ce que ça empêche : qu'un fichier qui redéfinit une fonction
 * existante (`create or replace`, ou `drop` puis `create`) élargisse son droit sans le vouloir, en recopiant les
 * `grant` d'une autre fonction (cas du 21/10/2026 : `purge_transit_files`, réservée au rôle serveur, redéfinie avec
 * un `grant … to authenticated`). Le droit est celui que Postgres applique, pas le texte : `create or replace` garde
 * le droit d'avant ; une fonction créée (ou recréée après `drop`) s'exécute par `public` ; `grant` et `revoke`
 * (`execute` ou `all`) ajoutent et retirent des rôles ; `public` couvre tous les rôles.
 *
 * Un élargissement voulu s'écrit dans un fichier qui ne redéfinit pas la fonction : un `grant` seul, qui se lit
 * comme une décision ; le refus le dit.
 */

const IDENT = String.raw`(?:"[^"]+"|[a-z_][a-z0-9_$]*)`
const unquote = (s) => (s.startsWith('"') ? s.slice(1, -1) : s.toLowerCase())

/** Les types dont le nom tient en plusieurs mots : leur premier mot n'est pas un nom de paramètre. */
const MULTIWORD_TYPES = new Set(['double', 'character', 'char', 'timestamp', 'time', 'bit', 'interval', 'national'])
const ALIASES = {
  int: 'integer',
  int4: 'integer',
  int8: 'bigint',
  int2: 'smallint',
  bool: 'boolean',
  float8: 'double precision',
  float4: 'real',
  varchar: 'character varying',
  'char varying': 'character varying',
  timestamptz: 'timestamp with time zone',
  timestamp: 'timestamp without time zone',
  timetz: 'time with time zone',
  decimal: 'numeric',
}

/** Coupe `text` aux virgules hors parenthèses. */
function splitTopLevel(text) {
  const parts = []
  let depth = 0
  let start = 0
  for (let k = 0; k < text.length; k++) {
    if (text[k] === '(') depth++
    else if (text[k] === ')') depth--
    else if (text[k] === ',' && depth === 0) {
      parts.push(text.slice(start, k))
      start = k + 1
    }
  }
  parts.push(text.slice(start))
  return parts.map((part) => part.trim()).filter(Boolean)
}

/** Le type d'un paramètre, sans mode, nom, valeur par défaut ni modificateur ; `null` pour un paramètre `out`. */
function parameterType(parameter) {
  const bare = parameter.replace(/\s+default\s+[\s\S]*$/i, '').replace(/\s*=[\s\S]*$/, '')
  const tokens = bare.replace(/\([^()]*\)/g, '').toLowerCase().split(/\s+/).filter(Boolean)
  if (['in', 'out', 'inout', 'variadic'].includes(tokens[0])) {
    if (tokens.shift() === 'out') return null
  }
  if (tokens.length > 1 && !MULTIWORD_TYPES.has(tokens[0]) && !tokens[0].endsWith('[]')) tokens.shift()
  const type = tokens.join(' ').replace(/^(?:pg_catalog|public)\./, '')
  const array = type.endsWith('[]') ? '[]' : ''
  const base = array ? type.slice(0, -2) : type
  return (ALIASES[base] ?? base) + array
}

/** La signature `nom(type,…)` d'une fonction de `platform` nommée à `text` (`platform.f(…)`) ; `null` hors de `platform`. */
function signatureAt(text) {
  const m = text.match(new RegExp(String.raw`^\s*(${IDENT})\s*\.\s*(${IDENT})\s*(\()?`, 'i'))
  if (!m || unquote(m[1]) !== 'platform') return null
  const name = unquote(m[2])
  if (!m[3]) return { name, key: null }
  let depth = 0
  let end = m[0].length - 1
  for (; end < text.length; end++) {
    if (text[end] === '(') depth++
    else if (text[end] === ')' && --depth === 0) break
  }
  const types = splitTopLevel(text.slice(m[0].length, end)).map(parameterType).filter((type) => type !== null)
  return { name, key: `${name}(${types.join(',')})` }
}

const GRANT = /^\s*(grant|revoke)\s+(?:execute|all(?:\s+privileges)?)\s+on\s+(?:function|routine)s?\s+([\s\S]+?)\s+(?:to|from)\s+([\s\S]+?)\s*$/i
const CREATE = /^(\s*)create\s+(or\s+replace\s+)?function\s+/i
const DROP = /^\s*drop\s+(?:function|routine)\s+(?:if\s+exists\s+)?([\s\S]+?)\s*(?:cascade|restrict)?\s*$/i

/** Les rôles d'une liste `to …` ou `from …` (`granted by` et `with grant option` retirés). */
const rolesOf = (list) =>
  splitTopLevel(list.replace(/\s+with\s+grant\s+option\s*$/i, '').replace(/\s+granted\s+by\s+[\s\S]*$/i, '')).map((role) => unquote(role.replace(/^group\s+/i, '')))

/** Les rôles à qui `after` donne `EXECUTE` et que `before` n'avait pas (`public` couvre tous les rôles). */
function gained(before, after) {
  if (before.has('public')) return []
  return [...after].filter((role) => !before.has(role)).sort()
}

/** Le refus : la fonction, les rôles gagnés, et comment élargir le droit quand c'est voulu. */
const widenedText = (key, roles) =>
  `platform.${key} : EXECUTE donné à ${roles.join(', ')}, que la fonction n'avait pas avant ce fichier ; ` +
  'une redéfinition garde le droit de la fonction. Élargissement voulu : un `grant` seul, dans une migration qui ne redéfinit pas la fonction'

/**
 * Le suivi des droits sur l'ensemble des migrations, dans l'ordre. `file(statements, report)` lit les instructions
 * d'un fichier (après `clean` et `splitStatements`) et signale `function-execute-widened` sur la redéfinition d'une
 * fonction qui existait avant le fichier et dont le droit, à la fin du fichier, va à un rôle de plus.
 */
export function executeGrantTracker() {
  const rights = new Map()
  const keysOf = (target) => (target.key ? [target.key] : [...rights.keys()].filter((key) => key.startsWith(`${target.name}(`)))
  /** Les signatures d'une liste de fonctions (`platform.f(…), platform.g(…)`), celles de `platform` seules. */
  const keysIn = (list) => splitTopLevel(list).flatMap((ref) => {
    const target = signatureAt(ref)
    return target ? keysOf(target) : []
  })

  function apply(statement, redefined) {
    const body = statement.body.replace(/^\s*/, '')
    const offset = statement.offset + statement.body.length - body.length
    const create = body.match(CREATE)
    if (create) {
      const target = signatureAt(body.slice(create[0].length))
      if (!target?.key) return
      if (rights.has(target.key)) {
        if (!redefined.has(target.key)) redefined.set(target.key, offset)
        return
      }
      rights.set(target.key, new Set(['public']))
      // Recréée après son `drop` dans ce fichier : jugée ici, contre son droit d'avant le `drop`.
      if (redefined.get(target.key) === null) redefined.set(target.key, offset)
      return
    }
    const drop = body.match(DROP)
    if (drop) {
      for (const key of keysIn(drop[1])) {
        if (!redefined.has(key)) redefined.set(key, null)
        rights.delete(key)
      }
      return
    }
    const grant = body.match(GRANT)
    if (!grant) return
    const add = grant[1].toLowerCase() === 'grant'
    for (const key of keysIn(grant[2])) {
      const roles = rights.get(key) ?? new Set()
      for (const role of rolesOf(grant[3])) {
        if (add) roles.add(role)
        else roles.delete(role)
      }
      rights.set(key, roles)
    }
  }

  return {
    file(statements, report) {
      const before = new Map([...rights].map(([key, roles]) => [key, new Set(roles)]))
      const redefined = new Map()
      for (const statement of statements) apply(statement, redefined)
      for (const [key, offset] of redefined) {
        if (offset === null || !before.has(key) || !rights.has(key)) continue
        const roles = gained(before.get(key), rights.get(key))
        if (roles.length) report(offset, 'function-execute-widened', widenedText(key, roles))
      }
    },
  }
}
