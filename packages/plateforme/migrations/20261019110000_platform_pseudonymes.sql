-- La pseudonymisation des données servies à l'assistant (pseudonymisation, J2) : l'état de chaque organisation que le
-- paquet garde pour calculer ses jetons, et l'invalidation de son dictionnaire. Le dictionnaire lui-même vit en mémoire
-- du processus, jamais en base ; aucune personne n'est écrite ici. Un seul bloc ROLLBACK en fin de fichier.

-- 1. Une ligne par organisation, posée à son premier usage : la version de la clé maître, le sel de l'organisation
--    (d'où sa clé, `HMAC(clé maître, org | sel)`), le témoin de la clé maître (six octets de son empreinte : une clé
--    changée par erreur refuse tout au lieu de changer les jetons en silence), et la génération, qu'incrémente
--    l'invalidation. Aucun rôle de session ne lit la table : elle ne se lit que par les deux fonctions ci-dessous.
CREATE TABLE platform.pseudonym_orgs (
    org_id uuid NOT NULL,
    key_version integer DEFAULT 1 NOT NULL,
    salt text NOT NULL,
    witness text NOT NULL,
    generation bigint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pseudonym_orgs_pkey PRIMARY KEY (org_id),
    CONSTRAINT pseudonym_orgs_org_id_fkey FOREIGN KEY (org_id) REFERENCES platform.orgs(id) ON DELETE CASCADE,
    CONSTRAINT pseudonym_orgs_salt_check CHECK (char_length(salt) BETWEEN 16 AND 64),
    CONSTRAINT pseudonym_orgs_witness_check CHECK (char_length(witness) BETWEEN 4 AND 16)
);

ALTER TABLE platform.pseudonym_orgs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE platform.pseudonym_orgs FROM PUBLIC;
REVOKE ALL ON TABLE platform.pseudonym_orgs FROM anon;
REVOKE ALL ON TABLE platform.pseudonym_orgs FROM authenticated;

-- 2. `pseudonym_org` : l'état d'une organisation de l'appelant (membre, ou équipe plateforme pour le MCP admin), posé
--    au premier appel avec le sel et le témoin que le serveur propose, rendu tel qu'en base ensuite (le premier sel
--    gagne). Rend aussi le slug, que la source de l'hôte reçoit. Une organisation hors de portée lève 42501.
CREATE FUNCTION platform.pseudonym_org(p_org uuid, p_salt text, p_witness text)
RETURNS TABLE(slug text, key_version integer, salt text, witness text, generation bigint)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $$
begin
  if not (coalesce(p_org in (select platform.member_orgs()), false) or platform.is_staff()) then
    raise exception 'organisation not reachable' using errcode = '42501';
  end if;
  insert into platform.pseudonym_orgs (org_id, salt, witness)
    values (p_org, p_salt, p_witness)
    on conflict (org_id) do nothing;
  return query
    select o.slug, p.key_version, p.salt, p.witness, p.generation
      from platform.pseudonym_orgs p
      join platform.orgs o on o.id = p.org_id
     where p.org_id = p_org;
end;
$$;

REVOKE ALL ON FUNCTION platform.pseudonym_org(p_org uuid, p_salt text, p_witness text) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.pseudonym_org(p_org uuid, p_salt text, p_witness text) FROM anon;
GRANT EXECUTE ON FUNCTION platform.pseudonym_org(p_org uuid, p_salt text, p_witness text) TO authenticated;

-- 3. `invalidate_pseudonyms` : la génération d'une organisation de l'appelant avance d'un ; chaque instance la voit à
--    sa requête suivante et rebâtit son dictionnaire. Sans ligne (aucun jeton encore servi), rien à invalider.
CREATE FUNCTION platform.invalidate_pseudonyms(p_org uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $$
begin
  if not (coalesce(p_org in (select platform.member_orgs()), false) or platform.is_staff()) then
    raise exception 'organisation not reachable' using errcode = '42501';
  end if;
  update platform.pseudonym_orgs set generation = generation + 1 where org_id = p_org;
end;
$$;

REVOKE ALL ON FUNCTION platform.invalidate_pseudonyms(p_org uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.invalidate_pseudonyms(p_org uuid) FROM anon;
GRANT EXECUTE ON FUNCTION platform.invalidate_pseudonyms(p_org uuid) TO authenticated;

-- ROLLBACK: (jamais exécuté depuis le paquet)
--   drop function platform.invalidate_pseudonyms(uuid) ;
--   drop function platform.pseudonym_org(uuid, text, text) ;
--   drop table platform.pseudonym_orgs.
