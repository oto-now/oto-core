import type { Metadata } from "next"
import { Inter } from "next/font/google"
import { FaviconDuTheme } from "@otomata_tech/oto_platform/ui"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/sonner"
import { metadonneesDePartage } from "@otomata_tech/oto_platform/share"
import { marqueDeLAdresse } from "@/lib/plateforme/marque-de-l-adresse"
import { getCalledOrigin } from "@/lib/plateforme/session"
import "./globals.css"

const inter = Inter({ subsets: ["latin"] })

// Les métadonnées de partage de toute adresse (E11-S21) : l'organisation de l'adresse, jamais une page privée
// (HN-E11S21-2) ; l'image vient de la convention `opengraph-image.tsx`. L'origine de la requête devient `metadataBase` :
// chaque organisation sert ses images sous sa propre adresse.
export async function generateMetadata(): Promise<Metadata> {
  const [origine, marque] = await Promise.all([getCalledOrigin(), marqueDeLAdresse()])
  return {
    title: {
      default: "Oto",
      template: "%s | Oto",
    },
    description: "Description du projet",
    ...metadonneesDePartage({ organisation: marque?.nomAffiche ?? null, origine }),
  }
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <body className={inter.className}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {/* Skip link : premier élément focusable, visible seulement au focus clavier
              (accessibility-patterns.md § Navigation clavier). */}
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:ring-1 focus:ring-ring"
          >
            Aller au contenu principal
          </a>
          <div id="main-content">{children}</div>
          {/* Sans ce Toaster monté à la racine, tout toast.success() est silencieux. */}
          <Toaster position="bottom-right" richColors visibleToasts={3} duration={5000} />
          {/* La favicon au thème de l'organisation, lu sur la racine `.oto` de chaque page ; au
              chargement d'une page sans racine ni jeton, l'icône statique `icon.svg` reste (M28). */}
          <FaviconDuTheme />
        </ThemeProvider>
      </body>
    </html>
  )
}
