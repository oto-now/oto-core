# Offres de l'hôte

- **Statut** : validé avec JB le 01/10/2026
- **Dernière révision** : 2026-10-01

## Résumé

Un hôte qui vend le paquet par offres reçoit ce qui revient au paquet, sans que le paquet connaisse jamais une offre, un prix ou un prestataire de paiement : une personne vérifiée crée elle-même son organisation, autant qu'elle en veut, si l'hôte l'active (ADR-023), et chaque organisation porte des capacités que les services vérifient avant d'écrire et que les écrans grisent, leurs valeurs venant de l'hôte (ADR-022). Sans option ni fonction enregistrée, un ERP voit le comportement d'avant.

## Contexte

Le SaaS vend une offre gratuite en libre-service et une offre payante, au prix par organisation. Jusque-là, une organisation ne se créait que par l'équipe plateforme (`createOrg`, `requireStaff` ; `create_org` contrôle `is_staff()`), et on n'entrait que par invitation ([identité et connexion](identite-et-connexion.md)). Il faut aussi brider certaines écritures : nombre de membres, d'équipes, de connecteurs activés, stockage des fichiers.

Contraintes du paquet :

- un refus est décidé par le service, avant sa requête (ADR-012 § 3) ; un filtre dans les routes de l'hôte dépendrait des chemins internes du paquet et contournerait cette garde ;
- le paquet n'écrit dans `platform` qu'au nom d'un appelant vérifié, et la connexion d'administration n'est jamais déployée (ADR-006 § 3, ADR-012 § 1) ; or l'état d'une offre change sur un événement du prestataire de paiement (un webhook), sans appelant ;
- l'état d'une offre vit déjà chez l'hôte (son schéma à lui) ; le recopier dans `platform` ferait deux sources à tenir égales ;
- une organisation n'existe pour personne sans adresse (ADR-004) : c'est le point de création de l'hôte (`OrgCreationHook`, E09-S02) qui la fournit dans la cellule partagée ;
- en mode OIDC, `identity_for_caller()` ne donne un identifiant interne qu'à l'équipe plateforme et à une adresse invitée ; en mode Supabase, le hook d'inscription refuse tout compte sans invitation (réglage d'Auth de l'hôte).

## Objectifs et non-objectifs

- Les invariants d'une création (arbre de départ, premier administrateur, adresse) restent dans le paquet, en un seul endroit.
- Les limites valent pour toutes les portes, et les écrans savent d'avance ce qui sera refusé.
- Un ERP qui n'active rien garde l'entrée sur invitation seule et aucune limite (sauf le quota de stockage d'avant).
- Hors objectif : noms d'offres, prix, paiement, anti-abus dans le paquet (captcha, débit par IP, domaines jetables), réglage d'une limite par le MCP admin.

## Conception

### Inscription libre (ADR-023)

1. **Option de `handlePlateforme`** : `signup: { orgCreation, admit? }` ; sans elle, `POST /api/platform/signup` répond `not_found` et rien ne change. `orgCreation` est le point de création de l'hôte (ses adresses) ; une organisation sans adresse ne se crée pas (ADR-023 § 1).
2. **Le service `signUp` décide**, dans l'ordre : Zod ; option présente ; email vérifié de l'appelant ; `admit({ email, request, acceptedTerms })` de l'hôte (son refus devient `forbidden`, `reason: "signup_refused"`, avec son texte) ; adresses de l'hôte contrôlées comme celles d'une création par l'équipe plateforme. En deux temps comme `createOrg` : sans `confirm`, rien n'est écrit (ADR-023 § 2).
3. **`signup_org`**, `security definer`, crée en une transaction l'identité de l'appelant s'il n'en a pas (mode OIDC : identifiant neuf ; mode Supabase : le `sub`), l'organisation, son arbre de départ (par `org_skeleton`, partagé avec `create_org`) et ses adresses, et son premier membre, `admin` (par `seat_org_admin`, partagée avec le premier administrateur que nomme l'équipe plateforme). Elle refuse (`42501`) sans email ni émetteur dans les claims. Elle ne borne pas le nombre d'organisations d'une personne. Aucune équipe ni accès plateforme n'est créé (ADR-023 § 3).
4. **Reste à l'hôte** : la création du compte chez l'émetteur, dans les deux modes (en mode Supabase, retirer de ses réglages d'Auth le hook `hook_before_user_created`, qui refuse tout compte sans invitation ; en mode OIDC, Logto ou Keycloak, l'inscription de l'émetteur), la page qui monte l'écran d'inscription du paquet (`FormulaireDInscription`, îlot monté dans `EcranDAuthentification` : un seul champ, le nom, dont l'adresse et le préfixe se déduisent ; leurs champs ne reviennent que sur un `conflict` ou pour un nom dont on ne tire rien de valide, jugé à la sortie du champ ou à Entrée, jamais pendant la frappe ; l'adresse se lit sous le nom après une pause de frappe, par l'aperçu sans `confirm`, qui passe par `admit` et dont seul un conflit se dit ; un seul bouton crée au premier clic ; après la création, l'écran « Votre espace se prépare » (`DepartVersLOrganisation`) dit trois étapes, avance une barre qui ne finit qu'avec la réponse de l'adresse, sondée deux minutes au plus, puis y conduit ; sans réponse, il le dit, donne le lien vers l'adresse et propose de réessayer ; aucun lien avant, l'adresse ne répondant pas encore), captcha, débit par IP et domaines jetables par `admit`, l'offre de départ par sa fonction de capacités (ADR-023 § 4).
5. **Rejoindre une organisation existante** passe par une invitation (ADR-023 § 5), ou, quand un administrateur l'a ouverte, par l'entrée sans invitation ([identité et connexion](identite-et-connexion.md), `open_entry`) : elle respecte `members_max`, compté comme pour une invitation, et son refus au plafond se dit (`forbidden`, `reason: "limit"`).
6. **Plusieurs organisations par personne** : une personne peut créer plusieurs organisations, gratuites ou payantes, et être administratrice de l'une et membre d'une autre. Le paquet ne pose aucune borne ; un hôte qui veut borner refuse par `admit`. `listMyOrganisations` rend les organisations dont la personne est membre, chacune avec une adresse, celle que la personne peut joindre depuis l'adresse de sa requête (`requestHost` : la plus proche de celle-ci, même domaine parent ; puis une adresse qui n'est pas du poste de développement, `localhost` ou `*.localhost` ; puis l'ordre alphabétique) ; à partir de deux, le menu de l'entreprise du rail porte la bascule (`RailApplication`, `organisations`). Chaque organisation ayant sa propre adresse, choisir une organisation mène à cette adresse, où la session se reprend. Sous la bascule, « Créer une organisation » mène à la page d'inscription de l'hôte (`inscription` des adresses du rail, un chemin de son application) ; sans cette adresse, l'entrée n'existe pas. `POST signup` étant servi sur toute adresse de l'hôte, la page peut vivre sur l'adresse d'une organisation.

Choix de mise en œuvre :

- HN-E12S01-1 : l'hôte de référence ne monte pas l'écran d'inscription (un ERP n'en a pas) ; le README du paquet donne le montage.
- HN-E12S01-3 : en mode Supabase, l'email du jeton est vérifié quand l'hôte exige la confirmation (`enable_confirmations`) ; le paquet le lit comme pour les invitations.
- HN-E12S01-4 : le refus d'`admit` porte son texte dans `details.text` : l'API ne sert pas le message d'une erreur aux écrans, qui traduisent par code ; le texte de l'hôte est dans sa langue.
- HN-E12S01-5 : la ligne de journal s'écrit par un second client de l'appelant (`VerifiedSession.caller`) : le premier a traduit l'identité avant que `signup_org` la crée (mode OIDC).
- HN-E12S01-6 : les conflits de slug et de préfixe gardent le texte de `createConflict` ; l'écran les dit par une phrase commune (« adresse ou préfixe déjà pris »).
- Conditions de l'hôte : `conditions` de `FormulaireDInscription` (case obligatoire vers les conditions de l'hôte), `accepted_terms` de `signupSchema`, `acceptedTerms` passé à `admit` ; le paquet ne juge pas la case, l'hôte refuse sans elle et garde la preuve.

### Capacités par organisation (ADR-022)

1. **Registre fermé**, typé par Zod (`schemas/limits.ts`) : un nom, un type (entier ≥ 0, octets, ensemble de valeurs), une phrase. Liste de la 1.2.0 : `members_max`, `teams_max` (0 admis), `storage_bytes`, `connectors_max`, `account_owner_kinds`, `accounts_per_owner_max`. Une capacité s'ajoute avec le service qui la lit ; aucune n'est un nom d'offre (ADR-022 § 1).
2. **Valeurs de l'hôte** : `registerOrgLimits({ read, raiseUrl? })`, enregistrée une fois comme `registerFunctions` ; `read({ id, slug })`, synchrone ou non, rend les capacités de l'organisation, appelée à chaque écriture bridée et à chaque lecture de l'état des écrans (l'hôte la met en cache s'il le veut), hors transaction ; la valeur repasse le schéma du registre. **Sans fonction, ou sans valeur pour une capacité : aucune limite**, sauf `storage_bytes`, dont le défaut reste le quota de 10 Go (`ORG_QUOTA_BYTES`) (ADR-022 § 2).
3. **Refus décidé par le service avant l'écriture** (`requireUnderLimit`, `limitedTx`), sous un verrou consultatif par organisation (classe 7601 ; 7501 pour le stockage, pris par `requireQuota`), dans la transaction qui compte puis écrit, pour `inviteMember`, `createTeam`, `activateConnector` et le quota de fichiers (`orgStorageQuota`). Le refus garde un code de la liste fermée : `forbidden` avec `reason: "limit"`, `limit` (le nom) et `max` ; le stockage garde `too_large`, `reason: "quota"`. Message neutre (« <organisation> is limited to 1 team »), sans mot d'offre ni de prix (ADR-022 § 3).
4. **Une fonction de l'hôte en échec refuse** (`internal`, sans son message) : une limite ne tombe jamais en silence (ADR-022 § 4).
5. **Toutes les portes** : API, MCP des organisations et MCP admin ; relever une limite se fait chez l'hôte (ADR-022 § 5). **L'équipe plateforme passe les limites comptées** (membres, équipes, connecteurs actifs) quand elle a un accès en cours à l'organisation : son statut n'est pas celui d'un administrateur de l'organisation. Le passage écrit, dans la transaction de l'ajout, une ligne du journal de l'organisation (`limit passed`, la limite en cible, plafond et compte en arguments), et `orgLimitsView` ne grise rien pour elle. Le quota de fichiers vaut pour tous.
6. **Seuls les ajouts se refusent** : une limite abaissée ne supprime ni ne suspend rien ; la création suivante est refusée (ADR-022 § 6). Les invitations en attente comptent dans `members_max` ; l'acceptation, faite en SQL au retour de connexion, ne recompte pas.
7. **Écrans** : `orgLimitsView` rend compte et plafond de chaque capacité lue par un écran (`EcranEquipes`, `EcranConnecteurs`), qui grise le geste refusé ; avec `raiseUrl` (une adresse `https://` ou un chemin de l'hôte), un administrateur voit « Relever la limite », vers `<raiseUrl>?capacity=<nom>` (ADR-022 § 7). L'éditeur dit le quota de fichiers réel, lu dans le refus (`details.max`). Pour ses propres écrans d'offre, l'hôte reçoit la clé `abonnement` des adresses du rail (« Abonnement » aux réglages de l'entreprise, pour qui administre ; absente, rien) et les primitives du design system exportées par `/ui`.
8. **Comptes de connecteur comptés au propriétaire** (organisation, équipe ou personne), jamais pour chaque personne qui peut s'en servir ; un partage ne change aucun compte (ADR-022 § 8).
9. **La surface MCP ne change pas** (ADR-002) : la liste des six outils est la même quelles que soient les capacités ; seul l'effet d'un outil est refusé (ADR-022 § 9).
10. **Compteurs sans session** : `orgUsage(orgId)` rend le nombre de membres et d'invitations en attente, rien d'autre, par la fonction `org_usage`, accordée à `anon` comme `org_by_host` et `org_contact` ; `platform` reste hors du Data API, la fonction ne se joint que par le serveur de l'hôte ; une organisation inconnue rend `null` (ADR-022 § 10).

## Décisions et alternatives écartées

- **Inscription dans l'hôte, sous une identité de l'équipe plateforme** : garde du service contournée, invariants dupliqués, une identité à garder. Rejetée.
- **Inscription sur code d'accès émis par l'équipe plateforme** : plus sûre au lancement, une table et un outil admin de plus. Écartée par JB (inscription libre).
- **Anti-abus dans le paquet** (liste de domaines jetables) : une liste à tenir dans un paquet public, mise à jour par version chez chaque hôte. Rejetée au profit d'`admit`.
- **Capacités stockées dans `platform`** (`orgs.limits`, écrites par l'équipe plateforme et l'hôte) : l'événement du prestataire n'a pas d'appelant (identité robot ou rôle de base nouveau à poser par `db prepare`), et l'état de l'offre vivrait à deux endroits. Rejetée.
- **Point d'autorisation de l'hôte** (`authorize({ orgId, action }) → null | message`) : le moins de code, mais les écrans ne savent pas d'avance ce qui est refusé. Rejetée.
- **Filtre dans les routes de l'hôte** : dépend des chemins internes du paquet et contourne la garde du service. Rejeté.
- **Drapeaux étendus d'un niveau « réservé à l'hôte »** (`orgs.flags`, ADR-006 § 7) : mélange mise en service progressive et droit commercial, et reste booléen. Rejetée.
- **Une organisation par compte** (refus `already_member` d'une personne déjà membre, verrou 7801 sur la personne, HN-E12S01-2) : livrée en 1.2.0, retirée en 1.3.0. Elle empêchait une personne invitée ailleurs de créer la sienne, et une personne d'en payer plusieurs.
- **Borne du nombre d'organisations dans le paquet**, ou nombre passé à `admit` : écartées par JB (aucune borne) ; l'hôte compte lui-même s'il veut borner.
- **Limites opposées à l'équipe plateforme** : livrées en 1.2.0, retirées en 1.3.0 ; un geste de support demandait de changer l'offre chez l'hôte.
- **Une équipe par défaut créée à l'inscription** : l'équipe par défaut est retirée du modèle depuis E05-S13 ([droits d'accès](droits-d-acces.md)).

## Sécurité et confidentialité

- Les deux modes d'émetteur sont couverts à la porte : un jeton de forme Supabase et un jeton d'un émetteur OIDC de test (personne inconnue de la base, email non vérifié refusé).
- `signup_org` porte une seconde barrière plus faible que `create_org` : la base ne sait pas si l'hôte a activé l'inscription ; cette décision est celle du service (ADR-012 § 3), `platform_app` n'étant utilisé que par le code du paquet.
- Le paquet ne lie aucun état à une IP : débit et anti-abus sont à l'hôte, par `admit`.
- `org_usage` est accordée à `anon` mais ne rend que deux compteurs ; elle ne se joint que par le serveur de l'hôte, `platform` étant hors du Data API.
- L'état d'un module vit dans chaque bundle serverless : une route ou une page qui n'importe pas l'enregistrement de `registerOrgLimits` sert sans limite (même contrainte et même garde de test que les fonctions métier).

## Écart avec le code

- `account_owner_kinds` et `accounts_per_owner_max` sont déclarés et lus ; leur contrôle dans `createAccount` appartient au chantier des connecteurs ([connecteurs et comptes](connecteurs-et-comptes.md)).
- Publié dans la 1.2.0 (migration `20261001090000_v1_2_0.sql`, partie 1 : `signup_org`, `org_skeleton` ; partie 2 : `org_usage`). Plusieurs organisations, bascule et passage des limites par l'équipe plateforme : pour la 1.3.0 (migration `20261001180000_v1_3_0.sql`, `signup_org` sans borne), non publiée.
- Une organisation sans adresse n'apparaît pas dans la bascule. L'hôte de référence ne donne pas d'adresse d'inscription : « Créer une organisation » ne s'y montre pas.
- L'hôte de référence ne monte ni l'inscription ni une source de capacités : l'écran d'inscription n'est éprouvé qu'en test de composant, jamais de bout en bout.

## Questions ouvertes

Aucune à ce jour.

## Historique

- 2026-09-30 : capacités par organisation déclarées par le paquet, valeurs fournies par l'hôte, refus décidés par le service — décidé par JB (source : ADR-022, story E12-S02).
- 2026-09-30 : inscription libre d'une personne vérifiée, activée par l'hôte ; inscription sur code d'accès écartée — décidé par JB (source : ADR-023, story E12-S01).
- 2026-10-01 : compteurs lisibles sans session (`orgUsage`, ADR-022 § 10) — décidé par JB (source : amendement d'ADR-022).
- 2026-10-01 : case des conditions de l'hôte à l'inscription (`conditions`, `accepted_terms`, `acceptedTerms` passé à `admit`) ; clé `abonnement` du rail et primitives exportées pour les écrans d'offre de l'hôte — demandé par l'hôte SaaS, accord de JB.
- 2026-10-01 : l'inscription vaut pour les deux modes d'émetteur (Supabase Auth, OIDC), la porte testée dans les deux — décidé par JB.
- 2026-10-01 : plusieurs organisations par personne, sans borne dans le paquet ; bascule d'organisation dans le menu de l'entreprise ; « une organisation par compte » retirée — décidé par JB.
- 2026-10-01 : l'équipe plateforme, avec un accès en cours, passe les limites comptées, une ligne au journal le dit — décidé par JB.
- 2026-10-01 : aucun lien vers la nouvelle adresse pendant l'attente, seulement au retard — demandé par JB (source : création rejouée en production).
- 2026-10-01 : écran d'attente animé après la création (étapes, barre, textes) ; la bascule mène à l'adresse joignable depuis celle de la requête, plus à la première par ordre alphabétique — demandé par JB (source : retours d'usage en production, relayés par l'hôte SaaS).
- 2026-10-01 : l'adresse se lit pendant la frappe, un seul clic crée, et le départ attend que l'adresse réponde ; le service garde ses deux temps — demandé par JB (source : retour d'usage en production, relayé par l'hôte SaaS).
- 2026-10-01 : à l'inscription, seul le nom se saisit ; adresse et préfixe déduits, saisissables seulement sur conflit ou nom inexploitable — demandé par l'hôte SaaS pour JB.
- 2026-10-01 : refonte en document de conception vivant, qui reprend ADR-022, ADR-023, l'épic E12 et les choix HN-E12S01 — décidé par Alexis, accord de JB.
- 2026-10-03 : une organisation existante se rejoint aussi sans invitation, quand un administrateur l'ouvre à des domaines d'email ; le plafond de membres s'y applique et se dit — décidé par JB (source : story « entrée automatique des membres », révision d'ADR-023 § 5).
