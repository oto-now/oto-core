import { randomBytes } from "node:crypto"
import { expect, test } from "@playwright/test"
import { auRepos } from "./fixtures/au-repos"
import { clientAuth } from "./fixtures/base"
import { seConnecterSurLEspace } from "./fixtures/noeud"
import { CHEMINS, EQUIPE, ESPACE, PROCEDURE, SANS_ESPACE } from "./fixtures/espace"

// Le rail, la seule coque (E05-S09, partie a), en contrôle visuel connecté : le compte E2E,
// administrateur de l'organisation de la campagne (`espace.ts`), en clair puis en sombre. Une seule navigation
// (AC-a2) ; une ligne ouvre sa page par le lien de l'hôte, sans recharger le document, et devient la ligne
// courante (AC-a6) ; la procédure de l'équipe est dans l'arbre (AC-a5) ; ⌘K ouvre la palette, qui trouve et
// ouvre un nœud (AC-a7) ; le menu de l'entreprise porte les réglages, Journal compris, sans Usage (AC-a4 ;
// E05-S13, AC-8, AC-10). Captures du rail dans les huit thèmes, posés sur la racine `.oto` de la page, sans
// écrire la marque (AC-x1, AC-x3). E11-S20 (AC-3) : une page écrite dans un autre onglet, comme par un assistant,
// paraît dans le rail à la navigation suivante, sans recharger le document ; page jetable, mise à la corbeille à la fin.

const email = process.env.E2E_USER_EMAIL ?? ""
const password = process.env.E2E_USER_PASSWORD ?? ""
const MODES = ["light", "dark"] as const
const THEMES = ["manuscrit", "ardoise", "grenat", "brique", "foret", "lagune", "cobalt", "violet"]

test.describe("le rail", () => {
  test.skip(!ESPACE.semee, SANS_ESPACE)

  test.beforeAll(async () => {
    const { error } = await clientAuth().auth.signInWithPassword({ email, password })
    test.skip(error !== null, "E2E account missing from the Supabase project: run pnpm demo:seed (E01-S05)")
  })

  for (const mode of MODES) {
    test(`should navigate by the rail without reloading, search with ⌘K and open the company menu (${mode})`, async ({ browser }, testInfo) => {
      const page = await browser.newPage({ colorScheme: mode, viewport: { width: 1440, height: 900 } })
      try {
        await seConnecterSurLEspace(page, { email, password })
        const rail = page.getByRole("navigation", { name: "Navigation principale" })
        await expect(page.getByRole("navigation")).toHaveCount(1)
        // Le déclencheur du tiroir n'existe que sous 1 024 px (fiche D90 B).
        await expect(page.getByRole("button", { name: "Menu", exact: true })).toBeHidden()

        // Un rechargement du document emporterait cette marque ; une navigation de l'hôte la garde.
        await page.evaluate(() => {
          document.body.dataset.sansRechargement = "oui"
        })
        await rail.getByRole("link", { name: "Contexte · Tout le monde" }).click()
        await expect(page).toHaveURL(`${ESPACE.adresse}/n/contexte`)
        await expect(rail.getByRole("link", { name: "Contexte · Tout le monde" })).toHaveAttribute("aria-current", "page")
        expect(await page.evaluate(() => document.body.dataset.sansRechargement)).toBe("oui")
        await expect(rail.getByRole("link", { name: PROCEDURE })).toHaveAttribute("href", `/n/${CHEMINS.procedure}`)
        // La page du Contexte chargée, la ligne quittée revenue au repos : la capture se compare à `noeud-vide.png`.
        await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toBeVisible()
        await auRepos(rail)
        await page.screenshot({ path: testInfo.outputPath(`rail-${mode}.png`) })

        await page.keyboard.press("Control+k")
        const palette = page.getByRole("dialog", { name: "Palette de commandes" })
        await expect(palette).toBeVisible()
        await palette.getByRole("combobox").fill("qualifier")
        await expect(palette.getByRole("group", { name: "Procédures" })).toBeVisible()
        // La recherche dans le contenu part après la pause de frappe, et sa route se compile à son premier appel
        // sur le serveur de développement, partagé par les agents : jusqu'au-delà des 5 s par défaut (M48).
        await expect(palette.getByRole("group", { name: "Dans le contenu" })).toBeVisible({ timeout: 60_000 })
        await auRepos(palette)
        await page.screenshot({ path: testInfo.outputPath(`palette-${mode}.png`) })
        await palette.getByRole("group", { name: "Procédures" }).getByRole("option", { name: PROCEDURE }).click()
        await expect(page).toHaveURL(`${ESPACE.adresse}/n/${CHEMINS.procedure}`)

        await rail.getByRole("button", { name: /^Entreprise : / }).click()
        // 1.4.13 : « Activité » réunit Statistiques et Journal ; aucune des deux n'a d'entrée à part.
        await expect(page.getByRole("menu").getByRole("menuitem", { name: "Activité" })).toBeVisible()
        await expect(page.getByRole("menu").getByRole("menuitem", { name: "Journal" })).toHaveCount(0)
        await expect(page.getByRole("menu").getByRole("menuitem", { name: "Statistiques" })).toHaveCount(0)
        await auRepos(page.getByRole("menu"))
        await page.screenshot({ path: testInfo.outputPath(`menu-entreprise-${mode}.png`) })
        await page.keyboard.press("Escape")

        for (const theme of THEMES) {
          await page.evaluate((cle) => document.querySelector(".oto")?.setAttribute("data-oto-theme", cle), theme)
          await auRepos(rail)
          await rail.screenshot({ path: testInfo.outputPath(`rail-${theme}-${mode}.png`) })
        }
      } finally {
        await page.close()
      }
    })

    // E11-S20 (AC-3) : l'arbre relu seul à la navigation client, le layout de l'hôte n'étant pas rejoué.
    test(`should show in the rail a page written in another tab at the next navigation, without reloading (${mode})`, async ({ browser }) => {
      const context = await browser.newContext({ colorScheme: mode, viewport: { width: 1440, height: 900 } })
      const page = await context.newPage()
      const chemin = `${EQUIPE.slug}/essai_e11s20_${randomBytes(3).toString("hex")}`
      const titre = `Essai E11-S20 ${chemin.slice(-6)}`
      try {
        await seConnecterSurLEspace(page, { email, password })
        const rail = page.getByRole("navigation", { name: "Navigation principale" })
        await page.evaluate(() => {
          document.body.dataset.sansRechargement = "oui"
        })

        // L'autre onglet, sous la même session : la page s'écrit par l'API du paquet, comme la création du rail.
        const autre = await context.newPage()
        await autre.goto(`${ESPACE.adresse}/`)
        const issue = await autre.evaluate(
          async (corps) => {
            const reponse = await fetch("/api/platform/nodes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corps) })
            return reponse.ok ? "écrite" : await reponse.text()
          },
          { path: chemin, title: titre, summary: "Page jetable du contrôle d'E11-S20.", kind: "page" },
        )
        expect(issue).toBe("écrite")
        await autre.close()

        await rail.getByRole("link", { name: "Contexte · Tout le monde" }).click()
        await expect(page).toHaveURL(`${ESPACE.adresse}/n/contexte`)
        await expect(rail.getByRole("link", { name: titre })).toBeVisible()
        expect(await page.evaluate(() => document.body.dataset.sansRechargement)).toBe("oui")
      } finally {
        await page
          .evaluate(async (path) => {
            await fetch("/api/platform/trash", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path }) })
          }, chemin)
          .catch(() => {})
        await context.close()
      }
    })

    // Fiche D90 B (M39) : à 375 px, « Menu » ouvre le rail en tiroir, Échap le ferme et rend le focus au bouton.
    test(`should open the rail as a drawer from « Menu » at 375 px, then close it with Échap (${mode})`, async ({ browser }, testInfo) => {
      const page = await browser.newPage({ colorScheme: mode, viewport: { width: 375, height: 812 } })
      try {
        await seConnecterSurLEspace(page, { email, password })
        const menu = page.getByRole("button", { name: "Menu", exact: true })
        const tiroir = page.locator("nav.oto-rail")
        await expect(menu).toBeVisible()
        await expect(tiroir).not.toBeInViewport()
        await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toBeVisible()
        await page.screenshot({ path: testInfo.outputPath(`tiroir-ferme-${mode}.png`) })

        await menu.click()
        await expect(tiroir).toHaveAttribute("data-open", "")
        await auRepos(tiroir)
        await expect(tiroir).toBeInViewport({ ratio: 1 })
        await page.screenshot({ path: testInfo.outputPath(`tiroir-ouvert-${mode}.png`) })

        await page.keyboard.press("Escape")
        await expect(tiroir).not.toHaveAttribute("data-open")
        await expect(menu).toBeFocused()
      } finally {
        await page.close()
      }
    })
  }
})
