# Pile et structure du dépôt

> Ce qu'on consulte : les technologies du paquet et de l'hôte de référence, et où vit chaque chose dans le dépôt. Le pourquoi est dans [la conception](../conception/README.md), à commencer par [la vue d'ensemble](../conception/vue-d-ensemble.md).

## Stack technique

Versions exactes et règles de montée : `.method/conventions/tech-stack.md`.

| Techno | Version | Rôle |
|--------|---------|------|
| Next.js | 15 (App Router) | Application hôte ; routes qui montent les faces du paquet |
| React | 19 | Écrans du paquet (`ui/`) |
| TypeScript | ~5.8.3 (strict) | Tout le code ; le paquet est publié en sources |
| Tailwind CSS | 4.x | Styling ; `@source` vers `ui/` du paquet ; jeu de tokens d'Oto sous `CoquilleOto` (ADR-008) |
| Zod | 3.25.x (`zod/v4` pour `toJSONSchema`) | Schémas partagés : écrans, API, outils MCP |
| Postgres | 16, avec `pg_trgm`, `unaccent`, `ltree` (schéma `extensions`) | Seule base ; Supabase ou Postgres nu (ADR-012) |
| `postgres` (postgres.js) | 3.4.9 exacte | Pilote du serveur, de la CLI, de l'outillage et des tests |
| `@modelcontextprotocol/sdk`, `mcp-handler`, `jose` | 1.32.1, 1.1.0, 6.2.12 exactes | Serveur MCP sur route handler, vérification des jetons |
| `nodemailer` | 10.0.10 exacte | Invitations envoyées par la plateforme en mode OIDC |
| `@supabase/supabase-js`, `@supabase/ssr` | 2.x, 0.x | Hôte en mode Supabase : session web, lien magique, consentement OAuth |
| `oauth4webapi` | 3.8.8 exacte | Hôte en mode OIDC : connexion web chez l'émetteur |
| `@phosphor-icons/react` | 2.x | Icônes des écrans du paquet |
| pnpm | 12.x (workspace) | Application de base + `packages/plateforme` |
| Vitest, Testing Library, Playwright | — | Tests unitaires, d'intégration, de bout en bout |
| Renovate, npmjs.com (public) | — | Mises à jour des applications hôtes (ADR-006, ADR-010) |

## Structure

```
.
├── src/                                        # Application de base : l'hôte de référence
│   ├── app/(dashboard)/                        # Layout authentifié : organisation par l'adresse, `CoquilleOto` au thème de l'organisation, le rail
│   │   ├── page.tsx                            # Accueil
│   │   ├── n/[...chemin]/page.tsx              # Tout nœud de l'arbre : page, procédure, Contexte, tableau
│   │   ├── teams/, journal/, connect/          # Équipes et droits ; journal ; brancher un assistant
│   │   ├── upload/[token]/page.tsx             # Formulaire de dépôt d'un assistant sans shell (`form_url`, ADR-018 § 8)
│   │   └── admin/…                             # Tableau de bord : `organization/` (marque comprise), `connectors/`, `usage/`, `feedback/`
│   ├── app/(auth)/, app/auth/callback, app/auth/confirm     # Mode Supabase : connexion, lien magique, réinitialisation, invitation acceptée au retour
│   ├── app/auth/oidc/{login,callback,logout}   # Mode OIDC : connexion chez l'émetteur, session en cookie chiffré
│   ├── app/oauth/consent/page.tsx              # Mode Supabase : consentement OAuth des assistants
│   ├── app/no-organization/page.tsx            # Personne connectée sans appartenance à l'organisation de l'adresse
│   ├── app/p/…                                 # Page publique d'un lien de partage (ADR-013) ; `p/[jeton]/share-image/[[...chemin]]` : son image de partage (E11-S21)
│   ├── app/opengraph-image.tsx                 # Image de partage de toute autre adresse : l'organisation seule, jamais une page (E11-S21)
│   ├── app/api/mcp/route.ts                    # MCP des organisations
│   ├── app/api/mcp-admin/route.ts              # MCP admin, rôle plateforme
│   ├── app/api/platform/[...route]/route.ts    # API du paquet
│   ├── app/.well-known/oauth-protected-resource/[[...chemin]]/route.ts  # RFC 9728 : racine et formes suffixées
│   ├── lib/fonctions-metier.ts                 # Fonctions de l'ERP inscrites au catalogue, importé en tête des routes MCP et API
│   ├── lib/plateforme/                         # Session de l'hôte dans les deux modes, client et session OIDC, marque de l'adresse
│   ├── lib/cellule/sous-domaines.ts            # Propre au SaaS : sous-domaines par l'API Vercel, désactivé sans ses variables
│   └── middleware.ts                           # Session ; `/api`, `/.well-known`, `/p`, `/opengraph-image` publics (le MCP gère son auth)
├── packages/plateforme/                        # @otomata_tech/oto_platform
│   ├── ui/                                     # Écrans copiés d'oto-frontend et leur design system ; JAMAIS server/, migrations/ ni client de base
│   ├── schemas/                                # Zod partagé par toutes les faces, ui/ compris ; rendu des blocs, syntaxe des liens
│   ├── mcp/                                    # Six outils, MCP admin, résultats, vérification des jetons, métadonnées de ressource
│   ├── api/                                    # Handler de /api/platform/* : adaptateurs des services
│   ├── server/                                 # Services : la seule porte d'écriture dans platform
│   ├── migrations/                             # Ligne de base du schéma platform et migrations additives suivantes
│   ├── cli/                                    # `oto-platform` : `db prepare`, `migrations sync`, `migrations check`
│   ├── widgets/                                # Widget routeur dans la conversation (Vite single-file) ; construit dans mcp/widgets/generated.ts, non publié
│   └── CHANGELOG.md                            # Notes de version (format testé)
├── supabase/                                   # Projet Supabase de l'hôte : configuration, copies des migrations du paquet
├── renovate/preset.json                        # Preset Renovate des applications hôtes
├── scripts/                                    # Outillage de tout hôte (docs/exploitation/installer-un-hote.md) et contrôles du dépôt
└── tests/                                      # unit, integration (dont la suite portable), e2e
```

Dépendances entre faces :
- `ui/` → `schemas/` seulement ; il reçoit ses données par props et appelle `api/` par HTTP ;
- `widgets/` → `ui/` et `schemas/` seulement ; son bundle est servi par `mcp/` depuis le module généré ;
- `api/` et `mcp/` → `server/` et `schemas/` ;
- `server/` → la base, et en V2 les API des tiers (`server/connectors/`) ; `server/` n'importe ni `mcp/` ni `api/` :
  ce qu'ils partagent vit dans `schemas/` ou `server/` ;
- `migrations/` n'est importé par personne.

La frontière de `ui/` est appliquée par ESLint, avec un test. `src/` est l'hôte de référence : ce
qu'un ERP ou le SaaS écrit pour monter le paquet, rien de plus ; un appel à un service propre au
SaaS (Vercel, DNS, facturation) n'y entre que désactivé par une variable.

