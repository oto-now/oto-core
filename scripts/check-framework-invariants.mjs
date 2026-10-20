#!/usr/bin/env node
/**
 * Deuxième moitié de `check-framework` : ce qui porte sur le CODE et sur l'OUTILLAGE, là où le
 * fichier principal ne vérifie que la cohérence documentaire du framework (tags, globs, skills,
 * sections citées).
 *
 * La séparation n'est pas cosmétique : ces deux blocs répondent à une question différente.
 * « Le framework se décrit-il correctement ? » d'un côté, « ses garanties sont-elles encore
 * branchées ? » de l'autre. Le second est le seul à pouvoir échouer sur un projet dont la
 * documentation est parfaite.
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * @param {{ROOT: string, read: (p: string) => string, walk: (d: string, o?: string[]) => string[],
 *          err: (m: string) => void, warn: (m: string) => void}} ctx
 */
export function verifierInvariants({ ROOT, read, walk, err, warn }) {
  invariantsDeCode({ ROOT, read, walk, err })
  adressesEnAnglais({ ROOT, read, walk, err })
  chaineDApplication({ ROOT, read, err, warn })
}

/** Tables créées par une migration sans que la même migration active la RLS. */
function tablesSansRls(sql) {
  const manquantes = []
  for (const m of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w."]+)/gi)) {
    const table = m[1].replace(/"/g, '').split('.').pop()
    const rls = new RegExp(
      `ALTER\\s+TABLE[^;]*\\b${table}\\b[^;]*ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`,
      'is'
    )
    if (!rls.test(sql)) manquantes.push(table)
  }
  return manquantes
}

// ---------------- invariants de CLAUDE.md que rien ne vérifiait
// Trois règles annoncées comme absolues et laissées au jugement. Elles sont mécanisables :
// les laisser en prose, c'est accepter qu'elles se dégradent sans trace.
function invariantsDeCode({ ROOT, read, walk, err }) {
  // « RLS activée sur toute table » (CLAUDE.md § Invariants techniques)
  const migrations = join(ROOT, 'supabase/migrations')
  if (existsSync(migrations)) {
    for (const f of readdirSync(migrations).filter((f) => f.endsWith('.sql'))) {
      for (const table of tablesSansRls(read(join(migrations, f)))) {
        err(
          `supabase/migrations/${f} : table \`${table}\` créée sans \`ENABLE ROW LEVEL SECURITY\` dans la même migration.`
        )
      }
    }
  }

  // « Deux page.tsx ne doivent jamais résoudre le même chemin » — Next ne le signale pas, il en
  // choisit un en silence. Le template s'y était fait prendre : `/` était servi par un redirect
  // vers une route inexistante, et la page du route group n'était jamais rendue.
  const appDir = join(ROOT, 'src/app')
  if (existsSync(appDir)) {
    const routes = new Map()
    for (const p of walk(appDir).filter((p) => /[\\/]page\.tsx?$/.test(p))) {
      const rel = p.slice(appDir.length + 1)
      const chemin =
        '/' +
        rel
          .replace(/\/?page\.tsx?$/, '')
          .split('/')
          .filter((s) => !/^\(.*\)$/.test(s))
          .join('/')
      if (routes.has(chemin)) {
        err(
          `Deux page.tsx résolvent \`${chemin}\` : ${routes.get(chemin)} et ${rel}. Next n'échoue pas, il en choisit un en silence.`
        )
      } else routes.set(chemin, rel)
    }
  }

  // « Classes sémantiques uniquement, aucune couleur Tailwind numérotée » (CLAUDE.md § Design system)
  // Les écrans du paquet aussi (ADR-008 § 3) : ils tournent dans l'hôte, sur leurs propres tokens.
  const dirsCouleur = [join(ROOT, 'src'), join(ROOT, 'packages', 'plateforme', 'ui')].filter(existsSync)
  {
    const COULEUR =
      /\b(?:bg|text|border|ring|fill|stroke|from|via|to|decoration|outline|divide|shadow|accent|caret|placeholder)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/
    for (const p of dirsCouleur.flatMap((d) => walk(d)).filter((p) => /\.tsx?$/.test(p))) {
      read(p)
        .split('\n')
        .forEach((l, i) => {
          const m = COULEUR.exec(l)
          if (m) {
            err(
              `${p.slice(ROOT.length + 1)}:${i + 1} : couleur Tailwind numérotée \`${m[0]}\` — utiliser une classe sémantique (bg-primary, text-muted-foreground…).`
            )
          }
        })
    }
  }
}

// ------------------------------------------ les adresses sont en anglais (E11-S07)
// « Jamais de français dans une URL » (ADR-020) : une consigne que rien ne gardait, et que chaque nouvelle
// route aurait pu défaire en silence. Deux gardes (HN-E11S07-7) : les segments de route de `src/app` sont
// pris dans une liste fermée (un segment nouveau s'y ajoute, visible en revue) ; les anciens noms français
// d'une adresse (route, préfixe d'API, paramètre, valeur, ancre) sont refusés partout où une adresse s'écrit.

/** Les segments de route admis : anglais (ou neutres), orthographe américaine (`organization`, HN-E11S07-3). */
const SEGMENTS_ADMIS = [
  'admin',
  'api',
  'auth',
  'callback',
  'confirm',
  'connect',
  'connectors',
  'consent',
  'context',
  'feedback',
  'forgot-password',
  'journal',
  'login',
  'logout',
  'mcp',
  'mcp-admin',
  'n',
  'no-organization',
  'oauth',
  'oauth-protected-resource',
  'oidc',
  'organization',
  'p',
  'platform',
  'profile',
  'reset-password',
  'share-image',
  'teams',
  'trash',
  'upload',
  'usage',
  'welcome',
]

const PARAMETRES = {
  onglet: 'tab',
  periode: 'period',
  equipe: 'team',
  personne: 'person',
  erreurs: 'errors',
  curseur: 'cursor',
  appels: 'calls',
  etat: 'state',
  filtre: 'filter',
  tri: 'sort',
  sens: 'order',
  colonne: 'column',
  egal: 'eq',
  contient: 'contains',
  enregistre: 'saved',
  erreur: 'error',
}

const ROUTES = {
  'admin/organisation': '/admin/organization',
  'admin/connecteurs': '/admin/connectors',
  'admin/retours': '/admin/feedback',
  'admin/acces': '/teams (écran retiré, 404)',
  'admin/marque': '/admin/organization (écran retiré, 404)',
  'admin/drapeaux': '/admin/organization (écran retiré, 404)',
  'aucune-organisation': '/no-organization',
  'auth/confirmer': '/auth/confirm',
  equipes: '/teams',
  profil: '/profile',
  corbeille: '/trash',
  plateforme: '/platform',
}

const NOMS_DE_PARAMETRES = Object.keys(PARAMETRES).join('|')

const ANCRES = { nouveautes: '#news', contenus: '#recent-content', regles: 'aucune ancre (HN-E11S07-11)' }

/**
 * Les anciens noms en position d'adresse, et le nom qui les remplace. Une adresse commence par `/` hors d'un
 * chemin de module (précédé d'une lettre, d'un chiffre, de `.`, `-` ou `_`) : `ui/admin/organisation/`,
 * `./admin/organisation/…` et « an organisation » passent.
 */
const ANCIENS_NOMS = [
  [/api\\?\/plateforme(?![\w-])/g, () => '/api/platform'],
  [
    /(?<![\w.-])\\?\/(admin\\?\/(?:organisation|connecteurs|retours|acces|marque|drapeaux)|aucune-organisation|auth\\?\/confirmer|equipes|profil|corbeille|plateforme)(?![\w-])/g,
    (m) => ROUTES[m[1].replaceAll('\\', '')],
  ],
  [/(?<![\w.-])\/(?:[a-z0-9-]+\/)*(?:[a-z0-9]+-)*organisation(?![\w-])/g, () => 'organization, orthographe américaine (HN-E11S07-3)'],
  [new RegExp(`[?&](${NOMS_DE_PARAMETRES})=`, 'g'), (m) => `${m[0][0]}${PARAMETRES[m[1]]}=`],
  // Les autres façons d'écrire un paramètre : `URLSearchParams.set` / `append`, un champ de formulaire GET ou la
  // prop `nom` de `ChoixDuFiltre`, une clé de l'objet passé à `URLSearchParams`.
  [new RegExp(String.raw`\.(?:set|append)\(\s*["'](${NOMS_DE_PARAMETRES})["']`, 'g'), (m) => PARAMETRES[m[1]]],
  [new RegExp(String.raw`\b(?:name|nom)=\{?["'](${NOMS_DE_PARAMETRES})["']`, 'g'), (m) => PARAMETRES[m[1]]],
  [new RegExp(String.raw`URLSearchParams\(\{(?:[^}]*,)?\s*["']?(${NOMS_DE_PARAMETRES})["']?\s*[:,}]`, 'g'), (m) => PARAMETRES[m[1]]],
  [/\bpresence=(vide|rempli)\b/g, (m) => `presence=${m[1] === 'vide' ? 'empty' : 'not_empty'}`],
  [/\bversion=publiee\b/g, () => 'version=published'],
  [/#(nouveautes|contenus|regles)(?![\w-])/g, (m) => ANCRES[m[1]]],
  [/#contexte-([a-z0-9_-]+)/g, (m) => (m[1] === 'tout-le-monde' ? '#everyone-context' : m[1] === 'prive' ? '#private-context' : `#context-${m[1]}`)],
  [/#partie-(\d+)/g, (m) => `#part-${m[1]}`],
]

/** Où une adresse s'écrit ; seuls la garde, son test et la spec d'AC-a1, qui citent les anciens noms, en sont exclus. */
const LIEUX_DES_ADRESSES = ['src', 'packages/plateforme', 'scripts', 'tests', 'next.config.ts']
const CITENT_LES_ANCIENS_NOMS = new Set([
  'scripts/check-framework-invariants.mjs',
  'tests/unit/check-framework.test.ts',
  'tests/e2e/e11s07-adresses.spec.ts',
  'packages/plateforme/CHANGELOG.md',
])
const TEXTE = /\.(?:[cm]?[jt]sx?|json|md|css|snap|sql|html|txt|ya?ml)$/

function adressesEnAnglais({ ROOT, read, walk, err }) {
  // AC-d1 : chaque dossier de route de `src/app`, hors groupes `(…)`, paramètres `[…]`, dossiers privés `_…`, slots
  // `@…` et dossiers en `.` : aucun n'est un segment d'adresse.
  const appDir = join(ROOT, 'src/app')
  if (existsSync(appDir)) {
    const signales = new Set()
    for (const p of walk(appDir)) {
      const rel = p.slice(appDir.length + 1)
      const dossiers = rel.split('/').slice(0, -1)
      dossiers.forEach((segment, rang) => {
        if (/^\(.*\)$/.test(segment) || /^\[.*\]$/.test(segment) || /^[._@]/.test(segment) || SEGMENTS_ADMIS.includes(segment)) return
        const dossier = dossiers.slice(0, rang + 1).join('/')
        if (signales.has(dossier)) return
        signales.add(dossier)
        err(
          `src/app/${rel} : segment de route « ${segment} » absent de SEGMENTS_ADMIS (scripts/check-framework-invariants.mjs) — une adresse est en anglais (ADR-020) ; un segment anglais s'y ajoute.`
        )
      })
    }
  }

  // AC-d2 : aucun ancien nom français en position d'adresse.
  const fichiers = LIEUX_DES_ADRESSES.map((lieu) => join(ROOT, lieu))
    .filter(existsSync)
    .flatMap((p) => (statSync(p).isDirectory() ? walk(p) : [p.replaceAll('\\', '/')]))
  for (const p of fichiers) {
    const rel = p.slice(ROOT.length + 1)
    if (CITENT_LES_ANCIENS_NOMS.has(rel) || !TEXTE.test(rel)) continue
    read(p)
      .split('\n')
      .forEach((ligne, i) => {
        // Un ancien nom que deux motifs reconnaissent (`/admin/organisation`) n'est dit qu'une fois.
        const vus = new Set()
        for (const [motif, nouveau] of ANCIENS_NOMS) {
          for (const m of ligne.matchAll(motif)) {
            if (vus.has(m.index)) continue
            vus.add(m.index)
            err(`${rel}:${i + 1} : ancien nom d'adresse « ${m[0]} » — écrire « ${nouveau(m)} » (adresses en anglais, ADR-020).`)
          }
        }
      })
  }
}

// ------------------------- la chaîne d'application est-elle encore branchée ?
// Jusqu'ici le vérificateur ne contrôlait que la cohérence DOCUMENTAIRE. On pouvait vider
// settings.json de ses hooks, réduire enforce-git-gate.mjs à `process.exit(0)` ou remplacer
// `type-check` par `echo ok` : exit 0 dans les trois cas. Toutes les garanties du framework
// étaient désactivables sans que son propre check bronche.
function chaineDApplication({ ROOT, read, err, warn }) {
  const pkgPath = join(ROOT, 'package.json')
  if (existsSync(pkgPath)) {
    const scripts = JSON.parse(read(pkgPath)).scripts ?? {}
    const ATTENDUS = {
      'check:framework': /node\s+scripts\/check-framework\.mjs/,
      'type-check': /tsc\s+--noEmit/,
      lint: /eslint/,
      test: /vitest/,
      verify: /check:framework.*type-check.*lint.*test.*verify-receipt\.mjs\s+write/s,
    }
    for (const [nom, motif] of Object.entries(ATTENDUS)) {
      if (!scripts[nom]) {
        err(`package.json : script \`${nom}\` absent — \`pnpm verify\` ne peut plus l'enchaîner.`)
      } else if (!motif.test(scripts[nom])) {
        err(`package.json : script \`${nom}\` ne lance plus ce qu'il annonce (« ${scripts[nom]} »).`)
      }
    }
    if (scripts.lint && !/--max-warnings\s+0/.test(scripts.lint)) {
      err(
        "package.json : `lint` sans `--max-warnings 0` — les règles ESLint en `warn` ne bloquent rien, alors que les conventions les annoncent « appliquées par l'outillage »."
      )
    }

    // `verify` confie ses checks à scripts/verify.mjs (M12), et le reçu ne s'écrit que sur son code
    // nul : sorti à 0 sur un check rouge, un `pnpm verify` en échec écrirait le reçu du gate (revue de M12).
    const verifyMjs = join(ROOT, 'scripts/verify.mjs')
    if (!existsSync(verifyMjs)) {
      err('scripts/verify.mjs absent — `pnpm verify` ne lance plus ses checks.')
    } else if (!/process\.exitCode\s*=\s*1\b/.test(read(verifyMjs))) {
      err('scripts/verify.mjs ne pose plus `process.exitCode = 1` — un check en échec y sortirait 0, et `pnpm verify` écrirait le reçu.')
    }
  }

  // Un hook déclaré mais vidé de sa substance est pire qu'un hook absent : il donne l'illusion
  // d'une garantie. On ne valide pas le contenu ligne à ligne, seulement qu'il refuse quelque chose.
  for (const f of ['enforce-git-gate.mjs', 'enforce-bash-rules.mjs']) {
    const p = join(ROOT, '.claude/hooks', f)
    if (!existsSync(p)) {
      err(`.claude/hooks/${f} absent — la garantie qu'il porte n'existe plus.`)
      continue
    }
    if (!/process\.exit\(2\)/.test(read(p))) {
      err(`.claude/hooks/${f} ne contient aucun \`process.exit(2)\` — il ne bloque plus rien.`)
    }
  }

  // Le hook git couvre les commits lancés depuis un script, invisibles au hook PreToolUse.
  const preCommit = join(ROOT, '.githooks/pre-commit')
  if (!existsSync(preCommit)) {
    warn(".githooks/pre-commit absent — un `git commit` lancé depuis un script n'est contrôlé par rien.")
  } else if (!/verify-receipt/.test(read(preCommit))) {
    err('.githooks/pre-commit ne vérifie plus le reçu.')
  }
}
