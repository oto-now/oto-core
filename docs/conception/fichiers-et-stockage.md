# Fichiers et stockage

- **Statut** : validé avec JB le 28/09/2026
- **Dernière révision** : 2026-10-19

## Résumé

Un fichier joint vit en deux moitiés : sa ligne `platform.files` en base (métadonnées) et ses octets dans un stockage d'objets compatible S3, troisième port du paquet après l'identité et la base (ADR-016). Le navigateur envoie au bucket par une URL présignée, le service décide tout (droits, type, taille, quota) et confirme ; la lecture passe par une route du paquet qui redirige vers une URL signée de 60 secondes. Un fichier vit autant que son nœud, se copie à la duplication et part à la purge de la corbeille. Un fichier en transit, entre une personne et un connecteur, n'a pas de nœud : il n'est lisible que par son auteur et par le moteur sous son identité, compte au quota et s'efface à son échéance.

## Contexte

Le bloc `image` ne portait qu'une adresse `https` externe (`src` ≤ 2 000 caractères, ADR-011 § 2) : le paquet n'avait aucun stockage de fichiers. Trois contraintes encadrent le choix : la garde de portabilité (`CLAUDE.md § Projet`, ADR-012) interdit d'appeler Supabase Storage par son client ; l'hôte peut être un ERP sans Supabase ni Vercel, et tout ce qu'il fournit se déclare par des variables `PLATFORM_*` ; un corps de requête est borné (`uploads-patterns.md § La limite de 1 Mo décide de l'architecture`, Vercel coupe à 4,5 Mo). JB a tranché le 2026-09-28 pour un port générique compatible S3 (fiche D111).

## Objectifs et non-objectifs

- Tout hôte branche le stockage qu'il a déjà, sans code ; le SaaS garde Supabase par configuration seule, sans nouvel appel à `supabase.*`.
- Aucune limite de taille imposée par l'hébergement : les octets ne passent pas par les routes du paquet.
- La base reste légère : sauvegarde et `bare-postgres` ne changent pas.
- Hors objectif (épic E10) : extraire le texte d'un PDF ou d'un document bureautique pour `find` (plus tard) ; aperçu en ligne des documents bureautiques ; import de fichiers Excel (`.xlsx`), un CSV exporté d'Excel suffit ; téléverser des octets par un outil MCP (voir [dépôt par lien](depot-par-lien.md)) ; un écran de quota.

## Conception

### Le port `FileStore` (ADR-016 § 1 et § 2)

- Port de `server/` à sept opérations : URL présignée d'envoi, URL présignée de lecture (60 s, ou la durée que l'appelant donne : une heure pour l'export d'une arborescence), métadonnées (`HEAD`), suppression, copie côté bucket (`copy`, pour la duplication, D118), écriture par le serveur (`put`, l'objet qu'il produit lui-même : l'export d'une arborescence, sous `<org>/exports/`, [transfert d'une arborescence](transfert-d-arborescence.md)), liste des clés sous un préfixe (`list`, ListObjectsV2 : les exports expirés à purger). Un seul adaptateur livré, S3 signé en SigV4 (`aws4fetch`, pas le SDK AWS : `tech-stack.md`) ; il sert AWS S3, l'Object Storage de Scaleway, MinIO et Supabase Storage par son point d'accès S3. Les tests ont un adaptateur en mémoire.
- Adresses en chemin, `<endpoint>/<bucket>/<clé>`, sans option pour un fournisseur qui n'admettrait que le sous-domaine (D148, HN-E10S02-31).
- Cinq variables de l'hôte : `PLATFORM_STORAGE_ENDPOINT`, `PLATFORM_STORAGE_BUCKET`, `PLATFORM_STORAGE_REGION`, `PLATFORM_STORAGE_ACCESS_KEY_ID`, `PLATFORM_STORAGE_SECRET_ACCESS_KEY` : des clés d'accès S3, jamais la clé `service_role`. Un `PLATFORM_STORAGE_ENDPOINT` qui n'est pas une adresse `http(s)` lève `PlatformConfigError` ; `null` reste réservé à une variable absente (HN-E10S02-34).
- **Sans ces variables, les fichiers sont désactivés** : les écrans ne proposent aucun dépôt, l'API refuse par `not_enabled` avec un message qui nomme les variables, le reste fonctionne. `GET files/<id>` et `POST files/<id>/complete` refusent aussi par `not_enabled`, avant de lire la ligne (HN-E10S02-26). Le bucket est privé ; ses règles CORS (envoi depuis l'origine de l'hôte) sont dans le README du paquet.

### Métadonnées en base, octets jamais (ADR-016 § 3)

- Table `platform.files` : `id`, `org_id`, `node_id`, `name` (nom d'origine, métadonnée seule), `mime`, `size`, `status` (`pending` · `ready`), `created_by`, `created_at` ; détail dans [le schéma](../reference/schema-platform.md). Clé d'objet `<org_id>/<id>`, jamais le nom d'origine (`uploads-patterns.md § Nommage du chemin`).
- Pas d'empreinte ni de colonne `sha256` : aucun comportement ne la lit, et la calculer demanderait de relire l'objet (HN-E10S02-7).
- Privilèges de `files` à `authenticated` seul, sans `service_role` : insertion attribuée à l'appelant sur un nœud de l'organisation, mise à jour de `status` seule (HN-E10S02-29). La policy d'insertion exige `status = 'pending'` : seule la mise à jour rend une ligne `ready`, duplication et dépôt par lien compris (HN-E10S02-52).
- Le bloc `file` et la forme de l'image interne (`file_id` ou `src`, jamais les deux ; `width`) entrent dans une seule redéfinition de `blocks_shape_check`, à la parité de `schemas/blocks.ts` (HN-E10S02-28). `20260929200000_platform_files.sql` a été la migration unique de la story, complétée lot par lot, figée dès son application au projet partagé (HN-E10S02-51, D124).

### Type, taille et quota

- 50 Mo par fichier (52 428 800 octets) et 10 Go par organisation (10 737 418 240 octets), en valeurs fixes, sans écran de quota (D113, HN-E10S02-1). Le quota compte les lignes `pending` et `ready` et se lit sous le verrou consultatif de classe 7501, clé `org_id` (HN-E10S02-30, `database-patterns.md § Transactions`).
- Le type d'un fichier vient de l'extension de `name` (`FILE_TYPES`), jamais du type déclaré par le navigateur (D148) : le `mime` du corps est reçu (255 caractères au plus, vide admis) mais jamais cru ; la ligne porte le type de l'extension, signé dans l'URL d'envoi et rendu dans `upload.headers` (HN-E10S02-25).
- Le type reste celui de l'extension, sans contrôle des octets (décision de JB, FB-0014) : le fichier est servi au type de son extension (`readResponse` le signe dans l'URL de lecture), `attachment` hors images matricielles, PDF, `txt` et `csv`, et la route isolée d'un HTML pose `nosniff`. Un `nosniff` du bucket lui-même n'est pas garanti par le port (hypothèse : sans effet) (HN-E10S02-123).

### Envoi en trois temps (ADR-016 § 4)

- La demande (nom, type, taille, nœud) vérifie l'écriture sur le nœud, le type admis, la taille et le quota, crée la ligne `pending` et rend une URL présignée d'envoi (5 minutes, taille et type fixés dans la signature) ; le navigateur envoie au bucket ; la confirmation lit l'objet (`HEAD`), vérifie sa taille et passe la ligne à `ready`. `POST files` répond 201 ; `POST files/<id>/complete` prend le corps JSON de tout `POST` de la porte (`{}`), sans le lire (HN-E10S02-33).
- `node` de `fileRequestSchema` est le chemin du nœud (`nodePathSchema`), lu par `findNode`, ancien chemin compris (HN-E10S02-24). La demande ne contrôle pas le genre du nœud : un fichier se joint à tout nœud que la personne écrit, `writeNode` décide quels blocs le citent (HN-E10S02-27, HN-E10S02-74).
- La confirmation (`completeFileUpload`) et l'envoi par le serveur (`storeFile`) ne comparent que la **taille** de l'objet relu à celle de la ligne, jamais son type : Supabase Storage relit un objet `text/html` en `text/plain`, et comparer le type refusait tout HTML. Sûr : le type est signé à l'envoi et aucune lecture ne sert celui de l'objet. Le bucket en mémoire relit `text/html` en `text/plain` comme Supabase (HN-E10S02-114) et perd les paramètres d'un type (`; charset=…`) au `HEAD` (HN-E10S02-115).
- La taille (`head()` de l'adaptateur S3) se lit par un `HEAD` qui envoie `accept-encoding: identity`, posé après la signature et hors d'elle (un CDN compresse sinon un objet relu `text/plain`, sans `content-length`). Un `content-length` absent, non numérique ou sous un `content-encoding` autre qu'`identity` se rabat sur `content-range` d'un `GET range: bytes=0-0` (416 : objet vide, 0) ; sinon la taille est `null` (jamais `NaN`), les en-têtes vont au log (`storage gave no size`) et la confirmation rend `internal` en gardant ligne `pending` et objet. Une taille différente se journalise (`size mismatch`) avant la suppression de la ligne et de l'objet, et le refus dit les deux tailles. L'adaptateur S3 se teste sur un `fetch` qui simule le CDN (HN-E10S02-124).
- Pannes : une panne du bucket (réseau, délai, 5xx) rend `internal` « File storage unreachable. Retry later. », le détail au log sans l'adresse signée ; un objet rendu en 403 ou 404 vaut absent (`not_found` à la lecture du texte, `head()` nul, `conflict` à la confirmation, `available: false` pour une carte) ; `readFileText` au-delà de 4 Mo lus rend `too_large` (HN-E10S02-32).
- `storeFile` partage avec la demande d'envoi l'insertion `pending` sous quota (`insertPending`) et avec la confirmation `markReady` ; `admittedType` et `checkSize` décident type et taille (HN-E10S02-107).
- Un bloc n'est écrit qu'après `complete` : aucun bloc, brouillon ou publié, ne cite une ligne `pending`, et la purge ne casse aucun bloc (HN-E10S02-8). Une ligne `pending` de plus d'une heure est purgée, objet compris, au début de chaque demande d'envoi de l'organisation et au passage de la corbeille.

### Lecture (ADR-016 § 5)

- `GET /api/platform/files/<id>` : le service vérifie la lecture sur le nœud, puis redirige (302) vers une URL présignée de 60 secondes. Type et disposition sont fixés **dans l'URL signée** (`response-content-type`, `response-content-disposition`), jamais lus de l'objet : image matricielle (`png`, `jpeg`, `gif`, `webp`) `inline` ; PDF `inline`, `txt` et `csv` `inline` en `text/plain; charset=utf-8` pour « Voir » seulement ; tout le reste en `attachment`, `svg`, `html` et `md` compris. L'URL sert le type de l'extension (`FILE_TYPES`), jamais le `mime` de la ligne ; `application/octet-stream` pour un nom sans type admis (HN-E10S02-53).
- Un `html` ne se voit que par la route isolée, un `.md` par la visionneuse ([contenu HTML isolé](contenu-html-isole.md)) ; aucun autre dépôt n'est servi en `text/html` depuis l'origine de l'hôte (`uploads-patterns.md § Validation`).

### Le dépôt à l'écran

- L'écran apprend l'état du stockage par `GET files` plutôt que par une propriété de l'hôte, pour n'ajouter aucun fichier à l'hôte (HN-E10S02-6), au premier geste qui en a besoin (« + » survolé ou atteint au clavier, collage, dépôt), jamais au montage ; un échec n'est pas retenu ; tant qu'il ne le sait pas, « Image » et « Fichier » n'apparaissent pas (HN-E10S02-37).
- « Image » et « Fichier » terminent le groupe « Insérer » du « + » et la liste de « / », qui montrent les mêmes entrées (HN-E10S02-38, revue par JB) ; choisis par « / », le Texte se vide de sa barre et le fichier se joint après lui ; ils ouvrent un `Dialog` (zone de dépôt d'E10-S01, `accepte`) qui dit types et limites avant la sélection (HN-E10S02-39). L'écran propose les fichiers dans tout nœud qu'il écrit : page, procédure, Contexte (HN-E10S02-50, tranchée par HN-E10S02-74).
- Le genre vient de l'extension : une image (`png`, `jpeg`, `jpg`, `gif`, `webp`, `svg`) devient un bloc `image`, même choisie par « Fichier » ; tout autre type admis, un bloc `file` (HN-E10S02-36).
- Un dépôt ou un collage joint le premier fichier seul (HN-E10S02-40). Un fichier lâché sur une rangée est reçu par la rangée (`rangee-de-bloc.tsx`) ; stockage désactivé, le comportement d'E10-S01 ; extension non admise, le refus nomme les formats admis, sous le bloc (HN-E10S02-41). Lâché ou collé sur le Texte local d'une page vide, il se joint après ce Texte, qui reste (HN-E10S02-79).
- Un CSV importé en tableau depuis une page prend la première adresse libre `<page>/<segment du nom>` (`adressesAEssayer`) (HN-E10S02-48).
- L'envoi en cours est une rangée locale `depot-local`, jamais envoyée (sans forme, hors de `SANS_TEXTE`), sans « + » ni poignée ; elle retient la reprise des blocs servis jusqu'à sa confirmation ou son retrait (HN-E10S02-46). Elle reste dans les blocs que l'éditeur rend à la publication ; seul le Texte local d'une page vide en est exclu (HN-E10S02-80, `portage-ecrans.md § 6`).
- Un `PUT` au stockage hors 2xx se lit `internal` (« Le stockage des fichiers ne répond pas »), une coupure du réseau `reseau` (HN-E10S02-47). L'écran traduit un refus par sa cause, retrouvée par le fichier envoyé (`invalid_arguments` sur une extension admise : nom refusé ; `too_large` d'un fichier de 0 octet : fichier vide), le service ne changeant ni ses codes ni ses messages (HN-E10S02-54).
- Texte alternatif et largeur s'écrivent par `modifierLeBloc` (différé de 1 200 ms, envoi à la sortie du champ) ; `image` et `file` sont dans `SANS_TEXTE` (`operations.ts`) : jamais vides (HN-E10S02-42). Largeurs : `small` un tiers, `medium` deux tiers, `full` toute la colonne de lecture (HN-E10S02-49).
- La carte d'un fichier demande une fois montée, par un `useEffect`, `GET files/<id>?check`, qui rend `{ data: { available } }` sans redirection (`fileAvailability` : ligne `ready` sous la lecture du nœud, puis `head()`) ; « Fichier indisponible » sur `available: false`, `not_found` ou `not_enabled`, rien sur une panne ; exception écrite de `state-management.md § Règle d'or` (HN-E10S02-43).

### Blocs qui citent un fichier

- `writeNode` admet un bloc `file` ou une image jointe dans tout nœud à blocs (page, procédure, Contexte), jamais dans un tableau (HN-E10S02-74). Il ne relit que les fichiers que le document (brouillon, sinon publié) ne citait pas encore (`ready`, joints au nœud) ; un fichier déjà cité par un bloc `file` passe avec ses métadonnées (HN-E10S02-70). Un bloc `file` dont les métadonnées ne viennent ni d'une ligne relue `ready` jointe au nœud ni d'un bloc `file` déjà dans le document est refusé, ou gardé en `code` en mode tolérant (HN-E10S02-82).
- Une création qui cite un fichier est refusée avant l'insertion du nœud ; le dépôt par lien crée la page, puis joint le fichier par une seconde écriture (HN-E10S02-71). En mode tolérant, un fichier non joint à la page devient un bloc `code` qui porte son markdown, compté dans `kept_as_text` (HN-E10S02-72). Une image jointe réécrite sans largeur garde la largeur du bloc qui citait le même fichier (HN-E10S02-73).

### Durée de vie, duplication, purge (ADR-016 § 6)

- Un fichier vit aussi longtemps que son nœud : retirer le bloc qui le montre ne le supprime pas (un instantané de `node_versions` peut le citer). La purge de la corbeille (30 jours) supprime les lignes `files` dans la même instruction que les nœuds (deux `delete` en `with`), limitée aux nœuds vraiment emportés ; les objets partent après le commit (`removeObjects`) (HN-E10S02-92).
- **Dupliquer** une page copie ses objets (`copy`) sous des identifiants neufs et réécrit les blocs de la copie : un fichier n'appartient jamais à deux nœuds (D118, HN-E10S02-2). Seuls les fichiers qu'un bloc publié d'un nœud copié cite (`file`, image jointe) sont copiés, `pending` compris (HN-E10S02-88). `duplicate_subtree` rend, par nœud copié, `copied_files` (ancien identifiant → nouveau) (HN-E10S02-90).
- Les fichiers copiés comptent au quota (D149) : `requireQuota` relit la somme sous le verrou 7501 dans la transaction de la duplication ; au-delà de 10 Go, `too_large` (raison `quota`), rien n'est écrit, copie de page comprise (HN-E10S02-89).
- Après le commit, les copies d'objets partent ensemble, par lots de 8 (`COPIES_AT_ONCE`), un échec n'arrêtant pas les lots suivants (HN-E10S02-113) ; puis une seule mise à jour sous la session passe les lignes copiées à `ready` ; sans stockage, elles restent `pending`, nommées au log (`[platform] files: copy left pending <clé>`) (HN-E10S02-91). Le lien public d'une copie sert le fichier copié, jamais celui de l'original (HN-E10S02-94).

### Fichier en transit

- Un fichier qui passe entre une personne (ou un assistant) et un connecteur, une pièce jointe à envoyer ou un export rendu par une API, passe par oto de serveur à serveur, sans transiter par l'assistant : il y devient un **fichier en transit**, une ligne `files` et un objet comme un fichier joint, donc sous le plafond, le quota et les [lecteurs](lecture-des-fichiers.md) d'oto, mais rattaché à aucune page. Rien de durable par défaut (15/10).
- Toute source produit un fichier d'oto (une adresse publique et un fichier du poste le font déjà par le [dépôt par lien](depot-par-lien.md) ; une sortie de connecteur déclarée fichier, un contenu tenu par l'assistant restent à faire) ; toute destination de connecteur ne reçoit qu'un identifiant de fichier d'oto, joint ou en transit. Le compte de la source se résout une fois, à l'entrée, par la résolution habituelle ([connecteurs et comptes](connecteurs-et-comptes.md)). La source et la destination sont deux appels.
- Garder la pièce est un geste explicite : la joindre à une page, où elle devient un fichier joint et vit avec son nœud.
- **Forme** (16/10) : hors de l'arbre, sa ligne `files` n'a pas de nœud (`node_id` nul) et porte une échéance (`expires_at`), plutôt qu'un nœud caché ; `files_transit_check` pose l'échéance sur une ligne sans nœud, et sur elle seule. Un seul plafond : 50 Mo par fichier, pour tout type admis, texte compris (19/10) : la borne de 4 Mo d'un fichier texte joint ne vaut pas ici, un gros export CSV passe (`checkSize` sans type). Les types admis sont ceux d'un fichier joint (`admittedType`), confirmés le 19/10 : un export en `.json` ou `.xml` est refusé.
- **Lecture** (19/10) : un fichier en transit n'est lisible que par la personne qui l'a produit ou téléversé, et par le moteur pendant le transfert ; ni l'organisation, ni une équipe, ni un administrateur, ni l'équipe plateforme ne le lisent. Le moteur court sous l'identité de la personne qui appelle (`<p>_call`, `callFunction`), donc ne lit que les siens : aucune fonction `security definer` ne lui ouvre les fichiers d'un autre. Le service le décide en filtrant sur l'auteur avant toute URL (`ownTransitRow`) ; les quatre policies de `files` le doublent, un fichier en transit ne se lisant, ne se modifiant et ne se supprimant que par son auteur. Pour tout autre, la même réponse `not_found` qu'un fichier inconnu.
- **Durée de vie** (16/10) : effacé à sa consommation, et au plus tard une heure après sa création (`TRANSIT_HOURS`) s'il n'est jamais consommé. L'échéance part de l'horloge de la base, à l'insertion. Échu, il est aussitôt illisible et hors du quota ; sa ligne et son objet partent à l'entrée en transit suivante de l'organisation, de toute personne (`purge_transit_files`, `security definer`, qui ne rend que les identifiants ; le paquet n'a pas de tâche planifiée). La consommation est `expireTransitFile` : la ligne de l'appelant, puis l'objet après le commit ; la lecture par le moteur n'efface rien, la consommation suit l'envoi réussi au tiers (confirmé le 19/10).
- **Quota** (19/10) : pendant sa vie, il compte au quota de l'organisation, `pending` et `ready`, comme un fichier joint, et la demande refuse au-delà par `too_large` (raison `quota`), avec le message d'un fichier joint (confirmé le 19/10). La RLS le cachant aux autres, le quota se lit par `org_files_bytes` (`security definer`, une somme pour une organisation de l'appelant, `42501` sinon), sous le verrou 7501 (`requireQuota`, `server/files/rows.ts`).
- **Portes** : `POST transit-files` `{ name, mime, size }` (la demande : purge des échus, stockage, type, taille, quota ; rend `{ id, upload, expiresAt }`), `POST transit-files/<id>/complete` (la confirmation, `confirmObject` partagée avec le fichier joint) et `GET transit-files/<id>` (sa lecture par l'auteur, redirection 302 vers une URL de 60 s, `attachment` hors images matricielles, confirmé le 19/10) ; aucune cible au journal, faute de nœud. Au journal de l'organisation (19/10), la demande et la confirmation ne portent que l'identifiant, la taille et le type MIME, jamais le nom : la route en tire une liste blanche (`journalArgs`), au lieu du corps, et un refus s'y journalise par son seul code, son message pouvant citer le nom. Le moteur lit les octets par `readTransitBytes` (50 Mo au plus), qui n'efface rien : la consommation se décide après l'envoi au tiers. Un fichier en transit ne se lit pas par les routes d'un fichier joint (`files/<id>`), ne s'exporte jamais avec l'organisation (`present: 'node_id'` de la carte du transfert) et ne se cite dans aucun bloc.

### Partage public et transfert (ADR-016 § 7 et § 8)

- `GET /api/platform/public/<jeton>/files/<id>` passe par `public_file_by_token`, `security definer` sous `anon`, sans fichier de l'hôte : seul un fichier cité par un bloc **publié** d'un nœud couvert par le lien, dans ce que l'auteur du lien lit à cet instant ([partage public](partage-public.md) ; détail des routes dans [contenu HTML isolé](contenu-html-isole.md)).
- Transfert d'une organisation (E09-S04) : le JSON porte les métadonnées (carte `TABLES`), les octets vont dans un dossier `<out>.files/` à côté de lui (HN-E10S02-4), relus dans le bucket de la source et réécrits dans celui de la cible sous les nouveaux identifiants. Les scripts (`.mjs`, sans le TypeScript du paquet) signent par `aws4fetch` (`scripts/lib/org-transfer-files.mjs`).
- `files` est dans `TABLES` (`scripts/lib/org-transfer.mjs`), `created_by` nul pour une personne absente, `node_id` remplacé ; une ligne `files` dans A et dans B dans l'organisation source d'`org-transfer.test.ts`, l'état de création `pending` dans `isolation/tables.test.ts` (HN-E10S02-35). Le filtre `ready` de l'export s'écrit dans la carte (`TableSpec.only`, lu par `orgRowsSql`) ; l'empreinte d'E09-S04 désigne un fichier par `file:<chemin de son nœud>/<nom>` ; `transferEnv` lit les cinq variables en facultatives, masquées (HN-E10S02-93).
- Sans les cinq variables, `org:export` d'une organisation qui a des fichiers `ready` échoue après sa lecture, avant le JSON et `<fichier>.files/`, et `org:import` d'un document qui porte des fichiers juste après la lecture des variables, avant toute connexion : message qui nomme les cinq (`requireTransferStore`), code 1 ; sans fichier, le transfert passe sans elles. Un objet absent est nommé, jamais une erreur ; une panne du stockage à l'export lève avant le JSON ; à l'import, les objets partent après le commit des lignes, un envoi en échec est nommé, code 1 (HN-E10S02-87).
- À l'import, un ancien identifiant de fichier qui n'est pas un uuid est refusé avant de bâtir son chemin (nommé, code 1) ; à l'export, un dossier `<fichier>.files/` déjà là arrête le script comme le JSON (« relancez avec --force »), et `--force` le vide avant l'écriture (HN-E10S02-112).

### Lecteurs de format

- Ce qu'un assistant lit d'un fichier joint (aperçu au dépôt, texte par `read {file}`, registre des lecteurs, complété par l'hôte) est dans [lecture des fichiers par un assistant](lecture-des-fichiers.md).

## Décisions et alternatives écartées

- **Octets en Postgres (`bytea`)** : aucun port, portable, droits et transfert gratuits. Écarté par JB (D111) : la base grossit avec les fichiers, et le corps de requête reste borné à 4,5 Mo sur Vercel.
- **Supabase Storage par son client** : immédiat, avec des policies de Storage. Écarté : nouvelle dépendance au schéma `storage` et au client Supabase, contraire à la garde de portabilité (ADR-012).
- **Une empreinte par fichier** (`sha256`, ADR-016 § 3 d'origine) : retirée, aucun comportement ne la lit (HN-E10S02-7).
- **Un fichier partagé entre l'original et sa copie** : écarté par D118 ; chaque page garde ses propres fichiers. Copie hors quota : écartée par D149.
- **Une table à part pour le fichier en transit** : écartée ; la forme est décidée le 16/10 (une ligne `files` sans nœud, avec une échéance), et le quota, la confirmation, la purge des objets et le plafond s'écrivent déjà sur `files`.
- **Un fichier en transit lisible par l'organisation** (la RLS d'isolation seule, comme un fichier joint) : écarté par Alexis le 19/10 ; une pièce de paie ou un relevé envoyé à un connecteur ne regarde que la personne qui l'envoie.
- **Une lecture du moteur hors de la session de l'appelant** (fonction `security definer`) : écartée ; le moteur court déjà sous l'identité de qui appelle, et une telle porte lirait le fichier d'un autre pour un appel qui n'est pas le sien.
- **Comparer le type de l'objet relu à la confirmation** (1.1.2) : abandonné, il refusait tout HTML sur Supabase Storage (HN-E10S02-114).
- **Adresses S3 en sous-domaine** : non livrées, une option le jour où un fournisseur l'exige (D148).

## Sécurité et confidentialité

- Les clés du bucket sont des clés d'accès S3 de l'hôte, jamais `service_role` ; le bucket est privé ; une URL de lecture vit 60 secondes (une heure pour l'export d'une arborescence, une capacité que l'assistant relaie à l'import) et n'est jamais journalisée en clair.
- Le nom d'origine n'entre jamais dans la clé d'objet ; type et disposition sont signés dans l'URL, jamais lus de l'objet ni du navigateur.
- Les droits se décident dans le service avant toute URL (`security-patterns.md § Droits dans le service`) ; voir [droits d'accès](droits-d-acces.md).
- Un fichier en transit n'est lisible que par son auteur : décidé par le service, doublé par la RLS, prouvé contre une personne de son équipe, un administrateur et l'équipe plateforme (`tests/integration/fichiers-en-transit.test.ts`). Son nom n'entre pas au journal de l'organisation, que lit un administrateur, ni par le corps, ni par la réponse, ni par le message d'un refus (`tests/unit/api-transit-files.test.ts`). `org_files_bytes` et `purge_transit_files` vérifient l'appartenance de l'appelant et ne rendent ni nom ni taille d'un fichier d'un autre.

## Écart avec le code

- M86 : objets orphelins quand une ligne `files` part sans la purge (`forget_user`, organisation supprimée en SQL, `pnpm test:cleanup`, `pnpm demo:seed`) ; les supprimer par préfixe `<org_id>/`.
- M87 : `org:export --force` vide `<fichier>.files/` avant d'écrire, et une panne en cours laisse l'ancien JSON à côté d'objets en partie réécrits ; écrire dans un dossier temporaire puis remplacer.
- M88 : la CI n'a pas de MinIO pour l'adaptateur S3 réel (SigV4, `copy`, URL signées).
- HN-E10S02-115 : sur le bucket de l'hôte de démo en 1.1.2, `.md`, `.txt` et `.svg` échouaient ; seul l'échec de `html` est expliqué (comparaison de type), la cause des trois autres n'est pas établie sans le bucket réel (hypothèse : types MIME admis du bucket, ou refus du `PUT`) ; les messages d'HN-E10S02-116 et le log serveur la diront. Un ticket public de Supabase Storage décrit la perte du `charset`, correctif non fusionné.
- M98 : test d'expiration sensible à l'écart d'horloge entre la base et le poste.
- Fichier en transit : le moteur de connecteurs n'envoie ni ne reçoit encore d'octets hors JSON (ni multipart, ni réponse binaire), donc rien n'appelle `readTransitBytes` ni `expireTransitFile` ; une sortie de connecteur n'en produit pas ; `read {file}` d'un assistant ne le lit pas ; le joindre à une page n'est pas écrit.
- Fichier en transit : `forget_user` met son auteur à nul comme pour un fichier joint ; plus personne ne le lit, et il part à son échéance (accepté le 19/10).
- Fichier en transit : un refus de la demande ou de la confirmation se journalise par son seul code (`too_large`, `conflict`…), sans son message, qui peut citer le nom ; le journal ne dit pas lequel des refus d'un même code.

## Questions ouvertes

- Aucune pour le fichier en transit : ses valeurs, d'abord provisoires, sont confirmées le 19/10.

## Historique

- 2026-09-28 : port de stockage S3, octets hors base, envoi en trois temps, lecture signée, durée de vie liée au nœud — décidé par JB (source : ADR-016, fiche D111).
- 2026-09-28 : 50 Mo par fichier, 10 Go par organisation, sans écran de quota — décidé par JB (source : fiche D113).
- 2026-09-29 : la duplication copie les objets par `copy`, 5ᵉ opération du port — décidé par JB sur proposition du pilote (source : fiche D118, ADR-016 § 1).
- 2026-09-29 : adresses S3 en chemin, type par l'extension, copies comptées au quota — option du pilote (source : fiches D148, D149, story E10-S02).
- 2026-09-30 : taille seule comparée à la confirmation, `HEAD` en `identity` et repli `content-range` (versions 1.1.3 et 1.1.4) — option du pilote (source : HN-E10S02-114, HN-E10S02-124).
- 2026-10-01 : refonte en document de conception vivant, qui reprend ADR-016, les fiches D113, D118, D148, D149 et les choix HN-E10S02 du stockage — décidé par Alexis, accord de JB.
- 2026-10-08 : lecteurs de format sur les fichiers envoyés à oto, lus à l'envoi et rangés, par un port lecteur branché par l'hôte vers un service isolé qui lit le fichier par sa référence ; activés par organisation — décidé par Alexis, à valider avec JB.
- 2026-10-13 : sixième et septième opérations du port, `put` et `list`, et URL de lecture d'une heure pour l'export d'une arborescence et ses fichiers joints — décidé par JB (source : cahier des charges du transfert d'arborescence, session du 13/10/2026).
- 2026-10-14 : « Image » et « Fichier » aussi dans la liste de « / », comme au « + » — décidé par JB (source : retour sur l'éditeur, session du 14/10/2026).
- 2026-10-15 : un fichier qui va d'un connecteur à un autre passe par oto en fichier en transit, effacé après le transfert ; toute destination ne reçoit qu'un identifiant de fichier d'oto ; garder la pièce est un geste explicite — proposé par JB, décidé avec Alexis (source : issue du transfert de fichier entre connecteurs, 14 et 15/10/2026). Port lecteur du 08/10 abandonné au profit du registre des lecteurs — décidé avec Alexis (source : issue des lecteurs de fichiers, 15/10/2026).
- 2026-10-16 : fichier en transit effacé à sa consommation et au plus tard au bout d'une heure, sans nœud et avec une échéance, plafond de 50 Mo — décidé par Alexis (source : revue des connecteurs d'oto 2 du 16/10, issue oto-now/oto-core#3).
- 2026-10-19 : fichier en transit écrit ; lisible par la seule personne qui l'a produit ou téléversé, et par le moteur pendant le transfert, jamais par l'organisation, une équipe ou un administrateur ; compté au quota de l'organisation pendant sa vie — décidé par Alexis (source : décision du 19/10 sur le fichier en transit).
- 2026-10-19 : fichier en transit, valeurs confirmées : 50 Mo pour tout type admis, texte compris ; les types d'un fichier joint ; aucun nom de fichier au journal de l'organisation (identifiant, taille et type MIME seuls, refus par son code) ; le refus au quota plein d'un fichier joint, l'effacement à la consommation seule, la lecture en `attachment` hors images matricielles et `forget_user` inchangé, acceptés tels quels — arrêté à la relecture du lot (source : relecture du fichier en transit, 19/10).
