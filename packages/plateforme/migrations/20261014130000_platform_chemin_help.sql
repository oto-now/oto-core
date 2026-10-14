-- Version 1.4.3 du paquet : le chemin réservé `help`, où `read` sert le guide de la plateforme (nœuds et arbre) : aucune
-- équipe ne le prend pour dossier, comme `functions` (20260930150000_v1_1_3.sql). Une équipe dont le slug est déjà `help`
-- fait échouer cette migration : lui donner un autre slug avant d'appliquer (`update platform.teams set slug = …`).

ALTER TABLE platform.teams DROP CONSTRAINT teams_slug_reserved, ADD CONSTRAINT teams_slug_reserved CHECK ((slug <> ALL (ARRAY['guide'::text, 'perso'::text, 'private'::text, 'contexte'::text, 'journal'::text, 'functions'::text, 'help'::text])));

-- ROLLBACK: (jamais exécuté depuis le paquet)
--   teams_slug_reserved : reprendre 20260930150000_v1_1_3.sql.
