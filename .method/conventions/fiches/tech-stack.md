# Fiche — tech-stack

Texte complet : `.method/conventions/tech-stack.md`. La fiche suffit pour écrire ; le texte complet se lit sur un doute, et toujours pour une revue. Chaque règle renvoie à sa section.

- TypeScript reste épinglé en 5.8.x : les versions 5.9 et suivantes figent `tsc --noEmit`. § Stack Technique
- Le script `lint` ne porte pas `--cache` (ou sa clé contient une empreinte de la liste des fichiers) : la frontière `ui/` ↔ `server/` se juge sur d'autres fichiers. § Stack Technique
- Les schémas de `packages/plateforme/schemas/` et tout schéma que le MCP compose s'écrivent en `zod/v4` : un schéma v3 ne s'imbrique pas dans un objet v4. § Stack Technique · § Canal MCP (si le produit expose un serveur MCP)
- `@hookform/resolvers` 5 (seul à lire `zod/v4`) demande React Hook Form 7.55 au moins. § Stack Technique
- postgres.js en 3.4.9 exacte, `prepare: false` pour le pooler en mode transaction ; nodemailer 10.0.0 au moins. § Stack Technique
- mermaid en 11.17.2 exacte, chargé à la demande dans le navigateur seulement (`import()` dans un effet client), `securityLevel: "strict"`. § Stack Technique
- La borne basse de chaque peer du paquet satisfait les `peerDependencies` des autres peers ; toute plage modifiée passe par `pnpm install`. § Stack Technique
- Une dépendance du paquet que `tests/` importe est aussi en `devDependencies` de la racine, à la même version exacte. § Canal MCP (si le produit expose un serveur MCP)
- SDK MCP 1.32.1 et `mcp-handler` 1.1.0 exacts, sans état ; la JWKS se lit au premier jeton, jamais à l'import. § Canal MCP (si le produit expose un serveur MCP)
- Le widget routeur se construit par Vite et `vite-plugin-singlefile`, en `devDependencies` du paquet, dans `mcp/widgets/generated.ts`, jamais commité, avant `type-check` (s'il manque), `build` et `npm pack`, et chez l'hôte qui a des vues de l'ERP par `oto-platform widgets build`, ces outils y étant des dépendances paires facultatives ; le protocole MCP Apps passe par le SDK `ext-apps` (`app-with-deps`), jamais réimplémenté. § Canal MCP (si le produit expose un serveur MCP)
