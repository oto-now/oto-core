# Fonctions d'un hôte

- **Statut** : validé avec Alexis le 22/11/2026 (décisions de l'issue #153)
- **Dernière révision** : 2026-11-23

## Résumé

Un hôte qui a sa propre API REST la décrit en OpenAPI ; oto lit ce document, en tire des fonctions qui entrent au
catalogue de l'organisation derrière `call`, comme des fonctions de l'ERP, et les exécute par le moteur des connecteurs
décrits, sous un jeton de la personne dont l'audience est l'API de l'hôte, obtenu par échange (RFC 8693). L'hôte reste
seul juge des droits, du récapitulatif d'une écriture sensible et du texte d'un refus.

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
les deux temps d'une écriture sensible tenus par l'hôte ; ses refus `problem+json` relayés.

Non-objectifs : aucun outil MCP de plus (ADR-002) ; le consentement OAuth d'un client tiers (PR 2 du chantier) ; la
visibilité par personne (`/me/functions`), le filtrage de l'index et le bloc de `context` (PR 3) ; un écran.

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
l'instance (`host_issuer_not_instance`), chaque schéma d'entrée se compile (`host_schema_invalid`). Les espaces de noms
déjà servis par l'instance (paquet, ERP, connecteurs déclarés, contrats) sont réservés.

**Rafraîchissement** (`server/host-api/service.ts`, `refreshHostApi`). Réservé à l'équipe plateforme, par
`admin_connector refresh_host_api` (deux temps) ; `admin_connector host_api` montre l'état et les problèmes du dernier
refus. Accepté : le document, sa version et son `ETag` sont servis, le refus effacé. Inchangé (`304`) : seule la date de
rafraîchissement bouge. Refusé : l'adresse et le document précédents restent servis, le refus s'enregistre.

**Catalogue de l'organisation** (`server/catalog/org-catalog.ts`). `orgAssistantFunctions(db, identity)` = le catalogue de
l'instance, puis les fonctions de l'API de l'hôte. `find`, `read` (une fonction, `read functions`), `call` et le contrôle
d'une procédure le lisent. Les fonctions tirées d'un document servi sont gardées en mémoire par organisation, sous la clé
adresse + date de service : une requête légère par appel, une reconstruction seulement quand la clé change. Un document
servi qui ne s'importe plus est une panne (`internal`, journalisée), jamais un catalogue amputé en silence.

**Fonctions** (`server/host-api/functions.ts`). Origine `erp` : toujours actives, sans compte, de la classe déclarée ; une
fonction qui écrit est servie sous `<espace>_act.<verbe>`, comme celle d'un connecteur décrit. Chaque appel prépare la
fonction pour l'organisation : adresse `<adresse><serveur relatif><chemin>` (réglage `address`, gardé), jeton échangé
(`host_delegated`), refus `problem+json` traduits, et trois en-têtes :

| En-tête | Valeur | Absent |
|---|---|---|
| `Oto-Ctx` | le code `ctx` de la conversation | appel sans `ctx` |
| `Oto-Client` | la famille du client MCP (`Claude`, `ChatGPT`…, `assistantName`) | client inconnu |
| `Oto-Org` | l'identifiant de l'organisation (uuid), stable ; jamais le préfixe, qui peut changer | jamais |

**Jeton** (`server/host-api/exchange.ts`), voie first-party. `POST` au `token_endpoint` de la découverte de l'émetteur :
`grant_type=urn:ietf:params:oauth:grant-type:token-exchange`, `subject_token` = le jeton vérifié de l'appelant,
`subject_token_type=urn:ietf:params:oauth:token-type:access_token`, `resource` = `x-oto.resource`, `scope` = les scopes
demandés ; oto s'authentifie en HTTP Basic avec son client M2M (`PLATFORM_OIDC_EXCHANGE_CLIENT_ID`,
`PLATFORM_OIDC_EXCHANGE_CLIENT_SECRET`). Permis seulement si `x-oto.issuer` est l'émetteur de l'instance. Cache en mémoire
par (organisation, personne, ressource, scope) jusqu'à l'échéance moins une minute. `invalid_grant` : `forbidden`,
`details.reason = host_consent_required` (`consentRequired`, point d'entrée de la PR 2), sans repli. Prérequis chez
l'émetteur (Logto 1.43 ou plus) : même tenant, « Allow token exchange » sur l'application d'oto
(<https://docs.logto.io/developers/service-to-service-delegation>).

**Scopes.** Le profil refuse toute clé inconnue sous `x-oto` et dans `x-oto.families` (des textes) : une extension
`x-oto-scope` par famille n'y passe pas. En attendant qu'il la porte, oto demande l'union des familles, leurs clés jointes
par une espace (`hostScope`) ; l'émetteur rend l'intersection avec les rôles de la personne.

**Confirmation par l'hôte.** Sans `confirm`, `call` appelle l'opération sans `confirm` : seule une réponse
`202 { status: "needs_confirmation", summary }` tient le premier temps, et son `summary` est relayé comme tout
`needs_confirmation`. Avec `confirm: true`, la requête porte `?confirm=true`. Toute autre réponse réussie au premier temps
rompt le contrat : refus `upstream_error` (`details.reason = host_confirmation_broken`), journalisé, qui dit que l'hôte a
pu agir, jamais que rien n'a été fait.

**Erreurs** (`server/host-api/problem-json.ts`). Un `application/problem+json` devient une `PlatformError` : 400 et 422
→ `invalid_arguments`, 401 → `unauthorized` (« reconnectez-vous »), 403 → `forbidden`, 404 → `not_found`, 409 →
`conflict`, 413 → `too_large`, 429 → `rate_limited`, le reste → `upstream_error`. Message : `detail`, sinon `title`, borné
à 500 caractères ; le `code` de l'hôte en `details.refusal`. Une autre réponse hors 2xx suit la table standard du profil.

## Décisions et alternatives écartées

- **Transmettre le jeton de la personne tel quel** : écarté (décision du 22/11/2026), contraire à la spécification MCP.
- **Impersonation par la Management API de l'émetteur** : écartée, pouvoir total sur les personnes du tenant.
- **Assertion signée par oto** : écartée, l'hôte la vérifierait hors de l'émetteur.
- **`catalogFunctions(org)` qui remplace le registre** : le registre reste synchrone et sans base (activation, écrans,
  exécutant des travaux) ; l'organisation s'ajoute par `orgAssistantFunctions`, lu par les portes d'un assistant.
- **Rupture des deux temps en `internal`** (note de l'issue) : `internal` sert « Internal error. Retry once », qui
  pousserait à rappeler une écriture peut-être faite ; `upstream_error` porte un message honnête.
- **Rafraîchissement automatique toutes les 10 minutes** : pas dans cette première version (voir Écart).

## Sécurité et confidentialité

- SSRF : l'adresse est contrôlée à la saisie (`httpsAddressProblem`), le document et chaque appel partent par le
  transport gardé, sans redirection.
- Le jeton échangé ne part que vers l'adresse réglée de l'organisation ; le jeton de la personne ne part que vers
  l'émetteur de l'instance (un test le vérifie).
- Aucun secret au journal ni dans une réponse : le client M2M se nomme par sa variable ; un `problem+json` se journalise
  par son statut, son code et son message borné, jamais son corps.
- Le document de l'hôte n'a rien de secret (servi sans authentification) : il est lisible par les membres de
  l'organisation.

## Écart avec le code

- Le rafraîchissement n'est que manuel (`admin_connector refresh_host_api`) : aucune tâche ne relit le document toutes les
  10 minutes, faute d'une écriture hors session de l'équipe plateforme.
- Le scope est l'union des familles, provisoire, tant que le profil ne porte pas un scope par famille.
- Voie third-party (consentement OAuth d'un client tiers) : PR 2. Visibilité par personne, filtrage et bloc de
  `context` : PR 3.
- La lib est épinglée par une URL GitHub (`github:oto-now/connectors#<sha>&path:/ts`) : elle n'est pas publiée sur npm.

## Questions ouvertes

- Un scope par famille (`x-oto-scope`) dans le profil hôte de la lib, pour ne demander que ce que la fonction appelée exige.
- Qui écrit le rafraîchissement automatique : une commande de l'hôte sur la connexion d'administration, ou une tâche du
  paquet.

## Historique

- 2026-11-23 : première version, PR 1 du chantier (source par organisation, échange de jeton, confirmation par l'hôte).
