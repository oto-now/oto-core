# Fonctions d'un hôte : visibilité et index

- **Statut** : validé avec Alexis le 22/11/2026 (décisions de l'issue #153)
- **Dernière révision** : 2026-11-23

## Résumé

L'index des fonctions de l'API d'un hôte ([fonctions d'un hôte](fonctions-d-un-hote.md)) montre à chacun les seules
fonctions que l'hôte lui ouvre, lues à `/me/functions` : `find`, `read functions` et un bloc de 3 000 caractères au plus
dans `context`, déterministe, coupé selon une règle dite. Il sert le routage, jamais la sécurité : `call` n'est pas
filtré, l'hôte décide.

## Contexte

- Un hôte compte jusqu'à 78 fonctions, soit 8 à 9 000 caractères d'index : le quart du plafond de `context`
  (35 000 caractères, [contexte servi](contexte-servi.md)).
- Les rôles déclarés (`x-oto-roles`) ne disent pas tout : la visibilité réelle dépend de droits plus fins que l'hôte seul
  connaît.

## Objectifs et non-objectifs

Objectifs : un index filtré par personne, dans `context` sans en manger le budget ; une liste indisponible dite, jamais
remplacée par tout le catalogue.

Non-objectifs : le filtrage comme garantie de sécurité (l'hôte décide à l'appel) ; aucun outil MCP de plus (ADR-002).

## Conception

**Visibilité par personne** (`server/host-api/visibility.ts`). oto demande à l'hôte les fonctions que la personne peut
appeler : `GET <adresse><x-oto.functions>` (`/me/functions`), par le transport gardé, 10 s, avec les en-têtes `Oto-*`,
sous un jeton de la personne pour l'API obtenu comme celui d'un appel ([jeton](fonctions-d-un-hote-jeton.md) : échange,
sinon consentement, sinon le refus et son lien), mais **sans scope** : la liste ne lit que l'identité, le jeton porte l'audience seule. Réponse
attendue : `200 {"functions": ["<operationId>", …]}`, les noms du document. Un nom que le document servi ne porte pas (un
document plus récent chez l'hôte) est ignoré et compté au log. Les rôles déclarés (`x-oto-roles`) ne filtrent rien : ils
servent l'affichage et la lecture du contrat ; la visibilité réelle dépend de droits plus fins que l'hôte seul connaît.
La liste est gardée en mémoire du processus cinq minutes par (organisation, personne, adresse, version du document) ;
seule une liste lue est gardée. Elle est lue par `context`, `find` et `read functions` (`visibleOrgFunctions`,
`server/catalog/org-catalog.ts`), **jamais par `call`** : une fonction absente de la liste part quand même vers l'hôte, qui
décide, et son refus `problem+json` est relayé ([fonctions d'un hôte](fonctions-d-un-hote.md) § Erreurs). Indisponible (refus de l'hôte, réponse illisible, panne,
consentement à donner, appel sans jeton vérifié), la liste ne montre aucune fonction de l'hôte et l'index le dit :
« Functions of <titre> unavailable: <raison> <p>_call still reaches <titre>, which decides. », raison bornée à
1 000 caractères (le lien d'autorisation entier y tient) ; jamais toutes les fonctions.

**Index** (`server/host-api/index-view.ts`). Deux vues des mêmes fonctions visibles :

- **Bloc de `context`** (`server/context/blocks/host.ts`), « host functions », servi juste après les règles, en
  affichage comme au budget (`PRIORITY.host = 1`, [contexte servi](contexte-servi.md)). Une tête (lire un contrat par
  `read`, l'appeler par `call`, l'index entier par `read {"path": "functions"}`), une ligne par famille dans l'ordre de
  `x-oto.families` (« - <libellé> : <noms servis> », une famille sans fonction visible omise), puis « Closest to the
  request: » et les fonctions les plus proches de la demande, 8 au plus (`searchFunctions` : score, puis nom), avec leur
  `summary`. Aucun bloc sans API servie, ni pour une personne sans fonction visible ; une liste indisponible : sa ligne.
  Le `context` léger (`since_ctx`) ne le sert pas, ni l'aperçu de l'écran « Contexte », qui n'a pas de jeton de la
  personne.
- **Règle de troncature**, déterministe (même document, même liste, même demande, même texte), à 3 000 caractères :
  1. une ligne de famille de plus de 600 caractères garde ses premiers noms entiers et compte les autres (« … and 12
     more ») ;
  2. si le bloc dépasse 3 000 caractères, les fonctions proches partent une à une, la moins proche d'abord ;
  3. puis les familles, la dernière d'abord ;
  4. le bloc coupé finit par « [Index cut to 3,000 characters: N families and M close functions not listed. Read them
     with <p>_read {"path": "functions"}.] » : jamais une coupure muette. Le bloc coupé est rapporté `cut` à l'aperçu.
- **`read functions`** : les fonctions actives de l'instance par connecteur, puis « Functions of <titre> open to you, by
  family: », chaque famille et ses fonctions avec leur classe et leur `summary`, entière ; « No function of <titre> is
  open to you. » pour une liste vide ; la ligne d'indisponibilité sinon. `find` cherche parmi les seules fonctions
  visibles, et ajoute la ligne d'indisponibilité quand la liste manque.

## Décisions et alternatives écartées

- **Filtrer par les rôles déclarés (`x-oto-roles`)** : écarté (réponse 6 de la conception), la visibilité réelle dépend de
  droits plus fins que le rôle, que seul l'hôte connaît ; oto lit `/me/functions`.
- **Filtrer `call` par la liste** : écarté, la liste sert le routage ; le refus de l'hôte à l'exécution reste la seule
  garantie, et il est relayé.
- **Tout montrer quand la liste échoue** : écarté, l'index dit la raison au lieu de tout montrer.
- **Le jeton de la liste au scope de toutes les fonctions** : écarté, la liste ne lit que l'identité ; aucun scope.
- **L'index entier dans `context`** (8 à 9 000 caractères pour 78 fonctions) : écarté (décision du 22/11/2026), le quart
  du plafond à chaque conversation ; un bloc de 3 000 caractères et `read functions`.

## Sécurité et confidentialité

- La liste d'une personne sert le routage, jamais la sécurité : `call` ne la lit pas, l'hôte juge chaque appel. Elle est
  gardée par personne (son identifiant dans la clé), jamais partagée entre deux personnes ; le jeton de la liste n'a aucun
  scope.

## Écart avec le code

- `read {"path": "functions/<famille>"}` (l'index d'une seule famille, réponse 7 de la conception) n'est pas servi :
  `read functions` sert l'index entier, et le bloc de `context` y renvoie. Le chemin `functions/…` n'est pas réservé à
  l'écriture.
- Une personne dont le client tiers n'a pas encore de consentement : sa liste est indisponible, et la ligne
  d'indisponibilité porte le lien d'autorisation de sa demande encore ouverte ([jeton](fonctions-d-un-hote-jeton.md),
  § Sans consentement).
- Un échec de la liste n'est pas gardé : chaque lecture la redemande à l'hôte.

## Questions ouvertes

- La forme de la réponse de `/me/functions` (`{"functions": [operationId…]}`) est fixée par oto ; le premier hôte doit
  la servir telle quelle (le profil de la lib n'en dit rien).

## Historique

- 2026-11-23 : PR 3 du chantier : visibilité par personne (`/me/functions`, sans scope, gardée cinq minutes), filtrage de
  `find`, de `read functions` et de `context`, jamais de `call` ; bloc « host functions » de `context`, 3 000 caractères
  au plus, et sa règle de troncature — décidé par Alexis (source : réponses 6 et 7 de la conception, décisions du 22/11/2026).
- 2026-11-23 : tiré de `fonctions-d-un-hote.md` — décidé par Alexis (source : revue de la PR 3 du chantier, 23/11/2026).
