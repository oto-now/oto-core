-- L'API de l'hôte d'une organisation (fonctions d'un hôte, § Source par organisation) : l'adresse `https` de l'API REST
-- propre à l'hôte, le document OpenAPI qu'elle sert à `<adresse>/openapi.json`, validé par le profil hôte de la lib de
-- connecteurs, sa version (`info.version`) et son `ETag`, la date du dernier rafraîchissement, et le dernier refus avec
-- ses problèmes. Une ligne par organisation, au plus.
-- - Servi : `address`, `document`, `version` et `served_at` vont ensemble (tout ou rien) ; `etag` n'existe qu'avec eux.
--   Le catalogue de l'organisation en tire ses fonctions de l'hôte.
-- - Refusé : `refused_address`, `refused_at` et `problems` (une liste JSON) vont ensemble. Un document refusé ne remplace
--   jamais celui qui est servi : la version précédente reste servie, et le refus se lit à l'administration.
-- Lecture : les membres de l'organisation (le catalogue se construit sous la session de qui appelle ; le document est
-- servi sans authentification par l'hôte, il n'a rien de secret). Écriture : l'équipe plateforme, sur une organisation
-- qu'elle atteint (`member_orgs()` et `is_staff()`), par l'opération d'administration. Aucune colonne de personne, aucun
-- secret.

CREATE TABLE platform.host_apis (
    org_id uuid NOT NULL,
    address text,
    document jsonb,
    version text,
    etag text,
    served_at timestamp with time zone,
    refreshed_at timestamp with time zone DEFAULT now() NOT NULL,
    refused_address text,
    refused_at timestamp with time zone,
    problems jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT host_apis_served_check CHECK ((((address IS NULL) = (document IS NULL)) AND ((document IS NULL) = (version IS NULL)) AND ((document IS NULL) = (served_at IS NULL)) AND ((etag IS NULL) OR (document IS NOT NULL)))),
    CONSTRAINT host_apis_refused_check CHECK ((((refused_at IS NULL) = (problems IS NULL)) AND ((refused_at IS NULL) = (refused_address IS NULL)))),
    CONSTRAINT host_apis_address_check CHECK ((((address IS NULL) OR ((char_length(address) <= 2000) AND (address ~ '^https://[^[:space:]]+$'))) AND ((refused_address IS NULL) OR ((char_length(refused_address) <= 2000) AND (refused_address ~ '^https://[^[:space:]]+$'))))),
    CONSTRAINT host_apis_document_check CHECK (((document IS NULL) OR (jsonb_typeof(document) = 'object'::text))),
    CONSTRAINT host_apis_version_check CHECK (((version IS NULL) OR ((char_length(version) >= 1) AND (char_length(version) <= 200)))),
    CONSTRAINT host_apis_etag_check CHECK (((etag IS NULL) OR (char_length(etag) <= 500))),
    CONSTRAINT host_apis_problems_check CHECK (((problems IS NULL) OR (jsonb_typeof(problems) = 'array'::text)))
);

COMMENT ON TABLE platform.host_apis IS 'API de l''hôte d''une organisation (fonctions d''un hôte) : adresse, document OpenAPI servi et validé, version, ETag, rafraîchissement, dernier refus et ses problèmes. Lue par les membres, écrite par l''équipe plateforme.';

ALTER TABLE ONLY platform.host_apis
    ADD CONSTRAINT host_apis_pkey PRIMARY KEY (org_id);

ALTER TABLE ONLY platform.host_apis
    ADD CONSTRAINT host_apis_org_id_fkey FOREIGN KEY (org_id) REFERENCES platform.orgs(id) ON DELETE CASCADE;

ALTER TABLE platform.host_apis ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS host_apis_select_member ON platform.host_apis;
CREATE POLICY host_apis_select_member ON platform.host_apis FOR SELECT TO authenticated USING ((org_id IN ( SELECT platform.member_orgs() AS member_orgs)));

DROP POLICY IF EXISTS host_apis_insert_staff ON platform.host_apis;
CREATE POLICY host_apis_insert_staff ON platform.host_apis FOR INSERT TO authenticated WITH CHECK (((org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND platform.is_staff()));

DROP POLICY IF EXISTS host_apis_update_staff ON platform.host_apis;
CREATE POLICY host_apis_update_staff ON platform.host_apis FOR UPDATE TO authenticated USING (((org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND platform.is_staff())) WITH CHECK (((org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND platform.is_staff()));

GRANT SELECT, INSERT, UPDATE ON TABLE platform.host_apis TO authenticated;

DROP TRIGGER IF EXISTS set_updated_at ON platform.host_apis;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON platform.host_apis FOR EACH ROW EXECUTE FUNCTION platform.set_updated_at();

-- ROLLBACK: (jamais exécuté depuis le paquet ; avec le paquet de la version précédente, qui ne lit pas la table)
--   drop table platform.host_apis.
