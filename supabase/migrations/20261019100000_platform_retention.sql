-- La rétention du journal et des retours (pseudonymisation, § Les quatre primitives) : l'hôte fixe une durée, en jours,
-- pour toutes ses organisations, et son outillage purge ce qui la dépasse (`oto-platform journal purge`,
-- connexion d'administration). Le journal des appels, celui de l'équipe plateforme (`admin_journal`, même durée) et les tickets
-- `feedback`. Sans durée, rien n'est purgé, comme avant. Un seul bloc ROLLBACK en fin de fichier.

-- `purge_expired` lit le journal et celui de l'équipe par date, toutes organisations, par leurs index `idx_journal_ts` et
-- `idx_admin_journal_ts` (base v1) ; les retours, peu nombreux, sans index propre.
-- `purge_expired` : les lignes plus anciennes que la durée, retirées ; une durée nulle laisse sa table telle quelle ;
--    une durée hors de 1 à 36 500 jours est refusée. Rend le nombre de lignes retirées par table. Réservée à la connexion
--    d'administration : aucun rôle de session ne l'exécute.
CREATE FUNCTION platform.purge_expired(journal_days integer, feedback_days integer)
RETURNS TABLE(journal bigint, admin_journal bigint, feedback bigint)
LANGUAGE plpgsql
SET search_path TO ''
AS $$
declare
  v_journal bigint := 0;
  v_admin bigint := 0;
  v_feedback bigint := 0;
begin
  if journal_days is not null and (journal_days < 1 or journal_days > 36500) then
    raise exception 'journal_days must be between 1 and 36500 (got %)', journal_days using errcode = '22023';
  end if;
  if feedback_days is not null and (feedback_days < 1 or feedback_days > 36500) then
    raise exception 'feedback_days must be between 1 and 36500 (got %)', feedback_days using errcode = '22023';
  end if;
  if journal_days is not null then
    delete from platform.journal where ts < now() - make_interval(days => journal_days);
    get diagnostics v_journal = row_count;
    delete from platform.admin_journal where ts < now() - make_interval(days => journal_days);
    get diagnostics v_admin = row_count;
  end if;
  if feedback_days is not null then
    delete from platform.feedback where created_at < now() - make_interval(days => feedback_days);
    get diagnostics v_feedback = row_count;
  end if;
  return query select v_journal, v_admin, v_feedback;
end;
$$;

REVOKE ALL ON FUNCTION platform.purge_expired(journal_days integer, feedback_days integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.purge_expired(journal_days integer, feedback_days integer) FROM anon;
REVOKE ALL ON FUNCTION platform.purge_expired(journal_days integer, feedback_days integer) FROM authenticated;

-- ROLLBACK: (jamais exécuté depuis le paquet)
--   drop function platform.purge_expired(integer, integer).
