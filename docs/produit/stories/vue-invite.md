# Story — La vue invité d'une équipe

## Meta

| Champ | Valeur |
|-------|--------|
| **Épic** | Vue invité d'une équipe : ce que les autres équipes ont ouvert, servi à l'assistant, montré dans le rail et réglé par équipe |
| **Parcours** | 5.2 Faire une tâche avec son assistant ; 5.4 Concevoir, organiser, partager |
| **Statut** | 🟢 Ready |
| **Priorité** | Must (lots 1, 2, 6, 3) ; Should (lots 4, 5) ; Could (lot 7) |
| **Référence UI** | Description texte par lot ; aucun composant ni style nouveau : `Dialog`, `ConfirmDialog`, `RowList`, `EmptyState`, `RailSection`, classes `oto-*` existantes |
| **Conventions** | supabase, security, api, mcp, forms, nextjs, state, portage, a11y, registry, testing |
| **Estimation** | L (sept lots livrables un par un, dans l'ordre 1, 2, 6, 3, 4, 5, 7) |
| **Porteuse de migration** | non (tout se lit dans `nodes`, `access_rules`, `teams`, `team_members`, `links`) |
| **Dépend de** | aucune story |

## Contexte

Quand les équipes d'une organisation s'ouvrent des contenus en lecture, un assistant ne sait pas ce que les autres
équipes ont ouvert à la sienne : le routage de `context` et `find` filtrent par droits, mais un assistant ne cherche pas
ce qu'il ignore. Une organisation le compense à la main (un catalogue, des pages recopiées par équipe, des lignes de
routage recopiées dans les Contextes) : quatre copies par partage, qui dérivent.

Une équipe a déjà deux visages. Pour ses membres : son espace et son Contexte. Pour les autres : ce qu'elle leur a
ouvert ; le rail montre déjà une section par équipe dès qu'un contenu visible porte son slug (`sectionsDeLArbre`).
Mais `context` n'en dit rien à l'assistant, le rail ne distingue pas ces sections, et une équipe ne voit nulle part ce
qu'elle ouvre.

**Décision du responsable du produit (17/11/2026) : un partage est la seule source ; tout le reste est une vue
calculée.** Ce second visage s'appelle la **vue invité** d'une équipe.

**Invariants décidés**
1. **Jamais coupée** : dans le budget de `context`, la vue invité passe juste après le bloc `code` (`PRIORITY.guests = 1`).
2. **Déterministe** : même liste quelle que soit la demande ; équipes par nom (comparaison française), entrées par chemin ;
   aucun classement, aucun plafond en lignes.
3. **Le résumé est servi** : `- <chemin> — <titre> — <résumé>` (`CONTEXT_INDEX`).
4. **Repli fixe, par taille seule**, le palier appliqué valant pour tout le bloc :
   palier 1, résumés entiers tant que le bloc fait 5 000 caractères au plus ; palier 2, résumés coupés à 100 caractères,
   à un mot, suivis de « … » ; palier 3, si le bloc dépasse encore 5 000, plus de résumé ; palier 4, si le palier 3
   dépasse 10 000, une ligne par équipe.
5. **Même source que le rail** : exactement ce que le rail montre dans les sections des équipes dont la personne n'est
   pas membre, niveaux calculés sur l'identité de membre (`asMember`).
6. **Confidentialité** : chacun ne voit que ce qui lui est ouvert ; les partages d'une équipe sont réservés à ses membres
   et aux administrateurs ; aucun email.
7. **Aucune migration.**
8. **Le paquet n'ajoute que** : descriptions MCP allongées, props d'écran facultatives ; un hôte qui ne passe rien garde
   le comportement d'avant.

**Périmètre** : les sept lots ci-dessous. **Hors périmètre** : voir le contexte comme un autre membre (montrerait son
Contexte privé ; non prévu) ; une note sur la règle de partage (le titre et le résumé disent déjà quand s'en servir) ;
les espaces privés d'autres personnes dans la vue invité (ils restent sous « Privé » dans le rail) ; un « voir aussi »
calculé dans `read` (à mesurer plus tard) ; un écran pour le rapport du lot 7.

**Refs :**
- PRD : parcours 5.2 et 5.4.
- Conception : `docs/conception/contexte-servi.md` (bloc, priorité, repli, bornes des règles), `docs/conception/droits-d-acces.md`
  (partages d'une équipe, qui perd l'accès), `docs/conception/ecrans-et-coque.md` (rail), `docs/conception/outils-mcp.md`
  (description de `find`, `team.shares`).

## Critères d'acceptation

### Lot 1 — La vue invité dans `context`

Texte servi (constantes `SERVED_GUESTS`, `schemas/context-index.ts`) :

```
## Shared with you by other teams (generated from access rights)
You are not a member of these teams: you read only what is listed here and what sits under a listed folder. Read one with <p>_read; search them with <p>_find.
### Team Finance. Lead: <responsables>.
- finance/paiements/mandat — Mandat SEPA — <résumé>
- finance/politique_esg (+4 under it) — Politique ESG — <résumé>
```

Un **point d'entrée** : un contenu publié, lisible par la personne comme membre, dont le premier segment du chemin est
le slug d'une équipe dont elle n'est pas membre, et sans ancêtre lisible. Les contenus lisibles sous lui ne sont pas
listés : `(+N under it)` les compte.

- [ ] **AC1** **Given** une personne à qui une autre équipe a ouvert une page **When** elle appelle `context` **Then**
  le bloc est servi après les parties de Contexte et avant « Recent content », avec l'en-tête, la consigne, la ligne
  de l'équipe (`Team <nom>. Lead: A, B.`, sans « Lead » quand aucun responsable n'a de nom) et la ligne du contenu.
- [ ] **AC2** **Given** un dossier ouvert qui porte quatre contenus lisibles **Then** une seule ligne, `(+4 under it)` ;
  **Given** un enfant fermé (`none`) sous ce dossier **Then** il n'est pas compté.
- [ ] **AC3** Un résumé n'est jamais vide (la base l'exige, `nodes_summary_check`) : la ligne sans résumé, `- <chemin> —
  <titre>`, n'existe qu'au troisième palier du repli (AC7).
- [ ] **AC4** **Given** une personne membre de toutes les équipes, ou à qui rien n'est ouvert **Then** aucun bloc, et
  `context` ne change pas d'un caractère.
- [ ] **AC5** **Given** un administrateur non membre d'une équipe **Then** il reçoit ce qu'un membre recevrait : les
  seuls contenus qui lui sont ouverts, pas tout l'espace de l'équipe.
- [ ] **AC6** **Given** des Contextes d'équipe qui remplissent le budget **Then** le bloc reste `full` dans le rapport,
  et ce sont les parties de Contexte qui sont coupées.
- [ ] **AC7** **Given** un bloc de plus de 5 000 caractères aux résumés entiers **Then** tous les résumés sont coupés à
  100 caractères, à un mot, suivis de « … » ; s'il dépasse encore, plus aucun résumé ; si le bloc sans résumé dépasse
  10 000, une ligne par équipe : `### Team <nom>. Lead: A. 12 contents shared with you: search them with <p>_find.`
- [ ] **AC8** **Given** deux demandes différentes **Then** le bloc est identique à l'octet ; équipes par nom, entrées
  par chemin.
- [ ] **AC9** **Given** `context` avec `since_ctx` **Then** le bloc n'est pas servi ; un partage ne périme pas le `ctx`.
- [ ] **AC10** **Given** une panne de la lecture **Then** le bloc est omis, `context` répond, la panne est au log.
- [ ] **AC11** Les points d'entrée servis sont ceux des sections du rail des équipes dont la personne n'est pas membre
  (`visibleTree` puis `sectionsDeLArbre`), sur le même jeu.
- [ ] **AC12** La lecture ne coûte pas une requête par équipe : nœuds publiés sous les slugs des équipes invitantes et
  niveaux en un lot, responsables en une lecture.
- [ ] **AC13** Vue « Contexte » de l'écran : le bloc devient la partie « Partagé par d'autres équipes » (ancre
  `guest-views`), un intertitre par équipe avec ses responsables, chaque entrée un lien vers le contenu avec son résumé
  dessous, « et 4 contenus dessous » pour un dossier ; l'explication gagne l'étape « Calculé d'après les partages :
  votre assistant sait ce qu'il peut lire dans les équipes dont vous n'êtes pas membre. » ; le texte recomposé par
  l'écran égale le texte servi, à l'octet.

### Lot 2 — Relancer une recherche en cours de tâche

- [ ] **AC14** La description de `find` finit par « Also use it in the middle of a task, when you need something outside
  the procedure you are following, before answering or escalating. », sans rien retirer, sous 1 000 caractères au pire cas.
- [ ] **AC15** Les règles servies portent, après « Usual order », la ligne « - In the middle of a task, when you need
  something the procedure you follow does not give (another team's content, another topic), run <p>_find before you
  answer or escalate. » ; la borne passe à 20 lignes et 3 950 caractères (21 lignes avec l'adresse).

### Lot 6 — Tester une demande et lire le texte exact sur `/context`

- [ ] **AC16** **Given** `/context?q=<demande>` **Then** l'écran montre ce que `context` servirait pour cette demande
  (`previewContext(db, identity, { phrase })`), la légende « Ce que votre assistant recevrait pour : « … » », le lien
  « Revenir au contexte sans demande », puis la procédure retenue (ou « Aucune procédure retenue ») et les procédures
  proches avec leur score, en liens (`served` et `candidates` de l'aperçu) ; `q` de plus de 2 000 caractères, ou vide, vaut « sans demande ».
- [ ] **AC17** En tête, un formulaire GET d'une ligne : champ « Tester une demande » (indice « Ex. : relance les devis
  en attente »), bouton « Tester », utilisable sans JavaScript ; le champ porte `maxLength` 2 000.
- [ ] **AC18** En bas, une partie repliée « Texte exact envoyé à l'assistant », avec « 12 480 caractères sur 35 000 »
  et le texte brut en chasse fixe, sélectionnable ; présente avec et sans demande, ouverte quand une demande est testée, repliée sinon.
- [ ] **AC19** Un hôte qui ne passe aucune des nouvelles props garde l'écran d'aujourd'hui.

### Lot 3 — La corbeille dit qui perd l'accès

- [ ] **AC20** **Given** un contenu, ou un contenu dessous, ouvert par une règle de lecture ou plus à d'autres que son
  équipe propriétaire **When** `node.trash` sans `confirm` **Then** le récapitulatif porte « Shared with: team Support
  (read), 2 people, the whole organisation: they lose access. » ; les personnes sont comptées, jamais nommées ; ni
  l'équipe propriétaire ni l'appelant n'y figurent ; sans partage, le récapitulatif ne change pas d'un caractère.
- [ ] **AC21** **Given** le dialogue de suppression de l'écran **Then** une lecture serveur précède la question
  (`GET trash/impact?path=`), et le dialogue dit qui perd l'accès, sujet d'abord : « Support, Ventes et 2 personnes n'y auront
  plus accès. », « Support n'y aura plus accès. », « Toute l'organisation n'y aura plus accès. », « 1 personne n'y aura
  plus accès. » (liste à la française, verbe accordé) ; sans partage, le dialogue d'aujourd'hui ; lecture refusée ou en panne : le dialogue d'aujourd'hui, la
  suppression reste possible (le service la contrôle de toute façon).
- [ ] **AC22** La lecture exige le niveau gestion du contenu, comme la suppression (`forbidden` sinon, avec à qui
  demander) ; chemin inconnu : `not_found`.

### Lot 4 — Le rail distingue les équipes où l'on est invité

- [ ] **AC23** **Given** `equipesDeLaPersonne` (slugs) passé au rail **Then** les sections d'équipes dont la personne
  n'est pas membre viennent après « Privé », par nom, sous un seul intertitre « Partagé par d'autres équipes », qui nomme leur groupe pour les
  lecteurs d'écran, sans chevron ni pli ni « + », sur une ligne à 232 px ; leur titre porte, au survol et pour les
  lecteurs d'écran, « Vous n'êtes pas membre de <équipe> : vous y voyez ce qu'elle partage avec vous. » ; elles n'ont pas de « + » de section ; les « + » des contenus qu'on peut écrire restent.
- [ ] **AC24** **Given** un hôte qui ne passe pas la prop **Then** le rail d'aujourd'hui, à l'identique.

### Lot 5 — « Les partages de <équipe> » et `team.shares`

- [ ] **AC25** `teamShares(db, identity, slug)` rend `opened` (contenus de l'équipe ouverts par une règle de lecture ou
  plus à une autre équipe, à une personne non membre, nom seul, ou à toute l'organisation ; groupés par contenu, niveau
  de chaque sujet ; jamais une fermeture `none`), `received` (points d'entrée que d'autres équipes ont ouverts à cette
  équipe, par équipe, filtrés à ce que l'appelant lit) et `brokenLinks` (20 au plus : liens des contenus publiés de
  l'équipe vers un contenu qu'un simple membre de l'équipe ne peut pas ouvrir).
- [ ] **AC26** **Given** un appelant ni membre de l'équipe ni administrateur **Then** `forbidden`, avec à qui demander,
  décidé avant toute lecture ; équipe inconnue : `not_found`.
- [ ] **AC27** `GET teams/<slug>/shares` rend ces données ; la fonction `team.shares` (classe `read`, origine `paquet`,
  l'équipe portée par le paramètre `team` de `call` si le serveur peut le résoudre ainsi, avec son refus d'équipe ambiguë ;
  sinon un argument `team`, et un refus qui liste les équipes de la personne et dit de demander) rend les mêmes en texte compact, borné.
- [ ] **AC28** Le menu d'une équipe porte « Partages de l'équipe… » après « Les personnes de … », pour ses membres et
  pour qui administre ; il ouvre le dialogue « Les partages de <équipe> » (`Dialog` `xl`, pied « Fermer »), chargé à la
  demande : la note des liens cassés quand il y en a, « n contenus partagés hors de l'équipe » (une ligne par contenu, « avec
  Support, Ventes » ou « avec 9 équipes », le niveau au libellé du panneau « Partager », « Régler le partage » pour qui
  gère le contenu), « n contenus partagés par d'autres équipes » (par équipe, « et 4 contenus dessous ») ; états vides : « Rien
  n'est partagé hors de l'équipe » avec « Pour partager un contenu : son menu « Partager ». », et « Aucune équipe ne
  partage encore de contenu avec <équipe>. » ; chargement, erreur.

### Lot 7 (facultatif) — Mesurer les vues invité

- [ ] **AC29** `guestViewsReport`, réservé à l'administrateur (`forbidden` sinon), rend pour chaque membre le nombre
  d'équipes invitantes, de points d'entrée, la taille à chaque palier et le palier servi ; une route d'administration
  en JSON, sans écran.

## Implémentation

### `schemas/`
- `context-index.ts` : `SERVED_GUESTS` (titre, consigne, forme d'une ligne d'équipe, `under`, paliers `GUESTS_FULL_MAX = 5000`,
  `GUESTS_PLAIN_MAX = 10000`, `GUEST_SUMMARY_MAX = 100`) ; réexport dans `index.ts`.
- `team-shares.ts` (lot 5) : forme de `TeamShares` ; `trash-impact` dans `node-gestures.ts` (lot 3).
- `contexte.ts` ou l'existant : schéma du paramètre `q` (lot 6).

### `server/`
- `nodes/guest-entries.ts` (nouveau) : `guestEntries(db, identity)` → équipes invitantes, points d'entrée, comptes ;
  relu par les lots 1 et 5. `nodes/tree.ts` : `asMember` exporté.
- `context/blocks/guests.ts` (nouveau) : `guestsBlock`, les quatre paliers, fonction pure sur les entrées.
- `context/index.ts` : lecture en parallèle (`orOmitted`), bloc placé avant `recent`, `PRIORITY.guests = 1`.
- `context/blocks/team.ts` : `leadsByTeam` reçoit les identifiants d'équipes à lire.
- `context/blocks/code.ts` : la règle du lot 2.
- `nodes/trash.ts`, `nodes/trash-impact.ts` (nouveau) : sujets qui perdent l'accès (lot 3).
- `team-shares.ts` (nouveau), `catalog/registry.ts` : `team.shares` (lot 5). `guest-report.ts` (lot 7).

### `api/`
- `trash.ts` : `GET trash/impact`. `teams.ts` : `GET teams/<slug>/shares`.

### `mcp/`
- `tools.ts` : description de `find`.

### `ui/`
- `contexte/` : `libelles.ts`, `parties-du-contexte.ts` (ancre, lecture des lignes), `contexte-servi.tsx`, `ecran-du-contexte.tsx`
  (formulaire, légende, texte exact).
- `coque/` : `types.ts`, `sections-du-rail.tsx`, `libelles.ts`, `gestes-du-rail.tsx`, `menu-de-l-equipe.tsx` ;
  `arbre/depuis-l-arbre.ts`, `arbre/types.ts` ; `equipes/partages-de-l-equipe.tsx` (nouveau), `equipes/libelles.ts`.

### Hôte de référence
- `src/app/(dashboard)/context/page.tsx` (`q`), `src/app/(dashboard)/layout.tsx` (`equipesDeLaPersonne`).

### Migrations prévues
Aucune : la vue invité se calcule à la lecture.

### Schémas Zod partagés
Le paramètre `q` de `/context` ; la requête de `GET trash/impact` (`nodePathSchema`) ; les arguments de `team.shares`.

## Rayon d'impact

### Appelants
Commandes lancées à la racine du dépôt, sans borne de sortie.
- `assembleContext` — `rg -n -w "assembleContext" packages src tests --glob '!**/node_modules/**'` → `server/context/index.ts`
  (deux appels), `tests/unit/context-engine.test.ts` : un bloc de plus quand la personne a une vue invité ; rien sinon.
- `previewContext` — même commande → `src/app/(dashboard)/context/page.tsx`, `src/app/(dashboard)/n/[...chemin]/page.tsx`
  (deux), `src/app/(dashboard)/admin/organization/page.tsx`, `server/index.ts` (réexport), `tests/unit/context-blocks.test.ts`,
  `tests/integration/pages/{noeud-page,contexte-page,e05s10d-organisation-liens,admin-config-pages,accueil-page}.test.tsx` :
  signature inchangée ; seule la page `/context` passe une phrase. Les doublures de ces tests rendent un aperçu sans
  bloc : inchangées.
- `teamFacts` — même commande → `server/context/index.ts`, `tests/integration/context-blocks-sql.test.ts`,
  `tests/unit/{connectors-context,e05s13-equipes,context-blocks}.test.ts` : résultat inchangé ; `leadsByTeam`, interne, prend
  la liste des équipes en paramètre.
- `visibleTree` — même commande → `src/lib/plateforme/lectures.ts`, `api/nodes.ts`, `server/index.ts`, tests
  `tests/unit/{nodes-personal-tree,api-rail}.test.ts`, `tests/integration/{invitations,gestes-du-rail}.test.ts`, doublures de
  `tests/integration/pages/*` : inchangé ; `asMember` devient exporté.
- `sectionsDeLArbre` — `rg -n "sectionsDeLArbre" packages src tests` → `ui/coque/sections-du-rail.tsx`, `ui/coque/recherche-du-rail.tsx`,
  `ui/noeud/fil.ts`, `tests/unit/ui-arbre-depuis.test.ts`, `tests/integration/invitations.test.ts` : un quatrième paramètre
  facultatif ; sans lui, même résultat pour les trois appelants.
- `MenuDeLEquipe` — `rg -n "MenuDeLEquipe" packages src tests` → un seul rendu, `ui/coque/sections-du-rail.tsx` : une
  entrée de plus, une prop de plus (membre ou non).
- `DonneesDuRail` — `rg -n "DonneesDuRail|<RailApplication" packages src tests --glob '!node_modules'` →
  `src/app/(dashboard)/layout.tsx`, `tests/integration/components/{rail-page-ouverte,rail-application}.test.tsx` : prop facultative.
- `summarizeTrash` — `rg -n "summarizeTrash" packages src tests` → `server/nodes/trash.ts` seul.
- `WORKSPACE_RULES` — `rg -n -w "WORKSPACE_RULES" packages src tests` → `server/context/blocks/code.ts` seul ; bornes dans
  `tests/unit/texte-servi.test.ts`, égalités dans `tests/unit/context-blocks.test.ts` et `tests/integration/mcp-core.test.ts`.
- Description de `find` — texte exact dans `tests/unit/mcp-tools.test.ts`, instantané `tests/unit/__snapshots__/`.

### Doublons
- Le rail calcule déjà les sections des équipes non membres (`sectionsDeLArbre`), côté client, sur l'arbre entier :
  **laisser**, et prouver la parité (AC11) ; le serveur ne peut pas relire un calcul d'écran, et `context` ne doit pas
  lire tout l'arbre.
- `visibleTree` lit tous les nœuds et leurs niveaux : **réutiliser** `asMember` et `nodeLevels` ; ne pas réutiliser la
  lecture (toute l'organisation, brouillons compris).
- `moveImpact` dit qui gagne et perd l'accès à un déplacement, personne par personne : **laisser** ; la corbeille nomme
  des sujets de règles (équipes, compte de personnes, organisation), pas des membres.
- `listNodeRules` rend les règles d'un nœud avec le nom des sujets : **réutiliser** ses noms (`teamsWithLeads`,
  `memberDirectory`) pour les lots 3 et 5.
- `contextBody` rend une ligne d'index sans traiter le résumé vide : **laisser** (non exportée, bornée à 20 lignes) ;
  la ligne de la vue invité prend ses séparateurs dans `CONTEXT_INDEX`.
- `PersonnesDeLEquipe` : modèle du dialogue du lot 5, **réutiliser** sa structure et ses composants.

### Effet produit
- La liste d'outils MCP servie aux hosts : description de `find` allongée ; une fonction de plus (`team.shares`).
- Le texte de `context` : un bloc et une règle de plus ; la jauge du budget d'un Contexte compte le bloc.
- L'application hôte : deux props facultatives à passer (`equipesDeLaPersonne`, `q`), deux routes de plus sous
  `/api/platform`.
- Aucun effet sur le schéma `platform`, ses policies, les connecteurs, les migrations.

### Refacto
- Corriger dans `docs/conception/contexte-servi.md` les deux passages qui gardent l'ancienne borne des règles (16 lignes,
  3 100 caractères) : fait avec le lot 2, la phrase étant devenue fausse.
- Écarté : faire calculer les sections du rail par le serveur à partir de `guestEntries`. Coût : un changement de la
  forme de `GET nodes` pour tous les hôtes ; sans lui, deux calculs de la même règle, tenus par le test de parité.

## Tests attendus

### Unitaires
- [ ] Rendu des quatre paliers, ordre des équipes et des entrées, ligne sans résumé, `(+N under it)`, coupe à un mot.
- [ ] Parité serveur et écran du bloc (`tests/unit/texte-servi.test.ts`) ; bornes des règles ; description de `find`.
- [ ] `sectionsDeLArbre` avec et sans `equipesDeLaPersonne`.
- [ ] Listes exactes du catalogue (`catalog`, `connectors-context`, `mcp-admin-connectors`).

### Intégration (base réelle, `createSqlFixtures`)
- [ ] Une autre équipe ouvre une page, un dossier, puis ferme un enfant ; un administrateur non membre ; une personne
  membre de toutes les équipes ; le bloc `full` quand des Contextes remplissent le budget ; parité avec `visibleTree`.
- [ ] `node.trash` : récapitulatif avec et sans partage ; `GET trash/impact` : niveaux, `forbidden`, `not_found`.
- [ ] `teamShares` : membre, administrateur, étranger (`forbidden` avant lecture, base qui rend des lignes interdites).
- [ ] Page `/context` : `q` passé à `previewContext`, `q` trop long.
- [ ] Composants : rail avec sections invitées, dialogue de suppression, dialogue « Partages » (rempli, vide, erreur).

### MCP et golden queries
- [ ] `context` par `InMemoryTransport` : le bloc dans le texte servi.
- [ ] `docs/reference/mcp-golden-queries.md` : requêtes de la vue invité, de la relance de `find`, de `team.shares` ; une
  ligne au journal des révisions.

### Contrôle visuel
- [ ] Captures en 1440 px et 390 px, thèmes clair et sombre : rail avec sections invitées ; dialogue « Partages » (rempli,
  vide, liens cassés) ; `/context` (sans demande, avec demande, texte exact ouvert) ; dialogue de suppression avec la
  phrase de partage.

## Actions JB

Publication de la version : tag `v1.8.0`, accord donné le 17/11/2026 pour que l'agent le pousse après la relecture des
captures.

## Post-implémentation

### Écarts avec la conception

### Composants créés
| Composant/Hook/Action | Path | Notes |
|----------------------|------|-------|

### Notes
