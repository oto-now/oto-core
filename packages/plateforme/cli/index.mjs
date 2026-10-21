/**
 * oto-platform — la ligne de commande du paquet, pour l'application hôte qui l'installe : copie
 * et contrôle des migrations du schéma `platform` (ADR-006), préparation d'une base (ADR-012 § 1),
 * bundle du widget avec les vues de l'ERP (story widgets-dans-la-conversation), secret et réglages d'un
 * compte réel de connecteur (connecteurs-et-comptes), purge du journal et des retours au-delà de la rétention de l'hôte
 * (pseudonymisation), suppression d'une organisation (administration-et-cellule).
 *
 * `run(argv)` rend le code de sortie : 0 succès, 1 copie ou migration refusée, préparation, build ou suppression en
 * échec, 2 usage incorrect. Appelée par `bin.mjs` (le `bin` du paquet) et par les scripts `migrations:sync`
 * et `check:migrations` du dépôt.
 */
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { adminDbUrl } from './admin-url.mjs'
import { checkMigrations } from './migrations-check.mjs'
import { sqlFiles, syncMigrations } from './migrations-sync.mjs'

// Les migrations embarquées, voisines de cli/ dans le paquet installé.
const PACKAGE_MIGRATIONS = fileURLToPath(new URL('../migrations/', import.meta.url))

const USAGE = `Usage : oto-platform migrations <sync|check> [options]
        oto-platform db prepare [--db-url <url>]
        oto-platform widgets build --views <dossier> --out <fichier>
        oto-platform accounts secret [--db-url <url>] --account <id> [--setting nom=valeur …] < champs.json
        oto-platform journal purge [--db-url <url>] [--journal-days <jours>] [--feedback-days <jours>]
        oto-platform org delete [--db-url <url>] --org <slug> [--yes --by <email>] [--without-storage]

  Adresse de la base (db prepare, accounts secret, journal purge, org delete)
    Celle d'un rôle d'administration, lue dans PLATFORM_ADMIN_DATABASE_URL, mot de passe compris ; ou
    --db-url <url> SANS mot de passe, celui-ci dans PGPASSWORD (un argument se lit dans ps et l'historique
    du shell). --db-url à mot de passe (admin:…@, vide compris, ou ?password=) : refusé. Les deux, ou
    aucune : refusé. TLS exigé, sauf sslmode écrit dans l'URL (?sslmode=disable pour un Postgres local
    sans TLS).

  migrations sync [--from <dossier>] [--to <dossier>]
    Copie les migrations du paquet dans celles de l'application hôte. Une copie qui diffère
    n'est jamais écrasée : rien n'est écrit et le code de sortie vaut 1.
    --from  migrations à copier (défaut : celles du paquet)
    --to    migrations de l'hôte (défaut : supabase/migrations du répertoire courant)

  migrations check [--file <fichier.sql>]
    Contrôle que le SQL ne touche que le schéma platform et ne fait qu'ajouter, que toute
    fonction créée dans platform retire l'exécution à public dans le même fichier
    (revoke execute … from public ; fonctions de déclencheur exceptées), et qu'il reste portable :
    aucune clé vers auth.users, aucune lecture de auth.users (fonction, vue, requête, bloc) hors
    des trois fonctions propres à Supabase, aucune extension hors de pg_trgm, unaccent et ltree ;
    et qu'une fonction redéfinie ne donne l'exécution à aucun rôle de plus qu'avant le fichier.
    --file  un fichier seul (défaut : les migrations du paquet)

  db prepare [--db-url <url>]
    Prépare une base avant les migrations, une fois ; un second passage ne change rien. Sur un
    Postgres sans Supabase : rôles anon et authenticated, schéma auth (uid, jwt, role), schéma
    extensions avec pg_trgm, unaccent et ltree. Partout : le rôle platform_app (connexion du
    serveur, membre d'anon et d'authenticated), son mot de passe lu dans PLATFORM_APP_PASSWORD.
    --db-url  adresse de la base sans mot de passe (Adresse de la base, ci-dessus)

  widgets build --views <dossier> --out <fichier>
    Construit le bundle du widget de la conversation : les vues du paquet et les vues de l'ERP,
    un fichier .tsx par vue (devis.tsx : la vue devis de defineErpFunction). Écrit un module qui
    exporte WIDGET_BUNDLE, à passer à registerWidgetViews avant registerFunctions. Demande, en
    devDependencies de l'hôte : vite, @vitejs/plugin-react, vite-plugin-singlefile,
    @tailwindcss/postcss, tailwindcss et @modelcontextprotocol/ext-apps.
    --views  dossier des vues de l'ERP
    --out    module TypeScript à écrire (ex. src/lib/widgets.generated.ts)

  accounts secret [--db-url <url>] --account <id> [--setting nom=valeur …]
    Pose le secret et les réglages d'un compte réel de connecteur. Les champs du secret se lisent
    sur l'entrée standard, en objet JSON ({"api_key": "…"}), jamais en argument ; une saisie
    fusionne avec ce qui est posé (champ absent gardé, null ou vide effacé). Chiffré par la clé
    PLATFORM_VAULT_KEY de l'environnement (32 octets en base64, la même que celle du serveur de
    l'application), puis écrit dans la base ; rien du secret ni de la clé n'est affiché. Refusé
    pour un compte inconnu ou simulé. Noms et valeurs contrôlés contre la déclaration à l'appel.
    --db-url   adresse de la base sans mot de passe (Adresse de la base, ci-dessus)
    --account  identifiant (uuid) du compte
    --setting  un réglage non secret, nom=valeur (nom= l'efface) ; répétable

  journal purge [--db-url <url>] [--journal-days <jours>] [--feedback-days <jours>]
    Retire, pour toutes les organisations, les lignes du journal des appels et du journal de l'équipe
    plateforme plus anciennes que --journal-days, et les retours (feedback) plus anciens que
    --feedback-days ; une table sans durée reste telle quelle. À lancer par la tâche planifiée de
    l'hôte. Rend le nombre de lignes retirées.
    --db-url         adresse de la base sans mot de passe (Adresse de la base, ci-dessus)
    --journal-days   rétention du journal, en jours (1 à 36 500)
    --feedback-days  rétention des retours, en jours (1 à 36 500)

  org delete [--db-url <url>] --org <slug> [--yes --by <email>] [--without-storage]
    Supprime une organisation : toutes ses lignes de platform, et ses objets du stockage (sous <org_id>/).
    Sans --yes, compte ce qui serait supprimé, table par table, et n'écrit rien. Avec --yes : le stockage
    d'abord, puis la base en une transaction ; les lignes de l'organisation dans le journal de l'équipe
    plateforme restent, arguments, cible, erreur et code de session vidés, et une ligne « organisation
    supprimée » s'y ajoute au nom de --by. Relancée après un échec, elle reprend ; après une suppression
    complète, elle dit « déjà supprimée » et repasse sur le stockage. Le stockage se lit dans
    PLATFORM_STORAGE_ENDPOINT, _BUCKET, _REGION, _ACCESS_KEY_ID et _SECRET_ACCESS_KEY.
    --db-url           adresse de la base sans mot de passe (Adresse de la base, ci-dessus)
    --org              slug de l'organisation
    --yes              supprime (sans lui, rien n'est écrit)
    --by               email d'un membre de l'équipe plateforme (platform_staff), au nom de qui supprimer ;
                       exigé avec --yes
    --without-storage  hôte sans stockage ; refusé si les variables sont posées ou si l'organisation
                       porte un fichier joint

  -h, --help  cette aide

Codes de sortie : 0 succès, 1 copie, migration, préparation, build, secret, purge ou suppression refusé, 2 usage incorrect
(adresse de la base refusée comprise).`

const OPTIONS = {
  from: { type: 'string' },
  to: { type: 'string' },
  file: { type: 'string' },
  'db-url': { type: 'string' },
  views: { type: 'string' },
  out: { type: 'string' },
  account: { type: 'string' },
  setting: { type: 'string', multiple: true },
  'journal-days': { type: 'string' },
  'feedback-days': { type: 'string' },
  org: { type: 'string' },
  by: { type: 'string' },
  yes: { type: 'boolean' },
  'without-storage': { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
}
// Options de chaque sous-commande : celle d'une autre y est une option inconnue.
const COMMANDS = {
  migrations: { sync: ['from', 'to'], check: ['file'] },
  db: { prepare: ['db-url'] },
  widgets: { build: ['views', 'out'] },
  accounts: { secret: ['db-url', 'account', 'setting'] },
  journal: { purge: ['db-url', 'journal-days', 'feedback-days'] },
  org: { delete: ['db-url', 'org', 'by', 'yes', 'without-storage'] },
}

/** Usage incorrect : le problème nommé sur stderr, puis l'usage, code 2. */
class UsageError extends Error {}

/** Nomme l'option en cause d'une erreur de `parseArgs`, dont le message est en anglais. */
function usageErrorOf(error) {
  if (error.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION') {
    const option = error.message.match(/'(-[^'\s]*)'/)?.[1]
    return new UsageError(option ? `option inconnue « ${option} »` : 'option inconnue')
  }
  if (error.code === 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE') {
    const option = error.message.match(/--[\w-]+/)?.[0]
    if (!option) return new UsageError('option sans valeur')
    const takesNoValue = OPTIONS[option.slice(2)]?.type === 'boolean'
    return new UsageError(takesNoValue ? `l'option « ${option} » ne prend pas de valeur` : `l'option « ${option} » attend une valeur`)
  }
  return error
}

function parse(argv, env) {
  let parsed
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, strict: true, allowPositionals: true })
  } catch (error) {
    throw usageErrorOf(error)
  }
  const { values, positionals } = parsed
  if (values.help) return { help: true }
  const [command, subcommand, extra] = positionals
  if (!command) throw new UsageError('commande manquante')
  if (!Object.hasOwn(COMMANDS, command)) throw new UsageError(`commande inconnue « ${command} »`)
  const subcommands = COMMANDS[command]
  const names = Object.keys(subcommands).join(' ou ')
  if (!subcommand) throw new UsageError(`sous-commande manquante après « ${command} » (${names})`)
  if (!Object.hasOwn(subcommands, subcommand)) throw new UsageError(`sous-commande inconnue « ${subcommand} »`)
  if (extra !== undefined) throw new UsageError(`argument en trop « ${extra} »`)
  for (const [name, value] of Object.entries(values)) {
    if (!subcommands[subcommand].includes(name)) throw new UsageError(`option « --${name} » inconnue de « ${command} ${subcommand} »`)
    if (value === '') throw new UsageError(`l'option « --${name} » attend une valeur`)
  }
  if (command === 'accounts' && !values.account) throw new UsageError('« accounts secret » attend --account <id>')
  if (command === 'org' && !values.org) throw new UsageError('« org delete » attend --org <slug>')
  if (command === 'org' && values.yes && !values.by) throw new UsageError('« org delete --yes » attend --by <email>')
  if (command === 'widgets' && (!values.views || !values.out)) throw new UsageError('« widgets build » attend --views <dossier> et --out <fichier>')
  // Une commande à connexion d'administration : celle qui admet --db-url (`admin-url.mjs`).
  if (!subcommands[subcommand].includes('db-url')) return { command, subcommand, ...values }
  const address = adminDbUrl({ flag: values['db-url'], env })
  if ('problem' in address) throw new UsageError(`« ${command} ${subcommand} » : ${address.problem}`)
  return { command, subcommand, ...values, dbUrl: address.url }
}

export async function run(argv) {
  let options
  try {
    options = parse(argv, process.env)
  } catch (error) {
    if (!(error instanceof UsageError)) throw error
    console.error(`oto-platform : ${error.message}\n\n${USAGE}`)
    return 2
  }
  if (options.help) {
    console.log(USAGE)
    return 0
  }
  if (options.command === 'db') {
    // Chargé à la demande : le pilote Postgres ne sert qu'ici, pas à la copie ni au contrôle.
    const { prepareDatabase } = await import('./db-prepare.mjs')
    return prepareDatabase({
      dbUrl: options.dbUrl,
      password: process.env.PLATFORM_APP_PASSWORD,
      print: (line) => console.log(line),
      printError: (line) => console.error(line),
    })
  }
  if (options.command === 'accounts') {
    // Chargé à la demande, comme `db prepare` : le pilote Postgres ne sert qu'ici.
    const { readStdin, setAccountSecretCommand } = await import('./account-secret.mjs')
    return setAccountSecretCommand({
      dbUrl: options.dbUrl,
      account: options.account,
      settings: options.setting ?? [],
      env: process.env,
      readSecret: () => readStdin(),
      print: (line) => console.log(line),
      printError: (line) => console.error(line),
    })
  }
  if (options.command === 'journal') {
    // Chargé à la demande, comme `db prepare` : le pilote Postgres ne sert qu'ici.
    const { purgeCommand } = await import('./purge.mjs')
    return purgeCommand({
      dbUrl: options.dbUrl,
      journalDays: options['journal-days'],
      feedbackDays: options['feedback-days'],
      print: (line) => console.log(line),
      printError: (line) => console.error(line),
    })
  }
  if (options.command === 'org') {
    // Chargé à la demande, comme `db prepare` : le pilote Postgres et le client du stockage ne servent qu'ici.
    const { orgDeleteCommand } = await import('./org-delete.mjs')
    return orgDeleteCommand({
      dbUrl: options.dbUrl,
      org: options.org,
      by: options.by,
      yes: options.yes === true,
      withoutStorage: options['without-storage'] === true,
      env: process.env,
      print: (line) => console.log(line),
      printError: (line) => console.error(line),
    })
  }
  if (options.command === 'widgets') {
    const { buildWidgets } = await import('./widgets.mjs')
    return buildWidgets({ views: options.views, out: options.out, print: (line) => console.log(line), printError: (line) => console.error(line) })
  }
  if (options.subcommand === 'sync') {
    return syncMigrations({ from: options.from ?? PACKAGE_MIGRATIONS, to: options.to ?? 'supabase/migrations' })
  }
  const files = options.file ? [options.file] : sqlFiles(PACKAGE_MIGRATIONS).map((file) => join(PACKAGE_MIGRATIONS, file))
  return checkMigrations({ files })
}
