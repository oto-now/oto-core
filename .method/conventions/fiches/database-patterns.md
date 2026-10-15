# Fiche — database-patterns

Texte complet : `.method/conventions/database-patterns.md`. La fiche suffit pour écrire ; le texte complet se lit sur un doute, et toujours pour une revue. Chaque règle renvoie à sa section.

- Tables en `snake_case` au pluriel, clé `id` uuid, clé étrangère `<table_singulier>_id`, index `idx_<table>_<colonnes>`, policy `<table>_<opération>_<qui>`, fonction `snake_case` à verbe. § Naming Conventions
- Un fichier de migration s'appelle `YYYYMMDDHHMMSS_description.sql` et se crée par `pnpm db:migrate <nom>`. § Naming · § Commande
- Une migration pose, dans l'ordre, la table, ses index, la RLS et ses policies, puis `updated_at` par `platform.set_updated_at()`, jamais `moddatetime`. § Structure d'une migration
- Aucune modification manuelle en base : tout passe par une migration. § Règles
- Portable, Supabase comme Postgres nu : aucune clé ni lecture vers `auth.users`, aucune extension hors `pg_trgm`, `unaccent` et `ltree` ; une colonne de personne entre dans `platform.forget_user` dans sa migration ; un privilège de `service_role` ou `supabase_auth_admin` s'accorde dans un bloc `do` qui vérifie le rôle. § Règles
- Jamais `IF NOT EXISTS` sur un schéma, une table ou un index (seule exception : `CREATE EXTENSION`) : une migration qui ne peut pas s'appliquer échoue. § Règles
- Une migration appliquée est figée, commentaires compris : ni modifiée ni renommée, elle ne cite qu'un renvoi déjà écrit à son application ; une correction est une nouvelle migration ; un agent l'applique par `supabase db push`, jamais par `migration repair`, qui ne nomme jamais une version absente de `supabase/migrations/`. § Règles
- Une migration qui crée une fonction posant un paramètre de `pg_trgm` commence par `DO $$ begin perform extensions.similarity('a', 'a'); end $$;` (un rôle non superutilisateur ne pose le paramètre que d'une bibliothèque chargée). § Règles
- `CREATE POLICY` et `CREATE TRIGGER` sont précédés d'un `DROP … IF EXISTS` (la ligne de base exceptée). § Règles
- La RLS s'active et les policies se créent dans la migration de la table ; toute policy `FOR UPDATE` déclare `WITH CHECK`. § Règles
- Une migration destructive (`DROP`, `ALTER … TYPE`, `SET NOT NULL`, `RENAME`) a son rollback dans `supabase/migrations/rollback/<timestamp>.sql` et se découpe en expand/contract sur deux déploiements. § Règles
- Une migration n'arrive jamais seule dans un diff : une entrée de `supabase/seed.sql` ou un test qui lit ou écrit la table l'accompagne. § Règles
- NULL passe un `CHECK` et saute un `if` : une comparaison à une valeur nullable s'écrit `is not distinct from` ou `coalesce(…, false)`, ou le cas NULL à part ; le test essaie NULL, SQL donné « tel quel » par une story compris. § Règles
- Dans un déclencheur `security invoker`, l'appel d'une fonction accordée au seul `authenticated` vit dans un `if` imbriqué sous `current_user = 'authenticated'`, jamais dans la même condition. § Règles
- Sur une branche dont la migration n'est pas encore appliquée au projet partagé, tout test qui confronte le projet au dépôt passe par `pendingMigrations` et se saute en nommant la version ; une migration appliquée part sur `main` sans attendre. § Règles
- Une table, une vue ou une colonne ajoutée à `platform` entre dans `TABLES` de `scripts/lib/org-transfer.mjs` dans la même story : `columns`, `excluded` si générée ou secrète, `NEVER_EXPORTED` si sans organisation, vue ou table dérivée. § Règles
- Une table ajoutée à `platform` reçoit une ligne de B dans `seedRows` de `tests/integration/isolation/donnees.ts` (et `PARENTS` sans `org_id`), et `AUTHORS` ou `CREATION` de `tables.test.ts` si sa policy d'insertion l'exige. § Règles
- Une colonne générée qui peut échouer (`text2ltree`, cast) a son entrée contrôlée par un déclencheur `BEFORE` ; le test essaie la valeur fautive. § Règles
- Un objet qui empêche de supprimer son propriétaire tient par une clé `on delete no action deferrable initially deferred`, jamais `cascade` ni la seule lecture du service ; en SQL, le `delete` épargne lui-même ce que la lecture refusait. § Règles
- Une fonction est `SECURITY INVOKER` par défaut ; `SECURITY DEFINER` seulement pour ce que la RLS ne peut exprimer. § Règles
- Un conflit de révision lève `PT409` (traduit en `stale_revision`), jamais `40001`. § Règles
- Un paramètre ajouté à une fonction existante crée une surcharge sans ambiguïté : la nouvelle le prend sans défaut, l'ancienne l'appelle avec une valeur neutre. § Règles
- Un enum se crée avant la table qui l'utilise, et aucune de ses valeurs ne se retire ; côté TypeScript, le type se tire d'un `z.enum`. § Types & Enums
- Un contrôle d'écriture qui lit d'autres lignes prend d'abord `pg_advisory_xact_lock(<classe>, hashtext(<clé>))` (7101 invitations, 7201 tickets, 7301 arbre, 7401 brouillon, 7501 quota des fichiers joints, 7601 limites comptées d'une organisation), ou le verrou de la ligne lue, ou s'appuie sur un index unique ou une clé sans action ; son test lance les écritures ensemble et relit l'invariant. § Transactions
- Une fonction `SECURITY DEFINER` déclare `SET search_path = ''` et qualifie ses tables, valide `auth.uid()` contre chaque paramètre qui désigne une ressource (plus l'appartenance à l'organisation pour un droit lu dans une colonne), puis `REVOKE EXECUTE … FROM public` et `GRANT` au rôle voulu ; sinon HAUTE. § Règles `SECURITY DEFINER`
- Seules exceptions sans contrôle d'`auth.uid()` : `org_by_host` et `org_contact`, qui rendent leurs seules colonnes listées, une fonction qu'un ADR ouvre, ou une fonction de rôle de service, dont le `GRANT` est le contrôle ; une fonction interne, exécutable par aucun rôle (`REVOKE` de public, aucun `GRANT`), appelée seulement par d'autres fonctions ou des déclencheurs, n'a ni contrôle d'`auth.uid()` ni `GRANT`. § Règles `SECURITY DEFINER`
- Paramètres postgres.js (`json`, `sql(rows)`, `timestamptz`) : `supabase-patterns.md § Couplage à Supabase (ADR-012)`. § Paramètres des requêtes (postgres.js)
- Un index se crée dans la même migration pour toute `*_id` qui référence une table, toute colonne filtrée ou triée par une requête du diff, tout curseur `(colonne, id)` ; aucun index sur un booléen seul ni une colonne jamais filtrée. § Indexes
- Tout `using gin` porte `with (fastupdate = off)`. § Indexes
- Aucune requête dans une boucle : une jointure. § N+1 Queries
- Seeds à UUID déterministes, sans donnée réelle, dans `supabase/seed.sql`. § Seeds (développement)
