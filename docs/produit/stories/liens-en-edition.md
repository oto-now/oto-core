# Story — Liens réduits à leur titre pendant la frappe

## Meta

| Champ | Valeur |
|-------|--------|
| **Épic** | Éditeur de blocs |
| **Parcours** | Écrire une page à l'écran |
| **Statut** | 🔵 In Progress |
| **Priorité** | Should |
| **Référence UI** | N/A (description ci-dessous) |
| **Conventions** | a11y, portage, registry, testing |
| **Estimation** | L |

## Contexte

Au repos, un texte qui porte des liens se lit comme en lecture ; au clic, le champ montrait la source entière (`[[ventes/relance_devis|Relance des devis]]`, `[texte](https://…)`) : le texte grandissait, le bloc sautait, et la phrase se noyait sous les chemins. Décision de JB du 14/10/2026, qui revient sur sa réponse du 30/09 (« pas de version légère des liens pendant la frappe ») : pendant la frappe, un lien se montre `[[Titre]]` (un lien web `[Titre]`), crochets en gris pâle, titre en couleur de lien ; le chemin ou l'adresse restent gardés de côté et repartent à l'enregistrement. Le panneau « Lien » reste le moyen de changer la destination.

**Refs :**
- Conception : `docs/conception/editeur-de-blocs.md` (D107, D152, HN-E11S06-1, alternative C)
- Story voisine écartée : `docs/produit/stories/editeur-visuel.md` (option C)

## Critères d'acceptation

- [ ] **AC-1 — Ce que montre le champ.** **Given** un Texte, un titre, une liste, une liste à cocher ou une citation qui porte `[[chemin|Titre]]`, `[[chemin#clé|Titre]]` ou `[Titre](https://…)` **When** son champ a le focus **Then** il montre `[[Titre]]` ou `[Titre]`, jamais le chemin, la clé ni l'adresse ; les crochets en `--mute` (le gris pâle `--faint` ne tient pas 4,5:1 sur l'îlot), le titre souligné en `--link` ; un lien sans libellé (`[[chemin]]`), une adresse nue et `<https://…>` se montrent tels quels.
- [ ] **AC-2 — Aucun saut.** Le texte du champ au focus est le texte qu'il dessine : passer du repos au focus ne change la hauteur du bloc que par les crochets.
- [ ] **AC-3 — Rien de perdu.** **Given** un texte à liens **When** on tape hors des liens, ou dans le titre d'un lien **Then** le texte enregistré garde chaque chemin, clé et adresse, le titre tapé compris ; un texte relu puis réécrit sans frappe part inchangé, à l'octet.
- [ ] **AC-4 — Les bords d'un lien.** Taper juste avant `[[` ou juste après `]]` écrit hors du lien ; taper entre les crochets écrit dans le titre ; effacer tout le titre retire le lien ; effacer un crochet, ou une sélection à cheval sur un lien et le texte autour, rend le lien à son titre seul, en texte ; un `[`, `]`, `|` ou saut de ligne tapé dans le titre fait de même ; une sélection qui couvre un lien entier l'emporte avec elle.
- [ ] **AC-5 — Annuler.** **Given** un lien rendu à son titre par une frappe **When** l'annulation du navigateur remet `[[Titre]]` **Then** le lien retrouve son chemin, pendant que le champ reste ouvert.
- [ ] **AC-6 — Un lien tapé en entier.** Un `[[chemin|Titre]]` ou `[Titre](https://…)` tapé ou collé se réduit à `[[Titre]]` ou `[Titre]` à sa fermeture, le curseur juste après lui.
- [ ] **AC-7 — Les gestes qui lisent le curseur.** Entrée (scinder), `Tab` dans une liste, « @ », « / », le panneau « Lien » (ouvert par le curseur entre les crochets, refermé par Échap curseur rendu à sa place), le focus posé par un geste de l'éditeur (curseur au caractère touché au repos) gardent leur comportement, le curseur à la même place du texte montré.
- [ ] **AC-8 — Copier, couper.** Une sélection du champ copiée ou coupée met en `text/plain` sa source : un lien entièrement sélectionné avec son chemin ou son adresse, un morceau de titre en texte.
- [ ] **AC-9 — Hors champ.** Le code, l'appel, le repli, les cellules d'un tableau simple et le panneau de conflit gardent leur texte brut ; en couleurs forcées, le dessin coloré se retire et le champ montre `[[Titre]]` lisible.

## Implémentation

- `ui/noeud/editeur/liens-masques.ts` (nouveau, fonctions pures) : `masquer`, `versSource`, `versVisible`, `appliquer` (une frappe du texte montré devient une frappe de la source, bords d'AC-4, liens rendus à leur titre retenus pour AC-5), `sourceDeLaSelection` (AC-8), et le registre `masqueDuChamp` par champ monté, que lisent le clavier et le focus de l'éditeur.
- `champ-de-bloc.tsx` : le champ montre `masque.visible`, chaque frappe passe par `appliquer`, le dessin coloré (`oto-block-miroir`) se pose sur le champ au focus ; copie et coupe.
- `elements-de-liste.tsx` : au focus, la copie d'une liste montre le texte montré, coloré, ligne par ligne.
- `clavier.ts`, `use-editeur.ts`, `lien-du-bloc.tsx` : positions converties par `masqueDuChamp`.
- `editeur.css` : le dessin et ses couleurs, le champ transparent dessous, les couleurs forcées.

## Rayon d'impact

1. **Appelants** (`rg -n "selectionStart|setSelectionRange|\.value\b|texte=" packages/plateforme/ui/noeud/editeur`) : `champ-de-bloc.tsx` (frappe, sélection, « @ », « / », panneau), `clavier.ts` (`entree`, `niveau`), `use-editeur.ts` (focus posé), `lien-du-bloc.tsx` (`rendreLeFocus`), `elements-de-liste.tsx` ; `selection-de-blocs.ts` et `pointeur-de-la-selection.ts` ne posent que le début ou la fin du champ, inchangés. Les tests qui lisent la valeur du champ (`tests/integration/components/*editeur*.test.tsx`, `tests/helpers/champ-du-bloc.ts`) lisent désormais le texte montré.
2. **Doublons** (`rg -n "liensDuTexte|versSource|position" packages/plateforme/ui/noeud`) : `liensDuTexte` (`en-ligne.ts`) reste le seul lecteur des liens, `masquer` s'appuie sur lui ; aucune conversion de positions n'existait.
3. **Effet produit** : l'éditeur de page, de procédure et de Contexte (même champ) ; rien côté service, MCP, base ni migration : la source enregistrée ne change pas.
4. **Refacto** : l'éditeur riche (ADR-021) reste écarté. Fait, sans changement de comportement : la hauteur du champ (`lignesEstimees`, `useHauteurDuTexte`) sort de `champ-de-bloc.tsx` dans `hauteur-du-champ.ts`, le fichier dépassant sinon la borne de 300 lignes d'ESLint.

## Hypothèses

- H1 : le titre montré est le libellé écrit, à l'octet ; un lien sans libellé montre son chemin (le montrer par le titre de la page changerait le texte sous les doigts quand on le tape).
- H2 : l'annulation après une frappe qui a réduit un lien (AC-6) ou rendu un lien à son titre peut perdre l'historique du navigateur à cet endroit : le champ est réécrit par l'éditeur.

## Post-implémentation

- **Arbitrage** : écartée, la version d'un cran plus simple, le texte brut seulement coloré (chemin en gris, titre en couleur) : un fichier de moins, mais le bloc sautait toujours. Écartée aussi, une correspondance des liens par leur rang, sans suivre les frappes : un lien effacé décalait les chemins sur les titres suivants.
- **Surfaces nouvelles** : `liens-masques.ts` (sans lui, aucune position du champ ne se traduit en position de la source), `use-liens-masques.ts` et `miroir-des-liens.tsx` (`champ-de-bloc.tsx` dépasserait la borne de 300 lignes ; le dessin coloré n'existe pas sans eux), `hauteur-du-champ.ts` (même borne).
- **Contraste** : les crochets passent de `--faint` (3,4 à 4,2:1 sur l'îlot) à `--mute` (5,4:1 au moins), le titre en `--link` (4,9:1 au moins), ratios calculés sur les jetons d'`oto.css` des huit teintes, jour et nuit.
- **Vérifié dans un navigateur** (aperçu temporaire de l'éditeur, retiré) : la hauteur du bloc est la même au repos et au focus (51,6 px), jour et nuit ; une frappe dans un titre de liste et après le lien part avec les chemins gardés.
- **Tests** : `tests/unit/ui-editeur-liens-masques.test.ts` (AC-3 à AC-6, AC-8), `tests/integration/components/liens-en-edition.test.tsx` (AC-1, AC-3, AC-7, AC-8) ; les suites de l'éditeur lisent la valeur du champ comme le texte montré, et `texteDuBloc` lit la source.
- **Non couvert par un test** : AC-2 (la hauteur ne se mesure pas sous jsdom), les couleurs forcées d'AC-9.
