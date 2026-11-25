// Le JavaScript chargé par toutes les pages d'un build Next (« First Load JS shared by all ») : les fichiers présents
// dans chaque entrée d'app, en octets compressés (gzip, niveau 9). Next 16 n'écrit plus `app-build-manifest.json` ni la
// colonne « First Load JS » : une entrée (page, layout, `loading` de `app/`) se lit dans les `entryJSFiles` des
// `page_client-reference-manifest.js` de `.next/server/app/`, plus les `rootMainFiles` de `build-manifest.json`, que
// toute page charge. Un module client tiré par un fichier du segment racine (layout, `opengraph-image`)
// entre dans toutes les pages, `/login` et le 404 compris : `performance-patterns.md § Bundle Size`.
// Et le JavaScript d'une route entière : la page et ses layouts, où un import serveur du barrel `/ui` met le code client de toute la face (éditeur, zod).
// Usage : `node scripts/ci/shared-first-load-js.mjs [<dossier .next>]` après `pnpm build` ; code 1 au-delà d'un budget.
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { runInNewContext } from "node:vm"
import { gzipSync } from "node:zlib"

/**
 * Le budget, en kB (1 kB = 1000 octets, l'unité de `next build`) : 104 kB en 1.1.6 sous Next 15 ; 144 kB sous Next 16
 * (Turbopack), dont 132 kB de `rootMainFiles` (Next et React) ; la marge pour Next et React.
 */
export const SHARED_JS_BUDGET_KB = 160

/**
 * Les budgets d'une route entière (page, layouts et `loading` de ses segments), en kB. `/login` : 151 kB en 1.1.7
 * (le formulaire et son zod ; 337 kB en 1.1.6), 176 kB sous Next 16 ; `/admin`, qui redirige, pèse la coque du tableau
 * de bord (219 kB en 1.1.7, 322 kB en 1.1.6, 234 kB en 1.9.0), 258 kB sous Next 16. Les clés sont les chemins des
 * entrées sous `app/` pour l'application de référence.
 */
export const ROUTE_BUDGETS_KB = { "/(auth)/login/page": 195, "/(dashboard)/admin/page": 265 }

/** Les clés d'entrée de l'application dans `entryJSFiles`, selon que `app/` est sous `src/` ou non. */
const APP_PREFIXES = ["[project]/src/app/", "[project]/app/"]

/** Les `page_client-reference-manifest.js` de `server/app/`, à toute profondeur. */
function clientReferenceManifests(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return clientReferenceManifests(full)
    return entry.name === "page_client-reference-manifest.js" ? [full] : []
  })
}

/**
 * Chaque route (`/(auth)/login/page`…) et ses entrées d'app (`/layout`, `/(auth)/layout`, la page si elle a du code
 * client), avec leurs fichiers ; et les `rootMainFiles`, que toute page charge. Le manifeste est un script qui remplit
 * `globalThis.__RSC_MANIFEST` : il s'exécute dans un contexte vide, sans accès au processus. Une clé
 * `[project]/…/app/<chemin>` est une entrée de l'application ; celles de `node_modules` (erreur globale de Next) non.
 */
function manifest(nextDir) {
  const { rootMainFiles } = JSON.parse(readFileSync(path.join(nextDir, "build-manifest.json"), "utf8"))
  const routes = {}
  for (const file of clientReferenceManifests(path.join(nextDir, "server/app"))) {
    const context = {}
    runInNewContext(readFileSync(file, "utf8"), context)
    for (const [page, route] of Object.entries(context.__RSC_MANIFEST ?? {})) routes[page] = appEntries(route.entryJSFiles ?? {})
  }
  return { rootMainFiles, routes }
}

/** Les entrées de l'application parmi les `entryJSFiles` d'une route, par chemin sous `app/`. */
function appEntries(entryJSFiles) {
  const entries = {}
  for (const [key, files] of Object.entries(entryJSFiles)) {
    const prefix = APP_PREFIXES.find((candidate) => key.startsWith(candidate))
    if (prefix) entries[`/${key.slice(prefix.length)}`] = files
  }
  return entries
}

function gzipped(nextDir, files) {
  return files.reduce((total, file) => total + gzipSync(readFileSync(path.join(nextDir, file)), { level: 9 }).length, 0)
}

/** Les entrées d'une route : sa page si elle a du code client, les `layout` et `loading` de chaque segment au-dessus. */
function routeEntries(entries, page) {
  const segments = page.split("/").slice(1, -1)
  const chain = entries[page] ? [page] : []
  for (let depth = 0; depth <= segments.length; depth++) {
    const prefix = segments.slice(0, depth).map((segment) => `/${segment}`).join("")
    for (const special of ["layout", "loading"]) if (entries[`${prefix}/${special}`]) chain.push(`${prefix}/${special}`)
  }
  return chain
}

function routeFiles({ rootMainFiles, routes }, page) {
  const entries = routeEntries(routes[page], page)
  return { entries, files: [...new Set([...rootMainFiles, ...entries.flatMap((entry) => routes[page][entry])])] }
}

/**
 * Les fichiers que chargent toutes les routes d'app et leur poids compressé total, en octets. `/_global-error/page`
 * n'entre pas : Next ne la sert que quand le layout racine échoue, et elle ne le rend pas ; comptée, elle retirerait du
 * calcul le layout racine, que ce budget surveille.
 */
export function sharedFirstLoadJs(nextDir) {
  const built = manifest(nextDir)
  const pages = Object.keys(built.routes).filter((page) => page !== "/_global-error/page")
  const lists = pages.map((page) => routeFiles(built, page).files)
  const files = [...new Set(lists.flat())].filter((file) => lists.every((list) => list.includes(file)))
  return { files, bytes: gzipped(nextDir, files) }
}

/** Lève si le JS partagé dépasse le budget ; rend le poids en kB. */
export function assertSharedJsBudget(nextDir, budgetKb = SHARED_JS_BUDGET_KB) {
  const { files, bytes } = sharedFirstLoadJs(nextDir)
  const kb = bytes / 1000
  if (kb > budgetKb) {
    throw new Error(
      `JS partagé par toutes les pages : ${kb.toFixed(1)} kB, budget ${budgetKb} kB (${files.join(", ")}). ` +
        "Un fichier du segment racine tire du code client : performance-patterns.md § Bundle Size.",
    )
  }
  return kb
}

/**
 * Le JS que charge une route (`/(auth)/login/page`) : les `rootMainFiles`, les fichiers `.js` de son entrée et des
 * `layout` et `loading` de chaque segment au-dessus d'elle, comptés une fois ; le CSS n'entre pas.
 */
export function routeFirstLoadJs(nextDir, page) {
  const built = manifest(nextDir)
  if (!built.routes[page]) throw new Error(`${page} absente des manifestes client de server/app.`)
  const { entries, files } = routeFiles(built, page)
  const js = files.filter((file) => file.endsWith(".js"))
  return { entries, files: js, bytes: gzipped(nextDir, js) }
}

/**
 * Lève si une route dépasse son budget ; rend le poids de chacune, en kB.
 * @param {string} nextDir
 * @param {Record<string, number>} [budgets]
 */
export function assertRouteBudgets(nextDir, budgets = ROUTE_BUDGETS_KB) {
  const weights = {}
  for (const [page, budgetKb] of Object.entries(budgets)) {
    const kb = routeFirstLoadJs(nextDir, page).bytes / 1000
    if (kb > budgetKb) {
      throw new Error(
        `JS de la route ${page} (page et layouts) : ${kb.toFixed(1)} kB, budget ${budgetKb} kB. Un import serveur du ` +
          "barrel `@otomata_tech/oto_platform/ui` sans `optimizePackageImports` y met le code client de toute la face : " +
          "performance-patterns.md § Bundle Size.",
      )
    }
    weights[page] = kb
  }
  return weights
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const nextDir = path.resolve(process.argv[2] ?? ".next")
  try {
    const kb = assertSharedJsBudget(nextDir)
    console.log(`shared-first-load-js: ${kb.toFixed(1)} kB (budget ${SHARED_JS_BUDGET_KB} kB).`)
    for (const [page, routeKb] of Object.entries(assertRouteBudgets(nextDir))) {
      console.log(`shared-first-load-js: ${page} ${routeKb.toFixed(1)} kB (budget ${ROUTE_BUDGETS_KB[page]} kB).`)
    }
  } catch (error) {
    console.error(`shared-first-load-js: ${error.message}`)
    process.exitCode = 1
  }
}
