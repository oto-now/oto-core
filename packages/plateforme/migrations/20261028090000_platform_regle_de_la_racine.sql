-- La règle de la racine (droits d'accès, § Règles d'accès ; décidé par JB le 28/10) : une règle posée sur la racine
-- (`guide`, profondeur 0) ne compte plus que pour les contenus dont l'organisation est le propriétaire effectif, ceux de
-- Tout le monde, Contexte compris. Sous un dossier d'équipe, elle est ignorée comme si elle n'existait pas : elle n'ouvre
-- l'équipe à personne, ne baisse pas ses membres et ne retire pas sa gestion à son responsable ; dans un espace
-- personnel, elle l'était déjà (D5, N35). Avant, une règle de la racine valait sur tout l'arbre : « Peut modifier » pour
-- toute l'organisation ouvrait aussi chaque dossier d'équipe en écriture, et une exception de personne ou d'équipe posée
-- sur la racine baissait ses membres ou son responsable sur leur propre dossier (D20).
--
-- `node_level_of`, le seul corps SQL du niveau d'un nœud, est re-versionné à signature identique ; son plancher (la
-- profondeur minimale d'une règle comptée) vaut 1 hors de l'organisation et d'un espace personnel, et s'applique aussi au
-- cas du responsable (1 bis). Le calcul du service (`nodeLevelOf`, `server/access-levels.ts`) change avec lui ; le test de
-- parité (`tests/integration/access-parity.test.ts`) les tient égaux. `node_level_for` et toutes les policies et
-- fonctions qui l'appellent suivent sans être recréées. Privilèges redits à l'identique : aucun rôle ne l'exécute
-- directement. Aucune table, colonne, policy ni index ; rien à relancer avant. Une règle déjà posée sur la racine garde sa
-- ligne : sous une équipe, elle cesse simplement de compter.

CREATE OR REPLACE FUNCTION platform.node_level_of(p_user uuid, p_org uuid, p_lpath extensions.ltree, p_owner_kind text, p_owner_team uuid, p_owner_user uuid) RETURNS integer
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_uid uuid := p_user;
  v_kind text := p_owner_kind;
  v_team uuid := p_owner_team;
  v_user uuid := p_owner_user;
  -- nœud qui porte le propriétaire effectif : le nœud lui-même quand il en porte un
  v_owner_lpath extensions.ltree := p_lpath;
  -- profondeur minimale d'une règle comptée : toute la branche pour un contenu de l'organisation, sous la racine
  -- ailleurs, sous le nœud qui porte la personne dans un espace personnel
  v_floor int := 0;
  -- une règle d'organisation compte, sauf dans un espace personnel (ADR-014)
  v_org_counts boolean;
  v_depth int;
  v_level int;
  v_team_level int;
  v_org_level int;
begin
  -- les organisations de la personne : `member_orgs()` pour elle
  if v_uid is null or p_org is null or p_lpath is null
     or not (exists (select 1 from platform.members m where m.org_id = p_org and m.user_id = v_uid)
             or exists (select 1 from platform.platform_grants g
                          join platform.platform_staff s on s.user_id = g.user_id
                         where g.org_id = p_org and g.user_id = v_uid and g.revoked_at is null)) then
    return 0;
  end if;
  -- propriétaire effectif (H52) : le sien, sinon celui de l'ancêtre le plus proche qui en porte un
  if v_kind is null then
    select a.owner_kind, a.owner_team_id, a.owner_user_id, a.lpath
      into v_kind, v_team, v_user, v_owner_lpath
      from platform.nodes a
     where a.org_id = p_org and a.lpath operator(extensions.@>) p_lpath
       and a.owner_kind is not null
     order by extensions.nlevel(a.lpath) desc
     limit 1;
  end if;
  -- D5, H61 : dans un espace personnel, seules comptent les règles posées sur le nœud qui porte la
  -- personne comme propriétaire, ou en dessous (les partages de son propriétaire). Une règle posée
  -- plus haut (`private`, la racine) n'y ouvre rien et n'en ferme pas le propriétaire.
  -- Règle de la racine (28/10) : hors d'un contenu de l'organisation, une règle de la racine (profondeur 0) est ignorée.
  if v_kind is not distinct from 'user' then
    v_floor := extensions.nlevel(v_owner_lpath);
  elsif v_kind is distinct from 'org' then
    v_floor := 1;
  end if;
  v_org_counts := v_kind is distinct from 'user';
  -- (1) administrateur, ou staff avec un accès en cours : gestion, sauf dans un espace personnel
  if v_kind <> 'user'
     and (exists (select 1 from platform.members m where m.org_id = p_org and m.user_id = v_uid and m.role = 'admin')
          or exists (select 1 from platform.platform_grants g
                       join platform.platform_staff s on s.user_id = g.user_id
                      where g.org_id = p_org and g.user_id = v_uid and g.revoked_at is null)) then
    return 3;
  end if;
  -- (1 bis) un responsable de l'équipe propriétaire (`team_members.role`, E05-S13) : gestion, sauf règle
  -- qui le vise nommément (N7), sous le plancher
  if v_kind = 'team'
     and exists (select 1 from platform.team_members tm
                  where tm.team_id = v_team and tm.user_id = v_uid and tm.role = 'lead')
     and not exists (select 1 from platform.nodes a join platform.access_rules r on r.node_id = a.id
                      where a.org_id = p_org and a.lpath operator(extensions.@>) p_lpath
                        and extensions.nlevel(a.lpath) >= v_floor
                        and r.subject_user_id = v_uid) then
    return 3;
  end if;
  -- (2) le nœud le plus proche (lui compris, sous le plancher) qui porte une règle visant la
  -- personne, ses équipes ou toute l'organisation
  select max(extensions.nlevel(a.lpath)) into v_depth
    from platform.nodes a join platform.access_rules r on r.node_id = a.id
   where a.org_id = p_org and a.lpath operator(extensions.@>) p_lpath
     and extensions.nlevel(a.lpath) >= v_floor
     and (r.subject_user_id = v_uid
          or r.subject_team_id in (select tm.team_id from platform.team_members tm where tm.user_id = v_uid)
          or (r.subject_org and v_org_counts));
  if v_depth is not null then
    -- la règle de la personne l'emporte ; à défaut, le plus haut niveau de ses équipes ; à défaut,
    -- celui de l'organisation, gardé pour l'étape (3)
    select max(platform.level_rank(r.level)) filter (where r.subject_user_id = v_uid),
           max(platform.level_rank(r.level)) filter (where r.subject_team_id in
             (select tm.team_id from platform.team_members tm where tm.user_id = v_uid)),
           max(platform.level_rank(r.level)) filter (where r.subject_org and v_org_counts)
      into v_level, v_team_level, v_org_level
      from platform.nodes a join platform.access_rules r on r.node_id = a.id
     where a.org_id = p_org and a.lpath operator(extensions.@>) p_lpath
       and extensions.nlevel(a.lpath) = v_depth;
    if v_level is not null then
      return v_level;
    end if;
    if v_team_level is not null then
      return v_team_level;
    end if;
  end if;
  -- (3) sans règle de la personne ni de ses équipes : le propriétaire effectif décide, et une règle
  -- d'organisation au plus proche ouvre au-delà
  v_level := case
    when v_kind = 'org' then 1
    when v_kind = 'team' and exists (select 1 from platform.team_members tm
                                      where tm.team_id = v_team and tm.user_id = v_uid and tm.role = 'lead') then 3
    when v_kind = 'team' and exists (select 1 from platform.team_members tm where tm.team_id = v_team and tm.user_id = v_uid) then 2
    when v_kind = 'user' and v_user = v_uid then 3
    else 0
  end;
  return greatest(v_level, coalesce(v_org_level, 0));
end;
$$;

REVOKE ALL ON FUNCTION platform.node_level_of(p_user uuid, p_org uuid, p_lpath extensions.ltree, p_owner_kind text, p_owner_team uuid, p_owner_user uuid) FROM PUBLIC;

-- ROLLBACK: (jamais exécuté depuis le paquet) `node_level_of` : la définition de 20260929090000_platform_e05s13.sql, sous
--   le même nom et la même signature (plancher à 0 hors d'un espace personnel, cas 1 bis sans plancher) ; et
--   `nodeLevelOf` du paquet précédent, qui compte une règle de la racine sur tout l'arbre.
