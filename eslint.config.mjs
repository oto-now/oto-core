import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";
import importPlugin from "eslint-plugin-import";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

// Règle JB (2026-09-23) : Phosphor pour l'app, lucide réservé aux internes Shadcn. Une icône par
// import : le baril charge les 1 500 icônes, 40 s par fichier de test mesurées en E05-S01.
const ICONES = [
  { name: "lucide-react", message: "Icônes de l'app : @phosphor-icons/react (lucide est réservé aux internes Shadcn)." },
  {
    name: "@phosphor-icons/react",
    allowTypeImports: true,
    message: "Une icône par import : @phosphor-icons/react/dist/ssr/<Nom> (serveur) ou /dist/csr/<Nom> (client).",
  },
  { name: "@phosphor-icons/react/ssr", message: "Une icône par import : @phosphor-icons/react/dist/ssr/<Nom>." },
];

// Motifs de `no-restricted-imports` de server/, api/ et mcp/ (blocs plus bas).
const PAQUET = { group: ["@/*"], message: "Le paquet n'importe jamais l'application hôte (alias @/)." };
const DROITS = {
  group: ["**/access-facts", "**/access-levels"],
  message: "Un service décide par server/access.ts seul : sans son repli node_owner, faits et calcul donnent un niveau trop haut.",
};
const SUPABASE_HORS_DU_PORT = {
  group: ["@supabase/*"],
  message: "server/, api/ et mcp/ parlent à la base par db.tx : @supabase/* n'entre que dans server/oauth.ts et server/invitations.ts (ADR-012 § 1).",
};
const ACCESS_FILES = ["packages/plateforme/server/access.ts", "packages/plateforme/server/access-facts.ts"];
const SUPABASE_PORT_FILES = ["packages/plateforme/server/oauth.ts", "packages/plateforme/server/invitations.ts"];

const eslintConfig = [
  // Sans cette liste, `eslint .` parcourt la sortie de build : après un premier `pnpm build`,
  // `pnpm lint` remonte des milliers d'erreurs sur du code généré et minifié, ce qui rend le
  // gate de commit-push impassable.
  {
    ignores: [
      ".next/**",
      "out/**",
      "build/**",
      "dist/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      "next-env.d.ts",
      // Bundle minifié du widget, généré par packages/plateforme/widgets/build.mjs.
      "packages/plateforme/mcp/widgets/generated.ts",
      // Script du worker des lecteurs, assemblé par le même script.
      "packages/plateforme/server/files/readers/worker/generated.ts",
      // Worktrees des vagues d'exécution autonome (copies du dépôt, avec leurs builds) : chacun
      // passe son propre `pnpm verify` ; le lint du checkout principal ne les relit pas.
      ".claude/worktrees/**",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // Ces règles remplacent des sections de prose supprimées de coding-standards.md.
    // Une règle appliquée par l'outillage n'a pas à être relue par un humain ou une IA à
    // chaque review : elle est vérifiée à chaque `pnpm lint`, sans exception ni oubli.
    plugins: { import: importPlugin },
    rules: {
      // Complexité — remplace la table « File Size & Complexity » et la section « Early Returns »
      "max-lines": ["error", { max: 300, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["error", { max: 150, skipBlankLines: true, skipComments: true }],
      "max-params": ["error", 4],
      "max-depth": ["error", 3],
      "no-empty": ["error", { allowEmptyCatch: false }],

      // Remplace « Enums : préférer as const » (typescript-patterns.md)
      "no-restricted-syntax": [
        "error",
        {
          selector: "TSEnumDeclaration",
          message: "Utiliser un objet `as const` + type inféré plutôt qu'un enum TypeScript.",
        },
      ],

      // Remplace l'ordre d'imports décrit en prose dans coding-standards.md
      "import/order": [
        "error",
        {
          groups: ["builtin", "external", "internal", "parent", "sibling", "index"],
          pathGroups: [
            { pattern: "{react,react-dom/**,next,next/**}", group: "builtin", position: "before" },
            { pattern: "@/components/**", group: "internal", position: "before" },
            { pattern: "@/lib/**", group: "internal" },
            { pattern: "@/types/**", group: "internal", position: "after" },
          ],
          pathGroupsExcludedImportTypes: ["react", "next"],
          // Pas d'alphabétisation ni de contrainte de ligne vide : la convention porte sur
          // l'ORDRE DES GROUPES, rien de plus. Aller au-delà imposerait de reformater les
          // composants Shadcn à chaque régénération.
          "newlines-between": "ignore",
        },
      ],
    },
  },
  {
    files: ["packages/plateforme/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [{ group: ["@/*"], message: "Le paquet n'importe jamais l'application hôte (alias @/)." }] },
      ],
    },
  },
  {
    // Frontière widgets/ : le bundle du widget part dans le navigateur de l'host (iframe), il ne rend que le résultat
    // déjà servi ; server/, api/, mcp/ ou migrations/ y mettraient le code du serveur. Il lit ui/ et schemas/.
    files: ["packages/plateforme/widgets/**/*.{ts,tsx}"],
    rules: {
      "import/no-restricted-paths": [
        "error",
        {
          zones: ["server", "api", "mcp", "migrations"].map((face) => ({
            target: "./packages/plateforme/widgets",
            from: `./packages/plateforme/${face}`,
            message: `widgets/ n'importe jamais ${face}/ : le bundle ne rend que le résultat servi, avec ui/ et schemas/.`,
          })),
        },
      ],
    },
  },
  {
    // Frontière ui/ (FR-INST-03, ADR-001) : un ERP hôte doit pouvoir embarquer ui/ sans tirer la
    // base. ui/ parle à api/ par HTTP ; il n'importe ni server/, ni migrations/, ni client DB.
    // Ce bloc remplace le `no-restricted-imports` du bloc précédent pour ui/ : il en reprend `@/*`.
    files: ["packages/plateforme/ui/**/*.{ts,tsx}"],
    rules: {
      "import/no-restricted-paths": [
        "error",
        {
          zones: [
            {
              target: "./packages/plateforme/ui",
              from: "./packages/plateforme/server",
              message: "ui/ ne dépend jamais de server/ : il parle à api/ par HTTP.",
            },
            {
              target: "./packages/plateforme/ui",
              from: "./packages/plateforme/migrations",
              message: "ui/ ne dépend jamais de migrations/ : le SQL n'est importé par personne.",
            },
            {
              target: "./packages/plateforme/ui",
              from: "./packages/plateforme/api",
              message: "ui/ appelle api/ par HTTP, jamais par import.",
            },
            {
              target: "./packages/plateforme/ui",
              from: "./packages/plateforme/mcp",
              message: "ui/ n'importe jamais mcp/.",
            },
          ],
        },
      ],
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "pg", message: "ui/ n'embarque aucun client de base : il parle à api/ par HTTP." },
            { name: "postgres", message: "ui/ n'embarque aucun client de base : il parle à api/ par HTTP." },
            // ADR-008 § 2 : la navigation vient de l'hôte, par props (`Lien`, `hrefDuNoeud`).
            { name: "next/navigation", message: "ui/ n'importe aucun routeur : la navigation vient de l'hôte, par props." },
            { name: "next/link", message: "ui/ n'importe aucun routeur : l'hôte passe son composant de lien en prop." },
            ...ICONES,
          ],
          patterns: [
            {
              group: ["@otomata_tech/oto_platform/server", "@otomata_tech/oto_platform/migrations*"],
              message: "ui/ ne dépend jamais de server/ ni de migrations/ : il parle à api/ par HTTP.",
            },
            { group: ["@supabase/*"], message: "ui/ n'embarque aucun client de base : il parle à api/ par HTTP." },
            { group: ["@tanstack/*"], message: "ui/ n'importe aucun routeur : la navigation vient de l'hôte, par props." },
            { group: ["@/*"], message: "Le paquet n'importe jamais l'application hôte (alias @/)." },
          ],
        },
      ],
    },
  },
  {
    // Frontière schemas/ (H02, E02-S01) : du Zod pur, importé par toutes les faces, ui/ compris. Il
    // n'importe ni une autre face, ni un client de base, ni Next, ni l'hôte : sinon ui/ tirerait la
    // base par un schéma. Ce bloc remplace le `no-restricted-imports` du bloc du paquet : il en
    // reprend `@/*`.
    files: ["packages/plateforme/schemas/**/*.ts"],
    rules: {
      "import/no-restricted-paths": [
        "error",
        {
          zones: ["server", "api", "mcp", "migrations"].map((face) => ({
            target: "./packages/plateforme/schemas",
            from: `./packages/plateforme/${face}`,
            message: `schemas/ ne dépend jamais de ${face}/ : il ne contient que du Zod.`,
          })),
        },
      ],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["@otomata_tech/oto_platform/*"], message: "schemas/ n'importe aucune autre face du paquet." },
            { group: ["@supabase/*"], message: "schemas/ n'embarque aucun client de base : du Zod pur." },
            { group: ["next", "next/*"], message: "schemas/ ne dépend pas de Next : il est importé par toutes les faces." },
            { group: ["@/*"], message: "Le paquet n'importe jamais l'application hôte (alias @/)." },
          ],
        },
      ],
    },
  },
  // Droits (E01-S07, HN-E01S07-19) : un service décide par server/access.ts seul. Lus sans lui, les
  // faits d'access-facts.ts et le calcul d'access-levels.ts donnent, sous la RLS de niveau, un
  // niveau trop haut sur une chaîne incomplète : le repli `node_owner` n'est que dans access.ts.
  // Port de base (E01-S10 f2, AC-f3) : server/, api/ et mcp/ parlent à la base par `db.tx` seul ;
  // `@supabase/*` n'entre que dans server/oauth.ts et server/invitations.ts, l'implémentation Supabase
  // du port (ADR-012 § 1 : consentement OAuth, lien magique). Sans cette règle, le client PostgREST
  // reviendrait dans server/ sans que rien ne le voie. Les trois blocs remplacent le
  // `no-restricted-imports` du bloc du paquet : ils en reprennent `@/*`.
  ...[
    {
      files: ["packages/plateforme/{server,api,mcp}/**/*.ts"],
      ignores: [...ACCESS_FILES, ...SUPABASE_PORT_FILES],
      patterns: [DROITS, SUPABASE_HORS_DU_PORT, PAQUET],
    },
    { files: SUPABASE_PORT_FILES, patterns: [DROITS, PAQUET] },
    { files: ACCESS_FILES, patterns: [SUPABASE_HORS_DU_PORT, PAQUET] },
  ].map(({ patterns, ...block }) => ({ ...block, rules: { "no-restricted-imports": ["error", { patterns }] } })),
  {
    // L'hôte suit la même règle d'icônes que ui/, sauf les internes Shadcn (générés avec lucide).
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/components/ui/**"],
    rules: { "no-restricted-imports": ["error", { paths: ICONES }] },
  },
  {
    // Composants Shadcn : générés par la CLI, réécrits à chaque `shadcn add`.
    files: ["src/components/ui/**"],
    rules: { "import/order": "off" },
  },
  {
    // Les pages catalogue sont des inventaires plats : la limite de lignes n'y a pas de sens.
    // database.ts est généré par `pnpm db:types` (coding-standards.md § Complexité : exempté).
    files: ["src/app/design-system/**", "tests/**", "packages/plateforme/server/database.ts"],
    rules: { "max-lines": "off", "max-lines-per-function": "off" },
  },
];

export default eslintConfig;
