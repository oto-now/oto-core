import { expect, test, type Page, type TestInfo } from "@playwright/test"
import { clientAuth } from "./fixtures/base"
import { seConnecterSurLEspace } from "./fixtures/noeud"
import { ESPACE, SANS_ESPACE } from "./fixtures/espace"

// Contrôle visuel connecté du journal, porté d'oto-frontend (E05-S09 partie d1 : AC-d1, AC-x1, AC-x3 ;
// E05-S05 : AC15) : le compte E2E, administrateur de l'organisation de la campagne (`espace.ts`, semée par la
// section `journal`), ouvre `/journal`, en clair puis en sombre : les trois conversations fictives `DEMO-000x`,
// le filtre « Erreurs seulement » qui ne garde que la troisième, son détail dans le tiroir, avec l'appel en échec
// et ses arguments masqués ; la valeur fictive `demo-secret`, écrite telle quelle par le script, n'est nulle part
// dans la page ; fermer le tiroir rend le focus à « Ouvrir ». Captures des huit thèmes, posés sur la racine
// `.oto` de la page, sans écrire la marque. Captures dans `test-results/`.

const email = process.env.E2E_USER_EMAIL ?? ""
const password = process.env.E2E_USER_PASSWORD ?? ""
const MODES = ["light", "dark"] as const
const THEMES = ["manuscrit", "ardoise", "grenat", "brique", "foret", "lagune", "cobalt", "violet"]
const CODES = ["DEMO-0001", "DEMO-0002", "DEMO-0003"]

const ouvrir = (page: Page, code: string) => page.getByRole("link", { name: `Ouvrir la conversation ${code}` })

/**
 * Une capture au repos : Playwright mène les entrées et les transitions à leur fin, et arrête les boucles.
 * Attendre `finished` de chaque animation laissait la capture pendue au contrôle visuel (délai dépassé).
 */
async function capturer(page: Page, testInfo: TestInfo, nom: string): Promise<void> {
  await page.screenshot({ path: testInfo.outputPath(`${nom}.png`), caret: "initial", animations: "disabled" })
}

test.describe("journal", () => {
  test.skip(!ESPACE.semee, SANS_ESPACE)
  // Un parcours de plusieurs routes, compilées à la demande par `next dev` sur la machine partagée : 30 s ne suffisent pas.
  test.slow()

  test.beforeAll(async () => {
    const { error } = await clientAuth().auth.signInWithPassword({ email, password })
    test.skip(error !== null, "E2E account missing from the Supabase project: run pnpm demo:seed (E01-S05)")
  })

  for (const mode of MODES) {
    test(`should show the demo conversations, keep the failed one under « Erreurs seulement » and mask its arguments in the drawer (${mode})`, async ({ browser }, testInfo) => {
      const page = await browser.newPage({ colorScheme: mode, viewport: { width: 1440, height: 900 } })
      try {
        await seConnecterSurLEspace(page, { email, password })
        // 1.4.13 : le journal est l'onglet Journal d'« Activité » ; un administrateur ouvre d'abord les statistiques.
        await page.goto(`${ESPACE.adresse}/journal?tab=journal`)
        await expect(page.getByRole("heading", { level: 1 })).toHaveText("Activité")
        await expect(page.getByRole("tab", { name: "Journal" })).toHaveAttribute("aria-selected", "true")
        await expect(page.getByRole("radiogroup", { name: "La période observée" }).getByRole("radio", { name: "7 jours" })).toHaveAttribute("aria-checked", "true")
        for (const code of CODES) await expect(ouvrir(page, code)).toBeVisible()
        await capturer(page, testInfo, `journal-liste-${mode}`)

        // La case du design system est masquée sous son libellé, qui reçoit le clic : on clique où clique la personne.
        await page.locator("label.oto-choice", { hasText: "Erreurs seulement" }).click()
        await expect(page.getByRole("checkbox", { name: "Erreurs seulement" })).toBeChecked()
        await page.getByRole("button", { name: "Filtrer" }).click()
        await page.waitForURL(/[?&]erreurs=1/)
        await expect(ouvrir(page, "DEMO-0003")).toBeVisible()
        for (const code of CODES.slice(0, 2)) await expect(ouvrir(page, code)).toHaveCount(0)

        await ouvrir(page, "DEMO-0003").click()
        const tiroir = page.getByRole("dialog", { name: "Conversation DEMO-0003" })
        await expect(tiroir).toBeVisible()
        const echec = tiroir.getByRole("listitem").filter({ hasText: "Échec" })
        await expect(echec).toContainText("invalid_arguments: Unknown column « statut »")
        await echec.getByText("Arguments", { exact: true }).click()
        await expect(echec.locator("pre")).toContainText('"api_token": "[masked]"')
        // Une valeur fictive (ADR-010) : le constat nomme le cas, jamais la page entière.
        expect((await page.content()).includes("demo-secret"), "demo-secret in the page").toBe(false)
        await capturer(page, testInfo, `journal-${mode}`)

        await tiroir.getByRole("button", { name: "Fermer le détail" }).click()
        await expect(tiroir).toBeHidden()
        await expect(page).not.toHaveURL(/conversation=/)
        await expect(ouvrir(page, "DEMO-0003")).toBeFocused()

        for (const theme of THEMES) {
          await page.evaluate((cle) => document.querySelector(".oto")?.setAttribute("data-oto-theme", cle), theme)
          await capturer(page, testInfo, `journal-${theme}-${mode}`)
        }

        // Sous la largeur de référence, le tableau défile dans son cadre, jamais la page (tables-patterns.md § Accessibilité).
        await page.setViewportSize({ width: 1280, height: 900 })
        const debord = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
        expect(debord, "horizontal page scroll at 1280 px").toBeLessThanOrEqual(0)
        await capturer(page, testInfo, `journal-1280-${mode}`)
      } finally {
        await page.close()
      }
    })
  }
})
