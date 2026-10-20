# Journal et retours

- **Statut** : proposé
- **Dernière révision** : 2026-10-20

## Résumé

Chaque appel MCP et chaque mutation de l'API laisse une ligne de journal, écrite après la réponse, arguments bornés et secrets masqués ; les lignes d'un même `ctx` forment une conversation.
Une personne lit ses lignes et celles des équipes qu'elle mène, l'administrateur toute l'organisation ; ce qui touche l'espace personnel d'autrui n'en livre que la forme.
Un assistant signale une friction, un manque ou une erreur par `feedback` ; l'équipe plateforme traite ces retours, et l'administrateur aussi quand l'organisation les affiche ; la page « Activité » réunit l'onglet Statistiques, pour l'administrateur, et l'onglet Journal, pour tous.

## Contexte

Les assistants travaillent seuls, par routines ou en conversation : pour comprendre ce qu'ils ont
fait, il faut un journal regroupé par conversation (le code `ctx`, [outils MCP](outils-mcp.md)),
lisible à l'écran (`/journal`) comme par `read journal`. Pour améliorer les procédures et le paquet,
il faut que l'assistant puisse dire ce qui l'a gêné, et que l'administrateur voie l'usage.

## Objectifs et non-objectifs

- Tracer chaque appel sans que la trace change jamais la réponse.
- Une seule portée de lecture du journal, décidée par le service, à l'écran, par `read` et au MCP admin.
- Ne rien livrer, à un autre lecteur que son auteur, du contenu de l'espace personnel d'autrui.
- Hors objectif : une vue de l'usage pour le responsable d'une équipe en V1 (E08-S09 N6) ; la
  journalisation des lectures (exports compris, D138).

## Conception

### Écriture du journal

- Les portes écrivent le journal après la réponse, sous l'appelant : une ligne par appel MCP, une par mutation de l'API ; arguments bornés à 2 048 caractères, clés de secret masquées ; une panne du journal ne change jamais la réponse (H07). Colonnes : [schéma `platform`](../reference/schema-platform.md) (`journal`, `admin_journal`, `feedback`).
- `journal.tool` porte le nom préfixé (`demo_context`), la forme nue est lue aussi ; une ligne `api` porte `<VERBE> <ressource>`, la cible du service et `error` `<code>: <message>`, hors de la vue par conversation (HN-E05S05-6).
- La ligne de journal d'un `call` ne porte l'équipe (porteuse, ou rendue par la fonction) que si la personne en est membre, sinon aucune : un responsable ne lit pas les arguments d'une personne hors de son équipe (D38).
- Les exports d'une page en `.md` et d'un tableau en `.csv` (`GET nodes/export`, `GET tables/export`) ne sont pas journalisés, comme toute lecture ; ils restent décidés par le droit de lecture et bornés à 5 000 lignes (D138, HN-E10S01-18).
- L'ordre d'écriture du journal est l'`id` : une conversation se lit par `id` croissant, les 2 000 lignes les plus récentes sont les plus grands `id` de la période, la fenêtre gelée est bornée par le plus grand `id` de la première page (HN-E05S05-10).
- Une limite fixée par un test : se retirer de l'organisation ou révoquer son propre accès plateforme ne laisse aucune ligne (HN-E05S03-36, [droits d'accès](droits-d-acces.md)).

### Lecture du journal

- Une personne lit au journal ses propres lignes et celles des équipes qu'elle mène ; l'administrateur et l'équipe plateforme avec un accès en cours lisent toute l'organisation (H74).
- Une conversation regroupe les lignes de journal de la portée de l'appelant d'un même `ctx`, en TypeScript, sur les 2 000 lignes les plus récentes de la période ; 50 conversations par page ; curseur opaque à fenêtre gelée (HN-E05S05-1).
- `today` couvre les 24 dernières heures et `week` les 7 derniers jours, fenêtres glissantes ; les heures servies au modèle sont en UTC explicite, l'écran les affiche en Europe/Paris (HN-E05S05-3).
- La procédure servie d'une conversation est la cible de son appel `context` quand c'est une procédure que l'appelant lit ; sinon la conversation cite la demande (HN-E05S05-4).
- Les arguments d'un appel sont visibles, masqués, pour qui voit la ligne, à l'écran comme par `read` (HN-E05S05-7). Les clés secrètes des arguments sont masquées à toute profondeur à la lecture ; au-delà de six niveaux, la valeur passe en texte après masquage, puis est coupée ; un argument stocké tronqué montre son `head` (HN-E05S05-20).
- Le chemin `journal` est réservé à la racine : `checkPath` (`server/nodes/write.ts`) refuse d'y écrire un nœud, et `read` y sert le journal (HN-E05S05-8, P22 dans [nœuds et arbre](noeuds-et-arbre.md)).
- Un curseur de `read journal` illisible ou d'une autre lecture est refusé en `invalid_arguments` `This cursor no longer matches journal <section>: read again without cursor.` ; l'écran repart du début (HN-E05S05-12). `read journal` lit un code de conversation sans casse (espaces retirés, majuscules, `CTX_PATTERN`) ; toute autre section se lit en minuscules (HN-E05S05-21).

### Espace personnel d'autrui

- Pour tout lecteur autre que son auteur, un appel sur l'espace personnel d'autrui ne livre au journal, à l'usage et à `admin_journal` que son outil, son heure, son issue et son code d'erreur, sa cible coupée à `private/<handle>` (`perso/<handle>` pour une ligne écrite avant D107, le journal n'étant pas réécrit) (D44).
- Pour tout lecteur autre que son auteur, un message d'erreur servi au journal, à l'usage ou à `admin_journal` coupe chaque chemin `private/<handle>/…` (ou `perso/<handle>/…`, d'avant D107) à son espace (D52).

### Usage et statistiques (tableau de bord)

- L'usage est réservé à qui administre l'organisation : pas de vue du responsable pour son équipe en V1 (E08-S09 N6) ; `usageSummary` exige `isOrgAdmin` avant toute lecture, sinon `forbidden` « Reading the usage of <org> is reserved to <qui>. Ask them. » (E08-S09 N9). Depuis la 1.4.13, l'usage est l'onglet « Statistiques » de la page « Activité » (`EcranDActivite`), à l'adresse du journal : `/journal?tab=statistics` pour l'administrateur, qui l'ouvre par défaut, puis `?tab=journal`, l'onglet Journal de tous ; l'onglet Statistiques n'est pas proposé à qui n'administre pas, et sa demande ouvre le journal. La page ne lit que l'onglet ouvert ; un en-tête, celui de l'onglet ouvert pour la méta et les réglages ; les formulaires GET des deux onglets gardent `tab` en champ caché. L'ancienne adresse `/admin/usage` mène à `/journal?tab=statistics`, sa fenêtre et son équipe gardées. Une seule entrée, « Activité », au menu de l'entreprise.
- Les statistiques (1.4.13, `server/usage-statistics.ts`) s'ajoutent à l'usage, sur sa fenêtre et son filtre d'équipe, en quatre lectures agrégées et bornées, lancées ensemble dans la transaction unique de l'usage (`usageSummary` tient toutes ses lectures en une transaction, que chacune reprend), puis un calcul pur : **adoption** (chaque semaine de la fenêtre, les personnes qui y ont ouvert une conversation et ces conversations ; les conversations par assistant, le client MCP ramené à sa famille, Claude, ChatGPT, Mistral… ; chaque équipe, ou celle du filtre ; les invitations en attente ; les membres jamais connectés, 20 nommés au plus) ; **contenu** (contenus créés et publications par semaine ; blocs publiés écrits dans la fenêtre, par un assistant ou à la main, selon leur provenance ; les 10 contenus les plus lus par `read`, nommés seulement quand l'appelant les lit) ; **partage et connecteurs** (liens publics actifs et créés dans la fenêtre, de toute l'organisation ; appels de `call` par famille de fonctions, chaque connecteur activé compris). Une conversation compte dans la semaine de son premier appel. La courbe hebdomadaire (personnes actives et conversations) se dessine en SVG par le serveur, sans bibliothèque. S'y ajoutent deux tableaux triables par colonne (le `Table` du design system, tri sur les lignes servies, `usage-people.ts`) : **par équipe** (membres d'aujourd'hui qui sont membres de l'organisation, membres actifs sur la fenêtre et leur part, le taux d'usage, conversations, appels, contenus écrits, procédures servies et la plus servie, nommée seulement quand l'appelant la lit, dernier appel d'un membre) ; **par personne** (équipes, dernière connexion à l'écran `members.last_sign_in_at`, dernier appel d'assistant au-delà de la fenêtre, conversations, appels, contenus écrits à la main ou par son assistant selon la provenance des blocs publiés, assistant le plus employé ; « Jamais connecté » sans connexion, « Inactif depuis 30 j » quand la dernière connexion et le dernier appel ont plus de 30 jours). Le tableau « par équipe » remplace la liste des équipes de l'adoption.
- Traiter les retours (`listFeedback`, `setFeedbackState`) est réservé au membre de l'équipe plateforme qui administre l'organisation (E05-S13) et, quand l'organisation a allumé « Retours visibles » (drapeau `feedback_visible`, 1.4.13), à ses administrateurs : `handlesFeedback` = `isOrgAdmin` et (`isStaff` ou l'option), l'option lue en une requête et pour un administrateur seulement ; refus `forbidden` « Handling the feedback of <org> is reserved to the platform team that administers it, and to its administrators when « Retours visibles » is on. Ask them. ». L'option se règle dans l'écran Organisation, îlot « Retours des assistants », par `PATCH admin/flags` (`setFlag`, administrateur). « Retours » est toujours montré à qui administre l'organisation (staff compris), sous « Suivi de l'entreprise », décidé sur l'identité seule (`isOrgAdmin`) : l'affichage d'une page ne lit pas l'option, son budget de requêtes ne bouge pas. La page `/admin/feedback` est introuvable pour qui n'administre pas ; pour un administrateur, elle lit `handlesFeedback` : vrai, la liste ; faux (option éteinte, pas du staff), elle dit « Les retours des assistants ne sont pas affichés pour votre organisation. » et « Les afficher » allume l'option sur place (`PATCH admin/flags`), puis la page se relit.
- L'usage lit au plus les 20 000 appels les plus récents de la fenêtre, en une requête bornée, puis un calcul pur (aucune fonction SQL) ; au-delà, l'écran le dit et donne la date couverte (E08-S09 N2).
- Fenêtre de 30 jours par défaut (usage et retours), au choix 7, 30 ou 90 ; toute valeur inconnue vaut 30 (E08-S09 N3). Paramètres d'URL de l'usage et des retours en anglais, comme ceux de `/journal` (`period`, `team`, `state`, `type`, `cursor`) ; un ancien nom est ignoré comme tout paramètre inconnu (E08-S09 N7, E11-S07, ADR-020).
- Le filtre d'équipe de l'usage retient les lignes des personnes membres de l'équipe aujourd'hui (le journal ne porte l'équipe que pour les appels de connecteur) (E08-S09 N4).
- Un `call` sans cible compte dans les totaux de l'usage, pas dans « Erreurs par fonction » : il ne nomme aucune fonction (E08-S09 N10).
- La demande et le host d'une conversation sans procédure se lisent sur sa première demande (ligne `<préfixe>_context` sans erreur et à cible), pas sur sa première ligne `context` (E08-S09 N27).

### Retours des assistants (`feedback`)

- Un ticket est numéroté par organisation (`FB-0001`), lié au `ctx`, donc recoupable avec le journal ; type `friction`, `gap` ou `error`.
- Un signalement en doublon (même personne, organisation, type, texte et cible, absente des deux côtés comprise, dans les 10 minutes) ne crée pas de ticket : le ticket existant est rendu et le résultat le dit (E03-S05 N1). Le doublon se cherche parmi les 50 tickets les plus récents de la personne, même organisation, type et cible, de moins de 10 minutes ; le texte se compare dans le service, pas dans le filtre (E03-S05 N6).
- Texte et cible d'un signalement sont rendus bien formés (`toWellFormed`) avant la recherche et l'insertion : une moitié de paire de substitution devient U+FFFD (E03-S05 N8).
- Retours à l'écran : « à traiter » (ouverts et pris en compte) par défaut ; quatre états, toute transition permise ; décliner exige un motif de 3 à 2 000 caractères ; le retour à `open` efface la décision ; « Traité par » est montré (E08-S09 N5).
- Aucune constante n'est exportée sans lecteur : `FEEDBACK_TYPES`, `DUPLICATE_WINDOW_MINUTES` et `PROMPTS_MAX` restent internes à leur fichier ; les faces lisent `feedbackTypeSchema` (E03-S05 N12).

### Prompts des procédures

Les procédures publiées lisibles se servent aussi en prompts MCP ([procédures](procedures.md)) :

- Nom d'un prompt : le dernier segment du chemin ; sur collision entre prompts visibles, le chemin entier avec `_` à la place de `/` ; 64 caractères au plus (E03-S05 N3). Un nom encore pris après le chemin entier et la coupe à 64 caractères reçoit `_2`, `_3`… dans l'ordre des chemins, la base recoupée pour tenir en 64 (E03-S05 N7).
- Le message d'un prompt est le titre de la procédure ; un nom hors des 20 prompts listés est inconnu, comme un nom invisible (E03-S05 N4). Un non-membre reçoit une liste de prompts vide, et un prompt invisible est « inconnu » (E03-S05 N5).
- `ProcedurePrompt` = `{ name, title, description }`, sans chemin ni nœud tant qu'aucun lecteur ne les demande (E03-S05 N16).

## Décisions et alternatives écartées

- **Une vue de l'usage par le responsable pour son équipe** : écartée en V1, l'usage reste à l'administrateur (E08-S09 N6).
- **Les retours traités par l'administrateur du client sans condition** (E08-S09 N6 et N9) : remplacé par E05-S13, les retours étant des frictions d'assistant destinées à l'équipe plateforme ; depuis la 1.4.13, l'organisation les ouvre à ses administrateurs par l'option « Retours visibles ».
- **Une option qui coupe l'envoi des retours par les assistants** : écartée, l'outil `feedback` fait partie des outils figés (ADR-002) et l'équipe plateforme garde ses retours ; l'option ne règle que leur lecture par l'administrateur (décidé par JB le 20/10).
- **Journaliser les exports** : écarté, un export est une lecture, et aucune lecture n'est journalisée (D138).
- **La forme `perso/<handle>` des espaces personnels** : remplacée par `private/<handle>` (D107) ; les lignes anciennes ne sont pas réécrites et se coupent à leur forme d'origine (D44, D52).
- **L'écran « Usage » caché** (D128, lot B d'HN-E05S13 dans [droits d'accès](droits-d-acces.md)) : remplacé en 1.4.13, l'écran revient sous le nom « Statistiques » pour l'administrateur.
- **Une entrée « Statistiques » à part dans le menu** : écartée, Statistiques et Journal sont les deux onglets d'« Activité », une seule entrée (décidé par JB le 20/10).
- **Une bibliothèque de graphiques pour la courbe hebdomadaire** : écartée, une polyligne SVG suffit à deux séries, sans dépendance.

## Sécurité et confidentialité

- Clés de secret masquées à l'écriture (H07) et à toute profondeur à la lecture (HN-E05S05-20).
- L'équipe d'un `call` n'est inscrite que si la personne en est membre, pour qu'un responsable ne lise pas les arguments d'une personne hors de son équipe (D38).
- L'espace personnel d'autrui ne livre que la forme de l'appel, jamais ses arguments ni ses chemins (D44, D52).

## Écart avec le code

- Curseur (instant, id) commun à `server/feedback.ts`, `server/usage.ts` et `server/admin/journal.ts` (M18b).
- `EcranUsage` et `EcranDuJournal` restent exportés, montables seuls ; l'hôte de référence ne monte que `EcranDActivite`.
- Lectures sans borne relevées en revue (M13).

## Questions ouvertes

- Portée des activités de l'accueil, tirées du journal : Q3 dans [écrans et coque](ecrans-et-coque.md).

## Historique

- 2026-09-29 : journal écrit après la réponse, une ligne par appel, lecture par conversation et portée décidée par le service, `feedback`, usage et retours, livrés dans la 1.0.0 — décidé par le pilote (source : choix H07, H74, stories E03-S05, E05-S05, E08-S09).
- 2026-09-28 : « Usage » caché, retours réservés à l'équipe plateforme à l'écran — décidé par JB (source : fiche D128, story E05-S13).
- 2026-09-29 : les exports `.md` et `.csv` ne sont pas journalisés — décidé par JB (source : fiche D138).
- 2026-10-01 : refonte en document de conception vivant, qui reprend les fiches D38, D44, D52, D138 et les choix H07, H74 et des stories E03-S05, E05-S05, E08-S09 — décidé par Alexis, accord de JB.
- 2026-10-20 : « Usage » revient sous le nom « Statistiques » avec l'adoption, le contenu, le partage et les connecteurs ; les retours s'ouvrent aux administrateurs de l'organisation qui allume « Retours visibles » — décidé par JB (source : session du 20/10/2026).
- 2026-10-20 : page « Activité » à deux onglets (Statistiques pour l'administrateur, Journal pour tous) à l'adresse du journal, courbe hebdomadaire, tableaux triables par équipe et par personne — décidé par JB (source : session du 20/10/2026).
- 2026-10-20 : « Activité » se range dans les réglages, à la place du Journal ; « Suivi de l'entreprise » ne porte que Retours, un membre simple garde un seul groupe — décidé par JB (source : session du 20/10/2026).
- 2026-10-20 : « Retours » toujours montré à l'administrateur, décidé sur l'identité sans requête ; la page des retours dit l'option éteinte et l'allume sur place — décidé par JB (source : session du 20/10/2026 ; plafond de requêtes de l'affichage d'une page).
