-- Le consentement d'une personne à un connecteur `oauth2_user` (connecteurs et comptes, § Consentement d'une
-- personne) : les demandes de consentement en cours, et les droits accordés d'un compte. Les jetons se rangent dans les
-- colonnes posées par 20261008090000 (`secret_ciphertext` : le jeton de rafraîchissement ; `token_ciphertext` et
-- `token_expires_at` : le jeton d'accès ; `status_reason` : un consentement à reconnecter). Un seul bloc ROLLBACK en fin
-- de fichier.

-- 1. Les droits qu'un tiers a accordés à un compte au dernier consentement ou renouvellement (`scope` de sa réponse de
--    jeton, sinon ceux que demandait la description), en clair : ce ne sont pas des secrets.
ALTER TABLE platform.accounts ADD COLUMN granted_scopes text[];

GRANT SELECT(granted_scopes),UPDATE(granted_scopes) ON TABLE platform.accounts TO authenticated;

-- 2. Une demande de consentement en cours : l'empreinte SHA-256 (hex) de son `state`, jamais le `state` ; la personne,
--    l'organisation et le connecteur auxquels il est lié ; l'écran de l'hôte où revenir. Dix minutes, une seule fois :
--    le retour la supprime en la lisant. La preuve PKCE se tire du `state` par la clé du coffre : rien d'autre ici.
CREATE TABLE platform.connector_consents (
    state_hash text NOT NULL,
    org_id uuid NOT NULL,
    user_id uuid NOT NULL,
    connector text NOT NULL,
    return_to text,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT connector_consents_state_hash_check CHECK ((state_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT connector_consents_return_to_check CHECK ((char_length(return_to) <= 500))
);

COMMENT ON TABLE platform.connector_consents IS 'Demandes de consentement d''une personne à un connecteur oauth2_user : empreinte SHA-256 du state, jamais le state ; 10 minutes, consommées une fois par le retour.';

ALTER TABLE ONLY platform.connector_consents
    ADD CONSTRAINT connector_consents_pkey PRIMARY KEY (state_hash);

ALTER TABLE ONLY platform.connector_consents
    ADD CONSTRAINT connector_consents_org_id_fkey FOREIGN KEY (org_id) REFERENCES platform.orgs(id) ON DELETE CASCADE;

ALTER TABLE ONLY platform.connector_consents
    ADD CONSTRAINT connector_consents_connector_fkey FOREIGN KEY (connector) REFERENCES platform.connectors(name) ON UPDATE CASCADE ON DELETE RESTRICT;

CREATE INDEX idx_connector_consents_org_id_expires_at ON platform.connector_consents USING btree (org_id, expires_at);

CREATE INDEX idx_connector_consents_connector ON platform.connector_consents USING btree (connector);

-- 3. RLS : la personne pose, lit et consomme ses propres demandes, dans une organisation dont elle est membre ; une
--    demande échue de l'organisation se purge par tout membre. Le service décide avant chaque requête.
ALTER TABLE platform.connector_consents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS connector_consents_select_own ON platform.connector_consents;
CREATE POLICY connector_consents_select_own ON platform.connector_consents FOR SELECT TO authenticated USING (((org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND ((user_id = ( SELECT auth.uid() AS uid)) OR (expires_at < now()))));

DROP POLICY IF EXISTS connector_consents_insert_own ON platform.connector_consents;
CREATE POLICY connector_consents_insert_own ON platform.connector_consents FOR INSERT TO authenticated WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND (org_id IN ( SELECT platform.member_orgs() AS member_orgs))));

DROP POLICY IF EXISTS connector_consents_delete_own_or_expired ON platform.connector_consents;
CREATE POLICY connector_consents_delete_own_or_expired ON platform.connector_consents FOR DELETE TO authenticated USING (((org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND ((user_id = ( SELECT auth.uid() AS uid)) OR (expires_at < now()))));

GRANT SELECT,DELETE ON TABLE platform.connector_consents TO authenticated;

GRANT INSERT(state_hash),INSERT(org_id),INSERT(user_id),INSERT(connector),INSERT(return_to),INSERT(expires_at) ON TABLE platform.connector_consents TO authenticated;

-- ROLLBACK: (jamais exécuté depuis le paquet)
--   drop table platform.connector_consents ;
--   alter table platform.accounts drop column granted_scopes.
