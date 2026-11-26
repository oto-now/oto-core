# Story — Prise des connecteurs : table des connecteurs, coffre, secret à l'appel, témoin Notion

## Meta

| Champ | Valeur |
|-------|--------|
| **Épic** | Connecteurs et comptes (V2) |
| **Parcours** | 4.5 Administrer ; 4.2 Faire (exécution) |
| **Statut** | 🔵 In Progress |
| **Priorité** | Must (V2) |
| **Référence UI** | N/A (aucun écran : le secret se pose par l'outillage) |
| **Conventions** | database, supabase, security, deploy, testing, registry, mcp |
| **Estimation** | L |
| **Porteuse de migration** | oui (table `connectors`, clés étrangères, fonction `account_secret`) |
| **Dépend de** | E04-S01, E03-S04, E08-S05 (livrées dans la 1.0.0) |

## Contexte

> Le témoin `notion` est retiré du paquet par la story `moteur-des-connecteurs-decrits.md` : l'hôte déclare désormais
> ses connecteurs, et ses tests passent sur un connecteur décrit de test (AC11, AC18 et la fumée en dépendent).

Le paquet doit pouvoir exécuter un connecteur réel chez l'hôte : un compte réel, son secret chiffré par le paquet,
déchiffré par le serveur de l'hôte pour le seul appel au tiers. Ce lot pose cette prise, prouvée par un connecteur
témoin écrit à la main au contrat `defineFunction`, `notion`, fidèle à sa description YAML du dépôt `connectors`.
La fabrique de ce dépôt générera ensuite ce même contrat et remplacera le témoin (`connectors :
docs/conception/fabrique.md`). Elle reprend ce qui vaut encore de `comptes-tiers-et-coffre.md` (coffre AES-GCM à clé
dans l'environnement de l'hôte, secret jamais relu par un écran, le modèle ou le journal) et de `connecteur-sellsy.md`
(secret jamais dans les arguments ni le journal), écrites pour le service connecteurs distant abandonné (ADR-019).

**Périmètre**
- Une origine `connecteur` remplace `service_connecteurs` partout (catalogue, activation, résolution, `read`).
- Table `platform.connectors` et clés étrangères de `accounts`, `connector_activations` et `sim_outbox` vers elle.
- Coffre du paquet : AES-256-GCM, clé `PLATFORM_VAULT_KEY` de l'hôte, données associées = id du compte.
- Saisie du secret : service `setAccountSecret` (niveau gestion) et commande `oto-platform accounts secret` ; aucune
  route HTTP, aucun outil MCP.
- Secret à l'appel : `FunctionContext.credential`, déchiffré par `runCall` pour un compte réel et pour `run` seul.
- Client HTTP des connecteurs (`fetch`, délai, en-tête d'authentification, table d'erreurs) ; codes `rate_limited`
  et `upstream_error`.
- Témoin `notion.search_workspace` (classe `read`), inscrit au catalogue du paquet.

**Hors périmètre**
- La fabrique et le paquet npm des connecteurs partagés : dépôt `connectors`.
- Les autres fonctions Notion, le connecteur mail réel (`connecteur-mail.md`), Sellsy (`connecteur-sellsy.md`).
- L'écran de saisie du secret, OAuth du tiers, santé et sondes d'un compte (`ecran-connecteurs.md`,
  `sondes-et-alertes.md`) ; un 401 ou 403 du tiers ne change pas l'état du compte dans ce lot.
- Les comptes `sandbox` : toujours refusés à la création (`unavailable_in_v1`).
- L'export du contrat de connecteur côté hôte (`defineFunction`).

**Refs :**
- PRD : FR-ADMIN-02, FR-ADMIN-05, NFR-ADMIN-01
- Conception : `docs/conception/connecteurs-et-comptes.md` (H85 révisé), `docs/conception/base-et-portabilite.md`
- Description du témoin : `connectors : connectors/notion/connector.yaml`

## Critères d'acceptation

Origine et catalogue
- [ ] **AC1** **Given** le catalogue **When** `read` sert le contrat de `mail.send_draft` **Then** il dit
  « origin connecteur » ; aucune fonction ne porte plus `service_connecteurs`.
- [ ] **AC2** **Given** une organisation **When** elle liste les connecteurs activables **Then** `mail` et
  `notion` y sont ; `notion` s'active comme `mail`.

Table des connecteurs (migration)
- [ ] **AC3** **Given** la migration appliquée **When** on insère un compte, une activation ou un brouillon simulé
  d'un connecteur absent de `platform.connectors` **Then** la base refuse (`23503`).
- [ ] **AC4** **Given** un hôte déjà installé dont les tables nomment des connecteurs **When** la migration
  s'applique **Then** elle réussit : chaque nom déjà cité, `mail` et `notion` sont dans `connectors` avant les clés.
- [ ] **AC5** **Given** une session `authenticated` **When** elle lit `connectors` **Then** elle lit toutes les
  lignes ; une écriture est refusée.

Coffre et saisie du secret
- [ ] **AC6** **Given** `PLATFORM_VAULT_KEY` **When** un secret est chiffré puis déchiffré pour le même compte
  **Then** il revient identique ; un chiffré présenté pour un autre compte, ou sous une autre clé, est refusé.
- [ ] **AC7** **Given** l'hôte sans `PLATFORM_VAULT_KEY` **When** il démarre **Then** rien n'échoue ; **When** un
  secret se chiffre ou se déchiffre **Then** `PlatformConfigError` nomme la variable.
- [ ] **AC8** **Given** une personne qui gère un compte réel **When** `setAccountSecret` **Then** le chiffré est écrit
  et rien du secret n'est rendu ; sans le niveau gestion → `forbidden` ; compte simulé → `invalid_arguments`.
- [ ] **AC9** **Given** la commande `oto-platform accounts secret --db-url <url> --account <id>` et le secret sur
  l'entrée standard **When** elle tourne **Then** le chiffré est écrit et la commande ne l'affiche jamais ; compte
  inconnu ou simulé, clé absente → code 1.
- [ ] **AC10** **Given** la migration appliquée **When** `platform.account_secret(id)` est appelée par un membre de
  l'organisation du compte **Then** elle rend le chiffré ; par une personne d'une autre organisation **Then** rien ;
  `select secret_ciphertext` reste refusé à `authenticated`.

Secret à l'appel
- [ ] **AC11** **Given** un compte réel `notion` avec son secret **When** `call notion.search_workspace` **Then** la
  fonction reçoit le secret déchiffré dans `credential`, et lui seul.
- [ ] **AC12** **Given** un compte réel sans secret **When** `call` **Then** `not_enabled` « Account « X » has no
  secret yet. Ask … to set it. », la fonction non appelée.
- [ ] **AC13** **Given** un compte simulé d'un connecteur réel **When** `call` **Then** `not_enabled`, la fonction non
  appelée ; `createAccount` refuse un compte simulé pour un connecteur réel (`invalid_arguments`) et admet le mode réel.
- [ ] **AC14** **Given** un compte réel `mail` **When** `call mail.create_draft` **Then** toujours refusé
  (`unavailable_in_v1`), rien n'est écrit ; `createAccount` d'un compte réel `mail` → `unavailable_in_v1`.
- [ ] **AC15** (NFR-ADMIN-01) **Given** un compte dont le secret est posé **When** `listOrgAccounts`, `context`, la
  ligne de journal de `call`, `read` du contrat ou l'export de l'organisation **Then** ni le secret ni son chiffré
  n'y apparaissent.

Client HTTP et erreurs
- [ ] **AC16** **Given** le client HTTP **When** il appelle le tiers **Then** il pose `Authorization: Bearer <secret>`,
  les en-têtes constants du connecteur et un délai ; 400 → `invalid_arguments`, 401/403 → `upstream_error` (message
  clair, état du compte inchangé), 404 → `not_found`, 409 → `conflict`, 429 → `rate_limited`, 5xx et autre →
  `upstream_error` ; une panne de `fetch` ou un délai dépassé → `upstream_error` ; aucun message d'erreur ni log ne
  porte le jeton ni la requête.
- [ ] **AC17** **Given** la liste fermée des codes **When** on la lit **Then** `rate_limited` (429) et `upstream_error`
  (502) s'y ajoutent ; aucun code ne change.

Témoin Notion
- [ ] **AC18** **Given** `notion.search_workspace` **When** elle court **Then** elle envoie `POST
  https://api.notion.com/v1/search`, en-tête `Notion-Version: 2025-09-03`, corps `{query, filter, sort, start_cursor}`
  sans clé absente, et rend une ligne par résultat (type, titre, id, adresse) et `next_cursor`.

## Implémentation

### Fichiers à créer
- `packages/plateforme/migrations/20261006090000_platform_connecteurs.sql` (et sa copie `supabase/migrations/`)
- `packages/plateforme/cli/vault.mjs` : format du chiffré, partagé par le serveur et la commande
- `packages/plateforme/cli/account-secret.mjs` : la commande `accounts secret`
- `packages/plateforme/server/connectors/vault.ts`, `server/connectors/http.ts`
- `packages/plateforme/server/connectors/notion/search-workspace.ts`
- Tests : `tests/unit/connectors-vault.test.ts`, `tests/unit/connectors-http.test.ts`,
  `tests/unit/notion-search.test.ts`, `tests/unit/cli-account-secret.test.ts`, `tests/integration/prise-des-connecteurs.test.ts`

### Fichiers à modifier
- `server/` : `catalog/define.ts`, `catalog/registry.ts`, `calls.ts`, `errors.ts`, `connectors/{accounts,activations,
  modes,resolution}.ts`, `connectors/simulated/mail.ts`, `database.ts`, `index.ts`
- `mcp/admin/tools/connector.ts` (texte de la création d'un compte)
- `cli/index.mjs`, `package.json` (1.5.0), `README.md`, `CHANGELOG.md` du paquet ; `.env.example`
- `scripts/lib/org-transfer.mjs` (`connectors` jamais exportée)
- Tests existants qui nomment l'origine, un connecteur arbitraire en base ou la liste des connecteurs activables
- Docs : `docs/conception/connecteurs-et-comptes.md`, `docs/reference/schema-platform.md`,
  `packages/plateforme/migrations/README.md`, une entrée dans `docs/changelog.d/`, registry

### Patterns à suivre
- `database-patterns.md § Règles SECURITY DEFINER`, `§ Règles` (additive, rollback en commentaire)
- `security-patterns.md § Environment Variables & Secrets`, `§ Droits dans le service`
- `supabase-patterns.md § Couplage à Supabase` (aucun `fetch` dans un `db.tx`)

## Rayon d'impact

### Appelants
- Origine `service_connecteurs` — `rg -n "service_connecteurs" packages tests docs` → `catalog/define.ts`, `catalog/registry.ts`
  (`isActive`, `callExamples`), `calls.ts`, `connectors/resolution.ts` (`chooseTeam`, `runningTeam`),
  `connectors/activations.ts`, `connectors/simulated/mail.ts`, et les tests `catalog`, `connectors-*`, `find`,
  `mail-simulated`, `nodes-read`, `factories/test-functions` : renommés en `connecteur`, comportement inchangé.
- `requireSimulated` — `rg -n "requireSimulated"` → `calls.ts` (retiré), `simulated/mail.ts` (gardé).
- `createAccount` — `rg -n "createAccount"` → `api/admin/accounts.ts`, `mcp/admin/tools/connector.ts`,
  `ui/admin/connecteurs/creation-de-compte.tsx` (mode `simule` par défaut) : seul le texte de l'outil admin change.
- Tables `accounts`, `connector_activations`, `sim_outbox` — `rg -n "into platform\.(accounts|connector_activations|sim_outbox)"`
  → tests qui insèrent `test`, `crm`, `sellsy`, `c_<hex>` : passés à `mail` ou `notion`.

### Doublons
- Chiffrement : aucun coffre existant (`rg -n "createCipheriv|aes-256-gcm"`) ; le chiffré du cookie de session de
  l'hôte vit dans `src/`, hors du paquet. Le format vit une fois, dans `cli/vault.mjs`, lu par le serveur et la CLI.
- Client HTTP : `uploads-fetch.ts` (adresse fournie, sans authentification), `files/s3.ts` (signature S3) ne servent
  pas un tiers authentifié ; `readBounded` est réutilisé pour borner la réponse.

### Effet produit
- `read` d'une fonction de connecteur dit « origin connecteur » ; `find`, `call` et `context` listent `notion`
  parmi les connecteurs activables ; l'écran Connecteurs le montre (création d'un compte simulé refusée pour lui).
- Migration additive à appliquer par chaque hôte ; une référence à un connecteur inconnu devient un refus.

### Refacto
- Écarté : donner le mode par défaut d'un compte selon son connecteur (le schéma partagé avec l'écran le pose à
  `simule`) ; l'écran ne crée pas de compte réel dans ce lot.

## Tests attendus

### Unit tests
- [ ] Coffre : aller-retour, données associées échangées refusées, mauvaise clé refusée, clé absente (AC6, AC7).
- [ ] Client HTTP, `fetch` simulé : en-têtes, délai, statuts traduits, aucune fuite du jeton (AC16).
- [ ] Témoin : forme de la requête et du rendu (AC18).
- [ ] Liste des codes (AC17) ; origine servie par `read` (AC1) ; modes refusés par `createAccount` (AC13, AC14).
- [ ] Commande `accounts secret` sur un client simulé : chiffré qui s'ouvre au serveur, rien d'affiché, refus (AC9).

### Integration tests
- [ ] `runCall` : compte réel reçoit son secret, compte réel sans secret refusé, compte simulé sur connecteur réel
  refusé, `mail` sur compte réel refusé (AC11 à AC14).
- [ ] Clé étrangère, `account_secret` d'une autre organisation, `select secret_ciphertext` refusé (AC3, AC5, AC10).
- [ ] NFR-ADMIN-01 sur `listOrgAccounts`, `context`, journal de `call`, `read`, export (AC15).
- [ ] Les suites qui demandent la migration se sautent par `pendingMigrations()` tant qu'elle manque au projet.

## Actions réservées (service extérieur, vrai secret, publication)
- Fumée réelle du témoin Notion avec un vrai jeton d'intégration (hors CI).
- Poser `PLATFORM_VAULT_KEY` chez chaque hôte qui pose un compte réel ; appliquer la migration de la 1.5.0.

## Post-implémentation

### Écarts avec la conception
- `docs/conception/connecteurs-et-comptes.md` révisé (H85, E03-S04 N5, « Coffre et secret à l'appel », décisions,
  écarts, historique).

### Composants créés
| Composant/Hook/Action | Path | Notes |
|----------------------|------|-------|
| `setAccountSecret`, `accountCiphertext` | `packages/plateforme/server/connectors/accounts.ts` | secret posé (niveau gestion) ; chiffré lu pour l'appel |
| `isSimulatedConnector` | `packages/plateforme/server/connectors/modes.ts` | liste des connecteurs simulés |
| `encryptSecret`, `decryptSecret` ; `sealSecret`, `openSecret`, `parseVaultKey` | `server/connectors/vault.ts` ; `cli/vault.mjs` | coffre, format partagé |
| `requestJson` | `packages/plateforme/server/connectors/http.ts` | client HTTP des connecteurs réels |
| `notionSearchWorkspace` | `packages/plateforme/server/connectors/notion/search-workspace.ts` | témoin |
| `mask`, `urlPassword` | `packages/plateforme/cli/masking.mjs` | sortis de `db-prepare.mjs`, partagés avec `accounts secret` |

### Notes
- Hypothèses : un compte simulé d'un connecteur réel est refusé dès sa création ; un compte `sandbox` posé par
  l'outillage sur un connecteur réel court avec son secret (aucune création ne le permet) ; `account_secret` suit
  `member_orgs()`, accès plateforme en cours compris, comme la RLS ; le schéma du témoin borne `query` (1 000) et
  `start_cursor` (500), absents de la description YAML ; le témoin rend type, titre, id et adresse, pas les
  propriétés (les données d'un résultat sont plafonnées à 20 000 caractères).
- `account_secret` garde le nom fixé au cadrage, sans verbe, comme `member_orgs` et `org_contact`.

