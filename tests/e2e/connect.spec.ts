import { expect, test } from "@playwright/test"
import { OTO_THEMES } from "../../packages/plateforme/schemas/brand"
import { supabaseConfigured } from "../helpers/plateforme"
import { baseAdminConfiguree, clientAuth, demoServieALocalhost, SANS_BASE_ADMIN } from "./fixtures/base"
import { seConnecter } from "./fixtures/connexion"
import { DEMO as DEMO_SERVIE } from "./fixtures/espace"

// Contrôle visuel connecté de « Brancher mon Claude, ChatGPT ou Mistral » (E02-S04, AC10, AC12 ; E11-S09,
// AC-12, AC-14, AC-16), porté sur le design system d'oto-frontend (E05-S09, partie d3 : AC-x1, AC-x3) : le
// compte E2E, membre de Démo (`pnpm demo:seed`), ouvre `/connect` depuis le menu du compte, au pied du rail
// (E05-S09, AC-a4), en clair puis en sombre : le guide en deux temps, sans onglets, la copie de l'adresse
// relue dans le presse-papiers, le titre et `noindex` ; une capture par mode, puis une par thème posé sur la
// racine, dans `test-results/`.

const email = process.env.E2E_USER_EMAIL ?? ""
const password = process.env.E2E_USER_PASSWORD ?? ""
const DEMO = DEMO_SERVIE.adresse
const ADRESSE = `${DEMO}/api/mcp`
const THEMES = ["light", "dark"] as const
const TITRE = "Brancher mon Claude, ChatGPT ou Mistral"

test.describe("brancher mon assistant", () => {
  test.skip(!email || !password || !supabaseConfigured, "set E2E_USER_EMAIL, E2E_USER_PASSWORD and the Supabase variables in .env.local")

  test.beforeAll(async () => {
    const { error } = await clientAuth().auth.signInWithPassword({ email, password })
    test.skip(error !== null, "E2E account missing from the Supabase project: run pnpm demo:seed (E01-S05)")
    // Sans `localhost` dans les domaines de Démo, la connexion finit sur « Adresse inconnue » : la spec se saute
    // en le disant, comme l'authentification et le consentement, au lieu d'attendre le menu du compte.
    test.skip(!baseAdminConfiguree, SANS_BASE_ADMIN)
    test.skip(!(await demoServieALocalhost()), "Démo is not served at localhost: run pnpm demo:seed (E01-S05)")
  })

  for (const theme of THEMES) {
    test(`should give the guide in two times, and copy the address (${theme})`, async ({ browser }, testInfo) => {
      const context = await browser.newContext({ colorScheme: theme })
      // La copie se relit dans le presse-papiers : permission accordée au contexte (AC12).
      await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: DEMO })
      const page = await context.newPage()
      await seConnecter(page, { baseURL: DEMO, email, password })
      const navigation = page.getByRole("navigation", { name: "Navigation principale" })
      await navigation.getByRole("button", { name: /^Compte : .+\. Ouvrir le menu$/ }).click()
      await page.getByRole("menu").getByRole("menuitem", { name: TITRE, exact: true }).click()
      await expect(page).toHaveURL(`${DEMO}/connect`)

      await expect(page.getByRole("heading", { level: 1 })).toHaveText(TITRE)
      await expect(page).toHaveTitle(new RegExp(`^${TITRE}`))
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/)

      await expect(page.getByRole("tablist")).toHaveCount(0)
      const adresse = page.locator("dd").filter({ hasText: ADRESSE })
      await expect(adresse.locator("code")).toHaveText(ADRESSE)
      await expect(page.getByRole("heading", { level: 2, name: "Adresse du serveur" })).toHaveCount(0)

      await adresse.getByRole("button", { name: "Copier l'adresse du serveur" }).click()
      await expect(adresse.getByRole("status")).toHaveText("Copié")
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(ADRESSE)
      // Sous la coque unique (E05-S09), le contenu défile dans le bureau, jamais la fenêtre : un texte
      // `sr-only` sous la ligne de flottaison (« Copier » d'un guide) n'allonge pas le document.
      expect(await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)).toBeLessThanOrEqual(0)

      await page.screenshot({ path: testInfo.outputPath(`connect-${theme}.png`), fullPage: true })
      // Les huit thèmes à l'œil (AC-x3) : posés sur la racine, rien d'écrit en base.
      for (const teinte of OTO_THEMES) {
        await page.locator(".oto").first().evaluate((racine, valeur) => racine.setAttribute("data-oto-theme", valeur), teinte)
        await page.screenshot({ path: testInfo.outputPath(`connect-${teinte}-${theme}.png`), animations: "disabled" })
      }
      await context.close()
    })
  }
})
