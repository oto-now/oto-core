# Story Done — Definition of Done

<!--
  Passée par dev (étape 7) avant de basculer une story en ✅ Done.
  RÈGLE DE MAINTENANCE : ne réénumère JAMAIS les rubriques de code-review.md ni les règles des
  conventions — elles sont confrontées au code par revue, qui route les fichiers par globs.
  Cette checklist ne vérifie que ce qui n'est vérifiable qu'à la fin : livraison et traçabilité.
-->

## Livraison

- [ ] Tous les AC de la story sont couverts par le code livré
- [ ] Tous les tests listés dans la section « Tests attendus » de la story existent et passent
- [ ] Les 4 checks passent : `check:framework`, `type-check`, `lint`, `test`
- [ ] Aucun test existant cassé (non-régression)

## Review

- [ ] Le skill `revue` a été passé : routing annoncé, conventions chargées en entier, findings sourcés
- [ ] Les findings HAUTE et MOYENNE sont corrigés, et les checks relancés après correction
- [ ] Les findings BASSE restants sont signalés à l'utilisateur, pas appliqués d'office

## Traçabilité

- [ ] Section « Post-implémentation » de la story remplie
- [ ] Entrée de la story dans un fichier neuf `docs/changelog.d/AAAA-MM-JJ-<sujet>.md` ; lignes visibles d'un hôte ou d'un assistant dans `packages/plateforme/changelog.d/AAAA-MM-JJ-<sujet>.md`
- [ ] `.method/conventions/component-registry.md` à jour si un composant, hook ou util réutilisable a été créé
- [ ] Document de conception du sujet mis à jour (`docs/conception/<sujet>.md`, ligne d'historique) si un invariant d'architecture a été touché ; ce qui doit durer de la story y est passé, et la story est retirée (`CLAUDE.md § Issues et stories`)
- [ ] L'issue du chantier est fermée, avec ce qui est livré ; un geste qui reste à JB est noté dans `.method/sprint/status.md`
- [ ] (si référence UI ≠ `N/A`) Les écarts avec la référence sont documentés dans la story
