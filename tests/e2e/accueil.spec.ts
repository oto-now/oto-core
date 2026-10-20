import { expect, test } from "@playwright/test"
import { clientAuth } from "./fixtures/base"
import { auRepos } from "./fixtures/au-repos"
import { seConnecterSurLEspace } from "./fixtures/noeud"
import { ESPACE, SANS_ESPACE } from "./fixtures/espace"

// L'accueil porté d'oto-frontend (E05-S09, partie b), en contrôle visuel connecté : le compte E2E,
// administrateur de l'organisation de la campagne (`espace.ts`), en clair puis en sombre. La connexion ouvre
// l'accueil ; le champ de recherche ouvre la palette du rail ; « Brancher » ouvre la grande fenêtre du guide
// (E11-S09, AC-10, AC-16) : l'adresse du serveur de l'adresse dans l'onglet ouvert, la flèche → passe à
// ChatGPT, Échap ferme et rend le focus à « Brancher », rien ne déborde à 375 px ; aucune erreur
// d'hydratation. Captures de l'accueil pour la comparaison avec `reel-01-accueil.png` (AC-x1), puis dans
// les huit thèmes, posés sur la racine `.oto` de la page, sans écrire la marque (AC-x3).

const email = process.env.E2E_USER_EMAIL ?? ""
const password = process.env.E2E_USER_PASSWORD ?? ""
const ADRESSE = ESPACE.adresse
const BRANCHER = "Brancher votre assistant"
/** La fenêtre du guide garde le titre long. */
const GUIDE = "Brancher mon Claude, ChatGPT ou Mistral"
const MODES = ["light", "dark"] as const
const THEMES = ["manuscrit", "ardoise", "grenat", "brique", "foret", "lagune", "cobalt", "violet"]

test.describe("l'accueil", () => {
  test.skip(!ESPACE.semee, SANS_ESPACE)

  test.beforeAll(async () => {
    const { error } = await clientAuth().auth.signInWithPassword({ email, password })
    test.skip(error !== null, "E2E account missing from the Supabase project: run pnpm demo:seed (E01-S05)")
  })

  for (const mode of MODES) {
    test(`should greet, search through the rail's palette and open the guide of Brancher (${mode})`, async ({ browser }, testInfo) => {
      // La taille de la capture de référence d'oto-frontend (`reel-01-accueil.png`), pour la comparer côte à côte.
      const page = await browser.newPage({ colorScheme: mode, viewport: { width: 1500, height: 770 } })
      const hydratation: string[] = []
      page.on("console", (message) => {
        if (message.type() === "error" && /hydrat/i.test(message.text())) hydratation.push(`${page.url()} :: ${message.text().slice(0, 1500)}`)
      })
      try {
        await seConnecterSurLEspace(page, { email, password })
        await expect(page).toHaveURL(`${ADRESSE}/`)
        await expect(page).toHaveTitle(/^Accueil/)
        const contenu = page.getByRole("main")
        await expect(contenu.getByRole("heading", { level: 1, name: /^Bonjour/ })).toBeVisible()
        await expect(contenu.getByRole("region", { name: BRANCHER })).toBeVisible()
        await auRepos(contenu)
        // `caret: "initial"` : la capture n'écrit rien dans la page, l'hydratation reste gardée.
        await page.screenshot({ path: testInfo.outputPath(`accueil-${mode}.png`), caret: "initial" })

        // 1.4.13 : l'accueil n'a plus de recherche, celle du rail s'ouvre au clavier.
        await expect(contenu.getByRole("search")).toHaveCount(0)
        await page.keyboard.press("ControlOrMeta+k")
        const palette = page.getByRole("dialog", { name: "Palette de commandes" })
        await expect(palette).toBeVisible()
        await page.keyboard.press("Escape")
        await expect(palette).toBeHidden()

        const brancher = contenu.getByRole("region", { name: BRANCHER }).getByRole("button", { name: "Brancher" })
        await brancher.click()
        const dialogue = page.getByRole("dialog", { name: GUIDE })
        await expect(dialogue).toHaveAttribute("data-size", "lg")
        await expect(dialogue.getByRole("tabpanel").getByText(`${ADRESSE}/api/mcp`, { exact: true })).toBeVisible()
        await expect(dialogue.getByRole("link", { name: /Guides d'installation/ })).toHaveCount(0)
        const choisi = dialogue.getByRole("tab", { selected: true })
        await choisi.focus()
        await page.keyboard.press("ArrowRight")
        await expect(dialogue.getByRole("tab", { name: "ChatGPT" })).toBeFocused()
        await expect(dialogue.getByRole("tabpanel", { name: "ChatGPT" })).toBeVisible()
        await auRepos(dialogue)
        await page.screenshot({ path: testInfo.outputPath(`accueil-brancher-${mode}.png`), caret: "initial" })
        await dialogue.getByRole("tab", { name: "Mistral" }).click()
        await auRepos(dialogue)
        await page.screenshot({ path: testInfo.outputPath(`accueil-brancher-mistral-${mode}.png`), caret: "initial" })
        // À 375 px, la page ne défile pas en largeur : le corps de la fenêtre défile seul (AC-10).
        await page.setViewportSize({ width: 375, height: 800 })
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
        await auRepos(dialogue)
        await page.screenshot({ path: testInfo.outputPath(`accueil-brancher-375-${mode}.png`), caret: "initial" })
        await page.setViewportSize({ width: 1500, height: 770 })
        await page.keyboard.press("Escape")
        await expect(dialogue).toBeHidden()
        await expect(brancher).toBeFocused()
        for (const theme of THEMES) {
          await page.evaluate((cle) => document.querySelector(".oto")?.setAttribute("data-oto-theme", cle), theme)
          await auRepos(contenu)
          await contenu.screenshot({ path: testInfo.outputPath(`accueil-${theme}-${mode}.png`), caret: "initial" })
        }
        await page.evaluate(() => document.querySelector(".oto")?.removeAttribute("data-oto-theme"))

        // E05-S12 (AC-19) : les activités à 375, 1 024 et 1 280 px ; une activité tient sur une ligne à partir de
        // 1 024 px (son nom, ce qui est arrivé et l'heure sur la même rangée, la phrase sur une ligne), aucun
        // défilement horizontal à 375 px.
        const fil = contenu.getByRole("region", { name: "Reprendre" })
        await fil.getByRole("tab", { name: "Fil" }).click()
        await expect(fil.locator(".oto-feed-item").first()).toBeVisible()
        for (const largeur of [375, 1024, 1280]) {
          await page.setViewportSize({ width: largeur, height: 900 })
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
          if (largeur >= 1024) {
            const surUneLigne = await fil.locator(".oto-feed-item").evaluateAll((lignes) =>
              lignes.map((ligne) => {
                const [nom, quoi, quand] = [".oto-feed-name", ".oto-feed-what", ".oto-feed-when"].map((classe) => ligne.querySelector(classe)?.getBoundingClientRect())
                if (!nom || !quoi || !quand) return false
                return quoi.height <= nom.height + 2 && Math.abs(quoi.top - nom.top) < 6 && Math.abs(quand.bottom - quoi.bottom) < 8
              }),
            )
            expect(surUneLigne.every(Boolean)).toBe(true)
          }
          await auRepos(contenu)
          await page.screenshot({ path: testInfo.outputPath(`accueil-activites-${largeur}-${mode}.png`), fullPage: true, caret: "initial" })
        }
        await page.setViewportSize({ width: 1500, height: 770 })

        // E11-S10 (AC-e1 à AC-e3) : l'accueil sans onglets ; la vue « Contexte », ce que lit l'assistant partie par
        // partie, sans chiffres (E05-S13, AC-13), ouverte par le menu du compte à `/context`, à 375 et 1 280 px, sans
        // défilement horizontal ; dans la même session (la connexion est limitée à cinq par minute).
        await expect(contenu.getByRole("tablist")).toHaveCount(0)
        await page.getByRole("button", { name: /^Compte : .*Ouvrir le menu$/ }).click()
        await page.getByRole("menu").getByRole("menuitem", { name: "Contexte" }).click()
        await expect(page).toHaveURL(`${ADRESSE}/context`, { timeout: 60_000 })
        await expect(contenu.getByRole("heading", { level: 1, name: "Contexte" })).toBeVisible({ timeout: 60_000 })
        const vue = contenu
        // La partie Tout le monde : la même avant et après le regroupement des faits (E05-S12, D109).
        await expect(vue.getByRole("region", { name: "Contexte : Tout le monde" })).toHaveAttribute("id", "everyone-context", { timeout: 60_000 })
        await expect(vue.getByText(/caractères sur|reflète les versions/)).toHaveCount(0)
        for (const largeur of [375, 1280]) {
          await page.setViewportSize({ width: largeur, height: 900 })
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
          await auRepos(contenu)
          await page.screenshot({ path: testInfo.outputPath(`contexte-${largeur}-${mode}.png`), fullPage: true, caret: "initial" })
        }
        expect(hydratation).toEqual([])
      } finally {
        await page.close()
      }
    })
  }
})
