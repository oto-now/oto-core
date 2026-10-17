-- Le compte de l'hôte et le compte rattaché (connecteurs et comptes, § Compte de l'hôte et compte rattaché) : un compte
-- porte l'identifiant de son compte chez un tiers qui héberge les comptes de ses utilisateurs (`linked_id`), écrit par
-- une seule fonction, qui le vérifie (`link_hosted_account`) ; les demandes de branchement en cours ; les lectures
-- gardées de ces identifiants. La clé de l'hôte atteint tous les comptes rattachés : un identifiant écrit par n'importe
-- qui ferait agir sous le compte d'un autre. Un seul bloc ROLLBACK en fin de fichier.

-- 1. L'identifiant chez le tiers et la date du branchement. Aucun droit de colonne à `authenticated`, ni en lecture ni
--    en écriture : il se lit par `account_linked_id` et `my_hosted_accounts`, il s'écrit par `link_hosted_account`
--    seule. Ses caractères sont ceux de la liste blanche de l'indice du tiers. Dans une organisation, un identifiant
--    n'est qu'à un compte d'un connecteur ; entre organisations, la fonction d'écriture garde qu'il reste à une personne.
ALTER TABLE platform.accounts
    ADD COLUMN linked_id text,
    ADD COLUMN linked_at timestamp with time zone,
    ADD CONSTRAINT accounts_linked_id_check CHECK ((linked_id ~ '^[A-Za-z0-9_-]{1,128}$'::text));

CREATE UNIQUE INDEX accounts_org_id_connector_linked_id_key ON platform.accounts USING btree (org_id, connector, linked_id) WHERE (linked_id IS NOT NULL);

CREATE INDEX idx_accounts_connector_linked_id ON platform.accounts USING btree (connector, linked_id) WHERE (linked_id IS NOT NULL);

-- 2. L'insertion d'un compte passe aux droits de colonnes (règle `accounts`) : le droit sur toute la table, accordé par la
--    ligne de base, couvrirait `linked_id` et `linked_at`. Les colonnes accordées sont exactement celles d'avant.
REVOKE INSERT ON TABLE platform.accounts FROM authenticated;

GRANT INSERT(id,org_id,connector,owner_kind,owner_team_id,owner_user_id,label,secret_ciphertext,status,health,mode,created_at,updated_at,settings,secret_fields,secret_updated_at,token_ciphertext,token_expires_at,status_reason,granted_scopes) ON TABLE platform.accounts TO authenticated;

-- 3. Une demande de branchement en cours : la personne, l'organisation, le connecteur, `create` ou `reconnect`, l'écran
--    de l'hôte où revenir ; une heure ; consommée par la liaison (`consumed_at`), avec toutes les demandes ouvertes de la
--    personne pour ce connecteur. Sa date de création, posée par la base, fonde la garde de provenance.
CREATE TABLE platform.hosted_link_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    user_id uuid NOT NULL,
    connector text NOT NULL,
    kind text NOT NULL,
    return_to text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    CONSTRAINT hosted_link_requests_kind_check CHECK ((kind = ANY (ARRAY['create'::text, 'reconnect'::text]))),
    CONSTRAINT hosted_link_requests_return_to_check CHECK ((char_length(return_to) <= 500)),
    CONSTRAINT hosted_link_requests_expires_at_check CHECK ((expires_at <= (created_at + '01:00:00'::interval)))
);

COMMENT ON TABLE platform.hosted_link_requests IS 'Demandes de branchement d''un compte chez un tiers qui héberge les comptes (accountIdentity) : une heure, consommées par link_hosted_account.';

ALTER TABLE ONLY platform.hosted_link_requests
    ADD CONSTRAINT hosted_link_requests_pkey PRIMARY KEY (id);

ALTER TABLE ONLY platform.hosted_link_requests
    ADD CONSTRAINT hosted_link_requests_org_id_fkey FOREIGN KEY (org_id) REFERENCES platform.orgs(id) ON DELETE CASCADE;

ALTER TABLE ONLY platform.hosted_link_requests
    ADD CONSTRAINT hosted_link_requests_connector_fkey FOREIGN KEY (connector) REFERENCES platform.connectors(name) ON UPDATE CASCADE ON DELETE RESTRICT;

CREATE INDEX idx_hosted_link_requests_org_id_expires_at ON platform.hosted_link_requests USING btree (org_id, expires_at);

CREATE INDEX idx_hosted_link_requests_connector_open ON platform.hosted_link_requests USING btree (connector, user_id) WHERE (consumed_at IS NULL);

-- 4. RLS : la personne pose et lit ses propres demandes, dans une organisation dont elle est membre ; une demande échue
--    de l'organisation se purge par tout membre. Aucune mise à jour : la consommation passe par `link_hosted_account`.
ALTER TABLE platform.hosted_link_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hosted_link_requests_select_own ON platform.hosted_link_requests;
CREATE POLICY hosted_link_requests_select_own ON platform.hosted_link_requests FOR SELECT TO authenticated USING (((org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND ((user_id = ( SELECT auth.uid() AS uid)) OR (expires_at < now()))));

DROP POLICY IF EXISTS hosted_link_requests_insert_own ON platform.hosted_link_requests;
CREATE POLICY hosted_link_requests_insert_own ON platform.hosted_link_requests FOR INSERT TO authenticated WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND (org_id IN ( SELECT platform.member_orgs() AS member_orgs))));

DROP POLICY IF EXISTS hosted_link_requests_delete_own_or_expired ON platform.hosted_link_requests;
CREATE POLICY hosted_link_requests_delete_own_or_expired ON platform.hosted_link_requests FOR DELETE TO authenticated USING (((org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND ((user_id = ( SELECT auth.uid() AS uid)) OR (expires_at < now()))));

GRANT SELECT,DELETE ON TABLE platform.hosted_link_requests TO authenticated;

GRANT INSERT(org_id),INSERT(user_id),INSERT(connector),INSERT(kind),INSERT(return_to),INSERT(expires_at) ON TABLE platform.hosted_link_requests TO authenticated;

-- 5. L'identifiant chez le tiers d'un compte, comme `account_secret` : au seul membre de l'organisation du compte
--    (`member_orgs`, comme la RLS), pour l'appel que le service a déjà décidé.
CREATE FUNCTION platform.account_linked_id(p_account uuid) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select a.linked_id from platform.accounts a
   where a.id = p_account and a.org_id in (select platform.member_orgs())
$$;

REVOKE ALL ON FUNCTION platform.account_linked_id(p_account uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.account_linked_id(p_account uuid) FROM anon;
GRANT EXECUTE ON FUNCTION platform.account_linked_id(p_account uuid) TO authenticated;

-- 6. Les comptes rattachés de l'appelant pour un connecteur, dans toutes ses organisations, désactivés compris : la
--    preuve qu'un identifiant est déjà à lui, une reconnexion, un identifiant à relier dans une autre organisation.
CREATE FUNCTION platform.my_hosted_accounts(p_connector text) RETURNS TABLE(org_id uuid, account_id uuid, linked_id text, status text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select a.org_id, a.id, a.linked_id, a.status from platform.accounts a
   where a.connector = p_connector and a.owner_kind = 'user' and a.owner_user_id = (select auth.uid()) and a.linked_id is not null
$$;

REVOKE ALL ON FUNCTION platform.my_hosted_accounts(p_connector text) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.my_hosted_accounts(p_connector text) FROM anon;
GRANT EXECUTE ON FUNCTION platform.my_hosted_accounts(p_connector text) TO authenticated;

-- 7. Parmi des identifiants, ceux qui sont rattachés à une autre personne que l'appelant, dans toute organisation, compte
--    actif ou désactivé : la RLS ne voit que les organisations de l'appelant. Rend les identifiants seuls, jamais à qui.
CREATE FUNCTION platform.hosted_linked_elsewhere(p_connector text, p_ids text[]) RETURNS SETOF text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select distinct a.linked_id from platform.accounts a
   where a.connector = p_connector and a.linked_id = any (p_ids) and a.owner_user_id is distinct from (select auth.uid())
$$;

REVOKE ALL ON FUNCTION platform.hosted_linked_elsewhere(p_connector text, p_ids text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.hosted_linked_elsewhere(p_connector text, p_ids text[]) FROM anon;
GRANT EXECUTE ON FUNCTION platform.hosted_linked_elsewhere(p_connector text, p_ids text[]) TO authenticated;

-- 8. Le seul écrivain de `linked_id`. En une transaction : la demande, à l'appelant et dans une de ses organisations,
--    verrouillée avec ses autres demandes ouvertes de ce connecteur, ni consommée (`not_found`) ni échue (`expired`) ; l'identifiant verrouillé (verrou 7601), jamais
--    rattaché à une autre personne, dans toute organisation, actif ou désactivé (`forbidden`) ; sa provenance : déjà à
--    l'appelant, ou créé chez le tiers au plus tôt cinq minutes avant la demande, une date absente refuse
--    (`no_candidate`), et aucune demande ouverte d'une autre personne ne le couvre (`ambiguous_candidates`). Puis le
--    compte personnel de l'appelant de ce connecteur dans l'organisation de la demande : celui qui porte déjà cet
--    identifiant, sinon celui de ce libellé, actif de nouveau, raison effacée ; sinon un compte neuf, réel. Enfin toutes
--    les demandes ouvertes de l'appelant pour ce connecteur sont consommées. Un refus rend sa raison, sans rien écrire.
CREATE FUNCTION platform.link_hosted_account(p_request uuid, p_linked_id text, p_created_at timestamp with time zone, p_label text) RETURNS TABLE(account_id uuid, refusal text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
#variable_conflict use_column
declare
  v_user uuid := (select auth.uid());
  v_request platform.hosted_link_requests%rowtype;
  v_account uuid;
begin
  if v_user is null then
    return query select null::uuid, 'not_found'::text;
    return;
  end if;
  if p_linked_id is null or p_linked_id !~ '^[A-Za-z0-9_-]{1,128}$' then
    return query select null::uuid, 'invalid_arguments'::text;
    return;
  end if;
  select r.* into v_request from platform.hosted_link_requests r
   where r.id = p_request and r.user_id = v_user and r.org_id in (select platform.member_orgs());
  if not found then
    return query select null::uuid, 'not_found'::text;
    return;
  end if;
  -- Toutes les demandes ouvertes de l'appelant pour ce connecteur, verrouillées dans un ordre fixe avant le verrou de
  -- l'identifiant : deux liaisons de la même personne s'attendent sans s'interbloquer, la seconde trouve la sienne
  -- consommée.
  perform 1 from platform.hosted_link_requests r
   where r.user_id = v_user and r.connector = v_request.connector and r.consumed_at is null
   order by r.id
     for update;
  select r.* into v_request from platform.hosted_link_requests r where r.id = p_request;
  if v_request.consumed_at is not null then
    return query select null::uuid, 'not_found'::text;
    return;
  end if;
  if v_request.expires_at <= now() then
    return query select null::uuid, 'expired'::text;
    return;
  end if;
  perform pg_advisory_xact_lock(7601, hashtext(v_request.connector || '/' || p_linked_id));
  if exists (select 1 from platform.accounts a
              where a.connector = v_request.connector and a.linked_id = p_linked_id and a.owner_user_id is distinct from v_user) then
    return query select null::uuid, 'forbidden'::text;
    return;
  end if;
  if not exists (select 1 from platform.accounts a
                  where a.connector = v_request.connector and a.linked_id = p_linked_id and a.owner_kind = 'user' and a.owner_user_id = v_user) then
    if p_created_at is null or p_created_at < v_request.created_at - interval '5 minutes' then
      return query select null::uuid, 'no_candidate'::text;
      return;
    end if;
    if exists (select 1 from platform.hosted_link_requests r
                where r.connector = v_request.connector and r.user_id <> v_user and r.consumed_at is null and r.expires_at > now()
                  and p_created_at >= r.created_at - interval '5 minutes') then
      return query select null::uuid, 'ambiguous_candidates'::text;
      return;
    end if;
  end if;
  select a.id into v_account from platform.accounts a
   where a.org_id = v_request.org_id and a.connector = v_request.connector and a.owner_kind = 'user' and a.owner_user_id = v_user
     and (a.linked_id = p_linked_id or lower(a.label) = lower(p_label))
   order by (a.linked_id is not distinct from p_linked_id) desc
   limit 1
     for update;
  if v_account is null then
    insert into platform.accounts (org_id, connector, owner_kind, owner_team_id, owner_user_id, label, mode, status)
    values (v_request.org_id, v_request.connector, 'user', null, v_user, p_label, 'reel', 'active')
    returning id into v_account;
  end if;
  update platform.accounts set linked_id = p_linked_id, linked_at = now(), status = 'active', status_reason = null where id = v_account;
  update platform.hosted_link_requests set consumed_at = now()
   where user_id = v_user and connector = v_request.connector and consumed_at is null;
  return query select v_account, null::text;
end
$$;

REVOKE ALL ON FUNCTION platform.link_hosted_account(p_request uuid, p_linked_id text, p_created_at timestamp with time zone, p_label text) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.link_hosted_account(p_request uuid, p_linked_id text, p_created_at timestamp with time zone, p_label text) FROM anon;
GRANT EXECUTE ON FUNCTION platform.link_hosted_account(p_request uuid, p_linked_id text, p_created_at timestamp with time zone, p_label text) TO authenticated;

-- ROLLBACK: (jamais exécuté depuis le paquet)
--   drop function platform.link_hosted_account(uuid, text, timestamptz, text) ;
--   drop function platform.hosted_linked_elsewhere(text, text[]) ;
--   drop function platform.my_hosted_accounts(text) ;
--   drop function platform.account_linked_id(uuid) ;
--   drop table platform.hosted_link_requests ;
--   revoke insert on platform.accounts from authenticated ; grant insert on platform.accounts to authenticated ;
--   drop index platform.idx_accounts_connector_linked_id ; drop index platform.accounts_org_id_connector_linked_id_key ;
--   alter table platform.accounts drop constraint accounts_linked_id_check, drop column linked_at, drop column linked_id.
