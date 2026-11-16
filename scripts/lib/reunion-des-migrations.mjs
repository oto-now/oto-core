// La réunion des migrations d'une version (database-patterns.md § Règles, fiche D124) : avant le tag `vX.Y.Z`, les
// fichiers ajoutés depuis le tag précédent deviennent un seul `<horodatage>_vX_Y_Z.sql`, concaténé dans l'ordre des
// horodatages, chaque partie sous une bannière qui nomme son fichier d'origine, sans une ligne changée. Les mentions
// de retrait des parties (`-- retrait: … ; plus lu depuis vX.Y.Z`) sont recopiées dans l'en-tête du fichier réuni :
// `oto-platform migrations check` ne lit une mention qu'avant la première instruction, et celle d'une partie qui suit
// la première tombe dans le corps. Sans la copie, ses opérations deviendraient `retrait-uncovered`.
import { retraitMentions } from '../../packages/plateforme/cli/migrations-retrait.mjs'

const RULE = '-- ' + '='.repeat(100)
const PART = /^\d{14}_[a-z0-9_]+\.sql$/
const VERSION = /^\d+\.\d+\.\d+$/

/** Le fichier réuni de la version `version` (`X.Y.Z`) à partir de ses parties `{ name, sql }` ; lève sur une entrée invalide. */
export function reunirMigrations({ version, parts }) {
  if (!VERSION.test(version ?? '')) throw new Error(`version « ${version} » : attendu X.Y.Z`)
  if (!parts.length) throw new Error('aucune migration à réunir')
  for (const { name } of parts) if (!PART.test(name)) throw new Error(`« ${name} » : attendu <horodatage>_<sujet>.sql`)
  const names = parts.map((part) => part.name)
  if (new Set(names).size !== names.length) throw new Error('une migration nommée deux fois')
  const ordered = [...parts].sort((a, b) => (a.name < b.name ? -1 : 1))
  const mentions = ordered.flatMap((part) => retraitMentions(part.sql).map((mention) => mention.text.trim()))
  const header = [
    `-- Version ${version} du paquet (un seul fichier de migration par version publiée, database-patterns.md § Règles) :`,
    `-- ${ordered.length === 1 ? 'la migration ajoutée' : `les ${ordered.length} migrations ajoutées`} depuis la version précédente, réunies au contenu identique, dans l'ordre`,
    "-- de leurs horodatages, chacune précédée d'une bannière qui nomme son fichier d'origine. Aucune ligne n'est changée.",
    ...(mentions.length
      ? [
          "-- Les mentions de retrait des parties, recopiées : le contrôle ne lit une mention que dans l'en-tête du fichier",
          '-- (database-patterns.md § Expand/contract sur base partagée).',
          ...mentions,
        ]
      : []),
  ]
  const body = ordered.map(({ name, sql }, k) =>
    [RULE, `-- Partie ${k + 1} sur ${ordered.length} : écrite en ${name}.`, RULE, '', sql.endsWith('\n') ? sql : `${sql}\n`].join('\n'),
  )
  return `${header.join('\n')}\n\n${body.join('\n')}`
}
