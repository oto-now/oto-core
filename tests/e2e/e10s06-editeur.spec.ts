import { randomBytes } from "node:crypto"
import { expect, test, type Page } from "@playwright/test"
import { clientAuth } from "./fixtures/base"
import { EQUIPE, ESPACE, SANS_ESPACE } from "./fixtures/espace"
import { attendre, attendreLEnregistrement, capturer, lireLeHtml, seConnecterSurLEspace } from "./fixtures/noeud"

// L'éditeur des blocs de page (E10-S06) : une page s'écrit avec le « + » et « / » (titre de niveau 3 par `#### `,
// tableau 3 × 3 rempli au clavier, séparateur, repli, liste à deux niveaux), puis se relit publiée, en clair puis en
// sombre. Le compte E2E administre l'organisation de la campagne : la page se publie seule (E05-S10, AC-a6). Une page
// jetable par thème, sous l'équipe du compte ; une capture de l'éditeur et une de la version publiée par thème.

const email = process.env.E2E_USER_EMAIL ?? ""
const password = process.env.E2E_USER_PASSWORD ?? ""
const MODES = ["light", "dark"] as const

/** Crée la page jetable, un paragraphe, par `POST /api/platform/nodes` depuis la page connectée. */
async function creerLaPage(page: Page, chemin: string): Promise<void> {
  const issue = await page.evaluate(
    async (corps) => {
      const reponse = await fetch("/api/platform/nodes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corps) })
      return reponse.ok ? "écrite" : await reponse.text()
    },
    { path: chemin, title: "Page écrite à l'éditeur", summary: "Page jetable du contrôle d'E10-S06.", publish: true, ops: [{ op: "add_section", section: "Réunion", text: "Premier paragraphe." }] },
  )
  expect(issue).toBe("écrite")
}

/** Le « + » d'un bloc, puis un choix (AC-a1). */
async function choisirApres(page: Page, mots: string | RegExp, choix: string): Promise<void> {
  const plus = page.getByRole("button", { name: typeof mots === "string" ? `Ajouter un bloc après — ${mots}` : mots })
  await plus.locator("xpath=ancestor::*[contains(concat(' ', @class, ' '), ' oto-block-row ')][1]").hover()
  await plus.click()
  await page.getByRole("menuitem", { name: choix, exact: true }).click()
}

test.describe("éditeur des blocs de page (E10-S06)", () => {
  test.skip(!ESPACE.semee, SANS_ESPACE)

  test.beforeAll(async () => {
    const { error } = await clientAuth().auth.signInWithPassword({ email, password })
    test.skip(error !== null, "E2E account missing from the Supabase project: run pnpm demo:seed (E01-S05)")
  })

  for (const mode of MODES) {
    test(`should write a page with « + » and « / », then read it published (${mode})`, async ({ browser }, testInfo) => {
      test.setTimeout(300_000)
      const context = await browser.newContext({ colorScheme: mode, viewport: { width: 1_280, height: 900 } })
      const page = await context.newPage()
      await seConnecterSurLEspace(page, { email, password })
      const chemin = `${EQUIPE.slug}/essai_e10s06_${randomBytes(3).toString("hex")}`
      await creerLaPage(page, chemin)
      await page.goto(`${ESPACE.adresse}/n/${chemin}`)

      // Un titre de niveau 3, tapé `#### ` dans un Texte neuf (AC-a5).
      await choisirApres(page, "Premier paragraphe.", "Texte")
      await attendre(page.getByRole("textbox", { name: "Modifier ce texte — bloc vide" })).toBeFocused()
      await page.keyboard.type("#### Chiffres")
      await expect(page.getByRole("textbox", { name: "Modifier ce titre — Chiffres" })).toBeFocused()
      await page.keyboard.press("Escape")

      // Un tableau simple, par « / » dans un Texte neuf, rempli au clavier (AC-a2, AC-b1).
      await choisirApres(page, "Chiffres", "Texte")
      await page.keyboard.type("/tab")
      await expect(page.getByRole("listbox", { name: "Blocs à insérer" })).toBeVisible()
      await page.keyboard.press("Enter")
      await expect(page.getByRole("textbox", { name: "En-tête de la colonne 1" })).toBeFocused()
      for (const cellule of ["Poste", "Montant", "Note", "Atelier", "12", "à revoir", "Forge", "3", "ok"]) {
        await page.keyboard.type(cellule)
        await page.keyboard.press("Tab")
      }
      // Le `Tab` de la dernière cellule a ajouté une rangée ; Échap rend le focus à la poignée, le tableau part.
      await page.keyboard.press("Escape")
      await attendreLEnregistrement(page)

      // Un séparateur, puis un menu dépliant (AC-a1, AC-b4).
      await choisirApres(page, /^Ajouter un bloc après — Poste/, "Séparateur")
      await choisirApres(page, "Séparateur", "Menu dépliant")
      await page.keyboard.type("Notes brutes")
      await page.keyboard.press("Enter")
      await page.keyboard.type("Tout ce qui a été dit.")
      await page.keyboard.press("Escape")

      // Une liste à deux niveaux, `Tab` sur sa seconde ligne (AC-a6).
      await choisirApres(page, "Notes brutes", "Liste à puces")
      await page.keyboard.type("Léa")
      await page.keyboard.press("Enter")
      await page.keyboard.type("relancer")
      await page.keyboard.press("Tab")
      await expect(page.getByRole("textbox", { name: /^Modifier cette liste — Léa/ })).toHaveValue("Léa\n  - relancer")
      await page.keyboard.press("Escape")
      // Échap rend le focus à la poignée, d'où Tab sort du bloc sans rentrer dans la liste (AC-a6).
      await page.keyboard.press("Tab")
      await expect(page.getByRole("textbox", { name: /^Modifier cette liste — Léa/ })).not.toBeFocused()
      await attendreLEnregistrement(page)
      await capturer(page, testInfo, `e10s06-editeur-${mode}`)

      // La version publiée : chaque bloc rendu, sans balisage visible.
      await attendre(async () => {
        const html = await lireLeHtml(page, `/n/${chemin}?version=published`)
        expect(html).toContain(">relancer<")
      }).toPass({ timeout: 90_000 })
      await page.goto(`${ESPACE.adresse}/n/${chemin}?version=published`)
      await expect(page.getByRole("heading", { level: 4, name: "Chiffres" })).toBeVisible()
      await expect(page.getByRole("columnheader", { name: "Montant" })).toBeVisible()
      await expect(page.getByRole("cell", { name: "à revoir" })).toBeVisible()
      await expect(page.locator("hr.oto-separator")).toHaveCount(1)
      await expect(page.locator("summary", { hasText: "Notes brutes" })).toBeVisible()
      await expect(page.locator("ul ul li", { hasText: "relancer" })).toBeVisible()
      await capturer(page, testInfo, `e10s06-publiee-${mode}`)
      await context.close()
    })
  }
})
