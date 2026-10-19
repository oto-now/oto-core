# Supabase Patterns

> Tag : `supabase`
> Lire ce fichier pour tout changement qui touche à Supabase (clients, RLS, erreurs) ou à la face SQL du paquet.

## Clients Supabase

### Server Client (mutations + data fetching)
```typescript
// lib/supabase/server.ts — utilisé dans Server Components et Server Actions
import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"

export async function createClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { /* getAll, setAll */ } }
  )
}
```

### Browser Client (realtime + auth listener uniquement)
```typescript
// lib/supabase/client.ts — JAMAIS de mutations (.insert/.update/.delete)
import { createBrowserClient } from "@supabase/ssr"

export function createBrowserSupabaseClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
```

**Règle absolue :** Le browser client est réservé au realtime et à l'auth listener. Toute mutation passe par une Server Action avec le server client.

## RLS Patterns

### Policies standard
```sql
-- L'utilisateur ne voit que ses données
CREATE POLICY users_select_own ON profiles
  FOR SELECT USING (auth.uid() = id);

-- L'utilisateur ne modifie que ses données
CREATE POLICY users_update_own ON profiles
  FOR UPDATE USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- L'utilisateur ne crée que pour lui-même
CREATE POLICY users_insert_own ON profiles
  FOR INSERT WITH CHECK (auth.uid() = id);
```

### Multi-tenant (organisation)
```sql
-- L'utilisateur ne voit que les données de son organisation
CREATE POLICY org_select ON items
  FOR SELECT USING (
    org_id IN (
      SELECT org_id FROM org_members WHERE user_id = auth.uid()
    )
  );
```

### Règles RLS
- **RLS activé sur TOUTE table** — sans exception
- **Tester les policies** : se connecter en tant qu'utilisateur et vérifier l'accès
- **Pas de `service_role`** sauf cas documenté (ADR obligatoire)
- **USING** = filtre les lignes visibles (SELECT, UPDATE, DELETE)
- **WITH CHECK** = valide les données insérées/modifiées (INSERT, UPDATE)
- **Policy de `platform` : l'organisation de la ligne et ses invariants, sur les colonnes de la ligne.** Une policy borne l'organisation de la ligne (`org_id in (select platform.member_orgs())`, accès plateforme en cours compris ; `id` pour `orgs` ; l'organisation de la ligne parente pour `team_members` et `node_drafts`) et garde les invariants (attribution à `auth.uid()`, état d'une ligne, cohérence d'organisation entre colonnes, structure de l'arbre). Elle n'appelle aucune fonction de droit (`node_level`, `account_level`, leurs variantes `_for`, `is_org_admin`) et ne porte aucun rôle (responsable, `is_staff()` hors des quatre policies de portée plateforme) : les droits sont décidés par les services (`security-patterns.md § Droits dans le service`). Jamais de relecture de la ligne par son id : un `insert … returning` (`.insert().select()` de supabase-js) évalue la policy `SELECT` sur la ligne à écrire, avant qu'elle n'existe (une fonction qui relit la table par `id` ne la trouve pas, et toute création suivie de sa relecture est refusée, `42501`) ; le `WITH CHECK` d'une mise à jour s'évalue avant que la nouvelle version soit écrite (relue par `id`, la ligne est celle d'avant, et le contrôle ne porte jamais sur ce que la mise à jour change). **Vérifiable :** le premier test de `tests/unit/rls-policies.test.ts`, sur les définitions finales des migrations du paquet : aucune fonction de droit ni rôle, `is_staff()` dans les seules policies de portée plateforme, un `with check` sur toute policy `for update`, l'appartenance dans le `using` de toute policy `for update`, `for delete` ou `for all` qui ne vaut pas `false` ; et aucune fonction qui relit par `id` la table même de la policy n'apparaît dans une policy `for select` ni dans le `with check` d'une policy `for update` de cette table.
- **Une sous-requête de policy ne revient jamais sur une table dont Postgres développe les policies.** Quand une policy porte une sous-requête (`(select auth.uid())` en est une), Postgres applique les policies de lecture de chaque table qu'elle lit, et refuse la commande entière (`42P17`, « infinite recursion detected in policy ») s'il revient ainsi, directement ou par une autre table, sur une table dont il développe déjà les sous-requêtes. Le cycle ne casse qu'au jour où la policy de lecture de la table visitée gagne elle-même une sous-requête, comme l'isolation `org_id in (select platform.member_orgs())` : la commande échoue alors avant tout déclencheur, pour tout jeton, et aucun test de service ne le voit. **Vérifiable :** `tests/unit/rls-policies.test.ts` rejoue cette détection sans base sur les définitions finales des migrations du paquet et ne trouve aucun cycle.
- **Recherche sous RLS : une fonction `security definer` qui applique la visibilité.** `@@`, `%`, `%>`, `LIKE` et `ILIKE` ne sont pas *leakproof* : sous une policy, Postgres les évalue après elle, ligne à ligne, sans index. Une recherche passe par une fonction `security definer` qui contrôle l'appartenance puis applique elle-même le niveau de lecture, aux seules lignes trouvées (`search_content` : `node_level_for`, qu'aucune policy n'appelle). **Vérifiable :** le plan de la requête de la fonction montre l'index GIN (`tests/sql/search-content-plan.sql`).
- **Droit hérité : une exception à l'héritage borne aussi les règles.** Quand un droit se calcule en remontant un arbre (règle la plus proche) et qu'une branche lui échappe (espace personnel), les règles posées au-dessus de la branche ne comptent pas dedans : sinon qui gère le parent s'ouvre la branche par une règle à son nom, sous son propre jeton. **Vérifiable :** le test de l'exception pose une règle sur un ancêtre (sous le jeton de qui gère cet ancêtre, puis pour une équipe et contre le propriétaire) et relit le niveau attendu.
- **Une écriture faite sous le jeton après une mutation est jugée après elle.** La porte de l'API écrit sa ligne de journal après la réponse, sous le jeton de l'appelant : quand la mutation retire à l'appelant le droit qu'exige cette écriture (se retirer de l'organisation, révoquer son propre accès plateforme), la policy la refuse (`journal_insert_own` : `org_id in member_orgs()`), et la ligne se perd sans bruit (`42501` au log). **Vérifiable :** tout geste de l'API qui peut retirer à l'appelant sa propre appartenance a un test par `handlePlateforme` qui relit sa ligne de journal (`tests/integration/api-equipes.test.ts`) ; tant qu'une migration ne lève pas la limite, ce test fixe l'absence de la ligne.

## Error Handling

```typescript
// Les erreurs Supabase n'ont pas toutes la même forme : PostgrestError expose `code`,
// StorageError expose `statusCode`, AuthError expose `status` + `name`.
type SupabaseLikeError = { code?: string; statusCode?: string; status?: number }

const ERROR_MESSAGES: Record<string, string> = {
  "23505": "Cette entrée existe déjà",
  "23503": "Référence invalide",
  "23514": "Valeur non autorisée",          // violation de CHECK
  "40001": "Conflit temporaire, réessayez", // serialization failure — rejouable
  "42501": "Accès non autorisé",
  "57014": "La requête a pris trop de temps", // statement timeout (8 s en lecture chez Supabase)
  PGRST116: "Aucun résultat trouvé",          // 0 OU plusieurs lignes avec .single()
  PGRST301: "Session expirée, reconnectez-vous", // JWT expiré / vérification échouée
  PGRST202: "Opération indisponible",         // fonction RPC introuvable (renommage non déployé)
  PGRST204: "Schéma désynchronisé",           // colonne absente du cache après migration
}

function handleSupabaseError(error: SupabaseLikeError): string {
  const code = error.code ?? error.statusCode ?? String(error.status ?? "")
  return ERROR_MESSAGES[code] ?? "Une erreur est survenue"
}
```

**Règles :**
- Ne JAMAIS exposer `error.message` de Supabase au client — il contient des noms de tables et de colonnes. **Vérifiable :** aucune Server Action ne place `error.message`, `error.details` ou `error.hint` dans sa valeur de retour ; le retour est soit une constante littérale, soit `handleSupabaseError(error)`.
- **Toute réponse Supabase déstructure `error` et le traite.** Un `const { data } = await supabase...` sans `error` est un défaut, comme une réponse gardée entière (`const again = await read()`) dont on lit `.data` sans avoir traité `.error` : une panne y devient un refus ou un vide. L'inverse aussi : une relecture sans ligne ni erreur (la ligne retirée entre-temps) n'est pas une panne, et `fromDatabaseError` ne reçoit que l'erreur lue par un `if (x.error)`, jamais `x.error` d'une réponse sans ligne. **Vérifiable :** `rg -n "if \(!\w+(\.data)?\) throw fromDatabaseError" packages/plateforme` ne trouve rien. Une erreur rendue à l'appelant garde son objet (`{ error }`) jusqu'à `fromDatabaseError` ou `databaseFailure` : réduite à un statut (`"failed"`, `false`), une panne se lit comme une course (`conflict`) et un jeton refusé perd son `unauthorized`. **Vérifiable :** dans `packages/plateforme/server/`, aucune fonction ne rend une chaîne ou un booléen à la place de l'`error` d'une réponse (`rg -n 'return "failed"' packages/plateforme/server` ne trouve rien).
- `PGRST301` signifie **JWT expiré**, pas « trop de résultats » : le traiter comme une session à rafraîchir, pas comme une erreur de requête. Dans le paquet, `fromDatabaseError` rend `PGRST301` et `PGRST303` (claims refusées : un `iat` à venir) en `unauthorized`, 401, que la porte de l'API sert tel quel ; un service qui dit ses pannes par son propre message passe par `databaseFailure` (`server/errors.ts`), qui le garde ; ces codes ne viennent que d'un ERP lu par une fonction de l'hôte (la face SQL ne refuse aucun jeton). **Vérifiable :** `rg -n "PGRST30" packages/plateforme -g '!CHANGELOG.md'` ne trouve que `server/errors.ts`, et aucun des `PlatformError("internal", …)` que liste `rg -n 'PlatformError\("internal"' packages/plateforme` ne remplace l'erreur d'une réponse de la base : celle-ci passe par `fromDatabaseError` ou `databaseFailure`.
- **Une insertion de plusieurs lignes aux colonnes différentes passe `{ defaultToNull: false }`.** supabase-js envoie l'union des clés des lignes (`columns`) et PostgREST met NULL dans celles qu'une ligne n'a pas : une colonne `not null` à défaut échoue en `23502`, une colonne nullable perd son défaut sans bruit. **Vérifiable :** tout `.insert([…])` dont les lignes n'ont pas toutes les mêmes clés porte `{ defaultToNull: false }` (`publishBlocks` de `tests/helpers/plateforme.ts`). Sur la face SQL, le pendant est `sql(rows)` de postgres.js (§ Couplage à Supabase (ADR-012)).
- **Une chaîne envoyée à PostgREST ne porte jamais une moitié de paire de substitution.** `slice` compte en unités UTF-16 : couper un emoji en deux laisse une moitié seule, et PostgREST refuse alors tout le corps (400 `PGRST102`) ; une insertion groupée perd toutes ses lignes, sans bruit. Une moitié envoyée par un host ou un navigateur fait de même : laissée dans les arguments d'un appel, elle effaçait sa ligne de journal. **Vérifiable :** toute coupe d'une chaîne écrite en base passe par `clip` (`packages/plateforme/server/journal.ts`), et ce que le client envoie n'entre au journal que par `clip` ou `loggedArgs` ; toute fonction du catalogue qui écrit en base une chaîne de ses arguments la reçoit passée par `wellFormed` (`table.*` ; `mail.*` par `toWellFormed`).
- **Le paquet ne lit ni n'écrit `platform` par PostgREST** : `PlatformDb` n'a que `tx`, et `platform` n'est pas exposé au Data API. `READ_PAGE_ROWS` (`server/errors.ts`) reste la borne des lectures SQL bornées (`routing.ts`, `context/blocks/news.ts`, `context/blocks/procedure.ts`). **Vérifiable :** `rg -n "\.from\(|\.rpc\(" packages/plateforme/server packages/plateforme/api packages/plateforme/mcp` ne trouve que `Buffer.from` et `Array.from`.

## Couplage à Supabase (ADR-012)

Le paquet ne dépend que d'un appelant vérifié et d'une session Postgres par requête (ADR-012),
Supabase restant l'implémentation par défaut de l'hôte de référence. Le couplage ne grandit pas dans
`server/`, `api/`, `mcp/` du paquet, ni dans les fonctions SQL qu'ils appellent : un besoin qui
franchit une de ces règles passe par un ADR.

- **Aucun nouvel appel à `supabase.auth.*`, aucune nouvelle lecture d'une table du schéma `auth`**
  (`auth.users`, `auth.sessions`, `auth.oauth_*` ; `auth.uid()` et `auth.jwt()` restent permis, le
  port les garde). Points admis : `signInWithOtp` de
  `server/invitations.ts` (sur un client local), les méthodes serveur OAuth du consentement
  (`server/oauth.ts`), `oauth_pending_resource` et `oauth_clients_activity`. Aucune
  fonction ne lit `auth.users` ni aucune clé ne la vise : l'email et le nom d'une personne sont les
  copies de `members` (posées par l'outillage et, depuis les claims de la session, par
  `accept_invitations`) et de `platform_staff` ; `check:migrations` refuse une clé ou une lecture
  nouvelle (`auth-users-foreign-key`, `auth-users-read`). **Vérifiable :**
  `rg -n "\.auth\b|\bauth\.(signIn\w*|signUp|oauth|admin)\b" packages/plateforme/server packages/plateforme/api packages/plateforme/mcp`
  et `rg -n "auth\.(users|sessions|identities|oauth_)" packages/plateforme/migrations -g "*.sql"` ne
  trouvent que ces points.
- **La vérification du jeton est injectée sur chaque porte**, Supabase par défaut : un
  `VerifyToken` (`mcp/auth.ts`), construit par `makeVerifyToken({ jwks, issuer })` ; `handleMcpPost`
  le reçoit de la route, `handlePlateforme` en option (`verifyToken`), et prend sans lui
  `makeVerifyToken()`, la JWKS et l'émetteur du projet Supabase. **Vérifiable :** une porte qui
  appelle `jwtVerify` ou `getUser` au lieu de recevoir un vérificateur injecté est un défaut. Seule
  exception : la porte du ticket d'envoi d'ADR-018, sans session, qui relit chaque droit à l'envoi
  (`security-patterns.md § Droits dans le service`).
- **Une hypothèse sur PostgREST ne s'écrit que dans `server/errors.ts`** : code `PGRST…` ou
  `PT409`, lignes rendues par lecture (`READ_PAGE_ROWS`), droit accordé colonne par colonne. **Vérifiable :** une ligne nouvelle hors de `server/errors.ts` qui teste un
  de ces codes ou dépend d'une de ces limites est un défaut.
- **Un refus est décidé par le service, jamais lu dans « aucune ligne rendue »** :
  `security-patterns.md § Droits dans le service`.
- **Le port de stockage (ADR-016) ne lit d'un `HEAD` que l'existence et la taille de l'objet**,
  jamais son type : Supabase Storage relit un objet `text/html` en `text/plain`, et le type relu
  varie d'un fournisseur S3 à l'autre. Le bucket en mémoire des tests joue ce fournisseur le plus
  strict. **Vérifiable :** `rg -n "head\??\.mime" packages/plateforme/server` ne trouve rien.
- **Une requête au stockage qui lit une taille envoie `accept-encoding: identity`, hors de la
  signature, et ne lit jamais un `content-length` absent ou compressé** : `fetch` annonce gzip, et le
  CDN devant Supabase compresse un objet relu `text/plain`, sans `content-length` ; `Number(null)`
  vaut 0 et `Number(undefined)` `NaN`. À défaut, `content-range` d'un `GET bytes=0-0`, sinon une
  taille `null` que le service refuse sans rien supprimer. **Vérifiable :**
  `rg -n "Number\(.*content-length" packages/plateforme/server` ne trouve rien, et
  `tests/unit/files-store.test.ts` (« an object the CDN compresses ») passe.
- **La face SQL ne pose aucun état de session, et n'en hérite d'aucun** : le pooler de
  Supabase en mode transaction rend une connexion serveur à d'autres clients de `platform_app` sans
  la remettre à zéro, et un rôle ou des claims posés pour la connexion passent aux transactions
  suivantes. Rôle (`authenticated`, `anon`, ou `platform_server` pour une écriture que le serveur seul
  affirme : `withServerSession`), claims, délais et fuseau (`TimeZone` UTC) se posent par
  `set_config(…, true)` ou `set local`, dans la transaction de la session (`server/sql.ts`), qui vide
  aussi `request.jwt.claim.sub` et `request.jwt.claim` : `auth.uid()` et `auth.jwt()` de Supabase les
  lisent avant `request.jwt.claims`. **Vérifiable :**
  `rg -niUP '(\w\x60|unsafe\(\s*[\x22\x27\x60]|;)\s*set\s+(?!(local|transaction|constraints)\b)[\w\x22]' packages/plateforme/server`
  ne trouve aucune instruction `set` (rôle, claims, délais ou tout autre réglage),
  `rg -n 'set_config\(' packages/plateforme/server` ne trouve que `server/sql.ts`, dont chaque appel
  porte `true` en dernier argument, et `tests/integration/sql-session.test.ts` lit la
  connexion rendue au pool et rejoue un claim hérité.
- **Une transaction de la face SQL ne tient que ses requêtes** : `db.tx` garde une
  connexion du pool (cinq par instance) jusqu'à sa fin. Elle n'ouvre jamais la transaction d'une
  autre session (autre appelant, client sans session) : elle tiendrait sa connexion en attendant une
  seconde, que le pilote attend sans délai, et sous charge les requêtes ouvertes tiendraient tout le
  pool en s'attendant ; `server/sql.ts` refuse cet appel au lieu d'attendre. Elle n'attend aucune
  entrée-sortie extérieure (HTTP, Supabase Auth, email, service connecteurs) : pendant ce temps, elle
  tient sa connexion du pooler et ses verrous, et la base la coupe après 8 s d'inactivité
  (`idle_in_transaction_session_timeout`). Le travail extérieur se fait avant ou après ;
  une écriture qui en dépend (retirer une invitation dont l'email n'est pas parti) ouvre sa propre
  transaction. **Vérifiable :** le cas « another session » de
  `tests/integration/sql-session.test.ts` échoue si le refus est retiré ; dans un diff, le `fn` d'un
  `db.tx` n'appelle ni `fetch`, ni `db.auth`, ni un client Supabase Auth, ni le service connecteurs.
- **Dans un `db.tx`, une instruction en erreur perd la transaction, même rattrapée** : Postgres refuse la
  suite (`25P02`), postgres.js 3.4.9 fait échouer la fin (`uncaughtError`). Une course sur une clé unique se lit
  par `insert … on conflict do nothing returning …` sans ligne, jamais par un `23505` rattrapé. **Vérifiable :**
  aucun `catch` du `fn` d'un `db.tx` ne rattrape une erreur de base (`regles-transaction.test.ts` joue la course).
  **Exception écrite, l'écriture d'un assistant** (`server/nodes/write-atomic.ts`, E11-S18) : elle tient dans une
  transaction des services qui, pour l'écran, rattrapent une erreur de base dans la leur (purge d'après publication et
  `evolution-publish.ts`, `followTitle`, refus relu de `publish_node` dans `publish.ts`) ; sous elle, une telle erreur
  perd toute l'écriture, rejouée une fois (le refus relu dit alors l'état d'après la course), puis refusée. La tolérance
  de ces services (N6 : publication faite, avertissement) ne vaut plus que pour l'écran. **Vérifiable :** la course
  d'AC30 de `tests/unit/nodes-publish.test.ts` (rejouée pour un assistant, tenue en deux temps pour l'écran).
- **Tout `update` et tout `delete` de la face SQL portent un `where`** : le rôle de
  PostgREST charge `safeupdate` (`session_preload_libraries` d'`authenticator`),
  qui refuse un `update` ou un `delete` sans `where` ; la face SQL ne le charge pas, et la RLS
  d'isolation laisserait l'instruction toucher toutes les lignes des organisations de l'appelant.
  **Vérifiable :**
  `rg -niUP '\b(update\s+platform\.\w+|delete\s+from\s+platform\.\w+)(?:(?!\bwhere\b)[^\x60])*\x60' packages/plateforme/server`
  ne trouve rien.
- **Un paramètre `json` ou `jsonb` d'une requête postgres.js passe par `sql.json(valeur)`, jamais par
  `JSON.stringify(…)`** : postgres.js sérialise un paramètre d'après le type que le serveur
  lui décrit, et une chaîne déjà sérialisée y est encodée une seconde fois. Postgres reçoit un JSON
  scalaire : `json_populate_recordset` lève 22023, une colonne `jsonb` garde sans bruit une chaîne au
  lieu d'un objet. Même piège pour une valeur lue en `::text` et réécrite par `${chaine}::jsonb` : le
  paramètre est déclaré `jsonb`, la chaîne est réencodée ; la réécrire par `${chaine}::text::jsonb`, ou
  la lire en `jsonb` et passer `sql.json`. Un paramètre `text` reçoit à bon droit un `JSON.stringify` (`set_config`, claims de
  `server/sql.ts`). **Vérifiable :** `rg -nU '(sql|tx)\x60[^\x60]*\$\{JSON\.stringify' packages scripts tests`
  ne trouve que des arguments de `set_config` (`tests/integration/sql-session.test.ts`).
- **`sql(rows)` prend les colonnes de la première ligne**, pendant de `defaultToNull`
  (§ Error Handling) : une clé en plus sur une ligne suivante est perdue sans bruit, une clé qui lui
  manque lève `UNDEFINED_VALUE`. Des lignes de formes différentes s'écrivent par jeu de colonnes
  (`insertRows` de `scripts/org-import.mjs`) ; sinon une même fabrique leur donne les mêmes clés
  (`documentBlocks` de `scripts/demo/publication.mjs`). **Vérifiable :** dans un diff, les lignes de
  tout `sql(rows)` qui en insère plusieurs sortent d'une même fabrique ou d'un groupe par colonnes.
- **Une ligne insérée se retrouve dans le `returning` par son rang, jamais par une valeur flottante relue** : les
  lignes d'un `insert … values … returning` suivent l'ordre des valeurs, alors qu'un `double precision` relu dépend de
  `extra_float_digits` de la session, que `server/sql.ts` ne pose pas (sous 1, il revient à 15 chiffres :
  `1365.3333333333333` revient `1365.33333333333`, et l'égalité avec la valeur envoyée échoue). Le rang se contrôle par le nombre de lignes et une
  colonne sans arrondi (`type`, `key`). **Vérifiable :** `insertBlocks` de `server/nodes/store.ts` ; son test pose
  `extra_float_digits = 0` dans la transaction (`tests/unit/e11s18-ecriture-assistants.test.ts`).
- **Un paramètre `timestamptz` d'une requête postgres.js passe par une `Date`, à la milliseconde** : son sérialiseur (`new Date(x).toISOString()`) coupe les microsecondes d'une date passée
  en texte, et une date lue en `Date` les a déjà perdues. Une date relue puis réécrite, ou comparée à
  l'égalité à une colonne (tampon de garde : `p_draft_stamp` de `publish_node`), reste dans la base,
  ou se lit en texte (`::text`, `to_json`) et repasse par un paramètre `text` converti dans la requête
  (`${tampon}::text::timestamptz`). **Vérifiable :** dans un diff de la face SQL, toute date relue pour
  être réécrite ou comparée à l'égalité suit l'une de ces formes, ou dit pourquoi la milliseconde
  suffit (`80-usage` de la Démo).
- **Un ordre promis se pose sur la requête qui rend les lignes**, jamais sur une sous-requête lue par
  `to_json` ou `json_agg` : Postgres ne garantit pas l'ordre d'une sous-requête à travers la requête
  qui l'enveloppe (`jsonRows(sql, columns, from)` de `scripts/lib/env.mjs` construit chaque ligne dans
  la requête qui porte l'`order by`). **Vérifiable :** dans un diff de la face SQL, toute lecture qui
  promet un ordre porte son `order by` au niveau qui rend les lignes.
- **Un `order by` ne nomme jamais seule une colonne que le `select` rend sous son nom par une expression** :
  Postgres y lit la sortie, et `to_json(updated_at) as updated_at` range un `json` (42883) ; qualifier la colonne
  (`order by blocks.updated_at`) ou prendre un autre alias. **Vérifiable :** dans un diff de la face SQL, un nom
  seul de l'`order by` n'est l'alias d'aucune expression du `select` (`tables-queue.test.ts`).
- **Un service de lecture tient ses requêtes en une transaction** : sans requêtes préparées, une requête
  paramétrée coûte deux allers-retours, une transaction quatre de plus. **Vérifiable :** `e05s10c-requetes-de-la-page.test.tsx`.
