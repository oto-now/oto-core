-- Le niveau exigé par les écritures des nœuds (base et portabilité, § Port de base ; suite de `20261019150000` et de
-- `20261020190000`, doctrine décidée par Alexis le 20/10). Ces écritures n'exigeaient que l'appartenance
-- (`member_orgs()`), le niveau étant décidé par le service : avec son seul jeton, sur un hôte qui exposerait `platform`,
-- tout membre réécrivait le titre d'une page qu'il ne fait que lire, la mettait à la corbeille, la datait de plus de
-- trente jours pour que la purge l'efface, la restaurait, la déplaçait ou la renommait, en changeait le propriétaire,
-- écrivait son brouillon, en créait, élargissait ou désactivait le lien public, supprimait une page vivante, rendait
-- brouillon un courriel simulé envoyé, et excluait un autre membre de l'entrée sans invitation. Chaque écriture reprend
-- la règle du service qui la fait, ni plus dure ni plus large, avec les fonctions d'aide de la base (`node_level_for`,
-- `is_org_admin`). Sous `platform_server`, qui hérite d'`authenticated` et lit les mêmes claims, la base juge la
-- personne de la requête. Les fonctions `security definer` qui écrivent un nœud à la place de la personne
-- (`publish_node`, `open_draft`, `discard_draft`, `duplicate_subtree`, `nodes_path_cascade`, `teams_tree_sync`) ne
-- passent ni par ces policies ni par le déclencheur.
--
-- Une seule policy de mise à jour couvre sur `nodes` des gestes de niveaux différents, et une policy ne voit pas
-- l'ancienne ligne : la renumérotation des frères (`positionAfter`) et la restauration d'un sous-arbre écrivent des
-- pages de tout niveau, la policy ne peut donc rien exiger de plus que l'appartenance. Les gestes sont jugés par une
-- fonction de déclencheur qui voit l'avant et l'après (`nodes_gesture_guard`), sous les deux sessions seulement (la
-- connexion d'administration et les fonctions `security definer` ne sont pas gardées), comme `expires_at_clock`
-- (`20261019130000`) : avant chaque ligne, le niveau sur la ligne d'avant (la ligne écrite ferait juger le
-- propriétaire qu'elle se donne) ; en fin d'instruction, la corbeille, dont la racine ne se reconnaît qu'à son parent
-- resté en place. Chaque policy est recréée sous son nom (`check:migrations` refuse un `drop` sans recréation, ADR-006
-- § 2). Restent hors de ce fichier : l'ajout d'un nœud et les blocs (`nodes_insert_writer`, `blocks_*_writer`), la
-- partie compte de `sim_outbox` (`accountLevelOf`, sans pendant en base), `accounts_update_admin` (aucun droit de mise à
-- jour pour `authenticated` ; sous le rôle du serveur, le jeton d'un compte se rafraîchit pour toute personne qui
-- l'emploie) et `invitations_select_admin` (le plafond des membres compte les invitations de toute l'organisation sous
-- la session d'un responsable). Un seul bloc ROLLBACK en fin de fichier.

-- 1. `nodes`, mise à jour : les gestes des services.
--    Avant chaque ligne :
--    - date de la corbeille : `null`, son ancienne valeur ou `now()`, pour tous (`trashNode`, `restoreNode`) : une
--      date passée ferait purger la page par le premier membre qui ouvre la corbeille ;
--    - déplacement (`moveNode` action `move`, et la remise en place de `restoreNode`) : la gestion (3) du nœud ;
--      changement de chemin sous le même parent (`followTitle`, `moveNode` action `rename`) : l'écriture (2) ; les deux,
--      l'écriture du parent d'arrivée (`destinationParent`, `restorePlace`) ;
--    - propriétaire (`transferOwner`, action `transfer`) : la gestion ;
--    - contenu (`title`, `summary`, `kind`, `status`, `revision`, `meta`, `created_at`, `updated_by`) : aucun service ne
--      l'écrit sous une session (`publish_node` est `security definer`), l'écriture comme `writeNode` ;
--    - `position` seule (`placeNode`, `positionAfter`) : rien de plus que l'appartenance, la renumérotation des frères
--      rangeant des pages de tout niveau.
--    En fin d'instruction :
--    - mise à la corbeille (`trashNode`, action `trash`) : la gestion du nœud dont le parent n'y entre pas avec lui, la
--      lecture (1) de ce qui part dessous (`trashPlan` refuse un sous-arbre qui cache une page) ;
--    - restauration (`restoreNode`, action `restore`) : la gestion du nœud dont le parent n'en sort pas avec lui ; ce
--      qui revient dessous, sans niveau.
--    Ce que la base ne distingue pas : un déplacement sous le même parent (`move`, gestion) d'un renommage (`rename`,
--    écriture), tous deux à l'écriture ; le nœud qu'on range, de ses frères renumérotés.
CREATE FUNCTION platform.nodes_gesture_guard() RETURNS trigger
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
  if tg_level = 'ROW' then
    if new.deleted_at is distinct from old.deleted_at and new.deleted_at <> now() then
      raise exception 'platform.nodes: the trash date of % is the clock of the database, now()', old.path
        using errcode = '42501';
    end if;
    if new.parent_id is distinct from old.parent_id
       or (new.owner_kind, new.owner_team_id, new.owner_user_id) is distinct from (old.owner_kind, old.owner_team_id, old.owner_user_id) then
      v_needed := 3;
    elsif new.path <> old.path
       or (new.title, new.summary, new.kind, new.status, new.revision, new.meta, new.created_at, new.updated_by)
          is distinct from (old.title, old.summary, old.kind, old.status, old.revision, old.meta, old.created_at, old.updated_by) then
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

CREATE TRIGGER nodes_guard_gesture BEFORE UPDATE ON platform.nodes FOR EACH ROW EXECUTE FUNCTION platform.nodes_gesture_guard();

CREATE TRIGGER nodes_guard_trash AFTER UPDATE ON platform.nodes REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION platform.nodes_gesture_guard();

-- 2. `nodes`, suppression : aucun service ne supprime un nœud sur sa gestion (la corbeille est une mise à jour). La purge
--    de la corbeille (`purgeTrash`, `server/nodes/trash.ts`, tout membre qui l'ouvre ou y met un contenu) : ce qui y
--    dort depuis plus de 30 jours (`TRASH_DAYS`), une rétention de l'organisation ; la clé du parent refuse un nœud dont
--    un descendant y est depuis moins longtemps. La suppression d'une équipe (`deleteTeam`, `requireAdmin`, qui efface
--    ses pages à la corbeille par `eraseTrashedNodes`) : l'administrateur, sur un nœud à la corbeille. Le retrait de la
--    page qu'un envoi de fichier vient de créer (`undoCreation`, `server/uploads-write.ts`) : son auteur, jamais publiée
--    (révision 0) ; « sans bloc » ne se lit pas ici (`blocks` lit `nodes` : 42P17), la cascade emporte ses brouillons.
DROP POLICY IF EXISTS nodes_delete_manager ON platform.nodes;
CREATE POLICY nodes_delete_manager ON platform.nodes FOR DELETE TO authenticated USING (((parent_id IS NOT NULL) AND (path <> 'private'::text) AND (NOT platform.is_context_path(org_id, path)) AND (org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND ((deleted_at < (now() - '30 days'::interval)) OR ((deleted_at IS NOT NULL) AND platform.is_org_admin(org_id)) OR ((revision = 0) AND (created_by = ( SELECT auth.uid() AS uid))))));

-- 3. `node_drafts`, modification de l'en-tête en attente : `writeNode` (`saveDraft`, `server/nodes/store.ts`), l'écriture
--    du nœud (`requireNodeLevel` action `write`, niveau 2).
DROP POLICY IF EXISTS node_drafts_update_writer ON platform.node_drafts;
CREATE POLICY node_drafts_update_writer ON platform.node_drafts FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM platform.nodes n
  WHERE ((n.id = node_drafts.node_id) AND (n.org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND (platform.node_level_for(n.org_id, n.lpath, n.owner_kind, n.owner_team_id, n.owner_user_id) >= 2))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM platform.nodes n
  WHERE ((n.id = node_drafts.node_id) AND (n.org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND (platform.node_level_for(n.org_id, n.lpath, n.owner_kind, n.owner_team_id, n.owner_user_id) >= 2)))));

-- 4. `node_shares`, création : `shareNode` (`server/shares.ts`, `managedNode`), la gestion du nœud (action `share`).
DROP POLICY IF EXISTS node_shares_insert_member ON platform.node_shares;
CREATE POLICY node_shares_insert_member ON platform.node_shares FOR INSERT TO authenticated WITH CHECK (((created_by = ( SELECT auth.uid() AS uid)) AND (org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND (revoked_at IS NULL) AND (EXISTS ( SELECT 1
   FROM platform.nodes n
  WHERE ((n.id = node_shares.node_id) AND (n.org_id = node_shares.org_id) AND (platform.node_level_for(n.org_id, n.lpath, n.owner_kind, n.owner_team_id, n.owner_user_id) >= 3))))));

-- 5. `node_shares`, modification d'un lien actif : `shareNode` (« Inclure les sous-contenus », qui en fait l'auteur), la
--    gestion du nœud ; `revokeShare`, l'administrateur pour tout lien (`isOrgAdmin`), sinon la gestion du nœud.
DROP POLICY IF EXISTS node_shares_update_member ON platform.node_shares;
CREATE POLICY node_shares_update_member ON platform.node_shares FOR UPDATE TO authenticated USING (((revoked_at IS NULL) AND (org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND (platform.is_org_admin(org_id) OR (EXISTS ( SELECT 1
   FROM platform.nodes n
  WHERE ((n.id = node_shares.node_id) AND (n.org_id = node_shares.org_id) AND (platform.node_level_for(n.org_id, n.lpath, n.owner_kind, n.owner_team_id, n.owner_user_id) >= 3))))))) WITH CHECK (((org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND (((revoked_at IS NOT NULL) AND platform.is_org_admin(org_id)) OR (((revoked_at IS NOT NULL) OR (created_by = ( SELECT auth.uid() AS uid))) AND (EXISTS ( SELECT 1
   FROM platform.nodes n
  WHERE ((n.id = node_shares.node_id) AND (n.org_id = node_shares.org_id) AND (platform.node_level_for(n.org_id, n.lpath, n.owner_kind, n.owner_team_id, n.owner_user_id) >= 3))))))));

-- 6. `sim_outbox`, envoi d'un brouillon simulé : `mail.send_draft` (`server/connectors/simulated/mail.ts`), un brouillon
--    encore brouillon, envoyé au nom de l'appelant. L'écriture du compte (`requireWriteAccess`, `accountLevelOf`) n'a pas
--    de pendant en base : elle reste à l'appartenance.
DROP POLICY IF EXISTS sim_outbox_update_writer ON platform.sim_outbox;
CREATE POLICY sim_outbox_update_writer ON platform.sim_outbox FOR UPDATE TO authenticated USING (((status = 'draft'::text) AND (org_id IN ( SELECT platform.member_orgs() AS member_orgs)))) WITH CHECK (((status = 'sent'::text) AND (sent_by = ( SELECT auth.uid() AS uid)) AND (org_id IN ( SELECT platform.member_orgs() AS member_orgs))));

-- 7. `member_exclusions`, ajout : `removeMember` (`server/members.ts`, `requireAdmin`), qui inscrit la personne retirée.
DROP POLICY IF EXISTS member_exclusions_insert_member ON platform.member_exclusions;
CREATE POLICY member_exclusions_insert_member ON platform.member_exclusions FOR INSERT TO authenticated WITH CHECK (((org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND (excluded_by = ( SELECT auth.uid() AS uid)) AND platform.is_org_admin(org_id)));

-- ROLLBACK: (jamais exécuté depuis le paquet ; chaque policy reprend sa définition d'avant, sous son nom)
--   drop policy member_exclusions_insert_member on platform.member_exclusions ;
--   create policy member_exclusions_insert_member on platform.member_exclusions for insert to authenticated
--     with check (((org_id in ( select platform.member_orgs() as member_orgs)) and (excluded_by = ( select auth.uid() as uid)))) ;
--   drop policy sim_outbox_update_writer on platform.sim_outbox ;
--   create policy sim_outbox_update_writer on platform.sim_outbox for update to authenticated
--     using ((org_id in ( select platform.member_orgs() as member_orgs)))
--     with check (((org_id in ( select platform.member_orgs() as member_orgs)) and ((sent_by is null) or (sent_by = ( select auth.uid() as uid))))) ;
--   drop policy node_shares_update_member on platform.node_shares ;
--   create policy node_shares_update_member on platform.node_shares for update to authenticated
--     using ((org_id in ( select platform.member_orgs() as member_orgs)))
--     with check (((org_id in ( select platform.member_orgs() as member_orgs)) and ((revoked_at is not null) or (created_by = ( select auth.uid() as uid))))) ;
--   drop policy node_shares_insert_member on platform.node_shares ;
--   create policy node_shares_insert_member … : la définition de la ligne de base (20260928100000), sans `node_level_for` ;
--   drop policy node_drafts_update_writer on platform.node_drafts ;
--   create policy node_drafts_update_writer … : la définition de la ligne de base, sans `node_level_for` ;
--   drop policy nodes_delete_manager on platform.nodes ;
--   create policy nodes_delete_manager … : la définition de 20260928120000, sans la dernière condition ;
--   drop trigger nodes_guard_trash on platform.nodes ;
--   drop trigger nodes_guard_gesture on platform.nodes ;
--   drop function platform.nodes_gesture_guard().
