-- Le partage des comptes de connecteur (droits d'accès, § Partage d'un compte de connecteur ; connecteurs et comptes,
-- § Comptes et résolution) : une règle sur un compte vise aussi l'organisation entière ; un niveau `sensitive`, entre
-- l'écriture et la gestion, propre aux comptes ; chaque règle posée, remplacée ou retirée sur un compte entre au journal
-- des partages, dans la transaction qui l'écrit. Le départ d'une personne ne supprime rien de plus : son compte cesse
-- de servir aux autres par la lecture du service, à chaque appel. Un seul bloc ROLLBACK en fin de fichier.

-- 1. `sensitive` : un niveau des seuls comptes (une fonction sensible l'exige ; l'écriture ne suffit plus). Un nœud
--    garde ses quatre niveaux, que tient égaux `node_level_of` et le service.
ALTER TABLE platform.access_rules DROP CONSTRAINT access_rules_level_check, ADD CONSTRAINT access_rules_level_check
    CHECK (((level = ANY (ARRAY['none'::text, 'read'::text, 'write'::text, 'sensitive'::text, 'manage'::text])) AND ((level <> 'sensitive'::text) OR (account_id IS NOT NULL))));

-- 2. Une règle d'organisation vise un nœud ou un compte : la contrainte ne garde plus que le sujet unique. L'unicité
--    par cible et sujet (`access_rules_target_subject_key`) tient déjà une seule règle d'organisation par compte, et
--    la policy d'insertion admettait déjà `subject_org` sur toute cible de l'organisation.
ALTER TABLE platform.access_rules DROP CONSTRAINT access_rules_one_subject, ADD CONSTRAINT access_rules_one_subject
    CHECK (((num_nonnulls(subject_team_id, subject_user_id) + (subject_org)::integer) = 1));

-- 3. Une règle `write` posée sur un compte avant ce niveau ouvrait les fonctions sensibles : elle devient `sensitive`,
--    qui ouvre ce qu'elle ouvrait. Une règle posée ensuite en `write` n'ouvre plus que l'écriture. Avant le journal,
--    qui ne trace que les gestes.
UPDATE platform.access_rules SET level = 'sensitive' WHERE account_id IS NOT NULL AND level = 'write';

-- 4. Le journal des partages : qui (`actor_user_id`, `auth.uid()` de la session ; nul hors d'une session), quel compte,
--    vers qui (`subject_kind`, `subject_id` : l'équipe ou la personne, nul pour l'organisation, ou une fois la personne
--    effacée), quel niveau (posé, ou retiré) et celui qu'il remplace, quand. Aucune clé vers les équipes ni les
--    personnes : la ligne survit au sujet, et le service la dit sans nom. Elle part avec son compte et son organisation.
CREATE TABLE platform.account_share_events (
    id bigint NOT NULL,
    org_id uuid NOT NULL,
    account_id uuid NOT NULL,
    action text NOT NULL,
    subject_kind text NOT NULL,
    subject_id uuid,
    level text NOT NULL,
    previous_level text,
    actor_user_id uuid,
    at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT account_share_events_action_check CHECK ((action = ANY (ARRAY['set'::text, 'removed'::text]))),
    CONSTRAINT account_share_events_subject_kind_check CHECK ((subject_kind = ANY (ARRAY['team'::text, 'user'::text, 'org'::text])))
);

COMMENT ON TABLE platform.account_share_events IS 'Journal des partages : chaque règle posée, remplacée ou retirée sur un compte de connecteur, par déclencheur sur access_rules.';

ALTER TABLE platform.account_share_events ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME platform.account_share_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

ALTER TABLE ONLY platform.account_share_events
    ADD CONSTRAINT account_share_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY platform.account_share_events
    ADD CONSTRAINT account_share_events_org_id_fkey FOREIGN KEY (org_id) REFERENCES platform.orgs(id) ON DELETE CASCADE;

ALTER TABLE ONLY platform.account_share_events
    ADD CONSTRAINT account_share_events_account_id_fkey FOREIGN KEY (account_id) REFERENCES platform.accounts(id) ON DELETE CASCADE;

CREATE INDEX idx_account_share_events_account_id ON platform.account_share_events USING btree (account_id, at DESC);

CREATE INDEX idx_account_share_events_org_id ON platform.account_share_events USING btree (org_id);

-- La RLS isole les organisations ; qui lit le journal d'un compte (qui le gère) est décidé par le service
-- (`listAccountShareJournal`). Aucune écriture accordée : seul le déclencheur écrit.
ALTER TABLE platform.account_share_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY account_share_events_select_member ON platform.account_share_events FOR SELECT TO authenticated USING ((org_id IN ( SELECT platform.member_orgs() AS member_orgs)));

GRANT SELECT ON TABLE platform.account_share_events TO authenticated;

-- 5. L'écrivain du journal, sur chaque règle d'un compte : posée (`set`), son niveau remplacé (`set`, l'ancien en
--    `previous_level` ; rien quand il ne change pas), retirée (`removed`, le niveau qui partait). Une règle retirée avec
--    son compte (cascade) n'écrit rien : la ligne partirait avec lui. `security definer` : le journal n'est accordé en
--    écriture à personne.
CREATE FUNCTION platform.account_share_journal() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_rule platform.access_rules;
begin
  v_rule := case when tg_op = 'DELETE' then old else new end;
  if v_rule.account_id is null then
    return null;
  end if;
  if tg_op = 'UPDATE' and new.level is not distinct from old.level then
    return null;
  end if;
  if tg_op = 'DELETE' and not exists (select 1 from platform.accounts a where a.id = old.account_id) then
    return null;
  end if;
  insert into platform.account_share_events (org_id, account_id, action, subject_kind, subject_id, level, previous_level, actor_user_id)
  values (
    v_rule.org_id,
    v_rule.account_id,
    case when tg_op = 'DELETE' then 'removed' else 'set' end,
    case when v_rule.subject_org then 'org' when v_rule.subject_team_id is not null then 'team' else 'user' end,
    coalesce(v_rule.subject_team_id, v_rule.subject_user_id),
    v_rule.level,
    case when tg_op = 'UPDATE' then old.level end,
    (select auth.uid())
  );
  return null;
end;
$$;

REVOKE ALL ON FUNCTION platform.account_share_journal() FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.account_share_journal() FROM anon;

CREATE TRIGGER access_rules_account_share_journal AFTER INSERT OR DELETE OR UPDATE OF level ON platform.access_rules FOR EACH ROW EXECUTE FUNCTION platform.account_share_journal();

-- 6. `forget_user` efface aussi la personne du journal des partages (auteur, sujet), sans retirer les gestes (le reste du
--    corps est celui de 20261003090000_v1_4_0.sql).
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
  -- le journal des partages (partage des comptes) : en dernier, après les règles retirées plus haut, que le
  -- déclencheur y a écrites ; la personne n'y reste ni comme auteur ni comme sujet, la ligne garde le geste
  update platform.account_share_events set actor_user_id = null where actor_user_id = p_user;
  update platform.account_share_events set subject_id = null where subject_kind = 'user' and subject_id = p_user;
end;
$$;

REVOKE ALL ON FUNCTION platform.forget_user(p_user uuid) FROM PUBLIC;

-- ROLLBACK: (jamais exécuté depuis le paquet)
--   forget_user : reprendre le corps de 20261003090000_v1_4_0.sql (point 6) ;
--   drop trigger access_rules_account_share_journal on platform.access_rules ;
--   drop function platform.account_share_journal() ;
--   drop table platform.account_share_events ;
--   update platform.access_rules set level = 'write' where level = 'sensitive' ;
--   delete from platform.access_rules where subject_org and account_id is not null ;
--   alter table platform.access_rules drop constraint access_rules_one_subject, add constraint access_rules_one_subject
--     check (((num_nonnulls(subject_team_id, subject_user_id) + (subject_org)::integer) = 1) and ((not subject_org) or (node_id is not null))) ;
--   alter table platform.access_rules drop constraint access_rules_level_check, add constraint access_rules_level_check
--     check ((level = any (array['none'::text, 'read'::text, 'write'::text, 'manage'::text]))).
