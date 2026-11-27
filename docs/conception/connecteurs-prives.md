# Connecteurs privés

- **Statut** : validé avec JB le 27/11/2026
- **Dernière révision** : 2026-11-27

## Résumé

Une organisation a des connecteurs privés : les opérations de l'API interne d'un de ses outils (un ERP, typiquement),
décrites en données, sans code ni déploiement, hors du catalogue de l'instance. Une définition **est** un
`connector.yaml` du format, restreint par le profil Custom API de la lib de connecteurs. L'équipe plateforme l'écrit,
les membres la lisent, l'organisation pose ses clés à l'écran Connecteurs. Chaque enregistrement est contrôlé en entier
et ajoute une version ; une définition refusée laisse servie la précédente.

## Contexte

- Le profil Custom API (`@otomata_tech/connectors/custom-api`, conception `custom-api.md` du dépôt de la lib) porte le
  format et sa validation : `validate(document, compile)` rend tous les problèmes, codés `custom_api_*` ; `toDefinition`
  projette la définition dans la forme que la fabrique génère. Il nomme lui-même ce qui manque à l'hôte : le stockage par
  organisation, l'application OAuth d'une organisation et l'écran.
- Le moteur des connecteurs décrits et le contrôle de déclaration existent ([connecteurs et
  comptes](connecteurs-et-comptes.md) § Moteur des connecteurs décrits) ; une source par organisation aussi, l'API d'un
  hôte ([fonctions d'un hôte](fonctions-d-un-hote.md) § Source par organisation), qui prouve qu'une définition peut
  s'exécuter hors du registre du processus.
- Oto 1 a appris, avec sa carte « API », que la définition appartient à l'organisation et que la garde de sortie doit
  exister dès le départ : elle y a été ajoutée après coup.

## Objectifs et non-objectifs

Objectifs : une définition par espace servi et par organisation, en données ; tous ses problèmes nommés d'un coup à
l'écriture ; un historique en ajout seul, avec retour à une version précédente ; aucune écriture hors de l'équipe
plateforme. Le découpage du chantier : stockage et validation, puis exposition aux assistants (la vue par organisation,
`call` sous un compte, la garde de sortie sur toute requête, l'origine d'un secret gardée sur son compte), puis la
rédaction par l'assistant (fonctions natives derrière `call`), puis l'écran.

Non-objectifs : un format à part (le profil est repris tel quel) ; un outil MCP de plus (ADR-002) ; un éditeur à l'écran ;
une entrée au catalogue de l'instance.

## Conception

**Stockage** (`20261127170000`, `docs/reference/schema-platform.md`). `platform.private_connectors` : un connecteur
privé par espace servi (`namespace`, en `custom_…`, unique dans l'organisation), sa clé interne (`name`, `custom_<8
hex>`, unique dans l'instance), sa version servie (`version`, montée par oto à chaque enregistrement) et son retrait
(`removed_at`). `platform.private_connector_versions` : chaque version enregistrée, en ajout seul, avec le document validé,
la version qu'un retour reprend (`restored_from`) et sa date ; une clé composée la garde dans l'organisation de son
connecteur. Le document servi est celui de la version de `private_connectors.version` : il n'est écrit qu'une fois.
Lecture : les membres de l'organisation. Écriture : le rôle du serveur seul (`platform_server`), une fois que le service
a décidé, pour l'équipe plateforme sur une organisation qu'elle atteint ; aucune suppression sous une session.

**Espace servi et clé.** L'espace servi est le nom de la définition (`connector.name`) : oto sert les fonctions sous lui
(`custom_erp.search_produits`, `custom_erp_act.create_commande`), et `connector.namespace` doit lui être égal. Deux
organisations peuvent servir le même espace sans que l'une apprenne l'existence de l'autre ; la clé interne, jamais
montrée à un assistant, est celle que les comptes de l'organisation nommeront. Un enregistrement sous un espace déjà
connu de l'organisation est une version de son connecteur.

**Validation** (`server/private-connectors/validation.ts`). Trois contrôles, dont tous les problèmes se rendent ensemble :

1. le profil de la lib (`validate`), qui borne aussi la définition à 100 fonctions et 256 Ko (`custom_api_too_large`) ;
2. sur une définition que le profil accepte : `toDefinition` (`private_connector_not_generated` si la fabrique ne la
   générerait pas), puis le contrôle de déclaration d'oto-core sur elle seule, `declarationProblem`, extrait de
   `registerConnectors` (`private_connector_declaration`, son message) ;
3. ce qu'oto exige en plus, sur ce qui se lit de la définition, sauf une place que le profil a déjà nommée : l'espace
   est le nom (`private_connector_namespace_mismatch`) ; il n'est pas déjà servi par l'instance, seul ou en `_act`
   (`private_connector_namespace_taken`, les espaces réservés de `reservedNamespaces`) ; l'authentification est de la V1
   (`private_connector_auth_not_supported` : `none`, `api_key`, `bearer`, `basic`, `oauth2_client_credentials`) ;
   chaque adresse (`base_url`, `token_url`, `authorize_url`, l'adresse d'identité) passe la garde **par sa résolution**
   (`resolutionFault`, `address-guard.ts`) : une adresse résolue interne (`private_connector_address_internal`) ou un
   nom qui ne se résout pas en 5 s (`private_connector_address_unresolved`) sont refusés.

**Service** (`server/private-connectors/service.ts`). `checkPrivateConnector` : le contrôle à blanc, tous les problèmes et
ce qui est servi sous l'espace, rien d'écrit. `savePrivateConnector` : contrôlée de même ; refusée, rien n'est écrit et la
version précédente reste servie ; acceptée, une version s'ajoute et devient celle servie (le même document déjà servi ne
change rien). `restorePrivateConnector` : le document d'une version passée, contrôlé à nouveau (l'instance a pu changer),
devient une version neuve qui la nomme. `removePrivateConnector` : le connecteur cesse d'être servi, sa clé et ses
versions restent ; un enregistrement ou un retour sous le même espace le rouvre. Les trois écritures sont réservées à
l'équipe plateforme (`forbidden` sinon) ; `listPrivateConnectors` et `readPrivateConnector` lisent sous la session de qui
appelle.

**Administration** (`mcp/admin/tools/private-connector.ts`). `admin_connector` gagne `private_connectors`,
`private_connector` (ses versions, et le document servi ou d'une version donnée), `save_private_connector` (la définition
en texte JSON, un schéma d'outil plat n'ayant ni objet ni liste ; son premier temps est le contrôle à blanc),
`restore_private_connector` et `remove_private_connector`, les trois écritures en deux temps. Chaque appel a sa ligne au
journal d'administration (auteur, organisation, arguments bornés) ; la cible d'une écriture nomme l'espace et la
version servie après elle (`private_connector:custom_erp v3`).

**Suppression et transfert.** Les deux tables partent avec l'organisation (`oto-platform org delete`) et ne sont jamais
exportées, comme l'API de l'hôte : sur un hôte cible, l'équipe plateforme relit la définition et la réenregistre.

## Décisions et alternatives écartées

- **Qui écrit la définition** (décidé par JB le 27/11/2026) : l'équipe plateforme seule, comme l'API d'un hôte. Écarté :
  l'administrateur de l'organisation sous une capacité que l'hôte lui ouvrirait (`private_connectors`), qui portait le
  besoin « à chaud, sans nous » ; la capacité n'est pas créée.
- **Clé et registre** (JB, 27/11/2026) : une clé interne `custom_<8 hex>` et un espace servi propre à l'organisation.
  Écarté : le nom choisi par l'organisation comme clé de `platform.connectors` et du registre du processus, qui
  révélait l'existence d'un homonyme et faisait modifier un état global par une organisation.
- **`oauth2_user`** (JB, 27/11/2026) : pas en V1 ; il attend l'application OAuth d'une organisation, rangée au coffre.
- **Exceptions de sortie** (JB, 27/11/2026) : aucune ; une API joignable seulement en réseau privé passe par un pont
  exposé en `https` public. Des exceptions déclarées par l'hôte, liées à une organisation, pourront s'ajouter sans rien
  casser.
- **Écran** (JB, 27/11/2026) : la définition en lecture à l'écran Connecteurs ; écarté, un éditeur dans le paquet.
- **Historique** (JB, 27/11/2026) : une table de versions en ajout seul, avec retour à une version. Écarté : le numéro
  de version seul et le journal d'administration, sans retour possible ni trace des textes servis.
- **Le document dans la table du connecteur** : écarté ; il n'est que dans sa version, une seule copie.
- **`created_by` et `updated_by`** : écartés ; `forget_user` aurait dû les oublier, et le journal d'administration nomme
  déjà l'auteur de chaque version.
- **Un retrait qui supprime** : écarté ; l'historique en ajout seul garde les versions, et la clé reste celle de
  l'espace.

## Sécurité et confidentialité

- Aucun secret dans une définition : le profil refuse tout en-tête qui authentifie ou route la requête ; les champs du
  coffre sont nommés, jamais remplis. Elle est donc lisible par les membres de l'organisation.
- Une adresse se juge à l'écriture par sa résolution, sur toutes les adresses rendues. Ce contrôle ne remplace pas la
  garde de chaque requête : une résolution qui change ensuite est refusée à l'appel, par le transport gardé.
- Aucune écriture sous la session d'une personne, membre de l'équipe plateforme comprise : le rôle du serveur seul, et la
  RLS refuse toujours une organisation que l'appelant n'atteint pas.

## Écart avec le code

- Écrit : le stockage, la validation, le service et l'administration.
- Pas encore écrit : l'exposition aux assistants (aucune fonction d'un connecteur privé n'est servie ni appelée, aucun
  compte ne s'y ouvre, `platform.connectors` ne le connaît pas) ; la garde de sortie sur ses requêtes et l'origine d'un
  secret gardée sur son compte ; les fonctions natives de rédaction derrière `call` ; l'écran.
- L'espace d'un connecteur privé n'est pas confronté à ceux de l'API de l'hôte de l'organisation.

## Questions ouvertes

- Le sort d'une définition au transfert d'une organisation : refaite à la main aujourd'hui ; à reprendre si l'export
  emporte un jour les comptes d'un connecteur privé.

## Historique

- 2026-11-27 : première version ; qui écrit (l'équipe plateforme), clé interne et espace par organisation, sans
  `oauth2_user` ni exception de sortie, définition en lecture à l'écran, versions en ajout seul avec retour — décidé par
  JB (source : décisions sur la proposition de conception du chantier, 27/11/2026).
