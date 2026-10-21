# Dépôt par lien

- **Statut** : validé avec JB le 28/09/2026
- **Dernière révision** : 2026-10-13

## Résumé

Un assistant ne fait jamais passer un fichier par la conversation : `upload.link`, derrière `call`, rend un ticket à usage unique (15 minutes, un envoi) où Claude Code envoie le fichier par `curl` ; un assistant sans shell donne une adresse publique que le serveur télécharge, ou un formulaire de dépôt ouvert sous la session de la personne (D117, D130). La porte `POST /api/platform/uploads/<jeton>` est la seule porte sans session qui écrit : le ticket y tient lieu de jeton (ADR-018).

## Contexte

Claude Code doit pouvoir déposer un fichier qu'il a déjà (un fichier à joindre à une page, un `.md` à importer en page, un CSV à importer en tableau) sans le réécrire dans un appel MCP (D117, D137) : les six outils ne transportent que du texte (ADR-009). La commande `curl` qu'il lance n'a ni session ni jeton de l'émetteur, alors que toute porte du paquet vérifie un jeton (ADR-012, garde de portabilité de `CLAUDE.md § Projet`) ; la seule exception, les liens publics (ADR-013), ne fait que lire.

## Objectifs et non-objectifs

- Un fichier arrive sans passer par le modèle : aucun jeton de conversation, aucune coupure.
- Aucun outil MCP ni jeton de service ajouté (jetons de service : V2, fiche D6).
- Écrire au nom de la personne, à la destination fixée au lien, sous ses droits relus à l'envoi.
- Hors objectif : un fichier en base64 dans un argument (refusé par JB) ; une CLI du paquet ; plus de 1 Mo par la porte sans session (un fichier plus gros se joint à l'écran).

## Conception

### Le lien (ADR-018 § 1 et § 2)

- `upload.link`, connecteur `upload` (forme `<espace>.<verbe>` de `table.*`) (HN-E10S02-15), de classe `write`, pas `sensitive` : le dépôt ne fait rien d'autre qu'une écriture que `write` ferait (`catalog/define.ts` : « sensitive : envoie, supprime ou paie ») (HN-E10S02-20). Il n'est pas admis dans un bloc `call` de procédure : son `checkArgs` rend « upload.link is called by an assistant, not by a procedure » (HN-E10S02-23).
- Le ticket est créé sous une session vérifiée, pendant une conversation (`ctx`) : 32 octets aléatoires dont seule l'empreinte SHA-256 est gardée, lié à la personne, à l'organisation, au `ctx`, à la destination, au type et au mode ; 15 minutes, un envoi, 1 Mo par la route d'envoi, sous la coupure de Vercel à 4,5 Mo (HN-E10S02-16). Modes : `file` en `create` ou `attach`, `csv` en `create` ou `merge`, `md` ; `base_revision` exigée hors `create` ; tickets expirés supprimés à chaque `upload.link` (HN-E10S02-19). Table `upload_tickets` : [schéma](../reference/schema-platform.md).
- Le ticket porte deux jetons, gardés en empreinte : celui de `curl` (`token_hash`) et celui du formulaire (`form_token_hash`) ; chaque porte n'accepte que le sien (`consume_upload_ticket(p_org, p_hash, p_form)`), `used_at` commun : le premier consommé rend l'autre `not_found` (HN-E10S02-108, D147, ADR-018 § 8).
- `form_url` est rendu par chaque `upload.link`, pas seulement quand `source_url` échoue (HN-E10S02-96). `name` est facultatif pour `md` et `csv` : il nomme le fichier dans la provenance d'un CSV (« Importé de <nom> », défaut `upload.link`) et dans les commandes rendues (sinon `<file>`) (HN-E10S02-101).
- Le repli quand `curl` n'atteint pas la plateforme (un proxy répond 403, shell de claude.ai) ou sans shell : un `.md` par `write`, un CSV par `table.import`, un autre fichier par le formulaire (`form_url`) donné à la personne ; dit par une phrase ajoutée à la description d'`upload.link` (ADR-002 : allongée seulement, golden queries à rejouer), par la dernière ligne du lien et par le texte d'un téléchargement en échec ; aucun argument nouveau (HN-E10S02-119).
- RLS d'`upload_tickets` : lecture par un membre de ses tickets et des tickets expirés, insertion attribuée à l'appelant, suppression des seuls tickets expirés, aucune mise à jour, aucune clé vers `members` (HN-E10S02-105).

### La porte sans session (ADR-018 § 3 à § 6)

- `POST /api/platform/uploads/<jeton>`, branche avant le jeton de session, texte brut. Consommation par `platform.consume_upload_ticket(p_org, p_hash, p_form)`, `security definer` sous `anon`, bornée à l'empreinte du jeton de la porte appelante et à l'organisation de l'adresse ; elle marque le ticket consommé dans sa propre transaction, **avant** l'écriture, et rend la personne, son e-mail lu dans `members` et la destination.
- Refus avant consommation (ADR-018 § 5), qui ne consomment pas le ticket, pour qu'un fichier trop gros se corrige sans nouveau lien (HN-E10S02-21) : une autre méthode que `POST`, une requête qui porte `Origin` (un navigateur, ou un HTML vu dans la visionneuse qui connaîtrait le jeton), une forme de jeton invalide, un corps trop gros. Toute méthode est servie : hors `POST`, `forbidden` (403, texte brut « Only POST is accepted here: send the file with curl --data-binary, or use the form link. »), avant le jeton, sans base ; pas 405, absent de `PLATFORM_ERROR_CODES` (HN-E10S02-120).
- Textes : refus 1 « Requests from a browser are refused: send the file with curl, or use the form link. » ; une seule `not_found` « Unknown upload link: it may have expired (15 minutes) or already been used. Ask for a new link. » (jeton mal formé, ticket inconnu, expiré, servi ou d'une autre organisation, adresse sans organisation) ; 200 pour un envoi écrit (HN-E10S02-106).
- **Identité reconstruite, droits relus** (ADR-018 § 4) : l'appelant `{ userId, email }` vient du ticket, puis `identityInOrg(db, org, { userId, email })` relit l'appartenance sur l'organisation lue à l'adresse ; un e-mail absent vaut `""` ; `not_member` : « The person who asked for this link is no longer a member of <organisation>: nothing was written. » (HN-E10S02-97). Les droits se relisent comme pour toute requête (`security-patterns.md § Droits dans le service`) : un membre retiré ou un droit perdu entre le lien et l'envoi fait échouer l'envoi.
- `errorResponse`, `asPlatformError`, `addressOrigin` et `requireSameOrigin` vivent dans `api/session.ts`, lus par `handler.ts` et `api/uploads.ts` ; un refus de la route du formulaire ne porte plus `Cache-Control: private, no-store`, et une panne inattendue des deux routes du dépôt se journalise `[platform] api: unexpected error` (HN-E10S02-111). La porte à session vérifie la session en deux temps, `verifiedSession` (jeton, `verifyToken`, `verifiedCaller`, `createPlatformDb`) puis `sessionIdentity`, dans `api/session.ts` : dans `handlePlateforme`, l'origine d'une mutation, `cell` et le 404 d'une route inconnue passent entre les deux (HN-E10S02-84).

### L'écriture (ADR-018 § 4)

- Un fichier à joindre est envoyé par le serveur au stockage, par l'URL présignée du port, sous les contrôles d'une demande d'envoi ([fichiers et stockage](fichiers-et-stockage.md)). Fichier en `create` : page créée en brouillon, puis ligne et objet (`storeFile`), puis bloc `file` écrit sous la révision 0 et publié selon `publish` ; un échec après la création retire la page (HN-E10S02-117). En `attach`, le bloc s'écrit sous la `base_revision` du ticket, après le dernier bloc du document (`insert_after`, bloc structuré) (HN-E10S02-100).
- Retrait sur échec : sous le verrou de l'arbre (7301), une suppression bornée au nœud créé par l'envoi, jamais publié (révision 0), créé par la personne du ticket, sans bloc, sans sous-page ni fichier `ready` autre que celui que l'envoi vient de stocker ; ses lignes `files` partent dans la même instruction, leurs objets après le commit ; le message finit par « The page <chemin> it created was removed: ask for a new upload link and send it again. ». Une page qui a reçu autre chose, ou un retrait en panne (log serveur), reste : « … stays, as an unpublished draft: ask for an upload link with mode attach and base_revision 0 to send the file there. ». Le journal garde la ligne de l'envoi en erreur (HN-E10S02-117).
- Un envoi par le serveur en échec dit ce qui a manqué : « <nom> could not be stored: » puis « the file storage could not be reached » (signature, réseau, délai), « the file storage refused it (HTTP <statut>) », « the file storage did not keep it » (`HEAD` sans objet) ou « the file storage kept <n> bytes instead of <m> », puis « Nothing was attached. » ; code `conflict` ; la consigne posée par l'appelant (`writeFile`) : « Ask for a new upload link and send it again. » sur une page existante (HN-E10S02-116).
- Un `.md` déposé se lit en mode tolérant, avec la ligne « N elements kept as text. » (« 1 element kept as text. ») ; `write` reste strict (HN-E10S02-18, HN-E10S02-110). `WriteOrigin` (agent) gagne `file?: { replace }`, posé par le seul service du dépôt : provenance `agent` ; `replace` applique les opérations à une page vide ; `wholeFile` d'`applyOps` saute `SECTION_MAX`, `OP_TEXT_MAX` tenu par des morceaux de 40 000 caractères ; `PAGE_MAX` et `BLOCKS_MAX` restent (HN-E10S02-98). Le premier titre `#` d'un `.md` déposé est retiré de son corps (`readPageMarkdown`) ; le titre vient du ticket en `create` et ne change pas en `replace` ; un `.md` vide sous son titre est refusé (`invalid_arguments`) (HN-E10S02-99).
- Une page reçoit la provenance `agent` avec le `ctx` du ticket, un tableau la provenance `import` (HN-E10S02-22). Créer un tableau par import (`upload.link` `csv create`) n'exige que l'écriture sur le parent (D150) ; le bloc écrit après `complete` et celui du dépôt par lien sont publiés aussitôt, sauf `publish: false` (D135) (HN-E10S02-78).
- Un chemin pris rend `conflict` (`notAvailable`) : la porte MCP ne sert que le message (« Path … is not available: choose another path. »), le code va au journal (« conflict: … ») et à `curl` ; le contrat d'`upload.link` cite ce message avec son code (HN-E10S02-121).

### Téléchargement d'une adresse fournie (ADR-018 § 7)

- Pour un assistant sans shell (claude.ai, ChatGPT), `upload.link` accepte une adresse `https` publique que le serveur télécharge (D130). Avec `node.import_tree` ([transfert d'une arborescence](transfert-d-arborescence.md), 30 s et 25 Mo), ce sont les seules requêtes du paquet vers une adresse choisie par un appelant, toutes deux par `fetchSource` : schéma, port et adresse résolue contrôlés avant la requête et à chaque redirection (E10-S02 AC-f13), 10 s et 1 Mo au plus pour `upload.link` (`uploads-fetch.ts`, `readBounded`).
- Toute adresse IPv6 qui porte une IPv4 (mappée, NAT64, `::/96`, 6to4, Teredo) est refusée entière ; la résolution contrôlée est celle de la connexion (`lookup`), toutes les adresses rendues doivent être publiques ; une adresse IP écrite dans l'URL se contrôle avant la requête (HN-E10S02-104).
- Un `.md` ou un CSV n'est téléchargé que servi en `text/*` autre que `text/html`, en `application/octet-stream` ou sans type (`textSourceFailure`, paramètres ignorés) ; sinon un résultat d'échec qui nomme le type servi, le ticket libre pour le formulaire. Un `.md` dont le texte commence par `<!doctype html` ou `<html` (blancs de tête ignorés, sans casse) est refusé par toute porte (`invalid_arguments`, rien d'écrit) : le rendu échappait déjà ce HTML, le refus évite une page remplie du source d'un site (HN-E10S02-118).
- `source_url` est masquée au journal par son nom normalisé exact (`MASKED_NAMES`, `server/journal.ts`), ses voisines restant lisibles ; un téléchargement en échec est un résultat, pas `isError` : la cause sans l'adresse, et `form_url` (HN-E10S02-103).

### Le formulaire de dépôt (ADR-018 § 8)

- Une page de l'hôte, `/upload/<token>` sous `(dashboard)`, qui monte `EcranDeDepot`, et une route à session, `POST /api/platform/uploads/<jeton>/form`, servie avant la table de dispatch, sous le contrôle d'origine des mutations : le paquet impose ce chemin à l'hôte, comme `/n/<chemin>` que cite la réponse d'un envoi (D146, HN-E10S02-95). Le formulaire a son propre jeton ; un jeton de l'autre porte rend la même `not_found` qu'un ticket inconnu (D147).
- Après un refus qui a servi le lien, la zone de dépôt est retirée et une phrase dit que le lien ne sert plus (`DEPOT.clos`), focus à l'alerte ; elle reste pour un refus du réseau, un 401, un `internal` ou un fichier de plus de 1 Mo (HN-E10S02-109).
- Après un dépôt réussi, le formulaire ouvre l'adresse `url` que rend le dépôt (même origine, `/n/<chemin>` imposé par le paquet) après 1,5 s de lecture, par `useHote().naviguer` ; « Ouvrir la page » reste offert ; pas de `window.close()` (HN-E10S02-125). Un `html` ou `md` joint mène à sa visionneuse (`?view=<id>`, `adresseDeVue`) ; un `txt`, `csv` ou `pdf` joint, un `.md` importé en page et un CSV importé en tableau mènent à la page ; le message cite le chemin, pas le titre, que `UploadDone` ne porte pas (HN-E10S02-126).

### Journal

- L'envoi est journalisé sous le `ctx` du ticket, même après la fin de la conversation (HN-E10S02-17). La ligne s'écrit sous la session de la personne du ticket, après la réponse (`defer`) à la porte de `curl` ; une personne retirée : aucune ligne tentée, `console.error("[platform] uploads: …")` (HN-E10S02-102).
- « N with errors » compte les conversations qui ont au moins une erreur, pas les appels (`withErrors`, `journal-read.ts`) ; `last_at` est la dernière ligne du même code `ctx`, en UTC ; un appel sous un autre code ouvre une autre conversation ; les refus d'avant la consommation ne s'écrivent pas (aucune personne connue) ; un envoi par `source_url` refusé après la consommation écrit deux lignes en erreur, l'appel `call` et l'envoi `uploads` (HN-E10S02-122, FB-0014). Voir [journal et retours](journal-et-retours.md).

## Décisions et alternatives écartées

- **Commande CLI du paquet avec connexion OAuth de l'appareil** : une vraie session sans porte nouvelle, mais un outil à installer et un flux d'authentification de plus. Écartée par JB (D117 B).
- **Jetons de service personnels** : une preuve durable pour un besoin ponctuel, sujet V2 (fiche D6). Écartés.
- **Un seul jeton pour `curl` et le formulaire** : qui voyait l'adresse du formulaire écrivait par `curl` sans session, et la session exigée ne protégeait rien. Remplacé par deux jetons (D147).
- **Laisser en brouillon la page d'un envoi en échec** : remplacé par son retrait (HN-E10S02-117 remplace l'ancienne règle d'HN-E10S02-100).
- **Le fichier en base64 dans un argument** : refusé par JB (HN-E10S02-119).

## Sécurité et confidentialité

- Cet ADR amende ADR-012 § 3 et la garde de portabilité : la vérification du jeton de l'émetteur vaut sur chaque porte, **sauf** `uploads/<jeton>`, où le ticket en tient lieu ; la revue la traite comme une surface de sécurité à part.
- Canal qui reste ouvert (ADR-018 § 6) : quiconque voit le lien dans les 15 minutes (conversation partagée, journaux d'un outil ou d'un proxy) peut écrire une fois, à la destination prévue, au nom de la personne. Accepté sous la brièveté, l'usage unique, la destination fixée et le journal. Le jeton n'est jamais journalisé, et seule son empreinte est gardée.
- Le téléchargement d'une adresse fournie est la seule requête sortante choisie par un appelant : contrôle des adresses résolues à chaque redirection, contre la falsification de requêtes côté serveur.

## Écart avec le code

- M98 : le test d'expiration du ticket (`tests/integration/uploads.test.ts`) dépasse 900 000 ms d'une milliseconde quand l'horloge de la base avance sur celle du poste.

## Questions ouvertes

Aucune à ce jour.

## Historique

- 2026-09-28 : un ticket à usage unique peut écrire au nom d'une personne, sans session — décidé par JB pour le lien, par le pilote pour la porte (source : ADR-018, fiche D117).
- 2026-09-29 : téléchargement d'une adresse publique et formulaire de dépôt pour les assistants sans shell — décidé par JB (source : fiche D130, ADR-018 § 7 et § 8).
- 2026-09-29 : formulaire monté par une page de l'hôte, avec son propre jeton — option du pilote, approuvée à la revue (source : fiches D146, D147).
- 2026-09-30 : cause dite par cas quand le stockage échoue, page retirée sur échec, `.md` en HTML refusé, `forbidden` hors `POST`, repli sans `curl` — option du pilote (source : retours FB-0012 à FB-0014, HN-E10S02-115 à HN-E10S02-123).
- 2026-10-01 : refonte en document de conception vivant, qui reprend ADR-018, les fiches D117, D130, D146, D147 et les choix HN-E10S02 du dépôt — décidé par Alexis, accord de JB.
- 2026-10-13 : `node.import_tree` télécharge aussi une adresse choisie par l'appelant, par les mêmes gardes, à sa propre borne — décidé par JB (source : cahier des charges du transfert d'arborescence, session du 13/10/2026).
