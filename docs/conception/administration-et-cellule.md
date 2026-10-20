# Administration et cellule

- **Statut** : proposé
- **Dernière révision** : 2026-10-19

## Résumé

L'équipe plateforme administre une cellule par un MCP admin à part (`/api/mcp-admin`, huit outils `admin_<objet>` à `op`), et l'administrateur d'une organisation par le tableau de bord `/admin/*` ; les deux partagent les mêmes opérations de `server/admin/`. Une organisation créée par l'équipe plateforme a toujours un premier administrateur : le créateur lui-même, membre sans email, ou une personne invitée. Drapeaux, marque, état de la cellule, export-import et suppression d'une organisation complètent l'exploitation ; sous-domaines et appel à l'hébergeur restent chez l'hôte.

## Contexte

Une cellule est un déploiement de l'application hôte : une base, un émetteur, une ou plusieurs organisations. L'équipe plateforme crée les organisations, y entre par un accès daté et suit la santé de la cellule ; l'administrateur du client règle son organisation sans elle. Chez Oto, les outils d'administration se mêlaient aux outils métier dans la même liste : la plateforme les sépare.

## Objectifs et non-objectifs

- Une surface d'administration séparée des six outils, réservée à l'équipe plateforme, qui évolue par ajout seulement.
- Une seule couche d'opérations sous deux portes (MCP admin, tableau de bord), décisions d'accès dans le service.
- Rien de propre à un hébergeur dans le paquet : sous-domaines et DNS sont un point d'extension de l'hôte.
- Hors objectif : le registre central de plusieurs cellules et la comparaison aux migrations attendues (V2) ; les sondes de santé et alertes des comptes (V2) ; un écran de quota.

## Conception

### MCP admin : surface et garde

- H105 : le MCP admin sert huit outils à `op` sur `/api/mcp-admin`, à l'équipe plateforme seule (401 sans métadonnées sinon) ; `help` sert le contrat des opérations ; l'organisation est un argument explicite ; une opération destructive se fait en deux temps.
- E08-S02 N1 : les outils s'appellent `admin_<objet>`, sans préfixe d'organisation : un connecteur admin sert une cellule, pas une organisation.
- E08-S02 N2 : sans jeton ou jeton invalide, 401 avec `resource_metadata` vers `…/oauth-protected-resource/api/mcp-admin` ; jeton valide hors équipe plateforme, 401 `invalid_token` sans métadonnées, corps « Unauthorized », rien servi.
- P29 : le MCP admin évolue par ajout ; `admin_org` est déclaré `openWorldHint: true` quand l'hôte branche un point d'extension de création d'organisation, `false` sinon. E08-S02 N17 : un outil déclaré sans table d'opérations rend `unavailable_in_v1` « Not available yet in this version. » après la garde ; les huit outils ont aujourd'hui leur table, et leurs schémas n'évoluent que par ajout.
- E08-S02 N40 : le schéma plat de chaque outil est servi (`tools/list`), jamais analysé : la validation est celle de l'opération (opération connue, champ en trop cherché dans les arguments bruts, schéma strict) ; ses bornes viennent des schémas partagés.
- E08-S02 N4 : `org` n'est requis que par les opérations qui visent une organisation : ni pour `help`, `admin_context`, `admin_org list` et `admin_cell`, et facultatif (filtre) pour `admin_journal admin_log`.
- E08-S02 N5 : tout appel d'`admin_context` émet un nouveau code ; sa ligne `admin_journal`, ancrage du code, est écrite et attendue avant la réponse : si elle échoue, aucun code n'est servi.
- E08-S02 N7 : premier temps admin : résultat normal (pas `isError`) qui finit par « Nothing was <verbe>. Show this to the user and ask for explicit approval, then call again with confirm: true. » ; `confirm: true` exécute ; jamais `needs_confirmation`. E08-S02 N14 : les `next_actions` sont des chaînes `"<outil> <op>"` et ne proposent jamais une opération en deux temps.
- E08-S02 N15 : ligne `admin_journal` : `target` = `org:<slug>` pour une opération qui nomme une organisation, `team:<slug>` pour une équipe, sinon chemin, ticket ou connecteur ; `host` sur la ligne `initialize` seule ; un refus 401 : un `console.warn` sans donnée.

### Organisations

- E08-S02 N9 : le staff ne voit et n'administre que les organisations où il est membre ou a un accès en cours, décidé par le service (`listOrgs`, `resolveAdminOrg`) ; une organisation sans accès rend le même `not_found` qu'un slug inconnu.
- E08-S02 N8 : `admin_org create` est en deux temps : le préfixe nomme les outils pour toujours, et aucune opération ne supprime une organisation (la commande de l'outillage le fait, § Suppression d'une organisation). E08-S02 N18 : slug `^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$` (étiquette DNS de 2 à 40 caractères, pour `<slug>.<base>`) ; nom de 1 à 80 caractères. E08-S02 N24 : la contrainte d'un `23505` de `create_org` (slug, préfixe, adresse) se reconnaît par `uniqueConstraint` de `server/errors.ts`, seul lieu d'une hypothèse sur la forme d'une erreur PostgREST.
- E08-S02 N10 : `orgs.settings.domains` est une chaîne libre en anglais (domaines de travail cités par `<prefix>_context`, 200 caractères au plus, vide = retirer) ; les adresses sont la table `org_domains` (`host`, `add_host`, `remove_host`).
- E08-S02 N12 : `orgs.settings.routing {threshold, gap}` (0 à 1, défauts 0,65 et 0,1) se règle par `updateOrg`, que servent `admin_org update` et la page Organisation du tableau de bord (voir [routage et recherche](routage-et-recherche.md)).
- E08-S02 N19 : `admin_org update` écrit nom et `settings` en une écriture sous garde `updated_at`, puis la marque par `updateBrand`, seul écrivain d'`orgs.brand` (dernière écriture gagnante sur la marque).
- E08-S02 N23 : avant toute écriture : `updateOrg` sans `isOrgAdmin` → `forbidden` « Changing the settings of <org> is reserved to … » ; `add_host`, `remove_host`, `grant_access` sans `isStaff` et `isOrgAdmin` → `forbidden` « op <op> of admin_org is reserved… ».

### Premier administrateur

Décision du 2026-10-14 : une organisation créée par l'équipe plateforme a toujours un premier administrateur (`server/admin/first-admin.ts`).

- `admin_org create` exige `admin_email`, l'adresse du premier administrateur. L'adresse de l'appelant, comparée sans casse à celle de son identité vérifiée, le fait membre `admin` dans la transaction de `create_org` (`claim_org_admin`), sans invitation ni email ; en mode OIDC, son identifiant est celui de sa ligne `platform_staff` (`identity_for_caller()`), sans compte chez l'émetteur, et le mode Supabase prend le `sub`. Une autre adresse reçoit, une fois l'organisation créée, une invitation `admin` par `inviteMember` : le service, les contrôles et l'email de l'écran Équipes (lien magique en mode Supabase, email de la plateforme au nom de qui invite en mode OIDC), sous l'accès `creation` de l'appelant. Le récapitulatif du premier temps dit lequel des deux cas va se produire.
- Le lien d'une invitation mène à une adresse de l'organisation, celle que `reachableHost` choisit d'après l'adresse du MCP admin appelé, bâtie par `linkOrigin` : `https` sans port, `http` et le port de l'adresse appelée sur le poste local seulement ; `x-forwarded-proto` n'est pas lu. L'invité revient sur l'adresse de son organisation, comme depuis l'écran Équipes (E02-S01 N2). Sans adresse, l'invitation est refusée avant toute écriture (`invalid_arguments`) : passer `host`, ou se nommer soi-même.
- Une invitation qui échoue après la création (email qui ne part pas : l'invitation est retirée, comme à l'écran) laisse l'organisation créée ; le résultat le dit et renvoie à `add_admin`, sans lever, parce que rejouer `create` buterait sur le slug pris.
- L'accès plateforme `creation` du créateur reste créé dans les deux cas (fiche D2) : il nomme et date l'entrée de l'équipe plateforme pour le client, qui peut le révoquer ; il porte l'invitation d'une autre adresse ; il garde l'administration au créateur que le client retirerait de ses membres. Membre et titulaire d'un accès, le créateur agit en membre (`listOrgs`, N9 ; `identityInOrg`) : l'accès ne double rien.
- `admin_org add_admin` nomme un administrateur d'une organisation existante, par la même règle, réservée au membre de l'équipe plateforme qui l'administre (`requireStaffAdmin`, comme `add_host`, N23), en un temps comme `grant_access`. L'appelant devient membre `admin` tout de suite (`claim_org_admin`, sous la limite `members_max`, que l'équipe plateforme passe en le journalisant) ; un membre présent, l'appelant compris, passe `admin` (`updateMember`, le geste de l'écran Équipes, ou `claim_org_admin`) ; un administrateur présent ne change pas, et le texte le dit ; une autre adresse est invitée `admin`.
- En base, `claim_org_admin(org)` en est la seconde barrière (`is_staff()` et `is_org_admin`, email dans les claims, sinon `42501`) ; la ligne `members` s'écrit par `seat_org_admin`, interne, partagée avec `signup_org` ([offres de l'hôte](offres-de-l-hote.md)).

### Équipe plateforme et accès

- E08-S02 N13 : `grant_access` : l'appelant administre l'organisation comme membre de l'équipe plateforme (`isStaff` et `isOrgAdmin`), le destinataire est du staff, un seul accès en cours par couple, décidé avant l'insertion ; `revoke_access` en deux temps. E08-S02 N35 : son récapitulatif nomme par son nom qui a accordé l'accès ; le `reason` d'une révocation est gardé par la ligne du journal admin, `platform_grants` n'ayant pas de motif de révocation. Le modèle des accès : [droits d'accès](droits-d-acces.md) (H73).
- E08-S02 N20 : l'annuaire de l'équipe plateforme se lit par `staff_directory()` (identifiant, email, nom, date d'ajout), réservée au staff ; email et nom sont nuls pour une ligne écrite sans email. E08-S02 N21 : `platform_staff` ne s'écrit que par l'outillage `scripts/platform-staff.mjs` (`add`, `remove`, `list`, connexion d'administration) : aucune porte du paquet ne l'écrit.
- E08-S02 N22 : `admin_team` suit les services d'équipes : `create` rend le slug de `teamSlug` ; `set_lead` avec `email` vide laisse l'équipe sans responsable ; `add_member` d'un membre présent ne change rien ; retirer le responsable est refusé (`is_lead`).

### Nœuds, connecteurs, journal, retours (MCP admin, 2/2)

- E08-S06 N1 : propriétaire et sujet s'écrivent en une chaîne plate, bornée à 300 caractères : `team:<slug>`, `user:<email>`, `org`, `inherit` (propriétaire seulement), résolue par `resolveRef`.
- E08-S06 N2 : `transfer_owner` est toujours en deux temps ; le premier nomme la gestion avant et après, compte les descendants lisibles qui héritent, et prévient quand le nouveau propriétaire est une personne (administrateurs et staff perdent l'accès). E08-S06 N19 : `transferOwner` décide avant d'écrire : la gestion du nœud (`requireNodeLevel`, action `transfer`, refus « Changing the owner of <path> is reserved to <qui>. Ask them to change it. ») suffit, rendre personnel compris ; `nodes_guard` en second. E08-S06 N3 : la racine `guide` ne change pas de propriétaire : elle appartient toujours à l'organisation. HN-E08S06-17 : `transfer_owner` refuse `perso` et un espace `perso/<handle>` (`invalid_arguments`) après la recherche du nœud ; en base, `nodes_guard` refuse de donner `perso/<handle>` à une autre personne que celle du handle.
- E08-S06 N17 : `admin_node` n'écrit que `nodes`, jamais un bloc (les blocs suivent leur nœud) ; une publication passe par le seul service de publication (contrôle, liens, `publish_node`), jamais par un appel direct à `publish_node`.
- E08-S06 N4 : `admin_connector deactivate` et `disable_account` sont en deux temps ; `activate` et les règles se font en un temps (réversibles). E08-S06 N13 : `create_account` ne crée que des comptes d'organisation ou d'équipe (`owner` = `org` ou `team:<slug>`) : un compte personnel ne se crée que par son propriétaire. E08-S06 N6 : un compte s'adresse par son libellé, unique dans l'organisation sans casse (index `accounts (org_id, lower(label))`) : `findAccount` compare comme l'index, parmi les comptes visibles, sans champ `connector` pour désambiguïser. E08-S06 N10 : les règles d'un compte vivent dans `server/rules.ts` sur le modèle de celles d'un nœud : `listAccountRules`, `setAccountRule` et `removeAccountRule` (`removeRule` ne retire que la règle d'un nœud).
- E08-S06 N15 : `catalogue` rend les connecteurs activables de `listConnectorsForOrg`, puis les fonctions toujours actives lues au registre du catalogue (`table.*`, fonctions de l'application). HN-E08S06-9 : tout connecteur activable y est dit « (simulated) », `kind: "simulated"` ; les fonctions natives se groupent par connecteur, « (built in) », celles de l'application sur une ligne ; `state` vaut `active`, `inactive` ou `always_active`. Voir [connecteurs et comptes](connecteurs-et-comptes.md).
- E08-S06 N7 : `admin_journal` : 7 jours par défaut ; `conversations` et `conversation` par la lecture du journal web (fenêtre gelée, masquage) ; `admin_log` : 50 lignes par page, curseur `(ts, id)`, toute l'équipe plateforme, arguments avec `code` seulement.
- E08-S06 N8 : `admin_feedback list` : tous les états, comptes par état en tête, 30 jours par défaut ; `set_state` : toute transition, `declined` exige une résolution de 3 caractères au moins, le retour à `open` efface la décision, le même état ne réécrit rien.

### État de la cellule

- H106 : `admin_cell` décrit la seule cellule : version du paquet, migrations appliquées (`platform.applied_migrations()`, équipe plateforme seule) et santé, variables présentes sans leur valeur ; le registre central de plusieurs cellules est en V2. E08-S06 N16 : `admin_cell migrations` reconnaît les migrations du paquet à leur nom (`<horodatage>_platform_<sujet>`) sans les comparer à une liste embarquée : l'écart aux migrations attendues est V2.
- E08-S04 NH4 : l'état de la cellule ne dépend d'aucune organisation : jeton, puis `is_staff()`, sans appartenance ni identité par l'adresse. E08-S04 NH5 : santé = base joignable (durée d'`applied_migrations()`) et présence, jamais la valeur, des variables requises du mode de l'hôte : Supabase (URL, clé anon, `NEXT_PUBLIC_SITE_URL`) ou OIDC (émetteur, audience, SMTP, expéditeur, `NEXT_PUBLIC_SITE_URL`).
- E08-S04 NH11 : `GET /api/platform/cell` est reconnu par `isCellRoute`, hors de `RESOURCES`, après le jeton et avant l'identité par l'adresse ; `GET` sans paramètre seulement (sinon `404 not_found`) ; aucune ligne de journal.

### Drapeaux

- H107 : les drapeaux d'une organisation vivent dans `orgs.flags` `{nom: true|false}`, déclarés dans un registre en code ; `isEnabled` n'est vrai que pour un `true` stocké ; l'administrateur ou l'équipe plateforme avec un accès en cours les posent (`setFlag` décide par `isOrgAdmin`).
- E08-S04 NH1 : registre `FLAGS` (nom et description), vide en V1 ; `setFlag` refuse un nom non déclaré, `listFlags` ne rend que les déclarés ; une clé stockée non déclarée n'est ni listée ni modifiée. E08-S04 NH2 : `isEnabled` ne rend vrai que pour la valeur stockée `true` exacte ; drapeau absent, toute autre valeur (`"true"`, `1`) et drapeaux mal formés valent `false`, sans erreur. E08-S04 NH3 : un drapeau s'écrit sous garde optimiste sur `orgs.updated_at` ; 0 ligne → `conflict`.

### Tableau de bord `/admin/*`

- E08-S03 N1 : les pages `/admin/*` sont réservées à qui administre l'organisation de l'adresse (`isOrgAdmin`), décidé par la page avant tout appel ; les autres lisent « Cette page est réservée aux administrateurs de <nom>. » E08-S03 N9 : les entrées d'administration du rail (`RailApplication`) ne se montrent qu'à qui administre (`administre`, calculé par `isOrgAdmin` dans le layout) : confort seulement, chaque page revérifie l'accès.
- E08-S03 N5 : désactiver un connecteur ou un compte se confirme en ligne par `ActionPlateforme` (question, « Garder », confirmation ; pas de modale), l'API exécutant directement ; activer et basculer un drapeau partent sans question.
- E08-S03 N6 : un libellé de compte est unique dans l'organisation, sans casse (index `accounts (org_id, lower(label))`) ; la création s'appuie sur le refus `23505` rendu en `conflict`, jamais sur une lecture préalable, à l'écran comme au MCP admin. E08-S03 N11 : les comptes créés depuis l'écran appartiennent à l'organisation ou à une équipe : `POST admin/accounts` refuse `owner_kind: user` en `invalid_arguments`.
- E08-S03 N18 : textes de l'écran Connecteurs accordés au nombre (« 1 connecteur activable », « 1 fonction », « 1 procédure publiée le cite… ») ; au-delà de 10 chemins, « , … » ; sans nom d'annuaire, « Actif depuis le <date> » sans parenthèse.

### Marque

- H110 : la marque d'une organisation est `orgs.brand` `{theme, logo_url, display_name}`, `theme` parmi les huit thèmes d'Oto ; la favicon suit le thème ; les emails de Supabase Auth, un modèle par projet, ne portent pas la marque d'une organisation.

### Sous-domaines : un point d'extension de l'hôte

- D24 : les sous-domaines et l'appel à l'hébergeur sont hors du paquet, qui n'expose qu'un point d'extension à la création d'une organisation ; le domaine de base est une variable de l'hôte.
- H111 : l'hôte pose le sous-domaine `<slug>.<domaine de base>` à la création d'une organisation, désactivé sans `CELL_BASE_DOMAIN`, `VERCEL_TOKEN`, `VERCEL_PROJECT_ID` ; les étiquettes réservées sont refusées. HN-E09S02-1 : le domaine de base se lit dans `CELL_BASE_DOMAIN` (une valeur que `hostSchema` refuse vaut absente) ; `VERCEL_TEAM_ID` est facultatif. HN-E09S02-2 : sous-domaines jamais servis à une organisation : `app`, `www`, `api`, `mcp`, `manage`, `admin`, `docs`, `status`, `auth`, `mail`, `oto`, `share`, `dashboard` ; un seul niveau sous la base ; une étiquette avec `--` est refusée.
- HN-E09S02-3 : la base d'abord (`create_org`), l'hébergeur ensuite : un échec chez Vercel laisse l'organisation et son adresse en place, à finir à la main dans Vercel par JB ; aucune opération de reprise. HN-E09S02-9 : une exception du point de création de l'hôte n'est jamais servie : `internal` sans message avant la création, ligne constante après ; ni son message ni sa pile ne vont au log.
- H-cellule-saas : le test des sous-domaines de la cellule (oto-saas : `tests/unit/cellule-sous-domaines.test.ts`) passe par la porte publique `handleAdminMcp`, avec un vérificateur injecté et une graine en ligne par le pilote `postgres`, sans `tests/helpers/` : il se résout contre le paquet publié dans le dépôt du SaaS, qui garde `postgres` en `devDependencies`.

### Export-import d'une organisation

- H112 : l'export-import est une CLI d'outillage (`pnpm org:export`, `pnpm org:import`) : un fichier JSON par organisation, `platform` par la connexion d'administration, les personnes rapprochées par email vérifié. Usage : [installer un hôte](../exploitation/installer-un-hote.md).
- HN-E09S04-12 : une table du fichier absente de la carte `TABLES` (`rows`, `vocabulary` ou autre) est refusée avant toute écriture : aucune ligne ignorée en silence, aucun ancien format converti. HN-E09S04-14 : refusés avant écriture : une référence (vers `orgs`, `teams`, `nodes`, `accounts`) à une ligne absente du fichier, un `org_id` nul ou absent, un `id` d'organisation non uuid, une colonne hors carte ; seules les clés chaînes désignent une ligne.
- HN-E09S04-2 : à l'import, toute valeur d'une ligne (clé propre, clés étrangères, `jsonb` à toute profondeur) égale, chaîne pour chaîne, à un ancien identifiant prend le nouveau ; les clés d'objet restent, les colonnes de personne suivent leur politique.
- HN-E09S04-10 : l'import insère les équipes sans responsable et pose `lead_user_id` après `team_members` : `teams_lead_sync` y retrouve la ligne du responsable, qui sinon ferait doublon (`23505`) et perdrait sa date.
- HN-E09S04-11 : dans l'empreinte, un bloc se désigne par le chemin de son nœud, son état (publié s'il l'est), puis `#<clé>`, ou `@<position>` quand il n'a pas de clé.
- HN-E09S04-13 : une invitation en attente pour l'adresse d'un membre importé n'est pas importée (comptée avec les invitations closes) : `invitations_guard` la refuserait et annulerait l'import.
- HN-E09S04-15 : `nodes.owner_user_id` suit la politique `membre` : un espace personnel dont le propriétaire n'est pas un membre importé est sauté avec ses descendants et ce qui en dépend (`nodes_guard` refuserait ce propriétaire).
- HN-E09S04-23 : un lien dont `source_block_id` n'est pas un bloc publié de son `source_node_id` dans le fichier est sauté (compté dans « Lignes sautées »), pas refusé : la clé unique des liens vaut pour toute la base.
- HN-E09S04-24 : seuls les comptes de la cible à l'email confirmé sont rapprochés ; les autres comptent comme absents (appartenances et accès sautés) et le résumé les nomme ; l'auteur par défaut doit être confirmé. HN-E09S04-25 : vers un autre projet (hôte cible différent de `source.host`), les accès plateforme en cours sont importés révoqués et comptés au résumé ; dans le même projet, recopiés tels quels ; `granted_by` prend la politique `null`.
- HN-E09S04-22 : délai de la suite d'intégration de l'export-import : 600 s (lecture de la spécification OpenAPI et semis Démo lents sous charge).

### Suppression d'une organisation

Décision du 2026-10-19 (besoin d'un hôte en fin de contrat, RGPD) : `oto-platform org delete` retire tout ce que `platform` et le stockage tiennent d'une organisation (`cli/org-delete.mjs`, `deleteOrg`).

- **Qui** : l'outillage de l'hôte seul (aucune session ne supprime une ligne `orgs`, migration `20261019140000`), par la commande du paquet sur la connexion d'administration (`--db-url`, comme `journal purge`), au nom d'un membre de l'équipe plateforme (`--by <email>`, lu dans `platform_staff`). Aucune route web ni opération du MCP admin (N8 tient) : la suppression traverse toutes les tables, `admin_journal` compris, qu'aucun rôle de session n'écrit ; `platform_server` porte les faits que le serveur affirme au fil d'une requête, pas un geste irréversible sur une organisation entière.
- **Deux temps** : sans `--yes`, la commande compte et n'écrit rien (lignes par table, objets, lignes du journal admin à anonymiser) ; ce compte rendu est la confirmation, `--yes --by <email>` supprime.
- **Ordre** : (1) les objets du stockage sous `<org_id>/` (fichiers joints, en transit, exports d'un arbre), listés et supprimés jusqu'à un préfixe vide ; (2) la base, en une transaction : la ligne `orgs` verrouillée (`for update` : une insertion qui la référence attend), le journal admin anonymisé, les comptes de connecteur supprimés (leurs règles partent sans écrire au journal des partages), `orgs` supprimée (les cascades emportent le reste), un contrôle qu'aucune table de la carte ne garde une ligne de l'organisation (sinon tout est annulé), la ligne « organisation supprimée » ; (3) un second passage sur le stockage, pour un objet arrivé entre (1) et (2).
- **Échec à mi-chemin, relance** : en (1), l'organisation reste en base, ses fichiers déjà supprimés ne se lisent plus, la même commande reprend ; en (2), rien n'est écrit ; en (3), la base est vidée : relancée, la commande retrouve l'organisation par sa ligne « organisation supprimée » (`target` `org:<slug>`, `args.org_id`), dit « déjà supprimée » et ne repasse que sur le stockage ; une telle ligne qui nommerait une organisation encore en base est refusée (l'équipe plateforme écrit ce journal). Une relance ne change rien à ce qui est déjà supprimé.
- **Inventaire** : la carte `ORG_TABLES` range chaque table de `platform` qui tient l'organisation, par `org_id` ou par son parent (`team_members`, `node_drafts`, `node_versions`) : supprimée, ou anonymisée (`admin_journal`) ; `NOT_DELETED` nomme les autres avec leur raison. `tests/integration/suppression-organisation.test.ts` confronte la carte au catalogue et sème une ligne dans chaque table : une table nouvelle le fait échouer tant qu'elle n'est pas rangée.
- **`admin_journal`** (décision d'Alexis) : une ligne de l'organisation garde sa date, sa méthode, son outil et son opération, la personne de l'équipe plateforme, sa durée, ses tailles et son issue ; `args`, `target`, `error` et `ctx` sont vidés, `org_id` mis à null. La ligne ajoutée : `method` `cli`, `tool` `org`, `op` `delete`, `target` `org:<slug>`, `args` `{org_id}`, la personne de `--by`, la date et la durée ; `forget_user` l'efface de `user_id` comme toute autre.
- **Pas supprimé** : `platform_staff` (l'équipe de la cellule, sans organisation) ; `identities` (le lien d'une personne à son émetteur, sans organisation : une personne qui n'est plus membre nulle part le garde, la commande la compte, et l'oublier est `forget_user`, que l'hôte joue en supprimant son compte) ; `connectors` (la liste de l'hôte) ; une ligne du journal admin sans `org_id` (un refus avant que l'organisation soit résolue). Le compte d'une personne chez l'émetteur reste à l'hôte.
- **Stockage** : les cinq variables `PLATFORM_STORAGE_*` sont exigées ; un hôte sans stockage passe `--without-storage`, refusé si l'organisation porte une ligne `files`. Liste par préfixe et suppression d'un objet vivent dans `cli/storage.mjs`, partagé avec l'adaptateur du serveur (`server/files/s3.ts`).
- **Sortie** : une ligne par table de la carte (lignes supprimées ou anonymisées), les objets supprimés, les personnes qui ne sont plus membres d'aucune organisation ; code 0 fait (ou rien à faire), 1 refusé ou en panne (organisation inconnue, `--by` hors de l'équipe plateforme, stockage absent, bucket ou base en échec), 2 usage. Rien du mot de passe de l'URL ni des clés n'est écrit.

### Déploiement du SaaS

- D126 : oto-saas n'est pas rebranché sur Vercel : le responsable du déploiement le déploie chez Scaleway, base PostgreSQL managée et Keycloak (procédure : oto-saas : `docs/deploiement.md`). Le projet Vercel actuel reste sur l'ancien dépôt tant que le déploiement Scaleway n'est pas fait (JB, 2026-09-28).

## Décisions et alternatives écartées

- **Outils d'administration dans la même liste que les outils métier** (le modèle d'Oto, `oto_admin_*`) : écarté ; un MCP admin séparé, sans préfixe d'organisation, et un tableau de bord.
- **E08-S04 NH9, plus en vigueur** : `setFlag` décidait par `member.role` ; il décide désormais par `isOrgAdmin` (administrateur, ou staff avec un accès en cours, membre simple compris), comme toutes les décisions d'administration.
- **Sous-domaines posés par le paquet** : écarté (D24) ; un appel à un hébergeur n'entre ni dans le paquet ni dans `src/`, sauf désactivé par une variable et listé (`CLAUDE.md § Projet`).
- **Supprimer une organisation par une opération** : écarté (E08-S02 N8) ; le préfixe nomme les outils pour toujours. La suppression d'une organisation passe par l'outillage de l'hôte (§ Suppression d'une organisation).
- **Supprimer une organisation par le MCP admin, par une route web ou au rôle `platform_server`** : écarté ; un geste irréversible sur toutes les tables d'un client n'a pas de porte dans l'application, et l'outillage tient déjà la connexion d'administration.
- **Supprimer la base d'abord, le stockage ensuite** : écarté ; une panne du bucket laisserait des objets sans ligne qui les nomme. Le stockage d'abord garde l'organisation, donc sa clé, jusqu'à la transaction, et la ligne « organisation supprimée » garde son identifiant pour le dernier passage.
- **`--confirm <slug>` à retaper** : écarté au profit des deux temps (`--yes`), le modèle de `pnpm test:cleanup --delete` et du MCP admin : le premier temps montre ce qui partira.
- **Rebrancher oto-saas sur Vercel** : écarté par D126 au profit d'un déploiement Scaleway.
- **Inviter le premier administrateur depuis l'écran Équipes après la création** (le parcours jusqu'au 2026-10-14) : écarté ; une organisation pouvait rester sans membre, et le créateur qui en était le premier administrateur devait s'inviter et accepter son propre email.
- **Retirer l'accès `creation` quand le créateur devient membre** : écarté ; l'accès trace l'entrée de l'équipe plateforme pour le client (D2) et survit au retrait du membre.
- **Refuser `add_admin` pour un membre présent** : écarté au profit de la promotion, le geste qu'un administrateur fait à l'écran Équipes ; une invitation de ce membre serait refusée (`already_member`, `invitations_guard`).
- **Lien de l'invitation vers l'adresse du MCP admin** : écarté ; cette adresse n'ouvre pas forcément l'organisation de l'invité.

## Sécurité et confidentialité

- Le MCP admin refuse tout jeton hors équipe plateforme sans servir de métadonnées (E08-S02 N2) ; une organisation sans accès se dit inconnue (E08-S02 N9).
- `admin_cell` ne sert jamais la valeur d'une variable (E08-S04 NH5) ; une exception du point d'extension n'est jamais servie ni journalisée (HN-E09S02-9).
- La RLS reprend le rôle des gestes d'administration (`20261019150000` pour les suppressions, `20261020190000` pour les ajouts et modifications, `20261021090000` pour l'exclusion de l'entrée sans invitation) : sous son seul jeton, un membre simple n'exclut personne de l'entrée sans invitation, ne retire, n'ajoute ni ne promeut un membre, ne crée, ne renomme ni ne retire une équipe, ne s'en nomme pas responsable, n'invite pas, ne révoque que ses propres invitations, ne crée ni compte d'organisation ni compte d'équipe, n'active pas de connecteur, ne règle pas l'organisation (`settings.demo` compris) et ne pose de règle que sur un nœud qu'il gère ; un responsable n'ajoute ou ne retire qu'un membre de son équipe et n'y invite qu'au rôle membre ; rattacher ou retirer une adresse et accorder un accès plateforme sont à l'équipe plateforme qui administre ; traiter un retour aussi, et à l'administrateur du client quand « Retours visibles » est allumé.
- `platform_staff` ne s'écrit par aucune porte du paquet (E08-S02 N21) ; l'export-import passe par la connexion d'administration, jamais importée par l'application.
- Se nommer administrateur (`claim_org_admin`) est réservé à qui administre déjà l'organisation comme membre de l'équipe plateforme : aucun pouvoir de plus qu'une invitation acceptée. Il ne lève pas une exclusion (`member_exclusions`), que seule une invitation acceptée lève.
- Le journal admin vit à part (`admin_journal`) ; le masquage de l'espace personnel d'autrui s'y applique : [journal et retours](journal-et-retours.md).

## Écart avec le code

- M73 : services et API des règles d'accès et des accès plateforme sans écran client ; `EcranUsage` et `usageSummary` sans page.
- M85 : `org:export`, `org:import`, `test:cleanup` et `oauth:clients` n'ont pas de mode sans Supabase. M86, M87 : objets orphelins du stockage après une suppression hors purge (`forget_user`, `test:cleanup`, `demo:seed` ; `org delete` retire ceux de l'organisation), et `org:export --force` qui peut laisser l'ancien JSON à côté d'objets en partie réécrits.
- `org delete` : un envoi signé avant la suppression peut encore arriver dans le bucket pendant sa durée (5 minutes, `UPLOAD_URL_SECONDS`) ; relancer la commande après ce délai le retire.
- M65 : `RailThemePicker`, les écrans Marque, Drapeaux et Accès plateforme et leurs clés d'adresse restent à retirer.
- V2 : registre central des versions de plusieurs applications (E08-S10), sondes de santé et alertes des comptes (E08-S08).
- Le déploiement Scaleway d'oto-saas (D126) est une action réservée à JB, pas encore faite.

## Questions ouvertes

Aucune à ce jour.

## Historique

- 2026-09-28 : oto-saas déployé chez Scaleway, pas rebranché sur Vercel — décidé par JB (source : fiche D126).
- 2026-09-29 : MCP admin en huit outils, journal à part, tableau de bord, drapeaux, état de la cellule ; sous-domaines hors du paquet par un point d'extension de l'hôte, marque, export-import d'une organisation, livrés dans la 1.0.0 — décision de JB (fiche D24) et choix du projet (source : H105 à H107, H110 à H112, P29, stories E08-S02 à E08-S06, E09-S02, E09-S04).
- 2026-10-01 : refonte en document de conception vivant, qui reprend D24, D126, H105 à H107, H110 à H112, P29, H-cellule-saas et les choix des stories E08-S02, E08-S03, E08-S04, E08-S06, E09-S02, E09-S04 — décidé par Alexis, accord de JB.
- 2026-10-14 : premier administrateur exigé à la création d'une organisation par l'équipe plateforme (`admin_email` : l'appelant membre `admin` sans email, ou une invitation `admin`), et `admin_org add_admin` pour une organisation existante ; l'accès `creation` reste — décidé par Alexis (source : une organisation de production créée par un membre de l'équipe plateforme qui n'en était pas membre).
- 2026-10-19 : suppression d'une organisation par la commande de l'outillage `oto-platform org delete` (stockage d'abord, base en une transaction, journal admin anonymisé, ligne « organisation supprimée ») — décidé par Alexis (source : un hôte en fin de contrat).
- 2026-10-19 : une session ne supprime plus une organisation (droit `delete` retiré à `authenticated`, policy `orgs_delete_admin` neutralisée) : la commande de l'outillage est le seul chemin — décidé par Alexis (source : l'écart relevé avec la commande `org delete`).
- 2026-10-19 : le lien de l'invitation d'un administrateur nommé par l'équipe plateforme est en `https` sans port hors du poste local, sans lire `x-forwarded-proto` ; les policies d'administration exigent le rôle de leur service (`20261019150000`) — décidé par Alexis (source : revue de sécurité des policies qui ne vérifiaient que l'appartenance).
- 2026-10-20 : les policies d'ajout et de modification exigent aussi le rôle de leur service (`20261020190000`) — décidé par Alexis (source : même revue, un membre simple se promouvait administrateur ou invitait avec son seul jeton).
