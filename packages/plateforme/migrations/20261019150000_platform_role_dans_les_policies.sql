-- Le rôle exigé dans les policies d'administration (base et portabilité, § Port de base ; suite du lot 1 du correctif des
-- faits affirmés, décidée par Alexis le 19/10). Ces policies n'exigeaient que l'appartenance (`member_orgs()`), le rôle
-- étant décidé par le service : avec son seul jeton, sur un hôte qui exposerait `platform`, tout membre retirait des
-- membres, des équipes, des membres d'une équipe ou des adresses, et réglait son organisation (`settings.demo` compris).
-- Chaque policy reprend désormais la règle du service qui fait l'écriture, ni plus dure ni plus large, avec les
-- fonctions d'aide de la base (`is_org_admin`, `is_staff`) : un administrateur, ou un membre de l'équipe plateforme avec
-- un accès en cours, comme `isOrgAdmin`. Sous `platform_server`, qui hérite d'`authenticated` et lit les mêmes claims
-- (`auth.uid()`), la policy juge la personne de la requête : le rôle du serveur n'y gagne rien. La policy est recréée
-- sous son nom (`check:migrations` refuse un `drop` sans recréation, ADR-006 § 2). Restent hors de ce fichier, faute
-- d'une règle exprimable sans recopier le calcul du service : `access_rules_delete_manager` (la gestion d'un compte, que
-- calcule `accountLevelOf` seul) et `nodes_delete_manager` (le retrait d'une page créée par un envoi, borné par le
-- fichier que l'envoi a stocké). Un seul bloc ROLLBACK en fin de fichier.

-- 1. L'un des responsables d'une équipe, pour l'appelant : `leadsTeam` (`team_members.role`, la seule source des
--    responsables depuis E05-S13). `security definer` : lue depuis une policy de `team_members`, une sous-requête sur
--    `team_members` reviendrait sur la table dont Postgres développe les policies (42P17).
CREATE FUNCTION platform.leads_team(p_team uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select exists (select 1 from platform.team_members tm
                  where tm.team_id = p_team and tm.user_id = (select auth.uid()) and tm.role = 'lead')
$$;

REVOKE ALL ON FUNCTION platform.leads_team(p_team uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.leads_team(p_team uuid) TO authenticated;

-- 2. `members` : `removeMember` (`requireAdmin`), un administrateur, y compris pour se retirer lui-même.
DROP POLICY IF EXISTS members_delete_admin ON platform.members;
CREATE POLICY members_delete_admin ON platform.members FOR DELETE TO authenticated USING (((org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND platform.is_org_admin(org_id)));

-- 3. `teams` : `deleteTeam` (`requireAdmin`).
DROP POLICY IF EXISTS teams_delete_admin ON platform.teams;
CREATE POLICY teams_delete_admin ON platform.teams FOR DELETE TO authenticated USING (((org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND platform.is_org_admin(org_id)));

-- 4. `team_members` : `removeTeamMember` (`requireComposer`), un administrateur, ou l'un des responsables de l'équipe
--    qui n'en retire qu'un membre (`role = 'member'`, HN-E05S13-20).
DROP POLICY IF EXISTS team_members_delete_admin ON platform.team_members;
CREATE POLICY team_members_delete_admin ON platform.team_members FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM platform.teams t
  WHERE ((t.id = team_members.team_id) AND (t.org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND (platform.is_org_admin(t.org_id) OR ((team_members.role = 'member'::text) AND platform.leads_team(t.id)))))));

-- 5. `org_domains` : `removeHost` (`requireStaffAdmin`), un membre de l'équipe plateforme qui administre l'organisation.
DROP POLICY IF EXISTS org_domains_delete_admin ON platform.org_domains;
CREATE POLICY org_domains_delete_admin ON platform.org_domains FOR DELETE TO authenticated USING (((org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND platform.is_staff() AND platform.is_org_admin(org_id)));

-- 6. `orgs` : `updateOrg`, `updateBrand`, `setFlag`, `setOpenEntry` (`isOrgAdmin`), avant comme après l'écriture.
DROP POLICY IF EXISTS orgs_update_admin ON platform.orgs;
CREATE POLICY orgs_update_admin ON platform.orgs FOR UPDATE TO authenticated USING (((id IN ( SELECT platform.member_orgs() AS member_orgs)) AND platform.is_org_admin(id))) WITH CHECK (((id IN ( SELECT platform.member_orgs() AS member_orgs)) AND platform.is_org_admin(id)));

-- ROLLBACK: (jamais exécuté depuis le paquet)
--   drop policy orgs_update_admin on platform.orgs ;
--   create policy orgs_update_admin on platform.orgs for update to authenticated
--     using ((id in ( select platform.member_orgs() as member_orgs)))
--     with check ((id in ( select platform.member_orgs() as member_orgs))) ;
--   drop policy org_domains_delete_admin on platform.org_domains ;
--   create policy org_domains_delete_admin on platform.org_domains for delete to authenticated
--     using ((org_id in ( select platform.member_orgs() as member_orgs))) ;
--   drop policy team_members_delete_admin on platform.team_members ;
--   create policy team_members_delete_admin on platform.team_members for delete to authenticated
--     using ((exists ( select 1 from platform.teams t
--       where ((t.id = team_members.team_id) and (t.org_id in ( select platform.member_orgs() as member_orgs)))))) ;
--   drop policy teams_delete_admin on platform.teams ;
--   create policy teams_delete_admin on platform.teams for delete to authenticated
--     using ((org_id in ( select platform.member_orgs() as member_orgs))) ;
--   drop policy members_delete_admin on platform.members ;
--   create policy members_delete_admin on platform.members for delete to authenticated
--     using ((org_id in ( select platform.member_orgs() as member_orgs))) ;
--   drop function platform.leads_team(p_team uuid).
