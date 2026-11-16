# Commentaires

- **Statut** : validé avec le responsable du produit le 12/11/2026
- **Dernière révision** : 2026-11-12

## Résumé

Qui lit une page, une procédure, un Contexte ou un tableau y ouvre des fils de commentaires, sur la page entière ou sur un bloc publié et un passage cité, sans la modifier ; les fils suivent la page, sans règle d'accès propre.
`@Prénom Nom` prévient un lecteur ; `@assistant` laisse le fil au prochain assistant d'une personne qui écrit la page, qui le lit par `read` et y répond par cinq fonctions de `call`, les six outils inchangés.
Une seule règle dit à qui un fil est destiné ; elle sert l'email groupé (un par personne et par heure au plus), l'îlot « Commentaires » de l'accueil et la marque de `context`.

## Contexte

Une personne qui lisait une page ne pouvait rien y signaler sans la modifier : ni question, ni correction
proposée, ni relecture. Le paquet n'avait ni table, ni route, ni écran pour cela ; le plus proche,
`feedback`, est un signalement à l'équipe plateforme, sans page ni réponse
([journal et retours](journal-et-retours.md)), et la preuve d'une valeur de tableau (`comment` d'une cellule) n'est pas un fil.

Trois contraintes cadrent la conception. Le paquet n'héberge aucun agent et le MCP ne pousse rien vers
le client ([outils MCP](outils-mcp.md), ADR-009) : une demande faite à l'assistant attend qu'une
conversation s'ouvre. La surface MCP est figée (ADR-002) : tout geste nouveau passe par `call`. Le paquet
n'a aucune tâche planifiée : ce qui doit partir à heure fixe est lancé par l'hôte.

## Objectifs et non-objectifs

- Commenter sans écrire la page : lire suffit pour ouvrir un fil et répondre.
- Demander à l'assistant depuis la page, et qu'il fasse lui-même tous les gestes d'une personne.
- Prévenir qui est concerné sans dix messages en dix minutes, et sans qu'il ouvre la page.
- Hors objectif en V1 : commenter une ligne de tableau (un bloc `row`) ; chercher dans les commentaires par `find` ; les exporter avec une page (`.md`, `node.export_tree`) ou les copier à sa duplication ; un état lu par fil, marquer comme lu sans ouvrir la page, une page « Tous mes commentaires » ; un réglage de notification par personne ; un agent hébergé qui répond tout de suite (affaire de l'application hôte) ; un commentaire sur une page publique par lien.

## Conception

Les tables et leurs colonnes sont dans [`../reference/schema-platform.md`](../reference/schema-platform.md), les services et les routes dans [`../reference/services-et-portes.md`](../reference/services-et-portes.md), les requêtes de référence d'un assistant dans [`../reference/mcp-golden-queries.md`](../reference/mcp-golden-queries.md).

### Le fil et son ancrage

- **Deux tables** (partie 1 de `20261113180000_v1_7_0.sql`, écrite en `20261112090000_platform_commentaires.sql`) : `comment_threads`, un fil sur un nœud, et `comments`, ses commentaires dans l'ordre. On résout un fil (`open`, `resolved`, avec qui et quand), jamais un commentaire.
- **Un fil s'ancre sur un bloc publié**, par son identifiant (`block_id`, stable d'une écriture à l'autre, [lecture et écriture des pages](lecture-et-ecriture-des-pages.md)), avec en option un **passage cité** en texte (500 caractères au plus) et la révision du bloc au moment du commentaire (`block_revision`). Aucune position dans le texte. Sans bloc, le fil commente la page entière. `block_id` n'a pas de clé étrangère, la clé de `blocks` étant `(id, state)`.
- **Ce que le service refuse à l'ouverture** (`invalid_arguments`, rien n'est écrit) : un bloc qui n'est pas un bloc publié de ce nœud, une ligne de tableau (un tableau ne se commente qu'en entier), une citation absente du texte du bloc tel que `read` le rend, blancs réduits.
- **Deux états se calculent à la lecture, jamais écrits** (`anchorOf`) : « passage modifié depuis » quand la révision du bloc publié dépasse celle du fil ; « passage supprimé » quand le bloc n'est plus publié, le fil se lisant alors sur la page, sa citation gardée.
- **Un commentaire** porte son auteur (nul quand la personne est oubliée : « Ancien membre »), son texte (1 à 4 000 caractères), les membres mentionnés (50 au plus), la date de sa modification, `to_assistant` (son texte porte `@assistant`, relu à chaque modification) et `via_assistant` (écrit par une fonction de `call`, posé à l'écriture, jamais modifié).
- **Les fils sont servis** ouverts d'abord, puis du plus récent au plus ancien, leurs commentaires du plus ancien au plus récent.

### Qui fait quoi

Le service décide avant toute requête d'écriture (`security-patterns.md § Droits dans le service`) ; la RLS des deux tables répète les mêmes rôles.

| Geste | Qui | Refus |
|---|---|---|
| Lire les fils, en ouvrir un, répondre | qui lit la page (niveau lecture) | page invisible, à la corbeille ou inconnue : `not_found`, comme un chemin inconnu (H68) |
| Résoudre, rouvrir un fil | l'auteur du fil, ou qui écrit la page | `forbidden`, qui nomme l'auteur et à qui demander |
| Modifier, supprimer un commentaire | son auteur, lui seul : ni qui écrit la page, ni l'administrateur | `forbidden`, qui nomme l'auteur |

- **Un fil résolu est figé** : on n'y répond pas, on n'y modifie ni n'y supprime un commentaire ; le service rend `conflict` et dit de rouvrir le fil. Le fil résolu reste lisible, avec qui l'a résolu.
- Supprimer le premier commentaire d'un fil supprime le fil et ses réponses (clé en cascade). Un fil déjà dans l'état demandé, un texte inchangé, n'écrivent rien ; un fil changé entre la lecture et l'écriture rend un conflit à recharger. Chaque écriture dans un fil (réponse, modification, suppression) est gardée par son état ouvert dans la requête même : un fil résolu depuis la lecture ne reçoit rien, le service rend `conflict` et le journalise.
- **Aucune règle d'accès propre** : un fil suit sa page ([droits d'accès](droits-d-acces.md)). Une page à la corbeille ne sert plus aucun fil ; purgée, elle emporte les siens, comme une organisation supprimée ; une personne oubliée (`forget_user`) laisse ses commentaires sans auteur, ses fils sans auteur ni « résolu par », et sort des mentions. L'export et l'import d'une organisation portent les fils et leurs commentaires, jamais l'état de l'email groupé.

### Les mentions

- `@Prénom Nom` mentionne un membre **qui lit la page**, par son nom d'annuaire entier, sans casse ; de deux noms possibles, le plus long ; des homonymes sont tous mentionnés. Un nom qui ne désigne aucun lecteur reste du texte, sans erreur : une mention ne révèle jamais une page à qui ne la lit pas. Les mentions se relisent à chaque modification du texte (`readMentions`). Une seule lecture des mentions (`readMentions`, `mentionPlaces` et `addressesAssistant` de `schemas/comments.ts`) : le service l'enregistre, l'écran l'annonce avant l'envoi et la met en valeur dans un commentaire lu.
- `@assistant` ne désigne aucun assistant précis : il adresse le commentaire au prochain assistant d'une personne qui peut modifier la page (`addressesAssistant`).

### L'API et l'écran

- **Routes de `/api/platform/*`** (`api/comments.ts`) : `GET comments?path=`, `POST comments` (un fil ou une réponse), `PATCH comments/<id>`, `DELETE comments/<id>`, `PATCH comment-threads/<id>`. Chaque mutation laisse une ligne de journal dont la cible est le chemin de la page ; la lecture n'en laisse pas (D138). La lecture rend aussi les lecteurs de la page (ceux qu'on peut mentionner) et si l'hôte a un relais d'envoi (`mailEnabled`).
- **L'encart « Commentaires »** est en tête de la colonne de droite d'une page, d'une procédure et d'un Contexte, avant « Cité dans », « Cite » et « Sous-pages » ; pour un tableau, sur la ligne des autres encarts, fils sur la page entière seulement. Sa pastille compte les fils ouverts et n'apparaît pas à zéro (un « 0 » se lirait comme un compteur en panne) ; il est ouvert à l'arrivée tant qu'un fil est ouvert. Une requête de plus à l'affichage, qui ne bloque pas le rendu de la page et se relance à chaque publication.
- **Dans l'encart** : deux onglets, « Ouverts » et « Résolus », avec leur compte ; dessous, sur toute la largeur, « Commenter la page », qui disparaît pendant l'écriture d'un nouveau fil (un seul à la fois). Le nouveau fil n'a pas de titre. Quatre états : lecture, échec avec « Réessayer », aucun fil, les fils.
- **La carte d'un fil** : la section du passage (un lien qui y défile) ou « Sur la page », ses états, la citation, les commentaires sans avatar (« Nom · quand », « modifié », « Assistant de <nom> »), puis « Répondre » à droite en pied, sous « en attente d'un assistant » le cas échéant. En haut à droite, toujours visible, la coche qui résout tout le fil, ou « Rouvrir le fil » ; inerte et expliquée pour qui ne peut pas. Sur ses propres commentaires, un crayon (modification en place) et une poubelle, confirmée dans la carte.
- **La bulle d'un bloc**, à droite de chaque bloc publié, en lecture comme en édition, paraît au survol ou au focus et dit « Commenter ce bloc » ; un bloc qui a des fils ouverts la garde, avec leur nombre, et elle ouvre le premier. Un bloc jamais publié n'en a pas.
- **Un texte sélectionné** dans un seul bloc publié fait paraître un bouton léger, « Commenter ce passage », centré au-dessus du passage (au-dessus du bloc quand la sélection est dans le champ ouvert de l'éditeur, qui ne dit pas où elle est). La sélection devient la citation si elle tient dans un seul nœud de texte et dans 500 caractères ; sinon le fil s'ouvre sur le bloc seul. Une citation que le service ne retrouve pas est retirée, le texte gardé.
- **Le surlignage de la citation** du fil ouvert est celui du navigateur (`CSS.highlights`), sans toucher au document ; sa règle est posée à l'exécution, dans une feuille adoptée (`passage.ts`), le compilateur CSS de l'hôte refusant `::highlight()` dans une feuille du paquet. Un navigateur sans ce surlignage garde le bloc mis en valeur.
- **Le champ** : l'aide « @ pour mentionner » est dans son texte d'invite ; `@` propose « assistant » en tête, puis les lecteurs de la page, au clavier comme à la souris ; « Annuler » à gauche, « Envoyer » à droite. Sous le champ, ce qu'une mention déclenchera : avec `@assistant`, qu'aucun assistant ne tourne en permanence ; avec une personne, qu'elle recevra l'email groupé, seulement si l'hôte a un relais. Un refus garde la saisie et dit quoi faire.

### L'assistant

- **Un fil attend un assistant** (`waitingAssistant`, calculé) : ouvert, un de ses commentaires porte `@assistant`, et aucun commentaire écrit par un assistant ne suit le dernier d'entre eux. L'étiquette part à la première réponse d'un assistant ou à la résolution.
- **`read` d'une page** ajoute à l'en-tête « comments: n open (m for the assistant) » et sert, après le corps, les fils ouverts : identifiant, référence courte du bloc (ou « page »), citation, commentaires, états, et l'appel exact pour répondre et pour résoudre. Avec `section`, `outline` ou `since_revision`, seule la ligne d'en-tête est servie, avec l'appel de `comment.list`. Les fils résolus ne sont pas servis ; une page sans fil ouvert ne change pas d'un caractère. Devant un fil en attente d'un assistant, le texte dit à l'assistant de qui écrit la page de dire d'abord à sa personne ce qui est demandé et par qui, et de n'agir (corriger la page, répondre, résoudre) qu'avec son accord. À qui ne fait que lire la page, le texte dit que la correction revient à ceux qui l'écrivent, nommés comme un refus d'écriture.
- **Cinq fonctions de `call`** (connecteur `comment`, `server/comments/functions.ts`) : `comment.list`, `comment.add` (nouveau fil, sur un bloc par sa référence courte, ou réponse), `comment.edit`, `comment.delete` (sensible, en deux temps : récapitulatif, puis `confirm: true`), `comment.resolve` (résoudre ou rouvrir). Adaptateurs minces sur les services de l'écran : l'assistant agit comme sa personne, mêmes droits, mêmes refus. Un commentaire écrit par elles porte `via_assistant` et se lit « Assistant de <personne> ».
- **`context`** marque, dans les contenus récents, les pages que la personne écrit et dont un fil attend un assistant (« n comment(s) for the assistant », niveau écriture exact), et celles dont un fil qui lui est destiné porte un commentaire d'un autre depuis sa conversation précédente (« n new comment(s) ») ; dès qu'une ligne porte une marque, une consigne est servie une fois (`SERVED_RECENT.commentsHint`). Le détail est dans [contexte servi](contexte-servi.md).

### À qui un fil est destiné

Une seule fonction, `recipientsOf` (`cli/comments-mail.mjs`), lue par l'email groupé, par l'accueil et par `context` (`server/comments/followed.ts`). Un commentaire prévient une personne dans trois cas :

1. elle y est mentionnée ;
2. c'est une réponse, et elle a écrit dans le fil avant (elle l'a ouvert ou y a répondu) ;
3. c'est le premier commentaire d'un fil, et elle est responsable de l'équipe propriétaire de la page.

Jamais son auteur ; un commentaire écrit par un assistant prévient comme un autre. Seuls les fils ouverts d'une page hors corbeille comptent, et seulement pour qui lit encore la page, ce qui se décide à l'usage : à l'envoi pour l'email, à la lecture pour l'accueil et `context`.

### L'email groupé

- **L'hôte lance chaque heure** `oto-platform comments notify`, sur la connexion d'administration, avec `PLATFORM_SMTP_URL` et `PLATFORM_MAIL_FROM` ([installer un hôte](../exploitation/installer-un-hote.md)). La logique vit en `.mjs` sous `cli/` (`comments-mail.mjs`, fonctions pures ; `comments-notify.mjs`, base et envoi ; `mail.mjs`, le relais, partagé avec l'invitation du mode OIDC) : la commande tourne en Node natif et ne charge aucun module de `server/`.
- **Un email par personne et par organisation, un par heure au plus**, qui réunit ce qui est arrivé depuis le précédent. `comment_mails` garde l'heure du dernier envoi, prise en une instruction avant l'envoi : deux commandes lancées ensemble n'envoient qu'une fois. La fenêtre tolère cinq minutes, pour qu'une tâche horaire partie une seconde plus tôt que la précédente ne repousse pas l'email d'une heure. `comment_mail_items` garde ce qui a été envoyé à qui : relancée, la commande n'envoie rien en double.
- **Ce qui part** : objet « n nouveaux commentaires sur vos pages » ; par commentaire, le titre de la page, l'auteur, un extrait de 200 caractères et un lien vers la page, sans ancre de fil ; au nom et au logo de l'organisation. L'origine des liens est une adresse de l'organisation (`org_domains`), jamais un en-tête de requête.
- **Ce qui ne part pas** : un commentaire supprimé, un fil résolu, une page à la corbeille ou que la personne ne lit plus. Sans relais, la commande le dit, n'envoie rien, ne marque rien et sort à 0, et le champ n'annonce aucun email ; une organisation sans adresse garde ses commentaires en attente. Un envoi en échec rend son heure à la personne, laisse ses commentaires au passage suivant et s'écrit au journal de l'équipe plateforme.

### L'accueil

L'îlot « Commentaires » (`CommentairesSuivis`, lu par `homeComments`) est dans la colonne de droite, au-dessus de « Lancer avec Claude » : les fils ouverts destinés à la personne, non lus d'abord et marqués, puis du plus récent au plus ancien, dix au plus et une ligne qui dit combien restent ; chaque ligne nomme la page, l'auteur du dernier commentaire d'un autre et son extrait (120 caractères), sur toute la largeur. Sans fil, l'îlot n'est pas rendu. « Non lu » se lit sur la dernière visite de la page à l'écran (`node_views.last_at`), sans table de plus : ouvrir la page marque ses fils comme lus, une lecture par l'assistant ne compte pas. La place de l'îlot dans la coque est décrite dans [écrans et coque](ecrans-et-coque.md).

## Décisions et alternatives écartées

- **Une position dans le texte** (décalage de caractères) pour ancrer un fil : elle casse à la première réécriture. Écartée pour l'identifiant du bloc et une citation en texte, dont l'écart se dit (« passage modifié depuis », « passage supprimé »).
- **Une seule table `comments` à parent**, le premier commentaire portant l'état du fil : les colonnes du fil seraient nulles sur chaque réponse, et l'état se lirait sur une ligne qu'on peut supprimer. Écartée.
- **Un modèle commun de « fils » avec `feedback`** : deux usages et deux cycles de vie, aucune duplication réelle. Écarté.
- **Des règles d'accès propres aux commentaires** : un second jeu de droits à tenir égal à celui de la page. Écartées ; ils suivent la page.
- **Résoudre un commentaire** : on résout un fil.
- **Modifier ou supprimer un commentaire dans un fil résolu** (le cadrage n'y refusait que la réponse) : un fil résolu qui change encore ne dit plus ce qui a été résolu. Écarté à l'implémentation : tout y est figé, on rouvre d'abord.
- **`@assistant` adressé à un assistant précis, ou un agent du paquet qui répond tout de suite** : le paquet n'héberge aucun agent et le MCP ne pousse rien. Écartés : le fil attend, et l'écran le dit à l'écriture, sur le fil et dans la signature de la réponse.
- **L'assistant qui traite un fil en attente sans l'accord de sa personne** (corriger, répondre et résoudre dès la lecture) : lire suffit pour écrire `@assistant`, un simple lecteur ferait donc écrire l'assistant d'un rédacteur à son insu. Écarté : l'assistant dit d'abord ce qui est demandé et par qui, et n'agit qu'avec l'accord de sa personne.
- **Un septième outil ou un outil par geste** : la surface est figée (ADR-002). Écartés pour `call`, `read` et `context`.
- **Un email par commentaire** : dix messages en dix minutes. Écarté pour l'email groupé.
- **Un envoi au passage d'une requête**, quand la fenêtre est échue : « un par heure » dépendrait du trafic. Écarté pour la commande de l'hôte, comme la purge du journal.
- **La logique de l'email dans `server/`** : la commande, en Node natif, ne charge pas un module TypeScript. Écartée pour des `.mjs` sous `cli/`, que `server/` importe (une seule règle des destinataires).
- **Une table d'état lu par fil** : « non lu » se lit sur `node_views`. Écartée en V1.
- **Une pastille « 0 » sur l'encart** : elle se lirait comme un compteur en panne, pas comme le calme. Écartée. **Un titre au nouveau fil, l'aide des mentions sous le champ, « Commenter la page » à côté des onglets** : prévus au cadrage, retirés ou déplacés à l'implémentation (l'aide dans le texte d'invite, le bouton sous les onglets).
- **La règle `::highlight()` dans une feuille du paquet** : refusée par le compilateur CSS de l'hôte. Écartée pour une feuille adoptée à l'exécution.

## Sécurité et confidentialité

Canaux fermés :

- **Un fil ne sort jamais d'une page que l'appelant ne lit pas** : `not_found` sans rien dire du nœud, par le chemin comme par l'identifiant d'un fil ou d'un commentaire ; la RLS porte la même règle, et sa policy de lecture s'applique aussi à une modification et à une suppression (l'auteur d'un commentaire sur une page qu'il ne lit plus n'y touche plus).
- **Une mention ne révèle rien** : seuls les lecteurs de la page sont proposés et enregistrés.
- **Une session n'écrit que ce que ses services écrivent** : privilèges colonne par colonne ; `created_by`, `author` et `resolved_by` valent l'appelant ; un fil naît ouvert ; `via_assistant` ne se modifie pas. Les deux tables de l'email ne s'écrivent que par la connexion d'administration de la commande ; chacun n'y lit que ses lignes.
- **L'email ne porte aucun contenu de la page**, et du commentaire son seul extrait ; rien n'est envoyé à qui ne lit plus la page ; le HTML échappe tout ce qu'il reçoit, et un logo ne se montre que s'il est une adresse `https`. Un échec d'envoi s'écrit par l'identifiant de la personne et le code de l'erreur : ni adresse, ni message du relais, ni mot de passe.
- **La page publique par lien** (`/p`) ne sert ni n'écrit aucun commentaire ; `context` ne nomme les fils en attente qu'à qui écrit la page.

Canaux qui restent ouverts, voulus ou acceptés :

- **Tout lecteur d'une page lit tous ses fils**, résolus compris, avec le nom de chaque auteur et de qui a résolu, et la liste des autres lecteurs de la page (pour les mentionner). Un commentaire n'est pas un message privé.
- **Le journal garde le texte d'un commentaire** écrit ou modifié, à l'écran (`POST comments`, `PATCH comments/<id>`) comme par `comment.add` et `comment.edit`, dans les arguments de la ligne (bornés comme tout argument, [journal et retours](journal-et-retours.md)) : supprimer le commentaire ne l'en retire pas avant la purge du journal.
- **La RLS ne peut pas vérifier `via_assistant`** : la base ne sait pas par quelle porte vient une session. Une personne qui écrirait la table avec son seul jeton poserait ou tairait la marque sur ses propres commentaires ; la signature « Assistant de <nom> » est une indication, pas une preuve. De même `mentions` et `to_assistant` sont lus par le service, non contrôlés par la base.
- **Le premier commentaire d'un fil emporte les réponses des autres** quand son auteur le supprime ; la confirmation le dit.
- **L'extrait d'un commentaire part par email**, hors de la plateforme, chez le relais de l'hôte et dans la boîte du destinataire ; il y reste après la suppression du commentaire ou la perte du droit de lire. Aucun réglage ne permet de s'en désabonner en V1.
- **Le texte d'un commentaire servi à un assistant** est du texte écrit par un tiers : `read` le sépare du contenu (« not part of the page content »), sans autre garde contre une consigne glissée dans un commentaire.

## Écart avec le code

- Aucun essai avec un vrai assistant : les textes servis (`read`, `comment.*`, `context`) sont prouvés par tests, pas par une conversation ; les requêtes de référence des commentaires ne sont pas jouées.
- Aucun envoi réel par un relais : l'email groupé est prouvé sur un transport de capture.
- `server/database.ts` a été complété à la main pour les quatre tables ; il est à régénérer par `pnpm db:types`.
- L'export puis l'import d'une organisation avec ses fils est prouvé en unitaire (le plan) ; l'aller-retour entre deux bases n'est pas vérifié.
- La pseudonymisation des noms d'auteurs et des mentions servis à un assistant n'a pas de test propre : elle repose sur la règle générale de la porte ([pseudonymisation](pseudonymisation.md)).
- Hors V1, non faits : commenter une ligne de tableau ; `find` dans les commentaires ; un état lu par fil ; l'export des fils avec une page et leur copie à la duplication ; un réglage de notification par personne ; un lien de l'email qui ouvre la page sur le fil.
- Une résolution encore non validée pendant qu'une réponse s'écrit ne la retient pas : la réponse entre, écrite sur un fil lu ouvert, et la résolution suit. Aucun verrou n'est pris sur le fil : la policy de modification de `comment_threads` cacherait la ligne verrouillée à un simple lecteur.
## Questions ouvertes

- Le texte d'un commentaire doit-il sortir des arguments gardés au journal, comme une donnée personnelle ?
- Faut-il un réglage par personne (se désabonner de l'email, changer sa fréquence) avant d'ouvrir l'email groupé à un hôte public ?
- L'email doit-il ouvrir la page sur le fil (une ancre), et l'accueil aussi ?

## Historique

- 2026-11-12 : création. Fils ancrés sur un bloc et un passage cité, lire suffit pour commenter, les fils suivent la page ; `@assistant` et cinq fonctions de `call` ; email groupé lancé chaque heure par l'hôte ; suivi sur l'accueil et dans `context` par une seule règle des destinataires ; un fil résolu est figé — décidé par le responsable du produit (source : décisions du 12/11/2026 et maquette validée le même jour).
- 2026-11-12 : devant un fil en attente, l'assistant dit d'abord à sa personne ce qui est demandé et par qui, et n'agit qu'avec son accord — décidé par le responsable du produit (source : décision du 12/11/2026 sur la consigne servie par `read`).
