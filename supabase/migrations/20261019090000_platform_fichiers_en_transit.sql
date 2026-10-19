-- Le fichier en transit (fichiers et stockage, § Fichier en transit ; décision d'Alexis du 19/10) : un fichier qui passe
-- entre une personne et un connecteur, rattaché à aucun nœud, avec une échéance. Il n'est lisible que par la personne qui
-- l'a fait entrer, et par le moteur pendant le transfert, qui court sous son identité : ni l'organisation, ni une équipe,
-- ni un administrateur, ni l'équipe plateforme ne le lisent. Il compte au quota de l'organisation jusqu'à son échéance.
-- Un seul bloc ROLLBACK en fin de fichier.

-- 1. Une ligne sans nœud porte son échéance, une ligne jointe n'en a pas. `node_id` facultatif n'invalide aucune ligne
--    existante ; l'index sert la purge des échues de l'organisation.
ALTER TABLE platform.files ALTER COLUMN node_id DROP NOT NULL;

ALTER TABLE platform.files
    ADD COLUMN expires_at timestamp with time zone,
    ADD CONSTRAINT files_transit_check CHECK (((node_id IS NULL) = (expires_at IS NOT NULL)));

COMMENT ON TABLE platform.files IS 'Fichiers joints à un nœud (E10-S02, ADR-016), ou en transit (sans nœud, avec une échéance, lisibles par leur seul auteur) : métadonnées seulement ; objet sous la clé <org_id>/<id> du stockage S3 de l''hôte.';

CREATE INDEX idx_files_org_id_expires_at ON platform.files USING btree (org_id, expires_at) WHERE (node_id IS NULL);

-- 2. RLS : un fichier joint reste isolé par organisation (le service décide le droit sur son nœud) ; un fichier en transit
--    ne se lit, ne se modifie et ne se supprime que par son auteur. Il s'insère `pending`, attribué à l'appelant, avec
--    son échéance, que le service pose.
DROP POLICY IF EXISTS files_select_member ON platform.files;
CREATE POLICY files_select_member ON platform.files FOR SELECT TO authenticated USING (((org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND ((node_id IS NOT NULL) OR (created_by = ( SELECT auth.uid() AS uid)))));

DROP POLICY IF EXISTS files_insert_member ON platform.files;
CREATE POLICY files_insert_member ON platform.files FOR INSERT TO authenticated WITH CHECK (((created_by = ( SELECT auth.uid() AS uid)) AND (status = 'pending'::text) AND (org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND ((EXISTS ( SELECT 1
   FROM platform.nodes n
  WHERE ((n.id = files.node_id) AND (n.org_id = files.org_id)))) OR ((node_id IS NULL) AND (expires_at IS NOT NULL)))));

DROP POLICY IF EXISTS files_update_member ON platform.files;
CREATE POLICY files_update_member ON platform.files FOR UPDATE TO authenticated USING (((org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND ((node_id IS NOT NULL) OR (created_by = ( SELECT auth.uid() AS uid))))) WITH CHECK (((org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND ((node_id IS NOT NULL) OR (created_by = ( SELECT auth.uid() AS uid)))));

DROP POLICY IF EXISTS files_delete_member ON platform.files;
CREATE POLICY files_delete_member ON platform.files FOR DELETE TO authenticated USING (((org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND ((node_id IS NOT NULL) OR (created_by = ( SELECT auth.uid() AS uid)))));

GRANT INSERT(expires_at) ON TABLE platform.files TO authenticated;

-- 3. Le quota de l'organisation compte ce qu'aucun membre ne voit en entier sous la RLS : les fichiers en transit des
--    autres. `org_files_bytes` rend la somme des lignes `pending` et `ready`, jointes ou en transit non échues, d'une
--    organisation de l'appelant, et rien d'autre ; une organisation qui n'est pas la sienne lève 42501.
CREATE FUNCTION platform.org_files_bytes(p_org uuid) RETURNS bigint
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_bytes bigint;
begin
  if not coalesce(p_org in (select platform.member_orgs()), false) then
    raise exception 'organisation not reachable' using errcode = '42501';
  end if;
  select coalesce(sum(f.size), 0)::bigint into v_bytes
    from platform.files f
   where f.org_id = p_org and f.status in ('pending', 'ready')
     and (f.expires_at is null or f.expires_at > now());
  return v_bytes;
end
$$;

REVOKE ALL ON FUNCTION platform.org_files_bytes(p_org uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.org_files_bytes(p_org uuid) FROM anon;
GRANT EXECUTE ON FUNCTION platform.org_files_bytes(p_org uuid) TO authenticated;

-- 4. La purge des fichiers en transit échus d'une organisation de l'appelant, quel qu'en soit l'auteur (le paquet n'a pas
--    de tâche planifiée : elle court à chaque entrée en transit). Rend les seuls identifiants supprimés, dont le service
--    retire les objets après le commit ; aucune métadonnée d'un fichier d'un autre ne sort.
CREATE FUNCTION platform.purge_transit_files(p_org uuid) RETURNS SETOF uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not coalesce(p_org in (select platform.member_orgs()), false) then
    raise exception 'organisation not reachable' using errcode = '42501';
  end if;
  return query
    delete from platform.files f
     where f.org_id = p_org and f.node_id is null and f.expires_at <= now()
    returning f.id;
end
$$;

REVOKE ALL ON FUNCTION platform.purge_transit_files(p_org uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.purge_transit_files(p_org uuid) FROM anon;
GRANT EXECUTE ON FUNCTION platform.purge_transit_files(p_org uuid) TO authenticated;

-- ROLLBACK: (jamais exécuté depuis le paquet)
--   drop function platform.purge_transit_files(uuid) ; drop function platform.org_files_bytes(uuid) ;
--   delete from platform.files where node_id is null ; (objets sous <org_id>/<id> à retirer du bucket)
--   les quatre policies de `files` recréées telles que les écrit 20260930100000 ; revoke insert(expires_at) ;
--   drop index platform.idx_files_org_id_expires_at ; alter table platform.files drop constraint files_transit_check,
--   drop column expires_at ; alter table platform.files alter column node_id set not null ;
--   commentaire de la table remis à celui de 20260930100000.
