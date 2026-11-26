## [2026-11-19] — Rail : la flèche de dépliage visible en permanence
**Quoi :** dans l'arbre du rail, la bascule d'une page qui a des sous-pages ne porte plus que le chevron, toujours visible, dans une colonne devant le glyphe de type ; le glyphe passe dans le lien, sur toutes les lignes ; une feuille garde la colonne vide (`--rail-chevron-col`), pour l'alignement. Au clavier, le chevron atteint prend l'anneau du rail.
**Pourquoi :** retour RET-013 : rien ne disait qu'une page avait des sous-pages sans la survoler.
**Fichiers :** `packages/plateforme/ui/ds/react/rail-tree.tsx`, `packages/plateforme/ui/ds/app/islands.css`, `tests/integration/components/rail-tree.test.tsx`, `packages/plateforme/CHANGELOG.md`.
