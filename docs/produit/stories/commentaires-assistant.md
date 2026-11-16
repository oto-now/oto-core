# Story — Commentaires d'une page : l'assistant les lit, y répond et les traite

## Meta

| Champ | Valeur |
|-------|--------|
| **Épic** | Commenter les pages, entre personnes et avec l'assistant |
| **Parcours** | 5.2 Faire une tâche avec son assistant ; 5.4 Concevoir, organiser, partager |
| **Statut** | 🔵 In Progress |
| **Priorité** | Must |
| **Référence UI** | Maquette interactive validée par JB le 12/11/2026 (étiquette « en attente d'un assistant », encadré de `@assistant`, réponse signée) |
| **Conventions** | mcp, supabase, security, api, portage, a11y, registry, testing |
| **Estimation** | L |
| **Porteuse de migration** | oui, dans la migration de `commentaires-ecran.md` (deux colonnes), fusionnée avec elle |
| **Dépend de** | commentaires-ecran |

## Contexte

Le second usage des commentaires : demander à l'assistant, depuis la page. On écrit « @assistant corrige le délai
partout » ; l'assistant d'une personne qui peut modifier la page voit le fil à sa prochaine conversation, dit à sa
personne ce qui est demandé et par qui, puis, avec son accord, corrige, répond et résout. Le paquet n'héberge aucun agent et le MCP ne pousse rien vers le client
(`outils-mcp.md`, ADR-009) : le fil attend.

**Décisions prises avec JB (12/11/2026)**
- `@assistant` ne désigne aucun assistant précis : **le prochain assistant d'une personne qui écrit la page** le
  traite. L'écran le dit au moment où on l'écrit, sur le fil qui attend, et dans la signature de la réponse.
- L'assistant voit les fils non résolus **en lisant la page**, et fait lui-même tous les gestes : créer un fil,
  répondre, résoudre, rouvrir, modifier et supprimer. Devant un fil en attente, il dit d'abord à sa personne ce qui
  est demandé et par qui, et n'agit qu'avec son accord : un simple lecteur ne fait pas écrire l'assistant d'un
  rédacteur à son insu.
- Les six outils ne bougent pas : les gestes passent par `call`, la lecture par `read` et `context`.

**Périmètre**
- `@assistant` dans la liste des mentions, enregistré sur le commentaire (`to_assistant`).
- `read` d'une page : une ligne d'en-tête qui compte les fils ouverts, et les fils ouverts servis après le corps,
  chacun avec la référence courte de son bloc, sa citation, ses commentaires et ses états.
- `context` : dans les contenus récents, les pages que la personne écrit et qui portent un fil en attente d'un
  assistant.
- Fonctions de `call` : `comment.list`, `comment.add` (nouveau fil ou réponse), `comment.edit`, `comment.delete`,
  `comment.resolve` (résoudre ou rouvrir).
- Un commentaire écrit par un assistant est marqué (`via_assistant`) et signé « Assistant de <personne> » à l'écran.

**Hors périmètre**
- Un agent hébergé qui répond tout de suite : composant de l'application hôte, pas du paquet.
- `find` dans les commentaires : V2. Les widgets de la conversation : texte seul.

## Critères d'acceptation

- [ ] **AC1** **Given** le champ d'un commentaire **When** on tape `@` **Then** « assistant » est proposé en tête,
  avec « le prochain assistant qui passe sur cette page » ; dès que le texte porte `@assistant`, un encadré dit
  qu'aucun assistant ne tourne en permanence et que le fil sera traité par le prochain assistant d'une personne qui
  peut modifier la page.
- [ ] **AC2** **Given** un fil ouvert dont un commentaire porte `@assistant` et qu'aucun assistant n'a encore suivi
  d'une réponse **Then** la carte montre « en attente d'un assistant » au-dessus de « Répondre », l'explication en
  info-bulle ; l'étiquette part à la première réponse d'un assistant ou à la résolution.
- [ ] **AC3** **Given** `read` d'une page avec des fils ouverts **Then** l'en-tête porte « comments: n open
  (m for the assistant) » et, après le corps, chaque fil ouvert : son identifiant, la référence courte de son bloc
  (ou « page »), sa citation, ses commentaires (auteur, date, texte), ses états, et l'appel exact pour y répondre et
  le résoudre ; les fils résolus ne sont pas servis ; une page sans fil ouvert ne change pas d'un caractère.
- [ ] **AC4** **Given** `read` avec `section`, `outline` ou `since_revision` (pas `file` : le texte d'un fichier joint n'est pas la page, décidé le 12/11/2026) **Then** seule la ligne
  d'en-tête est servie, avec l'appel de `comment.list`, pas les fils ; le plafond de 45 000 caractères et le curseur tiennent, fils compris.
- [ ] **AC5** **Given** une personne qui écrit des pages portant un fil en attente d'un assistant **When** elle
  ouvre une conversation **Then** `context` les nomme dans les contenus récents (« n comment(s) for the assistant »),
  dans son plafond ; une personne en simple lecture ne les y voit pas ; une consigne, servie une fois après les
  lignes marquées (`SERVED_RECENT.commentsHint`), dit où lire les fils.
- [ ] **AC6** **Given** `comment.add`, `comment.edit`, `comment.delete`, `comment.resolve` **Then** ils passent par
  les services de l'écran, avec les mêmes droits et les mêmes refus : l'assistant agit comme sa personne (il résout
  ce qu'elle peut résoudre, modifie et supprime ses commentaires à elle) ; `comment.delete` est en deux temps
  (résumé, puis `confirm: true`) ; dans un fil résolu, répondre, modifier et supprimer rendent `conflict` : le
  fil se rouvre d'abord (`comment.resolve`, `status: "open"`).
- [ ] **AC7** **Given** un commentaire écrit par `call` **Then** il porte `via_assistant`, se lit « Assistant de
  <personne> » à l'écran et dans `read`, et la ligne de journal de l'appel le trace.
- [ ] **AC8** **Given** un fil pour l'assistant sur une page que la personne ne fait que lire **Then** son assistant
  peut y répondre, mais le texte servi dit que la correction revient à un rédacteur, nommé comme un refus d'écriture.
- [ ] **AC9** **Given** la pseudonymisation active **Then** les noms d'auteurs et les mentions servis à l'assistant
  suivent la règle du contenu servi.

## Implémentation

- **migrations/** : `comments.to_assistant` et `comments.via_assistant` (booléens, faux par défaut), dans la
  migration de la story précédente.
- **server/** : `server/comments/functions.ts` (les cinq fonctions, `defineFunction`), le registre du catalogue,
  `server/nodes/read.ts` et `server/comments/served.ts` (ligne d'en-tête et fils servis),
  `server/context/blocks/recent.ts` et `server/comments/waiting.ts` (les pages en attente),
  `server/comments/mentions.ts` (`@assistant`).
- **schemas/** : `schemas/comments.ts` (arguments des fonctions).
- **ui/** : la liste des mentions, l'encadré, l'étiquette, la signature.
- **docs/** : `docs/reference/mcp-golden-queries.md`, `docs/conception/commentaires.md`, `outils-mcp.md` (rien de
  la surface ne change, à dire), l'aide servie (`server/help.ts`).

## Rayon d'impact

À remplir avant le passage à 🟢 Ready, une fois `commentaires-ecran` livrée : appelants de `headerLines` et du corps
de `read` (texte servi comparé mot pour mot par `tests/unit/nodes-read.test.ts`), du bloc des contenus récents de
`context` et de son plafond, du catalogue des fonctions (instantané de `tests/unit/mcp-tools.test.ts`).

## Tests attendus

- [ ] Unitaires : texte servi par `read` avec et sans fils, mot pour mot ; étiquette d'attente ; signature.
- [ ] Intégration : chaque fonction sous lectrice, rédactrice et personne sans accès ; `context` selon le niveau.
- [ ] MCP par `InMemoryTransport` : lire une page commentée, répondre, corriger par `write`, résoudre.
- [ ] Golden queries : « traite les commentaires de cette page », « qu'est-ce qui m'attend en commentaires ».

## Actions JB

- Valider le texte servi à l'assistant (`read`, `context`) avant la fusion.
