-- Premier administrateur d'une organisation créée par l'équipe plateforme (décision du 2026-10-14,
-- `docs/conception/administration-et-cellule.md`) : `admin_org create` nomme un premier administrateur, et
-- `admin_org add_admin` en nomme un pour une organisation existante. Quand c'est l'appelant lui-même, il devient membre
-- `admin` sans invitation ni email, dans la transaction de la création ; une autre adresse reçoit une invitation, par le
-- service des invitations (aucun SQL ici). La décision est celle du service (`server/admin/first-admin.ts`, ADR-012 § 3) ;
-- ces fonctions en sont la seconde barrière. Aucune table, colonne ni policy. Un seul bloc ROLLBACK en fin de fichier.

-- 1. La place d'administrateur d'une personne, écrite une fois et partagée par `signup_org` (inscription) et
--    `claim_org_admin` (équipe plateforme) : la ligne `members` au rôle `admin` avec son handle, son email et son nom,
--    ou le rôle `admin` pour un membre présent. Rend `joined`, `promoted` ou `unchanged` (déjà administrateur). Interne :
--    exécutable par aucun rôle, appelée par ces deux fonctions seules (`database-patterns.md § Règles SECURITY DEFINER`).
CREATE FUNCTION platform.seat_org_admin(p_org uuid, p_user uuid, p_email text, p_name text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  v_role text;
begin
  select m.role into v_role from platform.members m where m.org_id = p_org and m.user_id = p_user for update;
  if not found then
    insert into platform.members (org_id, user_id, role, profile, email, name, last_sign_in_at)
    values (p_org, p_user, 'admin',
            jsonb_strip_nulls(jsonb_build_object('handle', platform.unique_handle(p_org, p_email), 'name', p_name)),
            p_email, p_name, now());
    return 'joined';
  end if;
  if v_role = 'admin' then
    return 'unchanged';
  end if;
  update platform.members set role = 'admin' where org_id = p_org and user_id = p_user;
  return 'promoted';
end;
$_$;

REVOKE ALL ON FUNCTION platform.seat_org_admin(p_org uuid, p_user uuid, p_email text, p_name text) FROM PUBLIC;

-- 2. `signup_org` sur la place partagée : même signature, mêmes refus, même résultat (le corps est celui de
--    20261001180000_v1_3_0.sql, l'insertion du premier membre passée à `seat_org_admin`).
CREATE OR REPLACE FUNCTION platform.signup_org(p_name text, p_slug text, p_prefix text, p_hosts text[]) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  v_claims jsonb := coalesce((select auth.jwt()), '{}'::jsonb);
  v_issuer text := nullif(v_claims ->> 'iss', '');
  v_subject text := nullif(v_claims ->> 'ext_sub', '');
  v_email text := lower(nullif(btrim(v_claims ->> 'email'), ''));
  v_name text := nullif(btrim(v_claims ->> 'name'), '');
  v_user uuid := (select auth.uid());
  v_org uuid;
begin
  if v_email is null or (v_user is null and (v_issuer is null or v_subject is null)) then
    raise exception 'signup_org needs a verified caller with an email' using errcode = '42501';
  end if;
  if v_user is null then
    if v_claims ->> 'issuer_kind' is distinct from 'oidc' then
      raise exception 'signup_org needs a verified caller with an email' using errcode = '42501';
    end if;
    insert into platform.identities (issuer, subject, user_id)
    values (v_issuer, v_subject, gen_random_uuid())
    on conflict do nothing;
    select i.user_id into v_user from platform.identities i where i.issuer = v_issuer and i.subject = v_subject;
  end if;
  v_org := platform.org_skeleton(p_name, p_slug, p_prefix, p_hosts, v_user);
  perform platform.seat_org_admin(v_org, v_user, v_email, v_name);
  return v_org;
end;
$_$;

REVOKE ALL ON FUNCTION platform.signup_org(p_name text, p_slug text, p_prefix text, p_hosts text[]) FROM PUBLIC;
GRANT ALL ON FUNCTION platform.signup_org(p_name text, p_slug text, p_prefix text, p_hosts text[]) TO authenticated;

-- 3. L'appelant de l'équipe plateforme se nomme administrateur de l'organisation `p_org` : réservé à qui l'administre
--    comme membre de l'équipe plateforme (`is_staff()` et `is_org_admin`, la règle d'`add_host`, N23), avec un email
--    dans les claims ; sinon `42501`. Son identifiant est celui de la session (`auth.uid()`), que la base a traduit en
--    mode OIDC par l'email vérifié de sa ligne `platform_staff` (`identity_for_caller()`) : aucun compte de l'émetteur
--    n'est exigé. Appelée par `createOrg` dans la transaction de `create_org`, dont l'accès `creation` la rend permise,
--    et par `add_admin`. Aucune invitation, aucun email.
CREATE FUNCTION platform.claim_org_admin(p_org uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  v_claims jsonb := coalesce((select auth.jwt()), '{}'::jsonb);
  v_email text := lower(nullif(btrim(v_claims ->> 'email'), ''));
  v_name text := nullif(btrim(coalesce(v_claims -> 'user_metadata' ->> 'full_name',
                                       v_claims -> 'user_metadata' ->> 'name',
                                       v_claims ->> 'name')), '');
  v_user uuid := (select auth.uid());
begin
  if v_user is null or v_email is null or p_org is null or not platform.is_staff() or not platform.is_org_admin(p_org) then
    raise exception 'claim_org_admin is reserved to platform team members who administer this organisation' using errcode = '42501';
  end if;
  return platform.seat_org_admin(p_org, v_user, v_email, v_name);
end;
$_$;

REVOKE ALL ON FUNCTION platform.claim_org_admin(p_org uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION platform.claim_org_admin(p_org uuid) TO authenticated;

-- ROLLBACK: (jamais exécuté depuis le paquet) — dans l'ordre inverse de ce fichier.
--   drop function platform.claim_org_admin(uuid) ;
--   signup_org : reprendre le corps de 20261001180000_v1_3_0.sql (partie 1) ;
--   drop function platform.seat_org_admin(uuid, uuid, text, text).
