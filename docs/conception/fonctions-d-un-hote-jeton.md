# Fonctions d'un hôte : jeton et consentement

- **Statut** : validé avec Alexis le 22/11/2026 (décisions de l'issue #153)
- **Dernière révision** : 2026-11-23

## Résumé

Une fonction de l'API d'un hôte ([fonctions d'un hôte](fonctions-d-un-hote.md)) court sous un jeton de la personne dont
l'audience est l'API de l'hôte, au scope de la fonction appelée : obtenu par échange (RFC 8693) pour un client
first-party, par le consentement de la personne pour un client tiers, sans repli silencieux entre les deux. Le jeton de
la personne n'est jamais transmis à l'hôte. La liste des fonctions de la personne ([visibilité et
index](fonctions-d-un-hote-index.md)) se lit sous un jeton obtenu de même, sans scope.

## Contexte

- La spécification MCP proscrit de transmettre un jeton reçu à une autre ressource.
- Logto (1.43 ou plus) échange le jeton d'un client first-party, jamais celui d'un client tiers (DCR, CIMD).
- Le paquet sait déjà tenir un consentement `oauth2_user` : demande, `state`, PKCE, stockage chiffré, renouvellement.

## Objectifs et non-objectifs

Objectifs : le jeton de la personne jamais transmis à l'hôte ; un jeton par fonction, à son scope ; le client tiers servi
par un consentement donné une fois ; aucun repli silencieux d'une voie à l'autre.

Non-objectifs : l'impersonation, une assertion signée par oto (§ Décisions) ; la révocation chez l'émetteur.

## Conception

**Ordre** (`server/host-api/consent.ts`). Toujours dans cet ordre, sans repli silencieux : l'échange ; s'il désigne un
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
  d'autorisation : « Authorize oto to act on <titre> for you: <url> (… within 5 minutes …) ». Le lien est celui de la
  demande encore ouverte de la personne pour cette organisation, cette ressource, cette version du document et cette
  adresse de retour, relue en base par son `state` (`consentStillOpen`), tant qu'il lui reste au moins cinq minutes ;
  sinon une demande neuve (à usage unique, dix minutes, liée à la personne). Les liens servis sont gardés en mémoire du
  processus : une lecture de la liste des fonctions ([index](fonctions-d-un-hote-index.md)) ne pose pas une demande de
  plus. Le même refus vaut pour un compte désactivé, à reconnecter (renouvellement refusé), consenti pour une
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

## Décisions et alternatives écartées

- **Transmettre le jeton de la personne tel quel** : écarté (décision du 22/11/2026), contraire à la spécification MCP.
- **Impersonation par la Management API de l'émetteur** : écartée, pouvoir total sur les personnes du tenant.
- **Assertion signée par oto** : écartée, l'hôte la vérifierait hors de l'émetteur.
- **Union des familles comme scope** (PR 1, provisoire) : remplacée par le scope de la fonction dès que le profil l'a porté.
- **Scope manquant refusé à l'appel** : écarté, une fonction servie échouerait à chaque appel ; refusé à l'import.
- **Discriminer le client tiers par la description** « subject token was not issued to a first-party application » :
  impossible, Logto ne rend que « grant request is invalid » ; le couple exact est retenu (§ Conception, discrimination du client tiers).
- **Une table propre aux consentements d'hôte** : écartée, le compte personnel `host_api` réutilise le stockage chiffré,
  le renouvellement, la reconnexion, la désactivation et l'écran des comptes `oauth2_user`.
- **Le client web de connexion de l'hôte de référence** (`PLATFORM_OIDC_CLIENT_ID`) comme client de consentement :
  écarté, il appartient à `src/`, pas au paquet, et ses adresses de rappel sont celles de la connexion.
- **Une demande de consentement neuve à chaque refus** : écartée le 23/11/2026, chaque lecture de la liste des fonctions
  en posait une ; la demande encore ouverte est reprise.

## Sécurité et confidentialité

- Le jeton échangé ou consenti ne part que vers l'adresse réglée de l'organisation ; le jeton de la personne ne part que
  vers l'émetteur de l'instance (un test le vérifie). Un jeton consenti dont le `sub` n'est pas celui de l'appelant ne
  part jamais.
- Le jeton d'un client first-party n'en sert jamais un autre : le client de l'appelant fait partie de la clé du cache.
- Les jetons d'un consentement sont chiffrés par le coffre sur le compte (`PLATFORM_VAULT_KEY`), jamais en clair en base,
  au journal ni dans une réponse ; le lien d'autorisation n'en porte aucun.
- Un lien d'autorisation repris n'est servi qu'à la personne qui a posé sa demande, dans la même organisation : la clé
  de la mémoire et la relecture en base (`org_id`, `user_id`, `state`) le tiennent.

## Écart avec le code

- Le retour du consentement exige la session web de la personne à l'adresse de l'organisation, comme tout consentement
  `oauth2_user` : ouvert sans elle, le lien mène à la connexion, puis il faut le rouvrir.
- Le jeton consenti porte les scopes de toutes les fonctions, pas celui de la fonction appelée (un seul jeton par
  personne, renouvelé sans `scope`).
- La désactivation du compte `host_api` ne révoque pas l'autorisation chez l'émetteur : le jeton de rafraîchissement
  reste chiffré sur le compte, inutilisé, jusqu'à un nouveau consentement qui le remplace.
- Les liens repris sont gardés en mémoire du processus : deux instances du serveur posent chacune leur demande.

## Questions ouvertes

- Discrimination du client tiers : le couple `invalid_grant` + « grant request is invalid » couvre aussi un client
  supprimé et une personne suspendue (le lien n'aboutit pas pour eux). Obtenir de Logto qu'il rende le détail, ou
  reconnaître les clients first-party autrement (liste déclarée), le rendrait exact.

## Historique

- 2026-11-23 : première version, PR 1 du chantier (échange de jeton RFC 8693, union des familles comme scope provisoire).
- 2026-11-23 : PR 2 du chantier : scope par fonction (lib v1.248.0, famille sans scope refusée à l'import), consentement
  OAuth d'un client tiers (compte `host_api`, lien d'autorisation dans le refus), discrimination du client tiers —
  décidé par Alexis (issue #153, commentaire du 22/11/2026).
- 2026-11-23 : tiré de `fonctions-d-un-hote.md` ; la demande de consentement encore ouverte est reprise au lieu d'en
  poser une à chaque refus — décidé par Alexis (source : revue de la PR 3 du chantier, 23/11/2026).
