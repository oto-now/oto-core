# Index des conventions

> **Source de vérité unique du routing `fichier → tag → convention`.**
> Lu par le skill `dev` (avant d'écrire) et par le skill `revue` (avant de reviewer).
> Ne PAS dupliquer ce mapping ailleurs — ni dans un skill, ni dans `CLAUDE.md`.

## Convention de base (toujours lue)

| Fichier | Description |
|---------|-------------|
| `coding-standards.md` | Naming, structure des fichiers, DRY, error handling, commentaires |

Une seule, et volontairement courte. Tout le reste est **conditionnel** : `component-registry.md`
ne sert qu'au moment de créer quelque chose, `tech-stack.md` qu'au moment de toucher aux
dépendances. Les lire à chaque changement d'une ligne était du poids mort.

## Conventions par tag

La colonne **Globs** est la règle de routing : si un fichier touché (créé ou modifié) matche
un glob, le tag est actif et sa fiche (`fiches/<fichier>`) est lue, et le texte complet sur un doute ou pour une revue.

En mode story, les tags déclarés dans le champ `Conventions` de la story s'ajoutent aux tags
déduits des globs — c'est le seul moyen d'activer les tags marqués **non routables** ci-dessous.

| Tag | Fichier | Globs | Description |
|-----|---------|-------|-------------|
| `api` | `api-patterns.md` | `src/lib/actions/**`, `src/app/api/**`, `src/app/**/page.tsx`, `packages/plateforme/api/**` | Server Actions, fetch, pagination, caching, bulk |
| `forms` | `forms-patterns.md` | `src/lib/schemas/**`, `src/components/**/*form*.tsx`, `packages/plateforme/schemas/**` | RHF + Zod, formulaires progressifs, validation async |
| `tables` | `tables-patterns.md` | oto-saas : `src/components/**/*table*.tsx`, `src/components/**/*list*.tsx` | Tri, filtres, sélection, actions groupées |
| `uploads` | `uploads-patterns.md` | `src/components/**/*upload*.tsx`, `src/components/**/*dropzone*.tsx`, `src/lib/actions/*upload*.ts` | Upload, taille, mime, chemins de storage |
| `auth` | `auth-patterns.md` | `src/middleware.ts`, `src/app/(auth)/**`, `src/lib/actions/auth*.ts` | Signup, login, reset, session, OAuth |
| `database` | `database-patterns.md` | `supabase/migrations/**`, `supabase/seed.sql`, `src/types/database.ts`, `packages/plateforme/migrations/**` | Migrations, RLS, index, transactions, soft delete |
| `supabase` | `supabase-patterns.md` | `src/lib/supabase/**`, `supabase/**`, `src/lib/actions/**`, `src/lib/plateforme/**`, `packages/plateforme/server/**`, `scripts/platform-staff.mjs`, `scripts/org-export.mjs`, `scripts/org-import.mjs`, `scripts/lib/org-transfer*.mjs`, `scripts/demo-seed.mjs`, `scripts/demo/**`, `scripts/test-cleanup.mjs`, `scripts/oauth-clients.mjs`, `scripts/lib/env.mjs`, `scripts/lib/oauth-clients.mjs` | Clients, RLS avancé, codes d'erreur, face SQL et couplage à Supabase |
| `security` | `security-patterns.md` | `src/lib/actions/**`, `src/lib/plateforme/**`, `src/app/api/**`, `src/middleware.ts`, `.env.example`, `scripts/check-public.mjs`, `scripts/demo-seed.mjs`, `scripts/demo/**`, `scripts/test-cleanup.mjs`, `scripts/platform-staff.mjs`, `scripts/org-export.mjs`, `scripts/org-import.mjs`, `scripts/lib/org-transfer*.mjs`, `scripts/oauth-clients.mjs`, `scripts/lib/env.mjs`, `scripts/lib/oauth-clients.mjs`, `packages/plateforme/server/**`, `packages/plateforme/api/**`, `packages/plateforme/mcp/**`, oto-saas : `src/lib/cellule/**` | XSS, CSRF, rate limiting, secrets, idempotence |
| `nextjs` | `nextjs-patterns.md` | `src/app/**/page.tsx`, `src/app/**/layout.tsx`, `src/app/**/loading.tsx`, `src/app/**/error.tsx`, `src/app/**/not-found.tsx`, `src/app/**/template.tsx`, `src/app/**/global-error.tsx`, `src/app/**/unauthorized.tsx`, `src/app/**/forbidden.tsx`, `src/app/**/route.ts`, `next.config.ts` | App Router, fichiers spéciaux, frontières d'autorisation |
| `state` | `state-management.md` | `src/components/**/*provider*.tsx`, `src/components/**/*filter*.tsx`, `src/app/**/page.tsx` | URL state, contexte, hiérarchie de state |
| `feedback` | `feedback-patterns.md` | oto-saas : `src/components/**/*dialog*.tsx`, `src/components/**/*confirm*.tsx`, `src/components/**/*delete*.tsx`, `src/components/**/*toast*.tsx`, `src/components/ui/sonner.tsx` | Toasts, dialogs, confirmations, empty states |
| `a11y` | `accessibility-patterns.md` | `src/components/**/*.tsx`, `src/app/**/*.tsx`, `src/app/globals.css`, `packages/plateforme/ui/**/*.tsx`, `packages/plateforme/widgets/**/*.tsx` | WCAG, ARIA, clavier, focus, contraste |
| `performance` | `performance-patterns.md` | `next.config.ts`, `src/app/**/loading.tsx`, `src/app/**/page.tsx`, `src/components/**/*chart*.tsx`, `src/components/**/*editor*.tsx` | Code splitting, Web Vitals, images, fonts |
| `typescript` | `typescript-patterns.md` | `src/types/**`, `tsconfig.json` | Utility types, unions, branded types, type guards |
| `ui` | `ui-patterns.md` | `packages/plateforme/ui/**`, `packages/plateforme/widgets/**/*.tsx`, `src/app/**/*.tsx`, `src/components/**/*.tsx`, `src/app/globals.css` | Lecture de design, intégrer une fonctionnalité, principes UX, fiches et gestes, responsive, états, texte, signatures IA, preuve visuelle ; moyens du paquet : `portage` l'emporte (`docs/design/system.md`) |
| `portage` | `portage-ecrans.md` | `packages/plateforme/ui/**` | Écrans portés d'oto-frontend : navigation par props, tokens Oto, quatre états |
| `registry` | `component-registry.md` | `src/components/**`, `src/lib/utils/**`, `src/lib/actions/**`, `src/lib/schemas/**`, `src/types/**`, `packages/plateforme/ui/**`, `packages/plateforme/schemas/**`, `packages/plateforme/server/**` | Registry DRY — vérifier avant de créer |
| `stack` | `tech-stack.md` | `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `next.config.ts` | Versions exactes, pins et leurs raisons |
| `seo` | `seo-patterns.md` | `src/app/layout.tsx`, `src/app/**/page.tsx`, `src/app/**/sitemap.ts`, `src/app/**/robots.ts`, `src/app/**/opengraph-image.*` | Metadata API, Open Graph, sitemap, JSON-LD |
| `monitoring` | `monitoring-patterns.md` | `instrumentation.ts`, `src/instrumentation.ts`, `sentry.*.config.ts`, `src/app/**/error.tsx`, `src/app/**/global-error.tsx`, `src/app/api/health/**` | Error tracking, analytics, health checks, logs |
| `deploy` | `deployment-patterns.md` | `.github/workflows/**`, `.env.example`, `supabase/config.toml`, `packages/plateforme/cli/**`, `scripts/ci/**`, `renovate/**`, oto-saas : `vercel.json` | Environnements, rollback, migrations, secrets |
| `testing` | `testing-strategy.md` | `tests/**`, `**/*.test.ts`, `**/*.test.tsx`, `vitest.config.ts`, `playwright.config.ts` | Unit, integ, E2E, mocks, fixtures |
| `datetime` | `datetime-patterns.md` | `src/lib/utils/*date*.ts`, `src/lib/utils/*format*.ts`, `src/lib/utils/*currency*.ts` | Dates, timezones, formatage, devises |
| `i18n` | `i18n-patterns.md` | `messages/**`, `src/i18n/**`, `src/middleware.ts` | Traductions, pluriels, locale, RTL |
| `flags` | `feature-flags-patterns.md` | `src/lib/flags/**`, `src/lib/*flag*.ts` | Feature flags, A/B testing, rollouts |
| `mcp` | `mcp-patterns.md` | `packages/plateforme/mcp/**`, `src/app/api/mcp/**`, `src/app/api/mcp-admin/**`, `src/app/.well-known/**`, `src/app/oauth/**`, `packages/plateforme/widgets/**` | Tools MCP, AX et découverte par les hosts, résultats, widgets dual-host, OAuth, transport, golden queries |

### Tags non routables par chemin

`datetime`, `i18n` et `flags` portent sur des **préoccupations transverses** qu'aucun chemin de
fichier ne révèle : formater un montant, afficher une date ou gater une fonctionnalité se fait
dans n'importe quel composant. Leurs globs ne couvrent que le cas où un helper dédié existe.

À l'échelle Module, si le travail touche l'une de ces préoccupations, **déclarer le tag
explicitement** — via le champ `Conventions` de la story, ou en l'annonçant.

### Capacités non installées

Ces tags décrivent des domaines dont **aucune dépendance n'est installée dans le template**.

**Un tag de ce tableau ne s'active pas tant que sa capacité n'est pas installée**, même si un
glob matche : sinon un chemin courant ferait lire une convention sur une capacité absente. La
condition d'activation est dans la colonne de droite : elle se vérifie en une commande.

`check:framework` exempte aussi ces tags de la détection de globs morts.

| Tag | Activé par | Vérifiable par |
|-----|------------|----------------|
| `i18n` | `next-intl` ou équivalent | dépendance dans `package.json` |
| `flags` | librairie de feature flags | dépendance dans `package.json` |
| `monitoring` | Sentry ou provider d'analytics | dépendance dans `package.json` |

Supabase (`@supabase/ssr` dans `package.json`) et le canal MCP (face `mcp/` du paquet) sont installés :
`supabase`, `database`, `auth` et `mcp` sont routés normalement.

**Dès que la capacité est installée, retirer le tag de ce tableau** : il redevient soumis à la
vérification des globs, et un chemin devenu faux échouera au lieu de passer inaperçu.

## Règles de routing

1. **Un fichier peut activer plusieurs tags** — charger tous les fichiers correspondants (dédupliqués).
2. **Un tag de « Capacités non installées » ne s'active pas** tant que sa dépendance est absente, même si un glob matche.
3. **Aucun glob ne matche** → seule la convention de base s'applique. Ce n'est pas une erreur.
4. **Annoncer les conventions chargées** avant d'agir : `Conventions : coding-standards, api-patterns, security-patterns`. Si rien au-delà de la base, le dire.
5. **Lire la fiche** pour écrire, le texte complet sur un doute et pour toute revue ; jamais un résumé fait de mémoire. Il n'existe **pas** de skill par tag : `dev` et `revue` matchent ces globs eux-mêmes.
6. **Ajouter un tag** = une ligne ici + le fichier de conventions + sa fiche (`fiches/<fichier>`, 60 lignes au plus, chaque règle avec son `§`). Rien d'autre — créer un `.claude/skills/<tag>/` ferait échouer `pnpm check:framework`. Le check échoue aussi si le fichier manque, si les globs sont vides, si aucun glob ne peut matcher un dossier réel, ou si le fichier dépasse 400 lignes.
