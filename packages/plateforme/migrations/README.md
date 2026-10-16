# migrations/

Le SQL de ce dossier ne touche que le schéma `platform` et ne fait qu'ajouter (ADR-006).

L'application hôte copie ces fichiers dans `supabase/migrations/` et les applique par son
propre workflow (`supabase db push`, sur Supabase comme sur un Postgres sans Supabase).

## Fichiers

- `20260928090000_platform_pg_trgm.sql` (version 1.3.0) : avant la ligne de base, la bibliothèque de `pg_trgm`
  chargée dans la session qui applique les migrations (`create extension if not exists`, puis un appel à
  `extensions.similarity`). La ligne de base et la 1.1.0 créent des fonctions dont l'en-tête pose
  `set "pg_trgm.similarity_threshold"`, ce qu'un rôle non superutilisateur ne peut faire que si la session a chargé
  la bibliothèque : sans ce fichier, `supabase db push` s'arrêtait à la ligne de base sur un projet Supabase
  (42501). La CLI applique tous les fichiers en attente sur une seule session : joué le premier, il la charge pour
  eux. Seule migration datée avant la ligne de base, ces deux fichiers étant publiés, donc figés. Un hôte déjà
  installé la reçoit par `supabase db push --include-all`, une fois (« Hôtes déjà installés : la migration
  préalable de la 1.3.0 »). Aucune table, colonne, fonction ni index.
- `20260928100000_platform_base_v1.sql` (E01-S12, partie d ; fiche D102 ; ADR-012 § 1) : la ligne de base
  de la V1, tout le schéma `platform` en un fichier. Elle replie la ligne de base d'E01-S09
  (`20260925230100_platform_base.sql`, qui remplaçait la chaîne de vingt migrations d'E01-S02 à E01-S09)
  et les six migrations écrites après elle : `20260926084500_platform_identites.sql` (émetteur
  configurable, `platform.identities`, E01-S11), `20260926110000_platform_recherche.sql` (routage par
  index, lexique, E01-S13), `20260927090000_platform_proprietaires.sql` (gardes du propriétaire, M26),
  `20260927150000_platform_espace_prive.sql` (espace personnel « Privé », M45),
  `20260927190000_platform_corbeille_partage.sql` (ordre des frères, corbeille, partage public par lien,
  accès général, E05-S10, ADR-013, ADR-014) et `20260927200000_platform_retraits_v1.sql` (retraits en
  deux temps d'E01-S12 partie c, ADR-006 § 2). Même schéma, mêmes privilèges : comparés sur deux
  Postgres 16 nus, préparés comme un hôte Supabase, contre la chaîne complète de l'historique (vingt-six
  migrations) comme contre la ligne de base d'E01-S09 suivie des six (story E01-S12, AC-d2). Elle
  s'installe sur Supabase comme sur un Postgres nu (job `bare-postgres`) : ni `moddatetime` (le Postgres
  managé de Scaleway la refuse), ni table `auth.users`, ni clé vers elle ; `updated_at` avance par
  `platform.set_updated_at()` ; l'email et le nom d'une personne sont des copies, dans `members`,
  `platform_staff` et `platform_grants` ; une personne s'oublie par `platform.forget_user(id)`. Aucun
  privilège à `service_role` : l'outillage passe par la connexion d'administration, le serveur par
  `platform_app` ; `supabase_auth_admin` reçoit le hook d'inscription, dans un bloc qui vérifie d'abord
  que le rôle existe.
  Produite par `pg_dump --schema-only --schema=platform --no-owner` (PostgreSQL 16) d'une base où la
  chaîne était appliquée, puis normalisée : commentaires, lignes psql et réglages de session de pg_dump
  retirés ; `check_function_bodies` coupé le temps du fichier ; les trois extensions en tête ; une ligne
  de section par genre d'objet ; la contrainte `blocks_key_check` gardée avec son `between`, que pg_dump
  écrit en deux comparaisons et que Postgres relirait aplaties. Elle ne porte aucune donnée : les mises
  à jour de données des migrations repliées (lexique rempli, espaces renommés « Privé », clés de profil
  retirées) n'ont rien à changer sur une installation neuve. Toute migration nouvelle vient après elle,
  horodatage postérieur, et ne fait qu'ajouter (`pnpm check:migrations`) ; seule `20260928090000` la précède.
- `20260928110000_platform_profil.sql` (E05-S11, lot a ; page « Profil ») : `update_my_profile`
  re-versionnée avec sa signature et ses privilèges. La fiche d'une personne prend, en plus du nom et de la
  langue, son prénom (`first_name`) et son nom de famille (`last_name`), 80 caractères chacun, et sa couleur
  (`theme`, un des huit thèmes du jeu Oto) ; écrire le prénom ou le nom de famille recompose `name`
  (« Prénom Nom »), que lisent tous les lecteurs du nom ; les deux vidés retirent `name`. Aucune table ni
  colonne.
- `20260928120000_platform_private.sql` (E05-S11, lot h ; fiche D107 b) : le dossier des espaces
  personnels passe de `perso` à `private`. `is_context_path`, `create_org`, `unique_handle`,
  `members_tree_sync` et `nodes_guard` re-versionnées (mêmes signatures), la policy
  `nodes_delete_manager` recréée, `private` ajouté aux slugs d'équipe réservés (`perso` y reste). Les
  nœuds `perso` et `perso/…` changent de chemin comme par un déplacement : chaque ancien chemin devient
  un alias du nœud (`node_aliases`), `updated_at` ne bouge pas. S'arrête, sans rien changer, sur une
  organisation dont une équipe ou un nœud tient déjà `private`.
- `20260929090000_platform_e05s13.sql` (E05-S13, lot M ; fiches D127, D128) : plusieurs responsables par
  équipe, `team_members.role` seule source du responsable (`node_level_of` le lit, `team_members_guard` ne
  le recalcule plus ni ne refuse de retirer un responsable) ; une écriture héritée de `teams.lead_user_id`
  (`teams_lead_sync`) nomme la personne responsable sans retirer les autres, puis remet la colonne à `null`.
  L'équipe par défaut n'est plus écrite (`accept_invitations` ; `authenticated` perd l'écriture de
  `members.default_team_id`) et la colonne est vidée ; colonnes `teams.lead_user_id` et
  `members.default_team_id` gardées jusqu'à leur retrait en 1.1 (ADR-006 § 2). `create_org` et
  `members_tree_sync` posent le résumé du Contexte au modèle par portée ; un résumé resté l'ancien texte
  généré est remplacé, `updated_at` gardé. Mêmes signatures, privilèges redits ; aucune table, colonne,
  policy ni index.
- `20260930100000_v1_1_0.sql` (version 1.1.0 ; fiches D124, D131, D145) : les six migrations des epics E10 et
  E11, écrites une par story pendant le développement puis réunies avant le tag, au contenu identique, dans
  l'ordre de leurs horodatages ; une bannière nomme la story et le fichier d'origine de chaque partie, un seul
  bloc `-- ROLLBACK:` en fin de fichier les reprend dans l'ordre inverse. Aucune version publiée ne portait les
  six fichiers d'origine (§ « Hôtes qui avaient appliqué une migration de la 1.1.0 »).
  1. E11-S04, lot a (`20260929140000_route_candidates_formulations.sql`) : `platform.lexicon_fix(org, mot)`,
     la correction d'un mot de 5 à 40 lettres par le mot le plus proche du lexique de l'organisation
     (trigrammes ≥ 0,3), exécutable par aucun rôle client ; `route_candidates` remplacée (même porte, deux
     colonnes de plus, `s_phrase` et `lexical_title` : formulations du résumé cherchées une à une, lexèmes
     pesés par leur rareté, titre compté à part, demande corrigée par `lexicon_fix`, nœud à la corbeille
     jamais présélectionné) ; `search_content` recréée, sa correction par `lexicon_fix` et la corbeille
     écartée avant la coupe (M58). Privilèges redits ; aucune table, colonne, policy ni index.
  2. E11-S10, lot a (`20260929160000_private_spaces.sql`) : l'espace « Privé » de chaque membre dès sa
     première connexion. `platform.ensure_private_space(org, user)`, `security definer`, accordée à
     personne (`revoke` de `public`, aucun `grant`) : sans dossier `private` ni ligne `members`, elle
     rend sans rien écrire ; sinon elle pose le handle manquant (`unique_handle`, depuis
     `members.email`), puis crée `private/<handle>` et son Contexte s'ils manquent ; un espace tenu par
     une autre personne n'est pas touché, un second appel n'écrit rien. `members_tree_sync` l'appelle
     (signature et privilèges inchangés, déclencheur inchangé). La migration répare tous les membres,
     un à la fois, pour que `unique_handle` voie les handles posés aux tours précédents. Aucune table,
     colonne, policy ni index.
  3. E10-S04 (`20260929170000_platform_page_markdown.sql` ; fiches D111 b, D114, D115) : `blocks_type_check`
     et `blocks_shape_check` élargies en une instruction. Trois types de bloc : `simple_table` (`columns`,
     `rows`, `align` facultatif ; 1 à 20 colonnes, 200 rangées, cellules d'une ligne sans blanc de bord, `|`
     écrit `\|`), `divider` (`text` nul) et `toggle` (`data.summary` d'une ligne, 200 caractères ; corps dans
     `text`, sans ligne blanche de bord ni ligne `<details…` ou `</details>`). Un élément de `list` est une
     chaîne ou `{text, children: {items, ordered?, start?}}`, trois niveaux, 500 éléments en tout ;
     `heading.level` de 1 à 5. Toute ligne existante reste valide. `block_search_text` re-versionnée (même
     signature, privilèges redits) : sous-éléments, cellules et résumé d'un repli cherchables ; même texte
     qu'avant pour toute forme existante (`search_tsv` n'est pas recalculée). Aucune table, colonne, policy
     ni index.
  4. E11-S03, lot a (`20260929180000_ctx_contexts.sql` ; fiche D132) : colonne `platform.ctx.contexts jsonb`
     (contrainte `ctx_contexts_check` : nulle ou objet), la révision publiée de chaque Contexte servi à la
     conversation, `{<chemin>: <révision>}` ; un code périme quand l'un d'eux change, non plus par
     `orgs.rules_version`. Additive : un code émis avant est nul, donc périmé, et les conversations ouvertes
     au déploiement rappellent `context` une fois. Déclencheur, policies et index inchangés.
  5. E11-S02, lot d (`20260929190000_discard_draft.sql` ; ADR-011 § 3) : `platform.discard_draft(node,
     stamp)`, `security definer`, accordée à `authenticated` : refuse un nœud hors des organisations de
     l'appelant (`42501`), prend le verrou consultatif 7401 de `publish_node`, rend `55000` sans brouillon et
     `PT409` sur un tampon changé, puis supprime les blocs `draft` et la ligne `node_drafts` ; `nodes` et les
     blocs publiés ne bougent pas. Le droit (niveau écriture, nœud déjà publié) est décidé par le service.
     Aucune table, colonne, policy ni index.
  6. E10-S02 (`20260929200000_platform_files.sql` ; ADR-016, fiches D111, D113, D118) : les fichiers joints
     à un nœud. Table `files` (`org_id`, `node_id` en cascade, `name` de 1 à 255 caractères, `mime`, `size`
     de 1 octet à 50 Mo, `status` `pending` ou `ready`, `created_by`, `created_at` ; aucun octet, la clé
     d'objet vaut `<org_id>/<id>`), index `(org_id, status)` et `(node_id)`, RLS d'isolation par
     organisation (quatre policies, l'insertion attribuée à l'appelant sur un nœud de l'organisation),
     privilèges d'`authenticated` (mise à jour de `status` seule). `blocks_type_check` et
     `blocks_shape_check` élargies : bloc `file` (`{file_id, name, size, mime}`, `text` nul) ; `image.data`
     porte `src` ou `file_id`, jamais les deux, et `width` facultatif (`small`, `medium`, `full`). Toute
     ligne existante reste valide. `block_search_text` re-versionnée : le nom d'un fichier est cherchable,
     même texte qu'avant pour toute forme existante. `forget_user` re-versionnée : `files.created_by` mis à
     nul, les tickets de la personne supprimés. Mêmes signatures, privilèges redits.
     `public_file_by_token(org, token, file)`, `security definer`, `search_path` vide, accordée à `anon`
     seul (ADR-016 § 7, ADR-017 § 5) : lien actif, nœud du fichier publié, hors corbeille, dans le périmètre
     du lien et lisible par son auteur, fichier `ready` cité par un bloc publié (`file` ou `image`) de ce
     nœud ; rend `id`, `name`, `mime`, `size` et le chemin du nœud, ou rien, la même réponse pour tout
     refus. `duplicate_subtree` remplacée (retirée puis recréée aussitôt, mêmes arguments, mêmes contrôles,
     accordée à `authenticated`) : le type rendu gagne `copied_files`, les paires (ancien, nouveau) des
     fichiers de chaque nœud copié ; chaque fichier qu'un bloc publié d'un nœud copié cite reçoit une ligne
     neuve `pending` sous la copie, et le `file_id` des blocs copiés, donc de l'instantané de la copie, est
     réécrit (ADR-016 § 6, fiche D118) ; le service copie les objets après le commit et passe les lignes à
     `ready`. Table `upload_tickets` (ADR-018 ; empreintes SHA-256 des deux jetons, celui de `curl` et celui
     du formulaire, uniques, jamais un jeton ; personne, `ctx`, type, mode, destination et ses paramètres ;
     `expires_at`, `used_at`), index `(org_id, expires_at)`, RLS d'isolation par organisation (lecture de
     ses tickets et des tickets expirés, insertion attribuée à l'appelant, suppression d'un ticket expiré
     seulement ; aucune mise à jour) ; `consume_upload_ticket(org, empreinte, formulaire)`, `security
     definer`, `search_path` vide, accordée à `anon` seul : un `update` conditionnel sur l'empreinte du
     jeton de la porte appelante, qui sert le ticket une fois, par l'un ou l'autre jeton, rend la personne,
     son e-mail dans `members` et la destination, ou rien.
- `20260930150000_v1_1_3.sql` (version 1.1.3) : les migrations de la version, réunies dans ce fichier, chacune
  sous une bannière qui nomme sa story ; un seul bloc `-- ROLLBACK:` en fin de fichier, les parties dans l'ordre
  inverse.
  1. E11-S19 (ADR-002 § 2 amendé ; HN-E11S19-1) : l'auteur d'un Contexte n'est plus refusé par sa propre
     écriture ; `write` avance la ligne `ctx` de son code à la révision qu'il vient de publier
     (`acceptOwnContextWrite`, `server/ctx.ts`). Policy `ctx_update_own` sur `platform.ctx`, `for update` à
     `authenticated`, en `using` et `with check` : la ligne de l'appelant (`user_id = auth.uid()`) dans une de
     ses organisations (`member_orgs()`) ; `grant update (contexts)` à `authenticated`, sur cette seule colonne.
     Le reste (chemin attendu, révision précédente gardée, Contexte publié à la révision dite) est décidé par
     le service, dans la requête. Aucune table, colonne ni index.
  2. E11-S18 (HN-E11S18-13) : `functions` rejoint les slugs réservés d'une équipe (`teams_slug_reserved`,
     supprimée puis recréée avec la liste d'avant plus `functions`), comme `journal` : `read` y liste les
     fonctions. Une équipe dont le slug est déjà `functions` fait échouer cette partie : lui donner un autre
     slug dans la base (`update platform.teams set slug = …`) avant d'appliquer. Aucune table, colonne ni index.
- `20261001150000_v1_2_1.sql` (version 1.2.1) : `search_content` rend une colonne de plus, `block_total`, le nombre
  de blocs publiés du nœud que la recherche trouve, avant sa coupe à trois blocs par nœud (`null` sur une ligne
  de titre ou de résumé) : `find` dit les blocs qu'il ne montre pas. Le type rendu change : la fonction est
  retirée puis recréée aussitôt, mêmes arguments, mêmes privilèges, le reste à l'identique de 20260930100000.
  Elle commence par un appel à `extensions.similarity`, qui charge la bibliothèque de `pg_trgm` dans la session :
  sans lui, `supabase db push` refuse la clause `set "pg_trgm.similarity_threshold"` de la fonction sur un projet
  Supabase (42501). Aucune table, colonne ni index.
- `20261006090000_platform_connecteurs.sql` (version 1.5.0, prise des connecteurs) : table `connectors` (`name`
  clé, contrôlé comme `connector_activations.connector`, `label`), RLS active, lecture par `authenticated`
  (`connectors_select_authenticated`, `using (true)` : une liste de noms sans organisation), aucune écriture
  accordée ; ses lignes : `mail` et `notion`, puis chaque nom déjà cité par `accounts`, `connector_activations`
  et `sim_outbox`, insérés avant les clés, de sorte qu'un hôte installé l'applique sans échec (un nom hors du
  contrôle la fait échouer, en le nommant). Clés étrangères `accounts_connector_fkey`,
  `connector_activations_connector_fkey` et `sim_outbox_connector_fkey` vers `connectors(name)`, `on update
  cascade` (un renommage se fait à un seul endroit) et `on delete restrict` (un connecteur cité ne se supprime
  pas). `account_secret(compte)`, `security definer`, `search_path` vide, révoquée à `public` et `anon`, accordée
  à `authenticated` : le chiffré du secret au seul membre de l'organisation du compte (`member_orgs`), rien
  sinon ; `secret_ciphertext` reste sans droit de lecture. Pas de nouvelle colonne.
- `20261007090000_platform_connecteurs_declares.sql` (version 1.5.0, moteur des connecteurs décrits) :
  `declare_connector(nom, libellé)`, `security definer`, `search_path` vide, révoquée à `public` et `anon`, accordée à
  `authenticated` : ajoute à `connectors` le nom d'un connecteur que l'hôte déclare (`registerConnectors`), avant sa
  première activation ou son premier compte, `on conflict do nothing` (un nom présent ne change pas, libellé compris) ;
  réservée à un membre d'une organisation (`member_orgs`, sinon `42501`), le nom au motif de `connectors_name_check`, le
  libellé de 80 caractères au plus (`22023`). Aucune table, colonne ni policy. Fichier à part de `20261006090000`, déjà
  appliqué au projet de test ; les deux se fusionnent en `<horodatage>_v1_5_0.sql` avant le tag (D124).
- `20261008090000_platform_comptes_a_champs.sql` (version 1.5.0, comptes à plusieurs champs et réglages) : colonnes
  d'`accounts` `settings` (`jsonb`, `{}`, un objet, contrôle `accounts_settings_check`), `secret_fields` (`text[]`,
  `{}`), `secret_updated_at`, `token_ciphertext`, `token_expires_at`, `status_reason` (500 caractères au plus) ;
  `secret_updated_at` reprend `updated_at` pour un secret déjà posé ; droits de colonnes à `authenticated`, sans
  lecture de `token_ciphertext` ; `account_token(compte)`, `security definer`, `search_path` vide, révoquée à `public`
  et `anon`, accordée à `authenticated` : le chiffré du jeton au seul membre de l'organisation du compte. Fusionnée
  avec les deux précédentes avant le tag.
- `20261014090000_platform_premier_administrateur.sql` (premier administrateur d'une organisation créée par l'équipe
  plateforme, décision du 2026-10-14) : `seat_org_admin(org, personne, email, nom)`, `security definer`, `search_path`
  vide, révoquée à `public`, accordée à aucun rôle (interne, comme `org_skeleton`) : la ligne `members` au rôle `admin`
  (handle, email, nom), ou le rôle `admin` d'un membre présent ; rend `joined`, `promoted` ou `unchanged`.
  `signup_org` réécrite sur elle, même signature et même résultat. `claim_org_admin(org)`, `security definer`,
  `search_path` vide, révoquée à `public`, accordée à `authenticated` : l'appelant de l'équipe plateforme qui
  administre l'organisation (`is_staff()` et `is_org_admin`), email dans les claims, en devient membre `admin`, sinon
  `42501`. Aucune table, colonne ni policy.
- `20261014120000_platform_bloc_integration.sql` (version 1.4.3, bloc « Intégration ») : `blocks_type_check` admet
  `embed` ; `blocks_shape_check` lui ajoute sa forme (texte nul, `url` en `https://` de 9 à 2 000 caractères sans blanc
  ni guillemet, `height` facultative parmi `small`, `medium`, `large`). Les deux contraintes sont retirées puis reposées
  telles que les écrit la partie 3 de `20260930100000_v1_1_0.sql`, le type nouveau en plus : aucun bloc existant ne
  change. Aucune table, colonne ni fonction.
- `20261014130000_platform_chemin_help.sql` (version 1.4.3, guide de la plateforme) : `teams_slug_reserved` admet aussi
  `help`, le chemin où `read` sert le guide : une équipe dont le slug est déjà `help` fait échouer la migration, à renommer
  avant. Fichier à part de `20261014120000`, déjà poussée. Aucune table, colonne ni fonction.
- `20261016090000_platform_consentement.sql` (consentement d'une personne, `oauth2_user`) : `accounts.granted_scopes`
  (les droits accordés au dernier consentement ou renouvellement, en clair) ; la table `connector_consents`, les
  demandes de consentement en cours (empreinte SHA-256 du `state`, jamais le `state` ; personne, organisation,
  connecteur, écran de retour ; dix minutes, consommées une fois), sous RLS : chacun pose, lit et consomme les siennes,
  tout membre purge les échues. Les jetons se rangent dans les colonnes de `20261008090000`.

## Installer sur un hôte neuf

1. Sur un Postgres sans Supabase (Postgres managé de Scaleway, Postgres nu), une fois, par un rôle
   d'administration (`CREATEROLE`, droit de créer un schéma dans la base) :

   ```bash
   PLATFORM_APP_PASSWORD='<mot de passe du rôle platform_app>' pnpm exec oto-platform db prepare --db-url '<url>?sslmode=require'
   ```

   Elle pose ce que les migrations supposent sans le créer (elles ne touchent que `platform`) : les
   rôles `anon` et `authenticated`, le schéma `auth` avec `uid()`, `jwt()` et `role()` (ils lisent
   `request.jwt.claims`), le schéma `extensions` avec `pg_trgm`, `unaccent` et `ltree`, et le rôle
   `platform_app` (`login`, `noinherit`, membre d'`anon` et d'`authenticated`, ni `bypassrls` ni
   `createrole`), la connexion du serveur. Un second passage ne change rien ; une extension que
   l'hôte refuse arrête la commande en la nommant (code 1), comme une des trois déjà installée
   hors du schéma `extensions`. Sur Supabase, qui porte tout le reste, la commande ne crée que
   `platform_app`. La connexion passe en TLS, sauf `sslmode` écrit dans l'URL
   (`?sslmode=disable` pour un Postgres local sans TLS).
2. `pnpm exec oto-platform migrations sync --to supabase/migrations`, puis le workflow de
   migrations de l'hôte, ou `supabase db push --db-url '<url>?sslmode=require'`.

   La connexion est directe ou en mode session, jamais un pooler en mode transaction : la première
   migration (`20260928090000`) charge la bibliothèque de `pg_trgm` pour les fichiers suivants, ce qui
   ne vaut que sur une même session.

## Hôtes déjà installés : la migration préalable de la 1.3.0

`20260928090000_platform_pg_trgm.sql` est datée avant la ligne de base. Sur un hôte qui porte déjà des
migrations du paquet, `supabase db push` la refuse (« Found local migration files to be inserted before
the last migration on remote database ») : la pousser une fois avec `--include-all`.

```bash
npx supabase db push --db-url "$DB_URL" --include-all --dry-run   # la migration préalable, et celles de la version
npx supabase db push --db-url "$DB_URL" --include-all
```

Elle n'y change rien (l'extension existe déjà). Les migrations écrites après elle qui posent un paramètre
de `pg_trgm` chargent la bibliothèque elles-mêmes (`pnpm check:migrations` le contrôle) : un hôte déjà
installé n'en dépend pas.

## Hôtes déjà installés : marquer la ligne de base V1 appliquée

Un hôte qui a appliqué la chaîne jusqu'à `20260927200000_platform_retraits_v1.sql` porte déjà le schéma
de la ligne de base V1 : elle ne se rejoue pas (son `create schema platform` échouerait), elle se
**marque appliquée**, et les versions repliées sortent de son historique. Rien ne s'exécute sur le
schéma : seul l'historique change. Concerne notre projet Supabase et l'ERP du premier client ; une
installation neuve n'a rien à faire. La procédure se lance à la main par qui exploite l'hôte, jamais
par la CI : **avant** la poussée qui apporte la ligne de base dans `supabase/migrations/`, sinon
`supabase db push` (workflow oto-saas : `supabase-migrations.yml` pour notre projet) refuse, l'historique nommant
des versions que le dossier n'a plus (`Remote migration versions not found in local migrations
directory`), sans rien appliquer.

Préalable : la dernière migration de la chaîne est appliquée (`supabase migration list` la montre
côté base). Depuis un terminal Git Bash, à la racine d'un dépôt dont `supabase/migrations/` ne porte
que la ligne de base V1, `DB_URL` posée à la connexion directe de l'hôte, rôle propriétaire du schéma
(`postgres` sur Supabase ; `?sslmode=require` sauf réseau local) :

```bash
# 1. Sauvegarde de l'historique, hors du dépôt
npx supabase db query --db-url "$DB_URL" -o json "select version, name from supabase_migrations.schema_migrations order by version" > ../historique-migrations-avant-v1.json

# 2. Vérification du schéma : le schéma platform de l'hôte, contre celui d'un Postgres jetable de la
#    même version majeure (PG_MAJOR, lue sur l'hôte) où la ligne de base V1 est seule appliquée. Le
#    même client lit les deux bases, deux fois : pg_dump sans les privilèges (il les écrit dans l'ordre
#    de l'ACL de chaque objet, qui diffère d'une base à l'autre), puis la liste triée des privilèges,
#    où une ACL absente se lit à son défaut (acldefault). Sur Supabase, le Postgres jetable reçoit aussi
#    le rôle supabase_auth_admin, qui porte le hook d'inscription.
PG_MAJOR="$(docker run --rm postgres:16 psql "$DB_URL" -Atc "select current_setting('server_version_num')::int / 10000")"
docker run -d --name v1-ref -e POSTGRES_HOST_AUTH_METHOD=trust -p 127.0.0.1:55499:5432 "postgres:$PG_MAJOR"
until docker exec v1-ref pg_isready -q -h 127.0.0.1 -U postgres; do sleep 1; done   # le serveur a fini de démarrer
REF_URL='postgresql://postgres@localhost:55499/postgres?sslmode=disable'
docker exec v1-ref psql -U postgres -c 'create role supabase_auth_admin nologin noinherit'   # Supabase seulement
PLATFORM_APP_PASSWORD="$(openssl rand -hex 16)" pnpm exec oto-platform db prepare --db-url "$REF_URL"
docker exec -i v1-ref psql -U postgres -v ON_ERROR_STOP=1 -1 < supabase/migrations/20260928100000_platform_base_v1.sql
cat > ../privileges-platform.sql <<'SQL'
select kind, object, grantee, privilege from (
  select 'schema' as kind, n.nspname::text as object, coalesce(r.rolname, 'PUBLIC') as grantee, a.privilege_type as privilege
    from pg_namespace n cross join lateral aclexplode(n.nspacl) a left join pg_roles r on r.oid = a.grantee
   where n.nspname = 'platform'
  union all
  select case c.relkind when 'S' then 'sequence' else 'table' end, c.relname::text, coalesce(r.rolname, 'PUBLIC'), a.privilege_type
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(coalesce(c.relacl, acldefault((case c.relkind when 'S' then 's' else 'r' end)::"char", c.relowner))) a
    left join pg_roles r on r.oid = a.grantee
   where n.nspname = 'platform' and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
  union all
  select 'column', c.relname || '.' || t.attname, coalesce(r.rolname, 'PUBLIC'), a.privilege_type
    from pg_attribute t join pg_class c on c.oid = t.attrelid join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(t.attacl) a left join pg_roles r on r.oid = a.grantee
   where n.nspname = 'platform'
  union all
  select 'function', p.oid::regprocedure::text, coalesce(r.rolname, 'PUBLIC'), a.privilege_type
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    left join pg_roles r on r.oid = a.grantee
   where n.nspname = 'platform'
) x
order by 1, 2, 3, 4;
SQL
docker exec v1-ref pg_dump --schema-only --schema=platform --no-owner --no-privileges "$DB_URL" | grep -v -e '^--' -e '^[\]' -e '^$' > ../platform-hote.sql
docker exec v1-ref pg_dump -U postgres --schema-only --schema=platform --no-owner --no-privileges postgres | grep -v -e '^--' -e '^[\]' -e '^$' > ../platform-v1.sql
docker exec -i v1-ref psql -At -v ON_ERROR_STOP=1 -f - "$DB_URL" < ../privileges-platform.sql > ../privileges-hote.txt
docker exec -i v1-ref psql -U postgres -At -v ON_ERROR_STOP=1 -f - postgres < ../privileges-platform.sql > ../privileges-v1.txt
diff ../platform-hote.sql ../platform-v1.sql && echo 'schéma : identique'
diff ../privileges-hote.txt ../privileges-v1.txt && echo "privilèges : identiques ($(wc -l < ../privileges-v1.txt))"
docker rm -f v1-ref

# 3. Les versions repliées marquées annulées (celles que l'historique nomme : la ligne de base
#    d'E01-S09 et les six d'après ; aussi les vingt d'avant E01-S09, si l'historique les nomme encore)
npx supabase migration repair --db-url "$DB_URL" --status reverted 20260925230100 20260926084500 20260926110000 20260927090000 20260927150000 20260927190000 20260927200000

# 4. La ligne de base V1 marquée appliquée
npx supabase migration repair --db-url "$DB_URL" --status applied 20260928100000

# 5. Vérification de l'historique : une seule ligne, 20260928100000, en local comme côté base ;
#    puis db push ne trouve rien à appliquer (« Remote database is up to date »)
npx supabase migration list --db-url "$DB_URL"
npx supabase db push --db-url "$DB_URL" --dry-run
```

Les deux `diff` de l'étape 2 ne rendent rien : même schéma, mêmes privilèges. Un écart arrête la procédure avant l'étape 3 : l'hôte n'a pas toute la chaîne, ou son schéma a dérivé.
`supabase migration repair --db-url` vaut pour tout Postgres dont l'historique est tenu par la CLI
Supabase (un hôte installé par `supabase db push --db-url`, ci-dessus). Un hôte qui tient son
historique autrement fait l'équivalent dans son outil ; avec la table de la CLI, en SQL, dans une
transaction :

```sql
begin;
delete from supabase_migrations.schema_migrations
 where version in ('20260925230100', '20260926084500', '20260926110000', '20260927090000',
                   '20260927150000', '20260927190000', '20260927200000');
insert into supabase_migrations.schema_migrations (version, name) values ('20260928100000', 'platform_base_v1');
commit;
```

Revenir en arrière avant la poussée : `repair --status reverted 20260928100000`, puis
`repair --status applied` des versions repliées, depuis un arbre dont `supabase/migrations/` porte
encore leurs fichiers (le commit d'avant la ligne de base V1) ; la sauvegarde de l'étape 1 dit
lesquelles.

## Hôtes qui avaient appliqué une migration de la 1.1.0

Les six fichiers d'origine de `20260930100000_v1_1_0.sql` (`20260929140000`, `20260929160000`,
`20260929170000`, `20260929180000`, `20260929190000`, `20260929200000`) n'ont été publiés par aucune
version : seule une base de développement, ou le projet de test de ce dépôt, a pu en appliquer. Le
fichier de version ne se rejoue pas sur une telle base (ses `create` échoueraient) et `supabase db push`
refuse un historique qui nomme des versions absentes du dossier. Par qui exploite la base, jamais par la
CI, avant la poussée qui apporte le fichier de version, à la racine d'un dépôt dont `supabase/migrations/`
porte `20260930100000_v1_1_0.sql` et plus aucun des six fichiers, `DB_URL` posée comme au § précédent :

- **Base locale de test** : `pnpm db:local --reset` la recrée, rien d'autre.
- **Les six appliquées** (`supabase migration list` les montre côté base) : seul l'historique change.

  ```bash
  npx supabase migration repair --db-url "$DB_URL" --status reverted 20260929140000 20260929160000 20260929170000 20260929180000 20260929190000 20260929200000
  npx supabase migration repair --db-url "$DB_URL" --status applied 20260930100000
  npx supabase migration list --db-url "$DB_URL"
  npx supabase db push --db-url "$DB_URL" --dry-run   # « Remote database is up to date »
  ```

- **Une partie seulement** : appliquer d'abord, à la main et dans l'ordre, les parties du fichier de
  version qui suivent la dernière appliquée (chaque bannière nomme son fichier d'origine), puis le cas
  précédent ; une base qui en a sauté une se recrée.

Les copies des six dans `supabase/migrations/` de l'hôte se suppriment : `migrations sync` ajoute, il
ne retire rien.

## Supprimer une personne

Aucune clé ne lie plus `platform` aux comptes de Supabase Auth : supprimer un compte depuis le
tableau de bord de Supabase laisse ses lignes. L'outillage l'oublie d'abord, par le rôle
d'administration de la base (sur Supabase, la clé de service), puis supprime le compte :
`select platform.forget_user('<id>');` supprime ce que les clés supprimaient en cascade
(appartenances, équipes, règles nominatives, comptes personnels, `ctx`, accès et équipe plateforme),
met à nul ce qu'elles mettaient à nul (auteurs, responsable, journal), et supprime tout nœud dont la
personne est propriétaire, avec ce qui est dessous (fiche D19, option A). Un nœud d'un autre
propriétaire, une équipe ou une autre personne, rangé sous l'un des siens arrête tout (`23503`, les
chemins nommés) : la personne, ou un administrateur, le déplace d'abord. Rangé pendant l'oubli, il
l'arrête aussi : la suppression l'épargne et la clé `nodes_parent_id_fkey` refuse (`23503`) ; les
nœuds que la personne possède sont verrouillés le temps de l'oubli. Les tests (`createFixtures`) et
`pnpm test:cleanup` le font.

Ce qui reste après l'oubli : l'adresse de la personne là où elle est une donnée et non une
référence : dans `invitations.email` (ses invitations, acceptées ou non), dans les cibles du
journal (`journal.target` : une invitation, un changement de membre, d'équipe ou de profil nomme la
personne par son email) et dans le journal admin. Un effacement complet au titre du droit à
l'effacement les traite à la main, ou par une story à venir. Le lexique (`lexicon`, depuis
`20260926110000`) ne garde pas les mots de ce que l'oubli supprime : `forget_user` reconstruit celui
de chaque organisation où partent des nœuds de la personne (fiche D19 A). Une suppression ordinaire
laisse ses mots, jamais affichés ; `select platform.lexicon_rebuild('<org>');`, par le rôle
d'administration, les retire.

## Commandes

- `pnpm migrations:sync` : copie chaque `.sql` d'ici vers `supabase/migrations/`. Le paquet fait
  foi : une copie qui diffère n'est pas écrasée, le script s'arrête en nommant le fichier et
  n'écrit rien.
- `pnpm check:migrations` : refuse tout objet créé ou modifié hors de `platform` et tout retrait
  (`drop`, `alter … drop column`, `rename`, `set not null`, `alter … type`), avec `fichier:ligne
  règle`. Seuls `drop policy|trigger|function if exists` juste avant la recréation du même objet
  passent, et une contrainte CHECK remplacée par une autre du même nom dans la même instruction
  (`alter table … drop constraint x, add constraint x check (…)`, sans `if exists`) : la revue
  vérifie que la nouvelle admet tout ce qu'admettait l'ancienne, sauf quand la migration contrôle
  d'abord, dans le même fichier, qu'aucune ligne ne contrevient à la nouvelle et s'arrête sinon
  (`20260928120000`, fiche D107 : `teams_slug_reserved` refuse désormais `private`) ; de même une clé étrangère
  remplacée par une clé du même nom (`add constraint x foreign key …`, M26) : la revue vérifie la
  décision qui change son action. Refuse aussi une fonction de
  `platform` sans `revoke execute … from public` dans le même
  fichier (`function-execute-not-revoked`, fonctions de déclencheur exceptées), et ce qui
  attacherait de nouveau le schéma à Supabase ou à une extension que l'hôte refuse (E01-S09) : une
  clé vers `auth.users` (`auth-users-foreign-key`), une lecture de `auth.users` hors des trois
  fonctions propres à Supabase, `hook_before_user_created`, `oauth_pending_resource` et
  `oauth_clients_activity` (`auth-users-read`), une extension hors de `pg_trgm`, `unaccent` et
  `ltree` (`extension-not-allowed`). Tourne dans la CI avant le build ; `--file <chemin>` contrôle un
  fichier seul.
- Dans une application hôte, les mêmes commandes passent par la CLI du paquet :
  `pnpm exec oto-platform migrations sync --to supabase/migrations`, puis
  `pnpm exec oto-platform migrations check`. Les deux scripts ci-dessus l'appellent aussi.
- `pnpm exec oto-platform db prepare --db-url <url>` : la préparation d'un hôte neuf (ci-dessus).

## Règles

Les règles datées d'une migration de la chaîne (« depuis `2026…` ») citent le fichier que l'archive
garde ; la ligne de base V1 les porte toutes.

- **`accounts` : grants de colonnes.** `secret_ciphertext` n'est jamais accordée en lecture à
  `authenticated` ; `select *` est refusé, les services listent leurs colonnes. Toute colonne
  ajoutée à `accounts` doit être ajoutée au `grant select (…)` dans sa migration.
- **Rollback en commentaire** en fin de fichier (`-- ROLLBACK:`), dans l'ordre inverse de
  création ; il ne s'exécute jamais depuis le paquet.
- **`anon` a l'usage du schéma** (depuis E02-S01, pour atteindre `org_by_host`) : toute fonction
  créée révoque `EXECUTE` à `public` (et à `anon`) puis l'accorde au rôle voulu. Une fonction qui
  garderait le défaut de Postgres (`EXECUTE` à `public`) deviendrait appelable sans session.
  Appliquée par `pnpm check:migrations` (`function-execute-not-revoked`) ; une fonction de
  déclencheur, inappelable seule, en est exemptée.
- **La garde de l'arbre ne contrôle que la structure** (`nodes_guard`, depuis `20260927200000` ;
  ADR-012 § 3) : chemin, cycle, dossier `private` (`perso` jusqu'à `20260928120000`) et nœud Contexte immobiles, espace personnel et son
  propriétaire, pour tout écrivain ; les droits sont décidés par le service avant sa requête. Une
  fonction `security definer` qui écrit dans `nodes` porte donc elle-même l'isolation de son appelant.
- **La garde de l'arbre contrôle le chemin avant tout** (depuis `20260924120300`) : `lpath` est
  une colonne générée (`text2ltree`), calculée après les déclencheurs `BEFORE` et avant les
  contraintes `CHECK`. Une règle nouvelle sur le chemin s'écrit dans `nodes_guard`, en tête, pas
  seulement dans la contrainte de `path` (`database-patterns.md § Migrations`).
- **RLS d'isolation : l'appartenance à l'organisation et les invariants ; les droits sont décidés
  par les services (E01-S07)** (depuis `20260924150000`). Une policy n'appelle ni `node_level`,
  `node_level_for`, `account_level`, `account_level_for`, ni `is_org_admin`, ne lit pas le responsable
  d'une équipe (`team_members.role` depuis `20260929090000`), et n'appelle `is_staff()` que pour une portée plateforme
  (`platform_staff`, lecture de `platform_grants` et d'`admin_journal`, écriture du journal admin) ;
  elle garde l'attribution à `auth.uid()`, l'état d'une ligne, la cohérence d'organisation entre
  colonnes et la structure de l'arbre. Vérifié sans base par `tests/unit/rls-policies.test.ts`.
- **Une sous-requête de policy ne revient jamais sur une table dont Postgres développe déjà les
  policies**, directement ou par une autre table (depuis `20260924150100`) : sous l'isolation, les
  policies de lecture portent une sous-requête (`(select platform.member_orgs())`), et Postgres
  refuse alors la commande entière (`42P17`). Vérifié sans base par
  `tests/unit/rls-policies.test.ts` (`supabase-patterns.md § RLS Patterns`).
- **Une policy de lecture, et le `with check` d'une mise à jour, portent sur les colonnes de la
  ligne, pas sur son id** (`nodes_select_level`, `accounts_select_member`,
  `accounts_update_admin`) : un `insert … returning` évalue la policy de lecture sur la ligne à
  écrire, avant qu'elle n'existe, et le `with check` d'une mise à jour, relu par l'id, verrait la
  ligne d'avant (`supabase-patterns.md § RLS Patterns`).
- **`accounts` : mise à jour colonne par colonne** (depuis `20260924120200`). `id`, `org_id`,
  `created_at` et `updated_at` ne sont pas accordées ; une colonne ajoutée qu'un service doit
  modifier s'ajoute au `grant update (…)` dans sa migration.
- **`teams` : mise à jour de `name` et `lead_user_id` seulement** (depuis `20260924120400`). Le
  slug est le chemin du dossier de l'équipe (P39) et ne change pas, l'organisation non plus ; une
  colonne ajoutée qu'un service doit modifier s'ajoute au `grant update (…)` dans sa migration. Depuis
  `20260929090000`, le service n'écrit plus `lead_user_id` : une écriture héritée devient un rôle `lead`
  (`teams_lead_sync`), la colonne revient à `null` (retrait en 1.1).
- **Un niveau calculé dans un espace personnel ne compte que les règles de l'espace**
  (`node_level_for`, depuis `20260924120400`) : une fonction qui calcule un droit en remontant
  l'arbre s'arrête au nœud qui porte le propriétaire personnel (D5, H61).
- **Blocs** (depuis `20260924130000`, ADR-011) : par l'API, l'état publié d'un document ne s'écrit
  que par `publish_node` ; l'outillage à la clé de service (import, E09-S04) écrit en confiance,
  ADR-006 § 3 ; une ligne de tableau s'écrit publiée (pas de brouillon de lignes) ;
  `blocks.org_id` est posé par `blocks_guard` depuis le nœud, `blocks.id` n'est jamais fourni par
  l'API (privilèges de colonnes).
- **Un numéro de ticket se lit dans `feedback.number`**, posé par organisation sous verrou (classe
  7201), jamais dans `id`.
- **Index GIN en `fastupdate = off`** : sans liste d'attente, le planificateur garde l'index après
  une insertion en masse (`database-patterns.md § Indexes`).
- **Une recherche sur une table sous RLS passe par une fonction `security definer` qui applique la
  visibilité** (`search_content`, par `node_level_for`) : sous une policy, `@@` et `%>` s'évaluent
  sans index (`supabase-patterns.md § RLS Patterns`). `route_candidates` aussi, depuis
  `20260926110000`.
- **Le lexique ne s'écrit que par le paquet** (depuis `20260926110000`) : les mots d'un nœud ou d'un
  bloc publié y entrent par ses déclencheurs pour tout écrivain, outillage et import compris, dans
  l'ordre des mots ; `lexicon_rebuild(org)` le reconstruit, appelée par la migration et par
  `forget_user` ; aucune écriture accordée, une lecture qui ne rend aucune ligne à `authenticated` ;
  seule `lexicon_fix` le lit (depuis `20260930100000`, partie E11-S04), pour `search_content` et `route_candidates`.
  Jamais exporté (`NEVER_EXPORTED`), il se reconstruit à l'import.
- **Aucune fonction ne lève `40001`** (depuis `20260924130100`) : PostgREST rejoue sans fin une
  transaction en échec de sérialisation ; un conflit de révision lève `PT409`.
- **Un bloc `draft` ne s'écrit sous un jeton qu'avec son brouillon** (depuis `20260924140000`) :
  `blocks_lock_draft` exige la ligne `node_drafts`, verrouillée, et avance `node_drafts.updated_at`,
  le tampon que `publish_node` compare ; une écriture pendant une publication, ou après, rend `PT409`.
  L'outillage à la clé de service écrit en confiance.
- **`platform_grants`, `admin_journal` : insertion colonne par colonne** (depuis `20260924140000`).
  Les dates (`granted_at`, `revoked_at`, `ts`), l'id et l'issue d'un accès ne sont pas accordés, ni
  `user_email` et `user_name`, copies que la base pose (`platform_grants_identity_copy`, E01-S09) ;
  une colonne ajoutée qu'un service doit écrire s'ajoute au `grant insert (…)` dans sa migration.
- **`platform_grants` : lecture colonne par colonne** (E01-S09, `20260926023000`). `user_email` et
  `user_name` ne sont pas accordées en lecture à `authenticated` : seule `platform_access_directory`
  les sert, aux administrateurs et à l'équipe plateforme (fiche D2) ; `select *` est refusé, les
  services listent leurs colonnes. Une colonne ajoutée qu'un service doit lire s'ajoute au
  `grant select (…)` dans sa migration.
- **`members` : insertion et mise à jour colonne par colonne** (depuis `20260925100000`). `email`,
  `name` et `last_sign_in_at` sont des copies, écrites par la base seule (`accept_invitations` depuis
  la session, `members_identity_copy` pour une personne qui s'inscrit elle-même) et par l'outillage à
  la clé de service, qui les passe (E01-S09) ; une colonne ajoutée qu'un service doit écrire s'ajoute
  aux `grant insert (…)` et `grant update (…)` dans sa migration.
- **Une fonction appelée par PostgREST qui gagne un paramètre garde l'ancienne signature** (depuis
  `20260924140000`, `publish_node`) : la nouvelle surcharge prend le paramètre sans défaut, pour
  qu'aucun jeu de noms d'arguments ne désigne les deux, et l'ancienne l'appelle.
- **Portable, sur Supabase comme sur un Postgres nu** (E01-S09) : aucune clé ni lecture vers
  `auth.users` (une personne est un `uuid` ; son email et son nom sont des copies), aucune extension
  hors de `pg_trgm`, `unaccent` et `ltree` (appliqué par `pnpm check:migrations`) ; `updated_at`
  avance par `platform.set_updated_at()`, jamais par `moddatetime` ; un privilège accordé à
  `service_role` ou à `supabase_auth_admin`, rôles que seul Supabase porte, s'accorde dans un bloc
  `do` qui vérifie d'abord que le rôle existe (comme à la fin de la ligne de base) : ailleurs, le job
  `bare-postgres`, qui applique toutes les migrations sur un Postgres nu, échoue.
- **Une table qui porte une colonne de personne** (`user_id`, `created_by`…) **entre dans
  `forget_user`** dans la migration qui la crée : suppression de la ligne, mise à nul de la colonne ou
  retrait avec l'espace personnel, selon ce qu'aurait fait une clé vers le compte. Les 31 colonnes
  d'E01-S09 sont contrôlées par le test d'AC6 (`tests/integration/portabilite-schema.test.ts`), une
  colonne nouvelle par la revue du diff de sa migration.
