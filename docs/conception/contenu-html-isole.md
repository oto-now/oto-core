# Contenu HTML isolé et lecture des fichiers

- **Statut** : validé avec JB le 30/09/2026
- **Dernière révision** : 2026-10-01

## Résumé

Un fichier HTML, `.md` ou PDF est un fichier joint à une page, jamais un bloc rendu dans la page (D137). « Voir » ouvre une visionneuse à l'adresse du contenu : un HTML s'y exécute dans un iframe `sandbox` sans `allow-same-origin`, sur une origine opaque, servi par une route du paquet qui pose sa propre politique de sécurité (ADR-017) ; un `.md` s'y rend en blocs, un PDF dans le lecteur du navigateur. Un assistant lit le texte d'un fichier par `read {file}` (D119).

## Contexte

JB veut déposer une page HTML (un rapport, une petite application générés par Claude Code) et la voir comme un artefact de Claude. Voir ce fichier, c'est exécuter les scripts de son auteur dans le navigateur de chaque lecteur, sous le domaine de l'organisation : sans isolation, lecture de la session et appel de l'API au nom du lecteur, faux formulaire de connexion sur un domaine de confiance, envoi vers l'extérieur de ce que le lecteur saisit. La règle existante interdit déjà de servir un dépôt en `text/html` depuis l'origine de l'application (`uploads-patterns.md § Validation`), et le bucket sert un `html` en `attachment` (ADR-016 § 5, [fichiers et stockage](fichiers-et-stockage.md)).

## Objectifs et non-objectifs

- Le code de l'auteur ne lit rien de l'hôte : ni session, ni stockage, ni API.
- Droits, versions, partage et arbre viennent de la page qui porte le fichier ; la page garde son texte autour.
- Chaque canal de sortie est nommé et testé, ouvert ou fermé.
- Hors objectif : un HTML qui appelle une API extérieure (`connect-src 'none'`) ou charge une image par adresse `https` ; un HTML qui suit le thème de l'organisation ; un HTML vu dans la page elle-même ; un fichier HTML de plus de 4 Mo ; l'aperçu des documents bureautiques (épic E10).

## Conception

### La visionneuse (ADR-017 § 1, § 3)

- « Voir » (icône œil) ouvre la visionneuse à `?view=<id>` : un en-tête hors du contenu, la bannière, puis un iframe qui occupe la hauteur de la fenêtre. La visionneuse vit à l'adresse du contenu, dans l'organisation comme en public : aucune route de l'hôte ajoutée (`/p/<jeton>/files/…` serait pris pour un chemin) (HN-E10S02-10). « Voir » d'un `html` ou d'un `md` mène à `?view=<id>`, relatif à l'adresse où l'on est (`/n/…` comme `/p/<jeton>/…`) (HN-E10S02-44).
- `?view` vaut sur tout nœud qu'on lit sauf un tableau ; illisible ou répété, il vaut un identifiant vide : « Fichier introuvable », jamais l'écran du nœud (`fileViewParamSchema`) (HN-E10S02-59).
- « Voir » d'un PDF, d'un `txt` ou d'un `csv` ouvre le fichier `inline` depuis l'origine du bucket, jamais de l'hôte : la règle d'ADR-016 § 5 tient (HN-E10S02-5). Une image reste rendue dans la page (D137).
- **Aucun message entre l'iframe et l'écran** : l'iframe a la hauteur de la fenêtre, sans script de hauteur (HN-E10S02-11). Elle ne se monte qu'après l'hydratation (`useSyncExternalStore`) : un second chargement est une navigation de son contenu (O1) ; « Recharger » monte une iframe neuve (HN-E10S02-61), et le focus va à l'iframe neuve ; l'avis vit dans une région `role="alert"` montée vide avec l'iframe, l'`Alert` en `role="presentation"` (HN-E10S02-83).
- Un `.md` se rend en blocs ; un `.md` que l'analyse tolérante ne sait pas garder en blocs se montre entier en un bloc de code, sans phrase de plus (HN-E10S02-57). La visionneuse d'un `html` ne lit pas l'objet : un `html` hors UTF-8 se dit dans l'iframe, en texte brut de la route ; « Ce fichier n'est pas en UTF-8 : téléchargez-le. » vaut pour un `.md` (raison `not_utf8` d'`objectText`) (HN-E10S02-58).
- Bannière : une `Alert` en `role="note"` ; en public elle nomme la marque de l'adresse (`nomAffiche`), sinon « l'organisation » ; la visionneuse en échec se titre « Fichier », introuvable « Fichier introuvable » (HN-E10S02-63).

### La route isolée (ADR-017 § 1)

- L'iframe charge `GET /api/platform/files/<id>/html`, servie par une branche avant la table de dispatch, qui lit le fichier dans le bucket par le serveur ; jamais `srcdoc`, qui hériterait de la politique et de l'origine de la page parente. Un fichier texte (`html`, `md`, `txt`, `csv`) fait 4 Mo au plus, puisque la route HTML et `read {file}` le lisent par le serveur, sous la coupure de Vercel à 4,5 Mo (HN-E10S02-9).
- Contrôles : la route d'une personne connectée vérifie le jeton de session, l'identité, puis `Sec-Fetch-Dest` et le fichier (`fileHtml`) ; sans session, 401 même hors iframe ; une requête dont `Sec-Fetch-Dest` est présent et différent de `iframe` reçoit `not_found` : le fichier ne s'ouvre jamais en onglet sans bannière ; un navigateur qui n'envoie pas l'en-tête est servi (HN-E10S02-12). Toute erreur se sert `<code>: <message>` en `text/plain; charset=utf-8` aux autres en-têtes ; tout refus de lecture est `not_found: Unknown file.` (`not_found: Not found.` par un lien public) (HN-E10S02-60).
- Réponse : `Content-Type: text/html; charset=utf-8` ; `Content-Security-Policy: sandbox allow-scripts allow-popups allow-forms; default-src 'none'; script-src 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'` (les CDN admis sont ceux des artefacts de Claude) ; `X-Content-Type-Options: nosniff` ; `Referrer-Policy: no-referrer` ; `Cache-Control: private, no-store`.
- Iframe : `sandbox="allow-scripts allow-popups allow-forms"`, **sans `allow-same-origin`**, et `referrerpolicy="no-referrer"`. L'origine est opaque. `allow-forms` laisse tourner un `onsubmit`, l'envoi réel reste bloqué par `form-action 'none'` (HN-E10S02-12).
- Hôte : il exclut de ses en-têtes globaux (`X-Frame-Options`, `Referrer-Policy`) les deux routes HTML (README du paquet). L'hôte de référence pose `nosniff` et `Permissions-Policy` partout, `X-Frame-Options` et sa `Referrer-Policy` partout sauf les deux routes HTML (source à lecture anticipée négative de `next.config.ts`) (HN-E10S02-64).

### Canaux de sortie (ADR-017 § 2)

- **Fermés** (F1 à F16 de la story E10-S02, AC-c6) : requêtes d'un script (`fetch`, XHR, WebSocket, EventSource, `sendBeacon`), cookies, stockage, document parent, ressources extérieures (images, CSS, polices), envoi de formulaire, cadres imbriqués, workers `blob:`, navigation de l'onglet, téléchargement, `<base>`, ouverture hors iframe, fenêtres ouvertes (le `sandbox` s'y hérite), messages à l'écran, envoi vers la route de dépôt.
- **Ouverts, acceptés** (O1 à O7) : navigation de l'iframe elle-même (`location`, `meta refresh`), que l'écran voit par un second chargement et remplace par « Ce contenu a tenté de quitter la page », la requête déjà partie ; navigation vers une adresse qui répond 204, invisible ; fenêtre ouverte sur un clic (`allow-popups`, pour les liens d'un rapport) ; résolution DNS par `dns-prefetch` et `preconnect` ; WebRTC (serveurs STUN) ; les trois CDN admis, qui reçoivent l'IP du lecteur ; O7 : vu par un lien public, le script lit le jeton du lien dans `location` et peut l'envoyer en naviguant (O1) ; ce jeton ne donne que ce que le lien sert déjà, et seul un rédacteur de la page peut y joindre un tel script, sous la bannière (HN-E10S02-86).
- La spec e2e d'AC-c6 (`e10s02-voir`) dépose ses fichiers par les routes du paquet et se saute quand le serveur n'a pas de stockage (`GET files` → `enabled: false`) (HN-E10S02-66).

### Partage public (ADR-017 § 4 et § 5)

- La règle des contenus s'applique (D135) : un fichier joint n'est servi par un lien public que s'il est cité par un bloc publié (ADR-016 § 7). Partager la page partage ses fichiers (D137).
- Un HTML se voit aussi par un lien public, sous la même isolation qu'à l'intérieur, avec la bannière hors de l'iframe (D112) : `GET /api/platform/public/<jeton>/files/<id>/html`, sans fichier de l'hôte, par `platform.public_file_by_token` sous `anon` : seulement un fichier cité par un bloc publié du périmètre partagé, mêmes en-têtes, même `sandbox`, même règle `Sec-Fetch-Dest`, plus `X-Robots-Tag: noindex, nofollow`. Créer un lien exige déjà « Accès complet » sur le nœud (ADR-013 § 2). La bannière, au-dessus de l'iframe et hors de portée de ses scripts : « Contenu interactif publié par <nom de l'organisation>. N'y saisissez jamais de mot de passe. » ; elle s'affiche aussi dans l'organisation.
- `public_file_by_token` rend `id`, `name`, `mime`, `size` et `node_path`, jamais la clé (composée par `objectKey`) ; un fichier est servi s'il est cité par un bloc publié `file` ou `image` de son nœud (HN-E10S02-56). `GET public/<jeton>/files/<id>` (302, `PUBLIC_HEADERS`) et les routes d'un lien sur la page publique (`routeDesFichiers` : image, « Voir », « Télécharger ») sont livrés avec « Voir » (HN-E10S02-55).
- Sur la page publique, la carte d'un fichier ne relit pas sa disponibilité (`?check` exige une session) ; seule l'`onError` d'une image y dit « Fichier indisponible » (HN-E10S02-62). Les liens internes d'un `.md` vu par un lien public se lisent en texte : aucun n'est dans `links` du lien (HN-E10S02-65). Le `.md` téléchargé d'une page publique (`pageMarkdown`) cite ses fichiers par la route relative d'une session (HN-E10S02-81).

### Côté assistant (ADR-017 § 6)

- `read` d'une page montre un fichier comme tout fichier joint (nom, taille, type, lien), jamais son contenu (NFR-CONC-01) ; `find` le trouve par son nom ; `write` n'écrit pas de fichier (HN-E10S02-14) : un assistant dépose par le lien à usage unique ([dépôt par lien](depot-par-lien.md)).
- Un fichier se rend `[<nom> (<taille>, <type>)](<route>/<id>)` : nom tel quel, taille en octets exacts (`fileSizeText` : « 1,200 bytes », « 1 byte »), type par l'extension (le `mime` de la ligne sans extension admise) ; `parseMarkdown` relit la ligne de droite à gauche (dernière `](`, dernière ` (`) (HN-E10S02-67).
- L'adresse servie à l'assistant est absolue, sur l'origine de la requête MCP (`requestOrigin`, `server/identity.ts`), qu'un humain peut ouvrir (HN-E10S02-3) : `<origine>` est celle de la porte MCP (`McpDeps.origin`, lue par `webUrl`), sinon la route relative ; seul `read` la reçoit : `context`, `staleState`, le `.md` d'une page et la visionneuse servent la route relative, que `parseMarkdown` relit aussi (HN-E10S02-68). Hors de `read`, le markdown d'un fichier cite la route relative (`filePath`, `schemas/files.ts`) (HN-E10S02-45).
- Une ligne seule `[<étiquette>](<origine facultative>/api/platform/files/<uuid>)` est un bloc `file`, en strict comme en tolérant, uuid en minuscules ; une étiquette hors forme donne nom = étiquette, taille 1, `application/octet-stream`, que la ligne relue remplace ; un lien public ou d'une sous-route reste un paragraphe (HN-E10S02-69).
- `read` gagne un champ facultatif `file`, l'identifiant d'un fichier joint, qui sert le texte d'un `html`, `md`, `txt` ou `csv` de la page ; `read` d'une page n'en sert que le lien (D119, ajout admis par ADR-002). Il sert sous le droit de lecture du nœud de `path`, exclusif de `section`, `outline`, `since_revision` et `draft` (HN-E10S02-13) : avec l'un d'eux, « Give only one of section, outline, since_revision or file; file reads the text of a file, without draft. » ; `refs` ignoré ; en-tête `<nom> (<taille>)`, données `{ path, file: { id, name, size, type } }`, sans `next_actions` ; tout nœud visible, publié ou non ; `file` n'entre dans la clé du curseur que donné (HN-E10S02-75). Il contrôle le curseur avant de lire l'objet, dans sa seule branche (HN-E10S02-85).
- **Contenu retenu par l'hôte** : `registerDataPolicy({ fileContents: "metadata" })` de `/server`, ou une fonction de l'organisation (`({ id, slug }) => "served" | "metadata"`, synchrone ou non), retient le contenu des fichiers joints : `read {path, file}` refuse avant toute lecture de l'objet (`forbidden`, raison `file_contents_withheld`, « The contents of files are not served to assistants at <organisation>: only their name, size and type, shown in <chemin>. Ask the user to open the file. ») ; nom, taille et type restent dans la page. Sans politique, `served`, comme avant. Une fonction de l'hôte qui lève ou rend autre chose fait refuser la lecture (`internal`, cause au log) : jamais servi par défaut ([pseudonymisation](pseudonymisation.md) § Les quatre primitives).
- La description de `read` finit par « To read an attached html, md, txt or csv file, give file = the id from its link /api/platform/files/<id>. » (HN-E10S02-76). `readFileText` dit « only html, md, txt and csv files are read as text. » ; le refus de taille garde « a text file (html, md, txt, csv) » (HN-E10S02-77).

## Décisions et alternatives écartées

- **Bloc `html` rendu dans la page** (une page « artefact » à un seul bloc, source en base, écrite par `write`) : demandait un type de bloc, une règle d'un bloc par page, une clôture dans `write` et un extrait dans `read`, pour un usage que « Voir » couvre. Écarté par JB (D137), avec la fusion des stories E10-S02, E10-S03 et E10-S05.
- **Type de nœud `html`** : modifiait ADR-011 § 1, `nodes_guard`, le routage et les écrans du nœud, sans comportement que le fichier n'ait pas. Écarté par JB.
- **Servir le fichier depuis le bucket** : le bucket ne pose ni CSP ni `sandbox`, et son origine peut être celle du fournisseur d'authentification. Écarté : `html` y reste en `attachment`.
- **`srcdoc` avec une politique en `<meta>`** : le document hérite de la politique de la page parente, et `<meta>` ne porte ni `sandbox` ni `frame-ancestors`. Écarté.
- **Origine séparée (sous-domaine des contenus)** : l'isolation la plus forte, mais un domaine de plus par hôte, contraire à ADR-001. À revoir si un besoin de `allow-same-origin` apparaît.

## Sécurité et confidentialité

- Le risque qui reste est celui d'un auteur malveillant qui peut écrire dans la page : sept canaux ouverts (O1 à O7), traités par la bannière et le journal. La politique de sécurité est validée à la main : chaque ligne a été relue à la revue d'E10-S02.
- Le jeton d'un lien public, lisible par le script (O7), ne donne que ce que le lien sert déjà.

## Écart avec le code

- M88 : la spec d'isolation du HTML (`tests/e2e/e10s02-voir.spec.ts`, F1 à F16, O1 à O7) ne tourne pas en CI, faute de stockage.
- M103 : à 375 px, l'en-tête de la visionneuse (« Télécharger » + « Ouvrir la page … ») ne passe pas à la ligne et fait défiler la zone de contenu en largeur.

## Questions ouvertes

Aucune à ce jour.

## Historique

- 2026-09-28 : rendu isolé dans un iframe `sandbox`, route du paquet, canaux nommés — décidé par JB pour la forme du contenu, par le pilote pour l'isolation (source : ADR-017, fiche D111).
- 2026-09-28 : un HTML se voit aussi par un lien public, sous bannière — décidé par JB (source : fiche D112).
- 2026-09-29 : un HTML est un fichier joint, « Voir » dans un nouvel onglet, plus de bloc `html` ; `read {file}` — décidé par JB (source : fiches D137, D119, ADR-017 amendé).
- 2026-09-30 : canal O7 nommé (jeton d'un lien public lisible par le script) — option du pilote (source : ADR-017 § 2, HN-E10S02-86).
- 2026-10-01 : refonte en document de conception vivant, qui reprend ADR-017, les fiches D112, D119, D137 et les choix HN-E10S02 de la visionneuse et de la lecture — décidé par Alexis, accord de JB.
- 2026-10-19 : contenu des fichiers retenu par l'hôte (`registerDataPolicy({ fileContents })`), `read {file}` refusé, nom, taille et type servis — décidé par Alexis (pseudonymisation, J1).
