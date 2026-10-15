# Conception

Les documents de conception vivants d'oto-pkg : pour chaque sujet, **comment** c'est construit et
**pourquoi**, avec les alternatives écartées. Ils remplacent depuis le 2026-10-01 les ADR
(`docs/decisions/ADR-*.md`), le document d'architecture, la fiche des décisions de JB et le
registre des choix (`hypotheses.md`) : tout leur contenu est repris ici, décision par décision, et
les identifiants que le code cite se retrouvent par une recherche. Ce qui se consulte (tables,
fonctions SQL, services, routes, golden queries) est dans [`../reference/`](../reference/).

**Pour un agent qui code dans ce dépôt** : lire le document du sujet avant toute modification qui
touche un invariant, le modèle de données, la surface MCP ou les droits. Une demande qui contredit
un document se signale ; elle ne s'implémente pas en silence.

## Règle de vie

La forme et les règles sont dans `CLAUDE.md § Documents de conception vivants` ; le gabarit,
`.method/templates/conception.tmpl.md`. En bref :

- un document par sujet, qui répond à une question avec laquelle le lecteur arrive ; une décision
  proche d'un sujet existant enrichit son document ; un sujet nouveau s'ajoute à la table
  ci-dessous dans le même commit ;
- le corps décrit l'état présent et se corrige en place ; une option abandonnée passe dans
  « Décisions et alternatives écartées », avec sa raison ;
- une fois validé, chaque révision de fond ajoute une ligne datée à l'historique ;
- « Écart avec le code » se tient à jour avec le code, dans le même commit ;
- une question qui attend une décision vit en issue, assignée à qui tranche.

« Proposé » : écrit d'après les choix du projet, sans ADR accepté derrière ; il guide le code mais
peut encore changer. « Validé avec JB » : repris d'au moins un ADR accepté par JB, à la date dite.

## Les documents

### Le socle

| Document | La question à laquelle il répond | Statut |
|---|---|---|
| [Vue d'ensemble](vue-d-ensemble.md) | Comment la plateforme est-elle découpée, par quelles portes y entre-t-on, et qu'est-ce qui ne change pas sans décision ? | validé avec JB le 23/09/2026 |
| [Distribution du paquet](distribution-du-paquet.md) | Comment le paquet est-il publié, versionné, et mis à jour chez un hôte ? | validé avec JB le 23/09/2026 |
| [Base et portabilité](base-et-portabilite.md) | De quoi le paquet a-t-il besoin chez l'hôte (une base Postgres, un émetteur), et où se décident les droits en base ? | validé avec JB le 24/09/2026 |
| [Identité et connexion](identite-et-connexion.md) | Comment une personne et un assistant prouvent-ils qui ils sont, et dans quelle organisation entrent-ils ? | validé avec JB le 23/09/2026 |
| [Droits d'accès](droits-d-acces.md) | Qui lit, écrit et gère quoi, et comment ces droits se posent et se retirent ? | validé avec JB le 27/09/2026 |
| [Offres de l'hôte](offres-de-l-hote.md) | Que décide le paquet, et que fournit l'hôte, quand l'hôte vend des offres : inscription libre et capacités par organisation ? | validé avec JB le 01/10/2026 |
| [Adresses et langue](adresses-et-langue.md) | En quelle langue sont les adresses, les écrans et les réponses de l'assistant ? | validé avec JB le 30/09/2026 |

### Les assistants

| Document | La question à laquelle il répond | Statut |
|---|---|---|
| [Outils MCP](outils-mcp.md) | Quels outils un assistant voit-il, et comment chaque appel est-il gardé, tracé et rendu ? | validé avec JB le 23/09/2026 |
| [Contexte servi](contexte-servi.md) | Que reçoit l'assistant à l'ouverture d'une conversation (`context`, `ctx`), et quand doit-il le relire ? | validé avec JB le 23/09/2026 |
| [Routage et recherche](routage-et-recherche.md) | Comment une demande trouve-t-elle la procédure ou le contenu qui y répond ? | validé avec JB le 23/09/2026 |
| [Procédures](procedures.md) | Qu'est-ce qu'une procédure, comment s'écrit-elle, se contrôle-t-elle et se sert-elle ? | proposé |
| [Connecteurs et comptes](connecteurs-et-comptes.md) | Comment un appel de fonction atteint-il un service tiers, sous quel compte et avec quel secret ? | validé avec JB le 30/09/2026 |

### Le contenu

| Document | La question à laquelle il répond | Statut |
|---|---|---|
| [Nœuds et arbre](noeuds-et-arbre.md) | Comment le contenu est-il rangé, adressé, publié et retiré ? | validé avec JB le 24/09/2026 |
| [Pages et blocs](pages-et-blocs.md) | De quoi une page est-elle faite, et comment le markdown y entre et en sort ? | validé avec JB le 24/09/2026 |
| [Lecture et écriture des pages](lecture-et-ecriture-des-pages.md) | Comment un assistant lit-il et modifie-t-il une page ? | validé avec JB le 24/09/2026 |
| [Tableaux](tableaux.md) | Comment un tableau est-il décrit, lu, écrit, importé et exporté ? | proposé |
| [File de travail et revue](file-de-travail-et-revue.md) | Comment des assistants se partagent-ils les lignes d'un tableau, et comment une valeur est-elle prouvée et revue ? | proposé |
| [Fichiers et stockage](fichiers-et-stockage.md) | Où vivent les octets d'un fichier joint, et comment se déposent-ils, se copient-ils et se purgent-ils ? | validé avec JB le 28/09/2026 |
| [Dépôt par lien](depot-par-lien.md) | Comment un assistant dépose-t-il un fichier sans le faire passer par la conversation ? | validé avec JB le 28/09/2026 |
| [Contenu HTML isolé et lecture des fichiers](contenu-html-isole.md) | Comment voit-on un fichier HTML, `.md` ou PDF sans exposer l'hôte, et comment un assistant en lit-il le texte ? | validé avec JB le 30/09/2026 |
| [Lecture des fichiers par un assistant](lecture-des-fichiers.md) | Que voit un assistant d'un fichier joint, et comment en lit-il le contenu, quel qu'en soit le format ? | validé avec Alexis le 15/10/2026 |
| [Partage public](partage-public.md) | Comment un contenu s'ouvre-t-il à qui n'a pas de compte, et que montre son lien ? | validé avec JB le 27/09/2026 |
| [Transfert d'une arborescence](transfert-d-arborescence.md) | Comment une base, un dossier ou des procédures passent-ils d'une plateforme Oto à une autre, ou d'un dossier de `.md` à une plateforme ? | proposé |

### Les écrans

| Document | La question à laquelle il répond | Statut |
|---|---|---|
| [Écrans et coque](ecrans-et-coque.md) | D'où viennent les écrans du paquet, et comment l'hôte les monte-t-il sous une seule coque (rail, accueil, brancher un assistant) ? | validé avec JB le 23/09/2026 |
| [Écrans d'un contenu](ecrans-d-un-contenu.md) | Que montre l'écran d'une page, d'une procédure ou d'un tableau, et quels gestes offre-t-il ? | proposé |
| [Éditeur de blocs](editeur-de-blocs.md) | Comment une personne édite-t-elle les blocs d'une page à l'écran ? | proposé |

### L'exploitation

| Document | La question à laquelle il répond | Statut |
|---|---|---|
| [Administration et cellule](administration-et-cellule.md) | Comment l'équipe plateforme administre-t-elle une cellule et ses organisations (MCP admin, tableau de bord, drapeaux, marque, sous-domaines, export-import) ? | proposé |
| [Journal et retours](journal-et-retours.md) | Qu'est-ce qui est tracé de chaque appel, qui le lit, et comment un assistant signale-t-il un problème ? | proposé |
| [Tests et données de démonstration](tests-et-donnees-de-demo.md) | Comment le paquet se teste-t-il, et d'où viennent les données de démonstration ? | proposé |

## Les anciennes ADR

Le code et l'historique citent encore les ADR par leur numéro (et leurs paragraphes, « ADR-016 § 6 ») ;
chaque document garde ces repères à côté de la décision qu'ils portent.

| ADR | Décision | Document |
|---|---|---|
| ADR-001 | Un paquet npm installé dans une application Next : une application, un domaine | [Vue d'ensemble](vue-d-ensemble.md) |
| ADR-002 | Six outils figés, code `ctx` exigé partout, préfixe par requête, même contenu en texte et en structuré | [Outils MCP](outils-mcp.md), [Contexte servi](contexte-servi.md) (§ 2 et § 7 : contexte servi) |
| ADR-003 | Routage lexical côté serveur, sans IA, sans entité « projet » | [Routage et recherche](routage-et-recherche.md) |
| ADR-004 | Organisation par l'adresse, appartenance revérifiée, OAuth 2.1 auprès de l'émetteur de l'hôte | [Identité et connexion](identite-et-connexion.md) |
| ADR-005 | Hébergement (aucun fichier conservé ; reconstitué d'après ses citations) | [Base et portabilité](base-et-portabilite.md) |
| ADR-006 | SQL du paquet dans `platform`, additif ; mises à jour par version et pull request Renovate | [Distribution du paquet](distribution-du-paquet.md) |
| ADR-007 | Connecteurs par un service sans état, dans un autre dépôt (§ 1, § 2, § 4 remplacés) | [Connecteurs et comptes](connecteurs-et-comptes.md) |
| ADR-008 | Écrans copiés d'`oto-frontend`, sans routeur imposé, sous une seule coque | [Écrans et coque](ecrans-et-coque.md) |
| ADR-009 | Transport MCP sans état ; texte seul dans la conversation | [Outils MCP](outils-mcp.md) |
| ADR-010 | Distribution du paquet : npm public, dépôt open source | [Distribution du paquet](distribution-du-paquet.md) |
| ADR-011 | Le contenu en nœuds typés et en blocs ; une ligne de tableau est un bloc | [Nœuds et arbre](noeuds-et-arbre.md), [Pages et blocs](pages-et-blocs.md), [Lecture et écriture des pages](lecture-et-ecriture-des-pages.md) (§ 1, § 3, § 6 : nœuds ; § 2 : blocs ; § 4, § 5, § 7 : lecture et écriture) |
| ADR-012 | Ports d'identité et de base ; droits décidés dans le service ; Supabase hôte par défaut | [Base et portabilité](base-et-portabilite.md) |
| ADR-013 | Partage public d'un contenu par lien | [Partage public](partage-public.md) |
| ADR-014 | L'organisation entière, sujet d'une règle d'accès | [Droits d'accès](droits-d-acces.md) |
| ADR-015 | La langue des écrans, sans cadre d'i18n (proposé) | [Adresses et langue](adresses-et-langue.md) |
| ADR-016 | Les fichiers derrière un port de stockage d'objets compatible S3 | [Fichiers et stockage](fichiers-et-stockage.md) |
| ADR-017 | Un fichier HTML se voit isolé, sur une origine opaque | [Contenu HTML isolé et lecture des fichiers](contenu-html-isole.md) |
| ADR-018 | Un ticket d'envoi à usage unique écrit au nom d'une personne, sans session | [Dépôt par lien](depot-par-lien.md) |
| ADR-019 | Les connecteurs en TypeScript dans le paquet (amendée le 2026-09-30 : connecteurs partagés par `oto-connectors`, propres à l'hôte au contrat `defineFunction`) | [Connecteurs et comptes](connecteurs-et-comptes.md) |
| ADR-020 | Les adresses sont en anglais | [Adresses et langue](adresses-et-langue.md) |
| ADR-021 | Éditeur visuel par bloc (reporté) et sélection de blocs | [Éditeur de blocs](editeur-de-blocs.md) |
| ADR-022 | Capacités par organisation : le paquet décide les refus, l'hôte fournit les valeurs | [Offres de l'hôte](offres-de-l-hote.md) |
| ADR-023 | Inscription libre, si l'hôte l'active | [Offres de l'hôte](offres-de-l-hote.md) |

## Anciens identifiants → document

Les fiches de décision (`D…`, `fiche-decisions.md`), les choix du projet (`H…`, `P…`) et les choix
de story (`N…`, `NH…`, `HN-…`, `hypotheses.md`) sont repris dans le document de leur sujet, chacun
sous son identifiant. Un `N` ou un `NH` se répète d'une story à l'autre : il s'écrit avec sa story
devant (`E01-S04 N4`). Un document qui cite l'identifiant d'un autre y renvoie sans recopier son texte.


### Fiches de décision de JB (`D…`)

| Identifiants | Document |
|---|---|
| D1, D3, D11, D13, D14, D27, D54, D77, D79, D93 | [Identité et connexion](identite-et-connexion.md) |
| D2, D4, D5, D17, D18, D20, D94, D101, D127, D128 | [Droits d'accès](droits-d-acces.md) |
| D7, D99, D100, D133 | [File de travail et revue](file-de-travail-et-revue.md) |
| D8 | [Outils MCP](outils-mcp.md) |
| D9, D43 | [Routage et recherche](routage-et-recherche.md) |
| D10, D28, D66, D80 | [Base et portabilité](base-et-portabilite.md) |
| D15, D16, D90, D136, D139 | [Écrans et coque](ecrans-et-coque.md) |
| D19, D89, D110, D125, D135 | [Nœuds et arbre](noeuds-et-arbre.md) |
| D21, D107, D116, D142 à D144, D151, D152 | [Éditeur de blocs](editeur-de-blocs.md) |
| D24, D126 | [Administration et cellule](administration-et-cellule.md) |
| D33, D76 | [Tests et données de démonstration](tests-et-donnees-de-demo.md) |
| D38, D44, D52, D138 | [Journal et retours](journal-et-retours.md) |
| D42, D108, D129 | [Connecteurs et comptes](connecteurs-et-comptes.md) |
| D49, D120, D132, D150 | [Tableaux](tableaux.md) |
| D69, D96, D102, D121, D124, D131, D145 | [Distribution du paquet](distribution-du-paquet.md) |
| D97, D140 | [Écrans d'un contenu](ecrans-d-un-contenu.md) |
| D103 | [Partage public](partage-public.md) |
| D104 | [Procédures](procedures.md) |
| D105, D106 | [Adresses et langue](adresses-et-langue.md) |
| D109, D134 | [Contexte servi](contexte-servi.md) |
| D111, D114, D115, D122, D141 | [Pages et blocs](pages-et-blocs.md) |
| D112, D119, D137 | [Contenu HTML isolé et lecture des fichiers](contenu-html-isole.md) |
| D113, D118, D148, D149 | [Fichiers et stockage](fichiers-et-stockage.md) |
| D117, D130, D146, D147 | [Dépôt par lien](depot-par-lien.md) |
| D153 | [Lecture et écriture des pages](lecture-et-ecriture-des-pages.md) |

### Choix du projet (`H…`)

| Identifiants | Document |
|---|---|
| H01, H124 | [Distribution du paquet](distribution-du-paquet.md) |
| H02 à H04, H06 | [Vue d'ensemble](vue-d-ensemble.md) |
| H05 | [Adresses et langue](adresses-et-langue.md) |
| H07, H74 | [Journal et retours](journal-et-retours.md) |
| H10 à H13, H16 à H18, H20 | [Identité et connexion](identite-et-connexion.md) |
| H21 à H23, H25, H26, H29 | [Outils MCP](outils-mcp.md) |
| H27, H28, H30 à H32, H34 à H36 | [Contexte servi](contexte-servi.md) |
| H37, H40, H43, H44 | [Routage et recherche](routage-et-recherche.md) |
| H50 à H52, H58, H61 | [Nœuds et arbre](noeuds-et-arbre.md) |
| H54, H57 | [Lecture et écriture des pages](lecture-et-ecriture-des-pages.md) |
| H56 | [Pages et blocs](pages-et-blocs.md) |
| H59, H60, H62 | [Procédures](procedures.md) |
| H63, H65 à H73, H82 | [Droits d'accès](droits-d-acces.md) |
| H80, H81, H83 à H87, H108 | [Connecteurs et comptes](connecteurs-et-comptes.md) |
| H90 à H94, H96, H97, H100 | [Tableaux](tableaux.md) |
| H95, H98, H99 | [File de travail et revue](file-de-travail-et-revue.md) |
| H105 à H107, H110 à H112 | [Administration et cellule](administration-et-cellule.md) |
| H120 à H122 | [Tests et données de démonstration](tests-et-donnees-de-demo.md) |
| H123 | [Base et portabilité](base-et-portabilite.md) |

### Choix entre deux stories (`P…`)

| Identifiants | Document |
|---|---|
| P10 | [File de travail et revue](file-de-travail-et-revue.md) |
| P12, P13, P22, P39 | [Nœuds et arbre](noeuds-et-arbre.md) |
| P14, P28 | [Tests et données de démonstration](tests-et-donnees-de-demo.md) |
| P16 | [Écrans et coque](ecrans-et-coque.md) |
| P17, P27 | [Droits d'accès](droits-d-acces.md) |
| P18 | [Écrans d'un contenu](ecrans-d-un-contenu.md) |
| P19, P37, P38 | [Procédures](procedures.md) |
| P24 | [Tableaux](tableaux.md) |
| P29 | [Administration et cellule](administration-et-cellule.md) |
| P36 | [Vue d'ensemble](vue-d-ensemble.md) |

### Questions ouvertes de JB (`Q…`)

| Identifiants | Document |
|---|---|
| Q1, Q2 | [Contexte servi](contexte-servi.md) |
| Q3, Q4 | [Écrans et coque](ecrans-et-coque.md) |

### Choix de story (`N…`, `NH…`, `HN-…`) et stories livrées

Une story livrée est retirée du dépôt ; ce qui devait durer, ses choix compris, est dans le document
de son sujet. Une story qu'on trouve dans plusieurs documents y est répartie, chaque choix dans un seul.

| Story | Document |
|---|---|
| E01-S04 | [Droits d'accès](droits-d-acces.md) |
| E01-S05 | [Tests et données de démonstration](tests-et-donnees-de-demo.md) |
| E01-S06 | [Pages et blocs](pages-et-blocs.md) |
| E01-S07 | [Droits d'accès](droits-d-acces.md) |
| E01-S08 | [Base et portabilité](base-et-portabilite.md) |
| E01-S09 | [Base et portabilité](base-et-portabilite.md) |
| E01-S10 | [Base et portabilité](base-et-portabilite.md) |
| E01-S11 | [Identité et connexion](identite-et-connexion.md) |
| E01-S12 | [Base et portabilité](base-et-portabilite.md), [Distribution du paquet](distribution-du-paquet.md) |
| E01-S13 | [Routage et recherche](routage-et-recherche.md) |
| E02-S01 | [Identité et connexion](identite-et-connexion.md) |
| E02-S02 | [Identité et connexion](identite-et-connexion.md) |
| E02-S04 | [Identité et connexion](identite-et-connexion.md) |
| E03-S01 | [Contexte servi](contexte-servi.md), [Outils MCP](outils-mcp.md) |
| E03-S02 | [Routage et recherche](routage-et-recherche.md) |
| E03-S03 | [Lecture et écriture des pages](lecture-et-ecriture-des-pages.md) |
| E03-S04 | [Connecteurs et comptes](connecteurs-et-comptes.md) |
| E03-S05 | [Journal et retours](journal-et-retours.md) |
| E03-S06 | [Procédures](procedures.md) |
| E03-S07 | [Nœuds et arbre](noeuds-et-arbre.md) |
| E03-S08 | [Contexte servi](contexte-servi.md) |
| E04-S01 | [Connecteurs et comptes](connecteurs-et-comptes.md) |
| E05-S02 | [Éditeur de blocs](editeur-de-blocs.md) |
| E05-S03 | [Droits d'accès](droits-d-acces.md) |
| E05-S04 | [Procédures](procedures.md) |
| E05-S05 | [Journal et retours](journal-et-retours.md) |
| E05-S07 | [Écrans et coque](ecrans-et-coque.md) |
| E05-S08 | [Éditeur de blocs](editeur-de-blocs.md) |
| E05-S09 | [Écrans d'un contenu](ecrans-d-un-contenu.md), [Écrans et coque](ecrans-et-coque.md) |
| E05-S10 | [Écrans d'un contenu](ecrans-d-un-contenu.md) |
| E05-S11 | [Écrans et coque](ecrans-et-coque.md) |
| E05-S12 | [Contexte servi](contexte-servi.md) |
| E05-S13 | [Droits d'accès](droits-d-acces.md), [journal et retours](journal-et-retours.md) |
| E06-S01 | [File de travail et revue](file-de-travail-et-revue.md) |
| E07-S01 | [Tableaux](tableaux.md) |
| E07-S02 | [File de travail et revue](file-de-travail-et-revue.md), [Tableaux](tableaux.md) |
| E07-S03 | [File de travail et revue](file-de-travail-et-revue.md) |
| E07-S04 | [Tableaux](tableaux.md) |
| E08-S02 | [Administration et cellule](administration-et-cellule.md) |
| E08-S03 | [Administration et cellule](administration-et-cellule.md) |
| E08-S04 | [Administration et cellule](administration-et-cellule.md) |
| E08-S05 | [Connecteurs et comptes](connecteurs-et-comptes.md) |
| E08-S06 | [Administration et cellule](administration-et-cellule.md) |
| E08-S09 | [Journal et retours](journal-et-retours.md) |
| E09-S02 | [Administration et cellule](administration-et-cellule.md) |
| E09-S03 | [Identité et connexion](identite-et-connexion.md) |
| E09-S04 | [Administration et cellule](administration-et-cellule.md) |
| E09-S05 | [Droits d'accès](droits-d-acces.md) |
| E10-S01 | [Tableaux](tableaux.md) |
| E10-S02 | [Contenu HTML isolé et lecture des fichiers](contenu-html-isole.md), [Dépôt par lien](depot-par-lien.md), [Fichiers et stockage](fichiers-et-stockage.md) |
| E10-S04 | [Pages et blocs](pages-et-blocs.md) |
| E10-S06 | [Éditeur de blocs](editeur-de-blocs.md) |
| E11-S01 | [File de travail et revue](file-de-travail-et-revue.md), [Tableaux](tableaux.md) |
| E11-S02 | [Lecture et écriture des pages](lecture-et-ecriture-des-pages.md), [Nœuds et arbre](noeuds-et-arbre.md) |
| E11-S03 | [Contexte servi](contexte-servi.md), [Outils MCP](outils-mcp.md) |
| E11-S04 | [Routage et recherche](routage-et-recherche.md) |
| E11-S05 | [Écrans d'un contenu](ecrans-d-un-contenu.md) |
| E11-S06 | [Éditeur de blocs](editeur-de-blocs.md) |
| E11-S07 | [Adresses et langue](adresses-et-langue.md) |
| E11-S09 | [Écrans et coque](ecrans-et-coque.md) |
| E11-S10 | [Écrans et coque](ecrans-et-coque.md) |
| E11-S14 | [Tests et données de démonstration](tests-et-donnees-de-demo.md) |
| E11-S15 | [Écrans d'un contenu](ecrans-d-un-contenu.md) |
| E11-S16 | [Contexte servi](contexte-servi.md), [Routage et recherche](routage-et-recherche.md), [Éditeur de blocs](editeur-de-blocs.md) |
| E11-S17 | [Éditeur de blocs](editeur-de-blocs.md) |
| E11-S18 | [Lecture et écriture des pages](lecture-et-ecriture-des-pages.md) |
| E11-S19 | [Contexte servi](contexte-servi.md), [Outils MCP](outils-mcp.md) |
| E11-S20 | [Écrans et coque](ecrans-et-coque.md) |
| E11-S21 | [Partage public](partage-public.md) |
| E12-S01 | [Offres de l'hôte](offres-de-l-hote.md) |
| E12-S02 | [Offres de l'hôte](offres-de-l-hote.md) |

### Choix des tâches de suite et de version

| Identifiants | Document |
|---|---|
| H-cellule-saas | [Administration et cellule](administration-et-cellule.md) |
| HN-M37b-3, HN-M53-10, HN-M53-5, HN-M54-5 | [File de travail et revue](file-de-travail-et-revue.md) |
| HN-M08-5 | [Identité et connexion](identite-et-connexion.md) |
| H-M68, HN-M38-1 | [Nœuds et arbre](noeuds-et-arbre.md) |
| H-M67, HN-M113-1, HN-M113-2, HN-M113-3, HN-M113-4 | [Pages et blocs](pages-et-blocs.md) |
| HN-M59-1, HN-M59-3 | [Procédures](procedures.md) |

### Repères du code sans fiche

Quelques repères cités par des commentaires du code n'ont jamais eu de ligne au registre ; leur sens,
lu dans ces commentaires, est le suivant.

| Repère | Sens | Document |
|---|---|---|
| D67 | Fiche retirée avant la refonte : la licence nomme son titulaire, légitimement (`scripts/check-public.mjs`) | [Distribution du paquet](distribution-du-paquet.md) |
| P1 | `zod/v4` pour tout `schemas/` (décision du pilote) ; dans `schemas/table-write.ts`, une cellule écrite avec sa preuve `{ value, comment \| link }` | [Vue d'ensemble](vue-d-ensemble.md) (H02), [file de travail et revue](file-de-travail-et-revue.md) (D100) |
| P2, P3, P4 | Points de la tâche M54 (file de revue) : choisir ou passer une fiche (P2), la preuve de chaque valeur (P3), la raison d'un refus rendue à l'assistant (P4) ; dans `server/feedback.ts`, P3 désigne aussi le numéro de ticket par organisation (`FB-0001`) | [File de travail et revue](file-de-travail-et-revue.md), [journal et retours](journal-et-retours.md) |
| P5 | Défaut d'une campagne de test : procédures rangées dans l'espace « Privé » (M55), conditions de l'hôte à l'inscription | [Procédures](procedures.md), [offres de l'hôte](offres-de-l-hote.md) |
| P6 | La signature du client MCP (`host`) portée par la ligne d'ancrage d'un code admin et par chaque ligne d'`admin_journal` | [Administration et cellule](administration-et-cellule.md), [journal et retours](journal-et-retours.md) |
| HN-E05S13-1 à HN-E05S13-20, HN-M-3 | Hypothèses de la story E05-S13 (HN-E05S13-2, HN-E05S13-3, HN-E05S13-4, HN-E05S13-5, HN-E05S13-6, HN-E05S13-7, HN-E05S13-8, HN-E05S13-9, HN-E05S13-10, HN-E05S13-12, HN-E05S13-13, HN-E05S13-15, HN-E05S13-16, HN-E05S13-19 sont citées par le code) et d'une tâche, sans définition conservée avant la refonte ; la famille est décrite par la ligne `HN-E05S13` | [Droits d'accès](droits-d-acces.md) |

