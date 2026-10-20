-- Le niveau exigé par la création d'un nœud, et les colonnes de `nodes` qu'une session écrit (base et portabilité,
-- § Port de base ; suite de `20261021090000` et de `20261021100000`, doctrine décidée par Alexis le 20/10). L'ajout dans
-- `nodes` n'exigeait que l'auteur, un parent et l'appartenance (`nodes_insert_writer`), et l'ajout comme la mise à jour
-- étaient accordés sur toutes les colonnes : avec son seul jeton, sur un hôte qui exposerait `platform`, tout membre
-- créait une page sous un parent qu'il ne fait que lire, ou qui lui est caché, s'en posait propriétaire (ce qui lui en
-- donnait la gestion), en choisissait l'identifiant, l'état, la révision, la date de corbeille, la date de création, les
-- métadonnées ou la position, changeait l'identifiant d'une page, et réécrivait le contenu (titre, résumé, genre, état,
-- révision, métadonnées, date de création) d'une page qu'il écrit, ce qu'aucun service ne fait sous une session.
--
-- Chaque écriture reprend la règle du service qui la fait, ni plus dure ni plus large. Le seul ajout dans `nodes` sous
-- une session est `create` (`server/nodes/write.ts`), qui exige l'écriture (2) du parent et écrit par `insertNode`
-- (`write-result.ts`) l'organisation, le parent, le chemin, le genre, le titre, le résumé, l'auteur et le dernier
-- auteur ; le propriétaire est hérité (nul), le reste prend sa valeur par défaut. Les mises à jour sous une session
-- n'écrivent que le parent et le chemin (`moveNode`, `restoreNode`), le propriétaire (`transferOwner`), le dernier auteur
-- (les trois), la position (`placeNode`, `positionAfter`) et la date de corbeille (`trashNode`, `restoreNode`) ;
-- `updated_at` est posé par déclencheur, le contenu par `publish_node` (`security definer`). Aucun `select … for update`
-- sur `nodes` sous une session. Sous `platform_server`, qui hérite d'`authenticated` sans droit propre sur `nodes`, la
-- base juge la personne de la requête. Les fonctions `security definer` qui écrivent un nœud (`duplicate_subtree`,
-- `org_skeleton`, `ensure_private_space`, `teams_tree_sync`, `nodes_path_cascade`, `publish_node`, `forget_user`)
-- passent sous leur propriétaire : ni ces droits ni le déclencheur ne les touchent.
--
-- Une policy de `nodes` ne relit pas `nodes` (42P17) : le niveau du parent se lit dans la fonction de déclencheur des
-- gestes (`nodes_gesture_guard`), étendue à l'ajout par un déclencheur avant chaque ligne (`nodes_guard_creation`), sous
-- les deux sessions seulement. Le propriétaire et la date de corbeille, nuls à la création, et tout ce que le service
-- n'écrit pas, ne s'accordent plus. La policy `nodes_insert_writer` est inchangée. Un seul bloc ROLLBACK en fin de
-- fichier.

-- 1. La fonction des gestes d'un nœud, recréée sur son corps de `20261021090000`, avec son `search_path`, son
--    propriétaire et ses droits :
--    - ajout (`create`) : l'écriture (2) du parent (`parent.level < ACCESS_LEVELS.write` refusé), lue sur le parent ; un
--      parent caché ou absent est refusé de même ;
--    - mise à jour : la branche du contenu ne garde que le dernier auteur, seule colonne de contenu encore accordée
--      (écrit seul, il signerait une page qu'on ne fait que lire) : l'écriture (2), comme avant ; le reste à l'identique.
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

-- 2. L'ajout, jugé avant chaque ligne (après `nodes_guard`, qui refuse un parent d'une autre organisation et complète le
--    genre d'un Contexte). Les tables de transition d'un déclencheur par instruction ne couvrent pas l'ajout et la mise à
--    jour à la fois : l'ajout n'a que ce déclencheur par ligne.
CREATE TRIGGER nodes_guard_creation BEFORE INSERT ON platform.nodes FOR EACH ROW EXECUTE FUNCTION platform.nodes_gesture_guard();

-- 3. Les colonnes accordées. L'ajout : celles d'`insertNode`. La mise à jour : celles des services nommés en tête ;
--    l'identifiant, le contenu, l'auteur, les dates de création et de mise à jour ne s'écrivent plus sous une session
--    (`created_by`, immuable sous `authenticated` seul dans `nodes_guard`, ne l'est plus pour personne).
REVOKE INSERT,UPDATE ON TABLE platform.nodes FROM authenticated;

GRANT INSERT(org_id,parent_id,path,kind,title,summary,created_by,updated_by) ON TABLE platform.nodes TO authenticated;

GRANT UPDATE(parent_id,path,owner_kind,owner_team_id,owner_user_id,updated_by,"position",deleted_at) ON TABLE platform.nodes TO authenticated;

-- ROLLBACK: (jamais exécuté depuis le paquet)
--   revoke insert, update on platform.nodes from authenticated ;
--   grant insert, update on platform.nodes to authenticated ;
--   drop trigger nodes_guard_creation on platform.nodes ;
--   create or replace function platform.nodes_gesture_guard() … : le corps de 20261021090000 (sans la branche de
--     l'ajout ; la branche du contenu sur `title`, `summary`, `kind`, `status`, `revision`, `meta`, `created_at` et
--     `updated_by`), même `search_path`, propriétaire et droits.
