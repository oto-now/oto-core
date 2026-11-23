-- La personne en attente sans échéance (conception, identité et connexion § Personne en attente, sans email ; décision
-- du 22/11) : l'inscription que fait `member.add` (`registerInvitation`) part sans email d'oto ; l'hôte prévient la
-- personne lui-même, qui peut se connecter des semaines plus tard. Elle n'expire donc pas : `expires_at` nul. Une
-- invitation envoyée par email garde son échéance, la valeur par défaut de la colonne. `member.remove` retire une attente.
-- Partout où une invitation ouverte se lit, une échéance nulle compte comme ouverte. Un seul bloc ROLLBACK en fin de
-- fichier.

-- 1. La colonne admet l'absence d'échéance ; sa valeur par défaut (sept jours) reste celle d'une invitation envoyée.
--    Aucune ligne existante ne change.
ALTER TABLE platform.invitations ALTER COLUMN expires_at DROP NOT NULL;

COMMENT ON COLUMN platform.invitations.expires_at IS 'Échéance de l''invitation envoyée par email (sept jours par défaut) ; nulle pour une inscription sans email, qui n''expire pas.';

-- 2. Le service pose l'absence d'échéance à l'insertion, sous la session de qui inscrit. Les policies d'insertion ne
--    changent pas : mêmes droits que pour une invitation.
GRANT INSERT(expires_at) ON TABLE platform.invitations TO authenticated;

-- 3. `invitations_guard` : une attente sans échéance est une invitation ouverte (`already_invited`) ; le reste du corps
--    est celui de la ligne de base.
CREATE OR REPLACE FUNCTION platform.invitations_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  -- Sous une session, l'organisation de l'invitation est une organisation de l'appelant : ce déclencheur lit
  -- l'annuaire des membres et ne dit rien d'une adresse à qui n'en est pas membre (la RLS ne juge la ligne
  -- qu'après lui).
  if (select auth.uid()) is not null and new.org_id not in (select platform.member_orgs()) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;
  -- Relâché à la fin de la transaction. Classe 7101 : invitations.
  perform pg_catalog.pg_advisory_xact_lock(7101, pg_catalog.hashtext(new.org_id::text || ':' || new.email));
  if exists (
    select 1 from platform.members m
     where m.org_id = new.org_id and m.email = new.email
  ) then
    raise exception 'already_member' using errcode = '23505';
  end if;
  if exists (
    select 1 from platform.invitations i
     where i.org_id = new.org_id and i.email = new.email
       and i.accepted_at is null and i.declined_at is null and i.revoked_at is null
       and (i.expires_at is null or i.expires_at > now())
  ) then
    raise exception 'already_invited' using errcode = '23505';
  end if;
  return new;
end;
$$;

-- 4. `accept_invitations` : la personne en attente entre à sa première connexion, quelle qu'en soit la date (le reste
--    du corps est celui de 20261003090000_v1_4_0.sql).
CREATE OR REPLACE FUNCTION platform.accept_invitations() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_uid uuid := (select auth.uid());
  v_claims jsonb := coalesce((select auth.jwt()), '{}'::jsonb);
  v_email text := lower(nullif(v_claims ->> 'email', ''));
  v_name text := nullif(coalesce(v_claims -> 'user_metadata' ->> 'full_name',
                                 v_claims -> 'user_metadata' ->> 'name',
                                 v_claims ->> 'name'), '');
  v_last_sign_in timestamptz := now();
  v_inv record;
  v_joined jsonb := '[]'::jsonb;
begin
  if v_uid is null or v_email is null then
    return v_joined;
  end if;
  for v_inv in
    select i.id, i.org_id, i.role, i.team_id
      from platform.invitations i
     where i.email = v_email and i.accepted_at is null and i.declined_at is null
       and i.revoked_at is null and (i.expires_at is null or i.expires_at > now())
     order by i.created_at
       for update
  loop
    insert into platform.members as m (org_id, user_id, role, profile, email, name, last_sign_in_at)
    values (v_inv.org_id, v_uid, v_inv.role,
            jsonb_strip_nulls(jsonb_build_object(
              'handle', platform.unique_handle(v_inv.org_id, v_email), 'name', v_name)),
            v_email, v_name, v_last_sign_in)
    on conflict (org_id, user_id) do update
      set role = case when m.role = 'member' and excluded.role = 'admin' then 'admin' else m.role end;
    if v_inv.team_id is not null then
      insert into platform.team_members (team_id, user_id, role)
      values (v_inv.team_id, v_uid, 'member')
      on conflict (team_id, user_id) do nothing;
    end if;
    update platform.invitations
       set accepted_at = now(), accepted_by = v_uid
     where id = v_inv.id;
    -- Une invitation acceptée lève l'exclusion de la personne dans cette organisation : la seule façon de la lever.
    delete from platform.member_exclusions x where x.org_id = v_inv.org_id and x.user_id = v_uid;
    v_joined := v_joined || (
      select jsonb_build_array(jsonb_build_object(
               'org_id', o.id, 'slug', o.slug, 'name', o.name, 'role', mm.role))
        from platform.orgs o
        join platform.members mm on mm.org_id = o.id and mm.user_id = v_uid
       where o.id = v_inv.org_id
    );
  end loop;
  update platform.members m
     set email = v_email, name = v_name, last_sign_in_at = v_last_sign_in
   where m.user_id = v_uid
     and (m.email, m.name, m.last_sign_in_at) is distinct from (v_email, v_name, v_last_sign_in);
  return v_joined;
end;
$$;

REVOKE ALL ON FUNCTION platform.accept_invitations() FROM PUBLIC;
GRANT ALL ON FUNCTION platform.accept_invitations() TO authenticated;

-- 5. `identity_for_caller` : en mode OIDC, une attente sans échéance fait connaître le sujet comme une invitation ouverte
--    (le reste du corps est celui de la ligne de base).
CREATE OR REPLACE FUNCTION platform.identity_for_caller() RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  v_claims jsonb := coalesce((select auth.jwt()), '{}'::jsonb);
  v_issuer text := nullif(v_claims ->> 'iss', '');
  v_subject text := nullif(v_claims ->> 'ext_sub', '');
  v_kind text := v_claims ->> 'issuer_kind';
  v_email text := lower(nullif(v_claims ->> 'email', ''));
  v_user uuid;
begin
  if v_issuer is null or v_subject is null then
    return null;
  end if;
  select i.user_id into v_user
    from platform.identities i
   where i.issuer = v_issuer and i.subject = v_subject;
  if found then
    return v_user;
  end if;
  if v_kind = 'supabase' then
    if v_subject !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      return null;
    end if;
    v_user := v_subject::uuid;
  elsif v_kind = 'oidc' and v_email is not null then
    select s.user_id into v_user
      from platform.platform_staff s
     where s.email = v_email
     order by s.added_at, s.user_id
     limit 1;
    if v_user is null and exists (
      select 1 from platform.invitations i
       where i.email = v_email and i.accepted_at is null and i.declined_at is null
         and i.revoked_at is null and (i.expires_at is null or i.expires_at > now())
    ) then
      v_user := gen_random_uuid();
    end if;
  end if;
  if v_user is null then
    return null;
  end if;
  insert into platform.identities (issuer, subject, user_id)
  values (v_issuer, v_subject, v_user)
  on conflict do nothing;
  select i.user_id into v_user
    from platform.identities i
   where i.issuer = v_issuer and i.subject = v_subject;
  return v_user;
end;
$_$;

REVOKE ALL ON FUNCTION platform.identity_for_caller() FROM PUBLIC;
GRANT ALL ON FUNCTION platform.identity_for_caller() TO authenticated;

-- 6. Le hook d'inscription de Supabase admet l'adresse d'une attente sans échéance (le reste du corps est celui de la
--    ligne de base ; son droit à `supabase_auth_admin`, posé par la ligne de base quand le rôle existe, reste).
CREATE OR REPLACE FUNCTION platform.hook_before_user_created(event jsonb) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_email text := lower(nullif(trim(event -> 'user' ->> 'email'), ''));
begin
  if v_email is not null and exists (
    select 1 from platform.invitations i
     where i.email = v_email and i.accepted_at is null and i.declined_at is null
       and i.revoked_at is null and (i.expires_at is null or i.expires_at > now())
  ) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403,
    'message', 'L''inscription se fait sur invitation. Demandez à un administrateur de votre organisation de vous inviter.'));
end;
$$;

REVOKE ALL ON FUNCTION platform.hook_before_user_created(event jsonb) FROM PUBLIC;

-- 7. `org_usage` compte l'attente sans échéance parmi les invitations en attente (le reste du corps est celui de
--    20261001090000_v1_2_0.sql).
CREATE OR REPLACE FUNCTION platform.org_usage(p_org uuid) RETURNS TABLE(members integer, pending_invitations integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $_$
  select (select count(*)::int from platform.members m where m.org_id = o.id),
         (select count(*)::int from platform.invitations i
           where i.org_id = o.id and i.accepted_at is null and i.declined_at is null
             and i.revoked_at is null and (i.expires_at is null or i.expires_at > now()))
    from platform.orgs o
   where o.id = p_org
$_$;

REVOKE ALL ON FUNCTION platform.org_usage(p_org uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION platform.org_usage(p_org uuid) TO anon;

-- 8. `join_org` la compte au plafond des membres (le reste du corps est celui de 20261003090000_v1_4_0.sql ; ses
--    privilèges, ceux de 20261019130000_platform_role_serveur.sql, redits).
CREATE OR REPLACE FUNCTION platform.join_org(p_org uuid, p_members_max integer DEFAULT NULL) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  v_claims jsonb := coalesce((select auth.jwt()), '{}'::jsonb);
  v_issuer text := nullif(v_claims ->> 'iss', '');
  v_subject text := nullif(v_claims ->> 'ext_sub', '');
  v_email text := lower(nullif(btrim(v_claims ->> 'email'), ''));
  v_name text := nullif(btrim(coalesce(v_claims -> 'user_metadata' ->> 'full_name',
                                       v_claims -> 'user_metadata' ->> 'name',
                                       v_claims ->> 'name')), '');
  v_user uuid := (select auth.uid());
  v_taken integer;
begin
  if not platform.open_entry_gate(p_org, v_user, v_email) then
    return 'refused';
  end if;
  if v_user is null then
    if v_claims ->> 'issuer_kind' is distinct from 'oidc' or v_issuer is null or v_subject is null then
      return 'refused';
    end if;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(7601, pg_catalog.hashtext(p_org::text));
  if p_members_max is not null then
    select (select count(*)::int from platform.members m where m.org_id = p_org)
         + (select count(*)::int from platform.invitations i
             where i.org_id = p_org and i.accepted_at is null and i.declined_at is null
               and i.revoked_at is null and (i.expires_at is null or i.expires_at > now()))
      into v_taken;
    if v_taken >= p_members_max then
      return 'limit';
    end if;
  end if;
  if v_user is null then
    insert into platform.identities (issuer, subject, user_id)
    values (v_issuer, v_subject, gen_random_uuid())
    on conflict do nothing;
    select i.user_id into v_user from platform.identities i where i.issuer = v_issuer and i.subject = v_subject;
    -- L'identité vient d'être connue : exclusion, appartenance et accès plateforme se relisent sur elle.
    if not platform.open_entry_gate(p_org, v_user, v_email) then
      return 'refused';
    end if;
  end if;
  insert into platform.members (org_id, user_id, role, profile, email, name, last_sign_in_at)
  values (p_org, v_user, 'member',
          jsonb_strip_nulls(jsonb_build_object('handle', platform.unique_handle(p_org, v_email), 'name', v_name)),
          v_email, v_name, now())
  on conflict (org_id, user_id) do nothing;
  if not found then
    return 'refused';
  end if;
  insert into platform.journal (org_id, user_id, method, tool, target, args)
  values (p_org, v_user, 'api', 'member joined', v_email, jsonb_build_object('origin', 'open_entry'));
  return 'joined';
end;
$_$;

REVOKE ALL ON FUNCTION platform.join_org(p_org uuid, p_members_max integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION platform.join_org(p_org uuid, p_members_max integer) TO platform_server;

-- ROLLBACK: (jamais exécuté depuis le paquet)
--   update platform.invitations set expires_at = created_at + interval '7 days' where expires_at is null ;
--   les six fonctions recréées telles que les écrivent la ligne de base (invitations_guard, identity_for_caller,
--   hook_before_user_created), 20261001090000_v1_2_0.sql (org_usage) et 20261003090000_v1_4_0.sql (accept_invitations,
--   join_org) ; revoke insert(expires_at) on platform.invitations from authenticated ;
--   comment on column platform.invitations.expires_at is null ;
--   alter table platform.invitations alter column expires_at set not null.
