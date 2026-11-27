-- Les connecteurs privés d'une organisation (connecteurs privés, § Stockage) : la définition d'un connecteur décrit en
-- données (profil Custom API de la lib de connecteurs), propre à une organisation, hors du catalogue de l'instance.
-- - `private_connectors` : un connecteur privé par espace servi (`namespace`, `custom_…`, unique dans l'organisation), sa
--   clé interne (`name`, `custom_<8 hex>`, unique dans l'instance : deux organisations peuvent nommer leur outil pareil
--   sans que l'une apprenne l'existence de l'autre), sa version servie (`version`, montée par oto à chaque
--   enregistrement), et son retrait (`removed_at`, nul tant qu'il est servi ; un connecteur retiré garde sa clé et son
--   historique, et un nouvel enregistrement sous le même espace le rouvre).
-- - `private_connector_versions` : chaque version enregistrée, en ajout seul (ni modification ni suppression sous une
--   session) : le document validé, la version dont elle est le retour (`restored_from`, nul pour un enregistrement), sa
--   date. Le document servi est celui de la version de `private_connectors.version`.
-- Lecture : les membres de l'organisation (la définition ne porte aucun secret). Écriture : sous le rôle du serveur
-- seulement (`platform_server`), une fois que le service a décidé (l'équipe plateforme, sur une organisation qu'elle
-- atteint : `member_orgs()` et `is_staff()`). Aucune colonne de personne : l'auteur de chaque version est au journal
-- d'administration. Rien n'est réécrit ; le paquet sans elles échoue sur l'administration d'un connecteur privé.

CREATE TABLE platform.private_connectors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    name text NOT NULL,
    namespace text NOT NULL,
    version integer NOT NULL,
    removed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT private_connectors_name_check CHECK ((name ~ '^custom_[0-9a-f]{8}$'::text)),
    CONSTRAINT private_connectors_namespace_check CHECK ((namespace ~ '^custom_[a-z0-9_]{1,33}$'::text)),
    CONSTRAINT private_connectors_version_check CHECK ((version >= 1))
);

COMMENT ON TABLE platform.private_connectors IS 'Connecteur privé d''une organisation (connecteurs privés) : espace servi, clé interne, version servie, retrait. Lu par les membres, écrit sous le rôle du serveur.';

ALTER TABLE ONLY platform.private_connectors
    ADD CONSTRAINT private_connectors_pkey PRIMARY KEY (id);

ALTER TABLE ONLY platform.private_connectors
    ADD CONSTRAINT private_connectors_name_key UNIQUE (name);

ALTER TABLE ONLY platform.private_connectors
    ADD CONSTRAINT private_connectors_org_id_namespace_key UNIQUE (org_id, namespace);

-- La cible de la clé composée des versions : une version reste dans l'organisation de son connecteur.
ALTER TABLE ONLY platform.private_connectors
    ADD CONSTRAINT private_connectors_id_org_id_key UNIQUE (id, org_id);

ALTER TABLE ONLY platform.private_connectors
    ADD CONSTRAINT private_connectors_org_id_fkey FOREIGN KEY (org_id) REFERENCES platform.orgs(id) ON DELETE CASCADE;

CREATE TABLE platform.private_connector_versions (
    private_connector_id uuid NOT NULL,
    org_id uuid NOT NULL,
    version integer NOT NULL,
    document jsonb NOT NULL,
    restored_from integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT private_connector_versions_version_check CHECK ((version >= 1)),
    CONSTRAINT private_connector_versions_document_check CHECK ((jsonb_typeof(document) = 'object'::text)),
    CONSTRAINT private_connector_versions_restored_from_check CHECK (((restored_from IS NULL) OR ((restored_from >= 1) AND (restored_from < version))))
);

COMMENT ON TABLE platform.private_connector_versions IS 'Versions d''un connecteur privé, en ajout seul : document validé, version reprise par un retour, date. Lues par les membres, écrites sous le rôle du serveur.';

ALTER TABLE ONLY platform.private_connector_versions
    ADD CONSTRAINT private_connector_versions_pkey PRIMARY KEY (private_connector_id, version);

ALTER TABLE ONLY platform.private_connector_versions
    ADD CONSTRAINT private_connector_versions_connector_fkey FOREIGN KEY (private_connector_id, org_id) REFERENCES platform.private_connectors(id, org_id) ON DELETE CASCADE;

ALTER TABLE ONLY platform.private_connector_versions
    ADD CONSTRAINT private_connector_versions_org_id_fkey FOREIGN KEY (org_id) REFERENCES platform.orgs(id) ON DELETE CASCADE;

CREATE INDEX idx_private_connector_versions_org_id ON platform.private_connector_versions USING btree (org_id);

ALTER TABLE platform.private_connectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.private_connector_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS private_connectors_select_member ON platform.private_connectors;
CREATE POLICY private_connectors_select_member ON platform.private_connectors FOR SELECT TO authenticated USING ((org_id IN ( SELECT platform.member_orgs() AS member_orgs)));

DROP POLICY IF EXISTS private_connectors_insert_staff ON platform.private_connectors;
CREATE POLICY private_connectors_insert_staff ON platform.private_connectors FOR INSERT TO platform_server WITH CHECK (((org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND platform.is_staff()));

DROP POLICY IF EXISTS private_connectors_update_staff ON platform.private_connectors;
CREATE POLICY private_connectors_update_staff ON platform.private_connectors FOR UPDATE TO platform_server USING (((org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND platform.is_staff())) WITH CHECK (((org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND platform.is_staff()));

DROP POLICY IF EXISTS private_connector_versions_select_member ON platform.private_connector_versions;
CREATE POLICY private_connector_versions_select_member ON platform.private_connector_versions FOR SELECT TO authenticated USING ((org_id IN ( SELECT platform.member_orgs() AS member_orgs)));

DROP POLICY IF EXISTS private_connector_versions_insert_staff ON platform.private_connector_versions;
CREATE POLICY private_connector_versions_insert_staff ON platform.private_connector_versions FOR INSERT TO platform_server WITH CHECK (((org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND platform.is_staff()));

-- Lecture par les membres ; écriture par le rôle du serveur seul, sur les seules colonnes que le service change : la
-- version servie et le retrait. Aucune suppression sous une session (l'organisation les emporte, `org delete`).
GRANT SELECT ON TABLE platform.private_connectors TO authenticated;
GRANT INSERT ON TABLE platform.private_connectors TO platform_server;
GRANT UPDATE(version,removed_at) ON TABLE platform.private_connectors TO platform_server;
GRANT SELECT ON TABLE platform.private_connector_versions TO authenticated;
GRANT INSERT ON TABLE platform.private_connector_versions TO platform_server;

-- ROLLBACK: (jamais exécuté depuis le paquet ; avec le paquet de la version précédente, qui ne lit pas ces tables)
--   drop table platform.private_connector_versions ; drop table platform.private_connectors.
