# Système de design

Ce fichier ne porte aucune valeur : il dit où vit chaque partie du système de design de ce dépôt,
pour que les renvois de `ui-patterns.md`, du skill `design` et de ses agents (`system.md § <section>`)
mènent à une source réelle. Une règle ou une valeur s'écrit à sa source, jamais ici.

Deux jeux coexistent :

- **Écrans du paquet** (`packages/plateforme/ui/**`) **et pages du groupe `(dashboard)`** : le jeu
  d'`oto-frontend`, porté à l'identique sous `CoquilleOto` (ADR-008). Source des valeurs :
  `packages/plateforme/ui/styles/oto.css` (`@theme inline` et le contrat `.oto`) et `packages/plateforme/ui/ds/`.
  Règles : `.method/conventions/portage-ecrans.md`. Conception : `docs/conception/ecrans-et-coque.md`.
- **Hôte de référence hors coque** (`src/app/**` hors `(dashboard)`, `src/components/**`) : tokens
  Shadcn de `src/app/globals.css` (violet corporate, Inter), composants de `src/components/ui/`.

## Direction

Celle d'`oto-frontend` : les écrans se copient fidèles à 90 ou 95 % de l'original et ne changent
que le routeur, la donnée et les icônes (`portage-ecrans.md`, ADR-008 § 1 et § 6). Le thème est
celui de l'organisation ou de la personne, parmi les huit du contrat, jour et nuit. Aucune
audience, densité ni ton n'est écrit au-delà : un écran nouveau prend ceux de l'écran porté le
plus proche, et une direction qui s'en écarte se pose en question.

## Patterns de page

- Une seule coque, le rail ; aucun écran ne pose de navigation propre ni de second arbre
  (`portage-ecrans.md § 0. Une seule coque, le rail d'oto-frontend`).
- Tout ce que l'arbre porte (page, tableau, procédure, Contexte) s'ouvre à `/n/<chemin>` ; les
  écrans hors de l'arbre s'ouvrent depuis les menus du rail (`docs/conception/ecrans-et-coque.md`).
- Mise en page : `TwoColumns`, `.oto-content-max`, mesures de `portage-ecrans.md § 7. Mesures de mise en page`.
- États : `portage-ecrans.md § 4. Quatre états`.
- Écran plein cadre (authentification, consentement) : `portage-ecrans.md § 3. Tokens du jeu Oto, sous CoquilleOto`.
- Captures d'un écran protégé (groupe `(dashboard)`, tout écran derrière la connexion) :
  `pnpm ui:shots` ne se connecte pas, il rend `/login`. Le `designer` ou le `design-critic` les
  demande au pilote ou à JB, qui les prend à la main, en nommant l'écran (route), l'état (données,
  vide, erreur, chargement, cas du brief) et les largeurs (375, 768, 1280, clair et sombre). Une
  capture de `/login` à la place de l'écran demandé ne vaut pas preuve : un brief ou une critique
  qui s'appuie dessus est un finding (`ui-patterns.md § Preuve visuelle`).

## Règles

`ui-patterns.md` l'emporte partout, écrans du paquet et pages du groupe `(dashboard)` compris, sur
`portage-ecrans.md` comme sur la fidélité à l'original d'`oto-frontend`. Quand les deux
conventions se contredisent sur un cas précis, l'agent ne tranche pas : il pose la question à JB
par `AskUserQuestion` (contexte, options avec la conséquence et le coût de chacune,
recommandation en premier), puis la décision s'écrit dans
`portage-ecrans.md § 8. Écarts à ui-patterns.md, décidés par JB`, qui liste aussi les écarts déjà
décidés (tokens Oto, `ui/ds/`, coque unique). Tout écart à `ui-patterns.md` dans un écran du
paquet ou du groupe `(dashboard)` cite sa ligne dans cette section ; sinon c'est un finding de
revue.

Aucune page `/design-system` n'existe dans ce dépôt : le design system de référence se lit dans
`packages/plateforme/ui/ds/` et, en lecture seule, dans `src/design-system/` d'`oto-frontend`.

## Typographie

Section « Typographie » de `packages/plateforme/ui/styles/oto.css` (Inter et JetBrains Mono, rien
sous 11 px) ; polices dans `packages/plateforme/ui/ds/tokens/`.

## Spacing

Section « Espacement » d'`oto.css` : grille de 4 px, demi-pas réservés au chrome.

## Shadows

Section « Élévation » d'`oto.css` : trois distances (îlot, flottant, dialogue), ombres teintées à
l'encre du thème. Rayons : section « Rayons » du même fichier. Un nouvel empilement (`z-index`) se
documente dans cette section d'`oto.css`.
