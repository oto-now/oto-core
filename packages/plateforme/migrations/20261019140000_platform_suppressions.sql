-- Les suppressions qu'aucun service ne fait sous une session (base et portabilité, § Port de base ; suite du lot 1 du
-- correctif des faits affirmés, décidée par Alexis le 19/10). Une policy de suppression n'exige que l'appartenance
-- (`member_orgs()`) : le rôle et la gestion sont décidés par le service. Là où aucun service ne supprime sous la session
-- d'une personne, ni sous le rôle du serveur qui hérite d'`authenticated`, le droit ne sert qu'à qui atteindrait
-- `platform` avec son seul jeton : tout membre, pas seulement un administrateur, supprimerait son organisation entière
-- par les cascades (sans retirer le stockage ni anonymiser le journal admin), un compte de connecteur ou l'activation
-- d'un connecteur. Une organisation et ses comptes se suppriment par `oto-platform org delete`, sur la connexion
-- d'administration ; une personne oubliée perd ses comptes par `forget_user` (`security definer`) ; un connecteur se
-- désactive par son état (`state = 'inactive'`), sans suppression. Le droit est retiré à `authenticated` (et donc à
-- `platform_server`), et la policy de suppression devenue sans objet est neutralisée (`false`) : une migration du
-- paquet ne retire pas une policy (`check:migrations`, ADR-006 § 2), la ligne de base suivante l'omettra. `anon` ne
-- supprime dans aucune table. Les droits qui restent sont la liste fermée de `tests/integration/role-du-serveur.test.ts`.
-- Un seul bloc ROLLBACK en fin de fichier.

-- 1. `orgs` : supprimée par `oto-platform org delete` seule (stockage d'abord, journal admin anonymisé).
REVOKE DELETE ON TABLE platform.orgs FROM authenticated;

DROP POLICY IF EXISTS orgs_delete_admin ON platform.orgs;
CREATE POLICY orgs_delete_admin ON platform.orgs FOR DELETE TO authenticated USING (false);

-- 2. `accounts` : supprimés par `org delete` et `forget_user`, jamais par une session.
REVOKE DELETE ON TABLE platform.accounts FROM authenticated;

DROP POLICY IF EXISTS accounts_delete_admin ON platform.accounts;
CREATE POLICY accounts_delete_admin ON platform.accounts FOR DELETE TO authenticated USING (false);

-- 3. `connector_activations` : une désactivation passe l'état à `inactive` (`deactivateConnector`) ; la ligne ne part
--    qu'avec son organisation.
REVOKE DELETE ON TABLE platform.connector_activations FROM authenticated;

DROP POLICY IF EXISTS connector_activations_delete_admin ON platform.connector_activations;
CREATE POLICY connector_activations_delete_admin ON platform.connector_activations FOR DELETE TO authenticated USING (false);

-- ROLLBACK: (jamais exécuté depuis le paquet)
--   drop policy connector_activations_delete_admin on platform.connector_activations ;
--   create policy connector_activations_delete_admin on platform.connector_activations for delete to authenticated
--     using ((org_id in ( select platform.member_orgs() as member_orgs))) ;
--   grant delete on table platform.connector_activations to authenticated ;
--   drop policy accounts_delete_admin on platform.accounts ;
--   create policy accounts_delete_admin on platform.accounts for delete to authenticated
--     using ((org_id in ( select platform.member_orgs() as member_orgs))) ;
--   grant delete on table platform.accounts to authenticated ;
--   drop policy orgs_delete_admin on platform.orgs ;
--   create policy orgs_delete_admin on platform.orgs for delete to authenticated
--     using ((id in ( select platform.member_orgs() as member_orgs))) ;
--   grant delete on table platform.orgs to authenticated.
