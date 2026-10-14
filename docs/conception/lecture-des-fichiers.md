# Lecture des fichiers par un assistant

- **Statut** : proposé
- **Dernière révision** : 2026-10-14

## Résumé

Un assistant lit tout fichier joint, en entier ou par partie, au moindre coût en jetons : `read {path, file}` rend le **texte utile** du fichier quel qu'en soit le format (le texte d'un HTML sans balises ni scripts, les pages d'un PDF, les paragraphes d'un docx, les feuilles d'un xlsx en CSV), un grand fichier vient d'abord en **plan** dont chaque partie (titre, feuille, diapositive, page) se lit seule par `section`, et `read` de la page montre sous chaque fichier un **aperçu** d'une ligne, rangé au dépôt, qui évite souvent de l'ouvrir. Chaque format a son lecteur dans un registre (`defineReader`) : le paquet inscrit ceux des formats texte, des formats faits de XML dans un ZIP et du PDF ; l'hôte inscrit les autres (plans DWG/DXF, modèles 3D), comme il inscrit ses fonctions. L'original reste atteignable par `raw`. La vue d'une personne (icône œil) n'est pas le sujet de ce document.

## Contexte

- Aujourd'hui, `read` d'une page rend un fichier joint en une ligne `[rapport.html (380 KB, html)](/api/platform/files/<id>)` : nom, taille, type. Le bloc `file` n'a ni titre ni description ; l'adresse ne sert à l'assistant que pour l'identifiant, la route exigeant la session d'une personne.
- `read {path, file}` ([contenu HTML isolé](contenu-html-isole.md), D119) sert le texte brut des seuls `html`, `md`, `txt` et `csv`, jusqu'à 4 Mo, coupé à 45 000 caractères, toujours depuis le début. Le source d'un HTML généré (un rapport, une petite application) est souvent fait de styles, de scripts, de SVG et d'images en base64 : l'assistant paie en jetons et en parties de curseur un texte qui n'est pas le contenu, et ne peut pas aller droit à la partie qui l'intéresse.
- Les autres formats admis (`FILE_TYPES` : `pdf`, `docx`, `xlsx`, `pptx`, `odt`, `ods`, `zip`, images) ne sont pas lisibles du tout : un assistant n'en connaît que le nom.
- Le 08/10, des « lecteurs de format » ont été décrits dans [fichiers et stockage](fichiers-et-stockage.md) (premier cas : les plans DWG/DXF) : lecture à l'envoi, structure rangée, et un port lecteur vers un service isolé que l'hôte héberge, parce qu'un lecteur de DWG est un programme tiers exposé aux fichiers piégés et souvent sous une licence incompatible avec ce dépôt. Le 14/10, une issue d'Alexis demande un registre de lecteurs par type, que l'hôte complète, l'original toujours atteignable. Ce document remplace le port du 08/10 par ce registre : un lecteur inscrit par l'hôte isole son programme tiers s'il le faut.

## Objectifs et non-objectifs

- **Léger** : l'assistant ne reçoit que le texte utile, dans la forme la plus courte qui garde la structure (titres, listes, tableaux) ; aucune balise, aucun style, aucun binaire.
- **Tout ou partie** : un grand fichier se parcourt comme une longue page, plan d'abord, puis une partie à la fois.
- **Sans ouvrir** : l'aperçu dans la page dit ce que contient un fichier et combien il pèse, pour que l'assistant décide s'il l'ouvre.
- **Un seul contrat** pour tous les formats : même argument, même en-tête, même plan, même découpe.
- Les formats courants d'une entreprise marchent chez tout hôte, sans service à héberger ; aucun code du fichier n'est exécuté.
- Hors objectif : la vue d'une personne (icône œil, [contenu HTML isolé](contenu-html-isole.md)) ; chercher dans le texte des fichiers par `find` (l'aperçu le prépare) ; recalculer une formule de tableur ; lire un fichier chiffré, un ancien format binaire (`.doc`, `.xls`, non admis) ou un PDF numérisé sans couche de texte ; lire le contenu d'un bloc « Intégration », page d'un site tiers ; importer un xlsx en tableau ou un docx en page (le CSV et le `.md` le font déjà, [transfert d'une arborescence](transfert-d-arborescence.md)).

## Conception

### Trois paliers, du plus léger au plus complet

1. **L'aperçu dans la page** (quelques dizaines de jetons par fichier). `read` d'une page rend, sous la ligne du fichier, une ligne de commentaire que l'écriture ignore, comme la ligne résolue d'un bloc `reference` (E03-S07). La ligne du fichier reste seule sur sa ligne : elle se relit toujours en bloc `file` (HN-E10S02-69), et un assistant qui réécrit la page ne recopie pas l'aperçu.

```text
[budget.xlsx (2.1 MB, xlsx)](/api/platform/files/<id>)
<!-- file: 3 sheets: Synthèse (12 × 8), Détail (4,210 × 15), Paramètres (hidden); 310,000 characters. Read it with file: <id>. -->
[contrat.pdf (1.4 MB, pdf)](/api/platform/files/<id>)
<!-- file: « Contrat cadre de prestation », 14 pages, 38,000 characters. Read it with file: <id>. -->
```

2. **Le plan du fichier** (`read {file}` d'un fichier dont le texte dépasse 12 000 caractères, le seuil d'une page, `PAGE_FULL_MAX`). Comme une longue page, le fichier vient en plan : chaque partie, sa taille en caractères, et la façon de la lire. Une partie, c'est un titre (HTML, docx, odt, `md`), une feuille (xlsx, ods), une diapositive (pptx), une page (PDF).

```text
budget.xlsx (2.1 MB, xlsx) — 3 sheets, 310,000 characters
- Synthèse (12 rows × 8 columns, 900 characters)
- Détail (4,210 rows × 15 columns, 305,000 characters)
- Paramètres (hidden, 30 rows × 2 columns, 4,100 characters)
Read one part with section: "<name>"; the whole text with section: "*".
```

3. **Le texte, d'une partie ou du tout** (`read {file, section}`). `section` vaut le titre, le nom de la feuille, `slide 3` ou `page 4` (`pages 4-6` pour une suite) ; `*` rend tout le texte. Au-delà de 45 000 caractères, le curseur de `read` coupe comme pour une page. Un fichier de moins de 12 000 caractères vient en entier dès le premier appel, sans plan.

- `read {file}` garde ses autres règles (droit de lecture du nœud relu avant l'objet, exclusif d'`outline`, `since_revision` et `draft`, curseur ; [contenu HTML isolé](contenu-html-isole.md)). `file` avec `section` devient admis : la combinaison était refusée, l'admettre n'ôte rien (ADR-002).
- Un argument facultatif `raw: true` (ajout admis par ADR-002) rend l'original : le source d'un format texte (`html`, `svg`, `md`, `txt`, `csv`), pour un assistant qui doit le modifier ; pour un format binaire, une URL signée de 5 minutes, pour un agent qui exécute du code (un xlsx relu par pandas), journalisée sans l'URL. Un assistant sans outil de lecture d'adresse ne la suit pas.
- Un format non lisible (image matricielle tant que sa question est ouverte) est refusé par un message qui dit quels formats sont lisibles.

### Ce que rend chaque format

| Format | Aperçu | Texte rendu, au plus court |
|---|---|---|
| `html` | `<title>`, `meta description`, taille du texte | Titres en `#`, paragraphes, listes, liens `[texte](adresse)`, tableaux markdown, texte alternatif des images ; sans `script`, `style`, `svg`, `noscript`, `template`, commentaires ni `data:` ; blancs resserrés ; quand le texte pèse moins de 5 % du fichier, une ligne le dit (« mostly code: an application ») et propose `raw: true` |
| `pdf` | Titre (propriétés du document, sinon première ligne), nombre de pages, taille du texte | Une section par page (`## Page 4`), le texte de sa couche de texte dans l'ordre de lecture ; les lignes répétées en tête ou en pied de chaque page (en-têtes, numéros) retirées ; un PDF sans couche de texte le dit dans son aperçu (« no text layer: a scan ») |
| `docx`, `odt` | Titre (propriétés, sinon premier titre), plan, taille du texte | Styles de titre en `#`, paragraphes, listes, tableaux markdown, `[image: <texte alternatif>]` ; révisions suivies lues acceptées ; notes de bas de page à la fin ; en-têtes et pieds de page ignorés |
| `xlsx`, `ods` | Feuilles et leurs dimensions ; feuilles cachées dites | Une section par feuille, ses cellules en CSV (plus court qu'un tableau markdown) ; lignes et colonnes vides de bord retirées ; une formule rend sa valeur calculée gardée dans le fichier ; une date, reconnue par le format de sa cellule, en ISO ; une cellule fusionnée lue à son coin |
| `pptx` | Titres des diapositives | Une section par diapositive, son titre, ses textes, puis ses notes |
| `md` | Titre (frontmatter, premier titre, sinon le nom) et résumé (`splitFrontmatter`) | Tel quel ; ses titres font le plan |
| `txt` | Première ligne, nombre de lignes | Tel quel |
| `csv` | Colonnes, nombre de lignes, séparateur | Tel quel : un CSV est déjà le plus court pour un tableau |
| `svg` | `<title>`, `<desc>` | Le texte de `<title>`, `<desc>` et des `<text>` |
| `zip` | Nombre d'entrées, taille décompressée déclarée | La liste des entrées (chemin, taille) ; les `.md` et `.csv` s'importent par `node.import_tree` |
| `png`, `jpeg`, `gif`, `webp` | Dimensions | Question ouverte |

### L'aperçu au dépôt, le texte à la demande

- **L'aperçu** se calcule une fois, juste après que le fichier est devenu `ready`, hors du temps de réponse (`after()` de Next) : après la confirmation d'un envoi (`completeFileUpload`), après l'écriture par le serveur (`storeFile` : dépôt par lien, import d'une arborescence) ; à défaut, à la première lecture par `read {file}`. Un xlsx de 50 Mo se lit en secondes : la personne qui dépose ne l'attend pas. Il est rangé dans une colonne de `platform.files` avec le plan du fichier, et lu avec la ligne : `read` d'une page qui joint dix fichiers ne fait aucun appel au stockage, et le plan d'un grand fichier se sert sans relire l'objet.
- **Le texte** se recalcule à chaque `read {file, section}`, depuis l'objet : rien d'autre à stocker, donc rien de plus à copier à la duplication, à purger avec la corbeille ni à transférer avec une organisation.
- Un fichier déposé avant cette version reçoit son aperçu à sa première lecture par `read {file}` ; jusque-là, sa ligne dans la page reste « nom, taille, type ».
- Une duplication copie l'aperçu avec la ligne ; un transfert d'organisation le porte comme les autres colonnes de `files`.
- L'aperçu est borné à 300 caractères ; le plan rangé, à 200 parties (au-delà, les suivantes se disent par leur nombre) ; `read` d'une page montre l'aperçu des 20 premiers fichiers, les suivants par leur nom seul. Un fichier illisible porte un statut terminal (`unsupported`, `encrypted`, `empty`, `failed`, repris d'oto 1), dit dans son aperçu, et le dépôt lui-même n'échoue jamais pour une lecture ratée.
- L'aperçu (titre, résumé, noms des parties) entre dans `find` ; le texte complet n'y entre pas.

### Le registre des lecteurs

- Un lecteur s'inscrit par `defineReader({ types, read })`, sur le modèle de `defineFunction` ; il rend `{ title, summary, parts: [{ name, chars }], text(part) }`, ou un statut terminal. Le registre vit dans le paquet, en TypeScript : l'hôte est toujours une application Next qui monte le paquet ; un ERP Python fournit son lecteur par un service qu'un lecteur TypeScript de l'hôte appelle.
- **Le paquet inscrit** les lecteurs des formats texte, des formats faits de XML dans un ZIP et du PDF, dans `server/files/readers/`. `fflate` (déjà dépendance du paquet, pour l'import d'une arborescence) ouvre l'archive, un lecteur XML écrit pour le paquet en tire les éléments ; un xlsx ne décompresse que la feuille demandée et ses chaînes partagées. La couche de texte d'un PDF se lit par pdf.js, page par page, sans rendu.
- **L'hôte inscrit** les formats qui demandent un programme tiers (plans DWG/DXF, modèles 3D, reconnaissance de caractères d'un scan). Son lecteur appelle le service qu'il veut, isolé s'il le faut (processus jetable, sans réseau sortant, temps et mémoire bornés) : l'isolation est sa responsabilité, le paquet ne porte aucun contrat de service. Sans lecteur inscrit, un format reste « nom, taille, type ».
- **Paramétrer une lecture** : `section` choisit la partie ; filtrer ou croiser des lignes passe par l'import de la feuille en tableau puis `table.rows`, pas par des arguments du lecteur.

### Bornes

- Un fichier texte reste borné à 4 Mo (HN-E10S02-9). Un format binaire se lit jusqu'à 50 Mo, la taille admise d'un fichier : le serveur lit l'objet, la réponse ne porte que le texte.
- Décompression bornée à 64 Mo en tout, comptée à la taille que l'archive déclare puis vérifiée pendant la lecture (comme `TREE_UNZIPPED_BYTES_MAX`) ; lecture bornée à 10 secondes ; texte d'un fichier borné à 2 millions de caractères, au-delà coupé par une ligne qui le dit.

## Décisions et alternatives écartées

- **Un port lecteur vers un service isolé, branché par une variable** (décision du 08/10) : aucun format ne serait lisible tant que l'hôte n'a pas construit et hébergé un service, et le paquet porterait un contrat de service. Remplacé par le registre : ses deux raisons (programme tiers exposé aux fichiers piégés, licence incompatible) ne valent ni pour un ZIP de XML lu par `fflate`, ni pour la couche de texte d'un PDF ; pour un DWG, le lecteur que l'hôte inscrit isole son programme.
- **Le registre dans `connectors`, partagé entre Python et TypeScript** : écarté, aucun consommateur Python ne lit les fichiers d'oto ; un lecteur Python s'appelle depuis un lecteur TypeScript de l'hôte.
- **Des colonnes et des filtres en arguments du lecteur** : écarté, ce serait réécrire `table.rows` ; la feuille s'importe en tableau.
- **Calculer l'aperçu dans la confirmation du dépôt** : écarté, la personne attendrait la lecture d'un gros fichier et la fonction risquerait son délai.
- **Servir tout le texte d'un coup, découpé par le curseur seul** (le `read {file}` d'aujourd'hui) : écarté, l'assistant lit depuis le début jusqu'à la partie qui l'intéresse ; le plan puis `section` le mène droit à elle.
- **Bibliothèques par format** (`mammoth` pour docx, `exceljs` pour xlsx, SheetJS) : écartées, deux dépendances lourdes pour l'extraction de texte qu'un lecteur XML court fait ; la version npm de SheetJS n'est plus tenue à jour.
- **Retirer les balises d'un HTML par expression rationnelle** : écarté, perd les tableaux et les liens, et décode mal les entités.
- **Les feuilles d'un tableur en tableaux markdown** : écarté, les barres et l'alignement coûtent plus de jetons qu'un CSV pour le même contenu.
- **Stocker le texte complet au dépôt** : lecture instantanée, et prêt pour `find` ; écarté pour l'instant, un second objet à copier, purger et transférer avec chaque fichier.
- **Tout calculer à la demande** : aucune colonne, mais la page reste « nom, taille, type » et l'assistant doit ouvrir chaque fichier pour savoir ce qu'il contient. Écarté par JB le 14/10/2026.
- **L'aperçu après le lien, sur la même ligne** : la ligne ne se relirait plus en bloc `file` et deviendrait un paragraphe à la réécriture de la page.

## Sécurité et confidentialité

- Rien du fichier n'est exécuté : ni script d'un HTML, ni macro d'Office (les formats à macros ne sont pas admis), ni formule recalculée. pdf.js a permis d'exécuter du JavaScript par une police piégée (CVE-2024-4367, corrigée en 4.2.67) : version épinglée au-delà, `isEvalSupported: false`, extraction de texte seule, sans rendu.
- L'URL de `raw` d'un format binaire donne le fichier à qui la détient pendant 5 minutes ; elle n'est jamais journalisée en clair.
- Le lecteur XML ignore toute déclaration `<!DOCTYPE>` et n'interprète que les cinq entités prédéfinies et les références numériques : pas d'expansion d'entités, pas d'entité externe.
- Bornes de décompression, de temps et de taille du texte contre les archives piégées ; un fichier Office chiffré n'est pas un ZIP et se dit illisible, un PDF chiffré aussi.
- L'aperçu est écrit par le service sous la session de qui dépose ; la mise à jour de `files`, aujourd'hui limitée à `status` (HN-E10S02-29), s'étend à la seule colonne de l'aperçu.
- `read {file}` garde le droit de lecture du nœud, relu avant de lire l'objet ; l'aperçu se lit avec la page, au même droit.

## Écart avec le code

- Rien n'est écrit : ni registre, ni lecteurs, ni colonne d'aperçu, ni plan, ni `section` avec `file`, ni `raw`, ni ligne d'aperçu dans `read` ; `read {file}` sert les seuls `html`, `md`, `txt` et `csv`, en texte brut depuis le début.
- `node.import_tree` n'importe pas encore une feuille de xlsx en tableau.

## Questions ouvertes

- Poids de `pdfjs-dist` dans le build d'un hôte et sa tenue dans une fonction serverless, face à `unpdf` (build de pdf.js prévu pour le serverless) : à mesurer avant d'en ajouter un.
- Fichiers rendus par une fonction de connecteur : rangés en fichier joint (`storeFile`) dont la fonction rend l'identifiant, ou lus dans le résultat sans être stockés.
- Le lecteur d'un modèle 3D rend-il une structure que `{ title, summary, parts, text }` ne porte pas ?
- Images matricielles : `read {file}` peut-il rendre l'image elle-même (contenu `image` d'un résultat MCP), que l'assistant verrait, et sous quelle taille ; tous les hosts (claude.ai, ChatGPT) l'affichent-ils ?
- Forme de la colonne d'aperçu et de plan : un `jsonb` (`title`, `summary`, `parts`, `chars`, `reader`, `error`) ou deux colonnes.

## Historique

- 2026-10-08 : lecteurs de format sur les fichiers envoyés à oto, lus à l'envoi et rangés, par un port lecteur branché par l'hôte vers un service isolé ; activés par organisation — décidé par Alexis, à valider avec JB (source : conception de fichiers et stockage).
- 2026-10-14 : lecture de tout format par `read {file}`, en entier ou par partie, au plus léger ; formats texte, XML en ZIP et PDF lus par le paquet, les formats qui demandent un programme tiers laissés à l'hôte ; aperçu au dépôt, texte à la demande ; la vue d'une personne hors sujet — décidé par JB (source : session du 14/10/2026). Registre de lecteurs complété par l'hôte, original atteignable — proposé par Alexis (source : issue des lecteurs de fichiers, 14/10/2026), à confirmer avec lui.
