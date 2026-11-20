-- Version 1.9.0 du paquet (un seul fichier de migration par version publiée, database-patterns.md § Règles) :
-- les 2 migrations ajoutées depuis la version précédente, réunies au contenu identique, dans l'ordre
-- de leurs horodatages, chacune précédée d'une bannière qui nomme son fichier d'origine. Aucune ligne n'est changée.

-- ====================================================================================================
-- Partie 1 sur 2 : écrite en 20261119083000_platform_supervision.sql.
-- ====================================================================================================

-- La supervision de la plateforme (administration et cellule, § Organisations, N9 ; décidé par Alexis le 30/10 et JB le
-- 02/11) : l'équipe plateforme liste toutes les organisations de la cellule, sans accès daté, et pour chacune ses membres
-- et leur rôle, ses appels des 30 derniers jours, ses connecteurs actifs et ses comptes par connecteur et titulaire. Les
-- policies de `orgs`, `members`, `teams`, `journal`, `accounts` et `connector_activations` bornent la lecture aux
-- organisations de l'appelant (`member_orgs()`) : un membre de l'équipe plateforme sans accès en cours n'en lit rien, et le
-- serveur lit sous son jeton. Trois fonctions `security definer` rendent cette liste, et elle seule, à l'équipe plateforme
-- (`is_staff()`, sinon 42501) :
-- - `staff_org_overview(since)` : l'identité de chaque organisation et ses comptes (membres, équipes, appels
--   `tools/call` du journal depuis `since`, connecteurs actifs, comptes) ;
-- - `staff_org_members(org)` : ses membres, leur email, leur nom (celui de `member_directory`), leur rôle et leur date
--   d'entrée ; `org` nul : toutes les organisations ;
-- - `staff_org_accounts(org)` : ses comptes regroupés par connecteur, titulaire (l'organisation, le nom de l'équipe ou
--   l'email de la personne), état et mode, avec leur nombre ; `org` nul : toutes les organisations.
-- Aucune ne rend une clé, une colonne `secret_*`, un libellé ou un identifiant de compte, un argument ou une cible du
-- journal, ni un contenu : y entrer exige toujours l'accès daté et journalisé. Exécutables par `authenticated` (dont
-- hérite `platform_server`), comme `staff_directory()`. Aucune table, colonne, policy ni index ; rien à relancer avant.

CREATE FUNCTION platform.staff_org_overview(p_since timestamp with time zone)
    RETURNS TABLE(id uuid, slug text, name text, prefix text, created_at timestamp with time zone, members integer, teams integer,
                  calls integer, active_connectors integer, accounts integer)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not platform.is_staff() then
    raise exception 'the supervision of the platform is reserved to the platform team' using errcode = '42501';
  end if;
  -- Une borne nulle ne compterait aucun appel (`ts >= null`) : refusée plutôt que lue comme zéro.
  if p_since is null then
    raise exception 'staff_org_overview needs the start of the period' using errcode = '22004';
  end if;
  return query
    select o.id, o.slug, o.name, o.prefix, o.created_at,
           (select count(*)::int from platform.members m where m.org_id = o.id),
           (select count(*)::int from platform.teams t where t.org_id = o.id),
           (select count(*)::int from platform.journal j where j.org_id = o.id and j.method = 'tools/call' and j.ts >= p_since),
           (select count(*)::int from platform.connector_activations c where c.org_id = o.id and c.state = 'active'),
           (select count(*)::int from platform.accounts a where a.org_id = o.id)
      from platform.orgs o
     order by o.slug;
end;
$$;

REVOKE ALL ON FUNCTION platform.staff_org_overview(p_since timestamp with time zone) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.staff_org_overview(p_since timestamp with time zone) TO authenticated;

CREATE FUNCTION platform.staff_org_members(p_org uuid)
    RETURNS TABLE(org_id uuid, user_id uuid, email text, name text, role text, since timestamp with time zone)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not platform.is_staff() then
    raise exception 'the supervision of the platform is reserved to the platform team' using errcode = '42501';
  end if;
  -- Le nom comme `member_directory` le rend : celui du profil, sinon la copie de l'émetteur, sinon la partie locale de l'email.
  return query
    select m.org_id, m.user_id, m.email,
           coalesce(nullif(m.profile ->> 'name', ''), nullif(m.name, ''), split_part(m.email, '@', 1)),
           m.role, m.created_at
      from platform.members m
     where p_org is null or m.org_id = p_org
     order by m.org_id, 4, m.user_id;
end;
$$;

REVOKE ALL ON FUNCTION platform.staff_org_members(p_org uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.staff_org_members(p_org uuid) TO authenticated;

CREATE FUNCTION platform.staff_org_accounts(p_org uuid)
    RETURNS TABLE(org_id uuid, connector text, owner_kind text, owner_label text, status text, mode text, accounts integer)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not platform.is_staff() then
    raise exception 'the supervision of the platform is reserved to the platform team' using errcode = '42501';
  end if;
  -- Le titulaire se nomme sans identifiant : l'organisation (nul), le nom de l'équipe, l'email de la personne dans
  -- l'organisation du compte. Ni libellé, ni identifiant, ni colonne secrète du compte.
  return query
    select a.org_id, a.connector, a.owner_kind,
           case a.owner_kind when 'team' then t.name when 'user' then m.email end,
           a.status, a.mode, count(*)::int
      from platform.accounts a
      left join platform.teams t on a.owner_kind = 'team' and t.id = a.owner_team_id
      left join platform.members m on a.owner_kind = 'user' and m.org_id = a.org_id and m.user_id = a.owner_user_id
     where p_org is null or a.org_id = p_org
     group by a.org_id, a.connector, a.owner_kind, 4, a.status, a.mode
     order by a.org_id, a.connector, a.owner_kind, 4, a.status, a.mode;
end;
$$;

REVOKE ALL ON FUNCTION platform.staff_org_accounts(p_org uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.staff_org_accounts(p_org uuid) TO authenticated;

-- ROLLBACK: (jamais exécuté depuis le paquet)
--   drop function platform.staff_org_accounts(uuid) ;
--   drop function platform.staff_org_members(uuid) ;
--   drop function platform.staff_org_overview(timestamptz) ;
--   et le paquet précédent, sans `listPlatformOrgs`, `readPlatformOrg` ni les opérations `overview` et `members` d'`admin_org`.

-- ====================================================================================================
-- Partie 2 sur 2 : écrite en 20261119104631_platform_acces_du_compte.sql.
-- ====================================================================================================

-- L'accès d'un compte (connecteurs et comptes, § Plusieurs accès ; décidé par Alexis le 2026-11-19) : un connecteur
-- décrit peut s'ouvrir par plusieurs accès (le compte de service d'une organisation, la connexion d'une personne), et
-- chaque compte retient celui qui l'a ouvert, par lequel il se signe à chaque appel. Additif : deux colonnes nulles,
-- leurs contraintes et leurs droits ; aucune ligne n'est réécrite (un compte existant est celui d'un connecteur à un
-- seul accès, `access` nul). Un seul bloc ROLLBACK en fin de fichier.

-- 1. L'accès d'un compte : le nom d'un accès de la déclaration (`accesses`), exigé et contrôlé par le service pour un
--    connecteur à plusieurs accès, nul pour un connecteur à un seul ; la base ne connaît pas la déclaration, elle n'en
--    garde que la forme. Posé à la création du compte (saisie ou consentement), jamais changé : aucun rôle ne reçoit
--    le droit de le modifier ; passer d'un accès à l'autre, c'est connecter un autre compte.
ALTER TABLE platform.accounts ADD COLUMN access text;

ALTER TABLE platform.accounts ADD CONSTRAINT accounts_access_check CHECK ((access ~ '^[a-z][a-z0-9_]{0,39}$'::text));

GRANT SELECT(access),INSERT(access) ON TABLE platform.accounts TO authenticated;

-- 2. L'accès d'une demande de consentement : celui, à consentement, que la personne a choisi d'un connecteur à
--    plusieurs accès, que le retour donne au compte qu'il range ; nul pour un connecteur à un seul accès.
ALTER TABLE platform.connector_consents ADD COLUMN access text;

ALTER TABLE platform.connector_consents ADD CONSTRAINT connector_consents_access_check CHECK ((access ~ '^[a-z][a-z0-9_]{0,39}$'::text));

GRANT INSERT(access) ON TABLE platform.connector_consents TO authenticated;

-- ROLLBACK: (jamais exécuté depuis le paquet)
--   revoke insert(access) on platform.connector_consents from authenticated ;
--   alter table platform.connector_consents drop constraint connector_consents_access_check, drop column access ;
--   revoke select(access), insert(access) on platform.accounts from authenticated ;
--   alter table platform.accounts drop constraint accounts_access_check, drop column access.
