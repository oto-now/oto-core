-- L'écran Connecteurs, lot 2 (connecteurs et comptes, § Écran Connecteurs) : la fermeture d'un connecteur garde son
-- propre auteur, le dernier test d'un compte dit sa raison par un code, et il s'efface quand la clé du compte change.
-- Additif : une colonne, une fonction re-versionnée à signature identique, deux fonctions neuves. Aucune ligne n'est
-- réécrite : une ligne fermée avant ce fichier n'a pas d'auteur de fermeture connu (`closed_by` nul). Un seul bloc
-- ROLLBACK en fin de fichier.

-- 1. Qui a fermé un connecteur (`deactivateConnector`, lu en `OrgConnector.closedBy`) : jusqu'ici, `activated_by`
--    nommait celui qui avait activé, puis, depuis le lot 1, celui qui avait fermé ; la fermeture a désormais sa colonne,
--    et `activated_by` redevient l'auteur de l'activation. Nul : ligne active, ou fermée sans auteur connu (avant ce
--    fichier, ou personne oubliée). Lue et écrite comme les autres colonnes de la table (droits de la table, policies
--    `connector_activations_*`) ; aucune clé vers `auth.users`, comme `activated_by` (`forget_user` l'efface).
ALTER TABLE platform.connector_activations ADD COLUMN closed_by uuid;

-- 2. `forget_user`, re-versionnée à signature identique : qui a fermé un connecteur s'efface comme qui l'a activé (le
--    reste du corps est celui de 20261113180000_v1_7_0.sql, point 11).
CREATE OR REPLACE FUNCTION platform.forget_user(p_user uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_others text;
  -- les organisations où partent des nœuds de la personne : leur lexique se reconstruit (E01-S13)
  v_orgs uuid[];
begin
  if p_user is null then
    raise exception 'forget_user needs the id of a person' using errcode = '22023';
  end if;
  -- Le verrou d'abord : les nœuds que la personne possède ne changent ni de propriétaire ni de place
  -- avant la fin de la transaction. Un nœud rangé dessous entre-temps reste possible : la suppression
  -- l'épargne, et la clé refuse.
  perform 1 from platform.nodes s where s.owner_user_id = p_user order by s.id for no key update;
  -- Fiche D19, option A : le privé part avec la personne, pas ce que d'autres possèdent dessous. Un
  -- nœud d'équipe déplacé dans un espace personnel garde son propriétaire (H71) : il le reste ici.
  -- Cette lecture ne sert qu'à nommer les chemins : le refus tient à la clé.
  select string_agg(distinct o.slug || ':' || n.path, ', ' order by o.slug || ':' || n.path)
    into v_others
    from platform.nodes s
    join platform.nodes n on n.org_id = s.org_id and n.lpath operator(extensions.<@) s.lpath
    join platform.orgs o on o.id = n.org_id
   where s.owner_user_id = p_user
     and n.owner_kind is not null
     and n.owner_user_id is distinct from p_user;
  if v_others is not null then
    raise exception 'forget_user: nodes of other owners lie under the nodes of this person, move them first: %', v_others
      using errcode = '23503';
  end if;
  -- Ne partent que les nœuds dont la personne est la propriétaire effective : ni un nœud d'un autre
  -- propriétaire explicite, ni ce qui est dessous. Un tel nœud présent à la fin de l'instruction, même
  -- rangé après la lecture, garde son parent : `nodes_parent_id_fkey` refuse (23503). La condition sur
  -- `n` lui-même se relit sur sa dernière version quand une autre transaction l'a changé entre-temps.
  -- Les organisations des nœuds supprimés, rendues par la suppression même (E01-S13).
  with gone as (
    delete from platform.nodes n
     using platform.nodes s
     where s.owner_user_id = p_user
       and n.org_id = s.org_id
       and n.lpath operator(extensions.<@) s.lpath
       and (n.owner_kind is null or n.owner_user_id is not distinct from p_user)
       and not exists (select 1 from platform.nodes x
                        where x.org_id = s.org_id
                          and x.lpath operator(extensions.<@) s.lpath
                          and n.lpath operator(extensions.<@) x.lpath
                          and x.owner_kind is not null
                          and x.owner_user_id is distinct from p_user)
    returning n.org_id
  )
  select array_agg(distinct gone.org_id) into v_orgs from gone;
  -- ses mots aussi : le lexique de ces organisations, reconstruit depuis ce qui reste (E01-S13)
  perform platform.lexicon_rebuild(o.id) from unnest(v_orgs) as o(id);
  -- autrefois en cascade
  delete from platform.members where user_id = p_user;
  delete from platform.team_members where user_id = p_user;
  delete from platform.access_rules where subject_user_id = p_user;
  delete from platform.accounts where owner_user_id = p_user;
  delete from platform.ctx where user_id = p_user;
  delete from platform.platform_grants where user_id = p_user;
  delete from platform.platform_staff where user_id = p_user;
  -- ses correspondances chez les émetteurs (E01-S11)
  delete from platform.identities where user_id = p_user;
  -- autrefois `set null`
  update platform.teams set lead_user_id = null where lead_user_id = p_user;
  update platform.journal set user_id = null where user_id = p_user;
  update platform.invitations set invited_by = null where invited_by = p_user;
  update platform.invitations set accepted_by = null where accepted_by = p_user;
  update platform.nodes set created_by = null where created_by = p_user;
  update platform.nodes set updated_by = null where updated_by = p_user;
  update platform.access_rules set created_by = null where created_by = p_user;
  update platform.platform_staff set added_by = null where added_by = p_user;
  update platform.platform_grants set granted_by = null where granted_by = p_user;
  update platform.platform_grants set revoked_by = null where revoked_by = p_user;
  update platform.admin_journal set user_id = null where user_id = p_user;
  update platform.node_drafts set created_by = null where created_by = p_user;
  update platform.node_drafts set updated_by = null where updated_by = p_user;
  update platform.blocks set claimed_by_user = null where claimed_by_user = p_user;
  update platform.blocks set created_by = null where created_by = p_user;
  update platform.blocks set updated_by = null where updated_by = p_user;
  update platform.node_versions set author = null where author = p_user;
  update platform.node_aliases set created_by = null where created_by = p_user;
  update platform.feedback set user_id = null where user_id = p_user;
  update platform.feedback set handled_by = null where handled_by = p_user;
  update platform.connector_activations set activated_by = null where activated_by = p_user;
  -- qui a fermé un connecteur (écran Connecteurs, lot 2)
  update platform.connector_activations set closed_by = null where closed_by = p_user;
  update platform.sim_outbox set created_by = null where created_by = p_user;
  update platform.sim_outbox set sent_by = null where sent_by = p_user;
  -- l'auteur d'un lien public (E05-S10, ADR-013)
  update platform.node_shares set created_by = null where created_by = p_user;
  -- l'auteur d'un fichier joint (E10-S02)
  update platform.files set created_by = null where created_by = p_user;
  -- ses tickets de dépôt par lien (E10-S02 lot f, ADR-018)
  delete from platform.upload_tickets where user_id = p_user;
  -- ses exclusions (entrée sans invitation) : aucune ligne nominative ne reste ; l'auteur d'une exclusion s'efface
  delete from platform.member_exclusions where user_id = p_user;
  update platform.member_exclusions set excluded_by = null where excluded_by = p_user;
  -- ses commentaires et ses fils (commentaires d'une page) restent, sans elle ; elle sort des mentions
  update platform.comments set author = null where author = p_user;
  update platform.comments set mentions = array_remove(mentions, p_user) where p_user = any(mentions);
  update platform.comment_threads set created_by = null where created_by = p_user;
  update platform.comment_threads set resolved_by = null where resolved_by = p_user;
  -- le journal des partages (partage des comptes) : en dernier, après les règles retirées plus haut, que le
  -- déclencheur y a écrites ; la personne n'y reste ni comme auteur ni comme sujet, la ligne garde le geste
  update platform.account_share_events set actor_user_id = null where actor_user_id = p_user;
  update platform.account_share_events set subject_id = null where subject_kind = 'user' and subject_id = p_user;
end;
$$;

REVOKE ALL ON FUNCTION platform.forget_user(p_user uuid) FROM PUBLIC;

-- 3. Le dernier test d'un compte avec le code de sa raison (`probeAccount`) : `record_account_probe` de 20261114120000,
--    un argument de plus, `p_code`, rangé sous `code` (nul pour un test sain, un code `[a-z_]` sinon ; la liste fermée
--    est celle du service, `PROBE_FAILURE_CODES`). La fonction à quatre arguments reste, plus appelée par le paquet.
--    Refus : une issue absente, un code incohérent avec l'issue ou mal formé, un solde mal formé (22023) ; un compte
--    inconnu ou d'une autre organisation (42501).
CREATE FUNCTION platform.record_account_probe(p_account uuid, p_healthy boolean, p_code text, p_reason text, p_balance jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_probe jsonb;
begin
  if p_healthy is null then
    raise exception 'probe without an outcome' using errcode = '22023';
  end if;
  if (p_healthy and p_code is not null) or (not p_healthy and (p_code is null or p_code !~ '^[a-z][a-z_]{0,39}$')) then
    raise exception 'probe code that does not fit its outcome' using errcode = '22023';
  end if;
  if p_balance is not null and not (
       jsonb_typeof(p_balance) = 'object'
       and (select count(*) from jsonb_object_keys(p_balance)) = 3
       and jsonb_typeof(p_balance -> 'value') in ('number', 'null')
       and jsonb_typeof(p_balance -> 'unit') = 'string'
       and jsonb_typeof(p_balance -> 'min') = 'number') then
    raise exception 'probe balance of an unknown shape' using errcode = '22023';
  end if;
  v_probe := jsonb_build_object('at', to_jsonb(now()), 'healthy', p_healthy, 'code', coalesce(to_jsonb(p_code), 'null'::jsonb), 'reason', left(p_reason, 1000), 'balance', coalesce(p_balance, 'null'::jsonb));
  update platform.accounts a
     set health = jsonb_set(coalesce(a.health, '{}'::jsonb), '{last_probe}', v_probe)
   where a.id = p_account and a.org_id in (select platform.member_orgs());
  if not found then
    raise exception 'account not reachable' using errcode = '42501';
  end if;
  return v_probe;
end
$$;

REVOKE ALL ON FUNCTION platform.record_account_probe(p_account uuid, p_healthy boolean, p_code text, p_reason text, p_balance jsonb) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION platform.record_account_probe(p_account uuid, p_healthy boolean, p_code text, p_reason text, p_balance jsonb) TO platform_server;

-- 4. Le dernier test d'un compte effacé quand sa saisie change (`setAccountSecret`) : il portait sur l'ancienne clé ou
--    les anciens réglages. Retire `last_probe` de `health`, rien d'autre (la marque reste) ; un compte sans test reste
--    tel quel. Réservée au rôle du serveur, qui a décidé qui gère le compte. Refus : un compte inconnu ou d'une autre
--    organisation (42501).
CREATE FUNCTION platform.forget_account_probe(p_account uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  update platform.accounts a
     set health = a.health - 'last_probe'
   where a.id = p_account and a.org_id in (select platform.member_orgs());
  if not found then
    raise exception 'account not reachable' using errcode = '42501';
  end if;
end
$$;

REVOKE ALL ON FUNCTION platform.forget_account_probe(p_account uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION platform.forget_account_probe(p_account uuid) TO platform_server;

-- ROLLBACK: (jamais exécuté depuis le paquet)
--   drop function platform.forget_account_probe(uuid) ;
--   drop function platform.record_account_probe(uuid, boolean, text, text, jsonb) ;
--   forget_user : reprendre le corps de 20261113180000_v1_7_0.sql (point 11) ;
--   alter table platform.connector_activations drop column closed_by.
