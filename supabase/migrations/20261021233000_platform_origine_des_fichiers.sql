-- L'origine d'un fichier (fichiers et stockage, § Origine d'un fichier ; étape 4 du chantier « fichier », décidée par
-- Alexis le 21/10) : chaque ligne `files` dit, une fois pour toutes, ce qui l'a produite. Une ligne d'avant reste sans
-- origine (« origine inconnue »), sans reprise.
--
-- - `origin_kind` : `upload` (déposé par une personne), `link` (déposé par un lien de dépôt), `function` (rendu par une
--   fonction) ; `origin_function` : la fonction (`upload.link`, `3cx.recording`), pour `link` et `function` ;
--   `origin_ctx` : la conversation de l'appel, s'il en a une. Écrits par le service ; la base vérifie que la conversation
--   est celle de l'auteur de la ligne, dans son organisation.
-- - `origin_by`, `origin_at` : l'auteur et la date de l'origine, posés par la base (`files_origin`), jamais par la
--   session (aucun `INSERT` accordé sur eux) : l'auteur et l'heure de la ligne. Une origine déjà datée est gardée telle
--   quelle : seule la connexion d'administration en écrit une, l'import d'une organisation (`scripts/org-import.mjs`), qui
--   reprend la sorte, la fonction, l'auteur et la date de la source.
-- - `copied_from` : pour une copie (garder sur une autre page, dupliquer une page), le fichier d'où elle vient. La copie
--   reprend l'origine de sa source, posée par la base : un fichier d'avant donne son auteur et sa date, sans le reste.
--   La source doit être de la même organisation et lue par l'appelant, sinon `42501` : on ne recopie pas l'origine d'un
--   fichier qu'on ne lit pas. La copie garde son origine quand la source disparaît (aucune clé vers elle).
-- - `origin_by` part avec la personne : retirée de l'organisation ou oubliée (`forget_user` supprime ses lignes
--   `members`), la clé la met à nul, la ligne garde la fonction et la date.
--
-- `duplicate_subtree` est recréée sous sa signature et son droit, sur le corps de 20261021100000 : ses copies portent
-- `copied_from`. Un seul bloc ROLLBACK en fin de fichier.

ALTER TABLE platform.files
    ADD COLUMN origin_kind text,
    ADD COLUMN origin_function text,
    ADD COLUMN origin_ctx text,
    ADD COLUMN origin_by uuid,
    ADD COLUMN origin_at timestamp with time zone,
    ADD COLUMN copied_from uuid;

ALTER TABLE ONLY platform.files
    ADD CONSTRAINT files_origin_kind_check CHECK (((origin_kind IS NULL) OR (origin_kind = ANY (ARRAY['upload'::text, 'link'::text, 'function'::text])))),
    ADD CONSTRAINT files_origin_function_check CHECK (((origin_function IS NULL) OR ((char_length(origin_function) >= 1) AND (char_length(origin_function) <= 200)))),
    ADD CONSTRAINT files_origin_by_fkey FOREIGN KEY (org_id, origin_by) REFERENCES platform.members(org_id, user_id) ON DELETE SET NULL (origin_by);

CREATE INDEX idx_files_origin_by ON platform.files USING btree (org_id, origin_by) WHERE (origin_by IS NOT NULL);

GRANT INSERT(origin_kind) ON TABLE platform.files TO authenticated;
GRANT INSERT(origin_function) ON TABLE platform.files TO authenticated;
GRANT INSERT(origin_ctx) ON TABLE platform.files TO authenticated;
GRANT INSERT(copied_from) ON TABLE platform.files TO authenticated;

-- L'origine d'une ligne neuve : celle de sa source pour une copie, sinon l'auteur et l'heure de la ligne, la conversation
-- vérifiée. `security definer` : elle lit la source et la conversation hors de la RLS, et refait elle-même la lecture.
CREATE FUNCTION platform.files_origin() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_source platform.files%rowtype;
begin
  if new.copied_from is not null then
    select f.* into v_source
      from platform.files f
      left join platform.nodes n on n.id = f.node_id
     where f.id = new.copied_from
       and f.org_id = new.org_id
       and (case when f.node_id is null then f.created_by = (select auth.uid())
                 else platform.node_level_for(n.org_id, n.lpath, n.owner_kind, n.owner_team_id, n.owner_user_id) >= 1 end);
    if not found then
      raise exception 'copied_from: no file of this organisation read by the caller' using errcode = '42501';
    end if;
    new.origin_kind := v_source.origin_kind;
    new.origin_function := v_source.origin_function;
    new.origin_ctx := v_source.origin_ctx;
    new.origin_at := coalesce(v_source.origin_at, v_source.created_at);
    new.origin_by := coalesce(v_source.origin_by, v_source.created_by);
  else
    if new.origin_ctx is not null and not exists (
      select 1 from platform.ctx c where c.code = new.origin_ctx and c.user_id = new.created_by and c.org_id = new.org_id
    ) then
      raise exception 'origin_ctx: not a conversation of the author in this organisation' using errcode = '42501';
    end if;
    -- Une origine datée vient de l'import d'une organisation (la session ne peut écrire ni `origin_at` ni `origin_by`).
    if new.origin_at is null then
      new.origin_at := now();
      new.origin_by := new.created_by;
    end if;
  end if;
  -- L'auteur n'est gardé que membre de l'organisation (la clé vers `members`) : sinon nul, la fonction et la date restent.
  if not exists (select 1 from platform.members m where m.org_id = new.org_id and m.user_id = new.origin_by) then
    new.origin_by := null;
  end if;
  return new;
end
$$;

REVOKE ALL ON FUNCTION platform.files_origin() FROM PUBLIC;

CREATE TRIGGER files_origin BEFORE INSERT ON platform.files FOR EACH ROW EXECUTE FUNCTION platform.files_origin();

-- `duplicate_subtree` (`duplicateNode`, `server/nodes/duplicate.ts`), sur le corps de 20261021100000 : la copie d'un
-- fichier porte `copied_from`.
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
--   create or replace function platform.duplicate_subtree(…) … : le corps de 20261021100000 (§ 4) ;
--   drop trigger files_origin on platform.files ; drop function platform.files_origin() ;
--   revoke insert (origin_kind, origin_function, origin_ctx, copied_from) on platform.files from authenticated ;
--   drop index platform.idx_files_origin_by ;
--   alter table platform.files drop column origin_kind, drop column origin_function, drop column origin_ctx,
--     drop column origin_by, drop column origin_at, drop column copied_from.
