# Portage des écrans d'oto-frontend dans `ui/`

> Tag : `portage` — routé sur `packages/plateforme/ui/**`.
> Décisions dans ADR-008 (copie fidèle, coque unique).

Un écran d'`oto-frontend` se **copie puis s'adapte**, fidèle à 90 ou 95 % de l'original (ADR-008). Son design
system (CSS et composants) est porté tel quel dans `ui/`, et chaque écran se recopie sur lui. Ne
changent que le routeur (§ 1), la donnée (l'API du paquet, § 4), les icônes (§ 3) et ce que le § 5
exclut. Source en lecture seule : `src/components/` et `src/design-system/` du dépôt `oto-frontend`.

## 0. Une seule coque, le rail d'oto-frontend

- L'application a **une seule coque** : le rail d'oto-frontend (`src/components/coque/rail-application.tsx`
  et ses voisins : entreprise en tête, Accueil, recherche, une section par espace avec le Contexte en
  tête puis l'arbre, et le pied avec Connecteurs pour qui administre et le menu du compte : Contexte, Profil, Brancher mon Claude, ChatGPT ou Mistral, Corbeille, Déconnexion), porté dans `ui/` et monté une fois par le
  layout de l'hôte. L'hôte ne pose **aucune navigation propre**, et aucun écran ne rend un second arbre
  dans son contenu.
- **Tout ce que l'arbre porte est une page** : page, tableau, procédure et Contexte s'ouvrent à
  `/n/<chemin>`, avec l'icône de leur genre dans l'arbre. Aucune page de liste par genre (`/procedures`).
- Les écrans hors de l'arbre s'ouvrent depuis les menus du rail, comme dans oto-frontend : le menu de
  l'entreprise (Organisation, Équipes & accès, Journal) et le menu du compte ; un écran réservé à l'équipe
  d'Oto (Usage, Retours) reste hors des menus, ouvert par la palette.
- **Vérifiable :** `src/app/(dashboard)/layout.tsx` ne monte que la coque du paquet ; aucune route
  `procedures` sous `src/app/` ; le navigateur d'arbre n'est importé que par le rail.
- **Le contenu est un bloc conteneur** : `.oto-content` est `position: relative`, la racine `.oto` n'étant
  pas `<html>` ; sans lui, un élément absolu du contenu (un texte `sr-only`) allonge le document sous le
  bureau. **Vérifiable :** `tests/e2e/connect.spec.ts` exige que la fenêtre ne défile pas.
- **Un élément ajouté à un écran se place dans le conteneur de mise en page de ses voisins** (la colonne
  de la vue, `TwoColumns`, `.oto-content-max`), jamais en frère de ce conteneur au niveau de l'écran : un
  enfant direct de `.oto-content` n'est centré que par la marge `auto` de `.oto-content > *`, que la marge
  propre d'un composant, chargée après à même spécificité (`.oto-linked { margin: 0 }`), efface ; il se
  colle alors à gauche dès que le contenu dépasse `--content-max`. **Vérifiable :** en revue, aucun encart
  (`LinkedContent`) ni autre composant à marge propre n'est rendu à la racine d'un écran ; le test de
  composant de l'écran affirme que l'élément partage le parent de ses voisins, lui-même enfant direct du
  conteneur de `render` (`e11s15-ecrans-d-un-contenu.test.tsx`).

## 1. Navigation reçue de l'hôte, par props

- L'écran reçoit `Lien` (le composant de lien de l'hôte : `next/link`, celui d'un autre routeur,
  ou `"a"`) par props, ou par `ContexteDeLHote` pour le rail et ses morceaux, montés par un layout serveur
  qu'aucune fonction ni aucun composant ne traverse, et une fonction qui construit l'adresse (`hrefDuNoeud`), plus l'état courant
  (`cheminActif`). Il n'importe aucun routeur : `next/navigation`, `next/link` et `@tanstack/*`
  sont refusés par ESLint dans `ui/` (test : `tests/unit/ui-boundary.test.ts`).
- L'hôte monte l'écran dans **sa** route (`src/app/(dashboard)/<route>/page.tsx`, segment en anglais : ADR-020) et y
  lit ses paramètres ; l'état partageable reste dans l'URL de l'hôte (`state-management.md`).
- **Vérifiable :** un `Link` d'oto-frontend devient `<Lien href={…}>` ; une valeur de
  `useParams`/`useSearch` devient une prop.

## 2. Server Component, client au plus bas

- L'écran exporté est un Server Component : il peut ainsi recevoir `Lien` et des fonctions de
  l'hôte, qui ne traversent pas la frontière client. Seul le morceau qui a un état est `"use
  client"` (`branche-d-arbre.tsx`) et reçoit du `ReactNode` déjà rendu, jamais une fonction.
- **Vérifiable :** aucune prop fonction ou composant sur un fichier `"use client"` de `ui/` monté par un
  Server Component ; les composants de `ui/ds/react/` et les crochets de `ui/coque/` en reçoivent, montés
  seulement par des composants clients.
- **Un module rendu par le serveur ne fait d'un export d'un module `"use client"` qu'une balise ou une prop
  passée telle quelle** (`<ImageAgrandissable />`, `as={CarteDeFichier}`), jamais un appel, une lecture de
  propriété ni une valeur rangée dans un objet : côté serveur, chaque export d'un module client, fonction
  ordinaire comprise, est une référence client que le rendu refuse d'appeler (« Attempted to call … from the
  server »), alors que jsdom, le type-check et ESLint l'exécutent sans rien voir. Une fonction ordinaire
  partagée par le serveur et un îlot vit dans un module sans directive (`largeurDe` et `baliseDuTitre` dans
  `rendu-des-blocs.tsx`). **Vérifiable :** `tests/unit/frontiere-client-serveur.test.ts`, sur les modules que
  le serveur atteint depuis le barrel de `ui/` et `src/app/` sans franchir un module client.
- **Un îlot survit à la relecture** (`useRafraichir()`, `router.refresh()` dans Next) : ses props
  changent, ses champs restent. Un champ non contrôlé (`defaultValue`) garde la valeur de son premier
  montage, et `form.reset()` y ramène : l'envoi suivant réécrirait un état que personne n'a choisi.
  Un îlot dont les champs montrent un état servi les y remet à chaque relecture qui le change (listes
  non contrôlées : à la main ; React Hook Form : `values`, `ReglagesDEquipe`).
  Après un refus, un îlot à listes seules revient aussi à l'état servi, rien n'y est à corriger ; un
  îlot à champ texte garde la saisie refusée, à corriger sous le champ. **Vérifiable :** son test
  rerend l'îlot avec de nouvelles props, joue un refus, puis lit les champs.
- **Le rendu du serveur et l'hydratation s'accordent.** Une `key`, un `id` ou un attribut rendu au
  premier rendu d'un îlot ne vient jamais d'un état de module (compteur, `Math.random()`, `Date.now()`) :
  sur le serveur, un module vit d'une requête à l'autre, le navigateur repart de zéro, et les attributs
  divergent (« 1 Issue » de Next sur la page). Une donnée servie prend son identité
  (`id`) ; un élément sans donnée, `useId`. Un compteur de module ne nomme que ce que le navigateur crée
  après l'hydratation (bloc neuf de l'éditeur). **Vérifiable :** dans `ui/`, un `let` de module
  n'alimente aucune valeur rendue au premier rendu ; le test du modèle d'un îlot lit deux fois les mêmes
  données et compare leurs clés (`ui-editeur-modele.test.ts`), et la spec E2E de l'écran échoue sur une
  erreur d'hydratation (`tests/e2e/page.spec.ts`).
- **Un îlot qui écrit dans le `<head>` que rend l'hôte traite chaque élément visé, jamais le premier
  seul.** Quand un script a changé le `<link rel="icon">` servi, Next en ajoute un second, à l'icône
  statique, après l'hydratation : un seul lien repeint en laisse un autre à l'ancienne valeur, et chaque
  navigateur choisit à sa façon entre les deux (mesuré sur `/login`). **Vérifiable :** le test de
  l'îlot ajoute un second élément après le premier dessin et affirme les deux (`favicon-du-theme.test.tsx`).
- **Un îlot exporté garde l'état, l'envoi et le rendu conditionnel** ; ses listes de choix (`<select>`
  et ses options) vivent dans un composant interne aux props de données (`ChampChoix`), ou dans une
  fonction qui calcule les options du `Select` du design system (`optionsDuResponsable`). Sinon le
  mapping de la collection lui fait quatre responsabilités (`coding-standards.md § Complexité`).
  **Vérifiable :** dans un fichier `"use client"` de `ui/`, aucun `.map(` dans le corps du composant
  exporté.
- **Le déclencheur d'un `DropdownMenu` ou d'un `Tooltip` est l'élément qui prend la ref et les
  gestionnaires** (`IconButton`, `Button`, un `<button>`), rendu par une fonction s'il faut le composer
  (`declencheur(nom)`, `menu-d-une-personne.tsx`), jamais un composant maison : l'ancre clone l'élément
  reçu et y pose sa ref, `onClick` et `onKeyDown`, qu'un composant qui ne les transmet pas avale, et le
  bouton n'ouvre rien. **Vérifiable :** le test de composant ouvre chaque menu par son déclencheur
  (`getByRole("button", { name })`, puis `getByRole("menu")`).
- **Une infobulle est l'élément le plus devant : elle entre dans la couche du dessus** (`popover="manual"`,
  `showPopover()` à son montage, `tooltip.tsx`), jamais par un `z-index` : un `<dialog>` modal vit dans cette couche,
  au-dessus de tout `z-index`, et l'infobulle d'un de ses boutons, montée dans la racine `.oto`, passait derrière lui.
  **Vérifiable :** `gestes-equipes.test.tsx` lit l'infobulle d'un bouton du dialogue « Les personnes de … » après ce
  dialogue dans la couche du dessus (`coucheDuDessus` de `tests/helpers/dialogue.ts`).
- **Un `<Suspense>` n'entoure que ce qui attend sa promesse ; son repli ne recopie jamais un contenu déjà
  prêt.** Pendant le flux, le repli et le segment résolu (dans le `div hidden` de React) sont servis tous
  deux : un repli qui recopiait le document servait chaque bloc deux fois, ancres comprises, et une
  recherche stricte de Playwright y trouvait deux éléments. Une lecture qui n'enrichit qu'un détail (le
  titre d'un lien, `LienInterne` de `rendu-des-blocs.tsx`) se suspend au niveau de ce détail.
  **Vérifiable :** le test d'un écran à lecture différée le sert par `renderToReadableStream`, la promesse
  résolue après l'enveloppe, et compte une fois le texte prêt dans le HTML émis
  (`tests/integration/components/flux-des-liens.test.tsx`).

## 3. Tokens du jeu Oto, sous `CoquilleOto`

- Couleurs : uniquement les classes déclarées dans `@theme inline` de `ui/styles/oto.css`
  (`bg-island`, `text-ink`, `text-mute`, `bg-card`, `bg-primary`, `text-primary-on`,
  `bg-skeleton`, `bg-desk`, `bg-hair`, `ring-island-bd`).
- **Focus : `focus-visible:ring-2 focus-visible:ring-ink`, jamais `ring-ring`.** Le `--ring` d'Oto
  (primary translucide) mesure 1,17:1 sur l'îlot, sous les 3:1 d'un indicateur de focus
  (`accessibility-patterns.md § Couleurs & Contraste`) ; il n'est pas déclaré dans `@theme inline`,
  donc `ring-ring` est refusé par `ui-tokens.test.ts`.
- Un token ajouté à `@theme inline` se mesure d'abord en paire réelle (texte / fond, anneau / fond)
  sur les huit thèmes, jour et nuit : une valeur vérifiée dans oto-frontend ne l'est que pour
  l'usage qu'oto-frontend en faisait. Un token de l'hôte absent du jeu (`text-muted-foreground`, `border-border`…)
  rendrait le violet du template sous `.oto` : `tests/unit/ui-tokens.test.ts` le refuse ; les
  couleurs numérotées sont refusées par `check:framework`.
- Besoin d'un autre token du contrat (`--title`, `--hair`, `--oto-bg`…) : l'ajouter à
  `@theme inline`, jamais recalculer une valeur (elles sont vérifiées dans oto-frontend).
- **Hors navigateur, une couleur du jeu se lit dans une table confrontée à `oto.css`.** Un rendu qui ne lit pas le
  CSS (l'image de partage, dessinée par Satori) recopie les valeurs d'un bloc de teinte à l'identique et tire un
  jeton dérivé (`--ink`, `--mute`, `--title`) de sa formule `color-mix` du contrat, jamais d'une valeur choisie :
  une copie diverge sans bruit au premier thème retouché. **Vérifiable :** son test relit `oto.css` et compare la
  table entière (`COULEURS_DE_L_IMAGE`, `tests/integration/components/image-de-partage.test.tsx`).
- **Contour d'un champ : `ring-1 ring-mute`, jamais `border-<couleur>`.** La règle
  `* { border-color: var(--border) }` de `src/app/globals.css` est hors layer : elle bat tout
  utilitaire `border-*` (rangé en `@layer utilities`) et pose le `--border` du template sous `.oto`
  (contour invisible la nuit). `mute` mesure plus de 3:1 sur l'îlot, jour et
  nuit. **Vérifiable :** aucune classe `border-<token>` dans un écran porté (`ui-tokens.test.ts`
  n'exempte aucun écran).
- **Une propriété que pose une classe `oto-*` ne se change pas par un utilitaire sur le même élément** : les feuilles
  du design system sont hors couche et battent `@layer utilities` (`overflow-x-auto` sur un `pre.oto-code`, que
  `overflow: hidden` rognait sans défilement) ; elle se change dans la feuille, sous un sélecteur de contexte.
  **Vérifiable :** en revue, sur chaque élément de `ui/` qui porte une classe `oto-*` et un utilitaire, l'utilitaire
  ne redéfinit aucune propriété que la classe déclare.
- L'écran ne pose pas `.oto` lui-même. Dans le groupe `(dashboard)`, la page non plus : le layout
  pose `CoquilleOto` **une fois**, à la couleur de la personne, sinon à celle de l'organisation (`preferredTheme`). Une `.oto` imbriquée
  redéclare le thème par défaut et écrase celui du client ; seule exception voulue, la pastille
  `aria-hidden` d'un thème proposé. **Vérifiable :** aucune `page.tsx` de `src/app/(dashboard)/`
  n'importe `CoquilleOto`.
- **Écran plein cadre (authentification) : la page pose la racine.** Hors du groupe `(dashboard)`,
  chaque page d'un écran d'authentification pose `CoquilleOto` en `pleinePage`, au thème de
  l'organisation de l'adresse (`marqueDeLAdresse`, `src/lib/plateforme/`), et monte
  `EcranDAuthentification`. Un décor qui ne s'écrit pas en utilitaires (pseudo-élément,
  animation, couleur qui change au point de rupture) vit dans la section 4 d'`oto.css`, en
  sélecteurs `oto-` sous `.oto`, et ne lit que des jetons du contrat : ni jeton déclaré, ni bloc de
  teinte, ni couleur littérale hors d'un masque. Un accent posé sur le panneau d'encre lit
  `--rail-on-bg`, jamais `--primary` (1,01:1 sur `--rail-bg` en Ardoise, le jour). **Vérifiable :**
  `tests/unit/ui-tokens.test.ts` (section d'`oto.css`, fichiers des écrans d'authentification).
  **Exception, le consentement OAuth** (`src/app/oauth/consent/page.tsx`) : `CoquilleOto` en
  `pleinePage` au thème de l'organisation de la ressource (thème par défaut sans organisation
  connue), un `<main>` centré, sans `EcranDAuthentification`, qui poserait « Oto » en second `h1` à côté
  du nom du client ; la marque de l'organisation (logo, nom affiché) est dans l'en-tête de l'écran.
- Les deux thèmes se contrôlent à l'œil (`.dark` sur un ancêtre) avant de livrer.

- **Icônes : `@phosphor-icons/react`**, jamais `lucide-react` (lucide est réservé aux
  internes Shadcn ; refusé par ESLint dans `ui/`). Un glyphe lucide d'oto-frontend se remplace par
  son équivalent Phosphor (`ChevronRight` → `CaretRight`, `List` → `ListBullets`, `Route` → `Path`).
  **Une icône par import** : `@phosphor-icons/react/dist/ssr/<Nom>` dans un Server Component,
  `@phosphor-icons/react/dist/csr/<Nom>` dans un fichier `"use client"`. Le baril
  (`@phosphor-icons/react`, `/ssr`) charge les 1 500 icônes : 40 s par fichier de test,
  qui font tomber les tests voisins par délai. Refusé par ESLint dans `ui/` (sauf
  `import type`).

## 4. Quatre états

- Données reçues en `resultat: { data } | { error }` (forme d'`ActionResult`). L'écran rend :
  **données**, **vide** (phrase, aucune liste), **erreur** (`role="alert"`, message fourni).
- **Chargement** : un export `<Écran>Chargement` (`role="status"`, `aria-busy`, texte `sr-only`),
  que l'hôte passe en `fallback` de son `<Suspense>`.
- **Une lecture en échec se dit toujours.** Elle ne devient pas une liste vide (`resultat.data ?? []`)
  ni un nom inconnu : la section qui en dépend rend l'erreur et « Réessayer ». Un refus fondé sur le
  rôle (« Réservé aux administrateurs ») ne se rend qu'avec une identité lue : l'état de panne de la
  page sert chaque lecture en échec, et l'écran dit l'échec avant la réserve. **Vérifiable :**
  `rg -n "\.data \?\? " packages/plateforme/ui` ne trouve rien ; le test de la page joue la panne
  d'identité sur chaque onglet (`equipes-page.test.tsx`) ; le test de l'écran met chaque prop
  `resultat` en échec, sur l'onglet qui la lit, et affirme l'alerte et « Réessayer » vers la même
  adresse (`LECTURES_EN_ECHEC`, `ecran-equipes.test.tsx`).
- **Un panneau exporté que son hôte monte après avoir dit l'échec reçoit la donnée, pas un
  `resultat`** : sa branche d'erreur serait inatteignable, et sans « Réessayer » (`ReglesDuNoeud`
  reçoit `noeud`, `OngletRegles` rend `ErreurDeLecture`). **Vérifiable :** aucun composant de `ui/` ne
  reçoit un `resultat` que ses appelants ne lui passent qu'en cas de succès.
- **Un code qu'une lecture de l'écran peut recevoir de son service a sa phrase.** La table commune
  (`messageDErreur`) dit les codes de tout geste ; un code propre au service qu'une page lit (`too_large`
  d'un tableau au-delà de la borne des filtres) passe par `resultatDe(promesse, propres)`, avec les
  phrases de l'écran : sans elles, l'écran dit « Réessayez », et « Réessayer » échoue pareil.
  **Vérifiable :** le test de la page fait lever ce code par le service simulé et affirme la phrase
  (`noeud-tableau-page.test.tsx`).
- Tant que l'API de l'écran n'existe pas : données d'exemple **typées** exportées par `ui/` ; l'hôte
  les passe comme il passera la réponse de l'API. Elles partent, avec leur page de montage, dès que
  l'écran réel existe : un client ne voit jamais de données fictives.

## 5. Ce qui ne se porte pas

- Ce qui relève d'Oto seul : agents, exécutions, runs, toolbox, conventions `_org` / `_project` /
  `_run_id`. Jusqu'au service connecteurs (V2) : le bloc Connecteurs de l'accueil (l'entrée Connecteurs du rail est
  portée au pied, pour qui administre). Les menus « ⋯ » et « + » du rail, eux, se portent.
- Les commentaires d'historique d'oto-frontend (dates, numéros de ticket) : garder le pourquoi
  qui vaut encore, en une ligne. Une feuille portée garde chaque pourquoi de son original en une ligne ;
  aucun bloc de commentaire de plusieurs lignes d'oto-frontend n'y entre tel quel.
- **Vérifiable :** chaque écran porté se compare côte à côte à son original : une capture
  d'oto-frontend (prise sur son application, ou fournie par JB) et celle du portage,
  prise au contrôle visuel. Chaque écart visible est listé dans la section « Écarts avec la référence
  UI » de la story, avec sa raison parmi celles de ce paragraphe et des §§ 1, 3 et 4 ; un écart non
  listé est un défaut de revue.

## 6. Une règle du service, une seule source

- **Une rangée locale jamais envoyée (sans `id`) n'est pas du contenu** : ce que l'éditeur rend au reste
  de l'écran pour décrire le brouillon (publication, confirmation d'un Contexte vide) exclut le Texte
  local d'une page vide, sinon une page vide passe pour remplie. **Vérifiable :** le test de la
  confirmation d'un Contexte vide passe sur une page qui porte ce Texte local.

- **Ce que le service et l'écran appliquent tous deux vit dans `schemas/`** : la validation d'une valeur
  (une date), une chaîne que le service sert et que l'écran reconnaît (`FORMER_MEMBER`), une borne
  qu'une phrase de l'écran dit (`FILTERED_ROWS_MAX`, `REVIEW_REASON_MAX`). `ui/` n'importe pas `server/`
  (ESLint) : une copie y diverge sans bruit. La règle passe dans `schemas/`, importée des
  deux côtés ; le module de `server/` qui la portait la réexporte pour ses lecteurs. **Vérifiable :**
  aucune fonction de `ui/` ne refait le corps d'une fonction de `server/`, et aucun libellé de `ui/`
  n'écrit en chiffres une borne que porte une constante de `schemas/` (en revue, `rg` sur la chaîne ou
  le nombre, pas sur le nom : `checklists/code-review.md § Arbitrage de complexité`).

## 7. Mesures de mise en page

- **Au montage, aucune mesure par élément.** Un composant rendu une fois par élément d'une liste (bloc,
  rangée, carte, cellule) ne lit, au montage, aucune mesure de mise en page : chaque lecture après une
  écriture force une mise en page de toute la page, répétée autant de fois qu'il y a d'éléments. Une
  taille se donne par le CSS (`field-sizing: content`), sinon par une passe groupée à l'image suivante :
  toutes les écritures, puis toutes les lectures, puis toutes les écritures (`useHauteurDuTexte`,
  `ui/noeud/editeur/champ-de-bloc.tsx`). Seul le champ qui reçoit la frappe se mesure tout de suite, pour
  grandir pendant qu'on tape. **Vérifiable :**
  `rg -n "scrollHeight|offsetHeight|clientHeight|scrollWidth|clientWidth|offsetWidth|offsetLeft|getBoundingClientRect|getComputedStyle" packages/plateforme/ui`
  — chaque résultat est dans un gestionnaire d'événement, une passe groupée ou le champ qui reçoit la
  frappe ; le cas « une seule passe » de `tests/integration/components/editeur-leger.test.tsx` échoue sur
  une mesure faite au montage. Écart connu, à corriger : `TableCell` (`ui/ds/react/table.tsx`, effet de
  mise en page qui lit `getComputedStyle`, `scrollWidth` et `clientWidth` par cellule), M101.
