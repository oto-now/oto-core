# Documentation d'oto-pkg

La carte : quelle question mène à quel dossier. Un seul endroit par nature d'information
(`CLAUDE.md § Documentation : où vit chaque information`).

| Votre question | Où |
|---|---|
| Que fait le produit, pour qui, et pourquoi ? Quels parcours, quelles exigences, dans quel état ? | [`produit/prd.md`](produit/prd.md) |
| Quel est le détail d'un chantier ouvert ? | [`produit/stories/`](produit/stories/) : une story par sujet, désignée par son issue |
| Comment le système est-il conçu, et pourquoi ? Quelles alternatives ont été écartées ? | [`conception/`](conception/README.md) : un document vivant par sujet ; l'index dit lequel lire, et où sont passés les anciens ADR, fiches et hypothèses |
| Que contient le schéma, quels services, quelles routes, quelles phrases de test ? | [`reference/`](reference/) : [pile et structure](reference/pile-et-structure.md), [schéma `platform`](reference/schema-platform.md), [services et portes](reference/services-et-portes.md), [golden queries MCP](reference/mcp-golden-queries.md) |
| Comment installer le paquet chez un hôte, le monter de version, brancher un assistant ? | [`exploitation/`](exploitation/) : [installer un hôte](exploitation/installer-un-hote.md), [brancher votre assistant](exploitation/guide-installation.md) ; le pas à pas du paquet est dans `packages/plateforme/README.md` |
| Comment contribuer : issues, PR, documentation, conventions ? | [`contribuer/`](contribuer/README.md), et l'outillage dans `.method/` |
| Qu'est-ce qui reste ouvert ? | Les issues GitHub du dépôt ; les tâches de suite et les actions réservées à JB dans `.method/sprint/status.md` |
| Qu'est-ce qui a changé, version par version ? | [`changelog.d/`](changelog.d/), un fichier par entrée, et [`changelog.md`](changelog.md), l'historique figé (le dépôt) ; `packages/plateforme/CHANGELOG.md` (le paquet publié), dont les lignes attendent leur version dans `packages/plateforme/changelog.d/` |
