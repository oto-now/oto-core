# Story — Ajouter un connecteur : choisir, connecter, nommer

## Meta

| Champ | Valeur |
|-------|--------|
| **Épic** | Écrans de la plateforme (V2) : écran Connecteurs et traduction |
| **Parcours** | 4.5 Administrer |
| **Statut** | ⬜ Draft — le mainteneur du moteur a répondu le 2026-11-12 (§ Dépendances du moteur) ; à repasser par la Definition of Ready quand son premier lot (points 1 à 4) est fusionné et que ses formes sont connues |
| **Priorité** | Must (V2) |
| **Référence UI** | Maquette « Oto · Connecteurs, refonte UX » du responsable du produit, écrans 5 à 7 (choisir l'outil, coller la clé, les trois autres façons de se connecter), décrits en texte dans § Référence UI ci-dessous |
| **Conventions** | portage, a11y, forms, security, state, api, database, registry, testing |
| **Estimation** | L |
| **Porteuse de migration** | à confirmer : la description d'un compte et son renommage en demandent une, côté moteur |
| **Dépend de** | `ecran-connecteurs.md` ; les évolutions du moteur de § Dépendances du moteur |

## Contexte

Aujourd'hui, seul un administrateur active un connecteur, puis crée ses comptes, pour l'organisation ou pour une
équipe. Un membre ne peut que connecter son propre compte à un service à consentement. Le catalogue est une liste de
noms techniques, sans recherche, et rien ne dit où trouver une clé ni si elle fonctionne avant le premier appel d'un
assistant.

Décision du responsable du produit du 2026-11-12 : **tout membre ajoute un connecteur, pour lui, privé par défaut**,
et le partage ensuite s'il le veut. L'activation par organisation cesse d'être une étape visible.

**Périmètre**
- La fenêtre « Ajouter un connecteur » : recherche, catégories, une phrase par outil.
- Quatre façons de se connecter sous une même ossature : une clé à coller, une connexion en un clic (consentement),
  un compte rattaché fourni par l'hôte, l'application de l'entreprise.
- Le test de la connexion dès la saisie, et le bouton « Tester » du détail, pour les connecteurs qui ont une sonde.
- Le nom et la description d'un connecteur, à la création et ensuite.
- Les états « Fonctionne » et « Non testé », qui remplacent « Actif ».

**Hors périmètre**
- Les niveaux lecture ou complet choisis au consentement : le moteur garde leur déclaration sans l'appliquer ; à
  reprendre avec leur lot.
- Les quotas et le coût d'un connecteur fourni par l'hôte : lot de comptage du moteur.
- Un connecteur HTTP générique : non servi.
- Les logos des outils : la carte montre une initiale ; à reprendre quand la description d'un connecteur portera le
  domaine de son éditeur.

**Refs :**
- PRD : FR-ADMIN-04 (parcours 4.5 Administrer)
- Conception : `docs/conception/connecteurs-et-comptes.md` (§ Catalogue et activation, § Comptes et résolution,
  § Comptes à plusieurs champs et réglages, § Consentement d'une personne, § Compte de l'hôte et compte rattaché,
  § Moteur des connecteurs décrits pour la sonde), `docs/conception/offres-de-l-hote.md` (plafonds)
- Format des descriptions : `connectors : docs/conception/format-de-description.md`,
  `connectors : docs/conception/concevoir-un-connecteur.md`

## Dépendances du moteur

La story ne passe à Ready qu'une fois ces points tranchés par le mainteneur du moteur. Chacun dit ce que l'écran en
attend.

**Réponses du mainteneur du moteur, le 2026-11-12.** Les points bloquants sont tranchés ; le moteur les livre en un
premier lot, avec une seule migration.

- **1, d'accord autrement** : un membre crée son compte personnel à clé ; la création du premier compte active le
  connecteur pour l'organisation ; un connecteur désactivé par un administrateur reste fermé, et le refus nomme les
  administrateurs. Un compte personnel ne se crée que là où la description du connecteur l'admet (`byo_user`), sinon
  un refus nommé. Le catalogue et les formulaires sont servis à tout membre.
- **2, d'accord, sans alias** : une description de 200 caractères au plus, une route pour modifier le libellé et la
  description, réservée à qui gère le compte. Un ancien libellé n'est pas redirigé. Une procédure ne nomme pas un
  compte dans un bloc d'appel : l'écran n'a rien à compter avant un renommage. La description est servie à l'assistant
  comme une donnée citée.
- **3, d'accord** : `POST admin/accounts/<id>/probe` rend l'issue, sa raison et le solde ; la date et l'issue du
  dernier test sont gardées sur le compte. Une sonde à blanc, `POST admin/connectors/<nom>/probe`, reçoit la clé et
  les réglages sans rien écrire, limitée en débit : c'est elle que joue le test à la saisie. Sans sonde, l'écran dit
  « test non disponible pour cet outil ».
- **4, d'accord** : le libellé devient unique par propriétaire.
- **5, d'accord autrement, second lot** : un bloc typé dans la description du connecteur, vérifié par la fabrique ;
  textes d'écran en français dans la description ; facultatif pendant la transition, quinze connecteurs d'abord.
- **6, non** : le refus au clic suffit. Les critères « Sur demande » et « Demander l'accès » tombent.
- **7, d'accord autrement, second lot** : pour un connecteur qui agit comme un service, le compte personnel d'un
  autre, partagé, sert sans être nommé s'il est le seul de son rang, le dernier ; pour un connecteur qui agit comme
  une personne, il ne sert que nommé. Le pied du panneau de partage suivra cette règle.
- **En plus** : un service de réactivation d'un compte désactivé, réservé à qui le gère ; la confirmation peut
  proposer de poser une nouvelle clé. Le dernier usage et le nombre d'appels viennent plus tard.

| # | Évolution | Ce que l'écran en attend | Sans elle |
|---|---|---|---|
| 1 | Un membre crée un compte personnel à clé ; l'activation n'est plus une étape | « Ajouter » ouvert à tous, sans étape d'administrateur | bloquant |
| 2 | Renommer un compte ; une description servie à l'assistant | les champs « Nom » et « Description », « Modifier le nom » | bloquant |
| 3 | Une route pour la sonde, et le dernier test gardé sur le compte | le test à la saisie, « Tester », l'état « Fonctionne » | bloquant |
| 4 | Le libellé d'un compte : unique par propriétaire, ou nom proposé qui porte la personne | deux membres ont chacun leur connecteur du même outil | bloquant |
| 5 | Les métadonnées de catalogue dans la description d'un connecteur : phrase, catégorie, aide à la clé, pièges, aide par champ, textes en français | les cartes, les filtres, « Où trouver ma clé ? », « Bon à savoir » | l'écran sort avec le libellé seul, sans catégorie ni aide |
| 6 | La disponibilité d'un connecteur pour l'organisation, connue avant le clic | « Demander l'accès » au lieu d'un refus après le clic | le refus actuel reste |
| 7 | Un compte personnel partagé sert-il sans être nommé ? | la phrase du panneau de partage | la phrase actuelle reste |

## Référence UI

5. **Choisir l'outil.** Fenêtre « Ajouter un connecteur » : un champ de recherche, des pastilles de catégorie, une
   grille de cartes. Une carte porte l'initiale de l'outil, son nom et une phrase sur ce que l'assistant saura faire.
   **Elle ne dit pas comment on s'y connecte** (ni « clé », ni « jeton ») : retour du responsable du produit. Pied :
   « Ces connecteurs servent votre assistant à travers Oto, dans toutes vos conversations. Ils n'apparaissent pas dans
   les réglages de votre assistant. » et « Demander un connecteur ».
6. **Coller la clé.** Retour « Tous les outils ». À gauche : le champ de la clé, l'issue du test sous le champ, « Nom »,
   « Description (facultatif) ». À droite : « Où trouver ma clé ? » en trois étapes et un lien vers l'éditeur, puis
   « Bon à savoir ». Pied : « Privé : vous seul pourrez l'utiliser. Vous le partagerez ensuite si vous voulez. »,
   « Annuler », « Ajouter ».
7. **Les trois autres façons.** Connexion en un clic : un bouton vers le service, puis retour ; le connecteur prend le
   nom du compte connecté. Fourni par l'hôte : aucune clé, « Relier mon compte » ; si l'organisation n'y a pas droit,
   « Demander l'accès ». Application de l'entreprise : les champs de la définition, un guide à transmettre à
   l'administrateur du service, et les avertissements de la description.

## Critères d'acceptation

Écrits pour la cible ; ceux qui dépendent d'une évolution du moteur la nomment par son numéro.

### Choisir

- [ ] **Given** un membre **When** il choisit « Ajouter un connecteur » **Then** la fenêtre liste chaque connecteur
  déclaré par l'hôte et ouvert à l'organisation, par ordre alphabétique (1)
- [ ] **Given** la recherche **When** il saisit un texte **Then** les cartes se réduisent à celles dont le nom ou la
  phrase le contient, sans casse ni accent ; aucune réponse : « Aucun outil ne correspond. » et « Demander un
  connecteur »
- [ ] **Given** des catégories déclarées **When** il choisit une pastille **Then** seules ses cartes restent ; sans
  catégorie déclarée, les pastilles ne s'affichent pas (5)
- [ ] **Given** une carte **When** elle s'affiche **Then** elle porte le nom et la phrase du connecteur, jamais son mode
  de connexion (5)

### Connecter par une clé

- [ ] **Given** un connecteur à clé **When** il le choisit **Then** le formulaire montre ses champs et ses réglages,
  chaque champ secret en saisie masquée, avec l'aide de sa description quand elle existe (5)
- [ ] **Given** un connecteur qui a une sonde **When** tous les champs requis sont saisis **Then** l'écran teste la
  connexion et l'annonce sous le champ : « Connexion réussie. », ou la raison du refus ; le test ne part ni à chaque
  frappe ni sans champ requis (3)
- [ ] **Given** un test en échec **When** il choisit « Ajouter » **Then** l'écran demande confirmation : « Ajouter
  quand même ? » ; le connecteur naît alors à l'état « Clé refusée » ou « À terminer » (3)
- [ ] **Given** un connecteur sans sonde **When** le formulaire s'affiche **Then** il dit « Pas de test automatique pour
  cet outil : essayez-le dans votre assistant. », et aucun test ne part
- [ ] **Given** le champ « Nom » **When** le formulaire s'ouvre **Then** il est prérempli d'un nom libre dans
  l'organisation ; un nom déjà pris est refusé sous le champ (`conflict`), sans rien révéler du compte qui le porte (4)
- [ ] **Given** « Ajouter » **When** il valide **Then** le compte est créé personnel, à son nom, privé ; la fenêtre se
  ferme, la ligne apparaît dans la liste et son détail s'ouvre (1)
- [ ] **Given** un refus à la création (`forbidden` d'un plafond, `invalid_arguments`, `conflict`) **When** il arrive
  **Then** il s'affiche dans la fenêtre, la saisie gardée, la clé non réaffichée
- [ ] **Given** la saisie d'une clé **When** elle part **Then** elle ne va qu'à la route du secret, de même origine ;
  ni un journal, ni un texte rendu, ni l'adresse de la page ne la portent

### Connecter autrement

- [ ] **Given** un connecteur à consentement dont l'hôte a fourni l'application **When** il le choisit **Then** un
  bouton l'envoie chez le service, et au retour la ligne du compte apparaît, nommée par le compte connecté ; un échec
  du retour s'annonce avec sa raison, comme aujourd'hui
- [ ] **Given** un connecteur à consentement sans application de l'hôte, ou un connecteur de l'hôte fermé à
  l'organisation **When** la fenêtre s'affiche **Then** sa carte dit « Sur demande » et son bouton est « Demander
  l'accès » (6)
- [ ] **Given** un connecteur à compte rattaché ouvert à l'organisation **When** il le choisit **Then** l'écran dit
  qu'aucune clé n'est à saisir et propose « Relier mon compte »
- [ ] **Given** un connecteur dont la description porte des avertissements **When** son formulaire s'affiche **Then**
  ils sont montrés avant le bouton « Ajouter » (5)

### Nommer et décrire

- [ ] **Given** qui gère un connecteur **When** il choisit « Modifier le nom » dans le détail **Then** il change le nom
  et la description ; un nom pris est refusé (`conflict`) (2)
- [ ] **Given** un connecteur avec une description **When** la liste s'affiche **Then** la description remplace le nom
  de l'outil en seconde ligne (2)
- [ ] **Given** un nom cité par une procédure **When** il est modifié **Then** l'écran applique la règle arrêtée avec
  le mainteneur du moteur : prévenir avant de valider, ou garder l'ancien nom comme alias (2)

### Tester

- [ ] **Given** un connecteur qui a une sonde **When** qui le gère choisit « Tester » dans le détail **Then** l'état
  devient « Fonctionne », avec la date du test et le solde quand la sonde le lit, ou l'état que le refus désigne (3)
- [ ] **Given** un connecteur sans sonde **When** le détail s'affiche **Then** « Tester » est absent, l'état est « Non
  testé » et le détail propose de copier une demande à coller dans l'assistant
- [ ] **Given** une personne qui ne gère pas le compte **When** le détail s'affiche **Then** « Tester » est absent

### Administrateur

- [ ] **Given** un administrateur **When** il ouvre l'écran **Then** il n'a plus d'étape d'activation à faire avant
  qu'un membre ajoute un connecteur ; l'îlot « Outils de l'organisation » dit quels connecteurs sont ouverts et permet
  d'en fermer un (1)

## Implémentation

Les chemins du moteur seront fixés quand ses évolutions seront arrêtées. Ceux de l'écran :

### Fichiers à créer

`ui/`
- `packages/plateforme/ui/admin/connecteurs/ajout-d-un-connecteur.tsx` — la fenêtre et ses deux temps
- `packages/plateforme/ui/admin/connecteurs/catalogue-des-connecteurs.tsx` — recherche, catégories, cartes
- `packages/plateforme/ui/admin/connecteurs/test-de-connexion.tsx` — l'appel de la sonde et son annonce

### Fichiers à modifier

`ui/`
- `packages/plateforme/ui/admin/connecteurs/creation-de-compte.tsx` — remplacé par la fenêtre d'ajout
- `packages/plateforme/ui/admin/connecteurs/champs-du-compte.tsx` — l'aide par champ
- `packages/plateforme/ui/admin/connecteurs/connexion-par-consentement.tsx` — monté dans la fenêtre
- `packages/plateforme/ui/admin/connecteurs/detail-du-connecteur.tsx` — « Tester », « Modifier le nom »
- `packages/plateforme/ui/admin/connecteurs/etat-du-compte.ts` — « Fonctionne », « Non testé »

`api/`, `schemas/`, `server/`, `migrations/` : selon les réponses du mainteneur du moteur (routes de la sonde et de la
modification d'un compte, formulaire servi enrichi, colonne de description).

Hôte
- `src/app/(dashboard)/admin/connectors/page.tsx` — le catalogue servi à tout membre

**Migrations prévues** : à confirmer avec le moteur (description d'un compte, droit d'écrire son libellé, dernier
test), additives.

**Schémas Zod partagés** : `createAccountSchema` et `ConnectorAccountForm` (`schemas/connectors.ts`), à étendre.

### Patterns à suivre

- `.method/conventions/portage-ecrans.md`
- `.method/conventions/component-registry.md` : `Dialog`, `ListTools`, `InputAffix`, `EmptyState`
- `.method/conventions/security-patterns.md § Droits dans le service`

## Rayon d'impact

À compléter quand les formes du moteur sont arrêtées. Relevé du 2026-11-12 :

### Appelants

- Le refus d'un compte personnel par la route — `rg -l "PERSONAL_REFUSED|created by its owner" packages src tests
  scripts` → 6 fichiers : `api/admin/accounts.ts`, `mcp/admin/inputs.ts`, `mcp/admin/tools/connector.ts`,
  `schemas/admin.ts`, `tests/unit/admin-refs.test.ts`, `tests/unit/mcp-admin-connectors.test.ts` : le MCP admin porte
  le même refus, à trancher avec la route
- `CreationDeCompte` — `rg -l "creation-de-compte|CreationDeCompte" packages src tests scripts` → 2 fichiers de `ui/`
- `activateConnector` — `rg -l "activateConnector" packages src tests scripts` → 14 fichiers, dont le MCP admin, deux
  migrations et les tests des capacités de l'hôte (`tests/integration/e12s02-capacites.test.ts`) : le plafond
  `connectors_max` compte les activations
- L'unicité du libellé — `rg -l "uq_accounts_org_id_label|LIBELLE_PRIS" packages src tests scripts` → 3 fichiers : la
  migration de base, `creation-de-compte.tsx`, `ui/admin/textes.ts`
- `probeAccount` — `rg -l "probeAccount" packages src tests scripts` → exporté, appelé par les seuls tests : aucune
  route à adapter, une à créer

### Doublons

- La recherche d'une liste : `ListTools` et `CommandPalette` existent. Verdict : réutiliser `ListTools`
- Le formulaire des champs d'un compte : `champs-du-compte.tsx`. Verdict : réutiliser, l'étendre de l'aide par champ

### Effet produit

- Le MCP admin (`create_account`, `activate`) : son contrat suit ce que le moteur décide pour la création et
  l'activation
- Les capacités de l'hôte (`connectors_max`, plafond par propriétaire) : à redéfinir si l'activation devient implicite
- `context` : la description d'un compte y est servie à l'assistant
- Les procédures qui nomment un compte par son libellé : touchées par le renommage

### Refacto

- Aucun proposé à ce stade.

## Tests attendus

### Unit tests
- [ ] Filtre du catalogue par texte et par catégorie
- [ ] Déclenchement du test : ni à chaque frappe, ni sans champ requis

### Integration tests
- [ ] Composants : un membre ajoute un connecteur à clé de bout en bout (routes appelées, corps, la clé jamais
  réaffichée) ; test en échec puis « Ajouter quand même » ; nom pris ; connecteur sans sonde ; carte « Sur demande »
- [ ] Sur une vraie base, données jetables : la création d'un compte personnel par un membre ; deux membres et le même
  outil ; un compte renommé reste résolu par un appel
- [ ] MCP par `InMemoryTransport` si `admin_connector` change

### Contrôle visuel
- [ ] Les deux thèmes, largeur de bureau et de téléphone : la fenêtre à ses deux temps, les trois autres façons

## Actions JB

- Obtenir les réponses du mainteneur du moteur sur les sept points de § Dépendances du moteur.
- Pour un connecteur à consentement : l'application OAuth de l'hôte chez l'éditeur (service extérieur, vrai secret).

## Post-implémentation

À remplir.
