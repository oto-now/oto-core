# Checklist de review — transverse uniquement

<!--
  Lue par le skill revue, APRÈS le chargement des conventions routées par globs.

  RÈGLE DE MAINTENANCE : ce fichier ne contient QUE ce qui n'appartient à aucune convention.
  Sécurité, tests, Next.js, Supabase, performance, a11y, naming, types → ces règles vivent
  dans `.method/conventions/` et sont confrontées au code directement. Les recopier ici
  créerait une seconde source de vérité qui divergerait. Ne pas le faire.
-->

## Périmètre du diff

- [ ] Chaque fichier modifié trace à la demande (story, bug rapporté, demande utilisateur)
- [ ] Aucun cleanup adjacent, reformatage opportuniste ou refacto non demandé
- [ ] Le diff ne contient pas de changement de comportement non demandé
- [ ] (si refacto) Les tests sont **identiques** avant/après — un test modifié = un comportement modifié = ce n'est plus un refacto
- [ ] (si bugfix) Un test reproduit le bug et échouait avant le fix

## Hygiène

- [ ] Pas de `console.log` / `debugger` oublié
- [ ] Pas de TODO / FIXME / HACK sans explication ni ticket
- [ ] Pas de code mort ajouté (fonction, import, variable, prop non utilisée)
- [ ] Aucun fichier sensible dans le diff (`.env`, credentials, clés, dumps)
- [ ] Pas de dépendance ajoutée sans nécessité (vérifier `package.json` dans le diff) — sa justification relève de § Arbitrage de complexité

## Arbitrage de complexité

Point de contrôle de `CLAUDE.md § Justifier une surface nouvelle` — ne pas y redire la règle.

- [ ] Chaque surface nouvelle du diff (fichier, composant, hook, util, abstraction, prop optionnelle, option de config, table, colonne, flag, dépendance) porte, dans le récap ou le rapport de review, **ce qui casse sans elle aujourd'hui**
- [ ] Aucune surface justifiée au futur (« on pourrait vouloir », « pour rester générique », « ce sera utile quand ») — une telle surface est **à retirer**, pas à documenter
- [ ] (hors Micro) Le récap **nomme l'option d'un cran plus simple écartée** et la raison de l'écarter. Une seule solution présentée = aucun arbitrage rendu
- [ ] (paquet) Chaque nom ajouté à l'`index.ts` d'une face (`ui`, `schemas`, `server`, `api`, `mcp`) a un consommateur hors de son module, test mis à part (`rg -w <nom> packages src scripts`), ou figure dans les exports que la story exige ; sinon il reste interne
- [ ] (dès Standard) Chaque module partagé que le diff crée (classes, type, adaptateur, util, lecture de service) a sa ligne dans « Doublons » du rayon d'impact, trouvée en cherchant son **contenu** (chaîne de classes, forme du type ; côté `server/`, les colonnes du `select` et la table lue) dans chaque face touchée et dans l'hôte, pas son nom ; une copie dans le fichier d'une autre story y porte son verdict, et son refacto est posé en question

## Conformité à la demande

- [ ] (mode story) Tous les AC de la story sont couverts par le code livré
- [ ] (mode story) Tous les tests listés dans « Tests attendus » existent
- [ ] Les tests restent dans le budget du minimum vital : aucun test qui ne prouve ni un AC, ni la sécurité, ni le contrat, ni un invariant de base ; la revue ne réclame aucune permutation de plus sans nommer la faille qu'elle révélerait (`conventions/testing-strategy.md § Budget de tests`)
- [ ] (mode libre) Ce qui est livré correspond à ce qui a été demandé — ni moins, ni plus
- [ ] Les hypothèses prises face à une ambiguïté sont explicitées à l'utilisateur, ou, en travail autonome, écrites avec leur source dans la story ou le récap (`CLAUDE.md § Avant de coder`)
- [ ] Chaque chiffre de mesure que le diff écrit (commentaire, story, ADR, changelog) nomme la sortie d'où il vient (test, rapport, fichier de résultats) et s'y relit à l'identique ; un chiffre qu'aucune sortie ne porte est retiré ou marqué hypothèse : un décompte fait de mémoire arrondit dans le sens de la décision qu'il justifie
- [ ] Aucune régression que le diff introduit n'est laissée en « dette » dans le rapport ou la post-implémentation : elle est corrigée, ou écrite en hypothèse sourcée avec sa mesure, et posée en question à l'utilisateur si l'expérience d'un client change
- [ ] Un défaut de sécurité que la revue affirme nomme le chemin de la valeur jusqu'à sa source : où elle entre, et les gardes qu'elle traverse en amont (vérification du jeton, filtrage des claims, service appelant), relues dans le code ; sans ce chemin relu, c'est une question posée à l'auteur, pas un défaut, car une garde en amont rend souvent le point sans objet
- [ ] Chaque service du diff décide ses droits et pose ses filtres avant la requête, par `server/access.ts`, et un test où la base rend des lignes interdites le prouve ; aucun refus ni aucun filtre ne repose sur la seule RLS, et « aucune ligne rendue » n'est pas lu comme un refus (`conventions/security-patterns.md § Droits dans le service`)
- [ ] (si référence UI fournie) L'écart avec la référence est documenté — **si `N/A`, ne pas pénaliser l'absence de maquette**

## Documentation de méthode

- [ ] `docs/changelog.md` mis à jour
- [ ] `.method/conventions/component-registry.md` mis à jour si nouveau composant réutilisable
- [ ] (mode story) Section « Post-implémentation » de la story remplie
- [ ] Document de conception du sujet mis à jour dans `docs/conception/` si un invariant d'architecture a été touché
- [ ] Si une règle a dû être inventée pendant l'implémentation → elle est écrite dans la convention concernée **et annoncée** (fichier, section, règle en une phrase), pas laissée implicite
