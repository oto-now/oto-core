## [2026-11-19] — Rail : plus de glissement de côté au clic sur une page
**Quoi :** une navigation qui suit un geste dans l'arbre du rail (clic, glisser-déposer, dans les 10 secondes : `suitUnGesteDuRail`) amène la ligne courante en vue en hauteur seulement (`amenerEnVue(…, largeur)`) ; ouverte par la recherche ou un lien, la page se recadre en hauteur et en largeur comme avant.
**Pourquoi :** retour RET-007 et seconde occurrence de RET-011 : au clic sur une sous-page au nom long, le rail glissait de côté alors que la ligne était sous les yeux.
**Fichiers :** `packages/plateforme/ui/coque/ligne-courante-en-vue.ts`, `tests/integration/components/largeur-du-rail.test.tsx`, `packages/plateforme/CHANGELOG.md`.
