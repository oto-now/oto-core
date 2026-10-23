-- Version 1.6.0 du paquet (un seul fichier de migration par version publiée, database-patterns.md § Règles) : les
-- sept migrations ajoutées depuis 1.5.1, réunies au contenu identique, dans l'ordre de leurs horodatages, chacune
-- précédée d'une bannière qui nomme son sujet et son fichier d'origine. Aucune ligne n'est changée : chaque partie
-- garde son bloc ROLLBACK (commentaire, jamais exécuté) à sa fin ; pour défaire, les parties dans l'ordre inverse.
-- Aucune version publiée ne portait les sept fichiers d'origine : une base qui en avait appliqué un avant la réunion
-- (base de développement, projet de test) suit `migrations/README.md` § « Hôtes qui avaient appliqué une migration
-- de la 1.6.0 ».

-- ====================================================================================================
-- Partie 1 sur 7 : le fichier en transit dure 24 heures, écrite en 20261021160000_platform_transit_de_24_heures.sql.
-- ====================================================================================================

-- Le fichier en transit dure 24 heures au lieu d'une (fichiers et stockage, § Fichier en transit ; décision d'Alexis du
-- 21/10) : un fichier jamais consommé reste lisible par son auteur et compte au quota de l'organisation jusqu'à 24 h
-- après sa création, et un envoi au tiers en échec peut être retenté dans la journée. La durée vit à deux endroits qui
-- doivent concorder : `TRANSIT_HOURS` du service (`server/files/transit.ts`), qui pose l'échéance, et cette garde, qui
-- refuse toute autre valeur (42501). Le paquet et cette migration partent ensemble. Aucune ligne existante ne change :
-- un fichier déjà en transit garde son échéance d'une heure. Un seul bloc ROLLBACK en fin de fichier.

-- 1. La garde de l'échéance d'un fichier en transit, recréée sous son nom avec la nouvelle durée ; `expires_at_clock`
--    et les gardes de `upload_tickets` et de `connector_consents` ne changent pas.
DROP TRIGGER IF EXISTS files_expires_at_clock ON platform.files;
CREATE TRIGGER files_expires_at_clock BEFORE INSERT ON platform.files FOR EACH ROW WHEN ((new.node_id IS NULL)) EXECUTE FUNCTION platform.expires_at_clock('24 hours');

-- ROLLBACK: (jamais exécuté depuis le paquet ; avec le paquet de la version précédente, `TRANSIT_HOURS = 1`)
--   drop trigger files_expires_at_clock on platform.files ;
--   create trigger files_expires_at_clock before insert on platform.files for each row when ((new.node_id is null))
--     execute function platform.expires_at_clock('1 hour') ;

-- ====================================================================================================
-- Partie 2 sur 7 : la suppression d'une ligne de fichier exige l'écriture de son nœud (correctif de sécurité), écrite en 20261021170000_platform_role_dans_la_suppression_des_fichiers.sql.
-- ====================================================================================================

-- La suppression d'une ligne de fichier (base et portabilité, § Port de base ; suite de `20261021140000`, doctrine
-- décidée par Alexis le 20/10 ; issue #81). `files_delete_member` (`20261019090000`) laissait supprimer la ligne d'un
-- fichier joint à tout membre de l'organisation qui la voit, sans exiger l'écriture sur son nœud : avec son seul jeton,
-- sur un hôte qui exposerait `platform`, la lectrice d'une page d'équipe (niveau 1) effaçait la ligne d'un fichier qui
-- y est joint et laissait son objet orphelin dans le stockage. Aucun service ne le faisait : défense en profondeur.
--
-- Chaque suppression reprend la règle de son service, ni plus dure ni plus large :
-- - un fichier joint : l'écriture (2) de son nœud, celle qu'exige le service avant de le joindre (`requestFileUpload`,
--   `storeFile`) ; les suppressions sous une session sont celles d'un fichier que l'appelant vient d'envoyer à une page
--   qu'il écrit : sa ligne `pending` de taille fausse (`confirmObject`, `server/files/service.ts`) et les fichiers de la
--   page qu'il vient de créer, en révision 0 (`undoCreation`, `server/uploads-write.ts`) ; un fichier `ready` ne part
--   sinon qu'avec son nœud (cascade de `files.node_id`, purge de la corbeille par `purge_trash` et `erase_team_trash`) ;
-- - un fichier en transit : son seul auteur, comme avant (`expireTransitFile`, `server/files/transit.ts`) ; l'échu des
--   autres part par `purge_transit_files`.
-- La sous-requête porte `offset 0`, comme les policies de `20261021130000` : corrélée, son coût suit les lignes visées.
--
-- La purge des envois abandonnés (`purgePendingFiles`), une rétention de l'organisation que lance tout membre qui
-- demande un envoi ou ouvre la corbeille, comptait sur la policy large, et sous RLS ne voyait que les lignes que
-- l'appelant lit : un envoi abandonné sur une page qu'il ne lit pas restait, compté au quota. Elle passe par une
-- fonction `security definer`, sur le modèle de `purge_trash` : `purge_pending_files(org)`, membre de l'organisation
-- (`member_orgs`, accès plateforme en cours compris), sinon 42501 ; les lignes `pending` de plus d'une heure, délai
-- fixé ici, jamais passé par l'appelant : celles d'un fichier joint, sur toute page, lue ou non, et ses propres envois
-- en transit (ceux d'un autre, que la RLS lui cache, partent à leur échéance par `purge_transit_files`). Elle ne rend
-- que les identifiants, dont le service retire les objets après le commit ; aucun nom ni taille ne sort.
--
-- La policy est recréée sous son nom (`check:migrations` refuse un `drop` sans recréation, ADR-006 § 2). Un seul bloc
-- ROLLBACK en fin de fichier.

-- 1. `files`, suppression : un fichier joint, l'écriture (2) de son nœud ; un fichier en transit, son auteur.
DROP POLICY IF EXISTS files_delete_member ON platform.files;
CREATE POLICY files_delete_member ON platform.files FOR DELETE TO authenticated USING (((org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND (((node_id IS NULL) AND (created_by = ( SELECT auth.uid() AS uid))) OR ((node_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM platform.nodes n
  WHERE ((n.id = files.node_id) AND (n.org_id = files.org_id) AND (platform.node_level_for(n.org_id, n.lpath, n.owner_kind, n.owner_team_id, n.owner_user_id) >= 2))
 OFFSET 0))))));

-- 2. La purge des envois abandonnés de l'organisation (`purgePendingFiles`), pour un membre : les lignes `pending` de
--    plus d'une heure, jointes ou en transit de l'appelant.
CREATE FUNCTION platform.purge_pending_files(p_org uuid) RETURNS SETOF uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not coalesce(p_org in (select platform.member_orgs()), false) then
    raise exception 'the abandoned uploads of an organisation are purged by its members' using errcode = '42501';
  end if;
  return query
    delete from platform.files f
     where f.org_id = p_org and f.status = 'pending' and f.created_at < now() - interval '1 hour'
       and (f.node_id is not null or f.created_by = (select auth.uid()))
    returning f.id;
end;
$$;

REVOKE ALL ON FUNCTION platform.purge_pending_files(p_org uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.purge_pending_files(p_org uuid) TO authenticated;

-- ROLLBACK: (jamais exécuté depuis le paquet ; la policy reprend sa définition précédente, sous son nom)
--   drop function platform.purge_pending_files(uuid) ;
--   (et `server/files/service.ts` supprime les envois abandonnés sous la session, `PENDING_HOURS = 1`) ;
--   files_delete_member : drop, puis la définition de 20261019090000 (`node_id is not null or created_by = auth.uid()`).

-- ====================================================================================================
-- Partie 3 sur 7 : l'écriture des blocs jugée une fois par nœud et par instruction, écrite en 20261021180000_platform_ecriture_des_blocs_par_instruction.sql.
-- ====================================================================================================

-- L'écriture des blocs jugée une fois par nœud et par instruction (base et portabilité, § Les droits dans le service, la
-- RLS pour l'isolation ; suite de
-- `20261021120000` et `20261021130000`). Les policies d'écriture de `blocks` évaluaient `node_level_for` (environ
-- 0,2 ms) pour chaque ligne écrite, et le brouillon de chaque ligne sous la policy de `node_drafts`, qui l'évalue
-- encore : la page de 1 000 blocs qu'un écran écrit en une instruction (`insertBlocks` de `saveDraft`) en faisait des
-- milliers, et dépassait le délai d'instruction d'une session (57014) dès que la base était chargée. Laissé libre, le
-- planificateur pouvait aussi évaluer le `exists` d'une modification sur tous les nœuds de l'organisation (sous-plan
-- haché), à chaque ligne de tableau écrite.
--
-- La garantie ne change pas : sous une session (`authenticated`, `platform_server`), toute instruction qui ajoute,
-- modifie ou supprime un bloc d'un nœud que l'appelant n'écrit pas (niveau 2) est refusée en entier (42501). Elle
-- passe des policies à un déclencheur d'instruction, `blocks_write_guard`, sur les lignes écrites (tables de
-- transition) : un appel de `node_level_for` par nœud distinct, quel que soit le nombre de lignes. Ce qui reste aux
-- policies :
-- - l'ajout : l'auteur, le dernier auteur, l'organisation et la forme (brouillon hors ligne, ligne publiée), sans
--   sous-requête. L'existence du brouillon est déjà exigée, avant la policy, par `blocks_lock_draft` (PT409) ;
-- - la modification et la suppression d'une ligne d'un tableau : l'écriture du tableau, sur la seule ligne (`offset 0`,
--   jamais le sous-plan haché), pour qu'un membre qui lit le tableau touche zéro ligne au lieu d'un refus. Ces écritures
--   vont ligne par ligne (`updateRow`, `writeDecision`, `writePurge`), sauf `deleteJudged` ;
-- - la modification et la suppression d'un bloc de brouillon : rien de plus. Une instruction qui lit ses lignes (un
--   filtre, un `returning`) ne voit que le brouillon d'une page qu'on écrit (`blocks_select_level`,
--   `node_drafts_select_writer`) : zéro ligne ; une instruction sans filtre est refusée par le déclencheur.
-- La modification ne change ni le nœud ni l'état d'un bloc (`blocks_guard`) : son `with check` garde la forme et le
-- dernier auteur. Un bloc supprimé avec son nœud (cascade) passe : le nœud n'est plus là, sa suppression a été jugée sur
-- `nodes`. Les fonctions `security definer`, les cascades d'une suppression faite par elles et la connexion
-- d'administration ne passent ni par les policies ni par le déclencheur (`current_user`). Chaque policy est recréée sous
-- son nom (`check:migrations` refuse un `drop` sans recréation). Un seul bloc ROLLBACK en fin de fichier.

-- 1. Le déclencheur : l'écriture (2) de chaque nœud des lignes écrites, une fois par instruction.
CREATE FUNCTION platform.blocks_write_guard() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_node record;
begin
  if current_user not in ('authenticated', 'platform_server') then
    return null;
  end if;
  for v_node in
    select c.node_id, n.path,
           platform.node_level_for(n.org_id, n.lpath, n.owner_kind, n.owner_team_id, n.owner_user_id) >= 2 as writes
      from (select distinct r.node_id from changed_rows r) c
      left join platform.nodes n on n.id = c.node_id
  loop
    -- un bloc supprimé avec son nœud (cascade) : le nœud n'est plus là
    if not coalesce(v_node.writes, false) and not (tg_op = 'DELETE' and v_node.path is null) then
      raise exception 'platform.blocks: row-level security, writing the blocks of % needs the level 2 on it',
        coalesce(v_node.path, v_node.node_id::text)
        using errcode = '42501';
    end if;
  end loop;
  return null;
end;
$$;

REVOKE ALL ON FUNCTION platform.blocks_write_guard() FROM PUBLIC;

DROP TRIGGER IF EXISTS blocks_write_guard_insert ON platform.blocks;
CREATE TRIGGER blocks_write_guard_insert AFTER INSERT ON platform.blocks REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION platform.blocks_write_guard();
DROP TRIGGER IF EXISTS blocks_write_guard_update ON platform.blocks;
CREATE TRIGGER blocks_write_guard_update AFTER UPDATE ON platform.blocks REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION platform.blocks_write_guard();
DROP TRIGGER IF EXISTS blocks_write_guard_delete ON platform.blocks;
CREATE TRIGGER blocks_write_guard_delete AFTER DELETE ON platform.blocks REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION platform.blocks_write_guard();

-- 2. `blocks`, ajout : l'auteur, le dernier auteur nul ou l'appelant, l'organisation, la forme.
DROP POLICY IF EXISTS blocks_insert_writer ON platform.blocks;
CREATE POLICY blocks_insert_writer ON platform.blocks FOR INSERT TO authenticated WITH CHECK (((created_by = ( SELECT auth.uid() AS uid)) AND ((updated_by IS NULL) OR (updated_by = ( SELECT auth.uid() AS uid))) AND (org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND (((state = 'draft'::text) AND (type <> 'row'::text)) OR ((state = 'published'::text) AND (type = 'row'::text)))));

-- 3. `blocks`, modification : un bloc de brouillon, ou une ligne d'un tableau qu'on écrit, prise ligne à ligne ; la
--    ligne écrite garde la forme et le dernier auteur.
DROP POLICY IF EXISTS blocks_update_writer ON platform.blocks;
CREATE POLICY blocks_update_writer ON platform.blocks FOR UPDATE TO authenticated USING (((org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND (((state = 'draft'::text) AND (type <> 'row'::text)) OR ((state = 'published'::text) AND (type = 'row'::text) AND (EXISTS ( SELECT 1
   FROM platform.nodes n
  WHERE ((n.id = blocks.node_id) AND (platform.node_level_for(n.org_id, n.lpath, n.owner_kind, n.owner_team_id, n.owner_user_id) >= 2))
 OFFSET 0)))))) WITH CHECK (((org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND ((updated_by IS NULL) OR (updated_by = ( SELECT auth.uid() AS uid))) AND (((state = 'draft'::text) AND (type <> 'row'::text)) OR ((state = 'published'::text) AND (type = 'row'::text)))));

-- 4. `blocks`, suppression : un bloc de brouillon, ou une ligne d'un tableau qu'on écrit, prise ligne à ligne.
DROP POLICY IF EXISTS blocks_delete_writer ON platform.blocks;
CREATE POLICY blocks_delete_writer ON platform.blocks FOR DELETE TO authenticated USING (((org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND (((state = 'draft'::text) AND (type <> 'row'::text)) OR ((state = 'published'::text) AND (type = 'row'::text) AND (EXISTS ( SELECT 1
   FROM platform.nodes n
  WHERE ((n.id = blocks.node_id) AND (platform.node_level_for(n.org_id, n.lpath, n.owner_kind, n.owner_team_id, n.owner_user_id) >= 2))
 OFFSET 0))))));

-- ROLLBACK: (jamais exécuté depuis le paquet ; chaque policy reprend sa définition précédente, sous son nom)
--   drop trigger blocks_write_guard_insert on platform.blocks ; drop trigger blocks_write_guard_update on platform.blocks ;
--   drop trigger blocks_write_guard_delete on platform.blocks ; drop function platform.blocks_write_guard() ;
--   blocks_insert_writer, blocks_update_writer : drop, puis la définition de 20261021130000 ;
--   blocks_delete_writer : drop, puis la définition de 20261021120000.

-- ====================================================================================================
-- Partie 4 sur 7 : la trace d'un fichier en transit effacé, écrite en 20261021190000_platform_trace_des_fichiers_effaces.sql.
-- ====================================================================================================

-- La trace d'un fichier en transit effacé (fichiers et stockage, § Adresse unique et lecture d'un fichier en transit ;
-- durée décidée par Alexis le 21/10) : la purge des échus (`purge_transit_files`) et la consommation (`expireTransitFile`)
-- suppriment la ligne, et rien ne distinguait plus un fichier effacé d'un identifiant faux. Son auteur, qui ouvre
-- `/f/<id>` ou le lit par `read {file}`, apprend désormais quand et pourquoi il est parti, et quoi faire, pendant 30 jours.
--
-- La trace ne garde que ce que dit le refus : l'identifiant, l'organisation, l'auteur, la date et la cause ; ni nom, ni
-- taille, ni type. Elle est hors quota (`org_files_bytes` ne lit que `files`) et lisible par son seul auteur. Elle naît
-- d'un déclencheur sur la suppression d'une ligne `ready` en transit, quel que soit le chemin (purge, consommation, ou
-- suppression directe par l'auteur sous la RLS) : aucune trace ne dépend de la discipline d'un service. Une ligne
-- `pending` (envoi abandonné, objet qui ne s'est pas écrit) n'a jamais été lisible : aucune trace. La date est
-- l'échéance pour un fichier échu (il est illisible depuis, même purgé plus tard), l'heure de la suppression sinon.
-- Une personne retirée de l'organisation, ou oubliée, emporte ses traces (clé vers `members`, en cascade), et aucune ne
-- naît pour elle ; l'organisation supprimée aussi. Les traces de plus de 30 jours partent avec la purge des échus, à
-- chaque entrée en transit (aucune tâche planifiée) ; d'ici là, le service ne lit que celles dont `keep_until` n'est
-- pas passé. La durée vit ici seule. Un seul bloc ROLLBACK en fin de fichier.

-- 1. La table.
CREATE TABLE platform.erased_files (
    id uuid NOT NULL,
    org_id uuid NOT NULL,
    created_by uuid NOT NULL,
    erased_at timestamp with time zone NOT NULL,
    cause text NOT NULL,
    keep_until timestamp with time zone NOT NULL,
    CONSTRAINT erased_files_cause_check CHECK ((cause = ANY (ARRAY['expired'::text, 'consumed'::text])))
);

COMMENT ON TABLE platform.erased_files IS 'Traces des fichiers en transit effacés (échus ou consommés) : identifiant, auteur, date et cause, lisibles par l''auteur seul, 30 jours.';

ALTER TABLE ONLY platform.erased_files
    ADD CONSTRAINT erased_files_pkey PRIMARY KEY (id);

ALTER TABLE ONLY platform.erased_files
    ADD CONSTRAINT erased_files_org_id_fkey FOREIGN KEY (org_id) REFERENCES platform.orgs(id) ON DELETE CASCADE;

ALTER TABLE ONLY platform.erased_files
    ADD CONSTRAINT erased_files_member_fkey FOREIGN KEY (org_id, created_by) REFERENCES platform.members(org_id, user_id) ON DELETE CASCADE;

-- La purge des traces de plus de 30 jours d'une organisation.
CREATE INDEX idx_erased_files_org_id_keep_until ON platform.erased_files USING btree (org_id, keep_until);

-- La cascade d'une personne retirée : sans lui, chaque retrait parcourrait la table.
CREATE INDEX idx_erased_files_org_id_created_by ON platform.erased_files USING btree (org_id, created_by);

ALTER TABLE platform.erased_files ENABLE ROW LEVEL SECURITY;

-- 2. RLS : l'auteur seul lit ses traces ; personne ne les écrit sous une session (le déclencheur les pose, la purge les
--    retire, tous deux `security definer`).
DROP POLICY IF EXISTS erased_files_select_own ON platform.erased_files;
CREATE POLICY erased_files_select_own ON platform.erased_files FOR SELECT TO authenticated USING (((created_by = ( SELECT auth.uid() AS uid)) AND (org_id IN ( SELECT platform.member_orgs() AS member_orgs))));

GRANT SELECT ON TABLE platform.erased_files TO authenticated;

-- 3. Le déclencheur : la suppression d'une ligne `ready` en transit laisse sa trace, si son auteur est encore membre
--    (une organisation supprimée n'a plus de membres : la cascade ne laisse rien).
CREATE FUNCTION platform.files_erased_trace() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_at timestamptz := least(old.expires_at, now());
begin
  if exists (select 1 from platform.members m join platform.orgs o on o.id = m.org_id
              where m.org_id = old.org_id and m.user_id = old.created_by) then
    insert into platform.erased_files (id, org_id, created_by, erased_at, cause, keep_until)
    values (old.id, old.org_id, old.created_by, v_at,
            case when old.expires_at <= now() then 'expired' else 'consumed' end,
            v_at + interval '30 days');
  end if;
  return old;
end
$$;

REVOKE ALL ON FUNCTION platform.files_erased_trace() FROM PUBLIC;

CREATE TRIGGER files_erased_trace AFTER DELETE ON platform.files FOR EACH ROW WHEN (((old.node_id IS NULL) AND (old.status = 'ready'::text) AND (old.created_by IS NOT NULL))) EXECUTE FUNCTION platform.files_erased_trace();

-- 4. La purge des échus retire aussi les traces de l'organisation dont les 30 jours sont passés ; le reste à l'identique
--    de `20261019090000`.
CREATE OR REPLACE FUNCTION platform.purge_transit_files(p_org uuid) RETURNS SETOF uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not coalesce(p_org in (select platform.member_orgs()), false) then
    raise exception 'organisation not reachable' using errcode = '42501';
  end if;
  delete from platform.erased_files e where e.org_id = p_org and e.keep_until <= now();
  return query
    delete from platform.files f
     where f.org_id = p_org and f.node_id is null and f.expires_at <= now()
    returning f.id;
end
$$;

-- Réservée au rôle serveur, comme depuis `20261019130000` : `purgeTransitFiles` l'appelle sous `platform_server`.
REVOKE ALL ON FUNCTION platform.purge_transit_files(p_org uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION platform.purge_transit_files(p_org uuid) TO platform_server;

-- ROLLBACK: (jamais exécuté depuis le paquet ; avec le paquet de la version précédente)
--   purge_transit_files : la définition de 20261019090000 ;
--   drop trigger files_erased_trace on platform.files ; drop function platform.files_erased_trace() ;
--   drop table platform.erased_files.

-- ====================================================================================================
-- Partie 5 sur 7 : garder un fichier en transit sur une page (keep_transit_file), écrite en 20261021230000_platform_garder_un_fichier_en_transit.sql.
-- ====================================================================================================

-- Garder un fichier en transit sur une page (fichiers et stockage, § Garder un fichier en transit sur une page ; étape 3
-- du chantier « fichier », décidée par Alexis le 21/10) : `file.keep` insère un bloc média dans une page, et le fichier
-- y est joint, son échéance levée, sans copie. Les privilèges de `files` n'ouvrent aucune mise à jour de `node_id` ni
-- d'`expires_at` sous une session (seul `UPDATE(status)` est accordé) : le passage d'un état à l'autre vit ici, dans
-- une fonction `security definer`, qui refait la décision du service sans rien ouvrir d'autre.
--
-- `keep_transit_file(p_file, p_node)` joint la ligne au nœud et lève son échéance, dans une seule instruction, si :
-- l'appelant en est l'auteur, elle est en transit (`node_id` nul), `ready`, non échue (`expires_at > now()`), et le
-- nœud est de la même organisation, hors corbeille, n'est pas un tableau, et l'appelant l'écrit (`node_level_for` ≥ 2).
-- Sinon `42501`, sans dire lequel : le service a déjà rendu le refus qui le dit. La même instruction exclut une purge
-- concurrente (`expires_at <= now()`) et une consommation (`node_id is null`) : la ligne gardée n'est plus ni l'une ni
-- l'autre. Elle ne rend rien ; le service lit la ligne sous la RLS, désormais par la lecture du nœud. Le bloc qui montre
-- le fichier s'écrit dans la même transaction (`writeAtomically`) : un refus de l'écriture annule le rattachement.
-- Un seul bloc ROLLBACK en fin de fichier.

CREATE FUNCTION platform.keep_transit_file(p_file uuid, p_node uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  update platform.files f
     set node_id = n.id, expires_at = null
    from platform.nodes n
   where f.id = p_file
     and f.node_id is null
     and f.status = 'ready'
     and f.expires_at > now()
     and f.created_by = (select auth.uid())
     and f.org_id in (select platform.member_orgs())
     and n.id = p_node
     and n.org_id = f.org_id
     and n.deleted_at is null
     and n.kind <> 'table'
     and platform.node_level_for(n.org_id, n.lpath, n.owner_kind, n.owner_team_id, n.owner_user_id) >= 2;
  if not found then
    raise exception 'transit file not kept' using errcode = '42501';
  end if;
end
$$;

REVOKE ALL ON FUNCTION platform.keep_transit_file(p_file uuid, p_node uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.keep_transit_file(p_file uuid, p_node uuid) FROM anon;
GRANT ALL ON FUNCTION platform.keep_transit_file(p_file uuid, p_node uuid) TO authenticated;

-- ROLLBACK: (jamais exécuté depuis le paquet ; avec le paquet de la version précédente)
--   drop function platform.keep_transit_file(uuid, uuid).

-- ====================================================================================================
-- Partie 6 sur 7 : l'origine des fichiers, écrite en 20261021233000_platform_origine_des_fichiers.sql.
-- ====================================================================================================

-- L'origine d'un fichier (fichiers et stockage, § Origine d'un fichier ; étape 4 du chantier « fichier », décidée par
-- Alexis le 21/10) : chaque ligne `files` dit, une fois pour toutes, ce qui l'a produite. Une ligne d'avant reste sans
-- origine (« origine inconnue »), sans reprise.
--
-- - `origin_kind` : `upload` (déposé par une personne), `link` (déposé par un lien de dépôt), `function` (rendu par une
--   fonction) ; `origin_function` : la fonction (`upload.link`, `3cx.recording`), pour `link` et `function` ;
--   `origin_ctx` : la conversation de l'appel, s'il en a une. Écrits par le service ; la base vérifie que la conversation
--   est celle de l'auteur de la ligne, dans son organisation.
-- - `origin_by`, `origin_at` : l'auteur et la date de l'origine, posés par la base (`files_origin`), jamais par la
--   session (aucun `INSERT` accordé sur eux) : l'auteur et l'heure de la ligne. Une origine déjà datée est gardée telle
--   quelle : seule la connexion d'administration en écrit une, l'import d'une organisation (`scripts/org-import.mjs`), qui
--   reprend la sorte, la fonction, l'auteur et la date de la source.
-- - `copied_from` : pour une copie (garder sur une autre page, dupliquer une page), le fichier d'où elle vient. La copie
--   reprend l'origine de sa source, posée par la base : un fichier d'avant donne son auteur et sa date, sans le reste.
--   La source doit être de la même organisation et lue par l'appelant, sinon `42501` : on ne recopie pas l'origine d'un
--   fichier qu'on ne lit pas. La copie garde son origine quand la source disparaît (aucune clé vers elle).
-- - `origin_by` part avec la personne : retirée de l'organisation ou oubliée (`forget_user` supprime ses lignes
--   `members`), la clé la met à nul, la ligne garde la fonction et la date.
--
-- `duplicate_subtree` est recréée sous sa signature et son droit, sur le corps de 20261021100000 : ses copies portent
-- `copied_from`. Un seul bloc ROLLBACK en fin de fichier.

ALTER TABLE platform.files
    ADD COLUMN origin_kind text,
    ADD COLUMN origin_function text,
    ADD COLUMN origin_ctx text,
    ADD COLUMN origin_by uuid,
    ADD COLUMN origin_at timestamp with time zone,
    ADD COLUMN copied_from uuid;

ALTER TABLE ONLY platform.files
    ADD CONSTRAINT files_origin_kind_check CHECK (((origin_kind IS NULL) OR (origin_kind = ANY (ARRAY['upload'::text, 'link'::text, 'function'::text])))),
    ADD CONSTRAINT files_origin_function_check CHECK (((origin_function IS NULL) OR ((char_length(origin_function) >= 1) AND (char_length(origin_function) <= 200)))),
    ADD CONSTRAINT files_origin_by_fkey FOREIGN KEY (org_id, origin_by) REFERENCES platform.members(org_id, user_id) ON DELETE SET NULL (origin_by);

CREATE INDEX idx_files_origin_by ON platform.files USING btree (org_id, origin_by) WHERE (origin_by IS NOT NULL);

GRANT INSERT(origin_kind) ON TABLE platform.files TO authenticated;
GRANT INSERT(origin_function) ON TABLE platform.files TO authenticated;
GRANT INSERT(origin_ctx) ON TABLE platform.files TO authenticated;
GRANT INSERT(copied_from) ON TABLE platform.files TO authenticated;

-- L'origine d'une ligne neuve : celle de sa source pour une copie, sinon l'auteur et l'heure de la ligne, la conversation
-- vérifiée. `security definer` : elle lit la source et la conversation hors de la RLS, et refait elle-même la lecture.
CREATE FUNCTION platform.files_origin() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_source platform.files%rowtype;
begin
  if new.copied_from is not null then
    select f.* into v_source
      from platform.files f
      left join platform.nodes n on n.id = f.node_id
     where f.id = new.copied_from
       and f.org_id = new.org_id
       and (case when f.node_id is null then f.created_by = (select auth.uid())
                 else platform.node_level_for(n.org_id, n.lpath, n.owner_kind, n.owner_team_id, n.owner_user_id) >= 1 end);
    if not found then
      raise exception 'copied_from: no file of this organisation read by the caller' using errcode = '42501';
    end if;
    new.origin_kind := v_source.origin_kind;
    new.origin_function := v_source.origin_function;
    new.origin_ctx := v_source.origin_ctx;
    new.origin_at := coalesce(v_source.origin_at, v_source.created_at);
    new.origin_by := coalesce(v_source.origin_by, v_source.created_by);
  else
    if new.origin_ctx is not null and not exists (
      select 1 from platform.ctx c where c.code = new.origin_ctx and c.user_id = new.created_by and c.org_id = new.org_id
    ) then
      raise exception 'origin_ctx: not a conversation of the author in this organisation' using errcode = '42501';
    end if;
    -- Une origine datée vient de l'import d'une organisation (la session ne peut écrire ni `origin_at` ni `origin_by`).
    if new.origin_at is null then
      new.origin_at := now();
      new.origin_by := new.created_by;
    end if;
  end if;
  -- L'auteur n'est gardé que membre de l'organisation (la clé vers `members`) : sinon nul, la fonction et la date restent.
  if not exists (select 1 from platform.members m where m.org_id = new.org_id and m.user_id = new.origin_by) then
    new.origin_by := null;
  end if;
  return new;
end
$$;

REVOKE ALL ON FUNCTION platform.files_origin() FROM PUBLIC;

CREATE TRIGGER files_origin BEFORE INSERT ON platform.files FOR EACH ROW EXECUTE FUNCTION platform.files_origin();

-- `duplicate_subtree` (`duplicateNode`, `server/nodes/duplicate.ts`), sur le corps de 20261021100000 : la copie d'un
-- fichier porte `copied_from`.
CREATE OR REPLACE FUNCTION platform.duplicate_subtree(p_source uuid, p_nodes uuid[], p_segment text, p_title text, p_position double precision) RETURNS TABLE(source_id uuid, copy_id uuid, copy_path text, copied_files jsonb)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  v_uid uuid := (select auth.uid());
  v_source platform.nodes%rowtype;
  v_parent platform.nodes%rowtype;
  v_ids uuid[];
  v_path text;
  v_map jsonb := '{}'::jsonb;
  -- E10-S02 (AC-e3) : ancien identifiant de fichier → nouveau
  v_files jsonb;
  v_new uuid;
  r record;
begin
  if v_uid is null then
    raise exception 'duplicate_subtree needs a caller' using errcode = '42501';
  end if;
  select * into v_source from platform.nodes n where n.id = p_source and n.deleted_at is null;
  -- `duplicateNode` : le nœud lu (`findNode`), un nœud caché refusé comme un nœud inconnu (20261021100000).
  if v_source.id is null or v_source.parent_id is null
     or v_source.org_id not in (select platform.member_orgs())
     or platform.node_level_for(v_source.org_id, v_source.lpath, v_source.owner_kind, v_source.owner_team_id, v_source.owner_user_id) < 1 then
    raise exception 'node not found' using errcode = 'P0002';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(7301, pg_catalog.hashtext(v_source.org_id::text));
  select * into v_parent from platform.nodes n where n.id = v_source.parent_id;
  -- `duplicateNode` : l'écriture sous le parent, où la copie se pose et dont elle hérite (20261021100000).
  if platform.node_level_for(v_parent.org_id, v_parent.lpath, v_parent.owner_kind, v_parent.owner_team_id, v_parent.owner_user_id) < 2 then
    raise exception 'duplicating % needs the level 2 on its parent', v_source.path using errcode = '42501';
  end if;
  if p_title is null or char_length(btrim(p_title)) not between 1 and 200 then
    raise exception 'the title of the copy holds 1 to 200 characters' using errcode = '22023';
  end if;
  if p_segment is null or p_segment !~ '^[a-z0-9_]+$' then
    raise exception 'the segment of the copy is made of [a-z0-9_]' using errcode = '22023';
  end if;
  v_path := case when v_parent.parent_id is null then p_segment else v_parent.path || '/' || p_segment end;
  if exists (select 1 from platform.nodes n where n.org_id = v_source.org_id and n.path = v_path)
     or exists (select 1 from platform.node_aliases a where a.org_id = v_source.org_id and a.old_path = v_path) then
    raise exception 'path % is not available', v_path using errcode = '23505';
  end if;
  v_ids := array[p_source] || coalesce(p_nodes, '{}'::uuid[]);
  if exists (select 1 from unnest(coalesce(p_nodes, '{}'::uuid[])) as w(id)
               left join platform.nodes n on n.id = w.id
              where n.id is null or n.id = p_source or n.org_id <> v_source.org_id or n.deleted_at is not null
                 -- `copiedDescendants` : les seuls descendants que la personne lit (20261021100000)
                 or platform.node_level_for(n.org_id, n.lpath, n.owner_kind, n.owner_team_id, n.owner_user_id) < 1
                 or not (n.lpath operator(extensions.<@) v_source.lpath)
                 or not (n.parent_id = any (v_ids))) then
    raise exception 'each node to copy is a live descendant of the node, under a copied parent'
      using errcode = '22023';
  end if;

  -- E10-S02 (AC-e3) : un identifiant neuf pour chaque fichier d'un nœud copié qu'un bloc publié de ce nœud cite ;
  -- un fichier que seul un brouillon ou une version ancienne cite ne se lit pas dans la copie, il ne se copie pas.
  select coalesce(jsonb_object_agg(f.id::text, gen_random_uuid()), '{}'::jsonb) into v_files
    from platform.files f
   where f.org_id = v_source.org_id and f.node_id = any (v_ids)
     and exists (select 1 from platform.blocks b
                  where b.node_id = f.node_id and b.state = 'published' and b.type in ('file', 'image')
                    and b.data ->> 'file_id' = f.id::text);

  for r in select n.* from platform.nodes n where n.id = any (v_ids)
            order by extensions.nlevel(n.lpath), n.path loop
    v_new := gen_random_uuid();
    source_id := r.id;
    copy_id := v_new;
    copy_path := v_path || substr(r.path, char_length(v_source.path) + 1);
    -- E10-S02 (AC-e3) : les paires (ancien, nouveau) des fichiers de ce nœud
    copied_files := coalesce((select jsonb_object_agg(f.id::text, v_files -> f.id::text)
                                from platform.files f where f.node_id = r.id and v_files ? f.id::text), '{}'::jsonb);
    insert into platform.nodes (id, org_id, parent_id, path, kind, title, summary, status, revision, meta,
                                position, created_by, updated_by)
    values (v_new, r.org_id,
            case when r.id = p_source then r.parent_id else (v_map ->> r.parent_id::text)::uuid end,
            copy_path, r.kind, case when r.id = p_source then btrim(p_title) else r.title end, r.summary,
            case when r.revision > 0 then 'published' else 'draft' end,
            case when r.revision > 0 then 1 else 0 end,
            r.meta, case when r.id = p_source then p_position else r.position end, v_uid, v_uid);
    v_map := v_map || jsonb_build_object(r.id::text, v_new);
    return next;
  end loop;

  -- E10-S02 (AC-e3) : les fichiers copiés, `pending` sous la copie, jusqu'à la copie de leur objet par le service.
  -- Étape 4 du chantier « fichier » : la copie porte `copied_from`, et reprend l'origine de sa source (`files_origin`).
  insert into platform.files (id, org_id, node_id, name, mime, size, status, created_by, copied_from)
  select (v_files ->> f.id::text)::uuid, f.org_id, (v_map ->> f.node_id::text)::uuid, f.name, f.mime, f.size, 'pending', v_uid, f.id
    from platform.files f
   where f.org_id = v_source.org_id and v_files ? f.id::text;

  -- Blocs publiés et liens de ces blocs : un identifiant neuf par bloc, lu deux fois dans la même
  -- instruction (le `with` est calculé une fois ; l'insertion qu'il porte part même sans être lue).
  -- E10-S02 (AC-e3) : le `file_id` d'un bloc `file` ou d'une image jointe devient celui de la copie du fichier.
  with src as (
    select b.id, b.org_id, b.node_id, b.position, b.type, b.text,
           case when b.type in ('file', 'image') and v_files ? (b.data ->> 'file_id')
                then pg_catalog.jsonb_set(b.data, '{file_id}', v_files -> (b.data ->> 'file_id'))
                else b.data end as data,
           b.key, b.provenance, b.revision,
           gen_random_uuid() as new_id
      from platform.blocks b
     where b.node_id = any (v_ids) and b.state = 'published'
  ), copied as (
    insert into platform.blocks (id, state, org_id, node_id, position, type, text, data, key, provenance, revision,
                                 created_by, updated_by)
    select src.new_id, 'published', src.org_id, (v_map ->> src.node_id::text)::uuid, src.position, src.type, src.text,
           src.data, src.key, src.provenance, src.revision, v_uid, v_uid
      from src
  )
  insert into platform.links (org_id, source_node_id, source_block_id, target_path, target_key, target_node_id)
  select l.org_id, (v_map ->> l.source_node_id::text)::uuid, src.new_id, l.target_path, l.target_key, l.target_node_id
    from platform.links l
    join src on src.id = l.source_block_id
   where l.source_node_id = any (v_ids);

  -- L'instantané de la révision 1 d'une copie publiée, comme `publish_node` le prend.
  insert into platform.node_versions (node_id, revision, title, summary, kind, meta, blocks, author)
  select n.id, n.revision, n.title, n.summary, n.kind, n.meta,
         coalesce((select jsonb_agg(jsonb_build_object(
                             'id', b.id, 'type', b.type, 'position', b.position, 'key', b.key,
                             'text', b.text, 'data', b.data, 'provenance', b.provenance,
                             'revision', b.revision) order by b.position, b.id)
                     from platform.blocks b
                    where b.node_id = n.id and b.state = 'published' and b.type <> 'row'), '[]'::jsonb),
         v_uid
    from platform.nodes n
   where n.id in (select (e.value #>> '{}')::uuid from jsonb_each(v_map) e) and n.revision = 1;
end;
$_$;

REVOKE ALL ON FUNCTION platform.duplicate_subtree(p_source uuid, p_nodes uuid[], p_segment text, p_title text, p_position double precision) FROM PUBLIC;
GRANT ALL ON FUNCTION platform.duplicate_subtree(p_source uuid, p_nodes uuid[], p_segment text, p_title text, p_position double precision) TO authenticated;

-- ROLLBACK: (jamais exécuté depuis le paquet ; avec le paquet de la version précédente)
--   create or replace function platform.duplicate_subtree(…) … : le corps de 20261021100000 (§ 4) ;
--   drop trigger files_origin on platform.files ; drop function platform.files_origin() ;
--   revoke insert (origin_kind, origin_function, origin_ctx, copied_from) on platform.files from authenticated ;
--   drop index platform.idx_files_origin_by ;
--   alter table platform.files drop column origin_kind, drop column origin_function, drop column origin_ctx,
--     drop column origin_by, drop column origin_at, drop column copied_from.

-- ====================================================================================================
-- Partie 7 sur 7 : les travaux en tâche de fond des fonctions longues, écrite en 20261022230000_platform_travaux_en_tache_de_fond.sql.
-- ====================================================================================================

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
