-- Le niveau exigé par les fonctions `security definer` qu'une session exécute (base et portabilité, § Port de base ;
-- suite de `20261019150000`, `20261020190000` et `20261021090000`, doctrine décidée par Alexis le 20/10). Ces fonctions
-- n'exigeaient que l'appartenance (`member_orgs()`), le niveau étant décidé par le service avant l'appel : avec son seul
-- jeton, sur un hôte qui exposerait `platform`, tout membre ouvrait, publiait ou abandonnait le brouillon d'une page
-- qu'il ne fait que lire, ou qui lui est cachée, abandonnait celui d'une page jamais publiée, et dupliquait sous un
-- dossier qu'il lit une page qui lui est cachée, ou des descendants cachés passés dans `p_nodes` : la copie ne reprend
-- ni le propriétaire ni les règles, elle hérite de son parent, et lui devenait lisible (fuite de contenu).
--
-- Quand l'appelant est une personne (`auth.uid()` non nul, sous `authenticated` ou `platform_server`, qui lit les mêmes
-- claims), chaque fonction exige le niveau de son service (`node_level_for`), ni plus dur ni plus large :
-- - `open_draft` : l'écriture (2), comme `openDraft`, appelé après `requireNodeLevel` (`edit`, `server/nodes/write.ts`)
--   ou dans la transaction d'une création, sur un nœud neuf qui hérite du niveau de son parent (`create`) ;
-- - `publish_node` : l'écriture (2), comme `publishNode` (`requireNodeLevel` action `publish`) ;
-- - `discard_draft` : l'écriture (2), et une page déjà publiée, comme `discardPlan` (`server/nodes/discard.ts`) ;
-- - `duplicate_subtree` : la lecture (1) du nœud et de chaque descendant copié, l'écriture (2) de son parent, comme
--   `duplicateNode` (`findNode`, `copiedDescendants`, `nodeLevel` du parent).
-- Le refus est celui que la fonction levait déjà pour un nœud inconnu ou d'une autre organisation : un nœud caché ne
-- se distingue pas d'un nœud absent. Sans refus existant (le parent de la copie, une page jamais publiée), 42501.
-- Sans personne (connexion d'administration, seed), rien ne change : `open_draft` et `publish_node` restent libres,
-- `discard_draft` et `duplicate_subtree` exigeaient déjà un appelant. Chaque fonction est recréée sous sa signature,
-- avec son `search_path`, son propriétaire et ses droits, sur son corps d'avant, contrôles ajoutés. Aucune autre
-- fonction `security definer` exécutable par `authenticated` ou `platform_server` n'écrit dans `nodes`, `blocks` ou
-- `node_drafts` (inventaire de `pg_proc` du 20/10 ; `create_org` et `signup_org` créent les nœuds d'une organisation
-- neuve). Un seul bloc ROLLBACK en fin de fichier.

-- 1. `open_draft` (`openDraft`, `server/nodes/store.ts`), sur le corps de la ligne de base.
CREATE OR REPLACE FUNCTION platform.open_draft(p_node uuid) RETURNS TABLE(base_revision integer, created boolean)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_uid uuid := (select auth.uid());
  v_kind text;
  v_revision int;
  v_created boolean;
begin
  -- Sous une session, un nœud d'une organisation de l'appelant, qu'il écrit (`openDraft`, après `requireNodeLevel`
  -- ou l'écriture du parent d'une création : niveau 2, 20261021100000) ; un nœud inconnu ou caché est refusé de même.
  if v_uid is not null and not exists (select 1 from platform.nodes n
                                        where n.id = p_node and n.org_id in (select platform.member_orgs())
                                          and platform.node_level_for(n.org_id, n.lpath, n.owner_kind, n.owner_team_id, n.owner_user_id) >= 2) then
    raise exception 'node outside the organizations of the caller, or not written by the caller' using errcode = '42501';
  end if;
  select n.kind, n.revision into v_kind, v_revision
    from platform.nodes n where n.id = p_node for update;
  if v_kind is null then
    raise exception 'node not found' using errcode = 'P0002';
  end if;
  insert into platform.node_drafts (node_id, base_revision, created_by, updated_by)
  values (p_node, v_revision, v_uid, v_uid)
  on conflict (node_id) do nothing;
  v_created := found;
  -- Un bloc de brouillon écrit pendant la publication précédente lui survit, sans marque : il part
  -- avant la copie.
  if v_created then
    delete from platform.blocks b where b.node_id = p_node and b.state = 'draft';
  end if;
  if v_created and v_kind <> 'table' then
    insert into platform.blocks (id, state, org_id, node_id, position, type, text, data, key,
                                 provenance, revision, created_by, updated_by, created_at, updated_at)
    select b.id, 'draft', b.org_id, b.node_id, b.position, b.type, b.text, b.data, b.key,
           b.provenance, b.revision, b.created_by, b.updated_by, b.created_at, b.updated_at
      from platform.blocks b
     where b.node_id = p_node and b.state = 'published';
  end if;
  return query select d.base_revision, v_created from platform.node_drafts d where d.node_id = p_node;
end;
$$;

REVOKE ALL ON FUNCTION platform.open_draft(p_node uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION platform.open_draft(p_node uuid) TO authenticated;

-- 2. `publish_node`, la surcharge au tampon (`publishNode`, `server/nodes/publish.ts`), sur le corps de la ligne de
--    base. La surcharge sans tampon l'appelle (`select platform.publish_node(p_node, p_base_revision, null, p_links)`)
--    sous les mêmes claims : elle n'est pas recréée.
CREATE OR REPLACE FUNCTION platform.publish_node(p_node uuid, p_base_revision integer, p_draft_stamp timestamp with time zone, p_links jsonb DEFAULT NULL::jsonb) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  v_uid uuid := (select auth.uid());
  v_node platform.nodes%rowtype;
  v_draft platform.node_drafts%rowtype;
begin
  -- Sous une session, un nœud d'une organisation de l'appelant, qu'il écrit (`publishNode`, `requireNodeLevel`
  -- action `publish` : niveau 2, 20261021100000) ; un nœud inconnu ou caché est refusé de même.
  if v_uid is not null and not exists (select 1 from platform.nodes n
                                        where n.id = p_node and n.org_id in (select platform.member_orgs())
                                          and platform.node_level_for(n.org_id, n.lpath, n.owner_kind, n.owner_team_id, n.owner_user_id) >= 2) then
    raise exception 'node outside the organizations of the caller, or not written by the caller' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(7401, pg_catalog.hashtext(p_node::text));
  select * into v_node from platform.nodes n where n.id = p_node for update;
  if v_node.id is null then
    raise exception 'node not found' using errcode = 'P0002';
  end if;
  if p_base_revision is distinct from v_node.revision then
    raise exception 'stale revision: the node is at revision %', v_node.revision
      using errcode = 'PT409';
  end if;
  select * into v_draft from platform.node_drafts d where d.node_id = p_node for update;
  if v_draft.node_id is null then
    raise exception 'nothing to publish: no open draft' using errcode = '55000';
  end if;
  if v_draft.base_revision <> v_node.revision then
    raise exception 'stale draft: opened on revision %, the node is at revision %',
      v_draft.base_revision, v_node.revision using errcode = 'PT409';
  end if;
  if p_draft_stamp is not null and v_draft.updated_at is distinct from p_draft_stamp then
    raise exception 'stale draft: saved again after the stamp read' using errcode = 'PT409';
  end if;
  if v_draft.meta is not null and v_node.kind <> 'table' then
    raise exception 'meta holds the schema of a table only' using errcode = '22023';
  end if;
  if p_links is not null and (jsonb_typeof(p_links) <> 'array' or jsonb_array_length(p_links) > 1000) then
    raise exception 'p_links must be an array of 1000 links at most' using errcode = '22023';
  end if;

  if v_node.kind <> 'table' then
    delete from platform.blocks b where b.node_id = p_node and b.state = 'published';
    insert into platform.blocks (id, state, org_id, node_id, position, type, text, data, key,
                                 provenance, revision, created_by, updated_by, created_at, updated_at)
    select b.id, 'published', b.org_id, b.node_id, b.position, b.type, b.text, b.data, b.key,
           b.provenance, b.revision, b.created_by, b.updated_by, b.created_at, b.updated_at
      from platform.blocks b
     where b.node_id = p_node and b.state = 'draft';
    delete from platform.blocks b where b.node_id = p_node and b.state = 'draft';
  end if;

  update platform.nodes n
     set title = coalesce(v_draft.title, n.title),
         summary = coalesce(v_draft.summary, n.summary),
         kind = coalesce(v_draft.kind, n.kind),
         meta = coalesce(v_draft.meta, n.meta),
         status = 'published',
         revision = n.revision + 1,
         updated_by = coalesce(v_uid, n.updated_by)
   where n.id = p_node;

  insert into platform.node_versions (node_id, revision, title, summary, kind, meta, blocks, author)
  select n.id, n.revision, n.title, n.summary, n.kind, n.meta,
         coalesce((select jsonb_agg(jsonb_build_object(
                             'id', b.id, 'type', b.type, 'position', b.position, 'key', b.key,
                             'text', b.text, 'data', b.data, 'provenance', b.provenance,
                             'revision', b.revision) order by b.position, b.id)
                     from platform.blocks b
                    where b.node_id = n.id and b.state = 'published' and b.type <> 'row'), '[]'),
         v_uid
    from platform.nodes n where n.id = p_node;

  if p_links is not null then
    if exists (
      select 1 from jsonb_array_elements(p_links) e
       where jsonb_typeof(e) <> 'object'
          or coalesce(e ->> 'path', '') !~ '^[a-z0-9_]+(/[a-z0-9_]+)*$'
          or char_length(e ->> 'path') > 1000
          or (e -> 'key' is not null and jsonb_typeof(e -> 'key') not in ('string', 'null'))
          or char_length(coalesce(e ->> 'key', '')) > 500
          or case when coalesce(e ->> 'block_id', '') ~ '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$'
                  then not exists (select 1 from platform.blocks b
                                    where b.id = (e ->> 'block_id')::uuid and b.node_id = p_node
                                      and b.state = 'published')
                  else true end) then
      raise exception 'each link is {block_id, path, key?} with block_id a block of the published node'
        using errcode = '22023';
    end if;
    delete from platform.links l where l.source_node_id = p_node;
    insert into platform.links (org_id, source_node_id, source_block_id, target_path, target_key,
                                target_node_id)
    select distinct v_node.org_id, p_node, (e ->> 'block_id')::uuid, e ->> 'path',
           nullif(e ->> 'key', ''),
           (select t.id from platform.nodes t
             where t.org_id = v_node.org_id and t.path = e ->> 'path')
      from jsonb_array_elements(p_links) e;
  end if;

  delete from platform.node_drafts d where d.node_id = p_node;
  return v_node.revision + 1;
end;
$_$;

REVOKE ALL ON FUNCTION platform.publish_node(p_node uuid, p_base_revision integer, p_draft_stamp timestamp with time zone, p_links jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION platform.publish_node(p_node uuid, p_base_revision integer, p_draft_stamp timestamp with time zone, p_links jsonb) TO authenticated;

-- 3. `discard_draft` (`discardPlan`, `server/nodes/discard.ts`), sur le corps de 20260930100000.
CREATE OR REPLACE FUNCTION platform.discard_draft(p_node uuid, p_draft_stamp timestamp with time zone) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_node platform.nodes%rowtype;
  v_draft platform.node_drafts%rowtype;
begin
  -- Un nœud d'une organisation de l'appelant, qu'il écrit (`discardPlan`, `requireNodeLevel` action `write` : niveau
  -- 2, 20261021100000) ; un nœud inconnu ou caché est refusé de même.
  if not exists (select 1 from platform.nodes n
                  where n.id = p_node and n.org_id in (select platform.member_orgs())
                    and platform.node_level_for(n.org_id, n.lpath, n.owner_kind, n.owner_team_id, n.owner_user_id) >= 2) then
    raise exception 'node outside the organizations of the caller, or not written by the caller' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(7401, pg_catalog.hashtext(p_node::text));
  select * into v_node from platform.nodes n where n.id = p_node for update;
  select * into v_draft from platform.node_drafts d where d.node_id = p_node for update;
  if v_draft.node_id is null then
    raise exception 'nothing to discard: no open draft' using errcode = '55000';
  end if;
  if p_draft_stamp is not null and v_draft.updated_at is distinct from p_draft_stamp then
    raise exception 'stale draft: saved again after the stamp read' using errcode = 'PT409';
  end if;
  -- `discardPlan` : une page jamais publiée n'a pas de révision à laquelle revenir (20261021100000).
  if v_node.revision = 0 then
    raise exception '% has never been published: discarding its draft would leave it empty', v_node.path
      using errcode = '42501';
  end if;

  delete from platform.blocks b where b.node_id = p_node and b.state = 'draft';
  delete from platform.node_drafts d where d.node_id = p_node;
  return v_node.revision;
end;
$$;

REVOKE ALL ON FUNCTION platform.discard_draft(p_node uuid, p_draft_stamp timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION platform.discard_draft(p_node uuid, p_draft_stamp timestamp with time zone) TO authenticated;

-- 4. `duplicate_subtree` (`duplicateNode`, `server/nodes/duplicate.ts`), sur le corps de 20260930100000.
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
                                position, created_by, updated_by)
    values (v_new, r.org_id,
            case when r.id = p_source then r.parent_id else (v_map ->> r.parent_id::text)::uuid end,
            copy_path, r.kind, case when r.id = p_source then btrim(p_title) else r.title end, r.summary,
            case when r.revision > 0 then 'published' else 'draft' end,
            case when r.revision > 0 then 1 else 0 end,
            r.meta, case when r.id = p_source then p_position else r.position end, v_uid, v_uid);
    v_map := v_map || jsonb_build_object(r.id::text, v_new);
    return next;
  end loop;

  -- E10-S02 (AC-e3) : les fichiers copiés, `pending` sous la copie, jusqu'à la copie de leur objet par le service.
  insert into platform.files (id, org_id, node_id, name, mime, size, status, created_by)
  select (v_files ->> f.id::text)::uuid, f.org_id, (v_map ->> f.node_id::text)::uuid, f.name, f.mime, f.size, 'pending', v_uid
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

-- ROLLBACK: (jamais exécuté depuis le paquet ; chaque fonction reprend son corps d'avant, sous sa signature)
--   create or replace function platform.duplicate_subtree(…) … : le corps de 20260930100000 (§ 7), sans les trois
--     appels à `node_level_for` ;
--   create or replace function platform.discard_draft(…) … : le corps de 20260930100000, sans `node_level_for` ni le
--     refus d'une révision 0 ;
--   create or replace function platform.publish_node(p_node uuid, p_base_revision integer, p_draft_stamp timestamp with
--     time zone, p_links jsonb) … : le corps de la ligne de base (20260928100000), sans `node_level_for` ;
--   create or replace function platform.open_draft(p_node uuid) … : le corps de la ligne de base, sans
--     `node_level_for` ;
--   les refus reprennent le message « node outside the organizations of the caller ».
