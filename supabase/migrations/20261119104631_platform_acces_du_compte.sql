-- L'accès d'un compte (connecteurs et comptes, § Plusieurs accès ; décidé par Alexis le 2026-11-19) : un connecteur
-- décrit peut s'ouvrir par plusieurs accès (le compte de service d'une organisation, la connexion d'une personne), et
-- chaque compte retient celui qui l'a ouvert, par lequel il se signe à chaque appel. Additif : deux colonnes nulles,
-- leurs contraintes et leurs droits ; aucune ligne n'est réécrite (un compte existant est celui d'un connecteur à un
-- seul accès, `access` nul). Un seul bloc ROLLBACK en fin de fichier.

-- 1. L'accès d'un compte : le nom d'un accès de la déclaration (`accesses`), exigé et contrôlé par le service pour un
--    connecteur à plusieurs accès, nul pour un connecteur à un seul ; la base ne connaît pas la déclaration, elle n'en
--    garde que la forme. Posé à la création du compte (saisie ou consentement), jamais changé : aucun rôle ne reçoit
--    le droit de le modifier ; passer d'un accès à l'autre, c'est connecter un autre compte.
ALTER TABLE platform.accounts ADD COLUMN access text;

ALTER TABLE platform.accounts ADD CONSTRAINT accounts_access_check CHECK ((access ~ '^[a-z][a-z0-9_]{0,39}$'::text));

GRANT SELECT(access),INSERT(access) ON TABLE platform.accounts TO authenticated;

-- 2. L'accès d'une demande de consentement : celui, à consentement, que la personne a choisi d'un connecteur à
--    plusieurs accès, que le retour donne au compte qu'il range ; nul pour un connecteur à un seul accès.
ALTER TABLE platform.connector_consents ADD COLUMN access text;

ALTER TABLE platform.connector_consents ADD CONSTRAINT connector_consents_access_check CHECK ((access ~ '^[a-z][a-z0-9_]{0,39}$'::text));

GRANT INSERT(access) ON TABLE platform.connector_consents TO authenticated;

-- ROLLBACK: (jamais exécuté depuis le paquet)
--   revoke insert(access) on platform.connector_consents from authenticated ;
--   alter table platform.connector_consents drop constraint connector_consents_access_check, drop column access ;
--   revoke select(access), insert(access) on platform.accounts from authenticated ;
--   alter table platform.accounts drop constraint accounts_access_check, drop column access.
