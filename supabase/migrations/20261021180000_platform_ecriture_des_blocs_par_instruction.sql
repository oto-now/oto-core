-- L'écriture des blocs jugée une fois par nœud et par instruction (base et portabilité, § Les droits dans le service, la
-- RLS pour l'isolation ; suite de
-- `20261021120000` et `20261021130000`). Les policies d'écriture de `blocks` évaluaient `node_level_for` (environ
-- 0,2 ms) pour chaque ligne écrite, et le brouillon de chaque ligne sous la policy de `node_drafts`, qui l'évalue
-- encore : la page de 1 000 blocs qu'un écran écrit en une instruction (`insertBlocks` de `saveDraft`) en faisait des
-- milliers, et dépassait le délai d'instruction d'une session (57014) dès que la base était chargée. Laissé libre, le
-- planificateur pouvait aussi évaluer le `exists` d'une modification sur tous les nœuds de l'organisation (sous-plan
-- haché), à chaque ligne de tableau écrite.
--
-- La garantie ne change pas : sous une session (`authenticated`, `platform_server`), toute instruction qui ajoute,
-- modifie ou supprime un bloc d'un nœud que l'appelant n'écrit pas (niveau 2) est refusée en entier (42501). Elle
-- passe des policies à un déclencheur d'instruction, `blocks_write_guard`, sur les lignes écrites (tables de
-- transition) : un appel de `node_level_for` par nœud distinct, quel que soit le nombre de lignes. Ce qui reste aux
-- policies :
-- - l'ajout : l'auteur, le dernier auteur, l'organisation et la forme (brouillon hors ligne, ligne publiée), sans
--   sous-requête. L'existence du brouillon est déjà exigée, avant la policy, par `blocks_lock_draft` (PT409) ;
-- - la modification et la suppression d'une ligne d'un tableau : l'écriture du tableau, sur la seule ligne (`offset 0`,
--   jamais le sous-plan haché), pour qu'un membre qui lit le tableau touche zéro ligne au lieu d'un refus. Ces écritures
--   vont ligne par ligne (`updateRow`, `writeDecision`, `writePurge`), sauf `deleteJudged` ;
-- - la modification et la suppression d'un bloc de brouillon : rien de plus. Une instruction qui lit ses lignes (un
--   filtre, un `returning`) ne voit que le brouillon d'une page qu'on écrit (`blocks_select_level`,
--   `node_drafts_select_writer`) : zéro ligne ; une instruction sans filtre est refusée par le déclencheur.
-- La modification ne change ni le nœud ni l'état d'un bloc (`blocks_guard`) : son `with check` garde la forme et le
-- dernier auteur. Un bloc supprimé avec son nœud (cascade) passe : le nœud n'est plus là, sa suppression a été jugée sur
-- `nodes`. Les fonctions `security definer`, les cascades d'une suppression faite par elles et la connexion
-- d'administration ne passent ni par les policies ni par le déclencheur (`current_user`). Chaque policy est recréée sous
-- son nom (`check:migrations` refuse un `drop` sans recréation). Un seul bloc ROLLBACK en fin de fichier.

-- 1. Le déclencheur : l'écriture (2) de chaque nœud des lignes écrites, une fois par instruction.
CREATE FUNCTION platform.blocks_write_guard() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_node record;
begin
  if current_user not in ('authenticated', 'platform_server') then
    return null;
  end if;
  for v_node in
    select c.node_id, n.path,
           platform.node_level_for(n.org_id, n.lpath, n.owner_kind, n.owner_team_id, n.owner_user_id) >= 2 as writes
      from (select distinct r.node_id from changed_rows r) c
      left join platform.nodes n on n.id = c.node_id
  loop
    -- un bloc supprimé avec son nœud (cascade) : le nœud n'est plus là
    if not coalesce(v_node.writes, false) and not (tg_op = 'DELETE' and v_node.path is null) then
      raise exception 'platform.blocks: row-level security, writing the blocks of % needs the level 2 on it',
        coalesce(v_node.path, v_node.node_id::text)
        using errcode = '42501';
    end if;
  end loop;
  return null;
end;
$$;

REVOKE ALL ON FUNCTION platform.blocks_write_guard() FROM PUBLIC;

DROP TRIGGER IF EXISTS blocks_write_guard_insert ON platform.blocks;
CREATE TRIGGER blocks_write_guard_insert AFTER INSERT ON platform.blocks REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION platform.blocks_write_guard();
DROP TRIGGER IF EXISTS blocks_write_guard_update ON platform.blocks;
CREATE TRIGGER blocks_write_guard_update AFTER UPDATE ON platform.blocks REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION platform.blocks_write_guard();
DROP TRIGGER IF EXISTS blocks_write_guard_delete ON platform.blocks;
CREATE TRIGGER blocks_write_guard_delete AFTER DELETE ON platform.blocks REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION platform.blocks_write_guard();

-- 2. `blocks`, ajout : l'auteur, le dernier auteur nul ou l'appelant, l'organisation, la forme.
DROP POLICY IF EXISTS blocks_insert_writer ON platform.blocks;
CREATE POLICY blocks_insert_writer ON platform.blocks FOR INSERT TO authenticated WITH CHECK (((created_by = ( SELECT auth.uid() AS uid)) AND ((updated_by IS NULL) OR (updated_by = ( SELECT auth.uid() AS uid))) AND (org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND (((state = 'draft'::text) AND (type <> 'row'::text)) OR ((state = 'published'::text) AND (type = 'row'::text)))));

-- 3. `blocks`, modification : un bloc de brouillon, ou une ligne d'un tableau qu'on écrit, prise ligne à ligne ; la
--    ligne écrite garde la forme et le dernier auteur.
DROP POLICY IF EXISTS blocks_update_writer ON platform.blocks;
CREATE POLICY blocks_update_writer ON platform.blocks FOR UPDATE TO authenticated USING (((org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND (((state = 'draft'::text) AND (type <> 'row'::text)) OR ((state = 'published'::text) AND (type = 'row'::text) AND (EXISTS ( SELECT 1
   FROM platform.nodes n
  WHERE ((n.id = blocks.node_id) AND (platform.node_level_for(n.org_id, n.lpath, n.owner_kind, n.owner_team_id, n.owner_user_id) >= 2))
 OFFSET 0)))))) WITH CHECK (((org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND ((updated_by IS NULL) OR (updated_by = ( SELECT auth.uid() AS uid))) AND (((state = 'draft'::text) AND (type <> 'row'::text)) OR ((state = 'published'::text) AND (type = 'row'::text)))));

-- 4. `blocks`, suppression : un bloc de brouillon, ou une ligne d'un tableau qu'on écrit, prise ligne à ligne.
DROP POLICY IF EXISTS blocks_delete_writer ON platform.blocks;
CREATE POLICY blocks_delete_writer ON platform.blocks FOR DELETE TO authenticated USING (((org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND (((state = 'draft'::text) AND (type <> 'row'::text)) OR ((state = 'published'::text) AND (type = 'row'::text) AND (EXISTS ( SELECT 1
   FROM platform.nodes n
  WHERE ((n.id = blocks.node_id) AND (platform.node_level_for(n.org_id, n.lpath, n.owner_kind, n.owner_team_id, n.owner_user_id) >= 2))
 OFFSET 0))))));

-- ROLLBACK: (jamais exécuté depuis le paquet ; chaque policy reprend sa définition précédente, sous son nom)
--   drop trigger blocks_write_guard_insert on platform.blocks ; drop trigger blocks_write_guard_update on platform.blocks ;
--   drop trigger blocks_write_guard_delete on platform.blocks ; drop function platform.blocks_write_guard() ;
--   blocks_insert_writer, blocks_update_writer : drop, puis la définition de 20261021130000 ;
--   blocks_delete_writer : drop, puis la définition de 20261021120000.
