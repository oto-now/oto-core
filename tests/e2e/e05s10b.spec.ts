import { expect, test, type Page } from "@playwright/test"
import { clientAuth } from "./fixtures/base"
import { assurerLeNoeud, attendre, capturer, seConnecterSurLEspace } from "./fixtures/noeud"
import { ESPACE, PROCEDURE, SANS_ESPACE } from "./fixtures/espace"

// E05-S10, partie b (la coque et les actions d'en-tête), en contrôle visuel connecté : le compte E2E,
// administrateur de l'organisation de la campagne (`espace.ts`), en clair puis en sombre, à 1 280 et 375 px. Sur
// la page jetable `private/<handle>/e05s10b_parent` et son enfant (créés s'ils manquent), le rail déplie une
// branche au clic sur son nom (AC-b2) et une procédure porte son « + » (AC-b1) ; une page jetable
// `e05s10b_mobile` se glisse-dépose (AC-b7 : confirmation vers un autre espace, déplacement sans question dans
// Privé), puis revient ; la ligne sous le titre ouvre son infobulle (AC-a7) ; l'en-tête n'a plus de « Déplacer »
// (E05-S13, AC-20) ; « Partager » montre le champ d'ajout, qui a accès et l'accès général (AC-b5) ; « Contenus
// liés » se déplie sur ce qui est dessous (AC-b6). La création sans dialogue (AC-b3) ne se joue pas ici ; son test
// est `rail-application.test.tsx`. Une capture par étape, dans `test-results/`.

const email = process.env.E2E_USER_EMAIL ?? ""
const password = process.env.E2E_USER_PASSWORD ?? ""
const MODES = ["light", "dark"] as const
const LARGEURS = [1280, 375] as const
const RESUME = "Page jetable du contrôle visuel d'E05-S10, partie b."
const TITRE = "Essai E05-S10 b"

// Les passages écrivent les mêmes nœuds jetables : l'un après l'autre.
test.describe.configure({ mode: "serial" })

const MOBILE = "Mobile d'essai"

/**
 * Remet un nœud à sa place par la route de « Déplacer » : lu par son chemin, peut-être ancien (`GET nodes?path=`
 * rend son chemin courant, E03-S07) ; inconnu, ou déjà à sa place (passage complet), rien.
 */
async function deplacerParLAPI(page: Page, chemin: string, nouveauChemin: string): Promise<void> {
  const statut = await page.evaluate(
    async ({ lu, cible }) => {
      const tete = await fetch(`/api/platform/nodes?path=${encodeURIComponent(lu)}`)
      if (tete.status === 404) return 200
      const courant: string = (await tete.json()).data?.path ?? ""
      if (courant === cible) return 200
      const corps = JSON.stringify({ path: courant, new_path: cible })
      return (await fetch("/api/platform/nodes/move", { method: "POST", headers: { "content-type": "application/json" }, body: corps })).status
    },
    { lu: chemin, cible: nouveauChemin },
  )
  expect(statut).toBe(200)
}

/** Le `handle` du compte, lu dans l'adresse du Contexte de Privé que porte le rail. */
async function handleDuCompte(page: Page): Promise<string> {
  const href = await page.locator('a[href^="/n/private/"][href$="/contexte"]').first().getAttribute("href")
  const handle = /^\/n\/private\/([^/]+)\/contexte$/.exec(href ?? "")?.[1]
  expect(handle).toBeTruthy()
  return handle ?? ""
}

test.describe("E05-S10 partie b : la coque et les actions d'en-tête", () => {
  test.skip(!ESPACE.semee, SANS_ESPACE)

  test.beforeAll(async () => {
    const { error } = await clientAuth().auth.signInWithPassword({ email, password })
    test.skip(error !== null, "E2E account missing from the Supabase project: run pnpm demo:seed (E01-S05)")
  })

  for (const mode of MODES) {
    for (const largeur of LARGEURS) {
      test(`should unfold the rail on click, show the header actions and fold the linked contents (${mode}, ${largeur} px)`, async ({ browser }, testInfo) => {
        test.setTimeout(600_000)
        const context = await browser.newContext({ colorScheme: mode, viewport: { width: largeur, height: 900 } })
        const page = await context.newPage()
        const nom = `${mode}-${largeur}`
        await seConnecterSurLEspace(page, { email, password })
        const handle = await handleDuCompte(page)
        const parent = `private/${handle}/e05s10b_parent`
        await assurerLeNoeud(page, { chemin: parent, titre: TITRE, resume: RESUME })
        await assurerLeNoeud(page, { chemin: `${parent}/enfant`, titre: "Enfant d'essai", resume: RESUME })

        if (largeur === 1280) {
          // Le rail (AC-b1, AC-b2) : depuis le Contexte de Privé, le clic sur le nom de la page l'ouvre et la déplie.
          await page.goto(`${ESPACE.adresse}/n/private/${handle}/contexte`)
          const rail = page.getByRole("navigation", { name: "Navigation principale" })
          await expect(rail.getByRole("button", { name: `Ajouter dans ${PROCEDURE}` })).toHaveCount(1)
          const depli = rail.getByRole("button", { name: new RegExp(`^(Déplier|Replier) ${TITRE}$`) })
          if ((await depli.getAttribute("aria-expanded")) === "true") await depli.click()
          await expect(rail.getByRole("link", { name: "Enfant d'essai" })).toBeHidden()
          await rail.getByRole("link", { name: TITRE }).click()
          await attendre(page).toHaveURL(`${ESPACE.adresse}/n/${parent}`)
          await expect(rail.getByRole("button", { name: `Replier ${TITRE}` })).toHaveAttribute("aria-expanded", "true")
          await expect(rail.getByRole("link", { name: "Enfant d'essai" })).toBeVisible()
          await capturer(page, testInfo, `rail-${nom}`)

          // Le glisser-déposer (AC-b7) : vers Tout le monde, la confirmation dit, sur l'aperçu du service, ce qui
          // change (« Annuler » : rien ne part) ; dans Privé, la page mobile devient l'enfant de la page d'essai
          // sans question, s'ouvre et reste sélectionnée ; puis elle revient par la même route, pour le passage suivant.
          const mobile = `private/${handle}/e05s10b_mobile`
          await deplacerParLAPI(page, `${parent}/e05s10b_mobile`, mobile)
          await assurerLeNoeud(page, { chemin: mobile, titre: MOBILE, resume: RESUME })
          await page.goto(`${ESPACE.adresse}/n/${parent}`)
          await rail.getByRole("link", { name: MOBILE }).dragTo(rail.getByRole("link", { name: "Contexte · Tout le monde" }))
          const confirmation = page.getByRole("dialog", { name: `Déplacer « ${MOBILE} » ?` })
          await expect(confirmation).toBeVisible()
          await expect(confirmation.getByText("Il quitte Privé pour Tout le monde.")).toBeVisible()
          // Ce qui change se lit sur l'aperçu du service : qui gagne l'accès, ou le propriétaire seul (selon l'accès
          // général de l'organisation, ADR-014).
          await expect(confirmation.getByText(/^(Gagnent l'accès : |Personne ne gagne ni ne perd l'accès)/)).toBeVisible()
          await capturer(page, testInfo, `glisser-confirmation-${nom}`)
          await confirmation.getByRole("button", { name: "Annuler" }).click()
          await expect(confirmation).toHaveCount(0)
          await rail.getByRole("link", { name: MOBILE }).dragTo(rail.getByRole("link", { name: TITRE }))
          await attendre(page).toHaveURL(`${ESPACE.adresse}/n/${parent}/e05s10b_mobile`)
          await attendre(rail.getByRole("link", { name: MOBILE })).toHaveAttribute("aria-current", "page")
          await capturer(page, testInfo, `glisser-fait-${nom}`)
          await deplacerParLAPI(page, `${parent}/e05s10b_mobile`, mobile)
          await page.goto(`${ESPACE.adresse}/n/${parent}`)
        } else {
          await page.goto(`${ESPACE.adresse}/n/${parent}`)
        }
        await attendre(page.getByRole("heading", { level: 1 })).toHaveText(TITRE)

        // La ligne sous le titre et son infobulle (AC-a7).
        const modifiee = page.locator(".oto-screen-header-meta").getByText(/^modifiée /)
        await expect(modifiee).toBeVisible()
        await modifiee.focus()
        const infobulle = page.getByRole("tooltip")
        await expect(infobulle).toContainText("Propriétaire")
        await capturer(page, testInfo, `infobulle-${nom}`)
        await page.keyboard.press("Escape")

        // Plus de « Déplacer » en tête : le rail déplace (E05-S13, AC-20, qui remplace AC-b4).
        await expect(page.getByRole("button", { name: "Déplacer", exact: true })).toHaveCount(0)
        const partager = page.getByRole("button", { name: "Partager · Privé" })

        // « Partager » (AC-b5) : le champ, l'accès par défaut, qui a accès ; aucun mot « règle ».
        await partager.click()
        const panneauPartager = page.getByRole("dialog", { name: "Partager — Privé" })
        await expect(panneauPartager.getByRole("combobox", { name: "Ajouter une personne ou une équipe" })).toBeVisible()
        await expect(panneauPartager.getByText("Accès par défaut", { exact: true })).toBeVisible()
        await expect(panneauPartager.getByText("Seulement les personnes ajoutées")).toBeVisible()
        await expect(panneauPartager).not.toContainText(/règle/i)
        await panneauPartager.getByRole("combobox", { name: "Ajouter une personne ou une équipe" }).fill("e")
        await expect(panneauPartager.getByRole("listbox", { name: "Personnes et équipes" })).toBeVisible()
        await capturer(page, testInfo, `partager-${nom}`)
        await page.keyboard.press("Escape")
        await page.keyboard.press("Escape")
        await expect(panneauPartager).toHaveCount(0)

        // « Sous-pages » (E11-S05, AC-e1, qui remplace « Contenus liés » d'AC-b6) : replié, hors de la carte des blocs.
        const sousPages = page.locator("details.oto-linked").filter({ has: page.locator("summary strong", { hasText: "Sous-pages" }) })
        await expect(sousPages).not.toHaveAttribute("open")
        await expect(sousPages.locator("xpath=ancestor::*[contains(@class, 'oto-island')]")).toHaveCount(0)
        await sousPages.locator("summary").click()
        await expect(sousPages.getByRole("list", { name: "Sous-pages" }).getByRole("link", { name: /^Enfant d'essai/ })).toBeVisible()
        // Les liens lus, un encart vide n'est pas rendu.
        await attendre(page.getByText("Lecture des liens…")).toHaveCount(0)
        await expect(page.locator("details.oto-linked summary strong", { hasText: /^Cit/ })).toHaveCount(0)
        await capturer(page, testInfo, `encarts-${nom}`)
        await context.close()
      })
    }
  }
})
