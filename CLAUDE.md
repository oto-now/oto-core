# CLAUDE.md — Méthode de développement

## Projet

**Plateforme MCP d'entreprise** — un paquet npm, `@otomata_tech/oto_platform` (organisation npm
`otomata_tech`, ADR-010), installé dans une application Next : écrans, API, MCP à six outils figés,
services et migrations du schéma Postgres `platform`. Ce dépôt est un workspace pnpm : l'application
de base à la racine, le paquet dans `packages/plateforme/` (faces `ui/`, `schemas/`, `mcp/`, `api/`,
`server/`, `migrations/`, `cli/` ; `ui/` n'importe jamais `server/`, `migrations/` ni un client de
base — frontière appliquée par ESLint).

Docs qui font foi : la carte `docs/README.md` mène au produit (`docs/produit/prd.md`), à la
conception (`docs/conception/`, un document vivant par sujet), à la référence (`docs/reference/`) et
à l'exploitation (`docs/exploitation/`) ; ce qui reste ouvert : les issues GitHub, tâches de suite comprises ;
`.method/sprint/status.md` ne garde que les gestes réservés à JB (§ Documentation : où vit chaque information). Aucune création ni
modification de service extérieur (GitHub, Supabase, Vercel, npm), ni vrai secret, sans l'accord de JB.

**Effet produit — les systèmes de ce projet** (remplace la liste générique de « Rayon d'impact ») :
l'autre face du paquet (`ui/` ↔ `api/` ↔ `server/`) ; le schéma `platform` et ses policies RLS ; la
liste d'outils MCP servie aux hosts (surface figée : ajout seulement, ADR-002) ; les connecteurs
du paquet et le coffre de leurs secrets (`docs/conception/connecteurs-et-comptes.md`) ; l'application hôte qui monte le paquet (route,
middleware, thème) ; les migrations copiées et appliquées par l'hôte.

Stack : Next.js 15 (App Router) · TypeScript strict · Tailwind v4 · Shadcn/ui · pnpm workspace ·
Postgres (schéma `platform`). L'hôte de référence s'appuie sur Supabase (Auth et base), variables
dans `.env.local` (jamais affiché, jamais commité). Canal MCP (Claude, ChatGPT) : face `mcp/` du
paquet, montée sur `src/app/api/mcp/route.ts` ; ses règles sont dans le tag `mcp`.

**Gardes de portabilité** (ADR-012) — une revue les cite :
- **`src/` est l'hôte de référence** : ce que n'importe quel ERP écrirait pour monter le paquet, rien
  de plus. Un appel à un service propre au SaaS (Vercel, DNS, facturation) n'entre ni dans le paquet
  ni dans `src/`, sauf s'il est désactivé par une variable et listé ici. Listé : les sous-domaines
  de la cellule (src/lib/cellule/ d'oto-saas, API Vercel), désactivés sans `CELL_BASE_DOMAIN`, `VERCEL_TOKEN`
  et `VERCEL_PROJECT_ID`. Un tel appel hors de cette liste est un défaut de revue.
- **Le paquet ne dépend de Supabase qu'aux points admis** : `supabase-patterns.md § Couplage à Supabase`.
- **Un refus est décidé par le service**, avant sa requête : `security-patterns.md § Droits dans le service`.

## Documentation : où vit chaque information

Règle : **un seul endroit par nature d'information**. Une même décision ne s'écrit jamais deux fois.

| Nature | Où | Forme |
|---|---|---|
| Ce que fait le produit, pour qui, pourquoi | `docs/produit/` | le PRD, par parcours |
| Le détail d'un chantier, quand l'issue ne suffit pas | `docs/produit/stories/<sujet>.md` | une story : contexte, critères d'acceptation ; `/dev` la consomme |
| Comment le système est conçu, et pourquoi | `docs/conception/` | un document vivant par sujet (voir plus bas), et l'index `docs/conception/README.md` |
| Ce qu'on consulte : fonctions, schéma, routes, variables, textes servis | `docs/reference/` | — |
| Installer, déployer, monter de version | `docs/exploitation/` | — |
| Méthode, conventions, règles de contribution | `docs/contribuer/` (et `.method/` pour l'outillage) | — |
| Ce qui s'ouvre et se ferme : besoin, bug, question à trancher, chantier | une issue GitHub | type, assigné, jalon, étiquettes |
| Ce qui a changé, version par version | `docs/changelog.md` | — |

`docs/README.md` est la carte : quelle question mène à quel dossier.

### Issues et stories

- Tout besoin arrive en issue. Une épic est une issue parente ; ses chantiers sont des sous-issues.
- Métadonnées d'une issue :
  - le **type** dit la nature (Feature, Task, Bug) ;
  - l'**assigné** dit qui agit (ou qui tranche, pour une question) ;
  - le **jalon** dit l'échéance ;
  - les **étiquettes** sont limitées au domaine (`area: …`), à `bloquant` et à `leçon oto 1`.
- Une story n'est écrite que si l'issue ne suffit pas à spécifier le chantier. **C'est l'issue qui pointe vers la story** : son corps porte le chemin du fichier. Les documents du dépôt ne citent jamais d'issue, de PR ni d'URL GitHub.
- Pour travailler une issue, on lit l'issue (`gh issue view <n>`), puis la story qu'elle désigne, s'il y en a une.
- Un chantier livré : ce qui doit durer passe dans le document de conception du sujet, et la story est retirée.

### Documents de conception vivants

- **Un document par sujet** : un ensemble de décisions qui changent ensemble, et qui répond à une question avec laquelle le lecteur arrive. On le découpe s'il sert deux lecteurs ou deux rythmes, ou au-delà de 200 lignes environ. Une décision proche d'un sujet existant enrichit son document : elle n'en ouvre pas un nouveau.
- **En tête** : le statut (`proposé`, ou `validé avec X le JJ/MM/AAAA`) et la date de dernière révision.
- **Sections**, dans cet ordre et jamais vides : Résumé ; Contexte ; Objectifs et non-objectifs ; Conception ; Décisions et alternatives écartées ; Sécurité et confidentialité ; Écart avec le code ; Questions ouvertes ; Historique.
- **Le corps décrit toujours l'état présent.** Une phrase devenue fausse se corrige sur place. Une option abandonnée reste dans « Décisions et alternatives écartées », avec la raison de son abandon.
- **Historique** : une ligne par révision de fond, sous la forme `AAAA-MM-JJ : ce qui change — décidé par X (source : compte rendu ou réunion)`. Tant que le document est `proposé`, Git suffit et l'historique n'est pas obligatoire.
- Les identifiants hérités (anciens ADR, fiches `Dnnn`, hypothèses `Hnn`, `Nnn`, `Pnn`) restent cités dans le document qui les porte désormais, pour que les références du code se retrouvent par une recherche.
- Une question qui attend une décision vit en issue, assignée à qui tranche. Une fois tranchée, sa décision est reportée dans le document du sujet.

## Style de réponse

Réponses courtes, droit au but, le minimum de mots. Pas de récap de ce que l'utilisateur vient de
dire, pas de tableau décoratif ni d'emoji sauf demande, pas d'introduction ni de transition : l'état du résultat, rien d'autre.

## Avant de coder

- **Toute décision qui revient à l'utilisateur passe par `AskUserQuestion`, jamais par une phrase dans un récap.** Demande à plusieurs lectures, arbitrage produit, refacto proposé, option écartée qui coûterait à rattraper : la question porte le contexte nécessaire pour trancher — par option, sa conséquence et son coût — et la recommandation en premier. Le filtre reste « des lectures différentes mènent à un travail matériellement différent » ; le reste se tranche seul et s'écrit dans le récap. Un **sous-agent ne tranche pas** : il s'arrête et remonte l'arbitrage à qui l'a lancé. Quand l'utilisateur a demandé d'avancer sans lui, l'ambiguïté ne bloque pas : l'option la plus proche des documents de `docs/conception/`, sinon la plus simple, s'écrit en hypothèse sourcée ; seul ce qui changerait l'expérience d'un client ou coûterait cher à défaire lui remonte. Contrôlable sur la trace : un arbitrage rendu en prose (« j'ai choisi X », « à toi de voir ») sans appel à l'outil ni hypothèse écrite est une violation.
- **Edits chirurgicaux.** Chaque ligne changée trace à la demande. Pas de cleanup adjacent, pas de reformatage opportuniste, pas de refacto non demandé. Dead code repéré : le mentionner, pas le supprimer. Un refacto **repéré** n'est pas un refacto **fait** : il se nomme dans le rayon d'impact et devient une question (§ ci-dessus), pas un silence.
- **Rayon d'impact avant d'éditer, dès l'échelle Standard.** Le plus petit changement local, répété N fois sans regarder autour, produit un Frankenstein : doublons, appelants oubliés, effets de bord que personne n'a nommés. Avant la première ligne — dans la story (section « Rayon d'impact ») ou dans le plan proposé en live — quatre items, chacun observable : **(1) Appelants** : pour chaque fonction, table, colonne, composant ou Server Action modifié, les usages trouvés (**commande de recherche citée**, chemin absolu, sans borne de sortie : ni `head` ni `head_limit`, qui cachent les appelants au-delà de la coupe) et ce qui change pour chacun, doublures de test comprises (une doublure qui sert l'ancienne forme passe le type-check et n'échoue qu'à l'exécution) ; « aucun autre appelant » se prouve par la commande, jamais par affirmation. **(2) Doublons** : ce qui fait déjà la même chose (`component-registry.md` + recherche sur le concept, **commande citée**, sur ce que fait la surface et non sur son nom, qui manque les synonymes), avec le verdict réutiliser / fusionner / laisser et sa raison. **(3) Effet produit** : quel parcours voit une différence hors de l'écran modifié — autre route ou layout partagé, Server Action appelée ailleurs, policy RLS, webhook ou cron, email transactionnel, export / sitemap / SEO ; **un projet dérivé de ce template remplace cette liste par ses propres systèmes** (§ Projet). **(4) Refacto** : proposé ou écarté, écrit ; s'il est proposé, il est posé en question avec son coût et ce qui se passe sans lui. Contrôlable : un plan ou une story Standard+ sans ces quatre items, ou un item (1) ou (2) sans commande citée, est une violation. Micro en est exempt — sinon plus personne ne le fait.
- **Critères de succès vérifiables d'abord.** Reformuler la tâche en checks concrets : test qui reproduit le bug, assertion qui valide la feature, type-check qui passe. Pas de « make it work » flou.
- **Push back quand c'est justifié.** Approche plus simple disponible ou dette évidente créée : le dire avant d'exécuter.
- **Base à jour avant un chantier documentaire.** `git fetch` et écart avec `origin/main` constatés avant d'écrire dans `docs/`, `.method/` ou `CLAUDE.md`. Une règle écrite sur une base périmée cite des chemins morts.

## Justifier une surface nouvelle

Est une **surface** tout ce qui devra ensuite être lu, maintenu ou désappris : fichier, composant,
hook, util, abstraction, prop optionnelle, option de config, table, colonne, feature flag, dépendance.

1. **Toute surface nouvelle porte ce qui casse sans elle aujourd'hui.** Une phrase, dans le récap de livraison — dans le rapport de `revue` dès l'échelle Standard : quel comportement demandé n'existe pas sans elle. Un besoin au futur (« on pourrait vouloir », « pour rester générique ») n'est pas une justification : **la surface se retire, elle ne se documente pas.**
2. **Au-delà d'un changement Micro, le récap nomme l'option d'un cran plus simple écartée, et la raison.** Un cran plus simple = la même livraison avec une surface en moins : valeur en dur au lieu d'une option, composant existant étendu, code en ligne au lieu d'une abstraction, aucune dépendance ajoutée. **Une seule solution présentée = aucun arbitrage rendu** (`checklists/code-review.md § Arbitrage de complexité`).

Ces deux obligations sont la **trace** de « réutiliser avant de créer » (`.method/conventions/component-registry.md`) et de « factoriser à partir de 2 occurrences » (`coding-standards.md § DRY`) : sans elles, rien ne dit, en relisant un diff, si l'arbitrage a eu lieu.

## Après une erreur

- **Corriger l'instance ne solde pas l'erreur** — qu'elle soit commise par l'agent, repérée dans le code ou signalée par l'utilisateur. Après le fix, s'arrêter avant de reprendre le fil : qu'est-ce qui a rendu l'erreur possible, et qu'est-ce qui l'empêchera de revenir ? Tant que la seconde question n'a pas de réponse **écrite**, la récidive est garantie — sous une autre forme, dans un contexte où personne ne fera le lien.
- **L'apprentissage s'écrit là où il sera relu au bon moment**, pas là où c'est commode. Une garde posée dans une convention routée ou une checklist devient **citable en review** (`conventions/<fichier>.md § <section>`) — c'est ce qui la fait relire au bon moment.

| Apprentissage | Emplacement |
|---|---|
| Invariant d'architecture absent, flou ou violé | Document de conception du sujet, `docs/conception/<sujet>.md` (§ Documents de conception vivants ; un sujet nouveau : `.method/templates/conception.tmpl.md`) |
| Règle technique manquante ou fausse | Fichier du tag dans `.method/conventions/` (globs : `_index.md`), et sa fiche |
| Point de contrôle absent de la review | `.method/checklists/code-review.md` |
| Story acceptée alors qu'elle était floue | `.method/checklists/story-ready.md` |
| Composant recréé au lieu de réutilisé | `.method/conventions/component-registry.md` |
| Règle de travail globale / gotcha projet | `CLAUDE.md` |
| Contexte de l'erreur (incident, date, chantier) | Commentaire de l'issue, entrée de `docs/changelog.md` |

L'écriture ne se demande pas et ne s'ajourne pas : la garde s'écrit dans la foulée du fix, et le
récap dit **quel fichier, quelle section, quelle règle en une phrase** (§ Modifications
documentaires).

- **Une règle porte sa raison, pas son histoire.** Le « pourquoi » tient en une clause qui nomme le mécanisme (« le pooler rend la connexion sans la remettre à zéro »), jamais une date, une story, une revue ni un incident : ceux-là vont à l'issue et au changelog, où ils se lisent dans leur contexte. Une règle en contredit une autre : elle la remplace. Une règle dont le mécanisme a disparu (commande, fichier, service) part avec lui.
- **Une erreur avérée vaut occurrence suffisante.** Le seuil « 2+ occurrences » de `wrap-up` vise les patterns observés, pas les gardes anti-récidive. Le plafond de 400 lignes par fichier de conventions s'applique en revanche à l'identique : si la garde fait déborder, élaguer plutôt qu'empiler. `wrap-up` reste le filet de fin de chantier ; il ne remplace pas cette boucle immédiate.
- **Trois écueils :**
  1. **Ne rien écrire parce que « ça ne se reproduira pas ».** La bonne foi n'est pas un mécanisme.
  2. **Repousser l'écriture à plus tard.** « Je le noterai au wrap-up » laisse la garde à l'état d'intention. Elle s'écrit dans la foulée du fix, et cette écriture est annoncée — c'est l'annonce, pas un accord préalable, qui la rend relisible.
  3. **Écrire une règle qui décrit l'erreur au lieu de la rendre détectable.** « Faire attention à X » ne vaut rien. Test avant d'écrire : en relisant la règle, peut-on contrôler si elle a été tenue — par une machine (`pnpm verify`) ou par une citation en review ? « Toute affirmation porte sa source ou est marquée hypothèse » se contrôle ; « être rigoureux » non.

## Règles absolues

1. **Conventions chargées + `pnpm type-check` : à toute échelle, sans exception** — y compris pour un changement d'une ligne.
2. Lire avant de coder : l'issue et la story qu'elle désigne si applicable, sa référence UI si elle n'est pas `N/A`, le document de conception du sujet (`docs/conception/`), et les conventions routées.
3. Ne jamais créer un composant, hook ou util sans avoir vérifié `.method/conventions/component-registry.md`. S'il existe, le réutiliser.
4. Ne jamais modifier un invariant d'architecture sans réviser le document de conception de son sujet (`docs/conception/`).
5. Les tests s'écrivent AVEC le code : unit, puis intégration, puis e2e si applicable — au **minimum vital** (`testing-strategy.md § Budget de tests`).
6. **Aucun artefact n'est obligatoire ; son absence est déclarée, pas subie.** Pas de maquette, pas de story, pas de base de données : le travail se fait quand même. Une référence UI à `N/A` n'est jamais un défaut et la review ne la pénalise pas.
7. **Cadrage = documentation uniquement.** Pendant un `/plan` : aucune dépendance installée, aucun fichier de code créé, aucun build lancé. Seuls `docs/` et `.method/sprint/` sont modifiés.

### Ce qui est appliqué, et ce qui ne l'est pas

| Garanti par une machine | Tenu par jugement |
|---|---|
| `type-check`, `lint`, `test`, `check:framework` (`pnpm verify`) | Conventions réellement **lues** avant d'écrire (règles 1-2) |
| Le gate de commit : reçu obligatoire, `--no-verify` / `--force` bloqués | Registry consulté avant de créer (règle 3) |
| Routing, citations, fiches, globs morts, RLS, routes dupliquées (`check:framework`) | Document de conception révisé sur un invariant touché (règle 4) |
| | Échelle du changement correctement estimée |

Rien ne vérifie qu'une convention a été lue — seulement qu'elle a été **annoncée** : l'annonce est
la seule trace, et la produire fausse est un mensonge. Un doute sur la colonne de droite se dit.

## Échelle du changement

L'ampleur du process dépend de **ce que le changement touche**, jamais des mots employés dans la
demande. En cas de doute entre deux échelles, prendre la plus haute et le dire.

| Échelle | Reconnaissance | Process |
|---------|----------------|---------|
| **Micro** | 1-2 fichiers, aucune nouvelle surface | conventions → implémentation → type-check → **review inline** |
| **Standard** | 3-5 fichiers, ou création d'une fonction / composant / action | + tests → skill `revue` → changelog |
| **Module** | nouvelle surface (route, table, parcours), changement DB, ou ≥ 6 fichiers | **proposer une story avant de coder** → tout le Standard → registry → document de conception si invariant → issue du chantier fermée |

Micro retire le cérémonial (rapport de review, changelog d'un changement invisible), pas la
vérification. En Module, la story se **propose** : seul endroit où les AC précèdent le code, donc
seul moyen pour la review de statuer « AC non livré ». Refusée, on **reste en Module sans story** :
registry, document de conception et changelog restent dus ; seule la post-implémentation tombe.

### Garde-fous conditionnels

Déclenchés par la **nature réelle** du travail, quel que soit le vocabulaire employé.

- **Correction d'un comportement cassé** → écrire d'abord un test qui reproduit le bug et échoue.
- **Changement qui ne doit rien modifier au comportement observable** (réorganisation, extraction, renommage) → lire les tests existants avant · tests **identiques** avant/après · si la zone n'est pas testée, écrire les tests avant.

## Conventions routées par globs

Le routing `fichier touché → tag → convention` a **une seule source de vérité** : la colonne
**Globs** de [`.method/conventions/_index.md`](.method/conventions/_index.md).

- **Base, toujours lue :** `coding-standards.md` — une seule, volontairement courte.
- **Par globs :** chaque fichier créé ou modifié active des tags ; de chaque fichier correspondant se lit la fiche (`.method/conventions/fiches/<fichier>`), et le texte complet sur un doute, à la section citée, ou pour une revue.
- **Mode story :** les tags du champ `Conventions` s'ajoutent (union avec les globs). C'est le seul moyen d'activer `datetime`, `i18n` et `flags`, qu'aucun chemin ne révèle.
- **Annoncer la liste chargée** avant d'implémenter et avant de reviewer.

Registry et stack sont **routés** : le registry sert à la création, la stack aux dépendances. Ce
mapping ne se déduit jamais de mémoire ni ne se recopie ; aucun skill par tag (`dev` et `revue`
matchent les globs). **Ce qu'ESLint, TypeScript ou `check:framework` applique ne se répète pas en prose.**

## Skills

Tout vit dans `.claude/skills/`. Un skill se déclenche **sur l'intention** et reste invocable en `/<nom>`.

| Skill | Déclenchement | Rôle |
|-------|---------------|------|
| `dev` | auto — modification de `src/`, `tests/`, `supabase/`, config | 2 modes (lecture / écriture) × 3 échelles |
| `revue` | auto — fin d'implémentation dès l'échelle Standard | Conventions routées, confrontées au diff |
| `verify` | auto — « vérifie », « ça compile ? », après un fix | `pnpm verify` : 4 checks + reçu |
| `commit-push` | auto — « commit », « push », « envoie » | Checks (sans les rejouer) + changelog + commit + push |
| `wrap-up` | auto — « on a fini », « c'est bouclé » | Capture les apprentissages de fin de chantier : conventions, documents de conception, registry |
| `conventions` | auto — question sur une règle, sans fichier touché | Répond depuis `.method/conventions/` en citant la source |
| `audit` | demande explicite d'audit large | Confronte la **codebase existante** aux conventions, par lots |
| `plan` | **explicite uniquement** | Cadrage : refus / story seule / évolution / initial |

`revue` audite un **diff**, `audit` audite **l'existant**. Mêmes sources citables, même barème de
gravité. `plan` ne s'auto-déclenche jamais (`disable-model-invocation`) : un cadrage réécrit PRD,
conception et stories. Face à un besoin produit large, le **proposer** et attendre l'accord.

## Déléguer à un sous-agent

Un sous-agent reçoit la méthode, pas seulement la tâche : échelle annoncée, conventions routées à
charger, critères de succès, liste explicite des fichiers qu'il écrit (jamais un motif ni « ceux
des autres, à ne pas toucher » : deux agents réécriraient les mêmes), interdiction de commiter,
interdiction de trancher un arbitrage (§ Avant de coder). Dès l'échelle Standard, son rapport porte
son **rayon d'impact**. Le commit reste à qui l'a lancé. En vague de stories menée sans JB, les
règles du pilote et des agents sont dans `.method/sprint/vagues.md`.

## Modifications documentaires

Éditer `docs/`, `.method/` ou `README.md` sans toucher au code ne déclenche **aucun skill** (`dev`
s'en exclut, `revue` ne relit pas la prose) ; cinq règles s'appliquent quand même :

1. **Écrire dans `.method/`, `docs/` et `CLAUDE.md` ne demande aucun accord préalable**, mais
   **aucune écriture n'est silencieuse** : le récap nomme le fichier, la section, et la règle en une
   phrase — sinon une règle ajoutée sera lue comme vraie sans que personne ne l'ait vue passer. Une
   règle qui en contredit une existante la **remplace** ; elle ne s'empile pas à côté.
2. **`pnpm check:framework`** reste dû : routing, citations `§`, fiches et références de skills ne
   se vérifient que là.
3. **Une entrée de changelog** seulement si la modification change ce qu'un lecteur doit faire.
4. **Un texte markdown ne passe jamais dans une chaîne shell** : entre guillemets doubles
   (`node -e "…"`, `echo "…"`, `sed "…"`), ses apostrophes inverses deviennent des commandes ; dans
   `node -e '…'`, une apostrophe échappée `\'` casse le script. Il passe par un fichier : heredoc à délimiteur quoté (`<<'EOF'`) ou outil Write. Sous Windows PowerShell 5.1, un
   fichier du dépôt ne se relit jamais par `Get-Content` sans `-Encoding UTF8` pour être réécrit : lu
   en ANSI, chaque lettre accentuée devient deux caractères ; une réécriture passe par l'outil
   d'édition. **Vérifiable :** `rg -n 'Ã[©¨ª«®´§ ]' tests packages src scripts docs` ne trouve rien.
   Un échappement de code (barre oblique inverse suivie de `u` et d'un code, ou doublée) ne s'écrit
   ni par l'outil Edit ou Write, une expression rationnelle comprise, ni par un heredoc, passé à un interpréteur ou écrit dans un fichier : l'un et l'autre peuvent le livrer
   déjà interprété, en caractère invisible ou combinant. Il s'écrit par un script qui compose la barre
   (`chr(92)`, `String.fromCharCode(92)`), puis se relit. Aucun fichier du dépôt ne se modifie par `sed -i`
   sous Git Bash, qui réécrit ses fins de ligne (CRLF en LF) : une modification passe par l'outil d'édition. **Vérifiable :**
   `rg -n "[\x{2028}\x{2029}\x{200B}-\x{200F}\x{0300}-\x{036F}]" packages src tests scripts` ne trouve rien.
5. **Aucun nom réel dans un texte nouveau**, de document, de code ou de test : un client ou une
   personne réels s'écrivent par leur libellé neutre (« le premier client », « l'ERP Python »,
   « l'ERP d'un partenaire », « le responsable d'Oto ») ; seule la licence nomme son titulaire.
   Contrôle : `pnpm check:public`, avec la liste de refus `.public-denylist` posée à la racine
   (jamais commitée).

`docs/changelog.md`, `.method/sprint/`, `docs/produit/stories/`, `docs/conception/` et le registry sont
exclus du reçu de vérification : les éditer n'invalide pas des checks déjà passés.

## Vérifier, commiter, pousser

- **Pendant l'implémentation :** `pnpm type-check` seul, à chaque itération.
- **Une fois terminé :** `pnpm verify` — les 4 checks (`check:framework`, `type-check`, `lint`, `test`) **et** l'écriture du reçu. Ne jamais lancer les 4 commandes séparément.
- **Pour commiter :** skill `commit-push`. Il lance `pnpm verify:cached`, qui ne rejoue les checks que si le code a bougé depuis le dernier passage.
- **Base de test locale** : `PLATFORM_TEST_DB=local` dans la copie de `.env.local` et `pnpm db:local` font tourner les tests sur un Postgres 16 du poste ; seules les suites de l'adaptateur Supabase s'y sautent (Auth, serveur OAuth, Data API, outillage à comptes). À la fusion sur `main` : `PLATFORM_TEST_DB=local pnpm verify` écrit le reçu et, en parallèle, les fichiers que ce passage a sautés (sa ligne « skipped ») tournent sur le projet par `vitest run <ces fichiers>` sans la variable ; le commit attend les deux verts (`testing-strategy.md § Base de test locale`).
- **Le projet Supabase de test est partagé avec le dépôt de banc MCP (`mcp-test`)** : ses objets (`public.bench_*`, schémas `proto` et `oauth_test`) et ses versions de `supabase_migrations` ne sont ni supprimés, ni modifiés, ni « nettoyés », par SQL, tableau de bord ou connecteur ; ce dépôt ne touche que `platform` et ses propres versions (`database-patterns.md § Règles` pour `migration repair`). Vérifiable : une instruction `drop`, `truncate` ou `delete` lancée sur le projet nomme un objet de `platform`.
- **Un commit n'indexe que ses propres fichiers** : d'autres sessions écrivent dans le même checkout ; avant `git add`, chaque chemin de `git status --porcelain` se rattache au travail commité, un chemin inconnu reste hors du commit et se signale à JB.
- **C'est un gate appliqué, pas une convention.** `.claude/hooks/enforce-git-gate.mjs` bloque tout `git commit`, `merge`, `rebase`, `revert`, `cherry-pick` et `push` direct, lancé par l'outil Bash comme par l'outil PowerShell (matcher `Bash|PowerShell` de `.claude/settings.json` ; les deux hooks lisent la commande par `scripts/hook-command.mjs`, dans la grammaire du shell de l'outil), et refuse un commit dont le reçu ne couvre pas l'état exact du code. `--no-verify` et `--force` sont bloqués sans échappement possible. Si `scripts/hook-command.mjs` ne se charge pas, les hooks refusent ce qu'ils gardent et disent quoi faire : réparer le module par l'outil Edit ou Write, que les hooks ne voient pas (vérifiable : `tests/unit/hooks.test.ts`, « hooks whose reading module does not load »). `.githooks/pre-commit` couvre les commits que le hook ne voit pas (script, Makefile).
- **Worktree : seulement pour des stories menées en parallèle** (`.method/sprint/vagues.md`). Un correctif, une story seule ou une préparation de version se font dans le checkout principal : un worktree coûte une installation, une base locale, un recalage et un ménage. Le gate juge un commit sur le reçu du dépôt que la commande vise (`cd <dir> &&` en tête — en PowerShell `cd <dir>;` ou `Set-Location <dir>;` —, ou `git -C <dir>`) : lancer `pnpm verify` puis `git commit` DANS le worktree. Sous Windows, `<dir>` s'écrit en chemin Windows (`C:/apps/…`) : la forme de Git Bash (`/c/apps/…`) n'est pas reconnue, et le gate juge alors le reçu du checkout principal (vérifiable : un commit dans un worktree passe par `git -C "C:/…"`) ; le marqueur `# checks-ok` termine la commande, rien ne le suit. Pour recaler une branche sans commit sur `main` : `git stash push -u -m <nom unique>` → `git reset --hard main` → `git stash apply` de la référence qui porte ce nom (`git stash list`) → `git stash drop` de la même ; jamais un `git stash pop` nu, la pile étant commune à tous les worktrees. Jamais `git status --ignored` dans un worktree : avec `node_modules`, la commande dépasse le délai et laisse un `index.lock` orphelin. Tout contrôle de `pnpm verify` qui parcourt le disque depuis la racine saute `.claude/worktrees/**` par un chemin ancré à la racine (`eslint.config.mjs`, `scripts/check-framework.mjs`) ou liste ses fichiers par `git ls-files --exclude-standard` : sinon il lit le travail en cours des autres worktrees (vérifiable par `tests/unit/check-framework.test.ts`).
- **CI** : `pnpm check:migrations` (le SQL du paquet reste dans `platform` et additif, FR-INST-04), `pnpm build` (erreurs propres à Linux), et la suite portable sur un Postgres nu (job `bare-postgres` : `db prepare`, la ligne de base, la fumée, puis `vitest run tests/integration`, les suites propres à Supabase se sautant), et le build comme un hôte (job `packed-host-build` : le paquet empaqueté, installé depuis son `.tgz` dans une copie de l'application de référence, puis `next build` ; le build du workspace ne voit pas l'ordre de chargement d'un hôte). Un tag ne part que d'un commit où ces jobs sont verts. Pas de duplication avec le local.
- **Publication** : `publish.yml` ne tourne que sur un tag `v*` : secrets de l'arbre (`check-public --secrets-only`), migrations, accord du tag, de la version et du `CHANGELOG.md` du paquet, puis `npm publish --provenance`.

## Invariants techniques

Le détail vit dans les conventions routées ; ces quatre points s'appliquent partout et ne se
déduisent d'aucun chemin de fichier.

1. **Server Components par défaut.** `"use client"` seulement pour state, effets ou event handlers, et poussé le plus bas possible dans l'arbre.
2. **Server Actions pour les mutations.** Pas de Route Handler sauf webhook ou cron. Chaque action : auth → Zod → exécution → revalidation → `{data}` ou `{error}`. Exceptions écrites : les écrans du paquet (`ui/`) ne connaissent pas `server/`, leurs mutations passent par `/api/platform/*` (ADR-008 § 4) ; les routes MCP (`/api/mcp`, `/api/mcp-admin`) et OAuth sont des Route Handlers par nature.
3. **Un schema Zod = une source de vérité**, partagé entre le formulaire et l'action.
4. **RLS activée sur toute table**, sans exception non documentée par un document de conception. Auth revérifiée dans chaque Server Action — le middleware ne suffit pas. La décision d'accès est dans le service, jamais dans la seule RLS (`security-patterns.md § Droits dans le service`, ADR-012 § 3).

## Design system

Hôte de référence : violet corporate, dark mode class-based (next-themes), Inter. Tokens dans
`src/app/globals.css`, documentation dans docs/design/system.md d'oto-saas, preview sur `/design-system`.

- **Réutiliser avant de créer** : `.method/conventions/component-registry.md` puis `src/components/ui/`.
- **Classes sémantiques uniquement** (`bg-primary`, `text-muted-foreground`, `border-border`). Aucune couleur Tailwind numérotée (`bg-emerald-500`) dans `src/` ni `packages/plateforme/ui/`.
- **Exception : les écrans du paquet** (`packages/plateforme/ui/`) **et les pages du groupe `(dashboard)`** sont sur le jeu de tokens d'`oto-frontend` (`text-ink`, `text-mute`…), sous la `CoquilleOto` que le layout pose une fois, à la couleur de la personne ou de l'organisation (ADR-008 § 3, `.method/conventions/portage-ecrans.md`, `accessibility-patterns.md § Couleurs & Contraste`).
- **Tester les deux thèmes** avant de considérer un écran terminé.

## Workflow

1. Échelle, puis conventions routées (plus les tags de la story), **liste annoncée**.
2. Issue : la lire (`gh issue view <n>`), puis la story qu'elle désigne, entièrement ; passer `.method/checklists/story-ready.md`, lire la référence UI si ≠ `N/A`. Sinon : critères vérifiables et, dès Standard, plan proposé avant d'éditer.
3. Implémenter : migration DB → schemas Zod → Server Actions + tests → composants + tests → page + tests d'intégration ; garde-fous conditionnels ; `pnpm verify`.
4. Review — inline en Micro, skill `revue` dès Standard. Tout problème HAUTE ou MOYENNE **cite sa source** (`conventions/<fichier>.md § <section>`, `CLAUDE.md § <section>`, `checklists/code-review.md § <section>`, ou un AC). Sans source : BASSE, non bloquant.
5. Finaliser selon l'échelle (changelog · registry · post-implémentation · issue du chantier fermée · document de conception), puis `commit-push`.

## Quand le PRD évolue

`docs/produit/prd.md` modifié (parcours concerné, statut 🔶 Draft) → `.method/checklists/prd-evolution.md`
→ impacts **réels** seulement (parcours, référence UI, conception, issues et stories, DB) → le document
de conception du sujet et `docs/reference/` → issues et stories impactées, nouvelles seulement si
nécessaires → entrée de `docs/changelog.md`. Un changement qui ne touche ni parcours ni modèle de données passe
directement en implémentation.
