# Fiche — ui-patterns

Texte complet : `.method/conventions/ui-patterns.md`. La fiche suffit pour écrire ; le texte complet se lit sur un doute, et toujours pour une revue. Chaque règle renvoie à sa section. Sur les écrans du paquet et du groupe `(dashboard)`, les moyens (tokens, composants, import des icônes) sont ceux de `portage-ecrans.md`, qui l'emporte en cas d'écart (`docs/design/system.md`, section Règles).

- Dès Standard, tout changement visible passe par le skill `design` (brief du `designer`, critique du `design-critic`) ; en Micro, une ligne de lecture de design dans le plan. § Lecture de design
- Partir de l'écran réel (captures avant, inventaire), zoom arrière, verdict `ajouter` / `réorganiser l'encart` / `repenser l'écran` ; ce dernier se pose en question. § Intégrer une fonctionnalité
- Seuils qui imposent de réorganiser : deux actions primaires, plus de 5 actions au même niveau, plus de 7 champs sans regroupement, action principale hors du premier écran, donnée dupliquée, seconde liste non justifiée. § Intégrer une fonctionnalité
- L'option la plus petite est toujours évaluée ; intégrer, c'est aussi retirer. § Intégrer une fonctionnalité
- Une tâche, une action primaire, un objet par écran ; ordre de lecture = ordre d'usage ; geste rare ou destructif sur l'objet, jamais au niveau de l'usage courant. § Principes UX
- Seule l'exception se marque ; vocabulaire de l'utilisateur, aucun état interne ni identifiant ; un terme décidé ne se renomme pas sans arbitrage. § Principes UX
- Couleurs par token sémantique seulement, pas de `dark:` sur une couleur, pas de valeur arbitraire. § Design system verrouillé
- Mobile d'abord, collapse déclaré dans le composant, 375 / 768 / 1280, `dvh`, cibles de 44 px, aucune affordance au survol seul ni déplacement au survol. § Responsive
- Réutiliser avant de créer ; card seulement si l'élévation porte une hiérarchie ; hiérarchie par le poids, titre de section jamais en muted. § Composition
- Fiche : un geste principal, les autres groupés, les destructifs à part ; tiroir de l'ordre de 560 px ; une information par ligne ; capacités en lignes repliables ; choix exclusif en contrôle segmenté. § Fiches et gestes sur l'objet
- Chargement, vide, erreur, pending, partiel, plafond et bloqué conçus, avec l'action pour en sortir. § États
- Aucun tiret cadratin ni demi-cadratin visible ; une intention = un libellé ; aucune contradiction ni promesse que le moteur ne tient pas ; accords calculés. § Texte visible
- Icônes Phosphor ; bouton d'action = icône + libellé ; badges d'état d'une forme par état ; pas d'emoji. § Icônes
- Animer `transform` et `opacity` seuls, `prefers-reduced-motion` respecté. § Mouvement
- Aucune signature de gabarit généré (dégradés, eyebrow, cards identiques, faux compteurs) sauf si la direction la nomme. § Signatures IA
- `pnpm ui:shots <routes>` avant la review d'un diff UI, captures citées ; version servie vérifiée ; captures du design copiées dans `.claude/design-shots/<sujet>/`. § Preuve visuelle
