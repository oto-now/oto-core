# Story : contexte plus court, procédures et outils plus faciles à trouver

- **Statut** : proposée par JB le 26/11/2026, à répartir avec le responsable du moteur
- **Conventions** : mcp, testing
- **Référence UI** : N/A (seule la phrase de l'écran « Brancher » change)

## Contexte

Deux ratés de découverte sont remontés le 26/11.
- **Un connecteur ignoré** : France Open Data, ouvert par défaut, n'apparaît dans aucun texte que l'assistant lit. Il n'est trouvé que si on nomme l'outil avec Oto.
- **Une procédure jamais proposée** : « Cahier des charges communication ». La demande « <produit> com produit » score sous 0,30. Or `context` ne liste plus toutes les procédures depuis le 27/10, et aucune n'a donc été montrée.

Par ailleurs, les règles servies (3 750 caractères) répètent des descriptions d'outils, et les lignes de routage portent un score et des « words in common » destinés à l'auteur, pas à l'assistant.

## Critères d'acceptation

### Ce que l'assistant lit pour décider d'appeler Oto

- **AC1** — La description de `context` cite, après les domaines de travail, les noms des connecteurs que l'organisation utilise : six environ, les plus appelés sur 30 jours, sinon les adoptés. Elle ne cite jamais le catalogue entier. C'est une description qui s'allonge d'un domaine, comme le permet ADR-002.
- **AC2** — La phrase de préférences de l'écran « Brancher » (`preferenceSentence`, `server/connect.ts`) devient, décidée par JB après le retour d'un utilisateur qui ne comprenait ni « outils » ni « mon travail » :

  > Au début de chaque conversation, charge le contexte de mon Oto « X » avec son outil context.
  > Dans « X », tu peux : suivre nos procédures, lire et écrire nos pages et tableaux, utiliser nos connecteurs (emails, comptabilité, CRM…).
  > Réflexes : cherche d'abord dans « X » avant de répondre de mémoire, de chercher sur le web ou de dire que tu ne peux pas ; suis la procédure trouvée pas à pas.
  > Si j'ai plusieurs Oto, charge seulement celui que la demande concerne.

  Le mot « espace » n'y apparaît pas (décision de JB du 26/11 : « mon Oto « X » », « plusieurs Oto »).

  La note de l'écran qui dit de ne pas coller la phrase quand on a plusieurs connecteurs d'organisation part : la dernière ligne de la phrase couvre désormais ce cas.

### Les règles servies (bloc A)

- **AC3** — Les règles en double avec une description d'outil sont retirées : la ligne « <p>_write publishes at once… base_revision » et la ligne « A function that sends, deletes or pays… ». La ligne des six outils se réduit à l'ordre habituel.
- **AC4** — Une règle des outils de l'organisation : ils sont listés plus bas ; un outil absent peut exister, il faut donc le chercher avec find avant de dire non ou de chercher sur le web ; un outil pas encore connecté se connecte par le lien de `connector.connect`.
- **AC5** — La règle d'une procédure dit :
  - **le titre** est l'action dans les mots de ceux qui la demandent (un verbe et un objet), jamais le nom d'un livrable seul ;
  - **le résumé** dit ce qu'elle fait, puis trois à cinq façons dont on la demande, abréviations comprises.

  Les deux lignes sur l'écriture d'une bonne procédure ne sont servies qu'avec une demande d'en écrire une, ce que fait déjà l'aide du routage. Le contrat `write.procedure` redit la règle du titre et du résumé. `node.check` signale une procédure dont le résumé ne donne aucune façon de la demander.

### La demande (bloc B)

- **AC6** — Un index des procédures : le titre et le chemin de chaque procédure publiée que la personne lit, une ligne chacune, 40 au plus, les plus utilisées d'abord. Il est servi à chaque `context` complet, sans résumé ni score. Les procédures proches restent au-dessus, avec leur résumé.
- **AC7** — Les lignes des procédures et des contenus proches perdent le score et les mots en commun. Ceux-ci restent dans les données (`candidates`) et dans l'aperçu de l'auteur.

### Les outils (bloc C)

- **AC8** — Le bloc des fonctions de l'hôte devient « ce que vous pouvez utiliser ». Il n'est jamais coupé, donc chacune de ses parties a sa borne.
  - **Les fonctions de l'ERP**, comme aujourd'hui : l'index par famille, 3 000 caractères au plus (`HOST_INDEX_MAX`), 600 par famille. Au-delà, l'index le dit et renvoie à `read path functions`. Un ERP de 100 fonctions tient donc dans ces 3 000 caractères.
  - **Les connecteurs**, 15 au plus, une ligne chacun, sans texte rédigé pour l'occasion : le libellé de sa déclaration (`label`), la première phrase de sa description déclarée, coupée à 120 caractères, et son état pour la personne (« connecté », « partagé par <nom> », « à connecter »). Ils sont pris parmi les plus appelés sur 30 jours, puis les adoptés ; au-delà, une ligne « et N autres : find ».
  - **Les lignes de connecteurs** de la partie « Tout le monde » et des lignes d'équipe en partent, avec leur jargon (`live`, `simulated`, `(write)`).

### Le budget

- **AC9** — Les contenus récents passent de 20 lignes à 10, avec le titre et la date ; `read path journal` donne le reste.
- **AC9 bis** — Un résumé servi par `context` est coupé à sa première phrase, 160 caractères au plus. Cela vaut pour les procédures et contenus proches, les enfants d'un Contexte, la vue invité et les contenus récents. Le résumé entier reste lisible par `read`.
- **AC9 ter** — Sous un Contexte, une procédure enfant est listée par son seul titre : l'index de l'AC6 la porte déjà. Les listes d'enfants passent de 20 à 15 lignes.
- **AC9 quater** — La vue invité (« Shared with you by other teams »), jamais coupée par le budget, reçoit une borne : 25 points d'entrée au plus (décision de JB : « 20/30 max »), toutes équipes comprises, ses paliers de taille retirés, puis la ligne « and N more shared with you: search them with <p>_find and the words of what you need. ». Sa consigne dit « you read only what they shared with you, whether listed here or not ».
- **AC9 quinquies** — Le `context` léger (`since_ctx`) ne redonne ni l'index des procédures ni le bloc des outils, déjà dans la conversation. Il ne les redonne que s'ils ont changé.
- **AC10** — La mesure : l'aperçu d'une organisation de référence, avec et sans demande, est relevé avant et après. Le total ne dépasse pas l'actuel, malgré l'index et les connecteurs ajoutés.

### Les ratés du 26/11 rejoués

- **AC11** — « <produit> com produit » sert « Cahier des charges communication » dans l'index. « des données publiques sur une commune » cite France Open Data dans le bloc des outils. La description de `context` le nomme dès qu'il a été appelé.

## Hors périmètre

- Les embeddings (piste 2) : ils reviendront quand l'index ne tiendra plus, au-delà d'une centaine de procédures.
- Une formulation apprise d'un raté, et les mots-clés français : un autre chantier du moteur.
- Le renommage `read`/`call` vers `query`/`act` : le point 1, qui devra reprendre les règles, les descriptions, le guide et la règle servie.

## Rayon d'impact

Lot « règles, lignes de routage, budget » (AC2, AC3, AC4, AC5, AC7, AC9, AC9 bis, AC9 quater) ; le lot du moteur (AC1, AC6, AC8, AC9 ter, AC9 quinquies, `node.check`) écrit le sien.

1. **Appelants** (recherches lancées à la racine du dépôt, sans borne de sortie) :
   - `grep -rn "preferenceSentence" packages src tests docs` : `server/connect.ts`, `src/lib/plateforme/connexion.ts` (transmet, inchangé), `tests/integration/components/ecran-connexion.test.tsx`, `docs/exploitation/guide-installation.md`, `docs/produit/prd.md`, `.method/conventions/mcp-patterns.md` § 9.
   - `grep -rn "WORKSPACE_RULES\|workspaceRules\|SERVED_RULES" packages src tests` : `blocks/code.ts`, `tests/integration/{mcp-core,server-ctx}.test.ts`, `tests/unit/{context-blocks,texte-servi}.test.ts` ; aucun écran ne traduit les règles.
   - `grep -rn "SERVED_RELATED\|otherLine" packages src tests` : `find.ts` (lignes suivantes, gardent leur score), `blocks/related.ts`, `ui/contexte/parties-du-contexte.ts` (`ligneProche`, qui lisait le score dans le texte), `tests/unit/texte-servi.test.ts`.
   - `grep -rn "recentDocuments\|RECENT_MAX\|ACTIVATIONS_MAX" packages src tests` : la liste de « @ » de l'éditeur (`api/search.ts`) lit `recentDocuments` : elle garde 20 documents.
   - `grep -rn "GUEST_SUMMARY_MAX\|GUESTS_FULL_MAX\|guestsText\|countOne\|countMany" packages src tests docs` : `blocks/guests.ts`, `schemas/context-index.ts`, `ui/contexte/parties-du-contexte.ts`, `tests/unit/{context-guests,texte-servi}.test.ts`, `tests/integration/vue-invite.test.ts`, `docs/produit/stories/vue-invite.md`.
   - `grep -rn "previewContext\|DonneesDeLApercu" src packages/plateforme/ui tests` : pages `/context`, `/n/…` et Organisation de l'hôte ; doublures de `tests/integration/pages/{contexte-page,noeud-page}.test.tsx` (les champs nouveaux sont facultatifs : elles restent valides).
   - `grep -rln "words in common\|best match;\|steps are served" tests docs` : `context-blocks`, `routing`, `context-engine`, `mcp-golden-queries.md` (C7), `routage-et-recherche.md`, `outils-mcp.md` (HN-E11S19-5).
2. **Doublons** : `grep -rn "firstSentence\|SUMMARY_MAX" packages/plateforme/server` : la coupe d'une première phrase de `blocks/contexts.ts` est réutilisée et exportée (`servedSentence`) ; `firstSentence` de `find.ts` (phrase d'une fonction, finie par un point) a un autre rôle, laissé ; `shortened` de `guests.ts` (coupe à 100) retiré avec les paliers. Registre : aucun utilitaire de coupe servie.
3. **Effet produit** : le texte servi à tous les hosts (règles, routage, contenus proches, récents, vue invité) ; la liste d'outils MCP inchangée (aucune description d'outil touchée) ; l'écran « Brancher » (phrase) ; l'écran « Contexte » (score et mots lus dans les données de l'aperçu) ; `ContextPreview` gagne deux champs facultatifs (un hôte qui le double reste valide) ; `SERVED_GUESTS` perd `cutMark`, `countOne`, `countMany`, `countEnd` (paquet public, dit au changelog) ; aucune table, policy ni migration.
4. **Refacto** : écarté. Passer le moteur de blocs à un rendu par ligne commun aurait unifié les coupes ; une seule fonction (`servedSentence`) suffit.

## Post-implémentation

**AC livrés** : AC2, AC3, AC4, AC5 (sans `node.check`), AC7, AC9, AC9 bis, AC9 quater. **Restants** (lot du moteur) : AC1, AC6, AC8, AC9 ter, AC9 quinquies, `node.check` ; AC10 mesuré seulement (aperçu d'une organisation de référence, sans l'index ni les connecteurs : 12 006 → 7 183 caractères sans demande, 15 271 → 8 431 avec) ; AC11 à rejouer quand AC1, AC6 et AC8 seront livrés.

Surfaces nouvelles, ce qui casse sans elles, et l'option d'un cran plus simple écartée :
- **`servedSentence`** (`blocks/contexts.ts`) : sans elle, chaque bloc recoupe un résumé à sa façon (AC9 bis veut une seule règle). Écarté : la coupe en ligne dans chaque bloc (quatre copies).
- **`RECENT_LINES_MAX`** (`blocks/recent.ts`, non exporté) : sans elle, borner le bloc à 10 bornerait aussi la liste de « @ » de l'éditeur. Écarté : `RECENT_MAX` à 10 pour tous (change un écran que la story ne vise pas).
- **`GUESTS_MAX`** et **`SERVED_GUESTS.moreStart` / `moreMiddle` / `moreEnd`** : sans eux, la vue invité n'a pas de borne et l'écran ne sait pas relire la dernière ligne. Écarté : la ligne en dur dans `guests.ts` (l'écran la recopierait).
- **`CONNECT_RULE` et le marqueur `<connect>`** dans `WORKSPACE_RULES` : sans eux, la règle citerait `connector.connect` chez un hôte qui ne le sert pas, et l'assistant l'appellerait pour un refus. Écarté : citer `connector.connect` toujours (faux chez un tel hôte), ou deux textes de règles entiers (une règle écrite deux fois).
- **`otherLine(…, { score })`** (`find.ts`) : sans l'option, les contenus proches de `context` portent le score que `find` garde. Écarté : une seconde fonction de ligne dans `related.ts` (copie de la coupe et des séparateurs de `find`).
- **`ContextPreview.related` et `candidates[].words`**, **`DonneesDeLApercu.related` / `words`**, **`auteursDesProches`**, **`LigneServie.auteur`** : sans eux, l'auteur ne voit plus ni score ni mots en commun, le texte servi ne les portant plus. Écarté : laisser le score dans le texte servi des contenus proches (contraire à la décision de JB).
