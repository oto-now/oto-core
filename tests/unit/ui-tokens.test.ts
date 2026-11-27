// @vitest-environment node
import fs from "fs"
import path from "path"
import tailwindcss from "@tailwindcss/postcss"
import postcss from "postcss"
import ts from "typescript"
import { describe, it, expect } from "vitest"

const root = path.resolve(__dirname, "../..")
const uiDir = path.join(root, "packages/plateforme/ui")
const otoCss = fs.readFileSync(path.join(uiDir, "styles/oto.css"), "utf8")
const globalsCssPath = path.join(root, "src/app/globals.css")
// Repris de `tailwind-package-source.test.ts` (M11b) : une classe utilisée seulement dans
// packages/plateforme/ui/components/package-version.tsx, compilée par le `@source` de globals.css.
const PACKAGE_ONLY_CLASS = "select-all"

const couleursDeclarees = (css: string) => new Set([...css.matchAll(/--color-([a-z0-9-]+):/g)].map((m) => m[1]))

// Jeu Oto : les seules couleurs qu'un écran de ui/ peut employer (ADR-008 § 3).
const OTO = couleursDeclarees(otoCss)
// Tokens de l'hôte ABSENTS du jeu Oto : sous `.oto`, ils rendraient le violet du template en silence.
const HOTE_SEUL = [...couleursDeclarees(fs.readFileSync(globalsCssPath, "utf8"))].filter((c) => !OTO.has(c))

// Un seul parcours pour les trois listes, depuis que ce fichier reçoit celui de
// `tailwind-package-source.test.ts` (M11b) : l'extension cherchée en paramètre.
function fichiers(dir: string, extension: RegExp): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) return fichiers(full, extension)
    return extension.test(e.name) ? [full] : []
  })
}

const fichiersTsx = (dir: string) => fichiers(dir, /\.tsx$/)
const fichiersTsEtTsx = (dir: string) => fichiers(dir, /\.tsx?$/)

const relatif = (f: string) => path.relative(root, f).split(path.sep).join("/")

// Tous les écrans de ui/ sont rendus sous la `CoquilleOto` du layout `(dashboard)` (E09-S01), ceux
// d'E01-S01 compris : plus aucune exemption.
const ecransOto = fichiersTsx(uiDir)

// Les pages du groupe, elles aussi rendues sous cette coquille ; le layout seul rend hors d'elle
// (barre latérale). Sur l'îlot, les tokens de l'hôte perdent leur contraste : le
// `text-muted-foreground` de `PageContainer` et `EmptyState` y mesurait 3,77:1 la nuit (page `/`,
// Manuscrit), le `text-primary-foreground` de `Button` passe sur le primaire du thème.
const dashboardDir = path.join(root, "src/app/(dashboard)")
const pagesSousLaCoquille = fichiersTsx(dashboardDir).filter((f) => f !== path.join(dashboardDir, "layout.tsx"))

// Les écrans d'authentification de l'hôte, rendus sous la `CoquilleOto` que chaque page pose en
// `pleinePage` (E05-S07) : formulaires, pages et chaînes de classes ; le consentement OAuth aussi (E02-S02).
const ecransDAuthentification = ["src/app/(auth)", "src/app/auth/confirm", "src/app/no-organization", "src/app/oauth"].flatMap(
  (dossier) => fichiersTsEtTsx(path.join(root, dossier)),
)

function tokensDeLHote(fichiers: string[]): string[] {
  const utilitaire = /\b(?:bg|text|border|ring|fill|stroke|outline|divide|decoration|placeholder|caret)-([a-z-]+)\b/g
  return fichiers.flatMap((f) =>
    [...fs.readFileSync(f, "utf8").matchAll(utilitaire)]
      .filter((m) => HOTE_SEUL.includes(m[1]))
      .map((m) => `${relatif(f)} : ${m[0]}`),
  )
}

const importsDeLHote = (fichiers: string[]) =>
  fichiers.filter((f) => /from\s+["']@\/components\//.test(fs.readFileSync(f, "utf8"))).map(relatif)

// Une bordure colorée perd contre `* { border-color }`, hors layer, de l'hôte (`portage-ecrans.md § 3`).
function bordersColorees(fichiers: string[]): string[] {
  const couleurs = new Set([...OTO, ...HOTE_SEUL])
  const bordure = /\bborder(?:-[trblxyse])?-([a-z-]+)\b/g
  return fichiers.flatMap((f) =>
    [...fs.readFileSync(f, "utf8").matchAll(bordure)].filter((m) => couleurs.has(m[1])).map((m) => `${relatif(f)} : ${m[0]}`),
  )
}

// Un bouton des écrans du paquet est le `Button` du design system (`oto-btn`) : une chaîne qui porte à la fois un
// arrondi et les deux marges internes dessine un bouton à la main, hors des tailles et de la pilule du DS
// (`portage-ecrans.md § 3`). Lue chaîne par chaîne, elle se trouve aussi rangée dans une constante.
const FORME_DE_BOUTON = /["'`][^"'`\n]*["'`]/g
const dessineUnBouton = (chaine: string) => /\brounded\b|\brounded-/.test(chaine) && /\bpx-/.test(chaine) && /\bpy-/.test(chaine)
// Nommée : la ligne de l'arbre, un lien qui n'agit pas.
const FORMES_ADMISES = new Set(["packages/plateforme/ui/arbre/navigateur-d-arbre.tsx"])

function boutonsDessines(fichiers: string[]): string[] {
  return fichiers
    .filter((f) => !FORMES_ADMISES.has(relatif(f)))
    .flatMap((f) => [...fs.readFileSync(f, "utf8").matchAll(FORME_DE_BOUTON)].filter((m) => dessineUnBouton(m[0])).map((m) => `${relatif(f)} : ${m[0]}`))
}

describe("ui/ design tokens (ADR-008)", () => {
  it("should find host-only tokens to guard against", () => {
    expect(HOTE_SEUL).toContain("muted-foreground")
  })

  it("should use no host-only color token in a ported screen", () => {
    expect(tokensDeLHote(ecransOto)).toEqual([])
  })

  it("should use no colored border in a ported screen", () => {
    expect(bordersColorees(ecransOto)).toEqual([])
  })

  it("should tell a hand-drawn button from the chains it lets through", () => {
    const chaines = {
      bouton: "`rounded-md px-3 py-2 text-sm font-medium ${FOCUS}`",
      lien: "`rounded-sm text-ink underline ${FOCUS}`",
      carte: '"rounded-lg bg-island p-3 ring-1 ring-hair"',
      tuile: '"rounded-lg px-1.5 pb-2.5 pt-3.5"',
      design: '"oto-btn"',
    }
    expect(Object.fromEntries(Object.entries(chaines).map(([cas, chaine]) => [cas, dessineUnBouton(chaine)]))).toEqual({
      bouton: true,
      lien: false,
      carte: false,
      tuile: false,
      design: false,
    })
  })

  it("should draw no button by hand in a ported screen, the design system's Button instead", () => {
    expect(boutonsDessines(fichiersTsEtTsx(uiDir).filter((f) => !relatif(f).startsWith("packages/plateforme/ui/ds/")))).toEqual([])
  })

  // La compilation Tailwind scanne tout le dépôt : au-delà des 5 s par défaut sur Windows. Une seule
  // compilation pour les jetons Oto et le `@source` du paquet (M11b).
  it("should compile the Oto classes and a class used only in packages/plateforme/ui through the host globals.css", { timeout: 30_000 }, async () => {
    const css = fs.readFileSync(globalsCssPath, "utf8")
    const result = await postcss([tailwindcss()]).process(css, { from: globalsCssPath })
    expect(result.css).toContain(".bg-island")
    expect(result.css).toContain(".text-primary-on")
    expect(result.css).toContain(".dark .oto")
    // Les trois jetons des écrans d'authentification (E05-S07, AC11).
    expect(result.css).toContain(".bg-desk")
    expect(result.css).toContain(".bg-hair")
    expect(result.css).toContain(".ring-island-bd")
    expect(result.css).toContain(`.${PACKAGE_ONLY_CLASS}`)
    // Le design system porté d'oto-frontend (E05-S09, AC-a1) : le bureau, le rail, sous `.oto`.
    expect(result.css).toContain(".oto-desk")
    expect(result.css).toContain(".oto-rail-item")
  })

  // E05-S09, AC-a1 : les feuilles de `ui/ds/` lisent les jetons d'`oto.css`, la seule source des valeurs ;
  // une feuille qui en redéclare un ne peut que le rapporter à un autre jeton (`--gap: var(--space-2)`).
  it("should give ui/ds no value of its own for a token of oto.css", () => {
    const jetons = new Set([...otoCss.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]))
    const redeclares = fichiers(path.join(uiDir, "ds"), /\.css$/).flatMap((f) =>
      [...fs.readFileSync(f, "utf8").matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)]
        .filter((m) => jetons.has(m[1]) && !m[2].trim().startsWith("var(--"))
        .map((m) => `${relatif(f)} : ${m[1]}: ${m[2].trim()}`),
    )
    expect(jetons.has("--space-2")).toBe(true)
    expect(redeclares).toEqual([])
  })

  it("should not find the class used only in packages/plateforme/ui anywhere in src/", () => {
    const hits = fichiers(path.join(root, "src"), /\.(ts|tsx|css)$/).filter((file) => fs.readFileSync(file, "utf8").includes(PACKAGE_ONLY_CLASS))
    expect(hits).toEqual([])
  })
})

// Les gestes du design system, gardés hors de `ui/ds/` : chaque motif refusé redessinait à la main ce qu'un rôle ou un
// composant du DS porte déjà, aux couleurs et aux tailles du navigateur ou de Tailwind plutôt qu'à celles du thème.
const horsDuDs = (f: string) => !relatif(f).startsWith("packages/plateforme/ui/ds/")
const ecransHorsDuDs = ecransOto.filter(horsDuDs)
// Le lien de texte n'a que deux sources : `LIEN` et `LienDeCellule`.
const SOURCES_DU_LIEN = new Set(["packages/plateforme/ui/components/classes.ts", "packages/plateforme/ui/components/table-serveur.tsx"])

const occurrences = (fichiers: string[], motif: RegExp) =>
  fichiers.flatMap((f) => fs.readFileSync(f, "utf8").split("\n").flatMap((ligne, rang) => (motif.test(ligne) ? [`${relatif(f)}:${rang + 1}`] : [])))

/** Les balises JSX d'un source, chacune avec le nom de ses attributs et le texte de sa `className`. */
function balises(source: string, nom = "source.tsx"): { attributs: Set<string>; classes: string; ligne: number }[] {
  const fichier = ts.createSourceFile(nom, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const trouvees: { attributs: Set<string>; classes: string; ligne: number }[] = []
  const visiter = (noeud: ts.Node) => {
    if (ts.isJsxOpeningElement(noeud) || ts.isJsxSelfClosingElement(noeud)) {
      const attributs = noeud.attributes.properties.filter(ts.isJsxAttribute)
      const classe = attributs.find((attribut) => attribut.name.getText(fichier) === "className")
      trouvees.push({
        attributs: new Set(attributs.map((attribut) => attribut.name.getText(fichier))),
        classes: classe?.initializer?.getText(fichier) ?? "",
        ligne: fichier.getLineAndCharacterOfPosition(noeud.getStart(fichier)).line + 1,
      })
    }
    ts.forEachChild(noeud, visiter)
  }
  visiter(fichier)
  return trouvees
}

/** Une infobulle native sur un bouton à icône : `title` double le `Tooltip` du DS, qui seul passe au focus et au toucher. */
const infobulleNative = (balise: { attributs: Set<string> }) => balise.attributs.has("data-icon-only") && balise.attributs.has("title")
/** Une étiquette refaite : petite et grise, c'est `.oto-label` ou `.oto-caption`, aux tailles et au contraste mesurés du DS. */
const etiquetteRefaite = (balise: { classes: string }) => /\btext-xs\b/.test(balise.classes) && /\btext-mute\b/.test(balise.classes)

const balisesFautives = (fichiers: string[], fautive: (balise: { attributs: Set<string>; classes: string }) => boolean) =>
  fichiers.flatMap((f) => balises(fs.readFileSync(f, "utf8"), f).filter(fautive).map((balise) => `${relatif(f)}:${balise.ligne}`))

describe("ui/ design system gestures, outside ui/ds/", () => {
  it("should tell the faulty tags from the ones they let through", () => {
    const source = [
      '<a data-icon-only="" title="Ouvrir" />',
      '<a data-icon-only="" aria-label="Ouvrir" />',
      '<p className="text-xs font-semibold text-mute" />',
      '<p className={`text-xs ${x ? "text-mute" : ""}`} />',
      '<p className="oto-caption text-xs" />',
    ].join("\n")
    expect(balises(source).map((balise) => [infobulleNative(balise), etiquetteRefaite(balise)])).toEqual([
      [true, false],
      [false, false],
      [false, true],
      [false, true],
      [false, false],
    ])
  })

  // Une barre native se peint aux couleurs du navigateur, hors thème : `.oto-progress`.
  it("should use no native <progress>, the design system's .oto-progress instead", () => {
    expect(occurrences(ecransHorsDuDs, /<progress\b/)).toEqual([])
  })

  // Un rectangle `bg-skeleton` n'a ni le balayage ni la forme du DS, ni sa coupure sous « réduire les animations » : `Skeleton`.
  it("should draw no skeleton by hand, the design system's Skeleton instead", () => {
    expect(occurrences(ecransHorsDuDs, /\bbg-skeleton\b/)).toEqual([])
  })

  // Un soulignement à la main n'a ni le décalage ni l'arrondi de focus de `.oto-link` : `LIEN` ou `LienDeCellule`.
  it("should underline no link by hand outside LIEN and LienDeCellule", () => {
    const sources = fichiersTsEtTsx(uiDir).filter((f) => horsDuDs(f) && !SOURCES_DU_LIEN.has(relatif(f)))
    expect(occurrences(sources, /\bunderline\b/)).toEqual([])
  })

  // Les capitales à la main refont `.oto-label`, en mono, à la taille et au contraste mesurés du DS.
  it("should set no uppercase by hand, the .oto-label role instead", () => {
    expect(occurrences(ecransHorsDuDs, /\buppercase\b/)).toEqual([])
  })

  it("should put no text-xs with text-mute on the same className, the .oto-label or .oto-caption role instead", () => {
    expect(balisesFautives(ecransHorsDuDs, etiquetteRefaite)).toEqual([])
  })

  it("should put no title= on an icon-only control, the design system's Tooltip instead", () => {
    expect(balisesFautives(ecransHorsDuDs, infobulleNative)).toEqual([])
  })

  // Un titre en `text-2xl` ou `text-xl` sort de l'échelle des rôles : `oto-page-title`, `oto-card-title` ou `oto-empty-title`.
  it("should set no text-2xl nor text-xl, a title role of the design system instead", () => {
    expect(occurrences(ecransHorsDuDs, /\btext-(?:2xl|xl)\b/)).toEqual([])
  })

  // `--faint` tombe sous 4,5:1 sur l'îlot la nuit : `.oto-label`, un texte, reste en `--mute`.
  it("should not colour .oto-label in var(--faint) in typography.css", () => {
    const typographie = fs.readFileSync(path.join(uiDir, "ds/tokens/typography.css"), "utf8")
    const regles = [...typographie.matchAll(/([^{}]*)\{([^}]*)\}/g)].filter((regle) => regle[1].includes(".oto-label"))
    expect(regles.length).toBeGreaterThan(0)
    expect(regles.filter((regle) => /\bcolor\s*:\s*var\(--faint\)/.test(regle[2])).map((regle) => regle[1].trim())).toEqual([])
  })
})

describe("(dashboard) pages under the layout's CoquilleOto (E09-S01)", () => {
  it("should find the pages of the group, the layout left out", () => {
    const relatifs = pagesSousLaCoquille.map(relatif)
    expect(relatifs).toContain("src/app/(dashboard)/page.tsx")
    expect(relatifs).not.toContain("src/app/(dashboard)/layout.tsx")
  })

  it("should import no host component, all written on the host tokens", () => {
    expect(importsDeLHote(pagesSousLaCoquille)).toEqual([])
  })

  it("should use no host-only color token", () => {
    expect(tokensDeLHote(pagesSousLaCoquille)).toEqual([])
  })
})

describe("authentication screens under the page's CoquilleOto (E05-S07, AC11)", () => {
  it("should find the forms, the pages and the class strings of the six screens", () => {
    const relatifs = ecransDAuthentification.map(relatif)
    // Garde contre un chemin mort : un dossier renommé viderait la liste sans bruit.
    expect(relatifs).toContain("src/app/(auth)/login/formulaire-de-connexion.tsx")
    expect(relatifs).toContain("src/app/(auth)/classes-oto.ts")
    expect(relatifs).toContain("src/app/auth/confirm/page.tsx")
    expect(relatifs).toContain("src/app/no-organization/page.tsx")
    expect(relatifs).toContain("src/app/oauth/consent/page.tsx")
  })

  it("should import no host component", () => {
    expect(importsDeLHote(ecransDAuthentification)).toEqual([])
  })

  it("should use no host-only color token", () => {
    expect(tokensDeLHote(ecransDAuthentification)).toEqual([])
  })

  it("should use no colored border", () => {
    expect(bordersColorees(ecransDAuthentification)).toEqual([])
  })
})

// La section « écrans d'authentification » d'oto.css (E05-S07, AC3, AC11) n'est plus lue règle par
// règle (M11b : on ne teste pas le CSS) : ses jetons sont gardés ci-dessus, l'animation unique et
// coupée sous « réduire les animations » et le contraste du panneau d'encre sont mesurés dans le
// navigateur (`tests/e2e/ecrans-d-authentification.spec.ts`, AC3 et AC12).
