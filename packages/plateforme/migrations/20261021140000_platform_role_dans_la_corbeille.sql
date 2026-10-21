-- La lecture des fichiers d'une page à la corbeille, et sa purge (base et portabilité, § Port de base ; suite de
-- `20261021130000`, doctrine décidée par Alexis le 20/10). `files_select_member` gardait une exception : le fichier d'un
-- nœud à la corbeille restait lu par tout membre de l'organisation, nom et taille compris. Avec son seul jeton, sur un
-- hôte qui exposerait `platform`, un membre voyait pendant 30 jours les fichiers d'un espace personnel ou d'une page
-- d'équipe fermée mis à la corbeille.
--
-- L'exception servait la purge, qui tourne sous la session de l'appelant : sous RLS, une suppression ne voit que les
-- lignes que l'appelant lit, et un fichier qu'il ne lit pas partait par la cascade de `files.node_id` sans que son
-- identifiant revienne au service, son objet laissé dans le stockage. La purge passe donc par deux fonctions
-- `security definer`, qui suppriment en une instruction les nœuds visés et leurs fichiers, lus ou non par l'appelant,
-- et rendent les identifiants des fichiers pour `removeObjects`. Chacune reprend la règle de son service, ni plus dure
-- ni plus large, et la borne de `nodes_delete_manager` (`20261021090000`) :
-- - `purge_trash(org)` : `purgeTrash` (`server/nodes/trash.ts`), une rétention de l'organisation que lance tout membre
--   qui ouvre la corbeille (`listTrash`) ou y met un contenu (`trashNode`) ; membre de l'organisation (`member_orgs`,
--   accès plateforme en cours compris), sinon 42501 ; les nœuds à la corbeille depuis plus de 30 jours dont tout le
--   sous-arbre l'est aussi, hors racine, dossier `private` et Contextes. Le délai est fixé ici, comme dans la policy,
--   jamais passé par l'appelant ; le service rend le nombre de nœuds purgés ;
-- - `erase_team_trash(org, team)` : `eraseTrashedNodes` (`server/team-trash.ts`) pour `deleteTeam` (`server/teams.ts`,
--   `requireAdmin`) ; l'administrateur de l'organisation (`is_org_admin`), sinon 42501 ; l'équipe lue dans
--   l'organisation, sinon P0002 ; les pages de l'équipe à la corbeille, quelle que soit leur date (celles dont elle est
--   propriétaire et celles rangées sous son dossier, avec leurs sous-pages), hors racine, dossier `private` et Contextes.
--
-- `files_select_member` perd sa branche de la corbeille : un fichier se lit par son auteur, ou par qui lit son nœud
-- (`node_level_for` >= 1), à la corbeille comme ailleurs. `node_level_for` ne lit pas `deleted_at` : qui lisait la page
-- en lit encore le fichier en SQL, comme ses blocs ; les services la tiennent pour illisible (`access-facts.ts`).
-- La policy est recréée sous son nom (`check:migrations` refuse un `drop` sans recréation, ADR-006 § 2). Un seul bloc
-- ROLLBACK en fin de fichier.

-- 1. `files`, lecture : son auteur ; un fichier joint, la lecture (1) de son nœud (`readableFile`), à la corbeille comprise.
DROP POLICY IF EXISTS files_select_member ON platform.files;
CREATE POLICY files_select_member ON platform.files FOR SELECT TO authenticated USING (((org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND ((created_by = ( SELECT auth.uid() AS uid)) OR ((node_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM platform.nodes n
  WHERE ((n.id = files.node_id) AND (n.org_id = files.org_id) AND (platform.node_level_for(n.org_id, n.lpath, n.owner_kind, n.owner_team_id, n.owner_user_id) >= 1))
 OFFSET 0))))));

-- 2. La purge de la corbeille de l'organisation (`purgeTrash`), pour un membre : les nœuds expirés et leurs fichiers.
CREATE FUNCTION platform.purge_trash(p_org uuid) RETURNS TABLE(nodes integer, files uuid[])
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not coalesce(p_org in (select platform.member_orgs()), false) then
    raise exception 'the trash of an organisation is purged by its members' using errcode = '42501';
  end if;
  return query
    with gone as (
      delete from platform.nodes n
       where n.org_id = p_org and n.deleted_at < now() - interval '30 days'
         and n.parent_id is not null and n.path <> 'private' and not platform.is_context_path(n.org_id, n.path)
         and not exists (select 1 from platform.nodes d
                          where d.org_id = n.org_id and starts_with(d.path, n.path || '/')
                            and (d.deleted_at is null or d.deleted_at >= now() - interval '30 days'))
      returning n.id
    ), gone_files as (
      delete from platform.files f where f.org_id = p_org and f.node_id in (select gone.id from gone)
      returning f.id
    )
    select (select count(*)::int from gone),
           coalesce((select array_agg(gone_files.id) from gone_files), '{}'::uuid[]);
end;
$$;

REVOKE ALL ON FUNCTION platform.purge_trash(p_org uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.purge_trash(p_org uuid) TO authenticated;

-- 3. L'effacement des pages d'une équipe à la corbeille (`eraseTrashedNodes` pour `deleteTeam`), pour l'administrateur.
CREATE FUNCTION platform.erase_team_trash(p_org uuid, p_team uuid) RETURNS uuid[]
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_slug text;
  v_files uuid[];
begin
  if not platform.is_org_admin(p_org) then
    raise exception 'the trashed pages of a team are erased by an administrator of its organisation' using errcode = '42501';
  end if;
  select t.slug into v_slug from platform.teams t where t.id = p_team and t.org_id = p_org;
  if v_slug is null then
    raise exception 'no team % in this organisation', p_team using errcode = 'P0002';
  end if;
  with roots as (
    select r.path from platform.nodes r
     where r.org_id = p_org and r.deleted_at is not null
       and (r.owner_team_id = p_team or starts_with(r.path, v_slug || '/'))
  ), gone as (
    delete from platform.nodes n
     where n.org_id = p_org and n.deleted_at is not null
       and n.parent_id is not null and n.path <> 'private' and not platform.is_context_path(n.org_id, n.path)
       and exists (select 1 from roots where n.path = roots.path or starts_with(n.path, roots.path || '/'))
    returning n.id
  ), gone_files as (
    delete from platform.files f where f.org_id = p_org and f.node_id in (select gone.id from gone)
    returning f.id
  )
  select coalesce(array_agg(gone_files.id), '{}'::uuid[]) into v_files from gone_files;
  return v_files;
end;
$$;

REVOKE ALL ON FUNCTION platform.erase_team_trash(p_org uuid, p_team uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.erase_team_trash(p_org uuid, p_team uuid) TO authenticated;

-- ROLLBACK: (jamais exécuté depuis le paquet ; la policy reprend sa définition précédente, sous son nom)
--   drop function platform.erase_team_trash(uuid, uuid) ;
--   drop function platform.purge_trash(uuid) ;
--   (et `server/nodes/trash.ts`, `server/team-trash.ts` suppriment nœuds et fichiers sous la session) ;
--   files_select_member : drop, puis la définition de 20261021130000 (la branche `n.deleted_at is not null`).
