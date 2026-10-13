# Transfert d'une arborescence

- **Statut** : proposé
- **Dernière révision** : 2026-10-13

## Résumé

Une arborescence (une base de connaissances, un dossier d'équipe, un jeu de procédures) passe d'un MCP Oto à un autre par deux fonctions du catalogue, `node.export_tree` et `node.import_tree`. L'export écrit un fichier pivot JSON (ou un ZIP lisible par une personne) dans le stockage et rend une URL signée d'une heure, les fichiers joints du pivot chacun à la sienne ; l'import télécharge lui-même l'adresse, en deux passes (réserver les chemins, puis remplir et recoller les liens), et rend un rapport. L'assistant relaie l'adresse et lit le rapport, rien d'autre : aucun contenu ne passe par la conversation.

## Contexte

Avant, déplacer une base d'une organisation à l'autre passait par l'assistant, page par page (`read` puis `write`, ou `node.write_many` par lots de 50). Un tableau y perdait son schéma (file de travail, preuve exigée) et la preuve de chaque valeur, les liens internes gardaient les chemins de la source, et le volume dépendait de la fenêtre de l'assistant. L'export-import d'une organisation entière existe déjà, mais c'est une CLI d'outillage sous la connexion d'administration ([administration et cellule](administration-et-cellule.md), H112) : il ne sert ni une personne ni un assistant, et ne prend pas un sous-arbre.

## Objectifs et non-objectifs

- Objectif : copier un ou plusieurs sous-arbres d'une plateforme Oto vers une autre, fidèlement (blocs, fichiers joints, en-têtes et lignes des tableaux, preuves, statuts des procédures), sous les droits de la personne de chaque côté.
- Objectif : importer aussi ce qu'une personne a sous la main : un dossier de `.md` et de `.csv` zippé, un `.md` seul, un CSV seul.
- Objectif : un import interrompu se reprend sans doublon ni stockage de reprise.
- Hors objectif : les fichiers joints d'un export ZIP (leur mention seule) ; l'historique des versions, les brouillons, les droits, les alias et les partages publics ; une synchronisation continue entre deux plateformes ; un outil MCP de plus (ADR-002 : tout passe par `call`).

## Conception

### Export (`node.export_tree`, classe `read`)

- Entrée : 1 à 20 racines (`paths`), `format` `json` (défaut) ou `zip`. Chaque racine part avec tout ce qui est sous elle **et que la personne peut lire** ; un nœud illisible est laissé, avec tout ce qui est sous lui (son parent manquerait à l'arrivée), et dit au rapport.
- Refus : racine inconnue ou illisible, racine sous une autre racine du même appel, deux racines au même dernier segment (exporter leur parent commun), plus de 2 000 nœuds, plateforme sans stockage.
- Pivot (`schemas/tree-transfer.ts`, format `oto-tree` version 1) : `roots` (chemin absolu à la source et nom porté dans `nodes`), puis chaque nœud par chemin **relatif** (le nom de sa racine, puis le chemin sous elle), genre, titre, résumé, et soit ses blocs publiés (type, texte, données, clé), soit son tableau (en-tête publié, lignes avec leurs valeurs, vides vérifiés et preuves `{comment, link}` par colonne). Un Contexte part en page. Un bloc `file` ou une image jointe garde son bloc, et le pivot liste dans `files` chaque fichier cité (`server/transfer/files.ts`) : `ready`, joint à la page qui le cite, avec son nom, sa taille et une URL de lecture signée d'une heure, comme l'export ; 1 000 fichiers au plus. Un fichier absent du stockage ou d'une autre page devient un paragraphe « (Fichier joint non transféré : nom) », dit au rapport.
- ZIP : un `.md` par page ou procédure (frontmatter `title`, `summary`, `kind: procedure`), un `.csv` par tableau ; pour une personne, sans preuves ni en-tête complet, chaque fichier joint réduit à sa mention.
- Le fichier est écrit par le serveur dans le stockage (opération `put` du port, [fichiers et stockage](fichiers-et-stockage.md)), sous `<org>/exports/<expiration>-<uuid>.<format>` (l'instant d'expiration en secondes, en tête de la clé), et servi par une URL de lecture signée **d'une heure**, relisible autant de fois que l'import le demande. Purge à l'expiration : le paquet n'ayant pas de tâche planifiée, les exports expirés de l'organisation sont listés et retirés à chaque export, à chaque import et à chaque passage de la corbeille (opération `list` du port) ; une panne du bucket (des clés qui ne listent pas) est dite au log et n'arrête pas le geste. Les liens vers une page hors des racines restent tels quels et sont listés (`orphans`).

### Import (`node.import_tree`, classe `write`)

- Entrée : `source_url`, `parent` (une page existante), `root_folder` (défaut vrai : chaque racine est créée sous le parent ; faux : son contenu y est déversé, la racine elle-même non créée), `collision` (`skip` par défaut, `overwrite`, `suffix`), `format` (`auto` par défaut), `continue_from`.
- Source : une adresse `https` téléchargée par la plateforme avec les gardes de `fetchSource` (schéma, port, adresses résolues, redirections ; 25 Mo et 30 s pour l'import), ou **l'adresse d'un fichier joint à une page de la même plateforme**, telle que `read` la donne : il est lu dans le stockage sous le droit de lecture de sa page. C'est la voie d'un arbre posé sur le disque de la personne : joint à l'écran (50 Mo) ou par `upload.link` kind `file` (1 Mo), puis importé.
- Formats (`server/transfer/formats.ts`), reconnus au type servi, au nom ou aux premiers octets : le pivot (fidèle) ; un ZIP (un dossier devient une page parente, un `.md` une page, un `.csv` un tableau ; la page d'un dossier se lit dans `<dossier>.md` à côté de lui **ou** `<dossier>/index.md`, le premier l'emportant, dit au rapport ; un dossier sans page devient une page vide ; les autres fichiers sont ignorés et listés) ; un `.md` seul (une page) ; un CSV seul (un tableau, colonnes et clé inférées comme `table.import`). Les chemins naissent des noms (`slugOf`), le titre du frontmatter, du premier `#` ou du nom.
- Deux passes, puis une troisième pour les tableaux du pivot (`server/transfer/import.ts`) :
  1. **réserver** : chaque nœud est créé vide à son chemin d'arrivée, parents d'abord (une page avec titre et résumé ; un tableau avec ses colonnes et sa clé seulement) ;
  2. **remplir** : les fichiers joints d'une page du pivot sont relus chacun à son URL (gardes de `fetchSource`, 50 Mo), joints à la page d'arrivée par `storeFile` (type, taille, quota), et leurs liens pointés vers les copies ; un fichier qui n'arrive pas laisse sa mention, dite parmi les refus ; puis le corps de chaque page est écrit d'un coup (opérations `insert_after` d'une écriture d'agent en mode tolérant), ses liens `[[chemin…]]` réécrits vers les chemins d'arrivée (clé et libellé gardés ; rien de réécrit dans un bloc de code, sauf la ligne d'ouverture d'un bloc `reference`) ; les lignes d'un tableau par lots de 50 par `table.write`, avec leurs preuves ;
  3. **finir** : l'en-tête complet d'un tableau du pivot (file de travail, état clos, preuve exigée) est posé après ses lignes, qu'il refuserait sinon.
- Collisions, décidées au chemin (aucune table de correspondance) : `skip` garde un nœud existant non vide et remplit un nœud vide (c'est ce qui reprend un import interrompu) ; `overwrite` réécrit un nœud du même genre (genre différent : refusé, listé) ; `suffix` place une racine importée à côté de l'existante (`_2`, `_3`…), ses descendants suivant. Le titre d'un nœud existant n'est jamais changé (il déplacerait le chemin).
- Temps : 40 s de travail par appel, sous les 60 s de la route MCP. Au-delà, la réponse rend `continue_from`, un curseur opaque (l'étape atteinte et les places choisies par `suffix`) ; l'assistant rappelle avec les mêmes arguments et ce curseur, la source étant relue.
- Rapport : créés, mis à jour, gardés tels quels (avec la raison), refusés (avec le refus de `write` ou de `table.write`), liens hors de l'arbre importé, notes du format. Un refus sur un nœud n'arrête pas les autres.

## Décisions et alternatives écartées

- Les deux fonctions passent par `call`, sans outil ajouté (ADR-002) ; `checkArgs` les refuse à une procédure : elles n'ont de sens que dans une conversation.
- Idempotence par le chemin : un nœud déjà là se reconnaît à son chemin d'arrivée. Écartés : une table de correspondance source → destination, et une colonne d'origine sur les nœuds, une surface en base pour un geste rare (décision de JB).
- URL d'une heure, relisible : l'import la relit à chaque `continue_from`. Écartée : une URL à usage unique, qui rendrait la reprise impossible.
- Les quatre formats livrés ensemble, et les deux conventions de page de dossier d'un ZIP reconnues (décision de JB).
- Un fichier du poste passe par un fichier joint puis l'import (décision de JB). Écarté : un type `tree` pour `upload.link`, qui demandait une migration de `upload_tickets`, plafonnait à 1 Mo et ne pouvait pas reprendre un import long.
- Le corps d'une page voyage en markdown rendu puis relu, pas en blocs : l'écriture garde ainsi toutes ses règles (droits, bornes, liens) ; la clé d'un bloc ne survit pas, la clé d'une ligne de tableau si.
- Les fichiers joints voyagent par des URL signées de la source, que l'import relit (décision de JB) : aucune clé d'un bucket n'est donnée à l'autre. Écartés : ne pas les transférer (une base copiée perdait ses pièces), et les mettre dans le pivot (le JSON passerait la borne de 25 Mo de l'import).
- Purge des exports à l'expiration (décision de JB), au plus près sans tâche planifiée : au geste suivant de l'organisation (export, import, corbeille), la clé disant son expiration. Écartés : un registre des exports en base (une migration pour un objet d'une heure) et une règle de cycle de vie du bucket (à la charge de chaque hôte, et au jour près).

## Sécurité et confidentialité

- L'export ne contient que ce que la personne lit ; l'import écrit par `writeNode` et `table.write`, sous les droits de la personne à la destination, chaque refus décidé par le service.
- L'URL d'export est une capacité : quiconque la tient lit l'export pendant une heure. Elle n'est pas journalisée (le journal ne garde d'un résultat que des nombres) ; `source_url` est masquée au journal par son nom ([dépôt par lien](depot-par-lien.md)).
- Le téléchargement d'une adresse choisie par l'appelant passe par les gardes de `fetchSource` ; un fichier joint n'est lu qu'après la vérification de lecture sur sa page, et un fichier d'une autre organisation répond `not_found`.
- Un ZIP n'est décompressé que pour ses `.md` et `.csv`, 100 Mo au plus en tout, comptés à la taille qu'il déclare (chaque tampon a cette taille) : une bombe de décompression est refusée (`too_large`) avant de remplir la mémoire.
- Le curseur `continue_from` est forgeable : une place qu'il retient n'est reprise que si elle est un enfant direct du parent, et toute écriture repasse par les droits.

## Écart avec le code

- Un export expiré reste dans le bucket jusqu'au geste suivant de l'organisation (export, import, corbeille), ou à jamais si l'hôte donne des clés qui ne listent pas le bucket ; la suppression d'une organisation ne retire pas ses exports.
- Une page qui porte de gros fichiers les relit et les envoie dans une seule étape : au-delà de la borne de la route (60 s), l'étape échoue, et un nouvel appel la rejoue (fichiers déjà joints en double).
- Un pivot JSON gardé sur le disque ne s'importe pas comme fichier joint (`json` n'est pas un type admis) : il faut l'exporter de nouveau, ou son ZIP.

## Questions ouvertes

- Aucune.

## Historique

- 2026-10-13 : export en pivot ou ZIP à une URL d'une heure, import en deux passes des quatre formats, idempotence par le chemin, fichier du poste par un fichier joint — décidé par JB (source : cahier des charges du transfert d'arborescence, session du 13/10/2026).
- 2026-10-13 : les fichiers joints voyagent dans le pivot, et les exports se purgent à l'expiration — décidé par JB (source : session du 13/10/2026).
