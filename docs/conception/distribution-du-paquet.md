# Distribution du paquet

- **Statut** : validé avec JB le 23/09/2026
- **Dernière révision** : 2026-11-19 (publication à la fusion d'une pull request de version)

## Résumé

Le paquet `@otomata_tech/oto_platform` est consommé en source dans son workspace et publié en public sur npmjs.com, en version sémantique, à la fusion d'une pull request de version approuvée par JB ou par Alexis, qui pose le tag `v<version>` ; le dépôt `oto-pkg` est open source (MIT) et ne contient rien de privé (ADR-010). Son SQL ne touche que le schéma `platform` et ne fait qu'ajouter ; personne n'écrit dans `platform` hors des services ; un hôte monte de version par une pull request Renovate (ADR-006).

## Contexte

Le paquet s'installe dans la base de l'application hôte, à côté du schéma `public` de l'ERP. Deux sortes de consommateurs : l'application de base du dépôt du paquet, qui le teste, et les applications hôtes, dans d'autres dépôts (notre SaaS, les ERP des clients). Une cellule ou une routine peut avoir une version de retard ; l'ERP voudra lire les tableaux de la plateforme ; chaque application doit monter de version à son rythme, sans que notre CI ait accès au projet du client.

## Objectifs et non-objectifs

- Installer un ERP sans jeton ni configuration de registre ; un correctif du paquet profite à tout le monde.
- Une cellule en retard d'une version continue de tourner ; notre CI n'entre jamais chez le client.
- Le journal, la provenance et les droits ne se contournent pas par une écriture directe.
- Hors objectif : un registre privé ; des migrations appliquées en silence au démarrage ; un schéma partagé avec l'ERP.

## Conception

### Publication (ADR-010)

- **Dans le workspace, le paquet est consommé en source** (ADR-010 § 1) : `"@otomata_tech/oto_platform": "workspace:*"` dans le `package.json` de l'application de base, `exports` du paquet vers ses fichiers TypeScript, `transpilePackages` dans `next.config.ts`. Aucune étape de build ; le paquet est aussi publié en sources TypeScript.
- **Pour tout autre hôte, publication publique sur npmjs.com** (ADR-010 § 2), en version sémantique, sous le scope de l'organisation npm `otomata_tech`. Aucun registre privé, aucun jeton d'installation. La provenance exige que `repository.url` du paquet nomme le dépôt qui publie.
- **Une version se publie à la fusion de sa pull request de version** (ADR-010, révisée le 2026-11-19), par `.github/workflows/publish.yml` :
  1. La pull request de version monte `version` de `packages/plateforme/package.json`, nomme la section `## <version> — <date>` du `CHANGELOG.md` du paquet et réunit les migrations de la version en un seul fichier (D124). Elle vise `main`, ou `release/x.y.z` pour un correctif parti d'un tag quand `main` porte un lot pas encore publiable (branche créée sur le tag de départ, `release/1.4.1` depuis `v1.4.0`). Elle part d'une branche du dépôt, jamais d'une fourche : le jeton d'une fourche ne pousse pas de tag.
  2. Elle est approuvée par JB (`jean-baptiste-tiple`) ou par Alexis (`AlexisLaporte`), sur son dernier commit, et fusionne quand la CI (`ci.yml`, qui tourne aussi sur les pull requests vers `release/**`) est verte. Le job `version` de `ci.yml` y joue déjà les contrôles de contenu de la version (`scripts/ci/version-publiable.mjs`) : une seule migration ajoutée depuis le tag précédent, une section `## <version> — ` au `CHANGELOG.md`, tag `v<version>` encore libre ; l'erreur se voit avant la fusion.
  3. **Double regard** : GitHub interdit d'approuver sa propre pull request, donc les versions d'Alexis attendent l'approbation de JB et celles de JB celle d'Alexis.
  4. À la fusion, le job `tag` vérifie que la version change entre la base de la pull request et son dernier commit (sinon rien ne se publie), rejoue les contrôles de contenu du même script sur le commit de fusion, vérifie que la dernière revue d'un des deux approbateurs est une approbation du dernier commit de la pull request (sinon il échoue, et rien n'est tagué), puis seulement pose le tag annoté `v<version>` (message `@otomata_tech/oto_platform <version>`) sur le commit de fusion. Un tag posé sur un commit qui ne peut pas être publié ne se retirerait qu'à la main.
  5. Le job `publish`, dans le même workflow, ne part que si le job `tag` a réussi et sorti un tag. Il part de ce tag : contrôle des secrets de l'arbre et de l'historique (`check-public --secrets-only`), des migrations (`check:migrations`), de nouveau du script (le tag égale la version), puis `npm publish --provenance` (secret `NPM_TOKEN` du dépôt). Un tag poussé avec le jeton du workflow ne déclenche aucun autre workflow : la publication s'enchaîne donc dans le même, plutôt que sur un `push: tags`.
  6. **Retour d'une version corrective vers `main`** : une branche `release/x.y.z` ne fusionne jamais dans `main`. L'auteur de la pull request de version corrective ouvre, dans la foulée de sa fusion, une pull request vers `main` qui y reporte la section `## x.y.z — <date>` du `CHANGELOG.md` du paquet : ses lignes sortent de `## Unreleased` (où le correctif, déjà sur `main`, les avait mises), sinon la version suivante les annoncerait comme nouvelles ; le correctif lui-même, s'il n'est pas déjà sur `main`, y passe par la même pull request. La section 1.8.1 a été reportée ainsi, dans la pull request qui révise cette règle.
- **Passage manuel exceptionnel** : `workflow_dispatch` de `publish.yml` sur un tag `v<version>` déjà posé, lancé par JB ou Alexis seulement (le job le refuse à tout autre compte), quand la publication est tombée après le tag (panne de npm). Il n'existe plus de tag poussé à la main qui publie : un `push: tags` publierait sans l'approbation exigée. La 1.8.1, publiée le 2026-11-19 par un tag poussé à la main depuis `release/1.8.1`, sur accord direct d'Alexis, est la dernière exception à cette règle.
- **Deux dépôts dans l'organisation GitHub `otomata-tech`** (ADR-010 § 3) : `oto-pkg`, public, sous licence MIT, porte le paquet et l'application de base minimale qui le teste ; `oto-saas`, privé, porte notre SaaS, application hôte qui dépend du paquet publié. Le titulaire de la licence est celui d'`oto-backend`.
- À la fin de la V1, le code s'est séparé en ces deux dépôts neufs : le paquet, public, publié sur npm au tag `v1.0.0` avec une application de base minimale, et le SaaS, privé ; jusque-là, `src/` était l'hôte de référence (H124). Pas de purge d'historique : paquet et SaaS sont partis chacun d'un dépôt neuf, en un commit initial de l'arbre nettoyé ; l'ancien dépôt reste privé ; le pilote a exécuté ces gestes de fin de V1 avec l'accord de JB (D96).

### Rien de privé dans un dépôt public (ADR-010 § 4)

- Ni nom de client ou de personne réels, ni secret, ni donnée de production, dans les fichiers comme dans l'historique. `check:public` cherche les secrets à chaque vérification et à la publication, et les noms d'une liste de refus (`.public-denylist`, jamais commitée ; en CI, lue depuis un secret du dépôt). Les deux fichiers `LICENSE` sont exemptés pour les noms, jamais pour les secrets : la licence nomme son titulaire, légitimement (D67, fiche retirée dont le texte n'est pas conservé ; `scripts/check-public.mjs` et son test la citent).
- Seule la licence nomme une personne, avec le nom, le domaine et la société du responsable du projet (D102).
- Un client ou une personne réels s'écrivent par un libellé neutre : « le premier client », « l'ERP Python », « l'ERP d'un partenaire », « le responsable d'Oto » (D69). Les organisations citées dans les documents et les tests sont fictives (Acme Énergies, Delta Logistique, Valbrune).
- Ce qui reste propre à un client (contenu, procédures, comptes) est en base, jamais dans le dépôt.

### Le schéma `platform` (ADR-006)

- **Le SQL du paquet ne touche que le schéma `platform`** (ADR-006 § 1) : `oto-platform migrations check` (`pnpm check:migrations` en CI) refuse toute migration qui en sort (FR-INST-04). Ce qu'un Postgres nu doit porter hors de `platform` (rôles, schéma `auth` réduit, extensions) est posé une fois par `oto-platform db prepare`, hors des migrations ([base et portabilité](base-et-portabilite.md), ADR-012 § 1).
- Le schéma `platform` n'évolue que par les migrations du paquet ; un service qui ne fait que lire et calculer n'ajoute ni migration ni fonction SQL : une lecture bornée, puis un calcul pur dans le service (H01).
- **Les migrations ne font qu'ajouter** (ADR-006 § 2). Retirer se fait en deux temps, sur deux versions : cesser d'utiliser, puis supprimer ; une contrainte n'est remplacée que par une plus large. Une version majeure peut replier la chaîne en une ligne de base, que la CI compare au schéma de la chaîne. `check:migrations` (`cli/migrations-check.mjs`) refuse tout `drop`, `rename`, `set not null` et changement de type, sauf trois formes qui ne retirent rien : `drop policy|trigger|function if exists X` suivi aussitôt de la recréation de X ; `drop constraint X, add constraint X check|foreign key` dans la même instruction, la revue vérifiant que la nouvelle contrainte admet tout ce qu'admettait l'ancienne ; `alter column … drop not null`. Une policy devenue sans objet est donc neutralisée sous son nom (`using (false)`), et la ligne de base suivante l'omet. Le second temps d'un retrait (supprimer) attend cette ligne de base : aucune liste d'exceptions par fichier ou par objet n'existe ; celle du retrait d'E01-S12 (`TWO_STEP_REMOVALS`, HN-E01S12c-1) n'est plus dans le code depuis la 1.0.0.
- Le schéma est sorti propre en 1.0.0 : une migration de retraits (ADR-006 § 2), puis une seule ligne de base V1 ; les tests du dépôt du paquet tournent en CI sur un Postgres nu, les suites propres à Supabase Auth vont au dépôt du SaaS (D102). Le schéma part de cette seule ligne de base, portable sur un Postgres managé (D66, porté par [base et portabilité](base-et-portabilite.md)) ; toute migration suivante s'y ajoute. Une seule la précède, `20260928090000_platform_pg_trgm.sql` : elle charge la bibliothèque de `pg_trgm` dans la session de `supabase db push`, sans quoi un rôle non superutilisateur ne peut pas créer les fonctions de la ligne de base qui posent `set "pg_trgm.similarity_threshold"` (M93) ; un hôte déjà installé la pousse une fois avec `--include-all`. `check:migrations` refuse toute migration nouvelle qui pose un tel paramètre avant d'avoir chargé la bibliothèque (`pg-trgm-parameter-before-load`).
- **Un seul fichier de migration par version publiée** : chaque story qui touche la base garde son fichier pendant le développement, puis le pilote les fusionne en `<horodatage>_vX_Y_0.sql` avant le tag et répare l'historique du projet de test (D124).
- **Personne n'écrit directement dans `platform`** (ADR-006 § 3), ni l'ERP, ni un script : tout passe par les services de `server/`, qui tiennent révisions, provenance, journal et droits. L'ERP lit aussi par ces services (`@otomata_tech/oto_platform/server`), jamais par une requête à côté : les droits se décident dans le service et la RLS n'isole que les organisations (ADR-012 § 3). Seule exception, l'outillage, par la connexion d'administration (`PLATFORM_ADMIN_DATABASE_URL`), jamais déployée ni importée par le paquet : organisation Démo, équipe plateforme, export-import d'une organisation, oubli d'une personne, ménage OAuth, tests ; ses tests vérifient ce qu'il pose. La clé secrète de Supabase ne sert plus qu'à l'API d'administration des comptes.
- **Les migrations du paquet sont copiées dans celles de l'hôte** (ADR-006 § 4) par `oto-platform migrations sync`, puis `check`, et appliquées par le propre workflow de l'hôte, dans l'ordre du paquet. Pas à pas : [installer un hôte](../exploitation/installer-un-hote.md).

### Mises à jour d'un hôte (ADR-006 § 5 à 7)

- Une mise à jour arrive par une version du paquet (numérotation sémantique, publiée sur npmjs.com) et une pull request Renovate par application (preset `renovate/preset.json` du dépôt du paquet). Seule une version corrective (`x.y.Z`) fusionne seule quand la CI est verte ; la PR d'une version mineure se relit à la main, sur les lignes `### Hosts` et `### Assistants` du `CHANGELOG.md` (label `oto-platform-minor`) ; une majeure aussi. La configuration Renovate de l'hôte de référence et le README du paquet le disent. La CI de l'application applique les migrations et déploie. `admin_cell` dit la version et les migrations d'une cellule ([administration](administration-et-cellule.md)).
- Les six outils et l'API ne font qu'ajouter (ADR-002) : une version du paquet ne demande rien à rafraîchir dans Claude ou ChatGPT (ADR-006 § 6).
- Un changement de comportement passe derrière un drapeau par organisation (`orgs.flags`, écran Drapeaux) (ADR-006 § 7), sauf les nouveautés de l'epic E10 (contenus riches), qui arrivent sans drapeau ; en contrepartie, une version mineure du paquet ne fusionne pas seule chez un hôte, sa PR Renovate se relit à la main (D121).

### Versions 1.1.0 et suivantes

- Les stories d'E10 et d'E11 sont sorties ensemble dans une seule version du paquet, rien avant la fusion de toutes ; le renommage des adresses (E11-S07) y est entré sans alias, la plateforme n'ayant pas de client ; la PR Renovate de l'hôte se relit à la main (D131).
- Cette version est la 1.1.0 : une seule version, un seul fichier de migration `<horodatage>_v1_1_0.sql` (D145). Elle ne se construisait pas chez un hôte ; la 1.1.1 corrective l'a suivie, et le job `packed-host-build` de la CI (le paquet empaqueté, installé depuis son `.tgz` dans une copie de l'application de référence, puis `next build`) garde ce cas.

### Restes de la clôture de la V1 (E01-S12)

- Une création « Sans titre » dont le chemin `sans_titre` ou `sans_titre_<n>` est pris par un nœud que l'appelant ne voit pas (corbeille ou invisible) va au premier chemin libre, sans borne, et le résultat le dit (`data.path`) ; tout autre chemin pris reste refusé (`conflict`) (HN-E01S12c-11 ; la règle générale des chemins est D125, dans [nœuds et arbre](noeuds-et-arbre.md)).
- La page publique d'un tableau porte `table` : `columns` (nom et type de chaque colonne publiée), `rows` (clé et valeurs des seules colonnes déclarées, triées par clé en ordre binaire, 500 au plus) et `truncated` ; ni preuve, ni provenance, ni réservation, ni ligne en brouillon (HN-E01S12c-12, fiche D103, dans [partage public](partage-public.md)).

## Décisions et alternatives écartées

- **Registre privé** (GitHub Packages ou npmjs.com privé) : scope lié au propriétaire du registre, jeton dans chaque ERP et dans Renovate. Écarté : le dépôt est public (ADR-010).
- **Un tag `v<version>` poussé à la main par JB seul** (ADR-010 jusqu'au 2026-11-19) : la publication attendait une seule personne, et le contrôle de la version passait hors de toute revue. Remplacé par la pull request de version approuvée par JB ou par Alexis, et le tag posé par la CI.
- **Un second workflow déclenché par le tag posé par la CI** : un tag poussé avec le jeton du workflow ne déclenche aucun workflow ; il faudrait un jeton personnel ou d'application dans les secrets. Écarté au profit de deux jobs enchaînés dans `publish.yml`.
- **Paquet non publié, copié dans chaque ERP** : copie qui diverge, plus de pull request Renovate. Écarté (ADR-010).
- **Un seul dépôt pour le paquet et le SaaS** : le SaaS porte des réglages et un outillage propres à son hébergement, et sa CI des secrets de déploiement. Écarté (ADR-010).
- **Purge de l'historique de l'ancien dépôt** : écartée au profit de dépôts neufs partant d'un arbre nettoyé (D96).
- **Migrations appliquées par le paquet au démarrage** : un déploiement qui migre en silence, sans revue, sur la base du client. Écarté (ADR-006).
- **Un schéma partagé avec l'ERP (`public`)** : collisions de noms, migrations entremêlées, impossible de refuser une migration hors périmètre. Écarté (ADR-006).
- **Écriture directe de l'ERP avec des déclencheurs de journal** : le journal ne saurait ni la personne, ni le `ctx`, ni la provenance ; `access_rules` serait contournable. Écarté (ADR-006).
- **La 1.1.0 d'E10 seul**, remplacée par une version commune à E10 et E11 (D131) ; **le numéro 1.0.1** de cette version commune, remplacé par 1.1.0 (D145).
- **Un drapeau par organisation pour les nouveautés d'E10** : remplacé par la relecture à la main de la version mineure (D121).
- **Replier les migrations en une nouvelle ligne de base qui charge `pg_trgm`** (M93) : `migration repair` par le responsable sur chaque hôte installé, copies à retirer à la main, fichiers publiés retirés. Écarté au profit d'une migration préalable.
- **Précharger `pg_trgm` par `db prepare`** (`session_preload_libraries`, M93) : réglage réservé au superutilisateur, que Supabase ne donne pas. Écarté.

## Sécurité et confidentialité

- Tout ce qui entre dans `oto-pkg` est public, fixtures et commits compris : `check:public` à chaque vérification et à la publication ; la liste de refus n'est jamais commitée.
- La publication vérifie les secrets de l'arbre avant `npm publish` et porte la provenance npm.
- Seule l'approbation de JB ou d'Alexis, lue par l'API des revues de la pull request, fait poser un tag de version ; le passage manuel est réservé aux mêmes comptes.
- La connexion d'administration de l'outillage n'entre jamais dans l'application déployée ni dans le paquet.

## Écart avec le code

- Les règles de branche ne se posent pas par le dépôt : Alexis, administrateur du dépôt, règle dans GitHub, sur `main` et `release/**`, une pull request obligatoire, une approbation, l'invalidation des approbations à chaque nouveau commit, et les jobs de `ci.yml` exigés (dont `Version pull request`), sans exception pour les administrateurs. Sans elles, `publish.yml` refuse toujours de taguer une version non approuvée ; il ne protège pas le reste de `main`.
- Le registre central des versions de plusieurs cellules n'existe pas ; `admin_cell` ne décrit que la cellule courante.
- `oto-platform migrations sync` compare les copies de l'hôte octet pour octet, ce qui échoue sur un checkout Windows en CRLF (M74).
- L'installation complète par `supabase db push` sous un rôle non superutilisateur n'est prouvée que sur un Postgres 16 du poste (M93) ; elle reste à jouer sur un projet Supabase neuf, et aucun job de CI ne pousse sous un tel rôle.
- Le chemin des migrations du paquet n'est pas encore exporté une seule fois pour les tests (M24).

## Questions ouvertes

Aucune à ce jour.

## Historique

- 2026-09-23 : distribution publique sur npmjs.com sous `@otomata_tech`, dépôts `oto-pkg` (MIT) et `oto-saas` ; SQL limité à `platform`, additif, écrit par les services, mises à jour par Renovate — décidé par JB (source : ADR-006, ADR-010).
- 2026-09-28 : nouveautés d'E10 sans drapeau, mineure relue à la main (D121) ; une migration par version publiée (D124) ; dépôts neufs sans purge d'historique (D96) — décidé par JB (source : fiches D96, D121, D124).
- 2026-09-29 : schéma propre en 1.0.0, une ligne de base (D102) ; 1.0.0 publiée avec provenance ; E10 et E11 en une seule version, la 1.1.0 (D131, D145) — décidé par JB (source : fiches D102, D131, D145, story E01-S12).
- 2026-10-01 : refonte en document de conception vivant, qui reprend ADR-006, ADR-010, H01, H124, D67, D69, D96, D102, D121, D124, D131, D145 et les choix d'E01-S12 — décidé par Alexis, accord de JB.
- 2026-10-01 : une migration préalable à la ligne de base charge `pg_trgm` pour `supabase db push` (M93), poussée une fois avec `--include-all` par un hôte installé ; garde `pg-trgm-parameter-before-load` de `check:migrations` — décidé par JB (source : session de travail du 2026-10-01).
- 2026-11-19 : une version se publie à la fusion de sa pull request de version (vers `main` ou `release/x.y.z`), approuvée par JB ou par Alexis, chacun approuvant les versions de l'autre ; contrôles de contenu joués sur la pull request puis avant le tag ; la CI pose le tag `v<version>` sur le commit de fusion puis publie dans le même workflow ; l'auteur d'une version corrective reporte sa section du CHANGELOG sur `main` ; plus de tag manuel réservé à une seule personne, la 1.8.1 en est la dernière exception — décidé par Alexis, relu par JB (révise ADR-010).
