# Story — Commentaires d'une page : fils à l'écran, entre personnes

## Meta

| Champ | Valeur |
|-------|--------|
| **Épic** | Commenter les pages, entre personnes et avec l'assistant |
| **Parcours** | 5.4 Concevoir, organiser, partager |
| **Statut** | 🔵 In Progress |
| **Priorité** | Must |
| **Référence UI** | Maquette interactive validée par JB le 12/11/2026 (artefact « Commentaires Oto, maquette ») ; décrite en texte dans « Écran » ci-dessous, qui fait foi |
| **Conventions** | database, supabase, security, api, forms, portage, a11y, registry, testing |
| **Estimation** | L |
| **Porteuse de migration** | oui (tables `comment_threads` et `comments`, additive ; à fusionner avec les autres migrations de la version avant son tag) |
| **Dépend de** | aucune |

## Contexte

Une personne qui lit une page ne peut aujourd'hui rien signaler sans la modifier : ni question, ni correction
proposée, ni relecture. Rien n'existe dans le paquet (ni table, ni route, ni écran). Cette story pose le modèle
des fils et l'écran entre personnes ; l'assistant vient dans `commentaires-assistant.md`, l'email dans
`commentaires-email.md`. Les trois partent dans la même version : une mention sans notification ne se publie pas seule.

**Décisions prises avec JB (12/11/2026)**
- Un fil s'ancre sur un **bloc** (son `id`, stable) et porte en option un **passage cité** en texte ; aucune position
  dans le texte. Un fil sans bloc commente la page entière.
- **Lire suffit** pour commenter et répondre ; tous ceux qui lisent la page voient ses fils. Résoudre ou rouvrir :
  l'auteur du fil, ou qui écrit la page. Modifier ou supprimer : l'auteur du commentaire, lui seul.
- On résout **un fil**, jamais un commentaire.
- Aucune règle d'accès propre aux commentaires : ils suivent la page (corbeille, purge, invisibilité).

**Périmètre**
- Tables `comment_threads` et `comments`, leur RLS, le service `server/comments/`, la ressource `comments` de l'API.
- L'encart « Commentaires » de la colonne de droite d'une page, d'une procédure et d'un Contexte ; en ligne
  au-dessus de la grille pour un tableau (fils sur la page entière seulement).
- La bulle de commentaire à droite de chaque bloc, en lecture comme en édition, et la citation d'un passage sélectionné.
- Les mentions de personnes par `@` : proposées, enregistrées, mises en valeur.

**Hors périmètre**
- `@assistant`, le service des fils à l'assistant et ses fonctions de `call` : `commentaires-assistant.md`.
- L'email groupé : `commentaires-email.md`.
- Commenter une ligne de tableau (un bloc `row`) : V2.
- La recherche dans les commentaires (`find`), leur export (`node.export_tree`, `.md`) : V2. La duplication d'une
  page ne copie pas ses fils.
- La marge gauche des blocs (une poignée, trait d'insertion) : chantier d'éditeur à part.

**Refs :**
- PRD : parcours 5.4 ; exigence `FR-CONC-15`, « commenter un contenu », inscrite.
- Conception : `docs/conception/commentaires.md`, écrit à la livraison, décrit le code livré et fait foi sur
  cette story ; lus : `droits-d-acces.md`, `pages-et-blocs.md`,
  `lecture-et-ecriture-des-pages.md` (identité des blocs, N12), `ecrans-d-un-contenu.md`, `journal-et-retours.md`.

## Modèle

- `platform.comment_threads` : `id`, `org_id`, `node_id` (clé vers `nodes`, cascade), `block_id` (uuid, nul pour
  la page ; sans clé étrangère, la clé de `blocks` étant `(id, state)`), `quote` (texte, 500 caractères au plus, nul),
  `block_revision` (révision du bloc publié au moment du commentaire, nulle sans bloc), `status` (`open` ·
  `resolved`), `resolved_by`, `resolved_at`, `created_by`, `created_at`.
- `platform.comments` : `id`, `org_id`, `thread_id` (cascade), `author` (nul quand la personne est oubliée), `text`
  (1 à 4 000 caractères), `mentions` (`uuid[]`, des membres), `created_at`, `edited_at` (nul tant que le texte n'a
  pas changé).
- États calculés à la lecture, jamais écrits : **passage modifié depuis** (la révision du bloc publié dépasse
  `block_revision`) ; **passage supprimé** (le bloc n'est plus dans l'état publié : le fil se lit au niveau de la page,
  avec sa citation).
- RLS activée sur les deux tables, le rôle repris en base : lecture au niveau lecture du nœud (`node_level_for` ≥ 1) ;
  insertion par l'appelant lui-même (`author`, `created_by` = `auth.uid()`) sur un nœud qu'il lit ; mise à jour du
  texte et suppression d'un commentaire par son auteur ; `status` d'un fil par son auteur ou au niveau écriture (≥ 2).
  La décision reste dans le service, avant la requête.

## Critères d'acceptation

**Service et API**

- [ ] **AC1** **Given** une personne qui lit une page (niveau lecture) **When** elle crée un fil sur un bloc publié,
  avec ou sans passage cité, ou sur la page entière **Then** le fil est créé ouvert, avec son premier commentaire, la
  révision du bloc et la citation ; un `block` qui n'est pas un bloc publié de ce nœud, ou une citation absente du
  texte du bloc, rend `invalid_arguments` et rien n'est écrit.
- [ ] **AC2** **Given** un nœud que la personne ne lit pas, à la corbeille ou inconnu **When** elle lit ou écrit ses
  commentaires **Then** `not_found`, comme un chemin inconnu (H68) ; aucun fil d'un tel nœud n'est jamais servi.
- [ ] **AC3** **Given** un fil ouvert **When** une personne qui lit la page répond **Then** le commentaire s'ajoute en
  fin de fil ; répondre à un fil résolu rend `conflict` (« rouvrez le fil ») et n'écrit rien.
- [ ] **AC4** **Given** un fil **When** son auteur, ou une personne au niveau écriture, le résout **Then** `status`
  passe à `resolved` avec `resolved_by` et `resolved_at`, et il reste lisible ; les mêmes le rouvrent ; toute autre
  personne reçoit `forbidden`, qui dit à qui demander, et rien n'est écrit.
- [ ] **AC5** **Given** un commentaire **When** son auteur le modifie **Then** le texte change et `edited_at` est
  posé ; un autre que l'auteur, administrateur compris, reçoit `forbidden` ; dans un fil résolu, `conflict`
  (« rouvrez le fil ») et rien n'est écrit.
- [ ] **AC6** **Given** un commentaire **When** son auteur le supprime **Then** il disparaît ; supprimer le premier
  commentaire d'un fil supprime le fil et ses réponses ; un autre que l'auteur reçoit `forbidden` ; dans un fil
  résolu, `conflict` (« rouvrez le fil ») et rien n'est supprimé.
- [ ] **AC7** **Given** `GET comments?path=` **Then** il rend les fils du nœud, ouverts d'abord puis du plus récent au
  plus ancien, chacun avec ses commentaires, le nom de chaque auteur (« Ancien membre » sans auteur connu), la section
  de son bloc, ses états calculés, et ce que l'appelant peut faire (`can_resolve` par fil, `mine` par commentaire) ;
  lecture sans ligne de journal (D138).
- [ ] **AC8** **Given** une mutation (`POST`, `PATCH`, `DELETE`) **Then** elle laisse une ligne de journal dont la
  cible est le chemin du nœud ; un corps invalide rend 400 (`invalid_arguments`) sans écriture.
- [ ] **AC9** **Given** un texte qui mentionne `@Prénom Nom` d'un membre qui lit la page **Then** `mentions` porte
  son identifiant ; un nom qui ne désigne aucun lecteur de la page reste du texte, sans erreur.
- [ ] **AC10** **Given** un bloc commenté réécrit puis publié **Then** le fil dit « passage modifié depuis » ;
  **Given** un bloc commenté supprimé à la publication (ou dont l'id a changé) **Then** le fil dit « passage
  supprimé » et se lit sur la page, sa citation gardée.
- [ ] **AC11** **Given** une page mise à la corbeille puis purgée, une organisation supprimée, une personne oubliée
  (`forget_user`) **Then** les fils partent avec la page ou l'organisation, et les commentaires de la personne
  restent sans auteur.

**Écran**

- [ ] **AC12** **Given** une page, une procédure ou un Contexte **Then** la colonne de droite montre l'encart
  « Commentaires » en tête, avant « Cité dans », « Cite » et « Sous-pages », avec la même pastille (glyphe, compte
  des fils ouverts, chevron) ; il est **ouvert à l'arrivée tant qu'au moins un fil est ouvert**, fermé sinon, et
  toujours présent, sans pastille de compte à zéro ; pour un tableau, il est en ligne avec les autres encarts.
- [ ] **AC13** **Given** l'encart ouvert **Then** deux onglets, « Ouverts » et « Résolus », avec leur compte ;
  « Commenter la page », sous les onglets et sur toute la largeur, ouvre un nouveau fil sans passage et sans
  titre, et disparaît pendant son écriture ; sans fil, un texte le dit.
- [ ] **AC14** **Given** un bloc publié, en lecture comme en édition **When** la souris le survole ou qu'il prend le
  focus **Then** une bulle paraît à sa droite, avec l'info-bulle « Commenter ce bloc » ; un bloc qui a des fils
  ouverts garde une pastille permanente avec leur nombre, qui ouvre le premier et surligne le passage ; un bloc
  jamais publié n'a pas de bulle.
- [ ] **AC15** **Given** un texte sélectionné dans un seul bloc **Then** un bouton léger, « Commenter ce passage », paraît centré
  au-dessus du passage (au-dessus du bloc quand la sélection est dans le champ ouvert de l'éditeur) et ouvre un
  nouveau fil dont elle est la citation ; la citation du fil ouvert est surlignée dans son bloc.
- [ ] **AC16** **Given** une carte de fil **Then** elle montre la section du passage (un lien qui y défile), la
  citation, ses états, puis ses commentaires sans avatar (« Nom · quand », « modifié » le cas échéant, le texte, les
  mentions en valeur), et un seul bouton en pied, à droite, « Répondre ».
- [ ] **AC17** **Given** une carte de fil **Then** une coche en haut à droite, toujours visible, résout tout le fil
  (info-bulle : il passe dans « Résolus », reste lisible, peut être rouvert) ; résolu, elle devient « Rouvrir le
  fil » ; pour qui ne peut pas résoudre, elle est désactivée et son info-bulle dit pourquoi.
- [ ] **AC18** **Given** l'un de ses propres commentaires **When** on le survole ou qu'il a le focus **Then** deux
  petites icônes grises en haut à droite : un crayon (modifier en place, « Enregistrer » ou « Annuler ») et une
  poubelle, qui demande confirmation dans la carte avant de supprimer (« Supprimer ce fil et ses n réponses ? » pour
  le premier commentaire).
- [ ] **AC19** **Given** le champ d'un commentaire **When** on tape `@` **Then** une liste propose les membres qui
  lisent la page, filtrée à la frappe, au clavier comme à la souris ; l'aide « @ pour mentionner » est dans le texte d'invite du
  champ, « Annuler » à gauche, « Envoyer » à droite.
- [ ] **AC20** **Given** un refus ou une panne **Then** la carte garde la saisie et dit quoi faire ; quatre états de
  l'encart (chargement, vide, erreur avec « Réessayer », fils).
- [ ] **AC21** Tout se fait au clavier (bulle, onglets, coche, crayon, poubelle, liste des mentions), le focus est
  rendu après chaque geste, et les deux thèmes sont contrôlés.

## Implémentation

**Migrations prévues** (`packages/plateforme/migrations/`, copie dans `supabase/migrations/` par `pnpm migrations:sync`)
- Les deux tables, leurs index (`comment_threads (node_id, status)`, `comments (thread_id, created_at)`), leurs
  policies, les privilèges de colonnes, et `forget_user` étendue (`comments.author`, `comment_threads.created_by` et
  `resolved_by` à nul).

**Schémas Zod partagés** (`packages/plateforme/schemas/comments.ts`, exporté par `schemas/index.ts`)
- `createCommentSchema` (`path`, `thread` ou `block` et `quote`, `text`), `editCommentSchema`,
  `threadStatusSchema`, les types de vue `CommentThreadView` et `CommentView`.

**server/**
- `server/comments/threads.ts` (lire, créer, répondre, résoudre, rouvrir), `server/comments/comments.ts`
  (modifier, supprimer), `server/comments/mentions.ts` (les lecteurs d'un nœud, la lecture des mentions d'un texte).
- `server/database.ts` complété à la main ; à régénérer (`pnpm db:types`).
- `cli/org-tables.mjs` : les deux tables rangées (`deleted`, parent `nodes` puis `comment_threads`).

**api/**
- `api/comments.ts` : `GET comments?path=`, `POST comments`, `PATCH comments/<id>`, `DELETE comments/<id>`,
  `PATCH comment-threads/<id>` ; branchées dans `api/handler.ts`.

**ui/**
- `ui/noeud/commentaires/` : l'encart, la carte de fil, le champ de commentaire et sa liste de mentions, les
  libellés ; `ui/noeud/ecran-de-noeud.tsx` (l'encart en tête de colonne et en ligne), `ui/noeud/sous-pages.tsx` si la
  pastille se partage, `ui/noeud/corps-du-noeud.tsx` et `ui/noeud/editeur/rangee-de-bloc.tsx` (la bulle, par
  l'emplacement `menu` de `BlockRow`), les feuilles de style du système de design (`blocks.css`, `content.css`) ; la règle du
  surlignage de la citation est posée à l'exécution (feuille adoptée, `passage.ts`), le compilateur CSS de l'hôte
  refusant `::highlight()` dans une feuille du paquet.

**Hôte et outillage**
- `scripts/lib/org-transfer.mjs` (export et import d'une organisation), `scripts/demo/` (deux fils de démonstration).
- `docs/reference/schema-platform.md`, `docs/reference/services-et-portes.md`, `docs/conception/commentaires.md`.

**Patterns à suivre**
- `security-patterns.md § Droits dans le service` ; `database-patterns.md § Règles` ; `api-patterns.md` ;
  `portage-ecrans.md` (quatre états, tokens Oto) ; `accessibility-patterns.md`.

## Rayon d'impact

### Appelants
- `EcranDeNoeud` et sa colonne — `rg -n "encarts\(|ContenusLies" c:/apps/oto-core/packages/plateforme/ui` : la
  colonne de droite reçoit un encart de plus, en tête ; un tableau, un de plus en ligne.
- `BlockRow` — `rg -n "BlockRow|oto-block-menu" c:/apps/oto-core/packages/plateforme/ui` : l'emplacement `menu` (à
  droite, vide depuis E05-S11) reçoit la bulle ; la rangée de l'éditeur et le rendu en lecture la posent.
- `forget_user` — `rg -n "forget_user" c:/apps/oto-core/packages/plateforme/migrations` : recréée avec les trois
  colonnes de plus ; rien d'autre ne change pour ses appelants.
- Une table de plus par page, comme `node_views` — `rg -l "node_views" c:/apps/oto-core` : les mêmes fichiers sont à
  toucher (`cli/org-tables.mjs`, `scripts/lib/org-transfer.mjs`, `tests/integration/isolation/donnees.ts`,
  `tests/integration/suppression-organisation.test.ts`, `tests/unit/rls-policies.test.ts`,
  `tests/integration/role-du-serveur.test.ts`, `docs/reference/schema-platform.md`).

### Doublons
- `rg -n -i "commentaire|comment_|thread" c:/apps/oto-core/packages/plateforme/server c:/apps/oto-core/packages/plateforme/ui`
  ne trouve aucun fil de discussion. Le plus proche : `feedback` (un signalement à l'équipe plateforme, sans page ni
  réponse) et la preuve d'une valeur de tableau (`comment` d'une cellule). Verdict : laisser, ce ne sont pas des fils.
- Pastille d'encart : `LinkedContent` (`ui/ds/react/linked-content.tsx`). Verdict : réutiliser.
- Confirmation : `ConfirmDialog` et la confirmation en ligne d'un geste destructeur (`ActionPlateforme`). Verdict :
  réutiliser la confirmation en ligne. Icônes et info-bulles : `IconButton` et le composant d'info-bulle du système
  de design, à vérifier dans `component-registry.md` avant toute création.

### Effet produit
- Schéma `platform` : deux tables et leurs policies ; l'export et l'import d'une organisation les portent.
- Écran d'un contenu : une requête de plus à l'affichage (`GET comments?path=`), hors du budget de la page ; elle ne
  bloque pas son rendu.
- Outils MCP : aucun changement dans cette story (la liste reste figée ; l'assistant vient dans la story suivante).
- Page publique par lien (`/p`) : aucun commentaire n'y est servi ni écrit.

### Refacto
- Écarté : rapprocher `feedback` et les commentaires d'un modèle commun de « fils » ; deux usages et deux cycles de
  vie, aucune duplication réelle.
- Un cran plus simple écarté : une seule table `comments` à parent (le premier commentaire porte l'état du fil) ;
  les colonnes du fil seraient nulles sur chaque réponse, et l'état du fil se lirait sur une ligne qu'on peut supprimer.

## Tests attendus

### Unit tests
- [ ] Lecture des mentions d'un texte : nom d'un lecteur, nom inconnu, deux mentions, `@` isolé.
- [ ] États calculés : « modifié depuis », « supprimé », bloc intact ; ordre des fils.
- [ ] Composants : la carte selon le lecteur (coche active ou non, crayon et poubelle sur les siens seuls), la
  confirmation de suppression, l'encart ouvert ou fermé selon le compte des fils ouverts.

### Integration tests
- [ ] Chaque AC de service sous trois personnes : lectrice, rédactrice, personne sans accès ; refus mot pour mot.
- [ ] RLS, données jetables : lecture, insertion, mise à jour et suppression directes sous un jeton, pour chaque rôle.
- [ ] Isolation de deux organisations, suppression d'une organisation, purge de la corbeille, `forget_user`,
  export puis import d'une organisation avec ses fils.
- [ ] API : codes de retour, journal écrit par les mutations, aucune ligne pour la lecture.

### E2E tests
- [ ] Commenter un passage, répondre, résoudre, rouvrir, modifier, supprimer ; contrôle visuel des deux thèmes.

## Actions JB

- Valider l'écran dans l'application locale avant la fusion.
- Fusionner la migration avec celles de la version au moment du tag.
