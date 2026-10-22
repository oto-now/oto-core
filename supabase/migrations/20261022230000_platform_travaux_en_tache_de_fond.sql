-- Les travaux en tâche de fond (fonctions longues, décidé par Alexis le 22/10) : une fonction de connecteur déclarée
-- longue (`background: true`) ne court pas pendant que l'assistant attend. `call` écrit un travail et rend aussitôt son
-- identifiant ; l'exécutant de l'hôte (`runJobs`) le réclame, l'exécute sous l'identité de son auteur, puis le conclut ;
-- l'auteur relève le résultat par `job.read`. Un appel parti n'est jamais relancé tout seul.
--
-- Un travail n'est lisible que par son auteur, comme un fichier en transit. Ses arguments et son résultat sont chiffrés
-- par le serveur avant d'être écrits (le coffre de l'hôte, `server/connectors/vault.ts`) : la base n'en garde aucune
-- donnée personnelle en clair ; le secret du compte n'y est jamais, il se résout à l'exécution. Les arguments partent à
-- la conclusion ; le résultat 24 heures après, et la ligne 30 jours plus tard (ce qui reste dit quand et pourquoi il a
-- été effacé). Un travail resté en file 24 heures finit `not_started` ; un travail envoyé dont le bail a expiré finit
-- `outcome_unknown`, jamais relancé. Les durées vivent ici seules.
--
-- Aucune écriture sous une session : la mise en file, le ménage, la réclamation et chaque passage d'état passent par une
-- fonction `security definer` réservée au rôle du serveur, chaque passage conditionné par l'état attendu et le jeton du
-- bail (un exécutant en retard n'écrit plus rien). Une personne retirée de l'organisation, ou oubliée, emporte ses
-- travaux (clé vers `members`, en cascade) ; l'organisation supprimée aussi. Un seul bloc ROLLBACK en fin de fichier.

-- 1. La table.
CREATE TABLE platform.jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    user_id uuid NOT NULL,
    function text NOT NULL,
    team_id uuid,
    team_slug text,
    account_id uuid,
    ctx text,
    origin text NOT NULL,
    timeout_ms integer NOT NULL,
    digest text NOT NULL,
    arguments_ciphertext text,
    worst_quantity numeric,
    cost_unit text,
    state text DEFAULT 'queued'::text NOT NULL,
    reason text,
    lease_token uuid,
    lease_until timestamp with time zone,
    outcome_ciphertext text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    sent_at timestamp with time zone,
    finished_at timestamp with time zone,
    erased_at timestamp with time zone,
    CONSTRAINT jobs_function_check CHECK (((char_length(function) >= 1) AND (char_length(function) <= 200))),
    CONSTRAINT jobs_timeout_ms_check CHECK (((timeout_ms >= 1000) AND (timeout_ms <= 300000))),
    CONSTRAINT jobs_state_check CHECK ((state = ANY (ARRAY['queued'::text, 'claimed'::text, 'sent'::text, 'done'::text, 'failed'::text]))),
    CONSTRAINT jobs_reason_check CHECK (((state = 'failed'::text) = (reason IS NOT NULL)) AND ((reason IS NULL) OR (reason = ANY (ARRAY['refused'::text, 'outcome_unknown'::text, 'not_started'::text])))),
    CONSTRAINT jobs_lease_check CHECK (((state = ANY (ARRAY['claimed'::text, 'sent'::text])) = (lease_token IS NOT NULL)) AND ((lease_token IS NULL) = (lease_until IS NULL))),
    CONSTRAINT jobs_cost_check CHECK (((worst_quantity IS NULL) = (cost_unit IS NULL)))
);

COMMENT ON TABLE platform.jobs IS 'Travaux en tâche de fond des fonctions longues (fonctions longues, 22/10/2026) : lisibles par leur seul auteur, arguments et résultat chiffrés par le serveur, écrits par les seules fonctions du rôle du serveur.';

ALTER TABLE ONLY platform.jobs
    ADD CONSTRAINT jobs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY platform.jobs
    ADD CONSTRAINT jobs_org_id_fkey FOREIGN KEY (org_id) REFERENCES platform.orgs(id) ON DELETE CASCADE;

ALTER TABLE ONLY platform.jobs
    ADD CONSTRAINT jobs_member_fkey FOREIGN KEY (org_id, user_id) REFERENCES platform.members(org_id, user_id) ON DELETE CASCADE;

-- Un travail identique en cours (même auteur, fonction, compte et arguments) est rendu au lieu d'en créer un second.
CREATE UNIQUE INDEX uq_jobs_active_digest ON platform.jobs USING btree (org_id, user_id, digest) WHERE (state = ANY (ARRAY['queued'::text, 'claimed'::text, 'sent'::text]));

-- La file, dans l'ordre d'arrivée, et le ménage des baux.
CREATE INDEX idx_jobs_state_created_at ON platform.jobs USING btree (state, created_at);

-- La cascade d'une personne retirée : sans lui, chaque retrait parcourrait la table.
CREATE INDEX idx_jobs_org_id_user_id ON platform.jobs USING btree (org_id, user_id);

ALTER TABLE platform.jobs ENABLE ROW LEVEL SECURITY;

-- 2. RLS : l'auteur seul lit ses travaux ; personne ne les écrit sous une session.
DROP POLICY IF EXISTS jobs_select_own ON platform.jobs;
CREATE POLICY jobs_select_own ON platform.jobs FOR SELECT TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND (org_id IN ( SELECT platform.member_orgs() AS member_orgs))));

GRANT SELECT ON TABLE platform.jobs TO authenticated;

-- 3. La mise en file, pour l'auteur de la session du serveur, dans une organisation dont il est membre ; un travail
--    identique en cours est rendu (`created` faux). Le chiffré, l'empreinte et le pire cas sont posés par le serveur.
CREATE FUNCTION platform.enqueue_job(p_org uuid, p_function text, p_team_id uuid, p_team_slug text, p_account uuid, p_ctx text, p_origin text, p_timeout_ms integer, p_digest text, p_arguments text, p_worst numeric, p_unit text) RETURNS TABLE(job_id uuid, created boolean)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
begin
  if v_user is null or not exists (select 1 from platform.members m where m.org_id = p_org and m.user_id = v_user) then
    raise exception 'jobs: the author is not a member of the organisation' using errcode = '42501';
  end if;
  insert into platform.jobs (org_id, user_id, function, team_id, team_slug, account_id, ctx, origin, timeout_ms, digest, arguments_ciphertext, worst_quantity, cost_unit)
  values (p_org, v_user, p_function, p_team_id, p_team_slug, p_account, p_ctx, p_origin, p_timeout_ms, p_digest, p_arguments, p_worst, p_unit)
  on conflict (org_id, user_id, digest) where (state = any (array['queued', 'claimed', 'sent'])) do nothing
  returning id into v_id;
  if v_id is not null then
    return query select v_id, true;
    return;
  end if;
  return query
    select j.id, false from platform.jobs j
     where j.org_id = p_org and j.user_id = v_user and j.digest = p_digest and j.state = any (array['queued', 'claimed', 'sent']);
end
$$;

-- 4. Le ménage, sous l'exécutant (aucun appelant : tous les travaux) ou sous l'auteur (les siens) : un bail réclamé
--    expiré revient en file (rien n'est parti) ; un bail envoyé expiré finit `outcome_unknown` ; un travail en file
--    depuis 24 heures finit `not_started` ; un résultat conclu depuis 24 heures s'efface ; une ligne effacée depuis
--    30 jours part. Rend les travaux qu'il vient de conclure, pour leur ligne de journal.
CREATE FUNCTION platform.sweep_jobs() RETURNS TABLE(job_id uuid, org_id uuid, user_id uuid, email text, function text, team_id uuid, account_id uuid, ctx text, reason text, worst_quantity numeric, cost_unit text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
#variable_conflict use_column
declare
  v_user uuid := auth.uid();
begin
  update platform.jobs j set state = 'queued', lease_token = null, lease_until = null
   where j.state = 'claimed' and j.lease_until <= now() and (v_user is null or j.user_id = v_user);
  update platform.jobs j set outcome_ciphertext = null, erased_at = now()
   where j.erased_at is null and j.finished_at <= now() - interval '24 hours' and (v_user is null or j.user_id = v_user);
  delete from platform.jobs j where j.erased_at <= now() - interval '30 days' and (v_user is null or j.user_id = v_user);
  return query
    update platform.jobs j
       set state = 'failed', reason = case when j.state = 'sent' then 'outcome_unknown' else 'not_started' end,
           finished_at = now(), lease_token = null, lease_until = null, arguments_ciphertext = null
      from platform.members m
     where m.org_id = j.org_id and m.user_id = j.user_id
       and ((j.state = 'sent' and j.lease_until <= now()) or (j.state = 'queued' and j.created_at <= now() - interval '24 hours'))
       and (v_user is null or j.user_id = v_user)
    returning j.id, j.org_id, j.user_id, m.email, j.function, j.team_id, j.account_id, j.ctx, j.reason, j.worst_quantity, j.cost_unit;
end
$$;

-- 5. La réclamation, sans doublon entre exécutants : les plus anciens en file, `p_limit` au plus (de 1 à 50), chacun
--    sous un jeton neuf et un bail de son délai plus 30 secondes ; rend de quoi reconstruire l'identité de l'auteur.
CREATE FUNCTION platform.claim_jobs(p_limit integer) RETURNS TABLE(job_id uuid, org_id uuid, user_id uuid, email text, lease_token uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
#variable_conflict use_column
begin
  return query
    with picked as (
      select j.id from platform.jobs j where j.state = 'queued'
       order by j.created_at limit greatest(1, least(coalesce(p_limit, 1), 50))
       for update skip locked
    )
    update platform.jobs j
       set state = 'claimed', lease_token = gen_random_uuid(), lease_until = now() + make_interval(secs => (j.timeout_ms + 30000) / 1000.0)
      from picked, platform.members m
     where j.id = picked.id and m.org_id = j.org_id and m.user_id = j.user_id
    returning j.id, j.org_id, j.user_id, m.email, j.lease_token;
end
$$;

-- 6. Juste avant l'appel au tiers : réclamé, sous ce jeton, bail en cours ; le bail repart pour l'appel. Faux : le bail
--    est perdu, rien ne doit partir.
CREATE FUNCTION platform.mark_job_sent(p_job uuid, p_token uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  update platform.jobs j
     set state = 'sent', sent_at = now(), lease_until = now() + make_interval(secs => (j.timeout_ms + 30000) / 1000.0)
   where j.id = p_job and j.lease_token = p_token and j.state = 'claimed' and j.lease_until > now();
  return found;
end
$$;

-- 7. La conclusion, sous ce jeton : `done` après l'envoi (`p_reason` nul), ou `failed` pour un refus (`refused`), avant
--    ou après l'envoi ; le résultat chiffré, les arguments retirés. Faux : un autre a conclu ou le ménage est passé.
CREATE FUNCTION platform.finish_job(p_job uuid, p_token uuid, p_reason text, p_outcome text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if p_reason is not null and p_reason <> 'refused' then
    raise exception 'jobs: a runner concludes done or refused, never %', p_reason using errcode = '22023';
  end if;
  update platform.jobs j
     set state = case when p_reason is null then 'done' else 'failed' end, reason = p_reason, outcome_ciphertext = p_outcome,
         finished_at = now(), lease_token = null, lease_until = null, arguments_ciphertext = null
   where j.id = p_job and j.lease_token = p_token
     and (j.state = 'sent' or (j.state = 'claimed' and p_reason is not null));
  return found;
end
$$;

REVOKE ALL ON FUNCTION platform.enqueue_job(p_org uuid, p_function text, p_team_id uuid, p_team_slug text, p_account uuid, p_ctx text, p_origin text, p_timeout_ms integer, p_digest text, p_arguments text, p_worst numeric, p_unit text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION platform.enqueue_job(p_org uuid, p_function text, p_team_id uuid, p_team_slug text, p_account uuid, p_ctx text, p_origin text, p_timeout_ms integer, p_digest text, p_arguments text, p_worst numeric, p_unit text) TO platform_server;

REVOKE ALL ON FUNCTION platform.sweep_jobs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION platform.sweep_jobs() TO platform_server;

REVOKE ALL ON FUNCTION platform.claim_jobs(p_limit integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION platform.claim_jobs(p_limit integer) TO platform_server;

REVOKE ALL ON FUNCTION platform.mark_job_sent(p_job uuid, p_token uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION platform.mark_job_sent(p_job uuid, p_token uuid) TO platform_server;

REVOKE ALL ON FUNCTION platform.finish_job(p_job uuid, p_token uuid, p_reason text, p_outcome text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION platform.finish_job(p_job uuid, p_token uuid, p_reason text, p_outcome text) TO platform_server;

-- ROLLBACK: (jamais exécuté depuis le paquet ; avec le paquet de la version précédente, qui refuse `background`)
--   drop function platform.finish_job(uuid, uuid, text, text) ; drop function platform.mark_job_sent(uuid, uuid) ;
--   drop function platform.claim_jobs(integer) ; drop function platform.sweep_jobs() ;
--   drop function platform.enqueue_job(uuid, text, uuid, text, uuid, text, text, integer, text, text, numeric, text) ;
--   drop table platform.jobs.
