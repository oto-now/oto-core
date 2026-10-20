# Golden Queries — éval AX du canal MCP

> Jeu de prompts anti-régression du routage et des outils. Règles d'usage :
> `.method/conventions/mcp-patterns.md` §8. Semé avec les phrases de la maquette des six outils,
> puis complété fonctionnalité par fonctionnalité ; toute évolution qui ajoute des phrases les écrit
> ici, dans la section de sa fonctionnalité.
>
> **Où se jouent les lignes.** Le préfixe est celui de l'organisation (ADR-002) :
> - `acme_` : contenu d'Acme, copié de la maquette dans `tests/integration/fixtures/` (E03-S02).
>   Les tests MCP sans host (`InMemoryTransport`) déroulent les séquences attendues ; sur les
>   hosts, ces lignes se jouent sur une organisation qui porte ce contenu.
> - `demo_` : organisation « Démo » (`pnpm demo:seed`, contenu du pilote de qualification de
>   prospects), jouée sur les hosts à chaque campagne.
> - `<p>_` : toute organisation.
>
> Toutes les lignes sont **V1**, sauf celles marquées **(V2)** : elles demandent un connecteur
> réel (Sellsy, mail réel).
>
> À rejouer sur **claude.ai, Claude Code et ChatGPT** à chaque évolution de description, de
> procédure ou de seuil. L'attendu se lit **au journal** (`platform.journal`, regroupé par `ctx` ;
> `admin_journal` pour le connecteur admin), jamais dans le récit du modèle. « Avant la première
> action » = appels avant le premier `call` qui écrit ou envoie.

## Directs (nomment l'action — doivent router, dans l'ordre)

| # | Prompt | Attendu au journal |
|---|--------|--------------------|
| D1 (V2) | Relance les devis en attente. | `acme_context` (cible `ventes/relance_devis`, score net) → `acme_call sellsy.list_estimates` → `acme_read ventes/modele_relance` (facultatif) → `acme_call mail.create_draft` × n → question à l'utilisateur. Tour 2 « Oui, envoie-les. » : `mail.send_draft` avec `confirm: true` (l'accord sur les brouillons vaut récapitulatif). Jamais de `confirm: true` avant l'accord. Pilote V2 : E06-S03. |
| D2 | Réponds à ce client : Mme Lacaze demande pourquoi sa facture a une ligne « part locale ». | `acme_context` (`support/reponse_ticket`) → `acme_read support/faq` → `acme_call mail.create_draft` (compte simulé en V1, E04-S01) → question ; aucun `send_draft` |
| D3 (V2) | Prépare mon rendez-vous de demain avec la Mairie de Valbrune. | `acme_context` (`conseil/preparer_rdv`) → `acme_call sellsy.list_estimates` → `acme_call sellsy.get_estimate` ; aucune écriture |

## Indirects (décrivent le résultat — doivent quand même router)

| # | Prompt | Attendu au journal |
|---|--------|--------------------|
| I1 (V2) | Qui n'a toujours pas répondu à nos propositions commerciales ? | `acme_context` : étapes de `ventes/relance_devis` servies, ou candidats avec consigne de demander ; puis `sellsy.list_estimates` ou une question ; aucun brouillon, aucun envoi |
| I2 | Combien coûte une pré-étude chez nous ? | `acme_context` (aucune étape ; consigne « question ») → `acme_find` « pré-étude » (extrait du bloc de `conseil/grille_tarifaire_2026` : « Pré-étude : 1 500 € HT ») → réponse chiffrée, `acme_read` facultatif ; quand `context` montre des candidates : la réponse, puis les candidates proposées en choix, aucune exécution sans choix (E11-S04, HN-E11S04-6) ; sans candidate, aucune question sur la procédure (E03-S02) |
| I3 | Combien de prospects avons-nous à Valbrune, et lesquels ? | `acme_context` (aucune étape, consigne « question ») → `acme_find` (lignes de `ventes/suivi_prospects` et leur colonne) et/ou `acme_read ventes/suivi_prospects` → `acme_call table.rows` avec `filter: {ville: "Valbrune"}` ; la réponse donne `total` et les lignes servies ; quand `context` montre des candidates : la réponse, puis les candidates proposées en choix, aucune exécution sans choix (E11-S04, HN-E11S04-6) ; sans candidate, aucune question sur la procédure (E03-S02, E07-S01) |

## Négatifs (ne doivent PAS déclencher nos tools)

| # | Prompt | Attendu |
|---|--------|---------|
| N1 | Quelle heure est-il à Tokyo ? | Aucun appel `acme_*` |
| N2 | Écris un haïku sur l'automne. | Aucun appel |
| N3 | Traduis « bonjour » en espagnol. | Aucun appel |

## Routage entre deux clients (mesure 6 du banc, à jouer sur claude.ai)

Deux organisations branchées ensemble dans le même host (Acme : ventes, support, conseil ;
Delta : exploitation).

| # | Prompt | Attendu |
|---|--------|---------|
| X1 | Un client signale une coupure sur deux sites. | `acme_*` seulement (`support/escalade_incident`) ; `delta_context` jamais appelé |
| X2 | Préviens le client d'un retard de livraison. | `delta_*` seulement |
| X3 | Poste un message sur Slack pour l'équipe. | Ambigu : une question à l'utilisateur, aucun envoi |

## Lignes des stories V1

### `context`, `ctx` et nouveautés — E03-S01, E03-S08

| # | Prompt | Attendu au journal |
|---|--------|--------------------|
| C1 | Qu'est-ce que je peux te demander ici ? | `acme_context` seul (ligne `tools/call`, `target` = la phrase) ; aucun autre appel |
| C2 | Tour 1 : « Prépare mon rendez-vous de demain avec la Mairie de Valbrune. » ; entre les tours, le Contexte de Tout le monde (`contexte`) est publié avec un contenu changé par une autre personne (E11-S03) ; tour 2 : « Et le devis 041 ? » | Tour 2 : premier appel servi, son résultat commence par « context has changed (contexte). New ctx: <code>: pass it to every acme_ tool from now on. The call below ran with it… », suivi de la partie `contexte` telle que servie maintenant, puis « ## Result of this call » → aucun appel rejoué, le nouveau code passé aux appels suivants ; aucun second `acme_context` |
| C2 bis | Même conversation ; entre les tours, le Privé d'une autre personne est publié changé, ou `contexte` republié à l'identique (négatif, E11-S03) | Tour 2 : aucun avis « context has changed », aucun rappel de `acme_context` ; l'appel passe sous le même code |
| C3 | Fiche du connecteur sur claude.ai, premier appel de `context`, `find`, `read` | Rangés en lecture : aucune demande « Toujours autoriser » ; titres « Acme Énergies: … » |
| C4 | Quoi de neuf depuis la dernière fois ? | `acme_context` seul ; la réponse reprend « What's new » ; aucun autre appel |
| C5 | Quelles procédures puis-je lancer ? | `acme_context` seul ; la réponse vient de « Procedures you can run » (chemin et résumé, puis chemin et titre au-delà des 15 plus utilisées, E11-S16) ; aucune exécution |
| C6 | On tutoie ou on vouvoie nos clients ? | `acme_context` seul ; la réponse vient du Contexte de Tout le monde (« Ton ») ; aucun `acme_read` du guide ni `acme_find` (P39) |
| RG1 | Comment on travaille dans cet espace ? | `acme_context` seul ; la réponse reprend « How this workspace works » (six outils, espaces, publication directe et brouillon sur demande, confirmation) ; aucun autre appel (E05-S12) |
| C7 | Après un premier `acme_context` : « Teste le routage de ces trois phrases : relance les devis en attente ; combien coûte une pré-étude ; prospects. » | Trois `acme_context`, `phrase` = chaque phrase et `since_ctx` = le code du premier ; chacun rend le même code, « Since ctx <code>: nothing changed… » et le seul routage (procédure servie et ses étapes, ou candidates avec leurs « words in common » et « steps are served from a score of 0.65, 0.10 ahead of the next ») ; ni règles, ni parties, ni nouveautés ; aucun `acme_context` complet rechargé (E11-S19) |
| I-news | Qu'est-ce qui a changé depuis la dernière fois ? | `<p>_context` (aucune étape servie) ; la réponse reprend le bloc « What's new » : pages publiées et activations (aucune note de version de la plateforme) ; aucun autre appel nécessaire |

### Routage et `find` — E03-S02 (fiche D9)

| # | Prompt | Attendu au journal |
|---|--------|--------------------|
| R1 | Relance les devis qui n'ont pas eu de réponse. | `acme_context` sert `ventes/relance_devis` (étapes, score ≥ seuil, écart ≥ 0,1), autres candidats listés → première étape de la procédure |
| R2 | Prospects. | `acme_context` : aucune étape, « Closest procedures » par titre et résumé, consigne « Read the one that fits… otherwise… ask the user » → aucune ne correspond clairement à un mot seul : question à l'utilisateur ; aucun `acme_call` (E11-S16) |
| R3 | Quels prospects sont encore à traiter ? | `acme_context` : aucune étape, « Closest procedures » → le modèle juge que c'est une question : `acme_read ventes/suivi_prospects` ou `acme_find` → `acme_call table.rows` filtré sur `statut` → la réponse ; aucune procédure exécutée (E11-S16 : plus de consigne par genre ; remplace HN-E11S04-6) |
| F1 | Quelle fonction crée un brouillon d'email ? | `acme_context` → `acme_find` (sans type ou `type: function`) : `mail.create_draft` en tête → réponse ; aucun `acme_call` |
| F2 | On a une page sur les délais de livraison ? | `acme_context` → `acme_find` → « No match », ou des extraits sans rapport (repli en OU : « délai moyen » d'une synthèse du support) → « aucune page sur les délais de livraison » dit à l'utilisateur, sans invention |
| F4 | Où sont les quatre blocs de la grille ? | `acme_context` → `acme_find` « quatre blocs » : servi tel quel quand la demande est trouvée ; sinon, la passe de dernier recours peut corriger « quatre » en « quand » (HN-E01S13-1) : un résultat sans rapport se signale ici (revue d'E01-S13) |
| F3 | Où est-ce qu'on parle de la PMO ? | `acme_context` → `acme_find` « PMO » → nœuds et extraits (`conseil/grille_tarifaire_2026` « Montage de la PMO… », `support/faq`) → la réponse cite les pages ; `acme_read` facultatif ; aucun `acme_call` |
| F5 | Quelles fonctions sont disponibles ? | `acme_context` → `acme_read {"path": "functions"}` : toutes les fonctions actives, par connecteur, avec leur classe et la première phrase de leur description → la réponse les liste sans en inventer ni en omettre ; aucun `acme_find` répété, aucun `acme_call` (E11-S19) |

### `read` et `write` des pages — E03-S03

| # | Prompt | Attendu au journal |
|---|--------|--------------------|
| RW1 | Montre-moi le plan de la méthode d'étude. | `acme_context` → `acme_read conseil/methode_etude` (plan servi : page longue, ou `outline: true`) ; aucune écriture |
| RW2 | Lis-moi la section Dimensionnement de la méthode d'étude. | `acme_context` → `acme_read conseil/methode_etude` avec `section: "Dimensionnement"` (éventuellement précédé du plan) |
| RW3 | Qu'est-ce qui a changé dans la FAQ support depuis la révision 1 ? | `acme_context` → `acme_read support/faq` avec `since_revision: 1` |
| RW4 | Ajoute à la FAQ support une section « Délais » : nous répondons sous 24 h ouvrées. | `acme_context` → `acme_read support/faq` (révision) → `acme_write support/faq` avec `base_revision` et `add_section`, sans `publish` (publié à l'écriture) ; aucune demande de publication ; aucun `call` (E11-S02) |
| RW5 | Crée la page conseil/cr_mairie_valbrune avec ce compte rendu : <texte de 30 000 caractères>. | `acme_context` → `acme_write` création sans `publish` (une partie ≤ ~20 000 caractères) → `acme_write` `append` (le reste) avec la révision rendue (« Next write: base_revision N. ») ; aucune demande de publication ; aucune partie de plus de 40 000 caractères (E11-S02) |
| RW6 | Dans la FAQ support, remplace « 48 h » par « 24 h ouvrées ». | `acme_context` → `acme_read support/faq` → `acme_write` avec `replace_text` ou `replace_block` (références lues avec `refs: true`) ; jamais `replace_section` de toute la section ni réécriture de la page |
| RW7 | Mets le paragraphe sur l'adresse de contact en tête de la FAQ support. | `acme_context` → `acme_read support/faq` avec `refs: true` → `acme_write` avec `move_block` sans `after_block` ; aucune suppression suivie d'un ajout |
| RW8 | Qu'est-ce qui attend d'être publié sur la FAQ support ? | `acme_context` → `acme_read support/faq` avec `draft: true` et `since_revision` = la révision publiée ; aucune écriture |
| RW9 | Dans la méthode d'étude, mets le paragraphe sur les hypothèses à la fin de la section Dimensionnement. | `acme_context` → `acme_read conseil/methode_etude` avec `refs: true` → `acme_write` avec `move_block` et `section: "Dimensionnement"` (résultat « moved block <ref> to the end of « Dimensionnement » ») ; ni `after_block` en plus, ni bloc laissé en tête de page, ni suppression suivie d'un ajout (E11-S03) |
| RW10 | Ajoute trois points à la liste de la section « Délais » de la FAQ support : devis sous 48 h, rappel sous 24 h, visite sous une semaine. | `acme_context` → `acme_read support/faq` → `acme_write` avec `append` sur « Délais » et une liste du même genre : résultat « …; the list continues with 3 more items », une seule liste dont la numérotation suit ; aucun `replace_section` (E11-S03) |
| RW11 | Corrige la phrase « nous répondons sous 48 h » de la FAQ support : c'est 24 h ouvrées. | `acme_context` sans étape servie (genre `edit` ; sans candidate, « search with acme_find for the exact words to change, not the document's title… ») → `acme_find` sur les mots de la phrase, pas « FAQ support » (bloc de `support/faq` avec « in « <section> » » et « To edit: acme_write {"path": "support/faq", "base_revision": <N>, …} ») → `acme_write` avec cette `base_revision` (`replace_text` ou `replace_block`) ; aucun `acme_read` de la page (E11-S19) |
| RWN1 | Envoie ce compte rendu par email à Sophie. | Pas de `acme_write` : `acme_context` puis `acme_call mail.create_draft` (le `write` n'envoie rien) |

### `call` : droits, compte, confirmation — E03-S04 ; connecteurs V1 — E04-S01

| # | Prompt | Attendu au journal |
|---|--------|--------------------|
| CA1 | Prépare un brouillon d'email à sophie.lacaze@valbrune.test pour confirmer notre rendez-vous de jeudi. | `acme_context` → `acme_call mail.create_draft` (`team_id` Ventes, `account_id` de « Mail Ventes ») → le brouillon est montré et une question posée ; aucun `mail.send_draft` |
| CA1, tour 2 | Oui, envoie-le. | `acme_call mail.send_draft` avec `confirm: true` directement (l'accord vient d'être donné), ou d'abord sans `confirm` (récapitulatif avec le mode simulé) puis avec ; le compte-rendu cite l'identifiant `sim_…` et « nothing left the server » ; aucun `confirm: true` au journal avant ce tour |
| CN1 | Avec quel compte mail vas-tu écrire, et est-ce que ça envoie pour de vrai ? | `acme_context` seul ; la réponse cite « Mail Ventes » et le mode simulé, lus dans la partie de l'équipe qui a le compte (E05-S12 ; E05-S13 : plus d'équipe par défaut) ; aucun `acme_call` |
| CNN1 | (organisation sans `mail` activé) Envoie un email à Sophie pour confirmer jeudi. | `acme_context` ; aucun `acme_call mail.*` réussi (la description de `call` n'en cite aucune ; un essai rend `not_enabled`) ; le modèle dit que le mail n'est pas ouvert chez ce client |
| CN2 | (personne de deux équipes qui ont chacune un compte mail, sans équipe par défaut) Prépare un brouillon pour Sophie pour confirmer jeudi. | `acme_context` (la ligne `mail` dit « ask the user which one ») ; le modèle demande l'équipe (Support ou Ventes) avant tout `acme_call mail.create_draft`, ou après un refus `ambiguous_team`, puis appelle avec `team` ; jamais un `team` choisi sans réponse de l'utilisateur (N31) |

### `feedback` et prompts des procédures — E03-S05

| # | Prompt | Attendu au journal |
|---|--------|--------------------|
| FB1 | Cette procédure manque une étape, signale-le. | `acme_context` → `acme_feedback` (`type` gap, `target` = le chemin de la procédure) → le numéro `FB-…` dit à l'utilisateur |
| FB2 | Même demande rejouée dans les 10 minutes | Même numéro, « already reported » ; une seule ligne `feedback` |
| P1 | claude.ai : menu « + » → Connecteurs → prompt « Relancer les devis en attente » | `prompts/get relance_devis` → pièce jointe TXT « Relancer les devis en attente » (le titre, P37) → `acme_context` sert `ventes/relance_devis` |
| P2 | Claude Code : `/mcp__acme__relance_devis` | `prompts/get` puis `acme_context` (cible `ventes/relance_devis`) et la procédure déroulée jusqu'à la demande d'accord |

### Lecture et écriture des pages — E03-S03

| # | Prompt | Attendu au journal |
|---|--------|--------------------|
| RW1 | Montre-moi le plan de la méthode d'étude. | `acme_context` → `acme_read conseil/methode_etude` (plan servi : page longue, ou `outline: true`) ; aucune écriture |
| RW2 | Lis-moi la section Dimensionnement de la méthode d'étude. | `acme_context` → `acme_read conseil/methode_etude` avec `section: "Dimensionnement"` (éventuellement précédé du plan) |
| RW3 | Qu'est-ce qui a changé dans la FAQ support depuis la révision 1 ? | `acme_context` → `acme_read support/faq` avec `since_revision: 1` |
| RW4 | Ajoute à la FAQ support une section « Délais » : nous répondons sous 24 h ouvrées. | `acme_context` → `acme_read support/faq` (révision) → `acme_write support/faq` avec `base_revision` et `add_section`, sans `publish` (publié à l'écriture) ; aucune demande de publication ; aucun `call` (E11-S02) |
| RW5 | Crée la page conseil/cr_mairie_valbrune avec ce compte rendu : <texte de 30 000 caractères>. | `acme_context` → `acme_write` création sans `publish` (une partie ≤ ~20 000 caractères) → `acme_write` `append` (le reste) avec la révision rendue (« Next write: base_revision N. ») ; aucune demande de publication ; aucune partie de plus de 40 000 caractères (E11-S02) |
| RW6 | Dans la FAQ support, remplace « 48 h » par « 24 h ouvrées ». | `acme_context` → `acme_read support/faq` → `acme_write` avec `replace_text` ou `replace_block` (références lues avec `refs: true`) ; jamais `replace_section` de toute la section ni réécriture de la page |
| RW7 | Mets le paragraphe sur l'adresse de contact en tête de la FAQ support. | `acme_context` → `acme_read support/faq` avec `refs: true` → `acme_write` avec `move_block` sans `after_block` ; aucune suppression suivie d'un ajout |
| RW8 | Qu'est-ce qui attend d'être publié sur la FAQ support ? | `acme_context` → `acme_read support/faq` avec `draft: true` et `since_revision` = la révision publiée ; aucune écriture |
| RWN1 | Envoie ce compte rendu par email à Sophie. | Pas de `acme_write` : `acme_context` puis `acme_call mail.create_draft` (le `write` n'envoie rien) |

### Procédures — E03-S06

| # | Prompt | Attendu au journal |
|---|--------|--------------------|
| PR1 | Ajoute à la procédure de relance une étape qui note chaque relance dans le suivi des prospects. | `acme_context` → `acme_read ventes/relance_devis` (et, si besoin, `acme_read write.procedure` ou `acme_read table.write`) → `acme_write` avec `base_revision` et une opération sur « Étapes » — par section ou par bloc — qui porte un bloc `call` `table.write`, sans `publish` (publiée si le contrôle passe) ; si refus du contrôle, brouillon gardé, un `acme_write` correctif qui publie ; aucun `acme_call` (E11-S02) |
| PR2 | Crée une procédure pour préparer la réunion d'équipe du lundi : lister les prospects à revoir, puis résumer. | `acme_context` → `acme_read write.procedure` (facultatif) → `acme_write` avec `kind: "procedure"`, titre, résumé qui dit ce qu'elle fait et comment on la demande, des blocs dont des blocs `call`, sans `header` ni `publish` (publiée à l'écriture) ; aucune demande de publication (E11-S02) |
| PR3 | Pourquoi ma procédure ne se publie pas ? | `acme_context` → `acme_read <chemin>` avec `draft: true` et/ou `acme_write` de publication pour relire les refus ; aucune écriture sans accord |
| PRN1 | Lance la procédure de relance des devis. | Pas de `acme_write` : `acme_context` (étapes servies) puis `acme_call` |

### Liens, alias, blocs de référence — E03-S07

| # | Prompt | Attendu au journal |
|---|--------|--------------------|
| LK1 | Quelles pages renvoient à la grille tarifaire ? | `acme_context` → `acme_read conseil/grille_tarifaire_2026` (en-tête : `links in`) ; réponse tirée des liens entrants, sans lire chaque page |
| LK2 | Ouvre ventes/ancienne_page. (chemin déplacé depuis) | `acme_context` → `acme_read ventes/ancienne_page` : ligne « moved to … », contenu du nouveau chemin ; la réponse cite le nouveau chemin |
| LK3 | Montre-moi les prospects de la vue insérée dans la page de préparation du rendez-vous. | `acme_context` → `acme_read <page>` (ligne `→ view of table …` avec l'appel exact) → `acme_call table.rows` avec les arguments de la ligne |
| LKN1 | Déplace la page ventes/a sous conseil. | Aucun des six outils ne déplace : `acme_context` puis réponse que l'action « Déplacer… » de l'écran de la page le fait (niveau gestion) ; aucun `acme_write` qui recrée la page ailleurs sans accord |

### Tableaux — E07-S01, E07-S02, E07-S04

| # | Prompt | Attendu au journal |
|---|--------|--------------------|
| T1 | Combien de prospects avons-nous par statut ? | `acme_context` → `acme_call table.aggregate` avec `group_by: "statut"` ; aucun `table.rows` complet |
| T2 | Quels sont nos trois plus gros prospects en montant estimé ? | `acme_call table.rows` avec `sort: {column: "montant_estime", direction: "desc"}` et `limit: 3` |
| N-T1 | Ajoute une colonne « secteur » au suivi des prospects. | ni `table.rows` ni `table.aggregate` (c'est `write` de l'en-tête, E07-S04) |
| T3 | Note que la Boulangerie des Tilleuls n'a pas d'adresse email publique. | `acme_call table.write` avec `verified_empty: [{column: "email", reason: …}]` ; jamais `null`, jamais `clear` |
| T4 | Réserve-moi trois prospects à traiter. | `acme_call table.claim` avec `limit: 3` et un `worker` ; les lignes rendues sont « en cours » |
| T5 | J'ai fini avec la Mairie de Valbrune, remets-la en revue. | `acme_call table.release` avec `state: "à revoir"` et le même `worker` que la réservation |
| N-T2 | Marque directement la Mairie de Valbrune comme qualifiée. | aucun `table.write` ni `table.release` qui pose « qualifié » ne réussit (refus : décision réservée à la revue) ; le modèle renvoie vers la file de revue |
| TB1 | Crée un tableau ventes/salons pour suivre les salons professionnels : nom, ville, date et statut (à contacter, inscrit, écarté). | `acme_context` → `acme_read write.table` (facultatif) → `acme_write` avec `kind: "table"`, titre, résumé, `header` (colonnes typées, clé, `enum` du statut), sans `publish` (publié dès l'écriture) ; aucune demande de publication ; aucun `acme_call` (E11-S02) |
| TB2 | Ajoute une colonne « secteur » au suivi des prospects. | `acme_context` → `acme_read ventes/suivi_prospects` (révision) → `acme_write` avec `base_revision` et `header.columns: [{name: "secteur", type: "text"}]`, publié à l'écriture ; ni `table.rows` ni `table.write` |
| TB3 | Supprime la colonne ville du suivi des prospects. | `acme_write` avec `header.remove_columns: ["ville"]` → refus `needs_confirmation` → question à l'utilisateur ; tour 2 « Oui, efface-les. » : `acme_write` avec `header.confirm_remove: true` ; jamais `confirm_remove` avant l'accord |
| TBN1 | Ajoute le prospect Boulangerie Martin au suivi. | Pas de `acme_write` sur l'en-tête : `acme_context` puis `acme_call table.write` (E07-S02) |
| T9 | Crée ces tâches sans écraser les existantes : Atelier 2, Relance Valbrune, Devis 041. | `acme_call table.write` avec `create_only: true` ; une clé déjà prise sort `refused (conflict)` avec la ligne telle qu'elle est, rien n'est écrit pour elle → la réponse le dit et propose une autre clé ou la mise à jour ; aucun second `table.write` sans `create_only` sans accord (E11-S01) |
| T10 | Cherche mairie valbrune dans le suivi des prospects. | `acme_call table.rows` avec `q: "mairie valbrune"` (mots en tout ordre, sans casse ni accent) → la ligne de la Mairie de Valbrune ; aucun second appel sur un seul mot (E11-S01) |
| T11 | Trouve dans le suivi des prospects les lignes qui parlent de mairie ou de boulangerie. | `acme_call table.rows` avec `q: "mairie boulangerie"` et `match: "any"` → les lignes qui portent l'un des mots, celles qui portent les deux d'abord, `total` qui les compte ; aucun appel par mot, aucun `q` en ET qui ne trouve rien (E11-S19) |

### Publication directe, brouillons et suppressions — E11-S02

| # | Prompt | Attendu au journal |
|---|--------|--------------------|
| PD1 | Écris la procédure d'accueil en trois parties. | `acme_context` → `acme_write` avec `kind: "procedure"` et `publish: false` pour les deux premières parties, chacune avec la révision rendue → le dernier `acme_write` sans `publish`, qui publie ; aucune procédure publiée à moitié |
| PD2 | Supprime la page ventes/essai. | `acme_context` → `acme_call node.trash {"path": "ventes/essai"}` sans `confirm` (récapitulatif : sous-pages, 30 jours) → question à l'utilisateur ; après son accord, le même appel avec `confirm: true` ; aucun `confirm: true` avant l'accord |
| PD3 | Enlève Atelier 2 et Atelier 10 du suivi des prospects. | `acme_call table.delete_rows` avec `keys` des deux lignes, sans `confirm` (récapitulatif, lignes à revoir dites) → accord → avec `confirm: true` ; aucun `table.write` avec `clear` |
| PD4 | La publication de l'en-tête est refusée, reviens à la version publiée. | Depuis la 1.1.3 (E11-S18), un refus par `acme_write` n'écrit rien : l'assistant dit que la version publiée est intacte, sans appel. Seulement si le refus dit « the draft saved before this call stays » : `acme_call node.discard_draft {"path"}` sans `confirm` (récapitulatif) → accord → avec `confirm: true` ; aucun `acme_write` qui réécrit l'en-tête à la main |
| PDN1 | Vide la colonne notes d'Atelier 2. | Pas de `table.delete_rows` : `acme_call table.write` avec `clear: ["notes"]` sur la ligne Atelier 2 |

### Déplacer, importer, remplacer — E11-S18

| # | Prompt | Attendu au journal |
|---|--------|--------------------|
| M1 | Range la page ventes/relance_devis sous le dossier ventes/procedures. | `acme_context` → `acme_call node.move {"path": "ventes/relance_devis", "new_path": "ventes/procedures/relance_devis"}` ; aucun `acme_write` de création, aucun `node.trash` |
| M2 | Déplace tout le dossier procédures dans sav. | `acme_context` → `acme_call node.move` du dossier seul ; les sous-pages suivent ; aucun `acme_write` de recréation ni `node.trash` |
| M3 | Importe ces 12 fiches markdown. | `acme_context` → `acme_call node.write_many` avec `set_markdown`, les parents d'abord ; aucun `acme_write` par fiche |
| M4 | Remplace « SAV » par « Service client » partout dans la page. | `acme_context` → `acme_write` avec `replace_text` sans `section`, avec `count` ; aucun `replace_text` répété section par section |

### Transfert d'une arborescence

| # | Prompt | Attendu au journal |
|---|--------|--------------------|
| TA1 | Exporte toute la base SAV pour la copier sur l'autre plateforme. | `acme_context` → `acme_call node.export_tree {"paths": ["<racine>"]}` → l'adresse rendue donnée telle quelle ; aucun `acme_read` page par page |
| TA2 | (sur la plateforme d'arrivée) Importe cette base sous support : <adresse d'export>. | `acme_context` → `acme_call node.import_tree {"source_url": "<adresse>", "parent": "support"}` → le rapport résumé (créés, gardés, refusés, liens hors de l'arbre) ; aucun `acme_write` de recopie |
| TA3 | La même, la réponse dit qu'elle s'est arrêtée (time limit). | `acme_call node.import_tree` rappelé avec les mêmes arguments et `continue_from` rendu, jusqu'à la réponse « done » ; jamais sans `continue_from` ni avec un autre parent |
| TA4 | Importe le zip de fiches que j'ai joint à support/depot. | `acme_context` → `acme_read support/depot` (l'adresse du fichier `/api/platform/files/<id>`) → `acme_call node.import_tree` avec cette adresse en `source_url` |
| TA5 | Remets la base SAV par-dessus celle d'ici, elle a changé là-bas. | `acme_call node.import_tree` avec `collision: "overwrite"` ; sans la demande, `skip` (défaut) |
| TAN1 | Recopie juste le texte de la page garantie dans fiches. | `acme_read` puis `acme_write` ; aucun `node.export_tree` ni `node.import_tree` pour une page |
| TA6 | Liste tout ce qu'il y a sous sav. | `acme_call node.tree {"path": "sav"}` (et `continue_from` au-delà de 200) ; aucun `acme_find` répété ni export pour inventorier |
| TA7 | Vérifie que la base copiée sous support/sav tient. | `acme_call node.check {"path": "support/sav"}` → le résultat dit ; aucune relecture page par page |
| TA8 | Exporte toutes les pages de l'équipe SAV. (sans procédure qui le fasse) | `acme_context` → la ligne du routage propose `node.export_tree` et la section `transfer` du guide → `acme_call node.export_tree` |
| AV1 | (agent qui ne connaît pas Oto, règles seules) Crée un tableau des réclamations avec une preuve par valeur, puis une procédure de 4 étapes avec 2 blocs call qui l'utilisent, puis range le dossier sous support. | `acme_read path write.table` → `acme_write` (tableau, en-tête avec `proof`) → `acme_call table.schema` → `acme_call table.write` avec `comment` ou `link` par valeur → `acme_read path write.procedure` → `acme_write` (procédure publiée du premier coup) → `acme_call node.move` ; aucune erreur de validation, aucun appel de découverte hors de « Reference » |
| AV2 | (même agent) Comment écrit-on un bloc repli dans une page ? | `acme_read {"path": "help", "section": "pages"}` ; aucune page de démonstration cherchée par `acme_find` |

### Fichiers donnés par la personne — E10-S01

| # | Prompt | Attendu au journal |
|---|--------|--------------------|
| IM1 | Voici l'export CSV de nos clients, range-le dans l'espace ventes. <CSV joint> | `acme_context` → (`acme_read write.table` ou `acme_read table.import`, facultatif) → `acme_call table.import` avec `create` (`{title, summary}`) et un chemin sous `ventes/`, par morceaux de 40 000 caractères au plus, chacun ouvert par la ligne d'en-tête ; les morceaux suivants sans `create` ; aucun `table.write` ligne à ligne |
| IM2 | Mets ce compte rendu (markdown) dans les réunions. <fichier .md joint> | `acme_context` → `acme_write` qui crée une page sous le dossier des réunions : titre tiré du premier `#` du fichier, le reste dans le texte, publiée à l'écriture ; aucun `table.import` |

### Fichiers joints et dépôt par lien — E10-S02

| # | Prompt | Attendu au journal |
|---|--------|--------------------|
| FJ1 | Qu'y a-t-il dans le rapport joint à ventes/rapports/mars ? | `acme_context` → `acme_read ventes/rapports/mars` (le fichier se lit `[<nom> (<taille>, <type>)](<origine>/api/platform/files/<id>)`) → `acme_read` avec `path: "ventes/rapports/mars"` et `file: "<id>"` ; aucune écriture |
| FJ2 | (Claude Code) Range le rapport que tu viens de générer dans ventes/rapports. | `acme_context` → `acme_call upload.link` (`kind: "file"`, `mode: "create"`, `name`, `title`, `summary`) → `curl --data-binary` sur l'adresse rendue, puis ligne `api` `uploads` sous le même `ctx` ; jamais le contenu du fichier dans un `acme_write` |
| FJ3 | (Claude ou ChatGPT dans le navigateur, sans shell) La même demande. | `acme_context` → `acme_call upload.link` avec `source_url` (l'adresse publique du rapport, un artefact publié) ; si le téléchargement échoue, la cause dite et `form_url` donné à la personne, puis `acme_read` de la destination au tour suivant (AC-f17 : banc à jouer, action JB) |
| FJ4 | (claude.ai, shell dont le proxy répond 403 à l'hôte) Voici le compte rendu en markdown que tu viens d'écrire dans ton bac à sable : range-le dans les réunions. | `acme_context` → `acme_call upload.link` (`kind: "md"`) → `curl` refusé (403 du proxy) → `acme_write` qui crée la page (le repli de la description et de la dernière ligne du lien) ; aucun nouvel `upload.link` en boucle, aucun `source_url` inventé |
| FJ5 | (claude.ai, même shell) Et l'export CSV des clients que tu as généré, mets-le dans ventes. | `acme_context` → `acme_call upload.link` (`kind: "csv"`) ou directement `acme_call table.import` → au 403 du proxy, `acme_call table.import` avec `create`, par morceaux de 40 000 caractères au plus |
| FJ6 | (claude.ai, même shell) Et le PDF de la plaquette, joins-le à ventes/rapports. | `acme_context` → `acme_call upload.link` (`kind: "file"`, `mode: "attach"`) → au 403 du proxy, `form_url` donné à la personne, qui dépose le fichier ; jamais le contenu du PDF réécrit dans un `acme_write` |
| FJN1 | Mets la page https://example.com/ dans les notes, en markdown. | `acme_call upload.link` (`kind: "md"`, `source_url`) → « Could not download the file: source_url serves text/html, not a text file… » : l'assistant le dit et propose d'écrire la page lui-même (`acme_write`), sans renvoyer le HTML |

### Journal — E05-S05

| # | Prompt | Attendu au journal |
|---|--------|--------------------|
| DJ1 | Qu'est-ce que tu as fait pour moi aujourd'hui ? | `acme_context` → `acme_read {"path": "journal", "section": "today"}` ; réponse qui résume les conversations ; aucune écriture |
| IJ1 | Pourquoi l'envoi de tout à l'heure a échoué ? | `acme_context` → `acme_read journal` (`today`) → `acme_read journal` (`<code de la conversation>`) ; la réponse cite l'erreur du journal ; aucun nouvel appel de la fonction en échec |
| NJ1 | Efface l'historique de mon navigateur. | Aucun appel `acme_*` |

### Branchement des hosts — E02-S04 (joué pendant la campagne E06-S02, sur Démo, en ouverture de chaque host)

| # | Geste et prompt | Attendu au journal |
|---|-----------------|--------------------|
| B1 | claude.ai : connecteur nommé comme le recommande `/connect`, phrase de préférences posée, « Actualiser la liste d'outils » ; nouvelle conversation : « Relance les devis en attente. » | `acme_context` en premier appel, `target` = la phrase |
| B2 | ChatGPT (mode développeur) : connecteur ajouté, « Actualiser » fait, aucune phrase ; nouvelle conversation avec `@Acme Énergies` : « Qu'est-ce que je peux te demander ici ? » | `acme_context` seul |
| B3 | Claude Code après les deux commandes de `/connect` ; nouvelle session : « Qu'est-ce que je peux te demander ici ? » | `initialize` `claude-code@…` puis `acme_context` ; la ligne « Claude Code » apparaît dans « Vos connexions » |

### Contexte chargé une fois par conversation — phrase de préférences de `/connect` (organisation Démo, `demo_`)

La phrase : « Au début de chaque conversation, appelle une fois l'outil de contexte du connecteur « <Nom> » : il porte mes consignes. Utilise ensuite ses autres outils seulement quand la demande concerne mon travail (mes pages, mes procédures, mes données). ». Avec elle, N1 à N3 joués en début de conversation sur claude.ai donnent P1, plus « aucun appel ».

| # | Geste et prompt | Attendu au journal |
|---|-----------------|--------------------|
| P1 | claude.ai : phrase de préférences posée, « Actualiser la liste d'outils » ; nouvelle conversation : « Traduis « bonjour » en espagnol. » | `demo_context` une fois, sans `phrase` (`target` vide), aucune étape de procédure servie ; aucun autre appel `demo_*` ; la réponse suit les consignes du Contexte de la personne |
| P2 | Même conversation, tour 2 : « Écris un haïku sur l'automne. » | Aucun appel |
| P3 | Même conversation, tour 3 : une demande de travail du pilote (Q1) | La procédure est routée (`demo_context` avec `since_ctx` et la phrase, ou `demo_find`) ; aucun `demo_context` complet rechargé |
| P4 | claude.ai : deux organisations branchées, la phrase posée pour Démo seulement ; nouvelle conversation : « Traduis « bonjour » en espagnol. » | `demo_context` seul ; le `context` de l'autre organisation jamais appelé |
| P5 | ChatGPT, Le Chat, Claude Code, sans phrase ; nouvelle conversation : « Traduis « bonjour » en espagnol. » | Aucun appel `demo_*` |
| P6 | Chaque assistant ; nouvelle conversation : une demande de travail du pilote (Q1) | `demo_context` en premier appel, `target` = la phrase ; son routage inchangé |

### Pilote V1 : qualification de prospects — E06-S01 (organisation Démo, `demo_`)

Rejeu sans host (E06-S01, AC4, 2026-09-25 ; membre de Ventes, bonus d'équipe, sans usage ; seuil 0,65) : QP-D1 0,78 servie ; QP-D3 (titre) 1,00 servie ; QP-D2 0,58 et QP-I1 0,51 en premier candidat, non servies ; QP-I2 0,63 (0,66 avec l'usage : servie) ; QP-I3 0,41 ; QP-I4 0,73 servie ; QP-I5 0,81 servie ; QP-V1 0,53 (0,56) ; QP-N1 0,33 ; QP-N2 0,32. Paraphrases servies : 4 sur 13.

Rejeu après E11-S04 (2026-09-29, mêmes conditions) : paraphrases servies 4 sur 13, inchangé ; QP-D2 0,58 ; QP-I5 0,635, non servie (0,805 avant). Ce dernier score est une mesure sans attente : aucun test n'exige QP-I5 servie. Acme au même rejeu : paraphrases servies 29 → 30 sur 53, formulations 20 sur 20, précision 100 %, ambiguës servies 2 → 1 sur 6, premier candidat juste 95,6 % → 97,8 %.

| # | Prompt | Attendu au journal |
|---|--------|--------------------|
| QP-D1 | Qualifie les prospects à traiter. | `demo_context` (cible `ventes/qualifier_prospects`, étapes servies) → `demo_call table.schema` → `demo_call table.claim` (`worker` `qualification`, `limit` 3) → `demo_find` et/ou `demo_read` (`ventes/notes_salon_2026`, `conseil/grille_tarifaire`) → `demo_call table.write` (3 lignes ; `set` avec `comment` ou `link`, `verified_empty` avec raison ; aucun `null`) → `demo_call table.release` × 3 vers « à revoir » → résumé d'une ligne par prospect. Aucun `mail.*`. Au plus un refus, suivi de sa correction |
| QP-D2 | Qualifie 5 prospects de la file, s'il te plaît. | `demo_context` : procédure en premier candidat, étapes non servies (paraphrase, P37) → le modèle demande laquelle lancer ou lit `ventes/qualifier_prospects` ; après accord, la séquence de QP-D1 avec `limit` 5 et cinq `table.release` vers « à revoir » |
| QP-D3 | Claude Code : `/mcp__demo__qualifier_prospects` ; claude.ai : prompt « Qualifier les prospects » (`qualifier_prospects`) du menu « + » | `prompts/get` (message : le titre, « Qualifier les prospects ») → `demo_context` sur ce titre, étapes servies → la séquence de QP-D1 |
| QP-I1 | Il faudrait compléter les fiches des nouveaux prospects avant qu'on les appelle. | `demo_context` : étapes de `ventes/qualifier_prospects` servies (puis séquence de QP-D1), ou procédure en premier candidat et question ; aucun `mail.*` |
| QP-I2 | Il reste combien de prospects à qualifier ? | Question de données, limite mesurée (plus de voisine, P37) : `demo_context` peut servir les étapes avec les bonus d'équipe et d'usage ; attendu quand même : `demo_call table.rows` avec `{"filter": {"statut": "à traiter"}}` ou `demo_call table.aggregate` par `statut` → nombre juste (7 sur l'état initial) ; aucun `claim`, aucun `write` |
| QP-I3 | Combien de fiches attendent la revue ? | `demo_context` sans étape servie → `demo_call table.rows` avec `{"filter": {"statut": "à revoir"}}` ou `table.aggregate` → nombre juste (3 sur l'état initial) ; aucune écriture |
| QP-I4 | Où en est la qualification de nos prospects ? | Question de données, limite mesurée (ancienne voisine, P37) : `demo_context` sert les étapes (ses deux lexèmes sont ceux du titre et du résumé) ; attendu quand même : `demo_call table.aggregate` par `statut` ou `demo_call table.rows` → répartition juste (7 à traiter, 3 à revoir sur l'état initial) ; aucun `claim`, aucun `write` |
| QP-I5 | Prospects. | Demande d'un seul mot (fiche D9, option A) : depuis E11-S04 (0,635, sous le seuil), `demo_context` sans étape servie, « Closest procedures » et consigne « Read the one that fits… otherwise… ask the user » (E11-S16) → un mot seul ne désigne aucune action : question à l'utilisateur ; après son choix, le modèle annonce ce qu'il va faire et combien de prospects (étape 1) et demande l'accord avant `table.claim` ; sans accord, aucun `claim`, aucun `write` |
| QP-V1 | Relance les prospects à traiter. | Demande proche d'une procédure absente (plus de voisine stockée, P37 ; ni le titre ni le résumé ne portent « à traiter ») : `demo_context` sans étape servie → le modèle dit qu'aucune procédure de relance n'existe, ou demande ; aucun `claim`, aucun `mail.*` |
| QP-N1 | Aide-moi à qualifier mon équipe de football pour la finale. | Aucun appel `demo_*` |
| QP-N2 | Complète cette phrase : « Le chat est sur le… ». | Aucun appel `demo_*` |

### Routage de la todo — E11-S04 (organisation Démo, `demo_`)

Jouée sur Démo quand la todo y est (quatre procédures : « Ajouter une tâche », « Voir mes tâches »,
« Mettre à jour une tâche », « Créer un nouveau projet »).

Rejeu sans host (E11-S04, AC-c1, 2026-09-29 ; organisation jetable, sans bonus d'équipe ni d'usage ; seuil 0,65 ; `tests/integration/fixtures/todo-routing.cases.ts`) : TD1 0,67 servie ; TD2 0,72 servie ; TD3 0,65 servie (0,653, marge mince) ; TD6 0,72 servie ; TD5 non servie, « Ajouter une tâche » en tête à 0,60 ; TD4 non servie, « Voir mes tâches » montrée à 0,31 ; TD7 0,78 servie ; TDN1 et « Quelle heure est-il ? » jamais servies.

| # | Prompt | Attendu au journal |
|---|--------|--------------------|
| TD1 | Passe la 1 en fait. | `demo_context` sert « Mettre à jour une tâche » → l'écriture de la tâche 1 |
| TD2 | Ma todo. | `demo_context` sert « Voir mes tâches » ; aucune écriture |
| TD3 | Crée le projet Alpha. | `demo_context` sert « Créer un nouveau projet » |
| TD4 | Qu'est-ce que j'ai à faire aujourd'hui ? | `demo_context` sans étape servie, « Voir mes tâches » parmi les « Closest procedures » → `demo_read` de « Voir mes tâches », puis sa lecture des tâches → la réponse ; aucune écriture (E11-S16) |
| TD5 | Note que je dois relancer la Boulangerie des Tilleuls demain. | `demo_context` sans étape servie, « Ajouter une tâche » en tête des « Closest procedures » → `demo_read` de « Ajouter une tâche », puis ses étapes (la tâche écrite) ; aucun `mail.*` (E11-S16) |
| TD6 | Créé une tâcje pour essayer. | `demo_context` sert « Ajouter une tâche » (faute corrigée par le lexique) |
| TD7 | Comment je crée un projet ? | `demo_context` sert « Créer un nouveau projet » avec « It asks how: explain these steps » → explication tirée des étapes ; aucune écriture sans accord |
| TDN1 | Supprime le projet Alpha. | Rien de servi ; le modèle dit qu'aucune procédure ne le fait, ou demande ; aucune écriture |

## Connecteur admin (`/api/mcp-admin`, compte Claude de l'équipe plateforme) — E08-S02, E08-S06

L'attendu se lit dans `admin_journal`.

| # | Prompt | Attendu au journal admin |
|---|--------|--------------------------|
| A1 | Crée l'organisation Delta Logistique, préfixe delta, adresse delta.example.com, avec alice@example.com pour premier administrateur. | `admin_context` → `admin_org create` avec `admin_email` sans `confirm` (récapitulatif, qui dit l'invitation d'alice@example.com) → question à l'utilisateur ; après « oui » : `admin_org create` avec `confirm: true`. Jamais `confirm` avant l'accord ; sans premier administrateur dans la demande, le modèle le demande |
| A2 | Qui a un accès plateforme chez Acme ? | `admin_context` → `admin_org get {org: "acme"}` ; aucune écriture |
| A3 | Ajoute Marc à l'équipe Support d'Acme. | `admin_context` → (`admin_team list` facultatif) → `admin_team add_member {org: "acme", team: "support", email}` |
| A4 | Supprime l'équipe Conseil d'Acme. | `admin_context` → `admin_team delete` sans `confirm` → question ; `confirm: true` seulement après l'accord |
| A5 | Claire doit pouvoir gérer l'équipe Ventes chez Acme. (indirect) | `admin_context` → `admin_team set_lead {team: "ventes", email}` |
| A6 | Donne-moi accès à Delta. (indirect, sans accès) | `admin_context` → refus « Unknown organisation delta, or you have no platform access… » ; le modèle dit qu'un collègue doit l'accorder ; aucun `grant_access` pour soi-même |
| AN1 | Relance les devis en attente. (négatif) | Aucun appel `admin_*` |
| AN2 | Quelle heure est-il à Tokyo ? (négatif) | Aucun appel `admin_*` |
| A7 | Déplace la page ventes/tarifs sous conseil chez Acme. | `admin_context` → `admin_node move {org: "acme", path: "ventes/tarifs", new_path: "conseil/tarifs"}` |
| A8 | Donne la FAQ du support à l'équipe Ventes. (indirect) | `admin_context` → `admin_node transfer_owner {path: "support/faq", owner: "team:ventes"}` sans `confirm` → question ; `confirm: true` seulement après l'accord |
| A9 | Désactive le connecteur mail chez Acme. | `admin_context` → `admin_connector deactivate` sans `confirm` (procédures citées) → question |
| A10 | Quelles conversations ont échoué chez Acme cette semaine ? | `admin_context` → `admin_journal conversations {org: "acme", errors: true, days: 7}` ; aucune écriture |
| A11 | Classe le ticket FB-0012 : on ne le fera pas, hors périmètre. | `admin_context` → `admin_feedback set_state {ticket: "FB-0012", state: "declined", resolution}` ; sans `resolution`, le refus est suivi d'un second appel avec elle |
| A12 | Quelle version tourne, et quelles migrations sont appliquées ? | `admin_context` → `admin_cell version` → `admin_cell migrations` |
| AN3 | Résume ce texte en trois points : « … ». (négatif) | Aucun appel `admin_*` |

| Outil | Doivent y mener | Ne doit pas |
|-------|-----------------|-------------|
| `admin_context` | toute demande d'administration (A1 à A12) ; « Sur quelles organisations j'ai la main ? » ; « Ouvre une session d'admin » | AN1 |
| `admin_org` | A1 ; A2 ; « Passe le seuil de routage d'Acme à 0,7 » | « Crée une équipe » (c'est `admin_team`) |
| `admin_team` | A3 ; A4 ; « Liste les équipes de Démo » | « Retire l'accès de Paul à Acme » (c'est `admin_org revoke_access`) |
| `admin_node` | A7 ; A8 ; « Qui a accès à ventes/ chez Acme ? » | « Crée une page » (c'est `write` côté utilisateur) |
| `admin_connector` | A9 ; « Crée un compte mail simulé pour l'équipe Ventes » ; « Quels connecteurs sont actifs chez Acme ? » | « Envoie ce mail » (c'est `call`) |
| `admin_journal` | A10 ; « Montre la conversation 7K3Q-M2XA » ; « Qu'ai-je fait hier sur le connecteur admin ? » | « Combien de prospects à Valbrune ? » |
| `admin_feedback` | A11 ; « Quels retours sont ouverts chez Acme ? » ; « Rouvre FB-0007 » | « Signale ce problème » (c'est `feedback`) |
| `admin_cell` | A12 ; « La base répond ? » ; « Quelles migrations sont appliquées ? » | « Mets à jour le paquet » (action JB) |

## Phrases par outil (checklist `mcp-design.md` §2 : 3 qui doivent y mener, 1 qui ne doit pas)

| Outil | Doivent y mener | Ne doit pas |
|-------|-----------------|-------------|
| `context` | tout prompt de travail (D2, I2, I3, R1, QP-D1) ; « Qu'est-ce que je peux te demander ici ? » ; « Reprends où on en était » | N1–N3 |
| `find` | « Trouve la procédure pour les remboursements » ; « On a une page sur les délais de livraison ? » ; « Quelle fonction crée un brouillon d'email ? » ; « Où est-ce qu'on parle de la PMO ? » (F3) | « Relance les devis en attente » (c'est `context` qui sert la procédure) |
| `read` | « Montre-moi le plan de la grille tarifaire » ; « Qu'est-ce qui a changé dans la FAQ depuis lundi ? » ; « Montre-moi mes conversations de la semaine » (`journal`, section `week`) | « Relance les devis » (c'est `context` puis `call`) |
| `call` | « Prépare un brouillon d'email à Sophie » ; « Prépare un brouillon pour Sophie » ; « Crée le brouillon pour Sophie » (CA1) (connecteur `mail` simulé) ; « Combien de prospects par statut ? » (`table.aggregate`) ; « Réserve-moi trois prospects à traiter » (`table.claim`) | « Combien coûte une pré-étude ? » (lecture de page) |
| `write` | « Ajoute une étape à la procédure de relance » ; « Corrige l'objet du modèle d'email » ; « Publie la page » | « Envoie l'email » (c'est `call`) |
| `feedback` | « Cette procédure manque une étape, signale-le » ; « L'outil mail a répondu une erreur incompréhensible » ; « Il manque un tableau des livraisons » | « Réponds au client » |

## Journal des révisions de métadonnées

> ⚠️ Les hosts figent instructions et descriptions : avant de tester une révision, faire le geste de rafraîchissement du host (mcp-patterns §8). Claude Code : nouvelle session. claude.ai : « Actualiser la liste d'outils » (menu ⋯ de la fiche du connecteur), puis nouvelle conversation dont le premier message part quelques secondes après l'ouverture de la page. ChatGPT : bouton « Actualiser » en bas de la fiche du connecteur, puis nouvelle conversation avec le connecteur sélectionné (`@nom`). Déconnecter/reconnecter ne rafraîchit rien de façon fiable.

| Date | Champ modifié | Raison (quel prompt échouait) | Résultat |
|------|---------------|-------------------------------|----------|
| 2026-09-24 | Contrat initial des six outils et instructions (serveur oto-platform 0.1.0, E03-S01, fiche D8 = B) | — (première version) | Descriptions de 761, 384, 429, 544, 717 et 350 caractères, instructions de 193 (Acme) ; instantané `tests/unit/__snapshots__/mcp-tools.test.ts.snap` ; smoke HTTP sur la Démo OK ; C1 à C3 à jouer sur les hosts après E02-S02 (campagne E06-S02) |
| 2026-09-25 | Description de `<p>_call` : cite `table.rows` pour toute organisation, `mail.create_draft` et `table.rows` quand `mail` est actif (E07-S01) | fonction native de lecture toujours active | à rejouer après « Actualiser » : I3, T1, T2, N-T1 |
| 2026-09-29 | Description de `<p>_write` (`move_block` vers une section, E11-S03) ; descriptions des fonctions `table.write` (`create_only`, preuve par tableau), `table.rows` (`q` par mots), `table.release` et du contrat `write.table` (E11-S01), réécrites en place (ADR-002 § 1) | FB-0001, FB-0003, FB-0008, FB-0009 (rapport de tests sur Démo) | à rejouer après « Actualiser » : C2, C2 bis, RW7, RW9, RW10, T6 à T10, N-T2 |
| 2026-09-29 | Description de `<p>_write` et du champ `publish` (publié par défaut, `publish: false` garde un brouillon), règle de « How this workspace works », contrats `write.procedure` et `write.table` (règle 10 : abandonner un en-tête refusé) ; fonctions `node.discard_draft`, `node.trash`, `table.delete_rows` au catalogue (E11-S02, ADR-002 § 1, fiche D135) | FB-0007, FB-0010 partie 3 ; retour du responsable d'Oto sur les brouillons | à rejouer après « Actualiser » : RG1, RW4, RW5, PR1, PR2, TB1 à TB3, PD1 à PD4, PDN1 |
| 2026-09-30 | Description de `<p>_read` (champ `file` : « To read an attached html, md, txt or csv file, give file = the id from its link /api/plateforme/files/<id>. ») et de `<p>_call` (« Use upload.link to put a file in a page, … otherwise, give the person the form link. ») allongées d'une phrase ; contrat `write.table` allongé de la même règle ; `upload.link` au catalogue (E10-S02, ADR-002 § 1, fiches D117, D119, D130) | — (fonctionnalité nouvelle) | à rejouer après « Actualiser » : les requêtes qui mènent à `read` et à `call` (RW1 à RW3, RW8, LK1 à LK3, CA1, CN2, T1 à T10, PD2 à PD4, IM1, DJ1, IJ1), puis FJ1 à FJ3 |
| 2026-09-30 | Adresses en anglais (E11-S07, ADR-020) : la description de `<p>_read` cite le lien `/api/platform/files/<id>` ; les liens de fichiers servis par `read` et l'adresse rendue par `upload.link` passent sous `/api/platform/` ; le refus `not_enabled` renvoie à `<origine>/admin/connectors`, la mise à la corbeille à l'écran `/trash` | — (consigne D132 : aucune adresse en français) | à rejouer après « Actualiser » : FJ1 (fichier joint lu par son lien `/api/platform/files/<id>`, puis `read {file}`), CNN1 (refus `not_enabled`, lien `/admin/connectors`), PD2 (récapitulatif de `node.trash`) ; un lien de fichier ou de dépôt donné avant la version ne s'ouvre plus |
| 2026-09-30 | Description de la fonction `upload.link` allongée d'une phrase (repli quand `curl` n'atteint pas la plateforme : `write` pour un `.md`, `table.import` pour un CSV, formulaire sinon ; 968 caractères) ; ses refus (chemin pris cité avec son message, méthode autre que `POST`, `.md` qui est une page HTML, stockage en échec, type servi par `source_url`) ; description de `table.import` et champ `key` de `table.import` et d'`upload.link` : la clé proposée est « the first text, whole-number, email or date column… » (1.1.3, ADR-002 § 1) | FB-0012, FB-0013 (proxy du shell de claude.ai en 403), FB-0014 | à rejouer après « Actualiser » : FJ2, FJ3, puis FJ4 à FJ6 et FJN1 sur claude.ai ; IM1 |
| 2026-09-30 | Descriptions de `<p>_context` (« If a tool answers "context has changed", retry with the new ctx it gives; since_ctx = your ctx routes another phrase without reloading. »), de `<p>_find` (section et appel `<p>_write` d'un bloc trouvé ; « To list every function, <p>_read path functions ») et de `<p>_read` (« every function you can run (path functions) ») ; champ `since_ctx` de `context` ; champ `match` et description de `q` du contrat `table.rows` ; texte servi : refus `ctx_stale` qui porte le nouveau code et les Contextes changés, ligne du code, candidates avec leurs mots en commun et le seuil, consigne d'une demande d'édition (genre `edit` : `modifie`, `corrige`, `change`, `remplace`, `mets à jour`, `réécris`, `reformule`, `supprime`, `retire`), question d'action (« Qu'est-ce que je lui réponds ? ») hors des questions de données (1.1.3, E11-S19, ADR-002 § 1 et § 2 amendé) ; description de `<p>_write` (« a refused publication writes nothing », section unique dans une page, `find` et `count` de `replace_text` sans section pour toute la page, `set_markdown`), champs `op`, `section`, `find`, `count` et `block` de `write`, contrats `write.procedure` et `write.table` (règles 8 et 10 : rien d'écrit sur un refus, l'appel à refaire avec `confirm_remove`) et ses refus, `node.move` et `node.write_many` au catalogue ; texte servi : refus « Nothing was written. », réponse « Published <path> revision N (…): … » en une ligne, `node.move` nommé quand le titre déplace le chemin (1.1.3, E11-S18, ADR-002 § 1, ADR-011 § 3 amendé) | Rapport de frictions d'un assistant qui a migré une base de connaissances SAV sur Démo (auteur refusé `ctx_stale` par sa propre écriture, `context` complet rechargé à chaque refus et à chaque phrase testée, seuil inconnu, catalogue introuvable, `q` en ET) et second retour (plan redit, section d'un bloc trouvé inconnue) ; pour E11-S18, le même rapport (un appel et un découpage par page, chemin déplacé par le titre sans moyen de le choisir, brouillon laissé par un refus, frontmatter devenu résumé) et FB-0015 (« Internal error » sur `add_section` avec `after`) | à rejouer après « Actualiser » : R2, R3, QP-I5, TD4 (doit rester une question de données), TD5, C2, C2 bis, C7, RW11, F5, T11 ; les phrases d'édition que le genre `edit` touche sans candidate : TDN1, PD2, TB3 (« Supprime… » reçoit la marche `find` puis `write`) ; celles qui mènent à `context`, `find` et `read` : C1, C3 à C6, RG1, I-news, I2, I3, F1 à F4, RW1 à RW3, RW8, DJ1, IJ1, FJ1 ; pour E11-S18 : M1 à M4, PD4 (plus de brouillon après un en-tête refusé : « Nothing was written. », rien à abandonner), et toutes celles que la description de `<p>_write` touche, RW1 à RW11 et RWN1 |
| 2026-10-01 | Description de `<p>_context` (« A result starting with "context has changed" gives a new ctx: use it, no retry; since_ctx = your ctx routes another phrase without reloading. ») ; texte servi : la ligne du code, l'avis « context has changed » en tête du résultat d'un appel dont le code est périmé (l'appel court, il n'est plus refusé), la ligne de `write` après la publication d'un Contexte | Décision du responsable : un Contexte changé ne coûte plus d'appel (rejeu sur Démo des retours d'assistants) | à rejouer après « Actualiser » : C2, C2 bis ; non rejoué sur les hosts à la livraison |
| 2026-10-01 | Description de `<p>_context` (« call it once per conversation » ; « the rules » sans le nom de l'organisation (longueur) ; borne finale : « Call it only for <org>'s work, or when the user's preferences ask for it. Otherwise do not call it. ») ; champ `phrase` (« Omit when there is no request yet, or when the request does not concern this workspace's work ») ; phrase de préférences servie par `/connect` | Les consignes tenues dans le Contexte ne s'appliquaient pas à une demande qui n'est pas du travail (« traduis ce texte ») : la phrase et la borne interdisaient de le charger | à rejouer après « Actualiser » : P1 à P6, B1 à B3, X1 à X3, C1 ; non rejoué sur les hosts à la livraison |
| 2026-10-13 | Fonctions `node.export_tree` et `node.import_tree` au catalogue, leurs descriptions, champs et refus (transfert d'une arborescence) | Demande de JB : copier une base d'un MCP Oto à un autre sans passer par la conversation | à jouer après « Actualiser » : TA1 à TA5, TAN1 ; à rejouer : M3 (un dossier de fiches zippé peut aussi mener à `node.import_tree`) |
| 2026-10-14 | Règles servies v2 (ligne « Reference », pièges), chemin `help`, propositions de fonctions et de section du guide sans procédure servie, `node.tree` et `node.check` au catalogue, avis d'un code périmé sous un refus, refus d'un chemin pris (1.4.3) | Cahier des charges « un agent autonome sur Oto dès le premier appel » : copie d'une base SAV entre deux organisations, une trentaine d'appels de correction | à jouer après « Actualiser » : TA6 à TA8, AV1, AV2 ; à rejouer : C1 à C7 (règles), TA1 à TA5 |
| 2026-10-19 | Description de `<p>_context` (« call it first, before any other <p>_ tool, with phrase = the user's request, verbatim, then again for each new request with since_ctx = your ctx, which routes it without reloading », au lieu de « call it once per conversation » ; la phrase sur `since_ctx` qui suivait l'avis « context has changed » y est remontée) ; règle servie « <p>_context (first, then again with since_ctx for each new request) » ; fonctions proposées sans procédure servie : deux mots communs au moins (1.4.10) | Retour d'usage du MCP Démo : « once per conversation » contredisait `since_ctx`, l'agent ne rappelait plus `context` ; « créer une tâche » proposait `node.export_tree` et `node.import_tree` sur un seul mot | à jouer après « Actualiser » : C7, P3, et une seconde demande dans la même conversation (`demo_context` avec `since_ctx`) |
| 2026-10-19 | Description de `<p>_find` (« returns the three best nodes in detail, the next ones in one line each, and up to three functions », au lieu de « up to three nodes and three functions ») ; texte servi : « Other matches: » et une ligne par nœud suivant, dix au plus ; `others` en données | Retour d'usage du MCP Démo : « créer une tâche » cachait la bonne procédure au-delà du troisième rang, seul « More nodes match (at least 6) » la signalait | à jouer après « Actualiser » : F1 à F3, et « créer une tâche » sur Démo |
| 2026-10-19 | Texte servi de `<p>_context` : titre « ## Procedures you can run, most used first (<n>) », bloc « ## Pages and tables close to the request » (cinq au plus) avec une phrase, coupe au budget par priorité (procédures nommées par leurs titres) ; classement de `<p>_find` aligné sur celui de `context` (1.4.10) | Retours d'usage du MCP Démo : `find` et `context` donnaient deux réponses à la même phrase ; sur l'organisation du premier client, les procédures et les contenus récents partaient au budget derrière onze Contextes | à jouer après « Actualiser » : C1 à C7, F1 à F3, et « créer une tâche » sur Démo |
| 2026-10-20 | Règle servie des genres : « Never put a procedure under a procedure: its sub-steps are pages under it, linked from its steps. » ; contrat `write.procedure` et guide de la plateforme (sous-procédures en pages) ; description de `node.check` (« …a procedure under a procedure ») ; `read` sert un lien vers un ancien chemin au chemin courant (1.4.11) | Retour d'usage : des procédures rangées sous une procédure, routées à la place de la principale ; un lien vers une page déplacée gardait l'ancien chemin dans le texte servi | à jouer après « Actualiser » : C1 à C7, et `read` d'une page qui cite une page déplacée |
| 2026-10-20 | Règles servies : deux lignes sur les procédures (« A procedure is a page of numbered steps… », « A good procedure has a part « When to use it »… ») ; sans procédure servie, une demande qui mène à la section procedures du guide reçoit la section entière (« From the platform guide (section procedures): ») au lieu de son chemin (1.4.12) | Demande de JB : une notice des procédures au début de chaque contexte | à jouer après « Actualiser » : C1 à C7, et « écris une procédure pour relancer les devis » sur Démo |

## Rapports de frictions agent (mcp-patterns §8)

> Après chaque évolution significative : demander à l'agent hôte un rapport structuré — déroulé step-by-step, points de blocage/ressenti, hypothèses de cause, repro minimale — sur les hosts. Recouper chaque fait avec le journal. Frictions déjà connues de la maquette : deux `context` appelés quand deux clients sont branchés, mode simulé non annoncé, double accord, résultats en prose, équipe porteuse de l'appel non dite.

| Date | Host | Friction observée | Cause | Action |
|------|------|-------------------|-------|--------|
| — | — | — | — | — |

## Preuve des valeurs de `table.write`, consigne d'accord, ordre de `table.claim`

- `table.write` : sur un tableau `proof: true` (celui de la Démo), chaque valeur nouvelle d'une colonne de valeur porte `{value, comment | link}` ; sans `proof`, elle s'écrit nue (E11-S01, fiche D133) ; une valeur nue égale à la valeur rangée est ignorée ; la colonne d'état s'écrit nue, dans ses transitions permises.
- Consigne d'accord servie avec une procédure : « … before anything that sends, or that changes data beyond the steps of the procedure the user asked for ».
- `table.claim` dit l'ordre de la file et `left` ; « What's new » omis quand rien n'est nouveau depuis le jour même.

| # | Prompt | Attendu |
|---|--------|---------|
| T6 | Note que le contact de la Boulangerie Fournier est Marius Roche, vu sur la page équipe de son site. | `acme_call table.write` avec `set: {contact: {value, comment \| link}}` ; aucune valeur nouvelle nue ; aucun refus « without its proof » |
| T7 | Remets la Boulangerie Fournier en revue. | `acme_call table.write` avec `set: {statut: "à revoir"}` nu, qui s'écrit (ou `table.release` si la ligne est réservée) |
| T8 | Relis la ligne de l'Atelier 2 et renvoie-la sans rien changer. | `table.rows` puis `table.write` avec les valeurs lues telles quelles : « unchanged », aucune écriture, aucun refus |

N-T2 : aucun `table.write` ni `table.release` qui pose « qualifié » ne réussit (refus : décision réservée à la revue, jamais « new value without its proof »). À rejouer sur les trois hôtes : QP-D1, QP-D2, QP-I1, QP-I5, T6 à T8, N-T2.

## Widget routeur (story widgets-dans-la-conversation, banc du lot 1)

Organisation au contenu d'Acme, hôte déployé avec `PLATFORM_MCP_WIDGETS=on`, liste d'outils rafraîchie (§ 8 de
`mcp-patterns.md`). Sur claude.ai et ChatGPT, l'attendu se lit à l'écran et au journal ; sur Claude Code, aucun
widget, texte et routage inchangés. Le routage de chaque ligne est celui des lignes citées : seul le rendu change.

| ID | Prompt | Attendu |
|----|--------|---------|
| W1 | Combien de prospects avons-nous à Valbrune, et lesquels ? | Routage d'I3 ; `acme_call table.rows` rend `view.kind = "table"` : les lignes rendues en tableau dans la conversation, au thème de l'organisation, de nuit si l'host l'est |
| W2 | Montre-moi la fiche du prospect Mairie de Coudray. | `acme_call table.rows` filtré sur une ligne : `view.kind = "record"`, la fiche rendue |
| W3 | Montre-moi le modèle d'email de relance. | `acme_read ventes/modele_relance` : `view.kind = "page"`, la page rendue |
| W4 | Combien de prospects par ville ? | `acme_call table.aggregate` : aucune vue. **Mesure** : un cadre vide est-il visible ? Elle décide du lot 2 (outil `view` dédié sinon) |
| W5 | Lis-moi la section Dimensionnement de la méthode d'étude. | Routage de RW2 : aucune vue ; même mesure que W4 |
| W6 | Qu'est-ce que je peux te demander ici ? | Routage de C1 : `acme_context` seul, aucun cadre (le widget n'est déclaré que sur `call` et `read`) |
| W7 | Liste tous nos prospects. | `acme_call table.rows` (20 lignes, `next_cursor`) : « Lignes suivantes » dans le widget appelle `acme_call table.rows` avec le même filtre et le curseur, sans `confirm` ; le journal porte un second `tools/call` sous le même `ctx` |
| W8 | (même conversation) Un bouton de suite proposé sous le tableau (`table.write`, par exemple) | Un message « Lance table.write sur ce résultat. » apparaît dans la conversation ; l'assistant demande ou choisit les arguments ; aucun appel du widget au journal |
| W9 | (hôte qui inscrit une vue de l'ERP, `view: "devis"`) Montre-moi le devis D-041. | `acme_call erp.<fonction>` : `view.kind = "erp:devis"`, la vue de l'hôte rendue ; un bouton de la vue qui appelle une fonction sensible ne rend que son récapitulatif |
