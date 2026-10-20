# Nœuds et arbre

- **Statut** : validé avec JB le 24/09/2026
- **Dernière révision** : 2026-10-20

## Résumé

Tout contenu est un nœud typé (page, procédure, Contexte, tableau) rangé dans un arbre par organisation et adressé par un chemin qui suit son titre ; un ancien chemin reste un alias pour toujours. Écrire publie : un brouillon ne reste que sur demande d'un assistant ou sur une publication refusée. Un nœud se déplace par `node.move`, part à la corbeille, et une ligne de tableau se supprime pour de bon.

## Contexte

Le contenu se présente sous quatre formes ; les garder dans un seul modèle de nœuds faits de blocs (ADR-011) donne un seul index, un seul chemin d'écriture et un seul contrôle de droits. Les assistants adressent le contenu par chemin, jamais par identifiant : le chemin doit donc rester stable pour eux même quand une personne renomme ou déplace. Les retours de la démo (2026-09-29) ont montré qu'un brouillon laissé ouvert bloquait l'assistant : la publication est devenue directe (D135). Ce document dit comment l'arbre se range et comment un nœud naît, change d'adresse, se publie et se retire. Le contenu d'un nœud (blocs) est dans [pages et blocs](pages-et-blocs.md), sa lecture et son écriture par un assistant dans [lecture et écriture des pages](lecture-et-ecriture-des-pages.md), les niveaux d'accès dans [droits d'accès](droits-d-acces.md).

## Objectifs et non-objectifs

- Un chemin lisible et stable : un lien ou un assistant qui cite un ancien chemin arrive toujours au nœud.
- Un chemin n'est jamais un motif de refus (D125) ; seuls le genre et les droits refusent.
- Ce qu'écrit une personne ou un assistant est publié dans la foulée, sans geste « Publier ».
- Hors objectif : renommer les chemins des nœuds créés par la base (`contexte`, `private/<handle>/contexte`) : ce sont des données ; un identifiant dans l'URL ; une corbeille des lignes de tableau.

## Conception

### Le nœud et l'arbre (ADR-011 § 1)

- `platform.nodes` porte les métadonnées seules : chemin, parent, titre, résumé, type (`page`, `procedure`, `context`, `table`), statut, révision (0 = jamais publié), propriétaire, ordre parmi les frères, date de corbeille, auteurs, dates ; `meta` porte le schéma d'un tableau et reste vide ailleurs. Colonnes détaillées : [schéma `platform`](../reference/schema-platform.md).
- H50 : la racine de l'arbre a le chemin `guide` et un `lpath` vide, une par organisation ; les grands sujets sont ses enfants, sans préfixe ; la page servie de l'organisation est son Contexte `contexte`, pas la racine.
- H51 : un segment de chemin s'écrit `[a-z0-9_]+` ; le chemin change par un déplacement ou quand le titre change, l'ancien devenant un alias. Le segment tiré d'un titre fait 60 caractères au plus, coupé au dernier mot entier (`slugOf`, [lecture et écriture des pages](lecture-et-ecriture-des-pages.md), HN-E11S18-7).
- H52 : le propriétaire s'hérite : un nœud sans propriétaire prend celui de son ancêtre le plus proche qui en porte un, et la racine appartient à l'organisation.
- P39 : l'arbre se range en sections : l'espace commun « Tout le monde », l'espace « Privé » de chacun et chaque équipe (aucune équipe « Tout le monde » en base), chacune avec un nœud Contexte (`contexte`, `private/<handle>/contexte`, `<équipe>/contexte`) qui porte ton, préférences et règles, servi par `context` dans cet ordre ([contexte servi](contexte-servi.md)).
- Les nœuds Contexte naissent en base avec leur équipe ou leur personne ; `platform.is_context_path` est la seule définition de leurs chemins, et un nœud `context` n'existe qu'à ces chemins (ADR-011 § 1).
- D110 : sous un nœud Contexte se rangent d'autres contenus (page, tableau, procédure) : dans le rail, le « + » d'un Contexte et le glisser-déposer sur sa ligne créent ou rangent sous lui, et le quart bas de sa ligne range juste après lui, en tête de sa section (seule place à côté de lui quand la section n'a pas d'autre ligne) ; quand `context` sert ce Contexte, ses enfants sont listés en lignes d'index (jamais leur corps), avant ses pages liées.
- P22 : les chemins racines `journal`, `functions` et `help` sont réservés : `read journal` sert le journal, `read functions` la liste des fonctions (E11-S19), `read help` le guide de la plateforme, servi par le paquet, le même partout, une section par appel (1.4.3, `server/help.ts`) ; `write` refuse d'y créer un nœud, et aucune équipe ne prend ces slugs (E11-S19, E11-S18 ; `help` dans `teams_slug_reserved` par la migration de la 1.4.3).
- Inventaire et contrôle (1.4.3) : `node.tree` (classe `read`) liste ce qu'on lit sous une racine, 200 nœuds par réponse ; `node.check` (classe `read`) y cherche les liens vers un chemin qui n'existe pas (ni nœud ni ancien chemin : un contenu qu'on ne voit pas compte comme existant, H68), les blocs `call` que la publication refuserait, les cellules qui valent un chemin inconnu et les outils nommés avec le préfixe d'une autre organisation ; l'import d'une arborescence le lance sur ce qu'il a importé (`server/transfer/inspect.ts`).
- Le refus d'un chemin pris dit ses causes possibles sans dire laquelle (H68) : « a content holds it (perhaps one you cannot see), a moved content had it, or the name is reserved ».

### L'espace personnel

- H61 : l'espace personnel `private/<handle>` (handle unique tiré de l'email) et son Contexte naissent à l'arrivée du membre ; un nœud personnel n'est visible que de son propriétaire et de ses partages ; le dossier `private` et l'espace ne se suppriment ni ne se déplacent. Les anciens chemins `perso/…` restent des alias.
- D89 : l'espace personnel s'appelle « Privé » dans le rail et dans son titre ; son dossier est `private/<handle>` (D107).
- HN-M38-1 : l'espace personnel naît titré « Privé » ; un espace encore titré « Perso » par la base le devient, un titre changé par sa personne reste.
- D19 : à l'oubli d'une personne (`forget_user`), son espace personnel part avec elle, ses mots du lexique de recherche aussi ; ce que d'autres possèdent dessous reste.

### Chemins, alias et liens (ADR-011 § 6)

- D125 : un chemin n'est jamais un motif de refus : création, renommage, déplacement, restauration et duplication prennent le premier chemin libre sous le parent (`<segment>_2`, `_3`…, anciens chemins et corbeille comptés), l'ancien chemin restant un alias ; pas d'identifiant dans l'URL. Le refus de changement de genre et les refus de droits restent.
- H58 : un déplacement ou un renommage inscrit l'ancien chemin dans `node_aliases` ; un outil appelé par un alias résout le nœud et le signale (« moved to X ») ; l'alias ne disparaît pas.
- P13 : les alias d'un déplacement sont écrits en base par le déclencheur `nodes_aliases_on_move`, pour tous les nœuds déplacés, invisibles compris ; l'alias qu'un nœud reprend est retiré.
- E03-S07 N8 : les anciens chemins se résolvent en un point (`findNode`) pour `read`, `write` et l'argument `table` : première ligne « X moved to Y on AAAA-MM-JJ: use the new path. », journal sur le chemin courant, `write` modifie le nœud déplacé.
- E03-S07 N17 : rien ne se crée ni ne se pose sous un ancien chemin : `write` et le déplacement refusent (`invalid_arguments`) en donnant le chemin à suivre ; l'ancien chemin d'un nœud invisible reste « does not exist ».
- HN-E11S02-18 : le chemin suit le titre au niveau écriture (action `rename`) ; l'ancien chemin reste un alias de `node_aliases`, lu par `findNode` et `writeNode`.
- H-M68 : la redirection d'une création « Sans titre » se limite aux alias et aux genres incompatibles (un nœud compatible garde `stale_revision`) ; une course reste `conflict` ; le premier chemin libre égal au chemin du nœud est refusé (« nothing to move ») ; l'aperçu d'impact reste calculé sur le chemin demandé ; le formulaire annonce le chemin demandé, le chemin réel se dit après.
- Liens `[[…]]` et blocs `reference` : extraits à la publication dans `links`, relus pour le lecteur (H57, [lecture et écriture des pages](lecture-et-ecriture-des-pages.md)).
  - E03-S07 N2 : les liens s'extraient à la publication sous les droits du publieur et se relisent pour le lecteur : chemin, puis alias, puis bloc visé ; cible invisible = sans cible ; `[[chemin#clé]]` se résout comme une référence courte.
  - E03-S07 N4 : le bloc `reference` compte comme lien sortant (chemin sans clé) ; sa ligne résolue donne titre, résumé et chemin, et pour une vue l'appel exact de `table.rows` ; une cible absente est signalée, jamais refusée.
  - E03-S07 N10 : en-tête de `read` : 20 liens entrants et 20 sortants au plus, totaux donnés, entrants comptés par source visible du lecteur ; `references` bornées à 50 dans les données.
  - E03-S07 N11 : droits des liens et du déplacement dans le service : niveaux en un lot, niveau 0 = sans cible, entrants filtrés avant la borne de 20 ; `moveNode` décide gestion et écriture sur la destination avant la mise à jour.
  - E03-S07 N24 : `read` lit les liens sortants et entrants en une requête par étape, en parallèle de l'en-tête ; les blocs `reference` reprennent les cibles déjà relues ; les liens vers un ancien chemin ne se lisent que pour un nœud qui en a.
  - Lien vers un ancien chemin (1.4.11) : `read` sert le texte d'un document avec chaque lien et chaque bloc `reference` vers un nœud déplacé ou renommé réécrits au chemin courant, alias suivis pour le lecteur (sa référence est alors servie `ok`, plus `moved`) ; l'écriture suivante de la page enregistre ces chemins. Le texte stocké d'une page qu'on n'écrit pas ne change pas : un déplacement n'écrit jamais dans les pages qui le citent (aucune révision ni conflit chez autrui) ; les blocs `code`, `call` et `mermaid` restent tels quels (`server/nodes/current-links.ts`).
- L'historique d'un nœud, ce sont les instantanés de publication (`node_versions`) et la révision de chaque bloc (ADR-011 § 6).

### Déplacer

- P12 : le déplacement d'un nœud passe par la route `POST /api/platform/nodes/move`, l'action « Déplacer… » de l'écran et `node.move` derrière `call`, au niveau gestion ; aucun des six outils ne déplace lui-même.
- HN-E11S18-5 : `node.move` est de classe `write`, pas `sensitive` : un déplacement se défait (l'ancien chemin redirige, on redéplace), rien n'est effacé. HN-E11S18-6 : ses arguments sont `moveNodeSchema`, décrit (une source pour l'API, l'écran et le catalogue) ; un `new_path` pris va au premier chemin libre, comme à l'écran (D125).
- E03-S07 N5 : un déplacement est une seule mise à jour du nœud : la base réécrit le sous-arbre et inscrit les alias ; la réponse ne nomme que les nœuds visibles ; `40P01` est rejoué une fois ; 0 ligne → `stale_revision`.
- E03-S07 N6 : destination libre : ni nœud ni ancien chemin d'un autre nœud, visibles ou non ; `guide`, `private`, `private/<handle>`, un Contexte et son dossier ne se déplacent pas ; refus `conflict` « Path … is not available: choose another path. » (le premier chemin libre de D125 s'applique quand le chemin demandé est pris par un frère).
- E03-S07 N7 : déplacer un nœud dans un espace personnel n'est pas réservé à l'administrateur : la gestion sur le nœud et l'écriture sur la destination suffisent.
- E03-S07 N15 : refus de la base après une décision qui passe : le code part au log serveur, les contrôles du déplacement sont rejoués ; sinon `23505` → `conflict`, `42501` → refus sans nom, `23514`/`23503` → « the tree refuses this place », le reste `internal`.
- E03-S07 N25 : `42501` après une décision de déplacement qui passe encore : `forbidden` « Cannot move X to Y: the access rules of <org> refuse it there. Choose another path. », qui ne renvoie vers personne.

### Écrire publie (ADR-011 § 3, D135)

- D135 : publication directe : à l'écran comme par l'assistant, un contenu est publié dès sa création et à chaque modification ; `write` publie par défaut, un brouillon ne reste que sur `publish: false` ou sur une publication refusée ; qui peut écrire publie (la gestion garde partage, droits, déplacement, suppression).
- L'écran regroupe les frappes et publie 3 s après la dernière et en quittant la page ; HN-E11S02-20 : cadence de 3 s gardée, aucune fusion de révisions. Le brouillon est partagé, et la publication suivante le publie entier ; HN-E11S02-19 : aucun avis à l'ouverture d'un nœud qui a un brouillon : la frappe suivante le publie entier.
- HN-E11S02-21 : le défaut de `publish` se lit dans le service (`publish !== false`) ; l'écran passe `publish: false` par la file d'opérations. HN-E11S02-22 : refus de publication : brouillon gardé, `isError` avec son code (E03-S03 N28) ; une écriture d'assistant, elle, est entière ou rien (HN-E11S18-1).
- Modifier écrit l'état `draft` : la première modification ouvre le brouillon et copie les blocs publiés, avec les mêmes `id`. Publier remplace l'état `published` par le brouillon, incrémente `nodes.revision`, prend un instantané dans `node_versions`, réécrit les liens, puis efface le brouillon. L'en-tête en attente (titre, résumé, type, schéma) vit dans `node_drafts` ; brouillon, publication et abandon passent par `open_draft`, `publish_node` et `discard_draft`.
- HN-E11S02-17 : qui peut écrire publie aussi l'en-tête changé d'un tableau publié (colonnes, clé, `proof`, `agents_may_decide`, `closed`) ; canal ouvert voulu, tracé. Un tableau n'a pas de brouillon de lignes : ses blocs `row` s'écrivent à l'état `published` ([tableaux](tableaux.md)).
- HN-E11S02-23 : Contextes et espaces créés par la base restent à la révision 0 jusqu'à leur première écriture. HN-E11S02-28 : le Contexte suit la règle : écrire le publie.
- HN-E11S02-24 : fil d'accueil inchangé pour l'écriture : `publish: true` explicite donne « publié », sinon « créé » ou « modifié ». HN-E11S02-26 : aucun filtre des contenus « Sans titre » vides. HN-E11S02-29 : « Sans titre » s'ouvre titre sélectionné quelle que soit la révision.
- HN-E11S02-15 : l'écran reconnaît le refus d'un en-tête à `details.reason = "header_refused"`, posée par le service ; il le dit dans la zone de publication, sans « Réessayer ».
- HN-E11S02-25 : `?version=published`, `read draft: true` et `node.discard_draft` restent pour les brouillons rares ; le lien « Voir la version publiée » part avec le bandeau.

### Abandonner, mettre à la corbeille, supprimer des lignes

- HN-E11S02-1 : noms `node.discard_draft`, `node.trash`, `table.delete_rows` ; connecteur natif `node`. HN-E11S02-6 : les trois fonctions sont `sensitive` : deux temps. HN-E11S02-14 : ni `checkArgs` ni refus dans un bloc `call` de procédure pour les trois fonctions : elles y restent en deux temps.
- Abandon d'un brouillon : HN-E11S02-2 : il exige le niveau écriture (action `write`). HN-E11S02-3 : on abandonne le brouillon entier, titre et résumé en attente compris ; le récapitulatif les nomme. HN-E11S02-4 : l'abandon d'un nœud jamais publié est refusé, avec un renvoi à `node.trash`. HN-E11S02-5 : le brouillon s'abandonne par une fonction SQL (`platform.discard_draft`, verrou 7401 ; `55000` sans brouillon, `PT409` sur tampon changé ; depuis `20261021100000`, l'écriture du nœud et une page déjà publiée, `42501`), jamais par un privilège ni une policy `DELETE` sur `node_drafts`. HN-E11S02-13 : l'assistant ne passe pas de tampon à `node.discard_draft` : le service passe celui qu'il lit. HN-E11S02-12 : aucun bouton « Abandonner le brouillon » ni route à l'écran : seul un assistant abandonne un brouillon.
- Corbeille : `node.trash` derrière `call`, au niveau gestion ; purge après 30 jours par le service, sans tâche planifiée. La base le reprend sous une session (`20261021090000`) : la date de corbeille ne prend que `now()` (une date passée ferait purger la page par le premier membre qui ouvre la corbeille), la racine mise à la corbeille ou restaurée exige la gestion, ce qui part dessous la lecture ; un nœud ne se supprime que dormant depuis plus de 30 jours, par l'administrateur à la corbeille (suppression d'une équipe), ou par son auteur jamais publié (retrait de la page d'un envoi). Les pages d'une équipe à la corbeille (dont elle est propriétaire ou rangées sous son dossier, sous-pages comprises) ne bloquent pas sa suppression : elles sont effacées pour de bon dans la même transaction, avant elle, et la confirmation en donne le nombre (`server/team-trash.ts`) ; seules ses pages vivantes et ses comptes la bloquent.
- Lignes de tableau (`table.delete_rows`) : HN-E11S02-7 : un tableau fermé n'empêche pas la suppression de lignes : `closed` n'interdit que la création. HN-E11S02-8 : une ligne à l'état de revue se supprime comme les autres, quel que soit `review.agents_may_decide` ; le récapitulatif et le résultat le disent ; P10 n'est pas touchée. HN-E11S02-9 : une ligne réservée par autrui, bail actif, est refusée ; bail expiré ou propre, supprimée. HN-E11S02-10 : une ligne supprimée l'est pour de bon, sans corbeille de lignes.
- HN-E11S02-11 : fil d'activité : `trashed` réutilisé, `deleted_rows` ajouté (« a supprimé des lignes dans »), l'abandon d'un brouillon absent. HN-E11S02-16 : le nombre de lignes supprimées et à revoir voyage de la fonction au journal par `FunctionOutput.outcome` et `ToolOutput.outcome`, écrit en clé réservée `args._outcome`, sans migration ([journal et retours](journal-et-retours.md)).

## Décisions et alternatives écartées

- **Brouillon par défaut, publication à la gestion** (ADR-011 § 3 d'origine, défaut `publish` de l'ADR-002, H63) : remplacés par la publication directe au niveau écriture (D135, 2026-09-29) : un brouillon laissé ouvert bloquait l'assistant, et la gestion ne doit garder que partage, droits, déplacement et suppression.
- **Pas d'abandon de brouillon** (E01-S06 N5, [pages et blocs](pages-et-blocs.md)) : remplacé par `node.discard_draft` (E11-S02) : un assistant doit pouvoir sortir d'un brouillon qu'il a laissé.
- **Refuser un chemin pris** : écarté par D125 : un chemin n'est pas une information que la personne doit gérer ; on prend le premier libre.
- **Espace personnel sous `perso/<handle>`** : renommé `private/<handle>` (D89, D107) ; les anciens chemins restent des alias, le journal n'est pas réécrit.
- **Un bouton d'abandon de brouillon à l'écran** (HN-E11S02-12) : écarté, l'écran publiant toujours ; **une corbeille de lignes** (HN-E11S02-10) : écartée, une ligne supprimée l'est pour de bon.
- **Un identifiant dans l'URL** : écarté (D125) ; **sections dans le nœud** : écartées par ADR-011 (ni écriture ni ancre au bloc, voir [pages et blocs](pages-et-blocs.md)).

## Sécurité et confidentialité

- Un nœud invisible répond comme un chemin inconnu ; un ancien chemin d'un nœud invisible reste « does not exist » (E03-S07 N17), et un refus de déplacement ne nomme personne (E03-S07 N25).
- Les liens se relisent pour le lecteur : une cible qu'il ne voit pas est « sans cible » (E03-S07 N2) ; les droits se décident dans le service ([droits d'accès](droits-d-acces.md)) et, pour le contenu, aussi en base depuis `20261021130000` : blocs publiés, versions, liens sortants et fichiers joints à la lecture du nœud, brouillon à l'écriture, lien public à la gestion ; le titre et le résumé restent lus par l'organisation (`nodes_select_level`, en attente d'une décision).
- Abandon, corbeille et suppression de lignes sont `sensitive` : récapitulatif d'abord, exécution sur `confirm: true`.

## Écart avec le code

- M70 : une création titrée d'un assistant sur un chemin tenu par un nœud invisible ou à la corbeille refuse encore (`conflict`) au lieu de prendre le premier chemin libre (D125) ; branche `context` inatteignable de `createsElsewhere` (`write.ts`).
- M91 : un commentaire de `ui/noeud/en-tete-modifiable.tsx` dit encore qu'un nœud neuf est « jamais publié » ; états `brouillon` et `ecrit` sans lecteur.
- M69 : après un déplacement par « ⋯ », le focus tombe sur le document au lieu du nœud déplacé.

## Questions ouvertes

Aucune à ce jour.

## Historique

- 2026-09-24 : contenu en nœuds typés faits de blocs, brouillon et publication, liens, alias et historique par instantanés — décidé par JB (source : ADR-011).
- 2026-09-28 : l'espace personnel devient « Privé » sous `private/<handle>` ; contenus rangés sous un Contexte ; un chemin n'est jamais un refus — décidé par JB (source : fiches D89, D110, D125, avant la 1.0.0).
- 2026-09-29 : publication directe au niveau écriture ; abandon de brouillon, corbeille et suppression de lignes depuis un assistant — décidé par JB, détails tranchés par le responsable d'Oto (source : fiche D135, story E11-S02).
- 2026-09-30 : `node.move` derrière `call`, de classe `write` ; `functions` réservé comme `journal` — décidé par JB (source : stories E11-S18, E11-S19).
- 2026-10-01 : refonte en document de conception vivant, qui reprend ADR-011 § 1, § 3 et § 6, les fiches D19, D89, D110, D125, D135 et les choix H50 à H61, P12, P13, P22, P39, E03-S07, E11-S02 — décidé par Alexis, accord de JB.
- 2026-10-14 : chemin réservé `help` (guide de la plateforme), `node.tree` et `node.check`, refus d'un chemin pris qui dit ses causes possibles — décidé par JB (source : cahier des charges « un agent autonome sur Oto dès le premier appel », session du 14/10/2026).
- 2026-10-15 : dans le rail, le quart bas de la ligne d'un Contexte range juste après lui, en tête de sa section (D110) — décidé par JB (source : session du 15/10/2026).
- 2026-10-20 : un lien vers un ancien chemin est lu au chemin courant et enregistré à l'écriture suivante de sa page, sans réécrire les pages qui citent un nœud déplacé — décidé par JB (source : session du 20/10/2026).
- 2026-10-20 : les pages d'une équipe à la corbeille sont effacées avec elle et ne bloquent plus sa suppression — décidé par JB (source : session du 20/10/2026).
- 2026-10-21 : la base exige la lecture d'un nœud pour en lire le contenu publié (blocs, versions, liens sortants, fichiers joints), l'écriture pour son brouillon, la gestion ou l'administrateur pour son lien public, et le dernier auteur d'un bloc vaut l'appelant (`20261021130000`) — décidé par Alexis le 20/10 (source : revue des policies de lecture, restées à l'appartenance).
- 2026-10-20 : la base exige l'écriture d'un nœud pour écrire ses blocs, lignes publiées d'un tableau comme brouillon d'une page (`blocks_*_writer`), et le dernier auteur d'un nœud (`updated_by`), posé à l'ajout ou changé, vaut l'appelant (`nodes_gesture_guard`, `20261021120000`) — décidé par Alexis (source : revue des policies de `blocks`).
- 2026-10-20 : la base exige l'écriture du parent pour créer un nœud (déclencheur `nodes_guard_creation`) et n'accorde à une session que les colonnes de `nodes` que les services écrivent : à la création, celles d'`insertNode`, propriétaire hérité ; ensuite, parent, chemin, propriétaire, dernier auteur, position et corbeille (`20261021110000`) — décidé par Alexis (source : revue des droits de colonne de `nodes`).
- 2026-10-20 : `open_draft`, `publish_node`, `discard_draft` et `duplicate_subtree` exigent en base le niveau de leur service (`20261021100000`) ; la duplication ne copie plus une page ni des descendants cachés — décidé par Alexis (source : revue des fonctions `security definer`).
- 2026-10-20 : la base juge les gestes d'une mise à jour d'un nœud et sa suppression au niveau du service (déclencheur `nodes_gesture_guard`, `nodes_delete_manager`, `20261021090000`) — décidé par Alexis (source : revue des policies d'écriture).
