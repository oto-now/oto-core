# Tableaux

- **Statut** : proposé
- **Dernière révision** : 2026-10-19

## Résumé

Un tableau est un nœud `table` dont l'en-tête typé vit dans `nodes.meta` et dont chaque ligne est un bloc `row` publié, à clé unique. Les assistants le lisent et l'écrivent par les fonctions `table.*` derrière `call`, les écrans par la grille ; un CSV s'importe en tableau et s'exporte, sans que le CSV soit un type de contenu. La réservation des lignes, la preuve et la revue sont dans [file de travail et revue](file-de-travail-et-revue.md).

## Contexte

Les équipes tiennent des listes (prospects, devis, fiches) qu'un assistant doit lire, compléter et filtrer sans réécrire une page. La règle « une ligne de tableau est un bloc » vient d'ADR-011 ([pages et blocs](pages-et-blocs.md), [nœuds et arbre](noeuds-et-arbre.md)). Oto exposait dix-huit outils `data_*`, des sentinelles (`@keep`, `@empty`, `@clear`), un `null` qui efface et deux formes de lecture : la plateforme n'a que des fonctions `table.*`, une seule forme de ligne et refuse `null` ([vue d'ensemble](vue-d-ensemble.md)). Les retours de la démo (FB-0001 à FB-0010) ont ajouté la création sans écrasement, la colonne strictement obligatoire et la recherche par mots (D132).

## Objectifs et non-objectifs

- Une ligne lue a la forme d'une ligne écrite ; chaque cellule dit d'où vient sa valeur.
- Un assistant n'écrase jamais une ligne sans le savoir, et ne détruit rien sans que le compte rendu le nomme.
- Un CSV entre en un geste, à l'écran comme par un assistant, et ressort tel qu'il se relit.
- Hors objectif : l'historique des valeurs d'une cellule (une table de versions de lignes, plus tard) ; une clé auto-incrémentée (FB-0001 : `create_only` seul, D132) ; l'import de fichiers Excel (`.xlsx`) : un CSV exporté d'Excel suffit ; l'export en flux (plus tard).

## Conception

### En-tête et colonnes

- H91 : l'en-tête vit dans `nodes.meta` : colonnes, colonne `key` (la clé de chaque ligne), cycle de vie facultatif (états, état de travail, revue) et `closed`, qui refuse les lignes nouvelles ; l'en-tête en attente vit dans `node_drafts.meta`. Il se crée et évolue par `write`, comme toute page (E07-S04).
- H90 : une colonne a l'un des huit types `text`, `number`, `date`, `datetime`, `bool`, `enum`, `email`, `url`, et les seules contraintes `required`, `max_length`, `options` ; un attribut inconnu est refusé. E07-S04 N1 : un attribut, une clé ou un type inconnus dans un patch d'en-tête sont refusés par sa forme stricte (clés citées 20 au plus) ; à la création, le refus porte le cadre « Invalid table header: … Contract: … ».
- E07-S01 N1 : `key` nomme une colonne déclarée `text`, `email`, `url` ou `number`, implicitement requise ; sa valeur en texte est la clé de ligne (`blocks.key`, unique par tableau), aussi rangée dans `data`, servie typée dans `key` et dans `set`. HN-E10S01-29 : une colonne `date` peut aussi porter la clé (décision de JB, FB-0014, 1.1.3) ; `KEY_COLUMN_TYPES` (`schemas/tables.ts`) est la seule liste, lue par l'en-tête, la clé proposée et l'écran d'import ; `datetime` ne porte pas la clé.
- E07-S01 N2 : une colonne texte sans `max_length` tient 2 000 caractères au plus ; `max_length` va jusqu'à 10 000.
- HN-E11S01-3 : l'attribut de colonne `allow_verified_empty` (défaut `true`) vaut pour toute colonne ; « obligatoire strict » = `required: true` et `allow_verified_empty: false` (D132). HN-E11S01-24 : dans `table.schema`, la clé et la colonne d'état se disent `required` seul, `verified_empty` y étant toujours refusé. HN-E11S01-25 : publier `allow_verified_empty: false` sur une colonne déjà requise avertit (`missing_required`) des seules lignes qui n'y ont qu'un `verified_empty` ; une colonne rendue requise et stricte d'un coup avertit de toute ligne sans vraie valeur.
- HN-E11S01-23 : la description de `required` du patch d'en-tête (`tableColumnPatchSchema`) reprend celle du schéma de colonne, avec son exemple et son défaut (« e.g. true (default: unchanged; false for a new column) »).
- P24 : la clé d'un tableau ne change que s'il est vide ; une colonne qui a des valeurs ne se renomme ni ne change de type ; une procédure tient en 12 000 caractères rendus ; un brouillon n'est servi qu'à partir du niveau écriture.
- E07-S04 N6 : une ligne que la purge des colonnes retirées ne peut écrire (changée trois fois, panne) ne fait pas échouer la publication, déjà faite : journalisée, dite en avertissement `not_purged`, purgée si la colonne revient.
- E07-S01 N13 : un tableau sans en-tête publié rend `conflict` ; un en-tête publié ou en attente invalide rend `internal`, le problème au log du serveur.
- HN-E11S01-9 : la révision servie par `table.schema` est celle du nœud publié, celle que `write` attend en `base_revision`. E07-S01 N15 : le contrat d'un tableau (`read`, `table.schema`) ne cite `table.write`, `table.claim` ou `table.release` que s'ils sont au catalogue.

### Lire : `table.rows`, `table.aggregate`, `read`

- H93 : une ligne lue a la forme de l'écriture : `{key, revision, set, verified_empty, provenance?, claim?}` ; `set` ne sert que les colonnes déclarées, et jamais de `null` : une colonne sans valeur est absente. E07-S01 N16 : une ligne lue est un bloc `row` publié du tableau ; ses cellules sont les colonnes déclarées de l'en-tête publié qui ont une valeur, jamais une clé de `data` hors en-tête ni un `null` rangé.
- H96 : `table.rows` rend 20 lignes par défaut, 50 au plus, avec un curseur opaque, un tri selon le type déclaré, une recherche `q` par mots (chaque mot, sans casse ni accent, dans une cellule cherchable, en tout ordre : `queryWords`, E11-S01 ; avec `match: "any"`, au moins un mot, les lignes classées au nombre de mots trouvés, `sort` départageant, le défaut restant chaque mot, E11-S19) et le compte au même filtre. HN-E11S01-4 : un mot de `q` se découpe sur ce qui n'est ni lettre ni chiffre, après `normalizeTitle`, et se cherche en sous-chaîne ; aucune borne du nombre de mots au-delà des 200 caractères de `q`.
- H95 : une grammaire de filtre pour `rows`, `aggregate` et `claim` : `{col: valeur}` ou `{col: {op: valeur}}` (`eq`, `ne`, `contains`, `in`, `gt`, `gte`, `lt`, `lte`, `empty`, `not_empty`), 30 clauses au plus ; `in: []`, `null`, colonne inconnue refusés.
- E07-S01 N3 : filtres sans casse ni accent sur `text`, `email`, `url`, `enum`, exacts et typés ailleurs ; `gt` à `lte` sur `number`, `date`, `datetime` ; `contains` sur le texte ; `empty` et `not_empty` prennent `true` ; `in` de 1 à 100 valeurs. E07-S01 N4 : une valeur de filtre est typée par sa colonne : une chaîne pour un nombre, `"true"` pour un booléen sont refusées avec la forme attendue.
- E07-S01 N5 : tri par une clé `{ column, direction }`, typé, texte naturel sans casse ni accent, valeurs hors type puis vides en dernier ; par défaut, clé croissante en ordre naturel.
- E07-S01 N6 : filtre, `q`, tri et agrégats se calculent dans le service sur 5 000 lignes au plus, lues par pages de 1 000 ; au-delà, `too_large`, et les pages sans eux sont servies par la base dans l'ordre de `key`.
- E07-S01 N7 : le curseur est opaque : position et empreinte de la requête (`filter`, `q`, `sort`) ; rejoué sur une autre requête, il est refusé.
- E07-S01 N11 : une page de lignes se coupe sur une frontière de ligne dès 16 000 caractères sérialisés, avec `next_cursor` ; une ligne seule trop grande rend `too_large`, qui propose la projection ; les agrégats se coupent de même. E07-S01 N25 : en plus, les lignes du texte d'une page tiennent en 22 000 caractères sérialisés ; la ligne d'un bail expiré porte « (lease expired) » après son JSON.
- H97 : `table.aggregate` compte, et fait somme, moyenne, minimum et maximum des colonnes nombre, groupé par une colonne ou en totaux, sous un filtre `where`, 1 000 groupes au plus. E07-S01 N10 : `metrics` `[{ op, column? }]`, `count` par défaut ; un groupe sans valeur est `{ empty: true }` ; la moyenne a deux décimales. E07-S01 N23 : `count` d'une colonne compte ses cellules renseignées ; `sum` sans nombre vaut 0, `avg`, `min`, `max` sont absents ; à effectif égal, groupes en ordre naturel, sans valeur en dernier ; chaque valeur de groupe est citée en JSON.
- E07-S01 N30 : bornes : `metrics` de 1 à 10, `columns` de 1 à 100, `cursor` de 4 000 caractères ; une valeur citée dans un refus est coupée à 50 caractères ; le contrat cite la longueur que `valueProblem` accepte (254 pour un email, 2 000 pour une URL).
- E07-S01 N9 : `by` (provenance, bail) est servi comme le nom du membre, « former member » s'il n'est plus membre.

### Écrire : `table.write`

- H92 : `table.write` écrit 50 lignes au plus, `{key, revision?, set, clear, verified_empty}`, chaque ligne atomique et rapportée ; `null` refuse sa ligne ; `create_only: true` refuse (`conflict`) une clé qui existe déjà, avec la ligne telle qu'elle est, sans rien écrire pour elle ; dans un tableau `proof: true`, une valeur nouvelle exige sa preuve `{value, comment | link}`, sinon tout l'appel est refusé ; sans `proof`, elle s'écrit nue (D133, détail dans [file de travail et revue](file-de-travail-et-revue.md)).
- HN-E11S01-1 : `create_only` est un indicateur par appel, pas par ligne. HN-E11S01-2 : `create_only` avec `revision` sur une ligne est refusé au schéma ; une valeur nue d'un appel `create_only` suit la règle de l'appel entier (`withoutBareValues`), jugée avant tout.
- E07-S02 N1 et D49 : une ligne est atomique : un seul problème, un `null` compris, la refuse entière avec la consigne de la corriger, et rien n'est écrit pour elle ; les autres lignes du lot s'écrivent. E07-S02 N22 : un commentaire trop long, un lien hors `http(s)` ou une raison de moins de 3 caractères sont refusés par le schéma pour tout l'appel, au chemin exact ; un `null` passe le schéma et ne refuse que sa ligne.
- E07-S02 N19 : une clé est normalisée avant tout : espaces de bord retirés, caractère de contrôle refusé, clé `number` rangée en texte canonique (`String(n)`) depuis un nombre fini ou son écriture décimale ; puis `blockKeySchema`, 200 caractères au plus.
- E07-S02 N2 : une écriture sans `revision` qui croise une autre est relue et réappliquée deux fois au plus ; avec `revision`, elle est gardée par la révision lue. E07-S02 N3 : deux créations concurrentes d'une même clé donnent un seul bloc `row` : la violation d'unicité `23505` est relue puis appliquée comme une mise à jour, jamais par upsert.
- H100 : chaque ligne a sa révision, 1 à l'insertion, posée par la base ; elle avance quand les valeurs, le bail ou l'état changent, jamais sur une écriture sans effet. E07-S02 N26 : une ligne refusée porte `code` (`invalid_arguments`, `stale_revision`, `conflict`) ; une écriture avec `revision` sur une clé sans ligne, ou relue sur une autre révision, rend `stale_revision`, journalisée.
- E07-S02 N8 : le `comment` d'une cellule fait 1 000 caractères au plus ; son `link` est une URL `http(s)` de 2 000 caractères au plus.
- E07-S02 N15 : le compte rendu nomme chaque valeur détruite : écrasée (avant → après), vidée (ancienne valeur), remplacée par `verified_empty` (ancienne valeur).
- E07-S02 N20 : chaque fonction `table.*` rend dans son `FunctionOutput` le `teamId` de l'équipe propriétaire effective du tableau résolu, alias compris, que `call` journalise.

### Provenance

- H94 : chaque cellule porte sa provenance (`origin`, `by`, `ctx?`, `at`, `comment?`, `link?`, `imported?`, `host?`, `worker?`) ; `host` est la signature du client MCP du `ctx`, `worker` le travailleur du bail (E11-S01) ; une valeur changée perd `comment` et `link`, une valeur identique ne change rien.
- E07-S02 N21 : la provenance d'une cellule écrite par un assistant est `{ origin, by, ctx, at }`, `ctx` étant le code de la conversation (nul sans code). HN-E11S01-5 : `host` et `worker` se rangent à l'écriture ; `host` est la signature de `ctx.host` telle que rangée.
- HN-E10S01-22 : la provenance `import` passe par `RowActor.origin` : toute cellule écrite par un import, clé et état d'entrée d'une file compris, porte `origin: "import"` ; le commentaire va aux valeurs posées.

### Importer et exporter (CSV et markdown)

Le markdown et le CSV sont des gestes d'import et d'export vers la page et le tableau, pas des types de contenu ([pages et blocs](pages-et-blocs.md)). La lecture, la déduction et le contrôle d'un CSV (`schemas/csv.ts`, `csv-cells.ts`) se jouent à l'écran avant l'envoi et se rejouent dans le service sur chaque lot.

- D120 et D150 : `table.import` (ou l'écran) qui crée un tableau n'exige que l'écriture sur le parent, comme `write` ; l'import crée et publie l'en-tête, puis écrit les lignes ; sans l'écriture, `forbidden` avec à qui s'adresser ; importer dans un tableau existant demande l'écriture.
- HN-E10S01-21 : une création (écran, `table.import`, conversion) décide les droits, contrôle tout le lot, crée et publie le tableau par le service de `write`, puis écrit les lignes en une transaction ; toute erreur levée après la création (relecture du tableau, lecture de son équipe, refus ou panne du lot) porte `details.created` et le dit (« The table <chemin> was created and published, but none of these rows was written… »), une erreur sans code devenant `internal` ; « Reprendre » remplit ce tableau sans `create`, un refus portant `details.created` n'essaie pas l'adresse suivante, et la conversion garde par rangée le tableau d'un premier lot refusé (`convertis`, `use-envois.ts`).
- HN-E10S01-4 : `table.import` prend 40 000 caractères par appel ; un gros CSV s'envoie en morceaux qui reprennent chacun la ligne d'en-tête et fusionnent sur la clé ; pas de clé générée par `call`. HN-E10S01-20 : cette borne est une constante à côté du schéma (`IMPORT_CSV_MAX`), dite par sa description et contrôlée par l'adaptateur en `too_large` (un `.max` Zod rendrait `invalid_arguments`).
- HN-E10S01-19 : sur un tableau existant, `key`, s'il est donné, doit nommer sa clé, sinon refus ; les colonnes inconnues, nommées deux fois ou l'état d'une file sont ignorées et listées dans la réponse (texte et champs), comme à l'écran. HN-E10S01-5 : la colonne d'état d'une file est ignorée à l'import : elle ne change que par `table.claim`, `table.release` et la revue.
- HN-E10S01-7 : 5 000 lignes au plus par import et par export, la borne des lectures filtrées (`FILTERED_ROWS_MAX`). HN-E10S01-8 : à l'écran, lots de 500 lignes par requête (`POST tables/import`), sous la coupure de 4,5 Mo de Vercel (`uploads-patterns.md § La limite de 1 Mo décide de l'architecture`) ; 5 Mo au plus par fichier lu.
- HN-E10S01-1 : le fichier se lit dans le navigateur, sans stockage ; un import ne garde pas le fichier d'origine (le joindre est le geste de [fichiers et stockage](fichiers-et-stockage.md)).
- HN-E10S01-3 : la colonne `enum` n'est jamais déduite (trop d'erreurs sur un échantillon) ; on la choisit dans le dialogue. HN-E10S01-9 : dates `JJ/MM/AAAA` lues jour d'abord, jamais mois d'abord. HN-E10S01-28 : un nombre qui commence par un zéro suivi d'un chiffre (`01000`) n'est pas un nombre (une colonne de codes postaux reste un texte) ; l'apostrophe d'un export se retire aussi devant une tabulation ou un retour chariot.
- HN-E10S01-29 : la clé proposée est la première colonne `text`, `number` entière, `email` ou `date` dont les valeurs sont présentes et distinctes une fois lues (`29/09/2026` et `2026-09-29` sont la même clé, rangée `YYYY-MM-DD`) ; une colonne où un nombre porte une virgule ou un point décimal n'est jamais proposée ; `url` se nomme par `key` seulement.
- HN-E10S01-23 : le dépôt d'un `.csv` sur un tableau existant enveloppe son corps (`ui/tableau/tableau-du-noeud.tsx`), vide compris, avec « Importer un fichier… » pour le clavier ; `grille.tsx` n'est pas touché (D140, [écrans d'un contenu](ecrans-d-un-contenu.md)).
- HN-E10S01-25 : « Convertir en tableau de données » (un tableau simple d'une page) crée `<page>/<segment du titre>`, puis `_2`… (cinq essais) ; les cellules sont prises telles quelles (barres échappées et `<br>` gardés).
- HN-E10S01-18 : `GET nodes/export` et `GET tables/export` ne sont pas journalisés, comme toute lecture : aucune ligne de journal, `exportNode` et `exportTable` ne calculent ni cible ni équipe ; l'export reste borné à 5 000 lignes et décidé par la lecture (confirmé par JB, D138, [journal et retours](journal-et-retours.md)).
- HN-E10S01-11 : le `.md` d'une page (`pageMarkdown`) et son inverse (`readPageMarkdown` : titre, résumé, morceaux d'un import) vivent dans `schemas/blocks-render.ts`, exportés par `./schemas` ; `server/nodes/export.ts` les importe. HN-E10S01-12 : `slugOf`, `OP_TEXT_MAX`, `PAGE_MAX` (`schemas/nodes.ts`), `instantOf`, `maxLengthOf`, `COLUMN_TEXT_MAX` et `ROW_KEY_MAX` (`schemas/tables.ts`) vivent dans `schemas/`, réexportés à leur ancienne place (`segments.ts`, `limits.ts`, `meta.ts`) : l'écran et le service appliquent la même règle ; `segmentOf` et `columnNameOf` reposent sur `slugOf`.
- HN-E10S01-13 : `kept_as_text` compte les constructions d'un `.md` gardées en texte (bloc `code` ou paragraphe) : `call` ou `reference` mal formés, clôture jamais fermée, titre de plus de 200 caractères, source d'image trop longue, tableau hors bornes, résumé de repli refusé, bloc que le schéma refuse encore ; les formes ramenées (`#` en titre de niveau 1, liste coupée ou ramenée au troisième niveau, repli dans un repli, `---` en séparateur, `mermaid` vide retiré) ne comptent pas.
- HN-E10S01-14 : en mode tolérant (collage, `.md` importé) : un texte sans marque dans une sous-liste devient un élément ; puces et numéros mêlés gardent la forme du premier élément ; un repli jamais fermé court jusqu'à la fin ; un résumé trop long est coupé à 200 caractères ; un résumé refusé laisse la ligne `<details>` en texte (compté) ; un bloc de plus de 100 000 caractères reste refusé. HN-E10S01-15 : un `call` ou une `reference` mal formés deviennent un `code` sans mot de tête ; une clôture jamais fermée garde son mot de tête, sauf `call`, `reference` et `mermaid`.
- HN-E10S01-16 : les morceaux d'un `.md` importé partent en `insert_after` sans bloc, du dernier au premier, dans une seule requête : `append` exige une section, qu'une page neuve n'a pas.
- HN-E10S01-17 : l'encart « N éléments conservés en texte » d'un `.md` importé vit dans le retour du rail : le message s'écrit dans sa région `role="status"`, montée vide, quand la page importée devient l'adresse ouverte, et l'encart visible (`role="note"`) part avec son état quand une autre adresse s'ouvre ; après un collage ou un dépôt dans l'éditeur, le compte va dans son annonce (`role="status"`).
- HN-E10S01-24 : le « ⋯ » d'un Contexte offre « Télécharger en .md », son seul geste (confirmé par JB, D139).
- HN-E10S01-26 : `server/tables/import.ts` lit `nodes/write` par un import dynamique : sans lui, le registre du catalogue, qui importe `table.import`, forme un cycle (registre, `write`, publication, contrôle des procédures, registre).
- HN-E10S01-27 : la phrase d'AC-c2 sur le markdown est écrite telle que l'AC la cite (« with write »), sans le préfixe de l'organisation.

## Décisions et alternatives écartées

- **Une seule forme de ligne, `null` refusé** (H92, H93, D49) : les sentinelles et le `null` qui efface d'Oto rendaient une écriture ambiguë ; on vide par `clear`, on déclare un vide vérifié par `verified_empty`.
- **`create_only` plutôt qu'une clé auto-incrémentée** (D132, FB-0001) : la clé reste une valeur métier, l'assistant apprend par `conflict` que la ligne existe déjà.
- **Créer un tableau demande l'écriture sur le parent** (D150, 2026-09-29) : remplace la gestion qu'exigeait D120 (et HN-E10S01-2), alignée sur `write` depuis la publication directe (D135).
- **Clé en `date`** (HN-E10S01-29, FB-0014) : la liste fermée des types de clé (`text`, `email`, `url`, `number`) excluait une colonne de jours ; `datetime` reste écarté (un instant n'est pas une clé lisible).
- **Pas de `.max` Zod sur le CSV de `table.import`** (HN-E10S01-20) : il rendrait `invalid_arguments` au lieu de `too_large`, qui dit d'envoyer par morceaux.
- **Pas d'`enum` déduit, pas de date mois d'abord** (HN-E10S01-3, HN-E10S01-9) : la déduction sur un échantillon se trompe trop souvent ; les organisations de la V1 écrivent les dates jour d'abord.
- **Calcul dans le service plutôt qu'en SQL** (E07-S01 N6) : la colonne d'état et les types sont propres à chaque tableau ; la borne de 5 000 lignes garde le coût.

## Sécurité et confidentialité

- Lire un tableau exige la lecture, écrire l'écriture, décidées par le service ([droits d'accès](droits-d-acces.md)) ; l'export est décidé par la lecture et borné à 5 000 lignes.
- La provenance nomme qui a écrit (nom du membre, « former member » ensuite) et par quel client ; un commentaire ou un lien de preuve ne survit pas à une valeur changée (H94).
- Un CSV est contrôlé deux fois : à l'écran avant l'envoi, puis dans le service sur chaque lot.

## Écart avec le code

- M77 : une panne de la relecture du propriétaire que `writeNode` fait après `publish_node` fait sortir `createTable` sans `details.created`, le tableau déjà publié (HN-E10S01-21).
- M78 : les 5 000 lignes d'un `table.import` s'écrivent une requête à la fois ; un import complet reste à mesurer contre `maxDuration`.
- M56 : deux `table.write` qui prennent les mêmes lignes dans des ordres contraires peuvent s'interbloquer ; écrire les lignes d'un appel dans un ordre commun.

## Questions ouvertes

Aucune à ce jour.

## Historique

- 2026-09-29 : version 1.0.0 publiée avec les tableaux de la V1 (en-tête typé, `table.schema`, `rows`, `aggregate`, `write`, provenance, garde de révision) — décidé par JB (fiche D49 ; stories E07-S01, E07-S02, E07-S04).
- 2026-09-29 : `create_only`, colonne obligatoire stricte, recherche `q` par mots, révision servie par `table.schema` — décidé par JB (fiche D132 ; story E11-S01).
- 2026-09-29 : import et export CSV, `table.import`, création au niveau écriture du parent, exports sans journal — décidé par JB (fiches D120, D150, D138, D139 ; story E10-S01).
- 2026-09-30 : une colonne `date` peut porter la clé ; `match: "any"` de `table.rows` — décidé par JB (FB-0014, HN-E10S01-29 ; story E11-S19).
- 2026-10-01 : refonte en document de conception vivant, qui reprend H90 à H97, H100, P24, D49, D120, D132, D150 et les choix des stories E07-S01, E07-S02, E07-S04, E10-S01, E11-S01 — décidé par Alexis, accord de JB.
