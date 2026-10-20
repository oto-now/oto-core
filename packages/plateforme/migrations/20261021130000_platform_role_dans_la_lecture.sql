-- Le niveau exigé par la lecture du contenu d'un nœud, et le dernier auteur d'un bloc (base et portabilité, § Port de
-- base ; suite de `20261021090000` à `20261021120000`, doctrine décidée par Alexis le 20/10). Les policies de lecture du
-- contenu n'exigeaient que l'appartenance : avec son seul jeton, sur un hôte qui exposerait `platform`, tout membre lisait
-- les blocs publiés, les versions, les liens sortants et les noms des fichiers joints d'une page qui lui est cachée
-- (l'espace personnel d'un autre, une page d'équipe fermée), le brouillon et son en-tête d'une page qu'il ne fait que
-- lire, et le jeton du lien public d'une page qu'il ne partage pas, qui ouvre la page et ses sous-pages hors session. Et
-- la base ne disait pas qui pose le dernier auteur d'un bloc : un membre qui écrit une page pouvait y nommer un autre.
--
-- Chaque lecture reprend la règle du service qui la fait, ni plus dure ni plus large :
-- - le contenu publié (blocs publiés, `node_versions`, `links`) : la lecture (1) du nœud, celle de `findNode` et
--   `lookupNode` (`server/nodes/lookup.ts`), des listes filtrées par `nodeLevels` (`server/access.ts` : arbre, vue,
--   recherche, accueil, nouveautés, liens entrants, contexte servi au MCP, procédures, export) et de `requireRead` des
--   tableaux ;
-- - le brouillon (blocs de brouillon, `node_drafts`) : l'écriture (2), celle de `loadDraft` derrière `level >= write`
--   (`server/nodes/read.ts`, `server/procedures.ts`) et de `requireNodeLevel` action `write` ; un bloc de brouillon se
--   lit quand son brouillon se lit (`node_drafts_select_writer`, niveau 2) ;
-- - les fichiers joints : la lecture du nœud (`readableFile`, `server/files/service.ts`), ou leur auteur ; ceux d'une
--   page à la corbeille restent lus par l'organisation, que la purge de la corbeille (`purgeTrash`, `eraseTrashedNodes`,
--   une rétention de l'organisation, sous la session de qui ouvre la corbeille) supprime en rendant leurs identifiants,
--   dont les objets partent ensuite du stockage ; un fichier en transit, son seul auteur, comme avant ;
-- - le lien public : la gestion (3) du nœud (`managedNode`, action `share`, `server/shares.ts` ; `activeShareAt` pour
--   `node.access`), ou l'administrateur, qui liste et désactive tous les liens (`listShares`, `revokeShare`).
-- Le titre et le résumé d'un nœud (`nodes_select_level`) restent lus par toute l'organisation : une décision à part,
-- pas prise. `node_aliases` (d'anciens chemins, de même nature que `nodes.path`) et `node_views` (qui a ouvert quelle
-- page, sans contenu) restent à l'appartenance : `lookupAlias` doit voir l'ancien chemin d'un nœud invisible pour le
-- refuser (AC15).
--
-- Les statistiques d'usage (`server/usage-statistics.ts`, l'administrateur seul) comptent le contenu écrit et publié de
-- toute l'organisation, espaces personnels compris, sans le nommer (D44) : sous la nouvelle règle, l'administrateur ne
-- lit plus les blocs ni les versions d'un espace personnel, et ses comptes seraient faux. Trois fonctions
-- `security definer` rendent ces agrégats, et eux seuls, à l'administrateur de l'organisation (`is_org_admin`, la règle
-- de `usage.ts`), sinon 42501.
--
-- Coût : `node_level_for` coûte environ 0,2 ms par appel. Laissé libre, le planificateur évalue une policy corrélée par
-- ligne ou une fois par nœud de l'organisation (sous-plan haché), et prend le haché pour une page de 50 blocs dans une
-- organisation de 2 000 nœuds (0,6 s par lecture). D'où deux formes, choisies par ce qu'on lit :
-- - les lignes d'un tableau (des milliers par lecture) ne se lisent que par un tableau (`blocks_guard`) : leur branche
--   est un `in` non corrélé sur les seuls tableaux lisibles, calculé une fois par instruction (un appel par tableau des
--   organisations de l'appelant), quelle que soit la taille de l'arbre ;
-- - le reste (blocs d'une page, brouillon, versions, liens, fichiers, liens publics) se lit nœud par nœud : la
--   sous-requête porte `offset 0`, qui la garde corrélée (pas de sous-plan haché) ; son coût suit le nombre de lignes
--   lues, jamais la taille de l'arbre.
-- Le planificateur compte chaque sous-requête corrélée pour chaque ligne parcourue, branches non prises comprises : JIT
-- actif (`jit`, `jit_above_cost`), une lecture de milliers de lignes peut être compilée (environ 20 ms, jusqu'à 300 ms
-- mesurés). Rien ici ne règle `jit`, un réglage de l'hôte.
--
-- Le dernier auteur d'un bloc : chaque service qui l'écrit sous une session y met l'appelant (`insertRow`, `updateRow`,
-- `writeDecision`, `writePurge`, `insertBlocks` et `writeUpdate` de `saveDraft` : `identity.user.id`, porté en `sub`) ;
-- l'ajout et la modification d'un bloc le vérifient (`updated_by` nul ou `auth.uid()`). Chaque policy est recréée sous
-- son nom (`check:migrations` refuse un `drop` sans recréation, ADR-006 § 2). Un seul bloc ROLLBACK en fin de fichier.

-- 1. `blocks`, lecture : un bloc publié, la lecture (1) de son nœud (une ligne, parmi les tableaux lisibles) ; un bloc de
--    brouillon, la lecture de son brouillon (`node_drafts_select_writer`, l'écriture du nœud).
DROP POLICY IF EXISTS blocks_select_level ON platform.blocks;
CREATE POLICY blocks_select_level ON platform.blocks FOR SELECT TO authenticated USING ((((state = 'published'::text) AND (((type = 'row'::text) AND (node_id IN ( SELECT n.id
   FROM platform.nodes n
  WHERE ((n.kind = 'table'::text) AND (platform.node_level_for(n.org_id, n.lpath, n.owner_kind, n.owner_team_id, n.owner_user_id) >= 1))))) OR ((type <> 'row'::text) AND (EXISTS ( SELECT 1
   FROM platform.nodes n
  WHERE ((n.id = blocks.node_id) AND (n.org_id = blocks.org_id) AND (n.kind <> 'table'::text) AND (platform.node_level_for(n.org_id, n.lpath, n.owner_kind, n.owner_team_id, n.owner_user_id) >= 1))
 OFFSET 0))))) OR ((state = 'draft'::text) AND (EXISTS ( SELECT 1
   FROM platform.node_drafts d
  WHERE (d.node_id = blocks.node_id)
 OFFSET 0)))));

-- 2. `node_drafts`, lecture : l'écriture (2) du nœud, celle de `loadDraft` (`read.ts`, `procedures.ts`, `write.ts`).
DROP POLICY IF EXISTS node_drafts_select_writer ON platform.node_drafts;
CREATE POLICY node_drafts_select_writer ON platform.node_drafts FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM platform.nodes n
  WHERE ((n.id = node_drafts.node_id) AND (n.org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND (platform.node_level_for(n.org_id, n.lpath, n.owner_kind, n.owner_team_id, n.owner_user_id) >= 2))
 OFFSET 0)));

-- 3. `node_versions`, lecture : la lecture (1) du nœud (les révisions de `read`, les nouveautés, le `ctx`).
DROP POLICY IF EXISTS node_versions_select_level ON platform.node_versions;
CREATE POLICY node_versions_select_level ON platform.node_versions FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM platform.nodes n
  WHERE ((n.id = node_versions.node_id) AND (platform.node_level_for(n.org_id, n.lpath, n.owner_kind, n.owner_team_id, n.owner_user_id) >= 1))
 OFFSET 0)));

-- 4. `links`, lecture : la lecture (1) du nœud source (liens sortants d'une page lue, liens entrants filtrés par
--    `nodeLevels`, liens des Contextes lus).
DROP POLICY IF EXISTS links_select_level ON platform.links;
CREATE POLICY links_select_level ON platform.links FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM platform.nodes n
  WHERE ((n.id = links.source_node_id) AND (n.org_id = links.org_id) AND (platform.node_level_for(n.org_id, n.lpath, n.owner_kind, n.owner_team_id, n.owner_user_id) >= 1))
 OFFSET 0)));

-- 5. `files`, lecture : son auteur ; un fichier joint, la lecture (1) de son nœud, ou son nœud à la corbeille (la purge).
DROP POLICY IF EXISTS files_select_member ON platform.files;
CREATE POLICY files_select_member ON platform.files FOR SELECT TO authenticated USING (((org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND ((created_by = ( SELECT auth.uid() AS uid)) OR ((node_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM platform.nodes n
  WHERE ((n.id = files.node_id) AND (n.org_id = files.org_id) AND ((n.deleted_at IS NOT NULL) OR (platform.node_level_for(n.org_id, n.lpath, n.owner_kind, n.owner_team_id, n.owner_user_id) >= 1)))
 OFFSET 0))))));

-- 6. `node_shares`, lecture : la gestion (3) du nœud, ou l'administrateur de l'organisation.
DROP POLICY IF EXISTS node_shares_select_member ON platform.node_shares;
CREATE POLICY node_shares_select_member ON platform.node_shares FOR SELECT TO authenticated USING (((org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND (platform.is_org_admin(org_id) OR (EXISTS ( SELECT 1
   FROM platform.nodes n
  WHERE ((n.id = node_shares.node_id) AND (n.org_id = node_shares.org_id) AND (platform.node_level_for(n.org_id, n.lpath, n.owner_kind, n.owner_team_id, n.owner_user_id) >= 3))
 OFFSET 0)))));

-- 7. `blocks`, ajout et modification : la définition de `20261021120000`, et le dernier auteur nul ou l'appelant.
DROP POLICY IF EXISTS blocks_insert_writer ON platform.blocks;
CREATE POLICY blocks_insert_writer ON platform.blocks FOR INSERT TO authenticated WITH CHECK (((created_by = ( SELECT auth.uid() AS uid)) AND ((updated_by IS NULL) OR (updated_by = ( SELECT auth.uid() AS uid))) AND (org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND (((state = 'draft'::text) AND (type <> 'row'::text) AND (EXISTS ( SELECT 1
   FROM platform.node_drafts d
  WHERE (d.node_id = blocks.node_id)))) OR ((state = 'published'::text) AND (type = 'row'::text))) AND (EXISTS ( SELECT 1
   FROM platform.nodes n
  WHERE ((n.id = blocks.node_id) AND (n.org_id = blocks.org_id) AND (platform.node_level_for(n.org_id, n.lpath, n.owner_kind, n.owner_team_id, n.owner_user_id) >= 2))))));

DROP POLICY IF EXISTS blocks_update_writer ON platform.blocks;
CREATE POLICY blocks_update_writer ON platform.blocks FOR UPDATE TO authenticated USING (((org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND (((state = 'draft'::text) AND (type <> 'row'::text)) OR ((state = 'published'::text) AND (type = 'row'::text))) AND (EXISTS ( SELECT 1
   FROM platform.nodes n
  WHERE ((n.id = blocks.node_id) AND (n.org_id = blocks.org_id) AND (platform.node_level_for(n.org_id, n.lpath, n.owner_kind, n.owner_team_id, n.owner_user_id) >= 2)))))) WITH CHECK (((org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND ((updated_by IS NULL) OR (updated_by = ( SELECT auth.uid() AS uid))) AND (((state = 'draft'::text) AND (type <> 'row'::text) AND (EXISTS ( SELECT 1
   FROM platform.node_drafts d
  WHERE (d.node_id = blocks.node_id)))) OR ((state = 'published'::text) AND (type = 'row'::text))) AND (EXISTS ( SELECT 1
   FROM platform.nodes n
  WHERE ((n.id = blocks.node_id) AND (n.org_id = blocks.org_id) AND (platform.node_level_for(n.org_id, n.lpath, n.owner_kind, n.owner_team_id, n.owner_user_id) >= 2))))));

-- 8. Les agrégats du contenu des statistiques d'usage (`readPeople`, `readOrgCounts`), pour l'administrateur de
--    l'organisation seul : les mêmes requêtes que le service, sans la RLS de lecture du contenu ; des comptes, des
--    origines et des identifiants de nœuds (que `nodes_select_level` montre déjà), jamais un texte.
CREATE FUNCTION platform.usage_authorship(p_org uuid, p_since timestamp with time zone, p_users uuid[], p_limit integer) RETURNS TABLE(user_id text, origin text, node_id uuid)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not platform.is_org_admin(p_org) then
    raise exception 'the usage statistics of an organisation are for its administrator' using errcode = '42501';
  end if;
  return query
    select distinct b.provenance ->> 'by', b.provenance ->> 'origin', b.node_id
      from platform.blocks b
     where b.org_id = p_org and b.state = 'published' and b.updated_at >= p_since
       and (p_users is null or b.provenance ->> 'by' = any(p_users::text[]))
     limit p_limit;
end;
$$;

REVOKE ALL ON FUNCTION platform.usage_authorship(p_org uuid, p_since timestamp with time zone, p_users uuid[], p_limit integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.usage_authorship(p_org uuid, p_since timestamp with time zone, p_users uuid[], p_limit integer) TO authenticated;

CREATE FUNCTION platform.usage_written(p_org uuid, p_since timestamp with time zone, p_users uuid[]) RETURNS TABLE(origin text, count integer)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not platform.is_org_admin(p_org) then
    raise exception 'the usage statistics of an organisation are for its administrator' using errcode = '42501';
  end if;
  return query
    select b.provenance ->> 'origin', count(*)::int
      from platform.blocks b
     where b.org_id = p_org and b.state = 'published' and b.updated_at >= p_since
       and (p_users is null or b.updated_by = any(p_users))
     group by 1;
end;
$$;

REVOKE ALL ON FUNCTION platform.usage_written(p_org uuid, p_since timestamp with time zone, p_users uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.usage_written(p_org uuid, p_since timestamp with time zone, p_users uuid[]) TO authenticated;

CREATE FUNCTION platform.usage_published_weeks(p_org uuid, p_since timestamp with time zone, p_users uuid[]) RETURNS TABLE(week text, count integer)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not platform.is_org_admin(p_org) then
    raise exception 'the usage statistics of an organisation are for its administrator' using errcode = '42501';
  end if;
  return query
    select to_char(date_trunc('week', v.created_at at time zone 'UTC'), 'YYYY-MM-DD'), count(*)::int
      from platform.node_versions v join platform.nodes n on n.id = v.node_id
     where n.org_id = p_org and v.created_at >= p_since and (p_users is null or v.author = any(p_users))
     group by 1;
end;
$$;

REVOKE ALL ON FUNCTION platform.usage_published_weeks(p_org uuid, p_since timestamp with time zone, p_users uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.usage_published_weeks(p_org uuid, p_since timestamp with time zone, p_users uuid[]) TO authenticated;

-- ROLLBACK: (jamais exécuté depuis le paquet ; chaque policy reprend sa définition précédente, sous son nom)
--   drop function platform.usage_published_weeks(uuid, timestamptz, uuid[]) ;
--   drop function platform.usage_written(uuid, timestamptz, uuid[]) ;
--   drop function platform.usage_authorship(uuid, timestamptz, uuid[], integer) ;
--   (et `server/usage-statistics.ts` relit `blocks` et `node_versions` sous la session) ;
--   blocks_insert_writer, blocks_update_writer : drop, puis la définition de 20261021120000 (sans le dernier auteur) ;
--   node_shares_select_member, node_versions_select_level, links_select_level, node_drafts_select_writer,
--   blocks_select_level : drop, puis la définition de la ligne de base (20260928100000) ;
--   files_select_member : drop, puis la définition de 20261019090000.
