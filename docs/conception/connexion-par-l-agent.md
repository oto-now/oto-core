# Connexion menée par l'agent

- **Statut** : proposé
- **Dernière révision** : 2026-11-24

## Résumé

Chaque refus de connecteur (connecteur éteint, aucun compte, compte à reconnecter) porte une adresse finale,
`<origine>/connect/<connecteur>?space=…`, et une phrase d'action ; `connector.connect` donne la même adresse sans
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
- les refus de marque (clé refusée, crédits épuisés) et ceux d'un champ manquant, qui ne sont pas un geste de
  connexion.

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

**L'adresse.** `<origine>/connect/<connecteur>?space=…[&access=…][&activate=1]`. Elle est stable et n'expire pas.
Elle ne porte aucun secret : ni `state`, ni code, ni client. L'origine est celle de la requête, reconnue pour
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
  le relie.
- Clé : le formulaire du compte, l'espace et l'équipe posés.
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
des données d'un appel : `{id, label, mode, owner}`, `owner` valant `{kind: "org" | "team", description}` ou `{kind:
"user", userId, name, yours}`. `access` est exigé pour un connecteur à plusieurs accès, refusé sinon. `find` la trouve par « connecter fod » ou « activer un connecteur ». Une procédure ne l'appelle
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

- Les refus de marque (`credential_rejected`, crédits) et ceux d'un champ manquant (« has no secret yet ») gardent
  leur phrase : ils ne portent pas encore d'adresse.
- Écarts au contrat commun de la lib : l'espace d'équipe s'écrit `team:<slug>` (le contrat dit `team:<id>` ; son motif
  admet les deux) ; une origine `http` est admise (poste local), le contrat demande `https` ; `connector.connect` rend
  en plus `connector`, `access` et `by` ; l'API d'un hôte (`host_api`), qui demande un consentement pour un client
  tiers, sert `gesture: oauth`, là où le contrat ne prévoit aucun geste pour `host_delegated` ; un refus de connecteur
  sans compte, à plusieurs accès, prend l'accès à consentement par défaut.
- `shared_accounts` : éléments `{id, label, owner, description}`, `owner` étant le nom de la personne qui partage.
- Un hôte qui déclare sa surface (`registerHostSurface`) doit y nommer `connector.connect` pour la servir.

## Questions ouvertes

- Les refus de marque doivent-ils porter l'adresse de la saisie d'une nouvelle clé ?

## Historique

Document proposé ; Git suffit tant qu'il n'est pas validé.
