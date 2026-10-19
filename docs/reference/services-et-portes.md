# Services et portes

> Ce qu'on consulte : les modules de `server/`, les fonctions pures de `schemas/` et les trois portes (MCP, API, écrans). Le pourquoi est dans [la conception](../conception/README.md).

## Services et portes

Chaque service suit le même ordre : identité, Zod, droits décidés avant la requête, exécution
dans une transaction, journal. Il rend `{ data }` ou lève `PlatformError`.

| Module de `server/` | Rôle | Portes |
|---------------------|------|--------|
| `sql.ts`, `db.ts` | Pool postgres.js (`PLATFORM_DATABASE_URL`, rôle `platform_app`, sans requêtes préparées, TLS hors machine locale, cinq connexions par instance) ; `withCallerSession` et `withAnonSession` : une transaction par opération, rôle, claims et délais posés en local, claims hérités vidés ; `createPlatformDb({ caller })`, face `db.tx` ; `createAnonPlatformDb()` pour les lectures anonymes | toutes |
| `errors.ts` | `PlatformError` et ses codes ; traduction des codes de la base (`PT409` → `stale_revision`) ; `inTransaction`, seule aide de transaction ; `READ_PAGE_ROWS` | toutes |
| `issuer.ts`, `identity.ts` | Émetteur configuré (Supabase Auth ou OIDC) ; organisation de l'adresse (`X-Forwarded-Host`, sinon `Host`), personne traduite, rôle, équipes, équipe plateforme | toutes |
| `access.ts`, `access-levels.ts`, `access-facts.ts` | Niveaux calculés en TypeScript (calcul pur) sur l'identité, les ancêtres du nœud et les règles, lus par lots ; lots `nodeLevels` et `accountLevels` ; messages de refus « à qui demander » ; décision d'un changement de propriétaire | tous les services |
| `invitations.ts`, `members.ts`, `mail.ts` | Inviter, accepter, retirer, fiche de la personne ; lien magique en mode Supabase, email de la plateforme au SMTP de l'hôte en mode OIDC | API, écrans, MCP admin |
| `teams.ts`, `rules.ts`, `account-share-journal.ts`, `directory.ts` | Équipes, responsables, règles d'accès d'un nœud ou d'un compte (personne, équipe, organisation), journal des partages d'un compte, annuaire | API, écrans, MCP admin |
| `team-panel.ts` | Une équipe lue par le « ⋯ » de sa section du rail (`GET teams/<slug>`) : elle, les personnes de l'organisation, `compose` et `admin` ; `teamViews`, partagé avec `listTeams` | API (rail) |
| `oauth.ts`, `connect.ts` | Mode Supabase : consentement OAuth (client, compte, organisation par `resource`, MCP admin nommé) ; page « Brancher mon Claude, ChatGPT ou Mistral » : adresse du serveur, noms recommandés, dernières connexions, prompts d'exemple | hôte, écrans |
| `ctx.ts`, `journal.ts` | Émission et garde du `ctx` : le refus d'un code périmé nomme les Contextes changés, porte un nouveau code, avec lequel l'appel se rejoue, et leurs parties telles que `context` les sert maintenant (ADR-002 § 2) ; la ligne de l'auteur d'un Contexte avancée par `write` à la révision qu'il publie, si son code gardait la précédente (`acceptOwnContextWrite`) ; ce qui a changé depuis un code (`ctxChanges`, pour `since_ctx`) ; écriture du journal, pour le MCP et les mutations de l'API | MCP, API |
| `context/` | Moteur de blocs de `context` : `code` (règles « How this workspace works » et langue de réponse ; sans procédure servie, fonctions et section du guide proposées, `hints.ts`), procédure servie, une partie par Contexte (Tout le monde, Privé, chaque équipe) ouverte par sa ligne de faits (organisation, personne, équipe, connecteurs de l'équipe par défaut) puis le Contexte, les contenus rangés dessous et ses pages liées, nouveautés, procédures utiles, « Recent content » ; blocs servis entiers sous un plafond de 35 000 caractères, coupe dite (ADR-002 § 7) ; `BlockReport.head`. Avec `since_ctx` (un code précédent de la personne dans l'organisation) : le routage de la phrase et les seules parties des Contextes changés depuis, le même code si rien n'a changé (aucune ligne écrite), un nouveau sinon ; ni règles, ni nouveautés, ni procédures utiles, ni contenus récents ; un code refusé sert le contexte complet (E11-S19) | MCP, écrans (aperçu) |
| `routing.ts`, `find.ts` | Score, décision au seuil de l'organisation, consigne des candidats (chacune avec ses mots en commun avec la demande ; sans procédure servie, le seuil et l'écart de l'organisation dits ; une demande d'édition sans candidate reçoit la marche `find` puis `write`) ; recherche de `find` (section de chaque bloc de page trouvé ; pour qui écrit le nœud, hors tableau, la ligne « To edit » avec sa révision) ; liste de toutes les fonctions actives, par connecteur, servie par `read functions` | MCP, écrans |
| `nodes/` | `read` (blocs rendus en markdown : en-tête, plan, section, référence au bloc ; un bloc de type ou de forme inconnus rendu en ligne de commentaire, que `write` refuse de perdre ; chemins réservés `journal` et `functions` ; le plan absent des données quand une section est lue ou que le texte le porte), `write` (markdown analysé en blocs ; opérations par section, par bloc et sur tout le corps, `set_markdown`, découpé en sections par ses titres ; `replace_text` sur une section, un bloc ou toute la page, `count` occurrences ; publiées par défaut, brouillon sur `publish: false` ; mode tolérant réservé à l'écran : collage, `.md` importé), écriture d'assistant qui publie (`write` du MCP, `upload.link`, `table.import`, `node.write_many`) tenue dans une transaction (`write-atomic.ts`) : un refus n'écrit rien, l'écran garde son brouillon, `publish: false` garde un brouillon (ADR-011 § 3), export `.md` d'un nœud publié (`export.ts`), publication dès le niveau écriture (le chemin suit le titre au même niveau, segment coupé au dernier mot entier), abandon d'un brouillon (`discard.ts`, `node.discard_draft`), liens, alias, blocs `reference`, déplacement (`node.move` derrière `call`), écriture par lot (`node.write_many`, 50 pages, une ligne de résultat par page), ordre des frères, duplication, corbeille (purge après 30 jours par le service, sans tâche planifiée ; `node.trash` derrière `call`), liens de partage public | MCP, API, écrans |
| `files/` | Fichiers joints (ADR-016) : le port `FileStore` (`store.ts`, nul sans les cinq variables `PLATFORM_STORAGE_*` ; sept opérations, `put` et `list` compris), l'adaptateur S3 signé par `aws4fetch` (`s3.ts`) et celui des tests (`memory.ts`) ; demande d'envoi, confirmation, lecture par redirection, disponibilité, texte d'un fichier (`readFileText`), purge, copie, envoi par le serveur (`service.ts`) ; quota et ligne `pending` (`rows.ts`) ; fichier en transit, sans nœud, lisible par son seul auteur et lu en octets par le moteur sous son identité (`transit.ts`) ; visionneuse et lecture publique (`view.ts`) ; en-têtes et texte des deux routes HTML (`html.ts`, ADR-017) | API, écrans, MCP (`read {file}`) |
| `uploads.ts`, `uploads-write.ts`, `uploads-fetch.ts` | `upload.link` (ADR-018) : ticket, consommation sous `anon`, identité reconstruite, journal, formulaire de dépôt ; destination décidée au lien et relue à l'envoi, écriture d'un fichier, d'un `.md` ou d'un CSV ; téléchargement contrôlé d'une adresse fournie (schéma, port, adresses résolues, redirections, 10 s, 1 Mo ; une autre borne pour `node.import_tree`) | MCP (`call`), API |
| `transfer/` | Transfert d'une arborescence (`transfert-d-arborescence.md`) : `node.export_tree` (lecture des sous-arbres lisibles, pivot `oto-tree` ou ZIP, écrit par `put`, URL d'une heure ; `collect.ts`) et `node.import_tree` (source téléchargée ou fichier joint, quatre formats, `formats.ts` ; deux passes, collisions par le chemin, `continue_from`, `import.ts` ; fichiers joints relus et rejoints, purge des exports expirés, aussi au passage de la corbeille, `files.ts` ; liens, appels, cellules et outils préfixés recollés, `links.ts` ; rapport et curseur, `import-report.ts`) et `node.tree`, `node.check` (inventaire et contrôle d'une arborescence, `inspect.ts`) derrière `call` | MCP (`call`) |
| `bounded-read.ts` | `readBounded` : seul lecteur borné d'un corps (porte du dépôt, adresse fournie, texte d'un fichier), refus choisi par l'appelant | API, services |
| `procedures.ts`, `procedures-check.ts`, `prompts.ts` | Contrôle à la publication des blocs `call` d'une procédure ; prompts (procédures publiées lisibles, message = titre) | MCP, API |
| `catalog/` | Registre des fonctions, recherche et contrats servis par `read` ; fonctions `table.*` ; `node.discard_draft`, `node.trash`, `node.move` (niveau gestion), `node.write_many`, `node.export_tree` et `node.import_tree` (connecteur natif `node`) ; contrats non appelables `write.*` ; source des fonctions métier de l'ERP et des connecteurs décrits déclarés ; arguments en Zod ou en JSON Schema (`arguments.ts`, Ajv 2020) | MCP, MCP admin |
| `connectors/` | Activation, comptes simulés ou réels, secret à plusieurs champs et réglages d'un compte réel (`setAccountSecret`, `account-secret.ts`, coffre `vault.ts`), authentifications (`auth.ts`), adresses et réglages (`settings.ts`), garde d'une adresse saisie (`address-guard.ts`), résolution du compte dans un ordre fixe et ses refus (`resolution.ts`, `account-refusals.ts`), équipe porteuse, client HTTP des connecteurs réels (`http.ts`), connecteur simulé `mail` ; moteur des connecteurs décrits : déclaration par l'hôte (`registerConnectors`, `declaration.ts`, type `definition.ts`), exécution (`engine.ts`), sonde d'un compte et son solde (`probeAccount`, `probe.ts`), liste `connectors` tenue depuis la déclaration | MCP, API, MCP admin |
| `calls.ts` | `call` : fonction, activation, droits, équipe, compte, confirmation en deux temps, exécution, compte-rendu | MCP |
| `tables/` | `table.schema`, `rows`, `aggregate`, `write`, `claim`, `release`, `delete_rows` (suppression définitive par clé, `delete-rows.ts`) sur les blocs `row` ; preuve exigée pour toute valeur nouvelle si le tableau l'exige (`proof`) ; `create_only` ; recherche `q` par mots (chaque mot, ou avec `match: any` au moins un, les lignes qui en portent le plus d'abord) ; revue humaine, ou par l'assistant si le tableau l'autorise ; lectures de l'écran (grille, résumé, file, vues) ; évolution de l'en-tête par `write` ; import d'un CSV (`import.ts` : `table.import` et `POST tables/import` appellent `importRows`, provenance `import`) et export CSV (`export.ts`) | MCP (`call`), API, écrans |
| `feedback.ts` | Tickets | MCP, MCP admin, écrans |
| `journal-read.ts`, `journal-rows.ts`, `journal-model.ts`, `usage.ts`, `activities.ts` | Lecture du journal par conversation, dans la portée décidée par le service (ses lignes, celles des équipes qu'on mène, toutes pour l'admin) ; arguments masqués et coupés ; un appel sur l'espace personnel d'autrui ne livre à un autre lecteur que son outil, son heure, son issue, son code et sa cible coupée à `private/<handle>` (`perso/<handle>` sur une ligne d'avant ce nom, le journal n'étant pas réécrit) ; usage agrégé ; activités de l'accueil (le journal classé en gestes sur un contenu, dans la même portée, titre et lien seulement pour un contenu que la personne lit) | écrans, MCP, MCP admin |
| `admin/` | Opérations des huit outils admin, partagées avec le tableau de bord ; journal admin ; administrateur nommé par l'équipe plateforme, à la création ou après (`first-admin.ts`) ; point d'extension de la création d'une organisation, que l'hôte branche ; inscription libre (`signup.ts`, ADR-023), sur l'option `signup` de `handlePlateforme` | MCP admin, API |
| `limits.ts` | Capacités par organisation (ADR-022) : la source de l'hôte (`registerOrgLimits`), lue hors transaction ; le refus au plafond (`requireUnderLimit`, `limitedTx`, verrou 7601) de `inviteMember`, `createTeam`, `activateConnector` ; le quota de fichiers (`orgStorageQuota`, 10 Go par défaut) ; l'état servi aux écrans (`orgLimitsView`) ; les compteurs sans session (`orgUsage`, ADR-022 § 10) ; l'équipe plateforme, avec un accès en cours, passe les limites comptées, une ligne du journal le dit | API, MCP, MCP admin, écrans |
| `organisations.ts` | Les organisations dont la personne est membre, avec une adresse de chacune, celle qu'on joint depuis l'adresse de la requête (`listMyOrganisations`, `reachableHost`), pour la bascule du menu de l'entreprise | écrans |
| `flags.ts`, `cell.ts`, `brand.ts` | Drapeaux par organisation ; état de la cellule (version, migrations, variables exigées selon le mode) ; marque | MCP admin, écrans |
| `share-image.ts` | Données de l'image de partage d'une adresse, sans session (E11-S21) : l'organisation de l'adresse (`org_by_host`, logo lu par `fetchSource`, en `data:`), et, pour un lien public, le titre et le résumé que `readPublicNode` sert ; jamais un nœud sans lien ; ne lève jamais (repli générique). Dessinée par `ImageDePartage` (`ui/`), rendue par `ImageResponse` chez l'hôte | Routes d'image de l'hôte |

**Hors de `server/`, dans `schemas/`**, des fonctions pures qu'importent `server/` et `ui/` :
le rendu des blocs (`blocks-render.ts`, dont le `.md` d'une page et son inverse, `pageMarkdown` et
`readPageMarkdown`, qui retire d'un `.md` importé son frontmatter YAML et en lit titre et résumé,
`frontmatter.ts`, que `set_markdown` écarte aussi du corps) et la syntaxe des liens `[[…]]` (`link-syntax.ts`, seul lecteur des liens, du
code en ligne qui les cache et des clôtures, `openingFence` et `closesFence`) : un `[[…]]` est un
lien à l'écran si et seulement si la publication l'extrait. S'y ajoutent la lecture, la déduction
et le contrôle d'un CSV (`csv.ts`, `csv-cells.ts`), que l'écran joue avant l'envoi et que le service
rejoue sur chaque lot, et les règles d'une valeur de tableau (`tables.ts` : `isEmail`, `instantOf`,
`maxLengthOf`).

**Portes.**
- `mcp/` : handlers bas niveau, outils calculés par organisation, un seul formateur de résultat,
  garde `ctx` ; `makeVerifyToken()` injecté par la route ; métadonnées de ressource protégée.
- `api/` : un handler unique, `handlePlateforme(request, { accessToken, host, defer?, verifyToken? })`, qui
  vérifie le jeton, résout l'organisation de l'adresse puis dispatche `/api/platform/<ressource>`
  vers le service. Réponses `{ data }` ou `{ error: { code, message } }` avec le statut HTTP. Une
  ressource sans organisation (`cell`, équipe plateforme) se reconnaît avant l'identité par
  l'adresse. Routes du tableau de bord sous `admin/*`. `GET nodes/export` et `GET tables/export`
  rendent `{filename, content}`, des lectures sans ligne de journal (D138) ; `GET nodes/tree` rend l'arbre
  visible de la personne (`visibleTree`, `{tree, truncated}`), celui que le layout de l'hôte passe au rail,
  lecture sans journal (E11-S20) ; `POST tables/import`
  écrit un lot de 500 lignes d'un CSV. Vérification de la session en deux temps, réponses d'erreur
  JSON et contrôle d'origine d'une mutation dans `api/session.ts`, partagés par la table de dispatch
  et les branches qui passent avant elle. Fichiers : `api/files.ts` (`GET files`, `POST files`,
  `POST files/<id>/complete`, `GET files/<id>` en redirection 302, `?check`, `…/markdown`),
  `api/transit-files.ts` (`POST transit-files`, `POST transit-files/<id>/complete`, `GET transit-files/<id>` en
  redirection 302, pour l'auteur seul) et
  `api/files-html.ts` (route isolée `files/<id>/html` et son pendant public, branche avant le
  dispatch, texte brut, ADR-017) ; `public/<jeton>/files/…` passe par la porte publique.
  **Porte sans session qui écrit** (ADR-018) : `api/uploads.ts`, `POST uploads/<jeton>`, avant le
  jeton de session, texte brut, toute requête à `Origin` ou d'une autre méthode que `POST` refusée
  (`forbidden`, sans lire la base ni consommer le ticket) ; à côté, la route à session du
  formulaire, `POST uploads/<jeton>/form`, que monte la page `/upload/<token>` de l'hôte.
- `ui/` : écrans en Server Components, qui reçoivent leurs données et leurs rappels par props
  (`.method/conventions/portage-ecrans.md`) ; mutations par `api/`. Le rail (`RailApplication`) part de
  l'arbre servi par le layout, que Next ne rejoue pas à la navigation client, puis relit son arbre seul par
  `GET nodes/tree` : à chaque changement d'adresse, au retour sur l'onglet ou la fenêtre (5 s au moins après
  la relecture précédente), et à chaque relecture de la page (`useRafraichir`, qui suit chaque geste) ; une
  relecture à la fois, l'arbre montré gardé sur un échec, un nouvel arbre servi par le layout adopté
  (E11-S20). Équipes et nom de l'organisation restent ceux du layout. Une procédure s'y édite et s'y
  lit comme une page (texte seul, un bloc `call` déjà écrit rendu en texte) ; ses blocs `call`, la
  vérification à la publication et les prompts servent les assistants.

