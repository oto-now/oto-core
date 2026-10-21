# Tests et données de démonstration

- **Statut** : proposé
- **Dernière révision** : 2026-10-01

## Résumé

La suite tient au minimum vital : un test par règle, sa frontière si elle est le risque ; le contrat MCP, l'isolation, les droits, les secrets, les fonctions `definer` et les verrous restent toujours testés.
Un service écrit en SQL se teste sur une vraie base, avec des organisations et des personnes jetables ; la suite portable tourne sur un Postgres nu, seules les suites de l'adaptateur Supabase gardent le projet.
L'organisation « Démo » se sème par un script d'outillage rejouable, en données fictives.

## Contexte

Le paquet s'installe chez des hôtes qui n'ont pas tous Supabase ([base et portabilité](base-et-portabilite.md)) ;
plusieurs agents testent en même temps sur les mêmes bases ; le texte servi aux assistants pilote
leur comportement. Il faut donc des tests qui prouvent sur une vraie base ce que la base refuse,
qui ne se gênent pas entre eux, et qui figent mot pour mot ce que lit le modèle. La méthode de test
au quotidien (budget, emplacement, base locale) est dans `.method/conventions/testing-strategy.md`.

## Objectifs et non-objectifs

- Prouver droits et isolation sur une base qui rend des lignes interdites, jamais sur une simulation seule.
- Faire tourner la suite portable sur tout Postgres, en CI comme en local.
- Une organisation de démonstration rejouable, sans donnée réelle.
- Hors objectif : couvrir chaque cas d'usage par un test ; les campagnes sur les hosts réels (Claude, ChatGPT, Mistral), qui se jouent à part (H122).

## Conception

### Budget et ce qui est toujours testé

- La suite de tests est tenue au minimum vital : un test par règle, sa frontière si elle est le risque ; restent toujours testés le gate de commit, le contrat MCP figé, l'isolation et les droits, les secrets, les fonctions `definer`, les verrous (D33 ; `testing-strategy.md § Budget de tests`).
- Tout texte servi au modèle (description, refus, consigne d'un résultat MCP) se teste mot pour mot ; un message interne ne se compare jamais (P14).
- Toute modification d'un outil, d'une description ou d'une procédure ajoute ses lignes à `docs/reference/mcp-golden-queries.md` ; le routage est rejoué sans host dans les tests, et les campagnes sur les hosts se jouent à part (H122, [référence](../reference/mcp-golden-queries.md), [routage et recherche](routage-et-recherche.md)).

### Sur une vraie base

- Un service écrit en SQL se teste sur une vraie base qui rend des lignes interdites : le projet Supabase en local, un Postgres nu en CI (`bare-postgres`), sans Supabase Auth, par `asCaller` et la connexion d'administration (D76).
- Les tests créent leurs organisations et personnes jetables (`t<hex>`, `test-<hex>@example.invalid`) et les nettoient après chaque passage ; deux agents testent en même temps ; les suites portables tournent aussi sur un Postgres nu (H120).
- Les tests de bout en bout sèment leurs propres données (une organisation jetable par campagne), et l'espace Démo est vidé de ses contenus et de ses équipes à leur fin (D127, [droits d'accès](droits-d-acces.md)).
- La suite d'isolation de deux organisations et ses règles de preuve : [droits d'accès](droits-d-acces.md) (choix de la story E09-S05).

### Harnais sans Supabase

Les suites du paquet tournent sur un Postgres nu ; seules celles de l'adaptateur Supabase (Auth,
serveur OAuth, Data API, outillage à comptes) gardent le projet.

- L'identité d'une suite portable est un jeton de la forme « supabase » du port (`sub` = identifiant interne), signé par une clé locale (`testIssuer`) et vérifié par `makeVerifyToken({ jwks, issuer })` injecté ; les personnes viennent de `createSqlFixtures` ; aucun service joint (HN-E11S14-1).
- La vérification d'un vrai jeton par la JWKS du projet est un `it` explicite de `mcp-core`, gardé par le projet (session par `createFixtures().sessionFor`) (HN-E11S14-4). AC1 et AC2 de `portabilite-schema` (lecture d'`auth.users` et `auth.oauth_*`) restent sur le projet, entiers (HN-E11S14-5). Le `describe` principal d'`org-transfer` (export et import par les emails des comptes Auth) reste sur le projet, inchangé ; seul le `describe` AC14 passe sur la base portable (HN-E11S14-9).
- `api-invitations` pose `NEXT_PUBLIC_SUPABASE_URL` et `NEXT_PUBLIC_SUPABASE_ANON_KEY` par `vi.stubEnv` (adresse en `.invalid`), `signInWithOtp` restant espionné : le client se construit, rien n'est joint (HN-E11S14-3).
- `tests/unit/gardes-supabase.test.ts` lit les noms importés par `import {…} from`, `export {…} from` et un import dynamique déstructuré (`const {…} = await import(…)`), alias et `type` retirés (HN-E11S14-6). Sa liste est fermée dans les deux sens : un fichier qui importe une garde sans y être échoue, une ligne dont le fichier n'en importe plus échoue aussi ; les lignes « pending » des lots b et c en sont sorties avec leur lot (HN-E11S14-7).
- Les noms de `describe` passés sur la base portable qui disaient « on the cloud project » disent « on a real database » ; rien d'autre de leur nom ne change (HN-E11S14-8).

### Organisation « Démo »

- L'organisation « Démo » est semée par `pnpm demo:seed`, script d'outillage rejouable jamais importé par `server/`, `api/` ni `mcp/` ; tout type de donnée nouveau y ajoute sa part, en données fictives (H121).
- Le compte `E2E_USER_EMAIL` est créé s'il manque, jamais modifié s'il existe (mot de passe, métadonnées) ; le script Démo n'en pose que l'appartenance et la responsabilité dans la Démo (E01-S05 N2).
- La suite d'isolation se sème par un mode OIDC du script Démo, sur le motif de `platform:staff` (fiche D77 A, [identité et connexion](identite-et-connexion.md)), `--user` exigé ; confirmé par le pilote le 2026-09-30 (HN-E11S14-2). `--user` n'admet qu'un `uuid`, contrôlé par `parseArgs` avant toute connexion (code 1, « Identifiant invalide ») : la base le refuserait après la création de l'organisation (HN-E11S14-10).
- Le mode OIDC du script Démo ne vérifie pas que l'identifiant de `--user` est lié à un sujet dans `identities` (contrairement à `platform:staff add --user`) : un jeton de test de la forme « supabase » ne pose sa ligne qu'au premier passage par une porte (HN-E11S14-11). En mode OIDC, `members.name` et `profile.name` de la personne E2E valent « Compte E2E » (HN-E11S14-12).
- Les deux refus de la ligne de commande du mode OIDC se jouent dans `demo-seed-oidc.test.ts`, hors garde ; leurs messages sont exportés par le script (`USER_WITHOUT_OIDC`, `OIDC_WITHOUT_USER`) et comparés à la sortie entière (HN-E11S14-13).

### Variables et aides de test

- Ordre des sources de variables des scripts et des tests : environnement du processus, puis `.env.local`, puis `.env` ; les tests passent leurs comptes jetables par l'environnement (E01-S05 N4).
- Une aide de test partagée porte un nom unique dans `tests/helpers/` ; une aide propre à un lot prend un nom neuf préfixé par son lot, ou vit dans son module `tests/helpers/<lot>.ts` (P28).
- La base simulée des tests unitaires (`tests/helpers/simulated-db.ts`) et l'organisation de référence (`tests/helpers/reference-org.ts`) : [droits d'accès](droits-d-acces.md) (HN-E01S07-5, HN-E01S07-20).

## Décisions et alternatives écartées

- **Tester les droits sur une base simulée seule** : écarté, une simulation sans règle d'accès ne prouve pas ce que la base refuse (D76) ; la base simulée ne sert qu'aux tests unitaires.
- **Garder toute la suite sur le projet Supabase** : écarté par le harnais sans Supabase (story E11-S14, décision du 2026-09-29) ; seules les suites propres à l'adaptateur Supabase gardent le projet.
- **Une organisation Démo partagée par les tests de bout en bout** : écartée, chaque campagne sème ses données et la Démo est vidée à la fin (D127).
- **Comparer les messages internes** : écarté, seul le texte servi au modèle se compare mot pour mot (P14).

## Sécurité et confidentialité

- Données de test et de démonstration fictives seulement ; adresses en `example.invalid`.
- L'outillage (Démo, nettoyage) passe par la connexion d'administration, jamais importée par le paquet ni présente dans l'environnement de l'application déployée ([base et portabilité](base-et-portabilite.md)).

## Écart avec le code

- Élagage des tests au minimum vital pour les fichiers postérieurs au dernier élagage (M11c).
- Aides de la base de test (`seed.cleanup`, `valuesOf`, `ref.write`) et aides recopiées (M24, M25, M15b).
- Un mode sans Supabase pour `org:export`, `org:import`, `test:cleanup` et `oauth:clients`, dont le verrouillage du mode Supabase par deux lancements de `scripts/demo-seed.mjs` (M85).
- Ménage des bases `test_agent_*` du Postgres du poste (M62) ; tests qui échouent quand d'autres sessions travaillent dans le même checkout (M76) ; écart d'horloge entre la base et Node dans `uploads` (M98) ; un service MinIO dans la CI pour l'adaptateur S3 réel (M88).

## Questions ouvertes

Aucune à ce jour.

## Historique

- 2026-09-28 : les tests de bout en bout sèment leurs propres données, la Démo est vidée — décidé par JB (source : fiche D127).
- 2026-09-29 : suite au minimum vital, tests sur vraie base, données jetables, organisation Démo rejouable, livrés dans la 1.0.0 — décidé par JB et le pilote (source : fiches D33, D76, choix H120, H121, story E01-S05).
- 2026-09-29 : harnais de test sans Supabase, les suites du paquet sur un Postgres nu ; mode OIDC du script Démo confirmé le 2026-09-30 — décidé par le pilote (source : story E11-S14).
- 2026-10-01 : refonte en document de conception vivant, qui reprend les fiches D33, D76, les choix H120, H121, H122, P14, P28 et des stories E01-S05, E11-S14 — décidé par Alexis, accord de JB.
