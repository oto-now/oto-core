# File de travail et revue

- **Statut** : proposé
- **Dernière révision** : 2026-10-01

## Résumé

Un tableau à cycle de vie est une file de travail : des assistants réservent des lignes par `table.claim` sous un bail, les rendent par `table.release`, et une personne décide la revue à l'écran, sauf si le tableau laisse l'assistant décider. La preuve d'une valeur (`{value, comment | link}`) est une option par tableau, `proof`. Le pilote V1, la qualification de prospects, en est le cas de référence.

## Contexte

Plusieurs assistants (et plusieurs travailleurs d'un même assistant) traitent les mêmes lignes ; sans bail, ils se marchent dessus, et sans revue humaine une décision d'agent part sans contrôle. D7 : le pilote V1 est la qualification de prospects dans un tableau, par une procédure avec revue humaine, sans connecteur externe ; la relance des devis est le pilote V2. Les retours de la démo ont rendu la preuve facultative et ouvert la décision de revue à l'assistant, option par tableau (D132, D133). L'en-tête, l'écriture et la provenance sont dans [tableaux](tableaux.md).

## Objectifs et non-objectifs

- Une ligne n'est travaillée que par le titulaire de son bail ; un bail perdu se récupère.
- Une valeur nouvelle se prouve quand le tableau l'exige ; une décision de revue dit qui, quand et pourquoi.
- Hors objectif : un ordonnanceur ou une progression mémorisée côté serveur ; la relance des devis réelle (pilote V2, avec les connecteurs, [connecteurs et comptes](connecteurs-et-comptes.md)).

## Conception

### Réserver et rendre : `table.claim`, `table.release`

- H98 : `table.claim` réserve 5 lignes au plus par appel, baux expirés d'abord puis l'attente la plus longue, avec un bail de 15 minutes (60 au plus) lié à la personne et au travailleur, 5 baux par travailleur et tableau ; seul son titulaire rend la ligne.
- E07-S02 N12 : `table.claim` sert d'abord les lignes au bail expiré, puis l'attente la plus longue (`updated_at`), puis la clé. E07-S02 N39 : les candidats se lisent par l'index `idx_blocks_node_id_updated_at_key` (nœud, `updated_at`, clé, lignes `row` publiées) ; la colonne d'état, propre à chaque tableau, n'est pas indexée. E07-S02 N14 : le `filter` de `table.claim` resserre les lignes éligibles, avec la grammaire de filtre de `table.rows` (H95).
- E07-S02 N11 : 5 baux actifs au plus par personne, travailleur et tableau ; `table.claim` rend le reste du quota, et `conflict` quand il est atteint. E07-S02 N17 : le libellé `worker` fait 1 à 40 caractères, espaces de bord retirés (la base en admet 100).
- E07-S02 N4 : une ligne sous le bail actif d'une autre personne refuse l'écriture ; `claimed_by_user` fait foi : la même personne écrit quel que soit son libellé de travailleur. HN-E11S01-6 : `table.write` n'a pas d'argument `worker` : il range celui du bail actif de la même personne.
- E07-S02 N16 : l'état d'une ligne sous bail ne change que par `table.release`. E07-S02 N10 : libérer une ligne sans bail n'est pas une erreur (`released: false`) ; une ligne réservée par un autre titulaire rend `conflict`. HN-E11S01-26 : `table.release` range toujours le `worker` de l'appel dans la provenance de l'état ; sa description et sa ligne de refus disent l'exception d'un tableau qui laisse l'assistant décider.
- E07-S02 N24 : une réservation range dans la provenance de l'état la révision qu'elle pose (`claim_revision`, jamais servie) ; E07-S02 N13 : une libération vers le premier état d'une ligne restée inchangée depuis sa réservation, sur cette même révision, porte une note de livelock.

### Décider la revue

- H99 : la revue humaine sert la file des lignes à l'état de revue ; une décision (approuver ou rejeter) est atomique sous garde de révision, passe la provenance de l'état à `human` avec qui, quand et pourquoi, et écrit une ligne de journal.
- P10 et E07-S02 N9 : quand l'en-tête déclare `review`, les états de décision (`approve`, `reject`) ne se posent ni par `table.write` ni par `table.release`, seulement par la revue humaine de l'écran, sauf sur un tableau dont la revue déclare `agents_may_decide` (E11-S01, D132 ; provenance `agent`).
- HN-E11S01-7 : un assistant au niveau écriture peut publier `agents_may_decide` et `proof` par `write`, comme tout attribut d'en-tête ; canal ouvert voulu, tracé par la ligne de publication, le journal et la provenance `agent` (tranché par le responsable d'Oto, 2026-09-29). HN-E11S01-8 : une décision d'un assistant garde `origin: "agent"`, sans origine nouvelle ni commentaire exigé ; la colonne d'état s'écrit nue. HN-E11S01-22 : `agents_may_decide` est `.optional()` dans `tableReviewSchema`, sans défaut écrit : absent, il se lit faux, et un en-tête lu ne gagne pas la clé.
- HN-E07S03-3 : la décision humaine passe par une route dédiée, `POST /api/platform/tables/review`, pas par `table.write` : la garde porte sur la révision lue et sur l'état attendu de la ligne. HN-E07S03-2 : approbation comme refus prend une raison facultative de 500 caractères au plus, rangée en `comment` de la provenance de la colonne d'état.
- HN-E07S03-1 : la file de revue sert le nombre de lignes à l'état de revue et les 20 premières dans l'ordre croissant des clés, provenance comprise. HN-M54-5 : au-delà de 20 fiches, elle dit « 20 premières sur N », et « Passer » depuis la dernière dit le retour à la première et que les suivantes paraissent après les décisions. Points de la tâche M54 cités par le code : P2 (choisir la fiche à décider, ou passer à la suivante), P3 (la preuve de chaque valeur servie avec sa provenance), P4 (un refus garde sa raison, que le résumé rend à l'assistant).
- HN-E07S03-6 : le résumé d'une revue, en français, se calcule dans l'îlot à partir des décisions de la session ; il n'est pas stocké. HN-M37b-3 : le résumé en échec du pied du tableau s'affiche en alerte : « Le résumé n'a pas pu être calculé. » en titre, le message dessous, un lien « Réessayer », la grille intacte.

### Preuve d'une valeur : `proof`

- D133 : la preuve est une option par tableau (`proof` dans l'en-tête, défaut non) : sans elle, `table.write` accepte une valeur nue ; avec elle, la règle de D99 et D100 s'applique inchangée. HN-E11S01-10 : l'attribut s'appelle `proof`, booléen, comme `closed`. HN-E11S01-11 : un tableau créé sans `proof`, ou rangé avant 1.1.0, se lit `proof: false`.
- D99 : sur un tableau `proof: true`, `table.write` exige la preuve d'une valeur nouvelle ; l'accord de la personne ne vaut que pour un envoi ou ce qui dépasse la procédure demandée ; « What's new » vide du jour est omis (plus de « What's new » à part depuis le 2026-10-27 : [contexte servi](contexte-servi.md)) ; une procédure d'un espace Privé n'est candidate que pour son propriétaire.
- D100 : une valeur nue égale à la valeur rangée est ignorée sans erreur ; toute valeur nouvelle d'une colonne de valeur exige `{value, comment | link}`, sinon l'appel entier est refusé ; la colonne d'état s'écrit nue, dans ses transitions permises ; un état interdit ou une clé qui change est refusé avec son vrai motif.
- HN-M53-5 : une valeur nue d'une colonne de valeur est jugée sur les lignes lues avant toute écriture : égale à la valeur rangée, ignorée ; différente, ou sur une ligne à créer, elle refuse l'appel entier sur un tableau `proof: true`, et s'écrit nue sans lui. HN-E11S01-15 : sans `proof`, `withoutBareValues` retire encore une valeur nue égale à la valeur rangée : un renvoi tel quel ne remplace pas une provenance prouvée ou importée.
- HN-M53-10 : sur un tableau `proof: true`, à la publication d'une procédure, un bloc `call` de `table.write` qui écrit une colonne de valeur sans `comment` ni `link` est refusé, valeur réservée comprise ; la colonne d'état et la clé s'écrivent nues ; une cellule entière réservée (`"<notes>"`) reste admise ; ce refus s'ajoute à un refus de type ([procédures](procedures.md)).
- HN-E11S01-12 : changer `proof` n'avertit de rien et ne réécrit ni ne compte aucune ligne ; une procédure publiée n'est pas recontrôlée au changement de `proof` ou de `closed`. HN-E11S01-14 : textes du changement : « require proof » et « stop requiring proof » en attente, « proof required » et « proof optional » à la publication.
- HN-E11S01-13 : la fixture `PROSPECTS_HEADER` (`tests/factories/table-fixture.ts`) porte `proof: true`, pour que les tests de M53 et d'HN-M53-10 gardent leurs assertions ; un en-tête dérivé sans `proof` sert les cas sans preuve.

### Réglages du tableau à l'écran

- HN-E11S01-16 : dans le créneau `access` de l'en-tête d'un tableau : « Télécharger en .csv », « Réglages », puis « Partager · <espace> », toujours le dernier. HN-E11S01-30 : un nœud `table` dont `vue.meta` ne passe pas `tableHeaderSchema` n'a pas de bouton « Réglages ». HN-E11S01-21 : le panneau s'ouvre dès le niveau écriture (`vue.level >= 2`), comme la publication d'un en-tête (HN-E11S02-17) ; tranché par le responsable d'Oto (2026-09-29).
- HN-E11S01-17 : sans `lifecycle.review`, l'interrupteur « L'assistant peut décider la revue » est absent, pas désactivé. HN-E11S01-29 : le décocher publie `agents_may_decide: false` explicite, plutôt que retirer la clé.
- HN-E11S01-18 : un geste du panneau part par la file d'opérations de la page, qui pose la révision et le tampon courants ; un appel direct avec la révision lue serait périmé. HN-E11S01-27 : une bascule part avec le tampon courant du brouillon (`draft_stamp` posé seulement si un brouillon existe), comme la publication de la page. HN-E11S01-20 : un en-tête en attente dans le brouillon bloque le panneau, plutôt que publier le brouillon entier avec le réglage ou écrire sur l'en-tête publié par une porte nouvelle.
- HN-E11S01-19 : au succès, une annonce nomme l'interrupteur et son nouvel état, puis la page se relit (`useRafraichir`). HN-E11S01-31 : l'annonce s'accorde à l'option, au féminin pour les trois : « Fermé : activée. ». HN-E11S01-28 : un refus ne relit pas la page : l'interrupteur revient à l'état publié lu, l'arrêt de la file est levé pour qu'un geste suivant reparte, la relecture reste à la personne (« Rechargez la page »).
- HN-E11S01-32 : l'intitulé et l'aide d'un interrupteur prennent leurs couleurs d'`oto-choice` (`--ink`) et `oto-choice-desc` (`--mute`), même rendu que `text-ink` et `text-mute` dans les deux thèmes.

### Grille et vues dans une page

- HN-E07S03-4 : la grille lit ses réglages dans l'adresse (`ui/tableau/adresse.ts`) : `q`, `sort` (`-` pour décroissant), `f` répété `<colonne>:<opération>:<valeur>` (`contains`, `eq`, `min`, `max`, `empty`, `not_empty`), `n` de 20 à 200 par 20 ; ces noms sont en anglais depuis ADR-020 ([adresses et langue](adresses-et-langue.md)).
- HN-E07S03-5 : les blocs `reference` d'un nœud sont résolus côté serveur, désignés par leur `id` de bloc, 10 au plus rendus en place ; les suivants gardent leur lien. HN-E07S03-11 : un bloc `reference` sans `view` rend la carte du nœud cité, quel que soit son genre ; une `view` sur un chemin qui n'est pas un tableau est une vue illisible. HN-E07S03-12 : vues et cartes sont rendues par la page serveur et passées à l'écran et à l'éditeur en un `ReactNode` par `id` de bloc (`referencesRendues`) ; une référence non résolue garde le lien par défaut.

### Le pilote V1 : qualification de prospects

- E06-S01 NH15 : état initial du tableau du pilote : P-003, P-006 et P-009 « à revoir », fiches complétées (provenance `agent`), les sept autres « à traiter », aucune décidée ; la page `ventes/prospects_valbrune` reste publiée. E06-S01 NH8 : le script Démo remet les dix lignes à leur état initial à chaque passage ; une ligne identique au module n'est pas réécrite, une ligne qui en diffère reprend ses valeurs et avance d'une révision. HN-E07S03-7 : il remet P-003, P-006 et P-009 « à revoir » avec une provenance `agent` fictive, et publie `ventes/prospects_valbrune` (une vue, une carte) ; ce qui est déjà dans l'état voulu n'est pas réécrit.
- E06-S01 NH5 : la page `ventes/notes_salon_2026` de Démo, aux entreprises fictives, donne au scénario des valeurs vérifiables, un titre de section par entreprise, que `find` trouve au bloc près. E06-S01 NH14 : la source interne du scénario se trouve par `find`, qui cherche dans le contenu au bloc près, sans pointeur par sujet.
- E06-S01 NH6 : la procédure s'intitule « Qualifier les prospects », titre et résumé sans « à traiter » ni « à » : « Relance les prospects à traiter » reste sous le seuil de service, « Qualifie les prospects à traiter » au-dessus. E06-S01 NH7 : seuils du test de routage du pilote : formulations du résumé et titre servies à 100 % ; négatives, demandes proches et questions de données jamais servies, marge d'au moins 0,06 ; paraphrases et limites mesurées, sans seuil. E06-S01 NH11 : le test joue les anciennes déclencheuses en paraphrases, les anciennes voisines en négatives ou limites ; « Où en est la qualification de nos prospects ? » est QP-I4, « Prospects. » QP-I5 ; « leads » n'équivaut pas à « prospects » ([routage et recherche](routage-et-recherche.md)).
- E06-S01 NH12 : les liens de chaque document du pilote sont déclarés dans le module (format `links` de `publishBlocks`) et passés à `publish_node` en `p_links` ; un test statique les confronte aux `[[…]]` des blocs. E06-S01 NH13 : un document n'est republié sur Démo que s'il diffère du module (blocs dans l'ordre, titre, résumé) : un passage sans changement n'ajoute aucune version et ne fait pas monter `rules_version`.
- E06-S01 NH23 : le test de l'état initial de Démo rejoue en place les sections `identite`, `contenu`, `tableau` et `procedure`, dans l'ordre du script, sur l'organisation semée par le test de fumée, sans relancer le script ([tests et données de démo](tests-et-donnees-de-demo.md)).
- HN-E07S03-10 : l'E2E du tableau Démo n'en suppose que la forme (clé `ref`, colonne d'état `statut` et ses cinq états, `ville`, `montant_estime`, au moins deux lignes « à revoir ») ; ses nombres se calculent sur les lignes lues.

## Décisions et alternatives écartées

- **Preuve obligatoire partout** (D99, D100, H92 et HN-M53-5, HN-M53-10 dans leur première forme) : amendée par D133 (2026-09-29) ; exiger `{value, comment | link}` sur tout tableau bloquait les usages où l'assistant saisit une donnée qu'il a sous les yeux ; la règle reste entière sur un tableau `proof: true`.
- **Revue réservée à l'humain sans exception** (P10 dans sa première forme) : amendée par D132 ; un tableau peut déclarer `agents_may_decide`, la décision restant tracée en provenance `agent`.
- **Pilote V1 avec connecteur externe** : écarté par D7 ; la relance des devis demande des comptes réels, reportée au pilote V2.
- **Décision de revue par `table.write`** : écartée (HN-E07S03-3) ; une route dédiée garde à la fois la révision lue et l'état attendu.
- **Réglages de la grille en français dans l'adresse** (`tri`, `contient`, `egal`, `vide`, `rempli`, première forme d'HN-E07S03-4) : remplacés par l'anglais, toute adresse étant en anglais (ADR-020, E11-S07).
- **Réglage du tableau par une porte d'écriture propre à l'en-tête publié** : écarté (HN-E11S01-20) ; le panneau passe par la file d'opérations de la page, avec révision et tampon.

## Sécurité et confidentialité

- Seul le titulaire d'un bail écrit ou rend sa ligne (`claimed_by_user` fait foi) ; une décision de revue est atomique, sous garde de révision, et journalisée.
- Ouvrir la décision ou la preuve à l'assistant est un geste au niveau écriture, tracé par la publication, le journal et la provenance (HN-E11S01-7).

## Écart avec le code

- M56 : deux `table.write` qui prennent les mêmes lignes dans des ordres contraires peuvent s'interbloquer ([tableaux](tableaux.md)).
- Aucune mémoire de ce que la file vient de servir : une ligne relâchée mais encore éligible revient selon `updated_at` (ordre E07-S02 N12).

## Questions ouvertes

Aucune à ce jour.

## Historique

- 2026-09-29 : version 1.0.0 publiée avec la file de travail, la revue humaine et la preuve des valeurs ; pilote V1 de qualification de prospects — décidé par JB (fiches D7, D99, D100 ; stories E06-S01, E07-S02, E07-S03).
- 2026-09-29 : preuve en option par tableau (`proof`), décision de revue ouverte à l'assistant (`agents_may_decide`), réglages du tableau à l'écran — décidé par JB (fiches D132, D133 ; story E11-S01).
- 2026-10-01 : refonte en document de conception vivant, qui reprend H98, H99, P10, D7, D99, D100, D133 et les choix des stories E06-S01, E07-S02, E07-S03, E11-S01 — décidé par Alexis, accord de JB.
