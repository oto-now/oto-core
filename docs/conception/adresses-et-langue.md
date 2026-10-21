# Adresses et langue

- **Statut** : validé avec JB le 30/09/2026
- **Dernière révision** : 2026-10-21

## Résumé

Toute adresse est en anglais, quelle que soit la langue de l'écran (ADR-020). Le code est en anglais côté services, les écrans du paquet en français (H05). La langue du profil règle la langue de réponse de l'assistant ; la traduction des écrans, décidée dans son principe et son mécanisme (ADR-015, proposé), n'est pas encore construite.

## Contexte

Consigne du responsable d'Oto (fiche D132) : jamais de français dans une URL. L'hôte de référence et le paquet servaient pourtant des adresses françaises : routes (`/equipes`, `/corbeille`…), préfixe de l'API des écrans (`/api/plateforme/*`), paramètres (`?onglet=`, `?periode=`…), valeurs (`?version=publiee`) et ancres (`#nouveautes`). Le préfixe de l'API des écrans est le contrat de montage entre l'hôte et le paquet (H03, H06, ADR-012, ADR-016, ADR-017, ADR-018) : le changer casse tout hôte.

Côté langue, la langue du profil doit changer l'interface, en français et en anglais au moins (D105). Les écrans vivent dans la face `ui/` du paquet, qui n'importe aucun cadre de l'hôte (ADR-008) : un ERP qui monte le paquet n'a pas forcément `next-intl`, et le paquet ne peut pas lui imposer son routage par langue. `i18n-patterns.md` recommande `next-intl` pour une application ; il ne décrit pas un paquet d'écrans monté par un hôte.

## Objectifs et non-objectifs

- Une seule langue d'adresse pour tous les écrans, stable quand les écrans seront traduits.
- Une règle détectable par `pnpm verify`, pas seulement en revue.
- La langue de réponse de l'assistant suit la personne, puis l'organisation.
- Hors objectif : renommer les chemins des nœuds (`contexte`, `private/<handle>/contexte`), qui sont des données ; un préfixe de langue dans l'adresse ; des alias des anciennes adresses.

## Conception

### Adresses en anglais (ADR-020)

1. **Toute adresse est en anglais** : segments de route, noms et valeurs de paramètres, ancres qu'un lien vise ; orthographe américaine (`/admin/organization`, `/no-organization`). Les textes servis en anglais par le paquet (outils MCP, refus) gardent `organisation` : seule l'adresse suit la règle (ADR-020 § 1). HN-E11S07-1 : une adresse est ce qui s'écrit dans la barre d'adresse ou dans un lien ; un `id` qu'aucun lien ne vise, un identifiant de code, un nom de dossier entre crochets et un chemin de nœud n'en sont pas. HN-E11S07-3 : `organization` pour toute adresse future ; incohérence avec les textes servis assumée.
2. **Contrat de montage** : l'hôte monte l'API des écrans sous `/api/platform/*` (`src/app/api/platform/[...route]/route.ts`). Le paquet lit ce préfixe d'une seule constante, `PLATFORM_API_PREFIX` (`schemas/api.ts`, réexportée par `@otomata_tech/oto_platform/schemas`) : la porte, le client des écrans et les adresses d'API que les services écrivent (dépôt par lien) (ADR-020 § 2, HN-E11S07-10). L'adresse d'un fichier est hors de ce préfixe : `/f/<id>` (`FILE_ADDRESS`, même fichier), montée par `src/app/f/[id]/route.ts`, qui réexporte le `GET` de la porte ([fichiers et stockage](fichiers-et-stockage.md) § Adresse unique).
3. **Sans client, un renommage se fait sans alias ni redirection** : l'ancienne adresse répond 404. La redirection permanente de `seo-patterns.md § Règles SEO` ne vaut que pour une page publique indexée ; une page authentifiée ou `noindex` renommée répond 404 (ADR-020 § 3). Exception, décidée le 21/10 : l'ancienne adresse d'un fichier, `/api/platform/files/<id>`, redirige en permanence (308) vers `/f/<id>`, sans alias, parce qu'elle est écrite dans du contenu (texte des pages, courriels, exports), pas seulement dans des écrans ; elle se retire quand son compteur au log cesse ([fichiers et stockage](fichiers-et-stockage.md) § Adresse unique). HN-E11S07-5 : les trois pages de redirection d'`/admin` et la redirection de `/plateforme/invitations` sont retirées. HN-E11S07-6 : un ancien nom de paramètre est ignoré comme tout paramètre inconnu, sans refus.
4. **`pnpm check:framework` garde la règle** (`scripts/check-framework-invariants.mjs`) : un segment de `src/app` absent de `SEGMENTS_ADMIS` fait échouer le check (hors groupes `(…)`, paramètres `[…]` et dossiers en `.`) ; un ancien nom en position d'adresse est refusé avec le nom qui le remplace, y compris dans `URLSearchParams`, un champ `name=` et la prop `nom=` ; un segment anglais nouveau s'ajoute à la liste, visible en revue (ADR-020 § 4). HN-E11S07-7 : la garde des routes est une liste de segments admis, celle des paramètres une liste d'anciens noms refusés. HN-E11S07-14 : elle refuse aussi les routes retirées (`/admin/acces`, `/admin/marque`, `/admin/drapeaux`) ; elle ne contrôle pas les opérations écrites dans la valeur de `f=` (`f=nom:contient:x`), que `reglagesDepuisLAdresse` écarte à la lecture.

Noms retenus :

- HN-E11S07-2 : `/journal` reste : « journal » est un mot anglais, déjà chemin MCP (`JOURNAL_PATH`) et table `platform.journal` ; `/log` écarté.
- HN-E11S07-4 : un nom nouveau reprend celui que l'API ou le service donne déjà (`trash`, `feedback`, `connectors`, `profile`, `teams`, `sort` de H96, opérateurs de H95) ; `sens` devient `order`. Les ressources de l'API (`nodes`, `teams`, `trash`…) étaient déjà en anglais : seul le préfixe a changé.
- HN-E11S07-8 : `/plateforme` (`PlateformeHome`) se renomme `/platform` ; son retrait serait une décision produit.
- HN-E11S07-11 : ancre `recent-content` pour le bloc servi « recent content » ; aucune ancre pour le bloc `code`, que la vue n'affiche plus ; `procedures` inchangée.
- HN-E11S07-13 : les ancres fixes des Contextes sont `everyone-context` et `private-context` : elles ne commencent pas par `context-`, qu'aucun slug d'équipe (`context-<slug>`) ne peut donc produire.
- HN-E11S07-12 : les écrans retirés (Marque, Drapeaux, Accès plateforme) restent exportés par le paquet (M65) ; leurs tests les montent sous des adresses fictives en anglais (`/admin/brand`, `/admin/flags`, `/admin/access`), qu'aucune route ne sert.

### Langue du code et des écrans

- H05 : les identifiants sont en anglais dans `server/`, `mcp/`, `api/`, `schemas/` et le SQL ; les composants et écrans de `ui/` sont en français.
- Les services restent en anglais (H04) : leurs messages sont traduits par l'écran (`ui/api/messages.ts`) ; le MCP ne change pas avec la langue de la personne.

### Langue de réponse de l'assistant

- D105 : la langue du profil change la langue de réponse de l'assistant ; défaut : la langue de l'organisation (`orgs.brand.language`), puis le français.
- D106 : `context` dit toujours la langue de réponse, français compris ([contexte servi](contexte-servi.md)) ; la couleur de l'organisation est le défaut de tout compte sans choix.

### Traduction des écrans, quand elle viendra (ADR-015, proposé)

1. **Pas de cadre d'i18n dans `ui/`** (D106 : sans `next-intl` dans le paquet). Chaque table de libellés d'un écran (`libelles.ts`, `textes.ts`, `messages.ts`) garde son français comme source et reçoit un jumeau anglais typé (`libelles.en.ts`, `satisfies Catalogue<typeof …>`) : une clé manquante ne compile pas (ADR-015 § 1).
2. **La langue vient de l'hôte** : il la résout (profil, puis organisation, puis français) et la pose, côté client par le contexte de `CoquilleOto`, côté serveur par une valeur de requête (`cache()` de React) ; un composant lit sa table en une ligne (`useLibelles(table)` ou `libelles(table)`) (ADR-015 § 2).
3. **L'adresse ne porte pas la langue** : pas de préfixe `/en/` ; une page s'affiche dans la langue de qui la lit (ADR-015 § 3), et son adresse reste en anglais (ADR-020).
4. **Les services restent en anglais** ; `context` dit à l'assistant la langue de réponse (ADR-015 § 4).
5. **Dates et nombres** passent par `Intl` dans la langue effective (ADR-015 § 5).
6. `src/` (pages de l'hôte hors paquet) suit la même règle pour ses quelques textes (`src/app/(auth)/messages.en.ts`).

## Décisions et alternatives écartées

- **Alias ou redirections des anciennes adresses** : inutiles sans client (fiche D131) ; ils ajouteraient une surface à maintenir et à retirer plus tard. À reconsidérer pour une page publique indexée, que la règle SEO couvre.
- **`/admin/organisation`, orthographe britannique** : aurait gardé l'accord avec les textes servis ; écartée par le responsable d'Oto (HN-E11S07-3).
- **`/log` au lieu de `/journal`** : écarté (HN-E11S07-2).
- **Renommer les littéraux du préfixe d'API en place** : écarté au profit d'une constante (HN-E11S07-10).
- **Amender ADR-015 au lieu d'un nouvel ADR** : écarté (HN-E11S07-9) ; ADR-015 reste « Proposé » pour la version qui traduira les écrans.
- **`next-intl` dans le paquet** : `ui/` dépendrait du cadre de l'hôte et de son routage (ADR-008), un ERP devrait l'installer. Rejetée.
- **Fichiers JSON par langue** : une clé manquante ne se voit qu'à l'exécution ; les tables TypeScript existent déjà par écran. Rejetée.
- **Traduction des écrans en V1** : sortie de la V1 par JB (D105, lot g d'E05-S11, HN-E05S11-26) ; en V1, la langue du profil se range et règle la langue de réponse, les écrans restent en français.

## Sécurité et confidentialité

Rien de propre à ce sujet : une ancienne adresse répond 404 sans rien révéler. Une invitation envoyée avant le passage aux adresses anglaises mène à une 404, et la liste des adresses de retour de Supabase Auth porte `/auth/confirm` ([identité et connexion](identite-et-connexion.md)).

## Écart avec le code

- **Traduction des écrans non construite** (ADR-015 proposé) : chaque texte en dur d'un écran doit rejoindre sa table (61 composants recensés par le lot g d'E05-S11) ; pas de pluriels ICU ni d'outil de traduction externe, un pluriel s'écrit en fonction dans la table. Lignes de faits et de connecteurs du Contexte encore en anglais à l'écran (M73).
- Le passage aux adresses anglaises a été cassant pour tout hôte (version 1.1.0, D131) : dossiers de routes renommés, route de l'API déplacée, exclusion d'en-têtes des routes HTML (ADR-017) réécrite, `/auth/confirm` ajouté aux adresses de retour ; un lien de fichier ou de dépôt donné à un assistant avant la version ne répond plus.
- Retrait des écrans Marque, Drapeaux et Accès plateforme et de leurs clés d'adresse (M65).

## Questions ouvertes

Aucune à ce jour.

## Historique

- 2026-09-28 : la langue du profil change la langue de réponse de l'assistant ; traduction des écrans hors V1, par des tables typées sans cadre d'i18n — décidé par JB (source : fiches D105, D106 ; ADR-015, proposé).
- 2026-09-29 : `/journal` gardé, orthographe américaine des adresses, préfixe d'API en une constante — décidé par le responsable d'Oto (source : story E11-S07, HN-E11S07-2, HN-E11S07-3, HN-E11S07-10 ; fiche D132).
- 2026-09-30 : toute adresse en anglais, API des écrans sous `/api/platform/*`, renommage sans alias, garde par `pnpm check:framework` — décidé par le responsable d'Oto, accepté (source : ADR-020, fiche D132).
- 2026-10-01 : refonte en document de conception vivant, qui reprend ADR-020, ADR-015, les fiches D105 et D106, H05 et les choix d'E11-S07 — décidé par Alexis, accord de JB.
- 2026-10-21 : l'adresse d'un fichier, `/f/<id>`, hors du préfixe de l'API ; son ancienne adresse redirige en permanence, exception à la règle des renommages — décidé par Alexis (source : étape 2 du chantier « fichier », [fichiers et stockage](fichiers-et-stockage.md))
