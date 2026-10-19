-- Le rôle du serveur (base et portabilité, § Port de base ; lot 1 du correctif des faits affirmés, décidé par Alexis le
-- 19/10) : une fonction SECURITY DEFINER exécutable par `authenticated`, ou une colonne qui lui est accordée en écriture,
-- croit ce que l'appelant lui passe. Quand la valeur vient d'un tiers ou du serveur (l'identifiant d'un compte hébergé,
-- la marque d'un compte, ses jetons, le plafond de membres de l'hôte, ses adresses, le passage d'un fichier à `ready`,
-- l'état de pseudonymisation, le libellé d'un connecteur déclaré), une personne qui atteindrait `platform` avec son seul
-- jeton l'affirmerait. Ces écritures passent au rôle `platform_server`, que seul `platform_app` peut prendre, aux mêmes
-- claims vérifiés (`server/sql.ts`) ; les échéances que pose le serveur sont gardées par l'horloge de la base. Le rôle
-- est créé hors des migrations, par `oto-platform db prepare`. Un seul bloc ROLLBACK en fin de fichier.

-- 1. Le rôle doit exister, hériter d'`authenticated` (mêmes policies, mêmes droits, `auth.uid()` et `auth.jwt()` lus
--    comme lui) et rester hors de portée de PostgREST (`authenticator`) : sinon rien n'est appliqué.
DO $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'platform_server') then
    raise exception 'rôle platform_server absent : relancer « oto-platform db prepare » sur cette base, puis appliquer cette migration';
  end if;
  if not pg_catalog.pg_has_role('platform_server', 'authenticated', 'USAGE') then
    raise exception 'rôle platform_server sans les droits d''authenticated : relancer « oto-platform db prepare » sur cette base, puis appliquer cette migration';
  end if;
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticator')
     and pg_catalog.pg_has_role('authenticator', 'platform_server', 'MEMBER') then
    raise exception 'le rôle authenticator (PostgREST) est membre de platform_server : retirer cette appartenance, puis appliquer cette migration';
  end if;
end
$$;

-- 2. Les fonctions qui écrivent un fait venu d'un tiers ou du serveur : réservées au rôle du serveur.
REVOKE ALL ON FUNCTION platform.link_hosted_account(p_request uuid, p_linked_id text, p_created_at timestamp with time zone, p_label text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION platform.link_hosted_account(p_request uuid, p_linked_id text, p_created_at timestamp with time zone, p_label text) TO platform_server;

REVOKE ALL ON FUNCTION platform.mark_account(p_account uuid, p_reason text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION platform.mark_account(p_account uuid, p_reason text) TO platform_server;

REVOKE ALL ON FUNCTION platform.join_org(p_org uuid, p_members_max integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION platform.join_org(p_org uuid, p_members_max integer) TO platform_server;

REVOKE ALL ON FUNCTION platform.signup_org(p_name text, p_slug text, p_prefix text, p_hosts text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION platform.signup_org(p_name text, p_slug text, p_prefix text, p_hosts text[]) TO platform_server;

REVOKE ALL ON FUNCTION platform.purge_transit_files(p_org uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION platform.purge_transit_files(p_org uuid) TO platform_server;

REVOKE ALL ON FUNCTION platform.pseudonym_org(p_org uuid, p_salt text, p_witness text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION platform.pseudonym_org(p_org uuid, p_salt text, p_witness text) TO platform_server;

REVOKE ALL ON FUNCTION platform.declare_connector(p_name text, p_label text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION platform.declare_connector(p_name text, p_label text) TO platform_server;

-- 3. Le passage à `ready` des lignes `pending` d'un envoi, que le serveur décide après avoir lu l'objet dans le stockage :
--    les lignes d'une organisation de l'appelant que la RLS de `files` lui laisse modifier (jointes, ou en transit à
--    lui). Rend les identifiants passés à `ready` ; une organisation hors de portée lève 42501. Le droit de modifier
--    `status`, qui ne servait qu'à ce passage, est retiré à `authenticated`.
CREATE FUNCTION platform.mark_files_ready(p_org uuid, p_files uuid[]) RETURNS SETOF uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not coalesce(p_org in (select platform.member_orgs()), false) then
    raise exception 'organisation not reachable' using errcode = '42501';
  end if;
  return query
    update platform.files f set status = 'ready'
     where f.org_id = p_org and f.id = any (p_files) and f.status = 'pending'
       and (f.node_id is not null or f.created_by = (select auth.uid()))
    returning f.id;
end
$$;

REVOKE ALL ON FUNCTION platform.mark_files_ready(p_org uuid, p_files uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION platform.mark_files_ready(p_org uuid, p_files uuid[]) TO platform_server;

REVOKE UPDATE(status) ON TABLE platform.files FROM authenticated;

-- 4. `accounts` : le service n'écrit jamais le propriétaire, le connecteur, le libellé ni le mode d'un compte existant ;
--    l'état, sa raison, les réglages, le secret, les jetons et les droits accordés ne s'écrivent que sous le rôle du
--    serveur. `authenticated` n'insère plus que ce que la personne fournit (le reste prend sa valeur par défaut).
REVOKE UPDATE(owner_kind,owner_team_id,owner_user_id,connector,label,mode) ON TABLE platform.accounts FROM authenticated;

REVOKE UPDATE(status,status_reason,settings,secret_ciphertext,secret_fields,secret_updated_at,token_ciphertext,token_expires_at,granted_scopes) ON TABLE platform.accounts FROM authenticated;

GRANT UPDATE(status,status_reason,settings,secret_ciphertext,secret_fields,secret_updated_at,token_ciphertext,token_expires_at,granted_scopes) ON TABLE platform.accounts TO platform_server;

REVOKE INSERT(id,status,created_at,updated_at,settings,secret_ciphertext,secret_fields,secret_updated_at,token_ciphertext,token_expires_at,status_reason,granted_scopes) ON TABLE platform.accounts FROM authenticated;

-- 5. L'échéance que pose le serveur, gardée par l'horloge de la base : sous `authenticated` comme sous le rôle du
--    serveur, une ligne s'insère avec `now()` plus la durée de sa table, sinon elle est refusée comme un droit manquant
--    (42501) : l'appelant n'a pas à affirmer l'échéance. Le service passe déjà exactement cette valeur ; un écart est une
--    erreur, jamais une valeur remplacée en silence. La connexion d'administration (outillage, tests) n'est pas gardée.
CREATE FUNCTION platform.expires_at_clock() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if current_user in ('authenticated', 'platform_server')
     and new.expires_at is distinct from now() + tg_argv[0]::interval then
    raise exception 'platform.%.expires_at is set by the database clock: now() + %', tg_table_name, tg_argv[0]
      using errcode = '42501';
  end if;
  return new;
end
$$;

REVOKE ALL ON FUNCTION platform.expires_at_clock() FROM PUBLIC;

CREATE TRIGGER files_expires_at_clock BEFORE INSERT ON platform.files FOR EACH ROW WHEN ((new.node_id IS NULL)) EXECUTE FUNCTION platform.expires_at_clock('1 hour');

CREATE TRIGGER upload_tickets_expires_at_clock BEFORE INSERT ON platform.upload_tickets FOR EACH ROW EXECUTE FUNCTION platform.expires_at_clock('15 minutes');

CREATE TRIGGER connector_consents_expires_at_clock BEFORE INSERT ON platform.connector_consents FOR EACH ROW EXECUTE FUNCTION platform.expires_at_clock('10 minutes');

-- ROLLBACK: (jamais exécuté depuis le paquet)
--   drop trigger connector_consents_expires_at_clock on platform.connector_consents ;
--   drop trigger upload_tickets_expires_at_clock on platform.upload_tickets ;
--   drop trigger files_expires_at_clock on platform.files ; drop function platform.expires_at_clock() ;
--   grant insert(id, status, created_at, updated_at, settings, secret_ciphertext, secret_fields, secret_updated_at,
--     token_ciphertext, token_expires_at, status_reason, granted_scopes) on platform.accounts to authenticated ;
--   revoke update(…) on platform.accounts from platform_server ; grant update(owner_kind, owner_team_id, owner_user_id,
--     connector, label, mode, status, status_reason, settings, secret_ciphertext, secret_fields, secret_updated_at,
--     token_ciphertext, token_expires_at, granted_scopes) on platform.accounts to authenticated ;
--   grant update(status) on platform.files to authenticated ; drop function platform.mark_files_ready(uuid, uuid[]) ;
--   pour declare_connector, pseudonym_org, purge_transit_files, signup_org, join_org, mark_account,
--     link_hosted_account : revoke execute from platform_server ; grant execute to authenticated ;
--   le rôle platform_server reste (créé par db prepare, hors des migrations).
