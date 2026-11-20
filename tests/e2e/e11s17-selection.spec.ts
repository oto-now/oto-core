import { randomBytes } from "node:crypto"
import { expect, test, type Locator, type Page } from "@playwright/test"
import { clientAuth } from "./fixtures/base"
import { EQUIPE, ESPACE, SANS_ESPACE } from "./fixtures/espace"
import { attendre, attendreLEnregistrement, capturer, lireLeHtml, seConnecterSurLEspace, statut } from "./fixtures/noeud"

// La sélection dans l'éditeur, là où jsdom ne pose aucune boîte : un glissé commencé dans le texte d'un bloc lu et lâché
// dans un autre reste une sélection de texte à travers les blocs, sans ouvrir l'édition, et un clic simple ouvre le champ
// au caractère cliqué (l'édition au clic) ; un rectangle tiré depuis la marge prend les blocs qu'il couvre (E11-S17,
// AC-a5) ; la sélection se supprime en une écriture et revient d'un seul « Annuler », relue publiée (AC-a6). À 390 et à 1 280 px, en clair puis en sombre. Une page jetable par passage, sous
// l'équipe du compte E2E, qui administre l'organisation : la page se publie seule.

const email = process.env.E2E_USER_EMAIL ?? ""
const password = process.env.E2E_USER_PASSWORD ?? ""
const PASSAGES = [
  { mode: "light", largeur: 390 },
  { mode: "dark", largeur: 1_280 },
] as const
const TEXTES = ["Premier paragraphe de la sélection.", "Deuxième paragraphe de la sélection.", "Troisième paragraphe de la sélection."]

async function creerLaPage(page: Page, chemin: string): Promise<void> {
  const issue = await page.evaluate(
    async (corps) => {
      const reponse = await fetch("/api/platform/nodes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corps) })
      return reponse.ok ? "écrite" : await reponse.text()
    },
    { path: chemin, title: "Sélection de blocs", summary: "Page jetable du contrôle d'E11-S17.", publish: true, ops: [{ op: "insert_after", text: TEXTES.join("\n\n") }] },
  )
  expect(issue).toBe("écrite")
}

/** Les blocs surlignés de la page. */
const selectionnes = (page: Page) => page.locator(".oto-block-row[data-selectionnee]")

/** Le centre d'un élément, sur la page. */
async function centre(element: Locator): Promise<{ x: number; y: number }> {
  const boite = await element.boundingBox()
  if (!boite) throw new Error("élément sans boîte")
  return { x: boite.x + boite.width / 2, y: boite.y + boite.height / 2 }
}

test.describe("selection of blocks in the editor (E11-S17, lot a)", () => {
  test.skip(!ESPACE.semee, SANS_ESPACE)

  test.beforeAll(async () => {
    const { error } = await clientAuth().auth.signInWithPassword({ email, password })
    test.skip(error !== null, "E2E account missing from the Supabase project: run pnpm demo:seed (E01-S05)")
  })

  for (const { mode, largeur } of PASSAGES) {
    test(`should select text across read blocks by a drag, open a field by a click, select blocks by a rectangle from the margin, then delete them in one write and bring them back (${mode}, ${largeur} px)`, async ({ browser }, testInfo) => {
      test.setTimeout(300_000)
      const context = await browser.newContext({ colorScheme: mode, viewport: { width: largeur, height: 900 } })
      const page = await context.newPage()
      await seConnecterSurLEspace(page, { email, password })
      const chemin = `${EQUIPE.slug}/essai_e11s17_${randomBytes(3).toString("hex")}`
      await creerLaPage(page, chemin)
      await page.goto(`${ESPACE.adresse}/n/${chemin}`)
      const champs = TEXTES.map((texte) => page.getByRole("textbox", { name: `Modifier ce texte — ${texte.split(" ").slice(0, 4).join(" ")}` }))
      await attendre(champs[2]).toBeVisible()

      // Un glissé commencé dans le texte du premier bloc, lâché dans le troisième : une sélection de texte à travers les
      // blocs, à copier ; aucun bloc pris, aucun champ ouvert, ni au survol ni au lâcher.
      const depart = await champs[0].boundingBox()
      if (!depart) throw new Error("premier champ sans boîte")
      await page.mouse.move(depart.x + 12, depart.y + depart.height / 2)
      await expect(champs[0]).not.toHaveJSProperty("tagName", "TEXTAREA")
      await page.mouse.down()
      const troisieme = await centre(champs[2])
      await page.mouse.move(troisieme.x, troisieme.y, { steps: 12 })
      await page.mouse.up()
      await expect(selectionnes(page)).toHaveCount(0)
      expect(await page.locator("textarea").count()).toBe(0)
      expect(await page.evaluate(() => document.getSelection()?.toString() ?? "")).toContain(TEXTES[1])
      await capturer(page, testInfo, `e11s17-texte-${mode}-${largeur}`)

      // Un clic simple, sans sélection : le champ s'ouvre, focalisé, le curseur au caractère cliqué (pas à la fin).
      await page.mouse.click(depart.x + 12, depart.y + depart.height / 2)
      await expect(champs[0]).toHaveJSProperty("tagName", "TEXTAREA")
      await expect(champs[0]).toBeFocused()
      expect(await champs[0].evaluate((champ) => (champ instanceof HTMLTextAreaElement ? champ.selectionStart : -1))).toBeLessThan(TEXTES[0].length)
      await page.keyboard.press("Tab")

      // AC-a5 : un rectangle tiré dans la marge de gauche, du premier au deuxième bloc, les prend au fil du geste.
      const zone = page.getByRole("group", { name: "Blocs de la page" })
      const boiteDeLaZone = await zone.boundingBox()
      const premier = await champs[0].boundingBox()
      const second = await champs[1].boundingBox()
      if (!boiteDeLaZone || !premier || !second) throw new Error("zone ou champs sans boîte")
      await page.mouse.move(boiteDeLaZone.x + 3, premier.y + 4)
      await page.mouse.down()
      await page.mouse.move(boiteDeLaZone.x + 30, second.y + second.height / 2, { steps: 12 })
      await expect(page.locator(".oto-rectangle-de-selection")).toBeVisible()
      await expect(selectionnes(page)).toHaveCount(2)
      await capturer(page, testInfo, `e11s17-rectangle-${mode}-${largeur}`)
      await page.mouse.up()
      await expect(page.locator(".oto-rectangle-de-selection")).toHaveCount(0)
      await expect(selectionnes(page)).toHaveCount(2)
      await expect(page.getByRole("group", { name: "2 blocs sélectionnés" })).toBeFocused()

      // AC-a6 : Suppr, une écriture ; « Annuler » les rétablit tous, à leur place.
      await page.keyboard.press("Delete")
      await attendre(statut(page, "2 blocs supprimés.")).toBeVisible()
      await expect(champs[0]).toHaveCount(0)
      await expect(champs[1]).toHaveCount(0)
      await page.getByRole("button", { name: "Annuler", exact: true }).click()
      await attendre(champs[1]).toBeVisible()
      await attendreLEnregistrement(page)

      // La version publiée : les trois paragraphes, dans l'ordre d'avant la suppression.
      await attendre(async () => {
        const html = await lireLeHtml(page, `/n/${chemin}?version=published`)
        const rangs = TEXTES.map((texte) => html.indexOf(texte))
        expect(rangs.every((rang) => rang >= 0)).toBe(true)
        expect([...rangs].sort((a, b) => a - b)).toEqual(rangs)
      }).toPass({ timeout: 90_000 })
      await context.close()
    })
  }
})
