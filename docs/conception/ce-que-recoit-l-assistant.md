# Ce que reçoit l'assistant

- **Statut** : proposé
- **Dernière révision** : 2026-11-25

## Résumé

Cinq couches limitent ce qu'un assistant reçoit des données d'une organisation, de la plus sûre à la plus fragile :
ne pas servir, transformer un champ connu, jeton d'identité stable, dictionnaire des personnes déclarées, modèle de
reconnaissance. Les trois premières tiennent sur la structure des données ; les deux dernières lisent du texte et
peuvent manquer. Un hôte les pose dans cet ordre : liste blanche et jetons à la source, puis dictionnaire, puis modèle.

## Contexte

Un hôte sert à l'assistant des pages, des tableaux et des fonctions de connecteur qui portent des données de personnes.
Plusieurs mécanismes existent ou sont proposés pour en limiter la part qui atteint le modèle ; ils sont décrits chacun à
part, surtout dans [Pseudonymisation](pseudonymisation.md). Ce document en donne la vue d'ensemble : ce que chaque couche
garantit, ce sur quoi elle repose, et l'ordre dans lequel un hôte les met en place. Il ne redit pas le détail.

## Objectifs et non-objectifs

**Objectifs** : nommer les couches, dire laquelle tient sur quoi, distinguer le livré du proposé, donner un ordre de
mise en place à un hôte.

**Non-objectifs** : décrire le fonctionnement de chaque couche (voir les documents cités) ; traiter la sécurité des
secrets de connecteur ([Connecteurs et comptes](connecteurs-et-comptes.md)) ; traiter les droits de lecture entre
personnes d'une organisation ([Outils MCP](outils-mcp.md)).

## Conception

Une couche « tient sur la structure » quand elle s'applique à un champ ou à une fonction nommés d'avance : elle ne
dépend pas de ce que contient le texte et ne peut pas manquer une valeur. Une couche « lit le texte » cherche des
valeurs dans un contenu libre : elle peut manquer une forme inattendue ou masquer à tort.

### 1. Ne pas servir

La donnée n'atteint jamais l'assistant. C'est la seule couche qui ne laisse rien passer, même transformé.

| Moyen | Ce qu'il fait | État |
|---|---|---|
| `serverOnly` (fonction) et `withServerOnly` (fonctions d'un connecteur déclaré) | La fonction est retirée du catalogue de l'assistant ; seul le serveur de l'hôte l'appelle. | livré |
| `registerDataPolicy({ fileContents: "metadata" })` | Par organisation, le contenu des fichiers n'est pas servi : la lecture est refusée avant d'ouvrir le fichier, seules les métadonnées restent. | livré |
| Arguments marqués `personal` | Leur valeur n'est jamais écrite au journal des appels : remplacée par `[personal]`, et retirée de la cible et de l'erreur où un tiers l'aurait recopiée. | livré |
| `withhold` (champ) | Le champ est rendu `[withheld]` : sa présence se voit, son contenu non. | proposé (J2b de [Pseudonymisation](pseudonymisation.md)) |

Une liste blanche des champs servis, classés par sensibilité, est la forme cible de cette couche : ce qui n'est pas
nommé n'est pas servi.

### 2. Transformer un champ connu

Un champ nommé est servi transformé : masqué, haché, généralisé (une année au lieu d'une date, un département au lieu
d'une adresse) ou supprimé, par champ et par organisation. Le principe est l'échec fermé : si la règle ne s'applique pas,
la sortie est retenue plutôt que servie brute.

- Dans ce paquet : `output.entityFields` (livré) remplace les champs d'entité qu'une fonction de l'hôte déclare par le
  jeton de l'entité, pour l'assistant seulement. La généralisation par champ est proposée (J5 de
  [Pseudonymisation](pseudonymisation.md)) ; la suppression passe par `withhold` (couche 1).
- Un filtre de champs par organisation, avec ces quatre actions et l'échec fermé, existe dans la lib de connecteurs
  Python (`FieldFilter`) et dans le serveur d'oto 1. Il n'est pas dans ce paquet.

### 3. Jeton d'identité stable

Une personne est servie sous un jeton opaque et stable, `client#<13 caractères>` : un HMAC de son identifiant sous une
clé propre à l'organisation, sans table de correspondance. Le même jeton revient d'un appel à l'autre, ce qui permet à
l'assistant de raisonner sur la personne sans la connaître. Le jeton se résout par recherche inverse dans le dictionnaire
(couche 4) ; effacer la personne chez l'hôte le rend irrésoluble. Livré ; détail dans
[Pseudonymisation](pseudonymisation.md).

### 4. Dictionnaire des personnes déclarées et formes

L'hôte déclare ses personnes (`registerSensitiveEntities`) ; la porte MCP remplace toute mention de l'une d'elles, dans
le texte, les données, les refus et les prompts, par son jeton. Des détecteurs de formes complètent : courriel et
téléphone (livrés), NIR, IBAN et carte (proposés, J3).

C'est une deuxième ligne, avec ses limites : une personne non déclarée n'est pas reconnue ; un nom seul n'est masqué
que s'il n'est ni un mot courant ni un prénom courant ; une graphie inattendue peut passer. Livré et activable par
organisation.

### 5. Modèle de reconnaissance d'entités

Un modèle cherche, dans un texte libre, les noms et adresses de personnes que personne n'a déclarées. Non construit :
option prévue au J5 de [Pseudonymisation](pseudonymisation.md). Ses faux positifs (un nom commun masqué) et ses faux
négatifs sont à mesurer avant de le proposer.

### En complément

- **Les fichiers** restent hors de l'assistant quand l'organisation choisit `fileContents: "metadata"` (couche 1).
- **Le choix du modèle et de son hébergement** relève de l'organisation : il décide qui, au-delà de l'assistant, voit
  ce qui lui est servi. Le paquet ne le fixe pas.

### Ordre pour un hôte

1. À la source : liste blanche de ce qui est servi (`serverOnly`, `fileContents`, `personal`), et jetons sur les
   champs d'entité de ses propres fonctions (`entityFields`).
2. Ensuite, le dictionnaire de ses personnes, pour les mentions en texte libre.
3. En dernier, et seulement si la mesure le justifie, le modèle de reconnaissance.

## Décisions et alternatives écartées

- **Un seul mécanisme de masquage par le texte** : écarté. Il manque ce qu'il ne reconnaît pas ; les couches
  structurelles passent devant.
- **Une table de correspondance jeton ↔ personne** : écartée au profit du HMAC sous clé d'organisation, qui ne crée
  aucun stock de données à protéger ([Pseudonymisation](pseudonymisation.md)).

## Sécurité et confidentialité

Les couches 1 à 3 tiennent quelle que soit la forme du contenu. Les couches 4 et 5 réduisent le risque sans le
supprimer : un hôte ne doit pas s'en servir pour exposer ce que les couches 1 et 2 pourraient retenir. Le journal des
appels ne garde pas les arguments marqués `personal`.

## Écart avec le code

- Livré : `serverOnly`, `withServerOnly`, `registerDataPolicy` (`fileContents`), arguments `personal`, `entityFields`,
  jetons HMAC, dictionnaire, détecteurs de courriel et de téléphone.
- Proposé, non écrit dans ce paquet : `withhold`, généralisation par champ, filtre de champs par organisation,
  détecteurs de NIR, d'IBAN et de carte, modèle de reconnaissance.

## Questions ouvertes

- Faut-il reprendre dans ce paquet le filtre de champs par organisation (masquer, hacher, généraliser, supprimer), ou
  l'exprimer par `withhold` et la généralisation déjà proposés ?
- Comment mesurer les faux positifs d'un modèle de reconnaissance avant de l'ouvrir aux hôtes ?

## Historique

- 2026-11-25 : première version, proposée.
