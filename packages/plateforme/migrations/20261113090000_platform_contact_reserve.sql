-- Le contact d'une organisation réservé à ses membres et à l'équipe plateforme. `org_contact` rendait le nom et l'email
-- de l'administrateur le plus ancien à toute personne connectée qui en donnait l'identifiant, membre ou non : sur un
-- hôte ouvert à l'inscription, n'importe qui lisait ce contact. Elle ne rend plus de ligne qu'à un membre de
-- l'organisation (`member_orgs`) ou à l'équipe plateforme (`is_staff`), qui la lit dans la fiche d'une organisation.
--
-- Re-versionnée à signature identique, privilèges redits à l'identique. Aucune table, colonne, policy ni index ; rien à
-- relancer avant. Un hôte dont l'écran « aucune organisation » lisait ce contact pour un non-membre reçoit désormais
-- « aucun contact » : son écran dit de demander à un administrateur, sans le nommer.

CREATE OR REPLACE FUNCTION platform.org_contact(p_org uuid) RETURNS TABLE(name text, email text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select coalesce(nullif(m.profile ->> 'name', ''), split_part(m.email, '@', 1)), m.email
    from platform.members m
   where m.org_id = p_org and m.role = 'admin'
     and (p_org in (select platform.member_orgs()) or platform.is_staff())
   order by m.created_at, m.user_id
   limit 1
$$;

REVOKE ALL ON FUNCTION platform.org_contact(p_org uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION platform.org_contact(p_org uuid) TO authenticated;
