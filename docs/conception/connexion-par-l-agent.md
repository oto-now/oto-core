# Connexion menée par l'agent

- **Statut** : proposé
- **Dernière révision** : 2026-11-24

## Résumé

Chaque refus de connecteur (connecteur éteint, aucun compte, compte à reconnecter, clé refusée par le tiers, compte
sans secret) porte une adresse finale, `<origine>/connect/<connecteur>?space=…[&account_id=<id>]`, et une phrase d'action ; `connector.connect` donne la même adresse sans
attendre un refus. La personne ouvre l'adresse et fait le seul geste humain : consentir chez le tiers, coller une clé,
brancher son compte, ou, administrateur, confirmer l'activation. Puis elle revient à son assistant. Le contrat suit
celui que la lib de connecteurs fixe pour oto.now et oto.cx (`docs/conception/refus-de-connexion.md` de
oto-now/connectors), aux écarts près que dit « Écart avec le code ».

## Contexte

Avant, un refus disait « connect it in the application (Connect my account) » ou renvoyait à
`/admin/connectors` : l'assistant ne pouvait pas mener la personne au geste, elle cherchait l'écran. Le refus d'une
fonction d'un hôte portait déjà un lien d'autorisation ([jeton](fonctions-d-un-hote-jeton.md)), mais c'était le lien
du tiers : il portait un `state`, expirait en dix minutes et posait une demande à chaque refus. Les parcours existants
restent la base : consentement `oauth2_user` (`startConnectorConsent`, `state` haché, dix minutes, usage unique,
PKCE), branchement hébergé (`startHostedLink`), saisie d'un compte (`FormulaireDAjout`), activation
(`POST admin/connectors/<nom>/activation`). Voir [connecteurs et comptes](connecteurs-et-comptes.md).

## Objectifs et non-objectifs

Objectifs :
- une adresse finale dans chaque refus de connecteur, la même pour un même geste ;
- un seul geste humain, sans écran intermédiaire, quand c'est permis ;
- la fonction `connector.connect` derrière `call`, sans outil MCP de plus (ADR-002).

Non-objectifs :
- notifier les administrateurs : l'assistant leur transmet l'adresse ;
- toucher l'écran Connecteurs ou ajouter une migration ;
- les crédits épuisés, qui se rachètent chez le tiers, hors de l'application ;
- un champ ou un réglage manquant d'un compte qui a déjà son secret (« has no <champ> yet », « setting … ») : ils
  gardent leur phrase.

## Conception

**Le refus.** Un seul constructeur, `connectRefusal` (`server/connectors/connect-link.ts`), sert les trois raisons et
tous les appelants : fonction d'un connecteur éteint (`calls.ts`), aucun compte (`account-refusals.ts`), consentement
ou branchement à reconnecter (`account-secret.ts`, `consent-accounts.ts`), API d'un hôte (`host-api/consent.ts`).
Il fait le plan (`planConnection`), puis bâtit le refus (`refusalFromPlan`) :

- code : `not_enabled`, toujours ;
- message : ce qui manque, puis les comptes partagés s'il y en a, puis la phrase d'action, qui se termine par
  `open <url>` : un assistant qui ne lit pas `details` relaie quand même le geste ;
- `details` : `reason` (`connector_off`, `no_account` ou `reconnect`), `gesture`, `connector`, `access` (s'il en a
  plusieurs), `space` (`me`, `org` ou `team:<slug>`), `url`, `administrators` (quand seul un administrateur peut
  agir, `[{name}]` : leurs noms seuls, jamais leur identifiant) et `shared_accounts`.

**Plusieurs accès.** Un connecteur à plusieurs accès ([connecteurs et comptes](connecteurs-et-comptes.md) § Plusieurs
accès) se connecte toujours par un accès nommé, le geste étant celui de cet accès : `oauth` pour une connexion
`oauth2_user`, `key` pour une clé, `hosted_link` pour un compte rattaché. Le compte qui en naît retient l'accès.
- Le refus sans compte (`no_account`) n'a qu'un accès dans `details` (contrat de la lib, schéma fermé) : celui à
  consentement, que la personne fait elle-même, sinon le premier déclaré (`connectAccess`). Son message nomme les
  autres avant la phrase d'action (« Crm also opens by another access, key (Key of the organization), which the link
  offers too. »), et la page de son adresse les offre (`accessChoices`). Un compte à reconnecter ou à doter d'une clé
  garde son accès, et un connecteur éteint attend l'activation, commune à tous les accès : leur refus ne nomme pas
  d'autre accès.
- `connector.connect` exige l'accès, comme l'exécution : l'agent choisit d'après la demande de la personne.

**La clé d'un compte existant.** Une clé refusée par le tiers et un compte créé sans secret visent un compte précis :
l'adresse le nomme, et la page y ouvre la saisie de sa clé, pas la création d'un autre compte. `planAccountKey` en fait
le plan, `accountKeyRefusal` le refus (`connect-link.ts`) :
- geste `key` ; espace : celui du compte (`me` pour un compte personnel, vu par sa personne, `org`, `team:<slug>`) ;
  adresse `…?space=…[&access=…]&account_id=<id>` ;
- qui agit : la personne si elle gère le compte (`ACCOUNT_LEVELS.manage`) ; sinon qui le gère, nommé dans la phrase
  (« Only Léa Petit | the administrators of Acme (Ada Martin) | team Ventes (lead: Claire Morel) can set the key of
  account « … »; … open URL »), et `administrators` pour un compte de l'organisation ;
- `reason` : `reconnect` pour une clé refusée, `no_account` pour un compte sans secret (aucun compte utilisable).

**Les refus de marque** (`account-marker.ts`, `markRefusal`). Le refus du tiers qui marque le compte pose la marque,
puis devient, à l'appel :
- clé refusée (`credential_rejected`) d'un compte à clé : `not_enabled`, `reason: reconnect`, geste `key`, l'adresse de
  la clé du compte ; le message garde le refus du tiers et la marque (« Crm refused the key. (key_rejected) Account « … »
  is marked: key refused since … UTC. Ask the user to paste … open URL ») ;
- clé refusée d'un consentement ou d'un compte rattaché : `not_enabled`, `reason: reconnect`, geste `oauth` ou
  `hosted_link` (`connectRefusal`) ;
- clé refusée de l'hôte (un compte sans champ à lui) : le refus du tiers (`credential_rejected`), « ask whoever runs
  this application to check it » ; personne dans l'organisation n'a de geste ;
- crédits épuisés (`quota_exhausted`) : le refus du tiers, sans adresse, « Ask <qui gère le compte> to add credits. ».
  Ce n'est pas un refus de connexion : aucun geste dans l'application ne le lève, et la lib ne déclare aucune page du
  fournisseur (ni facturation, ni console) vers laquelle mener la personne.

La sonde de l'écran Connecteurs (`liveCredential(…, "probe")`) garde le refus du tiers, qu'elle classe par son code
(`credential_rejected`) devant qui gère déjà le compte. Un compte sans secret y rend le refus de connexion
(`account_not_ready`).

**Le plan.** `planConnection` décide trois choses, sous l'identité de l'appelant.
- Le geste. `oauth` pour un accès `user_consent` ou l'API d'un hôte, `hosted_link` pour un accès à identité rattachée,
  `key` sinon. Un connecteur fermé par un administrateur, ou jamais ouvert (pour un geste autre que la clé), devient
  `admin_activation`. Créer un compte à clé ouvre déjà le connecteur.
- L'espace. Un espace demandé est vérifié : types de propriétaire du connecteur, limite de l'hôte
  (`account_owner_kinds`) et droit de créer (`mayCreateAccountFor`). Un espace refusé l'est nommément (`forbidden`),
  une équipe inconnue est `not_found`. Sans espace demandé, l'espace par défaut est soi pour un consentement, sinon
  l'organisation pour un administrateur, puis l'équipe qu'on dirige, puis soi.
- Qui agit. La personne, si elle peut faire le geste. Sinon, les administrateurs, nommés, à qui elle transmet
  l'adresse.

**L'adresse.** `<origine>/connect/<connecteur>?space=…[&access=…][&activate=1 | &account_id=<id>]`. Elle est stable et
n'expire pas. Elle ne porte aucun secret : ni `state`, ni code, ni client ; l'identifiant d'un compte n'en est pas un. L'origine est celle de la requête, reconnue pour
l'organisation. Sans origine utilisable (absente, avec un chemin, autre que http(s)), le refus est une erreur de
configuration (`internal`) : « The public address of this organisation is not known… ». Il n'y a jamais de repli sur
une adresse relative.

**La phrase d'action**, une par cas (`actionSentence`), toujours terminée par l'adresse :
- la personne agit : « Ask the user to authorize X | paste the X key | add the X account | link their X account |
  confirm the activation of X and connect an account, then call again: open URL » ;
- un autre agit : « Only an administrator of ORG (names) can do it; ask the user to pass them the link and call again
  once it is done: open URL », ou, pour un compte partagé, « Only its owner, NAME, can connect it again; … ».

**La page** (`src/app/(dashboard)/connect/[connector]/page.tsx`, écran `EcranConnexionDUnConnecteur`, étape
`connectionStep` dans `server/connectors/connect-page.ts`).
- Sans session, la page renvoie à la connexion, avec retour sur la même adresse. Hors de l'organisation de
  l'adresse, elle renvoie à `/no-organization`.
- Le plan est refait sous la session. L'ouverture (un GET) ne pose rien, n'appelle pas le tiers et n'écrit rien.
- Consentement ou branchement sur un espace permis : un seul bouton (« Autoriser X », « Connecter mon compte X »). Son
  clic envoie un `POST` de même origine (`connector-consent` ou `hosted-link`, origine contrôlée par
  `requireSameOrigin`), qui pose la demande, puis le navigateur part chez le tiers. Le parcours reste un clic, puis le
  geste chez le tiers. Le retour revient sur la page, avec son issue.
- Compte hébergé déjà relié dans une autre organisation de la personne : la page le dit avant le clic (« Votre compte X
  est déjà utilisé dans ORG. Le bouton le relie aussi à cette organisation. », « Relier mon compte X ») ; seul ce `POST`
  le relie. Toute organisation hors de la courante où le compte est relié compte (`hostedLinkedElsewhere`, sur
  `my_hosted_accounts`), celle que la personne a quittée comprise : elle n'en lit plus le nom (RLS de `orgs`), la page
  dit « une autre organisation ».
- Clé : le formulaire du compte, l'espace et l'équipe posés.
- Clé d'un compte existant (`account_id`) : le formulaire de la clé et des réglages du détail du compte
  (`FormulaireDeLaCle`), réservé à qui gère le compte (`forbidden` sinon, qui dit qui le gère). L'adresse est revérifiée
  contre le compte : son connecteur, son accès, son espace ; un compte qui ne prend pas de clé, ou `activate` avec
  `account_id`, sont refusés nommément (`invalid_arguments`). L'envoi passe par `setAccountSecret`, qui revérifie.
- Connecteur à plusieurs accès, adresse sans accès (hors `activate`) : la page fait choisir (`choose_access`), chaque
  accès un lien vers la même page qui le nomme (`?access=<nom>`, avec l'espace de l'adresse quand elle en nomme un ;
  sans lui, l'espace choisi ensuite selon l'accès), avec son libellé et son geste ; aucun accès n'est pris à la place de
  la personne. Le choix ne se sert qu'après les contrôles du plan de chaque accès (`planConnection`) : un connecteur
  inconnu ou natif est refusé comme sans choix, un espace nommé qu'aucun accès ne permet est refusé (`forbidden`), et un
  accès qu'il ne permet pas n'est pas offert. Adresse avec un accès : son étape, et les autres accès offerts de même
  (`others`, l'espace nommé gardé), sauf à l'activation. Rien n'en est cru : l'accès revient par l'adresse, revérifié
  (`requestedAccess`).
- Activation : un bouton qui confirme. Rien ne s'active à l'ouverture.
- Une autre personne doit agir : l'adresse à copier et les administrateurs.
- L'issue d'un retour s'affiche sans rien relancer et sans croire l'adresse. Réussi : « Le compte est connecté. Vous
  pouvez revenir à votre assistant et lui demander de reprendre. », sans le nom que porte l'adresse. Échoué : la phrase
  de la raison si elle est connue (`echecDuConsentement`, la liste de l'écran Connecteurs), sinon une phrase générique,
  et « Réessayer ».

**La fonction** `connector.connect {connector, space?, access?}` (contrat `server/catalog/connector-connect.ts`, logique
`server/connectors/connect-function.ts`, chargée à l'appel pour ne pas créer de cycle d'imports avec le registre) :
connecteur natif `connector`, classe `read`,
toujours active. Elle suit le même plan et dit la même phrase. Elle rend `{url, gesture, connector, access?, space, by,
administrators?}`. Quand un compte marche déjà dans l'espace (actif, sans marque, pour l'accès du plan, sa personne
présente), elle rend `{gesture: "none", connector, access?, space, account}` sans adresse ; `account` a la forme du compte
des données d'un appel, `{id, label, mode, owner}`, `owner` valant `{kind: "org" | "team", description}` ou `{kind:
"user", name, yours}` : sans l'identifiant de la personne, qu'aucune sortie servie à un client MCP ne porte (contrat de
la lib, oto-now/connectors#288). Les données d'un appel le gardent (`CallAccountOwner`) : le journal en lit qui a prêté
le compte. `access` est exigé pour un connecteur à plusieurs accès, refusé sinon. `find` la trouve par « connecter fod » ou « activer un connecteur ». Une procédure ne l'appelle
pas : l'adresse va à une personne.

## Décisions et alternatives écartées

- **Adresse stable plutôt que lien du tiers à usage unique.** Mettre le lien d'autorisation dans le refus posait une
  demande à chaque refus, exposait le `state` dans la conversation et expirait avant que la personne ne lise.
  Le cache des liens et `consentStillOpen` sont retirés.
- **Redirection immédiate au GET, abandonnée pour raison de CSRF.** La page partait chez le tiers dès l'ouverture, la
  demande posée. Un lien forgé, ou une navigation de premier niveau depuis un autre site (cookie `lax`), forçait alors
  un consentement chez un fournisseur qui approuve sans écran, ou reliait sans geste un compte hébergé déjà utilisé dans
  une autre organisation ; chaque GET écrivait une demande. Le départ passe par un bouton et un `POST` de même origine.
  `Sec-Fetch-Site` ne suffit pas comme garde : le lien arrive souvent d'une autre application, donc d'un autre site.
- **Activation par bouton, jamais à l'ouverture.** Un lien transmis ou prérendu ne doit rien changer.
- **Un seul code, `not_enabled`.** Un nouveau code aurait cassé les clients qui le lisent ; la raison va dans
  `details.reason`. `host_consent_required` devient `no_account` ou `reconnect`, avec `gesture: oauth`.
- **Pas de notification aux administrateurs.** C'est la personne qui transmet l'adresse.

## Sécurité et confidentialité

- L'adresse ne porte aucun secret : connecteur, espace, accès, `activate`. Le `state` du consentement (256 bits, haché
  en base, dix minutes, usage unique, lié à la personne, l'organisation et le connecteur, avec PKCE) n'est créé qu'au
  clic du bouton, par un `POST` de même origine d'une session connectée, jamais à l'ouverture ni dans un refus.
- Le compte de l'adresse n'est jamais cru : la page le relit sous la session, réservé à qui le gère ; un compte
  invisible est introuvable (`not_found`).
- L'espace de l'adresse n'est jamais cru.
  - Il est revérifié à l'affichage (`planConnection`), puis à l'envoi par le service de création de compte.
  - Un espace non permis est un refus nommé.
  - Une équipe d'une autre organisation est introuvable, car l'identité est celle de l'organisation de l'adresse.
- Rien ne part ni ne s'écrit au GET : consentement, branchement, relier un compte hébergé d'une autre organisation et
  activation passent chacun par un `POST` de même origine sous session (l'activation, réservée aux administrateurs par
  sa route).
- L'issue du retour ne reprend aucun texte de l'adresse : raison par liste blanche, succès sans nom de compte.
- `administrators` ne porte que des noms.
- Le retour du tiers ne peut ramener que sur un chemin local (`return_to` validé par le parcours de consentement).

## Écart avec le code

- Gardent leur phrase, sans adresse : les crédits épuisés, la clé de l'hôte refusée, et un champ ou un réglage manquant
  d'un compte qui a déjà son secret.
- Une clé refusée, à l'appel, ne rend plus le code `credential_rejected` mais `not_enabled` : le contrat met le compte
  marqué sous `reconnect`. La sonde le garde.
- Écarts au contrat commun de la lib : l'espace d'équipe s'écrit `team:<slug>` (le contrat dit `team:<id>` ; son motif
  admet les deux) ; une origine `http` est admise (poste local), le contrat demande `https` ; `connector.connect` rend
  en plus `connector`, `access` et `by` ; l'API d'un hôte (`host_api`), qui demande un consentement pour un client
  tiers, sert `gesture: oauth`, là où le contrat ne prévoit aucun geste pour `host_delegated` ; un refus de connecteur
  sans compte, à plusieurs accès, prend l'accès à consentement par défaut et nomme les autres dans son seul message ; l'adresse de la clé d'un compte existant
  porte `account_id=<id>`, que le contrat ne prévoit pas ; un compte sans secret est `no_account` (le contrat ne dit pas
  ce cas) ; pour un compte d'équipe que la personne ne gère pas, les responsables de l'équipe peuvent agir, mais
  `details` n'a que `administrators` : ils ne sont nommés que dans la phrase, et `administrators` est absent ; pour un
  compte personnel d'une autre personne, sa personne n'est nommée que dans la phrase.
- `shared_accounts` : éléments `{id, label, owner, description}`, `owner` étant le nom de la personne qui partage.
- Un hôte qui déclare sa surface (`registerHostSurface`) doit y nommer `connector.connect` pour la servir.

## Questions ouvertes

- Un refus sans compte d'un connecteur à plusieurs accès : faut-il porter tous les accès dans `details` (une liste
  `accesses: [{name, gesture, url}]`) ? Le schéma de la lib est fermé ; seul le message les nomme aujourd'hui.

- Les crédits épuisés : la lib pourrait déclarer la page du fournisseur où les racheter ; le refus la porterait alors,
  hors du contrat `not_enabled`.
- Un champ ou un réglage manquant d'un compte qui a déjà son secret : mener à la même saisie (`account_id=<id>`) ?

## Historique

Document proposé ; Git suffit tant qu'il n'est pas validé.
