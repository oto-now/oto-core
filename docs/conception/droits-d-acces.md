# Droits d'accès

- **Statut** : validé avec JB le 27/09/2026
- **Dernière révision** : 2026-10-18

## Résumé

Quatre niveaux (aucun, lecture, écriture, gestion) se calculent dans le service, pour une personne, sur un nœud de l'arbre ; un compte de connecteur en a un cinquième, sensible, entre l'écriture et la gestion.
Une règle vise une personne, une équipe ou l'organisation entière ; la plus proche dans l'arbre l'emporte, l'administrateur gère tout sauf les espaces personnels.
L'équipe plateforme n'entre dans une organisation que par un accès daté, que l'administrateur du client voit et révoque.

## Contexte

Le contenu d'une organisation est un arbre de nœuds ([nœuds et arbre](noeuds-et-arbre.md)) ; les
comptes de connecteur appartiennent à l'organisation, à une équipe ou à une personne
([connecteurs et comptes](connecteurs-et-comptes.md)). Il faut dire qui lit, écrit et gère chacun,
le dire de la même façon à l'écran, par l'API et par le MCP, et ouvrir un contenu à toute
l'organisation sans entretenir une équipe « Tout le monde ». Où se décide un droit (dans le
service, la RLS ne gardant que l'isolation par organisation) est porté par
[base et portabilité](base-et-portabilite.md) (ADR-012 § 3).

## Objectifs et non-objectifs

- Un seul calcul de niveau, en TypeScript dans `server/access*.ts`, et son pendant SQL
  `node_level_of` pour la recherche et la lecture publique, égaux par un test de parité.
- Un refus dit à qui demander l'accès ; un nœud invisible ne se distingue pas d'un chemin inconnu.
- Ouvrir un contenu à toute l'organisation en un geste, en lecture ou en modification.
- Hors objectif : une règle qui vise quelqu'un du dehors (le lien public est un partage à part,
  [partage public](partage-public.md)) ; une vue des droits par le responsable pour l'usage
  ([journal et retours](journal-et-retours.md)).

## Conception

### Niveaux et calcul

- Quatre niveaux d'accès : aucun (0), lecture (1), écriture (2), gestion (3) (H65).
- Écrire et publier exigent le niveau écriture, en-tête d'un tableau compris ; la gestion garde le partage, les règles, le déplacement, la corbeille et le propriétaire. Le chemin qui suit un titre publié change au niveau écriture ; l'ancien chemin reste un alias qui mène au nœud (H63, fiche D135).
- Niveau sur un nœud : l'administrateur gère tout sauf l'espace personnel ; le responsable de l'équipe propriétaire garde la gestion sauf règle qui le nomme ; sinon la règle la plus proche dans l'arbre, même plus basse (à même nœud, la plus précise : personne, équipe, organisation ; une règle d'organisation ne retire rien au propriétaire) ; sinon le propriétaire effectif décide (H66).
- Le responsable de l'équipe propriétaire effective garde la gestion d'un nœud ou d'un compte de son équipe : une règle qui vise son équipe ne la lui retire pas, seule une règle qui le vise nommément la baisse ; l'admin garde la gestion (E01-S04 N7). Une règle posée sur l'équipe propriétaire ne ferme pas son responsable (niveau 3) ; un membre de cette équipe sans règle nominative prend le niveau de la règle d'équipe (E01-S04 N26). Une règle nominative `none` sur un ancêtre ôte au responsable sa gestion ; son niveau vient de la règle la plus proche qui le vise, lui ou ses équipes (1 sur `ventes/devis`, 0 sur `ventes`) (HN-E01S07-16).
- Une règle d'équipe posée au-dessus du dossier d'une équipe devient sa règle la plus proche et peut baisser son niveau ; le responsable garde la gestion ; pour garder l'écriture, poser aussi une règle d'écriture sur le dossier (D20).
- L'administrateur d'une organisation a la gestion sur tout, sauf les espaces personnels ; un nœud qu'un gestionnaire rend personnel sort donc aussi de sa vue (D5). Dans un espace personnel, seules comptent les règles posées sur le nœud qui porte la personne comme propriétaire, ou en dessous : une règle posée plus haut (`perso`, la racine) n'ouvre l'espace à personne, pas même à l'admin (E01-S04 N35).
- Niveau sur un compte : même calcul, sans héritage, sur l'échelle des comptes : aucun (0), lecture (1), écriture (2), sensible (3), gestion (4) (`ACCOUNT_LEVELS`, à part de celle des nœuds, qui ne change pas). Par défaut, compte d'organisation en lecture (gestion à l'administrateur), d'équipe jusqu'au sensible pour ses membres (gestion au responsable), personnel à son seul propriétaire, qui le gère quelles que soient les règles. Une fonction de lecture exige la lecture, d'écriture l'écriture, sensible le niveau sensible (H67, partage des comptes).
- Le niveau d'un nœud se calcule en SQL sur les colonnes de la ligne (`node_level_of`, definer) ; la recherche filtre par `node_level_for`, qui l'applique à l'appelant ; le niveau d'un compte n'a plus de pendant en base (E01-S04 N24). Un seul test de parité : les décisions du service sur les nœuds comparées à `node_level_for` sous la même session, à l'égalité stricte ; l'exactitude du calcul pur se prouve sans base (HN-E01S07-13).

### Faits lus par le service

- `Identity.hasOpenGrant` : accès plateforme en cours de l'appelant à l'organisation ; `isOrgAdmin` = rôle `admin`, ou `isStaff` et `hasOpenGrant`, comme `platform.is_org_admin` ; `leadsTeam` lit les équipes de l'identité (HN-E01S07-2). Un membre de l'équipe plateforme avec un accès en cours administre l'organisation même s'il a une ligne `members` au rôle `member` (`isOrgAdmin`, en parité avec `platform.is_org_admin`) (HN-E05S03-40).
- Par appel de service, les faits de droits des nœuds ou comptes touchés se lisent en un lot (cibles, ancêtres par chemin, règles : trois lectures au plus), sans cache d'une requête à l'autre ; une lecture en échec lève (HN-E01S07-3). Les faits se lisent dans la seule organisation de l'identité : un nœud ou un compte d'une autre organisation de l'appelant vaut 0 à l'adresse de celle-ci (HN-E01S07-17).
- Une décision sur un nœud dont un ancêtre manque à la lecture (parti pendant elle) prend le propriétaire effectif de `platform.node_owner` ; une liste au seuil de la lecture s'en passe (HN-E01S07-4). `nodeLevels` n'appelle jamais `node_owner` : un nœud dont un ancêtre manque y est ramené à la lecture ; une décision d'écriture ou de gestion passe par `nodeLevel` ou `requireNodeLevel`, et un service ne décide que par `access.ts` (HN-E01S07-19).
- `node_owner` rend aussi le nœud qui porte le propriétaire effectif (`owner_node_id`) ; `staff_directory()` rend l'annuaire de l'équipe plateforme au seul staff (E01-S04 N9).
- Une borne de liste s'applique à ce que le service sert : filtre dans la requête, borne dans la requête ; filtre en mémoire, la requête lit l'ensemble candidat et le service coupe après (HN-E01S07-8). Sur la face SQL, le paquet lit chaque lot en entier, sans pages ; la base simulée des tests rend au plus 1 000 lignes par lecture (`SERVER_MAX_ROWS`), comme `max_rows` de PostgREST (HN-E01S07-24).

### Refus

- Un nœud invisible répond `not_found`, comme un chemin inconnu ; sur un nœud visible sans le niveau voulu, le refus dit à qui demander (« … is reserved to team Ventes (lead: …). Ask them for access. ») (H68).
- Une écriture qui ne rend aucune ligne après une décision positive est un `conflict` (« … changed meanwhile. Reload … and retry. »), nommé au log serveur, jamais `forbidden` ni `not_found` (HN-E01S07-6). Une règle posée puis retirée pendant sa pose (`23505`, puis relecture vide) rend `conflict` (« Rechargez la page »), sans nouvel essai (HN-E05S03-39).

### Règles d'accès

- Une règle d'`access_rules` vise un nœud ou un compte, pour une équipe ou une personne (l'organisation entière selon ADR-014) ; aucune table d'accès propre aux comptes (H82).
- Trois sujets de règle : une personne (`subject_user_id`), une équipe (`subject_team_id`) ou l'organisation entière (`subject_org` vrai : tous les membres de l'organisation de la règle). Une règle porte exactement un sujet (contrainte de base) ; une règle d'organisation vise un nœud ou un compte (partage des comptes) ; une règle est unique par cible et sujet (ADR-014 § 1). Le niveau `sensitive` n'existe que sur une règle de compte (`access_rules_level_check`).
- Une règle d'organisation compte pour chaque membre, avec les mêmes règles d'héritage par l'arbre ; à un même nœud, la plus précise l'emporte (personne, puis équipe, puis organisation ; à précision égale, le niveau le plus haut). Elle ne retire rien à ce que donne le propriétaire, elle ouvre au-delà ; l'espace personnel n'en admet pas (le service refuse, le calcul l'ignore) (ADR-014 § 2).
- Qui gère un nœud pose des règles pour une autre équipe, une personne ou toute l'organisation, en lecture ou en écriture ; une règle de gestion reste réservée à l'administrateur ; une règle ne vise jamais quelqu'un du dehors (le lien public est à part, ADR-013) (D4, ADR-014 § 3). Une règle `manage` ne se pose que par qui administre l'organisation (`isOrgAdmin`) ; un responsable d'équipe ou tout autre gestionnaire du nœud pose `none`, `read` ou `write`, et l'écran ne lui propose pas la gestion (E01-S04 N6).
- `access_rules` ne se met à jour que sur `level` (privilège de colonne) : un service relit la règle du couple cible-sujet, puis met à jour `level` ou insère ; jamais d'upsert, qui réécrirait toutes les colonnes (E01-S04 N15).
- À l'écran, « Accès général » vaut « Seulement les personnes ajoutées » (aucune règle d'organisation) ou « Toute l'organisation » avec un niveau (« Peut lire », « Peut modifier », « Accès complet » pour l'admin) (ADR-014 § 4). « Accès général » ouvre un contenu à toute l'organisation en lecture ou en modification ; l'adresse d'un contenu suit son titre partout, assistants compris, l'ancienne restant un alias ; l'export d'une organisation emporte la corbeille ; un contenu restauré revient sous son plus proche ancêtre encore là (D101).
- Portabilité : colonne et contrainte dans `platform` ; calcul dans le service et dans `node_level_of`, le seul corps SQL du niveau, que gardent la recherche (`node_level_for`) et la lecture publique (ADR-012 § 3, ADR-013) ; aucune dépendance à Supabase (ADR-014 § 5).
- Les droits se règlent dans « Partager » : « Règles d'accès » et « Accès plateforme » ont quitté l'écran Équipes & accès, l'accès du support d'Oto passant par la console admin ; l'espace Démo est vidé de ses contenus et de ses équipes à la fin, les tests de bout en bout semant leurs propres données (D127, JB, 2026-09-28).

### Partage d'un compte de connecteur

Origine : un incident d'oto 1, où une personne sans compte propre a écrit dans la boîte d'une collègue sans le savoir ; la règle d'oto 1 du 15/10 (`partage-de-compte.md` d'oto-backend) est reprise, partie d'un seul geste.

- **Sujets** : un compte, personnel compris, se partage à une personne, à une équipe ou à l'organisation entière (`subject_org` sur une règle de compte). Une règle de personne ou d'équipe l'emporte sur celle de l'organisation ; sans elles, le compte prend le plus haut du défaut de son propriétaire et de la règle d'organisation, comme un nœud.
- **Servir** : pour tout connecteur, l'ordre est le compte nommé, puis son propre compte personnel, sans être nommé, puis celui de l'équipe porteuse, puis celui de l'organisation (`chooseAccount`, `resolution.ts`). Son propre compte qui sert lève l'ambiguïté entre deux équipes capables. Le compte personnel d'un autre, même partagé au bon niveau, ne sert que nommé.
- **Refus** : faute de compte, ou sous le niveau partout, le refus nomme les comptes personnels partagés avec l'appelant au niveau voulu, chacun avec son propriétaire, et demande de les montrer à l'utilisateur sans choisir (`details.shared_accounts`, comme `ambiguous_account`). Un connecteur à consentement demande toujours de connecter le sien, avec la même mention.
- **À qui** : chaque réponse de `call` dit à qui est le compte servi (`account.owner` : l'organisation, l'équipe, ou la personne, son nom et `yours`) ; quand il est à une autre personne, une ligne le dit au texte et au récapitulatif d'une fonction sensible, et le journal l'écrit en clé réservée `_lent_by` (l'identifiant de la personne qui l'a partagé), l'équivalent du `lent_by` d'oto 1.
- **Départ** : quand une personne quitte l'organisation, son compte cesse aussitôt de servir aux autres : `accountRows` (`connectors/accounts.ts`) lit à chaque appel si le propriétaire est encore membre (`owner_left`), seul point d'entrée d'une future pause. Rien n'est supprimé (compte, secret, règles sur le compte) ; nommé, il est refusé (« no longer serves: its owner has left … », sans son nom, que l'annuaire ne garde plus) ; il ne se propose ni ne se mentionne plus. La personne revenue, il sert de nouveau.
- **Niveaux** : les droits d'un compte se règlent par classe, par compte et par personne, équipe ou organisation : lecture, écriture, sensible. Pas de droit fonction par fonction. Les règles de compte à `write` d'avant le niveau sensible sont passées à `sensitive` par la migration, pour garder ce qu'elles ouvraient.
- **Journal** : chaque règle de compte posée, remplacée (niveau changé) ou retirée s'écrit dans `account_share_events` (qui, quel compte, vers qui, quel niveau, l'ancien, quand), par un déclencheur sur `access_rules`, dans la transaction du geste : services, départ d'une personne (`members_cleanup`) et outillage compris ; l'auteur est l'appelant de la session (`auth.uid()`), nul hors session. Seule la personne qui gère le compte le lit (`listAccountShareJournal`, `GET admin/accounts/<id>/share-journal`, « Journal des partages » sous le compte à l'écran Connecteurs) : pour un compte personnel, son propriétaire. `forget_user` y efface la personne, pas l'événement ; l'export d'une organisation ne le porte pas, l'import l'écrit en reposant les règles.
- **Plus tard** : une organisation pourra interdire les comptes personnels d'un connecteur, partage compris.

### Propriétaires, déplacements, personnel

- Un nœud à propriétaire hérité (`owner_kind` NULL) ne porte ni `owner_team_id` ni `owner_user_id` (contrainte `nodes_owner_inherited_check`, écrite sans comparaison qui puisse valoir NULL) (E01-S04 N32).
- Déplacer un nœud exige la gestion sur lui et l'écriture sur la destination ; un cycle est refusé par déclencheur ; le propriétaire explicite suit le nœud, le propriétaire hérité devient celui de la nouvelle place (H71).
- Tout gestionnaire d'un nœud d'équipe (responsable, ou règle de gestion) peut le rendre personnel, par son propriétaire ou en le déplaçant dans un espace personnel ; l'administrateur ne le voit plus (D18).
- Un compte ne change ni d'organisation ni d'identifiant (mise à jour accordée colonne par colonne, sans `id`, `org_id`, `created_at`, `updated_at`) ; changer son propriétaire exige la gestion avant et après, décidée par le service (E01-S04 N30) : sur la ligne d'avant et sur la ligne écrite, et le rendre personnel est réservé à l'administrateur (`accountOwnerChangeAllowed`, `access-levels.ts`) (HN-E01S07-10). Sous un jeton, seul un administrateur (ou le staff avec un accès en cours) rend personnel un compte qui ne l'était pas (`accounts_guard`, `42501`) (E01-S04 N37).
- `nodes_guard` contrôle le chemin avant tout (segments `[a-z0-9_]`, 1 000 caractères au plus, NULL refusé : `23514`) : la colonne générée `lpath` (`text2ltree`) ne reçoit jamais un chemin invalide (E01-S04 N33). Sous un jeton, il prend `pg_advisory_xact_lock(7301, hashtext(org_id))` avant de lire le parent, à toute insertion et tout déplacement : les écritures de l'arbre d'une organisation passent une à une (un interblocage `40P01` en annule une) (E01-S04 N36).

### Équipes et membres

- Le responsable d'équipe gère les nœuds de son équipe, y ajoute ou retire des membres de l'organisation, y invite au rôle membre, et pose des règles d'accès pour une autre équipe, une personne ou toute l'organisation, jamais pour quelqu'un du dehors (un lien public est un partage à part, ADR-013) (H72).
- Une équipe a plusieurs responsables : `team_members.role` est la source (« Lead: A, B. » dans le texte servi) ; l'équipe par défaut est supprimée du modèle en deux temps (ADR-006) : depuis la 1.0.0 plus rien ne la lit ni ne l'écrit (écrans, service ; un connecteur sans équipe précisée demande laquelle, `ambiguous_team`), la colonne vidée part en 1.1 ; « Usage » caché ; textes par portée : Tout le monde « Ce que les assistants de tous les membres de l'organisation lisent à chaque conversation. », équipe « Ce que les assistants des membres de l'équipe X lisent à chaque conversation. », Privé « Ce que votre assistant lit à chaque conversation ; vous seul le recevez. » (D128, JB, 2026-09-28).
- Les choix de la story E05-S13 qui a porté ces retours se citent par lot (HN-E05S13) : A1 à A11 (lignes servies traduites à l'écran, repli sur le texte servi), B1 à B7 (Retours réservés à l'équipe plateforme par `handlesFeedback`, Usage réduit à `notFound()`), E1 à E9 (organisation jetable par campagne), M-1 à M-14 (rôle de membre source des responsables, retrait d'un responsable réservé à l'administrateur, appel sans équipe nommée : la seule équipe qui a un compte, sinon `ambiguous_team`), I1 (avis de budget sans chiffre).
- Retirer le responsable de son équipe est refusé (`conflict`, `is_lead`) : il faut d'abord nommer un autre responsable ou « Sans responsable » (HN-E05S03-6). Retirer une personne d'une équipe demande confirmation, par un dialogue « Retirer X de l'équipe ? » (D94) ; retirer une personne ou supprimer une équipe passent par `ConfirmDialog`, un geste destructeur d'une ligne (`ActionPlateforme`) et une question de l'éditeur se confirment en ligne, « Garder » d'abord (HN-E05S03-2). Un refus `not_found` d'un geste confirmé rend l'alerte, donne le focus à l'ancre de la liste puis relit la page ; les autres refus gardent la ligne et rendent le focus au bouton (HN-E05S03-31).
- `ui/` relit la page après une mutation par `ContexteDeRafraichissement`, que l'hôte remplit (`router.refresh` dans Next) ; sans fournisseur, `window.location.reload()` (HN-E05S03-1). Les dates des écrans sont en `fr-FR`, fuseau `Europe/Paris` fixe, sans fuseau par personne (HN-E05S03-5).
- Slug d'équipe : nom sans accents, en minuscules, tout caractère hors `[a-z0-9]` remplacé par `_`, 40 caractères au plus, `equipe` à défaut ; unique par organisation, et nom unique sans casse ni accents (HN-E05S03-8). `name_taken` quand une autre équipe porte ce nom (sans casse ni accents) ou un nom de même slug ; `slug_taken` quand seul le slug figé d'une équipe renommée est pris ; mêmes refus au renommage (HN-E05S03-32). Dans une organisation qui a son arbre, le slug d'une équipe doit être un segment de chemin (`[a-z0-9_]`), son nom tenir en 124 caractères et le `handle` d'un membre être un segment, sinon la création échoue (`23514`) (E01-S04 N28).
- La mise à jour de `teams` n'est accordée à `authenticated` que sur `name` et `lead_user_id` : le slug, chemin du dossier de l'équipe, et l'organisation sont figés (E01-S04 N38). `team_members_update_admin` exige, comme l'insertion, que la personne soit membre de l'organisation de l'équipe : un non-membre n'entre pas dans une équipe par une réécriture de `user_id` (E01-S04 N31).
- Une équipe qui possède des nœuds ou des comptes ne se supprime pas (clés différées sans action ; le service liste quoi transférer) ; supprimer une organisation emporte équipes et nœuds ; les règles qui visent l'équipe tombent avec elle (H69). `nodes.owner_team_id` et `accounts.owner_team_id` sont des clés `no action deferrable initially deferred`, `parent_id` en `no action` : ce qui possède encore un nœud ou un compte ne se supprime pas seul (`23503`) ; une organisation part entière (E01-S04 N4).
- Retirer un membre retire, par déclencheur et dans la même transaction, ses appartenances d'équipe et ses règles nominatives ; la coupure vaut dès la requête suivante ; ses nœuds personnels restent, invisibles de tous (H70).
- `listInvitations` sert à l'administrateur toutes les invitations, aux autres celles des équipes qu'ils mènent et celles de leur email ; `revokeInvitation` rend le même `not_found` pour une invitation inconnue, close ou hors de ses droits (HN-E01S07-7).
- Se retirer de l'organisation ou révoquer son propre accès plateforme ne laisse aucune ligne de journal : écrite après la réponse sous le jeton de l'appelant, elle est refusée par `journal_insert_own` ; un test fixe cette limite (HN-E05S03-36).

### Équipe plateforme

- L'équipe plateforme (`platform_staff`) entre dans une organisation par un accès daté (`platform_grants`), donné à qui la crée, révocable par l'administrateur du client ; avec un accès en cours, elle agit en administrateur hors espaces personnels (H73). Elle reçoit un accès à l'organisation qu'elle crée et en nomme le premier administrateur, elle-même ou le client invité ([administration et cellule](administration-et-cellule.md)) ; l'administrateur du client voit ces accès, nommés et datés, et peut les révoquer (D2).
- Un membre de l'équipe plateforme avec un accès en cours peut devenir membre de l'organisation ; la liste des accès plateforme montre à côté les membres ajoutés par l'équipe plateforme (D17). Ces membres, lus dans `invitations`, ne se lisent et ne se servent qu'aux administrateurs de l'organisation, jamais au reste de l'équipe plateforme (HN-E01S07-C2).
- `platform_access_directory(p_org)` nomme, pour le staff et les administrateurs de l'organisation, qui tient ou a tenu un accès plateforme et qui en a accordé ou révoqué un sans être membre ; rien pour les autres (E01-S04 N14). Nom et email s'y lisent dans `platform_staff`, puis `members`, puis la copie posée sur l'accès (P27).

### Isolation de deux organisations

La suite d'isolation prouve qu'aucune ligne ne passe d'une organisation à l'autre :

- Une table sans ligne chez B fait échouer la suite : une preuve sur une table vide ne prouve rien (HN-E09S05-2). Le cas critique est la personne membre des deux organisations (`c`, administratrice d'A et de B) : services et porte MCP sont testés sous son identité, seule l'adresse séparant A de B (HN-E09S05-3).
- Le clone d'une ligne de B omet ce qu'`authenticated` ne peut pas insérer (colonnes générées, identités, `blocks.id`…) : le refus doit venir de l'isolation, pas du privilège de colonne (HN-E09S05-6). Il porte l'appelant dans les colonnes comparées à `auth.uid()` (`user_id`, `created_by`, `invited_by`, `granted_by`, `activated_by`) et l'état d'une création (`feedback` ouvert, `sim_outbox` brouillon) (HN-E09S05-20).
- Sur un clone de B, une erreur de contrainte (check, clé étrangère, unicité, non-nul) est une fuite ; 42501, 23503 d'un parent invisible et 23514 d'un Contexte à l'équipe invisible sont des refus ; toute autre erreur fait échouer (HN-E09S05-12).
- L'absence d'un marqueur de B dans une recherche sur A ne compte que si le même terme rend la ligne de B sur B ; l'assertion porte sur les nœuds de B, le repli en OU de `search_content` pouvant rendre des lignes d'A (HN-E09S05-7).
- Portée plateforme : `p` lit les lignes de B dans `platform_grants` et `admin_journal`, et écrit à son nom dans le journal admin de B (policy d'insertion sans appartenance) ; la suite l'attend, puis retire la ligne (HN-E09S05-9).
- Base simulée des tests unitaires : `tests/helpers/simulated-db.ts` sert le sous-ensemble du client supabase-js sur des tables en mémoire, chaque filtre appliqué, aucune règle d'accès ; un opérateur non couvert lève, jamais ignoré (HN-E01S07-5). `tests/helpers/reference-org.ts` : O en mémoire, avec P (`OTHER_ORG`), autre organisation de Léa aux chemins de O, dans toute base simulée ; ses noms et équipes redisent `buildReferenceOrg` (HN-E01S07-20).

## Décisions et alternatives écartées

- **L'organisation propriétaire du nœud**, pour ouvrir un contenu à tous : ne donne que la lecture. Écartée (ADR-014).
- **Une équipe « Tout le monde » tenue à jour** : à synchroniser avec chaque arrivée et chaque départ. Écartée (ADR-014) ; aucune équipe « Tout le monde » n'existe en base.
- **`teams.lead_user_id` seule source du responsable, `team_members.role` dérivé par déclencheur** (P17) : remplacé par D128, qui fait de `team_members.role` la source pour admettre plusieurs responsables ; `lead_user_id` est vidé et part en 1.1 (M73).
- **L'équipe par défaut d'une personne** : « une équipe par défaut dont la personne n'est plus membre se lit `null` (« aucune »), sans déclencheur en base » (HN-E05S03-7) ne vaut plus, l'équipe par défaut étant retirée du modèle (D128).
- **La face SQL passe chaque liste en un seul paramètre (`= any(…)`), sans borne d'adresse ni tranches** (HN-E01S07-23) : marqué « Plus en vigueur » au registre ; le code a quitté ce choix.
- **Une autorisation répartie entre plusieurs sources et recalculée par les écrans** : écartée, leçon d'oto 1. Là-bas, savoir si un acteur peut un acte sur une ressource demandait de croiser quatre sources (octroi, trois axes de droits…, ADR 0053 et 0066 d'oto 1, archive oto-enterprise), et le front en refaisait une partie. Ici, un seul contrôle, dans le service, avant la requête ; les écrans ne lisent que ce que le service leur rend (`viewerLevel`, `gestionAccordable`) et n'en déduisent aucun droit.
- **« Règles d'accès » et « Accès plateforme » sur l'écran Équipes & accès** : retirés par D127 au profit de « Partager » et de la console admin.

## Sécurité et confidentialité

- Le refus est décidé par le service, avant sa requête (`security-patterns.md § Droits dans le service`) ; la RLS ne garde que l'isolation par organisation ([base et portabilité](base-et-portabilite.md)).
- Un nœud invisible est indiscernable d'un chemin inconnu (H68) ; l'espace personnel n'est ouvert ni par l'admin, ni par une règle d'organisation, ni par une règle posée plus haut (D5, E01-S04 N35).
- L'accès de l'équipe plateforme est daté, nommé et révocable par le client (H73, D2).

## Écart avec le code

- `default_team_id` et `lead_user_id` vidés restent en base, à retirer en 1.1 ; services et API des règles d'accès et des accès plateforme sans écran client (M73).
- Partage des comptes : l'écran Connecteurs est réservé à l'administrateur, si bien qu'un propriétaire qui n'administre pas lit le journal de son compte par la route seule ; aucune porte ne lui permet encore de poser une règle sur son compte (services seuls ; `admin_connector add_account_rule` ne prend ni l'organisation pour sujet ni un compte personnel qu'un administrateur ne gère pas) ; aucune pause d'un membre n'existe, `owner_left` d'`accountRows` est son point d'entrée (oto-now/oto-core#68).
- Upsert et vue du sujet des règles (`server/rules.ts`), curseur au-delà de 200 éléments (M18b) ; `DirectoryEntry.email` et `StaffEntry` en `string | null`, `server/admin/grants.ts` sur `sameEmail` (M20b) ; commentaires de `server/` rendus faux par l'isolation par organisation (M15b).

## Questions ouvertes

Aucune à ce jour.

## Historique

- 2026-09-24 : droits décidés et filtrés dans le service, RLS réduite à l'isolation (stories E01-S04, E01-S07, ADR-012) — décidé par JB (source : ADR-012).
- 2026-09-27 : l'organisation entière devient un sujet de règle, « Accès général » à l'écran — décidé par JB (source : ADR-014, fiche D101).
- 2026-09-28 : plusieurs responsables par équipe, équipe par défaut retirée, règles et accès plateforme hors de l'écran Équipes & accès — décidé par JB (source : fiches D127, D128, story E05-S13).
- 2026-10-01 : refonte en document de conception vivant, qui reprend ADR-014, les fiches D2, D4, D5, D17, D18, D20, D94, D101, D127, D128 et les choix H, P et de story — décidé par Alexis, accord de JB.
- 2026-10-05 : autorisation répartie et recalculée au front écartée, leçon d'oto 1 (ADR 0053, 0066) — décidé par Alexis (source : tri des issues d'oto-enterprise du 05/10).
- 2026-10-14 : l'équipe plateforme nomme le premier administrateur de l'organisation qu'elle crée (elle-même, membre sans email, ou le client invité) au lieu de l'inviter ensuite — décidé par Alexis (source : [administration et cellule](administration-et-cellule.md)).
- 2026-10-16 : partage d'un compte de connecteur — à l'organisation ou à une équipe ; son propre compte sans le nommer ; refus qui nomme les comptes partagés et leur propriétaire ; extinction au départ ; niveau sensible distinct ; journal des règles d'un compte — décidé par Alexis (source : revue des connecteurs d'oto 2 du 16/10, issue oto-now/oto-core#68).
- 2026-10-18 : partage des comptes écrit — échelle des comptes à cinq niveaux, règle d'organisation sur un compte, ordre son compte, équipe, organisation pour tout connecteur, `owner_left` lu à chaque appel, journal des partages par déclencheur et son écran — décidé par Alexis (source : issue oto-now/oto-core#68).
