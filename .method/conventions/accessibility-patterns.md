# Accessibility Patterns (WCAG 2.1 AA)

> Tag : `a11y`
> Lire ce fichier pour toute story avec des composants UI interactifs.

## Principes

1. **Perceivable** — Le contenu est visible/audible par tous
2. **Operable** — L'interface est utilisable au clavier et à la souris
3. **Understandable** — Le contenu et la navigation sont compréhensibles
4. **Robust** — Compatible avec les technologies d'assistance

## HTML Sémantique

```tsx
// BON : structure sémantique
<header>
  <nav aria-label="Navigation principale">
    <ul>
      <li><Link href="/projects">Projets</Link></li>
    </ul>
  </nav>
</header>
<main>
  <h1>Mes projets</h1>
  <section aria-labelledby="active-projects">
    <h2 id="active-projects">Projets actifs</h2>
    {/* ... */}
  </section>
</main>
<footer>{/* ... */}</footer>

// MAUVAIS : div soup
<div className="header">
  <div className="nav">
    <div onClick={navigate}>Projets</div>
  </div>
</div>
<div className="main">
  <div className="title">Mes projets</div>
</div>
```

## Keyboard Navigation

### Ordre de focus
- L'ordre de tab suit l'ordre visuel (pas de `tabIndex > 0`)
- Tous les éléments interactifs sont focusables
- Le focus est visible (outline, ring)

Le focus visible est déjà fourni par les primitives Shadcn du template
(`focus-visible:ring-1 focus-visible:ring-ring`). Ne pas redéfinir une règle de focus globale :
en Tailwind 4, `@apply` hors du fichier qui importe le thème exige `@reference`, et un style
maison divergera de celui des 34 composants existants.

**Vérifiable :**
- aucun `outline-none` / `focus:outline-none` sans `focus-visible:ring-*` sur le même élément
- aucune règle globale `*:focus { outline: none }` dans `globals.css`
- tout élément rendu interactif par un `onClick` sur un `div`/`span` est un défaut : utiliser `<button>`.
  **Exception bornée, champ d'un bloc de l'éditeur** : le `textarea` d'un
  bloc (`ui/noeud/editeur/champ-de-bloc.tsx`) n'a ni fond, ni bordure, ni anneau au focus ; il porte
  `focus-visible:outline-hidden`, qui garde un contour en contrastes forcés ; le curseur reste visible, et
  la rangée (`group`) révèle au focus sa gouttière (« + » et poignée, `group-focus-within:opacity-100`,
  anneau du design system). Le bloc lu qui le précède (`ui/noeud/editeur/champ-au-repos.tsx`) porte la même
  classe : il n'a le focus que le temps de monter le champ qui le prend, et sans elle le `outline: none` du
  design system lui retirerait aussi le contour en contrastes forcés. Contrôle : `rg -n "outline-hidden" packages/plateforme/ui` ne trouve que
  `champ-de-bloc.tsx` et `champ-au-repos.tsx`, dont la rangée est un `BlockRow` dont la gouttière est révélée par `:focus-within`
  (`blocks.css`, `.oto-block-row:focus-within > .oto-block-gutter`)

### Raccourcis clavier
| Touche | Action |
|--------|--------|
| `Tab` | Focus suivant |
| `Shift+Tab` | Focus précédent |
| `Enter` / `Space` | Activer le bouton/lien |
| `Escape` | Fermer modal/dropdown |
| `Arrow keys` | Naviguer dans les listes/menus |

### Skip link
```tsx
// app/layout.tsx — premier élément du body
<a
  href="#main-content"
  className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:bg-background focus:px-4 focus:py-2"
>
  Aller au contenu principal
</a>
{/* ... */}
<main id="main-content">{children}</main>
```

## Formulaires

```tsx
// Chaque input a un label associé
<label htmlFor="email">Email</label>
<input id="email" name="email" type="email" required aria-describedby="email-error" />
{error && <p id="email-error" role="alert" className="text-destructive">{error}</p>}

// Champs obligatoires
<label htmlFor="name">
  Nom <span aria-hidden="true">*</span>
  <span className="sr-only">(obligatoire)</span>
</label>

// Groupe de champs
<fieldset>
  <legend>Adresse de livraison</legend>
  {/* champs */}
</fieldset>
```

## Images

```tsx
// Image informative — alt descriptif
<Image src="/chart.png" alt="Graphique montrant une croissance de 25% sur Q4" />

// Image décorative — alt vide
<Image src="/decoration.svg" alt="" aria-hidden="true" />

// Icône avec action — label accessible
<button aria-label="Supprimer le projet">
  <TrashIcon aria-hidden="true" />
</button>

// Icône informative — sr-only text
<span>
  <CheckIcon aria-hidden="true" />
  <span className="sr-only">Validé</span>
</span>
```

## ARIA

### Régions dynamiques (toasts, notifications)
```tsx
// Les mises à jour sont annoncées aux lecteurs d'écran
<div role="status" aria-live="polite">
  {successMessage}
</div>

<div role="alert" aria-live="assertive">
  {errorMessage}
</div>
```

Une région n'annonce que ce qui change **après son montage** : elle se monte vide, le message
arrive ensuite. Un message déjà présent dans le HTML du serveur (retour d'un rechargement, tiré de
l'URL comme `?saved=1`) s'affiche sans être dit : il s'écrit après l'hydratation
(`StatutDEnregistrement`, `packages/plateforme/ui/marque/`). **Vérifiable :** aucune région
`role="status"` ne reçoit au rendu serveur un message tiré de l'URL.

### États
```tsx
// Bouton loading
<button disabled={isPending} aria-busy={isPending}>
  {isPending ? "Chargement..." : "Sauvegarder"}
</button>

// Expandable
<button aria-expanded={isOpen} aria-controls="menu-content">
  Menu
</button>
<div id="menu-content" hidden={!isOpen}>
  {/* contenu */}
</div>

// Sélection
<div role="option" aria-selected={isSelected}>
  {item.name}
</div>
```

## Focus Management

### Modal
```tsx
// Shadcn/Radix gère automatiquement :
// - Focus trap (Tab reste dans la modal)
// - Focus restore (retour au trigger à la fermeture)
// - Escape pour fermer
```

### Après une action
```tsx
// Après suppression d'un item dans une liste
// → Déplacer le focus vers l'item suivant ou le titre de la liste
const nextItem = listRef.current?.querySelector("[data-index]")
nextItem?.focus()
```

Même règle quand la relecture retire le contrôle qui a le focus sans retirer de ligne : formulaire
dont le dernier choix vient d'être pris, colonne réservée à un rôle que la personne vient de
quitter, formulaire réservé à un niveau que la règle posée vient de lui retirer. Est un tel geste
tout îlot monté sous une condition que son propre succès peut changer (rôle, niveau, liste de choix).
Le focus va au titre de la liste avant la relecture (`replierLeFocusSur`,
`packages/plateforme/ui/components/focus.ts`) ; quand l'îlot ne peut pas prévoir l'issue (le niveau
se calcule en base), à son départ après un succès, dans le nettoyage d'un `useLayoutEffect`, jamais à
un départ sans succès, que le double montage du mode strict provoque (`AjoutDeRegle`). Quand la
relecture peut emporter l'ancre elle-même (la règle posée ou retirée ôte aussi la lecture : l'alerte
« introuvable » remplace le panneau, titre compris), l'élément qui la remplace porte le même
identifiant, et le focus l'y rejoint une fois la relecture posée (`queueMicrotask`) : l'îlot qui replie
à son départ le fait dans le même nettoyage (`AjoutDeRegle`) ; pour un geste qui replie avant la
relecture (« Retirer » d'`ActionPlateforme`), l'ancre qui part avec le focus le passe elle-même à son
remplaçant (`TitreDuPanneau` de `ReglesDuNoeud`). **Vérifiable :** tout geste dont le succès peut
retirer son propre contrôle a un test de focus par état que sa relecture peut rendre (ancre gardée,
ancre remplacée).

Le focus rendu à la fin d'un envoi (bouton pressé, réactivé après un refus) se pose dans un effet qui
court après chaque rendu, gardé par une ref qui dit quoi focaliser, jamais dans un effet qui dépend du
seul état d'envoi : une réponse immédiate (refus en cache, réseau coupé) rend le début et la fin de
l'envoi dans le même rendu, et un tel effet ne court pas. Quand l'envoi peut ne rien changer à l'état du
composant qui porte l'effet (état revenu à sa valeur), React ne le rend pas et l'effet ne court pas non
plus : la demande de focus est alors un état (`useFocusApresLEnvoi`, `ui/corbeille/restauration.tsx`).
Un `<dialog>` démonté ouvert ne rend pas le focus (seul `close()` le fait) : `useNativeDialog` le rend
à l'élément d'avant `showModal()` ; un choix de menu rend le focus à son déclencheur. **Vérifiable :** le
test de ce focus joue une réponse immédiate (`fetch` simulé résolu sans attente ; `rail-application.test.tsx`).

## Couleurs & Contraste

| Élément | Ratio minimum | Outil de vérification |
|---------|--------------|----------------------|
| Texte normal | 4.5:1 | `pnpm audit:lh` (audit `color-contrast`) |
| Grand texte (> 18px bold) | 3:1 | `pnpm audit:lh` |
| Éléments UI (bordures, icônes) | 3:1 | contrôle manuel (hors périmètre de l'audit automatique) |

**Seule exception au 3:1 d'une icône : le chevron d'un pli vide** (titre sans section, menu dépliant sans corps), à demi-opacité (`[data-vide]`, `content.css`) : il ne replie rien et reste cliquable pour ouvrir un corps à écrire ; aucune autre icône active ne descend sous 3:1.

**La règle porte sur les paires réellement utilisées en markup** — `text-muted-foreground` sur
`bg-card`, `text-primary-foreground` sur `bg-primary` — pas sur les tokens pris isolément.
Un token « prévu pour » ne garantit rien : la paire se mesure.

**Une règle CSS ajoutée sous `.oto` qui colore un texte porte en commentaire le ratio de sa paire** sur son fond, le plus
bas des huit teintes, jour et nuit, calculé sur les jetons d'`ui/styles/oto.css` : un jeton du jeu n'est pas lisible
partout (`--faint` tient 3,4 à 4,2:1 sur l'îlot, sous les 4,5:1 d'un texte). **Vérifiable en revue :** une couleur de
texte ajoutée sans ratio dans son commentaire se mesure avant d'être acceptée.

**À relancer après tout changement de token de couleur** dans `src/app/globals.css`, et dans les
**deux thèmes**. Une paire qui passe de justesse (4.4:1) est invisible à l'œil et indétectable en
relisant les tokens — seule la mesure la voit.

**Couleurs de statut de l'hôte : jamais pour un texte.** Mesuré sur les tokens de
`src/app/globals.css`, jour / nuit (OKLCH converti en sRGB, teinte composée sur `bg-card`, ratio
WCAG 2.x) : `text-success` sur `bg-success/10` 3,75:1 / 4,06:1, `text-destructive` sur
`bg-destructive/10` 4,60:1 / 3,31:1, `text-warning` sur `bg-warning/10` 2,49:1 / 6,08:1 ; sur la
carte seule, `text-success` 4,27:1 / 4,42:1 et `text-destructive` 5,38:1 / 3,50:1. Le texte d'une
boîte de statut teintée s'écrit en `text-card-foreground` (plus de 13:1 sur les trois teintes,
dans les deux thèmes) ; la couleur de statut ne sert qu'à la teinte, ou à une icône ou une bordure
qui mesure 3:1 (pas `warning` sur sa teinte le jour, 2,49:1). **Vérifiable :** aucun élément de `src/` ne porte à la fois `bg-<statut>/<n>` et
`text-<statut>` (`success`, `destructive`, `warning`). Défauts connus, antérieurs à la règle : tendance de `StatCard` et badge `success`
(`text-success-foreground` sur `bg-success`, 4,04:1), du gabarit, montrés sur `/design-system`
seulement.

**Pages du groupe `(dashboard)` : tokens du jeu Oto.** Le layout pose autour de chaque page la
`CoquilleOto` du thème de l'organisation : le fond est le bureau du thème (`--desk`) et chaque
écran pose ses îlots ; mesuré dans oto-frontend sur les huit thèmes, jour et nuit,
`--mute` y tient 5,39:1 au moins sur le bureau et l'îlot, 4,78:1 sur la carte, `--ink` au-delà. Les tokens et composants de l'hôte y perdent leur contraste : le
`muted-foreground` de `PageContainer` et `EmptyState` mesurait de 3,77:1 à 4,35:1 la nuit sur les
huit thèmes (page `/`), et le `primary-foreground` de `Button` passe sur le primaire du thème. Une
page, un `loading.tsx` ou un `error.tsx` du groupe écrit son texte en `text-ink` / `text-mute` et
monte les écrans du paquet, jamais un composant de `@/components/`. **Vérifiable :**
`tests/unit/ui-tokens.test.ts` refuse, dans `src/app/(dashboard)/` hors `layout.tsx`, tout import de
`@/components/` et toute classe de couleur de l'hôte absente du jeu Oto.

La même règle couvre les **écrans d'authentification**, rendus sous la `CoquilleOto` que chaque
page pose en `pleinePage` : fichiers `.ts` et `.tsx` de `src/app/(auth)/`,
`src/app/auth/confirm/`, `src/app/no-organization/` et `src/app/oauth/` (consentement OAuth),
sous la même garde (plus aucune classe `border-<couleur>`). Sous `.oto`, une boîte d'alerte ou de statut s'écrit en `text-ink` sur
`bg-card` (l'`Alert` du design system, `ui/ds/react/primitives.tsx`, région de `IlotDAuthentification`) : plus de
10:1 sur les huit thèmes, jour et nuit.

**Règle :** Ne JAMAIS utiliser la couleur seule pour transmettre une information.
```tsx
// MAUVAIS : statut indiqué uniquement par la couleur
<span className="text-red-500">Erreur</span>

// BON : icône de statut + texte (la couleur va à l'icône, 3:1 ; le texte garde 4,5:1)
<span className="flex items-center gap-1">
  <AlertCircle className="h-4 w-4 text-destructive" aria-hidden="true" />
  Erreur
</span>
```

## Testing

```bash
# Lighthouse accessibility audit
npx lighthouse http://localhost:3000 --only-categories=accessibility

# axe-core dans les tests
pnpm add -D jest-axe @axe-core/playwright
```

```typescript
// Test unitaire avec jest-axe
import { axe } from "jest-axe"

it("should have no accessibility violations", async () => {
  const { container } = render(<ProjectCard project={mockProject} />)
  const results = await axe(container)
  expect(results).toHaveNoViolations()
})
```

## Checklist rapide

- [ ] Chaque image a un `alt` (vide si décorative)
- [ ] Chaque input a un `label` associé
- [ ] Le focus est visible sur tous les éléments interactifs
- [ ] L'app est utilisable uniquement au clavier
- [ ] Les contrastes respectent 4.5:1 (texte) et 3:1 (UI)
- [ ] Les régions dynamiques ont `role="status"` ou `role="alert"`
- [ ] Un seul `h1` par page, hiérarchie logique
- [ ] Les icônes d'action ont un `aria-label`
- [ ] `lang="fr"` sur la balise `<html>`
