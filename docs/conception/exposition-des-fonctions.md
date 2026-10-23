# Exposition des fonctions

- **Statut** : validé avec Alexis le 23/10/2026 (principe et modes) ; la forme reste à revoir avec JB
- **Dernière révision** : 2026-10-23

## Résumé

Les fonctions métier d'un hôte et celles des connecteurs passent déjà par un seul catalogue et un seul chemin d'appel ;
quelques services manquent encore aux premières. L'hôte choisit à la déclaration comment chaque connecteur est servi :
par `call` seulement (le défaut), par un outil MCP pour le connecteur, ou par un outil par fonction. Il fixe un mode
pour tous et peut le forcer connecteur par connecteur, sans borne de nombre. À l'activation d'un connecteur, un message
dit ce qui marche tout de suite et ce qui reste à faire.

## Contexte

- Deux hôtes ERP sortent sous une semaine. Leurs fonctions métier (`registerFunctions`, `defineErpFunction`) sont
  servies, comme celles des connecteurs (`registerConnectors`), par les six outils figés : l'assistant les trouve par
  `find`, `read` ou `context`, puis les appelle par `call`. Aucune n'est un outil MCP à elle seule.
- Demande d'Alexis (point du 23/10/2026 avec JB) : un seul moule pour les deux voies, avec les mêmes services ; une
  exposition choisie à la déclaration ; un message à l'activation, parce qu'aujourd'hui on « active et il ne se passe
  rien, puis il faut configurer à côté ».
- Ce que le banc a mesuré, et qui a fondé le gel (`outils-mcp.md` § Contexte) :
  - les clients figent la liste d'outils et n'appliquent une mise à jour qu'après un geste de l'utilisateur ;
  - `notifications/tools/list_changed` n'est relue que par Claude Code ;
  - une description est lue à sa première phrase (claude.ai), ou coupée à 2 048 caractères (Claude Code) ;
  - le seul levier qui marche partout, 9 fois sur 9, est un champ obligatoire dont la valeur vient d'un de nos
    outils (`ctx`).
  - La dégradation du routage quand les outils se multiplient est affirmée, mais elle n'est pas chiffrée. Aucun client
    ne refuse 504 outils : la limite tient au routage et au coût en contexte (`.method/conventions/mcp-patterns.md`).
- Oto 1 sert déjà ses connecteurs selon trois modes : `via_call`, `per_connector` et `per_action`. Le dépôt connectors
  les décrit dans un bloc `exposure`, qu'oto-core ignore aujourd'hui (`server/connectors/definition.ts`).

## Objectifs et non-objectifs

- **Objectifs :**
  - relever ce qui diffère entre les deux voies, et dire quoi combler ;
  - trois modes d'exposition, choisis par l'hôte à la déclaration : un défaut, et un choix forcé par connecteur ;
  - un outil exposé qui garde tout ce que garde `call` : journal, plafonds, confirmation, pseudonymisation ;
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
de `call`, qui taisent les fonctions métier : à combler dans le même lot. Pour l'exposition, l'espace d'une fonction
métier (`<espace>.<fonction>`) tient lieu de connecteur.

### Les trois modes

| Mode | Ce que voit l'assistant | Outil |
|---|---|---|
| `call` (défaut) | les six outils, rien de plus | aucun : `find`, `read`, puis `call` |
| `connector` | un outil par connecteur | `<préfixe>_<connecteur>`, la fonction en paramètre |
| `function` | un outil par fonction | `<préfixe>_<connecteur>_<fonction>` |

- **Où il se pose** : une option de `registerConnectors` et de `registerFunctions`. Elle porte un mode par défaut,
  `call` si l'hôte ne dit rien, et une table des connecteurs ou espaces dont le mode est forcé :
  `{ default: "call", connectors: { crm: "function", agenda: "connector" } }`.
- **Aucune borne de nombre** (décidé par Alexis). La déclaration ne refuse qu'un mode inconnu, un connecteur non
  déclaré, ou un nom d'outil hors des règles des clients : ASCII et 64 caractères au plus, puisque Claude Code casse
  au-delà de 128 et que claude.ai retire un nom non ASCII sans le dire.
- **Les fonctions `serverOnly`** ne sont jamais exposées, quel que soit le mode.
- **Un outil exposé :**
  - en `function`, la description est celle de la fonction, dont la première phrase doit suffire. Le schéma d'entrée
    est celui de la fonction, plus `ctx` obligatoire (le levier mesuré) et `confirm` pour une fonction sensible ;
  - en `connector`, la description liste les fonctions du connecteur, une ligne chacune. Le schéma d'entrée est
    `{ ctx, function, arguments, confirm? }`, et les arguments se lisent par `read` comme pour `call` ;
  - dans les deux cas, l'appel passe par `runCall`, comme `call` : même journal, même ligne, même refus. La fonction
    reste appelable par `call`.
- **La liste** : `tools/list` rend les six outils, puis les outils exposés des connecteurs actifs dans l'organisation,
  et ceux des espaces métier, toujours actifs. Elle suit donc l'activation, sans que le client le voie tout de suite :
  c'est ce que dit le message d'activation.

### Le message d'activation

L'activation (écran et MCP admin) rend un message calculé sur l'état réel :

- toujours : « `<c>` est actif : ses fonctions s'appellent tout de suite par `call`. » ;
- si le connecteur est exposé en `connector` ou en `function` : « Votre client Claude mettra un moment à afficher ses
  outils : au prochain démarrage d'une conversation. » ;
- s'il manque un compte ou une clé : ce qui manque, et le lien vers l'écran Connecteurs. C'est la réponse au constat
  « il ne se passe rien ».

### Ce qui change pour le gel des six outils, et ce qui se perd

- **Ne change pas, en mode `call`** : c'est le défaut, et un hôte qui ne dit rien garde exactement les six outils.
- **Change, dès qu'un hôte expose** :
  - la liste d'outils n'est plus la même pour tous les hôtes, ni pour toutes les organisations d'un hôte ;
  - le test qui fige le contrat (D8) fige les six outils, et laisse passer les outils exposés ;
  - « pas d'outil par famille d'objets » devient « pas d'outil que l'hôte n'a pas choisi ».
- **Reste** : les six outils, leurs champs et leur gel ; `ctx` obligatoire partout ; un seul chemin d'exécution.
- **Se perd, pour un hôte qui expose** :
  - la stabilité de la liste : un outil ajouté à l'activation ne se voit qu'après un geste, sauf sur Claude Code ;
  - une part du routage : plus d'outils, c'est un choix plus difficile pour l'assistant, et sans mesure chiffrée ;
  - le coût en contexte : chaque outil porte sa description et son schéma dans la liste ;
  - la garantie que l'assistant lit le contrat complet (refus, exemples) par `read` avant d'appeler ;
  - le contenu sans surface : un outil exposé est une surface. Le renommer, ou changer son sens, casse les clients.

## Décisions et alternatives écartées

- **Des outils à plat choisis un par un par l'hôte, en nombre borné** : proposé le 23/10 dans la première version de
  cette note, et écarté par Alexis le même jour au profit des trois modes par connecteur, sans borne.
- **Exposition choisie par l'organisation** : écarté. Elle ferait varier la liste au gré des administrateurs, et
  aucun client ne le voit sans geste.
- **Pousser `list_changed`** : écarté. Seul Claude Code le relit, et le transport est sans état (ADR-009).
- **Septième outil générique (`act`)** : déjà écarté par Alexis le 17/10.

## Sécurité et confidentialité

- Un outil exposé n'ouvre aucun chemin nouveau. Il appelle `runCall` avec les mêmes contrôles : activation, équipe,
  compte, `confirm` d'une fonction sensible, plafonds, journal et masquage.
- `ctx` reste obligatoire : une conversation ne peut appeler un outil exposé sans avoir lu son contexte.
- Une fonction `serverOnly` n'est jamais exposée.
- Le nom d'un outil exposé est vu par tout utilisateur de l'organisation, y compris quand la fonction lui est refusée.

## Écart avec le code

Rien n'est réalisé. Les points d'accroche :

- `mcp/tools.ts` : la liste fixe `TOOL_KEYS`, `buildTools`, et `toolKey`, qui refuse tout nom hors des six ;
- `mcp/server.ts` : `SERVICES`, indexée par `ToolKey`, et le handler de `tools/list` ;
- `server/catalog/define.ts` : `CatalogFunction`, qui porte déjà `serverOnly` et `background` ;
- `server/catalog/erp.ts` : `registerFunctions` et ses options ;
- `server/connectors/declaration.ts` : `ConnectorOptions` ;
- `server/catalog/registry.ts` : `callExamples`, qui ne cite aucune fonction métier ;
- `mcp/admin/tools/connector.ts` et `api/admin/connectors.ts` : le message d'activation.

## Questions ouvertes

- La forme de l'option, les noms des modes et la forme de l'outil en mode `connector` : à revoir avec JB.
- Une description de connecteur peut-elle imposer son mode (le bloc `exposure` existant) ? Ou bien le choix
  reste-t-il seulement à l'hôte ?
- Quels services porter aux fonctions métier, et pour quel hôte : fichier rendu, fonction longue ?

## Historique

- 2026-10-23 : note ouverte, proposée — demande d'Alexis (source : point du 23/10/2026 avec JB).
- 2026-10-23 : trois modes (`call` par défaut, `connector`, `function`), un défaut et un choix forcé par connecteur,
  connecteurs et fonctions métier, sans borne de nombre ; la liste suit l'activation — décidé par Alexis (source :
  réponse à la note).
