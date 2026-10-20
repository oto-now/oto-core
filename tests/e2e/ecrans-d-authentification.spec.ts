import fs from "fs"
import { expect, test, type Browser, type Locator, type Page } from "@playwright/test"
import { OTO_THEMES } from "../../packages/plateforme/schemas/brand"
import { hex, supabaseConfigured, type TestOrg } from "../helpers/plateforme"
import { baseAdminConfiguree, clientAuth, demoServieALocalhost, donneesJetables, SANS_BASE_ADMIN, type DonneesJetables } from "./fixtures/base"
import { DEMO } from "./fixtures/espace"
import { seConnecter } from "./fixtures/connexion"

// Contrôle visuel des écrans d'authentification sur le gabarit porté d'oto-frontend (E05-S09, partie
// d3 : AC-x1, AC-x3, M27 ; E05-S07 : AC1 à AC3, AC6, AC10, AC12, AC14). Prérequis : `pnpm demo:seed`
// (Démo servie à `localhost`, H10) et le serveur de `playwright.config.ts`. Les adresses partent de
// `baseURL` : la spec tourne aussi sur un autre port. Captures dans `test-results/` (dont `/login` à la
// taille de la capture d'oto-frontend, et les huit thèmes, jour et nuit) ; minima de contraste par paire
// dans `contrastes.json` à côté.

const email = process.env.E2E_USER_EMAIL ?? ""
const password = process.env.E2E_USER_PASSWORD ?? ""
const LARGEURS = [
  { nom: "390", viewport: { width: 390, height: 844 } },
  { nom: "1280", viewport: { width: 1280, height: 800 } },
] as const
const SCHEMAS = ["light", "dark"] as const
const MESSAGE_DU_LIEN = "Si une invitation ou un compte existe pour cette adresse, un lien de connexion vient de partir."

type Ecran = { nom: string; chemin: string; titre: string; onglet: string }

const ECRANS: Ecran[] = [
  { nom: "connexion", chemin: "/login", titre: "Se connecter", onglet: "Connexion | Oto" },
  { nom: "mot-de-passe-oublie", chemin: "/forgot-password", titre: "Mot de passe oublié", onglet: "Mot de passe oublié | Oto" },
  {
    nom: "nouveau-mot-de-passe",
    chemin: "/reset-password",
    titre: "Choisir un nouveau mot de passe",
    onglet: "Nouveau mot de passe | Oto",
  },
  {
    nom: "confirmation",
    chemin: "/auth/confirm?token_hash=e2e&type=email&next=/",
    titre: "Connexion",
    onglet: "Ouvrir votre session | Oto",
  },
]

type Affichage = { largeur: (typeof LARGEURS)[number]; schema: (typeof SCHEMAS)[number] }

function ouvrir(browser: Browser, baseURL: string | undefined, { largeur, schema }: Affichage): Promise<Page> {
  return browser.newPage({ baseURL, viewport: largeur.viewport, colorScheme: schema })
}

/** `true` quand le bas de `a` est au-dessus du haut de `b` à l'écran. */
async function auDessus(a: Locator, b: Locator): Promise<boolean> {
  const [boiteA, boiteB] = await Promise.all([a.boundingBox(), b.boundingBox()])
  return Boolean(boiteA && boiteB && boiteA.y + boiteA.height <= boiteB.y)
}

test.describe("écrans d'authentification sans session (AC-x1, AC-x3, M27 ; E05-S07, AC1, AC2, AC14)", () => {
  test.skip(!supabaseConfigured || !baseAdminConfiguree, "set the Supabase variables and PLATFORM_ADMIN_DATABASE_URL in .env.local")

  test.beforeAll(async () => {
    test.skip(!(await demoServieALocalhost()), "Démo is not served at localhost: run pnpm demo:seed (E01-S05)")
  })

  for (const ecran of ECRANS) {
    for (const largeur of LARGEURS) {
      for (const schema of SCHEMAS) {
        test(`${ecran.nom} at ${largeur.nom} px (${schema})`, async ({ browser, baseURL }, testInfo) => {
          const page = await ouvrir(browser, baseURL, { largeur, schema })
          await page.goto(ecran.chemin)
          const large = largeur.nom === "1280"

          await expect(page).toHaveTitle(ecran.onglet)
          const racine = page.locator(".oto")
          await expect(racine).toHaveCount(1)
          await expect(racine).toHaveAttribute("data-oto-theme", "manuscrit")
          if (schema === "dark") await expect(page.locator("html")).toHaveClass(/\bdark\b/)
          // Un seul `h1`, celui du panneau, à toute largeur ; le panneau à l'écran dès 64 rem, hors de
          // l'écran mais lu en dessous, où la marque compacte, son dessin, prend sa place.
          await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1)
          await expect(page.getByRole("heading", { level: 1 })).toHaveText("Oto")
          const panneau = await page.getByRole("region", { name: "Oto" }).boundingBox()
          expect((panneau?.width ?? 0) > 100).toBe(large)
          await expect(page.locator("main p.oto-page-title")).toBeVisible({ visible: !large })
          const ilot = page.getByRole("region", { name: ecran.titre })
          await expect(ilot.getByRole("heading", { level: 2, name: ecran.titre })).toBeVisible()
          // La ligne de l'organisation de l'adresse, au-dessus de l'îlot.
          await expect(page.getByText(DEMO.nom, { exact: true })).toBeVisible()
          expect(await auDessus(page.locator("main p.font-semibold"), ilot)).toBe(true)
          // La barre de repères du panneau et sa mention d'hébergement (M27).
          await expect(page.locator(".oto-brand-bar")).toContainText("Données hébergées en France")
          // Le bureau ne défile pas : la fenêtre non plus (`portage-ecrans.md § 0`).
          expect(await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)).toBeLessThanOrEqual(0)

          await page.screenshot({
            path: testInfo.outputPath(`auth-${ecran.nom}-${largeur.nom}-${schema}.png`),
            fullPage: true,
            animations: "disabled",
          })
          await page.close()
        })
      }
    }
  }

  // AC-x1 : `/login` à la taille de la capture d'oto-frontend (`.playwright-mcp/page-2026-08-15T16-41-18-312Z.png`),
  // pour la comparaison côte à côte.
  test("connexion at the size of the oto-frontend capture (light)", async ({ browser, baseURL }, testInfo) => {
    const page = await browser.newPage({ baseURL, viewport: { width: 1920, height: 889 }, colorScheme: "light" })
    await page.goto("/login")
    await expect(page.getByRole("region", { name: "Se connecter" })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath("auth-connexion-1920-light.png"), animations: "disabled" })
    await page.close()
  })
})

test.describe("aucune organisation (E05-S07, AC10, AC14)", () => {
  test.skip(!email || !password || !supabaseConfigured || !baseAdminConfiguree, SANS_BASE_ADMIN)
  // Une seule organisation jetable pour les quatre captures.
  test.describe.configure({ mode: "serial" })

  let fx: DonneesJetables
  let org: TestOrg

  test.beforeAll(async () => {
    const { error } = await clientAuth().auth.signInWithPassword({ email, password })
    test.skip(error !== null, "E2E account missing from the Supabase project: run pnpm demo:seed (E01-S05)")

    fx = donneesJetables()
    org = await fx.createOrg({ localhost: true })
    // Le thème de l'organisation, posé par l'outillage : la page doit le reprendre (AC10).
    await fx.sql`update platform.orgs set brand = ${fx.sql.json({ theme: "cobalt" })} where id = ${org.id}`
  })

  test.afterAll(async () => {
    await fx?.cleanup()
  })

  for (const largeur of LARGEURS) {
    for (const schema of SCHEMAS) {
      test(`should dress the non-member screen in the theme of the organisation at ${largeur.nom} px (${schema})`, async ({ browser, baseURL }, testInfo) => {
        const adresse = new URL(baseURL ?? DEMO.adresse)
        adresse.hostname = `${org.slug}.localhost`
        const page = await ouvrir(browser, undefined, { largeur, schema })
        await seConnecter(page, { baseURL: adresse.origin, email, password })

        await expect(page).toHaveURL(/\/no-organization$/)
        await expect(page).toHaveTitle("Aucune organisation | Oto")
        await expect(page.locator(".oto")).toHaveCount(1)
        await expect(page.locator(".oto")).toHaveAttribute("data-oto-theme", "cobalt")
        await expect(page.getByRole("heading", { level: 1 })).toHaveText("Oto")
        const titre = `Vous n'êtes pas membre de ${org.name}`
        await expect(page.getByRole("heading", { level: 2 })).toHaveText(titre)
        await expect(page.getByRole("region", { name: titre }).locator("footer").getByRole("button", { name: "Se déconnecter" })).toBeVisible()
        await page.screenshot({
          path: testInfo.outputPath(`auth-aucune-organisation-${largeur.nom}-${schema}.png`),
          fullPage: true,
          animations: "disabled",
        })
        await page.close()
      })
    }
  }
})

test.describe("rotation du mark et annonce (fiche D15 B ; E05-S07, AC3, AC6)", () => {
  test.skip(!supabaseConfigured, "set the Supabase variables in .env.local")

  test("should turn each mark once, in 5 s at most, and animate nothing under reduced motion", async ({ browser, baseURL }) => {
    const page = await ouvrir(browser, baseURL, { largeur: LARGEURS[1], schema: "light" })
    await page.goto("/login")
    const animations = () =>
      page.locator(".oto-marque-tournante").evaluateAll((marks) =>
        marks.map((mark) => {
          const style = getComputedStyle(mark)
          return { nom: style.animationName, duree: style.animationDuration, fois: style.animationIterationCount }
        }),
      )

    // Le filigrane et le mark du panneau, le mark de la marque compacte.
    const tours = await animations()
    expect(tours).toHaveLength(3)
    for (const tour of tours) {
      expect(tour.nom).toBe("oto-marque-tour")
      expect(Number.parseFloat(tour.duree)).toBeGreaterThan(0)
      expect(Number.parseFloat(tour.duree)).toBeLessThanOrEqual(5)
      expect(tour.fois).toBe("1")
    }

    await page.emulateMedia({ reducedMotion: "reduce" })
    for (const tour of await animations()) expect(tour.nom).toBe("none")
    const animees = await page.locator(".oto").evaluate((racine) =>
      [racine, ...racine.querySelectorAll("*")].flatMap((element) => element.getAnimations()).length,
    )
    expect(animees).toBe(0)
    await page.close()
  })

  test("should announce the link in the island of /login and bring the focus to its title", async ({ browser, baseURL }) => {
    const page = await ouvrir(browser, baseURL, { largeur: LARGEURS[0], schema: "light" })
    await page.goto("/login")
    await page.getByLabel("Adresse mail").fill(`test-${hex(6)}@example.invalid`)
    // L'adresse d'abord (2026-10-20) : « Continuer » montre ensuite le lien de connexion.
    await page.getByRole("button", { name: "Continuer", exact: true }).click()

    await page.getByRole("button", { name: "Recevoir un lien de connexion" }).click()

    // La région montée d'emblée est la première ; l'`Alert` du succès s'y loge.
    await expect(page.locator(".oto [role=status]").first()).toHaveText(MESSAGE_DU_LIEN)
    await expect(page.getByRole("heading", { level: 2, name: "Se connecter" })).toBeFocused()
    await page.close()
  })
})

// ── Contraste mesuré dans le navigateur, sur les huit thèmes, jour et nuit, aux deux largeurs (AC-x3 ; E05-S07, AC12) ──

type Mesure = { paire: string; ratio: number; seuil: number }

/**
 * Mesure, dans la page, les paires des écrans présentes : couleurs calculées (`rgb()` et `color(srgb …)`),
 * fond du premier ancêtre opaque, texte ou anneau translucide composé dessus. Les décors en
 * pseudo-éléments (grille, halo) ne comptent pas. L'anneau de l'élément focalisé se mesure sur le fond
 * qui l'entoure, celui de son parent. Le contour d'un champ est relevé contre l'îlot, au seuil du design
 * system (`--island-bd`, un filet à 1,3:1 au moins) : il est dit, pas tenu pour un texte.
 */
function mesurerLesPaires(): Mesure[] {
  type Rgba = [number, number, number, number]
  const lire = (couleur: string): Rgba | null => {
    const rgb = /^rgba?\(([^)]+)\)$/.exec(couleur.trim())
    if (rgb) {
      const [r, g, b, a] = rgb[1].split(/[\s,/]+/).filter(Boolean).map(Number)
      return [r / 255, g / 255, b / 255, a ?? 1]
    }
    const srgb = /^color\(srgb ([^)]+)\)$/.exec(couleur.trim())
    if (srgb) {
      const [r, g, b, a] = srgb[1].split(/[\s/]+/).filter(Boolean).map(Number)
      return [r, g, b, a ?? 1]
    }
    return null
  }
  const sur = (haut: Rgba, bas: Rgba): Rgba => [
    haut[0] * haut[3] + bas[0] * (1 - haut[3]),
    haut[1] * haut[3] + bas[1] * (1 - haut[3]),
    haut[2] * haut[3] + bas[2] * (1 - haut[3]),
    1,
  ]
  const luminance = ([r, g, b]: Rgba) => {
    const lineaire = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
    return 0.2126 * lineaire(r) + 0.7152 * lineaire(g) + 0.0722 * lineaire(b)
  }
  const rapport = (a: Rgba, b: Rgba) => {
    const [clair, fonce] = [luminance(a), luminance(b)].sort((x, y) => y - x)
    return (clair + 0.05) / (fonce + 0.05)
  }
  const fond = (element: Element | null): Rgba => {
    const couches: Rgba[] = []
    for (let courant = element; courant; courant = courant.parentElement) {
      const couleur = lire(getComputedStyle(courant).backgroundColor)
      if (couleur && couleur[3] > 0) {
        couches.push(couleur)
        if (couleur[3] >= 1) break
      }
    }
    return couches.reverse().reduce<Rgba>((bas, haut) => sur(haut, bas), [1, 1, 1, 1])
  }
  // La couleur de l'anneau : l'ombre à étalement non nul et non transparente.
  const anneau = (element: Element): Rgba | null => {
    const ombres = getComputedStyle(element).boxShadow.split(/,(?![^(]*\))/)
    for (const ombre of ombres) {
      const couleur = /(rgba?\([^)]*\)|color\(srgb [^)]*\))/.exec(ombre)
      const longueurs = ombre.replace(couleur?.[0] ?? "", "").trim().split(/\s+/).map((l) => Number.parseFloat(l))
      const lue = couleur ? lire(couleur[0]) : null
      if (lue && lue[3] > 0 && (longueurs[3] ?? 0) > 0) return lue
    }
    return null
  }
  // Hors de l'écran (l'enveloppe `sr-only` du panneau, sous 64 rem, un carré absolu d'un pixel), un texte
  // ne se voit pas : il ne se mesure pas.
  const horsEcran = (element: Element): boolean => {
    for (let courant: Element | null = element; courant; courant = courant.parentElement) {
      const boite = courant.getBoundingClientRect()
      if (getComputedStyle(courant).position === "absolute" && boite.width <= 1 && boite.height <= 1) return true
    }
    return false
  }
  const visible = (element: Element | null): element is Element =>
    Boolean(element && element.getClientRects().length > 0 && !horsEcran(element))

  const mesures: Mesure[] = []
  const texte = (paire: string, element: Element | null, seuil = 4.5) => {
    if (!visible(element)) return
    const couleur = lire(getComputedStyle(element).color)
    if (!couleur) return
    const dessous = fond(element)
    mesures.push({ paire, ratio: rapport(sur(couleur, dessous), dessous), seuil })
  }
  const focus = (paire: string, element: Element | null) => {
    if (!visible(element)) return
    const couleur = anneau(element)
    if (!couleur) return
    const dessous = fond(element.parentElement)
    mesures.push({ paire, ratio: rapport(sur(couleur, dessous), dessous), seuil: 3 })
  }
  const filet = (paire: string, element: Element | null) => {
    if (!visible(element)) return
    const couleur = lire(getComputedStyle(element).borderTopColor)
    if (!couleur) return
    const dessous = fond(element.parentElement)
    mesures.push({ paire, ratio: rapport(sur(couleur, dessous), dessous), seuil: 1.3 })
  }

  // Le panneau d'encre (dès 64 rem) ou la marque compacte (en dessous) : `texte` ignore l'élément caché.
  const panneau = document.querySelector(".oto-brand-panel")
  texte("rail-fg/rail-bg (h1 du panneau)", panneau?.querySelector("h1") ?? null)
  texte("rail-fg/rail-bg (phrase)", document.querySelector(".oto-brand-say"))
  document.querySelectorAll(".oto-brand-bar span").forEach((repere) => texte("rail-mute/rail-bg (barre)", repere))
  texte("accord : rail-on-bg/rail-bg", document.querySelector(".oto-brand-key"), 3)
  document.querySelectorAll("main p.oto-page-title").forEach((titre) => texte("ink/desk (marque compacte)", titre))
  document.querySelectorAll("main p.oto-caption").forEach((legende) => {
    texte("mute/desk ou îlot (légende)", legende)
    legende.querySelectorAll("a").forEach((lien) => texte("mute/desk ou îlot (lien de légende)", lien))
  })
  texte("ink/desk (organisation)", document.querySelector("main p.font-semibold span:last-child"))

  const ilot = document.querySelector("main section:not(.oto-brand-panel)")
  texte("title/bande (h2)", ilot?.querySelector("h2") ?? null)
  ilot?.querySelectorAll("label").forEach((libelle) => texte("ink/island (libellé)", libelle))
  ilot?.querySelectorAll(".oto-field-error").forEach((erreur) => texte("st-fail-text/island (erreur de champ)", erreur))
  ilot?.querySelectorAll(".oto-alert-title").forEach((titre) => texte("ink/teinte (titre d'alerte)", titre))
  ilot?.querySelectorAll(".oto-alert-desc").forEach((description) => texte("mute/teinte (description d'alerte)", description))
  ilot?.querySelectorAll(".oto-btn").forEach((bouton) => texte("bouton : texte/fond", bouton))

  const focalise = document.activeElement
  ilot?.querySelectorAll("input:not([type=hidden])").forEach((champ) => {
    if (champ !== focalise) filet("contour de champ : island-bd (design system)", champ)
  })
  if (focalise && focalise !== document.body) {
    const surLIlot = Boolean(ilot?.contains(focalise))
    focus(surLIlot ? "focus : ink/island" : "focus : ink/desk", focalise)
  }
  return mesures
}

/**
 * Attend la fin des transitions de couleur : boutons et champs du design system passent d'un thème à
 * l'autre en `--tr-colors` ; mesurés pendant ce passage, ils mêlent deux thèmes (constaté à la première
 * campagne de la partie d3 : des ratios de bouton de 1,19 à 4,19, jamais les mêmes d'un passage à l'autre).
 */
async function transitionsFinies(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation instanceof CSSTransition)
        // Une transition remplacée rejette sa promesse : celle qui la remplace est attendue à sa place.
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  )
}

const PAGES_MESUREES = [
  { nom: "connexion", chemin: "/login?error=oauth" },
  { nom: "mot-de-passe-oublie", chemin: "/forgot-password" },
] as const

test.describe("contraste des paires, huit thèmes (AC-x3 ; E05-S07, AC12)", () => {
  test.skip(!supabaseConfigured, "set the Supabase variables in .env.local")

  for (const ecran of PAGES_MESUREES) {
    for (const largeur of LARGEURS) {
      for (const schema of SCHEMAS) {
        test(`${ecran.nom} at ${largeur.nom} px (${schema})`, async ({ browser, baseURL }, testInfo) => {
          const page = await ouvrir(browser, baseURL, { largeur, schema })
          await page.goto(ecran.chemin)
          await expect(page.getByRole("heading", { level: 1 })).toHaveText("Oto")
          if (schema === "dark") await expect(page.locator("html")).toHaveClass(/\bdark\b/)

          const mesures: (Mesure & { theme: string })[] = []
          for (const theme of OTO_THEMES) {
            // Posé sur la racine, rien d'écrit en base.
            await page.locator(".oto").evaluate((racine, valeur) => racine.setAttribute("data-oto-theme", valeur), theme)
            // Sans focus : textes et contours ; puis le champ focalisé (anneau sur l'îlot) ; puis, sur
            // `/forgot-password`, le lien de la légende, atteint au clavier (anneau sur le bureau). Le champ
            // vidé puis quitté est refusé (validation à la sortie) : son erreur se mesure avec les textes.
            await page.getByLabel("Adresse mail").fill("")
            await page.evaluate(() => {
              const actif = document.activeElement
              if (actif instanceof HTMLElement) actif.blur()
            })
            await transitionsFinies(page)
            mesures.push(...(await page.evaluate(mesurerLesPaires)).map((m) => ({ ...m, theme })))
            // Les huit thèmes à l'œil (AC-x3) : une capture de `/login` par thème, à 1 280 px.
            if (ecran.nom === "connexion" && largeur.nom === "1280") {
              await page.screenshot({ path: testInfo.outputPath(`auth-connexion-${theme}-${schema}.png`), animations: "disabled" })
            }
            // L'anneau mesuré est celui d'un champ valide : une adresse saisie puis quittée lève le refus
            // (validation à la sortie) ; refusé, le champ porte le halo d'erreur du design system
            // (`_interaction.css`), relevé à part (HN-E05S09d3-16).
            await page.getByLabel("Adresse mail").fill("e2e@example.invalid")
            await page.getByLabel("Adresse mail").blur()
            await expect(page.getByLabel("Adresse mail")).not.toHaveAttribute("aria-invalid", "true")
            await page.getByLabel("Adresse mail").focus()
            await transitionsFinies(page)
            mesures.push(...(await page.evaluate(mesurerLesPaires)).filter((m) => m.paire.startsWith("focus")).map((m) => ({ ...m, theme })))
            if (ecran.nom === "mot-de-passe-oublie") {
              await page.keyboard.press("Tab")
              await page.keyboard.press("Tab")
              await expect(page.getByRole("link", { name: "Se connecter" })).toBeFocused()
              await transitionsFinies(page)
              mesures.push(...(await page.evaluate(mesurerLesPaires)).filter((m) => m.paire.startsWith("focus")).map((m) => ({ ...m, theme })))
            }
          }

          const minima: Record<string, { ratio: number; theme: string; seuil: number }> = {}
          for (const { paire, ratio, seuil, theme } of mesures) {
            if (!minima[paire] || ratio < minima[paire].ratio) minima[paire] = { ratio: Math.round(ratio * 100) / 100, theme, seuil }
          }
          fs.writeFileSync(testInfo.outputPath("contrastes.json"), JSON.stringify({ ecran: ecran.nom, largeur: largeur.nom, schema, minima }, null, 2))
          await testInfo.attach("contrastes", { body: JSON.stringify(minima, null, 2), contentType: "application/json" })

          expect(mesures.length).toBeGreaterThan(0)
          const sousLeSeuil = mesures.filter((m) => m.ratio < m.seuil).map((m) => `${m.theme} ${m.paire} ${m.ratio.toFixed(2)}`)
          expect(sousLeSeuil).toEqual([])
          await page.close()
        })
      }
    }
  }
})
