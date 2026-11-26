-- Le nom d'une personne qui arrive dans un espace qu'elle crée (retour RET-010 ; décidé par JB le 2026-11-19, borné aux
-- espaces qu'elle crée le 2026-11-26) : un profil est propre à chaque espace et naissait vide, si bien qu'une personne
-- qui crée un nouvel espace y apparaissait sous le début de son email (`identityInOrg`) au lieu du nom de son profil
-- ailleurs. Quand elle crée l'espace, le profil reprend le nom, le prénom et le nom de famille de son profil dans
-- l'espace qu'elle a rejoint le plus récemment, dans la même base. Rejoindre l'espace d'un autre (invitation, entrée
-- par domaine, outillage) laisse le profil vierge : le nom qu'elle porte ailleurs n'y entre pas sans elle. Sans profil
-- nommé ailleurs, rien n'est copié : le nom de son compte (`members.name`, tenu à jour à chaque connexion) sert déjà de
-- secours à l'annuaire et à l'identité, et une copie dans le profil le figerait. Elle reste libre de changer son nom
-- ensuite dans chaque espace, sans toucher aux autres.
--
-- « Elle crée l'espace » : l'organisation est née dans la transaction de l'arrivée (`orgs.created_at = now()`, l'heure
-- de début de la transaction) et n'a encore aucun membre. C'est le cas de `signup_org` (inscription) et de
-- `create_org` suivi de `claim_org_admin` (équipe plateforme), qui posent le créateur dans la transaction de la
-- création ; une organisation créée plus tôt, même vide, ne l'est plus. Chaque champ copié est une chaîne, coupé à
-- 80 caractères (la borne d'`update_my_profile`) : le nom est servi aux assistants.
--
-- Un déclencheur `before insert` lit toutes les arrivées ; il passe après `members_identity_copy` (ordre alphabétique
-- des déclencheurs d'un même temps). Un profil qui porte déjà un nom (une insertion qui le pose) n'est pas touché.
-- Aucune ligne existante n'est reprise. Additif : une fonction, un déclencheur ; rien à relancer avant. Fichier de
-- développement, à réunir avec les autres de la version avant le tag.

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
  -- Seulement dans un espace qu'elle crée : né dans cette transaction, sans membre avant elle.
  if not exists (select 1 from platform.orgs o where o.id = new.org_id and o.created_at = now())
     or exists (select 1 from platform.members m where m.org_id = new.org_id) then
    return new;
  end if;
  -- Le profil nommé le plus récent de la même personne dans un autre espace : ses trois champs de nom, et eux seuls.
  select m.profile into v_other
    from platform.members m
   where m.user_id = new.user_id and m.org_id <> new.org_id
     and jsonb_typeof(m.profile -> 'name') = 'string'
     and btrim(m.profile ->> 'name') <> ''
   order by m.created_at desc, m.org_id
   limit 1;
  if v_other is not null then
    new.profile := v_profile || coalesce((
      select jsonb_object_agg(e.key, btrim(left(btrim(e.value #>> '{}'), 80)))
        from jsonb_each(v_other) e
       where e.key in ('name', 'first_name', 'last_name')
         and jsonb_typeof(e.value) = 'string'
         and btrim(e.value #>> '{}') <> ''), '{}'::jsonb);
  end if;
  return new;
end;
$$;

REVOKE ALL ON FUNCTION platform.members_profile_on_arrival() FROM PUBLIC;

DROP TRIGGER IF EXISTS members_profile_on_arrival ON platform.members;
CREATE TRIGGER members_profile_on_arrival BEFORE INSERT ON platform.members FOR EACH ROW EXECUTE FUNCTION platform.members_profile_on_arrival();

-- ROLLBACK: (jamais exécuté depuis le paquet)
--   drop trigger members_profile_on_arrival on platform.members ;
--   drop function platform.members_profile_on_arrival().
