import { expect, test } from "@playwright/test"
import { clientAuth } from "./fixtures/base"
import { CHEMINS, ESPACE, SANS_ESPACE } from "./fixtures/espace"
import { seConnecterSurLEspace } from "./fixtures/noeud"

// Les écrans étroits (1.4.10) : sous 1 024 px, le rail est un tiroir ouvert par « Menu », qui garde les noms des pages ;
// réduit à ses icônes entre 768 et 1 024 px, un arbre ne se lisait plus. Sur un téléphone, le titre d'un nœud et le
// début de son contenu tiennent dans le premier écran. Une mise en page se mesure dans un navigateur.

const email = process.env.E2E_USER_EMAIL ?? ""
const password = process.env.E2E_USER_PASSWORD ?? ""

test.describe("écrans étroits", () => {
  test.skip(!ESPACE.semee, SANS_ESPACE)

  test.beforeAll(async () => {
    const { error } = await clientAuth().auth.signInWithPassword({ email, password })
    test.skip(error !== null, "E2E account missing from the Supabase project: run pnpm demo:seed (E01-S05)")
  })

  test("should open the rail as a drawer under 1 024 px, page names readable", async ({ browser }, testInfo) => {
    test.setTimeout(180_000)
    const page = await browser.newPage({ viewport: { width: 900, height: 800 } })
    try {
      await seConnecterSurLEspace(page, { email, password })
      const rail = page.getByRole("navigation", { name: "Navigation principale", includeHidden: true })
      // Fermé, le tiroir est hors de l'écran, caché aux lecteurs d'écran et hors de la tabulation.
      await expect(rail).toHaveAttribute("aria-hidden", "true")
      await page.getByRole("button", { name: "Menu", exact: true }).click()
      const ligne = page.getByRole("navigation", { name: "Navigation principale" }).getByRole("link", { name: "Contexte · Tout le monde" })
      await expect(ligne).toBeVisible()
      // Le nom se lit en entier, pas en infobulle : sa boîte a la largeur des mots.
      expect((await ligne.boundingBox())?.width ?? 0).toBeGreaterThan(120)
      await page.screenshot({ path: testInfo.outputPath("rail-tiroir-900.png") })
    } finally {
      await page.close()
    }
  })

  test("should show the title of a node and the start of its content in the first screen of a phone", async ({ browser }, testInfo) => {
    test.setTimeout(180_000)
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    try {
      await seConnecterSurLEspace(page, { email, password })
      await page.goto(`${ESPACE.adresse}/n/${CHEMINS.procedure}`)
      await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toBeVisible()
      await expect(page.getByRole("navigation", { name: "Chemin" })).toBeVisible()
      const premierBloc = page.locator("[data-cle]").first()
      await expect(premierBloc).toBeVisible()
      // Le bouton « Menu » sur la ligne du fil, à sa gauche, sans le chevaucher : plus de rangée à lui seul.
      const menu = await page.getByRole("button", { name: "Menu", exact: true }).boundingBox()
      const fil = await page.getByRole("navigation", { name: "Chemin" }).boundingBox()
      if (!menu || !fil) throw new Error("bouton Menu ou fil sans boîte")
      expect(Math.abs(menu.y + menu.height / 2 - (fil.y + fil.height / 2))).toBeLessThanOrEqual(4)
      expect(menu.x + menu.width).toBeLessThanOrEqual(fil.x)
      const hautDuBloc = (await premierBloc.boundingBox())?.y ?? Infinity
      console.log(`mobile 390 : menu à ${menu.y} px, fil à ${fil.y} px, premier bloc à ${hautDuBloc} px`)
      await page.screenshot({ path: testInfo.outputPath("noeud-390.png") })
      // Mesuré à 380 px avant (le bouton seul sur sa rangée) : le premier bloc remonte d'autant.
      expect(hautDuBloc).toBeLessThanOrEqual(330)
    } finally {
      await page.close()
    }
  })
})
