# Routage et recherche

- **Statut** : validé avec JB le 23/09/2026
- **Dernière révision** : 2026-10-27

## Résumé

Une demande trouve sa procédure côté serveur, sans IA : `context(phrase)` classe les procédures lisibles par plein texte et trigrammes sur leur titre et leur résumé et montre les cinq plus proches ; au-delà d'un seuil, la première est décidée, marquée « best match », avec la consigne de la lire par `read` puis de suivre ses étapes ; sinon l'assistant départage. Pour la longue traîne, `find` cherche dans le contenu publié. Une faute de frappe se corrige par le lexique des mots de l'organisation.

## Contexte

L'utilisateur parle ; une phrase doit trouver seule la bonne procédure, sans qu'il connaisse les outils. Le routage par l'host se dégrade avec le nombre d'outils. Le canal MCP est déjà une conversation avec un modèle frontier que l'utilisateur paie (`mcp-patterns.md § 4 bis`) ; une IA côté serveur coûterait une clé, une facture et une boîte noire non testable. Oto portait une entité « projet » (`_project` sur chaque appel) que le banc a jugée coûteuse à retenir (ADR-003). Les retours de la démo du 2026-09-29 (FB-0004 : égalités, « crée le projet X » et fautes de frappe non servis) ont recalibré le mélange (E11-S04), puis le passage à l'échelle a confié l'arbitrage des candidates à l'assistant (E11-S16).

## Objectifs et non-objectifs

- Testable sans host, à chaque commit ; explicable (score, composantes, bonus) ; zéro coût d'inférence serveur, zéro clé, zéro dérive silencieuse.
- 95 % au moins de bonnes reconnaissances sur le jeu de phrases de chaque organisation.
- Hors objectif : le routage par embeddings ou par un LLM serveur ; une entité « projet » ; des phrases voisines stockées par procédure ; une confiance chiffrée sur les résultats de `find`.

## Conception

### Le serveur route (ADR-003 § 1)

- `context(phrase)` route, puis `find` pour la longue traîne. Le routage cherche parmi les procédures publiées que la personne lit, par plein texte Postgres à racines françaises (configuration `platform.fr`) et similarité de trigrammes (`pg_trgm`, `unaccent`) sur leur titre et leur résumé — le résumé dit comment on la demande —, plus deux bonus : procédure d'une équipe de la personne, procédure utilisée dans les 30 derniers jours. Score ramené entre 0 et 1. Aucun embedding, aucun dictionnaire de vocabulaire (ADR-011 § 7, [nœuds et arbre](noeuds-et-arbre.md)).
- `route_candidates(org, query, kind, limit)` rend les composantes du score ; le service redécide. Fonctions et index : [schéma](../reference/schema-platform.md), modules `routing.ts`, `find.ts` : [services et portes](../reference/services-et-portes.md).
- **Score** (H40) : score = 0,55 × max(s_summary, s_title) + 0,45 × lexical × min(1, lexèmes/2), + 0,03 par bonus (équipe, usage sur 30 jours) ; candidat dès 0,30 ; procédure décidée à 0,65 avec 0,1 d'écart, réglables par organisation.
- **Poids du mélange** (E11-S04, sans ADR : les poids sont « flexibles sans ADR ») : `WEIGHTS` = texte 0,25, formulation 0,30, lexèmes 0,45 (dans les lexèmes, 0,75 titre et résumé, 0,25 titre seul) : le seul point d'une grille au pas de 0,05 qui tient le jeu « todo » sans baisser Acme ni le pilote (HN-E11S04-16) ; seuil 0,65 et écart 0,1 inchangés, seuls les poids se recalibrent (HN-E11S04-2).
- Chaque formulation du résumé est cherchée à part (`s_phrase`) ; aucune branche de présélection pour une formulation contenue dans la demande : ses mots sont des lexèmes de la demande, que la branche plein texte trouve (HN-E11S04-10). Le titre compte à part : `lexical_title` lit `to_tsvector('platform.fr', norm_words(title))`, la normalisation des lexèmes du nœud (HN-E11S04-18).
- Les poids des mots rares se comptent sur les candidates lisibles de l'appel, jamais sur toute l'organisation : un nœud illisible ne change aucun score (HN-E11S04-5). Rareté et correction : `df` compte un lexème porté tel quel ou par sa correction ; la demande corrigée entre par des branches `union`, qui gardent les index de la présélection (HN-E11S04-19).
- **Présélection** : un nœud sans lexème commun n'est gardé que si une ressemblance atteint 0,43 (trigrammes du titre et du résumé, titre contenu dans la demande) ; seuils de `pg_trgm` posés par `SET` sur la fonction (HN-E01S13-5) ; ce seuil reste 0,43, recalculé sur les poids nouveaux (HN-E11S04-17).
- `rankCandidates` ne route que les procédures (`p_kind: "procedure"` de `route_candidates`), sans genre en paramètre (E03-S02 N18).
- **Droits et corbeille** : `route_candidates` filtre par `node_level_for`, le même calcul que `search_content` ; le service garde sa décision par `nodeLevels` (HN-E01S13-4). `rankCandidates` et `find` calculent en un lot (`nodeLevels`) le niveau des nœuds rendus et retirent ceux de niveau 0 avant le mélange, le regroupement et les bornes (E03-S02 N22). `route_candidates` et `search_content` excluent la corbeille (`deleted_at is null`) avant leur coupe ; le service garde `nodeLevels` après la fonction (HN-E11S04-9). `route_candidates` ne rend aucune ligne à qui n'est pas membre de l'organisation ; `search_content` le refuse en `42501` (HN-E01S13-10).
- **Bonus d'usage** : une ligne de journal de la personne dans l'organisation dont `target` vaut le chemin de la procédure, sur 30 jours (lecture ou procédure servie) (E03-S02 N5) ; il lit les `READ_PAGE_ROWS` (1 000) cibles les plus récentes des 30 jours (E03-S02 N32).

### Seuil, écart et consigne (ADR-003 § 2)

- Une procédure n'est décidée que si le meilleur candidat dépasse le seuil et distance nettement le deuxième (0,65 et 0,1 par défaut, calibrés sur la maquette, 132 phrases). Seuil et écart se règlent par organisation (`orgs.settings.routing`), sur le jeu de phrases de test, pour 95 % au moins de bonnes reconnaissances. `orgs.settings.routing` se lit clé par clé : une valeur absente, non numérique ou hors de [0, 1] reprend son défaut (seuil 0,65 ; écart 0,1) (E03-S02 N3).
- Les cinq candidates les plus proches (`CANDIDATES_SHOWN`, 5 depuis le 2026-10-27, 3 avant), une ligne chacune : chemin, titre, résumé, score et mots en commun avec la demande. Toujours toutes les candidates montrées, jamais la première seule. Le modèle juge si la phrase demande d'agir, d'expliquer ou de répondre ; le score lexical ne départage pas deux voisines que leur titre distingue (« relancer les devis », « relancer les tickets »), le modèle si (amendement E11-S16, décision de JB).
- Une procédure décidée est la première, sa ligne marquée « best match », suivie d'une consigne (2026-10-27) : si la demande porte sur son titre, la lire par `<p>_read {"path": …}`, puis suivre ses étapes dans l'ordre (si elle porte sur une autre des candidates, lire et suivre celle-là), comment recopier un bloc `call` en appel de `<p>_call`, et l'accord de la personne avant tout envoi ou ce qui dépasse la procédure demandée (fiche D99). Ses étapes ne sont jamais servies par `context`, même sur un score excellent. La décision garde son rôle hors du texte : `served` (chemin, révision relue, score) en données, cible du journal et bonus d'usage.
- Sans procédure décidée : les candidates, puis une seule consigne, lire celle qui correspond à la demande, sinon chercher ou demander à l'utilisateur ; le seuil et l'écart de l'organisation sont dits. Une seule candidate de score ≥ 0,30 : la consigne n'en propose qu'une ; aucune procédure sous `SHOW_THRESHOLD` n'est ajoutée pour atteindre cinq (HN-E11S04-15).
- **Genre de la phrase** (H37) : sans procédure décidée, une phrase qui finit par « ? » ou commence par un interrogatif est une question de données (`data_question`), sauf une question dont la personne est le sujet et un tiers (`lui`, `leur`) l'objet, qui est une action (E11-S19) ; avec des candidates, une seule consigne, quel que soit le genre de la phrase ; sans candidate, une question se cherche et se répond (l'assistant arbitre, il n'est plus tenu de demander, E11-S16), et une demande qui commence par un verbe d'édition est `edit` et reçoit la marche `find` puis `write` (E11-S19).
- Une phrase est une question de données si, rognée, elle finit par « ? » ou commence par un interrogatif (`INTERROGATIVE` de `server/routing.ts`) suivi d'une frontière de mot ; « est-ce qu' » compte, apostrophe typographique comprise ; une phrase ouverte par « comment » ou par une formule de demande n'en est pas une (`requestKind`, HN-E11S04-12) (E03-S02 N1). Les formules de demande (`REQUEST_FORMULAS` de `server/routing.ts`) forment une liste fermée écrite dans le code, comme les interrogatifs (HN-E11S04-12). `isDataQuestion` reste exporté (`requestKind(phrase) === "data"`), sans appelant de production : ses tests gardent leur verdict (HN-E11S04-23).
- Une question « comment » dont la procédure est décidée reçoit, au lieu de la consigne de suivre, « It asks how: read <chemin> with <p>_read {…}, explain its steps, and run them only if the user asks. » (ADR-003 § 4, HN-E11S04-7). Aucun champ nouveau dans `structuredContent` : `data_question` vaut `false` pour `how` et `request` (HN-E11S04-8).
- Une demande d'un seul mot décide une procédure dès qu'elle passe le seuil, comme toute autre demande ; ces cas sont mesurés, pas refusés (D9).
- La phrase reprise dans la ligne du routage est coupée à 200 caractères (`MAX_TARGET_CHARS`), comme la cible du journal (E03-S02 N4).
- La procédure décidée se lit par `read`, entière quelle que soit sa taille (jamais de plan d'office, seul le curseur au-delà de 45 000 caractères la découpe) : forme des étapes et des blocs `call`, [procédures](procedures.md) ; assemblage de `context` : [contexte servi](contexte-servi.md).
- **Pannes** : `search_content` en erreur → `internal` pour `find` ; dans `context`, routage en panne → « no procedure could be matched right now », réglage illisible → défauts, bonus illisible → aucun ; `context` répond (E03-S02 N17). Une procédure décidée dont la révision ne se relit pas, ou disparue depuis le routage, n'est pas proposée : `context` répond comme un routage en panne (ni décidée ni candidate), la panne au log serveur (E03-S02 N30).

### Fautes de frappe : le lexique

- Le lexique (`lexicon`) garde les mots de surface d'une organisation (`norm_words` en `simple`, sans chiffres, 4 à 40 lettres) ; une suppression ordinaire ne les retire pas, un mot périmé ne rend aucun résultat (HN-E01S13-2). Il n'est lu et écrit que par des fonctions `security definer` du paquet : les mots d'un nœud privé ne sortent par aucune lecture directe (HN-E01S13-6).
- Un déclencheur par table (`nodes_lexicon_sync`, `blocks_lexicon_sync`) sert `lexicon_sync()` sur le contenu publié ; chaque insertion prend ses mots `order by word`, `on conflict do nothing` : deux publications s'attendent sans s'interbloquer (HN-E01S13-13). `forget_user` reconstruit le lexique des organisations des nœuds qu'elle supprime (`lexicon_rebuild`, definer, sans exécution accordée) : les mots privés partent avec la personne (HN-E01S13-20).
- La correction s'écrit une fois, dans `platform.lexicon_fix` (forme du mot, absence du lexique, mot le plus proche) ; `search_content` l'appelle et garde en ligne son exception du dernier mot, cherché par préfixe (HN-E11S04-4). Son seuil est la clause `set pg_trgm.similarity_threshold = '0.3'` de `lexicon_fix`, sans paramètre : ses deux appelants corrigent à 0,3 (HN-E11S04-13).
- Dans `find`, la correction ne sert qu'en dernier recours : un terme de 5 lettres ou plus absent du lexique reçoit le mot le plus ressemblant (`similarity` ≥ 0,3) ; termes tels quels (ET), puis chacun OU sa correction, puis l'un d'eux (OU) (HN-E01S13-1). `find` n'affiche aucune correction : elle révélerait un mot d'un nœud illisible (HN-E01S13-3).
- Le routage tente toujours la correction, en plus de la demande telle quelle (pas en dernier recours comme `find`) ; mots de 5 à 40 lettres, seuil 0,3, sans l'exception du dernier mot (HN-E11S04-3).

### `find` : la longue traîne

- `find` classe comme `context` (2026-10-19) : le score d'un nœud est son score de routage (`rankCandidates` sur tous les genres, ou ceux de `type` : titre et résumé, lexèmes et trigrammes, bonus d'équipe et d'usage), ou celui de `search_content` s'il est meilleur ; une procédure gagne 0,05 pour une demande qui n'est pas une question de données ; un nœud que seul le routage trouve entre sans emplacement. La procédure que `context` met en tête pour une phrase est ainsi le premier résultat de `find` pour la même : deux moteurs donnaient deux réponses.
- `find` rend trois nœuds en détail, avec ce que `search_content` y trouve (titre, puis résumé, puis blocs publiés, lignes comprises), chacun avec ses emplacements (la section d'un bloc de page trouvé, E11-S19), la ligne « To edit » avec sa révision pour qui écrit un nœud hors tableau dont des blocs sont montrés (E11-S19), puis les dix nœuds suivants en une ligne chacun (chemin, genre, score, titre et début du résumé ; `others` en données), puis trois fonctions au plus du catalogue, un nom exact en tête (H44). Sans les suivants, l'agent savait qu'il existait d'autres résultats sans pouvoir juger s'ils étaient meilleurs.
- `find` demande 50 lignes à `search_content` et les regroupe par nœud, chacun avec ses emplacements dans l'ordre des lignes (trois blocs au plus) (E03-S02 N11). Il sert trois nœuds en détail, les dix suivants en une ligne, et trois fonctions au plus, comme sa description le dit ; `more_nodes` compte les nœuds vus au-delà des trois premiers, « More nodes match » ceux qui ne sont pas listés ; le score d'un nœud est son meilleur rang divisé par 3, dans [0, 1] comme celui des fonctions (E03-S02 N13).
- `find` ne dit pas « The best match is weak » : le rang de `search_content` classe des emplacements sans mesurer une confiance ; le seuil de l'organisation ne sert que le routage de `context` (E03-S02 N14). « No match » est un résultat, pas une erreur, avec la consigne de faire reformuler (E03-S02 N6). Une liste coupée le dit : « More nodes match (at least <n>) … » quand d'autres nœuds ont été vus, « At most 3 rows per table are shown … » quand une ligne de tableau est montrée, « <n> of <total> matching blocks shown … » quand une page a plus de blocs trouvés que les trois montrés (E03-S02 N15).
- `find` de `type: "page"` cherche les pages et les Contextes (`p_kinds` = `page`, `context`) : l'énumération figée de `find` n'a pas de valeur `context` (E03-S02 N12).
- **Extraits** : un extrait tient sur une ligne (blancs et sauts de ligne réduits à une espace) ; titre et résumé sont remplacés par leur extrait quand la correspondance y est (E03-S02 N16). L'extrait d'un bloc va jusqu'à la fin du bloc quand il en reste au plus huit mots (D43) : le fragment `ts_headline`, qui ne finit jamais sur un nombre, est prolongé ainsi (« participant supplémentaire » rend « … 250 € HT. ») (E03-S02 N31), dans la borne de 300 caractères ; un fragment introuvable dans le bloc laisse l'extrait inchangé (HN-E01S13-7).

### Mesure continue sans host (ADR-003 § 3)

- Les données de test de chaque organisation portent des demandes qui doivent mener à chaque procédure et des demandes proches qui ne doivent pas y mener ; un test du serveur les rejoue à chaque changement. Le journal compare la procédure servie aux fonctions appelées ; un écart, une correction ou un `feedback` nourrissent le titre et le résumé. Jeux et cas : [golden queries](../reference/mcp-golden-queries.md).
- Le test de routage sans host joue, sur une organisation jetable, les formulations des résumés (95 % servies au moins), des paraphrases et des négatives (aucune servie à marge sûre) ; paraphrases et demandes d'un mot sont mesurées et rapportées (H43).
- Jeu Acme : une copie de la maquette dans `tests/integration/fixtures/`, jamais une lecture du dépôt `mcp-test` (E03-S02 N8) ; ses données en blocs : étapes en `list` `ordered`, appels en blocs `call` après l'étape qui les annonce (`start` reprend la numérotation), lignes de tableau en blocs `row`, guide et règles d'équipe versés aux Contextes (E03-S02 N9) ; chaque résumé de procédure est suivi de deux anciennes déclencheuses (200 caractères au plus), les autres deviennent des paraphrases, les voisines des négatives ; le taux des paraphrases est rapporté, sans seuil (E03-S02 N10). `seedNodes` est une méthode de `createFixtures()` (`tests/helpers/plateforme.ts`), composée de `createNode`, `publishBlocks` et `addRows` (E03-S02 N20).
- Jeu « todo » (`tests/integration/fixtures/todo-routing.cases.ts`) : ses résumés sont reconstitués et reproduisent les égalités et les scores bas du rapport de tests sur le code d'avant (HN-E11S04-1). Les doublures de `route_candidates` de `tests/unit/routing.test.ts` dérivent `s_phrase` du texte et `lexical_title` des lexèmes : le mélange y vaut l'ancien, et les tests de filtres, bonus et coupes gardent leurs scores (HN-E11S04-22).

### Le serveur garde la main ; ni IA ni projet (ADR-003 § 4 à § 6)

- `call` vérifie fonction, droits et arguments ; une mauvaise reconnaissance ne déclenche jamais plus que ce que l'utilisateur confirme ([connecteurs et comptes](connecteurs-et-comptes.md)).
- Aucune IA côté serveur : l'assistant de l'utilisateur exécute, les routines sont déterministes. Le jour où une routine devra raisonner seule, la décision se rouvre.
- Pas d'entité « projet » : l'équipe est donnée par l'endroit dans l'arbre (`ventes/` s'exécute avec les comptes de Ventes) ; `ctx` seul porte le contexte d'appel.

## Décisions et alternatives écartées

- **Embeddings et recherche vectorielle** : dépendance à un fournisseur ou à un modèle local, coût, non reproductible entre cellules, inutile sur quelques milliers de phrases courtes. Ce qui la ferait revenir : moins de 95 % de bonnes reconnaissances après calibration. Réécartée par les retours de la démo (E11 : « ADR-003 tient »).
- **Un LLM serveur qui choisit la procédure** : coût par appel, clé à gérer, récit non vérifiable, contraire à « aucune IA côté serveur ».
- **Laisser l'host choisir parmi des outils par procédure** : contredit par le banc (dégradation avec le nombre d'outils, geste par utilisateur à chaque procédure publiée).
- **Une consigne par genre de phrase sans étapes servies** (E11-S04) : remplacée par E11-S16 (HN-E11S04-6) ; les candidates viennent par titre et résumé, et le modèle juge si la phrase demande d'agir, d'expliquer ou de répondre. Seule une procédure décidée sur une demande « comment » garde d'expliquer ses étapes et de ne les exécuter que sur demande.
- **Servir les étapes de la procédure décidée dans `context`** (ADR-003 § 2, bloc « ## Procedure <chemin> (vN) », un niveau de titre sous `read`, une page pleine ou trop longue remplacée par un pointeur vers `read`, E03-S02 N2, N19, N32) : retiré le 2026-10-27 par JB, `context` était trop lourd ; un appel `read` de plus quand une procédure est décidée, en échange d'un `context` léger pour toutes les demandes. **Trois candidates** (E11-S16) : cinq depuis, la liste des procédures utiles n'étant plus servie.
- **Tenir l'assistant de demander à l'utilisateur sans candidate** : remplacé par E11-S16, l'assistant arbitre (H37).
- **La correction en dernier recours pour le routage**, comme `find` : écartée par E11-S04, une demande mal tapée ne passait jamais le seuil (HN-E11S04-3).

## Sécurité et confidentialité

- Les niveaux de lecture s'appliquent avant toute coupe et tout mélange (E03-S02 N22, HN-E01S13-4, HN-E11S04-5) : un nœud illisible ne change ni un score, ni une rareté, ni un extrait.
- Le lexique n'a aucune lecture directe (HN-E01S13-6) : RLS et une policy de lecture `lexicon_select_none` (`using (false)`) : `authenticated` le lit sans y voir aucune ligne ; aucune écriture n'est accordée, `anon` n'a rien (HN-E01S13-8). `lexicon.created_at`, date d'entrée d'un mot, est la seule colonne hors de la clé `(org_id, word)` : elle donne à la suite d'isolation une colonne à modifier (HN-E01S13-9). Aucune correction affichée par `find` (HN-E01S13-3) ; les mots privés partent avec la personne (HN-E01S13-20).
- La migration qui recrée `search_content` redit ses privilèges (`revoke … from public`, `grant … to authenticated`) : `check:migrations` exige la révocation de toute fonction créée (HN-E11S04-20). `lexicon_fix` n'est exécutable par aucun rôle client.

## Écart avec le code

- Le retour arrière de la migration du routage est écrit en commentaire, jamais exécuté depuis le paquet (HN-E11S04-21, précédent E05-S13) ; la story a livré son propre fichier, réuni par le pilote dans la migration unique de 1.1.0 (HN-E11S04-11, fiches D131, D145, D124 : [distribution du paquet](distribution-du-paquet.md)).
- La calibration de seuil et d'écart par organisation reste un travail manuel sur le jeu de phrases de chaque organisation ; aucun écran ne l'expose.

## Questions ouvertes

Aucune à ce jour.

## Historique

- 2026-09-23 : routage lexical côté serveur, sans IA ni embedding, sans entité « projet » ; seuil et écart par organisation — décidé par JB (source : ADR-003).
- 2026-09-29 : `find`, lexique des fautes de frappe et candidats par index livrés dans la V1 ; une demande d'un mot est servie et mesurée, en vigueur à la 1.0.0 — décidé par JB (source : fiches D9, D43 ; stories E03-S02, E01-S13).
- 2026-09-29 : formulations du résumé, mots rares, correction toujours tentée par le routage, questions « comment », nouveaux poids — décidé par JB (source : fiche D132, story E11-S04, amendement d'ADR-003 § 2).
- 2026-09-30 : trois candidates par titre et résumé, l'assistant arbitre ; une procédure servie l'est « si la demande porte sur son titre » — décidé par JB (source : story E11-S16, amendement d'ADR-003 § 2).
- 2026-09-30 : demandes d'édition (`edit`, marche `find` puis `write`), sections et ligne « To edit » dans `find` — décidé par JB (source : story E11-S19).
- 2026-10-19 : `find` classe ses nœuds comme `context` classe les procédures — décidé par JB (source : retours d'usage du MCP Démo, session du 19/10/2026).
- 2026-10-19 : `find` liste en une ligne les dix nœuds qui suivent les trois premiers — décidé par JB (source : retours d'usage du MCP Démo, session du 19/10/2026).
- 2026-10-27 : plus d'étapes servies par `context` ; cinq procédures proches, la décidée en tête (« best match ») avec la consigne de la lire par `read` puis de suivre ses étapes — décidé par JB (source : session du 27/10/2026, `context` trop lourd).
- 2026-10-01 : refonte en document de conception vivant, qui reprend ADR-003, les fiches D9 et D43, les choix H37, H40, H43, H44 et ceux des stories E03-S02, E01-S13 et E11-S04 — décidé par Alexis, accord de JB.
