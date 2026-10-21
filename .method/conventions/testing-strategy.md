# Stratégie de Tests — Next.js + Supabase

## Setup

- `vitest.config.ts` avec `@vitejs/plugin-react`, resolve alias `@/`
- `@testing-library/react` + `@testing-library/jest-dom`
- Playwright installé avec `npx playwright install`

## Unit Tests (Vitest)

- **Quoi :** Server Actions (mock Supabase), Zod schemas (edge cases), hooks custom, utils
- **Où :** `tests/unit/`. La colocalisation (`fichier.test.ts` à côté du code) est tolérée par
  `vitest.config.ts` mais **ne doit pas être utilisée** : un fichier de test placé sous `src/`
  matche en plus les globs `registry`, `a11y` et `nextjs`, donc charge des conventions qui ne le
  concernent pas ; et l'exemption `max-lines` d'`eslint.config.mjs` ne couvre que `tests/**`.
- **Mock Supabase :** `vi.mock("@/lib/supabase/server")` → retourner des réponses fake
- **Couverture cible :** >80% sur `lib/actions/` et `lib/schemas/`

### Exemple mock Supabase

```typescript
import { vi } from "vitest"

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn(() => ({
        data: { user: { id: "test-user-id", email: "test@test.com" } },
      })),
    },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn(() => ({ data: { id: 1 }, error: null })),
    })),
  })),
}))
```

## Integration Tests (Vitest + Testing Library)

- **Quoi :** Composants form complets (render → fill → submit → vérifier résultat)
- **Mock :** Supabase client mocké, Server Actions mockées pour les tests composants
- **Où :** `tests/integration/`

## E2E Tests (Playwright)

- **Quoi :** Parcours critiques uniquement (login, CRUD principal, parcours de valeur core)
- **Env :** Supabase local (`npx supabase start`) ou projet staging dédié
- **Seed :** Script de seed pour données de test reproductibles
- **Où :** `tests/e2e/`
- **Convention :** un fichier par feature (`auth.spec.ts`, `projects.spec.ts`)

## Non-régression

- Avant chaque merge : TOUS les tests existants doivent passer
- `/commit-push` exécute `pnpm test` (unit + integ) avant chaque push
- E2E : avant chaque mise en prod (pas sur chaque push)
- **Une fonction SQL re-versionnée se prouve sur toutes les suites qui l'appellent**, pas seulement
  sur les tests que la story réécrit. Le rayon d'impact liste ces fichiers (`rg -l "<fonction>" tests`),
  et le rapport montre chacun rejoué contre la nouvelle version : sur la base visée, ou, pour une
  suite Supabase qu'une migration encore locale ne permet pas de jouer, par une copie de l'ancienne
  fonction en `pg_temp` comparée à la nouvelle sur les mêmes requêtes. **Vérifiable :** en revue, la
  liste `rg` du rayon d'impact et le résultat de chaque fichier.

## Budget de tests : le minimum vital

Une suite plus longue n'est pas une suite plus sûre, et chaque test sur la vraie base coûte du
temps à chaque passage et de la charge à la base de test partagée.

- **Un test par critère d'acceptation**, pas un par permutation (rôle × niveau × cas) : le cas
  qui prouve la règle, plus sa frontière si elle est le risque.
- **Toujours testés** : l'isolation entre organisations et les droits ; le contrat MCP figé
  (outils, schémas, textes servis) ; les invariants qui restent en base (atomicité,
  déclencheurs de garde) ; le gate de commit.
- **Sur la vraie base quand la base est le sujet** (policy d'isolation, fonction SQL,
  déclencheur) ou qu'un service la lit par sa face SQL ; ailleurs, une base simulée
  (`security-patterns.md § Droits dans le service`).
- **Jamais deux tests pour la même règle** (un unitaire et un d'intégration qui disent la même
  chose : on garde le plus rapide qui la prouve).
- **Un script d'outillage : un test de fumée**, pas une suite de bout en bout.
- **Un test sur base réelle** part des fixtures `*-sql.ts` (`seedReferenceOrg`, `seedTableFixture`, `seedAdminFixture`, `seedAcme`) : une graine par fichier en `beforeAll`, les lignes propres à un test par `write`, `addRules` ou `addNodes`, l'attendu écrit en identifiants simulés et comparé par `readable` ; jamais une seconde description des données. Un refus sans requête, une course et une panne injectée se prouvent par l'espion `spyDb` de `tests/helpers/sql.ts` ; les espions plus anciens (`recordDb`, `spyRequests`, `dbSpy`, `watchDb`, ceux de `spy-tables.ts` et des `spy-t1-*.ts`) restent dans leurs fichiers, et un test nouveau prend `spyDb`. Chaque branche du service reste atteinte : quand la base réelle refuse plus tôt (déclencheur, contrainte), un sous-cas force le chemin d'origine par le crochet de l'espion. **Vérifiable :** la mutation de la branche, nommée en post-implémentation, fait échouer le test.
- **Textes comparés à l'octet** : seulement les textes figés du contrat.

**Vérifiable en revue :** un test qui ne prouve ni un critère d'acceptation, ni la sécurité, ni le
contrat, ni un invariant de base est un défaut à retirer ; une revue ne demande jamais une
permutation de plus sans nommer la faille qu'elle révélerait.

## Base de test

- **Données jetables, préfixées, nettoyées** : un test crée ses organisations et ses personnes avec un
  préfixe reconnaissable (`t<hex>`, `test-<hex>@example.invalid`) et les retire à la fin de son
  passage ; deux passages peuvent tourner en même temps sur la même base. Un passage interrompu
  laisse les siennes : `pnpm test:cleanup` compte celles de plus de 2 h, `--delete` les supprime.
- **Contrôles visuels connectés** : chaque campagne Playwright crée une organisation jetable
  `t<hex>` servie à `t<hex>.localhost` (`tests/e2e/fixtures/campagne.ts`, `globalSetup`), semée par
  `scripts/demo-seed.mjs --slug` pour le compte `E2E_USER_EMAIL`, supprimée en fin de campagne, même en échec ;
  `pnpm test:cleanup --delete` rattrape une campagne interrompue. Démo n'est plus semée pour les tests.
  Une spec ne lit jamais une adresse jetable par `page.request` (Node ne résout pas `*.localhost`) : elle
  passe par `fetch` dans la page (`lireLeHtml`, `tests/e2e/fixtures/espace.ts`).
- **Démo n'est jamais vidée par un script écrit à la main** : ses lignes se retirent table par table
  d'après `docs/reference/schema-platform.md` (un nom trompe : `org_domains` porte les adresses qui servent
  l'organisation, pas ses domaines de travail), après un `pnpm org:export`, et l'adresse de Démo répond
  encore après le ménage (`curl -s -o /dev/null -w '%{http_code}' <adresse>/login` = 200 ; les specs
  `connect`, consentement et authentification ne se sautent plus).
- **Un membre inséré sans `profile.handle`** (outillage, Démo) reçoit son handle de la base et son
  espace privé (`ensure_private_space`, E11-S10). Vérifiable : `private/<handle>` et son Contexte
  existent après l'ajout.

## Base de test locale

Sur le poste, `pnpm verify` tourne sur un **Postgres 16 natif**, pas sur le projet Supabase, comme
le job `bare-postgres` de la CI : le paquet ne suppose pas Supabase, et le projet distant ne sert plus
que les suites propres à Supabase, lancées sans la variable.

- **Mode local** : `PLATFORM_TEST_DB=local` dans `.env.local` (ou l'environnement). `vitest.config.ts`
  pointe alors `PLATFORM_DATABASE_URL` et `PLATFORM_ADMIN_DATABASE_URL` sur la base du checkout et
  retire les variables de Supabase : les suites Auth, `auth.users`, hook d'inscription et Data API se
  sautent (`supabaseConfigured`, `adminSqlConfigured`), les suites portables (`sqlConfigured`) passent.
  Sans la variable, rien ne change : le projet reste la base, la CI aussi.
- **La base d'un `pnpm verify`** : `pnpm verify` ne réutilise aucune base. Sur le Postgres du poste (mode
  local, ou `PLATFORM_ADMIN_DATABASE_URL` vers `localhost`), il crée une base neuve, la migre depuis les
  fichiers de `supabase/migrations/` de l'arbre vérifié, y fait tourner `test`, puis la supprime
  (`scripts/lib/base-de-verify.mjs`). Le reçu porte l'empreinte de ces migrations ; `pnpm commit:export`
  refuse un reçu qui n'en porte pas, ou dont l'empreinte n'est pas celle de l'arbre commité. Ce que ça
  empêche (cas du 21/10/2026) : une migration réécrite après son application à une base qui ne la rejoue
  pas, des tests verts sur l'ancienne version, la CI rouge sur la nouvelle.
- **Les tests ne visent jamais la production** : `PLATFORM_TEST_PROJECT_ID` déclare le projet de test,
  et la mise en place de Vitest (`vitest.config.ts`) et de Playwright (`playwright.config.ts`) arrête
  la campagne avant toute suite si elle vise le projet distant (`SUPABASE_PROJECT_ID`, l'URL de l'API
  ou une connexion à une base de Supabase posée) sans que `PLATFORM_TEST_PROJECT_ID` soit posée, égale à
  `SUPABASE_PROJECT_ID` et lue dans `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_DB_URL`,
  `PLATFORM_DATABASE_URL` et `PLATFORM_ADMIN_DATABASE_URL` ; le message nomme la variable, jamais sa
  valeur. Une URL du poste (hôte `localhost`, `*.localhost`, `127.0.0.1` ou `[::1]`, Supabase local
  compris) ne vise aucun projet distant et passe, comme une connexion hors Supabase. Raison : les
  suites distantes écrivent à la clé secrète (comptes, `auth.users`, organisations jetables). L'outillage d'exploitation (`demo:seed`, `org:export`…) ne passe pas par
  cette garde : il se lance sur la production avec ses variables passées au coup par coup.
  **Vérifiable :** `tests/unit/test-project-guard.test.ts` (`tests/helpers/test-project-guard.mjs`).
- **Une base par dossier** (`test_<dossier>`, `scripts/lib/test-db-local.mjs`), checkout ou export : une
  migration d'un export ne change que sa base ; la règle « une seule migration non fusionnée appliquée à la fois »
  ne vaut que pour le projet distant.
- **Préparer / relancer** : `pnpm db:local` crée le cluster s'il manque (`%LOCALAPPDATA%\oto-pg16\data`,
  port 55432, `127.0.0.1` seul, `trust`, sans mot de passe), le démarre (à relancer après chaque
  redémarrage du poste), crée la base du checkout, joue `db prepare` puis `supabase db push`. Avant
  chaque passage de Vitest, la mise en place globale (`tests/local-db.setup.ts`) applique d'elle-même les
  migrations nouvelles ; une migration pas encore fusionnée, réécrite après son application, se rejoue
  par `pnpm db:local --reset`.
- **Ce qui se saute en local** (comme dans `bare-postgres`) : les suites de l'adaptateur Supabase
  seules, liste fermée dans `tests/unit/gardes-supabase.test.ts` (Data API, serveur OAuth et schéma
  `auth`, scripts à comptes Auth). Une suite du paquet prend ses personnes dans `createSqlFixtures`, ses
  jetons dans `createLocalFixtures` (`sessionFor`, `verifyToken` passé à la porte) et se garde par
  `sqlConfigured` : un jeton de Supabase Auth ne prouve rien du paquet qu'un jeton signé localement ne
  prouve. Les suites sautées restent « toujours testées » (§ Budget de tests) : relancées sur le projet
  à la fusion (`CLAUDE.md § Vérifier, commiter, pousser`).
- **Vérifiable :** en mode local, `tests/unit/test-db-local.test.ts` échoue si une variable de Supabase
  atteint les suites ; la sortie de Vitest nomme chaque suite sautée et sa raison.

## Ce qu'on ne teste PAS

- Les composants Shadcn/ui (déjà testés en amont)
- Le CSS / le rendu pixel-perfect (les tests e2e vérifient les flows, pas le style)
- Les fonctions Supabase internes (RLS, triggers) → testées via l'app, pas en isolation

## Naming Conventions

```typescript
// describe = unité testée (composant, action, schema)
// it/test = comportement attendu en anglais
describe("createProjectAction", () => {
  it("should create a project with valid data", async () => {})
  it("should return error when user is not authenticated", async () => {})
  it("should return error when name is empty", async () => {})
})

describe("CreateProjectForm", () => {
  it("should render all form fields", () => {})
  it("should show validation errors on submit with empty fields", async () => {})
  it("should disable submit button while pending", async () => {})
})
```

**Règle :** Un `it` = un comportement. Pas de `it("should work")`. Un `it` ajouté suit ces règles même quand les `it` voisins d'un fichier antérieur ne les suivent pas (`tests/unit/hooks.test.ts`, en français) : l'usage local ne vaut pas exception.

## File Organization

```
tests/
├── unit/
│   ├── actions/           # Tests des Server Actions
│   │   └── project.test.ts
│   ├── schemas/           # Tests des schemas Zod
│   │   └── project.test.ts
│   ├── hooks/             # Tests des hooks custom
│   │   └── use-debounce.test.ts
│   └── utils/             # Tests des fonctions utilitaires
│       └── format-date.test.ts
├── integration/
│   ├── components/        # Tests des composants avec interactions
│   │   └── create-project-form.test.tsx
│   └── pages/             # Tests des pages complètes
│       └── projects-page.test.tsx
├── e2e/
│   ├── auth.spec.ts       # Un fichier par parcours
│   ├── projects.spec.ts
│   └── fixtures/          # Page Objects et helpers
│       ├── auth.fixture.ts
│       └── base.fixture.ts
├── factories/             # Générateurs de données de test
│   ├── user.factory.ts
│   └── project.factory.ts
└── setup.ts               # Setup global Vitest
```

## Mock Data Factories

```typescript
// tests/factories/user.factory.ts
import type { User } from "@/types"

let counter = 0

export function createMockUser(overrides?: Partial<User>): User {
  counter++
  return {
    id: `user-${counter}`,
    email: `user${counter}@test.com`,
    full_name: `Test User ${counter}`,
    role: "user",
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

// Usage dans les tests
const admin = createMockUser({ role: "admin" })
const user = createMockUser({ email: "custom@test.com" })
```

## Playwright Fixtures

```typescript
// tests/e2e/fixtures/auth.fixture.ts
import { test as base, type Page } from "@playwright/test"

type AuthFixtures = {
  authenticatedPage: Page
}

export const test = base.extend<AuthFixtures>({
  authenticatedPage: async ({ page }, use) => {
    await page.goto("/login")
    await page.fill('[name="email"]', "test@test.com")
    await page.fill('[name="password"]', "password123")
    await page.click('button[type="submit"]')
    await page.waitForURL("/dashboard")
    await use(page)
  },
})

// Usage
test("should display projects list", async ({ authenticatedPage }) => {
  await authenticatedPage.goto("/projects")
  await expect(authenticatedPage.getByRole("heading")).toContainText("Projets")
})
```

## Coverage Targets

| Dossier | Cible | Justification |
|---------|-------|---------------|
| `lib/actions/` | > 80% | Logique métier critique |
| `lib/schemas/` | > 90% | Validation = filet de sécurité |
| `hooks/` | > 70% | Logique réutilisable |
| `components/` | > 60% | Comportement, pas rendu |
| `lib/utils/` | > 90% | Fonctions pures = facile à tester |

## Anti-patterns

| Anti-pattern | Pourquoi c'est mauvais | Faire plutôt |
|-------------|----------------------|-------------|
| Tester l'implémentation | Casse à chaque refacto | Tester le comportement |
| Test de recherche qui sème un mot déjà présent dans un autre contenu semé du même fichier | Deux stories écrites en parallèle semant le même mot trouvent chacune le contenu de l'autre : l'attente exacte casse à la fusion | Un mot propre au test, absent du fichier avant lui. **Vérifiable :** `rg -i <mot> <fichier>` ne le trouve que dans ce test |
| Colonne unique semée par un littéral (`"b".repeat(64)`) dans une aide que plusieurs suites parallèles appellent (semis d'isolation) | Chaque suite sème sa propre organisation en même temps : la seconde insertion viole la contrainte d'unicité, et l'échec tombe sur une suite étrangère | Une valeur tirée à chaque passage (`hex(32)`, `randomUUID()`). **Vérifiable en revue :** aucune valeur d'une colonne `unique` n'est un littéral dans `tests/helpers/` ni `tests/integration/isolation/` |
| `case` du SQL de semis dont les branches sont des paramètres sans type (`case when … then ${a} else ${b} end`) | Postgres résout le `case` en `text` et refuse de l'écrire dans une colonne `bigint` ou `uuid` : le semis échoue avant le test | Typer chaque branche paramétrée (`${a}::bigint`). **Vérifiable en revue :** toute branche paramétrée d'un `case` de semis porte son `::type` |
| Corps en flux (`ReadableStream`) créé avec la file par défaut dans un test qui compte les octets lus | La file d'attente tire un morceau dès la création, sans lecteur : le test voit « lu » ce que la porte n'a jamais lu, et la preuve « refusé avant le corps » échoue ou ment | `new ReadableStream({ pull }, { highWaterMark: 0 })` (`countedBody`, `tests/unit/e10s02-uploads.test.ts`). **Vérifiable :** tout flux dont un test compte la lecture porte `highWaterMark: 0` |
| `expect(component).toMatchSnapshot()` partout | Faux positifs, snapshots géants | Snapshots ciblés (petits composants) |
| Spec sur l'organisation jetable qui affirme une partie calculée des écritures de la personne (contenus récents, nouveautés bornées) sans la poser | Sur une organisation neuve, elle dépend de l'ordre des specs parallèles : absente seule, chassée de la borne en campagne | Poser la précondition dans la spec (journal, date d'activation) par la connexion d'administration, juste avant la lecture ; la spec passe seule et en campagne complète |
| Clause facultative écrite en fragment (`${id ? sql\`and t.id = ${id}\` : sql\`\`}`) dans un service que mesure un budget de requêtes (`recordDb`, `e05s10c-requetes-de-la-page.test.tsx`) | L'espion compte chaque gabarit `sql\`…\``, fragment compris : une instruction de plus par appel, sans aller-retour réel | Paramètre nul (`${id ?? null}::uuid is null or t.id = ${id ?? null}::uuid`) ; un plafond ne se relève jamais pour un fragment |
| Test sous jsdom (écran rendu), ou spec Playwright, qui charge `cli/db-prepare.mjs` ou `scripts/lib/env.mjs` | `cli/db-prepare.mjs` lit `db-prepare.sql` à son chargement par `new URL(…, import.meta.url)` : sous jsdom, Vite réécrit cette adresse (« The URL must be of scheme file ») ; Playwright refuse `import.meta.url` (« exports is not defined in ES module scope ») | La règle TLS se lit dans `cli/ssl-option.mjs`, qui ne lit aucun fichier : les aides (`tests/helpers/sql.ts`, `admin-sql.ts`) et `tests/e2e/fixtures/base.ts` l'importent ; un fichier jsdom qui importe une aide SQL porte `// @vitest-environment node`. **Vérifiable :** `rg -n "db-prepare|scripts/lib/env" tests/helpers tests/e2e tests/integration/components tests/integration/pages` ne trouve rien |
| Test de l'ordre de chargement d'un module (cycle d'imports, valeur lue au chargement) joué par `await import(…)` sous Vitest | L'exécuteur de Vitest rend `undefined` pour une liaison lue à travers un cycle, là où ESM natif et le bundler d'un hôte lèvent `Cannot access … before initialization` : le test passe sur le défaut | Charger chaque module en premier dans un Node natif (`tests/helpers/native-load-first.mjs`, lancé par `execFile` promis, `tests/unit/schemas-load-order.test.ts`) ; l'absence de cycle se prouve sur le graphe des imports (`tests/unit/import-cycles.test.ts`). **Vérifiable :** aucun test d'ordre de chargement n'affirme un `import()` évalué par Vitest |
| `{}` attendu dans `toMatchObject` ou `expect.objectContaining` pour dire « objet vide » (`toMatchObject({ revision: 1, provenance: {} })`) | L'attendu y est un sous-ensemble : `{}` accepte tout objet, et la propriété n'est plus prouvée, sans échec | `toEqual({})` sur la propriété, ou la ligne entière comparée par `toEqual` à celle d'avant. **Vérifiable :** `rg -nP "(toMatchObject|objectContaining)\(\{[^\n]*\w: \{\}" tests` ne trouve qu'une présence voulue |
| Capture Playwright (`page.screenshot`, `locator.screenshot`) au caret par défaut dans une spec qui garde l'hydratation | Le caret « hide » pose `caret-color: transparent` dans le style de chaque champ, puis laisse `style=""` ; prise avant la fin de l'hydratation, la capture ajoute au HTML servi un attribut que le client ne rend pas, et React signale un écart sans défaut de l'écran | `caret: "initial"` sur toute capture d'une spec qui garde l'hydratation. **Vérifiable :** dans une telle spec, tout appel `screenshot(` porte `caret: "initial"` |
| Attente des animations avant une capture (`getAnimations()` puis `finished`) qui ne filtre que les animations infinies | Une animation liée au défilement (`animation-timeline: scroll()` : l'ombre de l'en-tête collant de `table.css`, les ombres de `.oto-scroll[data-shadows]`) ne finit jamais : la spec attend jusqu'à son délai, assertions toutes vertes | Ne garder que les animations du temps du document (`animation.timeline === document.timeline`). **Vérifiable :** tout `getAnimations(` d'une spec qui attend `finished` filtre sur `document.timeline` ; `tests/e2e/fixtures/au-repos.ts` l'applique |
| Course sur base réelle jouée par le seul `Promise.all` | Rien ne fait se croiser les requêtes : l'appel dont le client s'ouvre plus tard écrit après l'autre, et le test passe sans la garde qu'il dit prouver | Retenir les premières écritures jusqu'à ce qu'elles partent ensemble (`crossing`, `tests/factories/table-rows-sql.ts`), ou jouer l'écriture concurrente dans le crochet `before` de l'espion (`spyDb`). **Vérifiable :** la garde retirée du service fait échouer le test de la course, mutation nommée en post-implémentation |
| Verrou de table (`lock table …`) pris par un test | Un verrou `share` ou plus fort sur une table du paquet attend toutes les écritures des autres suites de la campagne, qui tournent sur la même base : le test tombe sur « lock timeout » dès que la base est chargée | Verrouiller la ligne que l'autre transaction doit attendre (`select … for update`, ou l'écriture de cette ligne). **Vérifiable :** `rg -n "lock table" tests` ne trouve rien |
| Remises en état jouées par une boucle qui s'arrête au premier échec (`for (const undo of undos) await undo()`) | Les remises suivantes sont perdues : les tests qui suivent échouent pour une cause étrangère, loin de la vraie | Jouer toutes les remises, puis lever leurs échecs ensemble (`undoAll`, `tests/helpers/spy-t1-d2a.ts`) ; agir sur une ressource à soi quand l'assertion le permet. **Vérifiable en revue :** un `afterEach` ou un `finally` qui joue plusieurs remises les joue toutes avant de lever |
| Mutation jouée à la main dans le fichier d'un service (outil d'édition, puis retour à la main) | Un agent arrêté pendant sa campagne laisse la dernière mutation en place, et rien n'échoue tant qu'aucun test ne la voit | Un script qui garde une copie du fichier, applique chaque mutation, lance le test, rend le fichier depuis la copie après chacune et dans un `finally`, puis compare l'empreinte. **Vérifiable :** le rapport d'une campagne de mutations nomme le script et l'empreinte comparée |
| Lecture de la face SQL sans `order by`, triée ensuite par le service, prouvée sur un jeu écrit dans l'ordre attendu | La base rend l'ordre d'écriture : la mutation qui retire le tri du service reste verte | Écrire le jeu hors de l'ordre attendu, ou garder un `order by` stable (`id`) dans la lecture. **Vérifiable en revue :** la mutation du tri, nommée en post-implémentation, fait échouer le test |
| Contraste mesuré dans le navigateur juste après un changement de thème ou de focus | Boutons et champs du design system passent par `--tr-colors` : la mesure mêle deux thèmes | Attendre la fin des transitions (`transitionsFinies`, `tests/e2e/ecrans-d-authentification.spec.ts`). **Vérifiable :** toute mesure de contraste d'une spec suit l'attente des transitions |
| Tester les détails CSS | Fragile, aucune valeur | Tester les interactions. **Vérifiable :** aucune assertion ne compare un attribut `style` ni une valeur CSS ; un élément se désigne par sa balise et son texte (`toMatch(/<h1[^>]*>Nom<\/h1>/)`) |
| Mock de tout | Test ne teste rien | Mock uniquement les frontières (DB, API) |
| Test qui dépend d'un autre | Non-déterministe | Chaque test est indépendant. Une organisation jetable partagée par un fichier (sessions limitées) n'y change rien : chaque test pose sa précondition (`beforeAll` du bloc ou le test lui-même), et un test qui consomme un état (révocation, suppression, déplacement) le fait sur une ressource à lui. **Vérifiable :** chaque `it` passe lancé seul (`vitest -t`) |
| `await sleep(1000)` | Lent et fragile | `waitFor`, `findBy` |
| Panne injectée une seule fois dans une écriture d’assistant atomique (`writeAtomically`) | L’écriture est rejouée une fois sur une erreur `internal` (HN-E11S18-2) : la panne est absorbée et le test voit une écriture réussie | La panne vise l’état, pas l’appel : toute écriture du même genre échoue tant que l’état l’exige (ex. toute insertion dans `blocks` une fois le fichier `ready`, `tests/integration/e10s02-uploads.test.ts`). **Vérifiable :** un test qui injecte une panne sous `writeAtomically` affirme aussi qu’elle survit au rejeu |
| Temps linéaire prouvé par une borne en millisecondes (`toBeLessThan(TEMPS_LINEAIRE_MS)`) | La charge d'un `pnpm verify` complet multiplie le temps d'une lecture linéaire (2,9 s pour une borne de 1 s) : le test échoue sans défaut | Le rapport des temps du texte entier et de son quart, chacun le plus court de trois lectures alternées : sous 10 (linéaire : 4, quadratique : 16), ou le texte entier lu en moins de 50 ms (`readingRatio`, `tests/unit/nodes-parse-tolerant.test.ts`). **Vérifiable :** un nouveau test de textes hostiles n'importe pas `TEMPS_LINEAIRE_MS` |
| `expect(document.activeElement)` nu après un `waitFor` sur le texte d'un envoi | Le focus déplacé par un `useEffect` passe après le rendu du texte : sous charge, l'assertion le précède | `await waitFor(() => expect(document.activeElement).toBe(…))` après toute action asynchrone |
| Test qui enchaîne des lancements de processus (`execFileSync`, `spawnSync` : node, git) sans délai explicite (défaut de `vitest.config.ts` : 20 s) ; fichier de tels tests qui ne rend jamais la main à la boucle d'événements | Sous charge, un lancement coûte jusqu'à 0,7 s. Un fichier entièrement synchrone ne traite les réponses internes de Vitest qu'à sa fin : passé 60 s cumulées, « Timeout calling "onTaskUpdate" » fait échouer le passage, tests verts compris | Un `timeout` explicite sur la suite, la raison et la mesure en commentaire, 60 s au plus (un lancement synchrone qui bloque plus de 60 s fait échouer le passage quel que soit le délai) ; plus long, le test lance ses processus sans bloquer (`execFile` promis, `tests/integration/org-transfer.test.ts`) ; un fichier qui dépasse 15 s au calme, ou 60 s dans un `pnpm verify` complet, rend la main après chaque test (`afterEach(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))`, `tests/unit/hooks.test.ts`). **Vérifiable :** un test qui lance plus de trois processus a un délai explicite, et aucun lancement synchrone n'attend plus de 60 s |
| Motif de détection élargi (hook, garde, filtre : casse, graphie, ouvrant) testé sur les seules formes qu'il doit saisir | Il saisit aussi des voisines légitimes, sans qu'aucun test ne le dise : `\bgit\b` rendu insensible à la casse refusait tout shell imbriqué qui cite le dossier `Git` de Git pour Windows | Dans le même diff, un `it.each` des formes voisines qu'il doit laisser passer (`tests/unit/hooks.test.ts`, « the Git folder of Git for Windows »). **Vérifiable :** tout motif élargi du diff a son test de formes permises |
| Faux secret écrit en littéral (JWT `eyJ…`, clé `sb_secret_…`, mot de passe, URL de base qui porte un mot de passe avant son `@`, workflows de CI compris) | Le contrôle pré-public (`scripts/check-public.mjs`, lancé par `pnpm test`) scanne le dépôt et le refuse | Le construire à l'exécution (`["eyJ", "hbGciOi"].join("")`, `randomBytes`, `new URL(…)` puis `url.password = …`) ; un service Postgres de CI se joint sans mot de passe (`POSTGRES_HOST_AUTH_METHOD: trust`) |
| Valeur réelle d'un secret dans une assertion (`expect(sortie).not.toContain(secretKey)`, `expect(fuites).toHaveLength(0)`) | En échec, Vitest imprime la valeur reçue ou attendue : la clé ou le mot de passe sort en clair dans le terminal | Comparer des noms : `expect(Object.entries({ secretKey }).filter(([, v]) => v && sortie.includes(v)).map(([nom]) => nom)).toEqual([])` (`tests/integration/demo-seed.test.ts`) |
| Session d'un nouveau test d'intégration ouverte par `fx.signIn` (mot de passe) | Supabase Auth limite les connexions par adresse IP : une seule suite peut atteindre ce quota, et un second passage en moins de cinq minutes échoue (« Request rate limit reached ») | `fx.sessionFor(user)` (lien généré à la clé secrète, vérifié à la clé publique : autre quota), et les mêmes personnes réutilisées d'une organisation jetable à l'autre (`fx.buildReferenceOrg(o.people)`) |
| Personne sans compte posée dans `platform_staff` par un passage qui ne crée aucune organisation marquée (slug `t<8 hex>` égal au préfixe) | `pnpm test:cleanup --delete` date une telle personne par les organisations qu'elle sert, et celle qui n'en sert aucune par l'absence de toute organisation marquée de moins de 2 h (`staleStaff`, `scripts/test-cleanup.mjs`) : en période calme, lancé pendant le test, il l'oublie | Créer l'organisation marquée avant la ligne (`seed.createOrg()`, `fx.createOrg()`) et lui en donner l'accès (`platform_grants`), sauf pour la voir oubliée (`tests/integration/test-cleanup.test.ts`). **Vérifiable :** tout fichier de `tests/` qui insère dans `platform_staff` une personne sans compte crée une organisation par `createOrg`, lui-même ou par sa fixture, avant cette insertion |
| Spec Playwright qui laisse un mot de passe saisi dans la page quand elle échoue, campagne qui saisit un mot de passe sous le rapport HTML, ou lecture de `test-results/**/error-context.md` filtrée par mot-clé | L'instantané de la page qu'écrit Playwright à l'échec porte les valeurs saisies en clair, sur une ligne `text:` sans libellé : un filtre sur `password` ou « mot de passe » la laisse passer ; le rapport HTML le recopie dans `playwright-report/data/` ; un `try` ouvert après le clic laisse le champ rempli quand le clic échoue. Même au succès, Playwright intitule chaque saisie `Fill "<valeur>"`, titre d'étape que le rapport HTML garde : aucun `try` ne le couvre | Saisir le mot de passe par `envoyerLaConnexion` (`tests/e2e/fixtures/connexion.ts`) : son `try` couvre la saisie, l'envoi et l'attente, et vide le champ avant de relancer l'échec ; lancer toute campagne qui saisit un mot de passe sous le rapport `line`, celui de `playwright.config.ts`, jamais sous `--reporter=html` ; de l'instantané, ne lire que des lignes de rôle (`heading`, `button`, `alert`) ; supprimer `test-results/` et `playwright-report/` après la campagne. **Vérifiable :** aucune spec ne remplit le champ « Mot de passe » hors d'`envoyerLaConnexion` ; `playwright.config.ts` garde `reporter: "line"` |
| Importer dans `tests/` une dépendance que seul le paquet déclare (`jose`, SDK MCP) | pnpm ne résout depuis la racine que ses propres dépendances : « Cannot find package », ou une seconde copie à une autre version | La déclarer aussi en `devDependencies` de la racine, à la même version exacte que le paquet (`tech-stack.md § Canal MCP`) |
| Page de l'hôte couverte par le seul test de son écran | L'écran reçoit la donnée déjà traduite (`{ data: null }`) : il reste vert si la page cesse d'attraper un refus de service (`forbidden` → pas de formulaire), de rediriger sans session, ou de lire selon le rôle | Un test de page dans `tests/integration/pages/`, session et services simulés (`equipes-page.test.tsx`). **Vérifiable :** toute `page.tsx` qui attrape un code de service ou choisit ses lectures selon le rôle a son test de page ; tout composant que monte un `layout.tsx` (fournisseur, navigation) est affirmé par un test du layout (`identite-pages.test.tsx`) ; toute prop de droit que la page tire de l'identité (`moi.equipesDirigees`, `moi.userId`) a un cas de page, sous une identité qui n'est pas administratrice, où elle seule montre ou retire un geste : remplacée par `[]`, par toutes les valeurs ou par `""`, elle fait échouer ce cas |
| Condition de droit à plusieurs branches (`moi.estAdmin \|\| invitation.invitedBy === moi.userId`) testée par le seul cas où toutes sont vraies | Réduite à l'une de ses branches, ou rendue vraie pour tous, elle passe toute la suite : un responsable perd un geste sur ce qui est à lui, ou le voit sur ce qui est à un autre | Un test où chaque branche est seule vraie, un où toutes sont fausses, qui affirment la présence et l'absence du geste. **Vérifiable :** la condition réduite à chacune de ses branches tour à tour, puis remplacée par `true`, fait échouer un test : une mutation par branche, nommée en post-implémentation |
| Règle d'ordre, de borne ou de choix d'un critère d'acceptation (« par X décroissant puis Y », « les N plus récentes », « la première »), ou choix des lignes qu'une décision de droits examine (« le masquage ne lit que la dernière erreur »), testée sur un jeu qui ne les distingue pas : un seul élément, des éléments déjà dans l'ordre attendu, N éléments au plus pour une borne N, un seul candidat au choix | Le tri inversé, le départage retiré, la borne prise par l'autre bout ou l'autre élément choisi passent toute la suite : l'AC est livré sans preuve ; une décision de droits qui examine une autre ligne que celle servie sert en entier ce qu'elle devait masquer ; un regroupement vérifié par la liste des titres et celle des éléments, chacune à part, garde les deux listes quand un élément passe d'un groupe à l'autre | Un jeu où chaque variante change le résultat : deux éléments rangés à l'envers de l'ordre attendu, une égalité à départager, N + 1 éléments pour une borne N, un concurrent pour chaque choix, celui d'une décision de droits compris ; pour un regroupement, un élément à la frontière de deux groupes et la suite entrelacée des titres et des éléments comparée en entier. **Vérifiable :** chacune de ces mutations (tri inversé, départage retiré, borne par l'autre bout, autre choix, autre ligne examinée) fait échouer le test de l'AC ou de la décision, nommée en post-implémentation |
| Lecture qui dépend du mode de l'hôte (session de Supabase Auth ou d'un émetteur OIDC) testée pendant que la doublure de l'autre source répond comme celle du mode testé | Une page qui lit encore l'autre source reste verte dans les deux modes | Dans chaque mode, l'autre source répond autrement : personne quand la page doit rendre, la personne quand elle doit renvoyer à la connexion (`supabaseSignedIn`, `tests/integration/oidc-flow.test.ts`). **Vérifiable :** chaque lecture remise sur l'autre source fait échouer un test, mutation nommée en post-implémentation |
| `page.getByRole("alert")` sans filtre dans un test Playwright | L'annonceur de route de Next (`#__next-route-announcer__`) porte aussi `role="alert"` : la locator résout deux éléments et le test échoue en « strict mode violation », même quand le refus attendu est à l'écran | `page.getByRole("alert").filter({ hasText: "<phrase attendue>" })` |
| Campagne Playwright lancée sans vérifier quel serveur écoute le port 3000 (`reuseExistingServer` de `playwright.config.ts`) | Un autre export, ou un serveur resté d'une session interrompue (sous Windows, les processus enfants de `next dev` survivent à leur shell), peut tenir le port 3000 : le `pnpm dev` de l'export part sur 3001, et la campagne teste le code de l'autre, écritures comprises | Juste avant chaque campagne, et après tout redémarrage du serveur : `Get-NetTCPConnection -LocalPort 3000 -State Listen`, dont le processus (`Win32_Process`) porte le chemin du dossier testé dans sa ligne de commande ; sinon ne pas lancer. **Vérifiable :** le rapport de la campagne cite ce contrôle, fait après le dernier démarrage du serveur |
| `pnpm verify` lancé dans un dossier (checkout ou export) où `pnpm dev` (ou une campagne Playwright, qui le démarre) a laissé `.next/`, ou après le retrait d'une page | Le premier `lintText` d'ESLint s'y allonge au-delà du délai de `tests/unit/ui-boundary.test.ts` ; `tsc` lit encore la route retirée dans `.next/types` | Arrêter le serveur, puis supprimer `.next/` (ignoré par git) avant `pnpm verify`, avec `test-results/` et `playwright-report/`. **Vérifiable :** aucun `.next/` dans le dossier quand `pnpm verify` démarre |
| Caractère invisible écrit en littéral dans une chaîne (inversion bidi U+202E, échappement U+001B, usage privé U+E000, séparateurs U+2028 et U+2029) | Invisible à la relecture, et un caractère bidi retourne l'affichage du code qui le suit (Trojan Source). Un outil d'édition peut écrire le caractère au lieu de l'échappement demandé ; `\p{Cf}` ne voit ni l'usage privé (`Co`) ni U+2028 et U+2029, qu'un module Node refuse et qu'une chaîne garde sans bruit | L'échappement dans la chaîne (`"‮"`), jamais le caractère ; écrit par l'outil d'édition, il se remplace par un script qui compose la barre oblique inverse (`String.fromCharCode(92)`), jamais par un second appel du même outil ; pour U+2028 et U+2029, une classe `\p{Zl}` ou `\p{Zp}` dans une expression, `String.fromCodePoint` dans une chaîne ; un outil de l'agent (Edit, Write, Bash) décode un `\uXXXX` de ses paramètres, et un remplacement par `perl` ou `sed` perd la barre oblique : l'échappement s'écrit par un script qui compose la barre, puis se relit par `cat -A`. **Vérifiable :** `rg -n "[\p{Cf}\p{Co}\p{Zl}\p{Zp}]" packages src scripts tests` et `rg -n "[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]" packages src scripts tests` ne trouvent rien |
| Doublure de la base (base simulée, fausse RPC) qui rend ses lignes dans l'ordre de la clé quand la requête ne pose pas d'ordre | Une lecture par pages (après la dernière clé lue) qui oublie son tri passe le test, alors qu'une base sans `order by` rend un ordre quelconque : la lecture saute et relit des lignes | Sans ordre demandé, la doublure rend un autre ordre que celui de la clé (l'inverse) ; le test de la lecture compare la liste entière lue, jamais son nombre de valeurs distinctes, qui ne voit pas une ligne relue. **Vérifiable :** l'ordre retiré de la lecture, puis la page suivante lue après l'avant-dernière clé, font chacun échouer son test. Exception connue, à reprendre : `simulatedDb` (`tests/helpers/simulated-db.ts`) rend sans `order()` l'ordre d'insertion d'une table, ou celui du gestionnaire d'une RPC |
| Filtre ou garde à plusieurs conditions (`note.date >= from && note.date <= to && compareVersions(…) <= 0`, `if (fond === "" \|\| encre === "") return`) testé par des cas que deux conditions écartent à la fois, ou que la même condition écarte toujours, sans cas sur ses bornes | Une condition retirée, une autre écarte encore le cas et la mutation passe toute la suite ; une borne rendue stricte (`<` pour `<=`) n'est vue par aucun cas d'égalité | Un cas écarté par chaque condition seule, les autres vraies, et un cas retenu sur chaque borne. **Vérifiable :** chaque condition retirée tour à tour, puis chaque borne rendue stricte, fait échouer le test de l'AC : une mutation par condition et par borne, nommée en post-implémentation |
| `vi.mock(m, importOriginal)` quand un module chargé par la fabrique importe `m`, même par un cycle | Ce module reçoit le `m` réel, pas la simulation : le test croit simuler le registre et lit le vrai | Simuler `m` entier, fabrique sans `importOriginal`, dans le test qui doit contrôler ce que lit ce module ; une source dynamique lue par le registre vit dans un module sans import (`catalog/erp-source.ts`) |
| Texte d'un objet JSON écrit en base (`JSON.stringify`, `renderBlocks` d'un bloc `call`) comparé à l'octet au texte calculé sur l'objet envoyé | `jsonb` range les clés d'un objet par longueur, puis par octets : `{"to", "subject", "body"}` revient `{"to", "body", "subject"}`, et `read` comme `context` le rendent dans cet ordre. La base simulée garde l'ordre d'écriture : l'écart ne se voit que sur la vraie base | Calculer le texte attendu sur les lignes relues, ou comparer les données (`toEqual`, sans ordre des clés). **Vérifiable :** un test d'intégration qui compare à l'octet le rendu d'un objet JSON écrit en base le tire des lignes relues |
| Mutation ou essai qui pose un état de session (`set_config(…, false)`, `set role` sans `local`) par `PLATFORM_DATABASE_URL` du projet partagé | Le pooler de Supabase en mode transaction ne remet pas à zéro une connexion serveur : rôle et claims y restent, et il la rend à tout client de `platform_app`, tests des autres exports compris | La jouer sur un Postgres nu jetable (comme le job `bare-postgres`) ; si elle a touché le projet, fermer les connexions de `platform_app` par la connexion d'administration (`pg_terminate_backend` sur `pg_stat_activity` où `usename = 'platform_app'`), puis rejouer `tests/integration/sql-session.test.ts`. **Vérifiable :** le rapport d'une mutation de session nomme sa base, ou la fermeture et le passage vert de `sql-session.test.ts` qui la suivent |
| Absence d'un texte dans ce qu'écrit la console (message levé, jeton, adresse) vérifiée par `JSON.stringify(<espion>.mock.calls)` | `JSON.stringify` rend une `Error` en `{}` : un `console.error("…", erreur)` qui écrirait au journal du serveur le message levé par l'application, sa pile ou un jeton garde le test vert | Lire la console par `loggedText` (`tests/helpers/logs.ts`) : `format` d'`util`, celui de `console.error`, rend le message et la pile ; un résultat d'outil ou une ligne de journal, qui partent en JSON, restent lus par `JSON.stringify`. **Vérifiable :** `rg -n "JSON\.stringify\(.*mock\.calls" tests` ne trouve rien ; exception connue, à reprendre : `tests/unit/errors.test.ts` |
| Aide de test qui observe ou simule la base (espion de requêtes, doublure) sur une face qu'aucun test n'exerce encore | Son défaut ne se voit qu'au jour où un test s'y fie, et il y fausse la preuve au lieu de la faire échouer : un espion peut compter deux fois chaque requête et jouer deux fois chaque course, postgres.js rappelant `then` par le `catch` qu'il pose sur toute requête d'une transaction | Un test de l'aide sur chaque face qu'elle couvre, dans le diff qui l'écrit (`tests/integration/spy-db.test.ts` pour la face SQL de `spyDb`). Sur la face SQL, l'aide attend son crochet dans `handle()` de la requête postgres.js 3.4.9, par où `then`, `catch`, `finally`, `execute`, `forEach` et `cursor` passent une seule fois, et rend une panne par son `reject()` : un enrobage du seul `then` laisse partir l'instruction avant le crochet sous les autres formes. **Vérifiable :** toute aide de `tests/helpers/` qui enveloppe une face de `PlatformDb` a un test qui exerce cette face par `then` et par `execute`, et ce test échoue quand l'enrobage agit à chaque appel |
| Horodatage à la microseconde semé par `ref.write` ou par un paramètre postgres.js (`${"…654321Z"}`), dans un test qui prouve que le service rend les microsecondes | Le sérialiseur `timestamptz` de postgres.js passe par une `Date` : la base reçoit `.654`, et le test échoue sur sa propre graine, ou passe à vide si son attendu est relu de la base | Semer la valeur en texte converti dans la requête, par la connexion d'administration : `${"2030-01-01T08:00:00.654321Z"}::text::timestamptz` (`supabase-patterns.md § Couplage à Supabase (ADR-012)`). **Vérifiable :** un test qui affirme des microsecondes les a écrites ainsi (`tests/integration/server-ctx.test.ts`) |
