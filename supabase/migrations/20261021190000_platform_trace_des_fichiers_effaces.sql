-- La trace d'un fichier en transit effacé (fichiers et stockage, § Adresse unique et lecture d'un fichier en transit ;
-- durée décidée par Alexis le 21/10) : la purge des échus (`purge_transit_files`) et la consommation (`expireTransitFile`)
-- suppriment la ligne, et rien ne distinguait plus un fichier effacé d'un identifiant faux. Son auteur, qui ouvre
-- `/f/<id>` ou le lit par `read {file}`, apprend désormais quand et pourquoi il est parti, et quoi faire, pendant 30 jours.
--
-- La trace ne garde que ce que dit le refus : l'identifiant, l'organisation, l'auteur, la date et la cause ; ni nom, ni
-- taille, ni type. Elle est hors quota (`org_files_bytes` ne lit que `files`) et lisible par son seul auteur. Elle naît
-- d'un déclencheur sur la suppression d'une ligne `ready` en transit, quel que soit le chemin (purge, consommation, ou
-- suppression directe par l'auteur sous la RLS) : aucune trace ne dépend de la discipline d'un service. Une ligne
-- `pending` (envoi abandonné, objet qui ne s'est pas écrit) n'a jamais été lisible : aucune trace. La date est
-- l'échéance pour un fichier échu (il est illisible depuis, même purgé plus tard), l'heure de la suppression sinon.
-- Une personne retirée de l'organisation, ou oubliée, emporte ses traces (clé vers `members`, en cascade), et aucune ne
-- naît pour elle ; l'organisation supprimée aussi. Les traces de plus de 30 jours partent avec la purge des échus, à
-- chaque entrée en transit (aucune tâche planifiée) ; d'ici là, le service ne lit que celles dont `keep_until` n'est
-- pas passé. La durée vit ici seule. Un seul bloc ROLLBACK en fin de fichier.

-- 1. La table.
CREATE TABLE platform.erased_files (
    id uuid NOT NULL,
    org_id uuid NOT NULL,
    created_by uuid NOT NULL,
    erased_at timestamp with time zone NOT NULL,
    cause text NOT NULL,
    keep_until timestamp with time zone NOT NULL,
    CONSTRAINT erased_files_cause_check CHECK ((cause = ANY (ARRAY['expired'::text, 'consumed'::text])))
);

COMMENT ON TABLE platform.erased_files IS 'Traces des fichiers en transit effacés (échus ou consommés) : identifiant, auteur, date et cause, lisibles par l''auteur seul, 30 jours.';

ALTER TABLE ONLY platform.erased_files
    ADD CONSTRAINT erased_files_pkey PRIMARY KEY (id);

ALTER TABLE ONLY platform.erased_files
    ADD CONSTRAINT erased_files_org_id_fkey FOREIGN KEY (org_id) REFERENCES platform.orgs(id) ON DELETE CASCADE;

ALTER TABLE ONLY platform.erased_files
    ADD CONSTRAINT erased_files_member_fkey FOREIGN KEY (org_id, created_by) REFERENCES platform.members(org_id, user_id) ON DELETE CASCADE;

-- La purge des traces de plus de 30 jours d'une organisation.
CREATE INDEX idx_erased_files_org_id_keep_until ON platform.erased_files USING btree (org_id, keep_until);

-- La cascade d'une personne retirée : sans lui, chaque retrait parcourrait la table.
CREATE INDEX idx_erased_files_org_id_created_by ON platform.erased_files USING btree (org_id, created_by);

ALTER TABLE platform.erased_files ENABLE ROW LEVEL SECURITY;

-- 2. RLS : l'auteur seul lit ses traces ; personne ne les écrit sous une session (le déclencheur les pose, la purge les
--    retire, tous deux `security definer`).
DROP POLICY IF EXISTS erased_files_select_own ON platform.erased_files;
CREATE POLICY erased_files_select_own ON platform.erased_files FOR SELECT TO authenticated USING (((created_by = ( SELECT auth.uid() AS uid)) AND (org_id IN ( SELECT platform.member_orgs() AS member_orgs))));

GRANT SELECT ON TABLE platform.erased_files TO authenticated;

-- 3. Le déclencheur : la suppression d'une ligne `ready` en transit laisse sa trace, si son auteur est encore membre
--    (une organisation supprimée n'a plus de membres : la cascade ne laisse rien).
CREATE FUNCTION platform.files_erased_trace() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_at timestamptz := least(old.expires_at, now());
begin
  if exists (select 1 from platform.members m join platform.orgs o on o.id = m.org_id
              where m.org_id = old.org_id and m.user_id = old.created_by) then
    insert into platform.erased_files (id, org_id, created_by, erased_at, cause, keep_until)
    values (old.id, old.org_id, old.created_by, v_at,
            case when old.expires_at <= now() then 'expired' else 'consumed' end,
            v_at + interval '30 days');
  end if;
  return old;
end
$$;

REVOKE ALL ON FUNCTION platform.files_erased_trace() FROM PUBLIC;

CREATE TRIGGER files_erased_trace AFTER DELETE ON platform.files FOR EACH ROW WHEN (((old.node_id IS NULL) AND (old.status = 'ready'::text) AND (old.created_by IS NOT NULL))) EXECUTE FUNCTION platform.files_erased_trace();

-- 4. La purge des échus retire aussi les traces de l'organisation dont les 30 jours sont passés ; le reste à l'identique
--    de `20261019090000`.
CREATE OR REPLACE FUNCTION platform.purge_transit_files(p_org uuid) RETURNS SETOF uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not coalesce(p_org in (select platform.member_orgs()), false) then
    raise exception 'organisation not reachable' using errcode = '42501';
  end if;
  delete from platform.erased_files e where e.org_id = p_org and e.keep_until <= now();
  return query
    delete from platform.files f
     where f.org_id = p_org and f.node_id is null and f.expires_at <= now()
    returning f.id;
end
$$;

REVOKE ALL ON FUNCTION platform.purge_transit_files(p_org uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.purge_transit_files(p_org uuid) FROM anon;
GRANT EXECUTE ON FUNCTION platform.purge_transit_files(p_org uuid) TO authenticated;

-- ROLLBACK: (jamais exécuté depuis le paquet ; avec le paquet de la version précédente)
--   purge_transit_files : la définition de 20261019090000 ;
--   drop trigger files_erased_trace on platform.files ; drop function platform.files_erased_trace() ;
--   drop table platform.erased_files.
