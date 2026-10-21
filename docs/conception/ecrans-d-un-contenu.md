# Écrans d'un contenu

- **Statut** : proposé
- **Dernière révision** : 2026-10-20

## Résumé

Une page, une procédure, un Contexte ou un tableau s'ouvrent à la même adresse de nœud, dans une carte de document avec, à droite, des encarts repliables (« À quoi sert cette page », « Cité dans », « Cite », « Sous-pages »).
L'écran offre les gestes du contenu : créer, ranger, dupliquer, mettre à la corbeille, restaurer, partager, télécharger, importer un fichier dans un tableau, revoir les lignes.
Ce document répond à : que montre l'écran d'un contenu, et quels gestes offre-t-il ?

## Contexte

Les écrans viennent d'`oto-frontend` ([écrans et coque](ecrans-et-coque.md)). Trois vagues de retours ont fixé ce qu'ils montrent : les retours d'édition (E05-S10), les écrans d'un contenu après la démo (E11-S05, fiche D136) et les retours sur la 1.1.1 (E11-S15). Le modèle des nœuds et leurs règles vivent dans [nœuds et arbre](noeuds-et-arbre.md) ; l'éditeur des blocs dans [éditeur de blocs](editeur-de-blocs.md) ; la grille et la file de revue dans [tableaux](tableaux.md) et [file de travail et revue](file-de-travail-et-revue.md).

## Objectifs et non-objectifs

- Qu'une personne comprenne ce qu'elle lit, et retrouve les gestes d'un contenu sans quitter sa carte.
- Que chaque geste de l'écran passe par le même service que l'assistant, avec les mêmes droits.
- Hors objectif : l'historique des valeurs d'une cellule (une table de versions de lignes, plus tard) ; ajouter une ligne de tableau depuis l'écran (HN-E05S09c2-1, [écrans et coque](ecrans-et-coque.md)) ; garder le lien rendu pendant l'édition d'un bloc.

## Conception

### Carte et encarts

- Les encarts d'un contenu sont repliables, à droite, au-dessus de la grille pour un tableau (D136). Ordre : « Cité dans », « Cite », « Sous-pages » ; glyphes `ArrowSquareIn`, `ArrowSquareOut`, `TreeStructure` ; total seul (HN-E11S05-12). « Cités » se lit par `readNode` (`links_out`, `links_in`, filtrés par le niveau du lecteur), appelé par la page après la lecture du nœud, sous `<Suspense>` (HN-E05S10b-6).
- La colonne de droite d'une page, d'une procédure ou d'un Contexte a toujours sa piste ; sans lien ni sous-page, elle reste vide, sans phrase (HN-E11S05-13). Pour un tableau, « Lecture des liens… » tient la ligne des encarts pendant la lecture (HN-E11S05-14), et la ligne est masquée quand elle est vide (`empty:hidden`) (HN-E11S05-29). L'aperçu d'un Contexte se place entre « À quoi sert cette page » et les encarts (HN-E11S05-28).
- « Rangés sous ce contexte » et « Pages citées » passent dans l'encart repliable partout où la vue « Contexte » les rend (`ListesServies`), même glyphe que « Sous-pages » et « Cite », sans total (HN-E11S15-a1). Dans un encart, la nature d'un nœud (« Page », « Procédure »), « déplacé vers … » et « sans cible » restent en méta (HN-E11S15-a2). Un Contexte cité se nomme par `titreDuContexte` (« Contexte · SAV ») dans un lien au repos et dans les lignes d'encart, quand son libellé est le titre enregistré ou absent ; le genre vient de l'arbre visible déjà servi ; arbre illisible, coupé ou Contexte déplacé : son titre enregistré ; le nom vaut aussi dans le panneau « Lien » (HN-E11S15-a9).
- Mise en page : sous 1 410 px de contenu, le document (borné à sa mesure) et la colonne d'annexes forment une paire centrée, l'en-tête au bord gauche du document (HN-E11S15-a3). La borne de 70 % de la fenêtre vaut pour les deux panneaux larges (`data-size="lg"` : « Partager », « Réglages » d'un tableau) ; « Partager » s'aligne sur le bord droit de son bouton (HN-E11S15-a4). Le filet entre les étapes du guide de branchement vaut aussi dans la fenêtre « Brancher » de l'accueil, en `--island-bd` (HN-E11S15-a5).
- À l'écran, un bloc `reference` résolu se rend en place (vue d'un tableau ou carte d'un nœud, désigné par son `id`) ; sinon, le chemin cité en lien (P18).
- Rendu des blocs à la lecture : l'en-tête teinté d'un tableau simple vaut à la lecture comme dans l'éditeur, sur le jeton `--oto-bg`, opaque, collé en défilant (HN-E11S15-b2) ; le rendu au repos d'un texte marqué vaut pour tout bloc à texte en ligne (Texte, titre, liste, cases, citation), un code et un appel restant lus tels quels (M59) (HN-E11S15-b5) ; « etc. » d'AC-b2 se lit tableau, fichier, image (HN-E11S15-b4) ; la hauteur libérée du menu de la poignée vaut pour tout bloc, bornée à la fenêtre (HN-E11S15-b3).
- Liens : un clic sur une page citée navigue par un `<a href>` dans l'onglet (Ctrl, ⌘ ou bouton du milieu : nouvel onglet) ; une adresse web s'ouvre dans un nouvel onglet (`noopener noreferrer nofollow`) (HN-E11S15-b6). Une adresse nue s'affiche entière jusqu'à 40 caractères ; au-delà, schéma, hôte et les 12 derniers caractères du chemin, requête et fragment tombés ; hôte montré, infobulle et nom accessible viennent de `new URL` (punycode d'un domaine international), jamais d'un hôte lu à la main ; jamais l'identifiant ni le mot de passe ; un libellé écrit reste le nom du lien (HN-E11S15-b8). Le correcteur du navigateur est coupé (`spellCheck={false}`) sur le champ d'un bloc qui porte un lien et sur « Libellé » et « Chercher une page » du panneau « Lien » (HN-E11S15-b1). Les contenus récents de « @ » sont ceux du bloc « Recent content » de `context` (`recentDocuments` : pages et tableaux lus, écrits ou publiés par la personne sur 90 jours, 20 au plus, hors de la page éditée, `GET /api/platform/search/recent?exclude=`), affichés tant que rien n'est tapé après « @ » ; le panneau « Lien » reste sans récents ; `search` sans `q` reste une erreur (HN-E11S15-b7).

### Résumé, page vide, tableau vide

- Le résumé ne se montre ni ne s'écrit à l'écran hors d'une procédure (Contexte et tableau compris) ; l'assistant l'écrit par `write` (HN-E11S05-15). Le résumé par défaut d'une procédure est une vraie valeur stockée, sans exemple métier (HN-E11S05-16). L'explication de la vue « Contexte » est l'encart « À quoi sert cette page », ouvert sous le titre, sans borne chiffrée ; « Règles Oto » et la procédure servie y sont dites « non montrées ici », l'outil nommé « son outil « context » », la procédure servie « quand Oto en reconnaît clairement une » (HN-E11S15-a8). La phrase d'un Contexte d'équipe ou de Tout le monde : « Ce que votre Claude/ChatGPT/Mistral, comme celui de chaque membre de l'organisation (de l'équipe X), lit à chaque conversation. » ; Privé et Privé d'autrui inchangés (HN-E11S15-a6).
- « Nœud neuf » = titre « Sans titre » et aucun bloc, sans condition de révision (HN-E11S05-20). L'invite d'une page vide vaut exactement `Commencer à écrire... Utilisez '/' pour afficher tous les types de blocs - Utilisez '@' pour citer un autre contenu (page, tableau, procédure) de l'espace` (HN-E11S05-22, revue par le responsable d'Oto : elle cite désormais `/`) ; elle ne se pose que sur le Texte seul, local et vide, d'une page vide (HN-E11S05-26) ; ce Texte n'existe que sur le poste et ne part jamais vide (HN-E11S05-19). Au niveau lecture et sur la page publique, « Cette page n'a pas encore de contenu. » reste (HN-E11S05-21). Entrée dans le titre mène au premier bloc ; à l'ouverture, le focus va au Texte d'une page vide seulement si le titre n'est pas « Sans titre » (HN-E11S05-27).
- Un tableau vide nomme la famille d'assistant la plus récente de `lastConnections` (HN-E11S05-17) ; famille inconnue ou « Client non identifié » : « votre assistant » (HN-E11S05-18).

### Grille d'un tableau

- Dans une fenêtre étroite, la grille défile en largeur dans son îlot, jamais en cartes : tri et filtres par colonne restent (D97).
- La provenance d'une cellule s'ouvre par une icône « info » (`Info`) après la valeur, dans un panneau posé par-dessus la grille (`Popover`, nommé « Provenance de « colonne » ») : le repli natif sous un chevron (HN-E11S05-1) déplaçait tout le tableau en s'ouvrant (1.4.11). L'icône se montre au survol de la cellule, au focus et panneau ouvert, toujours sans survol (`table.css`) ; le détail est en `text-mute`, sans token ajouté (HN-E11S05-2).
- Une cellule de texte va à la ligne au-delà de `--table-cell-max` au lieu d'être coupée par « … » ; sa largeur suit son texte jusque-là sans descendre sous lui, et une grille de nombreuses colonnes défile en largeur (`.oto-cell-texte`, `table.css` ; la même règle vaut pour le tableau simple d'une page). Ses liens `[[…]]` se suivent vers leur nœud, nommés par leur libellé ou le dernier segment du chemin (sans lecture des titres), quand l'hôte passe le début de l'adresse d'un nœud (`prefixeDesPages`) ; sans lui (page publique), le texte se lit tel quel. Une adresse d'une colonne `url` se montre raccourcie comme dans une page (`libelleDUneAdresse`), l'adresse entière en infobulle (1.4.11).
- Seul l'état de revue marque une ligne (`data-state="review"`) ; `running` et `failed` restent inutilisés (HN-E11S05-3). L'aide du cycle de revue est une phrase visible dans l'îlot « À revoir », composée des états déclarés (HN-E11S05-4).
- Pour qui écrit un tableau, son écran porte « Importer un fichier… » au-dessus du tableau, vide compris, et reçoit un `.csv` lâché sur lui ; la grille elle-même n'est pas une zone de dépôt (D140). « Importer un fichier… » suit la condition de « Réglages » (niveau écriture, hors `?version=published`), après « Télécharger… », en `secondary` ; le dépôt d'un `.csv` garde la sienne, le niveau écriture (HN-E11S15-a7).

### Télécharger

- « Télécharger » est offert à qui lit un nœud publié, version publiée seule ; il ne manque qu'à un nœud gardé en brouillon par un assistant (HN-E11S05-9). « Télécharger en .csv » exporte tout le tableau, comme le rail, même sous un filtre ou une recherche (HN-E11S05-8). Un refus se dit par `messageDErreur(erreur, EXPORTS.refus)` (HN-E11S05-25). Exports non journalisés : D138, [journal et retours](journal-et-retours.md).
- Sur une page publique, le fichier se compose de la vue déjà chargée (500 lignes au plus, dit par le libellé), au rendu serveur, et part sans requête au clic (HN-E11S05-10) ; la borne est `PUBLIC_TABLE_ROWS_MAX = 500`, dans `schemas/node-gestures.ts`, lue par la page publique et son libellé (HN-E11S05-23) ; le séparateur du CSV suit la langue de l'organisation, servie par `readPublicNode` (HN-E11S05-11), et `PublicNodeView.language` est typé `Language` (HN-E11S05-24). La page publique d'un tableau : D103, [partage public](partage-public.md).

### Gestes sur un nœud

- Créer depuis le rail : le nœud reçoit le résumé « À compléter. » (le service en exige un, 1 à 200 caractères), à réécrire en place (HN-E05S10b-2), et prend la première adresse libre parmi `sans_titre`, `sans_titre_2`, `_3`… ; un refus `conflict` ou `stale_revision` fait essayer la suivante, cinq au plus ; le premier titre, comme tout renommage, fait suivre le chemin, l'ancien restant un alias (HN-E05S10b-3).
- L'adresse suit le titre à chaque publication d'un titre changé, quelle que soit la porte (écran, `write`, `admin_node publish`) ; le résultat dit « Renamed: now at <chemin> », l'ancien chemin reste un alias, sans outil ni argument ajouté (ADR-002) (HN-E05S10e-17). Le segment tiré d'un titre suit la règle du slug d'équipe (60 caractères, `sans_titre` sans lettre ni chiffre), premier libre parmi `<segment>`, `_2`… `_50` ; racine, espaces, Contextes et dossiers d'équipe gardent leur chemin ; un refus du déplacement après la publication part au log (HN-E05S10e-5 ; la règle générale du chemin libre : D125).
- Ranger : `nodes.position` est nulle par défaut ; les frères se rangent par position, puis les nœuds sans position, puis par chemin ; un parent reçoit des positions (1 024 × rang) au premier rangement d'un de ses enfants, un nœud neuf naît sans position ; une mise à jour qui ne change que `position` garde `updated_at` (HN-E05S10e-1). Déposé dans le rail, un contenu demande confirmation (`ConfirmDialog`) seulement s'il change d'espace (Tout le monde, une équipe, Privé) (HN-E05S10b-9). L'aperçu d'un déplacement se lit au niveau 1 sur le nœud et sur le parent de destination ; il compte les membres de l'organisation, 20 par liste avec les totaux ; les règles propres du nœud le suivent (HN-E05S10e-7).
- Dupliquer exige la lecture du nœud et l'écriture sous son parent ; la copie est publiée (révision 1), sans règle ni propriétaire explicite, sans descendant que la personne ne lit pas, sans brouillon, lignes sans bail, titrée « <titre> (copie) » (HN-E05S10e-6) ; `duplicate_subtree` ne calcule aucun niveau, le service décide avant l'appel, la fonction borne l'organisation de l'appelant et la forme, `execute` à `authenticated` seul (HN-E05S10e-18).
- Corbeille : un nœud à la corbeille vaut 0 pour tout service ; la purge (30 jours, le nœud et son sous-arbre) se fait au passage de qui lit la corbeille ou y met un contenu, par une fonction `security definer` bornée à son organisation (`purge_trash`, `20261021140000`), qui emporte aussi les pages qu'il ne lit pas ; l'export d'une organisation garde la corbeille avec sa date, l'import la restitue (HN-E05S10e-2). « Supprimer » exige la gestion et refuse un sous-arbre qui porte un contenu que la personne ne voit pas (HN-E05S10e-3). « Restaurer » remet le nœud sous son parent s'il est vivant, sinon sous son plus proche ancêtre vivant (jamais hors de son espace), au premier chemin libre de son segment, l'écriture exigée sur cet ancêtre ; ce qui était parti avec lui revient avec lui (HN-E05S10e-4).

### « Partager »

- Le niveau d'accès d'une ligne se choisit dans le `Select` du design system : un `DropdownMenu`, monté hors du popover, le refermerait (HN-E05S10b-4). Une personne ou une équipe ajoutée reçoit « Peut lire », son menu change ensuite le niveau (HN-E05S10b-5).
- Niveau : au nœud le plus proche qui porte une règle visant la personne, sa règle l'emporte, puis ses équipes ; quand seule une règle d'organisation y est, le niveau est le plus haut de cette règle et de ce que donne le propriétaire : une règle d'organisation ouvre, elle ne retire rien (ADR-014) (HN-E05S10e-12). Une règle d'organisation ne compte pas dans un espace personnel, ni dans le calcul ni en SQL ; le service refuse de la poser (HN-E05S10e-13). Le calcul complet : [droits d'accès](droits-d-acces.md).
- Lien public (ADR-013, [partage public](partage-public.md)) : un lien actif par nœud ; jeton de 32 octets tiré par le service, jamais recopié par l'import, qui pose le lien désactivé ; un nœud à la corbeille rend son lien inerte (404) ; l'administrateur liste les liens sans jeton ; la route publique est servie avant le jeton, sans journal (HN-E05S10e-9). Ne se partagent pas sur le web : la racine, `perso`, un espace personnel, un Contexte, le dossier d'une équipe (`invalid_arguments`), un contenu dont le propriétaire effectif est une autre personne (`forbidden`) (HN-E05S10e-19). L'auteur d'un lien est qui l'a créé ou réglé en dernier ; une désactivation ne change pas l'auteur (HN-E05S10e-20). La lecture publique garde chaque nœud (racine du lien, contenu lu, enfants, cibles des liens) dont `node_level_of(auteur, …)` rend au moins la lecture ; un auteur qui n'est plus membre ne lit plus rien (404) ; `node_level_of` n'est exécutable par aucun rôle de l'application (HN-E05S10e-21).

## Décisions et alternatives écartées

- **Le résumé éditable à l'écran pour tout contenu** : écarté, l'assistant l'écrit (HN-E11S05-15) ; seule la procédure le montre, son résumé servant au routage ([procédures](procedures.md)).
- **Exporter la vue filtrée d'un tableau** : écarté, l'export prend tout le tableau, comme le rail (HN-E11S05-8).
- **La grille entière comme zone de dépôt d'un `.csv`** : écartée, le dépôt vise l'îlot au-dessus du tableau (D140).
- **Des cartes au lieu de la grille en fenêtre étroite** : écartées, tri et filtres par colonne seraient perdus (D97).
- **Une infobulle au survol pour la provenance** : écartée pour un panneau ouvert au clic ou au clavier ; une infobulle ne peut porter de lien cliquable (la preuve) et ne s'ouvre pas au toucher.
- **Lire les titres des nœuds cités dans les cellules** : écarté pour l'instant, une lecture de plus par page de lignes ; un lien sans libellé se nomme par le dernier segment de son chemin.
- **« Aucun ⋯ sur un Contexte »** (E05-S10 AC-b8) : remplacé par « Télécharger en .md » (D139, [écrans et coque](ecrans-et-coque.md)).
- **Un menu déroulant (`DropdownMenu`) pour le niveau d'accès** : écarté, il refermait le panneau « Partager » (HN-E05S10b-4).

## Sécurité et confidentialité

- Chaque geste passe par le service, qui décide le droit avant la requête : un sous-arbre qui cache un contenu ne se supprime pas (HN-E05S10e-3), une copie ne recopie ni règle ni descendant illisible (HN-E05S10e-6).
- Le lien public est borné à ce que son auteur lit à l'instant, et jamais posé sur un espace personnel ou un Contexte (HN-E05S10e-19, HN-E05S10e-21).
- Une adresse nue ne montre jamais identifiant ni mot de passe, et son hôte vient de `new URL` (HN-E11S15-b8).

## Écart avec le code

- M95 : la cause de l'étirement d'une image observé en 1.1.1 n'est établie que dans le code ; à confirmer à la campagne visuelle M96, à chaque largeur.
- M96 : campagne visuelle d'AC-a3, AC-a4, AC-a5, AC-a8 et AC-b7, dans les deux thèmes.
- M94 : le résumé que la base pose sur un Contexte d'équipe ou de Tout le monde garde l'ancien texte (HN-E11S15-a6) ; le changer demande une migration.
- M66 : `ContenusLies` (`ui/noeud/sous-pages.tsx`) recopie les sous-pages dans son repli pendant le flux.
- M101 : `TableCell` force une mise en page par cellule (troncature du texte).
- M103 : à 375 px, l'en-tête de la visionneuse d'un fichier fait défiler la zone de contenu en largeur.

## Questions ouvertes

Aucune à ce jour.

## Historique

- 2026-09-27 : retours d'édition des pages, procédures et tableaux : création depuis le rail, rangement, duplication, corbeille, « Partager » et lien public — décidé par JB (source : story E05-S10, ADR-013, ADR-014).
- 2026-09-29 : encarts repliables à droite, cellules, lignes à revoir, télécharger, résumé, page et tableau vides ; « Importer un fichier… » au-dessus d'un tableau — décidé par JB et le responsable d'Oto (source : fiches D136, D140, story E11-S05).
- 2026-09-30 : retours sur la 1.1.1, livrés dans la 1.1.2 : encarts de la vue « Contexte », mise en page centrée, panneaux larges, liens au repos, contenus récents de « @ » — décidé par JB (source : story E11-S15).
- 2026-10-01 : refonte en document de conception vivant, qui reprend P18, les fiches D97, D140 et les choix des stories E05-S10, E11-S05, E11-S15 — décidé par Alexis, accord de JB.
- 2026-10-20 : provenance par une icône « info » et un panneau, cellules de texte qui vont à la ligne, liens suivis dans les cellules, adresses raccourcies — décidé par JB (source : session du 20/10/2026).
