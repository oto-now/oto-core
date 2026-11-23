import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // Configuration minimale — personnaliser par projet
  // Le paquet est consommé en source TypeScript depuis le workspace : Next doit le transpiler.
  transpilePackages: ["@otomata_tech/oto_platform", "@otomata_tech/connectors"],
  // Le « Segment Explorer » des outils de développement (Next 15.5, actif par défaut) : quand une
  // compilation croise un chargement, le client hydrate ses enveloppes avec une branche de moins que le
  // serveur, et tout `useId` de la page change (« attributes didn't match » : contrôle visuel d'E05-S02,
  // un thème sur deux). Développement seulement : la production ne rend pas ces enveloppes.
  //
  // `optimizePackageImports` : Next réécrit chaque import du barrel `@otomata_tech/oto_platform/ui` vers le
  // module de l'export nommé. Sans lui, un import du barrel par un fichier serveur (layout, page) met le code
  // client de toute la face (éditeur, zod) dans la route. Le sous-chemin exact : le nom du paquet seul ne
  // couvre pas `/ui` (`performance-patterns.md § Bundle Size`).
  experimental: { devtoolSegmentExplorer: false, optimizePackageImports: ["@otomata_tech/oto_platform/ui"] },
  // ADR à rouvrir le jour où une vue s'intègre en cadre chez un client (E09).
  // E10-S02 (AC-c3, ADR-017 § 1) : la route isolée d'un fichier HTML, `/api/platform/files/<id>/html` et
  // `/api/platform/public/<jeton>/files/<id>/html`, se charge dans l'iframe de la visionneuse et pose elle-même sa
  // politique (`frame-ancestors 'self'`, `Referrer-Policy: no-referrer`) : ni `X-Frame-Options` ni la
  // `Referrer-Policy` globale ne s'y appliquent. Toute autre adresse les garde.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
      {
        source: "/((?!api/platform/(?:public/[^/]+/)?files/[^/]+/html/?$).*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ]
  },
}

export default nextConfig
