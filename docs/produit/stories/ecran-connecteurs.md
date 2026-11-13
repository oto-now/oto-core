# Story — Écran Connecteurs : mes connecteurs (liste, détail, partage, états)

## Meta

| Champ | Valeur |
|-------|--------|
| **Épic** | Écrans de la plateforme (V2) : écran Connecteurs et traduction |
| **Parcours** | 4.5 Administrer |
| **Statut** | 🔵 In Progress — codée le 2026-11-13 sur la branche `connectors`, non fusionnée ; contrôle visuel à faire ; livrée avec `ajout-d-un-connecteur.md` |
| **Priorité** | Must (V2) |
| **Référence UI** | Maquette « Oto · Connecteurs, refonte UX » du responsable du produit, écrans 1 à 4 (liste, détail, partage, états), décrits en texte dans § Référence UI ci-dessous |
| **Conventions** | portage, a11y, forms, security, state, api, registry, testing |
| **Estimation** | L |
| **Porteuse de migration** | non |
| **Dépend de** | aucune pour être codée (services déjà livrés) ; **livrée avec** `ajout-d-un-connecteur.md`, sur la branche `connectors` |

## Contexte

L'écran Connecteurs montre aujourd'hui la mécanique du moteur : un catalogue à activer, des comptes, un « secret et
réglages », des noms techniques, deux vues selon le rôle. Il n'a ni recherche, ni tiroir, ni état lisible, et un membre
n'y voit pas les comptes qu'on a partagés avec lui. Les retours d'usage de la version précédente du produit disent la
même chose : un connecteur qu'on ne trouve pas, un état « branché » ambigu, un partage qu'on ne sait pas faire.

Décisions du responsable du produit du 2026-11-12 :
- **un seul objet à l'écran, « le connecteur »** : un nom, un accès, un état ; les mots « activation », « compte » et
  « secret » ne sont plus montrés à un membre ;
- **le partage d'un connecteur suit le partage d'une page** : même panneau, mêmes gestes ;
- **tout membre ajoute un connecteur, privé par défaut** : cette partie attend des évolutions du moteur, elle est dans
  `ajout-d-un-connecteur.md`.

Cette story refait la lecture et l'entretien, sur les services existants. Elle ne change aucune règle du moteur.

Décision du responsable du produit du 2026-11-12 sur la livraison : l'écran sort **en une fois**, cette story et
`ajout-d-un-connecteur.md` ensemble, sur la branche `connectors`. Aucune version intermédiaire de l'écran n'est
montrée à un utilisateur.

**Périmètre**
- Une liste unique, la même pour un administrateur et pour un membre : chaque compte que la personne voit, les siens,
  ceux de ses équipes, de l'organisation, et ceux d'un autre partagés avec elle.
- Filtres « Tous », « À moi », « Partagés avec moi », et une recherche.
- Un état par ligne, en un mot, avec le geste qui le répare.
- Le détail d'un connecteur dans un tiroir : état, accès, ce que l'assistant peut faire, connexion, journal des
  partages, désactivation.
- Le partage dans le panneau des pages : une personne, une équipe ou toute l'organisation, trois niveaux.
- Les gestes montrés seulement à qui en a le droit.

**Hors périmètre**
- Le catalogue avec recherche et catégories, l'ajout par tout membre, le test à la saisie, le nom modifiable et la
  description : `ajout-d-un-connecteur.md`.
- Réactiver un compte désactivé, la date du dernier usage et le nombre d'appels : le moteur ne les sert pas ; à
  reprendre dans une story de suite quand il les servira.
- Les sondes planifiées et les alertes : `sondes-et-alertes.md`.
- La traduction de l'écran : `traduction-des-ecrans.md`.

**Refs :**
- PRD : FR-ADMIN-04 (parcours 4.5 Administrer)
- Conception : `docs/conception/connecteurs-et-comptes.md` (§ Écran Connecteurs, § État d'un compte),
  `docs/conception/droits-d-acces.md` (§ Partage d'un compte de connecteur), `docs/conception/ecrans-et-coque.md`

## Référence UI

Quatre écrans de la maquette, en texte.

1. **Liste.** Titre « Connecteurs », sous-titre « Les outils que votre assistant peut utiliser pour vous. », bouton
   « Ajouter un connecteur ». Filtres en pastilles avec leur compte. Tableau à quatre colonnes : connecteur (initiale
   de l'outil, nom du compte, nom lisible de l'outil), accès (à qui, et le niveau), état (pastille et mot, une ligne de
   précision), un geste au plus. Pied : « Un connecteur est privé tant que vous ne le partagez pas. »
2. **Détail**, tiroir à droite. En-tête : nom, outil, « Partager ». Sections : État ; Accès, avec « Gérer les accès » ;
   Ce que l'assistant peut faire (trois nombres : actions de lecture, d'écriture, sensibles) ; Connexion, avec
   « Remplacer la clé » ; Journal des partages ; « Désactiver ».
3. **Partage**, le panneau des pages : champ « Ajouter une personne ou une équipe », section « Accès par défaut »
   (toute l'organisation), section « Ajoutés », une pastille de niveau par ligne. Niveaux : « Lecture seule »,
   « Lecture et écriture », « Toutes les actions », chacun avec une ligne qui dit ce qu'il ouvre et le nombre d'actions
   du connecteur ; puis « Retirer l'accès ».
4. **États et page vide.** Un mot et un geste par état ; page vide « Aucun connecteur pour l'instant ».

## Critères d'acceptation

### Liste

- [ ] **Given** un membre, administrateur ou non **When** il ouvre l'écran **Then** une seule liste montre chaque compte
  qu'il voit au niveau lecture au moins (`listOrgAccounts`), et aucun compte de niveau 0
- [ ] **Given** une ligne **When** elle s'affiche **Then** elle porte le libellé du compte, le libellé lisible du
  connecteur (celui de sa définition, à défaut son nom technique), l'accès, l'état, et un geste au plus
- [ ] **Given** un compte personnel de la personne **When** il n'a aucune règle de partage **Then** la colonne accès
  dit « Privé » ; **When** il en a **Then** elle nomme le premier sujet, puis « +n »
- [ ] **Given** le compte personnel d'un autre, partagé avec la personne **When** la ligne s'affiche **Then** elle dit
  « Partagé par <nom du propriétaire> » et le niveau de la personne
- [ ] **Given** un compte d'équipe ou d'organisation **When** la ligne s'affiche **Then** elle nomme l'équipe ou
  « Toute l'organisation » et le niveau de la personne
- [ ] **Given** les filtres **When** la personne choisit « À moi » **Then** seuls ses comptes personnels restent ;
  « Partagés avec moi » montre tous les autres ; chaque pastille porte son compte
- [ ] **Given** plus de huit lignes **When** la personne saisit un texte dans la recherche **Then** la liste se réduit
  aux lignes dont le libellé ou le connecteur le contient, sans casse ni accent
- [ ] **Given** des comptes en plusieurs états **When** la liste s'affiche **Then** ceux qui demandent un geste viennent
  d'abord, puis les autres par libellé, les comptes désactivés en dernier
- [ ] **Given** aucun compte visible **When** l'écran s'ouvre **Then** la page vide dit « Aucun connecteur pour
  l'instant » et propose « Ajouter un connecteur »
- [ ] **Given** une lecture qui échoue **When** l'écran s'ouvre **Then** il dit « Une erreur est survenue. » et propose
  de réessayer, comme aujourd'hui

### États

- [ ] **Given** un compte actif, sans marque, dont le secret ou les jetons sont posés, ou simulé **Then** l'état est
  l'état sain, dans les mots que fixe `ajout-d-un-connecteur.md` : « Fonctionne » après un test réussi, « Non testé »
  sinon
- [ ] **Given** un compte réel sans secret, ou un compte à consentement jamais connecté **Then** l'état est
  « À terminer », avec le geste « Saisir la clé » ou « Connecter » pour qui le gère
- [ ] **Given** un compte à consentement ou rattaché en `error` **Then** l'état est « À reconnecter » ; son propriétaire
  voit « Reconnecter », les autres lisent « Demandez à <propriétaire> de le reconnecter »
- [ ] **Given** un compte marqué `credential_rejected` **Then** l'état est « Clé refusée » avec la date de la marque, et
  « Remplacer la clé » pour qui le gère
- [ ] **Given** un compte marqué `quota_exhausted` **Then** l'état est « Crédits épuisés » avec la date, et la précision
  « La clé reste bonne »
- [ ] **Given** un compte désactivé **Then** la ligne est atténuée, dit « Désactivé », et n'a aucun geste
- [ ] **Given** un état **When** il s'affiche **Then** il se lit sans la couleur : le mot est toujours écrit

### Détail

- [ ] **Given** une ligne **When** la personne l'ouvre **Then** un tiroir montre l'état, l'accès, ce que l'assistant
  peut faire, la connexion et le journal ; la touche Échap et le bouton de fermeture le ferment, le focus revient à la
  ligne
- [ ] **Given** le connecteur du compte **When** le détail s'affiche **Then** il donne le nombre de ses fonctions par
  classe (lecture, écriture, sensible) et leur liste dépliable
- [ ] **Given** une personne qui ne gère pas le compte (`viewerLevel` sous `manage`) **When** le détail s'affiche
  **Then** ni « Partager », ni « Gérer les accès », ni « Remplacer la clé », ni « Désactiver », ni le journal ne sont
  proposés ; le détail dit qui gère le compte
- [ ] **Given** qui gère un compte réel à clé **When** il choisit « Remplacer la clé » **Then** le formulaire actuel du
  secret et des réglages s'ouvre dans le tiroir, sans jamais préremplir un champ secret ; un refus
  (`invalid_arguments`, `forbidden`, `stale_revision`) s'affiche dans le formulaire
- [ ] **Given** qui gère le compte **When** il choisit « Désactiver » et confirme **Then** le compte passe à
  « Désactivé » ; la confirmation garde l'avertissement actuel tant que le moteur ne sait pas réactiver

### Partage

- [ ] **Given** qui gère le compte (le propriétaire d'un compte personnel, un responsable d'un compte d'équipe, un
  administrateur d'un compte d'organisation) **When** il choisit « Partager » ou « Gérer les accès » **Then** le
  panneau s'ouvre avec les partages lus (`listAccountRules`)
- [ ] **Given** le panneau **When** il cherche un nom **Then** les équipes et les personnes de l'organisation qui y
  répondent sont proposées ; le propriétaire d'un compte personnel n'est jamais proposé sur son propre compte
- [ ] **Given** un sujet choisi **When** il valide **Then** `POST admin/account-rules` pose la règle au niveau
  « Lecture seule » par défaut, et la ligne apparaît sous « Ajoutés »
- [ ] **Given** une ligne **When** il change sa pastille de niveau **Then** la règle prend le niveau choisi (`read`,
  `write`, `sensitive`) ; le niveau `manage` n'est pas proposé
- [ ] **Given** la ligne « Toute l'organisation » **When** il choisit un niveau **Then** la règle d'organisation est
  posée ; « Aucun accès » la retire
- [ ] **Given** une ligne **When** il choisit « Retirer l'accès » **Then** `DELETE admin/account-rules/<id>` la retire,
  sans confirmation de plus que celle du panneau des pages
- [ ] **Given** un refus du service (`forbidden`, `not_found`, `invalid_arguments`) **When** il arrive **Then** le
  panneau l'annonce et garde l'état d'avant
- [ ] **Given** le pied du panneau **When** il s'affiche **Then** il dit le comportement réel du moteur : pour un compte
  personnel, « L'assistant de la personne s'en servira quand elle le lui demandera en le nommant. » ; pour un compte
  d'équipe ou d'organisation, « L'assistant des membres s'en sert sans avoir à le nommer. » ; et toujours « La clé
  reste cachée : personne ne peut la lire ni la copier. »

### Ajouter

- [ ] **Given** le bouton « Ajouter un connecteur » **When** la personne le choisit **Then** la fenêtre de
  `ajout-d-un-connecteur.md` s'ouvre ; à sa fermeture sur un ajout, la liste montre la nouvelle ligne et son détail

## Implémentation

### Fichiers à créer

`ui/`
- `packages/plateforme/ui/admin/connecteurs/liste-des-connecteurs.tsx` — filtres, recherche, tableau
- `packages/plateforme/ui/admin/connecteurs/detail-du-connecteur.tsx` — le tiroir
- `packages/plateforme/ui/admin/connecteurs/partage-du-connecteur.tsx` — le panneau de partage d'un compte
- `packages/plateforme/ui/admin/connecteurs/etat-du-compte.ts` — fonction pure : `AccountView` vers l'état, son mot et
  son geste

### Fichiers à modifier

`ui/`
- `packages/plateforme/ui/admin/connecteurs/ecran-connecteurs.tsx` — une seule vue ; monte la liste, le tiroir et la
  fenêtre d'ajout
- `packages/plateforme/ui/admin/connecteurs/libelles-des-partages.ts` — les trois libellés de niveau et leurs lignes
- `packages/plateforme/ui/admin/connecteurs/partage-du-compte.tsx` et `partages-du-compte.tsx` — retirés, remplacés par
  `partage-du-connecteur.tsx`
- `packages/plateforme/ui/admin/textes.ts` — textes de l'écran
- `packages/plateforme/ui/index.ts` — exports

`schemas/`
- `packages/plateforme/schemas/connectors.ts` — `AccountView.owner` gagne le nom du propriétaire d'un compte personnel
  (additif)

`server/`
- `packages/plateforme/server/connectors/accounts.ts` — `visibleViews` rend ce nom, lu dans l'annuaire

Hôte
- `src/app/(dashboard)/admin/connectors/page.tsx` — une seule lecture pour tous : `listOrgAccounts`,
  `listConnectorsForOrg`, `connectorAccountForms`, les règles des comptes que la personne gère, l'annuaire des équipes
  et des personnes
- `src/app/(dashboard)/admin/connectors/loading.tsx` — squelette de la liste

**Migrations prévues** : aucune. La story ne lit et n'écrit que des colonnes existantes.

**Schémas Zod partagés** : `setAccountRuleSchema` (`schemas/rules.ts`), inchangé ; `AccountView`
(`schemas/connectors.ts`), étendu.

### Patterns à suivre

- `.method/conventions/portage-ecrans.md` : tokens d'`oto-frontend`, sous la `CoquilleOto`
- `.method/conventions/component-registry.md` : `Drawer`, `Dialog`, `AccessPanel`, `SectionDuPartage`,
  `EtiquetteDeLigne`, `Select`, `StatusDot`, `Badge`, `Avatar`, `EmptyState`, `ListTools`, `RowList`, `Ilot`,
  `ActionPlateforme`, `ConfirmationEnLigne`
- `.method/conventions/security-patterns.md § Droits dans le service` : l'écran masque un geste, le service le décide

## Rayon d'impact

### Appelants

- `EcranConnecteurs` — `rg -l "EcranConnecteurs|ecran-connecteurs" packages src tests scripts` → 7 fichiers :
  `packages/plateforme/ui/index.ts` (export, gardé), `src/app/(dashboard)/admin/connectors/page.tsx` et `loading.tsx`
  (props changées), `tests/integration/components/ecran-connecteurs.test.tsx` (réécrit),
  `packages/plateforme/README.md` et `CHANGELOG.md` (texte)
- `listOwnAccounts` — `rg -l "listOwnAccounts" packages src tests scripts` → 7 fichiers : la page ne l'appelle plus ;
  restent son export (`server/index.ts`) et ses tests (`tests/integration/partage-des-comptes.test.ts`,
  `tests/integration/pages/admin-config-pages.test.tsx`, à adapter). Le service devient sans appelant dans l'hôte de
  référence : à signaler, pas à retirer (un hôte peut l'appeler)
- `listOrgAccounts` — `rg -l "listOrgAccounts" packages src tests scripts` → 11 fichiers : `mcp/admin/tools/connector.ts`
  et `server/admin/context.ts` lisent `AccountView` ; le champ ajouté à `owner` est additif, leurs sorties ne changent
  pas tant qu'ils ne le lisent pas ; les doublures de `tests/unit/admin-dashboard-services.test.ts` servent l'ancienne
  forme et restent valides
- `partage-du-compte`, `partages-du-compte` — `rg -l "partage-du-compte|PartageDuCompte|partages-du-compte" packages
  src tests scripts` → 4 fichiers, tous dans `ui/` : les deux fichiers eux-mêmes, `ecran-connecteurs.tsx`, `ui/index.ts`
- `NIVEAUX_DU_COMPTE` — `rg -l "NIVEAUX_DU_COMPTE" packages src tests scripts` → 4 fichiers de
  `ui/admin/connecteurs/` : le journal des partages lit les mêmes libellés et change donc de mots avec eux
- `connectorAccountForms` et `listConnectorsForOrg` — lus par la page, inchangés

### Doublons

- Le partage d'une page (`ui/noeud/partage-du-noeud.tsx`, `partage-visuel.tsx`, `acces-general.tsx`,
  `niveau-d-un-membre.tsx`) — `rg -l "SectionDuPartage|ChoixDuNiveau|AjoutDAcces" packages src tests scripts` → ces 4
  fichiers. Verdict : **réutiliser** `AccessPanel`, `SectionDuPartage` et `EtiquetteDeLigne` tels quels ; **laisser**
  `PartageDuNoeud` et `ChoixDuNiveau`, câblés sur le chemin d'un nœud, ses règles et son échelle de niveaux
- Le tiroir : `Drawer` (`ui/ds/react/drawer.tsx`), déjà utilisé par le journal. Verdict : réutiliser
- La recherche d'une liste : `ListTools`. Verdict : réutiliser
- Le champ « Ajouter une personne ou une équipe » — `rg -l "PARTAGE\.ajouter" packages src tests scripts` → 1 fichier : `ui/noeud/champ-d-ajout-d-acces.tsx`. Verdict : **fusionner**, décidé par le responsable du produit le 2026-11-13 : le champ du partage d'une page (`AjoutDAcces` de `partage-du-noeud.tsx`) est sorti dans `ChampDAjoutDAcces`, générique (`candidats`, `ajouter`), que montent le partage d'une page et celui d'un connecteur ; les tests du partage d'une page passent inchangés

### Effet produit

- Le MCP admin (`admin_connector accounts`) et le contexte d'administration lisent `AccountView` : aucun texte servi
  ne change
- La liste d'outils MCP, le schéma `platform` et ses policies, le coffre : non touchés
- L'hôte de référence : la page change de lectures ; un hôte qui monte `EcranConnecteurs` avec ses propres lectures
  doit suivre les nouvelles props à sa montée de version (entrée de changelog)
- Le journal des partages change de mots (« en lecture » devient « Lecture seule »)

### Refacto

- **Fait, sur décision du responsable du produit du 2026-11-13** : le champ « Ajouter une personne ou une équipe » mis en commun (`ui/noeud/champ-d-ajout-d-acces.tsx`). Appelants : `rg -l "ChampDAjoutDAcces" packages src tests scripts` → `noeud/champ-d-ajout-d-acces.tsx`, `noeud/partage-du-noeud.tsx`, `admin/connecteurs/partage-du-connecteur.tsx`. Le partage d'une page ne change ni de geste ni de mot ; ses tests sont lus avant et rejoués inchangés

- **Écarté** : rendre `ChoixDuNiveau` et `PartageDuNoeud` génériques sur l'échelle de niveaux. Ils serviraient les deux
  partages, mais la modification toucherait le partage des pages, hors de la demande ; le panneau des comptes compose
  les pièces visuelles partagées et choisit le niveau par le `Select` du design system
- **Code mort repéré** : après cette story, `listOwnAccounts` n'a plus d'appelant dans l'hôte de référence

## Tests attendus

### Unit tests
- [ ] `etat-du-compte` : chaque état et son geste, pour qui gère et pour qui ne gère pas
- [ ] Tri et filtres de la liste, recherche sans casse ni accent

### Integration tests
- [ ] `tests/integration/components/ecran-connecteurs.test.tsx`, réécrit : liste d'un membre avec un compte partagé
  par un autre ; gestes absents sous le niveau `manage` ; tiroir ouvert et fermé au clavier ; partage posé, niveau
  changé, accès retiré (les routes appelées et leurs corps) ; refus annoncé
- [ ] `tests/integration/pages/admin-config-pages.test.tsx` : la page sert la même vue à un administrateur et à un
  membre
- [ ] Sur une vraie base, données jetables : `listOrgAccounts` rend le nom du propriétaire d'un compte personnel
  partagé, et ne rend pas un compte de niveau 0

### Contrôle visuel
- [ ] Les deux thèmes, largeur de bureau et de téléphone : liste, tiroir, panneau de partage, page vide, chaque état

## Hypothèses

Prises pendant l'implémentation, sous l'option la plus proche des décisions du 2026-11-12 ; chacune se défait sans toucher au moteur.

- **Les gestes de l'administrateur restent à l'écran tant que le moteur garde l'activation.** L'activation et la désactivation d'un connecteur pour l'organisation vivent dans un îlot « Outils de l'organisation », sous la liste, pour l'administrateur seul : c'est l'îlot que `ajout-d-un-connecteur.md` (§ Administrateur) prévoit. Sans lui, aucun connecteur ne pourrait plus être activé depuis l'écran.
- **La fenêtre « Ajouter un connecteur » rassemble ce que le moteur sait faire aujourd'hui.** Chacun y connecte son compte à un service à consentement ou à compte rattaché ; un administrateur y retrouve le formulaire actuel de création d'un compte d'organisation ou d'équipe, avec ses mots d'avant (« Créer un compte », « Libellé »). Un membre sans service à connecter y lit qu'un administrateur peut ajouter un connecteur et le partager avec lui. `ajout-d-un-connecteur.md` remplit cette fenêtre (catalogue, clé, test).
- **L'état sain se dit toujours « Non testé ».** Aucun test de connexion n'est gardé sur un compte ; « Fonctionne » arrive avec `ajout-d-un-connecteur.md`.
- **Le niveau « Toutes les actions » ne promet pas d'accord préalable.** Sa ligne dit « Y compris les actions sensibles, comme envoyer ou supprimer. », sans affirmer qu'une action sensible demande toujours un accord : la règle appartient au moteur.
- **La page lit les partages des comptes personnels de la personne et du compte ouvert**, non de tous les comptes qu'elle gère : la liste ne résume que les siens, et un administrateur gère tous les comptes de l'organisation.
- **Le filtre, la recherche et le compte ouvert vivent dans l'adresse**, en anglais comme toute adresse (`?filter=mine|shared`, `?q=`, `?connector=<id>`), sur le modèle du journal.

## Écarts avec la référence UI

- Le panneau de partage s'ouvre dans un dialogue au-dessus du tiroir, et non dans un panneau accroché au bouton : le tiroir est déjà un dialogue, étroit, en bas de l'écran sur un téléphone.
- Le détail ne montre ni « Modifier le nom », ni « Tester », ni l'activité (dernière utilisation, nombre d'appels) : hors périmètre, le moteur ne les sert pas.
- La page vide ne propose pas de raccourcis vers des outils nommés : le catalogue arrive avec `ajout-d-un-connecteur.md`.
- Le pied de la liste garde sa première phrase seule.

## Actions JB

- Contrôle visuel de l'écran (les deux thèmes, bureau et téléphone), une fois l'application locale relancée.

## Post-implémentation

- **Livré** : tous les critères d'acceptation. « Ajouter » : la fenêtre s'ouvre ; après la création d'un compte par un administrateur, elle se ferme et le détail du compte s'ouvre ; au retour d'un consentement, la liste montre la ligne et l'annonce nomme le compte, sans ouvrir son détail (le retour ne porte que son libellé : à reprendre avec `ajout-d-un-connecteur.md`).
- **Fichiers en plus de ceux prévus** : `lignes-des-connecteurs.ts` (les lignes, les filtres, le tri et la lecture de l'adresse, calculés par l'écran rendu par le serveur, qui ne peut pas appeler une fonction d'un îlot client), `ui/noeud/champ-d-ajout-d-acces.tsx` (le champ de recherche, commun aux deux panneaux de partage), `ajout-d-un-connecteur.tsx` (la fenêtre, prévue par l'autre story).
- **Fichiers prévus non touchés** : `loading.tsx` (le squelette existant convient).
- **Code mort** : `listOwnAccounts` n'a plus d'appelant dans l'hôte de référence ; il reste exporté.
- **Champ commun** : `ui/noeud/champ-d-ajout-d-acces.tsx` sert le partage d'une page et celui d'un connecteur ; `partage-du-noeud.tsx` le monte, sans changement de geste ni de mot, ses tests inchangés (`tests/integration/components/partager.test.tsx`). La comparaison sans casse ni accent passe par `normalizeTitle` de `schemas/`.
- **Tests** : `tests/unit/lignes-des-connecteurs.test.ts`, `tests/integration/components/ecran-connecteurs.test.tsx` (réécrit), `tests/integration/pages/admin-config-pages.test.tsx`, `tests/integration/partage-des-comptes.test.ts` (un cas sur base réelle). Le retour du focus à la ligne à la fermeture du tiroir tient au `<dialog>` natif : il ne se joue pas sous jsdom, à contrôler à l'œil.
- **Revue** : une revue isolée a demandé six corrections, faites (mots « compte » encore montrés, `normaliser` et `estAMoi` en double, un type exporté sans lecteur, le focus après « Désactiver » et après une gestion perdue, le détail ouvert après une création). Restent signalés, non appliqués : sur un compte d'équipe ou d'organisation en erreur, qui le gère lit « Demandez à qui le gère de le reconnecter » ; « Clé refusée » se dit aussi d'un compte à consentement ; « Son assistant consulte… » se lit aussi sur la ligne de toute l'organisation ; `vue` reste facultative ; la ligne d'un compte désactivé n'atténue que son nom ; `listMembers` est lu à chaque visite ; des types exportés sans lecteur hors de leur fichier.
- **Contrôle visuel** : non fait.
