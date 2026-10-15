# Fiche — accessibility-patterns

Texte complet : `.method/conventions/accessibility-patterns.md`. La fiche suffit pour écrire ; le texte complet se lit sur un doute, et toujours pour une revue. Chaque règle renvoie à sa section.

- Structure sémantique (`header`, `nav` nommée, `main`, `section` titrée), jamais une soupe de `div`. § HTML Sémantique
- L'ordre de tabulation suit l'ordre visuel, aucun `tabIndex` supérieur à 0, tout élément interactif est focusable. § Ordre de focus
- Le focus visible des primitives Shadcn reste : aucun `outline-none` sans `focus-visible:ring-*` sur le même élément, aucune règle globale `*:focus { outline: none }`. § Ordre de focus
- Aucun `onClick` sur un `div` ou un `span` : un `<button>`. § Ordre de focus
- `outline-hidden` n'est admis que sur le champ d'un bloc de l'éditeur (`champ-de-bloc.tsx`) et sur le bloc lu qui le précède (`champ-au-repos.tsx`), dont la rangée révèle sa gouttière au `:focus-within`. § Ordre de focus
- Escape ferme une modale ou un menu, les flèches parcourent listes et menus. § Raccourcis clavier
- Un lien d'évitement, premier élément du `body`, mène à `#main-content`. § Skip link
- Chaque champ a un `label` associé, son erreur liée par `aria-describedby` en `role="alert"`, l'obligation dite en `sr-only`, un groupe en `fieldset` et `legend`. § Formulaires
- Image informative : `alt` descriptif ; décorative : `alt=""` et `aria-hidden` ; bouton à icône : `aria-label`, icône en `aria-hidden`. § Images
- Un succès s'annonce en `role="status"`, une erreur en `role="alert"`. § Régions dynamiques (toasts, notifications)
- Une région se monte vide et reçoit son message ensuite ; un message tiré de l'URL s'écrit après l'hydratation, jamais au rendu serveur d'une région `role="status"`. § Régions dynamiques (toasts, notifications)
- Les états s'exposent : `aria-busy` pendant l'envoi, `aria-expanded` avec `aria-controls`, `aria-selected`. § États
- Après la suppression d'un élément d'une liste, le focus va à l'élément suivant ou au titre de la liste. § Après une action
- Un geste dont le succès peut retirer son propre contrôle replie le focus sur le titre de la liste (`replierLeFocusSur`), au départ après succès dans le nettoyage d'un `useLayoutEffect` quand l'issue se calcule en base ; une ancre remplacée garde le même `id` ; un test de focus par état que la relecture peut rendre. § Après une action
- Le focus rendu à la fin d'un envoi se pose dans un effet qui court après chaque rendu, gardé par une ref (par un état, `useFocusApresLEnvoi`, si l'envoi peut ne rien changer) ; son test joue une réponse immédiate. § Après une action
- Un `<dialog>` démonté ouvert rend le focus par `useNativeDialog` ; un choix de menu rend le focus à son déclencheur. § Après une action
- Le contraste se mesure sur les paires réellement utilisées, dans les deux thèmes : texte 4,5:1, grand texte et éléments d'interface 3:1, sauf le chevron d'un pli vide, à demi-opacité ; `pnpm audit:lh` après tout changement de token de couleur. § Couleurs & Contraste
- Une règle CSS ajoutée sous `.oto` qui colore un texte porte en commentaire le ratio de sa paire, le plus bas des huit teintes jour et nuit (`--faint` ne tient pas 4,5:1 sur l'îlot). § Couleurs & Contraste
- Une couleur de statut de l'hôte ne colore jamais un texte : aucun élément de `src/` ne porte `bg-<statut>/<n>` avec `text-<statut>` ; le texte d'une boîte teintée est en `text-card-foreground`. § Couleurs & Contraste
- Pages, `loading.tsx` et `error.tsx` du groupe `(dashboard)`, et écrans d'authentification : texte en `text-ink`/`text-mute`, écrans du paquet montés, aucun import de `@/components/` (`tests/unit/ui-tokens.test.ts`). § Couleurs & Contraste
- Sous `.oto`, une boîte d'alerte ou de statut s'écrit en `text-ink` sur `bg-card` (l'`Alert` du design system). § Couleurs & Contraste
- Jamais la couleur seule pour une information : une icône ou un texte l'accompagne. § Couleurs & Contraste
- Un seul `h1` par page, une hiérarchie de titres logique, `lang="fr"` sur `<html>`. § Checklist rapide
