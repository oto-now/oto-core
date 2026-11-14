-- Version 1.7.0 du paquet (un seul fichier de migration par version publiée, database-patterns.md § Règles) : les
-- deux migrations ajoutées depuis 1.6.2, réunies au contenu identique, dans l'ordre de leurs horodatages, chacune
-- précédée d'une bannière qui nomme son sujet et son fichier d'origine. Aucune ligne n'est changée : chaque partie
-- garde son bloc ROLLBACK (commentaire, jamais exécuté) à sa fin ; pour défaire, les parties dans l'ordre inverse.
-- Aucune version publiée ne portait les deux fichiers d'origine : une base qui en avait appliqué un avant la réunion
-- (base de développement, projet de test) suit `migrations/README.md` § « Hôtes qui avaient appliqué une migration
-- de la 1.7.0 ».

-- ====================================================================================================
-- Partie 1 sur 2 : les commentaires d'une page, écrite en 20261112090000_platform_commentaires.sql.
-- ====================================================================================================

-- Les commentaires d'une page (parcours 5.4, « commenter un contenu ») : des fils de discussion entre les personnes qui
-- lisent une page, une procédure, un Contexte ou un tableau. Sans eux, une personne qui lit une page ne peut rien y
-- signaler sans la modifier. Deux tables :
-- - `comment_threads`, un fil : son nœud, le bloc publié qu'il commente (`block_id`, nul pour la page entière ; sans clé
--   étrangère, la clé de `blocks` étant `(id, state)`), un passage cité en option, la révision du bloc au moment du
--   commentaire, son état (`open`, `resolved`), qui l'a résolu et quand ;
-- - `comments`, un commentaire d'un fil : son auteur (nul quand la personne est oubliée), son texte, les membres qu'il
--   mentionne, la date de sa dernière modification (nulle tant que le texte n'a pas changé), s'il s'adresse à l'assistant
--   (`to_assistant` : son texte porte `@assistant`, relu à chaque modification) et s'il a été écrit par l'assistant de son
--   auteur (`via_assistant` : par une fonction de `call`, posé à l'écriture, jamais modifié).
-- « Passage modifié depuis » et « passage supprimé » ne s'écrivent pas : le service les calcule à la lecture, sur les blocs
-- publiés du nœud. Aucune règle d'accès propre : les fils suivent la page. Une page purgée de la corbeille emporte ses
-- fils (clé vers `nodes`, en cascade), une organisation supprimée aussi (clé vers `orgs`) ; à la corbeille, la page ne
-- sert plus aucun fil.
--
-- Le rôle est repris en base (doctrine de `20261021090000` à `20261021150000`), chaque accès à la règle de son service
-- (`server/comments/`), ni plus dure ni plus large :
-- - lecture d'un fil : la lecture (1) de son nœud, hors corbeille (`findNode`, `listComments`) ; un commentaire se lit
--   quand son fil se lit (`comment_threads_select_reader`) ;
-- - ajout d'un fil ou d'un commentaire : l'appelant pour lui-même (`created_by`, `author` = `auth.uid()`), sur un nœud
--   qu'il lit (`postComment`) ; un fil naît ouvert ;
-- - état d'un fil : son auteur, ou l'écriture (2) du nœud (`setThreadStatus`) ; seules `status`, `resolved_by` et
--   `resolved_at` se modifient, et qui résout se nomme lui-même ;
-- - suppression d'un fil : son auteur, qui est l'auteur de son premier commentaire (`deleteComment`) ; ses réponses partent
--   avec lui (clé en cascade) ;
-- - texte d'un commentaire et sa suppression : son auteur seul, l'administrateur non plus (`editComment`,
--   `deleteComment`) ; seules `text`, `mentions`, `edited_at` et `to_assistant` se modifient.
-- La policy de lecture s'applique aussi à une modification et à une suppression : l'auteur d'un commentaire sur une page
-- qu'il ne lit plus n'y touche plus. Coût : comme `20261021130000`, la sous-requête de niveau porte `offset 0`, qui la
-- garde corrélée (un appel de `node_level_for` par fil lu, jamais par nœud de l'organisation).
--
-- `forget_user` est re-versionnée à signature identique : les commentaires de la personne restent sans auteur, ses fils
-- sans auteur ni « résolu par », et elle sort des mentions (le reste du corps est celui de `20261018090000`). Additive ;
-- rien à relancer avant. Un seul bloc ROLLBACK en fin de fichier.
--
-- L'email groupé des commentaires (`oto-platform comments notify`, lancée chaque heure par l'hôte) tient son état dans
-- deux tables, écrites par la seule connexion d'administration de la commande, jamais par une session :
-- - `comment_mails`, une ligne par personne et par organisation : l'heure de son dernier email groupé. Sans elle, rien
--   ne tient « un email par heure au plus » quand la commande est lancée plus souvent ;
-- - `comment_mail_items`, une ligne par commentaire et par personne : ce commentaire lui a été envoyé. Sans elle, une
--   commande relancée renverrait les mêmes commentaires.
-- Les deux suivent le membre (clé vers `members`, en cascade : une personne retirée de l'organisation ou oubliée n'y
-- laisse rien, `forget_user` supprimant ses lignes `members`) ; un commentaire supprimé emporte ses envois. Chaque
-- personne y lit ses propres lignes, rien d'autre.

-- 1. Les fils.
CREATE TABLE platform.comment_threads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    node_id uuid NOT NULL,
    block_id uuid,
    quote text,
    block_revision integer,
    status text DEFAULT 'open'::text NOT NULL,
    resolved_by uuid,
    resolved_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT comment_threads_status_check CHECK ((status = ANY (ARRAY['open'::text, 'resolved'::text]))),
    CONSTRAINT comment_threads_quote_check CHECK (((quote IS NULL) OR ((char_length(quote) >= 1) AND (char_length(quote) <= 500)))),
    CONSTRAINT comment_threads_anchor_check CHECK ((((block_id IS NULL) AND (quote IS NULL) AND (block_revision IS NULL)) OR ((block_id IS NOT NULL) AND (block_revision IS NOT NULL)))),
    CONSTRAINT comment_threads_resolution_check CHECK ((((status = 'open'::text) AND (resolved_by IS NULL) AND (resolved_at IS NULL)) OR ((status = 'resolved'::text) AND (resolved_at IS NOT NULL))))
);

COMMENT ON TABLE platform.comment_threads IS 'Fils de commentaires d''un nœud : le bloc publié commenté (nul pour la page entière), un passage cité, la révision du bloc au moment du commentaire, l''état (open, resolved).';

ALTER TABLE ONLY platform.comment_threads
    ADD CONSTRAINT comment_threads_pkey PRIMARY KEY (id);

ALTER TABLE ONLY platform.comment_threads
    ADD CONSTRAINT comment_threads_org_id_fkey FOREIGN KEY (org_id) REFERENCES platform.orgs(id) ON DELETE CASCADE;

ALTER TABLE ONLY platform.comment_threads
    ADD CONSTRAINT comment_threads_node_id_fkey FOREIGN KEY (node_id) REFERENCES platform.nodes(id) ON DELETE CASCADE;

-- Les fils d'un nœud, ouverts ou résolus (`listComments`) ; la cascade d'un nœud purgé.
CREATE INDEX idx_comment_threads_node_id_status ON platform.comment_threads USING btree (node_id, status);

-- La cascade d'une organisation supprimée.
CREATE INDEX idx_comment_threads_org_id ON platform.comment_threads USING btree (org_id);

ALTER TABLE platform.comment_threads ENABLE ROW LEVEL SECURITY;

-- 2. Les commentaires.
CREATE TABLE platform.comments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    thread_id uuid NOT NULL,
    author uuid,
    text text NOT NULL,
    mentions uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    edited_at timestamp with time zone,
    to_assistant boolean DEFAULT false NOT NULL,
    via_assistant boolean DEFAULT false NOT NULL,
    CONSTRAINT comments_text_check CHECK (((char_length(text) >= 1) AND (char_length(text) <= 4000))),
    CONSTRAINT comments_mentions_check CHECK ((cardinality(mentions) <= 50))
);

COMMENT ON TABLE platform.comments IS 'Commentaires d''un fil : l''auteur (nul quand la personne est oubliée), le texte (1 à 4 000 caractères), les membres mentionnés, la date de la dernière modification du texte, s''il s''adresse à l''assistant (@assistant) et s''il a été écrit par l''assistant de son auteur.';

ALTER TABLE ONLY platform.comments
    ADD CONSTRAINT comments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY platform.comments
    ADD CONSTRAINT comments_org_id_fkey FOREIGN KEY (org_id) REFERENCES platform.orgs(id) ON DELETE CASCADE;

ALTER TABLE ONLY platform.comments
    ADD CONSTRAINT comments_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES platform.comment_threads(id) ON DELETE CASCADE;

-- Les commentaires d'un fil dans l'ordre (`listComments`) ; la cascade d'un fil supprimé.
CREATE INDEX idx_comments_thread_id_created_at ON platform.comments USING btree (thread_id, created_at);

-- La cascade d'une organisation supprimée.
CREATE INDEX idx_comments_org_id ON platform.comments USING btree (org_id);

-- Les commentaires adressés à l'assistant d'une organisation, par fil : les pages en attente d'un assistant que sert
-- `context` (`pagesWaitingAssistant`).
CREATE INDEX idx_comments_org_id_thread_id_to_assistant ON platform.comments USING btree (org_id, thread_id) WHERE to_assistant;

ALTER TABLE platform.comments ENABLE ROW LEVEL SECURITY;

-- 3. `comment_threads`, lecture : la lecture (1) du nœud, hors corbeille.
DROP POLICY IF EXISTS comment_threads_select_reader ON platform.comment_threads;
CREATE POLICY comment_threads_select_reader ON platform.comment_threads FOR SELECT TO authenticated USING (((org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND (EXISTS ( SELECT 1
   FROM platform.nodes n
  WHERE ((n.id = comment_threads.node_id) AND (n.org_id = comment_threads.org_id) AND (n.deleted_at IS NULL) AND (platform.node_level_for(n.org_id, n.lpath, n.owner_kind, n.owner_team_id, n.owner_user_id) >= 1))
 OFFSET 0))));

-- 4. `comment_threads`, ajout : l'appelant pour lui-même, un fil ouvert, sur un nœud qu'il lit.
DROP POLICY IF EXISTS comment_threads_insert_reader ON platform.comment_threads;
CREATE POLICY comment_threads_insert_reader ON platform.comment_threads FOR INSERT TO authenticated WITH CHECK (((created_by = ( SELECT auth.uid() AS uid)) AND (status = 'open'::text) AND (org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND (EXISTS ( SELECT 1
   FROM platform.nodes n
  WHERE ((n.id = comment_threads.node_id) AND (n.org_id = comment_threads.org_id) AND (n.deleted_at IS NULL) AND (platform.node_level_for(n.org_id, n.lpath, n.owner_kind, n.owner_team_id, n.owner_user_id) >= 1))
 OFFSET 0))));

-- 5. `comment_threads`, état : son auteur, ou l'écriture (2) du nœud ; qui résout se nomme lui-même.
DROP POLICY IF EXISTS comment_threads_update_resolver ON platform.comment_threads;
CREATE POLICY comment_threads_update_resolver ON platform.comment_threads FOR UPDATE TO authenticated USING (((org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND ((created_by = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM platform.nodes n
  WHERE ((n.id = comment_threads.node_id) AND (n.org_id = comment_threads.org_id) AND (n.deleted_at IS NULL) AND (platform.node_level_for(n.org_id, n.lpath, n.owner_kind, n.owner_team_id, n.owner_user_id) >= 2))
 OFFSET 0))))) WITH CHECK (((org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND ((resolved_by IS NULL) OR (resolved_by = ( SELECT auth.uid() AS uid))) AND ((created_by = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM platform.nodes n
  WHERE ((n.id = comment_threads.node_id) AND (n.org_id = comment_threads.org_id) AND (n.deleted_at IS NULL) AND (platform.node_level_for(n.org_id, n.lpath, n.owner_kind, n.owner_team_id, n.owner_user_id) >= 2))
 OFFSET 0)))));

-- 6. `comment_threads`, suppression : son auteur (le premier commentaire supprimé par son auteur emporte le fil).
DROP POLICY IF EXISTS comment_threads_delete_author ON platform.comment_threads;
CREATE POLICY comment_threads_delete_author ON platform.comment_threads FOR DELETE TO authenticated USING (((created_by = ( SELECT auth.uid() AS uid)) AND (org_id IN ( SELECT platform.member_orgs() AS member_orgs))));

GRANT SELECT,DELETE ON TABLE platform.comment_threads TO authenticated;

GRANT INSERT(org_id),INSERT(node_id),INSERT(block_id),INSERT(quote),INSERT(block_revision),INSERT(created_by) ON TABLE platform.comment_threads TO authenticated;

GRANT UPDATE(status),UPDATE(resolved_by),UPDATE(resolved_at) ON TABLE platform.comment_threads TO authenticated;

-- 7. `comments`, lecture : un commentaire se lit quand son fil se lit (la policy de lecture de `comment_threads` s'applique
--    à la sous-requête : la lecture du nœud, hors corbeille).
DROP POLICY IF EXISTS comments_select_reader ON platform.comments;
CREATE POLICY comments_select_reader ON platform.comments FOR SELECT TO authenticated USING (((org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND (EXISTS ( SELECT 1
   FROM platform.comment_threads t
  WHERE ((t.id = comments.thread_id) AND (t.org_id = comments.org_id))
 OFFSET 0))));

-- 8. `comments`, ajout : l'appelant pour lui-même, dans un fil qu'il lit, de la même organisation.
DROP POLICY IF EXISTS comments_insert_reader ON platform.comments;
CREATE POLICY comments_insert_reader ON platform.comments FOR INSERT TO authenticated WITH CHECK (((author = ( SELECT auth.uid() AS uid)) AND (org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND (EXISTS ( SELECT 1
   FROM platform.comment_threads t
  WHERE ((t.id = comments.thread_id) AND (t.org_id = comments.org_id))
 OFFSET 0))));

-- 9. `comments`, texte : son auteur seul.
DROP POLICY IF EXISTS comments_update_author ON platform.comments;
CREATE POLICY comments_update_author ON platform.comments FOR UPDATE TO authenticated USING (((author = ( SELECT auth.uid() AS uid)) AND (org_id IN ( SELECT platform.member_orgs() AS member_orgs)))) WITH CHECK (((author = ( SELECT auth.uid() AS uid)) AND (org_id IN ( SELECT platform.member_orgs() AS member_orgs))));

-- 10. `comments`, suppression : son auteur seul.
DROP POLICY IF EXISTS comments_delete_author ON platform.comments;
CREATE POLICY comments_delete_author ON platform.comments FOR DELETE TO authenticated USING (((author = ( SELECT auth.uid() AS uid)) AND (org_id IN ( SELECT platform.member_orgs() AS member_orgs))));

GRANT SELECT,DELETE ON TABLE platform.comments TO authenticated;

GRANT INSERT(org_id),INSERT(thread_id),INSERT(author),INSERT(text),INSERT(mentions),INSERT(to_assistant),INSERT(via_assistant) ON TABLE platform.comments TO authenticated;

GRANT UPDATE(text),UPDATE(mentions),UPDATE(edited_at),UPDATE(to_assistant) ON TABLE platform.comments TO authenticated;

-- 11. `forget_user` efface aussi la personne des commentaires : ses commentaires et ses fils restent, sans elle ; elle sort
--     des mentions (le reste du corps est celui de 20261018090000_platform_partage_des_comptes.sql).
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

-- 12. L'email groupé des commentaires : le dernier envoi à une personne, dans une organisation.
CREATE TABLE platform.comment_mails (
    org_id uuid NOT NULL,
    user_id uuid NOT NULL,
    sent_at timestamp with time zone NOT NULL
);

COMMENT ON TABLE platform.comment_mails IS 'Dernier email groupé des commentaires parti pour une personne, dans une organisation : un par heure au plus (oto-platform comments notify).';

ALTER TABLE ONLY platform.comment_mails
    ADD CONSTRAINT comment_mails_pkey PRIMARY KEY (org_id, user_id);

ALTER TABLE ONLY platform.comment_mails
    ADD CONSTRAINT comment_mails_org_id_fkey FOREIGN KEY (org_id) REFERENCES platform.orgs(id) ON DELETE CASCADE;

ALTER TABLE ONLY platform.comment_mails
    ADD CONSTRAINT comment_mails_member_fkey FOREIGN KEY (org_id, user_id) REFERENCES platform.members(org_id, user_id) ON DELETE CASCADE;

ALTER TABLE platform.comment_mails ENABLE ROW LEVEL SECURITY;

-- Chacun lit l'heure de son propre dernier email ; aucune écriture sous une session.
DROP POLICY IF EXISTS comment_mails_select_own ON platform.comment_mails;
CREATE POLICY comment_mails_select_own ON platform.comment_mails FOR SELECT TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND (org_id IN ( SELECT platform.member_orgs() AS member_orgs))));

GRANT SELECT ON TABLE platform.comment_mails TO authenticated;

-- 13. L'email groupé des commentaires : les commentaires déjà envoyés à une personne.
CREATE TABLE platform.comment_mail_items (
    comment_id uuid NOT NULL,
    user_id uuid NOT NULL,
    org_id uuid NOT NULL,
    sent_at timestamp with time zone NOT NULL
);

COMMENT ON TABLE platform.comment_mail_items IS 'Commentaires déjà envoyés à une personne dans un email groupé : une ligne par commentaire et par personne (oto-platform comments notify).';

ALTER TABLE ONLY platform.comment_mail_items
    ADD CONSTRAINT comment_mail_items_pkey PRIMARY KEY (comment_id, user_id);

ALTER TABLE ONLY platform.comment_mail_items
    ADD CONSTRAINT comment_mail_items_comment_id_fkey FOREIGN KEY (comment_id) REFERENCES platform.comments(id) ON DELETE CASCADE;

ALTER TABLE ONLY platform.comment_mail_items
    ADD CONSTRAINT comment_mail_items_org_id_fkey FOREIGN KEY (org_id) REFERENCES platform.orgs(id) ON DELETE CASCADE;

ALTER TABLE ONLY platform.comment_mail_items
    ADD CONSTRAINT comment_mail_items_member_fkey FOREIGN KEY (org_id, user_id) REFERENCES platform.members(org_id, user_id) ON DELETE CASCADE;

-- La cascade d'un membre retiré et d'une organisation supprimée.
CREATE INDEX idx_comment_mail_items_org_id_user_id ON platform.comment_mail_items USING btree (org_id, user_id);

ALTER TABLE platform.comment_mail_items ENABLE ROW LEVEL SECURITY;

-- Chacun lit ce qui lui a été envoyé ; aucune écriture sous une session.
DROP POLICY IF EXISTS comment_mail_items_select_own ON platform.comment_mail_items;
CREATE POLICY comment_mail_items_select_own ON platform.comment_mail_items FOR SELECT TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND (org_id IN ( SELECT platform.member_orgs() AS member_orgs))));

GRANT SELECT ON TABLE platform.comment_mail_items TO authenticated;

-- ROLLBACK: (jamais exécuté depuis le paquet)
--   drop table platform.comment_mail_items ;
--   drop table platform.comment_mails ;
--   forget_user : reprendre le corps de 20261018090000_platform_partage_des_comptes.sql (point 6) ;
--   drop table platform.comments ;
--   drop table platform.comment_threads.

-- ====================================================================================================
-- Partie 2 sur 2 : le contact d'une organisation réservé à ses membres et à l'équipe plateforme, écrite en 20261113090000_platform_contact_reserve.sql.
-- ====================================================================================================

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
