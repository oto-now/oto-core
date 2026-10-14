# Pages et blocs

- **Statut** : validé avec JB le 24/09/2026
- **Dernière révision** : 2026-10-14

## Résumé

Tout le contenu vit dans une seule table de blocs à identifiants stables, fabriqués par la base : une page est une suite ordonnée de blocs typés, une ligne de tableau est un bloc `row`. Le markdown n'est pas un type de contenu : c'est le rendu des blocs, qu'une analyse inverse relit ; une page est compatible avec le markdown qu'écrit Claude.

## Contexte

Garder documents et tableaux dans deux modèles (sections markdown dans le nœud, table de lignes à part) donnerait deux index, deux chemins d'écriture, aucune identité aux blocs d'une page et un contrôle des blocs `call` par analyse du texte (ADR-011). L'éditeur d'`oto-frontend`, que le paquet porte, travaille sur des blocs à identifiants stables. Ce que JB et ses équipes produisent hors de la plateforme (du markdown copié de Claude, un `.md`) doit y entrer en un geste et rester lisible par les assistants (épic E10, 2026-09-28). Le rangement des nœuds est dans [nœuds et arbre](noeuds-et-arbre.md), leur lecture et leur écriture par un assistant dans [lecture et écriture des pages](lecture-et-ecriture-des-pages.md), leur édition à l'écran dans [éditeur de blocs](editeur-de-blocs.md).

## Objectifs et non-objectifs

- Une table, un index, un chemin d'écriture et un contrôle de droits pour tout le contenu ; écriture, révision et ancre au bloc.
- Le markdown qu'écrit Claude (tableaux, séparateurs, listes imbriquées, replis, titres profonds, barré) s'affiche sans balisage visible.
- Hors objectif : un type de contenu « markdown » ou « CSV » (ce sont des gestes d'import et d'export, D111) ; les tons des encarts (écartés par JB le 2026-09-28, D114) ; le corps d'un repli relu en blocs ; des cases à cocher imbriquées.

## Conception

### Le bloc (ADR-011 § 2)

- **Identité** : `id` (uuid stable, fabriqué par la base, jamais par le client), `org_id`, `node_id` ; `state` (`draft` ou `published`) ; clé primaire (`id`, `state`). E01-S06 N9 : `blocks.org_id` est posé par `blocks_guard` depuis le nœud (refusé s'il en diffère) ; `blocks.id` n'est jamais fourni par l'API (privilèges de colonnes).
- **Ordre** : `position` numérique, pour insérer entre deux blocs sans renuméroter ; les lignes d'un tableau se lisent dans l'ordre de leur clé. E01-S06 N7 : `blocks.position` en `double precision` : pas de 1 024, insertion au milieu de ses voisins, renumérotation du brouillon sous un écart de 1e-6.
- **Type**, liste fermée étendue par migration additive : `heading` (niveaux 1 à 5), `paragraph`, `list` (`ordered` pour des étapes numérotées ; trois niveaux), `checklist`, `code`, `call` (`{function, args}`), `mermaid`, `image`, `callout`, `reference` (`{path, view?}`), `simple_table`, `divider`, `toggle`, `file`, `embed`, `row`. `file` et `image` : [fichiers et stockage](fichiers-et-stockage.md).
- **`embed`** (1.4.3, « Intégration ») : la page `https` d'un autre site montrée dans la page. `data` : `url` (`https://`, 9 à 2 000 caractères, sans blanc ni guillemet, contrôlée par le schéma partagé et par `blocks_shape_check`) et `height` facultative (`small` 320 px, `medium` 480 px par défaut, `large` 720 px) ; texte nul. Markdown : une clôture ```` ```embed ```` dont la ligne porte l'adresse, puis `{"height": "large"}` quand la hauteur est choisie ; relue en `embed` par `write`, et laissée en bloc `code` par l'import tolérant quand elle est mal formée. Lue (écran, page publique, éditeur), une `iframe` pleine largeur, `sandbox` (scripts, formulaires, fenêtres, présentation ; sa propre origine seulement quand elle n'est pas celle de la page, décidé par le navigateur après l'hydratation), `referrerpolicy` `strict-origin-when-cross-origin`, chargée à la demande, et sous elle un lien « Ouvrir <site> dans un nouvel onglet » (un site qui refuse d'être intégré le dit dans le cadre). Toute adresse `https` est admise (décision de JB) : aucune liste de sites. Une adresse tierce qui redirige vers l'origine de l'hôte garde `allow-same-origin` (décidé sur l'adresse écrite) : les pages de l'hôte ne servent pas de contenu d'un client, et un fichier HTML joint se sert sous sa propre politique `sandbox` sans `allow-same-origin`, sur une origine opaque ([contenu HTML isolé](contenu-html-isole.md)).
- **Contenu** : `text` (nul pour un `row` et un `file`) et `data` (JSON propre au type). **Métadonnées** : `key` (ancre lisible, facultative, unique dans le nœud et l'état, obligatoire et immuable pour un `row`), `provenance`, `revision`, bail (`claimed_by`, `lease_until`), auteurs, dates.
- E01-S06 N8 : `key` d'un bloc : 1 à 500 caractères, sans espace de bord ni caractère de contrôle, unique par (nœud, état) ; la clé d'un `row` est obligatoire et ne change pas (`23514`, `blocks_guard`).
- **Recherche** : colonne générée `search_tsv` (configuration `platform.fr`), index GIN ; E01-S06 N21 : tout index GIN d'une migration est créé en `fastupdate = off`. E01-S06 N17 : `search_content` est `security definer` : `@@` et `%>` ne sont pas *leakproof* ; la fonction contrôle l'appartenance et applique `node_level_for` aux seuls nœuds trouvés.
- **Droits** : ceux du nœud, décidés par le service (ADR-012 § 3) ; aucune règle par bloc.
- E01-S06 N40 : parité Zod et base au caractère près : `char_length` compte une paire de substitution pour un caractère, `btrim` ne retire que l'espace U+0020, `[[:cntrl:]]` ne couvre que les caractères Cc.
- E01-S06 N44 : la base admet, par ses chemins JSON `lax`, des formes de blocs que `blockInputSchema` refuse : les services écrivent par ce schéma, et tout lecteur qui rend ou numérote des blocs les valide par `blockInputSchema.safeParse`.

### Le schéma qui porte nœuds et blocs (E01-S06)

- E01-S06 N3 : `open_draft` et `publish_node` sont `security definer` : sous un appelant, niveaux 2 et 3 contrôlés ; sans appelant (outillage par la connexion d'administration), en confiance, auteur de version nul.
- E01-S06 N5 (partie en vigueur) : `open_draft` efface les blocs `draft` restés sans marque. L'abandon d'un brouillon existe depuis E11-S02 ([nœuds et arbre](noeuds-et-arbre.md)).
- E01-S06 N15 : genre `context` ⇔ chemin de Contexte, contrôlé par `nodes_guard` à l'insertion et quand le genre ou le chemin change (`23514`) ; une page créée à ce chemin naît `context`.
- E01-S06 N33 : un déplacement écrit un alias pour le nœud et chacun de ses descendants ; l'ancien chemin reste au nœud qui l'a porté : aucun autre nœud, créé ou déplacé, n'y est admis (`23505`), et le nœud qui y revient échange son alias.
- E01-S06 N36 : `publish_node` refuse une révision ou un brouillon périmés par le SQLSTATE `PT409`, jamais `40001`, qu'un client rejouerait sans fin ; les services le traduisent en `stale_revision`.
- E01-S06 N16 : `check:migrations` admet une contrainte CHECK, ou une clé étrangère, remplacée par une autre du même nom dans la même instruction, sans `if exists` ; la revue vérifie que la nouvelle admet tout ce qu'admettait l'ancienne.
- Choix du même schéma rangés ici : E01-S06 N25 : aides de test du contenu : `publishBlocks`, `addRows`, `addActivation` et `rulesVersion` (`tests/helpers/plateforme.ts`). E01-S06 N28 : `update_my_profile(p_org, p_patch)` n'écrit que `name` (80 caractères) et `language` (`fr`, `en`) ; une chaîne vide retire la clé (étendu depuis au prénom, au nom et à la couleur, [schéma `platform`](../reference/schema-platform.md)). E01-S06 N30 : `sim_outbox.id` a pour défaut `sim_` suivi de 8 hexadécimaux ([connecteurs et comptes](connecteurs-et-comptes.md)).

### Le markdown, rendu des blocs (D111, D114)

- D111 : le markdown et le CSV ne sont pas des types de contenu : ils s'importent en page et en tableau, et s'exportent. Un tableau GFM devient un type de bloc, le « tableau simple », distinct du nœud tableau. Les fichiers vivent derrière un port de stockage S3 générique (ADR-016). Le HTML est un fichier joint, ni type de bloc ni type de nœud (ADR-017, D137).
- Le rendu d'un bloc est une fonction pure partagée par `server/` et `ui/` (`schemas/blocks-render.ts`) : l'assistant et l'écran lisent le même texte (ADR-011 § 5) ; les formes canoniques par type sont dans [lecture et écriture des pages](lecture-et-ecriture-des-pages.md) (E03-S03 N7).
- D114 : les pages sont compatibles avec le markdown (E10-S04) : tableau simple, séparateur, listes imbriquées, repli (`<details>`), marques en ligne (barré, échappements, `<br>`, imbrication, `<https://…>`), titres à cinq niveaux.
- D115, révisé le 2026-10-14 : le menu de l'éditeur écrit trois titres, comme Notion : Grand, Moyen et Petit (niveaux 1, 2 et 3). Un titre importé ou écrit par un assistant garde son niveau et s'affiche selon lui ; au menu, un niveau 4 ou 5 se lit « Petit titre ». Dans l'éditeur, `# `, `## ` et `### ` donnent les niveaux 1, 2 et 3, et au-delà le 3 ; le markdown lu garde ses niveaux (`##` : niveau 1).
- Titre repliable (2026-10-14) : `collapsible: true` dans le `data` d'un titre, rendu `## Titre <!-- toggle -->` (`COLLAPSIBLE_MARKER`, `schemas/blocks.ts`) et relu par l'analyse, le marqueur hors du texte du titre. Le titre replie à l'écran sa section de `splitSections` (`schemas/folds.ts`) ; l'assistant la lit toujours entière. Il est replié par défaut, à la lecture comme dans l'éditeur ; ce qu'une personne ouvre (un titre repliable, un menu dépliant) se garde dans son navigateur, par `id` de bloc (`localStorage`, `ui/noeud/plis-gardes.ts`), ni en base ni dans l'adresse.
- D141 : à l'écran, un titre de niveau N est un `h(N+1)`, borné à `h6` (`h(N+2)` sous `baliseDeTitre="h3"`, le Contexte de l'entreprise dans les réglages) : les titres de niveau 2 et 3 déjà écrits passent en `h3` et `h4`, plus petits ; remplace le rendu d'E05-S10 AC-a5 (« un `<h2>` quel que soit le niveau », E10-S04 AC-b3).
- H-M67 : un titre de niveau 4 ou 5 n'ouvre pas de section.
- HN-E10S04-2 : pas de cases à cocher imbriquées : un sous-élément de `checklist` reste du texte (rare dans ce qu'écrit Claude).
- HN-E10S04-3 : trois niveaux d'imbrication, 20 colonnes et 200 rangées pour un tableau simple ; au-delà, c'est un tableau de données ([tableaux](tableaux.md)).
- HN-E10S04-5 : un tableau ou un séparateur n'interrompt pas un paragraphe (précédé d'une ligne vide ou en tête) ; un tableau commence par `|` : un texte existant ne change pas de sens (`estUnTableau`, GFM restreint). HN-E10S04-9 : cela se lit « au début d'un bloc, jamais dans un paragraphe » : un tableau ou un séparateur qui suit un titre, une liste ou un encart sans ligne vide est reconnu ; une ligne `<details>` interrompt un paragraphe, comme une clôture ou un titre.
- HN-E10S04-6 : la conversion au premier `write` d'une section relue est admise, sans migration des données : un paragraphe fait d'un tableau, un « --- » seul, un paragraphe `<details>` ou un élément qui porte une sous-liste deviennent des blocs neufs ; de même, un élément de liste dont une ligne suivante commence par une marque (`"c\n1. x"`, écrit seulement par l'API des blocs) est relu en sous-liste aux niveaux 1 et 2, et sa section refusée au niveau 3 (`line N: lists go three levels deep at most.`).
- HN-E10S04-10 : la marque qui ouvre une sous-liste est admise de 0 à 3 espaces, ou jusqu'à la largeur de la marque de l'élément moins un quand elle est plus grande (un élément numéroté à partir de 1000 relit sa sous-liste). HN-E10S04-11 : dans une sous-liste, des lignes vides entre deux sous-éléments sont admises et se relisent en liste serrée ; au premier niveau, une ligne vide suivie d'une marque ouvre toujours une seconde liste.
- HN-E10S04-8 : le corps d'un repli n'est pas relu en blocs ; un tableau ou une liste s'y lit en texte (le corps s'affiche comme un encart, D114). HN-E10S04-12 : le résumé d'un repli est lu sans ses blancs de bord et compté comme un titre (`btrim`, 1 à 200 caractères) ; un résumé vide reçoit le refus « a toggle starts with <summary>…</summary> on one line. ». HN-E10S04-15 : les clôtures d'un corps de repli (accents graves ou tildes, 0 à 3 espaces avant ; une clôture jamais fermée court jusqu'à la fin) se lisent par `fencedParts` (`schemas/link-syntax.ts`), que partagent la publication (`links`), l'écran (`cheminsCites`) et le rendu.
- HN-E10S04-13 : un accent grave échappé ne s'affiche sans sa barre oblique que hors d'un span de code (`codeSpans` inchangé) ; un `\<` devant `<https://…>` empêche l'adresse entre chevrons, l'adresse nue qu'il contient restant un lien.
- Dans l'éditeur : HN-E10S04-14 : un élément de liste sur plusieurs lignes se relit en autant d'éléments, et les enfants d'un élément racine sur plusieurs lignes suivent sa dernière ligne ; un sous-élément sur plusieurs lignes montre chacune à sa profondeur, avec sa marque, et se relit en autant de sous-éléments frères, ses enfants après sa dernière ligne : aucun enfant ne change de niveau ni de parent ; une ligne de deux espaces ou plus d'un Texte changé en liste devient un sous-élément. Numéros de gouttière d'une liste numérotée (corrigés par E10-S06) : seuls les éléments du premier niveau se comptent, à partir de `start` (`numerosDeGouttiere`). HN-E10S04-16 : un tableau et un repli se nomment par leurs colonnes ou leur résumé, sinon « bloc vide » (`premiersMots`), un séparateur « Séparateur » (E10-S06) ; `h6` se distingue de `h5` par la mono capitales des intitulés (`content.css`).

### Blocs de référence, inconnus et diagrammes

- H56 : un bloc `reference` `{path, view?}` cite une page ou une vue d'un tableau (`filter`, `sort`, `columns`, `limit` de 20 au plus) ; `read` le sert avec sa ligne résolue, `context` la ligne seule.
- D122 : le lecteur tolérant (`read` affiche une ligne à la place d'un bloc de type ou de forme inconnus, `write` refuse par `conflict` une opération sur une section qui en contient un) sort avant le tag `v1.0.0`. H-M67 : `replace_block` d'un bloc inconnu est refusé aussi ; un bloc que la base admet mais que le schéma refuse reçoit la même ligne et les mêmes refus ; le type n'est pas assaini dans la ligne (liste fermée en base).
- Diagrammes `mermaid` dessinés, à la lecture et dans l'éditeur (1.1.3) : HN-M113-1 : mermaid en 11.17.2 exacte plutôt que la 12 (ES2024, Safari 17.4+, Node ≥ 22.12 à déclarer aux hôtes, ELK embarqué, rendu par défaut changé), chargé à la demande par `import()` dans l'effet d'un composant client (`DiagrammeMermaid`) : une page sans diagramme ne le télécharge pas, le serveur ne l'exécute jamais. HN-M113-2 : le nom accessible du dessin (`role="img"`) est la ligne `title:` ou `accTitle:`, sinon la première ligne qui n'est ni directive (`%%`) ni `---`, coupée à 120 caractères (« Diagramme : <ligne> », « Diagramme » sans ligne). HN-M113-3 : dans l'éditeur, un diagramme vide est traité comme tout bloc vide (neuf : jamais envoyé ; servi puis vidé : supprimé au départ de la rangée, avec « Annuler ») ; le dessin, sous le champ, ne se refait pas pendant la frappe (hors du focus seulement) ; une clôture `mermaid` dans un repli reste du code.

## Décisions et alternatives écartées

- **Sections dans le nœud** (ADR-011) : moins de lignes et un brouillon simple, mais ni écriture ni ancre au bloc, une recherche par section seulement, et le contrôle des `call` par analyse du texte. Écartées.
- **Lignes de tableau dans une table à part** (ADR-011) : contraintes plus nettes, mais deux modèles, deux recherches, deux chemins d'écriture. Écartées, en rendant clé, provenance, révision et bail utiles à tout bloc.
- **Historique bloc par bloc** (ADR-011) : une table de plus sans besoin exprimé ; les instantanés de publication et la révision de chaque bloc suffisent.
- **Titres de niveau 1 à 3 seulement** (ADR-011 § 2 d'origine) : étendus à cinq niveaux (D114, D115) pour le markdown de Claude ; **un `<h2>` quel que soit le niveau** (E05-S10 AC-a5) : remplacé par D141.
- **Diagrammes Mermaid non dessinés** (D114, épic E10) : levé en 1.1.3 (HN-M113-1 à 4) ; **tons des encarts** : toujours écartés.
- **Conversion des données existantes par migration** (HN-E10S04-6) : écartée, les blocs font foi et le markdown en est un rendu ; la conversion se fait au premier `write`.
- **Un `<img src="data:…">` pour le diagramme** (HN-M113-4) : écarté (liens et sélection du texte perdus, `foreignObject` des étiquettes).
- **Pas d'abandon de brouillon** (E01-S06 N5, première partie) : remplacé par `node.discard_draft` (E11-S02).
- **Un seul « Titre » au menu** (D115 d'origine) : remplacé le 2026-10-14 par trois titres. **Six entrées comme Notion** (trois titres et trois titres dépliants) : écartées pour garder le menu court ; « Repliable » est une case d'un titre. **« Repliable » sur un Texte** : écarté, un Texte n'a pas de fin de section, et le menu dépliant couvre ce besoin. **L'état des plis en base** : écarté, c'est une préférence de lecture propre à chacun, gardée dans le navigateur comme les plis du rail. **Le marqueur `## Titre {.toggle}`** (attributs Pandoc) : écarté, les autres lecteurs markdown l'affichent en clair.

## Sécurité et confidentialité

- HN-M113-4 : le SVG est inséré tel que mermaid le rend, assaini par lui (`securityLevel: "strict"`, DOMPurify ; une directive du texte ne change ni ce niveau ni `startOnLoad`) : `security-patterns.md § XSS Prevention`.
- Un bloc n'a pas de droit propre : il hérite de son nœud, décidé par le service ; `search_content` filtre par niveau avant de rendre un extrait (E01-S06 N17).
- Un bloc de forme inconnue n'est jamais perdu en silence (D122, H-M67).

## Écart avec le code

- M80 : dans l'éditeur, un élément racine d'une liste dont le texte commence par deux espaces est relu en sous-élément à la frappe (`elementsLus`, `ui/noeud/editeur/modele.ts`).
- M81 : le littéral `.max(500)` des éléments d'une `list` (`schemas/blocks.ts`) est redondant avec `LIST_ITEMS_MAX`.
- M82 : `beforeOpenFence` (`server/context/engine.ts`) ne reconnaît que les clôtures d'accents graves sans retrait ; à lire par `openingFence` et `closesFence`.
- M99 : `ui/noeud/editeur/modele.ts` est au plafond de 300 lignes depuis la forme « Diagramme ».

## Questions ouvertes

Aucune à ce jour.

## Historique

- 2026-09-24 : une seule table de blocs à identifiants stables, une ligne de tableau est un bloc — décidé par JB (source : ADR-011).
- 2026-09-28 : markdown et CSV sont des gestes d'import et d'export ; pages compatibles avec le markdown (tableau simple, séparateur, repli, listes imbriquées, titres à cinq niveaux) ; dessin Mermaid et tons des encarts écartés — décidé par JB (source : fiches D111, D114, D115, épic E10).
- 2026-09-29 : compatibilité markdown livrée, titres `h(N+1)` à l'écran — décidé par JB (source : story E10-S04, fiche D141).
- 2026-10-14 : trois titres au menu, titre repliable (marqueur `<!-- toggle -->`), plis repliés par défaut et gardés dans le navigateur — décidé par JB (source : session de conception du 2026-10-14, story `titres-et-replis`).
- 2026-09-30 : diagrammes Mermaid dessinés à la lecture et dans l'éditeur (version 1.1.3, sans story).
- 2026-10-01 : refonte en document de conception vivant, qui reprend ADR-011 § 2, les fiches D111, D114, D115, D122, D141 et les choix H56, H-M67, E01-S06, E10-S04, HN-M113 — décidé par Alexis, accord de JB.
- 2026-10-14 : bloc `embed` (« Intégration »), toute adresse `https`, hauteur réglable, publié en 1.4.3 avec sa migration — décidé par JB (source : session du 14/10/2026).
