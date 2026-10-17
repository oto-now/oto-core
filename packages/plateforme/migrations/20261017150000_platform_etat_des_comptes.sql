-- L'état d'un compte (connecteurs et comptes, § État d'un compte) : un appel dont la réponse révèle une clé refusée ou
-- des crédits épuisés, selon la description du connecteur (`marksAccount`), marque le compte ; le premier appel réussi
-- lève la marque. Le compte marqué reste résolu et appelé (un compte en `error` ne l'est pas) : la marque vit dans
-- `accounts.health`, sous `mark` (`{reason, at}`), écrite par une seule fonction étroite, que tout membre qui appelle
-- avec le compte peut jouer, y compris sur un compte partagé qu'il ne gère pas. Un seul bloc ROLLBACK en fin de fichier.

-- 1. `health` ne s'écrit plus que par `mark_account` : ni insertion (la valeur par défaut, `{}`), ni mise à jour par
--    `authenticated`. Sa lecture reste accordée (écran Connecteurs, contexte).
REVOKE INSERT(health) ON TABLE platform.accounts FROM authenticated;
REVOKE UPDATE(health) ON TABLE platform.accounts FROM authenticated;

-- 2. Pose (`credential_rejected`, `quota_exhausted`) ou lève (`null`) la marque d'un compte d'une organisation de
--    l'appelant (`member_orgs`, comme `account_secret` : le service a déjà résolu le compte de l'appel), et rien
--    d'autre : aucune autre clé de `health`, aucune autre colonne. Une marque reposée pour la même raison garde sa date ;
--    rien n'est écrit quand rien ne change. Rend si la marque a changé, et la marque après l'appel. Refus : une autre
--    raison (22023) ; un compte inconnu ou d'une autre organisation (42501).
CREATE FUNCTION platform.mark_account(p_account uuid, p_reason text) RETURNS TABLE(changed boolean, mark jsonb)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_mark jsonb;
  v_next jsonb;
begin
  if p_reason is not null and p_reason not in ('credential_rejected', 'quota_exhausted') then
    raise exception 'unknown account mark' using errcode = '22023';
  end if;
  select a.health -> 'mark' into v_mark from platform.accounts a
   where a.id = p_account and a.org_id in (select platform.member_orgs())
     for update;
  if not found then
    raise exception 'account not reachable' using errcode = '42501';
  end if;
  v_next := case
    when p_reason is null then null
    when v_mark ->> 'reason' = p_reason then v_mark
    else jsonb_build_object('reason', p_reason, 'at', to_jsonb(now()))
  end;
  if v_next is not distinct from v_mark then
    return query select false, v_mark;
    return;
  end if;
  update platform.accounts a
     set health = case when v_next is null then a.health - 'mark' else jsonb_set(a.health, '{mark}', v_next) end
   where a.id = p_account;
  return query select true, v_next;
end
$$;

REVOKE ALL ON FUNCTION platform.mark_account(p_account uuid, p_reason text) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.mark_account(p_account uuid, p_reason text) FROM anon;
GRANT EXECUTE ON FUNCTION platform.mark_account(p_account uuid, p_reason text) TO authenticated;

-- ROLLBACK: (jamais exécuté depuis le paquet)
--   drop function platform.mark_account(uuid, text) ;
--   grant update(health) on platform.accounts to authenticated ; grant insert(health) on platform.accounts to authenticated.
