-- L'écran Connecteurs, lot 1 (connecteurs et comptes, § Écran Connecteurs) : un membre décrit et renomme un compte
-- qu'il gère, le teste, et le libellé d'un compte devient unique pour son propriétaire, et non plus dans toute
-- l'organisation. Additif : une colonne, un droit, une fonction, une règle d'insertion, un index unique remplacé
-- par un plus large, qui admet toute ligne qu'admettait l'ancien. Un seul bloc ROLLBACK en fin de fichier.

-- 1. La description d'un compte : écrite par qui le gère, 200 caractères au plus, lue par les membres (écran
--    Connecteurs) et servie à l'assistant comme une donnée citée. `null` : aucune. Lue par `authenticated` ; jamais
--    insérée par lui (un compte neuf n'en a pas), modifiée sous le rôle du serveur seul.
ALTER TABLE platform.accounts ADD COLUMN description text;

ALTER TABLE platform.accounts ADD CONSTRAINT accounts_description_check CHECK ((char_length(description) <= 200));

GRANT SELECT(description) ON TABLE platform.accounts TO authenticated;

-- 2. Renommer et décrire un compte (`updateAccount`) : le service décide, puis écrit sous le rôle du serveur, comme
--    l'état et le secret d'un compte (`20261019130000`).
GRANT UPDATE(label,description) ON TABLE platform.accounts TO platform_server;

-- 3. Le dernier test d'un compte (`probeAccount`), rangé dans `health` sous `last_probe` (`{at, healthy, reason,
--    balance}`), à côté de la marque : `health` ne s'écrit que par des fonctions étroites (`20261017150000`). Pose le
--    test d'un compte d'une organisation de l'appelant, et rien d'autre : aucune autre clé de `health`, aucune autre
--    colonne ; la date est celle de la base. Réservée au rôle du serveur : l'issue vient de la réponse du tiers. Refus :
--    une issue absente ou un solde mal formé (22023) ; un compte inconnu ou d'une autre organisation (42501).
CREATE FUNCTION platform.record_account_probe(p_account uuid, p_healthy boolean, p_reason text, p_balance jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_probe jsonb;
begin
  if p_healthy is null then
    raise exception 'probe without an outcome' using errcode = '22023';
  end if;
  if p_balance is not null and not (
       jsonb_typeof(p_balance) = 'object'
       and (select count(*) from jsonb_object_keys(p_balance)) = 3
       and jsonb_typeof(p_balance -> 'value') in ('number', 'null')
       and jsonb_typeof(p_balance -> 'unit') = 'string'
       and jsonb_typeof(p_balance -> 'min') = 'number') then
    raise exception 'probe balance of an unknown shape' using errcode = '22023';
  end if;
  v_probe := jsonb_build_object('at', to_jsonb(now()), 'healthy', p_healthy, 'reason', left(p_reason, 1000), 'balance', coalesce(p_balance, 'null'::jsonb));
  update platform.accounts a
     set health = jsonb_set(coalesce(a.health, '{}'::jsonb), '{last_probe}', v_probe)
   where a.id = p_account and a.org_id in (select platform.member_orgs());
  if not found then
    raise exception 'account not reachable' using errcode = '42501';
  end if;
  return v_probe;
end
$$;

REVOKE ALL ON FUNCTION platform.record_account_probe(p_account uuid, p_healthy boolean, p_reason text, p_balance jsonb) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION platform.record_account_probe(p_account uuid, p_healthy boolean, p_reason text, p_balance jsonb) TO platform_server;

-- 4. Le libellé d'un compte, unique sans casse pour un même propriétaire (l'organisation, une équipe, une personne) :
--    deux propriétaires peuvent nommer leurs comptes pareil, et deux homonymes visibles se départagent à l'appel
--    (`ambiguous_named`). `nulls not distinct` : les comptes de l'organisation (sans équipe ni personne) restent
--    uniques entre eux. Le nouvel index couvre les clés de l'ancien et en ajoute : il admet toute ligne qu'il admettait.
CREATE UNIQUE INDEX uq_accounts_owner_label ON platform.accounts USING btree (org_id, owner_kind, owner_team_id, owner_user_id, lower(label)) NULLS NOT DISTINCT;

DROP INDEX platform.uq_accounts_org_id_label;

-- 5. L'activation implicite (`createAccount`, `enableAccount`) : le premier compte d'un connecteur jamais activé l'active,
--    au nom de l'appelant, membre ou administrateur. Le service décide (connecteur jamais activé, plafond
--    `connectors_max`) puis écrit sous le rôle du serveur ; `authenticated` reste borné aux administrateurs. Une ligne
--    active seulement, de l'organisation de l'appelant, à son nom : jamais la réouverture d'un connecteur fermé (une
--    mise à jour, que cette règle n'ouvre pas).
CREATE POLICY connector_activations_insert_server ON platform.connector_activations FOR INSERT TO platform_server WITH CHECK (((org_id IN ( SELECT platform.member_orgs() AS member_orgs)) AND (activated_by = ( SELECT auth.uid() AS uid)) AND (state = 'active'::text)));

-- ROLLBACK: (jamais exécuté depuis le paquet)
--   create unique index uq_accounts_org_id_label on platform.accounts (org_id, lower(label)) (échoue si deux
--     propriétaires portent le même libellé : en renommer un d'abord) ; drop index platform.uq_accounts_owner_label ;
--   drop policy connector_activations_insert_server on platform.connector_activations ;
--   drop function platform.record_account_probe(uuid, boolean, text, jsonb) ; update platform.accounts set health = health - 'last_probe' ;
--   revoke update(label, description) on platform.accounts from platform_server ;
--   alter table platform.accounts drop constraint accounts_description_check, drop column description.
