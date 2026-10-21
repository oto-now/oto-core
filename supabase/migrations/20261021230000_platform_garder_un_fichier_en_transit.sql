-- Garder un fichier en transit sur une page (fichiers et stockage, § Garder un fichier en transit sur une page ; étape 3
-- du chantier « fichier », décidée par Alexis le 21/10) : `file.keep` insère un bloc média dans une page, et le fichier
-- y est joint, son échéance levée, sans copie. Les privilèges de `files` n'ouvrent aucune mise à jour de `node_id` ni
-- d'`expires_at` sous une session (seul `UPDATE(status)` est accordé) : le passage d'un état à l'autre vit ici, dans
-- une fonction `security definer`, qui refait la décision du service sans rien ouvrir d'autre.
--
-- `keep_transit_file(p_file, p_node)` joint la ligne au nœud et lève son échéance, dans une seule instruction, si :
-- l'appelant en est l'auteur, elle est en transit (`node_id` nul), `ready`, non échue (`expires_at > now()`), et le
-- nœud est de la même organisation, hors corbeille, n'est pas un tableau, et l'appelant l'écrit (`node_level_for` ≥ 2).
-- Sinon `42501`, sans dire lequel : le service a déjà rendu le refus qui le dit. La même instruction exclut une purge
-- concurrente (`expires_at <= now()`) et une consommation (`node_id is null`) : la ligne gardée n'est plus ni l'une ni
-- l'autre. Elle ne rend rien ; le service lit la ligne sous la RLS, désormais par la lecture du nœud. Le bloc qui montre
-- le fichier s'écrit dans la même transaction (`writeAtomically`) : un refus de l'écriture annule le rattachement.
-- Un seul bloc ROLLBACK en fin de fichier.

CREATE FUNCTION platform.keep_transit_file(p_file uuid, p_node uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  update platform.files f
     set node_id = n.id, expires_at = null
    from platform.nodes n
   where f.id = p_file
     and f.node_id is null
     and f.status = 'ready'
     and f.expires_at > now()
     and f.created_by = (select auth.uid())
     and f.org_id in (select platform.member_orgs())
     and n.id = p_node
     and n.org_id = f.org_id
     and n.deleted_at is null
     and n.kind <> 'table'
     and platform.node_level_for(n.org_id, n.lpath, n.owner_kind, n.owner_team_id, n.owner_user_id) >= 2;
  if not found then
    raise exception 'transit file not kept' using errcode = '42501';
  end if;
end
$$;

REVOKE ALL ON FUNCTION platform.keep_transit_file(p_file uuid, p_node uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.keep_transit_file(p_file uuid, p_node uuid) FROM anon;
GRANT ALL ON FUNCTION platform.keep_transit_file(p_file uuid, p_node uuid) TO authenticated;

-- ROLLBACK: (jamais exécuté depuis le paquet ; avec le paquet de la version précédente)
--   drop function platform.keep_transit_file(uuid, uuid).
