# Story — Éditeur visuel : la source d'un bloc ne s'affiche jamais, plusieurs blocs se sélectionnent d'un coup

## Meta

| Champ | Valeur |
|-------|--------|
| **Épic** | Retours de la démo |
| **Parcours** | 4.4 Concevoir et mettre à jour (écrire et organiser le contenu) |
| **Statut** | ⬜ Reportée : le **lot a** (sélection de blocs) est livré dans la 1.1.2 ; restent les lots 0, b à f, reportés avec ADR-021 (JB, 2026-09-30 : trop long pour le besoin), conception dans `docs/conception/editeur-de-blocs.md` |
| **Priorité** | Should — version 1.2.0 |
| **Référence UI** | oto-frontend (`C:\apps\oto-frontend`, lecture seule) : aucune pour le champ visuel (son `BlockField` est un `<textarea>` et refuse `contentEditable`, `src/design-system/components/react/blocks.jsx`) ; ses maquettes posent les citations dans la phrase (`wf-cite`, cité par `src/design-system/components/css/blocks.css`). Le reste : écrans actuels du paquet, dans leur style |
| **Conventions** | portage, a11y, security, performance, registry, state, testing |
| **Estimation** | XL au total, découpée en sept lots de S à L (`story-ready.md` : jamais XL) ; à scinder en stories à l'acceptation si le pilote le préfère |
| **Dépend de** | E11-S15 lot B fusionné (AC-b6, AC-b7, AC-b9 : rendu au repos, correcteur, clic et menu contextuel d'un lien) ; ADR-021 accepté |
| **Porteuse de migration** | Non |

## Contexte

Retours du responsable d'Oto du 2026-09-30 :

1. **La source ne s'affiche jamais.** Aujourd'hui, un bloc texte s'écrit dans un `<textarea>` (fiche D21,
   option B) : au repos, son rendu est posé dessus (liens par leur titre, gras, italique, code, barré) ; au
   focus, la source paraît (`[[private/<handle>/procedures|Mes procédures]]`, `**gras**`, la marque `  - `
   d'un sous-élément). C'est D107 (« au focus, le texte brut ») et HN-E05S11-17. Il veut un vrai éditeur
   visuel pour le texte en ligne : liens montrés par leur titre, gras en gras, même pendant la frappe.
   Tout le reste continue de marcher, et le stockage reste le markdown actuel. E11-S15 AC-b8 l'avait remis à
   l'évaluation.
2. **Sélectionner plusieurs blocs pour les supprimer**, à la souris (sélection tirée à travers les blocs)
   comme au clavier (Ctrl+A sur toute la page). Aujourd'hui Ctrl+A ne prend que le bloc courant et ouvre le
   menu de sa poignée (E05-S11 AC-28) ; une sélection ne traverse pas deux champs.

La décision technique est proposée par **ADR-021** (statut Proposé) : un éditeur ProseMirror par bloc, un
modèle en ligne propre lu et écrit en markdown, et une sélection de blocs tenue par l'éditeur au-dessus des
champs. Les options, mesures et alternatives y sont ; leur résumé et la question sont ci-dessous.

**Refs :**
- PRD : FR-CONC-03 (éditeurs web, « @ »), FR-CONC-10 (listes imbriquées, marques en ligne, aller-retour)
- Architecture : § 2 Stack, § 3 Structure (face `ui/`), § 5 (`schemas/link-syntax.ts`, seul lecteur des
  liens) ; ADR-008 (écrans portés), ADR-011 (blocs), ADR-021
- Stories : E05-S02 (champ, file d'opérations), E05-S08 (clavier), E05-S10 (« @ », menu de la poignée,
  glisser), E05-S11 (AC-26 à AC-28, D107), E10-S01 (collage tolérant), E10-S02 (fichiers), E10-S04 (marques,
  listes), E10-S06 (« / », `Tab`, tableau simple, repli), E11-S06 (panneau « Lien », repères de liste),
  E11-S15 lot B

## Options et question

Résumé d'ADR-021 (coûts : S ≤ 1 jour, M 2 à 3 jours, L 4 à 6 jours ; totaux en ordre de grandeur, à
confirmer par le lot 0). « Blocs » : sélection de blocs entiers (Ctrl+A une seconde fois, Maj+↑↓ depuis un
bloc sélectionné, rectangle tiré depuis la marge) et suppression, copie, déplacement groupés avec un seul
« Annuler ». « Texte » : sélection de texte partielle qui traverse plusieurs blocs.

| Option | Coût | Risques | Dépendance | Texte à travers les blocs | Blocs |
|---|---|---|---|---|---|
| **A. ProseMirror, un éditeur par bloc** (recommandée) | XL, ≈ 23 j en 7 lots (dont la sélection de blocs, L) | IME, touches mortes, Android, lecteurs d'écran à prouver ; tests d'intégration du champ à réécrire ; e2e hors `pnpm verify` | 8 paquets MIT d'un seul mainteneur, 1.x stable, ≈ 66 Ko gzip chargés à la demande | Non : un glissé qui quitte son bloc sélectionne des blocs entiers (comme Notion) | Oui, lot a |
| B. `contenteditable` écrit à la main | XL+, ≈ 40 j et plus | Très élevé : `beforeinput`, IME, Android, historique, presse-papiers à écrire | Aucune | Non (comme A) | Oui, lot a |
| C. `<textarea>` gardé, liens par leur titre seulement | M (≈ 5 j) + lot a (L) | Faible ; mais `**gras**` et `  - ` restent visibles au focus : demande 1 à moitié | Aucune | Non | Oui, lot a |
| D. Lexical, un éditeur par bloc | ≈ A | 0.x : changements cassants à chaque mineure ; ≈ 20 paquets `@lexical/*` | ≈ 79 Ko gzip | Non | Oui, lot a |
| E. TipTap 3, un éditeur par bloc | ≈ A | Surcouche à payer pour peu de code évité ; instance lourde par bloc ; `immediatelyRender: false` | ≈ 128 Ko gzip avec `starter-kit` | Non | Oui, lot a |
| F. Un seul document ProseMirror pour la page | ≈ 2 × A (≈ 45 j) | Réécriture de l'éditeur de blocs entier (rangées, poignées, menus, glisser, blocs sans texte, conflit, file d'opérations par différence) ; régressions possibles sur tous les AC d'éditeur d'E05 à E11 | ≈ 66 Ko gzip | **Oui**, natif (glissé, Maj+clic, Ctrl+A), suppression à cheval qui fusionne | Oui, natif, un seul historique texte et structure |

**Sélection par les poignées d'abord (Maj+clic, Ctrl+clic, puis Suppr) : rien n'est jeté avec A, B, C, D ou
E.** L'état de la sélection, le surlignage des rangées, l'écriture groupée (plusieurs opérations dans un seul
corps de `POST nodes`), l'« Annuler » groupé et la copie en markdown vivent dans l'éditeur, au-dessus des
champs, et ne lisent du champ que « tout son texte est-il sélectionné » (une fonction à changer de
`<textarea>` à ProseMirror, quelques lignes). Seule l'option F les remplacerait par la sélection du document
unique. D'où le lot a, livrable avant ou en parallèle de l'éditeur visuel, sur le champ actuel.

**Réponse de JB (2026-09-30)** : aucune des options A, F ou C, jugées trop longues pour le besoin ; pas non plus de version légère des liens pendant la frappe (la source reste visible au focus, rendue au repos, sans soulignement rouge, lien édité au clic droit : E11-S15). **Seul le lot a (sélection de blocs) est retenu, livré en premier** ; ADR-021 est reporté.

### Q-S17 — La question au responsable d'Oto

**Quel éditeur, pour quelle sélection ?**

1. **(Recommandé) A : ProseMirror bloc par bloc, et sélection de blocs à la Notion.** La source ne paraît
   plus nulle part ; un glissé à travers les blocs, Ctrl+A deux fois, Maj+↑↓ ou le rectangle sélectionnent
   des blocs entiers, qui se suppriment, se copient, se déplacent ensemble, avec un seul « Annuler ». Pas de
   sélection d'une fin de bloc au début d'un autre. ≈ 23 jours, 1.2.0 ; la sélection de blocs (lot a) peut
   sortir la première, sur le champ actuel.
2. **F : un seul document pour la page.** Tout ce que donne A, plus la sélection de texte partielle à
   travers les blocs et un seul historique. ≈ 45 jours, réécriture de l'éditeur de blocs, risque de
   régression large. A n'empêche pas d'y aller plus tard (même bibliothèque, même schéma).
3. **C : liens seulement, et sélection de blocs.** ≈ 10 jours, sans dépendance ; le gras, l'italique et les
   marques de liste restent visibles au focus.

Sous-question, si 1 ou 3 : **livrer le lot a (sélection de blocs) avant l'éditeur visuel ?** Recommandé :
oui, il ne sera pas jeté et répond seul à la seconde demande.

## Périmètre

(Pour l'option A ; une autre réponse à Q-S17 réécrit cette section.)

- Texte en ligne en visuel dans : Texte, titre, citation, listes à puces, numérotées et à cocher, cellules
  d'un tableau simple, résumé et corps d'un repli.
- Liens en atomes (page, adresse web) : titre montré, suivis au clic gauche, édités au menu contextuel par
  le panneau « Lien » d'E11-S06.
- Marques (gras, italique, code, barré) au raccourci et par la saisie markdown.
- « @ », « / », `Tab` des listes, Entrée, Retour arrière, ⇧Entrée, ⌥↑↓, Échap, ⌘S, collage, dépôt de
  fichiers, annuler et refaire dans un champ.
- Sélection de blocs entiers et gestes groupés (supprimer, copier, couper, déplacer) avec un seul
  « Annuler ».
- Stockage, `read`, `write`, publication, lecture, page publique, export `.md` : inchangés.

## Hors périmètre

- Sélection de texte partielle à travers deux blocs, suppression à cheval qui fusionne, historique unique
  texte et structure : option F d'ADR-021, V2 si Q-S17 ne la retient pas.
- Barre d'outils flottante de mise en forme sur une sélection : V2 si le besoin revient (les raccourcis et
  la saisie markdown suffisent ici).
- Code et appel déjà écrit (M59) : leur texte est leur source, ils restent des `<textarea>`.
- Titre et résumé de l'en-tête d'un contenu : texte brut, inchangés.
- Sélection de blocs au doigt (tactile) : V2.
- « @ » qui montre les contenus récents avant la frappe : E11-S15 AC-b4.
- Écriture à plusieurs en temps réel : aucune (pas de Yjs).

## Critères d'acceptation

### Lot 0 — Essai (S, jetable, rien n'est fusionné)

- [ ] **AC-01 — Essai de la bibliothèque retenue.** **Given** un prototype d'un bloc Texte dans un worktree
  **Then** la story note, avant le lot b : la saisie avec touches mortes (ê, ç, œ sur clavier français) et
  une composition IME dans Chrome, Firefox et Safari ; la saisie Gboard sur Android ; la lecture par NVDA
  (Firefox) et VoiceOver (Safari) d'un texte avec un lien ; ce que jsdom sait tester (frappe, sélection) ;
  le poids ajouté au `next build` de l'hôte. Un échec bloquant renvoie à Q-S17.

### Lot a — Sélection de blocs (L, sur le champ actuel)

- [ ] **AC-a1 — Glissé à travers les blocs.** **Given** un glissé du pointeur commencé dans le texte d'un bloc
  **When** le pointeur entre dans un autre bloc **Then** la sélection devient celle des blocs entiers, du bloc
  de départ au bloc sous le pointeur, vers le haut comme vers le bas, surlignés ; aucun champ ne garde de
  sélection de texte. **When** le pointeur revient dans le bloc de départ avant d'être relâché **Then** c'est
  de nouveau une sélection de texte dans ce bloc.
- [ ] **AC-a2 — Ctrl+A, ⌘A.** **Given** le focus dans un champ **When** Ctrl+A une première fois **Then** tout
  le texte du bloc est sélectionné et le menu de sa poignée s'ouvre comme aujourd'hui (E05-S11 AC-28).
  **When** Ctrl+A de nouveau (texte du bloc déjà tout sélectionné, ou bloc vide) **Then** tous les blocs de la
  page sont sélectionnés, le menu se ferme, le focus passe à l'éditeur.
- [ ] **AC-a3 — Clavier.** **Given** Échap dans un champ (le texte part, le focus va à la poignée, E05-S08)
  **Then** ce bloc est sélectionné. **When** Maj+↑ ou Maj+↓ **Then** la sélection s'étend ou se réduit d'un
  bloc ; ↑ ou ↓ seuls la déplacent d'un bloc ; Entrée rend le focus au champ du bloc sélectionné, curseur à
  la fin ; Échap vide la sélection.
- [ ] **AC-a4 — Poignées.** **When** Maj+clic sur la poignée d'un bloc **Then** la sélection s'étend du
  dernier bloc sélectionné à celui-ci. **When** Ctrl+clic ou ⌘+clic **Then** ce bloc entre dans la sélection
  ou en sort. Un clic simple ouvre le menu comme aujourd'hui.
- [ ] **AC-a5 — Rectangle.** **Given** un appui du pointeur dans la marge de la page (hors d'un champ, d'une
  poignée, d'un bouton, d'un lien) **When** il glisse **Then** un rectangle se dessine et les blocs qu'il
  croise sont sélectionnés au fil du geste ; relâché, la sélection reste.
- [ ] **AC-a6 — Suppression groupée.** **Given** une sélection de blocs **When** Suppr ou Retour arrière, ou
  « Supprimer » au menu de la poignée d'un bloc sélectionné **Then** tous les blocs sélectionnés partent en
  **une** écriture (autant d'opérations `delete_block` dans un seul corps, refusé en entier si l'une l'est) ;
  l'annonce dit « N blocs supprimés. » avec « Annuler », qui les rétablit tous à leur place en une fois ;
  Ctrl+Z ou ⌘Z pendant l'annonce fait de même. **Given** un bloc en conflit dans la sélection **Then** rien
  n'est supprimé et l'annonce le dit. Tous les blocs retirés : la page garde son Texte vide (E11-S05 AC-g1).
- [ ] **AC-a7 — Copier, couper.** **When** ⌘C ou Ctrl+C sur une sélection de blocs **Then** le presse-papiers
  reçoit leur markdown en `text/plain`, le même que l'export `.md` (`renderBlocks`,
  `schemas/blocks-render.ts`) ; collé dans un bloc de cette page ou d'une autre, il s'insère par le collage
  tolérant (E10-S01 AC-a1). **When** ⌘X **Then** copier, puis AC-a6.
- [ ] **AC-a8 — Déplacement groupé.** **When** ⌥↑ ou ⌥↓, ou le glissé de la poignée d'un bloc sélectionné
  **Then** le groupe se déplace, dans l'ordre de la page, en une écriture de `move_block` ; l'annonce offre
  « Annuler », qui remet chaque bloc à sa place.
- [ ] **AC-a9 — Accessibilité et thèmes.** Le nombre de blocs sélectionnés s'annonce dans une région vivante
  (« 3 blocs sélectionnés ») ; un bloc sélectionné porte un fond et une bordure lisibles dans les deux thèmes
  (bordure à 3:1 au moins) et en couleurs forcées (`Highlight`) ; toute la sélection se fait au clavier seul.
- [ ] **AC-a10 — Publication.** Une suppression ou un déplacement groupé déclenche la publication seule (3 s)
  comme une frappe (E05-S10 AC-a6).

### Lot b — Modèle en ligne (M, fonctions pures)

- [ ] **AC-b1 — Stabilité.** **Given** tout texte de bloc des tests existants (`tests/unit/ui-en-ligne*.test.ts`,
  `ui-editeur-liens.test.ts`, `ui-editeur-liens.test.ts`, fixtures d'E10-S04) et du script de démo **When** il est
  lu en document puis réécrit sans changement **Then** la source est identique à l'octet près (`_it_` reste
  `_it_`, `<br/>` reste `<br/>`, `\*` reste `\*`, un `[[a|  T ]]` reste tel quel).
- [ ] **AC-b2 — Fidélité.** **Given** un document écrit par l'éditeur (marques, atomes, et les caractères
  littéraux `*`, `_`, `~`, `` ` ``, `[[`, `\`, `<br>` tapés en texte) **When** il est écrit puis relu par
  `segmentsEnLigne` **Then** le rendu est le même document : un caractère qui serait relu en syntaxe est
  échappé, et seulement lui.
- [ ] **AC-b3 — Un seul lecteur des liens.** Un `[[…]]` devient un atome de lien si et seulement si `linksIn`
  (`schemas/link-syntax.ts`) l'extrait : dans un span de code ou après `\[[`, il reste du texte.
- [ ] **AC-b4 — Positions.** Un rang de la source et une position du document se convertissent l'un en
  l'autre, un atome comptant pour une position ; jamais un rang au milieu d'une marque ni d'un lien.
- [ ] **AC-b5 — Temps linéaire.** Lecture et écriture de 100 000 caractères adverses (suites de `*`, `[[`,
  `` ` ``, `\`) en temps linéaire (`tests/helpers/temps-lineaire.ts`).

### Lot c — Champ visuel : Texte, titre, citation (L)

- [ ] **AC-c1 — La source ne paraît jamais.** **Given** un bloc qui porte `**gras**`, `_italique_`, du code,
  du barré, `[[chemin|Titre]]`, `[texte](https://…)`, une adresse nue **When** il a le focus, qu'on y tape,
  qu'on sélectionne, qu'on annule **Then** le champ ne montre aucun balisage (`**`, `_`, `` ` ``, `~~`, `[[`,
  `|`, `](`, `\`) : il se lit comme en lecture, au repos comme au focus.
- [ ] **AC-c2 — Marques.** **When** ⌘B, ⌘I, ⌘E, ⌘⇧X (Ctrl sous Windows et Linux) **Then** gras, italique,
  code, barré s'appliquent ou se retirent sur la sélection, ou pour la frappe qui suit. **When** on tape
  `**mot**`, `*mot*`, `_mot_`, `` `mot` `` ou `~~mot~~` **Then** la marque s'applique à la fermeture ;
  Retour arrière aussitôt après rend le texte littéral.
- [ ] **AC-c3 — Un lien est un atome, montré par son titre.** Titre selon D107 (libellé écrit, titre de la
  cible connue, dernier segment ; texte ou domaine d'une adresse web), dans le style d'un lien de lecture ;
  le curseur le saute d'une touche, Retour arrière ou Suppr le retire en entier, la frappe n'y entre jamais.
- [ ] **AC-c4 — Suivre, modifier un lien.** **When** clic gauche sur un lien **Then** il est suivi (page :
  `<a href>` dans l'onglet ; adresse web : nouvel onglet `noopener noreferrer nofollow` ; Ctrl, ⌘ ou bouton
  du milieu : nouvel onglet). **When** clic droit, touche Menu ou Maj+F10 sur un lien, ou Alt+Entrée le lien
  sélectionné au clavier **Then** le panneau « Lien » (E11-S06 AC-b3 à AC-b8) s'ouvre sur lui ; « Appliquer »
  et « Retirer le lien » changent l'atome ; Échap rend le focus au champ, curseur après le lien.
- [ ] **AC-c5 — « @ ».** Même liste, mêmes touches qu'aujourd'hui (E05-S10 AC-a9) ; le choix insère un atome
  de lien, curseur après lui.
- [ ] **AC-c6 — « / ».** Dans un Texte vide, « / » ouvre le choix des blocs (E10-S06 AC-a2), inchangé.
- [ ] **AC-c7 — Clavier d'un bloc.** Entrée scinde au curseur, marques refermées et rouvertes de part et
  d'autre (`**gr|as**` donne `**gr**` puis `**as**`), jamais un lien coupé ; Retour arrière au début fusionne
  avec le bloc d'avant, marques réunies (`**a**` + `**b**` donne `**ab**`) ; ⇧Entrée va à la ligne (refusé
  dans un titre, « Un titre tient sur une ligne. ») ; ⌥↑ ⌥↓, Échap, ⌘S comme aujourd'hui (E05-S08 AC3).
- [ ] **AC-c8 — Annuler, refaire.** ⌘Z, ⌘⇧Z, Ctrl+Y dans un champ annulent et refont la frappe (groupée),
  une marque, un lien inséré par « @ », un lien changé par le panneau, un collage ; jamais un autre bloc.
- [ ] **AC-c9 — Collage.** Seul `text/plain` est lu, même quand `text/html` est présent. Une ligne collée est
  lue en markdown en ligne (`**x**` collé devient gras, `[[a/b|T]]` un lien « T ») ; Ctrl+Maj+V la garde
  littérale (échappée au stockage) ; plusieurs lignes s'insèrent après le bloc en mode tolérant (E10-S01
  AC-a1) ; un tableur dans un Texte vide devient un tableau simple (E10-S06 AC-b3) ; une image collée se
  joint (E10-S02 AC-b1). La copie d'une sélection du champ met sa source markdown en `text/plain`.
- [ ] **AC-c10 — IME et touches mortes.** ê, ç, œ tapés par touches mortes et une composition IME donnent le
  texte exact, sans doublon ni perte, en une étape d'historique ; l'envoi différé (1 200 ms) n'interrompt
  jamais une composition.
- [ ] **AC-c11 — Dépôt.** Un fichier lâché sur le champ va à sa rangée (E10-S02 AC-b4), un `.md` s'insère
  (E10-S01 AC-a4) ; un texte glissé dans le champ reste possible ; aucun HTML lâché n'est lu.
- [ ] **AC-c12 — Envoi et conflit.** Chaque changement rend le markdown du champ à la file ; D21 tient (sortie
  du champ, ⌘S, 1 200 ms) ; les bornes se contrôlent sur la source (100 000 caractères, `operations.ts`) ;
  en conflit, le champ n'est pas modifiable (`aria-readonly`) et « Réglez d'abord le bloc en conflit. »
  s'annonce au focus.
- [ ] **AC-c13 — Accessibilité.** Le champ est un `role="textbox"` nommé comme aujourd'hui (« Modifier ce
  texte — … »), `aria-multiline` sauf un titre ; « @ », « / » et le panneau gardent `aria-describedby`,
  `aria-controls`, `aria-activedescendant` ; un lien s'annonce « lien, <titre> » ; le correcteur
  orthographique du navigateur reste actif (plus de source à souligner) ; le contour tient en couleurs
  forcées.
- [ ] **AC-c14 — Deux thèmes.** Liens, code, sélection de texte lisibles en clair et en sombre, texte à 4,5:1
  au moins, sur les jetons du paquet.
- [ ] **AC-c15 — Chargement.** Avant que l'éditeur soit chargé, le bloc montre son rendu de lecture (rendu
  aussi au serveur) ; au chargement, la boîte du bloc ne bouge pas (à 1 px près).

### Lot d — Listes (M)

- [ ] **AC-d1 — Éléments visibles.** Chaque élément est une ligne de l'éditeur, son repère (puce, numéro depuis
  `start` au premier niveau seul, case) dessiné sur sa première ligne ; un sous-élément est en retrait, sa
  marque écrite (`  - `, `  1. `) jamais visible. Le texte stocké est celui d'aujourd'hui (`texteDe`,
  `ecrireTexte`, `modele.ts`).
- [ ] **AC-d2 — `Tab`, `Maj+Tab`.** Changent le niveau de l'élément du curseur, mêmes refus annoncés
  qu'E10-S06 AC-a6 (trois niveaux, rien au-dessus, premier niveau), curseur gardé dans son texte.
- [ ] **AC-d3 — Entrée, Retour arrière.** Entrée ajoute un élément au même niveau ; Entrée sur un dernier
  élément vide sort de la liste (E05-S10 AC-a2) ; Retour arrière au début d'un élément le réunit au précédent,
  au début du premier élément fusionne avec le bloc d'avant.
- [ ] **AC-d4 — Cases.** Une case par élément, nommée, cochée au clic ou au clavier, son état parti tout de
  suite (E05-S10 AC-a2).
- [ ] **AC-d5 — En ligne.** Liens, marques, « @ », collage d'une ligne dans un élément comme au lot c.

### Lot e — Tableau simple et repli (M)

- [ ] **AC-e1 — Cellules.** Chaque cellule d'un tableau simple est un champ visuel d'une ligne (marques,
  liens, « @ ») ; `Tab`, `Maj+Tab`, Entrée comme E10-S06 AC-b1 ; un `|` écrit reste échappé au stockage.
- [ ] **AC-e2 — Repli.** Résumé (une ligne) et corps (plusieurs lignes) en champs visuels ; Entrée dans le
  résumé passe au corps ; Retour arrière dans un corps vide revient au résumé (E10-S06 AC-b4).

### Lot f — Finitions (M)

- [ ] **AC-f1 — Plus de calque.** `rg -n "oto-block-pile|oto-block-rendu|data-rendu|oto-block-copie|TexteAuRepos|ElementsDeListe|aDuBalisage" C:/apps/oto-pkg/packages`
  ne trouve plus rien.
- [ ] **AC-f2 — Rien d'autre ne bouge.** Lecture, page publique, `read`, `write`, publication, `context`,
  export `.md` : leurs tests passent sans changement d'attente ; aucune migration, aucun export du paquet
  retiré.
- [ ] **AC-f3 — Poids.** Le code de l'éditeur visuel ne se charge que sur un écran qui édite (morceau séparé du
  `next build` de l'hôte) ; le job `packed-host-build` de la CI passe ; le poids ajouté est écrit en
  post-implémentation.
- [ ] **AC-f4 — Aller-retour sur la démo.** Chaque bloc des contenus du script de démo, ouvert dans l'éditeur
  puis quitté sans frappe, n'envoie aucune écriture (stabilité, AC-b1, vue de bout en bout).

## Implémentation

### Migrations prévues
Aucune : l'éditeur change, pas les données.

### Schémas Zod partagés
Aucun nouveau. Le texte envoyé passe `controler` puis `blockInputSchema` comme toute frappe ; le lecteur des
liens reste `schemas/link-syntax.ts`.

### Dépendances (lot b)
`packages/plateforme/package.json`, `dependencies`, versions exactes : `prosemirror-model` 1.25.12,
`prosemirror-state` 1.4.4, `prosemirror-view` 1.42.6, `prosemirror-transform` 1.12.2, `prosemirror-history`
1.5.1, `prosemirror-keymap` 1.2.3, `prosemirror-commands` 1.7.2, `prosemirror-inputrules` 1.5.1 (versions du
2026-09-30, relues au lot b). Racine : `devDependencies` si un test importe l'une d'elles (pnpm ne résout que
les dépendances de la racine, comme pour `aws4fetch`).

### Fichiers à créer (face `ui/`)
Tous sous 300 lignes (`coding-standards.md § Complexité`).
- **Lot a** : `ui/noeud/editeur/selection-de-blocs.ts` (`useSelectionDeBlocs` : état, glissé qui change de
  bloc, rectangle, clavier, annonce).
- **Lot b** : `ui/noeud/editeur/visuel/schema.ts` (schéma ProseMirror : texte, marques, atomes, lignes à
  niveau) ; `visuel/lecture.ts` (markdown en document) ; `visuel/ecriture.ts` (document en markdown) ;
  `visuel/positions.ts` (rang de la source ↔ position).
- **Lot c** : `visuel/champ-visuel.tsx` (le champ : `EditorView` monté une fois, chargé par `import()`, rendu
  de lecture avant) ; `visuel/vue-du-lien.ts` (vue de l'atome, `<a>` non éditable) ; `visuel/raccourcis.ts`
  (marques, Entrée, Retour arrière, `Tab`, vers les gestes) ; `visuel/saisie.ts` (règles de saisie
  markdown) ; `visuel/presse-papiers.ts` (collage, copie, dépôt : `text/plain` seul).
- Tests : `tests/unit/e11s16-modele-en-ligne.test.ts`, `tests/unit/e11s16-selection.test.ts`,
  `tests/integration/components/e11s16-editeur.test.tsx`, `tests/e2e/e11s16-editeur.spec.ts`.

### Fichiers à modifier
- **Lot a** : `ui/noeud/editeur/editeur-de-blocs.tsx` (sélection montée, clavier et pointeur de la zone) ;
  `rangee-de-bloc.tsx` (état sélectionné, Maj+clic et Ctrl+clic de la poignée) ; `actions.ts` (supprimer,
  couper, déplacer un groupe) ; `gestes.ts` (types) ; `modele.ts` (retirer, rétablir, déplacer plusieurs
  rangées) ; `use-envois.ts` (une écriture de plusieurs opérations, annonce groupée) ; `lignes-d-etat.tsx`
  (« N blocs supprimés. ») ; `glisser.ts` (glisser un groupe) ; `champ-de-bloc.tsx` (second Ctrl+A, glissé
  qui sort du champ) ; `ui/noeud/libelles.ts` ; `ui/ds/components/css/editeur.css` (surlignage, rectangle).
- **Lot b** : `ui/noeud/en-ligne.ts` (la forme écrite de chaque segment en champ facultatif ; `Segment` lu
  par le rendu inchangé pour lui).
- **Lot c** : `champ-de-bloc.tsx` (monte `ChampVisuel` pour Texte, titre, citation ; `TexteAuRepos` retiré) ;
  `clavier.ts` et `modele.ts` (scinder et fusionner sur deux textes écrits par le document, plus sur un rang) ;
  `citer.tsx` (`citationAuCurseur` lu sur le texte de la ligne) ; `choix-de-bloc.tsx` (« / » lu sur le
  document) ; `lien-du-bloc.tsx` (panneau ouvert sur un atome, écrit par l'atome) ; `use-editeur.ts` (focus
  posé en position du document) ; `editeur.css` (règles de base de ProseMirror, lien atome) ;
  `ui/noeud/libelles.ts`.
- **Lot d** : `champ-de-bloc.tsx` ; `blocs-de-page.ts` (`niveauDeLigne` repris sur les lignes) ;
  `elements-de-liste.tsx` supprimé ; `ui/ds/components/css/blocks.css`, `editeur.css`.
- **Lot e** : `tableau-edite.tsx`, `repli-edite.tsx`.
- **Lot f** : restes du calque ; `docs/reference/pile-et-structure.md` ; `.method/conventions/tech-stack.md`,
  `accessibility-patterns.md § Keyboard Navigation` (exception du champ d'un bloc réécrite pour le champ
  visuel), `component-registry.md` ; `docs/conception/editeur-de-blocs.md` (décision, amendement de D107) ;
  `packages/plateforme/CHANGELOG.md` et `package.json` (1.2.0)
  (ligne OUT retirée).
- **Tests existants réécrits** (frappe et valeur du champ ; voir « Appelants ») : lot c et lot d.

### Points de départ
- `segmentsEnLigne`, `liensDuTexte`, `titreDuLien`, `libelleDUneAdresse` (`ui/noeud/en-ligne.ts`), `linksIn`,
  `codeSpans`, `escaped` (`schemas/link-syntax.ts`) : la lecture existe, l'écriture est son inverse.
- `avecLeLien`, `sansLeLien` (`lien-du-bloc.tsx`) : la relecture qui refuse un lien illisible, reprise pour
  écrire un atome.
- `renderBlocks` (`schemas/blocks-render.ts`) pour la copie groupée ; `insererDuMarkdown` pour son collage.
- `retablirSuppression` et `Retiree` (`actions.ts`, `modele.ts`) pour l'« Annuler » groupé ; `useGlisser`
  (`glisser.ts`) pour le glisser d'un groupe ; l'annonce de `lignes-d-etat.tsx`.

### Patterns à suivre
- `performance-patterns.md § Code Splitting` : `import()` dynamique (`ui/` n'importe pas `next/dynamic`).
- `security-patterns.md § XSS Prevention`, `§ Validation des inputs` (temps linéaire).
- `accessibility-patterns.md § Keyboard Navigation`, `§ ARIA`, `§ Focus Management`, `§ Couleurs & Contraste`.
- `portage-ecrans.md § 2` (client au plus bas), `§ 3` (jetons Oto, deux thèmes), `§ 5` (écarts listés).

### Canaux de sécurité
- **Fermé — HTML collé, déposé ou glissé** : seul `text/plain` est lu ; aucune règle `parseDOM`. Test : collage
  portant `text/html` `<img src=x onerror=…>` et `text/plain` « a » : le champ reçoit « a », aucun élément
  `img`.
- **Fermé — adresse dangereuse** : un atome ne naît que de la lecture du markdown (`LIEN_WEB`, `ADRESSE_WEB`,
  `http(s)` seuls) ou du panneau (`https://` relu, HN-E11S06-4). Test : `[x](javascript:alert(1))` reste du
  texte, sans `href`.
- **Fermé — écriture de HTML** : le DOM du champ se construit par le schéma (nœuds texte, `<a>` à `href`
  calculé), jamais par `innerHTML`. Contrôle : `rg -n "innerHTML|dangerouslySetInnerHTML" C:/apps/oto-pkg/packages/plateforme/ui/noeud`
  ne trouve rien hors `diagramme-mermaid.tsx` (1.1.3 : SVG assaini par mermaid, `security-patterns.md § XSS Prevention`).
- **Fermé — expression adverse** : lecture et écriture linéaires (AC-b5).
- **Ouvert, assumé** : la copie depuis un champ écrit aussi un `text/html` (sérialiseur du presse-papiers de
  ProseMirror) ; il ne porte que le rendu déjà affiché (texte, liens de la page). Aucun appel réseau nouveau.

## Rayon d'impact

Relevé du 2026-09-30 sur le checkout principal (lots d'E11-S15 en cours dans les mêmes fichiers : à relever
de nouveau au lot a).

### Appelants
- `ChampDeBloc` : `rg -n "ChampDeBloc|champ-de-bloc" C:/apps/oto-pkg/packages C:/apps/oto-pkg/src C:/apps/oto-pkg/tests`
  → rendu seul par `editeur/rangee-de-bloc.tsx` (l. 55, 211) ; type `LiensDesBlocs` importé par
  `lien-du-bloc.tsx`, `elements-de-liste.tsx`, `editeur-de-blocs.tsx`. Props gardées ; `LiensDesBlocs`
  reste.
- Éditeur monté : `rg -n "<EditeurDeBlocs" C:/apps/oto-pkg/packages C:/apps/oto-pkg/src` →
  `ui/noeud/corps-du-noeud.tsx` l. 139 (pages, procédures, Contextes) et `ui/contexte/contexte-servi.tsx`
  l. 87 (vue « Contexte ») : même effet sur les deux.
- Calque et copie : `rg -n "\bEnLigne\b|TexteAuRepos|ElementsDeListe" C:/apps/oto-pkg/packages C:/apps/oto-pkg/src C:/apps/oto-pkg/tests`
  → `rendu-des-blocs.tsx` (lecture, inchangée), `champ-de-bloc.tsx`, `elements-de-liste.tsx` ; classes :
  `rg -c "oto-block-pile|oto-block-rendu|data-rendu|oto-block-copie|oto-block-element|oto-block-repere" C:/apps/oto-pkg/packages C:/apps/oto-pkg/src C:/apps/oto-pkg/tests`
  → `editeur.css` (19), `blocks.css` (1), `champ-de-bloc.tsx`, `elements-de-liste.tsx` ; tests
  `liens-en-edition.test.tsx` (7), `editeur-de-blocs.test.tsx` (4), `editeur-de-blocs.test.tsx` (4),
  `editeur-blocs-de-page.test.tsx`, `editeur-de-blocs.test.tsx`, `procedure.test.tsx` (1 chacun) ; e2e
  `e11s06-editeur.spec.ts` (3), `e05s11-page.spec.ts`, `e05s10a-edition.spec.ts` (1 chacun). Tous réécrits
  aux lots c et d.
- Opérations sur un rang de la source : `rg -c "\bscinder\(|\bfondre\(|sortirDeLaListe\(|ecrireTexte\(" C:/apps/oto-pkg/packages C:/apps/oto-pkg/tests`
  → `modele.ts` (4), `clavier.ts` (4), `actions.ts` (3), `gestes-du-menu.ts` (1) ; tests
  `ui-editeur-modele.test.ts` (18), `ui-editeur-blocs-de-page.test.ts` (10). `scinder` reçoit deux textes
  au lieu d'un rang ; `ecrireTexte` et `sortirDeLaListe` gardent leur forme.
- Sélection du champ : `rg -c "setSelectionRange|selectionStart|selectionEnd" C:/apps/oto-pkg/packages/plateforme/ui/noeud`
  → `champ-de-bloc.tsx` (4), `clavier.ts` (4), `lien-du-bloc.tsx` (1), `repli-edite.tsx` (1),
  `use-editeur.ts` (1) : chacun passe par `positions.ts` ou par l'état du document.
- Gestes du champ : `rg -c "\.saisir\(|\.citer\(|\.remplacerParChoix\(|\.insererDuMarkdown\(|\.collerUneImage\(" C:/apps/oto-pkg/packages`
  → `champ-de-bloc.tsx` (6), `lien-du-bloc.tsx` (1), `actions.ts` (1). Signatures gardées (markdown en
  entrée). Doublures : `rg -ln "ContexteDesGestes|GestesContext|useGestes" C:/apps/oto-pkg/tests` → aucune.
- Sélection totale et menu (AC-28) : `rg -c "selectionner\(|menuOuvert|fermerLeMenu" C:/apps/oto-pkg/packages/plateforme/ui/noeud/editeur`
  → `rangee-de-bloc.tsx` (8), `champ-de-bloc.tsx` (6), `editeur-de-blocs.tsx` (6), `actions.ts` (3),
  `gestes.ts` (1) : gardés ; le second Ctrl+A s'y ajoute (lot a).
- Suppression et « Annuler » : `rg -c "Retiree|retablirSuppression|envoyerSuppression" C:/apps/oto-pkg/packages C:/apps/oto-pkg/tests`
  → `actions.ts` (7), `use-envois.ts` (6), `modele.ts` (3), `gestes.ts` (2) ; `ui/equipes/repli-du-focus.ts`
  (1) est un homonyme sans lien. Le geste unitaire reste, le groupe s'y ajoute.
- Tests qui tapent dans un champ : `rg -c "toHaveValue|fireEvent\.(change|input)|setSelectionRange|selectionStart" C:/apps/oto-pkg/tests/integration C:/apps/oto-pkg/tests/unit`
  → pour l'éditeur : `liens-en-edition.test.tsx` (34), `editeur-de-blocs.test.tsx` (33), `editeur-blocs-de-page.test.tsx`
  (17), `ecran-de-noeud.test.tsx` (8), `procedure.test.tsx` (7), `editeur-de-blocs.test.tsx` (6),
  `editeur-de-blocs.test.tsx` (2), `fichiers-dans-l-editeur.test.tsx` (2) ; les autres fichiers de la liste visent des
  formulaires hors de l'éditeur, inchangés. Champ nommé : `rg -l "data-champ|oto-block-field|Modifier ce texte" C:/apps/oto-pkg/tests`
  → 22 fichiers (16 d'intégration, 6 e2e), triés au lot c : une assertion sur le nom ou le rôle tient, une
  sur la valeur passe au contenu du champ ou à l'e2e.
- Hôte : `rg -n "segmentsEnLigne|texteLu" C:/apps/oto-pkg/src` → `src/app/(dashboard)/context/page.tsx`,
  `src/app/(dashboard)/n/[...chemin]/page.tsx` (`texteLu`, inchangé). Aucune autre ligne de l'hôte.
- Dépendance existante : `rg -n "prosemirror|lexical|tiptap|slate-react" C:/apps/oto-pkg/package.json C:/apps/oto-pkg/packages/plateforme/package.json`
  → rien ; `rg -n -i "contenteditable" C:/apps/oto-pkg/packages C:/apps/oto-pkg/src C:/apps/oto-pkg/tests`
  → rien.

### Doublons
- `component-registry.md`, lignes `EditeurDeBlocs` (`ChampDeBloc`, `ElementsDeListe`, `PanneauDuLien`,
  `useOptionActive`, sélection totale d'un bloc) et `segmentsEnLigne` : **réutilisés** — `segmentsEnLigne`
  comme lecteur, `PanneauDuLien` et `useOptionActive` tels quels, `ListeACiter` et `ListeDesChoix` tels quels ;
  **retirés** : `TexteAuRepos` et `ElementsDeListe`, que le champ visuel rend inutiles.
- Sérialiseur markdown : `rg -n "prosemirror-markdown|markdown-it|remark" C:/apps/oto-pkg/packages C:/apps/oto-pkg/package.json`
  → rien. Verdict : écrire l'inverse de `segmentsEnLigne` ; `prosemirror-markdown` écarté, il lit du
  CommonMark par `markdown-it` et ne connaît ni `[[…]]` ni nos formes écrites (une seconde lecture de la
  syntaxe, que `link-syntax.ts` interdit).
- Sélection de blocs : `rg -n -i "selection|sélection" C:/apps/oto-pkg/packages/plateforme/ui/noeud/editeur`
  → 13 fichiers, qui ne parlent que de la sélection du texte d'un champ (AC-28, `setSelectionRange`) ou du
  choix d'un fichier (« avant la sélection », E10-S02) : aucune sélection de blocs n'existe. `useGlisser` et
  l'annonce de `lignes-d-etat.tsx` sont **réutilisés** pour le groupe.
- Copie en markdown : `renderBlocks` (`schemas/blocks-render.ts`) **réutilisé** ; aucun second rendu.

### Effet produit
- Éditeur de toute page, procédure et Contexte (Tout le monde, équipe, Privé), et vue « Contexte » : même
  champ, même sélection.
- Ce qui voit une différence hors de l'écran modifié : le correcteur orthographique revient sur un texte à
  liens (E11-S15 H-b1 tombe) ; le poids d'un écran qui édite (≈ 66 Ko gzip, à la demande) ; une écriture de
  plusieurs opérations (suppression, déplacement groupés) apparaît au journal comme une écriture, et la
  publication seule suit.
- Inchangés : lecture, page publique, `read`, `write`, publication, `links`, `context`, recherche, export
  `.md`, schéma `platform`, policies, outils MCP, montage chez l'hôte (aucune route, aucun export, aucune
  variable ; la feuille de style reste `ui/styles.css`).

### Refacto
- **Proposé, posé en question (Q-S17, option F)** : un seul document pour la page, qui remplacerait les
  rangées ; ≈ 2 × A. Sans lui : pas de sélection de texte partielle à travers les blocs, deux historiques.
- Écarté : garder le calque au repos à côté du champ visuel (deux rendus du même texte, rien ne le justifie
  une fois la source cachée).
- Écarté : `choix-de-bloc.tsx` repris sur `useOptionActive` (M84) dans cette story : sans lien avec le champ,
  il reste au sprint.
- Option d'un cran plus simple, écartée : B, la même livraison sans dépendance (voir ADR-021) — XL+, et un
  risque qui porte sur la frappe elle-même.

## Hypothèses

À confirmer avec Q-S17 ; chacune s'applique à l'option A.

- **HN-E11S16-1 — Raccourcis des marques** : ⌘B gras, ⌘I italique, ⌘E code, ⌘⇧X barré (Ctrl ailleurs) ; ⌘S
  reste l'envoi, ⌘K la palette. Source : conventions courantes (Notion pour ⌘E, Gmail pour ⌘⇧X).
- **HN-E11S16-2 — Saisie markdown** : la marque s'applique à la fermeture (`**mot**`), Retour arrière la
  défait ; un `[[chemin|Titre]]` tapé devient un atome à son `]]` ; une adresse tapée devient un atome au
  blanc ou à la ponctuation qui la suit, collée tout de suite. Source : habitude des éditeurs à markdown.
- **HN-E11S16-3 — Un lien se montre en lien, pas en pastille** : le style d'un lien de lecture (D107 : « lien
  hypertexte dans la phrase »), un fond léger au survol et quand il est sélectionné pour dire qu'il est
  indivisible. Alternative : la pastille des maquettes d'oto-frontend (`wf-cite`), jamais codée. Source :
  D107.
- **HN-E11S16-4 — Clavier d'un lien** : ← et → le sélectionnent en entier ; Alt+Entrée, touche Menu ou
  Maj+F10 ouvrent le panneau ; Ctrl+Entrée ou ⌘+Entrée le suit ; Entrée seule scinde après lui. Source :
  HN-E11S06-3, E11-S15 AC-b9.
- **HN-E11S16-5 — Premier Ctrl+A** : garde AC-28 (tout le texte, menu de la poignée sans voler le focus) ;
  le second prend la page. Source : E05-S11 AC-28, HN-E05S11-18.
- **HN-E11S16-6 — Groupe non contigu** (Ctrl+clic) déplacé : les blocs se regroupent à la cible, dans l'ordre
  de la page. Source : simple.
- **HN-E11S16-7 — Un bloc en conflit** dans un groupe fait refuser tout le geste, comme `write` refuse tout
  le corps à la première opération refusée. Source : `schemas/nodes.ts` (`ops`).
- **HN-E11S16-8 — Deux historiques** : ⌘Z dans un champ annule le texte de ce champ ; un geste sur des blocs
  s'annule par l'« Annuler » de son annonce, ou ⌘Z tant que l'annonce ou la sélection de blocs est là.
  Scinder et fusionner ne s'annulent pas par ⌘Z, comme aujourd'hui. Source : ADR-021 § 7.
- **HN-E11S16-9 — Vue de conflit** (« Texte final ») : reste un `<textarea>` de source, parce qu'on y compare
  deux versions caractère par caractère. À confirmer : elle montre encore la source.
- **HN-E11S16-10 — Surlignage d'un bloc sélectionné** : le jeton `--oto-bg` (fond) et une bordure primary,
  comme l'en-tête d'un tableau simple (E11-S15 H-b2) ; aucun jeton ajouté. Source : `portage-ecrans.md § 3`.
- **HN-E11S16-11 — Avant le chargement** : un clic dans le rendu d'un bloc pose le curseur à la fin du bloc
  une fois l'éditeur chargé. Source : simple.
- **HN-E11S16-12 — Rectangle** : souris et stylet ; au doigt, V2. Source : hors périmètre.

### Hypothèses du lot a, à l'implémentation (2026-09-30, sur le champ `<textarea>` actuel)

HN-E11S16-5, -6, -7, -8 et -12 tiennent pour le lot a ; HN-E11S16-10 est précisée par HN-E11S17-a2.

- **HN-E11S17-a1 — Le rectangle prend les blocs qu'il couvre en hauteur**, où qu'il soit en largeur : tiré dans la
  marge de gauche (la gouttière, hors des blocs), il prend les blocs d'à côté. La marge : la zone des blocs, une rangée
  ou sa gouttière hors de leurs contrôles ; jamais le rendu d'un bloc lu (son texte reste sélectionnable). Source : AC-a5
  (« depuis la marge »), Notion.
- **HN-E11S17-a2 — Surlignage** : fond `--oto-bg` et contour (`outline`, la boîte ne bouge pas) en `--oto-ink`, la paire
  texte sur fond d'Oto des badges ; `--primary` seul (ambre en clair) ne tient pas 3:1 sur un fond clair. `Highlight`
  en couleurs forcées. Contraste à mesurer à la campagne (aucun navigateur dans la vague). Source : `portage-ecrans.md § 3`.
- **HN-E11S17-a3 — Focus après une suppression groupée** : la poignée du bloc qui précédait le premier retiré, du premier
  restant sinon ; toute la page retirée, le champ du Texte vide (E11-S05, AC-g1). ⌘Z y annule le geste annoncé ; dans un
  champ, ⌘Z reste l'annulation de sa frappe (HN-E11S16-8 : l'annonce, pas le champ). Source : `accessibility-patterns.md
  § Après une action`.
- **HN-E11S17-a4 — ⌘Z** sur la zone des blocs ou une poignée annule toute annonce qui porte « Annuler », celle d'un bloc
  seul comprise ; sans annonce, la touche reste au navigateur. Source : simple.
- **HN-E11S17-a5 — Touches d'une sélection** : sur la zone ou une poignée seulement (un champ garde les siennes). Sur la
  poignée d'un bloc sélectionné, ↑, ↓ et Entrée servent la sélection (AC-a3) et n'ouvrent pas son menu ; sur la poignée
  d'un bloc hors de la sélection, ils restent au bouton (↓ et Entrée ouvrent son menu) ; Espace et le clic l'ouvrent
  toujours. Échap dans un champ sélectionnant le bloc, « Échap puis Entrée » rend le champ au lieu d'ouvrir le menu
  (E05-S10, AC-a2 : aucun test ne jouait ce chemin). ⌘A sur la zone ou une poignée prend aussi toute la page.
  Source : AC-a3 ; la poignée d'un bloc hors de la sélection garde son rôle de bouton de menu (revue du lot a).
- **HN-E11S17-a6 — Bloc neuf jamais envoyé dans un groupe supprimé** : il part sans écriture et ne revient pas par
  « Annuler », comme par « Supprimer » (HN-E05S02-13) ; l'annonce le compte. Source : E05-S02.
- **HN-E11S17-a7 — Maj+clic** étend de l'ancre (le dernier bloc pris seul, par Échap, ↑↓ ou Ctrl+clic) ; deux Maj+clic
  de suite repartent de la même ancre ; sans sélection, il prend le bloc seul. Un clic simple sur la poignée d'un bloc
  hors de la sélection la vide et ouvre le menu ; sur un bloc sélectionné, il ouvre le menu et garde la sélection.
  Source : Finder, Notion.
- **HN-E11S17-a8 — Menu d'un bloc sélectionné parmi d'autres** : « Supprimer », « Monter » et « Descendre » agissent sur
  le groupe ; « Dupliquer » et « Style » restent au bloc. Source : AC-a6 (« Supprimer » au menu).
- **HN-E11S17-a9 — Refus serveur d'une écriture groupée** (révision périmée d'un des blocs) : lu sans bloc visé, la page
  relue dit le conflit de page ou le message, avec « Réessayer » ; refusée pour elle-même (`invalid_arguments`), elle
  quitte la file et l'alerte dit de recharger, sans « Réessayer » (le même corps échouerait encore) ; les blocs restent
  retirés ou déplacés à l'écran jusque là. Un conflit déjà ouvert refuse le geste avant tout envoi et le dit (AC-a6).
  Source : HN-E11S16-7.
- **HN-E11S17-a10 — Glissé sorti de son bloc (AC-a1)** : la sélection du texte continue sous le navigateur, masquée
  (`::selection`) tant que des blocs sont pris ; revenue au bloc de départ, elle reparaît telle que le navigateur l'a
  tenue ; lâché ailleurs, elle se replie et le focus passe à la zone des blocs. Au pointeur sans touche de modification.
  Source : le champ reste un `<textarea>` (JB, 2026-09-30).
- **HN-E11S17-a11 — Copie** : « N blocs copiés en markdown. » s'annonce ; un presse-papiers refusé le dit, et ⌘X ne
  supprime alors rien. Source : `components/presse-papiers.ts` (copie honnête).
- **HN-E11S17-a12 — Second ⌘A** : lu dans le champ d'un Texte, titre, citation, liste ou code (`ChampDeBloc`) ; les
  cellules d'un tableau simple et les champs d'un repli gardent le ⌘A du navigateur (Échap y sélectionne le bloc).
  Source : AC-a2 (« le focus dans un champ »), lots e reportés.

## Actions JB

- Répondre à Q-S17 (option, et ordre du lot a).
- Accepter ADR-021 (ou le réécrire selon la réponse).
- Aucun service extérieur, aucun secret ; la publication de 1.2.0 suit `README.md § Publier une version`.

## Tests attendus

### Unit tests
- [ ] `tests/unit/e11s16-modele-en-ligne.test.ts` (lot b) : stabilité sur le corpus (AC-b1) ; fidélité des
  caractères littéraux (AC-b2) ; `[[…]]` dans un span de code et `\[[` (AC-b3) ; positions autour d'un atome
  et d'une marque (AC-b4) ; temps linéaire (AC-b5) ; `javascript:` jamais en atome. Commandes du lot c sur
  un `EditorState` sans DOM : scinder et fusionner avec marques (AC-c7), `Tab` et refus (AC-d2).
- [ ] `tests/unit/e11s16-selection.test.ts` (lot a) : fonctions pures du modèle (retirer, rétablir, déplacer
  plusieurs rangées ; ordre gardé ; groupe non contigu) et corps d'écriture à plusieurs opérations.

### Integration tests (`tests/integration/components/e11s16-editeur.test.tsx`)
- [ ] Lot a : Maj+clic, Ctrl+clic, Échap puis Maj+↓, second Ctrl+A ; Suppr envoie un seul corps de N
  `delete_block` ; « Annuler » en rétablit N ; conflit : rien d'envoyé ; région vivante ; copie en
  `text/plain`.
- [ ] Lot c, dans la mesure du lot 0 : rôle, nom, `aria-multiline`, `aria-readonly` ; rendu sans balisage ;
  lien rendu `<a>` non éditable ; collage `text/html` ignoré ; « @ » et « / » ouverts par un état de document.
- [ ] Régression : les fichiers de « Appelants » réécrits, cas inchangés.
- [ ] MCP : sans objet, aucun outil touché.

### E2E tests (`tests/e2e/e11s16-editeur.spec.ts`)
Frappe, sélection, IME et presse-papiers ne se prouvent que dans un navigateur (`testing-strategy.md § Budget
de tests`). À 390 et 1 280 px, clair puis sombre.
- [ ] AC-c1 : au focus et pendant la frappe, le texte du champ ne contient aucune suite de balisage.
- [ ] AC-c2, AC-c8 : ⌘B puis ⌘Z ; `**mot**` tapé ; lien inséré par « @ » puis ⌘Z.
- [ ] AC-c4 : clic gauche suit, clic droit ouvre le panneau, « Appliquer », relu publié par son libellé.
- [ ] AC-c7 : Entrée au milieu d'un gras, Retour arrière de fusion : textes publiés relus.
- [ ] AC-c9 : collage `text/plain` d'une ligne marquée, Ctrl+Maj+V, collage de plusieurs lignes.
- [ ] AC-c10 : touches mortes (`page.keyboard` sur disposition française) et composition IME (Chromium,
  `Input.imeSetComposition`).
- [ ] AC-a1, AC-a5 : glissé d'un bloc à l'autre, rectangle depuis la marge ; AC-a6 : suppression groupée puis
  « Annuler », page relue.
- [ ] AC-d1, AC-d2 : liste à deux niveaux, `Tab`, repères mesurés (comme `e11s06-editeur.spec.ts`).
- [ ] AC-c15 : boîte d'un bloc avant et après le chargement de l'éditeur.
- [ ] Contrôle manuel écrit en post-implémentation : NVDA (Firefox), VoiceOver (Safari), Gboard (Android),
  couleurs forcées.

## Post-implémentation

### Écarts avec la référence UI
Lot a (oto-frontend n'a aucune sélection de blocs : ni surlignage ni rectangle à reprendre) :
- **Surlignage d'un bloc sélectionné** : fond `--oto-bg` et contour d'1 px en `--oto-ink` (`outline`, la boîte ne bouge
  pas), gouttière de la rangée révélée pour glisser le groupe ; `Highlight` de 2 px en couleurs forcées. Raison : la
  paire texte sur fond des badges d'Oto, sans jeton ajouté ; `--primary` seul ne tient pas 3:1 sur un fond clair
  (HN-E11S17-a2).
- **Rectangle tiré depuis la marge** : contour d'1 px en `--oto-ink` sur un voile de `--oto-bg` à 60 %, au-dessus des
  rangées, traversé par le pointeur ; `Highlight` en couleurs forcées. Raison : même paire que le surlignage, le texte
  des blocs couverts reste lisible dessous.

Lots c à f, reportés : champ `contentEditable` là où `BlockField` d'oto-frontend impose un `<textarea>` (ADR-021) ;
lien dans la phrase au lieu de la rangée de références sous le champ (`.oto-block-refs`).

### Composants créés

Lot a (2026-09-30), tous sous `packages/plateforme/ui/noeud/editeur/`, aucun export du paquet :
- `selection-de-blocs.ts` : `useSelectionDeBlocs` (état, clavier, poignées, focus, glissé d'un groupe) et ses fonctions
  pures `plage`, `seul`, `tous`, `etendre`, `avancer`, `jusqua`, `basculer`.
- `pointeur-de-la-selection.ts` : `usePointeurDeLaSelection` (rectangle depuis la marge, glissé qui quitte son bloc),
  `dansLaMarge`, `couverts`.
- `groupe.ts` : `dansLOrdre`, `retirerLeGroupe`, `retablirLeGroupe`, `deplacerLeGroupe`, `remettre`,
  `insertionsDuGroupe`, `deplacementsDuGroupe`, type `GesteDeGroupe` (fonctions pures).
- `gestes-du-groupe.ts` : `gestesDuGroupe` (supprimer, déplacer, glisser, copier, couper un groupe ; « Annuler »).

### Notes

- Lot a : écarts de fichiers avec « Fichiers à créer / à modifier » : les opérations de groupe vivent dans `groupe.ts`,
  non dans `modele.ts`, à sa borne de 300 lignes (`max-lines`) ; les gestes dans `gestes-du-groupe.ts` (`actions.ts` à
  272) ; le pointeur dans `pointeur-de-la-selection.ts`. Tests nommés `e11s17-*` (la story disait `e11s16-*`, son ancien
  numéro) : `tests/unit/e11s17-selection.test.ts`, `tests/integration/components/e11s17-selection.test.tsx`,
  `tests/e2e/e11s17-selection.spec.ts` — écrits, non lancés (règle de la vague).
- Lot a : `useGlisser` reçoit `groupe` et `revenir` (glisser d'un groupe, geste interrompu) ; `rangee-de-bloc.tsx` pose
  `data-selectionnee` ; `use-envois.ts` gagne les écritures groupées (`envoyerSuppressions`, `envoyerInsertions`,
  `envoyerDeplacements`) et `annoncerLeGroupe`.
- Lot a, revue corrigée : `applyOps` bornait tout corps à 50 opérations (`OPS_MAX`), quelle que soit la porte : une
  sélection de plus de 50 blocs ne se supprimait ni ne se déplaçait (AC-a2, AC-a6, AC-a8), et le refus
  `invalid_arguments` bouclait sur « Réessayer ». Décision de JB (D153) : `opsMaxFor(origin)` (`server/nodes/write.ts`)
  donne `BLOCKS_MAX` à l'écran (origine humaine, porte `POST nodes`), 50 à `write` ; `BLOCKS_MAX` passe dans
  `schemas/nodes.ts` (`portage-ecrans.md § 6`), l'écran refuse au-delà avant de toucher le modèle
  (`SELECTION.tropDeBlocs`) ; un corps de groupe refusé pour lui-même quitte la file (`SELECTION.refusee`, « Recharger
  la page »). Aussi : la poignée d'un bloc sélectionné le décrit (« Bloc sélectionné », `aria-describedby`) ; la même
  sélection n'est pas reposée par un mouvement du pointeur ; un Échap qui ne déplace pas le focus ne laisse pas la
  poignée prête à sélectionner (microtâche après le geste du champ) ; ↑, ↓ et Entrée restent au bouton sur la poignée
  d'un bloc hors de la sélection (HN-E11S17-a5 réécrite). Tests ajoutés, non lancés : `tests/unit/nodes-write.test.ts`
  (51 et 1 000 opérations de l'écran, 1 001 refusées ; 51 d'un assistant refusées), `e11s17-selection.test.tsx`
  (51 blocs en une écriture, refus `invalid_arguments`, ⌘Z dans un champ, ↓ sur une poignée hors de la sélection,
  description), `editeur-de-blocs.test.tsx` (glissé d'un groupe non contigu, « Annuler », `pointercancel`). Le refus
  au-delà de `BLOCKS_MAX` à l'écran n'a pas de test de composant (1 001 rangées à monter) : il suit le même chemin que
  le refus d'un conflit (`verrouille`).
