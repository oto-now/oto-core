# Partage public

- **Statut** : validé avec JB le 27/09/2026
- **Dernière révision** : 2026-10-20

## Résumé

Un contenu, et au choix ses sous-contenus, se partage hors de l'organisation par un lien à jeton, lu sans session sur une page publique de l'hôte (`/p/<jeton>`).
Le lien ne montre que la dernière version publiée, jamais plus que ce que son auteur lit à cet instant, et une seule fonction de la base le sert.
L'aperçu d'un lien collé dans une messagerie montre son titre et son résumé ; toute autre adresse ne montre que l'organisation.

## Contexte

Toute lecture du paquet passe par une personne authentifiée : la porte vérifie son jeton, le
service décide son droit sur le nœud (`security-patterns.md § Droits dans le service`, ADR-012
§ 3), la base n'isole que les organisations. Partager un contenu avec quelqu'un qui n'a pas de
compte, comme « Publier sur le web » de Notion, introduit un lecteur nouveau : anonyme, sans
organisation, que seul un jeton désigne. Coller une adresse dans Slack, WhatsApp ou LinkedIn
demande aussi un aperçu (Open Graph) qui ne trahisse rien d'une page privée.

## Objectifs et non-objectifs

- Partager sans créer de compte ; ne prêter au lecteur aucun droit d'une personne.
- Ne jamais publier plus que ce que l'auteur du lien voit, même quand le contenu change dessous.
- Hors objectif : un compte invité par lecteur (c'est l'invitation qui existe, [identité et connexion](identite-et-connexion.md)) ; l'indexation par les moteurs de recherche ; le partage par le MCP.

## Conception

### Le lien

- **Un lien de partage est une ligne** `platform.node_shares` : `org_id`, `node_id`, `token` (32 octets aléatoires tirés par le service, encodés en base64url, unique ; jamais dérivé du nœud), `include_children` (booléen), `created_by`, `created_at`, `revoked_at` (null tant que le lien vaut). Un seul lien actif par nœud. RLS d'isolation par organisation, écriture colonne par colonne ; un lien ne se supprime pas, il se révoque. L'import d'une organisation ne recopie jamais un jeton (ADR-013 § 1).
- **Qui partage** : qui a le niveau `manage` sur le nœud (« Accès complet »), décidé par le service avant la requête ; l'admin de l'organisation liste et révoque tous les liens actifs de son organisation (ADR-013 § 2).

### Ce qu'un lien donne

- La **dernière version publiée** du nœud (titre, résumé, blocs publiés), et, si `include_children`, celle des nœuds dessous dans l'arbre, au moment de la lecture, **dans la limite de ce que l'auteur du lien lit à cet instant** (`node_level_of`) : un lien ne publie jamais plus que ce que son auteur voit, même quand un autre ajoute un contenu dessous plus tard ; un auteur qui ne lit plus le nœud, ou qui a quitté l'organisation, rend le lien inerte (404). L'auteur est qui a créé ou réglé le lien en dernier (ADR-013 § 3).
- La racine de l'organisation, `private`, les espaces personnels, les Contextes, les dossiers d'équipe et l'espace « Privé » d'une autre personne ne se partagent pas. Rien d'autre ne sort : ni brouillon, ni règles d'accès, ni auteurs, ni preuve ni provenance, ni réservation, ni journal, ni MCP. Un contenu à la corbeille n'est pas servi. Un lien interne vers un contenu que le lien ne couvre pas s'affiche en texte, sans cible (ADR-013 § 3).
- La page publique d'un tableau montre ses lignes : grille en lecture seule, valeurs publiées seulement (ni preuve, ni provenance, ni réservation), 500 lignes au plus, dans la limite de ce que l'auteur du lien lit (D103).
- Les fichiers d'une page partagée se lisent par la même règle, par `public_file_by_token` ([fichiers et stockage](fichiers-et-stockage.md), ADR-016 § 7) ; un fichier HTML s'y voit sous la même isolation ([contenu HTML isolé](contenu-html-isole.md)).

### Qui lit

- Une page publique de l'hôte (`/p/<jeton>`), à l'adresse de l'organisation, hors session, en lecture seule, au thème de l'organisation. Elle lit par une seule fonction de la base, `public_node_by_token(org, jeton, chemin)`, `security definer`, exécutable par `anon` seul, bornée au jeton et à l'organisation de l'adresse. Un jeton inconnu, révoqué ou d'une autre organisation, un chemin hors du lien, rendent 404, sans dire lequel (ADR-013 § 4).
- Le document s'y lit sur toute la largeur de son îlot, comme dans l'éditeur (`data-reading="blocs"`), sans la colonne centrée de la lecture ni la place de la gouttière de l'éditeur, absente ici (1.4.12).
- **Jamais indexée** : `noindex, nofollow` (en-tête `X-Robots-Tag` et balise), page exclue de tout sitemap (ADR-013 § 5).
- **Portabilité** : la page, le service et la fonction sont dans le paquet (faces `ui/`, `api/`, `server/`, `migrations/`), sans Supabase ; l'hôte monte une route de plus, et une seconde pour l'image de partage (ADR-013 § 6, HN-E11S21-9).

### L'image de partage d'une adresse

- L'image d'un lien ne porte que ce que le lien donne déjà (titre, résumé, organisation) : ADR-013 § 3 inchangé (HN-E11S21-9).
- L'image d'un lien public est une route de l'hôte, `/p/[jeton]/share-image/[[...chemin]]`, et non la convention `opengraph-image` : Next ne peut la monter sous l'attrape-tout optionnel `[[...chemin]]`, et posée à `/p/[jeton]/` elle ignorerait le chemin d'un contenu dessous. L'image générique garde la convention (`src/app/opengraph-image.tsx`). Segment anglais (ADR-020), hors de `NODE_PATH_PATTERN` (tiret) : aucun chemin de nœud ne le porte (HN-E11S21-1).
- Un robot d'aperçu n'est pas la personne : toute adresse autre qu'un lien public ne montre que l'organisation (nom, couleur, logo), jamais le titre ni le contenu d'une page privée, même collée par une personne connectée ; `/n/<chemin>` ne pose aucune métadonnée de partage, son titre privé ne sort que dans `<title>` (HN-E11S21-2).
- Clé de cache par révision : l'image d'un lien porte `?v=<révision>` du contenu servi, qui change avec un titre ou un résumé publié. Réponse en `private, max-age=300` (aucun cache partagé, comme toute réponse publique d'ADR-013 : une révocation vaut aussitôt côté serveur) ; l'image générique en `public, max-age=3600` (une marque changée se voit dans l'heure) (HN-E11S21-3).
- Le logo se lit côté serveur par `fetchSource` (https, 443, adresses privées refusées, 1 Mo, 3 redirections) en 3 s au plus, et entre dans l'image en `data:` : PNG ou JPEG seulement (Satori ne décode ni WebP ni AVIF ; un SVG mal formé casserait l'image après l'envoi du statut 200) ; sinon l'initiale sur la couleur du thème (HN-E11S21-4).
- Aucune police Inter n'existe en fichier local (celle de `next/font` est compilée) : l'image garde la police par défaut d'`ImageResponse`, Noto Sans (latin, accents français), sans appel réseau ; graisse unique, le titre se distingue par sa taille et sa teinte (`--title`) (HN-E11S21-5).
- Le paquet ne dépend pas de `next/og` : il rend l'arbre JSX (`ImageDePartage`) et les données (`shareImageData`, `server/share-image.ts`, qui ne lève jamais : repli générique) ; l'hôte appelle `new ImageResponse(…)`. Un import de `next/og` par le paquet chargerait le moteur d'image (WASM) dans la face qui l'importe (HN-E11S21-6).
- Textes : `og:description` générique « Les pages, procédures et tableaux de <organisation>. » (aucune sans organisation) ; d'un lien sans résumé, « Partagé par <organisation>. » ; dans l'image, nom coupé à 60 caractères, titre à 90, résumé à 160 ; `og:description` à 200 ; au dernier mot entier, suivis de « … ». `og:url` générique : `/` (l'adresse demandée n'est pas connue du layout). Aucune mention d'Oto quand l'organisation est connue, comme la page publique ; sans organisation, « Oto » et sa marque (HN-E11S21-7).
- Le layout racine compose ses métadonnées à chaque page : l'origine (`getRequestOrigin`, passée par `webUrl`) et la marque de l'adresse (lecture `anon` bornée à 1 s, une fois par requête par `cache`) ; Next 15 diffuse les métadonnées après le premier octet pour un navigateur, seul un robot les attend (HN-E11S21-8). En conséquence, `/_not-found` est dynamique depuis la 1.1.5 : un 404 statique porterait les métadonnées d'une seule organisation ; toutes les autres pages l'étaient déjà (HN-E11S21-11).
- Image et métadonnées de partage ont leur entrée, `@otomata_tech/oto_platform/share`, qui pointe le module existant (`ui/public/image-de-partage.tsx`, sans module client) ; `/ui` les exporte encore (le paquet ne fait qu'ajouter, ADR-006). Cause mesurée : `app/opengraph-image.tsx` importait le barrel `/ui`, dont Next collecte tous les modules client dans les morceaux du segment racine (JS partagé par toutes les pages : 314 kB, 104 kB avec `/share`) (HN-E11S21-10).
- Une route ne charge que le code client des écrans qu'elle monte par `optimizePackageImports: ["@otomata_tech/oto_platform/ui"]` dans la configuration de l'hôte, sans entrée nouvelle du paquet ni import changé (M104, 1.1.7). Mesuré par builds (JS de la page et de ses layouts, compressé) : `/login` 337 → 151 kB, `/admin` 322 → 219, `/n/<chemin>` 323 → 303 (avec l'éditeur). Un hôte sans la ligne reste correct, plus lourd ; condition gardée par test : le barrel ne fait que réexporter (HN-E11S21-12). L'installation est décrite dans [installer un hôte](../exploitation/installer-un-hote.md).

## Décisions et alternatives écartées

- **Un compte invité par lecteur** : c'est l'invitation qui existe déjà ; le besoin est un lien sans compte. Écarté (ADR-013).
- **Lire par la connexion d'administration** : elle contourne la RLS entière ; une fonction bornée au jeton limite ce qu'un défaut peut exposer. Écarté (ADR-013).
- **L'image d'un lien par la convention `opengraph-image` sous `/p/[jeton]/`** : elle ignorerait le chemin d'un contenu dessous. Écartée pour une route de l'hôte (HN-E11S21-1).
- **Des entrées par écran (`./ui/auth`, `./ui/theme`…)** pour alléger les routes : une surface d'exports à maintenir et des imports à changer chez chaque hôte pour le même résultat ; **`"sideEffects"`**, déjà `false` et sans effet sur la collecte des modules client par Next, qui précède l'élagage ; **le nom du paquet seul dans `optimizePackageImports`** (essayé en 1.1.6), qui ne couvre pas le sous-chemin `/ui`. Écartés (HN-E11S21-12).

## Sécurité et confidentialité

- Un lecteur anonyme existe : chaque lecture publique ne sort que du périmètre du jeton, ce qu'un test sur base réelle prouve par cas (autre nœud, sous-nœud sans `include_children`, brouillon, lien révoqué, autre organisation, sous-nœud que l'auteur ne lit pas, nœud ajouté plus tard par un autre, auteur retiré, racine et `private` refusés).
- Un jeton fuité donne la lecture jusqu'à sa révocation ; aucune réponse publique n'entre dans un cache partagé, une révocation vaut aussitôt.
- Aucun aperçu ne sort le titre d'une page privée (HN-E11S21-2) ; le logo se lit par un téléchargement contrôlé (HN-E11S21-4).

## Écart avec le code

- À 375 px, l'en-tête de la visionneuse d'un fichier ne passe pas à la ligne et fait défiler la zone de contenu en largeur, page publique comprise (M103).
- Le partage réel d'un lien public et d'un lien interne dans Slack et WhatsApp, chez l'hôte monté en 1.1.5, reste à jouer (actions de JB, `.method/sprint/status.md`).

## Questions ouvertes

Aucune à ce jour.

## Historique

- 2026-09-27 : partage public d'un contenu par lien à jeton, page `/p/<jeton>`, lecture par `public_node_by_token` ; la page d'un tableau montre ses lignes publiées, 500 au plus — décidé par JB (source : ADR-013, fiche D103).
- 2026-09-30 : image de partage d'une adresse aux couleurs de l'organisation (1.1.5), entrée `/share` (1.1.6), `optimizePackageImports` chez l'hôte (1.1.7) — décidé par le pilote (source : story E11-S21, M104).
- 2026-10-01 : refonte en document de conception vivant, qui reprend ADR-013, la fiche D103 et les choix de la story E11-S21 — décidé par Alexis, accord de JB.
- 2026-10-20 : la page publique lit son document en pleine largeur, sans marge à gauche — demandé par JB (source : session du 20/10/2026).
