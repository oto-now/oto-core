# Database Patterns

> Tag : `database`
> Lire ce fichier pour toute story créant/modifiant des tables, migrations, ou requêtes.

## Naming Conventions

| Élément | Convention | Exemple |
|---------|-----------|---------|
| Tables | `snake_case`, pluriel | `order_items`, `user_profiles` |
| Colonnes | `snake_case` | `created_at`, `user_id` |
| Primary key | `id` (UUID) | `id uuid DEFAULT gen_random_uuid()` |
| Foreign key | `[table_singulier]_id` | `user_id`, `order_id` |
| Index | `idx_[table]_[colonnes]` | `idx_orders_user_id` |
| RLS Policy | `[table]_[operation]_[qui]` | `orders_select_own` |
| Enum type | `snake_case` | `order_status`, `user_role` |
| Fonction | `snake_case`, verbe | `get_user_orders`, `calculate_total` |

## Migrations

### Naming
```
supabase/migrations/YYYYMMDDHHMMSS_description.sql
```
Exemples :
- `20240115120000_create_users_table.sql`
- `20240115130000_add_avatar_to_profiles.sql`
- `20240116100000_create_orders_with_rls.sql`

### Commande
```bash
pnpm db:migrate create_orders_table
```

### Structure d'une migration
```sql
-- Migration : create_orders_table
-- Description : Table des commandes avec RLS

-- 1. Table
CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Une personne : un uuid, sans clé vers auth.users (portabilité) ; forget_user l'oublie.
  user_id uuid NOT NULL,
  status order_status NOT NULL DEFAULT 'pending',
  total_cents integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Index
CREATE INDEX idx_orders_user_id ON orders(user_id);
CREATE INDEX idx_orders_status ON orders(status);

-- 3. RLS
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY orders_select_own ON orders
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY orders_insert_own ON orders
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- USING filtre les lignes visibles, WITH CHECK valide la ligne APRÈS écriture.
-- Sans WITH CHECK, un utilisateur peut réassigner user_id et donner sa ligne à un tiers.
CREATE POLICY orders_update_own ON orders
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 4. Trigger updated_at (jamais moddatetime, que le Postgres managé de Scaleway refuse)
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION platform.set_updated_at();
```

### Règles
- **Jamais de modification manuelle** en base — toujours via migration
- **Portable : Supabase comme Postgres nu** (ADR-012 § 1). Aucune clé ni lecture vers `auth.users` (une personne est un `uuid`, son email et son nom des copies), aucune extension hors de `pg_trgm`, `unaccent` et `ltree` ; `updated_at` par `platform.set_updated_at()` ; une colonne de personne entre dans `platform.forget_user` dans la migration qui la crée ; un privilège de `service_role` ou de `supabase_auth_admin` s'accorde dans un bloc `do` qui vérifie d'abord le rôle. **Vérifiable :** `pnpm check:migrations` (`auth-users-foreign-key`, `auth-users-read`, `extension-not-allowed`), puis le job de CI `bare-postgres`, qui applique toutes les migrations sur un Postgres nu ; la couverture de `forget_user` pour les colonnes existantes par `tests/integration/portabilite-schema.test.ts` (une instruction par colonne dans `pg_proc.prosrc`), et pour une colonne de personne nouvelle par la revue du diff de sa migration.
- **Une migration n'est jamais rejouée.** La CLI Supabase applique chaque fichier exactement une fois (`supabase_migrations.schema_migrations`) : `IF NOT EXISTS` n'apporte rien et fait passer une migration en silence sur une table préexistante de forme différente, ce qui crée une dérive de schéma invisible entre staging et prod. Une migration qui ne peut pas s'appliquer doit échouer bruyamment. Seule exception : `CREATE EXTENSION IF NOT EXISTS` — Supabase préinstalle certaines extensions, et une extension n'a pas de « forme » qui puisse dériver ; jamais pour un schéma, une table ou un index.
- **Une migration appliquée est figée, commentaires compris : elle ne cite que ce qui est déjà écrit.** Elle ne se modifie ni ne se renomme ; une correction, de revue comprise, est une migration additive nouvelle. Un agent l'applique par `supabase db push`, jamais par `supabase migration repair`, qui réécrit l'historique du projet (geste du responsable, procédure du README des migrations). Un `repair` ne nomme que des versions présentes dans `supabase/migrations/` du dépôt : l'historique du projet de test est commun avec un autre dépôt, et la CLI, devant ses versions inconnues d'ici, propose de les passer en `reverted`, ce qui efface son historique. **Vérifiable :** chaque version d'une commande `migration repair` se trouve par `ls supabase/migrations/<version>_*`. Un renvoi à une hypothèse, à une décision ou à un fichier existe, avec ce sens, avant le `db push` ; après, il ne se corrige plus, et une numérotation qui bouge le rend faux. **Vérifiable :** chaque renvoi que cite une migration du diff se lit, avec ce sens, dans la story ou dans `docs/conception/` à l'heure de son application.
- **Une fonction qui pose un paramètre de `pg_trgm` vient après le chargement de la bibliothèque.** Un rôle non superutilisateur ne pose `set "pg_trgm.similarity_threshold"` dans l'en-tête d'une fonction que si la session a chargé la bibliothèque, et `create extension if not exists` ne la charge pas : la migration qui crée ou recrée une telle fonction commence par `DO $$ begin perform extensions.similarity('a', 'a'); end $$;`. **Vérifiable :** `pnpm check:migrations` (`pg-trgm-parameter-before-load`).
- **Objets non idempotents par nature** (`CREATE POLICY`, `CREATE TRIGGER` : il n'existe pas de `IF NOT EXISTS` pour eux) → les précéder d'un `DROP ... IF EXISTS` explicite. La règle vise un objet qu'une migration antérieure a pu poser : la ligne de base, qui crée elle-même le schéma `platform` (`CREATE SCHEMA` sans `IF NOT EXISTS`), n'a rien à retirer et n'en porte aucun ; toute migration qui la suit y reste soumise.
- **RLS activée et policies créées dans la même migration** que la table
- **Toute policy `FOR UPDATE` déclare `WITH CHECK`** en plus de `USING`
- **Migration destructive = rollback fourni.** Toute migration contenant `DROP`, `ALTER ... TYPE`, `SET NOT NULL` ou `RENAME` est accompagnée d'un `supabase/migrations/rollback/<timestamp>.sql`, et découpée en expand/contract sur deux déploiements.
- **Vérifiable :** une migration seule dans un diff est un défaut — elle est accompagnée soit d'une entrée dans `supabase/seed.sql`, soit d'un test qui lit ou écrit la nouvelle table.
- **NULL passe un `CHECK` et saute un `if`.** Une contrainte `CHECK` accepte une expression qui vaut NULL, et `if <NULL> then raise` ne lève rien : une comparaison `=` à une valeur qui peut être NULL (colonne nullable, sous-requête scalaire sans ligne) laisse passer ce qu'elle devait refuser. Une contrainte à plusieurs cas sur une colonne discriminante nullable (`(kind is null and …) or (kind = 'a' and …) or …`) passe entière dès que `kind` vaut NULL et que le cas NULL est faux : les autres cas valent alors NULL, pas faux. **Vérifiable :** dans un `CHECK` ou une condition de garde plpgsql, une telle comparaison s'écrit `is not distinct from` ou `coalesce(…, false)`, ou le cas NULL s'écrit à part sans comparaison (`kind is not null or (…)`), et le test de la story essaie la valeur NULL. Une règle écrite après une erreur se confronte aussitôt à toutes les contraintes et gardes de la migration fautive, pas seulement à celle qui l'a révélée. Le SQL qu'une story donne « tel quel » n'en est pas exempté : l'agent le confronte à cette règle avant le premier `db push`, une migration appliquée ne se corrigeant plus que par une autre.
- **Dans un déclencheur `security invoker`, une fonction accordée au seul `authenticated` s'appelle dans un `if` imbriqué sous `current_user = 'authenticated'`.** Postgres contrôle le droit d'exécuter chaque fonction d'une condition quand il la prépare, même si l'évaluation s'arrête avant elle : `if current_user = 'authenticated' and … and not platform.is_org_admin(…)` refuse en `42501` toute mise à jour faite par l'outillage (connexion d'administration). **Vérifiable :** dans une fonction de déclencheur `security invoker`, un appel à une fonction accordée au seul `authenticated` n'apparaît que dans un bloc déjà gardé par `current_user = 'authenticated'` (ou `v_api`), jamais dans la même condition (`nodes_guard` imbrique ses appels). Sous le rôle du serveur, `current_user` vaut `platform_server` : un déclencheur qui garde une table que ce rôle écrit directement le nomme aussi (`expires_at_clock`) ; `nodes_guard`, `platform_grants_guard` et `team_members_guard` ne le nomment pas, aucune écriture directe de leurs tables ne courant sous lui.
- Sur une branche dont la migration n'est pas encore appliquée au projet partagé, tout test qui confronte le projet au dépôt (sa suite d'intégration, la garde de la carte `TABLES` d'`org-transfer.test.ts`) passe par `pendingMigrations` (`tests/helpers/pending-migrations.ts`) : il se saute en nommant la version jusqu'à l'application, au lieu d'échouer. Une migration appliquée au projet partagé part sur `main` sans attendre : tant qu'elle n'y est pas, la base porte un schéma que `main` ignore, et ses tests échouent. **Vérifiable :** la suite se saute sur le projet avec la raison `migration <version> … not applied`, et joue dans le job `bare-postgres`.
- **Une table, une vue ou une colonne ajoutée à `platform` entre dans la carte de l'export-import, dans la story qui porte la migration** (`TABLES` de `scripts/lib/org-transfer.mjs`) : dans `columns` si elle se recopie, dans `excluded` si la base la calcule (colonne générée, identité) ou la garde secrète — jamais dans `columns` pour faire passer la garde, un secret partirait dans chaque fichier d'export ; une table sans organisation, et toute vue (ses lignes sont celles de tables de la carte), vont dans `NEVER_EXPORTED`. La garde de la carte (`tests/integration/org-transfer.test.ts`) la confronte aux tables et vues du projet : elle échoue dès que la migration est appliquée, tant que la carte n'en décide pas. **Vérifiable :** un diff qui crée une table ou une vue, ou ajoute une colonne, dans `platform` modifie aussi `TABLES` ou `NEVER_EXPORTED`, et une colonne secrète y est dans `excluded`.
- **Une table ajoutée à `platform` reçoit aussi, dans la story qui porte la migration, une ligne de B dans `seedRows` de `tests/integration/isolation/donnees.ts`**, et son rattachement dans `PARENTS` si elle n'a pas d'`org_id`. Si sa policy d'insertion compare à `auth.uid()` une colonne hors de `AUTHORS`, ou fixe un état de création, cette colonne ou cet état s'ajoute à `AUTHORS` ou à `CREATION` de `tests/integration/isolation/tables.test.ts`. **Vérifiable :** la suite d'isolation échoue en nommant la table (« B n'a aucune ligne dans <t> », « table sans rattachement connu : <t> »).
- **Une colonne générée s'évalue avant les `CHECK`.** Postgres calcule les colonnes générées après les déclencheurs `BEFORE`, puis contrôle les policies (`WITH CHECK`) et les contraintes `CHECK` : une expression générée qui peut échouer (`text2ltree`, cast) sort sa propre erreur avant le `CHECK` qui devait refuser la valeur. **Vérifiable :** l'entrée d'une colonne générée qui peut échouer est contrôlée par un déclencheur `BEFORE` (ou par l'expression elle-même), et le test essaie une valeur qui la ferait échouer.
- **Un objet qui empêche de supprimer son propriétaire se garde en base.** Une suppression refusée tant qu'un objet dépend de la ligne (une équipe qui possède des nœuds ou des comptes) tient par une clé étrangère `on delete no action deferrable initially deferred` (`nodes.owner_team_id`), jamais par la seule lecture du service avant son `delete` : avec `on delete cascade`, un objet créé entre la lecture et la suppression, ou invisible sous RLS de qui supprime, part avec la ligne. Dans une fonction SQL non plus : la suppression épargne elle-même, dans la même instruction, ce que la lecture refusait, et la clé sans action refuse ce qui s'est rangé dessous après la lecture ; la condition sur la ligne supprimée porte sur ses propres colonnes, que Postgres relit sur leur dernière version quand une autre transaction l'a changée, jamais sur une sous-requête seule, qui lit l'instantané de l'instruction. **Vérifiable :** `rg -in "owner_team_id\) references platform\.teams" packages/plateforme/migrations` ne trouve que les clés d'`accounts` et de `nodes`, toutes deux `deferrable initially deferred` sans `on delete` ; dans une fonction SQL, tout `raise` qui refuse une suppression d'après une lecture est doublé par le `delete` qui suit, dont la condition exclut les mêmes lignes.
- **Un seul fichier de migration par version publiée du paquet** (fiche D124) : pendant le développement, chaque
  story Ⓜ garde son fichier (projet de test, CI et « migration appliquée figée » inchangés) ; avant le tag `vX.Y.0`,
  le pilote remplace les fichiers ajoutés depuis le tag précédent par un seul, `<horodatage>_vX_Y_0.sql`, concaténé
  dans l'ordre des horodatages sans une ligne changée, puis répare l'historique du projet de test (`migration repair`,
  anciennes versions `reverted`, la nouvelle `applied`), geste jamais fait par un agent ; aucune pré-version n'est
  publiée avant. **Vérifiable :** `git diff --name-status v<précédente> v<nouvelle> -- packages/plateforme/migrations`
  ne montre qu'une ligne `A` ; `pnpm check:migrations` et le job `bare-postgres` passent sur le fichier fusionné ;
  `supabase migration list` du projet de test est égal aux fichiers de `main`.
- **Une table dérivée avec organisation se range dans `NEVER_EXPORTED`** (`scripts/lib/org-transfer.mjs`) : elle se
  recalcule depuis les tables qu'elle résume, et un import ne l'écrit jamais (`lexicon`). **Vérifiable :** le
  test de la carte `TABLES` (`tests/integration/org-transfer.test.ts`) nomme chaque table du projet, exportée ou non.
- **Une fonction est `SECURITY INVOKER` (le défaut) par principe** : `SECURITY DEFINER` seulement pour ce que la RLS ne peut exprimer, et alors avec les règles de § Règles `SECURITY DEFINER`.
- **Un conflit de révision lève `PT409`, jamais `40001`** : `server/errors.ts` traduit `PT409` en `stale_revision`, alors que `40001` est le code qu'un client rejoue (PostgREST en boucle, sans rendre la main). **Vérifiable :** `rg "40001" packages/plateforme/migrations -g "*.sql"` ne trouve rien.
- **Un paramètre ajouté à une fonction existante crée une surcharge, jamais une ambiguïté** : `create or replace` avec un paramètre de plus crée une seconde fonction du même nom, et retirer l'ancienne n'est pas additif (FR-INST-04). La nouvelle prend son paramètre sans défaut ; l'ancienne appelle la nouvelle avec une valeur neutre (un seul corps). **Vérifiable :** deux fonctions de `platform` du même nom n'acceptent aucun même jeu d'arguments.

## Types & Enums

```sql
-- Créer un enum AVANT la table qui l'utilise
CREATE TYPE order_status AS ENUM ('pending', 'confirmed', 'preparing', 'ready', 'delivered', 'cancelled');

-- Ajouter une valeur à un enum existant
ALTER TYPE order_status ADD VALUE 'refunded';
-- Note : on ne peut PAS supprimer une valeur d'enum en PostgreSQL
```

**Côté TypeScript :**
```typescript
// Dériver les types depuis le schema Zod
const orderStatusSchema = z.enum(["pending", "confirmed", "preparing", "ready", "delivered", "cancelled"])
type OrderStatus = z.infer<typeof orderStatusSchema>
```

## Transactions

```typescript
// Le SDK (face PostgREST) n'ouvre aucune transaction entre deux appels : une opération atomique y
// passe par une fonction PostgreSQL. La face SQL de `server/` en ouvre une par `db.tx`,
// une par opération de service : règles dans supabase-patterns.md § Couplage à Supabase (ADR-012)
const { data, error } = await supabase.rpc("transfer_funds", {
  from_account: fromId,
  to_account: toId,
  amount: 1000,
})
```

```sql
-- SECURITY DEFINER s'exécute avec les droits du propriétaire : RLS est contournée par
-- construction. Une fonction SECURITY DEFINER est une API publique — elle doit valider
-- l'appelant elle-même, sinon n'importe quel compte connecté peut agir sur les données
-- d'un tiers en appelant simplement supabase.rpc().
CREATE OR REPLACE FUNCTION public.transfer_funds(
  from_account uuid, to_account uuid, amount integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''   -- sans ça, un search_path hostile détourne les noms de tables
AS $$
BEGIN
  IF amount <= 0 THEN
    RAISE EXCEPTION 'Montant invalide';
  END IF;

  -- Validation de l'appelant : RLS ne s'applique pas ici, ce guard la remplace
  IF NOT EXISTS (
    SELECT 1 FROM public.accounts
    WHERE id = from_account AND user_id = (SELECT auth.uid())
  ) THEN
    RAISE EXCEPTION 'Compte source non autorisé';
  END IF;

  -- Ordre verrouillé par id : deux transferts croisés simultanés ne peuvent pas se deadlock
  PERFORM 1 FROM public.accounts
   WHERE id IN (from_account, to_account) ORDER BY id FOR UPDATE;

  UPDATE public.accounts SET balance = balance - amount WHERE id = from_account;
  UPDATE public.accounts SET balance = balance + amount WHERE id = to_account;

  IF (SELECT balance FROM public.accounts WHERE id = from_account) < 0 THEN
    RAISE EXCEPTION 'Solde insuffisant';   -- rollback implicite de toute la fonction
  END IF;
END;
$$;

-- EXECUTE est accordé à `public` par défaut, donc à `anon`. Toujours révoquer puis
-- accorder explicitement.
REVOKE EXECUTE ON FUNCTION public.transfer_funds(uuid, uuid, integer) FROM public;
GRANT  EXECUTE ON FUNCTION public.transfer_funds(uuid, uuid, integer) TO authenticated;
```

**Contrôle par lecture d'autres lignes : le verrou d'abord.** Une fonction ou un déclencheur qui
valide une écriture en lisant d'autres lignes que l'écriture ne verrouille pas (un doublon par
`if exists (select …)`, le chemin du parent, un cycle) laisse passer deux écritures simultanées :
aucune ne voit l'autre avant sa validation. Un index unique porte la règle quand son prédicat le
permet ; sinon (prédicat avec `now()`, comme l'expiration d'une invitation ; invariant sur
plusieurs lignes, comme un arbre), la fonction prend d'abord `pg_catalog.pg_advisory_xact_lock(<classe>,
pg_catalog.hashtext(<clé>))`, relâché à la fin de la transaction, puis lit (fonction volatile :
chaque requête voit ce qui a été validé avant elle). Classes : 7101 invitations, 7201
numéros de ticket (réservée), 7301 arbre d'une organisation (insertion et
déplacement d'un nœud, clé `org_id`), 7401 brouillon d'un nœud (chaque écriture
d'un bloc `draft` sous un jeton la prend en partage sans attendre, `publish_node` en exclusif avant
tout autre verrou, clé `node_id`), 7501 quota des fichiers joints d'une organisation (demande
d'envoi, dépôt par lien et duplication, avant de sommer `files.size`, clé `org_id`), 7601 limites comptées d'une
organisation (invitation, équipe, connecteur, avant de compter, clé `org_id`, `server/limits.ts`). Un verrou pris dans un déclencheur de ligne
vient après le verrou de la ligne écrite : deux écritures qui se croisent peuvent s'interbloquer,
Postgres en annule une (`40P01`), l'invariant tient. **Vérifiable :** tout `raise exception` de
doublon qui suit un `exists` sur la même table, et tout contrôle d'une ligne contre d'autres lignes
qu'une transaction concurrente peut changer, vient après un `pg_advisory_xact_lock`, ou sous le
verrou de la ligne lue (`for share`, `for no key update` : la ligne que l'écriture concurrente doit
modifier ou retirer), ou un index unique porte la règle, ou une clé sans action (la suppression
épargne ce que la lecture refuse : § Migrations, « Un objet qui empêche de supprimer son
propriétaire ») ; le test lance les écritures en même
temps (`Promise.all`) et relit l'invariant. Une fenêtre entre deux instructions d'une fonction, que
`Promise.all` ne touche presque jamais, se rend déterministe : l'autre transaction tient un verrou
(la ligne qu'elle écrit, ou la table en mode `share` pour passer entre une lecture et une écriture)
jusqu'à ce que `pg_locks` montre la fonction qui l'attend (`forgetDuring`,
`tests/integration/portabilite-schema.test.ts`) ; ce test échoue sur le code d'avant la correction.

### Règles `SECURITY DEFINER`

Toute fonction `SECURITY DEFINER` :
- déclare `SET search_path = ''` et qualifie ses tables en `public.<table>` (le linter Supabase le signale : `function_search_path_mutable`)
- valide `auth.uid()` contre chaque paramètre qui désigne une ressource — c'est le seul contrôle d'accès, RLS étant contournée. Un droit tiré d'une colonne lue par la fonction (`teams.lead_user_id`) se double de l'appartenance de l'appelant à l'organisation (`platform.member_orgs()`) : la RLS de la table lue, qui la garantissait, ne s'applique plus
- est suivie d'un `REVOKE EXECUTE ... FROM public` puis d'un `GRANT` au rôle voulu

**Vérifiable :** dans un diff, tout `SECURITY DEFINER` sans les trois éléments ci-dessus est un défaut HAUTE.

**Un fait venu d'un tiers ou du serveur s'écrit sous `platform_server` seul.** Une fonction `SECURITY DEFINER` croit
ses paramètres : quand l'un porte une valeur que la personne ne décide pas (un identifiant ou une date rendus par un
tiers, la raison d'un refus, un plafond ou une adresse de l'hôte, un sel, le libellé d'un connecteur déclaré, l'état
d'un objet lu dans le stockage), elle se révoque à `public`, `anon` et `authenticated` et ne s'accorde qu'à
`platform_server`, et le service l'appelle sous `db.tx(fn, "server")` (ou `inTransaction(…, "server")`). De même, une
colonne dont la valeur vient d'un tiers ou du serveur ne s'accorde en écriture qu'à `platform_server` ; une échéance
que pose le serveur se garde à l'horloge de la base (`platform.expires_at_clock`). `platform_server` hérite
d'`authenticated` : la règle d'`auth.uid()` ci-dessus vaut toujours. **Vérifiable :**
`tests/integration/role-du-serveur.test.ts` échoue sur toute fonction `SECURITY DEFINER` exécutable par
`authenticated` ou `anon` hors de sa liste fermée, et sur toute colonne qu'`authenticated` ou `anon` peut modifier
hors de la sienne ; une entrée ajoutée à l'une de ces listes dit pourquoi elle n'écrit aucun fait affirmé.

**Exception écrite — fonctions d'accueil.** Une fonction que l'architecture ouvre à qui n'est pas
membre ne compare pas `auth.uid()` à son paramètre : ce qu'elle rend est son contrôle d'accès.
Deux existent (`docs/reference/schema-platform.md`) : `org_by_host` (l'organisation d'une adresse,
exécutable par `anon`) rend `id`, `slug`, `name`, `prefix`, `brand` et `domains`
(les domaines de travail de `settings`, chaîne libre que cite la description de `context`) ;
`org_contact` (l'admin le plus ancien, à qui demander d'entrer, exécutable par toute personne
connectée — donc aussi par un membre d'une autre organisation qui en connaît l'adresse) rend
`name` et `email`. Une telle fonction rend seulement les colonnes listées ici, jamais une ligne
entière : une colonne de plus s'inscrit d'abord dans cette liste et dans
`docs/reference/schema-platform.md`. Elle garde `search_path` vide et un `GRANT` au rôle le plus étroit.
Une fonction que seul un rôle de service exécute (`hook_before_user_created` :
`supabase_auth_admin`) n'a pas d'`auth.uid()` à comparer : son `GRANT` est son
contrôle. **Vérifiable :** un `SECURITY DEFINER` exécutable par `anon` ou `authenticated` sans
contrôle de `auth.uid()` est l'une de ces deux fonctions, qui rend les colonnes listées ici et
rien d'autre, ou une fonction qu'`docs/reference/schema-platform.md` ou un document de `docs/conception/` ouvre
explicitement ; sinon, défaut HAUTE.

**Exception écrite — fonctions internes.** Une fonction exécutable par aucun rôle (`REVOKE` de
`public`, aucun `GRANT`) ne contrôle pas `auth.uid()` et n'a pas de `GRANT` : seuls d'autres
fonctions ou déclencheurs l'appellent, et c'est leur appelant qui porte le contrôle d'accès.
Exemples : `ensure_private_space`, `unique_handle`, `members_tree_sync`. **Vérifiable :** dans le
diff, la fonction n'a aucun `GRANT … ON FUNCTION`, son `REVOKE … FROM public` est écrit, et chacun de
ses appelants est une fonction, un déclencheur ou une migration du schéma `platform` ; sinon, défaut
HAUTE.

## Paramètres des requêtes (postgres.js)

Les règles de la face SQL (paramètres `json` et `jsonb`, `sql(rows)`, `timestamptz`) vivent dans
`supabase-patterns.md § Couplage à Supabase (ADR-012)`, routée sur `server/**` et sur l'outillage
(`_index.md`) ; ce tag-ci ne l'est que sur les migrations.

## Soft Deletes

```sql
-- Pattern : colonne deleted_at + RLS qui exclut
ALTER TABLE items ADD COLUMN deleted_at timestamptz;

-- RLS : ne jamais montrer les supprimés
CREATE POLICY items_select_active ON items
  FOR SELECT USING (auth.uid() = user_id AND deleted_at IS NULL);
```

```typescript
// Server Action : soft delete
export async function deleteItem(id: string) {
  const supabase = await createClient()
  const { error } = await supabase
    .from("items")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
  // ...
}
```

## Indexes

**Vérifiable sur un diff — un index est créé dans la même migration pour :**
- toute colonne `*_id` référençant une autre table (PostgreSQL n'indexe **pas** les foreign keys)
- toute colonne utilisée dans un `.eq()`, `.in()`, `.order()` ou `.ilike()` d'une requête du diff
- toute colonne servant de curseur de pagination (index composé `(colonne, id)`)

**Ne pas indexer :** une colonne booléenne seule, une colonne jamais filtrée, une table de
référence figée de moins de 1 000 lignes. Un index inutile ralentit toutes les écritures.

**Un index GIN se crée `with (fastupdate = off)`.** Sa liste d'attente, pleine après une insertion
en masse, le fait juger trop cher par le planificateur, qui lit alors toute la table (mesuré :
318 pages après 6 000 insertions, index écarté ; 46 pages et index utilisé sans liste
d'attente). **Vérifiable :** tout `using gin` d'une migration porte `fastupdate = off`.

```sql
-- Index simple
CREATE INDEX idx_orders_user_id ON orders(user_id);

-- Index composé (ordre = important)
CREATE INDEX idx_orders_user_status ON orders(user_id, status);

-- Index partiel (plus petit, plus rapide)
CREATE INDEX idx_orders_pending ON orders(created_at) WHERE status = 'pending';

-- Index full-text
CREATE INDEX idx_items_search ON items USING gin(to_tsvector('french', name || ' ' || description));
```

## N+1 Queries

```typescript
// MAUVAIS — N+1 : 1 requête + N requêtes dans la boucle
const { data: orders } = await supabase.from("orders").select("*")
for (const order of orders) {
  const { data: items } = await supabase.from("order_items").select("*").eq("order_id", order.id)
}

// BON — 1 requête avec jointure
const { data: orders } = await supabase
  .from("orders")
  .select("*, order_items(*)")
```

## Seeds (développement)

```sql
-- supabase/seed.sql — données de développement
-- Exécuté avec : supabase db reset

INSERT INTO profiles (id, email, full_name, role)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'admin@dev.local', 'Admin Dev', 'admin'),
  ('00000000-0000-0000-0000-000000000002', 'user@dev.local', 'User Dev', 'user');
```

**Règles :**
- UUIDs déterministes pour les seeds (facilite les tests)
- Jamais de données réelles dans les seeds
- Seeds documentés dans `supabase/seed.sql`
