-- Les équipes d'une invitation (identité et connexion, § Personne en attente, sans email ; décision du 27/11) : une
-- personne invitée, ou inscrite sans email par `member.add`, entre dans toutes les équipes qu'on lui a données, à sa
-- première connexion. `invitations.team_id` n'en portait qu'une. Additif : la table de liaison `invitation_teams` porte
-- toutes les équipes d'une invitation ; `team_id` reste, écrit comme avant avec la première équipe (la policy
-- d'insertion d'`invitations` y lit l'équipe d'un responsable, et un paquet plus ancien la lit encore), et un
-- déclencheur la recopie dans la table de liaison, ce qu'écrive un paquet de cette version ou d'une plus ancienne. La
-- table de liaison fait seule foi pour l'entrée (`accept_invitations`) : une équipe retirée d'une personne en attente
-- n'en revient pas par `team_id`. Lecture : un administrateur, ou le responsable de l'équipe de la ligne ; ajout et
-- suppression : la règle de `addTeamMember` et `removeTeamMember` (un administrateur, ou le responsable de l'équipe), sur
-- une invitation ouverte, une équipe de la même organisation. Aucune colonne de personne.
--
-- L'espace d'un contenu (droits d'accès, § Propriétaires, déplacements, personnel ; règle de JB du 27/11, qui remplace la
-- fiche D18 B) : changer le propriétaire d'un nœud exige de le gérer, ce que `nodes_gesture_guard` vérifie déjà sur la
-- ligne d'avant, et d'écrire dans l'espace qui le reçoit, ce qu'il vérifie désormais sur la ligne écrite (section 5),
-- comme `transferOwner` (`server/admin/nodes.ts`) le décide avant d'écrire. Un seul bloc ROLLBACK en fin de fichier.

-- 1. La table de liaison, ses clés, son index et sa RLS.
CREATE TABLE platform.invitation_teams (
    invitation_id uuid NOT NULL,
    team_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

COMMENT ON TABLE platform.invitation_teams IS 'Équipes d''une invitation, où la personne entre à sa première connexion (accept_invitations). Lue par l''administrateur et le responsable de l''équipe, écrite par eux sur une invitation ouverte.';

ALTER TABLE ONLY platform.invitation_teams
    ADD CONSTRAINT invitation_teams_pkey PRIMARY KEY (invitation_id, team_id);

ALTER TABLE ONLY platform.invitation_teams
    ADD CONSTRAINT invitation_teams_invitation_id_fkey FOREIGN KEY (invitation_id) REFERENCES platform.invitations(id) ON DELETE CASCADE;

ALTER TABLE ONLY platform.invitation_teams
    ADD CONSTRAINT invitation_teams_team_id_fkey FOREIGN KEY (team_id) REFERENCES platform.teams(id) ON DELETE CASCADE;

CREATE INDEX idx_invitation_teams_team_id ON platform.invitation_teams USING btree (team_id);

ALTER TABLE platform.invitation_teams ENABLE ROW LEVEL SECURITY;

-- Lecture : `listInvitations` et `openInvitation` (`server/invitations.ts`, `server/pending-members.ts`), un
-- administrateur, ou le responsable de l'équipe de la ligne ; un responsable ne lit pas les autres équipes d'une
-- invitation.
DROP POLICY IF EXISTS invitation_teams_select_admin_lead ON platform.invitation_teams;
CREATE POLICY invitation_teams_select_admin_lead ON platform.invitation_teams FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM platform.invitations i
  WHERE ((i.id = invitation_teams.invitation_id) AND (i.org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND (platform.is_org_admin(i.org_id) OR platform.leads_team(invitation_teams.team_id))))));

-- Ajout : `insertInvitation` et `changeInvitationTeams` (`server/invitations.ts`, `server/pending-members.ts`), un
-- administrateur, ou le responsable de l'équipe ajoutée, sur une invitation ouverte, une équipe de la même organisation.
DROP POLICY IF EXISTS invitation_teams_insert_admin_lead ON platform.invitation_teams;
CREATE POLICY invitation_teams_insert_admin_lead ON platform.invitation_teams FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM (platform.invitations i
     JOIN platform.teams t ON (((t.id = invitation_teams.team_id) AND (t.org_id = i.org_id))))
  WHERE ((i.id = invitation_teams.invitation_id) AND (i.org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND (i.accepted_at IS NULL) AND (i.declined_at IS NULL) AND (i.revoked_at IS NULL) AND (platform.is_org_admin(i.org_id) OR platform.leads_team(t.id))))));

-- Retrait : `changeInvitationTeams` (`server/pending-members.ts`), un administrateur, ou le responsable de l'équipe
-- retirée, sur une invitation ouverte.
DROP POLICY IF EXISTS invitation_teams_delete_admin_lead ON platform.invitation_teams;
CREATE POLICY invitation_teams_delete_admin_lead ON platform.invitation_teams FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM platform.invitations i
  WHERE ((i.id = invitation_teams.invitation_id) AND (i.org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND (i.accepted_at IS NULL) AND (i.declined_at IS NULL) AND (i.revoked_at IS NULL) AND (platform.is_org_admin(i.org_id) OR platform.leads_team(invitation_teams.team_id))))));

GRANT SELECT, DELETE ON TABLE platform.invitation_teams TO authenticated;

GRANT INSERT(invitation_id) ON TABLE platform.invitation_teams TO authenticated;

GRANT INSERT(team_id) ON TABLE platform.invitation_teams TO authenticated;

-- 2. `team_id`, écrit par tout paquet à la création d'une invitation, entre dans la table de liaison. `security
--    invoker` : l'insertion de l'invitation a déjà passé sa policy, qui borne l'équipe à l'organisation et au droit de
--    qui invite ; celle de `invitation_teams` en redit autant. Exécutable par aucun rôle client.
CREATE FUNCTION platform.invitation_teams_from_team_id() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if new.team_id is not null then
    insert into platform.invitation_teams (invitation_id, team_id)
    values (new.id, new.team_id)
    on conflict (invitation_id, team_id) do nothing;
  end if;
  return null;
end;
$$;

REVOKE ALL ON FUNCTION platform.invitation_teams_from_team_id() FROM PUBLIC;

DROP TRIGGER IF EXISTS invitation_teams_from_team_id ON platform.invitations;
CREATE TRIGGER invitation_teams_from_team_id AFTER INSERT ON platform.invitations FOR EACH ROW EXECUTE FUNCTION platform.invitation_teams_from_team_id();

-- 3. Les invitations déjà écrites : leur équipe entre dans la table de liaison. Aucune ligne d'`invitations` ne change.
INSERT INTO platform.invitation_teams (invitation_id, team_id)
SELECT i.id, i.team_id FROM platform.invitations i WHERE i.team_id IS NOT NULL
ON CONFLICT (invitation_id, team_id) DO NOTHING;

-- 4. `accept_invitations` : la personne entre dans toutes les équipes de l'invitation, lues dans la table de liaison (le
--    reste du corps est celui de 20261122184838_platform_attente_sans_echeance.sql). Avant de lire ses invitations, elle
--    prend le verrou de classe 7101 de chacune (organisation, adresse : la clé d'`invitations_guard`), dans l'ordre des
--    organisations ; `changeInvitationTeams` (`server/pending-members.ts`) prend le même avant de relire l'invitation
--    ouverte et d'écrire ses équipes : une équipe ajoutée pendant l'acceptation entre avec la personne, ou le changement
--    trouve l'invitation close (`conflict`). `select … for update` ne sert pas au service : il applique la policy de mise
--    à jour d'`invitations`, qui cache la ligne au responsable qui n'a pas invité.
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
  perform pg_catalog.pg_advisory_xact_lock(7101, pg_catalog.hashtext(o.org_id::text || ':' || v_email))
     from (select distinct i.org_id
             from platform.invitations i
            where i.email = v_email and i.accepted_at is null and i.declined_at is null
              and i.revoked_at is null and (i.expires_at is null or i.expires_at > now())) o
    order by o.org_id;
  for v_inv in
    select i.id, i.org_id, i.role
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
    insert into platform.team_members (team_id, user_id, role)
    select it.team_id, v_uid, 'member'
      from platform.invitation_teams it
     where it.invitation_id = v_inv.id
    on conflict (team_id, user_id) do nothing;
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

-- 5. La fonction des gestes d'un nœud, recréée sur son corps de `20261021120000`, avec son `search_path`, son propriétaire
--    et ses droits : un propriétaire changé exige en plus l'écriture (2) de l'appelant dans l'espace qui reçoit le nœud,
--    lue sur la ligne écrite (l'exception à « le niveau lu sur la ligne d'avant », `security-patterns.md § Droits dans
--    le service`) : une personne, l'appelant seul (son propre Privé ; celui d'une autre, jamais) ; l'organisation, la
--    racine (Tout le monde) ; une équipe, son dossier (`teams_tree_sync` : le chemin de son slug, l'équipe pour
--    propriétaire) ; le propriétaire hérité, le parent. Sans un tel nœud, le refus. Le reste à l'identique.
CREATE OR REPLACE FUNCTION platform.nodes_gesture_guard() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_needed int := 0;
  v_row record;
begin
  if current_user not in ('authenticated', 'platform_server') then
    return case when tg_level = 'ROW' then new end;
  end if;
  if tg_level = 'ROW' and tg_op = 'INSERT' then
    if new.updated_by is not null and new.updated_by is distinct from (select auth.uid()) then
      raise exception 'platform.nodes: the last author of % is the caller, auth.uid()', new.path
        using errcode = '42501';
    end if;
    if not exists (
         select 1 from platform.nodes p
          where p.id = new.parent_id
            and platform.node_level_for(p.org_id, p.lpath, p.owner_kind, p.owner_team_id, p.owner_user_id) >= 2) then
      raise exception 'platform.nodes: creating % needs the level 2 on its parent', new.path
        using errcode = '42501';
    end if;
    return new;
  end if;
  if tg_level = 'ROW' then
    if new.updated_by is distinct from old.updated_by and new.updated_by is distinct from (select auth.uid()) then
      raise exception 'platform.nodes: the last author of % is the caller, auth.uid()', old.path
        using errcode = '42501';
    end if;
    if new.deleted_at is distinct from old.deleted_at and new.deleted_at <> now() then
      raise exception 'platform.nodes: the trash date of % is the clock of the database, now()', old.path
        using errcode = '42501';
    end if;
    if new.parent_id is distinct from old.parent_id
       or (new.owner_kind, new.owner_team_id, new.owner_user_id) is distinct from (old.owner_kind, old.owner_team_id, old.owner_user_id) then
      v_needed := 3;
    elsif new.path <> old.path or new.updated_by is distinct from old.updated_by then
      v_needed := 2;
    end if;
    if v_needed > 0
       and platform.node_level_for(old.org_id, old.lpath, old.owner_kind, old.owner_team_id, old.owner_user_id) < v_needed then
      raise exception 'platform.nodes: this change of % needs the level % on it', old.path, v_needed
        using errcode = '42501';
    end if;
    if (new.owner_kind, new.owner_team_id, new.owner_user_id) is distinct from (old.owner_kind, old.owner_team_id, old.owner_user_id)
       and not coalesce(case
         when new.owner_kind = 'user' then new.owner_user_id = (select auth.uid())
         when new.owner_kind = 'org' then exists (
           select 1 from platform.nodes p
            where p.org_id = old.org_id and p.parent_id is null
              and platform.node_level_for(p.org_id, p.lpath, p.owner_kind, p.owner_team_id, p.owner_user_id) >= 2)
         when new.owner_kind = 'team' then exists (
           select 1 from platform.nodes p
             join platform.teams t on t.id = new.owner_team_id and t.org_id = p.org_id
            where p.org_id = old.org_id and p.path = t.slug and p.owner_kind = 'team' and p.owner_team_id = t.id
              and platform.node_level_for(p.org_id, p.lpath, p.owner_kind, p.owner_team_id, p.owner_user_id) >= 2)
         when new.owner_kind is null then exists (
           select 1 from platform.nodes p
            where p.id = new.parent_id
              and platform.node_level_for(p.org_id, p.lpath, p.owner_kind, p.owner_team_id, p.owner_user_id) >= 2)
       end, false) then
      raise exception 'platform.nodes: giving % to this space needs the level 2 there', old.path
        using errcode = '42501';
    end if;
    if (new.parent_id is distinct from old.parent_id or new.path <> old.path) and not exists (
         select 1 from platform.nodes p
          where p.id = new.parent_id
            and platform.node_level_for(p.org_id, p.lpath, p.owner_kind, p.owner_team_id, p.owner_user_id) >= 2) then
      raise exception 'platform.nodes: placing % needs the level 2 on its parent', new.path
        using errcode = '42501';
    end if;
    return new;
  end if;
  for v_row in
    select n.org_id, n.lpath, n.owner_kind, n.owner_team_id, n.owner_user_id, n.path,
           case when exists (select 1 from old_rows po join new_rows pn on pn.id = po.id
                              where po.id = o.parent_id and (pn.deleted_at is null) <> (po.deleted_at is null))
                then case when n.deleted_at is not null then 1 else 0 end
                else 3 end as needed
      from old_rows o join new_rows n on n.id = o.id
     where (n.deleted_at is null) <> (o.deleted_at is null)
  loop
    if v_row.needed > 0
       and platform.node_level_for(v_row.org_id, v_row.lpath, v_row.owner_kind, v_row.owner_team_id, v_row.owner_user_id) < v_row.needed then
      raise exception 'platform.nodes: this change of % needs the level % on it', v_row.path, v_row.needed
        using errcode = '42501';
    end if;
  end loop;
  return null;
end;
$$;

REVOKE ALL ON FUNCTION platform.nodes_gesture_guard() FROM PUBLIC;

-- ROLLBACK: (jamais exécuté depuis le paquet ; avec le paquet de la version précédente, qui ne lit que `team_id`)
--   create or replace function platform.nodes_gesture_guard() … : le corps de 20261021120000_platform_role_dans_les_blocs.sql
--     (sans le contrôle de l'espace qui reçoit le nœud), même `search_path`, propriétaire et droits ;
--   accept_invitations recréée telle que l'écrit 20261122184838_platform_attente_sans_echeance.sql ;
--   drop trigger invitation_teams_from_team_id on platform.invitations ;
--   drop function platform.invitation_teams_from_team_id() ;
--   drop table platform.invitation_teams.
