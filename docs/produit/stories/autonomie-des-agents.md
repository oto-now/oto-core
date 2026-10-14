# Story : un agent autonome sur Oto dès le premier appel

- **Échelle** : Module (surfaces nouvelles : chemin réservé `help`, fonctions `node.tree` et `node.check`, règles servies v2).
- **Version** : 1.4.3, avec le bloc « Intégration » et les correctifs de l'éditeur et de l'import déjà sur main ; sans le lot
  connecteurs (1.5.0).
- **Conventions** : coding-standards, security-patterns, supabase-patterns, testing-strategy, component-registry, mcp-patterns
  (texte servi, golden queries), forms-patterns (schémas partagés).
- **Référence UI** : N/A (aucun écran).

## Contexte

Cahier des charges de JB du 14/10/2026, tiré de la copie de l'arborescence SAV d'une organisation de démonstration vers
celle d'un client par un assistant : 3 procédures refusées, 2 contenus absents sans signalement, 36 lignes de tableau aux
chemins périmés, 13 liens cassés, des mentions d'outils préfixés par l'organisation source, une trentaine d'appels de
correction et un script hors plateforme pour tout vérifier. Les réponses existent, mais dispersées dans les descriptions
d'outils et les contrats : l'agent apprend par l'erreur.

Décisions de JB (14/10/2026) :

- guide plateforme sous un chemin réservé virtuel `help`, servi par le paquet comme `functions` et `journal`, figé,
  identique dans toutes les organisations (`guide` est déjà le chemin de la racine d'une organisation) ;
- chemins dans les tableaux réécrits par valeur à l'import, sans nouveau type de colonne ;
- mentions `<préfixe source>_<outil>` réécrites par défaut à l'import, pour les six outils seulement ; le nom de
  l'organisation n'est jamais touché ;
- tout dans une seule publication, la 1.4.3.

Ce qui est déjà livré sur main : les arguments des blocs `call` recollés à l'import, une procédure refusée gardée en
brouillon (`drafts`), « / » et « + » aux mêmes entrées.

## Critères d'acceptation

### Lot A — import et export fiables (CDC E4, E6)

- AC-A1 : un refus de l'import porte le détail complet du refus (chaque problème d'une publication refusée, une ligne
  chacun), pas sa seule première ligne.
- AC-A2 : un nœud créé par l'import dont le contenu est refusé ne laisse pas de coquille publiée vide : une page ou un
  tableau créés vides partent à la corbeille et sont listés « refused » ; une procédure garde son texte en brouillon et le
  rapport dit « created empty, its text kept as a draft ».
- AC-A3 : toute cellule texte d'un tableau importé qui vaut exactement un chemin de l'arbre importé, et tout `[[…]]` dans
  une cellule, prennent le chemin d'arrivée ; le rapport compte les réécritures.
- AC-A4 : `<préfixe source>_(context|find|read|write|call|feedback)` dans le texte des pages, procédures et cellules prend
  le préfixe de l'organisation d'arrivée ; le pivot porte le préfixe source ; le rapport compte les réécritures.
- AC-A5 : une page jamais publiée s'exporte comme une page vide (titre, résumé) ; ses descendants lisibles voyagent ; un
  export d'une racine d'équipe non publiée rend ses sous-dossiers.
- AC-A6 : un Contexte de la source s'importe en page de même nom sous sa racine importée (jamais sur un chemin de Contexte
  de la destination), ses enfants avec lui ; si ce chemin est refusé, ses enfants sont listés « left out: parent refused ».
- AC-A7 : le rapport boucle : `source N = created + updated + kept + refused + drafts + left out`, sur une ligne en tête ;
  ses listes complètes sont dans `data`, le texte coupé à 30 lignes le dit.
- AC-A8 : « Path … is not available » dit, sans révéler un nœud invisible (H68) : « taken by a content, the old path of a
  moved one, or a reserved name » et propose le premier chemin libre (`freePath`).

### Lot B — découvrabilité (CDC E1, E2, routage)

- AC-B1 : les règles servies (« How this workspace works ») gagnent une partie « Reference » : `read path functions`,
  `read path help` (une section à la fois), `read path write.procedure` / `write.table`, `call table.schema` avant
  d'écrire des lignes ; et quatre pièges : un titre publié déplace le chemin, réorganiser par `node.move`, nommer les
  outils sans préfixe dans un texte, un Contexte n'existe qu'à la racine, sous une équipe et dans un espace personnel.
  Les règles v2 ajoutent moins de 1 200 caractères aux règles actuelles (test).
- AC-B2 : `read path help` sert le guide plateforme, figé, servi par le paquet : plan, puis une section par appel
  (`section`) : Pages et blocs (chaque type de bloc avec son markdown, opérations par bloc, contenu long), Tableaux,
  Procédures (règles de validité et guide qualité, CDC E3), Chemins et espaces, Import et export, Pièges connus. Une
  section renvoie au contrat (`write.procedure`, `write.table`) au lieu de le recopier.
- AC-B3 : `context` sans procédure qui convient liste aussi les fonctions dont la description correspond à la demande
  (`searchFunctions`, 3 au plus) et la section du guide la plus proche : « exporte toutes les pages de l'équipe SAV » mène
  à `node.export_tree`.
- AC-B4 : golden queries ajoutées : agent vierge (tableau avec preuves, procédure de 4 étapes à 2 blocs `call`, dossier
  déplacé) et routage vers une fonction.

### Lot C — inventaire et intégrité (CDC E5)

- AC-C1 : `node.tree` (classe `read`) : l'arborescence lisible d'une racine, chemin, genre, titre, publié ou non,
  révision, paginée (200 nœuds par page, `continue_from`).
- AC-C2 : `node.check` (classe `read`) sur une racine : liens `[[…]]` cassés, blocs `call` invalides (fonction ou tableau
  inconnus), cellules qui valent un chemin inconnu, mentions d'outils préfixés par une autre organisation ; une ligne par
  problème, avec le chemin et le bloc.
- AC-C3 : l'import lance `node.check` sur l'arbre importé et met son résultat dans le rapport.

### Lot D — confort (CDC E3 lint, E7, E8)

- AC-D1 : la publication d'une procédure rend des avertissements, sans refuser : résumé sans formulation de demande,
  étape sans suite (ni condition d'arrêt ni valeur reportée), mention d'outil préfixé.
- AC-D2 : une procédure déclare ses prérequis externes dans une section « Prérequis » ; `context` la rappelle quand il la
  sert. Convention écrite au guide, sans champ nouveau.
- AC-D3 : un résultat qui commence par « context has changed » dit sur la ligne suivante, seule, si l'appel a écrit ou
  non.

## Tests attendus

- Intégration (`tests/integration/transfert-d-arborescence.test.ts`) : AC-A1 à AC-A7, dont le scénario de référence
  réduit (Contexte avec deux enfants, tableau index aux chemins, procédure aux appels, mentions préfixées) qui finit avec 0
  refus et `node.check` vide.
- Unitaires : règles v2 (taille, présence des quatre pièges), guide (`help` servi, sections), routage vers une fonction,
  message de chemin pris.
- Intégration : `node.tree` et `node.check` sur une vraie base, droits (un nœud illisible n'apparaît pas).

## Rayon d'impact

1. **Appelants** :
   - règles servies : `rg -n "WORKSPACE_RULES|workspaceRules" packages tests src` (code.ts, son test de compte des règles et
     leur traduction à l'écran : la traduction suit) ;
   - chemins réservés virtuels : `rg -n "\"functions\"|\"journal\"" packages/plateforme/server packages/plateforme/schemas`
     (lecture de `read`, slugs réservés des équipes à compléter par `help`, contrainte `teams_slug_reserved` : `help` y
     manque, donc une équipe `help` pourrait exister ; le chemin virtuel se lit avant le nœud, comme `functions`) ;
   - message de chemin pris : `rg -n "notAvailable\(" packages/plateforme/server` (création, déplacement, duplication,
     import de tableau, résultat d'écriture : le message change pour tous) ;
   - routage : `rg -n "no procedure matches" packages tests` ;
   - import : `rg -n "runImport|collectTree|reportLines" packages tests`.
2. **Doublons** : `read` d'un dossier liste déjà ses enfants (une page, bornée) : `node.tree` en reprend la lecture des
   descendants (`readableSubtree` de `collect.ts`), à extraire en commun plutôt qu'à recopier ; la vérification des
   liens existe à la publication (`server/nodes/links.ts`) et celle des blocs `call` aussi (`procedures-check.ts`) :
   `node.check` les appelle, sans les réécrire (`rg -n "checkProcedureBlocks|resolveLinks" packages/plateforme/server`).
3. **Effet produit** : texte servi à chaque `context` (règles v2, toutes les organisations : golden queries à rejouer) ;
   deux fonctions au catalogue (surface de `call`, ajout seulement) ; message de chemin pris (écran compris, qui le
   traduit) ; aucune migration.
4. **Refacto** : extraire la lecture des descendants lisibles de `collect.ts` pour `node.tree` et `node.check` (proposé,
   coût faible, fait dans le lot C) ; rien d'autre.
