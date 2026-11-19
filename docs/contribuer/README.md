# Contribuer

Comment proposer un changement à oto-pkg : issues, commits et documentation. Les règles de travail
d'un agent (échelle d'un changement, conventions routées, revue, gate de commit) sont dans
`CLAUDE.md` ; ce document y mène sans les recopier.

## Issues

- Tout besoin, bug, question à trancher ou chantier s'ouvre en issue GitHub. Une épic est une issue
  parente ; ses chantiers sont des sous-issues. Les règles (type, assigné, jalon, étiquettes, story
  désignée par l'issue) : `CLAUDE.md § Issues et stories`.
- Types : `Feature` (un besoin), `Task` (un travail ou une question à trancher), `Bug`.
- Étiquettes : un domaine `area: …` (`api`, `connectors`, `datastore`, `dx`, `identity`, `infra`,
  `mcp`, `ui`), plus `bloquant` et `leçon oto 1` ; rien d'autre.
- Une story ne s'écrit que si l'issue ne suffit pas : `docs/produit/stories/<sujet>.md`, depuis
  `.method/templates/story.tmpl.md` ; le corps de l'issue porte son chemin, la story ne cite jamais
  l'issue. Le corps d'une issue parente part de `.method/templates/epic.tmpl.md`.
- Créer ou modifier une issue est une action sur un service extérieur : avec l'accord de JB
  (`CLAUDE.md § Projet`).

## Commits et intégration

- Un commit passe par le skill `commit-push` : vérifications (`pnpm verify`, reçu), entrée de
  `docs/changelog.md`, commit, push. Le hook `.claude/hooks/enforce-git-gate.mjs` bloque tout
  `git commit` ou `git push` direct (`CLAUDE.md § Vérifier, commiter, pousser`).
- Message : un préfixe (`feat:`, `fix:`, `perf:`, `docs:`…), la phrase de ce qui change pour le
  lecteur, puis les trailers.
- La CI (`.github/workflows/ci.yml`) construit, contrôle les migrations, joue la suite portable sur
  un Postgres nu et construit un hôte depuis le paquet empaqueté ; une version se publie à la
  fusion de sa pull request de version, approuvée par JB ou Alexis, qui pose son tag
  (`.github/workflows/publish.yml`, `README.md § Publier une version`).
- Dépôt public : aucun nom réel de client, de partenaire ni de personne hors du titulaire de la
  licence ; aucun secret (`CLAUDE.md § Modifications documentaires`, règle 5 ; `pnpm check:public`).

## Documentation

- Où écrire quoi : `CLAUDE.md § Documentation : où vit chaque information`, et la carte
  [`docs/README.md`](../README.md).
- Une décision de conception s'écrit dans le document vivant de son sujet, `docs/conception/`
  (`CLAUDE.md § Documents de conception vivants`, gabarit `.method/templates/conception.tmpl.md`).
- Une modification documentaire suit `CLAUDE.md § Modifications documentaires` : annoncée, et
  `pnpm check:framework` reste dû.

## L'outillage de la méthode

`.method/` reste à sa place, lu par les skills et les contrôles :

- `.method/conventions/` : les règles techniques, routées par globs (`_index.md`), et leurs fiches ;
- `.method/checklists/` : prêt à coder, fini, revue, évolution du PRD, conception MCP ;
- `.method/templates/` : gabarits de PRD, story, épic, conception, golden queries ;
- `.method/sprint/` : les tâches de suite et les actions réservées à JB (`status.md`), les vagues
  de stories menées sans JB (`vagues.md`).
