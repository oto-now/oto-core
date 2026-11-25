-- Le nom d'une personne qui arrive dans un espace (retour RET-010 ; décidé par JB le 2026-11-19) : un profil est propre
-- à chaque espace et naissait vide, si bien qu'une personne qui crée ou rejoint un nouvel espace y apparaissait sous le
-- début de son email (`identityInOrg`) au lieu du nom de son profil ailleurs. À l'arrivée, le profil reprend le nom, le
-- prénom et le nom de famille de son profil dans l'espace qu'elle a rejoint le plus récemment, dans la même base. Sans
-- profil nommé ailleurs, rien n'est copié : le nom de son compte (`members.name`, tenu à jour à chaque connexion) sert
-- déjà de secours à l'annuaire et à l'identité, et une copie dans le profil le figerait. Elle reste libre de changer son
-- nom ensuite dans chaque espace, sans toucher aux autres.
--
-- Un déclencheur `before insert` couvre toutes les arrivées (`signup_org`, `seat_org_admin`, `join_org`,
-- `accept_invitations`, outillage) ; il passe après `members_identity_copy` (ordre alphabétique des déclencheurs d'un
-- même temps). Un profil qui porte déjà un nom (une insertion qui le pose) n'est pas touché. Aucune ligne existante
-- n'est reprise. Additif : une fonction, un déclencheur ; rien à relancer avant. Fichier de développement, à réunir avec
-- les autres de la version avant le tag.

CREATE FUNCTION platform.members_profile_on_arrival() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_other jsonb;
  v_profile jsonb := coalesce(new.profile, '{}'::jsonb);
begin
  if nullif(btrim(coalesce(v_profile ->> 'name', '')), '') is not null then
    return new;
  end if;
  -- Le profil nommé le plus récent de la même personne dans un autre espace : ses trois champs de nom, et eux seuls.
  select m.profile into v_other
    from platform.members m
   where m.user_id = new.user_id and m.org_id <> new.org_id
     and nullif(btrim(coalesce(m.profile ->> 'name', '')), '') is not null
   order by m.created_at desc, m.org_id
   limit 1;
  if v_other is not null then
    new.profile := v_profile || jsonb_strip_nulls(jsonb_build_object(
      'name', v_other -> 'name', 'first_name', v_other -> 'first_name', 'last_name', v_other -> 'last_name'));
  end if;
  return new;
end;
$$;

REVOKE ALL ON FUNCTION platform.members_profile_on_arrival() FROM PUBLIC;

CREATE TRIGGER members_profile_on_arrival BEFORE INSERT ON platform.members FOR EACH ROW EXECUTE FUNCTION platform.members_profile_on_arrival();

-- ROLLBACK: (jamais exécuté depuis le paquet)
--   drop trigger members_profile_on_arrival on platform.members ;
--   drop function platform.members_profile_on_arrival().
