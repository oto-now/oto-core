-- Les vues des pages (1.4.13) : une ligne par page, par personne et par jour, avec le nombre de fois où la page de
-- l'hôte l'a affichée. L'accueil en tire « Les plus consultés » (avec les lectures des assistants, que le journal porte
-- déjà) et la date de la dernière visite, qui borne « Nouveautés depuis votre dernière visite ». Sans elle, une page lue
-- à l'écran ne se compte nulle part : le journal ne garde que les écritures de l'écran.
--
-- Le jour est celui de l'horloge de la base (`current_date`, valeur par défaut, jamais accordée en insertion) ; une vue
-- de plus le même jour augmente `views` (`insert … on conflict do update`, d'où l'`update` accordé sur `views` et
-- `last_at` seuls). La personne n'écrit que ses propres lignes, sur une page de son organisation qu'elle lit ; tout
-- membre lit les lignes de son organisation (le service n'en rend que des comptes). Les lignes de plus de 90 jours se
-- retirent par le service à chaque vue (`delete` borné à elles) : aucune tâche planifiée, comme la corbeille. Une
-- personne retirée de l'organisation, ou oubliée (`forget_user`), emporte ses lignes (clé vers `members`, en cascade) ;
-- une page purgée de la corbeille aussi (clé vers `nodes`). Un seul bloc ROLLBACK en fin de fichier.

CREATE TABLE platform.node_views (
    org_id uuid NOT NULL,
    node_id uuid NOT NULL,
    user_id uuid NOT NULL,
    day date DEFAULT CURRENT_DATE NOT NULL,
    views integer DEFAULT 1 NOT NULL,
    last_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT node_views_views_check CHECK (((views >= 1) AND (views <= 1000000)))
);

COMMENT ON TABLE platform.node_views IS 'Vues des pages à l''écran (1.4.13) : une ligne par page, personne et jour, le nombre de vues ; 90 jours, retirées par le service.';

ALTER TABLE ONLY platform.node_views
    ADD CONSTRAINT node_views_pkey PRIMARY KEY (org_id, node_id, user_id, day);

ALTER TABLE ONLY platform.node_views
    ADD CONSTRAINT node_views_org_id_fkey FOREIGN KEY (org_id) REFERENCES platform.orgs(id) ON DELETE CASCADE;

ALTER TABLE ONLY platform.node_views
    ADD CONSTRAINT node_views_node_id_fkey FOREIGN KEY (node_id) REFERENCES platform.nodes(id) ON DELETE CASCADE;

ALTER TABLE ONLY platform.node_views
    ADD CONSTRAINT node_views_member_fkey FOREIGN KEY (org_id, user_id) REFERENCES platform.members(org_id, user_id) ON DELETE CASCADE;

-- Les comptes de l'organisation sur une période, et le ménage des lignes trop anciennes.
CREATE INDEX idx_node_views_org_id_day ON platform.node_views USING btree (org_id, day);

-- La dernière visite d'une personne.
CREATE INDEX idx_node_views_org_id_user_id_day ON platform.node_views USING btree (org_id, user_id, day);

-- La cascade d'un nœud supprimé (purge de la corbeille) : sans lui, chaque suppression parcourrait la table.
CREATE INDEX idx_node_views_node_id ON platform.node_views USING btree (node_id);

ALTER TABLE platform.node_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS node_views_select_member ON platform.node_views;
CREATE POLICY node_views_select_member ON platform.node_views FOR SELECT TO authenticated USING ((org_id IN ( SELECT platform.member_orgs() AS member_orgs)));

DROP POLICY IF EXISTS node_views_insert_own ON platform.node_views;
CREATE POLICY node_views_insert_own ON platform.node_views FOR INSERT TO authenticated WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND (org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND (EXISTS ( SELECT 1 FROM platform.nodes n WHERE ((n.id = node_views.node_id) AND (n.org_id = node_views.org_id))))));

DROP POLICY IF EXISTS node_views_update_own ON platform.node_views;
CREATE POLICY node_views_update_own ON platform.node_views FOR UPDATE TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND (org_id IN ( SELECT platform.member_orgs() AS member_orgs)))) WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND (org_id IN ( SELECT platform.member_orgs() AS member_orgs))));

DROP POLICY IF EXISTS node_views_delete_expired ON platform.node_views;
CREATE POLICY node_views_delete_expired ON platform.node_views FOR DELETE TO authenticated USING (((org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND (day < (CURRENT_DATE - 90))));

GRANT SELECT,DELETE ON TABLE platform.node_views TO authenticated;

GRANT INSERT(org_id),INSERT(node_id),INSERT(user_id) ON TABLE platform.node_views TO authenticated;

GRANT UPDATE(views),UPDATE(last_at) ON TABLE platform.node_views TO authenticated;

-- ROLLBACK: (jamais exécuté depuis le paquet)
--   drop table platform.node_views.
