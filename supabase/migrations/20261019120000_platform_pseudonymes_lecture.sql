-- La lecture de `platform.pseudonym_orgs` par les membres (pseudonymisation, J2) : toute table de `platform` porte la RLS
-- et une politique, et une session y lit les lignes de ses organisations, rien d'autre (suite d'isolation, AC1 et AC3).
-- La ligne d'une organisation ne nomme personne et ne porte aucune clé : version de clé, sel, témoin de la clé maître
-- (six octets de son empreinte) et génération ; sans la clé maître, le sel ne calcule aucun jeton. Le serveur continue
-- de la lire et de l'écrire par `platform.pseudonym_org` et `platform.invalidate_pseudonyms` ; aucune session ne
-- l'écrit. Un seul bloc ROLLBACK en fin de fichier.

GRANT SELECT ON TABLE platform.pseudonym_orgs TO authenticated;

CREATE POLICY pseudonym_orgs_select_member ON platform.pseudonym_orgs
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT platform.member_orgs()));

-- ROLLBACK: (jamais exécuté depuis le paquet)
--   drop policy pseudonym_orgs_select_member on platform.pseudonym_orgs ;
--   revoke select on table platform.pseudonym_orgs from authenticated.
