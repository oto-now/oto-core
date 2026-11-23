# Fonctions d'un hôte

- **Statut** : validé avec Alexis le 22/11/2026 (décisions de l'issue #153)
- **Dernière révision** : 2026-11-23

## Résumé

Un hôte qui a sa propre API REST la décrit en OpenAPI ; oto lit ce document, en tire des fonctions qui entrent au
catalogue de l'organisation derrière `call`, comme des fonctions de l'ERP, et les exécute par le moteur des connecteurs
décrits, sous un jeton de la personne dont l'audience est l'API de l'hôte, au scope de la fonction appelée : obtenu par
échange (RFC 8693) pour un client first-party, par le consentement de la personne pour un client tiers. L'hôte reste seul
juge des droits, du récapitulatif d'une écriture sensible et du texte d'un refus. L'index montre à chacun les seules
fonctions que l'hôte lui ouvre (`/me/functions`) : le catalogue et un bloc de 3 000 caractères au plus dans `context`.

## Contexte

- Une fonction d'hôte n'entrait au catalogue que par `registerFunctions` (`server/catalog/erp.ts`), en TypeScript, dans le
  même processus. Un hôte qui a son propre serveur n'avait aucun chemin.
- La lib de connecteurs porte le profil « hôte » (`fromHostOpenApi`, `@otomata_tech/connectors/custom-api`) : il juge un
  document OpenAPI 3.1 et le projette dans le format de description, un connecteur par espace de noms, l'adresse lue dans
  le réglage `address`, l'authentification `host_delegated`, la confirmation `confirm: { by: host }`.
- Le moteur des connecteurs décrits (`connecteurs-et-comptes.md` § Moteur) sait déjà valider, répartir les arguments,
  garder une adresse saisie et tailler une sortie.
- La spécification MCP proscrit de transmettre un jeton reçu à une autre ressource.

## Objectifs et non-objectifs

Objectifs : une source par organisation, refusée avec ses problèmes nommés sans jamais remplacer la version servie ; des
fonctions trouvées par `find`, lues par `read`, appelées par `call` ; le jeton de la personne jamais transmis à l'hôte ;
les deux temps d'une écriture sensible tenus par l'hôte ; ses refus `problem+json` relayés ; un index filtré par personne,
dans `context` sans en manger le budget.

Non-objectifs : aucun outil MCP de plus (ADR-002) ; le filtrage comme garantie de sécurité (l'hôte décide à l'appel) ;
un écran.

## Conception

**Source par organisation.** La table `platform.host_apis` (`20261123150000`, `docs/reference/schema-platform.md`) garde,
par organisation, l'adresse `https` de l'API, le document servi, sa version (`info.version`), son `ETag`, les dates de
service et de rafraîchissement, et le dernier refus (adresse, date, problèmes). Lue par les membres, écrite par l'équipe
plateforme.

**Lecture du document** (`server/host-api/document.ts`). `GET <adresse>/openapi.json`, sans authentification, par le
transport gardé (`address-guard.ts` : `https`, IP publiques seules, aucune redirection suivie), 10 s, 5 Mo au plus,
`If-None-Match` quand l'adresse n'a pas changé. Chaque échec est un refus nommé (`host_address_refused`,
`host_document_unreachable`, `host_document_status`, `host_document_too_large`, `host_document_not_json`). Le document passe
ensuite le profil hôte (`host_*`, `openapi_*`), puis deux contrôles d'oto : l'émetteur `x-oto.issuer` est celui de
l'instance (`host_issuer_not_instance`), chaque fonction a un scope (`host_scope_missing`, § Scopes), chaque schéma
d'entrée se compile (`host_schema_invalid`). Les espaces de noms déjà servis par l'instance (paquet, ERP, connecteurs
déclarés, contrats) et `host_api` (§ Jeton, consentement) sont réservés.

**Rafraîchissement** (`server/host-api/service.ts`, `refreshHostApi`). Réservé à l'équipe plateforme, par
`admin_connector refresh_host_api` (deux temps) ; `admin_connector host_api` montre l'état et les problèmes du dernier
refus. Accepté : le document, sa version et son `ETag` sont servis, le refus effacé. Inchangé (`304`) : seule la date de
rafraîchissement bouge. Refusé : l'adresse et le document précédents restent servis, le refus s'enregistre.

**Catalogue de l'organisation** (`server/catalog/org-catalog.ts`). `orgAssistantFunctions(db, identity)` = le catalogue de
l'instance, puis les fonctions de l'API de l'hôte. `find`, `read` (une fonction, `read functions`), `call` et le contrôle
d'une procédure le lisent. Le document servi, importé, est gardé en mémoire par organisation, sous la clé adresse + date de
service (`server/host-api/served.ts`, lu aussi par le consentement) : une requête légère par appel, un import seulement
quand la clé change. Un document
servi qui ne s'importe plus est une panne (`internal`, journalisée), jamais un catalogue amputé en silence.

**Fonctions** (`server/host-api/functions.ts`). Origine `erp` : toujours actives, sans compte, de la classe déclarée ; une
fonction qui écrit est servie sous `<espace>_act.<verbe>`, comme celle d'un connecteur décrit. Chaque appel prépare la
fonction pour l'organisation : adresse `<adresse><serveur relatif><chemin>` (réglage `address`, gardé), jeton de la
personne au scope de la fonction (`host_delegated`, `server/host-api/consent.ts`, § Jeton), refus `problem+json`
traduits, et trois en-têtes :

| En-tête | Valeur | Absent |
|---|---|---|
| `Oto-Ctx` | le code `ctx` de la conversation | appel sans `ctx` |
| `Oto-Client` | la famille du client MCP (`Claude`, `ChatGPT`…, `assistantName`) | client inconnu |
| `Oto-Org` | l'identifiant de l'organisation (uuid), stable ; jamais le préfixe, qui peut changer | jamais |

**Jeton** (`server/host-api/consent.ts`). Toujours dans cet ordre, sans repli silencieux : l'échange ; s'il désigne un
client tiers, le consentement rangé de la personne ; sinon le refus qui porte le lien d'autorisation.

- **Échange, voie first-party** (`server/host-api/exchange.ts`). `POST` au `token_endpoint` de la découverte de
  l'émetteur : `grant_type=urn:ietf:params:oauth:grant-type:token-exchange`, `subject_token` = le jeton vérifié de
  l'appelant, `subject_token_type=urn:ietf:params:oauth:token-type:access_token`, `resource` = `x-oto.resource`, `scope`
  = celui de la fonction ; oto s'authentifie en HTTP Basic avec son client M2M (`PLATFORM_OIDC_EXCHANGE_CLIENT_ID`,
  `PLATFORM_OIDC_EXCHANGE_CLIENT_SECRET`). Permis seulement si `x-oto.issuer` est l'émetteur de l'instance. Cache en
  mémoire par (organisation, personne, client de l'appelant, ressource, scope) jusqu'à l'échéance moins une minute. Un
  jeton de l'appelant échu est refusé avant l'échange (`unauthorized`). Prérequis chez l'émetteur (Logto 1.43 ou plus) :
  même tenant, « Allow token exchange » sur l'application d'oto
  (<https://docs.logto.io/developers/service-to-service-delegation>).
- **Discrimination du client tiers** (`THIRD_PARTY_REFUSAL`). Logto refuse d'échanger le jeton d'un client tiers (DCR,
  et tout client CIMD, dont l'identifiant est une URL) par `InvalidGrant('subject token was not issued to a first-party
  application')`. Son fournisseur OIDC ne rend pas ce détail (`error_detail`) : la réponse est
  `{"error":"invalid_grant","error_description":"grant request is invalid"}`, la même pour tout `InvalidGrant`. oto ne
  passe au consentement que sur ce couple exact. Sous un jeton qu'oto vient de vérifier (signature, émetteur, audience,
  `sub`, `client_id`) et dont l'échéance est contrôlée avant l'échange, ce couple ne couvre que le client tiers, un client
  supprimé ou une personne suspendue ; les deux derniers ne consentent pas non plus, et le lien n'aboutit pas. Tout autre
  refus (`unauthorized_client` d'une application sans « Allow token exchange », `invalid_target`, `invalid_scope`,
  `invalid_client`, une panne) est un `upstream_error` qui nomme le code : jamais le consentement. Le constat d'un client
  tiers est gardé cinq minutes au plus pour ce jeton de l'appelant (une requête de moins par appel).
- **Consentement, voie third-party** (`server/host-api/consent-access.ts`, décision d'Alexis du 22/11/2026). Le parcours
  `oauth2_user` du paquet, construit depuis le document servi au lieu d'une description déclarée : la personne autorise
  une fois l'instance, cliente de l'émetteur, à appeler l'API. Autorisation à l'`authorization_endpoint` de la
  découverte : `scope` = `openid offline_access` puis les scopes des fonctions, `resource` = `x-oto.resource`,
  `prompt=consent` (sans lui, Logto ne rend pas de jeton de rafraîchissement), `state` et PKCE comme tout consentement ;
  `resource` aussi à chaque demande au point de jeton (code, renouvellement : sans lui, le jeton rendu n'a pas l'audience
  de l'API). Client : une application « traditional » de l'émetteur (`PLATFORM_OIDC_CONSENT_CLIENT_ID`,
  `PLATFORM_OIDC_CONSENT_CLIENT_SECRET`, `cell.ts`), distincte du client M2M qui ne fait pas `authorization_code` ; la même
  application sert les deux si « Allow token exchange » y est activé, les deux paires portant alors les mêmes valeurs.
  Adresse de retour : celle d'`oauth2_user`, `<adresse de l'organisation>/api/platform/connector-consent/callback`, à
  déclarer chez l'émetteur pour chaque adresse. Le retour range les jetons, chiffrés par le coffre, sur le compte
  personnel `host_api` de la personne (un seul par personne et organisation, au libellé du titre de l'API, la ressource
  consentie dans `settings.resource`), avec les mêmes renouvellement, rotation et passage à reconnecter qu'un compte
  `oauth2_user`. Le connecteur `host_api` n'est jamais déclaré : `registerConnectors` et l'import d'un document refusent
  ce nom ; il s'inscrit dans `platform.connectors` (« Host API ») à la première demande.
- **Sans consentement** : `not_enabled`, `details.reason = host_consent_required`, `details.url` = le lien
  d'autorisation, posé à l'appel (demande à usage unique, dix minutes, liée à la personne) : « Authorize oto to act on
  <titre> for you: <url> ». De même pour un compte désactivé, à reconnecter (renouvellement refusé), consenti pour une
  autre ressource, ou dont le jeton porte un autre `sub` que celui de l'appelant (consentement donné sous un autre compte
  de l'émetteur : le compte passe à reconnecter, son jeton ne part pas). Le même départ se fait de l'écran Connecteurs
  (« Reconnecter », `POST /api/platform/connector-consent` avec `connector: host_api`).
- **Révocation** : la personne désactive son compte `host_api` dans l'écran Connecteurs (`disableAccount`, comme tout
  compte `oauth2_user`) ; l'appel suivant rend le lien. Consentir de nouveau reprend le même compte.

**Scopes.** Une famille de `x-oto.families` s'écrit `{ label, scope }` (profil hôte de la lib v1.248.0) ; chaque fonction
porte le scope de sa famille (`definition.functions[nom].scope`), qu'oto demande à l'échange pour cette fonction seule.
Une famille écrite par son seul libellé n'a pas de scope : le profil l'admet, oto en refuse chaque fonction à l'import
(`host_scope_missing`, une ligne par fonction), jamais un scope deviné. À l'import plutôt qu'à l'appel : l'administration
lit le refus au rafraîchissement et la version précédente reste servie, au lieu d'une fonction servie qui échouerait à
chaque appel. Le consentement demande en une fois les scopes de toutes les fonctions ; l'émetteur rend l'intersection
avec les rôles de la personne.

**Confirmation par l'hôte.** Sans `confirm`, `call` appelle l'opération sans `confirm` : seule une réponse
`202 { status: "needs_confirmation", summary }` tient le premier temps, et son `summary` est relayé comme tout
`needs_confirmation`. Avec `confirm: true`, la requête porte `?confirm=true`. Toute autre réponse réussie au premier temps
rompt le contrat : refus `upstream_error` (`details.reason = host_confirmation_broken`), journalisé, qui dit que l'hôte a
pu agir, jamais que rien n'a été fait.

**Visibilité par personne** (`server/host-api/visibility.ts`). oto demande à l'hôte les fonctions que la personne peut
appeler : `GET <adresse><x-oto.functions>` (`/me/functions`), par le transport gardé, 10 s, avec les en-têtes `Oto-*`,
sous un jeton de la personne pour l'API obtenu comme celui d'un appel (§ Jeton : échange, sinon consentement, sinon le
refus et son lien), mais **sans scope** : la liste ne lit que l'identité, le jeton porte l'audience seule. Réponse
attendue : `200 {"functions": ["<operationId>", …]}`, les noms du document. Un nom que le document servi ne porte pas (un
document plus récent chez l'hôte) est ignoré et compté au log. Les rôles déclarés (`x-oto-roles`) ne filtrent rien : ils
servent l'affichage et la lecture du contrat ; la visibilité réelle dépend de droits plus fins que l'hôte seul connaît.
La liste est gardée en mémoire du processus cinq minutes par (organisation, personne, adresse, version du document) ;
seule une liste lue est gardée. Elle est lue par `context`, `find` et `read functions` (`visibleOrgFunctions`,
`server/catalog/org-catalog.ts`), **jamais par `call`** : une fonction absente de la liste part quand même vers l'hôte, qui
décide, et son refus `problem+json` est relayé (§ Erreurs). Indisponible (refus de l'hôte, réponse illisible, panne,
consentement à donner, appel sans jeton vérifié), la liste ne montre aucune fonction de l'hôte et l'index le dit :
« Functions of <titre> unavailable: <raison> <p>_call still reaches <titre>, which decides. », raison bornée à
300 caractères ; jamais toutes les fonctions.

**Index** (`server/host-api/index-view.ts`). Deux vues des mêmes fonctions visibles :

- **Bloc de `context`** (`server/context/blocks/host.ts`), « host functions », servi juste après les règles, en
  affichage comme au budget (`PRIORITY.host = 1`, [contexte servi](contexte-servi.md)). Une tête (lire un contrat par
  `read`, l'appeler par `call`, l'index entier par `read {"path": "functions"}`), une ligne par famille dans l'ordre de
  `x-oto.families` (« - <libellé> : <noms servis> », une famille sans fonction visible omise), puis « Closest to the
  request: » et les fonctions les plus proches de la demande, 8 au plus (`searchFunctions` : score, puis nom), avec leur
  `summary`. Aucun bloc sans API servie, ni pour une personne sans fonction visible ; une liste indisponible : sa ligne.
  Le `context` léger (`since_ctx`) ne le sert pas, ni l'aperçu de l'écran « Contexte », qui n'a pas de jeton de la
  personne.
- **Règle de troncature**, déterministe (même document, même liste, même demande, même texte), à 3 000 caractères :
  1. une ligne de famille de plus de 600 caractères garde ses premiers noms entiers et compte les autres (« … and 12
     more ») ;
  2. si le bloc dépasse 3 000 caractères, les fonctions proches partent une à une, la moins proche d'abord ;
  3. puis les familles, la dernière d'abord ;
  4. le bloc coupé finit par « [Index cut to 3,000 characters: N families and M close functions not listed. Read them
     with <p>_read {"path": "functions"}.] » : jamais une coupure muette. Le bloc coupé est rapporté `cut` à l'aperçu.
- **`read functions`** : les fonctions actives de l'instance par connecteur, puis « Functions of <titre> open to you, by
  family: », chaque famille et ses fonctions avec leur classe et leur `summary`, entière ; « No function of <titre> is
  open to you. » pour une liste vide ; la ligne d'indisponibilité sinon. `find` cherche parmi les seules fonctions
  visibles, et ajoute la ligne d'indisponibilité quand la liste manque.

**Erreurs** (`server/host-api/problem-json.ts`). Un `application/problem+json` devient une `PlatformError` : 400 et 422
→ `invalid_arguments`, 401 → `unauthorized` (« reconnectez-vous »), 403 → `forbidden`, 404 → `not_found`, 409 →
`conflict`, 413 → `too_large`, 429 → `rate_limited`, le reste → `upstream_error`. Message : `detail`, sinon `title`, borné
à 500 caractères ; le `code` de l'hôte en `details.refusal`. Une autre réponse hors 2xx suit la table standard du profil.

## Décisions et alternatives écartées

- **Filtrer par les rôles déclarés (`x-oto-roles`)** : écarté (réponse 6 de la conception), la visibilité réelle dépend de
  droits plus fins que le rôle, que seul l'hôte connaît ; oto lit `/me/functions`.
- **Filtrer `call` par la liste** : écarté, la liste sert le routage ; le refus de l'hôte à l'exécution reste la seule
  garantie, et il est relayé.
- **Tout montrer quand la liste échoue** : écarté, l'index dit la raison au lieu de tout montrer.
- **Le jeton de la liste au scope de toutes les fonctions** : écarté, la liste ne lit que l'identité ; aucun scope.
- **L'index entier dans `context`** (8 à 9 000 caractères pour 78 fonctions) : écarté (décision du 22/11/2026), le quart
  du plafond à chaque conversation ; un bloc de 3 000 caractères et `read functions`.

- **Transmettre le jeton de la personne tel quel** : écarté (décision du 22/11/2026), contraire à la spécification MCP.
- **Impersonation par la Management API de l'émetteur** : écartée, pouvoir total sur les personnes du tenant.
- **Assertion signée par oto** : écartée, l'hôte la vérifierait hors de l'émetteur.
- **`catalogFunctions(org)` qui remplace le registre** : le registre reste synchrone et sans base (activation, écrans,
  exécutant des travaux) ; l'organisation s'ajoute par `orgAssistantFunctions`, lu par les portes d'un assistant.
- **Rupture des deux temps en `internal`** (note de l'issue) : `internal` sert « Internal error. Retry once », qui
  pousserait à rappeler une écriture peut-être faite ; `upstream_error` porte un message honnête.
- **Rafraîchissement automatique toutes les 10 minutes** : pas dans cette première version (voir Écart).
- **Union des familles comme scope** (PR 1, provisoire) : remplacée par le scope de la fonction dès que le profil l'a porté.
- **Scope manquant refusé à l'appel** : écarté, une fonction servie échouerait à chaque appel ; refusé à l'import.
- **Discriminer le client tiers par la description** « subject token was not issued to a first-party application » :
  impossible, Logto ne rend que « grant request is invalid » ; le couple exact est retenu (§ Jeton).
- **Une table propre aux consentements d'hôte** : écartée, le compte personnel `host_api` réutilise le stockage chiffré,
  le renouvellement, la reconnexion, la désactivation et l'écran des comptes `oauth2_user`.
- **Le client web de connexion de l'hôte de référence** (`PLATFORM_OIDC_CLIENT_ID`) comme client de consentement :
  écarté, il appartient à `src/`, pas au paquet, et ses adresses de rappel sont celles de la connexion.

## Sécurité et confidentialité

- SSRF : l'adresse est contrôlée à la saisie (`httpsAddressProblem`), le document et chaque appel partent par le
  transport gardé, sans redirection.
- Le jeton échangé ou consenti ne part que vers l'adresse réglée de l'organisation ; le jeton de la personne ne part que
  vers l'émetteur de l'instance (un test le vérifie). Un jeton consenti dont le `sub` n'est pas celui de l'appelant ne
  part jamais.
- Le jeton d'un client first-party n'en sert jamais un autre : le client de l'appelant fait partie de la clé du cache.
- Les jetons d'un consentement sont chiffrés par le coffre sur le compte (`PLATFORM_VAULT_KEY`), jamais en clair en base,
  au journal ni dans une réponse ; le lien d'autorisation n'en porte aucun.
- Aucun secret au journal ni dans une réponse : les clients M2M et de consentement se nomment par leur variable ; un `problem+json` se journalise
  par son statut, son code et son message borné, jamais son corps.
- Le document de l'hôte n'a rien de secret (servi sans authentification) : il est lisible par les membres de
  l'organisation.
- La liste d'une personne sert le routage, jamais la sécurité : `call` ne la lit pas, l'hôte juge chaque appel. Elle est
  gardée par personne (son identifiant dans la clé), jamais partagée entre deux personnes ; le jeton de la liste n'a aucun
  scope.

## Écart avec le code

- Le rafraîchissement n'est que manuel (`admin_connector refresh_host_api`) : aucune tâche ne relit le document toutes les
  10 minutes, faute d'une écriture hors session de l'équipe plateforme.
- `read {"path": "functions/<famille>"}` (l'index d'une seule famille, réponse 7 de la conception) n'est pas servi :
  `read functions` sert l'index entier, et le bloc de `context` y renvoie. Le chemin `functions/…` n'est pas réservé à
  l'écriture.
- Une personne dont le client tiers n'a pas encore de consentement : chaque lecture de sa liste (`context`, `find`,
  `read functions`) pose une demande de consentement, à usage unique et de dix minutes, pour porter le lien dans la ligne
  d'indisponibilité.
- Un échec de la liste n'est pas gardé : chaque lecture la redemande à l'hôte.
- Le retour du consentement exige la session web de la personne à l'adresse de l'organisation, comme tout consentement
  `oauth2_user` : ouvert sans elle, le lien mène à la connexion, puis il faut le rouvrir.
- Le jeton consenti porte les scopes de toutes les fonctions, pas celui de la fonction appelée (un seul jeton par
  personne, renouvelé sans `scope`).
- La désactivation du compte `host_api` ne révoque pas l'autorisation chez l'émetteur : le jeton de rafraîchissement
  reste chiffré sur le compte, inutilisé, jusqu'à un nouveau consentement qui le remplace.
- La lib est épinglée par une URL GitHub (`github:oto-now/connectors#<sha>&path:/ts`) : elle n'est pas publiée sur npm.

## Questions ouvertes

- La forme de la réponse de `/me/functions` (`{"functions": [operationId…]}`) est fixée par oto ; le premier hôte doit
  la servir telle quelle (le profil de la lib n'en dit rien).

- Discrimination du client tiers : le couple `invalid_grant` + « grant request is invalid » couvre aussi un client
  supprimé et une personne suspendue (le lien n'aboutit pas pour eux). Obtenir de Logto qu'il rende le détail, ou
  reconnaître les clients first-party autrement (liste déclarée), le rendrait exact.
- Qui écrit le rafraîchissement automatique : une commande de l'hôte sur la connexion d'administration, ou une tâche du
  paquet.

## Historique

- 2026-11-23 : première version, PR 1 du chantier (source par organisation, échange de jeton, confirmation par l'hôte).
- 2026-11-23 : PR 2 du chantier : scope par fonction (lib v1.248.0, famille sans scope refusée à l'import), consentement
  OAuth d'un client tiers (compte `host_api`, lien d'autorisation dans le refus), discrimination du client tiers —
  décidé par Alexis (issue #153, commentaire du 22/11/2026).
- 2026-11-23 : PR 3 du chantier : visibilité par personne (`/me/functions`, sans scope, gardée cinq minutes), filtrage de
  `find`, de `read functions` et de `context`, jamais de `call` ; bloc « host functions » de `context`, 3 000 caractères
  au plus, et sa règle de troncature — décidé par Alexis (source : réponses 6 et 7 de la conception, décisions du 22/11/2026).
