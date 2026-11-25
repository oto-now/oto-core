# Fiche — deployment-patterns

Texte complet : `.method/conventions/deployment-patterns.md`. La fiche suffit pour écrire ; le texte complet se lit sur un doute, et toujours pour une revue. Chaque règle renvoie à sa section.

- `.env.local` n'est jamais commité ; `.env.example` est commité avec les noms de variables, sans valeurs ; en production, les variables vivent dans le tableau de bord de l'hébergeur, jamais dans un fichier. § Variables d'environnement
- Une migration passe en local, puis en staging, puis en production (`supabase db push --linked`), vérifiée à chaque étape. § Workflow
- Aucune migration destructive sans rollback prévu ; additive d'abord : ajouter, migrer les données, retirer l'ancien. § Règles
- Le rollback d'une migration est documenté en commentaire `-- ROLLBACK:` en fin de fichier. § Rollback SQL
- La CI ne rejoue ni type-check, ni lint, ni tests : elle vérifie les migrations, le build, le build d'un hôte (job `packed-host-build`) et la portabilité (job `bare-postgres`). § Vérification locale via `/commit-push`
- Le paquet se prouve construit chez un hôte par le job `packed-host-build` (paquet empaqueté, installé depuis son `.tgz` dans une copie de l'application de référence, `next build`) ; un tag ne part que d'un commit où il est vert. § Build comme un hôte
- Avant un déploiement : aucun `console.log` oublié, aucun secret dans le code, pages touchées sans violation axe DevTools en clair et en sombre. § Pre-deploy checklist
- Après un déploiement, sur l'URL de production : vraie 404, preview en `noindex`, compression et `cache-control` `immutable` servis, `is-agentic` sans issue `essential`. § Contrôles post-déploiement
- Toujours un rollback pour le code et pour la base ; déployer petit, une fonctionnalité à la fois ; surveiller après chaque déploiement. § Règles de déploiement
