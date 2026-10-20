# Pseudonymisation des données servies à l'assistant

- **Statut** : validé avec Alexis le 19/10/2026
- **Dernière révision** : 2026-10-20 (membre désigné par son jeton dans `node.share`)

## Résumé

Le paquet remplace, dans tout ce que le serveur MCP rend à un assistant, chaque mention d'une personne que l'hôte déclare par un jeton opaque et stable, `client#k7f3m2q9x4p1a` : texte et données, résultats et refus, prompts compris. L'hôte ne fait que déclarer ses personnes (`registerSensitiveEntities`) ; le paquet ne lit jamais ses tables. Un champ dont le contenu même est le secret est retenu entier (`withhold`).
Le jeton est un HMAC de l'identifiant, sous une clé propre à l'organisation ; aucune table de correspondance : il se résout par recherche inverse dans le dictionnaire de l'organisation, et effacer la personne chez l'hôte le tue. Une valeur ne redevient claire que vers une sortie que l'hôte déclare de confiance, sous son contrôle de portée, journalisée.
Le chantier se livre en six jalons, dans l'ordre de besoin : primitives (J1), dictionnaire et porte (J2), retenue d'un champ (J2b), détecteurs par forme (J3), sorties de confiance (J4), généralisation et modèle en option (J5).

## Contexte

- Un assistant lit, par les six outils ([outils MCP](outils-mcp.md)), des pages, des tableaux, des fichiers et le résultat de fonctions de l'hôte et de connecteurs. Tout part chez le fournisseur du modèle. Pour un hôte qui traite des données de personnes (ses clients, leurs dossiers), c'est un transfert de données personnelles à un tiers, à chaque conversation.
- Décision d'Alexis (19/10/2026) : la pseudonymisation se construit dans le paquet, une fois pour tous les hôtes ; l'hôte déclare ses personnes. Quatre primitives sont décidées avec elle (J1).
- Aujourd'hui, le journal ne masque que les clés de secret (`server/journal.ts`, `loggedArgs`) ; `read {path, file}` sert le texte d'un fichier joint (`server/nodes/read-file.ts`) ; l'hôte appelle une fonction par `callFunction` (`server/function-call.ts`), qui passe par `runCall` avec les contrôles d'activation de `<p>_call` : un connecteur actif est donc toujours servi à l'assistant.
- Un essai antérieur, hors de ce dépôt, a dû retirer le masquage des noms : il masquait des mots courants et bloquait le travail. Les faux positifs se mesurent avant de servir (J3).

## Objectifs et non-objectifs

- Aucune valeur d'une personne déclarée ne sort en clair du serveur MCP, quelle que soit la porte (résultat, refus, prompt, widget).
- L'assistant travaille sur des jetons comme sur des noms : il les relit, les recopie dans un appel, écrit avec eux ; le même jeton désigne la même personne d'une conversation à l'autre dans une organisation.
- Fermé en cas de panne : un dictionnaire illisible refuse l'appel, il ne sert jamais en clair.
- Le journal ne voit que des jetons ou des valeurs masquées.
- Hors objectif : ce que la personne tape elle-même dans la conversation (elle choisit de le donner au modèle) ; les écrans, exports et liens publics, lus par des personnes, sauf l'affichage résolu de J4 ; l'anonymisation au sens du RGPD (un jeton reste une donnée personnelle pseudonymisée) ; un sel par dossier (la recherche inverse devrait connaître le dossier, voir « Décisions ») ; une rétention propre à chaque organisation en V1 ; les fichiers binaires servis en original (refusés, voir l'inventaire).

## Conception

### Ce que l'hôte déclare

- Une **sorte** (`client`, `person`…) : un nom ASCII minuscule de 2 à 10 caractères, qui n'est pas une sorte réservée aux détecteurs (`email`, `phone`, `iban`, `nir`, `card`, `name`). Pour chaque sorte, deux fonctions lues dans la base de l'hôte, jamais par le paquet : `list(org)` rend toutes les entités de l'organisation avec leurs valeurs ; `read(org, id)` en rend une, ou `null` si elle n'existe plus.
- Les valeurs d'une entité : nom, prénoms, courriels, téléphones, adresses, et des désignations libres (`aliases` : nom d'usage, raison sociale, référence de dossier).
- Après toute écriture d'une entité déclarée (création, changement, effacement), l'hôte appelle `invalidateSensitiveEntities(db, org)`.
- La pseudonymisation est active pour toute organisation d'un hôte qui déclare ; une organisation sans entité garde les détecteurs par forme (J3).
- **Allumer par organisation** (20/10, à la demande d'un hôte) : `registerSensitiveEntities(kinds, { enabled })`, où `enabled(org)` (`{ id }`) rend une promesse de booléen, lue à chaque appel, sans redémarrage ; son cache est à la charge de l'hôte. Sans prédicat, toutes les organisations sont allumées. Éteinte, l'organisation est servie comme sans déclaration : pas de porte, pas d'avis des jetons dans `context`, journal et retours en clair, `pseudonymize` rend la valeur telle quelle, et ni la clé ni l'état de l'organisation ne sont lus. Une exception : une conversation commencée allumée garde ses jetons. Quand des arguments portent la forme d'un jeton d'une sorte déclarée ou réservée, le dictionnaire se bâtit et les résout comme allumée (argument d'entité, chemin, requête, clé de ligne, filtre, `replace_text`), jetons HMAC et de référence ; un jeton de valeur (`email#…`, `phone#…`, `name#…`) reste à sens unique, gardé dans un contenu, refusé pour désigner une personne. Rallumée, l'organisation retrouve les mêmes jetons (même sel). Un prédicat qui lève ou ne rend pas un booléen ferme l'appel (`internal`, raison `pseudonymization_unavailable`) : rien en clair.

### Le jeton

- Format : `<sorte>#<corps>`, retenu le 19/10 sur le banc de fidélité (§ Mesures de J2), corps de 13 caractères en base32 de Crockford minuscule, soit 64 bits. Expression : `(?<![0-9A-Za-z])([a-z][a-z0-9]{1,9})#([0-9a-hjkmnp-tv-z]{13})(?![0-9a-z-])` : ni lettre ni chiffre avant la sorte, ni après le corps. L'enveloppe est une seule constante (`TOKEN_ENVELOPE`, `token.ts`) ; `⟦…⟧` et `‹…›`, mesurées aussi, sont écartées (§ Décisions).
- Sans fermeture, la forme ne prouve pas le jeton : l'ancre d'une adresse (`guide#installation`) l'a aussi. La porte ne garde, sans y chercher de mention, que les jetons que le dictionnaire connaît (`fiche#camille_dupre` se masque) ; l'entrée ne lit comme jeton qu'une suite d'une sorte déclarée ou réservée, le reste est du texte. L'hôte choisit une sorte que ses textes n'écrivent pas devant un `#`.
- Corps : les 64 premiers bits de `HMAC-SHA-256(k_org, "entity|" + sorte + "|" + id)`. Clé de l'organisation : `k_org = HMAC-SHA-256(clé maître, "oto/pseudonym|" + org_id + "|" + sel)`. Le contexte d'usage est l'étiquette en tête du message : `entity|` pour une entité, `value|<détecteur>|` pour une valeur détectée par forme (J3), à sens unique.
- Clé maître : `PLATFORM_PSEUDONYM_KEY`, 32 octets en base64, lue à l'usage comme `PLATFORM_VAULT_KEY`. Sel et version de clé par organisation, en base (`platform.pseudonym_orgs`, J2 ; un membre lit les lignes de ses organisations, aucune session ne les écrit), avec un **témoin** : l'identifiant de la clé maître (six octets de son empreinte SHA-256, comme le coffre). Un témoin qui ne correspond plus refuse tout appel de l'organisation : une clé changée par erreur changerait tous les jetons en silence.
- La version n'est pas dans le jeton : le dictionnaire calcule les jetons de la version active, et de la précédente pendant une rotation (J4). Un caractère de moins par mention.
- Sans clé, nul ne calcule le jeton d'un nom connu : le fournisseur du modèle ne peut pas confirmer une hypothèse en hachant un nom.

### Référence fournie par l'hôte (option par sorte)

- Option d'une sorte (`tokens: "reference"`) : chaque entité porte `reference` (un numéro propre à l'organisation, `c-12`), qui devient le corps du jeton : `client#c-12`. Le HMAC reste le défaut.
- L'hôte choisit une référence **non séquentielle** (tirée au hasard, ou dérivée sous sa propre clé) : une suite dit un ordre et un volume.
- Conditions, vérifiées à la construction du dictionnaire, qui refuse sinon :
  - toutes les entités de la sorte ont une référence (aucun mélange avec le HMAC dans une sorte) ;
  - la référence est unique dans la sorte et l'organisation, sans casse ; l'hôte la garantit, le paquet le vérifie ;
  - alphabet du corps : `[0-9a-z][0-9a-z-]{0,23}`, en minuscules ; l'expression du jeton devient `(?<![0-9A-Za-z])([a-z][a-z0-9]{1,9})#([0-9a-z][0-9a-z-]{0,23})(?![0-9a-z-])` ;
  - la référence est opaque, sans donnée de la personne : la documentation l'impose, et le paquet rejette au mieux une référence qui contient une forme normalisée de l'entité (nom, prénom de 3 lettres au moins, partie locale d'un courriel, 6 chiffres consécutifs d'un téléphone).
- Ce qu'elle révèle : une référence séquentielle dit un ordre d'arrivée et un volume (`c-12` : peu de clients, ou un client ancien). Une référence **n'est pas sous clé** : quiconque tient la liste de l'hôte, ou un document qui la cite, relie le jeton à la personne sans la clé maître. Elle ne change pas à une rotation de clé.
- Ce qu'elle apporte : un jeton plus court, lisible par la personne qui connaît ses dossiers, et que l'hôte relit sans le paquet.

### Réversibilité : recherche inverse, pas d'identifiant chiffré

- Le dictionnaire de l'organisation porte, pour chaque entité, le jeton et ses formes reconnues ; la recherche inverse va du jeton à `(sorte, id)`. Une collision se voit à la construction du dictionnaire : elle la refuse (panne nommée au log), et le remède est un nouveau sel pour l'organisation.
- Une entité effacée chez l'hôte disparaît du dictionnaire à l'invalidation : son jeton ne désigne plus personne, sans dépendre de `read`. Toute réidentification relit en plus `read(id)` : l'effacement vaut tout de suite, même avant l'invalidation.

### Le dictionnaire et la détection

- Normalisation : NFKD, diacritiques retirés, casse repliée, ligatures (`œ`, `æ`, `ß`), apostrophes et tirets unifiés, blancs resserrés (l'astérisque d'une emphase Markdown compte pour un blanc : `find` met en gras chaque mot trouvé, « **Jean** **Morin** ») ; une table de positions rend la coupe dans le texte d'origine.
- Formes d'une entité : « prénoms nom », « nom prénoms », premier prénom et nom dans les deux ordres, initiale et nom (« j. dupont »), civilité et nom (`m`, `mme`, `mlle`, `monsieur`, `madame`, `mademoiselle`, `me`, `maître`, `dr`, `docteur`, `pr`, avec ou sans point ; reconnue à la recherche, le nom après la civilité, pas une forme par couple), la forme en chemin de chaque forme de mots (`jean_dupont`, `acme_sa`) et sa forme à tirets, celle d'une adresse web (`jean-dupont`), le nom seul (ci-dessous), chaque courriel, chaque désignation libre, la ligne de voie de chaque adresse. Un téléphone se compare en chiffres, au format E.164 (`+33` par défaut), à ce que trouve le détecteur de téléphones.
- Mots entiers seulement : ni lettre ni chiffre de part et d'autre. La plus longue mention l'emporte, de gauche à droite. Rien n'est cherché dans un jeton déjà posé.
- Le **nom seul** n'est masqué que s'il a au moins 3 lettres et ne figure pas dans la liste des mots courants (mots de la langue et prénoms, livrée avec le paquet) ; « Martin » ou « Rose » seul reste en clair, masqué avec le prénom, une civilité ou dans un champ déclaré (§ Les champs déclarés, J3). Le prénom seul n'est jamais masqué. Ces deux restes sont une **limite assumée** (décidé par Alexis le 20/10, § Décisions) ; pour les fiches de l'hôte, `output.entityFields` les couvre. Un nom seul se masque aussi dans un nom composé (« Marie-Jean Morin ») ; un courriel non déclaré qui le contient (`anne.dupre@…`) est remplacé entier par le détecteur de courriels.
- La liste des mots courants (J3, 19/10) : deux fichiers générés par `scripts/mots-courants.mjs` dans `server/pseudonym/words/`, à partir de sources épinglées par version et empreinte, chacun sous sa licence et avec sa notice :
  - les mots communs du lexique des formes fléchies de Grammalecte, version 7.7 (MPL 2.0, confirmée sur le fichier de la version téléchargée), sans les entrées étiquetées nom propre, prénom ou patronyme, vus au moins 100 000 fois dans ses corpus (environ 0,7 par million de mots) : 34 972 formes. Au-dessous, un mot est trop rare pour qu'un nom qui l'écrit reste en clair : « Moreau » (4 030) et « Fournier » (13 104) se masquent, « Brun » et « Fontaine » non ;
  - les prénoms du fichier des prénoms de l'Insee (naissances en France de 1900 à 2025, paru le 16/07/2026, Licence Ouverte 2.0, « Source : Insee »), donnés au moins 1 000 fois : 3 221 formes. « Martin » (73 180), « Bernard », « Thomas » ou « Laurent » restent en clair seuls ; « Durand » (75) ou « Leroy » (225) se masquent.
- Une forme partagée par deux entités (homonymes, nom seul commun à deux personnes) ne désigne personne : elle reçoit un jeton de valeur `name#…`, à sens unique.
- Les **détecteurs par forme** (J3, `detectors.ts`) : courriel et téléphone, cherchés dans tout texte que la porte parcourt, que la personne soit déclarée ou non. La valeur d'une personne déclarée garde le jeton de son entité ; une autre devient un jeton de valeur à sens unique, `email#…` ou `phone#…` (message `value|email|<courriel normalisé>` ou `value|phone|<E.164>`), le même pour la même valeur dans l'organisation, quelle que soit l'écriture du numéro. Courriel : une partie locale, `@`, un domaine à suffixe de lettres ; `user@localhost` ou `@scope/paquet` n'en sont pas. Téléphone : international (`+` ou `00`, 8 à 15 chiffres, `(0)` toléré après l'indicatif), ou français à dix chiffres `0[1-9]`, par paires d'un même séparateur ; ni lettre ni chiffre autour. Une date (`1914-1918`, `01.02.2024 10:30`), un SIRET, un IBAN ou un ISBN à tirets ne s'y prennent pas ; un ISBN à dix chiffres collés qui commence par `0`, si ; un numéro national étranger sans indicatif reste en clair. Reçu dans un argument, un tel jeton ne se cherche pas dans le dictionnaire (la porte le pose sans lui) : à sens unique, gardé dans un contenu, refusé dans une désignation. Les détecteurs servent toute organisation d'un hôte qui déclare, sans entité comprise.
- Une table des formes par organisation (`Map`), et non un automate : une mention commence au début d'une suite de lettres ou de chiffres et finit à la fin de l'une des 12 suites suivantes au plus ; chaque candidat se cherche dans la table, le plus long d'abord. Les formes sont bornées par des mots, le nombre de candidats par mot est celui des mots de la plus longue forme, et la mémoire est celle des formes seules. Un nom composé (« Marie-Jean Morin ») ne se coupe pas au tiret ; un courriel ne se coupe pas dans un courriel plus long. La porte parcourt `text` et chaque chaîne de `data`, à toute profondeur ; les clés d'objet ne sont pas touchées.

### La porte : inventaire des sorties vers l'assistant

La porte est une fonction pure du dictionnaire, appliquée au `ToolOutput` (texte et données) **avant** `formatResult`, pour que la coupe à 45 000 caractères et le plafond des données (`MAX_DATA_CHARS`) se mesurent sur ce qui part. `next_actions` (noms de fonctions), `view` et `new_ctx` (un code) sont posés après, par le formateur, et ne passent pas.

| Sortie vers l'assistant | Où, dans le code d'`origin/main` | Couverte |
|---|---|---|
| Résultat de `tools/call` : `context`, `find`, `read` (page, tableau, fichier, `journal`, `functions`, `help`, contrat d'une fonction), `call` (fonction native, de l'hôte, de connecteur partagé ou propre, simulé ; récapitulatif d'une fonction sensible), `write`, `feedback` | `mcp/server.ts`, `runTool`, sur `output` avant `formatResult` (l. 199) ; services de `SERVICES` (l. 110) | J2 |
| Avis d'un Contexte changé (`withCtxNotice`, chemins servis) | `runTool`, compris dans `output` et dans le refus | J2 |
| Refus et pannes d'un outil (message d'un service, d'un tiers par `upstream_error`) | `runTool`, `catch`, sur `failure.message` avant `withCtxNotice` et `formatError` (l. 205) | J2 |
| Données d'un widget (`structuredContent`) et appels du widget | même chemin que le résultat : le widget appelle `call` par l'host | J2 |
| `prompts/list` (titre, description) et `prompts/get` (description, message) | `visiblePrompts`, `servedPrompt` (`mcp/pseudonym.ts`) ; le nom d'un prompt est de l'ASCII que Claude Code met dans une commande : un prompt dont le nom nomme une personne n'est pas servi (inconnu à `get`), la procédure reste lisible par `read` | J2 |
| MCP admin, opérations sur une organisation (journal, nœuds, retours) | `mcp/admin/server.ts`, `runAdminCall`, avant `formatResult` et `formatError`, sous l'organisation de l'opération (`output.orgId`, sinon celle de la trace) ; sa porte en panne, le refus devient `Internal error.` | J2 |
| Champ qui nomme une personne déclarée (nom, prénoms d'une fiche de l'hôte) | `runCall`, pour une fonction de l'hôte appelée par le MCP (`withEntityTokens`, `server/pseudonym/outputs.ts`) | J3 (`output.entityFields`) |
| Champ dont le contenu est le secret (patrimoine, situation familiale, notes, régime, numéro d'identité) | moteur des connecteurs décrits (`shaped`, `server/connectors/engine.ts` l. 293) ; `runCall` pour une fonction de l'hôte | J2b (`withhold`) |
| Coordonnées (latitude, longitude) d'un résultat : des nombres qui désignent une adresse, que le dictionnaire ne voit pas | aucun | non par la porte : patron « une source qui exige la valeur en clair », ou `withhold` (J2b), ou `generalize` (J5) sur le champ |
| Valeurs de personnes non déclarées dans un texte libre | détecteurs par forme, puis modèle en option | J3, J5 |
| `tools/list`, instructions du serveur, `serverInfo` de l'`initialize` | `buildTools`, `serverInstructions` (`mcp/tools.ts`) | non : réglages de l'organisation et noms de fonctions, jamais une entité ; les hosts les gardent en cache |
| `resources/list`, `resources/read` (bundle du widget) | `installWidgetResources` | non : aucune donnée |
| Erreurs JSON-RPC de la route (401, 404 d'une adresse inconnue), refus d'un non-membre | `mcp/handler.ts` | non : ne nomment que l'appelant ou l'adresse |
| Original binaire d'un fichier (`read {file, raw}`, prévu par [lecture des fichiers](lecture-des-fichiers.md)) | non écrit | refusé quand la pseudonymisation est active : des octets ne se pseudonymisent pas |

Hors du serveur MCP, rien ne passe la porte : écrans, API, exports, liens publics (des personnes les lisent), et `callFunction`, qui rend en clair à l'hôte.

### Les champs déclarés (`output.entityFields`, J3)

- Une fiche de l'hôte porte le nom et les prénoms en champs séparés : le nom seul peut être un mot ou un prénom (« Martin »), le prénom seul n'est jamais masqué. La fonction de l'hôte déclare ces champs : `defineErpFunction({ output: { entityFields: [{ kind: "client", id: "id", fields: ["nom", "prenoms"] }] } })`, des chemins pointés dans chaque enregistrement ; `at` (`"clients"`) mène aux enregistrements d'une liste, un objet ou une liste d'objets.
- Pour l'assistant seulement (`runCall` avec le dictionnaire du MCP), chaque champ déclaré devient le jeton de l'entité que donne `id`, et chaque valeur remplacée quitte le texte que compose la fonction, en mots entiers. Une entité que le dictionnaire ne connaît pas (non déclarée, effacée) : la valeur est retenue, `"[withheld]"`. `callFunction` rend la sortie en clair.
- Plutôt que `withhold` : l'assistant garde un jeton qu'il recopie pour désigner la personne. Plutôt que la porte : rien ne dépend de la liste des mots courants.
- `registerFunctions` refuse une déclaration mal formée : sorte, chemins de `at`, `id` et `fields`, clé inconnue.

### Retenue d'un champ entier (`withhold`, J2b)

- Certains champs se protègent mal par jeton : leur contenu même est le secret (patrimoine, situation familiale, notes, régime, numéro d'identité). Un tel champ est servi `"[withheld]"` (le texte servi au modèle est en anglais, [adresses et langue](adresses-et-langue.md)) : sa présence reste visible, l'assistant sait qu'il existe et peut le dire à la personne.
- Annotation au même endroit que `generalize` (J5) :
  - connecteur décrit : `withhold: true` sur la propriété dans `output.schema`, que la fabrique d'`oto-connectors` compile en une liste de chemins `output.withhold`, lue par le moteur comme `strip` ; `shaped` (`engine.ts` l. 293) remplace la valeur avant de composer texte et données, qui sont donc retenus ensemble ;
  - fonction de l'hôte : elle n'a pas de schéma de sortie (`ErpFunctionInput`, `server/catalog/erp.ts` l. 42 à 55). Plus petit ajout : `output: { withhold: readonly string[] }`, des chemins dans `data`. `runCall` remplace la valeur à ces chemins, puis retire du texte, par substitution, chaque valeur retenue (le texte est composé par l'hôte, qui pourrait l'y recopier).
- La retenue précède la porte et ne dépend pas du dictionnaire : elle vaut aussi pour une organisation sans entité déclarée. Le journal ne garde aucun résultat, rien n'y change.

### Patron : une source qui exige la valeur en clair

- Certaines sources ne travaillent que sur la valeur en clair : géocoder une adresse, vérifier un numéro auprès d'un registre. Elles ne passent **jamais** par une réidentification vers le connecteur.
- La fonction de l'hôte qui sert l'assistant lit la valeur dans sa base, appelle la source côté serveur par `callFunction` (la fonction du connecteur réservée au serveur, J1), et rend un verdict sans identité : « dans la zone : oui », « numéro valide », une distance arrondie. Les coordonnées ne sortent pas.
- Une fonction de connecteur qui rendrait coordonnées ou identité à l'assistant retient (`withhold`) ou généralise (`generalize`) le champ.

### Les jetons dans les arguments

Un jeton reçu se cherche dans le dictionnaire avant le service. Inconnu : `invalid_arguments`, raison `unknown_pseudonym`. Jeton de valeur (`email#…`, `name#…`) là où une valeur est attendue : `invalid_arguments`, raison `one_way_pseudonym`. Puis, selon l'argument :

- **Désigner une chose existante** dans le stockage du paquet (chemin de `read` et `write`, requête de `find`, phrase de `context`, `old` de `replace_text`, clé de ligne et filtre de `table.*`) : la comparaison se fait dans l'espace pseudonymisé. Un chemin essaie les formes en slug de l'entité (bornées) ; un texte à retrouver se cherche dans le texte stocké pseudonymisé, puis la coupe revient au texte en clair par la table de positions ; une requête reçoit la forme « prénoms nom ».
- **Contenu écrit** dans le stockage du paquet (`write`, cellule de `table.*`) : le jeton est gardé tel quel. Rien ne fuit, et effacer la personne tue aussi ses mentions écrites par un assistant. L'écran le montre brut, ou résolu pour qui en a la portée (`resolveForDisplay`, J4).
- **Argument d'entité d'une fonction de l'hôte** (`entityArguments` de `defineErpFunction`) : le jeton devient l'identifiant ; l'hôte lit sa propre base, sous sa RLS. Ailleurs dans les arguments d'une fonction de l'hôte, le jeton passe tel quel : l'hôte peut appeler `reidentify`.
- **Membre désigné par une fonction native** (`name` de `node.share`, sujet `person`) : un jeton d'entité seul désigne le membre dont le nom ou l'email, pseudonymisé, le redonne (`FunctionContext.pseudonymized`, comparé dans l'espace pseudonymisé comme un filtre de `table.*`) ; un jeton de valeur ne désigne personne.
- **Fonction de connecteur** (partagé ou propre à l'hôte) : jamais de réidentification générique, un outil d'envoi exfiltrerait. Un jeton y est refusé (`forbidden`, raison `pseudonym_not_accepted`), sauf vers une sortie de confiance (J4). Une valeur que la personne a donnée en clair dans la conversation passe, comme aujourd'hui.

`context` ajoute, quand la pseudonymisation est active, un paragraphe court : ce qu'est un jeton, qu'il se recopie tel quel, qu'il ne se devine pas.

### Journal, retours et appels de l'hôte

- Le journal reçoit des arguments, une cible et un message d'erreur pseudonymisés, aux trois portes qui journalisent une requête : le MCP et `callFunction`, dans `openedEntry`, `servedEntry` et `failedEntry` (`server/journal.ts`) ; l'API HTTP des écrans, dont chaque mutation journalise son corps (`journaled` et `journalLine`, `api/handler.ts`).
- À la porte HTTP, aucune route ne court une fonction du catalogue : le marqueur `personal` n'y a rien à marquer. Une route dont le corps porte une donnée personnelle pose `journalArgs`, la liste blanche qui remplace le corps journalisé (J1) : son refus se journalise par son seul code, et toute valeur du corps que la liste ne garde pas est retirée de la cible par substitution, comme celle d'un argument marqué. En J2, la porte HTTP passe aussi le corps gardé, la cible et l'erreur par le dictionnaire. L'écriture suit la réponse : le coût est hors du chemin critique. Un dictionnaire illisible à ce moment ne garde pas les arguments (`{ _withheld: true }`), jamais en clair.
- Une ligne écrite avant J2 reste en clair ; `read journal` la sert par la porte, et la rétention (J1) la purge.
- Le journal de l'équipe plateforme (`admin_journal`, `flushAdminJournal`) passe par le même écrivain : arguments, cible et erreur pseudonymisés sous l'organisation de chaque ligne.
- Le texte d'un retour (`feedback`, `recordFeedback`) et sa cible sont pseudonymisés à l'écriture : l'équipe plateforme, qui les traite, est un tiers pour l'organisation. Un jeton est plus long que le nom qu'il remplace : le texte gardé est coupé aux bornes de la table (4 000 et 500 caractères).
- `callFunction` rend en clair : l'hôte appelle depuis son serveur, ses contrôles rendent un verdict sans identité. S'il repasse un résultat à un assistant, il le pseudonymise d'abord (`pseudonymize`, exporté dès J2).
- Les sorties des connecteurs partagés passent par `runCall`, donc par la porte, comme celles des connecteurs propres.

### Sorties de confiance et affichage (J4)

- L'hôte déclare les fonctions qui peuvent recevoir une valeur en clair (`registerTrustedOutputs`) et, pour chacune, son contrôle de portée : `authorize({ identity, output, entity, args })` dit si cette personne peut faire sortir cette entité par cette sortie (le jeton appartient au dossier ou au destinataire).
- À l'appel, chaque jeton d'entité est relu par `read(id)`, contrôlé par `authorize`, puis remplacé par la valeur que demande le champ (`fields` : un courriel pour `to`, sinon « prénoms nom »). Un refus est nommé (`forbidden`, raison `reidentification_refused`) et rien ne court.
- La ligne de journal porte, en clé réservée, `_reidentified: { <sorte>: <nombre> }`, jamais les valeurs.
- **Récapitulatif d'une fonction sensible** : il part à l'assistant, donc pseudonymisé ; la personne confirme sur des jetons. Une fonction de l'hôte compose déjà elle-même son récapitulatif : `summarize` de `defineErpFunction` (`server/catalog/erp.ts` l. 54, enveloppé l. 112), dont `confirmationRequest` sert `summary.text` en tête du texte (`server/calls.ts` l. 199 à 202). L'hôte y met un lien vers son écran, qui montre la valeur en clair à la personne connectée ; le lien porte un identifiant, jamais un nom (la porte le masquerait). Le récapitulatif d'un connecteur décrit vient de son gabarit (`confirm.summary`) : une sortie de confiance qui veut ce lien passe par une fonction de l'hôte.
- **Affichage résolu** : `resolveForDisplay(db, identity, text)` rend le texte, chaque jeton d'entité remplacé par « prénoms nom » quand le lecteur passe `authorize` pour la sortie réservée `display`, gardé tel quel sinon (jeton de valeur, entité effacée, lecteur hors portée). L'hôte déclare cette sortie comme les autres (`{ output: "display", authorize }`) ; sans elle, les écrans montrent les jetons bruts. `authorize` est appelé une fois par entité distincte, 200 entités au plus par appel. Lecteurs : les écrans de l'hôte, et ceux du paquet qui montrent du texte d'assistant (journal des appels, pages, grille d'un tableau). Une lecture : non journalisée, comme toute lecture (D138).

### API exportée (`/server`)

```ts
export type SensitiveOrg = { id: string; slug: string }
export type SensitiveValues = {
  lastName?: string
  firstNames?: string
  emails?: readonly string[]
  phones?: readonly string[]
  addresses?: readonly string[]
  /** Toute autre désignation, prise telle quelle (nom d'usage, raison sociale, référence de dossier). */
  aliases?: readonly string[]
}
export type SensitiveEntity = {
  id: string
  values: SensitiveValues
  /** Corps du jeton fourni par l'hôte, opaque, unique, non séquentiel conseillé (`c-12`) ; exigé pour toute la sorte si `tokens: "reference"`. */
  reference?: string
}
export type SensitiveKind = {
  /** ASCII minuscule, 2 à 10 caractères, hors des sortes réservées. */
  kind: string
  /** `"hmac"` (défaut) ou `"reference"`. */
  tokens?: "hmac" | "reference"
  list(org: SensitiveOrg): Promise<readonly SensitiveEntity[]>
  /** `null` : l'entité n'existe plus ; seule source d'une réidentification. */
  read(org: SensitiveOrg, id: string): Promise<SensitiveValues | null>
}
// J1 : `registerConnectors(defs, { serverOnly })` et `defineErpFunction({ serverOnly: true })`
export type ConnectorOptions = HostOptions & {
  /** Par connecteur : `"all"`, ou les noms servis de ses fonctions réservées au serveur. */
  serverOnly?: Readonly<Record<string, "all" | readonly string[]>>
}
export type DataPolicy = {
  fileContents?: "served" | "metadata" | ((org: SensitiveOrg) => "served" | "metadata")
}
export function registerDataPolicy(policy: DataPolicy | null): void
// J2
export function registerSensitiveEntities(kinds: readonly SensitiveKind[] | null): void
export function invalidateSensitiveEntities(db: PlatformDb, org: { id: string }): Promise<void>
export function pseudonymize<T extends Json>(db: PlatformDb, org: SensitiveOrg, payload: T): Promise<T>
// `defineErpFunction` : `entityArguments?: Readonly<Record<string, string>>` (chemin d'argument → sorte)
// J3 : `defineErpFunction` : `output?: { entityFields?: readonly EntityFields[] }`, `EntityFields = { kind, at?, id, fields }`
// J2b : `defineErpFunction` : `output?: { withhold?: readonly string[] }` (chemins dans `data`)

// J4
export type ReidentificationRequest = {
  identity: Identity
  /** Nom servi de la fonction, sortie nommée par l'hôte pour `reidentify`, ou `display`. */
  output: string
  entity: { kind: string; id: string }
  args?: Readonly<Record<string, unknown>>
}
export type TrustedOutput = {
  output: string
  authorize(request: ReidentificationRequest): Promise<boolean>
  /** Chemin d'argument → valeur rendue ; défaut : « prénoms nom ». */
  fields?: Readonly<Record<string, "name" | "email" | "phone" | "address">>
}
export function registerTrustedOutputs(outputs: readonly TrustedOutput[] | null): void
export function reidentify<T extends Json>(db: PlatformDb, identity: Identity, payload: T, scope: { output: string }): Promise<T>
/** Sous la sortie réservée `display` ; non journalisée. */
export function resolveForDisplay(db: PlatformDb, identity: Identity, text: string): Promise<string>
```

- Une déclaration mal formée lève au chargement de la route : `registerSensitiveEntities` (sorte invalide ou réservée, doublon, `tokens` inconnu, `list` ou `read` absente) lève `TypeError`, comme `registerDataPolicy` ; une sortie de confiance inconnue au catalogue ou une fonction `serverOnly` inconnue de son connecteur lève `CatalogRegistrationError`, comme `registerFunctions`.
- Les refus réutilisent les codes fermés de `PLATFORM_ERROR_CODES`, avec une raison (`details.reason`), comme `not_utf8` : `unknown_pseudonym`, `one_way_pseudonym` (`invalid_arguments`) ; `pseudonym_not_accepted`, `reidentification_refused`, `file_contents_withheld` (`forbidden`). Une panne de la pseudonymisation (source de l'hôte, clé absente, témoin, collision, référence en double ou qui contient une forme de l'entité) est un `internal` servi par la consigne habituelle, sa cause au log sous la raison `pseudonymization_unavailable`, sans valeur.

### Cache, invalidation et plusieurs instances

- Un dictionnaire par organisation et par processus, en mémoire, borné (LRU). Chaque requête MCP lit une fois, au premier besoin, l'état de l'organisation : génération, version de clé, sel, témoin (`platform.pseudonym_orgs`, une ligne). Une génération changée, ou un dictionnaire de plus de 5 minutes, le fait reconstruire ; une seule construction à la fois par organisation dans un processus.
- `invalidateSensitiveEntities` incrémente la génération en base : chaque instance la voit à sa requête suivante. Aucune notification entre processus : le transport est sans état et passe à zéro instance ([outils MCP](outils-mcp.md)) ; la borne de 5 minutes rattrape une invalidation oubliée.
- Fenêtre acceptée : une entité créée chez l'hôte, lue par un assistant sur une instance avant l'invalidation, part en clair. L'hôte invalide juste après sa validation.
- Une source qui lève, rend une forme invalide, ou une construction en collision : l'appel est refusé, rien n'est servi.
- Borne : 50 000 entités par organisation, toutes sortes comprises ; au-delà, la construction est refusée. La construction rend la main à la boucle d'événements toutes les 1 000 entités : elle ne gèle pas le serveur pendant ses deux secondes.

### Les quatre primitives (J1)

- **Argument donnée personnelle** : une propriété marquée (`.meta({ personal: true })` dans un schéma Zod de l'hôte ; `personal: true` dans une description de connecteur, à ajouter au format d'`oto-connectors`) n'est jamais journalisée : `[personal]` dans `args` ; sa valeur est retirée de `journal.error` et de `target` par substitution, quelle que soit la phrase du tiers qui l'y recopie. Une valeur de moins de trois caractères n'est remplacée que là où elle est seule. À la porte HTTP, la liste blanche `journalArgs` d'une route en tient lieu (§ Journal, retours et appels de l'hôte).
- **Rétention** : par hôte en V1, fixée par les paramètres de la commande de purge, `oto-platform journal purge --db-url <url> [--journal-days <jours>] [--feedback-days <jours>]`, lancée par la tâche planifiée de l'hôte sur la connexion d'administration, comme `accounts secret` ; une surcharge par organisation viendra plus tard. « Retours » désigne les tickets `feedback`. La purge est la fonction SQL `platform.purge_expired(journal_days, feedback_days)`, qu'aucun rôle de session n'exécute ; `admin_journal` suit la durée du journal. Sans durée, rien n'est purgé, comme aujourd'hui.
- **Contenu des fichiers** : `registerDataPolicy({ fileContents: "metadata" })` (ou une fonction de l'organisation ; `registerDataPolicy` ne porte que cette option) ; `read {file}` refuse (`forbidden`, raison `file_contents_withheld`) dans `readNodeFile`, avant la lecture de l'objet ; nom, taille et type restent visibles dans la page. L'aperçu, le plan et `raw` prévus par [lecture des fichiers](lecture-des-fichiers.md) suivent la même option.
- **Réservé au serveur, par fonction** : `registerConnectors(defs, { serverOnly: { <connecteur>: "all" | [<nom servi>, …] } })`, par exemple les seules fonctions d'un connecteur partagé qui prennent une adresse, les autres restant servies à l'assistant ; `defineErpFunction({ serverOnly: true })` pour une fonction de l'hôte. Le choix est celui de l'hôte, pas de la description partagée. `runCall` reçoit le catalogue de sa porte : l'adaptateur MCP celui de l'assistant (`assistantFunctions()`, sans les fonctions réservées), `callFunction` le catalogue entier ; par le MCP, une fonction réservée est inconnue (`not_found`, le message d'une fonction absente) ; `find`, `read functions`, `read <fonction>`, les exemples de `call` et `next_actions` ne la montrent pas ; `callFunction` la court. L'activation reste celle du connecteur, par organisation.

### Jalons

Dans l'ordre de besoin de l'hôte demandeur.

| Jalon | Ce qui change pour un hôte | Migration | Tests d'acceptation |
|---|---|---|---|
| **J1** journal, fichiers, réservé au serveur par fonction, rétention | Marquer ses arguments personnels ; `registerDataPolicy({ fileContents })` ; une tâche planifiée `oto-platform journal purge` ; `serverOnly` par fonction. Rien ne change sans geste. | Fonction SQL de purge | Argument marqué : `[personal]` au journal aux portes MCP et `callFunction`, absent de `error` quand le tiers le recopie ; à la porte HTTP, une valeur que `journalArgs` ne garde pas absente de la cible. Lignes plus vieilles que la durée purgées, les autres gardées, rien sans durée. `read {file}` refusé, nom et taille servis. Fonction réservée d'un connecteur : `not_found` par le MCP, absente de `find` et des exemples, courue par `callFunction` ; sa voisine non réservée reste servie. Nom réservé inconnu : `CatalogRegistrationError`. |
| **J2** dictionnaire, porte, jetons, entrée, référence | `PLATFORM_PSEUDONYM_KEY` ; `registerSensitiveEntities` ; `invalidateSensitiveEntities` après chaque écriture ; `entityArguments` ; `pseudonymize` avant de repasser un résultat de `callFunction` à un assistant ; `reference` en option, par sorte. | `platform.pseudonym_orgs` (organisation, version de clé, sel, témoin, génération) et la fonction qui incrémente la génération | Une page qui cite une personne déclarée : jeton au même endroit dans `content` et `structuredContent`, et dans `data`. Même jeton d'une conversation à l'autre, autre jeton dans une autre organisation. Refus qui cite un nom : jeton servi et journalisé. Source de l'hôte en panne : `internal`, rien en clair. Collision forcée (corps réduit en test) : construction refusée. Témoin faux : refus. Effacement puis invalidation : `unknown_pseudonym`. `replace_text` dont `old` porte un jeton modifie le texte en clair. Fonction de l'hôte : l'identifiant reçu. Connecteur : `pseudonym_not_accepted`. Deux processus : la génération changée dans l'un fait reconstruire l'autre. Résultat coupé à 45 000 après pseudonymisation. Référence : `client#c-12` servi et résolu ; référence en double, absente d'une entité de la sorte, ou contenant le nom : construction refusée. Requêtes de référence ([mcp-golden-queries](../reference/mcp-golden-queries.md)) vertes, pseudonymisation active. |
| **J2b** retenue d'un champ | Annoter `withhold` dans `output.schema` de ses connecteurs décrits (via la fabrique) et `output.withhold` de ses fonctions. | Aucune | Champ annoté d'un connecteur décrit : `[withheld]` dans le texte et dans `data`, la clé présente. Fonction de l'hôte qui recopie la valeur retenue dans son texte : retirée du texte. Champ non annoté intact. Vaut sans entité déclarée. |
| **J3** nom seul, champs déclarés, détecteurs par forme, mesure | Rien d'obligatoire ; `output.entityFields` sur ses fonctions qui rendent une fiche ; liste des détecteurs actifs au choix. La source de la liste des mots courants se choisit ici, après vérification des licences (choisie le 19/10). | Aucune | Nom seul masqué hors mots courants ; champ déclaré servi en jeton, retenu pour une entité inconnue, en clair par `callFunction`. NIR à clé (2A et 2B compris), IBAN mod 97, carte (Luhn et préfixe), courriel, téléphone : trouvés, et rejetés quand la clé est fausse. Mesure publiée : au plus 1 mot courant masqué pour 10 000 mots d'un corpus public ; 100 % des noms complets, courriels et téléphones déclarés trouvés sur un corpus synthétique de 1 000 personnes. |
| **J4** sorties de confiance, exports, affichage | `registerTrustedOutputs` et ses `authorize` ; `reidentify` pour ses autres sorties ; un lien vers son écran dans le récapitulatif de ses fonctions sensibles ; la sortie `display` pour `resolveForDisplay`. | Colonnes de rotation (sel précédent, fin de grâce) | Sortie de confiance : valeur en clair à la fonction, `_reidentified` au journal, sans valeur. `authorize` faux : `reidentification_refused`, rien ne court. Entité effacée sans invalidation : refus par `read`. Rotation : anciens jetons résolus pendant la grâce, morts après. `resolveForDisplay` : jeton résolu pour un lecteur dans la portée, gardé pour un autre ; sans sortie `display`, tout reste brut. |
| **J5** généralisation, modèle | Annoter les champs de sortie (`generalize: "year"`, `"department"`, `"bracket"`, `"area"` pour des coordonnées arrondies au dixième de degré) dans `output.schema` des connecteurs décrits et `output` des fonctions de l'hôte ; brancher un détecteur par modèle s'il le veut. | Aucune | Date de naissance annotée servie en année, adresse en département, montant en tranche, coordonnées arrondies ; une date non annotée intacte. Détecteur par modèle éteint par défaut ; allumé, il désigne des coupes et le code les remplace ; en panne, l'appel est refusé. |

Mesures à faire en J2, avant de servir : coût en jetons de modèle par mention (compteurs des fournisseurs, sur une page, un tableau de 50 lignes et un résultat de connecteur, pseudonymisés), pour trois formats (`⟦client:…⟧`, `‹client:…›`, `client#…`) et pour un corps de référence ; fidélité de recopie (30 conversations par host où l'assistant réutilise un jeton dans un appel, critère : aucune altération) ; temps de construction et mémoire du dictionnaire pour 10 000 et 100 000 entités ; latence ajoutée à un appel. Le format retenu est le moins coûteux à fidélité entière ; la borne d'entités par organisation se fixe d'après la mesure.

Mesures de J2 (19/10, entités synthétiques à cinq valeurs : prénom, nom, courriel, téléphone, adresse) :

- Construction du dictionnaire : 0,35 à 0,47 s pour 10 000 entités, 1,9 à 2,2 s pour 50 000, 4,2 à 4,8 s pour 100 000 ; mémoire gardée 14,5 Mo, 68 Mo et 134 Mo (environ 7 formes et 1,35 Ko par entité). La première écriture, avec une forme par couple civilité et nom, coûtait 30 s et 381 Mo pour 100 000 : la civilité est devenue une reconnaissance à la recherche. Borne retenue : 50 000 entités.
- Nom seul et forme à tirets (J3, 19/10), sur un même jeu de 50 000 entités synthétiques, avant et après : construction 1,3 → 2,2 s, mémoire gardée 45 → 53 Mo (+16 %), dont la liste des mots courants, lue une fois par processus ; porte d'une page de 48 000 caractères 15,5 → 17,2 ms. La borne de 50 000 entités tient.
- Porte, dictionnaire de 50 000 entités : 13 ms pour une page de 48 600 caractères, 1,2 ms pour un tableau de 50 lignes ; une requête de plus par appel MCP (l'état de l'organisation).
- Coût en tokens, mesuré avec deux encodeurs publics (`o200k_base`, `cl100k_base`), faute de compteur d'un fournisseur sans clé : un jeton HMAC `⟦client:…⟧` coûte 15 à 17 tokens, `‹client:…›` 13 à 14, `client#…` 11, une référence `⟦client:c-0⟧` 8 à 10 ; un nom en clair, 3. Sur une page de 20 lignes (60 jetons posés), un tableau de 50 lignes (150) et un résultat de connecteur de 20 contacts (60), le surcoût par rapport au clair est de 44 à 53 % pour `⟦…⟧` HMAC, 24 à 30 % pour `‹…›`, 15 à 20 % pour `client#…`, 14 à 17 % pour `⟦…⟧` de référence (`o200k_base`).
- Détecteurs de courriels et de téléphones (J3, 19/10). Faux positifs, sur 75 articles de Wikipédia en français (849 000 mots : villes, cuisine, droit, techniques, sans coordonnée de personne) : 4 valeurs trouvées, les 2 courriels d'exemple de l'article « Courrier électronique » et 2 ISBN à dix chiffres pris pour des téléphones, soit 0,02 pour 10 000 mots ; sur la documentation du dépôt (121 fichiers, 316 000 mots, versions, dates, ports) : 9 courriels d'exemple, aucun téléphone. Coût : 48 ms par million de caractères, environ 2 ms pour une page de 48 000 caractères.
- Banc de fidélité refait après J3, parties 1 et 2 (19/10, `client#…`, 30 conversations, Sonnet, serveur local, base jetable) : 114 recopies (44 dans les arguments, 70 dans le texte final), aucune altérée ni inventée ; 543 k tokens. Dans les résultats servis, et dans une lecture de toutes les pages, du tableau et des 50 fiches : aucun nom complet, courriel, téléphone, forme à tirets ni champ déclaré en clair ; restent, comme prévu, les noms seuls qui sont des mots courants (« Lambert », « Martin ») et les prénoms seuls.
- Fidélité et coût, au banc (19/10 ; 30 conversations par format sur Sonnet, serveur local, base jetable ; compteur du fournisseur) : aucun jeton altéré ni inventé dans aucun format (114 recopies pour `⟦…⟧`, 112 pour `‹…›`, 114 pour `client#…`, arguments et texte final) ; 618 k, 617 k et 547 k tokens consommés ; un jeton coûte 19, 16 et 13 tokens (11 en référence, 6 pour un nom en clair). Format retenu : `client#…`.

## Décisions et alternatives écartées

- **Enveloppes `⟦…⟧` et `‹…›`** : aussi fidèles au banc que `client#…`, mais plus chères (19 et 16 tokens par jeton contre 13, 40 % et 27 % de surcoût sur une page contre 13 %). Écartées le 19/10 par Alexis ; ce que leur fermeture apportait (la forme prouve le jeton), la porte et l'entrée le rendent en ne lisant comme jeton que ce que le dictionnaire connaît (§ Le jeton).
- **Identifiant chiffré dans le jeton** (AES-SIV) : réversible sans dictionnaire, mais le jeton porte l'identifiant et une étiquette, plus de 50 caractères par mention ; il confie à l'assistant un chiffré attaquable hors ligne ; et un jeton d'une entité effacée se déchiffre encore. Écarté pour la recherche inverse, dont le dictionnaire est de toute façon nécessaire à la détection.
- **96 bits ou plus** : utiles à un jeton qui s'authentifie seul. Avec la recherche inverse, une collision se joue dans une organisation et se voit à la construction (pour 100 000 entités, de l'ordre de 3 × 10⁻¹⁰), et un jeton deviné n'ouvre rien sans `authorize`. 64 bits, 13 caractères, avis de l'hôte demandeur suivi.
- **Allonger le jeton d'une organisation en collision** (proposé par l'hôte demandeur) : un format variable par organisation, une expression et un coût qui changent. Écarté pour le refus et un nouveau sel.
- **Table de correspondance** : une copie des personnes dans le paquet, à purger, à protéger. Écartée.
- **Version dans le jeton** : un caractère par mention pour un événement rare (rotation) ; la recherche essaie la version active, puis la précédente.
- **`PLATFORM_VAULT_KEY` comme clé maître** : sa rotation re-chiffre les secrets, mais un jeton ne se ré-émet pas (il vit dans des conversations et des pages) ; une fuite de l'une n'a pas à compromettre l'autre. Écarté pour une clé dédiée.
- **Sel par dossier** : la recherche inverse devrait connaître le dossier de chaque jeton, et deux dossiers verraient deux jetons pour la même personne. Reporté, hors objectif.
- **Porte dans `runCall`** : `callFunction` passe par `runCall` et doit rester en clair ; la porte est dans l'adaptateur MCP.
- **Réidentifier les arguments de toute fonction** : un outil d'envoi générique ferait sortir n'importe quelle personne. Écarté pour les sorties de confiance.
- **Réidentifier vers un connecteur qui exige la valeur** (géocodage) : la valeur partirait chez le tiers sous une décision de l'assistant. Écarté pour le patron de la fonction de l'hôte qui appelle côté serveur et rend un verdict.
- **Restituer en clair un jeton écrit par l'assistant** (page, cellule) : demande un contrôle de portée dès J2 et ferait lire à d'autres lecteurs de la page une personne hors de leur portée. Écarté pour le jeton gardé tel quel, résolu à l'affichage pour qui en a la portée (J4).
- **Réserver au serveur un connecteur entier seulement** : un connecteur partagé mêle des fonctions anodines et des fonctions qui prennent une adresse. Écarté pour une liste de fonctions par connecteur, décidée par l'hôte.
- **Annoter la réservation dans la description partagée** : la sensibilité dépend de l'usage de l'hôte, pas du connecteur. Écarté pour `registerConnectors`.
- **Retenir un champ par la porte** : la porte ne connaît que les valeurs des entités ; un patrimoine ou une note n'en contiennent pas forcément. Écarté pour une annotation lue avant la porte.
- **Une rétention par organisation dès la V1** : reportée, une surcharge viendra plus tard.
- **Un indice lisible dans le jeton opaque** (initiales, alias par conversation) : des initiales fuient, un alias par conversation demande un état. Écarté le 19/10 par Alexis : la référence de l'hôte et l'affichage résolu couvrent le besoin.
- **Masquer le prénom seul** : mesuré le 20/10 sur 849 000 mots de Wikipédia en français, avec des organisations tirées des naissances de l'Insee : 7,5 mots masqués à tort pour 10 000 mots à 50 personnes, 50 à 200, 114 à 1 000 (cible : au plus 1) ; les seuls prénoms rares (moins de 1 000 naissances) restent sous la cible mais ne couvrent que 3 % des personnes ; et de 8 % (50 personnes) à 92 % (10 000) des personnes partagent leur prénom avec une autre, qui n'aurait qu'un jeton à sens unique. Le masquer dans un texte qui nomme déjà la personne était l'autre voie. Écarté le 20/10 par Alexis : le prénom seul, comme le nom seul qui est un mot courant, reste une limite assumée, couverte pour les fiches par `output.entityFields`.
- **Nouveaux codes d'erreur** : la liste fermée est traduite par `ui/` ; une raison sur un code existant suffit à l'assistant, qui lit le message.

## Sécurité et confidentialité

- Fermé en cas de panne à chaque étape : source de l'hôte, clé, témoin, collision, référence invalide, détecteur par modèle. Le journal, qui ne lève jamais, retient ses arguments plutôt que de les garder en clair.
- Aucune valeur d'entité au log serveur, ni dans une erreur de construction.
- Un jeton n'ouvre rien seul : la réidentification exige une sortie déclarée, `authorize` et `read`, et se journalise ; l'affichage résolu exige `authorize` pour la sortie `display`.
- Le paquet ne lit jamais les tables de l'hôte ; le dictionnaire vit en mémoire du processus, jamais en base.
- Limites : le prénom seul et le nom seul qui est un mot courant restent en clair hors champ déclaré (limite assumée) ; une organisation éteinte par `enabled` est servie en clair. Le jeton est stable dans l'organisation ; le fournisseur du modèle peut relier les conversations d'une même personne sans la nommer. Le contexte d'une mention (métier, ville, dates) peut suffire à réidentifier : la retenue (J2b) et la généralisation (J5) le réduisent sans l'annuler. Une référence fournie par l'hôte n'est pas sous clé et peut dire un ordre ou un volume.

## Écart avec le code

- J1 est écrit : arguments marqués (`server/catalog/personal.ts`, `server/journal.ts`), liste blanche HTTP qui retire de la cible ce qu'elle ne garde pas (`api/handler.ts`), réservation au serveur (`server/connectors/server-only.ts`, `serverOnly` de `defineErpFunction`, `assistantFunctions()` du registre), contenu des fichiers (`server/data-policy.ts`, `readNodeFile`), purge (`platform.purge_expired`, `cli/purge.mjs`).
- J2, dictionnaire et porte, est écrit : déclaration (`server/pseudonym/declaration.ts`), normalisation, formes, jeton et dictionnaire (`normalize.ts`, `forms.ts`, `token.ts`, `mentions.ts`, `dictionary.ts`), cache et état de l'organisation (`service.ts`, `platform.pseudonym_orgs`), porte MCP (`mcp/pseudonym.ts`, `runTool`, prompts, MCP admin), journal et journal de l'équipe plateforme à l'écriture (`server/pseudonym/journal.ts`), retours, avis de `context`, `pseudonymize`.
- Écarts de J2 avec ce document : une table des formes plutôt qu'un automate (§ Le dictionnaire et la détection) ; la civilité reconnue à la recherche ; le nom seul est masqué depuis J3, première partie, hors mot commun et prénom courant ; un prompt dont le nom nomme une personne n'est pas servi, au lieu d'être retrouvé par son nom masqué ; une déclaration mal formée lève `TypeError`. Le transfert d'une organisation ne porte pas sa ligne `pseudonym_orgs` : l'organisation reçoit un nouveau sel, donc d'autres jetons, à destination.
- Les jetons dans les arguments sont écrits : `server/pseudonym/arguments.ts` (contrôle, désignation, formes en chemin, `entityArguments`, refus vers un connecteur) et `inputs.ts` (chemins contre les nœuds et les anciens chemins, arguments d'un `call` selon l'origine de la fonction), appelés par `resolvedToolInput` (`mcp/pseudonym.ts`) avant le schéma de l'outil et par `runCall` avant celui de la fonction. Un chemin essaie au plus 16 chemins en clair, chacun redonnant, pseudonymisé, le chemin reçu ; le premier qui existe l'emporte, sinon `prenoms_nom` (une page à créer). Les arguments de chemin d'une fonction native sont `path`, `table`, `new_path`, `parent`, `after` et le `path` des éléments de `pages` et `roots`. Un jeton à sens unique est refusé dans une désignation (chemin, requête de `find`, argument d'entité) et gardé dans un contenu, dont la phrase de `context`. L'enveloppe du jeton est une seule constante (`TOKEN_ENVELOPE`, `token.ts`), dont l'expression et le rendu dérivent.
- `find` de `replace_text` qui porte un jeton se cherche dans le markdown pseudonymisé de la portée, et chaque occurrence revient au clair par la table de places (`pseudonymizedPlaces`, `gate.ts`) ; une occurrence dont un bord tombe dans un jeton ne compte pas. Seul `write` du MCP passe la porte à ses opérations : un `replace_text` par `write_many` ne compare pas un jeton (il ne trouve rien, rien ne fuit). Un filtre de `table.*` dont une valeur de texte porte un jeton compare les cellules pseudonymisées (`FunctionContext.pseudonymized`) ; une colonne `enum` ne prend pas de jeton. Une clé de ligne en jeton (`key`, `keys`, `rows[].key`) devient la clé en clair de la ligne qui, pseudonymisée, la redonne : les clés du tableau se lisent une fois, seulement quand une clé porte un jeton ; sans telle ligne, la clé reste le jeton (une ligne neuve le garde, comme tout contenu écrit). `q` d'un tableau reçoit « prénoms nom ».
- J3, seconde partie : les champs déclarés (`output.entityFields`, `server/pseudonym/outputs.ts`), appliqués par `runCall` quand le MCP passe son dictionnaire.
- J3, troisième partie : les détecteurs de courriels et de téléphones (`server/pseudonym/detectors.ts`), appliqués par la porte (`gate.ts`) ; le jeton de valeur reçu est reconnu par sa forme (`arguments.ts`). Écart : toujours actifs, sans liste de détecteurs au choix de l'hôte.
- Allumer par organisation (20/10) : `enabled` de `registerSensitiveEntities` (`declaration.ts`), lu par `pseudonymizationFor` (`service.ts`), qui rend la porte et l'entrée ; le MCP résout les jetons par l'entrée, pose la porte et l'avis de `context` seulement allumée, et `runCall` ne fait des champs déclarés des jetons qu'allumée (`gated`). La clé n'est pas lue au démarrage : une organisation allumée sans clé refuse ses appels, une organisation éteinte ne la lit que pour résoudre un jeton reçu.
- Rien d'autre n'est écrit : ni `withhold`, ni les détecteurs de NIR, d'IBAN et de carte, ni `reidentify`, ni `resolveForDisplay`.
- Aujourd'hui : le journal ne masque que les clés de secret et les arguments marqués ; une fonction de l'hôte n'a pas de schéma de sortie ; `output.schema` d'un connecteur décrit est ignoré par le moteur ; l'aperçu, le plan et `raw` de [lecture des fichiers](lecture-des-fichiers.md), pas encore écrits, devront suivre `fileContents`.
- Les mots `withhold` et `generalize` du format de description sont à ajouter dans `oto-connectors` (`format-de-description.md`, `fabrique.md`) ; `personal` y arrive avec J1, par un commit séparé.

## Reste à faire

Les jetons dans les arguments laissent trois trous, sans fuite (un jeton n'y trouve rien), à combler hors J2 :

- `replace_text` passé par `write_many` (fonction native) : ses opérations ne reçoivent pas la table de places, un `find` qui porte un jeton ne trouve rien.
- Filtre de `table.*` sur une colonne `enum` : la valeur doit être une option, un jeton est refusé.
- Titre de section (`section` de `write` et de `read`) qui porte un jeton : il n'est pas résolu ; la section se vise par sa référence de bloc ou sans jeton.

Relevé au banc de fidélité (19/10), hors pseudonymisation : l'assistant passe d'instinct `where`, `key` ou `keys` à `table.rows`, qui les refuse (11 refus sur 90 conversations), et lit un tableau par `read` (7 fois) ; le message le remet chaque fois sur la voie, au prix d'un tour. À trancher : accepter ces arguments, ou les nommer dans le refus.

## Questions ouvertes

- Reportée, sans besoin avant un connecteur de messagerie : les valeurs détectées par forme sont à sens unique, et « répondre à l'expéditeur » devient impossible. Faut-il une correspondance chiffrée, bornée au `ctx` et à 24 heures, pour certains détecteurs ?

## Historique

- 2026-10-19 : conception (J0) proposée — pseudonymisation dans le paquet, l'hôte déclarant ses personnes ; jeton HMAC de 64 bits sans table de correspondance, recherche inverse dans le dictionnaire ; porte dans l'adaptateur MCP ; quatre primitives ; jalons J1 à J5 — d'après la décision d'Alexis du 19/10, à valider par Alexis.
- 2026-10-19 : révision après relecture de l'hôte demandeur — retenue d'un champ (`withhold`, J2b) ; réservation au serveur par fonction ; patron d'une source qui exige la valeur en clair, coordonnées à l'inventaire ; référence fournie par l'hôte et `resolveForDisplay` proposées ; lien vers l'écran de l'hôte dans le récapitulatif d'une fonction sensible ; rétention par hôte en V1 ; jalons dans l'ordre de besoin — à valider par Alexis.
- 2026-10-19 : référence fournie par l'hôte retenue, en option par sorte, non séquentielle conseillée et hors clé ; `resolveForDisplay` retenu en J4, sortie réservée `display`, sans journal ; pas d'indice lisible dans le jeton opaque ; source des mots courants réglée en J3 ; document validé — décidé par Alexis.
- 2026-10-19 : J1 écrit — arguments marqués retirés du journal aux portes MCP et `callFunction`, la porte HTTP ajoutée à l'inventaire du journal (`journalArgs`, cible comprise) ; réservation au serveur par fonction ; contenu des fichiers retenu (`registerDataPolicy({ fileContents })`, sa seule option) ; rétention fixée par `oto-platform journal purge --journal-days/--feedback-days`, et non par `registerDataPolicy` — écrit en J1 ; la durée est un paramètre de la commande de purge, fixée par l'hôte (décision : par hôte en v1).
- 2026-10-19 : J2 dictionnaire et porte écrits — table des formes au lieu d'un automate, civilité reconnue à la recherche, nom seul reporté à J3, prompt nommant une personne non servi, journal de l'équipe plateforme pseudonymisé, borne de 50 000 entités d'après la mesure ; jetons dans les arguments à suivre — écrit en J2.
- 2026-10-19 : format du jeton `client#…` retenu sur le banc de fidélité (aucune altération dans les trois formats, le moins coûteux) ; la forme ne prouvant plus le jeton, la porte ne garde que les jetons connus et l'entrée que les sortes déclarées ou réservées — décidé par Alexis.
- 2026-10-19 : J3, première partie, écrite — nom seul masqué hors mots courants (lexique de Grammalecte, MPL 2.0, et prénoms de l'Insee, Licence Ouverte 2.0, sources validées par Alexis), forme à tirets d'une adresse web ; seuils de 100 000 occurrences et 1 000 naissances — écrit en J3.
- 2026-10-20 : prénom seul et nom seul courant en clair, limite assumée, couverte pour les fiches par `output.entityFields` — décidé par Alexis.
- 2026-10-20 : pseudonymisation allumée par organisation (`enabled`), lue à chaque appel ; éteinte, servie comme sans déclaration, les jetons d'une conversation commencée allumée encore résolus — à la demande d'un hôte, écrit.
- 2026-10-19 : J3, troisième partie, écrite — détecteurs de courriels et de téléphones : jeton de la personne déclarée, sinon jeton de valeur à sens unique, toujours actifs ; 0,02 faux positif pour 10 000 mots sur Wikipédia ; banc de fidélité refait, sans altération ni fuite hors des limites prévues — écrit en J3.
- 2026-10-19 : J3, seconde partie, écrite — champs déclarés d'une fonction de l'hôte (`output.entityFields`) servis en jeton de l'entité, rattachés à J3 depuis J5 sur décision d'Alexis ; retenus pour une entité inconnue — écrit en J3.
- 2026-10-20 : dans une organisation pseudonymisée, `node.share` retrouve la personne désignée par le jeton de son nom ou de son email — décidé par JB (source : session du 20/10/2026).
