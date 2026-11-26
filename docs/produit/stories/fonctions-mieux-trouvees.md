# Story — Fonctions mieux trouvées : toujours proposées par `context`, classées comme les nœuds, mesurées ; comptes partagés cités

## Meta

| Champ | Valeur |
|-------|--------|
| **Épic** | Trouver et utiliser les connecteurs |
| **Parcours** | 4.2 Faire (routage d'une demande) |
| **Statut** | 🔵 In Progress — codée le 2026-11-25 dans un export de `main`, à relire (revue Module) ; relecture du 25/11/2026 reprise ; questions ouvertes 4, 7 et 9 |
| **Priorité** | Should (après la story « `read` exécute les lectures » et celle des connecteurs trouvés à la volée) |
| **Référence UI** | N/A (aucun écran : textes servis par `context` et `find`) |
| **Conventions** | mcp, supabase, security, testing, registry |
| **Estimation** | M (classement en TypeScript) |
| **Échelle** | Module (≥ 6 fichiers) |
| **Porteuse de migration** | non (classement en TypeScript, en mémoire) |
| **Dépend de** | aucune story ouverte ; à rejouer après « tout connecteur déclaré se trouve à la volée », qui fait grandir le catalogue servi |

## Contexte

Avec les connecteurs, l'assistant a beaucoup de fonctions à trouver : la version épinglée de `@otomata_tech/connectors`
en déclare environ 1 540 sur 63 connecteurs que le paquet accepte (un 64e, `salesforce`, est refusé par cette version
du paquet), dont 140 pour un seul ; un premier hôte en ajoute 78. Avant ce chantier, il trouvait mal la bonne :

- **`context`** ne proposait des fonctions que sans procédure servie (condition `served === null` dans
  `server/context/index.ts` et `!input.served` dans `server/context/blocks/code.ts`) : trois au plus, choisies par mots
  communs, un mot sur quatre et deux mots au moins (`proposedFunctions`, `server/context/hints.ts`).
- **`find`** cherchait les fonctions par le même appariement de mots (`searchFunctions`, `server/catalog/registry.ts`) :
  part des mots de la demande trouvés dans nom, connecteur et description, préfixe dans les deux sens au-delà de trois
  lettres, à score égal par nom ; ni plein texte, ni trigrammes, ni lexique, ni bonus, contrairement aux nœuds.
- Sur « mets à jour mon template Brevo », huit fonctions Brevo faisaient le même score ; le tri par nom plaçait
  `brevo_act.update_template` troisième sur trois. « Modifie mon modèle d'email Brevo » n'a qu'un mot commun : aucune
  proposition.
- **Comptes partagés** : le compte personnel d'un collègue partagé à la personne ne sert que nommé (`chooseAccount`) ;
  `context` ne le citait pas, et disait « no account you can use » à qui pouvait le servir en le nommant. Seul un refus
  de `call` faute de compte le nommait.

Décisions du 25/11/2026 :
- point 3 : la piste 1 d'abord, sans embeddings : des fonctions toujours proposées dans `context`, le même classement
  que les nœuds (plein texte, trigrammes, lexique), puis une mesure sur un jeu de demandes. La piste 2 (embeddings
  fournis par l'hôte, exception à ADR-003) attend le résultat de cette mesure. Le classement se calcule **en TypeScript,
  en mémoire** (le catalogue n'est pas en base) : ni migration, ni table, portable sur un Postgres nu. Le pont du
  français vers l'anglais passera par des **mots-clés français déclarés dans la bibliothèque des connecteurs** (autre
  dépôt) ; ce chantier ne change pas le format de déclaration.
- point 4 : `context` cite aussi les comptes que des collègues ont partagés à la personne. Règle du responsable du
  moteur : ne montrer que ce que l'appelant peut déjà servir (même règle que la liste des comptes), jamais un compte
  privé d'un autre.

### Comment les nœuds sont classés (`docs/conception/routage-et-recherche.md`, `server/routing.ts`)
- `platform.route_candidates(org, query, kind, limit)` (SQL) rend, pour chaque nœud publié lisible, les composantes :
  `s_summary`, `s_title` (trigrammes, `pg_trgm` et `unaccent`), `s_phrase` (meilleure formulation du résumé), `lexical`
  et `lexical_title` (plein texte `platform.fr`, poids des mots rares comptés sur les candidates lisibles),
  `query_lexemes`.
- `blendScore` (TypeScript) : 0,25 × max(résumé, titre) + 0,30 × formulation + 0,45 × lexèmes (0,75 titre et résumé,
  0,25 titre seul), atténué sous deux lexèmes ; `applyBonuses` : +0,03 équipe, +0,03 usage sur 30 jours ; candidat dès
  0,30 (`SHOW_THRESHOLD`).
- Fautes de frappe : `platform.lexicon_fix` corrige un mot de la demande vers le mot le plus proche du lexique de
  l'organisation.

**Périmètre**
- `context` propose des fonctions à chaque demande, procédure servie ou non (trois au plus, sous la ligne du routage).
- Un classement des fonctions aligné sur celui des nœuds, servi à `context` et à `find` (une seule fonction de
  classement pour les deux, `rankFunctions`) : le nom de la fonction joue le titre, la première phrase de la description
  le résumé, la description entière porte les mots.
- Le jeu de mesure des fonctions, sa mesure de départ et sa mesure d'arrivée.
- `context` cite, dans la partie de Tout le monde, les comptes personnels que des collègues ont partagés à la personne.
- Documents révisés : `routage-et-recherche.md` (§ Classement des fonctions, § `find`, § Mesure continue, § Écart avec
  le code, historique), `contexte-servi.md` (ligne des fonctions proposées), `droits-d-acces.md` (§ Partage d'un compte
  de connecteur), `connecteurs-et-comptes.md` (ligne des connecteurs).

**Hors périmètre**
- Les embeddings (piste 2) : rouverts seulement si la mesure reste sous 95 % après calibrage (ADR-003).
- « Modifie mon modèle d'email Brevo » (ancien AC6) et l'objectif de 95 % des demandes directes : reportés au lot « mots-clés
  français » (décision de JB du 25/11/2026), le seul qui relie « modèle » à « template » ; le cas reste au jeu, en
  paraphrase ratée, pour mesurer ce lot.
- Les mots-clés français des connecteurs (autre dépôt) et leur lecture par le classement : la forme est à proposer au
  responsable du moteur (question ouverte 4).
- La visibilité des connecteurs non activés (story « tout connecteur déclaré se trouve à la volée ») ; cette story classe
  ce qui est servi.
- L'exécution par `read` (story « `read` exécute les lectures ») ; si elle est livrée avant, la consigne d'exécution des
  propositions suit son prédicat.

**Refs :**
- Conception : `docs/conception/routage-et-recherche.md` (ADR-003, § Classement des fonctions, § Mesure continue sans
  host), `docs/conception/contexte-servi.md`, `docs/conception/droits-d-acces.md` § Partage d'un compte de connecteur,
  `docs/conception/connecteurs-et-comptes.md` § Catalogue et activation (H80)
- Référence : `docs/reference/mcp-golden-queries.md`

## Critères d'acceptation

Mesure d'abord
- [x] **AC1** **Given** le jeu de mesure des fonctions (AC10) et le code d'avant (`searchFunctions`, `proposedFunctions`)
  **When** la mesure tourne **Then** elle rapporte le taux de bonnes reconnaissances des demandes directes, des
  paraphrases et des négatives ; ce rapport de départ est écrit dans `routage-et-recherche.md` § Écart avec le code.
  Livré : 37 directes sur 65 (56,9 %) dans les trois, 17 au premier rang ; 5 paraphrases sur 18 ; 2 négatives sur 12
  avec une proposition de `context` (11 avec un résultat de `find`, sans seuil).

`context`
- [x] **AC2** **Given** une demande qui sert une procédure (« best match ») **When** `context` **Then** la ligne du
  routage est suivie de trois fonctions au plus qui répondent à la demande, chacune par son nom et la première phrase de
  sa description, sous « Functions close to the request, for what the procedure does not cover (read a contract with
  <p>_read path <function>, run it with <p>_call): » ; la section du guide reste réservée aux demandes sans procédure
  servie (hypothèse). `context` léger compris.
- [x] **AC3** **Given** une demande sans procédure servie **When** `context` **Then** les fonctions proposées viennent du
  nouveau classement, au même format qu'avant (`hintLines`, « Functions that may do it ») ; « créer une tâche » ne
  propose ni `node.export_tree` ni `node.import_tree` (il propose `team.create`, par sa formule française « créer équipe » :
  un faux positif compté dans la mesure).
- [x] **AC4** **Given** une panne de la lecture des connecteurs actifs, ou du classement **When** `context` **Then** il
  répond sans fonctions proposées (panne au log serveur), comme avant ; jamais une fonction inactive ni absente du
  catalogue de l'assistant (`assistantFunctions`, `serverOnly` exclu, surface de l'hôte respectée).

Classement
- [x] **AC5** **Given** le catalogue Brevo actif **When** « mets à jour mon template Brevo » **Then**
  `brevo_act.update_template` est la première fonction proposée par `context` et la première de `find` (par le bonus du
  genre de la demande, gardé en exception provisoire).
- **AC6** : sorti du lot, vers le lot « mots-clés français » (voir Hors périmètre).
- [x] **AC7** **Given** une faute de frappe sur un mot d'une fonction (« tempalte », « invocies ») **When** `find`
  **Then** la fonction est trouvée comme sans la faute, sans que la correction soit affichée (une seule faute de frappe,
  six lettres au moins).
- [x] **AC8** **Given** un nom exact de fonction (`table.rows`) **When** `find` **Then** elle reste en tête avec le
  score 1 (H44, inchangé).
- [x] **AC9** **Given** deux fonctions proches **When** le classement les ordonne **Then** l'ordre est stable et
  documenté : score mêlé, plus 0,03 pour une fonction appelée ou lue par la personne dans les 30 derniers jours (bonus
  d'usage), plus 0,05 pour une fonction de lecture sur une question de données ou pour un verbe de modification sur une
  demande d'édition (`requestKind`), puis le nom servi à score égal ; seuil des fonctions 0,40.

Jeu de mesure
- [x] **AC10** **Given** le jeu `function-routing.cases.ts` **When** le test de mesure tourne sur le catalogue de
  `@otomata_tech/connectors` (version épinglée, tous connecteurs acceptés actifs) plus les fonctions du paquet **Then**
  la mesure est livrée et figée : taux des directes (dans les trois, au premier rang), des paraphrases et des négatives
  imprimés, ratées et négatives bruyantes figées dans le test. L'objectif de 95 % est reporté au lot « mots-clés
  français » (décision de JB). Dernière mesure du test, sur 1 590 fonctions : 59 directes sur 65 (90,8 %), 46 au premier
  rang ; 62 sur 65 si chaque fonction attendue avait été appelée dans les 30 jours ; 4 paraphrases sur 18 ; 3 négatives
  sur 12 avec une proposition (« comment », « créer une tâche », « horaires d'ouverture »).
- [x] **AC11** **Given** `read path functions` sur ce même catalogue **When** il est servi **Then** il tient sous le
  plafond de 45 000 caractères : la liste entière en pesait 219 875 ; au-delà du plafond, un plan par connecteur (5 023
  caractères, données comprises, sur 1 590 fonctions ; le plus gros connecteur lu seul, 24 324), les fonctions de l'hôte
  sur une ligne à son nom, et `read {"path": "functions", "section": "<connecteur>"}` lit un connecteur, un connecteur inconnu refusé
  en `invalid_arguments` ; aucun champ ni description de `read` changé.

Comptes partagés (point 4)
- [x] **AC12** **Given** un collègue qui a partagé à la personne son compte personnel d'un connecteur actif (règle de
  personne, d'équipe ou d'organisation, niveau lecture au moins) **When** `context` **Then** la partie de Tout le monde
  porte, sous « Personal accounts colleagues shared with you (used only when named: pass account: "<label>" in the call;
  ask the user before using one): », une ligne par connecteur : `<connecteur>: « <libellé> » (owner <nom>, <mode>,
  <niveau>)`, sa marque comprise (`, marked: …`), 200 caractères au plus, libellés coupés à 40.
- [x] **AC13** **Given** un compte personnel d'une autre personne qui n'est pas partagé à l'appelant, ou dont la personne
  a quitté l'organisation, ou désactivé, ou le propre compte de l'appelant **When** `context` **Then** il n'y figure pas
  (règle de `listUsableAccounts` : actif, niveau lecture au moins, propriétaire encore membre) ; sans compte partagé, ni
  en-tête ni lecture de l'annuaire.

## Le jeu de mesure

- **Forme** : `tests/unit/function-routing.cases.ts`, à côté de son test (`function-routing.test.ts`, sans base) : un
  tableau de cas `{ phrase, expected, kind, source }`, `kind` ∈ `direct` (doit trouver `expected` dans les trois),
  `paraphrase` (rapportée), `negative` (aucune proposition) ; `expected` est un nom servi. Chaque cas porte sa source
  (`issue`, `écrit`, `journal`), jamais un nom réel ni une donnée d'un client.
- **Contenu au 25/11/2026** : 65 directes sur 22 connecteurs et quatre espaces du paquet (`node`, `comment`, `table`, `member`), 18 paraphrases, 12 négatives ; toutes écrites,
  sauf les deux demandes Brevo (`issue`). Une directe porte les mots de la fonction (nom du service, mot anglais d'usage
  courant, mot de même début) ; la classification a été écrite avant la mesure du nouveau classement.
- **Demandes réelles** : à extraire du journal de production, chaque phrase de `context` suivie dans le même `ctx` d'un
  appel de fonction réussi ; relues et pseudonymisées hors du dépôt (Actions JB), `pnpm check:public` vert.
- **Taux** : `trouvées dans les trois / demandes directes` ; le premier rang est rapporté en plus. Les ratées et les
  négatives bruyantes sont figées dans le test.

## Implémentation

### Fichiers créés
- `packages/plateforme/server/catalog/ranking.ts` : `rankFunctions(functions, phrase, limit, used?)` et `firstSentence`
  (venue de `find.ts`) ; seuil, bonus et lexique y restent privés.
- `tests/unit/function-routing.cases.ts`, `tests/unit/function-routing.test.ts`.

### Fichiers modifiés
- `server/routing.ts` (`usedPaths` exporté ; `rankCandidates` accepte `used`, la lecture du journal déjà faite ; sans lui,
  comportement inchangé : tests du routage identiques).
- `server/nodes/read.ts` (`section` passé à `functionCatalog`) ; `server/find.ts` (`functionCatalog` en plan par connecteur
  au-delà de 45 000 caractères, un connecteur par `section`) ; `docs/reference/mcp-golden-queries.md` (FB1 à FB5, F5).
- `server/context/hints.ts` (`proposedFunctions` sur `rankFunctions` ; `routingHints(db, identity, phrase, { served, used })` :
  le guide sans procédure servie, le bonus d'usage ; panne du classement au log ; `hintLines(hints, prefix, served)`),
  `server/context/index.ts` (les deux chemins de `context`, complet et léger, sans la condition `served === null`),
  `server/context/blocks/code.ts` (les propositions aussi sous une procédure servie).
- `server/find.ts` (`matchFunctions` sur `rankFunctions`, nom exact gardé en tête).
- `server/catalog/registry.ts` (`searchFunctions` gardé pour le seul index des fonctions de l'hôte, `host-api/index-view.ts`).
- `server/connectors/lines.ts` (`sharedWithCaller`, `sharedLines`, champ `shared` de `ConnectorLinesByPart`),
  `server/context/blocks/team.ts` (en-tête et lignes des comptes partagés dans la partie de Tout le monde).
- Tests : `tests/unit/catalog.test.ts`, `tests/unit/aide-plateforme.test.ts`, `tests/unit/find.test.ts`,
  `tests/unit/context-blocks.test.ts`, `tests/integration/partage-des-comptes.test.ts`,
  `tests/integration/context-blocks-sql.test.ts` (doublure de `teamConnectorLines`).

### Migrations prévues
Aucune.

## Rayon d'impact

Commandes lancées dans l'export (`C:/Users/jeanb/.oto-exports/recherche-fonctions`), sans borne de sortie.

### Appelants
- `rg -n "searchFunctions|proposedFunctions|routingHints|hintLines|matchFunctions|FUNCTION_SCORE_MIN|FUNCTION_WORDS_MIN|RoutingHints" packages src tests scripts`
  → production : `packages/plateforme/server/context/hints.ts`, `context/index.ts` (deux chemins), `context/blocks/code.ts`,
  `server/find.ts`, `server/catalog/registry.ts` ; tests : `tests/unit/aide-plateforme.test.ts`,
  `tests/unit/catalog.test.ts`. Aucun appelant dans `src/` ni `scripts/` ; `searchFunctions` n'est pas exporté par la face
  `server` (`rg -n "searchFunctions" packages/plateforme/server/index.ts` : rien). Ce qui change : les deux chemins de
  `context` proposent avec ou sans procédure servie ; `find` prend le nouveau classement ; les assertions de
  `catalog.test.ts` se rejouent sur `rankFunctions`.
- `rg -n "firstSentence" packages src tests scripts` → `find.ts` (définition, trois usages), `context/hints.ts` (import
  de `../find`), `context/blocks/contexts.ts` (une fonction homonyme privée, sans lien). Déplacée dans `ranking.ts`,
  réexportée par `find.ts` : aucun importeur ne change.
- `rg -n "teamConnectorLines|connectorLines|connectorOutlook|teamFacts|TeamFacts|ConnectorLinesByPart" packages src tests scripts`
  → production : `connectors/lines.ts`, `context/blocks/team.ts`, `context/index.ts` ; tests :
  `tests/unit/connectors-context.test.ts`, `tests/unit/context-blocks.test.ts`, `tests/unit/e05s13-equipes.test.ts`,
  `tests/integration/etat-des-comptes.test.ts`, et la doublure de `tests/integration/context-blocks-sql.test.ts`, qui
  rendait l'ancienne forme (`{ everyone, teams }`) et passait le type-check : complétée de `shared: []`.
- `rg -n "listUsableAccounts" packages src tests` → la règle reprise pour les comptes partagés ; inchangée.
- Score des fonctions de `find` : `functions[].score` en données change de sens (part de mots → score mêlé) ; aucun
  lecteur dans le paquet.

### Doublons
- `rg -n "pg_trgm|word_similarity|trigram" packages/plateforme/server src --glob '*.ts'` → aucun calcul de trigrammes en
  TypeScript avant `ranking.ts` (tout est en SQL : `route_candidates`, `search_content`, `lexicon_fix`). Verdict :
  **réutiliser** `blendScore`, `SHOW_THRESHOLD`, `requestKind` et le type `Components` de `server/routing.ts` ; **ne pas
  réutiliser** `route_candidates`, qui lit `platform.nodes` et ne voit pas les fonctions.
- `sameWord` (privée, `server/routing.ts`, règle des cinq premières lettres de `wordsInCommon`) : recopiée dans
  `ranking.ts` avec la règle de préfixe de l'ancien `searchFunctions` ; l'exporter demanderait de toucher `routing.ts`
  (refacto proposé ci-dessous).
- `rg -n "othersPersonal|ownerLeft !== true" packages/plateforme/server` → le filtre des comptes partagés existe dans
  `chooseAccount` (`resolution.ts`, au niveau de la classe de la fonction) et dans `listUsableAccounts` (`accounts.ts`,
  tous les comptes visibles). Verdict : **laisser** ; `sharedWithCaller` reprend la règle de `listUsableAccounts` (niveau
  lecture), restreinte aux comptes personnels d'autres personnes.
- `rg -n -i "stop_?words|mots vides" packages/plateforme/server src --glob '*.ts'` → aucune liste de mots vides en
  TypeScript (la liste `french` vit dans Postgres). Verdict : liste fermée nouvelle dans `ranking.ts`.

### Effet produit
- Surface MCP figée (ADR-002) : aucun outil, champ ni description changé ; la description de `find` promet « up to
  three functions, each with a score » et reste vraie. Le texte de `context` gagne au plus quatre lignes à une demande
  servie (plafond de 35 000 caractères non menacé) et, pour qui a des comptes partagés, un en-tête et une ligne par
  connecteur dans la partie de Tout le monde.
- `find` : moins de fonctions faibles (seuil des fonctions, 0,40), score mêlé ; `read path functions` en plan au-delà de
  45 000 caractères.
- Journal : `context` le lit une fois au lieu de deux (procédures et contenus proches partagent la lecture avec les
  fonctions) ; `find` sans `type` une fois, comme avant ; `find` de `type: "function"` ne le lit pas.
- Schéma `platform`, RLS, migrations : rien. Connecteurs et coffre : rien ; une lecture de plus de l'annuaire
  (`memberDirectory`) dans `context`, seulement quand un compte partagé existe.
- Hôte : rien à monter ; la face `server` publique ne change pas.
- Temps : le classement prend environ 40 à 80 ms sur 1 500 à 1 600 fonctions (jusqu'à 200 ms à la première demande d'une
  instance) ; une organisation n'en active qu'une partie.
- Golden queries FB1 à FB5 à rejouer sur les hosts (`docs/reference/mcp-golden-queries.md`).

### Refacto
- Fait : `usedPaths` exporté de `server/routing.ts` et partagé (bonus d'usage des fonctions, une lecture du journal de
  moins par `context`). Laissé : `sameWord`, privée à `routing.ts` et de règle différente (sans le préfixe de quatre
  lettres) ; `ranking.ts` garde sa propre règle.
- Option d'un cran plus simple écartée : garder `searchFunctions` (part des mots trouvés) et n'y ajouter que le bonus du
  genre de la demande. Elle faisait passer AC5, mais ne corrigeait ni les égalités de score (huit fonctions Brevo au même
  score), ni les fautes de frappe (AC7), ni le bruit d'un seul mot rare, et `context` et `find` n'auraient pas classé comme
  les nœuds, la décision du 25/11/2026 ; mesurée, elle restait à 37 directes sur 65 dans les trois.
- Écarté : un module de classement commun aux nœuds et aux fonctions qui sortirait le mélange de `routing.ts` ;
  `blendScore` est importé tel quel, avec des composantes calculées autrement.

## Tests

Au minimum vital (`.method/conventions/testing-strategy.md § Budget de tests`).
- `tests/unit/function-routing.test.ts` : la mesure en un seul test, ratées et négatives bruyantes figées, AC5, taux et
  poids de `read path functions` imprimés (AC1, AC5, AC10, AC11).
- `tests/unit/catalog.test.ts` : la table de cas de `rankFunctions` (AC7, AC9), le bonus d'usage, deux fonctions de même
  texte reçues dans les deux ordres (AC9).
- `tests/unit/aide-plateforme.test.ts` : « créer une tâche » (AC3) ; le classement qui lève (AC4).
- `tests/unit/context-blocks.test.ts` : la ligne des fonctions sous une procédure servie (AC2) ; `routingHints` avec et
  sans procédure servie, et en panne de lecture des connecteurs actifs (AC2, AC4).
- `tests/unit/find.test.ts` : nom exact en tête (AC8, inchangé), fonctions au-dessus du seuil.
- `tests/integration/partage-des-comptes.test.ts` : comptes partagés cités, jamais un compte non partagé, ni le sien, ni
  celui d'une personne partie, ni un compte désactivé, la marque dans la ligne ; sans compte partagé, aucune lecture de
  l'annuaire (AC12, AC13).
- `tests/unit/nodes-read.test.ts` : le plan de `read functions`, un connecteur par `section`, l'API de l'hôte par son nom
  (AC11).

## Actions JB
- Extraire du journal de production les couples (demande de `context`, fonction appelée ensuite dans le même `ctx`),
  les relire et les pseudonymiser hors du dépôt, pour compléter le jeu de mesure.
- Trancher les questions ouvertes 4, 7 et 9.

## Questions tranchées
1. **Où se calcule le classement** : en TypeScript, sur le catalogue en mémoire (décision du 25/11/2026). Écartés : une
   fonction SQL qui recevrait les textes à chaque appel ; une table tenue depuis la déclaration.
2. **Le pont français-anglais** : par des mots-clés français déclarés dans la bibliothèque des connecteurs (décision du
   25/11/2026) ; l'ancien AC6 part avec ces mots-clés.
3. **Seuil de proposition** : 0,40 pour les fonctions, partout, sous une procédure servie aussi (JB, 25/11/2026). Pour ne
   pas reculer sur « exporte toutes les pages de l'équipe SAV » et « déplacer renommer dossier », les formules françaises
   « In French: … » des descriptions du paquet comptent comme formulations, et celles de `node.export_tree` et `node.move`
   sont précisées.
5. **Bonus du genre de la demande** : gardé, exception provisoire au « aucun dictionnaire de vocabulaire » jusqu'aux
   mots-clés français (JB, 25/11/2026).
6. **Bonus d'usage des fonctions** : livré, sur la lecture du journal du routage faite une fois par `context` (deux avant)
   et par `find` ; `find` de `type: "function"` ne lit pas le journal (JB, 25/11/2026).
8. **`read path functions`** : paginé par connecteur dans ce lot, par le champ `section` existant (JB, 25/11/2026).

## Questions ouvertes

4. **Forme des mots-clés français** à proposer au responsable du moteur : par exemple un champ `keywords` (liste de
   mots ou de courtes formules françaises) sur la fonction et sur le connecteur, lu par le classement comme les mots de
   la description, et compté dans le titre quand il nomme l'action. Le format de déclaration n'a pas été changé.
7. **Sous l'objectif de 95 %** : rouvrir la piste 2 (embeddings fournis par l'hôte) maintenant, ou après les mots-clés
   et un jeu complété de demandes relevées au journal ?
9. **Le score des fonctions de `find`** change de sens : le dire dans la description de `find` (allongement permis), ou
   dans `docs/reference/` seulement ?

## Post-implémentation

### Écarts avec la conception
- `routage-et-recherche.md` révisé (§ Classement des fonctions, § `find`, § Mesure continue, § Écart avec le code,
  historique), `contexte-servi.md`, `droits-d-acces.md` (§ Partage d'un compte de connecteur), `noeuds-et-arbre.md` (P22),
  `connecteurs-et-comptes.md` (ligne des connecteurs).
- Écart assumé : le bonus du genre de la demande est une liste fermée de verbes anglais, exception provisoire au « aucun
  dictionnaire de vocabulaire » du routage, jusqu'aux mots-clés français.

### Composants créés
| Composant/Hook/Action | Path | Notes |
|----------------------|------|-------|
| rankFunctions, firstSentence | `packages/plateforme/server/catalog/ranking.ts` | Classement des fonctions de `context` et `find` ; lexique par catalogue servi |
| usedPaths (exporté), `used` de rankCandidates | `packages/plateforme/server/routing.ts` | Une lecture du journal par `context` |
| sharedWithCaller, sharedLines (privés), `shared` | `packages/plateforme/server/connectors/lines.ts` | Comptes partagés cités par `context` |

### Notes
- **Dette suivie** : `searchFunctions` (`server/catalog/registry.ts`) reste pour le seul index des fonctions de l'hôte
  (`host-api/index-view.ts`, « Closest to the request » du bloc de `context`). Sans lui, ce bloc ne compile plus et ne
  montre plus les fonctions de l'hôte proches de la demande. Proposition à porter au responsable du moteur : basculer cet
  index sur `rankFunctions`, avec son seuil, et retirer `searchFunctions`.
- Point 11 de la relecture du 25/11/2026, laissé en l'état (décision de JB) : une erreur hors base de `usedPaths` (configuration, bogue) remonte désormais et fait échouer `find` et `context` (`find.ts`, `hints.ts`), alors qu'avant le `catch` du classement l'absorbait.
- Point 15, laissé en l'état (décision de JB) : aucun test de temps sur une demande de 500 caractères (la plus longue lue) ; le coût est borné par `QUERY_MAX_CHARS`.
- Les formules françaises « In French: … » des descriptions du paquet comptent comme formulations ; celles de
  `node.export_tree` et `node.move` ont été précisées pour garder leurs demandes documentées au-dessus du seuil.
