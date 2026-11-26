## [2026-11-19] — Rail : glisser une page sans la vue fractionnée de Chrome, repère au bon niveau
**Quoi :** au départ du glisser d'une ligne, les données que le navigateur joint au lien (son adresse) sont retirées, seul le type du rail voyage ; le trait d'un dépôt entre deux lignes part du glyphe de la ligne visée (`--rail-glyphe-x`), à son niveau, au lieu du bord du lien.
**Pourquoi :** retour RET-011 : Chrome proposait sa « vue fractionnée » en glissant une page, et le trait laissait croire que la page irait dessous.
**Problèmes :** la disparition du panneau de Chrome ne se vérifie qu'à la main dans Chrome ; le test vérifie les données glissées.
**Fichiers :** `packages/plateforme/ui/coque/arbre-du-rail.tsx`, `packages/plateforme/ui/ds/app/islands.css`, `packages/plateforme/ui/ds/components/css/product.css`, `tests/integration/components/rail-application.test.tsx`, `packages/plateforme/CHANGELOG.md`.
