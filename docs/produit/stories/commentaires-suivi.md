# Story — Commentaires d'une page : le suivi sur l'accueil et dans `context`

## Meta

| Champ | Valeur |
|-------|--------|
| **Épic** | Commenter les pages, entre personnes et avec l'assistant |
| **Parcours** | 5.3 Observer ; 5.2 Faire une tâche avec son assistant |
| **Statut** | 🔵 In Progress |
| **Priorité** | Should |
| **Référence UI** | Description texte ci-dessous ; le bloc reprend la forme des blocs existants de l'accueil |
| **Conventions** | supabase, security, api, mcp, portage, a11y, registry, testing |
| **Estimation** | M |
| **Porteuse de migration** | non (aucune table : « non lu » se lit sur `node_views`) |
| **Dépend de** | commentaires-ecran, commentaires-assistant, commentaires-email |

## Contexte

Un fil qui attend une personne ne se voit aujourd'hui que sur sa page, ou par l'email groupé si l'hôte a un relais.
Décision du responsable du produit (12/11/2026) : l'accueil montre les fils qui lui sont destinés, lus ou non, et
`context` dit à son assistant ceux qui ont bougé.

**Règles décidées**
- **Un fil est destiné à une personne** dans trois cas, les mêmes que pour l'email groupé (une seule règle, une
  seule fonction) : elle est mentionnée par `@` dans l'un de ses commentaires ; quelqu'un d'autre a écrit dans un fil
  où elle a écrit (elle l'a ouvert ou y a répondu) ; elle est responsable de l'équipe propriétaire de la page et le
  fil est nouveau. Jamais pour ses seuls propres commentaires. Jamais un fil d'une page qu'elle ne lit plus.
- **Non lu** : le fil porte un commentaire d'une autre personne plus récent que sa dernière visite de la page à
  l'écran (`node_views.last_at`) ; sans visite, tout commentaire d'un autre est non lu. Ouvrir la page marque ses
  fils comme lus (la vue existante suffit). Une lecture par l'assistant ne compte pas comme une visite.
- Seuls les fils **ouverts** sont suivis.

**Périmètre**
- Accueil : un îlot « Commentaires », dans la colonne de droite au-dessus de « Lancer avec Claude », avec les
  fils ouverts destinés à la personne, non lus d'abord (marqués), puis
  du plus récent au plus ancien, dix au plus ; chaque ligne : titre de la page, auteur du dernier commentaire
  d'un autre, extrait de 120 caractères sur toute la largeur de la ligne, quand ; un clic ouvre la page. Absent quand il n'y a aucun fil.
- `context` : dans les contenus récents, sur la ligne de la page, « n new comment(s) » quand un fil destiné à la
  personne porte un commentaire d'un autre depuis sa conversation précédente (la borne des nouveautés), à côté de la
  mention « for the assistant » existante ; une consigne (`SERVED_RECENT.commentsHint`) est servie une fois quand
  une ligne porte une marque de commentaires.
- Dans le texte d'invite du champ d'un commentaire : « @ pour mentionner ».

**Hors périmètre** : un état lu par fil ; marquer comme lu sans ouvrir la page ; une page « Tous mes commentaires ».

## Critères d'acceptation

- [ ] **AC1** **Given** une personne mentionnée dans un fil ouvert d'une page qu'elle lit **Then** le fil est sur son
  accueil, marqué non lu ; **When** elle ouvre la page puis revient **Then** il y est encore, lu.
- [ ] **AC2** **Given** une réponse d'un autre dans un fil qu'elle a ouvert ou où elle a répondu **Then** le fil est
  sur son accueil ; ses propres commentaires seuls n'y mettent rien.
- [ ] **AC3** **Given** un nouveau fil sans mention sur une page d'une équipe **Then** il est sur l'accueil des
  responsables de l'équipe propriétaire, et de personne d'autre.
- [ ] **AC4** **Given** un fil résolu, un fil d'une page à la corbeille, ou d'une page que la personne ne lit plus
  **Then** il n'est pas sur l'accueil ni dans `context`.
- [ ] **AC5** **Given** plus de dix fils **Then** dix sont montrés, non lus d'abord, et une ligne dit combien restent.
- [ ] **AC6** **Given** un commentaire d'un autre, dans un fil destiné à la personne, depuis sa conversation
  précédente **Then** la ligne de la page dans les contenus récents de `context` dit « n new comment(s) », dans le
  plafond du bloc et sans requête hors du budget ; sans nouveauté, `context` ne change pas d'un caractère.
- [ ] **AC7** La règle « destiné à » de l'accueil, de `context` et de l'email groupé est la même fonction, ou deux
  fonctions prouvées égales par un test commun.
- [ ] **AC8** Le bloc de l'accueil a ses quatre états, se parcourt au clavier, et tient dans les deux thèmes.

## Rayon d'impact

À constater à l'implémentation : appelants du service de l'accueil (`server/home-contents.ts`) et de son écran,
du bloc des contenus récents de `context` et de son plafond, de la règle des destinataires de l'email
(`cli/comments-mail.mjs`).

## Tests attendus

- [ ] Unitaires : la règle « destiné à » sur un jeu où chaque cas change le résultat ; l'ordre et la borne de dix.
- [ ] Intégration : l'accueil sous trois personnes (mentionnée, participante, responsable) et une quatrième qui ne
  voit rien ; lu après une vue ; `context` avec et sans nouveauté ; égalité avec la règle de l'email.
- [ ] Composant : le bloc de l'accueil, ses états, le marqueur non lu.

## Actions JB

- Valider le bloc à l'écran.
