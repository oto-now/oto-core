-- L'espace d'un nœud écrit sur lui (droits d'accès, § Propriétaires, déplacements, personnel ; décidé avec JB le 03/11) :
-- Privé d'une personne, une équipe ou Tout le monde, porté par `owner_kind`, `owner_team_id` et `owner_user_id`, posés à
-- la création et jamais déduits d'un ancêtre. Avant, un nœud sans propriétaire (`owner_kind` nul) héritait de celui de
-- l'ancêtre le plus proche qui en portait un : son espace se lisait sur son chemin, un déplacement changeait ses droits
-- (un contenu rangé à la racine était lu de toute l'organisation), et une page créée par un assistant sans chemin complet
-- tombait dans Tout le monde. Le chemin reste l'adresse.
--
-- 1. Chaque nœud reçoit l'espace qu'il avait : le propriétaire effectif qu'on lui calculait, figé dans ses colonnes
--    (`updated_at` ne bouge pas : aucun contenu ne change). Aucune visibilité ne change.
-- 2. `nodes_owner_written_check` : un nœud porte toujours son propriétaire.
-- 3. `nodes_owner_at_creation` : un nœud créé sans propriétaire prend celui de son parent ;
--    sous une session, il ne peut prendre que celui de son parent ou le Privé de son auteur (sinon `42501`) : créer dans
--    son Privé n'ouvre rien à personne, et le service le choisit quand l'écriture ne nomme pas d'espace partagé
--    (`write`, `server/nodes/write.ts`). L'ajout des trois colonnes est accordé à `authenticated`.
-- 4. `node_owner` rend le propriétaire du nœud lui-même et le haut de son espace : le moins profond de la suite
--    d'ancêtres qui portent le même propriétaire.
-- 5. `node_level_of`, re-versionné à signature identique : le propriétaire est celui du nœud ; dans un espace personnel,
--    le plancher des règles comptées est le haut de cet espace. Un contenu Privé rangé sous un dossier partagé n'en
--    reçoit donc aucune règle : le déplacer ne le partage pas. Sous une équipe et dans Tout le monde, le plancher ne
--    change pas (1 et 0) : les règles des dossiers au-dessus s'y héritent comme avant, ce que montre l'aperçu d'un
--    déplacement. Le calcul du service (`nodeLevelOf`, `server/access-levels.ts`) change avec lui ; le test de parité
--    (`tests/integration/access-parity.test.ts`) les tient égaux.
-- 6. `duplicate_subtree`, sur le corps de 20261023120000 : chaque copie prend l'espace de sa source (une copie d'une page
--    Privée rangée dans un dossier de Tout le monde reste Privée).
-- Privilèges redits à l'identique. Un seul bloc ROLLBACK en fin de fichier.

-- 1. L'espace calculé, figé.
ALTER TABLE platform.nodes DISABLE TRIGGER set_updated_at;

UPDATE platform.nodes n
   SET owner_kind = o.owner_kind, owner_team_id = o.owner_team_id, owner_user_id = o.owner_user_id
  FROM (select h.id, a.owner_kind, a.owner_team_id, a.owner_user_id
          from platform.nodes h
          cross join lateral (select b.owner_kind, b.owner_team_id, b.owner_user_id
                                from platform.nodes b
                               where b.org_id = h.org_id and b.lpath operator(extensions.@>) h.lpath
                                 and b.owner_kind is not null
                               order by extensions.nlevel(b.lpath) desc
                               limit 1) a
         where h.owner_kind is null) o
 WHERE n.id = o.id;

-- Les clés différées de `owner_team_id` jouent ici : `ENABLE TRIGGER` refuse une table qui a des événements en attente.
SET CONSTRAINTS ALL IMMEDIATE;

ALTER TABLE platform.nodes ENABLE TRIGGER set_updated_at;

-- 2. Un nœud porte toujours son propriétaire.
ALTER TABLE platform.nodes ADD CONSTRAINT nodes_owner_written_check CHECK ((owner_kind IS NOT NULL));

-- 3. Le propriétaire à la création. Par ligne, avant l'ajout ; `nodes_guard` (qui le précède) a refusé un parent
--    absent ou d'une autre organisation.
CREATE FUNCTION platform.nodes_owner_at_creation() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_parent record;
begin
  -- La racine porte l'organisation, écrite par qui la crée (`nodes_root_owner_check`).
  if new.parent_id is null then
    return new;
  end if;
  select p.owner_kind, p.owner_team_id, p.owner_user_id into v_parent from platform.nodes p where p.id = new.parent_id;
  if new.owner_kind is null and new.owner_team_id is null and new.owner_user_id is null then
    new.owner_kind := v_parent.owner_kind;
    new.owner_team_id := v_parent.owner_team_id;
    new.owner_user_id := v_parent.owner_user_id;
    return new;
  end if;
  -- Sous une session : l'espace de son parent, ou le Privé de son auteur ; jamais l'espace d'un autre.
  if current_user in ('authenticated', 'platform_server')
     and (new.owner_kind, new.owner_team_id, new.owner_user_id)
         is distinct from (v_parent.owner_kind, v_parent.owner_team_id, v_parent.owner_user_id)
     and not coalesce(new.owner_kind = 'user' and new.owner_team_id is null
                      and new.owner_user_id = (select auth.uid()), false) then
    raise exception 'platform.nodes: % is created in the space of its parent or in the private space of its author', new.path
      using errcode = '42501';
  end if;
  return new;
end;
$$;

REVOKE ALL ON FUNCTION platform.nodes_owner_at_creation() FROM PUBLIC;

CREATE TRIGGER nodes_owner_at_creation BEFORE INSERT ON platform.nodes FOR EACH ROW EXECUTE FUNCTION platform.nodes_owner_at_creation();

GRANT INSERT(owner_kind,owner_team_id,owner_user_id) ON TABLE platform.nodes TO authenticated;

-- 4. Le propriétaire d'un nœud et le haut de son espace.
CREATE OR REPLACE FUNCTION platform.node_owner(p_node uuid) RETURNS TABLE(owner_kind text, owner_team_id uuid, owner_user_id uuid, owner_node_id uuid)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select n.owner_kind, n.owner_team_id, n.owner_user_id,
         (select a.id
            from platform.nodes a
           where a.org_id = n.org_id and a.lpath operator(extensions.@>) n.lpath
             and extensions.nlevel(a.lpath) > coalesce(
                   (select max(extensions.nlevel(b.lpath))
                      from platform.nodes b
                     where b.org_id = n.org_id and b.lpath operator(extensions.@>) n.lpath and b.id <> n.id
                       and (b.owner_kind, b.owner_team_id, b.owner_user_id)
                           is distinct from (n.owner_kind, n.owner_team_id, n.owner_user_id)), -1)
           order by extensions.nlevel(a.lpath)
           limit 1)
    from platform.nodes n
   where n.id = p_node and n.org_id in (select platform.member_orgs())
$$;

REVOKE ALL ON FUNCTION platform.node_owner(p_node uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION platform.node_owner(p_node uuid) TO authenticated;

-- 5. Le niveau d'un nœud, son propriétaire lu sur lui.
CREATE OR REPLACE FUNCTION platform.node_level_of(p_user uuid, p_org uuid, p_lpath extensions.ltree, p_owner_kind text, p_owner_team uuid, p_owner_user uuid) RETURNS integer
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_uid uuid := p_user;
  v_kind text := p_owner_kind;
  v_team uuid := p_owner_team;
  v_user uuid := p_owner_user;
  -- profondeur minimale d'une règle comptée : toute la branche pour un contenu de l'organisation, sous la racine
  -- ailleurs, sous le haut de son espace dans un espace personnel
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
  -- L'espace est écrit sur le nœud (migration 20261103150000) : plus aucun propriétaire ne se lit sur un ancêtre. Dans un
  -- espace personnel, seules comptent les règles posées sur le haut de l'espace (le nœud le moins profond de la suite
  -- d'ancêtres qui portent la même personne, `private/<handle>` pour l'espace d'origine) ou en dessous : une règle posée
  -- plus haut (`private`, la racine, le dossier où un contenu Privé est rangé) n'y ouvre rien et n'en ferme pas le
  -- propriétaire (D5, H61). Règle de la racine (28/10) : hors d'un contenu de l'organisation, une règle de la racine
  -- (profondeur 0) est ignorée.
  if v_kind is not distinct from 'user' then
    select coalesce(max(extensions.nlevel(a.lpath)) + 1, 0) into v_floor
      from platform.nodes a
     where a.org_id = p_org and a.lpath operator(extensions.@>) p_lpath
       and extensions.nlevel(a.lpath) < extensions.nlevel(p_lpath)
       and (a.owner_kind, a.owner_team_id, a.owner_user_id) is distinct from (v_kind, v_team, v_user);
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

-- 6. La copie d'un nœud dans l'espace de sa source.
CREATE OR REPLACE FUNCTION platform.duplicate_subtree(p_source uuid, p_nodes uuid[], p_segment text, p_title text, p_position double precision) RETURNS TABLE(source_id uuid, copy_id uuid, copy_path text, copied_files jsonb)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  v_uid uuid := (select auth.uid());
  v_source platform.nodes%rowtype;
  v_parent platform.nodes%rowtype;
  v_ids uuid[];
  v_path text;
  v_map jsonb := '{}'::jsonb;
  -- E10-S02 (AC-e3) : ancien identifiant de fichier → nouveau
  v_files jsonb;
  v_new uuid;
  r record;
begin
  if v_uid is null then
    raise exception 'duplicate_subtree needs a caller' using errcode = '42501';
  end if;
  select * into v_source from platform.nodes n where n.id = p_source and n.deleted_at is null;
  -- `duplicateNode` : le nœud lu (`findNode`), un nœud caché refusé comme un nœud inconnu (20261021100000).
  if v_source.id is null or v_source.parent_id is null
     or v_source.org_id not in (select platform.member_orgs())
     or platform.node_level_for(v_source.org_id, v_source.lpath, v_source.owner_kind, v_source.owner_team_id, v_source.owner_user_id) < 1 then
    raise exception 'node not found' using errcode = 'P0002';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(7301, pg_catalog.hashtext(v_source.org_id::text));
  select * into v_parent from platform.nodes n where n.id = v_source.parent_id;
  -- `duplicateNode` : l'écriture sous le parent, où la copie se pose et dont elle hérite (20261021100000).
  if platform.node_level_for(v_parent.org_id, v_parent.lpath, v_parent.owner_kind, v_parent.owner_team_id, v_parent.owner_user_id) < 2 then
    raise exception 'duplicating % needs the level 2 on its parent', v_source.path using errcode = '42501';
  end if;
  if p_title is null or char_length(btrim(p_title)) not between 1 and 200 then
    raise exception 'the title of the copy holds 1 to 200 characters' using errcode = '22023';
  end if;
  if p_segment is null or p_segment !~ '^[a-z0-9_]+$' then
    raise exception 'the segment of the copy is made of [a-z0-9_]' using errcode = '22023';
  end if;
  v_path := case when v_parent.parent_id is null then p_segment else v_parent.path || '/' || p_segment end;
  if exists (select 1 from platform.nodes n where n.org_id = v_source.org_id and n.path = v_path)
     or exists (select 1 from platform.node_aliases a where a.org_id = v_source.org_id and a.old_path = v_path) then
    raise exception 'path % is not available', v_path using errcode = '23505';
  end if;
  v_ids := array[p_source] || coalesce(p_nodes, '{}'::uuid[]);
  if exists (select 1 from unnest(coalesce(p_nodes, '{}'::uuid[])) as w(id)
               left join platform.nodes n on n.id = w.id
              where n.id is null or n.id = p_source or n.org_id <> v_source.org_id or n.deleted_at is not null
                 -- `copiedDescendants` : les seuls descendants que la personne lit (20261021100000)
                 or platform.node_level_for(n.org_id, n.lpath, n.owner_kind, n.owner_team_id, n.owner_user_id) < 1
                 or not (n.lpath operator(extensions.<@) v_source.lpath)
                 or not (n.parent_id = any (v_ids))) then
    raise exception 'each node to copy is a live descendant of the node, under a copied parent'
      using errcode = '22023';
  end if;

  -- E10-S02 (AC-e3) : un identifiant neuf pour chaque fichier d'un nœud copié qu'un bloc publié de ce nœud cite ;
  -- un fichier que seul un brouillon ou une version ancienne cite ne se lit pas dans la copie, il ne se copie pas.
  select coalesce(jsonb_object_agg(f.id::text, gen_random_uuid()), '{}'::jsonb) into v_files
    from platform.files f
   where f.org_id = v_source.org_id and f.node_id = any (v_ids)
     and exists (select 1 from platform.blocks b
                  where b.node_id = f.node_id and b.state = 'published' and b.type in ('file', 'image')
                    and b.data ->> 'file_id' = f.id::text);

  for r in select n.* from platform.nodes n where n.id = any (v_ids)
            order by extensions.nlevel(n.lpath), n.path loop
    v_new := gen_random_uuid();
    source_id := r.id;
    copy_id := v_new;
    copy_path := v_path || substr(r.path, char_length(v_source.path) + 1);
    -- E10-S02 (AC-e3) : les paires (ancien, nouveau) des fichiers de ce nœud
    copied_files := coalesce((select jsonb_object_agg(f.id::text, v_files -> f.id::text)
                                from platform.files f where f.node_id = r.id and v_files ? f.id::text), '{}'::jsonb);
    insert into platform.nodes (id, org_id, parent_id, path, kind, title, summary, status, revision, meta,
                                position, owner_kind, owner_team_id, owner_user_id, created_by, updated_by)
    values (v_new, r.org_id,
            case when r.id = p_source then r.parent_id else (v_map ->> r.parent_id::text)::uuid end,
            copy_path, r.kind, case when r.id = p_source then btrim(p_title) else r.title end, r.summary,
            case when r.revision > 0 then 'published' else 'draft' end,
            case when r.revision > 0 then 1 else 0 end,
            r.meta, case when r.id = p_source then p_position else r.position end,
            r.owner_kind, r.owner_team_id, r.owner_user_id, v_uid, v_uid);
    v_map := v_map || jsonb_build_object(r.id::text, v_new);
    return next;
  end loop;

  -- E10-S02 (AC-e3) : les fichiers copiés, `pending` sous la copie, jusqu'à la copie de leur objet par le service.
  -- Étape 4 du chantier « fichier » : la copie porte `copied_from`, et reprend l'origine de sa source (`files_origin`).
  insert into platform.files (id, org_id, node_id, name, mime, size, status, created_by, copied_from)
  select (v_files ->> f.id::text)::uuid, f.org_id, (v_map ->> f.node_id::text)::uuid, f.name, f.mime, f.size, 'pending', v_uid, f.id
    from platform.files f
   where f.org_id = v_source.org_id and v_files ? f.id::text;

  -- Blocs publiés et liens de ces blocs : un identifiant neuf par bloc, lu deux fois dans la même
  -- instruction (le `with` est calculé une fois ; l'insertion qu'il porte part même sans être lue).
  -- E10-S02 (AC-e3) : le `file_id` d'un bloc `file` ou d'une image jointe devient celui de la copie du fichier.
  with src as (
    select b.id, b.org_id, b.node_id, b.position, b.type, b.text,
           case when b.type in ('file', 'image') and v_files ? (b.data ->> 'file_id')
                then pg_catalog.jsonb_set(b.data, '{file_id}', v_files -> (b.data ->> 'file_id'))
                else b.data end as data,
           b.key, b.provenance, b.revision,
           gen_random_uuid() as new_id
      from platform.blocks b
     where b.node_id = any (v_ids) and b.state = 'published'
  ), copied as (
    insert into platform.blocks (id, state, org_id, node_id, position, type, text, data, key, provenance, revision,
                                 created_by, updated_by)
    select src.new_id, 'published', src.org_id, (v_map ->> src.node_id::text)::uuid, src.position, src.type, src.text,
           src.data, src.key, src.provenance, src.revision, v_uid, v_uid
      from src
  )
  insert into platform.links (org_id, source_node_id, source_block_id, target_path, target_key, target_node_id)
  select l.org_id, (v_map ->> l.source_node_id::text)::uuid, src.new_id, l.target_path, l.target_key, l.target_node_id
    from platform.links l
    join src on src.id = l.source_block_id
   where l.source_node_id = any (v_ids);

  -- L'instantané de la révision 1 d'une copie publiée, comme `publish_node` le prend.
  insert into platform.node_versions (node_id, revision, title, summary, kind, meta, blocks, author)
  select n.id, n.revision, n.title, n.summary, n.kind, n.meta,
         coalesce((select jsonb_agg(jsonb_build_object(
                             'id', b.id, 'type', b.type, 'position', b.position, 'key', b.key,
                             'text', b.text, 'data', b.data, 'provenance', b.provenance,
                             'revision', b.revision) order by b.position, b.id)
                     from platform.blocks b
                    where b.node_id = n.id and b.state = 'published' and b.type <> 'row'), '[]'::jsonb),
         v_uid
    from platform.nodes n
   where n.id in (select (e.value #>> '{}')::uuid from jsonb_each(v_map) e) and n.revision = 1;
end;
$_$;

REVOKE ALL ON FUNCTION platform.duplicate_subtree(p_source uuid, p_nodes uuid[], p_segment text, p_title text, p_position double precision) FROM PUBLIC;
GRANT ALL ON FUNCTION platform.duplicate_subtree(p_source uuid, p_nodes uuid[], p_segment text, p_title text, p_position double precision) TO authenticated;

-- ROLLBACK: (jamais exécuté depuis le paquet)
--   create or replace function platform.duplicate_subtree(…) … : le corps de 20261023120000 (sans les colonnes du
--     propriétaire : la copie hérite de son parent) ;
--   create or replace function platform.node_level_of(…) … : le corps de 20261028090000 (propriétaire lu sur l'ancêtre
--     le plus proche qui en porte un) ;
--   create or replace function platform.node_owner(…) … : le corps de la ligne de base 20260928100000 ;
--   revoke insert (owner_kind, owner_team_id, owner_user_id) on platform.nodes from authenticated ;
--   drop trigger nodes_owner_at_creation on platform.nodes ; drop function platform.nodes_owner_at_creation() ;
--   alter table platform.nodes drop constraint nodes_owner_written_check ;
--   les propriétaires figés restent écrits (ils valent celui qu'on calculait) ; et `nodeLevelOf` du paquet précédent.
