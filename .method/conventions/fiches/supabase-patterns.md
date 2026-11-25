# Fiche — supabase-patterns

Texte complet : `.method/conventions/supabase-patterns.md`. La fiche suffit pour écrire ; le texte complet se lit sur un doute, et toujours pour une revue. Chaque règle renvoie à sa section.

- Le client navigateur sert l'écoute de l'auth (et un éventuel realtime), rien d'autre : toute mutation passe par une Server Action et le client serveur. § Browser Client (realtime + auth listener uniquement)
- RLS sur toute table, sans exception ; aucun `service_role` sans ADR ; `USING` filtre les lignes, `WITH CHECK` valide celles écrites. § Règles RLS
- Une policy de `platform` borne l'organisation de la ligne (`org_id in (select platform.member_orgs())`) et ses invariants sur ses colonnes ; aucune fonction de droit ni rôle, `is_staff()` dans les quatre policies de portée plateforme seules ; `with check` sur tout `for update`. § Règles RLS
- Aucune policy ne relit sa propre table par `id` (un `insert … returning` ou le `with check` d'une mise à jour ne verraient pas la nouvelle ligne). § Règles RLS
- Aucune sous-requête de policy ne revient sur une table dont Postgres développe déjà les policies (`42P17`) ; `tests/unit/rls-policies.test.ts` le contrôle. § Règles RLS
- Une recherche sous RLS passe par une fonction `security definer` qui contrôle l'appartenance puis applique le niveau de lecture aux seules lignes trouvées. § Règles RLS
- Une exception à l'héritage d'un droit (espace personnel) borne aussi les règles posées au-dessus ; son test pose une règle sur un ancêtre. § Règles RLS
- Tout geste de l'API qui peut retirer à l'appelant sa propre appartenance a un test qui relit sa ligne de journal. § Règles RLS
- Jamais `error.message`, `details` ni `hint` rendus au client : une constante, ou `handleSupabaseError(error)`. § Error Handling
- Toute réponse de base déstructure `error` et le traite ; une relecture sans ligne ni erreur n'est pas une panne ; `fromDatabaseError` ne reçoit que l'erreur lue par un `if (x.error)`. § Error Handling
- Une erreur garde son objet jusqu'à `fromDatabaseError` ou `databaseFailure`, jamais réduite à une chaîne ou un booléen (`return "failed"`). § Error Handling
- `PGRST301` et `PGRST303` (jeton refusé) deviennent `unauthorized` ; ces codes ne se lisent que dans `server/errors.ts`. § Error Handling
- Une insertion supabase-js de lignes aux clés différentes porte `{ defaultToNull: false }`. § Error Handling
- Toute coupe d'une chaîne écrite en base passe par `clip`, jamais une moitié de paire de substitution ; une chaîne d'arguments du catalogue écrite en base passe par `wellFormed`. § Error Handling
- Le paquet ne lit `platform` que par `db.tx` : aucun `.from(` ni `.rpc(` dans `server/`, `api/`, `mcp/` ; `READ_PAGE_ROWS` borne les lectures SQL bornées. § Error Handling
- Aucun nouvel appel à `supabase.auth.*` ni nouvelle lecture du schéma `auth` hors des points admis (`auth.uid()` et `auth.jwt()` restent permis). § Couplage à Supabase (ADR-012)
- La vérification du jeton s'injecte sur chaque porte (`VerifyToken`, `makeVerifyToken`) ; une porte n'appelle ni `jwtVerify` ni `getUser`. § Couplage à Supabase (ADR-012)
- Le port de stockage ne lit d'un `HEAD` que l'existence et la taille, jamais le type (Supabase Storage relit `text/html` en `text/plain`) ; le bucket en mémoire joue ce fournisseur. § Couplage à Supabase (ADR-012)
- Une lecture de taille au stockage envoie `accept-encoding: identity` hors de la signature, et ne lit jamais un `content-length` absent ou compressé (le CDN compresse `text/plain`) : repli sur `content-range` d'un `GET bytes=0-0`, sinon taille `null`, jamais `NaN`. § Couplage à Supabase (ADR-012)
- Une hypothèse sur PostgREST (code `PGRST…`, `PT409`, `READ_PAGE_ROWS`, droit par colonne) ne s'écrit que dans `server/errors.ts`. § Couplage à Supabase (ADR-012)
- La face SQL ne pose aucun `set` de session : rôle, claims et délais par `set_config(…, true)` ou `set local`, dans `server/sql.ts` seul. § Couplage à Supabase (ADR-012)
- Un `db.tx` ne tient que ses requêtes : il n'ouvre pas la transaction d'une autre session, et son `fn` n'appelle ni `fetch`, ni `db.auth`, ni un client Auth, ni le service connecteurs. § Couplage à Supabase (ADR-012)
- Dans un `db.tx`, aucun `catch` ne rattrape une erreur de base ; une course sur une clé unique se lit par `insert … on conflict do nothing returning` sans ligne. Exception écrite : sous l'écriture atomique (`write-atomic.ts` : un assistant, ou le genre seul publié par toute porte), l'erreur rattrapée par un service perd toute l'écriture, rejouée une fois. § Couplage à Supabase (ADR-012)
- Tout `update` et tout `delete` de la face SQL portent un `where`. § Couplage à Supabase (ADR-012)
- Un paramètre `json` ou `jsonb` passe par `sql.json(valeur)`, jamais `JSON.stringify(…)` (réservé à un paramètre `text`) ; une chaîne lue en `::text` se réécrit par `${chaine}::text::jsonb`, jamais `${chaine}::jsonb`. § Couplage à Supabase (ADR-012)
- `sql(rows)` prend les colonnes de la première ligne : ses lignes sortent d'une même fabrique ou d'un groupe par colonnes. § Couplage à Supabase (ADR-012)
- Une ligne insérée se retrouve dans le `returning` par son rang (ordre des valeurs), jamais par l'égalité d'une valeur flottante relue. § Couplage à Supabase (ADR-012)
- Un paramètre `timestamptz` est une `Date` à la milliseconde ; une date relue pour être réécrite ou comparée à l'égalité reste en base ou passe en texte (`${tampon}::text::timestamptz`). § Couplage à Supabase (ADR-012)
- Un ordre promis se pose par `order by` au niveau qui rend les lignes, jamais dans une sous-requête lue par `to_json` ou `json_agg`. § Couplage à Supabase (ADR-012)
- Un `order by` ne nomme jamais seul l'alias d'une expression du `select` : qualifier la colonne (`blocks.updated_at`). § Couplage à Supabase (ADR-012)
