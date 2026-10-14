import { expect, test, type Locator, type Page } from "@playwright/test"
import { clientAuth } from "./fixtures/base"
import { assurerLeNoeud, attendre, capturer, lireLeHtml, seConnecterSurLEspace, statut } from "./fixtures/noeud"
import { CHEMINS, ESPACE, PROCEDURE, SANS_ESPACE } from "./fixtures/espace"

// Contrôle visuel connecté de l'édition (E05-S10, partie a) : le compte E2E, administrateur de l'organisation
// (`espace.ts`), en clair puis en sombre, à 375 et à 1 280 px. Sur la page jetable
// `private/<handle>/essai_edition` (créée si elle manque, avec un premier paragraphe) : le titre et le résumé
// sont des champs en place (AC-a1) ; le menu de la poignée s'ouvre au clavier (Entrée, Espace) et se ferme par
// Échap, le focus rendu à la poignée (AC-a2) ; deux blocs vides s'ajoutent de suite (AC-a4) ; « @ » cite un
// contenu par un lien (AC-a9) ; une adresse collée devient un lien raccourci (AC-a8) ; un bloc se glisse-dépose
// (AC-a3) ; la page se publie seule, sans « Publier » (AC-a6). La procédure et le tableau semés (`CHEMINS` de
// `espace.ts`) montrent le menu d'une liste numérotée et l'en-tête en place (AC-a10), sans
// rien écrire. Une capture par étape dans `test-results/` ; aucune erreur d'hydratation.

const email = process.env.E2E_USER_EMAIL ?? ""
const password = process.env.E2E_USER_PASSWORD ?? ""
const MODES = ["light", "dark"] as const
const LARGEURS = [375, 1_280] as const
const RESUME = "Page jetable du contrôle visuel de l'éditeur."

// Les passages écrivent la même page jetable : l'un après l'autre.
test.describe.configure({ mode: "serial" })

/** Un geste du menu de la poignée, la main passée sur la rangée (la gouttière ne prend le pointeur qu'au survol). */
async function geste(page: Page, poignee: Locator, nom: string | RegExp): Promise<void> {
  await page.locator(".oto-block-row").filter({ has: poignee }).hover()
  await poignee.click()
  await page.getByRole("menu").getByRole("menuitem", { name: nom }).click()
}

/** Un passage interrompu laisse les blocs qu'il a ajoutés : ils partent d'abord, la page repart de son premier paragraphe. */
async function retirerLesRestes(page: Page): Promise<void> {
  const poignees = page.getByRole("button", { name: /^Actions sur ce bloc — / })
  for (let restants = await poignees.count(); restants > 1; restants--) {
    await geste(page, page.locator(".oto-block-row").filter({ has: poignees }).nth(1).getByRole("button", { name: /^Actions sur ce bloc — / }), "Supprimer")
    await expect(poignees).toHaveCount(restants - 1)
  }
  await attendre(statut(page, "Enregistrement…")).toHaveCount(0)
}

/** Échap : le texte du champ part ; la file a tout écrit, « Enregistré. » au niveau gestion. */
async function envoyer(page: Page): Promise<void> {
  await page.keyboard.press("Escape")
  await attendre(statut(page, "Enregistré.")).toBeVisible()
  await attendre(statut(page, "Enregistrement…")).toHaveCount(0)
}

test.describe("édition sans friction (E05-S10, partie a)", () => {
  test.skip(!ESPACE.semee, SANS_ESPACE)

  test.beforeAll(async () => {
    const { error } = await clientAuth().auth.signInWithPassword({ email, password })
    test.skip(error !== null, "E2E account missing from the Supabase project: run pnpm demo:seed (E01-S05)")
  })

  for (const mode of MODES) {
    for (const largeur of LARGEURS) {
      test(`should edit a page in place, from the handle's menu, by drag and drop and « @ », publishing alone, then show a procedure and a table header (${mode}, ${largeur} px)`, async ({ browser }, testInfo) => {
        test.setTimeout(600_000)
        const context = await browser.newContext({ colorScheme: mode, viewport: { width: largeur, height: 900 } })
        const page = await context.newPage()
        const hydratation: string[] = []
        page.on("console", (message) => {
          if (message.type() === "error" && /hydrat/i.test(message.text())) hydratation.push(`${page.url()} :: ${message.text().slice(0, 1500)}`)
        })
        const nom = `${mode}-${largeur}`
        await seConnecterSurLEspace(page, { email, password })
        // Le `handle` du compte, lu dans le lien de son Contexte Privé, que le rail rend côté serveur à toute largeur.
        const servi = await lireLeHtml(page, `/n/${CHEMINS.contexteDeLEquipe}`)
        const handle = /\/n\/private\/([a-z0-9_]+)\/contexte/.exec(servi)?.[1]
        expect(handle).toBeTruthy()
        const essai = `private/${handle}/essai_edition`
        await assurerLeNoeud(page, { chemin: essai, titre: "Essai de l'éditeur", resume: RESUME })
        await page.goto(`${ESPACE.adresse}/n/${essai}`)
        await attendre(page.getByRole("textbox", { name: "Titre" })).toHaveValue("Essai de l'éditeur")
        await expect(page.getByRole("button", { name: "Modifier le titre et le résumé" })).toHaveCount(0)
        await expect(page.getByRole("button", { name: "Publier" })).toHaveCount(0)
        await retirerLesRestes(page)
        await capturer(page, testInfo, `page-${nom}`)

        // Le menu de la poignée, au clavier : Entrée l'ouvre, Échap le ferme et rend le focus (AC-a2).
        const premier = page.getByRole("textbox", { name: /^Modifier ce texte — / }).first()
        const mots = (await premier.getAttribute("aria-label"))?.replace(/^Modifier ce texte — /, "") ?? ""
        const poignee = page.getByRole("button", { name: `Actions sur ce bloc — ${mots}` })
        await poignee.focus()
        await page.keyboard.press("Enter")
        await attendre(page.getByRole("menu")).toBeVisible()
        await expect(page.getByRole("menu").getByRole("menuitemradio", { name: "Grand titre" })).toBeVisible()
        await capturer(page, testInfo, `menu-${nom}`)
        await page.keyboard.press("Escape")
        await expect(page.getByRole("menu")).toHaveCount(0)
        await expect(poignee).toBeFocused()
        await page.keyboard.press(" ")
        await attendre(page.getByRole("menu")).toBeVisible()
        await page.keyboard.press("Escape")
        await expect(poignee).toBeFocused()

        // Deux blocs vides de suite (AC-a4), puis « @ » dans le second (AC-a9).
        const horodatage = new Date().toISOString().slice(11, 19)
        await page.locator(".oto-block-row").filter({ has: poignee }).hover()
        // Le « + » ouvre le choix du bloc (E10-S06, AC-a1) : un Texte.
        await page.getByRole("button", { name: `Ajouter un bloc après — ${mots}` }).click()
        await page.getByRole("menuitem", { name: "Texte", exact: true }).click()
        await page.getByRole("button", { name: "Ajouter un bloc après — bloc vide" }).click()
        await page.getByRole("menuitem", { name: "Texte", exact: true }).click()
        await expect(page.getByRole("textbox", { name: "Modifier ce texte — bloc vide" })).toHaveCount(2)
        await page.keyboard.type(`Voir @qualif`)
        const option = page.getByRole("option", { name: new RegExp(PROCEDURE) })
        await attendre(option).toBeVisible()
        await capturer(page, testInfo, `citer-${nom}`)
        await page.keyboard.press("Enter")
        await page.keyboard.type(` et https://docs.exemple.fr/document/d/1AbCdEfGhIjKlMnOp/edit ${horodatage}`)
        await envoyer(page)
        // Hors du focus, les liens se lisent dans la phrase (E05-S11, AC-26) : la page par son titre, l'adresse coupée au
        // milieu et nommée entière (E11-S15, AC-b10).
        const liens = page.locator(".oto-block-rendu").filter({ hasText: horodatage })
        await expect(liens.getByRole("link", { name: new RegExp(PROCEDURE) })).toHaveAttribute("href", `/n/${CHEMINS.procedure}`)
        await expect(liens.getByRole("link", { name: "https://docs.exemple.fr/document/d/1AbCdEfGhIjKlMnOp/edit" })).toHaveAttribute("title", "https://docs.exemple.fr/document/d/1AbCdEfGhIjKlMnOp/edit")
        await expect(page.getByRole("group", { name: "Liens de ce bloc" })).toHaveCount(0)
        await capturer(page, testInfo, `liens-${nom}`)

        // Le bloc cité monte au-dessus du premier paragraphe, glissé par sa poignée (AC-a3).
        const cite = page.getByRole("button", { name: /^Actions sur ce bloc — Voir Qualifier/ })
        const cible = page.locator(".oto-block-row").filter({ has: poignee })
        await page.locator(".oto-block-row").filter({ has: cite }).hover()
        const depart = await cite.boundingBox()
        const arrivee = await cible.boundingBox()
        if (!depart || !arrivee) throw new Error("rangées non mesurées")
        await page.mouse.move(depart.x + depart.width / 2, depart.y + depart.height / 2)
        await page.mouse.down()
        for (const pas of [8, 16, 32]) await page.mouse.move(depart.x + depart.width / 2, depart.y - pas, { steps: 2 })
        await page.mouse.move(depart.x + depart.width / 2, arrivee.y + 2, { steps: 10 })
        await page.mouse.up()
        await expect(page.getByRole("menu")).toHaveCount(0)
        await attendre(statut(page, "Enregistrement…")).toHaveCount(0)
        const ordre = await page.getByRole("textbox", { name: /^Modifier ce texte — / }).evaluateAll((champs) => champs.map((champ) => champ.getAttribute("aria-label")))
        expect(ordre[0]).toMatch(/^Modifier ce texte — Voir Qualifier/)
        await capturer(page, testInfo, `glisse-${nom}`)

        // Publiée seule (AC-a6) : la version publiée porte le texte, sans qu'aucun bouton n'ait été pressé.
        await attendre(async () => {
          expect(await lireLeHtml(page, `/n/${essai}?version=published`)).toContain(horodatage)
        }).toPass({ timeout: 90_000 })
        await geste(page, page.getByRole("button", { name: /^Actions sur ce bloc — Voir Qualifier/ }), "Supprimer")
        await attendre(statut(page, "Enregistrement…")).toHaveCount(0)

        // Une procédure : le menu d'une liste numérotée est celui d'une page, sans insertion d'appel (M59), rien n'est écrit.
        await page.goto(`${ESPACE.adresse}/n/${CHEMINS.procedure}`)
        const etapes = page.getByRole("button", { name: /^Actions sur ce bloc — Annonce en une/ })
        await attendre(etapes).toBeVisible()
        await page.locator(".oto-block-row").filter({ has: etapes }).hover()
        await etapes.click()
        await expect(page.getByRole("menu").getByRole("menuitem", { name: /^Supprimer/ })).toBeVisible()
        await expect(page.getByRole("menu").getByRole("menuitem", { name: /^Insérer un appel/ })).toHaveCount(0)
        await capturer(page, testInfo, `procedure-${nom}`)
        await page.keyboard.press("Escape")

        // Un tableau : son titre en place (AC-a10), son résumé ni lu ni écrit (E11-S05, AC-f1), rien n'est écrit.
        await page.goto(`${ESPACE.adresse}/n/${CHEMINS.tableau}`)
        await attendre(page.getByRole("textbox", { name: "Titre", exact: true })).toBeVisible()
        await expect(page.getByRole("textbox", { name: "Résumé" })).toHaveCount(0)
        await capturer(page, testInfo, `tableau-${nom}`)
        expect(hydratation).toEqual([])
        await context.close()
      })
    }
  }
})
