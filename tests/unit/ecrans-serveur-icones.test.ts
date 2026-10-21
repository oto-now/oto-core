// Garde née d'une erreur de la partie b2 d'E05-S10 : l'écran « Corbeille », Server Component, importait son
// glyphe de `@phosphor-icons/react/dist/csr/` ; jsdom, le type-check et ESLint laissaient passer, la page
// tombait au rendu serveur (`createContext is not a function`), vue seulement par la campagne Playwright.
// Règle (`portage-ecrans.md § 3`, « Une icône par import ») : un écran exporté sans `"use client"` (`Ecran…`,
// un Server Component, `portage-ecrans.md § 2`) importe ses icônes de `/dist/ssr/`.
import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const UI = path.resolve(__dirname, "../../packages/plateforme/ui")

function fichiers(dossier: string): string[] {
  return fs.readdirSync(dossier, { withFileTypes: true }).flatMap((entree) => {
    const chemin = path.join(dossier, entree.name)
    if (entree.isDirectory()) return fichiers(chemin)
    return entree.name.endsWith(".tsx") ? [chemin] : []
  })
}

const ECRANS_SERVEUR = fichiers(UI).filter((fichier) => {
  const texte = fs.readFileSync(fichier, "utf8")
  return /^export function Ecran[A-Z]/m.test(texte) && !texte.startsWith('"use client"')
})

describe("server screens of ui/ and their icons", () => {
  it("should import no client icon in a server screen", () => {
    // Le détecteur trouve les écrans serveur : sans eux, la garde passerait à vide.
    expect(ECRANS_SERVEUR.map((fichier) => path.basename(fichier))).toContain("ecran-de-la-corbeille.tsx")
    const fautifs = ECRANS_SERVEUR.filter((fichier) => fs.readFileSync(fichier, "utf8").includes("@phosphor-icons/react/dist/csr/"))
    expect(fautifs.map((fichier) => path.relative(UI, fichier))).toEqual([])
  })
})
