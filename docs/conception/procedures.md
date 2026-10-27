# Procédures

- **Statut** : proposé
- **Dernière révision** : 2026-10-27

## Résumé

Une procédure est une page `kind: procedure` : un titre, un résumé qui dit comment on la demande, des étapes, et chaque appel exact en bloc `call`. Le serveur ne lit que ses blocs `call`, contrôlés à la publication ; `context` la met en tête des procédures proches quand le routage la reconnaît, et l'assistant la lit par `read`, entière, sans borne de taille. À l'écran, elle s'édite et se lit comme une page.

## Contexte

Oto faisait de la procédure un objet à part (slots liés par projet, équipement, exécutions, phrases déclencheuses et voisines) ; la plateforme la réduit à une page, que le routage trouve par son titre et son résumé ([routage et recherche](routage-et-recherche.md)) et que l'assistant exécute par `call` ([connecteurs et comptes](connecteurs-et-comptes.md)). Tant que les connecteurs réels ne sont pas là, l'écran n'en montre que le texte.

## Objectifs et non-objectifs

- Une procédure se lit et s'écrit comme toute page ; seul ce que le serveur exécute est structuré (le bloc `call`).
- Un appel écrit dans une procédure est contrôlé avant d'être servi : un assistant ne reçoit jamais un appel invalide.
- Hors objectif : phrases déclencheuses, voisines, slots ou entrées déclarées ; l'exécution d'un appel par l'écran ; un éditeur structuré d'appels tant que les connecteurs ne sont pas là (D104).

## Conception

### Forme

- Une procédure est une page `kind: procedure` : titre, résumé (ce qu'elle fait et comment on la demande) et étapes ; chaque appel exact est un bloc `call` `{function, args}`, un espace réservé `"<…>"` valant une valeur fournie à l'exécution (H59).
- Elle se réduit à un titre, un résumé et des étapes ; le résumé porte les façons de la demander, et le routage cherche dans le titre et le résumé ; ni phrases déclencheuses, ni voisines, ni slots, ni entrées (P37).
- Son contenu est celui d'une page ; le serveur n'en lit que les blocs `call`, contrôlés à la publication où qu'ils soient ; un refus nomme la section, le rang du bloc et, après une liste numérotée, son numéro (P38). Pages et blocs : [pages et blocs](pages-et-blocs.md).
- Un espace réservé est une valeur chaîne entière `^<[^<>]+>$`, à tout niveau ; sa clé est contrôlée, sa valeur non ; `isPlaceholderValue` (`schemas/procedures.ts`) en est la seule définition (E03-S06 N10).
- Jamais une procédure sous une procédure (1.4.11) : seule la procédure principale est routée et listée ; chacune de ses sous-étapes est une page (`kind: page`) rangée sous elle, que ses étapes citent par `[[chemin]]`. Une procédure imbriquée serait routée à la place de la principale. La règle se lit dans les règles servies par `context`, le contrat `write.procedure` et le guide de la plateforme ; le « + » d'une procédure, dans le rail, n'offre pas de procédure ; `node.check` signale une procédure sous une procédure (`nestedProcedures`, `server/transfer/inspect.ts`). Aucun refus à l'écriture : une arborescence importée ou ancienne se corrige, elle ne se bloque pas.
- Les types des refus et de la liste des procédures, et `isPlaceholderValue`, vivent dans `schemas/procedures.ts`, sans schéma Zod, lisibles par `ui/` qui n'importe pas `server/` (E03-S06 N15).
- `read` sert deux pseudo-fonctions non appelables, au rendu d'un contrat de fonction : `write.procedure` (écrire une procédure) et `write.table` (l'en-tête d'un tableau) (H62). Le contrat `write.procedure` ne porte pas de schéma d'en-tête : il décrit la forme d'une procédure, les deux façons d'écrire un bloc `call` et les refus ; seul `write.table` a un « Header (JSON Schema): » (E03-S06 N14).

### Contrôle à la publication

- Publier une procédure contrôle chaque bloc `call` : fonction active, clés d'arguments connues, valeurs conformes, contrôle propre à la fonction ; un bloc `code` en langage `call` est refusé ; un refus nomme section, rang du bloc et étape (H60).
- Le contrôle lit les blocs (types `call` et `code`, et les lignes ```` ```call ```` que rend un bloc), jamais le markdown ; la clôture ```` ```call ```` n'est que la forme markdown d'un bloc `call` (E03-S06 N1).
- Un bloc `code` de langage `call` (rogné, sans casse) est refusé (R2) : `renderBlocks` l'écrirait comme un appel jamais contrôlé (E03-S06 N3). R2 vaut pour toute clôture `call` : un bloc `code` dont la ligne d'ouverture rendue ouvre une clôture `call`, et tout texte rendu tel quel dont une ligne rognée en ouvre une (accents graves ou tildes, puis `call` ; `callout` exclu) (E03-S06 N17).
- `confirm`, `team`, `account`, `ctx`, `function` ou `arguments` écrits dans les arguments d'un bloc `call` : refus R9 avec l'indice (E03-S06 N11).
- Aucune borne de taille (2026-10-27) : une procédure se publie quelle que soit la longueur de ses étapes ; `read` la sert entière, sans plan d'office au-delà de 12 000 caractères (`PAGE_FULL_MAX` ne vaut que pour une page), et seul son curseur la découpe au-delà de 45 000 caractères (`server/nodes/read-body.ts`).
- Le refus donne tous les problèmes d'un coup (20 listés, le reste compté) et `details.refusals` complet, avec l'`id` du bloc fautif (E03-S06 N5). Les refus vont dans `details.refusals` ; `effectiveHeader` est exporté ; `previewContext` rend aussi `served` et `candidates` (P19).
- `checkProcedure` contrôle le brouillon quand le niveau calculé vaut au moins 2, sinon les blocs publiés ; `listProcedures` liste les nœuds de genre `procedure` de niveau ≥ 1, une page au genre en attente n'y entrant qu'à sa publication (E03-S06 N8).
- `publishNode` lit le tampon du brouillon (`node_drafts.updated_at`) avant ses blocs, pour tout genre, et le passe en `p_draft_stamp` : un brouillon changé pendant le contrôle rend `stale_revision`, et rien n'est publié (E03-S06 N9).
- Le service refuse encore la publication d'un bloc `call` invalide ; l'écran de refus de publication en dit l'emplacement et le genre (HN-M59-3).

### Service aux assistants

- `context` ne sert pas les étapes (2026-10-27) : la procédure décidée est en tête des procédures proches, avec la consigne de la lire par `read` puis de suivre ses étapes, et comment recopier un bloc `call` en appel de `<p>_call`, chaque valeur `<…>` remplacée par la vraie (E03-S06 N12). Forme servie : [routage et recherche](routage-et-recherche.md), [contexte servi](contexte-servi.md).
- Les procédures publiées lisibles sont aussi des prompts MCP (message = titre) ; côté assistants, rien ne dépend de l'écran (`context`, prompts, vérification à la publication) (D104).

### À l'écran

- Une procédure est une page comme les autres tant que les connecteurs ne sont pas là : même éditeur et même lecture, texte seul, un bloc d'appel déjà écrit lu en texte (D104). Un bloc `call` déjà écrit se lit comme un texte (« Appel de <fonction> : { … } »), jamais exécuté par l'écran ; un appel dont le texte ne change pas reste un appel, et rien ne part pour lui (HN-M59-1).
- Écrire un appel : deux champs, fonction et arguments JSON relus en objet, et le bloc part structuré `{ type: "call", data: { function, args } }` ; les espaces réservés `"<…>"` sont admis (HN-E05S04-8). « Appel de fonction » n'est offert que sur une procédure ; ailleurs, un bloc `call` se lit, se déplace et se supprime (HN-E05S04-11). Insérer un appel dans une liste numérotée la coupe, et la suite reprend son numéro (`start`) ; une liste numérotée ajoutée juste après un appel continue la numérotation (HN-E05S04-9).
- Les refus du contrôle se disent un par un : emplacement (section, rang, étape, sinon « Avant le premier titre » ou « Procédure »), genre traduit, lien vers le bloc, texte anglais sous « Détail technique » (HN-E05S04-2).
- **Tester une phrase** : un formulaire GET (`?phrase=`, 2 000 caractères au plus) calculé par la page serveur avec `previewContext` (procédure servie, score, candidats) ; aucune route API d'aperçu (HN-E05S04-1).

### Éditer un Contexte et sa fiche

- Un Contexte s'édite sur son écran de nœud (`/n/<chemin>`), ses annexes à droite (qui le reçoit, ce que le modèle recevra) ; aucune route `/contexte`, aucun lien de navigation « Contexte » (HN-E05S04-6). Publier un Contexte vide demande confirmation (« Publier quand même »), sans prendre le focus de qui écrit (HN-E05S04-10). Le Contexte Perso d'une autre personne se dit reçu par « la personne de cet espace seulement » et « Personne d'autre ne le reçoit, vous non plus. » ; il se reconnaît à l'absence de « Ma fiche » (HN-E05S04-22). Ce que sert un Contexte : [contexte servi](contexte-servi.md).
- « Ma fiche » vit dans les annexes du Contexte Perso de la personne, sur le sien seulement (HN-E05S04-7). Elle s'écrit par `PATCH /api/platform/profile`, puis `update_my_profile(p_org, p_patch)` : seuls les champs changés partent ; une personne peut vider un champ, un agent non (HN-E05S04-4). Les langues de la fiche sont `fr` et `en` (HN-E05S04-5). `updateProfile` refuse avant sa requête un appelant sans ligne `members` (entré par un accès plateforme) : `forbidden` `Only members of <org> have a profile here.` (HN-E05S04-12).

- Avertissements à la publication (1.4.3, `server/procedure-advice.ts`), jamais des refus : une procédure sans partie « Quand l'utiliser » (« When to use it »), une procédure qui nomme ses outils avec le préfixe d'une organisation. Une dépendance à un connecteur de l'assistant, hors de la plateforme, s'écrit dans une partie « Prérequis » (« Prerequisites »), lue avec les étapes : l'assistant qui ne l'a pas le dit à la personne au lieu d'échouer à l'étape. Les règles de qualité se lisent au guide de la plateforme, section `procedures`.

## Décisions et alternatives écartées

- **La procédure comme objet à part** (Oto : slots liés par projet, équipement, exécutions, phrases déclencheuses et voisines) : écartée pour une page (P37), que le routage lit par titre et résumé ; les anciennes déclencheuses sont devenues des formulations du résumé ou des paraphrases de test ([routage et recherche](routage-et-recherche.md)).
- **Lire le markdown pour contrôler les appels** : écarté ; le contrôle lit les blocs (E03-S06 N1), et un bloc `code` en langage `call` est refusé parce qu'il serait rendu comme un appel jamais contrôlé (E03-S06 N3).
- **Un éditeur d'appels structuré à l'écran dès la V1** : reporté ; tant que les connecteurs ne sont pas là, la procédure est une page en texte seul (D104, HN-M59-1).
- **La page de liste `/procedures`** : plus en vigueur, elle a disparu (tout nœud s'ouvre à son adresse, ADR-008 § 7) ; un espace personnel se nomme « Privé », reconnu à son chemin `perso/…` (HN-E05S04-21).
- **Refuser une procédure sous une procédure à l'écriture** : écarté ; l'arborescence existante et importée resterait bloquée à la moindre écriture, alors qu'une consigne, l'écran et `node.check` suffisent à l'éviter et à la retrouver.
- **Une borne de taille d'une procédure** (R1, genre de refus `too_long`, P24, E03-S06 N6 : 8 000 caractères, puis 12 000 le 2026-10-19, `PROCEDURE_MAX_CHARS` lue par le contrôle, l'écran, le contrat `write.procedure` et le guide) : retirée le 2026-10-27 par JB ; elle existait parce que `context` servait la procédure entière, ce qu'il ne fait plus. Une procédure longue se lit par `read`, entière.
- **Une route `/contexte` et une route API d'aperçu** : écartées ; le Contexte s'édite sur son écran de nœud (HN-E05S04-6), l'aperçu est calculé par la page serveur (HN-E05S04-1).

## Sécurité et confidentialité

- Un bloc `call` ne peut porter ni `confirm`, ni `team`, ni `account`, ni `ctx` (E03-S06 N11) : une procédure n'élève pas un appel au-delà de ce que l'assistant et la personne décident au moment de l'exécution ; les fonctions sensibles restent en deux temps ([connecteurs et comptes](connecteurs-et-comptes.md)).
- Le contrôle lit le brouillon seulement pour qui écrit (niveau ≥ 2), les blocs publiés sinon (E03-S06 N8) ; un brouillon changé pendant le contrôle ne se publie pas (E03-S06 N9).
- « Ma fiche » n'est écrite que par sa personne (HN-E05S04-4, HN-E05S04-12) ; droits sur les nœuds : [droits d'accès](droits-d-acces.md).

## Écart avec le code

- L'écran n'édite qu'en texte un bloc `call` déjà écrit (HN-M59-1) ; l'éditeur d'appels complet attend les connecteurs réels (V2).

## Questions ouvertes

Aucune à ce jour.

## Historique

- 2026-09-29 : procédure réduite à une page `kind: procedure`, blocs `call` contrôlés à la publication, contrats `write.procedure` et `write.table`, éditeurs et aperçu « Tester une phrase » livrés dans la V1, publiée en 1.0.0 (source : stories E03-S06, E05-S04 ; choix H59, H60, H62, P19, P37, P38).
- 2026-09-29 : à l'écran, une procédure est une page comme les autres tant que les connecteurs ne sont pas là — décidé par JB, date de la fiche non conservée, en vigueur à la 1.0.0 (source : fiche D104, tâche M59).
- 2026-10-27 : plus de borne de taille d'une procédure ; `context` ne sert plus ses étapes, `read` la sert entière — décidé par JB (source : session du 27/10/2026, `context` trop lourd).
- 2026-10-01 : refonte en document de conception vivant, qui reprend la fiche D104, les choix H59, H60, H62, P19, P37, P38 et ceux des stories E03-S06 et E05-S04 — décidé par Alexis, accord de JB.
