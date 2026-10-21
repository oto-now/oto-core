#!/usr/bin/env node
/**
 * Construit le bundle du widget routeur (story widgets-dans-la-conversation) : un HTML en un fichier (Vite,
 * `vite-plugin-singlefile`, JS, CSS et polices inlinés, aucune requête externe), servi en mémoire par le serveur
 * (`mcp/widget-meta.ts`), sans lecture de fichier à l'exécution.
 *
 * Deux usages :
 * - le bundle du paquet, sans vue de l'ERP, dans `mcp/widgets/generated.ts` (non suivi par git) : ce script lancé
 *   seul, avant `type-check` (s'il manque, ce qui sert aussi `verify`), `build`, le job `bare-postgres` et `npm pack`
 *   (`prepack` du paquet), qui le livre ; `--if-missing` ne reconstruit pas un module déjà présent ;
 * - le bundle d'un hôte, vues du paquet et vues de l'ERP, par `buildHostBundle` (`oto-platform widgets build`).
 *
 * Lancé seul, il construit aussi le script du worker des lecteurs de fichiers (`server/files/readers/worker/`) : son
 * point d'entrée et ce qu'il importe, `fflate` compris, en un script CommonJS rangé en texte dans `generated.ts` (non
 * suivi par git), que le serveur lance par `eval` : un worker chargé d'un fichier ne se résout pas dans le bundle d'un
 * hôte Next (webpack réécrit son chemin vers `/_next/…`, et un build `standalone` ne le trace pas). Le module porte
 * l'empreinte de ses sources, qu'un test compare : un script périmé ne passe pas. `--if-missing` le reconstruit aussi
 * quand une source est plus récente que lui.
 *
 * Vite, ses plugins, Tailwind et `ext-apps` se chargent à la demande : un hôte sans vue de l'ERP ne les installe pas.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'

const ROOT = dirname(fileURLToPath(import.meta.url))
const PACKAGE_TARGET = join(ROOT, '..', 'mcp', 'widgets', 'generated.ts')
const PACKAGE_ROOT = join(ROOT, '..')
const READERS = join(PACKAGE_ROOT, 'server', 'files', 'readers')
const WORKER_ENTRY = join(READERS, 'worker', 'entry.ts')
const WORKER_TARGET = join(READERS, 'worker', 'generated.ts')
const STYLES = join(ROOT, 'styles.css')
const VIEWS_MODULE = 'virtual:oto-erp-views'
// La barre oblique inverse, composée : le module généré n'écrit que de l'ASCII (CLAUDE.md, modifications documentaires).
const SLASH = String.fromCharCode(92)

/** Ce qu'un hôte installe pour construire ses vues (dépendances paires facultatives du paquet). */
const BUILD_PACKAGES = ['vite', '@vitejs/plugin-react', 'vite-plugin-singlefile', '@tailwindcss/postcss', 'tailwindcss', '@modelcontextprotocol/ext-apps']

/** Le littéral JS d'un texte, en ASCII seul : tout code UTF-16 au-delà de `~` s'écrit par son échappement. */
function asciiLiteral(text) {
  const json = JSON.stringify(text)
  let out = ''
  for (let i = 0; i < json.length; i += 1) {
    const unit = json.charCodeAt(i)
    out += unit > 126 ? `${SLASH}u${unit.toString(16).padStart(4, '0')}` : json[i]
  }
  return out
}

/** Les outils de build, chargés à la demande ; absents, l'erreur nomme les paquets à installer. */
async function buildTools() {
  try {
    const [{ build }, { default: react }, { viteSingleFile }, { default: tailwind }] = await Promise.all([
      import('vite'),
      import('@vitejs/plugin-react'),
      import('vite-plugin-singlefile'),
      import('@tailwindcss/postcss'),
    ])
    // Le SDK du pont n'est lu que par Vite, dans le bundle : sa résolution se vérifie ici, avec les autres.
    import.meta.resolve('@modelcontextprotocol/ext-apps/app-with-deps')
    return { build, react, viteSingleFile, tailwind }
  } catch (error) {
    if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error
    throw new Error(`outils de build absents : installer en devDependencies ${BUILD_PACKAGES.join(', ')}`)
  }
}

/**
 * Les vues de l'ERP (`virtual:oto-erp-views`, nom → fichier absolu) et les dossiers que Tailwind lit en plus pour leurs
 * classes, ajoutés à la feuille du widget.
 */
function erpViewsPlugin(views, sources) {
  return {
    name: 'oto-erp-views',
    enforce: 'pre',
    resolveId: (id) => (id === VIEWS_MODULE ? `\0${VIEWS_MODULE}` : null),
    load(id) {
      if (id === `\0${VIEWS_MODULE}`) {
        const entries = Object.entries(views)
        const imports = entries.map(([, file], index) => `import V${index} from ${JSON.stringify(file)}`)
        const map = entries.map(([name], index) => `${JSON.stringify(name)}: V${index}`).join(', ')
        return `${imports.join('\n')}\nexport default { ${map} }\n`
      }
      // Barres obliques : sous Windows, Tailwind ne lit pas un `@source` au séparateur du système, et les classes des
      // vues de l'hôte manqueraient au bundle.
      // L'identifiant d'un module porte des barres obliques sur tout système : le chemin du fichier s'y compare ainsi.
      if (id.split(sep).join('/') === STYLES.split(sep).join('/') && sources.length > 0) {
        return `${readFileSync(STYLES, 'utf8')}\n${sources.map((source) => `@source ${JSON.stringify(source.split(sep).join('/'))};`).join('\n')}\n`
      }
      return null
    },
  }
}

/** Le HTML du bundle : vues du paquet, et `views` de l'ERP (nom → fichier `.tsx` absolu). */
async function buildWidgetHtml({ views = {}, sources = [] } = {}) {
  const { build, react, viteSingleFile, tailwind } = await buildTools()
  const output = await build({
    root: ROOT,
    configFile: false,
    logLevel: 'warn',
    plugins: [erpViewsPlugin(views, sources), react(), viteSingleFile()],
    resolve: {
      // Mermaid hors du bundle : son chargement échoue, le diagramme reste en texte (`mermaid-absent.ts`).
      alias: [{ find: /^mermaid$/, replacement: join(ROOT, 'mermaid-absent.ts') }],
      // Les vues de l'hôte et celles du paquet partagent le même React.
      dedupe: ['react', 'react-dom'],
    },
    css: { postcss: { plugins: [tailwind()] } },
    build: { write: false, reportCompressedSize: false, chunkSizeWarningLimit: 4096 },
  })
  const outputs = (Array.isArray(output) ? output : [output]).flatMap((one) => one.output ?? [])
  const page = outputs.find((one) => one.fileName === 'index.html')
  if (!page || typeof page.source !== 'string') throw new Error('index.html absent de la sortie de Vite')
  return page.source
}

const kb = (bytes) => `${Math.round(bytes / 1024)} Ko`
const sizes = (html) => `${kb(Buffer.byteLength(html))} (gzip ${kb(gzipSync(html).length)})`

/** Le bundle d'un hôte (`oto-platform widgets build`) : `views` nom → fichier, écrit dans `out` (`WIDGET_BUNDLE`). */
export async function buildHostBundle({ views, out }) {
  const html = await buildWidgetHtml({ views, sources: [...new Set(Object.values(views).map((file) => dirname(file)))] })
  const target = resolve(out)
  mkdirSync(dirname(target), { recursive: true })
  const header = '// Généré par oto-platform widgets build : ne pas modifier ; à passer à registerWidgetViews avant registerFunctions.\n'
  writeFileSync(target, `${header}export const WIDGET_BUNDLE = { html: ${asciiLiteral(html)}, views: ${JSON.stringify(Object.keys(views))} }\n`)
  return { target, sizes: sizes(html) }
}

async function buildPackageBundle() {
  if (process.argv.includes('--if-missing') && existsSync(PACKAGE_TARGET)) return
  const html = await buildWidgetHtml()
  mkdirSync(dirname(PACKAGE_TARGET), { recursive: true })
  const header = '// Généré par packages/plateforme/widgets/build.mjs : ne pas modifier, ne pas commiter.\n'
  writeFileSync(PACKAGE_TARGET, `${header}export const VIEW_HTML = ${asciiLiteral(html)}\n`)
  console.log(`widgets : ${sizes(html)} dans mcp/widgets/generated.ts`)
}

/**
 * L'empreinte des sources du worker : chemin relatif au paquet et contenu de chaque fichier, dans l'ordre des chemins.
 * Exportée pour le test qui compare le module généré à ses sources.
 */
export function workerDigest(files) {
  const hash = createHash('sha256')
  for (const file of [...files].sort()) hash.update(`${file}\0${readFileSync(join(PACKAGE_ROOT, file), 'utf8')}\0`)
  return hash.digest('hex')
}

/** Les sources TypeScript des lecteurs : une plus récente que le module généré le rend périmé. */
function readerSources(dir = READERS) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return readerSources(path)
    return entry.name.endsWith('.ts') && path !== WORKER_TARGET ? [path] : []
  })
}

async function buildReaderWorker() {
  if (process.argv.includes('--if-missing') && existsSync(WORKER_TARGET)) {
    const built = statSync(WORKER_TARGET).mtimeMs
    if (readerSources().every((file) => statSync(file).mtimeMs <= built)) return
  }
  const { build } = await import('vite')
  const output = await build({
    root: PACKAGE_ROOT,
    configFile: false,
    logLevel: 'warn',
    // Tout dans le script, `fflate` compris : le worker n'a pas de `node_modules` à lui chez l'hôte.
    ssr: { noExternal: true, target: 'node' },
    build: {
      ssr: WORKER_ENTRY,
      write: false,
      minify: false,
      target: 'node20',
      reportCompressedSize: false,
      rollupOptions: { output: { format: 'cjs', inlineDynamicImports: true } },
    },
  })
  const chunks = (Array.isArray(output) ? output : [output]).flatMap((one) => one.output ?? []).filter((one) => one.type === 'chunk')
  if (chunks.length !== 1) throw new Error(`worker des lecteurs : ${chunks.length} morceaux au lieu d'un`)
  const [chunk] = chunks
  // Les sources du paquet assemblées dans le script, par leur chemin dans le paquet, barres obliques sur tout système :
  // sous Windows, Vite rend ses identifiants en barres obliques, la racine du paquet en barres inverses.
  const root = `${PACKAGE_ROOT.split(sep).join('/')}/`
  const files = chunk.moduleIds
    .map((id) => id.split(sep).join('/'))
    .filter((id) => id.startsWith(root) && !id.includes('/node_modules/'))
    .map((id) => id.slice(root.length))
  const header = '// Généré par packages/plateforme/widgets/build.mjs : ne pas modifier, ne pas commiter.\n'
  const inputs = `export const READER_WORKER_INPUTS = { files: ${JSON.stringify(files.sort())}, digest: ${JSON.stringify(workerDigest(files))} }\n`
  writeFileSync(WORKER_TARGET, `${header}${inputs}export const READER_WORKER_SOURCE = ${asciiLiteral(chunk.code)}\n`)
  console.log(`worker des lecteurs : ${kb(Buffer.byteLength(chunk.code))}, ${files.length} sources, dans server/files/readers/worker/generated.ts`)
}

// Lancé seul (`node widgets/build.mjs`) : le bundle du paquet et le worker des lecteurs ; importé par la CLI, rien ne
// court.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await buildPackageBundle()
    await buildReaderWorker()
  } catch (error) {
    console.error(`widgets : build en échec : ${error?.message ?? error}`)
    process.exitCode = 1
  }
}
