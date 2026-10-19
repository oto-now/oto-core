-- oto-platform db prepare : ce qu'un Postgres doit porter avant les migrations du paquet (E01-S09,
-- ADR-012 § 1). Les migrations ne touchent que le schéma `platform` (ADR-006 § 1) : ni rôle, ni
-- schéma `auth`, ni schéma `extensions`. Sur un Postgres sans Supabase, cette préparation les pose
-- une fois ; sur Supabase, qui les a déjà, seule la section « tout hôte » s'exécute : les rôles
-- `platform_app` et `platform_server`.
--
-- Lu par `db-prepare.mjs` : une section commence à sa ligne `-- section: <nom>` ; chaque instruction
-- s'exécute seule, dans une même transaction. Chacune regarde d'abord ce qui existe et le dit par une
-- notice : un second passage ne change rien. Le mot de passe de `platform_app` arrive par
-- `set_config('oto_platform.app_password', …, true)`, jamais dans le texte d'une instruction.
-- Rien ici ne crée `moddatetime` ni de table `auth.users`.

-- section: postgres-nu

-- Les rôles que les policies et les privilèges du paquet nomment ; aucun ne se connecte.
do $$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_catalog.pg_roles where rolname = v_role) then
      raise notice 'rôle % : déjà présent', v_role;
    else
      execute pg_catalog.format('create role %I nologin', v_role);
      raise notice 'rôle % : créé', v_role;
    end if;
  end loop;
end
$$;

-- Le schéma `auth` réduit à ce que lisent les policies et les fonctions du paquet : l'appelant et
-- ses claims, posés par la session dans `request.jwt.claims`, comme sur Supabase.
do $$
begin
  if exists (select 1 from pg_catalog.pg_namespace where nspname = 'auth') then
    raise notice 'schéma auth : déjà présent';
  else
    create schema auth;
    raise notice 'schéma auth : créé';
  end if;
  grant usage on schema auth to anon, authenticated;
end
$$;

do $$
begin
  if pg_catalog.to_regprocedure('auth.uid()') is null then
    create function auth.uid() returns uuid
      language sql stable
      as $f$ select (nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $f$;
    raise notice 'fonction auth.uid() : créée';
  else
    raise notice 'fonction auth.uid() : déjà présente';
  end if;
  if pg_catalog.to_regprocedure('auth.jwt()') is null then
    create function auth.jwt() returns jsonb
      language sql stable
      as $f$ select nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb $f$;
    raise notice 'fonction auth.jwt() : créée';
  else
    raise notice 'fonction auth.jwt() : déjà présente';
  end if;
  if pg_catalog.to_regprocedure('auth.role()') is null then
    create function auth.role() returns text
      language sql stable
      as $f$ select nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' $f$;
    raise notice 'fonction auth.role() : créée';
  else
    raise notice 'fonction auth.role() : déjà présente';
  end if;
end
$$;

-- Les trois extensions du paquet, dans le schéma `extensions` que ses migrations nomment ; les
-- seules qu'admet aussi le Postgres managé de Scaleway (relevé de JB du 2026-09-25).
do $$
begin
  if exists (select 1 from pg_catalog.pg_namespace where nspname = 'extensions') then
    raise notice 'schéma extensions : déjà présent';
  else
    create schema extensions;
    raise notice 'schéma extensions : créé';
  end if;
  grant usage on schema extensions to anon, authenticated;
end
$$;

do $$
declare
  v_extensions constant text[] := array['pg_trgm', 'unaccent', 'ltree'];
  v_extension text;
  v_elsewhere text;
begin
  foreach v_extension in array v_extensions loop
    if exists (select 1 from pg_catalog.pg_extension where extname = v_extension) then
      raise notice 'extension % : déjà présente', v_extension;
      continue;
    end if;
    begin
      execute pg_catalog.format('create extension %I with schema extensions', v_extension);
    exception when others then
      raise exception 'extension % refusée par l''hôte : %', v_extension, sqlerrm;
    end;
    raise notice 'extension % : créée', v_extension;
  end loop;
  select pg_catalog.string_agg(e.extname || ' (schéma ' || n.nspname || ')', ', ' order by e.extname)
    into v_elsewhere
    from pg_catalog.pg_extension e
    join pg_catalog.pg_namespace n on n.oid = e.extnamespace
   where e.extname = any (v_extensions) and n.nspname <> 'extensions';
  if v_elsewhere is not null then
    raise exception 'extension hors du schéma extensions, que nomment les migrations : %', v_elsewhere;
  end if;
end
$$;

-- section: tout-hote

-- Le rôle de connexion du serveur (ADR-012 § 1) : il ne fait que devenir `authenticated` ou `anon`
-- (`noinherit`), jamais au-delà de la RLS (ni `bypassrls` ni `createrole`).
do $$
declare
  v_password text := pg_catalog.current_setting('oto_platform.app_password', true);
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'platform_app') then
    raise notice 'rôle platform_app : déjà présent, inchangé';
  elsif coalesce(v_password, '') = '' then
    raise exception 'PLATFORM_APP_PASSWORD manquant : il donne son mot de passe au rôle platform_app, à créer';
  else
    -- Un refus relevé tel quel citerait l'instruction, mot de passe compris, dans le journal du
    -- serveur (CONTEXT) : seul son message repart.
    begin
      execute pg_catalog.format(
        'create role platform_app login noinherit nocreatedb nocreaterole nobypassrls password %L', v_password);
    exception when others then
      raise exception 'rôle platform_app refusé par l''hôte : %', sqlerrm;
    end;
    raise notice 'rôle platform_app : créé (login, noinherit, ni bypassrls ni createrole)';
  end if;
end
$$;

do $$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_catalog.pg_auth_members m
                where m.roleid = v_role::regrole and m.member = 'platform_app'::regrole) then
      raise notice 'platform_app membre de % : déjà', v_role;
    else
      execute pg_catalog.format('grant %I to platform_app', v_role);
      raise notice 'platform_app membre de % : accordé', v_role;
    end if;
  end loop;
end
$$;

-- Le rôle du serveur (lot 1 du correctif des faits affirmés) : ce que le serveur seul écrit, un fait venu d'un tiers ou
-- du serveur (liaison d'un compte hébergé, marque, jetons et état d'un compte, entrée dans une organisation, passage
-- d'un fichier à `ready`…), passe par lui, aux mêmes claims que l'appelant (`server/sql.ts`). `nologin` : personne ne
-- s'y connecte ; il hérite d'`authenticated` (mêmes policies et mêmes droits, `auth.uid()` et `auth.jwt()` lus comme
-- lui), jamais au-delà de la RLS (ni `bypassrls` ni `createrole`). Seul `platform_app` le prend ; `authenticator`
-- (PostgREST) n'en est jamais membre, et la migration qui s'en sert le vérifie.
do $$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'platform_server') then
    raise notice 'rôle platform_server : déjà présent, inchangé';
  else
    begin
      create role platform_server nologin inherit nocreatedb nocreaterole nobypassrls;
    exception when others then
      raise exception 'rôle platform_server refusé par l''hôte : %', sqlerrm;
    end;
    raise notice 'rôle platform_server : créé (nologin, hérite d''authenticated, ni bypassrls ni createrole)';
  end if;
end
$$;

do $$
declare
  v_grant text[];
begin
  foreach v_grant slice 1 in array array[array['authenticated', 'platform_server'], array['platform_server', 'platform_app']] loop
    if exists (select 1 from pg_catalog.pg_auth_members m
                where m.roleid = v_grant[1]::regrole and m.member = v_grant[2]::regrole) then
      raise notice '% membre de % : déjà', v_grant[2], v_grant[1];
    else
      execute pg_catalog.format('grant %I to %I', v_grant[1], v_grant[2]);
      raise notice '% membre de % : accordé', v_grant[2], v_grant[1];
    end if;
  end loop;
end
$$;
