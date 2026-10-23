# Exposition des fonctions

- **Statut** : proposé
- **Dernière révision** : 2026-10-23

## Résumé

Les fonctions métier d'un hôte et celles des connecteurs passent déjà par un seul catalogue et un seul chemin d'appel ;
quelques services manquent encore aux premières. Ce document propose un réglage posé à la déclaration, qui choisit
comment chaque fonction est servie : par `call` seulement (l'état présent, le défaut) ou, en plus, comme un outil MCP à
plat. Les outils à plat sont choisis par l'hôte, nommément et en nombre borné. C'est une entorse au gel des six outils
(`outils-mcp.md`), à trancher avec JB. À l'activation d'un connecteur, un message dit ce qui marche tout de suite et ce
qui reste à faire.

## Contexte

- Deux hôtes ERP sortent sous une semaine. Leurs fonctions métier (`registerFunctions`, `defineErpFunction`) sont
  servies, comme celles des connecteurs (`registerConnectors`), par les six outils figés : l'assistant les trouve par
  `find`, `read` ou `context`, puis les appelle par `call`. Aucune n'est un outil MCP à elle seule.
- Demande d'Alexis (point du 23/10/2026 avec JB) : un seul moule pour les deux voies, avec les mêmes services ; une
  exposition choisie à la déclaration (tout par `call`, tout à plat, ou un mélange) ; un message à l'activation, parce
  qu'aujourd'hui on « active et il ne se passe rien, puis il faut configurer à côté ».
- Ce que le banc a mesuré, et qui a fondé le gel (`outils-mcp.md` § Contexte) :
  - les clients figent la liste d'outils et n'appliquent une mise à jour qu'après un geste de l'utilisateur ;
  - `notifications/tools/list_changed` n'est relue que par Claude Code ;
  - une description est lue à sa première phrase (claude.ai), ou coupée à 2 048 caractères (Claude Code) ;
  - le seul levier qui marche partout, 9 fois sur 9, est un champ obligatoire dont la valeur vient d'un de nos
    outils (`ctx`).
  - La dégradation du routage quand les outils se multiplient est affirmée, mais elle n'est pas chiffrée. Aucun client
    ne refuse 504 outils : la limite tient au routage et au coût en contexte (`.method/conventions/mcp-patterns.md`).
- Le dépôt connectors a déjà un bloc `exposure` (`per_action`, `per_connector`, `via_call`). Il ne sert qu'à oto 1 ;
  oto-core l'ignore (`server/connectors/definition.ts`).

## Objectifs et non-objectifs

- **Objectifs :**
  - relever ce qui diffère entre les deux voies, et dire quoi combler ;
  - un réglage d'exposition posé par l'hôte à la déclaration, par fonction ;
  - un outil à plat qui garde tout ce que garde `call` : journal, plafonds, confirmation, pseudonymisation ;
  - un message d'activation qui dit ce qui reste à faire.
- **Non-objectifs :**
  - une exposition choisie par l'organisation ou par l'utilisateur ;
  - pousser `list_changed` (le transport reste sans état, ADR-009) ;
  - toucher aux six outils ou à leurs champs ;
  - renommer les fonctions métier : elles gardent leur nom, `<espace>.<fonction>`, sans paire `_act`.

## Conception

### Un moule, deux voies

Les deux voies partagent déjà le catalogue (`catalogFunctions`, `server/catalog/registry.ts`), la découverte (`find`,
`read`, `context`) et l'exécution (`runCall`, `server/calls.ts`).

| Service | Connecteur | Fonction métier |
|---|---|---|
| Journal d'appel, secrets et `personal` masqués | oui | oui, plus la pseudonymisation (`entityArguments`) |
| Plafond de la réponse (45 000 car.) | oui | oui |
| Retaille de la réponse (`strip`, `sample`) | oui | non : l'hôte compose son texte |
| Validation de l'entrée | Ajv | Zod strict, même point d'appel |
| Classes, `confirm` d'une fonction sensible | oui | oui (`summarize`) |
| Compte, secret, marquage du compte | oui | sans objet : jeton de l'appelant et RLS de l'ERP |
| Activation par organisation | oui | non : toujours active |
| Fichier envoyé, fichier rendu | oui | non |
| Fonction longue (`background`) | oui | non |
| Exemples dans la description de `call` | oui | non |
| `serverOnly` | oui | oui |

Ce qui manque aux fonctions métier ne s'ajoute que sur un besoin d'hôte : fichier rendu, fonction longue. La
retaille reste à l'hôte, qui compose déjà sa réponse. Le seul manque qui touche tous les hôtes est celui des exemples
de `call`, qui taisent les fonctions métier : à combler dans le même lot.

### Le réglage d'exposition

- **Valeurs** : `call` (défaut, l'état présent) ou `tool`. Une fonction en `tool` reste appelable par `call` ; elle
  est en plus listée comme un outil MCP. Le mélange (« tout par `call`, sauf celle-là ») est le cas général, puisque le
  réglage se pose fonction par fonction.
- **Où il se pose** :
  - fonction métier : un champ de `defineErpFunction` (`expose: "tool"`) ;
  - connecteur : une option de `registerConnectors`, une liste de noms servis, sur le modèle de `serverOnly`. Le nom
    d'un connecteur vaut toutes ses fonctions.
  - Le réglage est à l'hôte, pas à la description du connecteur : un hôte choisit ce qu'il montre.
- **Bornes, contrôlées à la déclaration** (`CatalogRegistrationError`, rien n'est déclaré) :
  - au plus N outils à plat par hôte (proposé : 10) ;
  - pas de `tool` sur une fonction `serverOnly` ;
  - un nom d'outil en ASCII, de 64 caractères au plus. Claude Code casse au-delà de 128, et claude.ai retire un nom non
    ASCII sans le dire.
- **L'outil** :
  - nom : `<préfixe>_<espace>_<fonction>`, avec le préfixe d'organisation des six outils ;
  - description : celle de la fonction, dont la première phrase doit suffire ;
  - schéma d'entrée : celui de la fonction, plus `ctx` obligatoire (le levier mesuré) et `confirm` pour une fonction
    sensible.
  - Un appel passe par `runCall`, comme `call` : même journal, même ligne, même refus.
- **La liste** : `tools/list` rend les six outils, puis les outils à plat. Pour une fonction métier, toujours active,
  la liste est la même pour toutes les organisations d'un hôte : elle ne change qu'au déploiement. Pour un connecteur,
  activé par organisation, deux formes sont possibles ; elles sont en question ouverte :
  - la liste suit l'activation, et elle change sans que le client le voie ;
  - la liste est fixe, et un outil d'un connecteur éteint rend le refus de `call` (« … is not enabled … »).

### Le message d'activation

L'activation (écran et MCP admin) rend un message calculé sur l'état réel :

- toujours : « `<c>` est actif : ses fonctions s'appellent tout de suite par `call`. » ;
- si des fonctions sont exposées à plat : « Votre client affichera ses outils au prochain démarrage d'une
  conversation. » Le client ne relit pas sa liste tout de suite ;
- s'il manque un compte ou une clé : ce qui manque, et le lien vers l'écran Connecteurs. C'est la réponse au constat
  « il ne se passe rien ».

### Ce qui change pour le gel des six outils, et ce qui se perd

- **Change** :
  - la liste d'outils n'est plus la même pour tous les hôtes ;
  - le test qui fige le contrat (D8) fige les six outils, et laisse passer les outils déclarés par l'hôte ;
  - « pas d'outil par famille d'objets » devient « pas d'outil que l'hôte n'a pas choisi ».
- **Reste** : les six outils, leurs champs et leur gel ; `ctx` obligatoire partout ; un seul chemin d'exécution.
- **Se perd** :
  - la stabilité de la liste : un outil ajouté ne se voit qu'après un geste de l'utilisateur, sauf sur Claude Code ;
  - une part du routage : plus d'outils, c'est un choix plus difficile pour l'assistant, et sans mesure chiffrée ;
  - le coût en contexte : chaque outil à plat porte sa description et son schéma dans la liste ;
  - la garantie que l'assistant passe par `find` ou `read` avant d'appeler. Il lit alors la description de la
    fonction, mais pas son contrat complet (refus, exemples) ;
  - le contenu sans surface : un outil à plat est une surface. Le renommer, ou changer son sens, casse les clients
    comme casserait un des six.

## Décisions et alternatives écartées

- **Tout à plat par défaut, ou un outil par capacité** : écarté par le banc (`outils-mcp.md` § Alternatives). La liste
  devient longue et changeante, et le routage revient au client.
- **Exposition choisie par l'organisation** : écarté. La liste diffère d'une organisation à l'autre, change au gré des
  administrateurs, et aucun client ne le voit sans geste.
- **Pousser `list_changed`** : écarté. Seul Claude Code le relit, et le transport est sans état (ADR-009).
- **Septième outil générique (`act`)** : déjà écarté par Alexis le 17/10.
- **Réutiliser le bloc `exposure` des descriptions** : écarté. Il décrit les modes d'oto 1, et l'exposition est un
  choix d'hôte, pas une propriété du tiers.

## Sécurité et confidentialité

- Un outil à plat n'ouvre aucun chemin nouveau. Il appelle `runCall` avec les mêmes contrôles : activation, équipe,
  compte, `confirm` d'une fonction sensible, plafonds, journal et masquage.
- `ctx` reste obligatoire : une conversation ne peut appeler un outil à plat sans avoir lu son contexte.
- Une fonction `serverOnly` ne peut pas être exposée : la déclaration la refuse.
- Le nom d'un outil à plat est vu par tout utilisateur de l'hôte, y compris quand la fonction lui est refusée.

## Écart avec le code

Rien n'est réalisé. Les points d'accroche :

- `mcp/tools.ts` : la liste fixe `TOOL_KEYS`, `buildTools`, et `toolKey`, qui refuse tout nom hors des six ;
- `mcp/server.ts` : `SERVICES`, indexée par `ToolKey`, et le handler de `tools/list` ;
- `server/catalog/define.ts` : `CatalogFunction`, qui porte déjà `serverOnly` et `background` ;
- `server/catalog/erp.ts` : `ErpFunctionInput` et `functionProblem` ;
- `server/connectors/declaration.ts` : `ConnectorOptions` ;
- `server/catalog/registry.ts` : `callExamples`, qui ne cite aucune fonction métier ;
- `mcp/admin/tools/connector.ts` et `api/admin/connectors.ts` : le message d'activation.

## Questions ouvertes

- Rouvre-t-on le gel des six outils pour des outils à plat choisis par l'hôte ? À trancher avec JB.
- Le premier lot couvre-t-il les fonctions métier seules (liste stable, besoin des hôtes ERP), ou aussi les
  connecteurs ?
- Quelle borne N par hôte ?
- Pour un connecteur : une liste qui suit l'activation, ou une liste fixe qui refuse ?
- Quels services porter aux fonctions métier, et pour quel hôte : fichier rendu, fonction longue ?

## Historique

- 2026-10-23 : note ouverte, proposée — demande d'Alexis (source : point du 23/10/2026 avec JB).
