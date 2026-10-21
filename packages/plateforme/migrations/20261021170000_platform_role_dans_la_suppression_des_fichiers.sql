-- La suppression d'une ligne de fichier (base et portabilité, § Port de base ; suite de `20261021140000`, doctrine
-- décidée par Alexis le 20/10 ; issue #81). `files_delete_member` (`20261019090000`) laissait supprimer la ligne d'un
-- fichier joint à tout membre de l'organisation qui la voit, sans exiger l'écriture sur son nœud : avec son seul jeton,
-- sur un hôte qui exposerait `platform`, la lectrice d'une page d'équipe (niveau 1) effaçait la ligne d'un fichier qui
-- y est joint et laissait son objet orphelin dans le stockage. Aucun service ne le faisait : défense en profondeur.
--
-- Chaque suppression reprend la règle de son service, ni plus dure ni plus large :
-- - un fichier joint : l'écriture (2) de son nœud, celle qu'exige le service avant de le joindre (`requestFileUpload`,
--   `storeFile`) ; les suppressions sous une session sont celles d'un fichier que l'appelant vient d'envoyer à une page
--   qu'il écrit : sa ligne `pending` de taille fausse (`confirmObject`, `server/files/service.ts`) et les fichiers de la
--   page qu'il vient de créer, en révision 0 (`undoCreation`, `server/uploads-write.ts`) ; un fichier `ready` ne part
--   sinon qu'avec son nœud (cascade de `files.node_id`, purge de la corbeille par `purge_trash` et `erase_team_trash`) ;
-- - un fichier en transit : son seul auteur, comme avant (`expireTransitFile`, `server/files/transit.ts`) ; l'échu des
--   autres part par `purge_transit_files`.
-- La sous-requête porte `offset 0`, comme les policies de `20261021130000` : corrélée, son coût suit les lignes visées.
--
-- La purge des envois abandonnés (`purgePendingFiles`), une rétention de l'organisation que lance tout membre qui
-- demande un envoi ou ouvre la corbeille, comptait sur la policy large, et sous RLS ne voyait que les lignes que
-- l'appelant lit : un envoi abandonné sur une page qu'il ne lit pas restait, compté au quota. Elle passe par une
-- fonction `security definer`, sur le modèle de `purge_trash` : `purge_pending_files(org)`, membre de l'organisation
-- (`member_orgs`, accès plateforme en cours compris), sinon 42501 ; les lignes `pending` de plus d'une heure, délai
-- fixé ici, jamais passé par l'appelant : celles d'un fichier joint, sur toute page, lue ou non, et ses propres envois
-- en transit (ceux d'un autre, que la RLS lui cache, partent à leur échéance par `purge_transit_files`). Elle ne rend
-- que les identifiants, dont le service retire les objets après le commit ; aucun nom ni taille ne sort.
--
-- La policy est recréée sous son nom (`check:migrations` refuse un `drop` sans recréation, ADR-006 § 2). Un seul bloc
-- ROLLBACK en fin de fichier.

-- 1. `files`, suppression : un fichier joint, l'écriture (2) de son nœud ; un fichier en transit, son auteur.
DROP POLICY IF EXISTS files_delete_member ON platform.files;
CREATE POLICY files_delete_member ON platform.files FOR DELETE TO authenticated USING (((org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND (((node_id IS NULL) AND (created_by = ( SELECT auth.uid() AS uid))) OR ((node_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM platform.nodes n
  WHERE ((n.id = files.node_id) AND (n.org_id = files.org_id) AND (platform.node_level_for(n.org_id, n.lpath, n.owner_kind, n.owner_team_id, n.owner_user_id) >= 2))
 OFFSET 0))))));

-- 2. La purge des envois abandonnés de l'organisation (`purgePendingFiles`), pour un membre : les lignes `pending` de
--    plus d'une heure, jointes ou en transit de l'appelant.
CREATE FUNCTION platform.purge_pending_files(p_org uuid) RETURNS SETOF uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not coalesce(p_org in (select platform.member_orgs()), false) then
    raise exception 'the abandoned uploads of an organisation are purged by its members' using errcode = '42501';
  end if;
  return query
    delete from platform.files f
     where f.org_id = p_org and f.status = 'pending' and f.created_at < now() - interval '1 hour'
       and (f.node_id is not null or f.created_by = (select auth.uid()))
    returning f.id;
end;
$$;

REVOKE ALL ON FUNCTION platform.purge_pending_files(p_org uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.purge_pending_files(p_org uuid) TO authenticated;

-- ROLLBACK: (jamais exécuté depuis le paquet ; la policy reprend sa définition précédente, sous son nom)
--   drop function platform.purge_pending_files(uuid) ;
--   (et `server/files/service.ts` supprime les envois abandonnés sous la session, `PENDING_HOURS = 1`) ;
--   files_delete_member : drop, puis la définition de 20261019090000 (`node_id is not null or created_by = auth.uid()`).
