import { expect, test, type Locator, type Page } from "@playwright/test"
import { clientAuth } from "./fixtures/base"
import { assurerLeNoeud, attendre, capturer, ouvrirLeRail, seConnecterSurLEspace } from "./fixtures/noeud"
import { ESPACE, SANS_ESPACE } from "./fixtures/espace"

// E05-S12, lot D (fiche D110 a), en contrôle visuel connecté sur l'organisation de la campagne : le compte E2E, en clair puis en sombre, à
// 1 280 et 375 px (le rail en tiroir). Dans son Privé, pour que rien ne paraisse aux autres : le « + » de
// « Mes instructions » crée une procédure sous le Contexte, qui s'ouvre et paraît sous sa ligne, dépliée (AC-25,
// AC-27) ; à 1 280 px, une page jetable (`e05s12d_mobile`, créée si elle manque) glissée sur la ligne du Contexte
// se range sous lui (AC-26), puis revient par l'API. La procédure créée part à la corbeille par l'API (purgée à
// 30 jours). Une capture par étape, dans `test-results/`.

const email = process.env.E2E_USER_EMAIL ?? ""
const password = process.env.E2E_USER_PASSWORD ?? ""
const MODES = ["light", "dark"] as const
const LARGEURS = [1280, 375] as const
const CONTEXTE = "Mes instructions"
const MOBILE = "Mobile E05-S12 D"

// Les passages écrivent le même nœud jetable : l'un après l'autre.
test.describe.configure({ mode: "serial" })

/** Le `handle` du compte, lu dans l'adresse du Contexte de Privé que porte le rail. */
async function handleDuCompte(page: Page): Promise<string> {
  const href = await page.locator('a[href^="/n/private/"][href$="/contexte"]').first().getAttribute("href")
  const handle = /^\/n\/private\/([^/]+)\/contexte$/.exec(href ?? "")?.[1]
  expect(handle).toBeTruthy()
  return handle ?? ""
}

/** Un geste de l'API du paquet depuis la page connectée (même origine, même session) ; rend le statut. */
async function envoyer(page: Page, ressource: string, corps: Record<string, string>): Promise<number> {
  return page.evaluate(
    async ({ ressource: route, corps: envoye }) =>
      (await fetch(`/api/platform/${route}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(envoye) })).status,
    { ressource, corps },
  )
}

/** La liste des enfants d'une ligne de branche, par le `aria-controls` de sa bascule. */
async function enfantsDe(rail: Locator, nom: string): Promise<Locator> {
  const pli = rail.getByRole("button", { name: `Replier ${nom}` })
  await attendre(pli).toHaveAttribute("aria-expanded", "true")
  return rail.locator(`[id="${await pli.getAttribute("aria-controls")}"]`)
}

test.describe("E05-S12 lot D : ranger sous un Contexte depuis le rail", () => {
  test.skip(!ESPACE.semee, SANS_ESPACE)

  test.beforeAll(async () => {
    const { error } = await clientAuth().auth.signInWithPassword({ email, password })
    test.skip(error !== null, "E2E account missing from the Supabase project: run pnpm demo:seed (E01-S05)")
  })

  for (const mode of MODES) {
    for (const largeur of LARGEURS) {
      test(`should create under a Contexte from its « + », show it under its line, and drop a page on it (${mode}, ${largeur} px)`, async ({ browser }, testInfo) => {
        test.setTimeout(600_000)
        const context = await browser.newContext({ colorScheme: mode, viewport: { width: largeur, height: 900 } })
        const page = await context.newPage()
        const nom = `${mode}-${largeur}`
        await seConnecterSurLEspace(page, { email, password })
        const handle = await handleDuCompte(page)
        const contexte = `private/${handle}/contexte`
        await page.goto(`${ESPACE.adresse}/n/${contexte}`)
        let rail = await ouvrirLeRail(page, largeur)

        // AC-25 : le « + » de la ligne du Contexte, révélé au survol, crée sous lui et ouvre la procédure.
        const ligne = rail.getByRole("link", { name: CONTEXTE, exact: true })
        await ligne.hover()
        await ligne.locator("xpath=..").getByRole("button", { name: `Ajouter dans ${CONTEXTE}` }).click()
        await capturer(page, testInfo, `plus-du-contexte-${nom}`)
        await page.getByRole("menuitem", { name: "Une procédure" }).click()
        await attendre(page).toHaveURL(new RegExp(`/n/${contexte}/sans_titre(_\\d+)?$`))
        const cree = new URL(page.url()).pathname.slice("/n/".length)
        try {
          // AC-27 : la procédure est sous la ligne du Contexte, déplié, et sélectionnée.
          rail = await ouvrirLeRail(page, largeur)
          const creee = (await enfantsDe(rail, CONTEXTE)).locator(`a[href="/n/${cree}"]`)
          await attendre(creee).toHaveAttribute("aria-current", "page")
          await capturer(page, testInfo, `cree-sous-le-contexte-${nom}`)

          if (largeur === 1280) {
            // AC-26 : une page glissée sur la ligne du Contexte se range sous lui (même espace : aucune question
            // quand l'aperçu ne change rien ; sinon la confirmation, acceptée).
            const mobile = `private/${handle}/e05s12d_mobile`
            expect(await envoyer(page, "nodes/move", { path: `${contexte}/e05s12d_mobile`, new_path: mobile })).toBeLessThan(500)
            await assurerLeNoeud(page, { chemin: mobile, titre: MOBILE, resume: "Page jetable du contrôle visuel d'E05-S12, lot D." })
            await page.goto(`${ESPACE.adresse}/n/${mobile}`)
            await rail.getByRole("link", { name: MOBILE }).dragTo(rail.getByRole("link", { name: CONTEXTE, exact: true }))
            const confirmation = page.getByRole("dialog", { name: `Déplacer « ${MOBILE} » ?` })
            const arrivee = new RegExp(`/n/${contexte}/e05s12d_mobile$`)
            await Promise.race([page.waitForURL(arrivee, { timeout: 90_000 }), confirmation.waitFor({ timeout: 90_000 })])
            if (await confirmation.isVisible()) await confirmation.getByRole("button", { name: "Déplacer" }).click()
            await attendre(page).toHaveURL(arrivee)
            await attendre((await enfantsDe(rail, CONTEXTE)).getByRole("link", { name: MOBILE })).toHaveAttribute("aria-current", "page")
            await capturer(page, testInfo, `depose-sous-le-contexte-${nom}`)
            expect(await envoyer(page, "nodes/move", { path: `${contexte}/e05s12d_mobile`, new_path: mobile })).toBe(200)
          }
        } finally {
          expect(await envoyer(page, "trash", { path: cree })).toBe(200)
          await context.close()
        }
      })
    }
  }
})
