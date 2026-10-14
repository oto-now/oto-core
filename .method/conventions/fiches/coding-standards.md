# Fiche — coding-standards

Texte complet : `.method/conventions/coding-standards.md`. La fiche suffit pour écrire ; le texte complet se lit sur un doute, et toujours pour une revue. Chaque règle renvoie à sa section.

- Fichiers en kebab-case ; composants et types en PascalCase, un type avec un suffixe descriptif (`UserRow`, `LoginFormData`) ; variables et fonctions en camelCase. § Naming
- Une Server Action se suffixe `Action` (`loginAction`), un schéma Zod `Schema` (`loginSchema`). § Naming
- Avant de créer un fichier, le placer selon l'arborescence de référence : actions par domaine dans `lib/actions/`, schémas dans `lib/schemas/`, fonctions pures dans `lib/utils/`, `components/ui/` (Shadcn) jamais modifié à la main. § Structure des fichiers
- Server Component par défaut ; `"use client"` seulement pour un state, un effet, un gestionnaire d'événement ou une API du navigateur, poussé au plus bas (parent serveur qui lit, enfant client interactif). § Server Components vs Client Components
- Server Actions, clients Supabase et authentification suivent `api-patterns`, `supabase-patterns` et `auth-patterns`, jamais une règle recopiée ici. § Server Actions et Supabase
- Un schéma Zod par entité, partagé par le formulaire et l'action. § DRY
- Vérifier `component-registry.md` avant de créer un composant ; factoriser à partir de 2 occurrences, pas avant. § DRY
- Une valeur d'une liste fermée (codes d'erreur `PLATFORM_ERROR_CODES`) se reconnaît par la liste elle-même (`find`, `includes`), jamais par une expression régulière qui en recopie la forme. § DRY
- Toute surface nouvelle porte ce qui casse sans elle aujourd'hui ; sans justification au présent, la retirer au lieu de la documenter. § DRY
- Les imports de l'hôte passent par l'alias `@/` vers `src/`. § Imports
- Aucun cycle d'imports évalués entre les modules de `schemas/`, `api/` et `mcp/` du paquet : chez un hôte, n'importe quel module d'une face peut se charger en premier ; `tests/unit/import-cycles.test.ts` le vérifie. § Imports
- Aucun cycle d'imports évalués par `server/catalog/registry.ts` : une fonction du catalogue lit `write.ts`, `procedures-check.ts` ou `find.ts` à l'appel, une constante partagée vit dans un module feuille ; sinon le build d'un hôte casse ; `tests/unit/import-cycles.test.ts` le vérifie. § Imports
- Aucune initialisation par l'effet de bord d'un import (le paquet et `zod` sont `sideEffects: false`, le bundler d'un hôte saute le module) : une fonction appelée à l'entrée d'une porte, comme `ensureZodMessages`. § Imports
- Une Server Action rend `{ data }` ou `{ error }`, jamais une exception vers le client. § Error Handling
- Tout composant d'interface gère chargement, erreur et vide. § Error Handling
- Toute réponse Supabase : lire son `.error` et le traiter. § Error Handling
- Un commentaire dit le pourquoi (règle métier non évidente, décision, contournement), jamais le quoi. § Quand commenter
- JSDoc seulement sur une fonction exportée complexe. § JSDoc — uniquement sur les fonctions exportées complexes
- Un composant exporté ne cumule pas plus de 3 responsabilités parmi lecture de données, state local, effet, rendu conditionnel et mapping de collection ; au-delà, extraire. § Complexité
- Toute assertion `as` (hors `as const`) est précédée d'un commentaire qui dit pourquoi le type ne peut pas être inféré. § TypeScript
