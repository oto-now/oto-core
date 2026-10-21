-- Les vues des pages, et la suppression d'un nœud sous une session (base et portabilité, § Port de base ; suite de
-- `20261021140000`, doctrine décidée par Alexis le 20/10). Deux ouvertures restaient à l'appartenance :
-- - `node_views_select_member` (`20261020090000`) : tout membre lisait qui a vu quelle page et quel jour, y compris sur
--   une page qui lui est fermée (l'espace personnel d'un autre, une page d'équipe fermée). Une vue s'enregistrait d'une
--   page que la personne ne lit pas, s'avançait sur une page qu'elle ne lit plus, et tout membre supprimait (et lisait
--   par `returning`) les lignes de plus de 90 jours des autres ;
-- - `nodes_delete_manager` (`20261021090000`) gardait deux branches de la corbeille (tout membre sur un nœud à la
--   corbeille depuis plus de 30 jours ; l'administrateur sur un nœud à la corbeille), qui servaient `purgeTrash` et
--   `eraseTrashedNodes`. Depuis `20261021140000`, ils passent par `purge_trash` et `erase_team_trash` : aucun service ne
--   s'en sert plus, et un membre supprimait encore, avec son seul jeton, un nœud expiré, dont la cascade emportait la
--   ligne du fichier et laissait l'objet orphelin dans le stockage.
--
-- Chaque accès reprend la règle de son service, ni plus dure ni plus large :
-- - lecture de `node_views` : ses propres lignes. Le seul lecteur sous une session qui lise une ligne est `lastVisit`
--   (`server/home-contents.ts`, la dernière visite de `homeNews`), sur ses propres lignes ; l'enregistrement
--   (`recordNodeView`, `server/node-views.ts`, `insert … on conflict do update`) lit la ligne qu'il avance, la sienne ;
-- - les comptes de l'organisation (« Les plus consultés », `viewedCandidates` de `homeContents`, montrés à tout membre ;
--   le service n'en rend que des comptes par page, gardés au seuil de la lecture par `nodeLevels`) : la fonction
--   `node_view_counts(org, jours, limite)`, `security definer`, pour tout membre (`member_orgs`, sinon 42501), une
--   fenêtre de 1 à 90 jours (la rétention, sinon 22023), les pages vivantes les plus vues, puis celles que l'appelant lit
--   (`node_level_for` >= 1) ; les vues sont d'abord comptées par page et bornées à la limite, puis le niveau évalué une
--   fois par page retenue, jamais par ligne de vue (mesuré sur 5 000 vues et 500 pages : 60 ms pour 300 pages
--   retenues ; 110 ms en évaluant chacune des 500 pages, 90 ms par ligne de vue ; 1 à 2 ms sans filtre, avant) ;
-- - ajout et avancée d'une vue : la personne pour elle-même (`user_id = auth.uid()`, comme avant), d'une page de son
--   organisation qu'elle lit (`node_level_for` >= 1, celle de `findNode` dans `recordNodeView`) ; l'avancée garde la
--   même exigence en `with check`, l'`insert … on conflict do update` passant par les deux ;
-- - le ménage des lignes de plus de 90 jours de l'organisation, à chaque vue (`recordNodeView`) : la fonction
--   `sweep_node_views(org)`, `security definer`, pour tout membre (`member_orgs`, sinon 42501), le délai fixé ici et
--   jamais passé par l'appelant ; rien n'est rendu. Le droit DELETE d'`authenticated` sur `node_views` est retiré, sa
--   policy neutralisée (`false`), comme `20261019140000` ;
-- - suppression d'un nœud : le retrait de la page qu'un envoi de fichier vient de créer (`undoCreation`,
--   `server/uploads-write.ts`), son auteur, jamais publiée (révision 0), seul `delete from platform.nodes` sous une
--   session ; les bornes de la structure (hors racine, `private` et Contextes) restent.
-- La page Activité (`/admin/usage`, `usage-statistics.ts`) ne lit pas `node_views`. Chaque policy est recréée sous son nom
-- (`check:migrations` refuse un `drop` sans recréation, ADR-006 § 2). Un seul bloc ROLLBACK en fin de fichier.

-- 1. `node_views`, lecture : ses propres lignes (`lastVisit`, et la ligne qu'avance `recordNodeView`).
DROP POLICY IF EXISTS node_views_select_member ON platform.node_views;
CREATE POLICY node_views_select_member ON platform.node_views FOR SELECT TO authenticated USING (((org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND (user_id = ( SELECT auth.uid() AS uid))));

-- 2. `node_views`, ajout : la personne pour elle-même, d'une page de son organisation qu'elle lit (`recordNodeView`).
DROP POLICY IF EXISTS node_views_insert_own ON platform.node_views;
CREATE POLICY node_views_insert_own ON platform.node_views FOR INSERT TO authenticated WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND (org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND (EXISTS ( SELECT 1
   FROM platform.nodes n
  WHERE ((n.id = node_views.node_id) AND (n.org_id = node_views.org_id) AND (platform.node_level_for(n.org_id, n.lpath, n.owner_kind, n.owner_team_id, n.owner_user_id) >= 1))))));

-- 3. `node_views`, avancée d'une vue (`on conflict do update` de `recordNodeView`) : sa ligne, d'une page qu'elle lit encore.
DROP POLICY IF EXISTS node_views_update_own ON platform.node_views;
CREATE POLICY node_views_update_own ON platform.node_views FOR UPDATE TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND (org_id IN ( SELECT platform.member_orgs() AS member_orgs)))) WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND (org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND (EXISTS ( SELECT 1
   FROM platform.nodes n
  WHERE ((n.id = node_views.node_id) AND (n.org_id = node_views.org_id) AND (platform.node_level_for(n.org_id, n.lpath, n.owner_kind, n.owner_team_id, n.owner_user_id) >= 1))))));

-- 4. `node_views`, suppression : aucune sous une session ; le ménage passe par `sweep_node_views`, la personne oubliée
--    ou retirée et la page purgée par les cascades.
REVOKE DELETE ON TABLE platform.node_views FROM authenticated;

DROP POLICY IF EXISTS node_views_delete_expired ON platform.node_views;
CREATE POLICY node_views_delete_expired ON platform.node_views FOR DELETE TO authenticated USING (false);

-- 5. Les comptes de vues de l'organisation (« Les plus consultés », `homeContents`), pour tout membre : sur les `p_days`
--    derniers jours, les `p_limit` pages vivantes les plus vues, puis celles qu'il lit, les plus vues d'abord ; ce que
--    faisait le service (les 300 premières, puis `nodeLevels`). Des comptes, jamais qui a vu. Le niveau est évalué une
--    fois par page retenue (`p_limit` au plus, environ 0,2 ms chacun), ni par ligne de vue, ni par page de l'organisation.
CREATE FUNCTION platform.node_view_counts(p_org uuid, p_days integer, p_limit integer) RETURNS TABLE(node_id uuid, views integer, last_at timestamp with time zone)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not coalesce(p_org in (select platform.member_orgs()), false) then
    raise exception 'the views of an organisation are counted for its members' using errcode = '42501';
  end if;
  if p_days is null or p_days < 1 or p_days > 90 then
    raise exception 'the window of the views is 1 to 90 days, not %', p_days using errcode = '22023';
  end if;
  return query
    with top as materialized (
      select c.node_id, c.views, c.last_at, n.lpath, n.owner_kind, n.owner_team_id, n.owner_user_id
        from (select v.node_id, sum(v.views)::int as views, max(v.last_at) as last_at
                from platform.node_views v
               where v.org_id = p_org and v.day >= current_date - p_days
               group by v.node_id) c
        join platform.nodes n on n.id = c.node_id and n.org_id = p_org and n.deleted_at is null
       order by c.views desc, c.node_id
       limit p_limit
    )
    select top.node_id, top.views, top.last_at
      from top
     where platform.node_level_for(p_org, top.lpath, top.owner_kind, top.owner_team_id, top.owner_user_id) >= 1
     order by top.views desc, top.node_id;
end;
$$;

REVOKE ALL ON FUNCTION platform.node_view_counts(p_org uuid, p_days integer, p_limit integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.node_view_counts(p_org uuid, p_days integer, p_limit integer) TO authenticated;

-- 6. Le ménage des vues de plus de 90 jours de l'organisation (`recordNodeView`), pour tout membre ; le délai fixé ici.
CREATE FUNCTION platform.sweep_node_views(p_org uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not coalesce(p_org in (select platform.member_orgs()), false) then
    raise exception 'the views of an organisation are swept by its members' using errcode = '42501';
  end if;
  delete from platform.node_views v where v.org_id = p_org and v.day < current_date - 90;
end;
$$;

REVOKE ALL ON FUNCTION platform.sweep_node_views(p_org uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.sweep_node_views(p_org uuid) TO authenticated;

-- 7. `nodes`, suppression : le retrait d'une création jamais publiée par son auteur (`undoCreation`) ; la corbeille se
--    purge par `purge_trash` et `erase_team_trash` (`20261021140000`).
DROP POLICY IF EXISTS nodes_delete_manager ON platform.nodes;
CREATE POLICY nodes_delete_manager ON platform.nodes FOR DELETE TO authenticated USING (((parent_id IS NOT NULL) AND (path <> 'private'::text) AND (NOT platform.is_context_path(org_id, path)) AND (org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND (revision = 0) AND (created_by = ( SELECT auth.uid() AS uid))));

-- ROLLBACK: (jamais exécuté depuis le paquet ; chaque policy reprend sa définition précédente, sous son nom)
--   nodes_delete_manager : drop, puis la définition de 20261021090000 (les deux branches de la corbeille) ;
--   drop function platform.sweep_node_views(uuid) ;
--   drop function platform.node_view_counts(uuid, integer, integer) ;
--   (et `server/node-views.ts`, `server/home-contents.ts` relisent et suppriment `node_views` sous la session) ;
--   grant delete on table platform.node_views to authenticated ;
--   node_views_delete_expired, node_views_update_own, node_views_insert_own, node_views_select_member : drop, puis la
--   définition de 20261020090000.
