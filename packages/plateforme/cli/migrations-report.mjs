/**
 * La sortie de `migrations check`. Texte (le défaut) : `fichier:ligne règle — explication` par erreur sur stdout, puis
 * le compte. JSON (`--json`) : un seul objet sur stdout, rien d'autre, `{ ok, files: [{ file, retraits, errors }],
 * requires }`, où `requires` est la plus haute version déclarée par une mention de retrait (`null` sans aucune).
 */
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { highestVersion } from './migrations-retrait.mjs'

/** Chemin affiché : relatif au répertoire courant quand le fichier y est, absolu sinon. */
function shown(file) {
  const absolute = resolve(file)
  const rel = relative(process.cwd(), absolute)
  const outside = rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)
  return outside ? absolute : rel.split(sep).join('/')
}

/** Écrit le résultat de chaque fichier (`{ file, mentions, errors }`) ; rend le code de sortie, 1 à la moindre erreur. */
export function printResults(results, { json }) {
  const failures = results.reduce((count, result) => count + result.errors.length, 0)
  if (json) {
    const files = results.map(({ file, mentions, errors }) => ({
      file: shown(file),
      retraits: mentions.filter((mention) => mention.since).map(({ line, objects, since }) => ({ line, objects, since })),
      errors: errors.map(({ line, rule, detail }) => ({ line, rule, detail: detail ?? null })),
    }))
    const requires = highestVersion(files.flatMap((file) => file.retraits.map((retrait) => retrait.since)))
    console.log(JSON.stringify({ ok: failures === 0, files, requires }, null, 2))
    return failures ? 1 : 0
  }
  for (const { file, errors } of results) {
    for (const { line, rule, detail } of errors) console.log(`${shown(file)}:${line} ${rule}${detail ? ` — ${detail}` : ''}`)
  }
  if (failures) {
    console.error(`check:migrations — ${failures} erreur(s)`)
    return 1
  }
  console.log(`check:migrations — ${results.length} fichier(s) conforme(s)`)
  return 0
}
