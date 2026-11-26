# Fiche — performance-patterns

Texte complet : `.method/conventions/performance-patterns.md`. La fiche suffit pour écrire ; le texte complet se lit sur un doute, et toujours pour une revue. Chaque règle renvoie à sa section.

- `ssr: false` ne s'écrit que dans un fichier dont la première ligne est `"use client"`. § Code Splitting
- Chargement différé obligatoire pour un éditeur riche, une bibliothèque de graphiques, `react-day-picker` et toute dépendance absente du premier rendu ; interdit pour un composant d'un layout, rendu sans condition par une page, ou placé avant le premier `<Suspense>`. § Code Splitting
- Toujours `next/image`, jamais `<img>`, avec `width` et `height` ou `fill` et `sizes` ; exactement une image `priority` par page, celle du LCP. § Images
- Une police passe par `next/font` avec `display: "swap"`, jamais par un `<link>` vers Google Fonts. § Fonts
- Un script tiers passe par `next/script` en `afterInteractive`, en `lazyOnload` s'il n'agit pas au premier rendu ; analytics gardés par `VERCEL_ENV === "production"` ; un embed lourd en façade, un seul par page. § Scripts tiers
- Pas de Lighthouse : poids JS par la sortie de `pnpm build` et les budgets de `packed-host-build`, Web Vitals par Chrome DevTools, accessibilité par axe DevTools en clair et en sombre. § Mesurer
- Aucun constat « bundle trop gros » sans chiffre mesuré. § Tailles cibles — objectifs mesurés
- Imports nommés ; aucune bibliothèque géante pour un usage simple (natif ou `date-fns` plutôt que lodash ou `moment`). § Bonnes pratiques
- Un fichier du segment racine (`opengraph-image`, `generateMetadata` du layout) prend l'image et les métadonnées de partage dans `@otomata_tech/oto_platform/share`, jamais dans `/ui` : le barrel tirerait tout son code client dans chaque page ; budget du JS partagé vérifié par `packed-host-build`. § Bundle Size
- Un écran s'importe de `/ui` par son nom, et l'hôte déclare `optimizePackageImports: ["@otomata_tech/oto_platform/ui"]` (sous-chemin exact) : sans elle, toute route qui importe du barrel charge le code client de toute la face ; `ui/index.ts` ne fait que réexporter ; budgets de `/login` et `/admin` (page et layouts) vérifiés par `packed-host-build`. § Bundle Size
- Les lectures indépendantes partent ensemble (`Promise.all`), jamais en cascade ; une section lente se rend sous son `<Suspense>`. § Parallel fetching · § Streaming avec Suspense
- Seule l'interactivité est cliente : la page reste serveur, le bouton seul est `"use client"`. § Éviter les re-renders inutiles
