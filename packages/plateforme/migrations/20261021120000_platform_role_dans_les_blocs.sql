-- Le niveau exigé par l'écriture des blocs, et le dernier auteur d'un nœud (base et portabilité, § Port de base ; suite
-- de `20261021090000`, `20261021100000` et `20261021110000`, doctrine décidée par Alexis le 20/10). L'ajout, la
-- modification et la suppression dans `blocks` (`blocks_insert_writer`, `blocks_update_writer`, `blocks_delete_writer`)
-- n'exigeaient que l'appartenance, et pour un bloc de brouillon l'existence d'un brouillon : avec son seul jeton, sur un
-- hôte qui exposerait `platform`, tout membre ajoutait, réécrivait ou supprimait les lignes publiées d'un tableau qu'il
-- ne fait que lire, ou qui lui est caché, et écrivait le brouillon de n'importe quelle page. Et la base ne disait pas
-- qui pose le dernier auteur d'un nœud (`updated_by`) : un membre qui écrit une page pouvait y nommer un autre.
--
-- Chaque écriture reprend la règle du service qui la fait, ni plus dure ni plus large. Sous une session, les blocs
-- s'écrivent par deux services, tous deux à l'écriture (2) du nœud :
-- - les lignes publiées d'un tableau : `requireWrite` (`server/tables/output.ts`, `requireNodeLevel` action `write`),
--   avant `table.write`, `table.claim`, `table.release`, la revue, `table.delete_rows` et l'import
--   (`server/tables/write.ts`, `claim.ts`, `release.ts`, `review.ts`, `delete-rows.ts`, `import.ts`), qui écrivent par
--   `insertRow` et `updateRow` (`row-store.ts`), `writeDecision` et `deleteJudged` ; la purge des colonnes retirées d'un
--   tableau (`writePurge`, `server/tables/evolution-publish.ts`), après `requireNodeLevel` action `publish` (2) ;
-- - le brouillon d'une page : `saveDraft` (`server/nodes/store.ts` : `insertBlocks`, `writeUpdate`, `deleteBlocks`),
--   après `requireNodeLevel` action `write` (`server/nodes/write.ts`), ou dans la transaction d'une création, après
--   l'écriture du parent : la page neuve hérite de son propriétaire et de ses règles, donc de son niveau.
-- Un agent réserve et libère des lignes sous la session de la personne qui l'emploie (`context.db`). Sous
-- `platform_server`, qui hérite d'`authenticated` et lit les mêmes claims, la base juge la même personne. Les fonctions
-- `security definer` qui écrivent des blocs (`open_draft`, `publish_node`, `discard_draft`, `duplicate_subtree`,
-- `forget_user`), les cascades de la clé étrangère et la connexion d'administration (démo, outillage) ne passent pas
-- par ces policies.
--
-- Les trois policies gardent leur définition et exigent en plus l'écriture (2) du nœud du bloc, dans son organisation
-- (`node_level_for`, lu sur `nodes` comme `blocks_select_level` le lit déjà : aucune récursion) ; la mise à jour sur son
-- `using` comme sur son `with check`. Un membre simple touche zéro ligne (`using`) ou est refusé (42501, `with check`).
-- Chaque policy est recréée sous son nom (`check:migrations` refuse un `drop` sans recréation, ADR-006 § 2).
--
-- Le dernier auteur : chaque service qui l'écrit sous une session y met l'appelant (`insertNode`, `moveNode`,
-- `restoreNode`, `transferOwner` : `identity.user.id`, que la session porte en `sub`). La fonction des gestes d'un nœud
-- (`nodes_gesture_guard`, `20261021110000`) le vérifie sous les deux sessions : posé à l'ajout, ou changé, il vaut
-- `auth.uid()`. Un seul bloc ROLLBACK en fin de fichier.

-- 1. `blocks`, ajout : une ligne publiée d'un tableau (`insertRow`) ou un bloc du brouillon (`insertBlocks`), l'écriture du
--    nœud.
DROP POLICY IF EXISTS blocks_insert_writer ON platform.blocks;
CREATE POLICY blocks_insert_writer ON platform.blocks FOR INSERT TO authenticated WITH CHECK (((created_by = ( SELECT auth.uid() AS uid)) AND (org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND (((state = 'draft'::text) AND (type <> 'row'::text) AND (EXISTS ( SELECT 1
   FROM platform.node_drafts d
  WHERE (d.node_id = blocks.node_id)))) OR ((state = 'published'::text) AND (type = 'row'::text))) AND (EXISTS ( SELECT 1
   FROM platform.nodes n
  WHERE ((n.id = blocks.node_id) AND (n.org_id = blocks.org_id) AND (platform.node_level_for(n.org_id, n.lpath, n.owner_kind, n.owner_team_id, n.owner_user_id) >= 2))))));

-- 2. `blocks`, modification : une ligne (`updateRow`, `writeDecision`, `writePurge`) ou un bloc du brouillon
--    (`writeUpdate`), l'écriture du nœud, sur la ligne lue et sur la ligne écrite.
DROP POLICY IF EXISTS blocks_update_writer ON platform.blocks;
CREATE POLICY blocks_update_writer ON platform.blocks FOR UPDATE TO authenticated USING (((org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND (((state = 'draft'::text) AND (type <> 'row'::text)) OR ((state = 'published'::text) AND (type = 'row'::text))) AND (EXISTS ( SELECT 1
   FROM platform.nodes n
  WHERE ((n.id = blocks.node_id) AND (n.org_id = blocks.org_id) AND (platform.node_level_for(n.org_id, n.lpath, n.owner_kind, n.owner_team_id, n.owner_user_id) >= 2)))))) WITH CHECK (((org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND (((state = 'draft'::text) AND (type <> 'row'::text) AND (EXISTS ( SELECT 1
   FROM platform.node_drafts d
  WHERE (d.node_id = blocks.node_id)))) OR ((state = 'published'::text) AND (type = 'row'::text))) AND (EXISTS ( SELECT 1
   FROM platform.nodes n
  WHERE ((n.id = blocks.node_id) AND (n.org_id = blocks.org_id) AND (platform.node_level_for(n.org_id, n.lpath, n.owner_kind, n.owner_team_id, n.owner_user_id) >= 2))))));

-- 3. `blocks`, suppression : une ligne (`deleteJudged`) ou un bloc du brouillon (`deleteBlocks`), l'écriture du nœud.
DROP POLICY IF EXISTS blocks_delete_writer ON platform.blocks;
CREATE POLICY blocks_delete_writer ON platform.blocks FOR DELETE TO authenticated USING (((org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND (((state = 'draft'::text) AND (type <> 'row'::text)) OR ((state = 'published'::text) AND (type = 'row'::text))) AND (EXISTS ( SELECT 1
   FROM platform.nodes n
  WHERE ((n.id = blocks.node_id) AND (n.org_id = blocks.org_id) AND (platform.node_level_for(n.org_id, n.lpath, n.owner_kind, n.owner_team_id, n.owner_user_id) >= 2))))));

-- 4. La fonction des gestes d'un nœud, recréée sur son corps de `20261021110000`, avec son `search_path`, son propriétaire
--    et ses droits : le dernier auteur posé à l'ajout, ou changé par une mise à jour, vaut l'appelant (`auth.uid()`),
--    pour tous ; le reste à l'identique.
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

-- ROLLBACK: (jamais exécuté depuis le paquet ; chaque policy reprend sa définition de la ligne de base, sous son nom)
--   create or replace function platform.nodes_gesture_guard() … : le corps de 20261021110000 (sans les deux contrôles du
--     dernier auteur), même `search_path`, propriétaire et droits ;
--   drop policy blocks_delete_writer on platform.blocks ;
--   create policy blocks_delete_writer … : la définition de la ligne de base (20260928100000), sans le dernier `exists` ;
--   drop policy blocks_update_writer on platform.blocks ;
--   create policy blocks_update_writer … : la définition de la ligne de base, sans le dernier `exists` du `using` ni
--     celui du `with check` ;
--   drop policy blocks_insert_writer on platform.blocks ;
--   create policy blocks_insert_writer … : la définition de la ligne de base, sans le dernier `exists`.
