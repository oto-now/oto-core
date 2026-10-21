# @otomata_tech/oto_platform

La plateforme MCP d'entreprise, en paquet npm : écrans, API, serveur MCP à six outils figés,
services et migrations du schéma Postgres `platform`. Elle s'installe dans une application Next
(App Router) adossée à Supabase, qui monte ses routes. Le paquet est publié en sources TypeScript,
sans étape de build, sous licence MIT.

## Les faces

| Face | Export | Rôle |
|------|--------|------|
| `ui/` | `@otomata_tech/oto_platform/ui` | Écrans et composants, portés d'oto-frontend ; jamais `server/`, `migrations/`, client DB ; un fichier de réexports seuls, que l'hôte déclare dans `optimizePackageImports` (installation, étape 3) |
| `ui/public/image-de-partage.tsx` | `@otomata_tech/oto_platform/share` | Image et métadonnées de partage (`ImageDePartage`, `TAILLE_DE_PARTAGE`, `metadonneesDePartage`), sans module client : pour les fichiers de métadonnées et les layouts |
| `schemas/` | `@otomata_tech/oto_platform/schemas` | Schémas Zod (`zod/v4`) partagés par toutes les faces, `ui/` compris ; Zod pur, aucune autre face ni client DB (frontière ESLint) |
| `mcp/` | `@otomata_tech/oto_platform/mcp` | Six outils, ctx, routage, prompts ; instructions et descriptions statiques |
| `api/` | `@otomata_tech/oto_platform/api` | Route handlers `/api/platform/*` : adaptateurs des services |
| `server/` | `@otomata_tech/oto_platform/server` | Services : la seule porte d'écriture (Zod → droits → écriture → journal) |
| `migrations/` | `@otomata_tech/oto_platform/migrations/*` | SQL du schéma `platform`, additif, copié par l'application hôte |
| `cli/` | commande `oto-platform` | Copie et contrôle des migrations dans l'application hôte ; préparation d'une base (`db prepare`) ; bundle du widget avec les vues de l'ERP (`widgets build`) ; purge du journal (`journal purge`) ; suppression d'une organisation (`org delete`) |
| `widgets/` | `@otomata_tech/oto_platform/widgets` | Widget routeur dans la conversation (sources construites par Vite) ; l'export ne porte que les types d'une vue de l'ERP (`ErpView`, `ErpViewProps`) |

## Règle de dépendance entre faces

`ui/` → `schemas/` seulement : il reçoit ses données par props et appelle `api/` par HTTP (même
origine) ; `api/` et `mcp/` → `server/` et `schemas/` ; `server/` → la base et, plus tard, le
service connecteurs ; `schemas/` n'importe aucune autre face ; `migrations/` n'est importé par
personne. La frontière de `ui/` est appliquée par ESLint avec un test, comme celle de `server/`,
`api/` et `mcp/`, qui n'importent `@supabase/*` que dans `server/oauth.ts` et `server/invitations.ts`
(consentement OAuth, lien magique). `server/` parle à la base par sa propre connexion
(`PLATFORM_DATABASE_URL`), sous l'appelant vérifié que l'hôte lui passe ; le client Supabase de l'hôte
reste pour ses propres pages. Le paquet n'importe jamais le code de l'hôte. Une page de l'hôte qui
appelle un service construit ce client par `createPlatformDb({ caller })` : l'appelant vérifié de la
session, sous lequel tournent les services (`db.tx`, la seule face du client ; `accessToken`, que les
versions antérieures demandaient, est accepté et n'est plus lu). Sur Supabase Auth, `{ userId, email, name }` du
compte de la session (`callerName(user)` pour le nom, jamais une valeur de repli) ; avec un émetteur
OIDC, `{ issuer, issuerKind: "oidc", subject, email, name }` de l'`id_token` validé (`issuer` :
`PLATFORM_OIDC_ISSUER` telle quelle, l'email seulement vérifié), que la base traduit en identifiant
interne à la première requête (`identity_for_caller`). `resolveIdentity(db, host, { email })` lit cet
identifiant dans la session.

## Installer dans une application

Pour une application Next 15 (App Router) sur Supabase.

1. Installer une version exacte ; Renovate la fera monter ensuite :

   ```bash
   pnpm add @otomata_tech/oto_platform@<version exacte>
   ```

   Dépendances pairs, à installer dans l'application : `next` 15, `react` et `react-dom` 19,
   `@supabase/supabase-js` 2, `@phosphor-icons/react` 2, `zod` 3 (3.25 au moins),
   `react-hook-form` 7 (7.55 au moins), `@hookform/resolvers` 5. La liste qui fait foi est
   `peerDependencies` dans le `package.json` du paquet.

2. pnpm 12 refuse d'installer une version publiée trop récemment (`minimumReleaseAge`). Pour
   recevoir chaque version dès sa publication, exclure le paquet de ce délai dans le
   `pnpm-workspace.yaml` de l'application :

   ```yaml
   minimumReleaseAgeExclude:
     - "@otomata_tech/oto_platform"
   ```

3. `next.config.ts` : le paquet est publié en sources TypeScript, Next le transpile ; et Next réécrit
   chaque import de `@otomata_tech/oto_platform/ui` vers le module de l'export nommé. Sans cette
   réécriture, un layout ou une page qui importe de `/ui` charge le code client de tous les écrans
   (éditeur, zod) : 337 kB de JavaScript sur `/login`, 151 kB avec elle. Le sous-chemin exact : le nom
   du paquet seul ne couvre pas `/ui`.

   ```ts
   transpilePackages: ["@otomata_tech/oto_platform"],
   experimental: { optimizePackageImports: ["@otomata_tech/oto_platform/ui"] },
   ```

4. `src/app/globals.css`, après `@import "tailwindcss";` : Tailwind lit les classes des écrans
   du paquet, et leurs tokens se chargent une fois.

   ```css
   @source "../../node_modules/@otomata_tech/oto_platform/ui";
   @import "@otomata_tech/oto_platform/ui/styles.css";
   ```

5. Variables d'environnement de l'application : `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL`. Jamais de clé service dans
   l'application : le paquet travaille sous l'appelant vérifié de la session, sous RLS.

   Et `PLATFORM_DATABASE_URL`, la connexion du serveur du paquet à la base (port de base, ADR-012),
   **exigée dès la version qui passe un premier service en SQL** ; sans elle, ces services lèvent
   `PlatformConfigError`. Avant : une fois, `oto-platform db prepare` sur le projet (section
   « Installer sur un Postgres sans Supabase », point 2 : sur Supabase, elle ne crée que les rôles
   `platform_app` et `platform_server`). La valeur : l'URL du pooler en mode transaction (port 6543, utilisateur
   `platform_app.<ref du projet>`, mot de passe de `PLATFORM_APP_PASSWORD`), dans l'environnement
   serveur de l'application seulement, jamais en `NEXT_PUBLIC_`. Le rôle `platform_app` ne peut que
   devenir `authenticated`, `anon` ou `platform_server` : chaque requête porte l'appelant vérifié, sous RLS ;
   `platform_server` (`nologin`, membre d'`authenticated`) écrit en plus ce que le serveur seul affirme (marque
   d'un compte, compte lié chez un tiers, fichier prêt, état d'un compte). TLS est
   exigé hors de la machine locale.

   Et `PLATFORM_VAULT_KEY` dès qu'un compte réel de connecteur se pose (« Connecteurs réels et coffre »),
   `PLATFORM_PSEUDONYM_KEY` dès que vous déclarez vos personnes (« Pseudonymiser les personnes »).

6. Routes à monter : celles de `src/app/` de l'application de base du dépôt
   [`oto-now/oto-core`](https://github.com/oto-now/oto-core), qui en est la
   référence. Les écrans s'y montent à l'un des trois niveaux de « Monter les écrans ».

   Toute adresse est en anglais (routes, paramètres, ancres), quelle que soit la langue de l'écran ; le
   préfixe de l'API des écrans est `PLATFORM_API_PREFIX` (`/api/platform/`, `@otomata_tech/oto_platform/schemas`),
   que la porte, le client des écrans et les liens de fichiers lisent : la route de l'hôte se monte sous lui.

   Routes de `/api/platform/*` des gestes du rail et du partage public, servies par la même route
   de l'hôte :
   - `GET nodes/links?path=` : liens sortants et entrants d'un nœud (« Contenus liés »).
   - `GET nodes/impact?path=&new_path=` : qui gagne, perd ou change d'accès si le nœud se déplace.
   - `POST nodes/position` `{ path, after }` : range un nœud juste après un frère (`null` : en tête).
   - `POST nodes/duplicate` `{ path }` : copie le nœud et son sous-arbre, juste après lui ; les fichiers joints
     que ses blocs publiés citent sont copiés sous des identifiants neufs (objets copiés dans le bucket).
   - `POST nodes/access` `{ path, access, level? }` : accès général, `organisation` (niveau `read`,
     `write` ou `manage`, `read` par défaut ; `manage` à l'administrateur) ou `restricted`.
   - `GET trash`, `POST trash` `{ path }`, `POST trash/restore` `{ path }` : la corbeille (30 jours) ; la
     purge supprime aussi les fichiers joints des nœuds purgés et leurs objets.
   - `GET shares?path=`, `GET shares`, `POST shares` `{ path, include_children? }`, `DELETE shares/<id>` :
     les liens publics d'un nœud, ceux de l'organisation (administrateur).
   - `GET public/<jeton>?path=` : la lecture publique d'un lien, **hors session** (la route de l'hôte la
     passe au paquet sans jeton), toujours `X-Robots-Tag: noindex, nofollow` ; la page `/p/<jeton>` de
     l'hôte peut aussi appeler `readPublicNode` directement.

   Aperçu d'un lien collé dans une messagerie (E11-S21) : `app/opengraph-image.tsx` rend
   `new ImageResponse(<ImageDePartage donnees={await shareImageData(requestHost(await headers()))} />, TAILLE_DE_PARTAGE)`
   (l'organisation de l'adresse seule), `app/p/[jeton]/share-image/[[...chemin]]/route.tsx` la même chose avec
   `{ token, path }` (le contenu du lien) ; le middleware laisse passer `/opengraph-image` ; le `generateMetadata` du
   layout racine étend `metadonneesDePartage({ organisation, origine })`, celui de la page publique
   `metadonneesDePartage({ organisation, page })`. Les trois s'importent de `@otomata_tech/oto_platform/share`, sans
   code client : importés de `/ui` par `app/opengraph-image.tsx`, fichier du segment racine, ils mettraient le code
   client de toute la face (éditeur, zod) dans le JavaScript de toutes les pages. Les fichiers de l'hôte de
   référence (`src/`) servent de modèle.

7. Réglages d'Auth du projet Supabase, une fois les migrations appliquées : depuis un clone du dépôt
   `oto-now/oto-core`, `pnpm auth:settings --to <ref> --site-url <url> --redirect <motif>`
   montre l'écart avec les réglages de la plateforme (hook d'inscription, serveur OAuth, adresses,
   emails, SMTP hors mot de passe) ; `--apply` l'écrit, et la commande liste ce qui reste à poser à
   la main.

8. Data API du projet Supabase : `platform` n'y est pas exposé. Le paquet le lit par
   `PLATFORM_DATABASE_URL` ; exposé, le schéma resterait lisible et modifiable par PostgREST sous le
   seul jeton d'une personne, que seule la RLS d'isolation borne. Une fois l'application passée à une
   version du paquet qui ne lit plus `platform` par PostgREST, retirer `platform` des schémas exposés
   (Settings → Data API → Exposed schemas), ou, depuis un clone du dépôt,
   `pnpm data-api:close --to <ref>` (l'écart), puis `--apply` (l'écriture, la relecture et le contrôle :
   `/rest/v1/nodes` sous `Accept-Profile: platform` est refusé). Jeton de gestion :
   `SUPABASE_ACCESS_TOKEN`, jamais affiché.

9. Fichiers joints (facultatif, ADR-016) : un stockage d'objets compatible S3, par cinq variables de
   l'environnement serveur, `PLATFORM_STORAGE_ENDPOINT` (le point d'accès, sans le bucket),
   `PLATFORM_STORAGE_BUCKET`, `PLATFORM_STORAGE_REGION`, `PLATFORM_STORAGE_ACCESS_KEY_ID` et
   `PLATFORM_STORAGE_SECRET_ACCESS_KEY`. Les cinq, ou aucune : sans elles, les fichiers sont désactivés
   (`GET files` rend `{ enabled: false }`, tout envoi est refusé par `not_enabled`) et tout le reste
   fonctionne. Les octets ne passent jamais par l'application : le navigateur envoie au bucket par une URL
   présignée de 5 minutes, et lit par une redirection vers une URL présignée de 60 secondes.
   - Bucket **privé**, sans ACL publique ; clés d'accès S3 limitées à ce bucket quand le fournisseur le
     permet (AWS, Scaleway, MinIO). Supabase Storage se branche par son point d'accès S3
     (`https://<ref>.supabase.co/storage/v1/s3`, région du projet) et des clés d'accès S3 créées dans
     Storage → S3 Access Keys, jamais la clé `service_role` : ces clés valent pour **tous les buckets du
     projet**, aucune ne se limite à un bucket.
   - CORS du bucket : `PUT` et `GET` depuis l'origine de chaque adresse de l'application, en-tête
     `content-type` admis.
   - CSP de l'application, si elle en pose une : `img-src` et `connect-src` admettent l'origine du bucket.
   - Routes de `/api/platform/*` : `GET files` (l'état du stockage) ; `POST files`
     `{ node, name, mime, size }` (la demande d'envoi : droit d'écrire le nœud, type par l'extension du nom,
     50 Mo, 4 Mo pour `html`, `md`, `txt` et `csv`, 10 Go par organisation) ; `POST files/<id>/complete`
     `{}` (la confirmation, après l'envoi) ; `GET files/<id>[?disposition=inline]` (redirection 302 ;
     `inline` pour une image matricielle, et sur demande pour un PDF, un `txt` ou un `csv`, `attachment`
     pour tout le reste) ; `GET files/<id>?check` (`{ data: { available } }`, sans redirection : le stockage
     sert-il encore l'objet ?) ; `GET files/<id>/markdown` (les blocs d'un `.md`) ; `GET files/<id>/html` (la route
     isolée d'un fichier HTML, ADR-017). Par un lien public, sans session : `GET public/<jeton>/files/<id>`,
     `…/markdown` et `…/html`, pour un fichier cité par un bloc publié du contenu partagé. Fichier en transit (sans
     nœud, entre une personne et un connecteur) : `POST transit-files` `{ name, mime, size }` (types d'un fichier joint,
     50 Mo pour tout type, texte compris, compté au quota ; rend `{ id, upload, expiresAt }`, une heure),
     `POST transit-files/<id>/complete` `{}` et `GET transit-files/<id>` (redirection 302) ; lisible par son seul
     auteur, `not_found` pour toute autre personne, administrateur et équipe plateforme compris ; au journal de
     l'organisation, l'identifiant, la taille et le type MIME seuls, jamais le nom, et un refus par son seul code.
   - « Voir » d'un fichier `html` ou `md` ouvre la visionneuse à l'adresse du contenu, `?view=<id>` : la page de
     l'hôte passe `fileView` (`/n/<chemin>`) ou `publicFileView` (`/p/<jeton>/<chemin>`, avec
     `routeDesFichiers={publicFilesRoute(<jeton>)}`) à l'écran. Un fichier HTML s'y exécute dans une iframe
     `sandbox` sans `allow-same-origin`, chargée depuis la route isolée, qui pose elle-même sa CSP, `nosniff`,
     `Referrer-Policy: no-referrer` et `frame-ancestors 'self'`. L'hôte **exclut ces deux routes**
     (`/api/platform/files/<id>/html` et `/api/platform/public/<jeton>/files/<id>/html`) de son
     `X-Frame-Options` et de sa `Referrer-Policy` globaux, et de toute CSP globale (`next.config.ts` de l'hôte de
     référence : une source `/((?!api/platform/(?:public/[^/]+/)?files/[^/]+/html/?$).*)`). Sa propre CSP, s'il en
     pose une sur ses pages, admet `frame-src 'self'`.
   - Dépôt par lien à usage unique (ADR-018) : `upload.link`, derrière `call`, rend à un assistant une adresse
     `POST /api/platform/uploads/<jeton>`, servie **sans session** (le ticket en tient lieu : 15 minutes, un envoi,
     1 Mo, le droit relu à l'envoi), en texte brut ; une requête qui porte un en-tête `Origin` y est refusée, et
     l'hôte n'y pose aucun CORS. Pour un assistant sans shell, un formulaire : l'hôte sert la page
     `/upload/<token>`, sous session, qui passe `uploadForm(db, identity, token)` à `EcranDeDepot` (phrases :
     `REFUS_DU_DEPOT`) ; l'écran envoie le fichier à `POST /api/platform/uploads/<jeton>/form` (à session, même
     origine). Le formulaire a son propre jeton, distinct de celui de `curl` : chacun n'ouvre que sa route, et le
     ticket sert une fois, par l'un ou par l'autre. `upload.link` peut aussi télécharger une adresse `https` publique (`source_url`) : la seule requête
     du paquet vers une adresse choisie par un appelant, adresses privées et de métadonnées refusées.

## Émetteur d'identité : trois combinaisons

Un hôte, un émetteur. Sans `PLATFORM_OIDC_ISSUER`, c'est Supabase Auth du projet, comme avant ; avec
elle, un émetteur OpenID Connect (Logto, Keycloak), dont le paquet lit les clés par la découverte, et
dont chaque jeton doit porter dans `aud` `PLATFORM_OIDC_AUDIENCE`, ou, sur `/api/mcp` et
`/api/mcp-admin`, la ressource que les métadonnées annoncent pour l'adresse appelée (RFC 8707 ; chez
Logto, une ressource d'API déclarée par adresse et par MCP). Une personne y entre par
invitation : son sujet chez l'émetteur est relié à un identifiant interne à sa première requête, par
l'email vérifié de l'invitation (ou de l'équipe plateforme). Les métadonnées de ressource protégée
annoncent l'émetteur aux assistants, qui s'y enregistrent et y consentent.

| Hôte | Variables | Côté émetteur |
|---|---|---|
| Supabase | `PLATFORM_DATABASE_URL`, en plus des variables Supabase (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`) | Réglages d'Auth reproduits (`pnpm auth:settings` : hook, serveur OAuth, adresses de retour) |
| Postgres nu + Logto | `PLATFORM_DATABASE_URL`, `PLATFORM_OIDC_ISSUER` (`https://<logto>/oidc`), `PLATFORM_OIDC_AUDIENCE`, le client web et le secret de session de l'hôte (`PLATFORM_OIDC_CLIENT_ID`, `PLATFORM_OIDC_CLIENT_SECRET`, `PLATFORM_SESSION_SECRET`), `PLATFORM_SMTP_URL` et `PLATFORM_MAIL_FROM` (invitations) | Application web confidentielle (adresse de rappel exacte par adresse de l'hôte : Logto n'admet pas de motif) ; ressource d'API = l'adresse du MCP ; clients des assistants (« dynamic apps ») ; email vérifié exigé |
| Postgres nu + Keycloak | Mêmes variables (`PLATFORM_OIDC_ISSUER` : `https://<keycloak>/realms/<realm>`) | Client web confidentiel (adresse de rappel exacte par adresse de l'hôte : Keycloak n'admet aucun motif d'hôte, `*` seulement en fin de chemin) ; enregistrement des clients des assistants (anonyme sur hôtes de confiance ; Client ID Metadata Documents : fonction expérimentale, coupée par défaut en 26.7) ; audience par mappeur (RFC 8707 : fonction expérimentale, coupée par défaut en 26.7) ; « Verify email » activé |

`PLATFORM_OIDC_ISSUER` s'écrit exactement comme l'émetteur l'écrit dans `iss` (barre finale
comprise), en `https`. L'émetteur ne marque `email_verified` que pour une adresse réellement
vérifiée : l'invitation et l'équipe plateforme relient une personne par cet email. Avec un émetteur
OIDC :

- **Invitations** : la plateforme envoie elle-même l'email, au nom affiché et au logo de
  l'organisation, avec un lien vers `/login` de l'adresse d'où l'on invite, par le relais SMTP de
  l'hôte. `PLATFORM_SMTP_URL` : `smtps://<utilisateur>:<mot de passe>@<relais>:465`, ou
  `smtp://…:587`, TLS exigé dans les deux cas (STARTTLS demandé, l'envoi refusé sans lui) ;
  `?requireTLS=false` en fin d'adresse, pour un relais de développement local seulement.
  `PLATFORM_MAIL_FROM` : l'expéditeur (`Invitations <invitations@exemple.fr>`), sur un domaine
  qui publie SPF et DKIM pour ce relais. Une variable qui manque refuse l'invitation en la nommant,
  sans rien créer ; un relais qui refuse retire l'invitation. Sur Supabase, Supabase envoie le lien
  magique, comme avant.
- **Équipe plateforme** : `pnpm platform:staff add <email>` crée la ligne par son email, sans compte
  Supabase ; la personne entre au MCP admin avec un jeton dont l'email vérifié est celui-là.
- **Équipe plateforme, retour d'une personne retirée** : `pnpm platform:staff add <email> --user <identifiant>`
  reprend l'identifiant interne auquel son sujet reste lié dans `platform.identities` ; un identifiant
  inconnu de l'émetteur est refusé, sans rien écrire.
- **Consentement** : chez l'émetteur ; la page de consentement de Supabase ne sert pas.

## Monter les écrans : trois niveaux

`@otomata_tech/oto_platform/ui/styles.css` charge le design system porté d'oto-frontend (jetons,
huit thèmes, grammaire d'îlots, composants, polices Inter et JetBrains Mono servies avec le paquet),
sous une racine `.oto` : `CoquilleOto`, que l'hôte pose une fois, au thème de l'organisation
(`readBrand(identity.org).theme`) ; la nuit suit la classe `.dark` de l'hôte. Les écrans n'importent
aucun routeur : l'hôte leur prête, dans un composant client, son lien, l'adresse courante, sa
navigation et sa déconnexion (`ContexteDeLHote`), et sa relecture (`ContexteDeRafraichissement`) :

```tsx
"use client"
// Dans Next : next/link, usePathname, useRouter ; ailleurs, le lien et la navigation du routeur de l'ERP.
<ContexteDeRafraichissement.Provider value={() => router.refresh()}>
  <ContexteDeLHote.Provider value={{ Lien: Link, chemin: usePathname(), naviguer: (a) => router.push(a), deconnecter }}>
    {children}
  </ContexteDeLHote.Provider>
</ContexteDeRafraichissement.Provider>
```

Une seule coque est visible, quel que soit le niveau choisi :

1. **La coque entière**, pour une section « plateforme » de l'ERP : le layout pose le bureau, le rail
   et le contenu. Le rail reçoit ses données, lues par le layout sous le jeton de la session
   (`visibleTree`, les équipes de `listTeams` réduites à `{ slug, name }`, l'identité, le nom affiché et
   le logo de la marque), et les adresses des écrans que l'hôte sert (une adresse absente retire son
   entrée ; `profil` et `corbeille` vont au menu du compte, `connecteurs` au pied du rail). La couleur est
   celle de la personne, sinon celle de l'organisation (`preferredTheme`) :

   ```tsx
   <CoquilleOto theme={preferredTheme(identity)} pleinePage>
     {/* le fournisseur ci-dessus */}
     <Desk>
       <RailApplication entreprise={…} arbre={…} equipes={…} handle={…} compte={…} administre={isOrgAdmin(identity)} adresses={{ pages: "/n/", profil: "/profile", … }} />
       <Content>{children}</Content>
     </Desk>
   </CoquilleOto>
   ```

2. **Les morceaux du rail dans la barre latérale de l'ERP**, sans second rail : `EntrepriseDuRail`
   (l'organisation et son menu), `RechercheDuRail` (« Rechercher », ⌘K et la palette),
   `SectionsDuRail` (Tout le monde, les équipes, Privé : le Contexte en tête, l'arbre, ses menus
   « ⋯ » et « + »), `PiedDuRail` (Connecteurs, le compte et son menu), sous une `CoquilleOto` et le même
   fournisseur ; les primitives qui les composent sont exportées aussi (`Desk`, `Content`, `Rail`,
   `RailSection`, `RailTree`, `RailItem`, `DropdownMenu`), à employer dans un composant client : elles
   reçoivent des fonctions. Leurs gestes passent par l'API du paquet (`/api/platform/*`, même
   origine).

3. **Un écran seul** dans une page de l'ERP (la grille d'un tableau dans une fiche client) : l'écran
   exporté (`TableauDuNoeud`, `EcranDeNoeud`…), sous une `CoquilleOto`, avec ses données lues par la
   page ; ses liens reçoivent le lien de l'hôte par props (`Lien`, `hrefDuChemin`).

## Installer sur un Postgres sans Supabase

Le schéma `platform` s'installe aussi sur un Postgres sans Supabase, un Postgres managé par
exemple : ses migrations partent d'une ligne de base sans table `auth.users` ni extension
`moddatetime`. Le serveur du paquet s'y connectera par un pilote Postgres et par l'émetteur
d'identité de l'hôte dans une version prochaine, qui en portera le guide complet. Pour la base :

1. Extensions : l'hôte admet `pg_trgm`, `unaccent` et `ltree`, les trois seules que le paquet
   demande.
2. Une fois, par un rôle d'administration de la base (`CREATEROLE`, droit de créer un schéma) :

   ```bash
   # PLATFORM_ADMIN_DATABASE_URL='<url>?sslmode=require' dans l'environnement, chargée d'un fichier non commité
   PLATFORM_APP_PASSWORD='<mot de passe>' pnpm exec oto-platform db prepare
   ```

   L'adresse de la base se lit dans `PLATFORM_ADMIN_DATABASE_URL`, mot de passe compris, ou par
   `--db-url <url>` sans mot de passe, celui-ci dans `PGPASSWORD` (`.pgpass` n'est pas lu) : un
   argument se lit dans `ps` et dans l'historique du shell. Une `--db-url` qui porte un mot de passe
   (`admin:…@`, vide compris, ou `?password=`) est refusée, comme les deux adresses à la fois ou aucune
   (code 2) ; de même pour `accounts secret`, `journal purge` et `org delete`.

   Elle crée les rôles `anon` et `authenticated`, le schéma `auth` réduit à `uid()`, `jwt()` et
   `role()` (lus dans `request.jwt.claims`), le schéma `extensions` et ses trois extensions, et le
   rôle `platform_app`, la connexion du serveur, dont le mot de passe vient de
   `PLATFORM_APP_PASSWORD` (jamais affiché), et le rôle `platform_server` (`nologin`), qu'elle accorde à
   `platform_app`. Un second passage ne change rien ; une extension
   refusée arrête la commande en la nommant. Sur Supabase, elle ne crée que `platform_app` et
   `platform_server`. La
   connexion passe en TLS, sauf `sslmode` écrit dans l'URL (`?sslmode=disable` pour un Postgres
   local sans TLS).
3. Les migrations, comme sur Supabase (section « Migrations ») : `migrations sync`, puis
   `supabase db push --db-url '<url>?sslmode=require'` ou le workflow de l'hôte.

Une personne se supprime par l'outillage : `select platform.forget_user('<id>');`, par le rôle
d'administration de la base (sur Supabase, la clé de service), retire ce qui lui appartient dans
`platform` (appartenances, accès, espace personnel) et efface son identifiant des lignes qu'elle a
écrites, avant la suppression de son compte chez l'émetteur ; ses limites sont dans
`migrations/README.md` (« Supprimer une personne »).

## Fonctions métier

Un ERP ajoute ses fonctions métier (lire un client, créer une facture) au catalogue de la
plateforme : elles se trouvent par `find`, se lisent par `read` et s'exécutent par `call`, comme
les fonctions natives, sans outil de plus. Un besoin nouveau devient une fonction, jamais un outil.

- **Où** : `src/lib/fonctions-metier.ts` de l'application, qui appelle une fois
  `registerFunctions([...])` de `@otomata_tech/oto_platform/server`. Chaque appel remplace toute la
  liste. Ce fichier est importé pour son effet, en tête de chaque route qui monte une porte du
  paquet : `src/app/api/mcp/route.ts`, `src/app/api/platform/[...route]/route.ts` et
  `src/app/api/mcp-admin/route.ts` (`import "@/lib/fonctions-metier"`). Chaque route est un bundle
  à part : une route qui l'oublie sert un catalogue sans ces fonctions. Une page de l'application
  qui appelle elle-même un service qui lit le catalogue (`checkProcedure` ou `checkProcedureBlocks`
  pour contrôler une procédure, `readNode` sur une fonction) l'importe aussi.
- **Déclaration** : `defineErpFunction({ name, class, description, schema, examples, refusals?,
  next?, run, summarize? })`. Le nom est `<espace>.<nom>` : deux parties qui commencent chacune par
  une lettre, en minuscules ASCII, chiffres et `_` (64 caractères au plus), dans un espace que ni le
  paquet (`table`, `mail`) ni les contrats (`write`) n'occupent. Le schéma est un `z.strictObject`
  de `zod/v4` (`import * as z from "zod/v4"`), comme chaque objet qu'il imbrique : une clé inconnue
  est refusée à tout niveau, pas ignorée (un `z.record` garde ses clés libres). Le contrat sert son
  JSON Schema côté entrée, ce que le modèle écrit : un champ à `.default()` y est facultatif ; ce que
  JSON Schema n'écrit pas (`z.date()`, `z.bigint()`, `z.map()`, `z.custom()`) est refusé à
  l'inscription. Au moins un exemple, chacun accepté par le schéma. La description, en anglais, dit
  d'abord ce que fait la fonction (1 000 caractères au plus). Classe `read`, `write` ou `sensitive` ;
  une fonction `sensitive` (envoyer, supprimer, payer) déclare `summarize`, le récapitulatif montré
  avant l'accord de la personne, et ne court qu'avec `confirm: true`. `next` ne cite que des
  fonctions du catalogue ; une fonction sensible n'y est jamais proposée.
- **Refus** : une liste mal déclarée lève `CatalogRegistrationError` au chargement de la route, et
  rien n'est inscrit.
- **Exécution sous le jeton de l'appelant** : `run(ctx, args)` reçoit des arguments validés et
  `ctx = { db, identity, accessToken }`. Les données de l'ERP se lisent et s'écrivent par un client
  Supabase construit sur `ctx.accessToken` (en-tête `Authorization`), donc sous la RLS de l'ERP.
  `ctx.db` est le client du schéma `platform`, jamais celui des données de l'ERP : il ne sert qu'à
  appeler les services du paquet avec `ctx.identity`, qui décident les droits et bornent
  l'organisation, jamais à lire les tables de `platform`, dont la RLS ne sépare que les organisations
  dont la personne est membre. L'organisation de l'appel est celle de l'adresse appelée
  (`ctx.identity.org`), pas celle du jeton : un ERP qui sert plusieurs organisations borne ses
  données à celle-ci. Aucun compte n'est résolu ; l'équipe de l'appel, au journal, est celle que la
  plateforme calcule.
- **Erreurs** : une `PlatformError` levée par `run` est servie telle quelle au modèle
  (`new PlatformError("not_found", "Unknown customer C-999.")`), sauf `internal`, servie comme la
  panne générique, sa cause écrite au log serveur. Toute autre erreur est servie comme une panne
  interne, sans son texte, et journalisée côté serveur. Une erreur de la base de l'ERP passe par
  `fromDatabaseError(error, "<fonction>: <table>")` : une écriture que sa RLS refuse devient
  `forbidden`, un jeton refusé `unauthorized` (une session à reprendre, pas une panne), le reste une
  panne ; seul son code part au log, jamais le message de la base.
- **Contrat** : une fonction ERP est toujours active, pour toute l'organisation ; la description de
  `call` ne la cite pas, `find` la trouve. Un contrat servi ne se durcit pas en place : une fonction
  dont les arguments changent s'inscrit sous un autre nom.

### Choisir l'adresse servie au MCP (previews, ERP sur un seul domaine)

Par défaut, l'organisation est celle de l'adresse appelée. Une preview a une adresse nouvelle à chaque déploiement, et un ERP peut n'avoir qu'un domaine : l'hôte passe alors **la même fonction** aux trois points qui lisent l'organisation.

```ts
import type { ServedHost } from "@otomata_tech/oto_platform/server"

// L'adresse déclarée dans `org_domains` que cette application sert ; `null` : aucune organisation (404).
export const adresseServie: ServedHost = ({ host }) => (process.env.APP_ENV === "production" ? host : "staging.acme.fr")

handleMcpPost(request, { verifyToken, defer, host: adresseServie })   // app/api/mcp/route.ts
handleResourceMetadata(request, { host: adresseServie })             // route des métadonnées OAuth
consentRequest({ auth, db, host: adresseServie }, authorizationId)   // page de consentement (mode Supabase)
```

La fonction reçoit `{ host, request? }` : l'adresse appelée, normalisée, et la requête (absente au consentement, qui lit l'adresse de la ressource demandée). L'option ne choisit qu'une adresse : le jeton est vérifié avant, l'appartenance est relue à chaque appel, l'origine du 401 et de `resource` reste l'adresse appelée. Une exception de la fonction répond 503 ; aucune organisation n'est servie par défaut. Le MCP admin n'a pas cette option.

### Lecteurs de fichiers

Un assistant lit le texte d'un fichier joint par `read {path, file}` : le paquet lit `html`, `md`,
`txt`, `csv` et `xlsx` ; un hôte inscrit les lecteurs des formats que lui seul sait lire (un plan, un
modèle 3D), comme ses fonctions métier.

```ts
import { defineReader, registerReaders } from "@otomata_tech/oto_platform/server"

registerReaders([
  defineReader({
    types: [{ extension: "dxf", mime: "image/vnd.dxf" }],
    read: async ({ name, bytes, signal }) => {
      const plan = await lirePlan(bytes, { signal })           // le programme de l'hôte
      if (!plan) return { status: "unsupported", detail: "this DXF version is not read" }
      return {
        title: plan.titre,                                       // 200 caractères au plus
        summary: `${plan.niveaux.length} levels.`,               // 300 au plus
        parts: plan.niveaux.map((n) => ({ name: n.nom, chars: n.texte.length })),
        text: (part) => plan.niveaux.find((n) => n.nom === part)?.texte ?? "",
      }
    },
  }),
])
```

- **Où** : dans le même fichier importé pour son effet que `registerFunctions`, en tête de chaque
  route qui monte une porte du paquet (`api/mcp`, `api/platform/[...route]`). Chaque appel remplace
  toute la liste ; une liste fausse lève `TypeError` au chargement, et rien n'est inscrit.
- **Ouverture au dépôt** : un type inscrit, et lui seul, s'ouvre au dépôt (demande d'envoi, lien
  d'envoi, envoi par le serveur, fichier en transit), sous la borne de 50 Mo ; le type MIME déclaré
  est celui que l'URL d'envoi signe. Sans lecteur, un type hors de la liste du paquet reste refusé.
  Le fichier se sert toujours en téléchargement, jamais en place. L'éditeur de pages ne propose pas
  encore ces types : ils se déposent par l'API.
- **Refus à l'inscription** : un type du paquet (`md`, `pdf`…), une extension de page, de script ou
  de programme (`html`, `svg`, `js`, `exe`, `docm`…), une extension lue par deux lecteurs, et un type
  MIME qu'un navigateur rend en page ou exécute (`text/html`, `image/svg+xml`, `application/xml`,
  JavaScript, `application/wasm`).
- **Contrat** : `read` reçoit le nom d'origine, les octets (50 Mo au plus) et un signal levé à
  l'échéance de 10 secondes, qui couvre aussi chaque `text(part)` ; un lecteur asynchrone est
  abandonné à l'échéance, un calcul synchrone n'est pas interrompu mais rend `timeout`. Il rend le
  document, ou un statut de `READER_STATUSES` (`unsupported`, `encrypted`, `empty`, `too_large`,
  `rejected_dtd`, `failed`, `timeout`), servi à l'assistant en refus ; `text(part)`, qui rend une
  chaîne, dit un statut en levant `ReaderStatusError`. Les noms de parties sont
  uniques (1 à 200 caractères) : l'assistant les passe à `section`. Une erreur levée ou une forme
  fausse vaut `failed`, la cause au log serveur. Le caractère NUL est retiré, le texte coupé à
  2 millions de caractères ; un lecteur qui décompresse s'arrête à
  `READER_LIMITS.decompressedBytes` (64 Mo).
- **Ce que voit l'assistant** : au-delà de 12 000 caractères et d'une partie, le plan (les parties
  et leur taille) ; `section` en sert une, `"*"` tout le texte, coupé par le curseur au-delà de
  45 000 caractères. La pseudonymisation et `fileContents: "metadata"` s'appliquent comme au texte
  d'un fichier du paquet.
- **Tableur (`xlsx`)** : une partie par feuille, nommée par la feuille (« (hidden) » pour une
  feuille cachée), en CSV : la valeur gardée des formules, les dates en ISO, une cellule fusionnée à
  son coin. Le lecteur court dans un `worker_threads` (256 Mo de tas, environnement vide) que
  l'échéance termine ; son script est livré en texte dans le paquet et lancé par `eval` : rien à
  configurer chez l'hôte, ni en développement, ni dans un build `output: "standalone"`. Un classeur
  protégé par mot de passe rend `encrypted`, une archive qui dépasse 64 Mo décompressés `too_large`,
  un `<!DOCTYPE>` `rejected_dtd`. Chaque lecture lance un worker, terminé une seconde après sa
  dernière réponse ; deux au plus tournent par processus (`READER_LIMITS.workers`), une lecture de
  plus attend son tour dans son échéance, puis rend `timeout`. Le script évalué est celui du
  paquet, assemblé au build : le contenu du fichier lui passe en données, jamais en code.

## Connecteurs réels et coffre

Le paquet porte un connecteur simulé, `mail` (rien ne sort du serveur), et le moteur qui exécute les connecteurs
réels que l'application lui déclare ; il n'en contient aucun. Un connecteur réel court sur un compte réel (mode
`reel`) qui garde tous les champs de secret que déclare son connecteur (une clé, un identifiant et un secret de
client…), chiffrés ensemble par le coffre du paquet (AES-256-GCM, données associées = l'id du compte et la colonne),
et ses réglages non secrets (région, sous-domaine, adresse), en clair ; le secret est déchiffré par le serveur de
l'application pour le seul appel au tiers : il ne revient jamais vers un écran, le modèle, le journal ni un log.

### Déclarer ses connecteurs

L'application déclare les connecteurs qu'elle utilise par `registerConnectors`, dans le module que chaque route qui
monte une porte du paquet importe pour son effet (comme `registerFunctions`, et avant lui) :

```ts
// src/lib/fonctions-metier.ts
import { registerConnectors, registerFunctions, type ConnectorDefinition } from "@otomata_tech/oto_platform/server"
import { notion, pennylane } from "<sortie TypeScript de la fabrique du dépôt connectors, épinglée à un commit>"

const monApi: ConnectorDefinition = { name: "monapi", label: "Mon API", baseUrl: "https://api.example.fr/v1", /* … */ }

registerConnectors([notion.connector, pennylane.connector, monApi])
registerFunctions([/* fonctions de l'ERP */])
```

- **Connecteurs partagés** : les définitions générées par la fabrique du dépôt `connectors` (`ts/src/`), passées
  telles quelles ; le paquet n'en dépend pas, il accepte toute définition de même forme (`ConnectorDefinition`).
- **Connecteurs propres** : une définition écrite à la main dans la même forme (adresse, authentification, table
  d'erreurs, fonctions avec leur JSON Schema d'entrée strict, exemples, requête).
- **Ce que le moteur exécute** : authentification `api_key` (en en-tête ou en query, la clé alors absente de tout
  log), `bearer`, `basic`, `oauth2_client_credentials` (jeton échangé, rangé chiffré sur la ligne du compte, renouvelé
  à son échéance et une fois après un 401), `oauth2_user` (le consentement d'une personne, ci-dessous) ; adresse fixe, par région (`baseUrls`) ou en gabarit sur un réglage
  (`https://{domain}.example.net`, `{server}/v1`), une adresse saisie ne joignant jamais un hôte interne ; `GET`, `POST`, `PUT`, `PATCH`, `DELETE` ; en-têtes et constantes ; listes en query ; arguments encodés
  en JSON ; pagination (`all_pages`) ; contrôles avant l'appel et sur la réponse ; débit du tiers par compte et nouvel
  essai après un 429 ; délai de chaque requête, celui de la fonction si elle déclare le sien (`timeoutMs`), sinon
  celui du connecteur. Le JSON Schema d'entrée est validé et servi tel quel.
- **Coût d'un appel** : `cost` (pire cas avant l'appel, à la requête, à l'élément ou au poids des valeurs que liste chaque
  élément, quantité relue après) et `async` (travail soumis, relevé plus tard, avec ou sans échéance) sont contrôlés à la déclaration, sans rien réserver ni régler ; `costOf`, `settledQuantity` et `collectionOf`
  (face `server`), fonctions pures, en donnent le pire cas, la quantité à régler et la relève à votre service.
- **Fichiers envoyés à un tiers** : `request.files` envoie en `multipart/form-data` un fichier en transit de la
  personne qui appelle, lu sous son identité et consommé après un appel réussi ; l'agent ne passe que son identifiant.
- **Refus** : une définition invalide (champ ou réglage mal déclaré ; schéma non strict ; espace de noms déjà servi…)
  lève `CatalogRegistrationError` au chargement de la route, qui la nomme, et rien n'est déclaré.
- **Base** : aucun SQL à écrire ; le paquet ajoute le nom d'un connecteur déclaré à `platform.connectors` à sa
  première activation ou à son premier compte (migration `20261007090000_platform_connecteurs_declares.sql`) ; les
  champs, réglages et jeton d'un compte vivent sur sa ligne (migration `20261008090000_platform_comptes_a_champs.sql`).

### Consentement d'une personne (`oauth2_user`)

Un connecteur `oauth2_user` (Microsoft 365, par exemple) court sur le compte de chaque personne, connecté par son
consentement chez le tiers ; ses appels le prennent sans le nommer, et elle peut le partager comme tout compte
personnel (qui le reçoit le nomme dans `account`). L'application
OAuth (identifiant et secret du client) est la vôtre : enregistrez-la chez le tiers, puis passez-la à
`registerConnectors`, lue par vous, jamais par le paquet :

```ts
registerConnectors([microsoft.connector], {
  oauthApplications: { microsoft: { clientId: process.env.MICROSOFT_CLIENT_ID!, clientSecret: process.env.MICROSOFT_CLIENT_SECRET! } },
})
```

- **Adresse de retour** à déclarer chez le tiers, pour chaque adresse qui sert le consentement :
  `https://<adresse de l'organisation>/api/platform/connector-consent/callback` (`connectorConsentRedirectUri(origin)`).
  La porte du paquet la sert : votre route `/api/platform/[...route]` doit répondre aux `GET` avec la session.
- **Départ** : `startConnectorConsent(db, identity, { connector, return_to? }, { origin })` (face `server`), ou
  `POST /api/platform/connector-consent`, rend `{ url }` ; envoyez-y le navigateur. Au retour, la personne revient à
  `return_to` (un chemin de votre application ; l'écran Connecteurs par défaut) avec `?consent=connected&account=…`
  ou `?consent=failed&reason=<code>`.
- **Écran** : le vôtre ; l'écran Connecteurs du paquet n'en porte que le bouton par défaut « Connecter mon compte ».
- **Base** : migration `20261016090000_platform_consentement.sql` (demandes en cours, droits accordés).
### Compte de l'hôte et compte rattaché (`holder: host`, `accountIdentity`)

Un champ de `credential` marqué `holder: "host"` est le vôtre, une fois pour toutes vos organisations (la clé d'une
messagerie hébergée, par exemple) : passez un lecteur, appelé à chaque appel, jamais gardé par le paquet. Un connecteur
qui déclare `accountIdentity` court sur un compte rattaché chez le tiers, dont l'identifiant (`accounts.linked_id`)
va dans l'adresse de base ; il se branche par un parcours hébergé, que le paquet mène par le port que vous construisez
avec votre clé (`HostedLinkProvider`, face `server`) :

```ts
registerConnectors([messagerie.connector], {
  hostCredentials: { messagerie: () => ({ api_key: process.env.MESSAGERIE_API_KEY! }) },
  hostedLinks: { messagerie: monAdaptateur(process.env.MESSAGERIE_API_KEY!) }, // createLink, listAccounts, probe
})
```

- **Port** : `createLink({ requestId, kind, linkedId?, returnUrl, expiresAt })` rend `{ url }` (https) ;
  `listAccounts()` rend tous les comptes de la clé, toutes pages, du bon fournisseur, `{ id, createdAt }` (ISO 8601
  ou `null`) ; `probe(id)` rend `{ state: "alive", label }`, `{ state: "dead" }` ou `{ state: "unavailable" }`. Une
  méthode qui lève devient `upstream_error`, sans détail.
- **Départ** : `startHostedLink(db, identity, { connector, return_to? }, { origin })`, ou `POST /api/platform/hosted-link`,
  rend `{ url }` ; envoyez-y le navigateur. Le paquet sert le retour (`/api/platform/hosted-link/callback`, en `GET`
  avec la session), lie le compte sur le compte personnel de la personne et revient à `return_to` avec
  `?hosted=connected&account=…` ou `?hosted=failed&reason=<raison>`.
- **Appel** : la personne n'a pas à nommer son compte rattaché, son appel le prend ; elle peut le partager comme
  tout compte personnel (qui le reçoit le nomme dans `account`).
- **Base** : migration `20261017090000_platform_comptes_rattaches.sql`.

- **Sonde** : `probeAccount(db, identity, { account_id })` joue la sonde du connecteur (`probe`) sur un compte, pour
  qui le gère, et rend `{ healthy: true }` ou `{ healthy: false, reason }` ; une sonde à solde (`probe.balance`) y
  ajoute `balance: { value, unit, min }`, non saine sous le seuil, solde absent ou illisible, et pose ou lève la
  marque `quota_exhausted` du compte selon le solde lu.

- **Réservé au serveur** : `registerConnectors(defs, { serverOnly: { <connecteur>: "all" | ["crm.get_contact", …] } })`
  (noms servis), ou `defineErpFunction({ serverOnly: true })` : la fonction est inconnue de l'assistant (ni `find`, ni
  `read`, `call` la refuse comme absente) et courue par `callFunction`. Un nom qu'un connecteur ne sert pas lève
  `CatalogRegistrationError`.
- **Données personnelles au journal** : marquez une propriété d'arguments `.meta({ personal: true })` (Zod) ou
  `personal: true` (JSON Schema d'un connecteur décrit) ; sa valeur n'est jamais journalisée : `[personal]` dans les arguments,
  retirée de la cible et du message d'erreur.
- **Contenu des fichiers** : `registerDataPolicy({ fileContents: "metadata" })` (ou une fonction de l'organisation)
  fait refuser `read {file}` à l'assistant (`file_contents_withheld`) ; nom, taille et type restent servis.
- **Rétention** : migration `20261019100000_platform_retention.sql`, puis, de votre tâche planifiée, sur la connexion
  d'administration : `pnpm exec oto-platform journal purge --journal-days 365 --feedback-days 730`,
  l'URL dans `PLATFORM_ADMIN_DATABASE_URL` (journal et journal de l'équipe plateforme ; tickets `feedback`). Sans durée, rien n'est purgé.
- **Suppression d'une organisation** : `pnpm exec oto-platform org delete --org <slug>` (URL dans
  `PLATFORM_ADMIN_DATABASE_URL`) compte ce qui partirait ; `--yes --by <email>` (un membre de l'équipe plateforme) supprime ses objets du stockage
  (les cinq variables `PLATFORM_STORAGE_*`, ou `--without-storage`), puis toutes ses lignes ; ses lignes du journal de
  l'équipe plateforme restent, anonymisées. Relancez la même commande après un échec.

- **Clé** : `PLATFORM_VAULT_KEY`, 32 octets en base64 (`openssl rand -base64 32`), dans l'environnement serveur de
  l'application, jamais en `NEXT_PUBLIC_`. Lue à l'usage seulement : sans elle, l'application démarre, et poser un
  secret ou appeler un connecteur réel lève `PlatformConfigError` qui la nomme. La changer rend illisibles les
  secrets déjà posés : les reposer.
- **Compte** : à l'écran Connecteurs (un connecteur déclaré y prend des comptes réels, avec leur formulaire), par
  `admin_connector` `create_account` avec `mode: "reel"`, ou par `createAccount` de `/server`. Un compte simulé d'un connecteur réel est refusé
  (`invalid_arguments`), un compte réel ou de bac à sable d'un connecteur simulé aussi (`unavailable_in_v1`).
- **Secret et réglages** : jamais par un outil MCP. À l'écran Connecteurs, « Secret et réglages » sous la ligne d'un
  compte réel : la page passe à l'écran `formulaires: connectorAccountForms()` (de `/server`) dans
  `DonneesDesConnecteurs` ; sans eux, l'écran ne crée que des comptes simulés. L'écran écrit par
  `POST /api/platform/admin/accounts/<id>/secret` (`{ secret?: { champ: valeur | null }, settings?: { réglage:
  valeur | null } }`), réservée à qui gère le compte ; un nom absent est gardé, `null` ou vide l'efface ; le secret
  n'est jamais relu (« posé le … »). Par le service `setAccountSecret(db, identity, { account_id, input })` de
  `/server`, ou par l'outillage, les champs en objet JSON sur l'entrée standard, la clé (`PLATFORM_VAULT_KEY`) et l'URL
  d'administration (`PLATFORM_ADMIN_DATABASE_URL`) dans l'environnement du shell (chargées d'un fichier non commité,
  jamais tapées dans la commande ni passées en argument) :

  ```bash
  pnpm exec oto-platform accounts secret --account <id du compte> --setting region=eu < champs.json
  ```
- **Appel** : un compte réel sans secret, sans un champ qu'exige l'authentification ou dont un réglage manque est
  refusé (`not_enabled`, qui dit à qui demander), un compte simulé d'un connecteur réel aussi ; un 401 ou un 403 du tiers rend `upstream_error`, sauf une ligne qui marque le compte (état d'un compte, ci-dessous), un débit dépassé `rate_limited`.
- **État d'un compte** : une ligne de la table d'erreurs qui marque le compte (`marksAccount`, à condition sur le corps
  ou non, `body`) rend `credential_rejected` (clé refusée) ou `quota_exhausted` (crédits épuisés), au statut 502, et
  marque le compte (`accounts.health.mark`, par `platform.mark_account`) ; le refus dit la marque, sa date et à qui
  demander. Le compte reste résolu et appelé ; le premier appel réussi lève la marque. L'écran Connecteurs la montre
  (`AccountView.mark`), le contexte et `admin_connector accounts` la disent, le journal note `account_marked` et
  `account_mark_lifted` en `args._outcome`. Une écriture de la marque qui échoue laisse l'issue du tiers (un succès
  reste un succès), loggée en erreur et notée `account_mark_failed` ou `account_mark_lift_failed`. Base : migration `20261017150000_platform_etat_des_comptes.sql`.

## Pseudonymiser les personnes

Les noms, courriels, téléphones et adresses des personnes que vous déclarez partent vers l'assistant en jetons
(`client#7k2m9q4x1b3nd`) : résultats et refus des outils MCP, prompts, MCP admin. Le journal et les retours les
gardent pseudonymisés à l'écriture. Les écrans, l'API et `callFunction` restent en clair.

- **Clé** : `PLATFORM_PSEUDONYM_KEY`, 32 octets en base64 (`openssl rand -base64 32`), dans l'environnement serveur
  seulement. Absente, mal écrite ou changée (chaque organisation garde un témoin de la clé), tout appel MCP d'une
  organisation est refusé (`internal`) : rien ne part en clair.
- **Base** : migrations `20261019110000_platform_pseudonymes.sql` et `20261019120000_platform_pseudonymes_lecture.sql`
  (sel et génération par organisation).
- **Déclarer** : au chargement de la route, avec vos autres déclarations.

  ```ts
  registerSensitiveEntities([{
    kind: "client", // a-z0-9, 2 à 10 caractères ; email, phone, iban, nir, card et name sont réservés
    list: async (org) => (await clientsOf(org.id)).map((c) => ({
      id: c.id,
      values: { lastName: c.nom, firstNames: c.prenoms, emails: [c.email], phones: [c.tel], addresses: [c.adresse], aliases: [c.raison_sociale] },
    })),
    read: async (org, id) => valuesOf(await clientById(org.id, id)), // null : la personne n'existe plus
  }])
  ```

  Une déclaration mal formée lève `TypeError`. Option `tokens: "reference"` : chaque entité porte `reference`
  (`c-7k2`, `[0-9a-z][0-9a-z-]{0,23}`, unique, opaque, non séquentielle), corps de son jeton à la place du HMAC ; une
  référence absente, en double ou qui contient le nom, le prénom, le courriel ou six chiffres du téléphone refuse le
  dictionnaire.
- **Allumer par organisation** : `registerSensitiveEntities(kinds, { enabled: async (org) => … })`, lu à chaque appel
  (`org.id`), sans redémarrage ; mettez en cache de votre côté. Sans `enabled`, toutes les organisations sont allumées.
  Éteinte, une organisation est servie comme sans déclaration (en clair, sans avis des jetons), mais une conversation
  commencée allumée garde ses jetons : reçus en argument, ils se résolvent encore. Rallumée, les mêmes jetons. Un
  `enabled` qui lève ou ne rend pas un booléen refuse l'appel (`internal`), rien en clair.
- **Invalider** : `await invalidateSensitiveEntities(db, org)` après toute écriture d'une personne déclarée
  (création, changement, effacement) ; sinon le dictionnaire gardé sert l'ancienne liste jusqu'à 5 minutes.
- **Repasser un résultat** de `callFunction` à un assistant : `await pseudonymize(db, org, result)` d'abord.
- **Fonctions de l'hôte** : `entityArguments` de `defineErpFunction` (chemin pointé de l'argument → sorte, e.g.
  `{ client: "client" }`) ; le jeton que l'assistant y passe arrive à `run` en identifiant, et un jeton d'une autre
  sorte est refusé. Ailleurs, vos arguments reçoivent le jeton tel quel.
- **Fiches** : `output.entityFields` de `defineErpFunction` nomme les champs de `data` qui portent le nom d'une
  personne, e.g. `{ entityFields: [{ kind: "client", id: "id", fields: ["nom", "prenoms"] }] }` (`at: "clients"` pour
  une liste). Servis à l'assistant, ils deviennent le jeton de la personne, et ces valeurs quittent votre texte ; une
  personne inconnue du dictionnaire : `[withheld]`. `callFunction` reste en clair.
- **Bornes** : 50 000 entités par organisation (mesuré : 2,8 s de construction, 83 Mo gardés) ; au-delà, refus.
- Ce qui est reconnu : prénoms et nom dans les deux ordres, premier prénom, initiale, civilité devant le nom, forme en
  chemin de chacune (`camille_dupre`, `acme_sa`) et d'adresse web (`camille-dupre`), le nom seul, courriels, désignations
  libres, ligne de voie, téléphones en chiffres. Le nom seul se masque s'il a au moins 3 lettres et n'est ni un mot commun
  ni un prénom courant (« Lefort », « Durand ») ; le prénom seul reste en clair. Une forme commune à deux personnes devient
  un jeton à sens unique (`name#…`).
- Courriels et téléphones de personnes non déclarées : trouvés par leur forme (courriel à domaine, téléphone en `+` ou
  `00`, ou français à dix chiffres par paires), servis en jeton à sens unique (`email#…`, `phone#…`), le même pour la
  même valeur ; dans toute organisation de l'hôte, même sans entité. Un numéro national étranger sans indicatif reste en
  clair.
- Mots courants : `server/pseudonym/words/`, généré par `scripts/mots-courants.mjs` du dépôt ; les mots communs du lexique
  de Grammalecte 7.7 (MPL 2.0, sa notice en tête du fichier) et les prénoms du fichier des prénoms de l'Insee (Source :
  Insee, paru le 16/07/2026, Licence Ouverte 2.0).
- Un jeton que l'assistant recopie se résout : chemin de `read`, de `write` et d'une fonction native (la page qui
  existe), requête de `find`, phrase de `context` et `q` d'un tableau (« prénoms nom »), argument d'entité de vos
  fonctions, clé de ligne d'un tableau (la ligne qui existe) ; `find` de `replace_text` et un filtre de `table.*` se
  comparent au texte tel que l'assistant l'a lu, et le texte en clair change. Un jeton
  inconnu est refusé (`invalid_arguments`, raison `unknown_pseudonym`), comme un jeton à sens unique là où il faut une
  personne (`one_way_pseudonym`) ; une fonction de connecteur refuse tout jeton (`forbidden`, `pseudonym_not_accepted`).
- Un jeton s'écrit `<sorte>#<corps>`. Une suite de cette forme dont la sorte n'est ni déclarée ni réservée est du texte
  (l'ancre `guide#installation` d'une adresse) ; d'une sorte déclarée, elle est un jeton, refusé s'il est inconnu.
  Choisissez une sorte que vos textes n'écrivent pas devant un `#` (`client` plutôt que `issue`).
- **Limite assumée** : un nom qui est aussi un prénom courant ou un mot commun (« Martin », « Brun ») reste en clair quand
  il est seul, sans prénom ni civilité ; le prénom seul aussi. Les masquer masquerait trop de mots ordinaires. Pour vos
  fiches, déclarez les champs nom et prénoms (`output.entityFields`) : ils partent en jetons.

## Widgets dans la conversation

Un résultat de `call` ou de `read` peut s'afficher rendu dans Claude et ChatGPT (MCP Apps) : un tableau, une
fiche, une page, ou une vue de l'ERP. Éteint par défaut, le MCP reste en texte seul.

- **Allumer** : `handleMcpPost(request, { verifyToken, defer, widgets: true })` dans `src/app/api/mcp/route.ts`.
  Les six outils ne changent pas ; `call` et `read` gagnent la méta du widget et le serveur sert son bundle
  (`ui://oto/view.html`). Sans `widgets`, rien de ce qui est servi ne change.
- **Vues du paquet** : `table` et `record` (`table.rows`, `table.claim`), `page` (une page lue entière), sans
  rien à construire : le bundle est livré dans le paquet.
- **Vues de l'ERP** : un fichier `.tsx` par vue dans un dossier de l'application (`src/widgets/devis.tsx`), dont
  l'export par défaut est un `ErpView` (`import type { ErpViewProps } from "@otomata_tech/oto_platform/widgets"`) :
  il reçoit `result` (les données que `run` a rendues), `theme`, et `call(fn, args)` pour appeler une fonction du
  catalogue, jamais avec `confirm`. Construire : `oto-platform widgets build --views src/widgets --out
  src/lib/widgets.generated.ts`, qui demande en `devDependencies` `vite`, `@vitejs/plugin-react`,
  `vite-plugin-singlefile`, `@tailwindcss/postcss`, `tailwindcss` et `@modelcontextprotocol/ext-apps`. Puis, dans
  `src/lib/fonctions-metier.ts`, `registerWidgetViews(WIDGET_BUNDLE)` avant `registerFunctions`, et
  `view: "devis"` dans `defineErpFunction`. Une fonction dont la vue n'est pas dans le bundle inscrit lève
  `CatalogRegistrationError`. Sans vue de l'ERP, rien à construire ni à installer.
- **Actions** : « Lignes suivantes » d'un tableau et `call` d'une vue de l'ERP passent par l'host vers l'outil
  `call`, sous le `ctx` de la conversation ; une suite proposée part en message à l'assistant.

## Capacités par organisation

Un hôte qui vend le paquet par offres borne certaines écritures de chaque organisation (ADR-022) ; le
paquet ne connaît ni offre, ni prix, ni prestataire. Sans rien enregistrer, rien ne change.

- **Où** : `registerOrgLimits({ read, raiseUrl? })` de `@otomata_tech/oto_platform/server`, une fois,
  dans un fichier importé pour son effet en tête des trois routes qui montent une porte (comme les
  fonctions métier) et des pages qui montrent un geste limité (Équipes, Connecteurs) ; une route qui
  l'oublie sert sans limite.
- **Valeurs** : `read({ id, slug })`, synchrone ou non, rend un `OrgLimits` (`orgLimitsSchema` de
  `/schemas`, toutes les clés facultatives, absente = sans limite) ou `null` : `members_max` (membres
  et invitations en attente, contrôlé à l'invitation), `teams_max` (0 ferme la création d'équipes),
  `connectors_max` (connecteurs actifs), `storage_bytes` (10 Go sans valeur), `account_owner_kinds` et
  `accounts_per_owner_max` (lus, contrôlés par aucun service dans cette version). Elle est appelée à
  chaque écriture bridée et par `orgLimitsView` ; une clé inconnue, une valeur hors schéma ou une
  exception refusent l'écriture (`internal`), jamais « sans limite ».
- **Refus** : `forbidden`, `details: { reason: "limit", limit, max }` ; le stockage, `too_large`,
  `details: { reason: "quota", max }`. Même refus par l'API, le MCP et le MCP admin. Baisser une limite
  ne supprime rien : seule la création suivante est refusée.
- **Écrans** : la page passe `orgLimitsView(db, identity)` à `EcranEquipes` (`limites`) et à
  `EcranConnecteurs` (`donnees.limites`) ; le geste au plafond est grisé, et un administrateur voit
  « Relever la limite », vers `<raiseUrl>?capacity=<nom>` (`raiseUrl` : `https://…` ou un chemin de
  l'hôte, résolu sur l'adresse de l'organisation). `AdressesDuRail.abonnement` ajoute l'écran
  « Abonnement » de l'hôte aux réglages de l'entreprise.
- **Compteurs sans session** : `orgUsage(orgId)` rend `{ members, pendingInvitations }` d'une organisation
  hors de toute requête d'une personne (tâche planifiée, webhook de paiement), pour prévenir d'un seuil sans
  refuser ; `null` pour une organisation inconnue.

## Inscription libre

Une personne connectée crée une organisation, autant qu'elle en veut, et en devient l'administratrice
(ADR-023). Désactivée par défaut : un ERP garde l'entrée sur invitation seule.

- **Activer** : `handlePlateforme(request, { …, signup: { orgCreation, admit? } })`. `orgCreation` est le
  point de création de l'hôte (`OrgCreationHook`, les adresses de la nouvelle organisation) ; `admit({
  email, request, acceptedTerms })` son contrôle d'abus (captcha, débit par IP, domaines jetables) : un texte refuse
  l'inscription avec ce texte, `null` l'admet.
- **Écran** : la page de l'hôte monte `FormulaireDInscription` dans `EcranDAuthentification` ; il
  appelle `POST /api/platform/signup` en deux temps : l'aperçu, sans `confirm`, part seul après une pause de
  frappe et donne l'adresse lue sous le nom (il passe par `admit` à chaque pause) ; le bouton « Créer
  l'organisation » crée au premier clic. La personne part ensuite à l'adresse de la nouvelle organisation dès
  qu'elle répond, où elle se reconnecte (la session est liée à l'adresse) ; d'ici là, l'écran « Votre espace
  se prépare » dit les étapes et avance une barre, sans lien vers l'adresse ; au bout de deux minutes sans
  réponse, il le dit, donne le lien et propose « Réessayer ».
  La personne ne saisit que le nom : l'adresse et le préfixe des outils s'en déduisent, et leurs champs ne
  s'affichent que sur un refus `conflict` ou pour un nom dont on ne tire rien de valide. Le nom se juge à la
  sortie de son champ ou à Entrée, jamais pendant la frappe.
  `conditions={{ libelle, url }}` y ajoute une case obligatoire vers les conditions de l'hôte ; le corps porte
  alors `accepted_terms: true`, qu'`admit` reçoit (`acceptedTerms`) pour refuser sans elle et en garder la preuve.
- **Comptes** : l'inscription marche dans les deux modes d'émetteur. En mode OIDC (Logto, Keycloak), l'inscription chez l'émetteur est la sienne, et l'inscription au paquet
  crée l'identité de la personne. En mode Supabase, `hook_before_user_created` refuse tout compte sans
  invitation : l'hôte qui ouvre l'inscription retire ce hook de ses réglages d'Auth.
- **Plusieurs organisations** : la page passe `listMyOrganisations(db, identity, requestHost)` à `RailApplication`
  (`organisations`) : à partir de deux, le menu de l'entreprise porte la bascule, qui mène à l'adresse de
  l'organisation choisie. `AdressesDuRail.inscription` (le chemin de la page d'inscription) y ajoute « Créer une
  organisation ».
- **Refus** : `email_required`, `signup_refused` (le
  texte d'`admit`, dans `details.text`), `conflict` pour un slug, un préfixe ou une adresse pris.

## Entrée sans invitation (annuaire de l'ERP)

Par défaut, on rejoint une organisation par une invitation. Dans un ERP dont les comptes existent déjà, un administrateur ouvre l'organisation dans « Équipes & accès » (onglet Membres) : toute personne qui a un compte vérifié chez l'émetteur de l'hôte, avec un email d'un des domaines qu'il nomme, entre comme membre, sans équipe, à son premier écran ou au premier appel de son assistant.

- **Monter** : la page de l'écran passe `entreeSansInvitation={await readOpenEntry(db, identity)}` à `EcranEquipes`, pour qui administre ; l'écran écrit par `PATCH /api/platform/admin/open-entry`. Sans la prop, le réglage n'est pas montré (il reste réglable par l'API).
- **Ce qui n'entre pas** : un email hors des domaines, une personne retirée par un administrateur (jusqu'à une nouvelle invitation acceptée), l'équipe plateforme servie par un accès en cours. Le refus reste `not_member`.
- **Plafond** : `members_max` de `registerOrgLimits` s'applique ; atteint, `resolveIdentity` lève `forbidden` avec `details.reason: "limit"`. L'hôte le traite comme un `not_member` (l'hôte de référence : `src/lib/plateforme/session.ts`) ; la porte MCP le sert elle-même.
- **Mode Supabase** : garder « Confirm email » ; une inscription ouverte à tous donne un compte vérifié à quiconque possède une adresse du domaine, ce qui est le but.

## Mode jour ou nuit

Le mode est à l'hôte : il pose la classe `.dark` (next-themes ou autre), que les écrans du paquet suivent. Pour que le menu du compte du rail en offre la bascule, l'hôte ajoute `apparence` à ce qu'il prête par `ContexteDeLHote` : `{ mode: "light" | "dark", basculer: () => void }`. Absente, aucune entrée.

## Migrations

Le SQL du paquet ne touche que le schéma `platform` et ne fait qu'ajouter. L'application copie les
migrations du paquet dans les siennes, puis les applique par son propre workflow de migrations,
dans l'ordre du paquet.

```bash
pnpm exec oto-platform migrations sync --to supabase/migrations
pnpm exec oto-platform migrations check
```

- `sync` copie chaque migration du paquet absente de l'application et dit `à jour` pour les
  autres. Une copie modifiée n'est jamais écrasée : la commande nomme le fichier, n'écrit rien et
  sort en code 1 ; le paquet fait foi, l'écart se résout à la main.
- `check` refuse tout objet créé ou modifié hors de `platform`, tout retrait (`drop`, `rename`,
  `set not null`, changement de type), toute fonction de `platform` sans
  `revoke execute … from public` dans le même fichier (fonctions de déclencheur exceptées), et ce
  qui attacherait le schéma à Supabase ou à une extension refusée : clé ou lecture vers
  `auth.users`, extension hors de `pg_trgm`, `unaccent` et `ltree` ; ligne par ligne
  (`fichier:ligne règle`) ; `--file <chemin>` contrôle un fichier seul. Sa place est dans la CI de
  l'application.
- `pnpm exec oto-platform --help` : usage et codes de sortie (0 succès, 1 refus, 2 usage incorrect).

Après chaque montée de version du paquet : `sync`, puis le workflow de migrations de l'application.

## Mises à jour par Renovate

Chaque version du paquet arrive dans l'application par une pull request Renovate, avec les notes
de `CHANGELOG.md`. L'application Renovate installée sur le dépôt de l'application, son
`renovate.json` étend le preset du paquet :

```json
{
  "extends": ["config:recommended", "github>oto-now/oto-core//renovate/preset"]
}
```

Le preset épingle la version du paquet. Une corrective est fusionnée automatiquement si la CI est
verte. Une mineure attend une revue humaine, sous le label `oto-platform-minor`, parce qu'elle
apporte des nouveautés sans drapeau par organisation (D121) ; une majeure aussi, sous le label
`oto-platform-major`. Dans les réglages du dépôt de l'application : fusion automatique autorisée,
CI exigée avant toute fusion.

## Versions et CHANGELOG

Numérotation sémantique : le paquet ne fait qu'ajouter, un changement cassant est donc une
majeure. `CHANGELOG.md`, embarqué dans le paquet, a un titre par version publiée,
`## <x.y.z> — <AAAA-MM-JJ>`, la plus récente en tête, et `## Unreleased` au-dessus pour ce qui
n'est pas encore publié. Sous chaque titre, au plus deux listes, en anglais :

- `### Assistants` : ce qu'un assistant connecté à la plateforme sait faire de nouveau, une phrase
  de 200 caractères au plus par entrée, servie aux assistants dans les nouveautés de `context` ;
- `### Hosts` : ce qu'une application qui installe le paquet doit savoir ou faire, lu dans les
  pull requests Renovate.

Tout changement visible d'un hôte ou d'un assistant a sa ligne sous `## Unreleased`, dans le
commit qui le livre.

## Publier une version

Réservé aux mainteneurs du dépôt.

1. Dans `CHANGELOG.md`, renommer `## Unreleased` en `## <x.y.z> — <AAAA-MM-JJ>`, et rouvrir un
   `## Unreleased` vide au-dessus.
2. Porter la même version dans `version` de `packages/plateforme/package.json`, et réunir les
   migrations écrites depuis la version précédente en un seul `<horodatage>_vX_Y_0.sql` au contenu
   identique (fiche D124, `migrations/README.md`).
3. `pnpm verify`, puis le commit par le skill `commit-push`.
4. JB pousse le tag de la version :

   ```bash
   git tag v<x.y.z>
   git push origin v<x.y.z>
   ```

5. Le workflow `.github/workflows/publish.yml` contrôle les secrets de l'arbre et de l'historique
   et les migrations, vérifie que le tag, la version et le CHANGELOG concordent, puis publie sur
   npmjs.com avec provenance. Chaque application hôte reçoit sa pull request Renovate.

Une version fautive ne se republie pas : JB la signale par
`npm deprecate @otomata_tech/oto_platform@<x.y.z> "<raison>"`, et une version corrective la
remplace par la pull request Renovate suivante ; une application épinglée ne bouge pas tant que
sa pull request n'est pas fusionnée.

Dans ce dépôt, l'application de base consomme le paquet depuis le workspace
(`"@otomata_tech/oto_platform": "workspace:*"`, `@source "../../packages/plateforme/ui";`), sans
passer par npm.
