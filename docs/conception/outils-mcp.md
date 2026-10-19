# Outils MCP

- **Statut** : validé avec JB le 23/09/2026
- **Dernière révision** : 2026-10-02 (ADR-009 § 3 révisé au statut proposé, en attente de la mesure du banc)

## Résumé

Un assistant voit six outils figés, préfixés par l'organisation de l'adresse : `context`, `find`, `read`, `call`, `write`, `feedback`. Chaque appel exige le code `ctx` que rend `context`, passe par une porte sans état qui vérifie le jeton, borne et journalise, et reçoit le même texte en clair et en structuré.
Tout le reste (tableaux, journal, contrats, fonctions métier) passe par `call` et `read` : c'est du contenu, pas de la surface.

## Contexte

Le banc MCP a mesuré que les hosts figent la liste d'outils, ne montrent presque rien des métadonnées (notice jamais lue sur claude.ai, coupée à 2 048 caractères sur Claude Code, descriptions lues à la première phrase), n'appliquent une mise à jour qu'après un geste de l'utilisateur, et que leur routage se dégrade avec le nombre d'outils. Un seul levier marche partout, 9 fois sur 9 : un champ obligatoire dont la valeur vient d'un de nos outils. Claude Code ne lit que `structuredContent` quand il existe ; claude.ai et ChatGPT lisent le texte. La maquette des six outils a confirmé le contrat : `context` premier appel 39 fois sur 39, rafraîchissement sans geste 3 fois sur 3, deux organisations branchées côte à côte sur les trois hosts sans confusion.

Le banc a aussi mesuré qu'aucune affinité réseau n'est possible (claude.ai et ChatGPT changent d'adresse à chaque requête), que `notifications/tools/list_changed` n'est relue que par Claude Code, et que le code `ctx` en base porte tout ce qu'une session porterait.

## Objectifs et non-objectifs

- Aucun geste demandé dans Claude ou ChatGPT pour une procédure, un connecteur ou une règle.
- Un routage qui ne dépend plus du nombre d'outils ; un contexte relu à chaque conversation ([contexte servi](contexte-servi.md)).
- Une porte simple, sans état, qui passe à zéro instance.
- Un résultat rendu dans la conversation (tableau, fiche, page, vue d'un ERP) quand l'hôte l'allume, sans outil de plus.
- Hors objectif : un outil par famille d'objets ; un widget par vue ou par outil ; toute notification du serveur vers le client.

## Conception

### Les six outils, gelés (ADR-002 § 1, § 6)

- Six outils : `context`, `find`, `read`, `call`, `write`, `feedback`. La seule évolution permise est d'en **ajouter** un ; jamais renommer, retirer, rendre un champ obligatoire ni changer le sens d'un champ ; un champ nouveau est facultatif avec défaut ; une description ne change que pour s'allonger d'un domaine. Ce qui serait un changement cassant devient une procédure ou une fonction, donc du contenu.
- D8 : le contrat MCP des six outils (noms, titres, descriptions, schémas) part tel qu'écrit, sans relecture préalable ; il ne change plus que par ajout (ADR-002), et un test le fige.
- H22 : les schémas d'entrée des six outils sont figés et ne changent que par ajout (ADR-002) ; chaque champ porte `.describe()` avec un exemple ; `team` et `account` de `call` sont facultatifs.
- Pas d'outil par famille d'objets (ADR-002 § 6) : tableaux, journal et contrats passent par `call` et `read`.
- Le connecteur admin (`/api/mcp-admin`) n'est pas soumis au gel ([administration et cellule](administration-et-cellule.md)).

### Préfixe et descriptions (ADR-002 § 3, § 5)

- Le préfixe de l'organisation est dans le nom des outils (`acme_context`…), calculé à chaque requête depuis l'organisation de l'adresse ; descriptions et messages citent le même préfixe. Court, en ASCII, fixé à l'arrivée du client et **jamais changé**.
- La description de `context` finit par une borne (« Call it only for <org>'s work, or when the user's preferences ask for it. Otherwise do not call it. ») : sans borne, un tiers des conversations appelaient les deux `context` de deux organisations branchées ensemble. Elle dit d'appeler `context` d'abord, avec `phrase`, puis de nouveau pour chaque nouvelle demande avec `since_ctx`, qui route la phrase sans tout recharger (2026-10-19 : « once per conversation » faisait croire qu'on ne le rappelait jamais). Elle admet un appel hors travail, celui que la phrase de préférences de l'écran « Brancher » demande une fois par conversation, sans `phrase` (aucune procédure n'est alors routée) : les consignes que la personne tient dans son Contexte s'appliquent ainsi à une demande qui n'est pas du travail. Sans préférence, rien ne change : une demande hors travail ne charge rien.
- Schémas plats (ChatGPT ne montre pas les descriptions imbriquées) : `arguments` de `call` est un objet libre décrit par `read`, validé par le serveur.
- H25 : descriptions en anglais, sous 1 000 caractères, ouvertes par « Requires the ctx code from <p>_context; call it first. » ; celle de `context` nomme les domaines et borne son usage ; celle de `call` cite deux ou trois fonctions actives.
- E03-S01 N6 : `settings.domains` est une chaîne libre en anglais ; un tableau de chaînes est joint par « , » ; absent ou vide, la description de `context` n'a pas de domaines.
- E03-S01 N14 : dans les descriptions, le nom affiché est coupé à 60 caractères et les domaines à 100, pour tenir sous 1 000 caractères.
- E03-S01 N15 : exemples de `call` : la première fonction non sensible, par nom, de deux connecteurs actifs au plus, puis `table.rows` s'il est actif ; trois noms au plus, jamais une fonction de l'ERP.
- E03-S01 N7 : les instructions du serveur MCP tiennent en une phrase qui renvoie à `context` et porte la borne (« for any request about {org}'s work ») : claude.ai ne montre jamais les instructions.
- H23 : annotations `readOnlyHint: true` sur `context`, `find` et `read` ; `destructiveHint: false` sur `feedback` seul ; `openWorldHint: true` sur `call` seul ; `call` et `write` gardent les autres défauts (ADR-002 § 7).

### Le serveur et son transport (ADR-009)

- Transport sans état (ADR-009 § 1) : Streamable HTTP, pas de `Mcp-Session-Id` persisté, pas de Redis, chaque requête reconstruit le serveur (`disableSse: true`). Tout l'état métier est en Postgres ; l'état conversationnel appartient à l'host ; le code `ctx` regroupe les appels.
- Pas de notification du serveur vers le client hors requête, pas d'abonnement aux resources (ADR-009 § 2). Une opération longue tient dans la requête (`maxDuration` sur la route) ; au-delà de 60 s, motif « job + fonction de statut » derrière `call`.
- **ADR-009 § 3, révisé (proposé le 02/10/2026, mesure du banc à reporter)** : texte seul par défaut ; un widget routeur unique quand l'hôte passe `widgets: true` à `handleMcpPost` (story `docs/produit/stories/widgets-dans-la-conversation.md`). Tout résultat reste pleinement utilisable en texte (`mcp-patterns.md` § 5.3 « Dégradation ») :
  - Interrupteur éteint : liste d'outils, capacités et `structuredContent` sont ceux du texte seul, octet pour octet.
  - Allumé : `call` et `read` portent la triple méta du widget (`mcp/widget-meta.ts`), les quatre autres outils non ; le serveur déclare `resources` et sert un seul bundle sous deux adresses, `ui://oto/view.html` (`text/html;profile=mcp-app`) et `ui://oto/view-skybridge.html` (`text/html+skybridge`), en mémoire, sans lecture de fichier.
  - Un résultat porte `structuredContent.view = { kind, theme, call }` : la vue (`table`, `record`, `page`, ou `erp:<nom>` d'une fonction de l'ERP qui déclare `view`), le thème de la personne sinon de l'organisation, et le nom de l'outil `call` que le widget appelle. Les données de la vue sont celles du résultat, sans copie ; seule la vue `page` ajoute les blocs servis, sous `MAX_DATA_CHARS`. Au-delà, ni données ni vue.
  - Le bundle du paquet porte ses vues ; un hôte qui déclare des vues de l'ERP construit un bundle unique (`oto-platform widgets build`) et l'inscrit par `registerWidgetViews`, qui remplace celui du paquet.
  - Le widget appelle `call` par l'host (page suivante d'un tableau, appels d'une vue de l'ERP) sous le `ctx` de la conversation, jamais avec `confirm` ; une suite (`next_actions`) part en message à l'assistant.
- H21 : le serveur installe des handlers bas niveau du SDK, pas `registerTool`, pour que la garde du `ctx` rende son propre message ; les schémas d'entrée sont en `zod/v4` et servis par `z.toJSONSchema`.
- E03-S01 N12 : les schémas que le MCP compose (`mcp/schemas.ts`, `schemas/nodes.ts`, `schemas/ctx.ts`…) s'écrivent en `zod/v4` : un schéma v3 ne s'imbrique pas dans un objet v4, et `z.toJSONSchema` n'existe qu'en v4.
- E03-S01 N10 : aucun module de `mcp/` ne lit l'environnement à l'import : JWKS et émetteur se lisent à la première vérification.
- E03-S01 N16 : le type `ToolOutput` vit dans `server/tool-output.ts` : les services de `server/` n'importent pas `mcp/` ([pile et structure](../reference/pile-et-structure.md)).

### La porte d'un appel

- E03-S01 N1 : adresse inconnue : le jeton est vérifié d'abord (401 sans jeton), puis 404 JSON-RPC `-32001` « No organisation is served at <hôte>. » sous jeton valide ; aucune clé de service ne résout l'organisation avant le jeton. Vérification du jeton et appartenance : [identité et connexion](identite-et-connexion.md).
- Le champ `ctx` est requis sur tous les outils sauf `context` (ADR-002 § 2) ; émission, péremption et refus : [contexte servi](contexte-servi.md). E03-S01 N13 : un `ctx` émis sur une autre organisation de la même personne est refusé comme inconnu (`ctx_missing`), pas comme périmé.
- E03-S01 N11 : les arguments d'un appel sont plafonnés à 1 000 000 caractères (`MAX_ARGS_CHARS`), refusés avant tout traitement.
- E03-S01 N22 : ce que le host envoie est borné à 200 caractères avant le journal ou un message : nom d'outil, nom de prompt, signature `client_name@version`, fonction demandée par `call`.
- H29 : la signature `client_name@version` de l'`initialize` est lue dans le corps de la requête et posée sur `ctx.host` et `journal.host`. E03-S01 N3 : `ctx.host` est la signature du dernier `initialize` journalisé de la même personne au même agent utilisateur (membre : journal de son organisation ; équipe plateforme : `admin_journal`) ; les appels sous ce `ctx` en héritent.
- E03-S01 N21 : `prompts/get` d'un nom inconnu : erreur JSON-RPC -32602 qui porte le message seul, journalisée `not_found: Unknown prompt <nom>.`.

### Journal de la porte

Une ligne par appel, écrite après la réponse ([journal et retours](journal-et-retours.md), H07).

- E03-S01 N2 : les refus d'un non-membre ne sont pas journalisés : la porte rend son refus sans ligne, le journal n'admettant que les membres de l'organisation.
- E03-S01 N4 : `journal.error` s'écrit `<code>: <message>`, coupé à 500 caractères (`journalError`) aux deux portes, jamais au milieu d'une paire de substitution.
- E03-S01 N5 : toute valeur dont la clé contient `secret`, `token`, `passw`, `authorization`, `apikey` ou `privatekey` (sans casse, sans `-` ni `_`) est masquée ; une clé `key` seule ne l'est pas (clé métier des lignes). E03-S01 N29 : le masquage descend de six niveaux, un par objet ou tableau traversé (`MASK_DEPTH`) ; au-delà, la valeur est gardée telle quelle et le parcours reste borné.
- E03-S01 N19 : jeton sans email : le refus du non-membre le nomme « user <sub> », et ce libellé sert de nom de repli à un membre sans nom ni email (bloc personne, annuaire).
- E03-S01 N31 : aucune chaîne du journal ni aucun nom servi au host ne porte une moitié de paire de substitution : toute coupe passe par `clip`, et ce que le host envoie est rendu bien formé (U+FFFD).

### Résultats et refus (ADR-002 § 4, § 7)

- Tout résultat porte le même contenu dans `content` (texte) et `structuredContent`, les données (ids, lignes) en plus dans le structuré (ADR-002 § 4). H26 : le même texte dans `content[0].text` et `structuredContent.text`, ses données en champs et `next_actions`, qui ne propose jamais de fonction sensible ; 45 000 caractères au plus, la suite par curseur.
- Budgets (ADR-002 § 7) : tout résultat de `read` et `call`, 45 000 caractères au plus ; morceaux de `write`, 20 000 caractères ; `context`, 35 000 ([contexte servi](contexte-servi.md)).
- E03-S01 N17 : le formateur coupe à la dernière fin de ligne qui tient ; une première ligne plus longue que le plafond à elle seule est coupée au caractère, jamais dans une paire de substitution.
- E03-S01 N30 : un refus `invalid_arguments` liste les 20 premiers problèmes (`chemin: message`, séparés par « ; ») puis « … and <k> more » ; `formatError` coupe tout refus au-delà de 45 000 caractères, avec « [Message cut at 45,000 characters.] ».
- E03-S01 N23 : toute panne, `internal` nommé compris, est servie au modèle par « Internal error. Retry once, then report it with <p>_feedback (type error). » (-32603 « Internal error. » pour `prompts/*`) ; le détail reste au log serveur.

### Ce que disent `write`, `read`, `find` et `context` (stories E11-S03, E11-S19)

Le détail des opérations vit dans [lecture et écriture des pages](lecture-et-ecriture-des-pages.md) et [routage et recherche](routage-et-recherche.md) ; restent ici les textes servis.

- HN-E11S03-8 : `append` au-delà de 500 éléments (sous-éléments compris) ne prolonge pas la liste : un bloc neuf, dit. HN-E11S03-9 : une liste numérotée prolongée garde son `start` ; celui du texte ajouté est ignoré.
- HN-E11S03-22 : dans le résultat d'`append` qui prolonge une liste, « +N » est la croissance de la section en caractères. HN-E11S03-23 : « the list continues with N more items » compte les éléments ajoutés, sous-éléments compris.
- HN-E11S03-10 : la ligne « - (start of page, N characters) » n'est que dans le texte du plan et de `staleState` : compte de sections, `data.outline` et plan de l'écran inchangés. HN-E11S03-24 : `staleState` d'une page sans titre : la ligne de début de page, puis « - (no section) ».
- HN-E11S03-25 : le résultat de `move_block` vers une section cite son titre tel que rangé, non tel que demandé. HN-E11S03-26 : un titre déplacé vers une sous-section de la section qu'il ouvre n'est pas refusé ; seul `section` égal à la section qu'il ouvre l'est (« a heading cannot move into the section it heads. »).
- HN-E11S19-5 : P37 gardée : pas de champ `triggers`. Les « words in common » d'une candidate (`wordsInCommon`) approchent les lexèmes du score : mots de quatre lettres au moins, sans casse ni accents, égaux ou de mêmes cinq premières lettres ; ils disent quoi ajouter au résumé, pas le calcul (trigrammes et correction par le lexique non montrés). Sans procédure servie, la ligne dit le seuil et l'écart de l'organisation.
- HN-E11S19-6 : genre `edit` : liste fermée de verbes qui modifient un texte (`modifie`, `corrige`, `change`, `remplace`, `mets à jour`, `réécris`, `reformule`, `renomme`, et leurs infinitifs après une formule de demande). Ni « ajoute » (une création), ni `supprime`, `retire`, `efface` : une suppression passe par `node.trash`, `table.delete_rows` ou l'en-tête d'un tableau par `write` (golden TDN1, PD2, TB3) (AC-d3).
- HN-E11S19-7 : une question dont la personne est le sujet et un tiers (`lui`, `leur`) l'objet, avant le verbe, est une action (« Qu'est-ce que je lui réponds ? ») ; « Qu'est-ce que j'ai à faire ? » reste une question de données (golden TD4) ; « Qu'est-ce que je leur dois ? » passe en action : accepté.
- HN-E11S19-8 : `functions` est un chemin réservé de `read`, comme `journal` (P22) : un nœud à ce chemin n'est plus lisible par `read` (l'écran le lit) ; `write` refuse ce chemin et le slug d'équipe `functions` est réservé (`server/teams.ts`) ; aucune contrainte de base : une équipe existante au slug `functions` ferait échouer la migration.
- HN-E11S19-9 : le plan (`outline`) quitte les données de `read` quand une section est demandée ou que le texte le porte (page servie par son plan, `outline: true` compris) ; `sections_total` reste (`mcp-patterns.md` § 4 : `structuredContent` compact, pas deux fois la même chose).
- HN-E11S19-10 : `find` rend la révision dans la ligne « To edit: <p>_write {"path": …, "base_revision": <révision>, "ops": [...]} » : sans elle, `write` exige de relire pour `base_revision` ; seulement pour un nœud hors tableau dont des blocs sont montrés et que la personne écrit.
- HN-E11S19-11 : avec `match: "any"` de `table.rows`, le nombre de mots trouvés prime sur `sort`, qui départage ; `match: "any"` entre dans l'empreinte du curseur.

## Décisions et alternatives écartées

- **Un outil par capacité** (le modèle d'Oto) : une centaine d'outils listés, routage par l'host, geste de chaque utilisateur à chaque évolution. Contredit par le banc.
- **Un readme et un accusé de lecture, sans code par conversation** : le levier mesuré 9 fois sur 9 est le champ requis ; l'accusé seul prouve l'appel, pas la lecture.
- **Transport avec état** (sessions et SSE par Redis) : coût de Redis, fin du passage à zéro instance, invalidation de session, tests plus lourds ; le seul gain (`listChanged` poussé) n'est vu que par Claude Code. Rejeté (ADR-009).
- **Widgets reportés** (ADR-009 § 3 d'origine) : build Vite en un fichier, triple méta, matrice de hosts à maintenir, sans demande d'utilisateur. Rouvert par la demande d'un ERP construit sur le paquet ; remplacé par le widget routeur derrière un interrupteur (proposé).
- **Un widget par vue, ou un outil par vue** : contredit ADR-002 § 6 (pas d'outil par famille d'objets) et multiplie les cadres ; écarté pour un widget routeur sur `call` et `read`. Repli si le banc montre un cadre vide sur un résultat sans vue : un outil `view` dédié, ajout permis par ADR-002.
- **Copier les données dans `view.data`** : doublait `structuredContent`, lu en entier par Claude Code, et atteignait `MAX_DATA_CHARS` deux fois plus tôt ; écarté pour une vue qui ne porte que son nom.
- **Deux bundles (paquet, ERP)** : deux widgets, donc un choix d'outil par fonction ; écarté sans mesure. **Vite en dépendance du paquet** : chaque hôte l'aurait téléchargé, même sans vue de l'ERP ; écarté pour des dépendances paires facultatives.
- **Suite appelée par le widget** : une suite n'a pas d'arguments, l'appel serait refusé ; écartée pour un message à l'assistant, qui garde aussi la confirmation en deux temps.
- **Exceptions au gel, sans client** (stade R&D) : en 1.1.0, les descriptions de `write` et des fonctions de tableau ont été réécrites en place et non seulement allongées, les hosts rafraîchissant la liste à la mise à jour (fiche D131, stories E11-S01, E11-S03) ; le défaut de `publish` de `write` est passé de `false` à `true`, `publish: false` gardant le sens d'avant (fiche D135, story E11-S02). Toute exception future demande la même absence de client.
- Coût accepté : tout passe par six schémas génériques (la qualité des descriptions de fonctions servies par `read` devient critique), et le préfixe est irréversible (une erreur de nommage se paie par une nouvelle organisation). Aucun push : une nouveauté n'atteint le modèle qu'à la conversation suivante ou au prochain appel.

## Sécurité et confidentialité

- Aucun outil n'accepte un secret en argument ; tout ce que le modèle envoie est validé comme un formulaire public (Zod, appartenance, niveau d'accès).
- Le journal masque les clés de secret (E03-S01 N5, N29), ne garde pas les refus d'un non-membre (E03-S01 N2), et coupe sans casser l'Unicode (E03-S01 N31).
- `next_actions` ne propose jamais de fonction sensible (H26) ; les fonctions sensibles se font en deux temps ([connecteurs et comptes](connecteurs-et-comptes.md)).
- Le détail d'une panne reste au log serveur (E03-S01 N23).
- Widget : bundle sans ressource externe (CSP des hosts), rendu par React sans `dangerouslySetInnerHTML` ; il ne montre que le résultat déjà servi au modèle. Il appelle `call` par l'host, que le serveur ne distingue pas d'un appel du modèle (mêmes gardes, même journal) ; il n'envoie jamais `confirm`, une fonction sensible ne rend donc que son récapitulatif. Le bundle se sert à tout jeton valide : il ne porte aucune donnée.

## Écart avec le code

- ADR-009 § 3 révisé au statut proposé : le code le suit, l'interrupteur reste éteint par défaut jusqu'à la mesure du banc (lignes W1 à W6 de [les requêtes de référence](../reference/mcp-golden-queries.md)). L'hôte de référence l'allume par `PLATFORM_MCP_WIDGETS=on`.
- Bundle de 997 Ko, 307 Ko compressé (sortie de `pnpm widgets:build`), au-delà de la cible de `mcp-patterns.md § 5.3` ; accepté pour le banc.
- Les cas de test du contrat figé et du routage sont dans [les requêtes de référence](../reference/mcp-golden-queries.md).

## Questions ouvertes

- Ce qui rouvrirait ADR-009 § 1 et § 2 : un besoin de notification du serveur vers le client (inopérant de toute façon sur claude.ai et ChatGPT).
- ADR-009 § 3 (proposé) : un résultat sans vue ouvre-t-il un cadre visible sur Claude et ChatGPT ? Oui : repli sur un outil `view` dédié. Non : l'interrupteur peut passer à vrai par défaut. À trancher par JB après le banc, avec le poids du bundle.

## Historique

- 2026-09-23 : six outils figés, `ctx` exigé partout sauf sur `context`, préfixe calculé par requête, même contenu en texte et en structuré ; transport sans état, texte seul — décidé par JB (source : ADR-002, ADR-009, fiche D8).
- 2026-09-29 : descriptions de `write` et des fonctions de tableau réécrites en place pour la 1.1.0, sans client ; `publish` de `write` vrai par défaut ; textes de `append`, `move_block` et du plan — décidé par JB et le responsable d'Oto (source : fiches D131, D135, stories E11-S01, E11-S02, E11-S03).
- 2026-09-30 : routage expliqué (`wordsInCommon`, seuil dit), genre `edit`, chemin réservé `functions`, plan retiré des données d'une section, ligne « To edit » de `find`, `match: "any"` — décidé par le pilote (source : story E11-S19).
- 2026-10-01 : refonte en document de conception vivant, qui reprend ADR-002 (§ 1, § 3 à § 7), ADR-009, D8, H21 à H23, H25, H26, H29, les choix d'E03-S01 et ceux d'E11-S03 et E11-S19 sur les textes servis — décidé par Alexis, accord de JB.
- 2026-10-02 : ADR-009 § 3 révisé au statut proposé — widget routeur sur `call` et `read` derrière l'interrupteur `widgets`, vues du paquet et de l'ERP, appels du widget sans `confirm` ; mesure du banc à reporter — proposé par la session de la story widgets-dans-la-conversation, à valider par JB.
- 2026-10-01 : `context` se charge une fois par conversation quand les préférences de la personne le demandent, les autres outils restent réservés au travail ; la borne de la description et le champ `phrase` le disent, mesure sur les assistants après publication — décidé par JB (source : demande du responsable d'Oto).
- 2026-10-19 : la description de `context` et la règle servie disent de le rappeler avec `since_ctx` à chaque nouvelle demande, au lieu de « once per conversation » — décidé par JB (source : retours d'usage du MCP Démo, session du 19/10/2026).
