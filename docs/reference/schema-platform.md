# Schéma `platform`

> Ce qu'on consulte : les tables, fonctions SQL, déclencheurs et policies du schéma `platform`. Les décisions qui les fondent sont dans [la conception](../conception/README.md) : [base et portabilité](../conception/base-et-portabilite.md), [nœuds et arbre](../conception/noeuds-et-arbre.md), [droits d'accès](../conception/droits-d-acces.md).

## Modèle de données

Tout vit dans le schéma `platform`, avec `org_id` sauf exception notée. Une personne est un
identifiant interne (`uuid`, sans clé vers un annuaire), que `identities` traduit du sujet de
l'émetteur ; son email et son nom sont des copies dans `members` et `platform_staff`. Le contenu
suit ADR-011 : des nœuds typés faits de blocs, dans une seule table ; une ligne de tableau est un
bloc `row`. Les nouveautés servies par `context` se calculent (versions publiées, activations) :
elles n'ont pas de table. Il n'y a pas d'équipe « Tout le monde » : l'organisation entière est un
sujet de règle (ADR-014).

```mermaid
erDiagram
    orgs ||--o{ org_domains : ""
    orgs ||--o{ invitations : ""
    orgs ||--o{ members : ""
    orgs ||--o{ teams : ""
    teams ||--o{ team_members : ""
    orgs ||--o{ nodes : "arbre"
    nodes ||--o{ nodes : "enfants"
    nodes ||--o{ node_versions : ""
    nodes ||--o{ node_aliases : ""
    nodes ||--o{ links : ""
    nodes ||--o{ blocks : "contenu (lignes comprises)"
    nodes ||--o| node_drafts : "brouillon ouvert"
    nodes ||--o{ node_shares : "liens publics"
    nodes ||--o{ files : "fichiers joints"
    nodes ||--o{ node_views : "vues à l'écran"
    orgs ||--o{ upload_tickets : ""
    orgs ||--o{ connector_consents : ""
    orgs ||--o{ hosted_link_requests : ""
    orgs ||--o{ member_exclusions : ""
    nodes ||--o{ access_rules : ""
    accounts ||--o{ access_rules : ""
    accounts ||--o{ account_share_events : "journal des partages"
    orgs ||--o{ accounts : ""
    orgs ||--o{ connector_activations : ""
    accounts ||--o{ sim_outbox : ""
    connectors ||--o{ accounts : ""
    connectors ||--o{ connector_activations : ""
    connectors ||--o{ sim_outbox : ""
    orgs ||--o{ ctx : ""
    ctx ||--o{ journal : ""
    ctx ||--o{ feedback : ""
    orgs ||--o{ platform_grants : ""
    orgs ||--o{ lexicon : ""
```

### Tables

| Table | Rôle | Colonnes |
|-------|------|----------|
| `orgs` | Un client | `slug`, `name`, `prefix` (immuable), `brand` `{theme, logo_url, display_name, language?}` (`theme` : un des huit thèmes d'Oto, couleur de tout compte sans choix ; `language` : langue de réponse par défaut), `settings` `{domains, routing: {threshold, gap}, demo}` — `domains` : les domaines de travail cités par la description de `context` (chaîne libre en anglais), `demo` : organisation de démonstration, seule que le script Démo resème —, `flags`, `rules_version` |
| `org_domains` | Adresse → organisation | `host` (clé, minuscules, sans port), `org_id` ; rattachée par l'équipe plateforme seule |
| `invitations` | Invitation en attente | `email` (minuscules), `role` (`admin` · `member`), `team_id`, `invited_by`, `expires_at` (7 jours), `accepted_at`, `accepted_by`, `declined_at`, `revoked_at` |
| `members` | Une personne dans l'organisation | `user_id`, `role` (`admin` · `member`), `default_team_id`, `profile` `{name, first_name, last_name, handle, language, theme}` (`handle` unique dans l'organisation ; `name` recomposé du prénom et du nom par `update_my_profile`) ; `email`, `name`, `last_sign_in_at` : copies posées à chaque connexion ; un membre nouveau reçoit son espace `private/<handle>`, titré « Privé » |
| `teams`, `team_members` | Équipes et appartenance | `slug` (ni `guide`, ni `perso`, ni `private`, ni `contexte`, ni `journal` ; ni `functions`, refusé par le service seul), `name`, `lead_user_id` ; `team_members.role` (`lead` · `member`), dérivé du responsable |
| `nodes` | Page, procédure, Contexte ou tableau (métadonnées ; le contenu est dans `blocks`) | `parent_id` (racine : null), `path` (unique par organisation ; suit le titre, segment de 60 caractères au plus coupé au dernier mot entier, l'ancien reste un alias ; un chemin pris donne le premier libre, `<segment>_2`, `_3`…, jamais un refus ; les espaces personnels sous `private`, anciens chemins `perso/…` gardés en alias), `lpath` (ltree généré), `kind` (`page` · `procedure` · `context` · `table` ; `context` ⇔ chemin de Contexte), `title` (≤ 200), `summary` (1 à 200), `status`, `revision` (0 = jamais publié), `position` (ordre parmi les frères ; nul = rangé par chemin), `deleted_at` (corbeille), `meta` (schéma d'un tableau seulement), `owner_kind` / `owner_team_id` / `owner_user_id` (null = hérité), `created_by`, `updated_by`, dates, `search_tsv` (générée : titre poids A, résumé poids B) |
| `pseudonym_orgs` | État de la pseudonymisation d'une organisation (aucune personne) | `org_id` (clé), `key_version`, `salt` (16 à 64), `witness` (témoin de la clé maître, 4 à 16), `generation` (avancée par l'invalidation), `created_at` ; RLS ; un membre lit la ligne de ses organisations (aucune personne, aucune clé), aucune session ne l'écrit : le serveur passe par `pseudonym_org` et `invalidate_pseudonyms` |
| `node_drafts` | Brouillon ouvert d'un nœud | `node_id` (clé), `base_revision`, en-tête en attente (`title`, `summary`, `kind`, `meta`), `created_by`, `updated_by`, dates |
| `blocks` | Tout le contenu : blocs des documents et lignes des tableaux | `id` (fabriqué par la base), `state` (`draft` · `published`), `org_id` (posé par la base), `node_id`, `position`, `type` (`heading` · `paragraph` · `list` · `checklist` · `code` · `call` · `mermaid` · `image` · `callout` · `reference` · `simple_table` · `divider` · `toggle` · `file` · `embed` · `row` ; titres de niveau 1 à 5, listes imbriquées sur trois niveaux ; `file` : `{file_id, name, size, mime}`, repris de la ligne `files` ; `embed` : `{url, height?}`, `url` en `https://` sans blanc ni guillemet, `height` parmi `small` · `medium` · `large` ; `image` : `src` (`https`) ou `file_id`, jamais les deux, et `width` facultatif `small` · `medium` · `full`), `text` (nul pour un `row` et un `file`), `data`, `key` (obligatoire et immuable pour un `row`), `provenance`, `revision`, `claimed_by`, `claimed_by_user`, `lease_until`, auteurs, dates, `search_tsv` ; clé (`id`, `state`) ; unique (`node_id`, `state`, `key`) |
| `node_versions` | Historique publié | `node_id`, `revision`, `title`, `summary`, `kind`, `meta`, `blocks` (instantané des blocs publiés ; sans lignes pour un tableau), `author`, `created_at` |
| `node_aliases` | Anciens chemins | `old_path`, `node_id` ; clé (`org_id`, `old_path`) |
| `links` | Liens `[[…]]` et blocs `reference` | `source_node_id`, `source_block_id`, `target_path`, `target_key` (`[[chemin#clé]]`), `target_node_id` (null si sans cible) |
| `node_views` | Vues des pages à l'écran (1.4.13), jamais exportées | `node_id`, `user_id` (clé vers `members` avec `org_id`, en cascade), `day` (jour de l'horloge de la base, jamais inséré), `views` (1 à 1 000 000, augmenté par une ouverture de plus le même jour : une vue à moins d'une minute de la précédente ne compte pas), `last_at` (la dernière vue, comptée ou non) ; clé (`org_id`, `node_id`, `user_id`, `day`), index (`org_id`, `day`), (`org_id`, `user_id`, `day`) et (`node_id`) ; lues dans l'organisation, écrites par la personne pour elle-même sur une page de son organisation (`insert … on conflict do update`, `update` accordé sur `views` et `last_at` seuls) ; les lignes de plus de 90 jours retirées par le service à chaque vue (policy `node_views_delete_expired`) |
| `node_shares` | Lien public d'un nœud (ADR-013) | `node_id`, `token` (43 caractères base64url, unique), `include_children`, `created_by`, `created_at`, `revoked_at` ; un seul lien actif par nœud |
| `files` | Fichier joint à un nœud (ADR-016), ou en transit (sans nœud, à échéance) : métadonnées seules, les octets dans le stockage sous la clé `<org_id>/<id>` | `node_id` (cascade ; nul pour un fichier en transit), `name` (1 à 255, jamais dans la clé), `mime`, `size` (1 octet à 50 Mo), `status` (`pending` · `ready` ; insertion `pending` seule ; passage à `ready` par `mark_files_ready` seule), `created_by`, `created_at`, `expires_at` (posée pour un fichier en transit, et pour lui seul : `files_transit_check` ; une heure, à l'horloge de la base : `expires_at_clock`) ; un fichier en transit ne se lit, ne se modifie et ne se supprime que par son auteur (RLS) ; quota de 10 Go par organisation sous le verrou 7501, lu par `org_files_bytes` ; un fichier appartient à un seul nœud |
| `upload_tickets` | Ticket d'envoi d'`upload.link` (ADR-018), jamais exporté | `user_id`, `ctx`, `token_hash` et `form_token_hash` (empreintes SHA-256 des jetons de `curl` et du formulaire, uniques, jamais un jeton), `kind` (`file` · `md` · `csv`), `mode`, `target_path`, `name`, `title`, `summary`, `key`, `base_revision`, `publish`, `expires_at` (15 minutes, à l'horloge de la base : `expires_at_clock`), `used_at` ; lu par sa personne et, expiré, par tout membre ; aucune mise à jour hors `consume_upload_ticket` |
| `connector_consents` | Demande de consentement d'une personne à un connecteur `oauth2_user`, jamais exportée | `state_hash` (empreinte SHA-256 du `state`, clé, jamais le `state`), `user_id`, `connector` (clé vers `connectors`), `return_to` (chemin de l'écran de retour), `expires_at` (10 minutes, à l'horloge de la base : `expires_at_clock`) ; posée, lue et consommée (supprimée) par sa personne ; expirée, purgée par tout membre |
| `hosted_link_requests` | Demande de branchement hébergé d'un compte à un connecteur à `account_identity`, jamais exportée | `user_id`, `connector` (clé vers `connectors`), `kind` (`create` · `reconnect`), `return_to` (chemin de l'écran de retour), `created_at` (posée par la base : fonde la garde de provenance), `expires_at` (une heure au plus), `consumed_at` (posée par `link_hosted_account` seule, avec toutes les demandes ouvertes de la personne pour ce connecteur) ; posée, lue et retirée par sa personne ; expirée, purgée par tout membre ; aucune mise à jour |
| `member_exclusions` | Personne retirée d'une organisation par un administrateur : l'entrée sans invitation la refuse ; jamais exportée | `org_id`, `user_id` (clé), `excluded_at`, `excluded_by` ; inscrite par `removeMember`, levée par une invitation acceptée, supprimée par `forget_user` |
| `access_rules` | Un droit | `node_id` **ou** `account_id` ; exactement un sujet : `subject_team_id`, `subject_user_id` ou `subject_org` (nœud ou compte, ADR-014 et partage des comptes) ; `level` (`none` · `read` · `write` · `manage`, et `sensitive` sur un compte seulement) ; unique par cible et sujet |
| `account_share_events` | Journal des partages d'un compte : une ligne par règle de compte posée, remplacée ou retirée ; jamais exporté | `org_id`, `account_id` (cascade), `action` (`set` · `removed`), `subject_kind` (`team` · `user` · `org`), `subject_id` (sans clé : l'équipe ou la personne peut partir), `level`, `previous_level` (niveau remplacé), `actor_user_id` (`auth.uid()` du geste, nul hors session), `at` ; écrit par le déclencheur `access_rules_account_share_journal` seul, lu sous RLS par un membre, le service le réservant à qui gère le compte ; `forget_user` met la personne à nul |
| `platform_staff` | Équipe plateforme (sans `org_id`) | `user_id` (clé), `email`, `name`, `added_by`, `added_at` ; écrite par l'outillage seul |
| `platform_grants` | Accès d'un consultant à une organisation | `user_id`, `granted_by`, `granted_at`, `revoked_at`, `revoked_by`, `reason` ; `user_email`, `user_name` copiés de `platform_staff` ; un seul accès en cours par couple ; révocation datée par la base |
| `identities` | Correspondance d'une personne chez l'émetteur (sans `org_id`) | `issuer`, `subject` (clé), `user_id` (unique par émetteur) ; ni email ni nom ; écrite par `identity_for_caller()` seule |
| `connectors` | Connecteurs connus de l'hôte (sans `org_id`), lus par toute session, écrits par une migration seule | `name` (clé, `^[a-z][a-z0-9_]{0,39}$`), `label` ; `accounts`, `connector_activations` et `sim_outbox` y renvoient par clé étrangère (`on update cascade`, `on delete restrict`) : un connecteur cité ne se supprime pas, un nom inconnu est refusé (`23503`) |
| `accounts` | Compte de connecteur ; `authenticated` n'en modifie aucune colonne, l'état, sa raison, les réglages, le secret, les jetons et les droits accordés s'écrivent sous `platform_server` | `connector` (clé vers `connectors`), `owner_kind` (`org` · `team` · `user`), `owner_team_id` (clé différée : une équipe qui possède un compte ne se supprime pas), `label` (unique sans casse dans l'organisation), `status`, `health` (objet ; `mark`, la marque du compte, `{reason, at}`, `reason` `credential_rejected` ou `quota_exhausted` : posée par un appel que le tiers refuse ainsi, levée au premier appel réussi ; lu par `authenticated`, ni inséré ni mis à jour par lui : écrit par `mark_account` seule), `mode` (`simule` pour un connecteur simulé, `reel` pour un connecteur réel ; `sandbox` pas encore admis), `secret_ciphertext` (les champs du secret, objet JSON chiffré par le coffre du paquet, `v2:…`, `v1:…` lisible ; jamais accordée en lecture, lue par `account_secret` seule), `secret_fields` (noms des champs posés) et `secret_updated_at` (dernière saisie, version de la fusion), `settings` (réglages en clair, objet), `token_ciphertext` (jeton d'un échange, chiffré à part ; jamais accordée en lecture, lue par `account_token` seule) et `token_expires_at`, `status_reason` (raison d'un état `error` : un consentement à reconnecter, 500 caractères au plus), `granted_scopes` (droits accordés au dernier consentement ou renouvellement d'un compte `oauth2_user`, en clair), `linked_id` (identifiant du compte chez le tiers d'un connecteur à `account_identity`, liste blanche `^[A-Za-z0-9_-]{1,128}$`, unique par organisation et connecteur ; ni lu ni écrit par `authenticated` : lu par `account_linked_id` et `my_hosted_accounts`, écrit par `link_hosted_account` seule ; jamais exporté) et `linked_at` ; insertion colonne par colonne |
| `connector_activations` | Connecteur ouvert chez ce client | `connector` (clé vers `connectors`), `state` (`active` · `inactive`), `activated_by` ; clé (`org_id`, `connector`) |
| `sim_outbox` | Ce que le connecteur simulé « enverrait » | `id` (`sim_` + 8 hex), `account_id`, `connector` (clé vers `connectors`), `function`, `payload`, `status` (`draft` · `sent`), `created_by`, `sent_by`, `sent_at` |
| `ctx` | Code de contexte | `code`, `user_id`, `rules_version` (compté, plus lu par la garde), `contexts` (`{chemin: révision}` des Contextes servis ; nul : émis avant 1.1.0, périmé ; ADR-002 § 2 ; seule colonne écrite après l'émission : la personne avance ses propres lignes quand elle publie un Contexte, policy `ctx_update_own`, E11-S19), `host`, `user_agent` |
| `journal` | Chaque appel | `ctx`, `user_id`, `team_id`, `account_id`, `method`, `tool`, `target`, `args` (2 ko, secrets masqués), `args_chars`, `result_chars`, `is_error`, `error`, `duration_ms`, `host`, `user_agent` |
| `admin_journal` | Journal du MCP admin, à part | comme `journal` sans `team_id`, `org_id` facultatif, plus `op` |
| `feedback` | Signalement | `number` (par organisation, affiché `FB-0001`), `user_id`, `ctx`, `type` (`friction` · `gap` · `error`), `target`, `text` (≤ 4 000), `state` (`open` · `acknowledged` · `declined` · `resolved`), `resolution` (exigée pour `declined`), `handled_by`, `handled_at` |
| `lexicon` | Mots du contenu d'une organisation, pour corriger une faute de `find` et du routage de `context` (dérivée : jamais exportée, se recalcule) | `word` (clé avec `org_id`, 4 à 40 lettres) ; tenue par déclencheurs ; lue et écrite par les seules fonctions du paquet |

V2 : le catalogue des fonctions des connecteurs distants ; les jetons de service hachés ; le coffre
des comptes.

### Fonctions SQL

`security definer` sauf les fonctions pures (`level_rank`, `is_context_path`, `norm`, `norm_words`,
`block_search_text`, `lexicon_words`), `search_path` vide, exécution accordée explicitement ; une
fonction réservée à l'outillage n'est accordée à aucun rôle de l'application. Une fonction qui écrit un
fait venu d'un tiers ou du serveur n'est accordée qu'au rôle du serveur, `platform_server` (marquée
ci-dessous) ; les autres, à `authenticated` (ou `anon`), sont la liste fermée de
`tests/integration/role-du-serveur.test.ts`.

| Fonction | Rôle |
|----------|------|
| `member_orgs()`, `is_staff()`, `is_org_admin(org)` | Organisations de l'appelant (accès plateforme en cours compris), base des policies d'isolation ; équipe plateforme, pour la portée plateforme ; admin, pour les fonctions qui le décident (`platform_access_directory`, niveau de la recherche) et les policies d'administration (`20261019150000`) |
| `leads_team(team)` | L'appelant est l'un des responsables de l'équipe (`team_members.role`) : `team_members_delete_admin` (`20261019150000`) ; `security definer`, une sous-requête sur `team_members` depuis sa propre policy bouclant (`42P17`) |
| `identity_for_caller()` | Traduit l'appelant vérifié (claims `iss`, `ext_sub`, `issuer_kind`, `email` vérifié) en identifiant interne : sujet connu, sinon `sub` de Supabase Auth, sinon la ligne `platform_staff` la plus ancienne de l'email vérifié, sinon un identifiant neuf sur invitation ouverte, sinon null ; un identifiant déjà lié chez l'émetteur à un autre sujet n'est pas relié. Seule écriture d'`identities` ; appelée avant que `sub` soit posé |
| `org_by_host(host)` | Organisation d'une adresse : id, slug, nom, préfixe, marque, domaines de travail (`anon` et `authenticated`) |
| `org_contact(org)` | Nom et email de l'admin le plus ancien, pour « aucune organisation » |
| `accept_invitations()` | Au retour de connexion : crée `members` et `team_members` depuis les invitations de l'email vérifié, et recopie email, nom et date de connexion dans chaque ligne `members` de la personne |
| `hook_before_user_created(event)` | Mode Supabase : n'accepte une création de compte que sur invitation en attente |
| `unique_handle(org, email)` | `handle` de l'espace personnel : partie locale de l'email, ASCII, unique dans l'organisation (outillage) |
| `create_org(name, slug, prefix, hosts)` | Organisation avec sa racine, son dossier `private`, son nœud `contexte` et ses adresses (équipe plateforme), par `org_skeleton` (interne, exécutable par aucun rôle), l'accès `creation` du créateur en plus |
| `signup_org(name, slug, prefix, hosts)` | Inscription (ADR-023) : l'identité de l'appelant s'il n'en a pas (mode OIDC), l'arbre de départ par `org_skeleton`, les adresses et le premier membre `admin` par `seat_org_admin`, sans équipe ni accès plateforme ; refus `42501` sans email ni émetteur ; aucune borne du nombre d'organisations d'une personne. Seconde barrière : l'activation est décidée par le service. `platform_server` seul (les adresses viennent de l'hôte) |
| `claim_org_admin(org)` | L'appelant de l'équipe plateforme qui administre l'organisation (`is_staff()` et `is_org_admin`, sinon `42501`), email dans les claims, en devient membre `admin`, sans invitation ni email : `createOrg` l'appelle dans la transaction de `create_org` quand le créateur se nomme premier administrateur, `admin_org add_admin` pour lui-même. Rend `joined`, `promoted` ou `unchanged`, par `seat_org_admin` (interne, exécutable par aucun rôle, partagée avec `signup_org` : la ligne `members` au rôle `admin`, handle, email et nom, ou le rôle `admin` d'un membre présent) |
| `join_org(org, members_max)` | Entrée sans invitation : fait de l'appelant un membre (`member`, sans équipe) si `orgs.settings.open_entry` est actif, que son email vérifié est d'un domaine admis, qu'il n'est ni exclu ni servi par un accès plateforme ; plafond passé par le service, compté sous le verrou 7601 ; rend `joined`, `refused` ou `limit` ; crée l'identité d'un sujet OIDC inconnu ; une ligne `member joined` au journal ; `platform_server` seul (le plafond vient de l'hôte). `open_entry_admits(org)` pose la même question sans écrire ; `open_entry_gate` est interne |
| `org_usage(org)` | Compteurs d'une organisation lus sans session (ADR-022 § 10) : membres et invitations en attente, rien d'autre ; aucune ligne pour une organisation inconnue (`anon`) |
| `is_context_path(org, path)` | Seule définition d'un chemin de Contexte : `contexte`, `<équipe>/contexte`, `private/<handle>/contexte` |
| `node_owner(node)` | Propriétaire effectif d'un nœud : le plus proche ancêtre, lui compris, qui en porte un |
| `level_rank(level)`, `node_level_of(user, …)`, `node_level_for(…)` | Rang d'un niveau ; `node_level_of` porte le seul corps SQL du niveau de lecture d'un nœud pour une personne (règles de personne, d'équipe et d'organisation, propriétaire, espaces personnels ; ADR-012 § 3, ADR-014), appelable par les fonctions du paquet seulement ; `node_level_for` l'applique à l'appelant pour la recherche, égal au calcul du service (test de parité) |
| `member_directory(org)`, `staff_directory()`, `platform_access_directory(org)` | Annuaire des membres (seule lecture d'annuaire du paquet, par pages) ; annuaire de l'équipe plateforme ; qui a ou a eu un accès plateforme à l'organisation, et qui l'a accordé ou révoqué. Lisent les copies de `members`, `platform_staff` et `platform_grants` |
| `open_draft(node)` | Ouvre le brouillon d'un nœud : ligne `node_drafts`, copie des blocs publiés sous les mêmes `id` ; rend la révision de base |
| `publish_node(node, base_revision, draft_stamp, links)` | Publication atomique sous verrou consultatif : garde de révision et de tampon (`PT409` → `stale_revision`), blocs `draft` → `published`, révision + 1, instantané dans `node_versions`, liens écrits, brouillon effacé ; ne lit aucun niveau (le service décide, dès l'écriture) |
| `discard_draft(node, draft_stamp)` | Abandon atomique du brouillon entier d'un nœud publié, sous le verrou 7401 de `publish_node` : `42501` hors des organisations de l'appelant, `55000` sans brouillon, `PT409` sur tampon changé ; blocs `draft` puis `node_drafts` supprimés, état publié intact ; rend la révision. Seul chemin de suppression d'un brouillon hors publication (ADR-011 § 3) |
| `duplicate_subtree(source, nodes, segment, title, position)` | Copie d'un nœud et des descendants que le service a choisis, blocs publiés et lignes compris, en une transaction ; ne borne que l'organisation de l'appelant et la forme ; chaque fichier cité par un bloc publié copié reçoit une ligne neuve `pending` sous la copie, `file_id` réécrit, paires rendues (`copied_files`) : le service copie les objets après le commit (ADR-016 § 6) |
| `public_node_by_token(org, token, path)` | Lecture publique bornée au jeton et à l'organisation de l'adresse (`anon` seul, ADR-013) : dernière version publiée, enfants si le lien les couvre, dans la limite de ce que l'auteur du lien lit à cet instant (`node_level_of`) ; lignes publiées d'un tableau, 500 au plus ; null pour tout le reste |
| `public_file_by_token(org, token, file)` | Même règle pour un fichier (`anon` seul, ADR-016 § 7) : fichier `ready` cité par un bloc publié (`file` ou `image`) d'un nœud du périmètre ; rend `id`, `name`, `mime`, `size`, le chemin du nœud, jamais la clé ; null pour tout le reste |
| `consume_upload_ticket(org, hash, form)` | Porte sans session du dépôt (`anon` seul, ADR-018 § 3) : un `update` conditionnel sert le ticket une fois, par le jeton de la porte appelante, dans sa propre transaction ; rend la personne, son e-mail dans `members` et la destination, ou null |
| `org_files_bytes(org)` | Le quota de fichiers d'une organisation de l'appelant (`member_orgs`, sinon `42501`) : la somme des lignes `pending` et `ready`, jointes ou en transit non échues, de toute personne ; rien d'autre ne sort (lue par `requireQuota` sous le verrou 7501) |
| `purge_transit_files(org)` | Supprime les fichiers en transit échus d'une organisation de l'appelant (`42501` sinon), de toute personne, et ne rend que leurs identifiants : le service retire les objets après le commit (`platform_server` seul) |
| `mark_files_ready(org, files)` | Passe à `ready` les lignes `pending` d'une organisation de l'appelant (`42501` sinon) que la RLS de `files` lui laisse modifier (jointes, ou en transit à lui), après la lecture de l'objet par le serveur ; rend celles qui l'ont été. Seule écriture de `files.status` (`platform_server` seul) |
| `norm(text)`, `norm_words(text)`, configuration `platform.fr` | Normalisation sans accent, mots `[a-z0-9]`, plein texte français |
| `block_search_text(type, text, data, key)` | Texte cherchable d'un bloc, source de `blocks.search_tsv` |
| `route_candidates(org, query, kind, limit)` | Composantes du score de routage sur le titre et le résumé : chaque formulation du résumé cherchée à part (`s_phrase`), mots pesés par leur rareté parmi les candidates lisibles, titre compté à part (`lexical_title`), demande corrigée par `lexicon_fix` en plus de la demande telle quelle ; présélection par index, niveau de lecture et corbeille appliqués avant la coupe ; le service redécide (ADR-003) |
| `search_content(org, query, kinds, limit)` | Recherche de `find` : titre, puis résumé, puis blocs publiés, lignes comprises, hors corbeille ; d'abord le nœud qui couvre la plus grande part des termes ; rend nœud, bloc, clé, colonne et extrait (jusqu'à la fin du bloc quand il en reste au plus 8 mots), trois blocs par nœud au plus et, sur chacun, le nombre de blocs trouvés du nœud (`block_total`) ; une faute se corrige par le lexique (`lexicon_fix`) en dernier recours ; la corbeille est exclue avant la coupe |
| `lexicon_words(text)`, `lexicon_sync()`, `lexicon_rebuild(org)`, `lexicon_fix(org, word)` | Mots d'un texte ; déclencheur qui les ajoute ; reconstruction du lexique d'une organisation (outillage) ; la correction d'un mot par le lexique, écrite une fois pour `search_content` et `route_candidates`, exécutable par aucun rôle client |
| `update_my_profile(org, patch)` | La personne écrit son prénom, son nom (80 caractères chacun, `name` recomposé), sa langue et sa couleur |
| `forget_user(user)` | Oublie une personne (outillage) : ses lignes, ses espaces personnels, ses `identities`, les auteurs mis à nul (journal des partages compris, auteur et sujet), le lexique reconstruit ; refus tant qu'un nœud d'un autre propriétaire est rangé sous les siens |
| `applied_migrations()` | Migrations appliquées, pour `admin_cell` (équipe plateforme) |
| `account_token(account)` | Le chiffré du jeton d'un échange (`oauth2_client_credentials`) d'un compte, rendu au seul membre de l'organisation du compte, null sinon ; lu et renouvelé par l'appel (`authenticated`) |
| `account_secret(account)` | Le chiffré du secret d'un compte, rendu au seul membre de l'organisation du compte (`member_orgs`), null sinon ; lu par `runCall` pour un compte réel d'un connecteur réel, déchiffré par le serveur de l'hôte pour le seul appel au tiers (`authenticated`) |
| `mark_account(account, reason)` | Pose (`credential_rejected`, `quota_exhausted`) ou lève (null) la marque d'un compte (`health.mark`) d'une organisation de l'appelant (`member_orgs`, 42501 sinon), et rien d'autre ; une raison inchangée garde sa date, rien n'est écrit quand rien ne change ; rend `changed` et la marque ; jouée par l'appel qui révèle le refus ou le premier succès, y compris par qui ne gère pas le compte (`platform_server` seul : la raison vient du tiers) |
| `declare_connector(name, label)` | Ajoute à `connectors` le nom d'un connecteur que l'hôte déclare, et son libellé (80 caractères au plus), avant sa première activation ou son premier compte ; un nom présent ne change pas, rien n'est retiré ; réservée à un membre d'une organisation (`platform_server` seul : le libellé est celui de l'hôte) |
| `pseudonym_org(org, salt, witness)`, `invalidate_pseudonyms(org)` | L'état de pseudonymisation d'une organisation de l'appelant (membre, ou équipe plateforme), posé au premier appel avec le sel et le témoin proposés par le serveur, rendu avec le slug ; la génération avancée d'un après une écriture d'une personne déclarée ; 42501 hors de portée (`pseudonym_org` : `platform_server` seul, le sel et le témoin viennent du serveur ; `invalidate_pseudonyms` : `authenticated`) |
| `oauth_pending_resource(authorization_id)`, `oauth_clients_activity()` | Mode Supabase : ressource d'une demande OAuth en attente (consentement) ; clients OAuth et dernière activité (ménage, outillage) |

### Déclencheurs

| Déclencheur | Effet |
|-------------|-------|
| `forbid_prefix_change` | Préfixe immuable |
| `set_updated_at` | `updated_at` posé par la base sur `orgs`, `accounts`, `nodes`, `blocks`, `node_drafts`, `connector_activations` |
| `members_identity_copy` | Une ligne `members` insérée sans email reçoit l'email et le nom des claims quand l'appelant s'insère lui-même ; une ligne qui change de personne perd les copies de la précédente |
| `platform_grants_identity_copy`, `platform_grants_guard` | Copie de l'email et du nom sur l'accès ; révocation datée par la base |
| `invitations_guard` | Une seule invitation en attente par organisation et par email (verrou par adresse) ; « déjà membre » jugé par `members.email` ; équipe de l'organisation |
| `nodes_guard` | Invariants de structure de l'arbre : chemin contrôlé, cycle refusé, un nœud Contexte ne bouge pas, genre `context` ⇔ chemin de Contexte, le dossier `private` ne bouge pas, `private/<handle>` n'a pour propriétaire que la personne de ce handle, propriétaire dans l'organisation ; verrou de l'arbre de l'organisation avant de lire le parent |
| `nodes_path_cascade`, `nodes_aliases_on_insert`, `nodes_aliases_on_move` | Réécrit dans la même transaction le chemin des descendants d'un nœud déplacé ou renommé ; inscrit un alias pour chaque chemin qui change ; un nœud nouveau sur l'ancien chemin d'un autre est refusé (`23505`), le nœud à qui l'alias appartient le reprend |
| `teams_lead_sync`, `team_members_guard` | `teams.lead_user_id` est la source, `team_members.role` en est dérivé ; le responsable ne quitte pas son équipe |
| `teams_tree_sync`, `members_tree_sync`, `teams_tree_cleanup` | Équipe créée : son dossier et son Contexte ; membre créé : `private/<handle>` (« Privé ») et son Contexte ; équipe supprimée dont le dossier ne contient que son Contexte : les deux nœuds partent avec elle |
| `members_cleanup` | Membre retiré : ses `team_members`, ses règles nominatives, sa place de responsable |
| `access_rules_account_share_journal` | Règle d'un compte insérée, au niveau changé ou retirée : une ligne d'`account_share_events` (`account_share_journal()`, definer), dans la transaction du geste ; rien pour une règle de nœud, un niveau inchangé ou le retrait en cascade d'un compte supprimé |
| `blocks_guard`, `blocks_lock_draft` | `org_id` pris du nœud ; un `row` seulement dans un tableau, publié, clé immuable ; une écriture de brouillon passe la porte du brouillon (verrou partagé, `PT409` pendant une publication) et avance son tampon |
| `bump_rules_version` | `rules_version + 1` à la publication d'un nœud Contexte ; compteur seul, la garde du `ctx` lit `ctx.contexts` (E11-S03) |
| `feedback_number` | Numéro de ticket par organisation, sous verrou |
| `expires_at_clock` | Échéance à l'horloge de la base, sous `authenticated` et `platform_server` : un fichier en transit (`files`, sans nœud) s'insère à `now()` + 1 heure, un ticket de dépôt (`upload_tickets`) à + 15 minutes, une demande de consentement (`connector_consents`) à + 10 minutes ; toute autre valeur est refusée (`42501`) |
| `nodes_lexicon_sync`, `blocks_lexicon_sync` | Mots du contenu ajoutés au lexique |

### RLS

Toute table de `platform` a la RLS activée et des policies d'appartenance : une ligne se lit et
s'écrit par un membre de son organisation (`member_orgs()`, accès plateforme en cours compris),
dans les colonnes accordées une à une. Seule la portée plateforme appelle `is_staff()`
(`platform_staff`, `platform_grants`, `admin_journal`), et le retrait d'une adresse. Aucun niveau ni rôle dans une policy :
les droits se décident dans le service (ADR-012 § 3), sauf les policies d'administration, qui reprennent le
rôle exigé par leur service (`20261019150000`) : supprimer un membre ou une équipe (`is_org_admin`), un membre
d'une équipe (`is_org_admin`, ou responsable de l'équipe, `leads_team`, pour un membre), une adresse (`is_staff()`
et `is_org_admin`), mettre à jour `orgs` (`is_org_admin`). Un membre simple y touche zéro ligne. Les écritures sans porte de l'API passent
par les fonctions du paquet : racine et `private` jamais supprimés, versions, liens et alias écrits
par `publish_node` et les déclencheurs, `identities` par `identity_for_caller()`, `orgs` créées
par `create_org`, `members` hors invitation, import, inscription et administrateur nommé par l'équipe plateforme (`claim_org_admin`) par `join_org` seule. Rien pour `anon`, sauf `org_by_host`, `public_node_by_token`, `public_file_by_token`,
`consume_upload_ticket` et `org_usage`.

**Suppressions.** `authenticated` ne supprime que dans les tables où un service supprime sous la session
d'une personne ou du serveur : `access_rules`, `blocks`, `connector_consents`, `files`,
`hosted_link_requests`, `members`, `nodes`, `org_domains`, `team_members`, `teams` et `upload_tickets`.
`orgs`, `accounts` et `connector_activations` ne se suppriment sous aucune session (droit retiré, policy
de suppression neutralisée, `false`) : une organisation et ses comptes par `oto-platform org delete`, les
comptes d'une personne oubliée par `forget_user`, un connecteur se désactive par son état. `anon` ne
supprime nulle part, `platform_server` rien de plus qu'`authenticated`. Ces tables sont la liste fermée
de `tests/integration/role-du-serveur.test.ts`, chacune avec le service qui s'en sert.

**Rôle du serveur.** `platform_server` (créé par `oto-platform db prepare`, `nologin`, membre
d'`authenticated` dont il hérite, pris par `platform_app` seul) reçoit en plus ce qui écrit un fait venu
d'un tiers ou du serveur : les fonctions marquées ci-dessus et, sur `accounts`, la mise à jour de
`status`, `status_reason`, `settings`, `secret_ciphertext`, `secret_fields`, `secret_updated_at`,
`token_ciphertext`, `token_expires_at` et `granted_scopes`. `authenticated` ne modifie aucune colonne
d'`accounts` ni de `files`, et n'insère d'un compte que `org_id`, `connector`, `owner_kind`,
`owner_team_id`, `owner_user_id`, `label` et `mode`. Les colonnes qu'`authenticated` modifie sont la
liste fermée de `tests/integration/role-du-serveur.test.ts`.

**Outillage.** Organisation Démo, équipe plateforme, export-import, oubli d'une personne, ménage
OAuth, tests d'intégration : par la connexion d'administration (`PLATFORM_ADMIN_DATABASE_URL`),
jamais importée par le paquet ni par l'hôte, jamais dans l'environnement de l'application déployée.
La clé secrète de Supabase ne sert qu'à l'API d'administration des comptes. `platform_staff` ne
s'écrit par aucune porte du paquet.

