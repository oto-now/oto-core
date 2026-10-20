-- Le rôle exigé dans les policies d'ajout et de modification (base et portabilité, § Port de base ; suite de
-- `20261019150000`, qui l'exigeait des suppressions, décidée par Alexis le 20/10). Ces policies n'exigeaient que
-- l'appartenance (`member_orgs()`), le rôle étant décidé par le service : avec son seul jeton, sur un hôte qui exposerait
-- `platform`, tout membre promouvait un membre ou s'en promouvait lui-même, ajoutait une personne, invitait, révoquait
-- l'invitation d'un autre, créait ou renommait une équipe et s'en nommait responsable (`teams_lead_sync`), y entrait,
-- rattachait une adresse, posait une règle sur un nœud qu'il ne gère pas, créait un compte d'organisation ou le compte
-- personnel d'un autre, activait un connecteur, traitait un retour, révoquait un accès plateforme ; un membre de
-- l'équipe plateforme, sans administrer l'organisation, y accordait un accès. Chaque policy reprend désormais la règle du
-- service qui fait l'écriture, ni plus dure ni plus large, avec les fonctions d'aide de la base (`is_org_admin`,
-- `is_staff`, `leads_team`, `node_level_for`), sur son `using` comme sur son `with check`. Sous `platform_server`, qui
-- hérite d'`authenticated` et lit les mêmes claims, la policy juge la personne de la requête. Les fonctions `security
-- definer` qui écrivent à la place de la personne ne passent pas par ces policies : `accept_invitations` (membre et
-- équipe d'une invitation acceptée), `join_org` (entrée ouverte), `signup_org`, `create_org` et `org_skeleton` (première
-- organisation, organisation créée par l'équipe plateforme, avec son accès), `seat_org_admin` et `claim_org_admin`,
-- `teams_lead_sync` (le responsable nommé par `lead_user_id`). Chaque policy est recréée sous son nom (`check:migrations`
-- refuse un `drop` sans recréation, ADR-006 § 2). Restent hors de ce fichier : la partie compte d'`access_rules` (la
-- gestion d'un compte, que calcule `accountLevelOf` seul ; seul `manage`, réservé à l'administrateur, y est exigé) et ce
-- qu'une policy ne voit pas, l'ancienne valeur d'une colonne (une mise à jour qui changerait l'organisation ou la
-- personne d'une ligne reste à l'ayant droit, sur des lignes qu'il administre des deux côtés). Un seul bloc ROLLBACK en
-- fin de fichier.

-- 1. `platform_grants`, ajout : `grantAccess` (`server/admin/grants.ts`, `requireStaffAdmin`), un membre de l'équipe
--    plateforme qui administre l'organisation accorde l'accès à un collègue de l'équipe plateforme, en son nom.
DROP POLICY IF EXISTS platform_grants_insert_staff ON platform.platform_grants;
CREATE POLICY platform_grants_insert_staff ON platform.platform_grants FOR INSERT TO authenticated WITH CHECK (((org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND (granted_by = ( SELECT auth.uid() AS uid)) AND (revoked_at IS NULL) AND (revoked_by IS NULL) AND (EXISTS ( SELECT 1
   FROM platform.platform_staff s
  WHERE (s.user_id = platform_grants.user_id))) AND platform.is_staff() AND platform.is_org_admin(org_id)));

-- 2. `platform_grants`, révocation : `revokePlatformAccess` (`server/members.ts`, `requireAccessManager`), un
--    administrateur ou un membre de l'équipe plateforme, en son nom.
DROP POLICY IF EXISTS platform_grants_update_revoke ON platform.platform_grants;
CREATE POLICY platform_grants_update_revoke ON platform.platform_grants FOR UPDATE TO authenticated USING (((revoked_at IS NULL) AND (org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND (platform.is_org_admin(org_id) OR platform.is_staff()))) WITH CHECK (((revoked_at IS NOT NULL) AND (revoked_by = ( SELECT auth.uid() AS uid)) AND (platform.is_org_admin(org_id) OR platform.is_staff())));

-- 3. `members`, ajout : aucun service n'ajoute un membre sous la session de la personne (invitation acceptée, entrée
--    ouverte, première organisation et premier administrateur passent par des fonctions `security definer`) ; une
--    écriture directe reste à l'administrateur, comme le nom de la policy.
DROP POLICY IF EXISTS members_insert_admin ON platform.members;
CREATE POLICY members_insert_admin ON platform.members FOR INSERT TO authenticated WITH CHECK (((org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND platform.is_org_admin(org_id)));

-- 4. `members`, modification : `updateMember` (`server/members.ts`, `requireAdmin`), un administrateur change un rôle,
--    avant comme après l'écriture (une ligne ne passe pas dans une organisation que l'appelant n'administre pas).
DROP POLICY IF EXISTS members_update_admin ON platform.members;
CREATE POLICY members_update_admin ON platform.members FOR UPDATE TO authenticated USING (((org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND platform.is_org_admin(org_id))) WITH CHECK (((org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND platform.is_org_admin(org_id)));

-- 5. `invitations`, ajout : `inviteMember` (`server/invitations.ts`, `invitationOptions`), un administrateur, aux deux
--    rôles, avec ou sans équipe ; l'un des responsables d'une équipe, au rôle `member`, dans une équipe qu'il dirige.
DROP POLICY IF EXISTS invitations_insert_admin ON platform.invitations;
CREATE POLICY invitations_insert_admin ON platform.invitations FOR INSERT TO authenticated WITH CHECK (((invited_by = ( SELECT auth.uid() AS uid)) AND (org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND ((team_id IS NULL) OR (EXISTS ( SELECT 1
   FROM platform.teams t
  WHERE ((t.id = invitations.team_id) AND (t.org_id = invitations.org_id))))) AND (platform.is_org_admin(org_id) OR ((role = 'member'::text) AND (team_id IS NOT NULL) AND platform.leads_team(team_id)))));

-- 6. `invitations`, révocation : `revokeInvitation` (`server/invitations.ts`), son émetteur ou un administrateur ; le
--    retrait d'une invitation dont l'email n'est pas parti (`withdraw`) est celui de son émetteur.
DROP POLICY IF EXISTS invitations_update_revoke ON platform.invitations;
CREATE POLICY invitations_update_revoke ON platform.invitations FOR UPDATE TO authenticated USING (((accepted_at IS NULL) AND (declined_at IS NULL) AND (revoked_at IS NULL) AND (org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND ((invited_by = ( SELECT auth.uid() AS uid)) OR platform.is_org_admin(org_id)))) WITH CHECK (((revoked_at IS NOT NULL) AND (accepted_at IS NULL) AND (declined_at IS NULL) AND (org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND ((invited_by = ( SELECT auth.uid() AS uid)) OR platform.is_org_admin(org_id))));

-- 7. `teams`, ajout : `createTeam` (`server/teams.ts`, `requireAdmin`).
DROP POLICY IF EXISTS teams_insert_admin ON platform.teams;
CREATE POLICY teams_insert_admin ON platform.teams FOR INSERT TO authenticated WITH CHECK (((org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND platform.is_org_admin(org_id)));

-- 8. `teams`, modification : `updateTeam` (`server/teams.ts`, `requireAdmin`) ; `lead_user_id`, dont `teams_lead_sync`
--    fait un responsable, est aussi à l'administrateur.
DROP POLICY IF EXISTS teams_update_admin ON platform.teams;
CREATE POLICY teams_update_admin ON platform.teams FOR UPDATE TO authenticated USING (((org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND platform.is_org_admin(org_id))) WITH CHECK (((org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND platform.is_org_admin(org_id)));

-- 9. `team_members`, ajout : `addTeamMember` (`server/teams.ts`, `requireComposer`), un administrateur, ou l'un des
--    responsables de l'équipe qui y ajoute un membre ; le responsable nommé par `createTeam` et `updateTeam`
--    (`setSoleLead`), un administrateur.
DROP POLICY IF EXISTS team_members_insert_admin ON platform.team_members;
CREATE POLICY team_members_insert_admin ON platform.team_members FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM (platform.teams t
     JOIN platform.members m ON (((m.org_id = t.org_id) AND (m.user_id = team_members.user_id))))
  WHERE ((t.id = team_members.team_id) AND (t.org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND (platform.is_org_admin(t.org_id) OR ((team_members.role = 'member'::text) AND platform.leads_team(t.id)))))));

-- 10. `team_members`, modification : `setTeamMemberRole` et `setSoleLead` (`server/teams.ts`, `requireAdmin`).
DROP POLICY IF EXISTS team_members_update_admin ON platform.team_members;
CREATE POLICY team_members_update_admin ON platform.team_members FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM platform.teams t
  WHERE ((t.id = team_members.team_id) AND (t.org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND platform.is_org_admin(t.org_id))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM (platform.teams t
     JOIN platform.members m ON (((m.org_id = t.org_id) AND (m.user_id = team_members.user_id))))
  WHERE ((t.id = team_members.team_id) AND (t.org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND platform.is_org_admin(t.org_id)))));

-- 11. `org_domains`, ajout : `addHost` (`server/admin/hosts.ts`, `requireStaffAdmin`), un membre de l'équipe plateforme
--     qui administre l'organisation.
DROP POLICY IF EXISTS org_domains_insert_admin ON platform.org_domains;
CREATE POLICY org_domains_insert_admin ON platform.org_domains FOR INSERT TO authenticated WITH CHECK (((org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND platform.is_staff() AND platform.is_org_admin(org_id)));

-- 12. `access_rules`, ajout, modification et retrait : `setNodeRule`, `setGeneralAccess` et `removeRule`
--     (`server/rules.ts`, `server/general-access.ts`), la gestion du nœud (`share`, niveau 3, que calcule
--     `node_level_for`) ; `setNodeRule`, `setGeneralAccess` et `setAccountRule`, le niveau `manage` réservé à
--     l'administrateur. Une règle d'un compte reste à l'appartenance pour le reste : la gestion d'un compte
--     (`accountLevelOf`) n'a pas de pendant en base.
DROP POLICY IF EXISTS access_rules_insert_manager ON platform.access_rules;
CREATE POLICY access_rules_insert_manager ON platform.access_rules FOR INSERT TO authenticated WITH CHECK (((created_by = ( SELECT auth.uid() AS uid)) AND (org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND (((node_id IS NOT NULL) AND (org_id = ( SELECT n.org_id
   FROM platform.nodes n
  WHERE (n.id = access_rules.node_id)))) OR ((account_id IS NOT NULL) AND (org_id = ( SELECT a.org_id
   FROM platform.accounts a
  WHERE (a.id = access_rules.account_id))))) AND (((subject_team_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM platform.teams t
  WHERE ((t.id = access_rules.subject_team_id) AND (t.org_id = access_rules.org_id))))) OR ((subject_user_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM platform.members m
  WHERE ((m.user_id = access_rules.subject_user_id) AND (m.org_id = access_rules.org_id))))) OR subject_org) AND ((level <> 'manage'::text) OR platform.is_org_admin(org_id)) AND ((node_id IS NULL) OR (EXISTS ( SELECT 1
   FROM platform.nodes n
  WHERE ((n.id = access_rules.node_id) AND (platform.node_level_for(n.org_id, n.lpath, n.owner_kind, n.owner_team_id, n.owner_user_id) >= 3)))))));

DROP POLICY IF EXISTS access_rules_update_manager ON platform.access_rules;
CREATE POLICY access_rules_update_manager ON platform.access_rules FOR UPDATE TO authenticated USING (((org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND ((node_id IS NULL) OR (EXISTS ( SELECT 1
   FROM platform.nodes n
  WHERE ((n.id = access_rules.node_id) AND (platform.node_level_for(n.org_id, n.lpath, n.owner_kind, n.owner_team_id, n.owner_user_id) >= 3))))))) WITH CHECK (((org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND ((level <> 'manage'::text) OR platform.is_org_admin(org_id)) AND ((node_id IS NULL) OR (EXISTS ( SELECT 1
   FROM platform.nodes n
  WHERE ((n.id = access_rules.node_id) AND (platform.node_level_for(n.org_id, n.lpath, n.owner_kind, n.owner_team_id, n.owner_user_id) >= 3)))))));

DROP POLICY IF EXISTS access_rules_delete_manager ON platform.access_rules;
CREATE POLICY access_rules_delete_manager ON platform.access_rules FOR DELETE TO authenticated USING (((org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND ((node_id IS NULL) OR (EXISTS ( SELECT 1
   FROM platform.nodes n
  WHERE ((n.id = access_rules.node_id) AND (platform.node_level_for(n.org_id, n.lpath, n.owner_kind, n.owner_team_id, n.owner_user_id) >= 3)))))));

-- 13. `accounts`, ajout d'un compte d'organisation ou d'équipe : `createAccount` (`server/connectors/accounts.ts`,
--     `requireCreationRight`, sous `platform_server`), un administrateur ; pour une équipe de l'organisation, aussi l'un
--     de ses responsables. Le compte personnel de l'appelant reste à `accounts_insert_own`.
DROP POLICY IF EXISTS accounts_insert_admin ON platform.accounts;
CREATE POLICY accounts_insert_admin ON platform.accounts FOR INSERT TO authenticated WITH CHECK (((org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND (((owner_kind = 'org'::text) AND platform.is_org_admin(org_id)) OR ((owner_kind = 'team'::text) AND (EXISTS ( SELECT 1
   FROM platform.teams t
  WHERE ((t.id = accounts.owner_team_id) AND (t.org_id = accounts.org_id) AND (platform.is_org_admin(t.org_id) OR platform.leads_team(t.id)))))))));

-- 14. `connector_activations` : `activateConnector` (sous `platform_server`) et `deactivateConnector`
--     (`server/connectors/activations.ts`, `checkedConnector`), un administrateur, en son nom à l'activation.
DROP POLICY IF EXISTS connector_activations_insert_admin ON platform.connector_activations;
CREATE POLICY connector_activations_insert_admin ON platform.connector_activations FOR INSERT TO authenticated WITH CHECK (((org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND (activated_by = ( SELECT auth.uid() AS uid)) AND platform.is_org_admin(org_id)));

DROP POLICY IF EXISTS connector_activations_update_admin ON platform.connector_activations;
CREATE POLICY connector_activations_update_admin ON platform.connector_activations FOR UPDATE TO authenticated USING (((org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND platform.is_org_admin(org_id))) WITH CHECK (((org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND platform.is_org_admin(org_id)));

-- 15. `feedback` : `setFeedbackState` (`server/feedback.ts`, `handlesFeedback`), un administrateur de l'organisation,
--     de l'équipe plateforme ou, l'option « Retours visibles » allumée (`orgs.flags`, `feedback_visible` à `true`,
--     1.4.13), du client, en son nom (une décision effacée n'a plus d'auteur).
DROP POLICY IF EXISTS feedback_update_admin ON platform.feedback;
CREATE POLICY feedback_update_admin ON platform.feedback FOR UPDATE TO authenticated USING (((org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND platform.is_org_admin(org_id) AND (platform.is_staff() OR (EXISTS ( SELECT 1 FROM platform.orgs o WHERE ((o.id = feedback.org_id) AND (o.flags @> '{"feedback_visible": true}'::jsonb))))))) WITH CHECK (((org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND platform.is_org_admin(org_id) AND (platform.is_staff() OR (EXISTS ( SELECT 1 FROM platform.orgs o WHERE ((o.id = feedback.org_id) AND (o.flags @> '{"feedback_visible": true}'::jsonb))))) AND ((handled_by IS NULL) OR (handled_by = ( SELECT auth.uid() AS uid)))));

-- ROLLBACK: (jamais exécuté depuis le paquet ; chaque policy reprend sa définition d'avant, sous son nom)
--   drop policy feedback_update_admin on platform.feedback ;
--   create policy feedback_update_admin on platform.feedback for update to authenticated
--     using ((org_id in ( select platform.member_orgs() as member_orgs)))
--     with check ((org_id in ( select platform.member_orgs() as member_orgs))) ;
--   drop policy connector_activations_update_admin on platform.connector_activations ;
--   create policy connector_activations_update_admin on platform.connector_activations for update to authenticated
--     using ((org_id in ( select platform.member_orgs() as member_orgs)))
--     with check ((org_id in ( select platform.member_orgs() as member_orgs))) ;
--   drop policy connector_activations_insert_admin on platform.connector_activations ;
--   create policy connector_activations_insert_admin on platform.connector_activations for insert to authenticated
--     with check (((org_id in ( select platform.member_orgs() as member_orgs)) and (activated_by = ( select auth.uid() as uid)))) ;
--   drop policy accounts_insert_admin on platform.accounts ;
--   create policy accounts_insert_admin on platform.accounts for insert to authenticated
--     with check ((org_id in ( select platform.member_orgs() as member_orgs))) ;
--   drop policy access_rules_delete_manager on platform.access_rules ;
--   create policy access_rules_delete_manager on platform.access_rules for delete to authenticated
--     using ((org_id in ( select platform.member_orgs() as member_orgs))) ;
--   drop policy access_rules_update_manager on platform.access_rules ;
--   create policy access_rules_update_manager on platform.access_rules for update to authenticated
--     using ((org_id in ( select platform.member_orgs() as member_orgs)))
--     with check ((org_id in ( select platform.member_orgs() as member_orgs))) ;
--   drop policy access_rules_insert_manager on platform.access_rules ;
--   create policy access_rules_insert_manager … : la définition de la ligne de base (20260928100000), sans les deux
--     dernières conditions (`manage` et `node_level_for`) ;
--   drop policy org_domains_insert_admin on platform.org_domains ;
--   create policy org_domains_insert_admin on platform.org_domains for insert to authenticated
--     with check ((org_id in ( select platform.member_orgs() as member_orgs))) ;
--   drop policy team_members_update_admin on platform.team_members ;
--   create policy team_members_update_admin … : la définition de la ligne de base, sans `is_org_admin(t.org_id)` ;
--   drop policy team_members_insert_admin on platform.team_members ;
--   create policy team_members_insert_admin … : la définition de la ligne de base, sans la condition de rôle ;
--   drop policy teams_update_admin on platform.teams ;
--   create policy teams_update_admin on platform.teams for update to authenticated
--     using ((org_id in ( select platform.member_orgs() as member_orgs)))
--     with check ((org_id in ( select platform.member_orgs() as member_orgs))) ;
--   drop policy teams_insert_admin on platform.teams ;
--   create policy teams_insert_admin on platform.teams for insert to authenticated
--     with check ((org_id in ( select platform.member_orgs() as member_orgs))) ;
--   drop policy invitations_update_revoke on platform.invitations ;
--   create policy invitations_update_revoke … : la définition de la ligne de base, sans l'émetteur ni `is_org_admin` ;
--   drop policy invitations_insert_admin on platform.invitations ;
--   create policy invitations_insert_admin … : la définition de la ligne de base, sans la condition de rôle ;
--   drop policy members_update_admin on platform.members ;
--   create policy members_update_admin on platform.members for update to authenticated
--     using ((org_id in ( select platform.member_orgs() as member_orgs)))
--     with check ((org_id in ( select platform.member_orgs() as member_orgs))) ;
--   drop policy members_insert_admin on platform.members ;
--   create policy members_insert_admin on platform.members for insert to authenticated
--     with check ((org_id in ( select platform.member_orgs() as member_orgs))) ;
--   drop policy platform_grants_update_revoke on platform.platform_grants ;
--   create policy platform_grants_update_revoke … : la définition de la ligne de base, sans `is_org_admin` ni `is_staff()` ;
--   drop policy platform_grants_insert_staff on platform.platform_grants ;
--   create policy platform_grants_insert_staff … : la définition de la ligne de base, sans `is_staff()` ni `is_org_admin`.
