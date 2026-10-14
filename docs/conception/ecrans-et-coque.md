# Écrans et coque

- **Statut** : validé avec JB le 23/09/2026
- **Dernière révision** : 2026-10-02

## Résumé

Les écrans du paquet (`ui/`) sont copiés d'`oto-frontend`, sans routeur imposé, sur son jeu de tokens, sous une seule coque, `CoquilleOto`, que l'hôte pose une fois dans son layout (ADR-008).
Le rail porte l'arbre visible de la personne et se relit seul ; l'accueil, la vue « Contexte », le profil et le guide « Brancher mon Claude, ChatGPT ou Mistral » vivent sous cette coque.
Ce document répond à : d'où viennent les écrans du paquet, et comment l'hôte les monte-t-il sous une seule coque ?

## Contexte

`oto-frontend` (une SPA : React 19, Vite, TanStack Router et Query, Tailwind v4, design system maison) couvre déjà 80 à 90 % de l'interface visée : navigateur d'arbre, éditeur de page par blocs, grille de tableau avec filtres, agrégats et file de revue, procédures, éditeur de Contexte, équipes et droits, journal. Le paquet s'installe pourtant dans une application qui a son propre routeur (Next App Router) et son propre thème ([vue d'ensemble](vue-d-ensemble.md)). Les retours de JB et du responsable d'Oto (E05-S09, E05-S11, E11-S09, E11-S10, E11-S20) ont fixé la coque, le rail, l'accueil et le guide de branchement.

## Objectifs et non-objectifs

- Reprendre l'essentiel de l'interface d'`oto-frontend`, fidèle à 90-95 %, sans dépendre de son dépôt.
- Un écran s'embarque aussi seul dans une page d'un ERP (la vue d'un tableau dans une fiche client).
- Une seule navigation visible, quel que soit le niveau d'intégration choisi par l'hôte.
- Hors objectif : agents, runs, projets et pages héritées d'`oto-frontend` ; l'écran Connecteurs refait sur notre modèle (V2, [connecteurs et comptes](connecteurs-et-comptes.md)) ; la traduction des écrans ([adresses et langue](adresses-et-langue.md)).

## Conception

### Écrans copiés, sans routeur, sur le jeu d'Oto (ADR-008)

- **ADR-008 § 1** : le design system (CSS et composants, `ui/ds/`) et chaque écran sont recopiés puis adaptés au routeur, à la donnée et aux icônes ; l'accueil n'a ni agents ni connecteurs. Méthode : `.method/conventions/portage-ecrans.md`.
- **ADR-008 § 2** : un écran reçoit la navigation de l'hôte (liens, `onNavigate`, paramètres), n'importe ni TanStack Router ni `next/navigation` ; l'hôte monte l'écran dans sa route et lui passe son rafraîchissement.
- **ADR-008 § 3** : le contrat `.oto` et ses huit thèmes, portés à l'identique dans `ui/styles/oto.css`, s'appliquent sous `CoquilleOto`, au thème de l'organisation. Classes sémantiques du jeu (`bg-island`, `text-ink`…) ; aucune couleur numérotée, aucun token de l'hôte absent du jeu (test et `check:framework`). Le client choisit l'un des huit thèmes, avec son logo et son nom affiché ; la favicon prend la couleur du thème ; la nuit suit la classe `.dark` de l'hôte. La couleur de l'organisation est le défaut de tout compte sans choix, nouveau ou non, lue à chaque page, sans copie à la création d'un compte ; un compte qui a choisi garde son choix (HN-E05S11-3).
- **ADR-008 § 4** : `ui/` n'importe jamais `server/`, `migrations/` ni un client de base ; il parle à `api/` par HTTP, même origine, avec la session de l'utilisateur (FR-INST-03, lint et test) ; ses mutations passent par `/api/platform/*` (H03, [vue d'ensemble](vue-d-ensemble.md)).
- **ADR-008 § 5** : les mêmes composants servent au widget routeur dans la conversation (`packages/plateforme/widgets/`, [outils MCP](outils-mcp.md), ADR-009 § 3 proposé) : `Table`, `RenduDUnBloc`, `EmptyState`, `Skeleton`, `Alert` et `Button`, sous `.oto` au thème de la personne sinon de l'organisation ; le widget n'importe ni `server/`, ni `api/`, ni `mcp/` (ESLint).
- **ADR-008 § 6** : une copie, pas un import ; un écran porté ne change que le routeur, la donnée et les icônes.
- **ADR-008 § 7** : une seule coque, le rail d'`oto-frontend` porté dans `ui/`, montée une fois dans le layout de l'hôte, qui ne pose aucune autre navigation ; tout nœud (page, tableau, procédure, Contexte) s'ouvre à la même adresse de nœud, sans page de liste par genre. Trois niveaux, tous exportés par `ui/` : la coque entière ; les morceaux du rail (sections de l'arbre, recherche, menus) dans la coque de l'ERP, sans second rail ; un écran seul dans une page de l'ERP.
- Une page de montage et ses données d'exemple partent dès que l'écran réel existe : un client ne voit jamais de données fictives (P16).
- Design system : une seule copie par composant (HN-E05S09-fus-1 : `ObjectLink`, `TwoColumns`, `Breadcrumb`, le fil du nœud lit le type `Maillon` ; HN-E05S09-fus-5 : `RowList` avec repli d'une ligne, `InputAffix`, `Select`, `SegmentedControl` ; HN-E05S09-fus-9 : `Checkbox`, `InputAffix`, `Select`, `Textarea`, `ListTools`, `Table`, `Radio`, `Popover`, `RadioGroup` et `Tooltip`, sur `Anchor` de `anchor.tsx`). Un seul `Select` du DS, déclencheur `oto-scope`, popover rendu dans la couche du déclencheur (pas de portail, qui fermait « Partager ») ; une entrée cachée porte `name` et la valeur ; le « multi-select » reste les menus à cases (HN-E05S11-14). Tab referme le `Select` sans choisir : un Tab dans « Partager » n'envoie aucun changement de droits (HN-E05S11-f3). `Onglets` d'`equipes/onglets.tsx` est réutilisé tel quel, onglet dans l'adresse (`?onglet=`), « Activités » par défaut, le premier jour dans « Activités » (HN-E05S11-11).
- Focus : l'anneau `--focus-ring` est un trait d'encre de 2 px (`--rail-fg` sur le rail), avec un écart d'îlot, au lieu du `--ring` d'`oto-frontend` (HN-E05S09a-11) ; un champ focalisé et refusé (`aria-invalid`) garde le halo d'erreur du design system (`_interaction.css`, `--st-fail` à 24 %, 3 px), bordure `--st-fail` et message sous le champ (HN-E05S09d3-16).

### Écrans d'authentification

- Le logo fait un tour à l'arrivée, en 5 s au plus, puis reste immobile (WCAG 2.2.2) (D15) ; les écrans portent la mention « Données hébergées en France » (D16).
- La marque de l'adresse est attendue 1 000 ms au plus avant le rendu ; au-delà, thème par défaut, sans ligne d'organisation, et `console.error` (HN-E05S07-4).
- Un seul bloc de marque porte le `h1` et la promesse à toute largeur : sous `lg`, il reste dans l'arbre d'accessibilité (`sr-only`), la marque compacte étant `aria-hidden` (HN-E05S07-7).
- Sur le panneau d'encre, mot-clé, grand mark et halo sont en `--rail-on-bg` (au moins 5,81:1 sur les huit thèmes), jamais en `--primary` (1,01:1 en Ardoise, le jour) (HN-E05S07-8).
- `/login` porte la légende « Pas encore de compte ? On entre sur invitation : demandez-en une à l'administrateur de votre organisation. » ; `/forgot-password` le lien « Retour à la connexion » ; aucune ailleurs (HN-E05S07-12). L'inscription libre, quand l'hôte l'active : [offres de l'hôte](offres-de-l-hote.md).

### Rail et menus

- Sous 768 px, un bouton « Menu » ouvre le rail en tiroir, sans piège du focus (D90).
- L'arbre des écrans d'un admin est celui d'un membre, calculé par le service (`visibleTree` sur l'identité de membre) : il y voit ses équipes et une page partagée avec lui, son équipe ou toute l'organisation ; ses droits ne changent pas (HN-E11S10-5, validée par le responsable d'Oto). Un admin ne voit dans le rail que ses équipes ; le créateur d'une équipe en devient responsable (D136). `admin_team create` avec `email` : la personne nommée devient la seule responsable, le créateur reste membre, la description de l'outil ne change pas (HN-E11S10-9).
- Le Contexte reste dans le rail : ligne « Contexte · <section> », son « + », glisser-déposer ; la fiche D110 ne change pas (HN-E11S10-13, tranchée par le responsable d'Oto). Son titre est composé à l'écran (`titreDeContexte(section)`), jamais un champ ; le titre enregistré ne change pas (HN-E05S11-13). Le « ⋯ » d'un Contexte offre « Télécharger en .md », son seul geste (D139).
- L'espace Privé existe dès la première connexion : `ensure_private_space` n'écrit rien sous un `private/<handle>` tenu par une autre personne, ni Contexte, ni changement de propriétaire (HN-E11S10-A) ; la renumérotation `<handle>_<n>` est sautée quand l'espace est déjà à `private/<handle>`, un second appel n'écrit rien (HN-E11S10-B). Sa migration (`20260929160000`, après `20260929140000` d'E11-S04) est réunie dans la migration unique de 1.1.0 (HN-E11S10-C ; D131, D145, D124, [distribution du paquet](distribution-du-paquet.md)).
- **Le rail se relit seul** (E11-S20) par `GET /api/platform/nodes/tree`, dans la ressource `nodes`, sans paramètre, le service du layout (`visibleTree`) sous la session, lecture sans journal (D138) (HN-E11S20-6) :
  - un geste demande la relecture par `useRafraichir`, le point que tous les gestes appellent déjà ; `router.refresh()` rejoue aussi le layout, dont le nouvel arbre est adopté ; le rail montre le dernier arbre arrivé (HN-E11S20-1) ;
  - 5 s au moins entre deux relectures, comptées depuis le départ de la précédente ou le montage, pour le seul retour sur l'onglet (`visibilitychange` → `visible`) ou la fenêtre (`focus`) ; une navigation ou un geste relit toujours (HN-E11S20-2) ;
  - un échec (réseau, refus, réponse sans tableau `tree` ni booléen `truncated`) garde l'arbre montré ; trois échecs d'affilée affichent « L'arbre n'a pas pu être actualisé. » sous les sections, dans une région de statut montée vide (annonce polie), retiré au premier succès ; un arbre servi en échec par le layout est remplacé par la première relecture réussie (HN-E11S20-3) ;
  - une demande pendant une relecture en vol ne lance rien de plus : les demandes se fondent en une relecture, après elle ; la requête en vol n'est pas annulée (HN-E11S20-4) ;
  - équipes et nom de l'organisation restent ceux du layout, relus avec la page (`router.refresh()`) ; les relire avec l'arbre demanderait une seconde route (HN-E11S20-5).
- Menus. Les écrans sans équivalent dans `oto-frontend` se rangent sous les menus les plus proches (« Suivi de l'entreprise », « Réglages de l'entreprise », « Membres & équipes ») (HN-E05S09-1). Les connecteurs n'ont ni entrée du rail ni bloc d'accueil ; leur écran d'administration reste joignable par le menu des réglages, pour qui administre (HN-E05S09-2). « Couleur », au pied du rail, choisit le thème de l'organisation (`PATCH brand`, le reste inchangé), pour qui administre ; un nom affiché égal au nom de l'organisation repart vide (HN-E05S09a-1). La langue de l'organisation vit dans `orgs.brand.language` (`fr`, `en`, facultative), à côté du thème : `org_by_host` la rend déjà avec la marque, sans lecture ni migration de plus ; son effet : [adresses et langue](adresses-et-langue.md) (HN-E05S11-4). Le menu de l'entreprise ne liste que l'organisation de l'adresse : aucune bascule, on change d'organisation en changeant d'adresse (HN-E05S09a-2).
- Menu du compte : « Contexte » en tête, glyphe `Info`, clé `contexte` ; sans `adresses.contexte`, ni entrée ni commande de la palette (HN-E11S10-18) ; « Brancher un assistant » si l'hôte en sert l'adresse ; jour et nuit suivent le système (HN-E05S09a-3, amendée ci-dessous). `/profil` est une page de l'hôte ouverte à tout membre (HN-E05S11-30) : prénom et nom dans `members.profile` (`first_name`, `last_name`), `name` recomposé par `update_my_profile` pour que tout lecteur de `name` reste juste (HN-E05S11-2).
- Les écrans Marque, Drapeaux et Accès plateforme restent exportés jusqu'à leur retrait (M65) : `ui/index.ts` est un fichier d'ajout, les pages de l'hôte redirigent (HN-E05S11-15).

### Accueil et vue « Contexte »

- La vue « Contexte » est une entrée du menu engrenage (route `/context`), plus un onglet de l'accueil (D136). Elle découpe le texte de `previewContext` par son rapport (tailles, séparateur de deux caractères), sans service nouveau ; une partie issue d'un Contexte que la personne peut écrire monte l'éditeur de ce Contexte, les autres se lisent ; « Vous » renvoie à Profil (HN-E05S11-8). Ses ancres sont stables : `code`, `vous`, `organisation`, `equipes`, `nouveautes`, `procedures`, `documents`, `contexte-tout-le-monde`, `contexte-<slug d'équipe>`, `contexte-prive`, et `partie-<rang>` pour un nom servi inconnu (HN-E05S11-9). `VersLaPartie` ne défile au montage que si l'adresse porte une ancre ; une ancre sans partie amène `#haut-de-la-vue` (HN-E11S10-E).
- Les lignes techniques sous chaque titre (organisation, personne, équipe, connecteurs) sont cachées à l'écran, l'assistant les reçoit toujours (HN-E11S10-14). « Nouveautés » a sa section de repli dans les trois cas d'absence où `newsBlock` rend `null` (HN-E11S10-22), placée avant les blocs `procedures` et `recent content`, après toutes les autres parties (HN-E11S10-D). Le code mort de l'ancienne vue est parti (`REGLES_OTO`, morceau `regles`, les deux `Regles`, `teteSansEnTete`) ; `SERVED_RULES` reste, servi par `blocks/code.ts` (HN-E11S10-15). Ce que sert `context` : [contexte servi](contexte-servi.md).
- Dans l'îlot « Activités » de l'accueil (`h2`), les titres de journée sont des `h3` (HN-E11S10-F). Portée et mise en page de l'accueil suivent les options par défaut de Q3 et Q4 (questions ouvertes).

### Brancher un assistant (E11-S09)

- Le nom est « Brancher mon Claude, ChatGPT ou Mistral » : le produit s'appelle ChatGPT, « GPT » est le modèle (HN-E11S09-1). Un guide par onglet d'assistant (D136) : quatre onglets, Claude Code en dernier ; le guide s'ouvre sur la famille de la connexion la plus récente, sinon claude.ai (HN-E11S09-2).
- L'étape 1 de claude.ai garde « Paramètres → Connecteurs » ; les libellés de menu de ChatGPT et de Le Chat se relisent au banc, un libellé se corrige sans changer la structure des étapes (HN-E11S09-3). « Rechargez la page » est une note de la dernière étape de claude.ai ; les notes « Une adresse par organisation » et « compte principal » de ChatGPT sont retirées ; Mistral n'a pas de phrase de préférences (HN-E11S09-4). Le lien direct de ChatGPT reste `https://chatgpt.com/#settings/Connectors`, non vérifié (HN-E11S09-8).
- Les demandes à essayer viennent de `usefulProcedures` sur les deux écrans, trois au plus, complétées par les exemples génériques (HN-E11S09-5). La famille « Mistral » n'existe au journal qu'après le relevé de la signature `initialize` de Le Chat ; d'ici là `hostFamily` ne la connaît pas (HN-E11S09-6).
- « Brancher un assistant » est un aparté de l'accueil (adresse du serveur copiable, état du branchement) ; `/connect` reste l'adresse directe des guides (HN-E05S09-3), au menu du compte et dans les métadonnées OAuth ; la fenêtre de l'accueil n'a plus de lien « Guides d'installation » (HN-E11S09-7). Le guide des utilisateurs : `../exploitation/guide-installation.md`.

## Décisions et alternatives écartées

- **Les tokens de l'hôte, que la marque du client remplit** : un seul jeu dans le dépôt, mais les écrans perdent les surfaces (îlot, bureau, carte) et les huit thèmes vérifiés. Écartée (ADR-008).
- **Réécrire les écrans sur Shadcn/ui** : perte du travail d'`oto-frontend`. Rejetée (ADR-008).
- **`oto-frontend` en SPA à côté de l'ERP** : deux applications, deux thèmes, intégration en cadre ; contredit ADR-001. Rejetée.
- **Imposer TanStack Router** : incompatible avec l'App Router de l'hôte. Rejetée.
- **Les Contextes hors des lignes du rail, derrière un bouton info par section** (partie de D136) : abandonné, le Contexte reste une ligne du rail (HN-E11S10-13).
- **La vue « Contexte » dans l'accueil** : remplacée par l'entrée `/context` du menu engrenage (D136).
- **Relire le rail par une minuterie** : écarté, rien ne relit le rail sans geste ; une personne ajoutée à une équipe par un autre la voit au prochain chargement ou après son prochain geste (HN-E11S10-10) ; la relecture à la navigation, au retour sur l'onglet et après chaque geste (E11-S20) a complété ce choix.
- **« Profil » ouvrant le Contexte Perso (`/n/perso/<handle>/contexte`) et « Apparence » au menu du compte** (HN-E05S09a-3) : remplacés par la page `/profil` (HN-E05S11-30) ; la couleur de la personne est dans Profil, celle de l'organisation dans Organisation.

## Sécurité et confidentialité

- `ui/` ne voit jamais `server/` ni la base : toute donnée arrive par props depuis la page serveur de l'hôte, toute mutation par l'API sous la session (ADR-008 § 4) ; les droits se décident dans le service ([droits d'accès](droits-d-acces.md)).
- Le rail ne montre que l'arbre visible de la personne (`visibleTree`), y compris pour un admin.
- Deux écarts de contraste du design system porté restent tels quels, par fidélité : le contour des champs contre l'îlot et le halo d'un champ refusé et focalisé ; un thème nouveau se vérifie d'abord dans `oto-frontend` (`verify-contrast.mjs`).

## Écart avec le code

- M65 : retirer `RailThemePicker`, les écrans Marque, Drapeaux et Accès plateforme et leurs clés d'adresse.
- M52 : restes de la reprise des écrans (export de `recentDocuments` par `./server`, `connexionsDe` en double entre `/` et `/connect`, lien d'évitement `#main-content`, `/auth/confirmer` au `Button` du design system, aides des specs e2e).
- M69 : après un déplacement par « ⋯ », le focus tombe sur le document au lieu du nœud déplacé.
- M72 : dans la vue « Contexte », la ligne « Not loaded: … » d'un Contexte écrivable est masquée par l'éditeur.
- M73 : lignes de faits et de connecteurs du Contexte encore en anglais à l'écran, `EcranUsage` et `usageSummary` sans page.
- M96 : campagne visuelle à mener dans les deux thèmes (zoom, « Partager », filet de `/connect` et de « Brancher », explication de la vue « Contexte »).
- La spec e2e `rail.spec.ts` d'E11-S20 est écrite, non lancée ; la famille « Mistral » attend le banc Le Chat (HN-E11S09-6).

## Questions ouvertes

- **Q3 — Portée des activités de l'accueil** (HN-E05S12-14) : **A.** celle du journal, qui administre voit l'organisation, un membre ses gestes et ceux des équipes qu'il mène ; **B.** tout geste sur un contenu que la personne lit, auteur nommé. Suivie par défaut : A. À trancher par JB.
- **Q4 — Mise en page de l'accueil** (HN-E05S12-20) : **A.** 2fr / 1fr, « Procédures utiles » à droite, « Contenus récents » retiré ; **B.** « Contenus récents » à la place des procédures. Suivie par défaut : A. À trancher par JB.

## Historique

- 2026-09-23 : écrans copiés d'`oto-frontend`, sans routeur imposé, sur son jeu de tokens, sous une seule coque — décidé par JB (source : ADR-008).
- 2026-09-28 : écrans d'authentification habillés, page `/profil`, couleur de l'organisation par défaut, vue « Contexte » et ses ancres — décidé par JB (source : fiches D15, D16, D90, stories E05-S07, E05-S09, E05-S11).
- 2026-09-29 : vue « Contexte » au menu engrenage, rail de l'admin réduit à ses équipes, créateur responsable, guide par onglet d'assistant ; le Contexte reste dans le rail ; « Télécharger en .md » sur un Contexte — décidé par JB et le responsable d'Oto (source : fiches D136, D139, stories E11-S09, E11-S10).
- 2026-09-30 : le rail relit seul son arbre à la navigation, au retour sur l'onglet et après chaque geste — décidé par le pilote (source : story E11-S20).
- 2026-10-01 : refonte en document de conception vivant, qui reprend ADR-008, les fiches D15, D16, D90, D136, D139, P16, les questions Q3 et Q4 et les choix des stories E05-S07, E05-S09, E05-S11, E11-S09, E11-S10, E11-S20 — décidé par Alexis, accord de JB.
- 2026-10-02 : ADR-008 § 5 appliqué : le widget routeur dans la conversation rend les composants du design system — proposé par la session de la story widgets-dans-la-conversation, avec ADR-009 § 3 ([outils MCP](outils-mcp.md)).
- 2026-10-03 : le menu du compte du rail offre la bascule jour ou nuit quand l'hôte la sert (`Hote.apparence` : le mode et le geste) ; le mode reste à l'hôte, le paquet ne l'écrit pas — demandé par JB (source : hôte SaaS, aucun moyen de changer de mode dans l'application).
