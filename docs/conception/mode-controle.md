# Mode contrôle

- **Statut** : validé avec Alexis le 23/10/2026
- **Dernière révision** : 2026-10-23

## Résumé

Un administrateur ouvre, depuis l'application seulement, par un geste humain, avec un motif, un accès d'une heure
au contenu personnel d'**un** membre : en lecture d'abord, en écriture par un second geste. Il reste lui-même : son
assistant MCP voit ce contenu sous le chemin du membre, chaque réponse le rappelle, et chaque version qu'il écrit
porte son nom. L'ouverture, le passage en écriture et la fermeture vont au journal d'administration ; le membre n'est
pas notifié.

## Contexte

L'espace personnel `private/<handle>` n'est vu que de son propriétaire et de ceux qu'il nomme : ni l'administrateur,
ni une règle d'organisation, ni l'équipe plateforme ne l'ouvrent ([droits d'accès](droits-d-acces.md), D5, N35, D18 ;
[nœuds et arbre](noeuds-et-arbre.md), H61). Le plancher de `node_level_of` (SQL) et de `nodeLevelOf` (TypeScript),
tenus égaux par un test de parité, le garantit ; depuis `20261021130000`, la RLS refuse aussi la lecture des blocs,
versions et fichiers d'un nœud qu'on ne lit pas. Seule la connexion d'administration de l'outillage (export d'une
organisation, `org delete`) voit ce contenu.

Deux cas réels n'ont aucun geste :

- corriger la procédure personnelle d'un membre dont dépend sa routine quotidienne : l'administrateur ne peut ni la
  lire ni l'écrire, et le membre n'est pas là ;
- reprendre le contenu personnel d'un membre pour un transfert : `node.export_tree` n'exporte que ce que la personne
  lit ([transfert d'une arborescence](transfert-d-arborescence.md)), donc rien de l'espace d'un autre.

Ce qui existait ailleurs : oto 1 a une « vue en tant que » (`X-Oto-View-As`), REST seulement, absente du MCP, sans
échéance ni motif : l'opérateur plateforme lit tout, l'administrateur d'organisation lit une liste fermée d'écrans de
ses membres, seul le super-administrateur écrit, après un geste d'acceptation ; la trace est `tool_calls.view_as_sub`,
lisible de l'administrateur de l'organisation. Le modèle le plus proche dans ce paquet est l'accès plateforme
(`platform_grants`) : nommé, motivé, visible du client, révocable, mais sans échéance.

## Objectifs et non-objectifs

- Objectifs : lire, puis corriger sur place, le contenu personnel d'un membre présent dans l'organisation, depuis
  l'écran comme par l'assistant de l'administrateur, sans rien changer à la propriété (la procédure reste au membre,
  sa routine continue) ; une trace qui dit qui, sur qui, pourquoi, quand, et ce qui a été écrit.
- Non-objectifs : ouvrir le mode par un outil MCP ou par `call` ; agir avec les comptes de connecteur personnels du
  membre (un appel à un service tiers en son nom) ; gérer son espace (partager, déplacer hors de l'espace, changer le
  propriétaire, mettre à la corbeille) ; le contenu d'un membre retiré (H70) ; tout autre droit du membre (jetons,
  profil, invitations).

## Conception

### Un contrôle

Une ligne `platform.member_controls` : organisation, acteur, membre contrôlé, mode (`read` ou `write`), motif (non
vide), ouverture, échéance (ouverture + 1 h, à l'horloge de la base, comme `expires_at_clock`), passage en écriture,
fermeture et sa cause (`closed`, `expired`, `member_removed`, `actor_not_admin`). Un seul contrôle ouvert par
acteur. Un contrôle n'est jamais prolongé : au-delà d'une heure, on en ouvre un autre, avec un nouveau motif.

### Ouvrir, écrire, fermer

- Écran Membres de l'administration : « Contrôler le contenu de… », motif à saisir, ouverture en lecture
  (`POST admin/members/<id>/control`). Un bandeau reste en tête de tous les écrans tant que le contrôle est ouvert :
  membre, mode, échéance, « Passer en écriture », « Fermer ».
- « Passer en écriture » demande une confirmation (`PATCH …/control`, `mode: "write"`), sans nouveau motif ni
  nouvelle échéance.
- La route n'accepte qu'une session de l'application : un jeton d'assistant y est refusé, quel que soit son porteur.
  Aucun des six outils ni aucune fonction de `call` n'ouvre, ne prolonge ni ne passe en écriture un contrôle.
- Le contrôle se ferme par le bandeau, à l'échéance, quand le membre quitte l'organisation, ou quand l'acteur perd
  l'administration ; la fermeture vaut dès la requête suivante.

### Ce que le contrôle ouvre

L'acteur garde son identité. Le calcul du niveau sur un nœud prend une entrée de plus : sur un nœud de l'espace
personnel du membre contrôlé, le niveau de l'acteur est au moins lecture (1), ou écriture (2) en mode écriture ;
jamais gestion (3). `node_level_of` lit le contrôle ouvert de `auth.uid()` en base ; `resolveIdentity` le lit à
chaque requête, ce qui le porte au MCP, dont la porte est sans état. Le test de parité couvre les deux modes.

Comme l'acteur reste l'appelant, ce que la base impose déjà vaut sans changement : le dernier auteur d'un bloc et
l'auteur d'une version sont l'acteur (`updated_by`, `node_versions.author`), et la ligne de journal est à son nom
(`journal_insert_own`). Les comptes de connecteur personnels du membre ne servent pas : `chooseAccount` ne les voit
pas, le contrôle ne touchant que les nœuds.

### Ce que voit l'assistant de l'acteur

Les mêmes six outils, sur le chemin du membre (`private/<handle>/…`) : `find` et `read` le trouvent, `write` y écrit
en mode écriture, `call` exporte ce que l'acteur lit. Chaque réponse porte une ligne « Mode contrôle : contenu
personnel de <nom>, lecture, jusqu'à 15:40 », et `context` la sert en tête. Le contexte privé du membre n'est pas
servi comme le sien : il se lit comme une page.

### La trace

- Au journal d'administration (`admin_journal`) : ouverture (membre, motif, mode, échéance), passage en écriture,
  fermeture et sa cause. Les administrateurs de l'organisation le lisent, et l'équipe plateforme avec un accès en
  cours.
- Au journal des appels, chaque ligne écrite pendant un contrôle porte son identifiant (`control_id`), et, par
  exception à D138, chaque lecture d'un nœud du membre pendant le contrôle s'y écrit aussi.
- L'historique d'une page nomme l'acteur, « en mode contrôle », par la version et son contrôle.
- Le membre n'est pas notifié ; il voit le contrôle dans l'historique de ses pages.

## Décisions et alternatives écartées

- **Se substituer au membre** (`sub` = membre, l'acteur dans un second claim), comme la vue d'oto 1 : écarté. Tout
  ce qui lit `auth.uid()` (auteur d'un bloc, journal, partages de comptes) l'attribuerait au membre ou demanderait une
  migration par table ; l'acteur hériterait des comptes personnels et des jetons du membre.
- **Ouvrir par un outil MCP** : écarté par la décision du 21/10, l'ouverture est un geste humain dans l'application.
- **Prolonger un contrôle** : écarté, un nouveau motif à chaque heure garde la trace lisible.
- **Transférer la propriété** pendant le contrôle : hors de ce mode, le membre garde sa procédure.

## Sécurité et confidentialité

- Le mode est une exception datée à D5, N35, H61 et D18, validés avec JB le 27/09/2026 : elle s'écrit dans [droits
  d'accès](droits-d-acces.md) avec le code.
- Les droits se décident dans le service et en base, dans les deux exemplaires du calcul ; le MCP n'ajoute rien, il
  hérite et signale.
- Le masquage du journal (D44, D52) reste : l'acteur lit le journal du membre comme avant ; seules ses propres lignes
  sont en clair.
- Un contrôle porte sur un membre de l'organisation de l'adresse ; un acteur de deux organisations n'a de contrôle
  ouvert que dans l'une.

## Écart avec le code

Tout : ni table, ni route, ni écran, ni calcul, ni ligne servie ; l'exception n'est pas encore dans [droits
d'accès](droits-d-acces.md) ni dans [journal et retours](journal-et-retours.md) (lectures journalisées).

## Questions ouvertes

- Aucune. Le contenu d'un membre retiré de l'organisation (H70) reste hors du mode : le reprendre serait un autre
  sujet.

## Historique

- 2026-10-23 : première version, d'après le cadre posé par Alexis le 21/10 (correction d'une procédure personnelle
  par un administrateur) et son point du 23/10 (transfert d'un contenu personnel).
- 2026-10-23 : deux gestes (lecture, puis écriture) dans un même contrôle ; l'assistant de l'acteur voit le contenu
  du membre, signalé à chaque réponse ; un membre ; une heure, sans prolongation ; ouvert par l'administrateur de
  l'organisation ou l'équipe plateforme avec un accès en cours ; lectures et écritures journalisées pendant le
  contrôle, membre non notifié, contrôle visible dans l'historique de ses pages — décidé par Alexis (source : session
  du 23/10/2026).
