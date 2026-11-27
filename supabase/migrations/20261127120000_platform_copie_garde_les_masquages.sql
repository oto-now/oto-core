-- La copie garde les masquages (droits d'accès, § Règles d'accès ; décidé par JB le 27/11) : chaque page copiée par
-- « Dupliquer » reprend les règles « Aucun accès » (`none`) de son original, sur le nœud copié comme sur ses
-- descendants ; les règles qui ouvrent (`read`, `write`, `manage`) ne sont pas reprises. Personne ne lit dans la copie ce
-- qu'il ne lisait pas dans l'original. Avant, la copie ne reprenait aucune règle : héritant de son parent, une page cachée
-- à un membre de l'équipe lui devenait lisible dans la copie qu'en faisait un autre.
--
-- Qui copie garde toutes les pages qu'il lit (la fonction ne copie que celles-là) : quand les règles `none` reprises
-- cachent à l'appelant la copie d'une page (une règle qui vise une de ses équipes ou toute l'organisation, l'original lui
-- étant ouvert par une règle qui ouvre, non reprise), une règle à son seul nom lui rend sur cette copie le niveau auquel
-- il lit l'original ; toutes les règles `none` restent, aucun autre sujet ne lit la copie. La fonction écrit les règles
-- elle-même, sous le verrou de l'arbre, `created_by` à l'appelant : la policy
-- `access_rules_insert_manager` exige la gestion de la copie (`node_level_for` >= 3), quand dupliquer ne demande que
-- l'écriture de son parent.
--
-- `duplicate_subtree` est recréée sous sa signature, son retour et son droit, sur le corps de 20261023120000. Aucune
-- table, colonne, policy ni index ; rien à relancer avant. Une copie déjà faite garde ses règles : seules les copies à
-- venir reprennent les masquages.

-- `duplicate_subtree` (`duplicateNode`, `server/nodes/duplicate.ts`), sur le corps de 20261023120000 : la copie de chaque
-- nœud reprend les règles `none` de son original.
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
  -- 27/11 : la copie d'un nœud, relue pour le niveau de l'appelant, et le nombre de règles `none` reprises
  v_copy platform.nodes%rowtype;
  v_rules int;
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
    -- La copie garde les masquages (27/11) : toutes les règles `none` de l'original, écrites sous l'appelant. Si elles
    -- cachent la copie à l'appelant, qui lit l'original (par une règle qui ouvre, non reprise), une règle à son seul nom
    -- lui rend sur la copie le niveau auquel il lit l'original : les règles déjà posées au-dessus lui laissent ses
    -- ancêtres, seules celles de la page peuvent la lui cacher.
    insert into platform.access_rules (org_id, node_id, subject_team_id, subject_user_id, subject_org, level, created_by)
    select a.org_id, v_new, a.subject_team_id, a.subject_user_id, a.subject_org, 'none', v_uid
      from platform.access_rules a
     where a.node_id = r.id and a.level = 'none';
    get diagnostics v_rules = row_count;
    if v_rules > 0 then
      select * into v_copy from platform.nodes n where n.id = v_new;
      if platform.node_level_for(v_copy.org_id, v_copy.lpath, v_copy.owner_kind, v_copy.owner_team_id, v_copy.owner_user_id) < 1 then
        insert into platform.access_rules (org_id, node_id, subject_user_id, level, created_by)
        values (r.org_id, v_new, v_uid,
                case platform.node_level_for(r.org_id, r.lpath, r.owner_kind, r.owner_team_id, r.owner_user_id)
                  when 1 then 'read' when 2 then 'write' else 'manage' end,
                v_uid)
        on conflict on constraint access_rules_target_subject_key do update set level = excluded.level;
      end if;
    end if;
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

-- ROLLBACK: (jamais exécuté depuis le paquet ; avec le paquet de la version précédente)
--   create or replace function platform.duplicate_subtree(…) … : le corps de 20261023120000 ; les règles `none` que des
--   copies ont reprises entre-temps restent (elles ne cachent que ce que l'original cachait).
