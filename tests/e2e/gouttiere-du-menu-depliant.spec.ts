import { randomBytes } from "node:crypto"
import { expect, test, type Locator, type Page } from "@playwright/test"
import { clientAuth } from "./fixtures/base"
import { EQUIPE, ESPACE, SANS_ESPACE } from "./fixtures/espace"
import { attendre, seConnecterSurLEspace } from "./fixtures/noeud"

// La gouttière d'un menu dépliant (1.4.10) : le « + » et la poignée se centrent sur la ligne du résumé, comme sur la ligne
// d'un Texte ; ils tombaient plus bas que le chevron. Une mise en page se mesure dans un navigateur : jsdom ne pose aucune
// boîte. Une page jetable sous l'équipe du compte E2E, un Texte puis un menu dépliant ajouté par le « + ».

const email = process.env.E2E_USER_EMAIL ?? ""
const password = process.env.E2E_USER_PASSWORD ?? ""

/** Le milieu vertical d'un élément, en pixels de la fenêtre. */
async function milieu(element: Locator): Promise<number> {
  const boite = await element.boundingBox()
  if (!boite) throw new Error("élément sans boîte")
  return boite.y + boite.height / 2
}

async function creerLaPage(page: Page, chemin: string): Promise<void> {
  const issue = await page.evaluate(
    async (corps) => {
      const reponse = await fetch("/api/platform/nodes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corps) })
      return reponse.ok ? "écrite" : await reponse.text()
    },
    { path: chemin, title: "Gouttière du menu dépliant", summary: "Page jetable du contrôle de la gouttière.", publish: true, ops: [{ op: "add_section", section: "Réunion", text: "Premier paragraphe." }] },
  )
  expect(issue).toBe("écrite")
}

test.describe("gouttière d'un menu dépliant", () => {
  test.skip(!ESPACE.semee, SANS_ESPACE)

  test.beforeAll(async () => {
    const { error } = await clientAuth().auth.signInWithPassword({ email, password })
    test.skip(error !== null, "E2E account missing from the Supabase project: run pnpm demo:seed (E01-S05)")
  })

  test("should center the « + » and the handle of a toggle on its summary line, like a Texte", async ({ browser }) => {
    test.setTimeout(180_000)
    const context = await browser.newContext({ viewport: { width: 1_280, height: 900 } })
    const page = await context.newPage()
    await seConnecterSurLEspace(page, { email, password })
    const chemin = `${EQUIPE.slug}/essai_gouttiere_${randomBytes(3).toString("hex")}`
    await creerLaPage(page, chemin)
    await page.goto(`${ESPACE.adresse}/n/${chemin}`)

    const plus = page.getByRole("button", { name: "Ajouter un bloc après — Premier paragraphe." })
    await plus.locator("xpath=ancestor::*[contains(concat(' ', @class, ' '), ' oto-block-row ')][1]").hover()
    await plus.click()
    await page.getByRole("menuitem", { name: "Menu dépliant", exact: true }).click()
    await page.keyboard.type("Notes brutes")
    await page.keyboard.press("Escape")

    const chevron = page.getByRole("button", { name: /le corps — Notes brutes/ })
    await attendre(chevron).toBeVisible()
    const rangee = chevron.locator("xpath=ancestor::*[contains(concat(' ', @class, ' '), ' oto-block-row ')][1]")
    await rangee.hover()
    const decalageDuRepli = (await milieu(rangee.locator('[data-geste="poignee"]'))) - (await milieu(chevron))

    // Le Texte : la poignée face au milieu de sa première ligne (le haut du texte, plus la moitié d'une ligne).
    const texte = page.getByRole("textbox", { name: "Modifier ce texte — Premier paragraphe." })
    const rangeeDuTexte = texte.locator("xpath=ancestor::*[contains(concat(' ', @class, ' '), ' oto-block-row ')][1]")
    await rangeeDuTexte.hover()
    const premiereLigne = await texte.evaluate((champ) => {
      const style = getComputedStyle(champ)
      const boite = champ.getBoundingClientRect()
      return boite.top + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop) + parseFloat(style.lineHeight) / 2
    })
    const decalageDuTexte = (await milieu(rangeeDuTexte.locator('[data-geste="poignee"]'))) - premiereLigne
    console.log(`décalage poignée — repli : ${decalageDuRepli}, texte : ${decalageDuTexte}`)
    expect(Math.abs(decalageDuRepli - decalageDuTexte)).toBeLessThanOrEqual(1)
    await context.close()
  })
})
