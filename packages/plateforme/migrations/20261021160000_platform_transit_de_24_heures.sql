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
