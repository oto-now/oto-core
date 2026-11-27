import { expect, test, type Browser, type Page } from "@playwright/test"
import type { JSONValue } from "postgres"
import { avecLaBase, clientAuth } from "./fixtures/base"
import { auRepos } from "./fixtures/au-repos"
import { ESPACE, SANS_ESPACE } from "./fixtures/espace"
import { seConnecterSurLEspace } from "./fixtures/noeud"

// Contrôle visuel connecté de la marque (E09-S01, AC13), sur l'écran porté d'oto-frontend (E05-S09 partie d2 :
// `settings.appearance.lazy.tsx`) : le compte E2E, administrateur de l'organisation de la campagne (`espace.ts`),
// règle la marque dans « Organisation » (`/admin/organization`, E05-S11 AC-22), en clair
// puis en sombre, en cliquant la carte d'un thème ; le nom montré est celui de l'organisation, sans « Nom affiché »
// (E05-S13, AC-3) ; captures de l'écran, de l'écran dans les huit thèmes (posés sur la racine `.oto`, sans écrire
// la marque), et de `/login` (sans session) dans `test-results/`. La marque d'origine (`orgs.brand`), lue au début
// par la connexion d'administration, y est réécrite telle quelle à la fin, sans passer par l'écran testé (comme
// `admin-config.spec`) : les autres specs de la campagne capturent la même organisation.

const email = process.env.E2E_USER_EMAIL ?? ""
const password = process.env.E2E_USER_PASSWORD ?? ""
const MODES = ["light", "dark"] as const
const THEMES = ["manuscrit", "ardoise", "grenat", "brique", "foret", "lagune", "cobalt", "violet"]
const FORET = { theme: "foret", logo: "https://example.com/logo.png" }
const NOMS: Record<string, string> = {
  manuscrit: "Manuscrit",
  ardoise: "Ardoise",
  grenat: "Grenat",
  brique: "Brique",
  foret: "Forêt",
  lagune: "Lagune",
  cobalt: "Cobalt",
  violet: "Violet",
}

type Marque = { theme: string; logo: string }

async function ouvrirLEcran(browser: Browser, colorScheme: "light" | "dark"): Promise<Page> {
  const page = await browser.newPage({ colorScheme, viewport: { width: 1920, height: 1080 } })
  await seConnecterSurLEspace(page, { email, password })
  await page.goto(`${ESPACE.adresse}/admin/organization`)
  await expect(page.getByRole("region", { name: "La couleur" })).toBeVisible()
  return page
}

async function enregistrer(page: Page, marque: Marque): Promise<void> {
  // La carte du thème, comme la personne la clique : le radio natif qu'elle porte est masqué à l'œil.
  await page.getByRole("group", { name: "Thème" }).locator("label").filter({ hasText: NOMS[marque.theme] }).click()
  await expect(page.getByRole("radio", { name: NOMS[marque.theme] })).toBeChecked()
  await page.getByLabel("Adresse du logo (https)").fill(marque.logo)
  // Plus de nom affiché : un seul nom, celui de l'organisation (E05-S13, AC-3).
  await expect(page.getByLabel("Nom affiché")).toHaveCount(0)
  // Le bouton de la marque, au bout de « La couleur » : celui de « L'entreprise » enregistre le nom.
  await page.getByRole("region", { name: "La couleur" }).getByRole("button", { name: "Enregistrer" }).click()
  await page.waitForURL(/\/admin\/organization\?saved=1$/)
}

test.describe("marque de l'organisation", () => {
  test.skip(!ESPACE.semee, SANS_ESPACE)
  // Une seule marque d'origine, relue une fois et remise une fois.
  test.describe.configure({ mode: "serial" })
  // Un parcours et ses captures, dont les huit thèmes dans les deux modes, sur un serveur de développement qui
  // compile chaque écran à sa première ouverture : au-delà des 30 s par défaut.
  test.setTimeout(240_000)

  let origine: { id: string; brand: JSONValue } | null = null

  test.beforeAll(async () => {
    const { error } = await clientAuth().auth.signInWithPassword({ email, password })
    test.skip(error !== null, "E2E account missing from the Supabase project: run pnpm demo:seed (E01-S05)")
    const [lue] = await avecLaBase((sql) => sql<{ id: string; brand: JSONValue }[]>`select id, brand from platform.orgs where slug = ${ESPACE.slug}`)
    if (!lue) throw new Error("campaign organisation not found")
    origine = lue
  })

  test.afterAll(async () => {
    const remise = origine
    if (!remise) return
    await avecLaBase((sql) => sql`update platform.orgs set brand = ${sql.json(remise.brand)} where id = ${remise.id}`)
  })

  for (const mode of MODES) {
    test(`should save the brand and show it on the screen, the rail and /login (${mode})`, async ({ browser }, testInfo) => {
      const page = await ouvrirLEcran(browser, mode)
      await auRepos(page.getByRole("main"))
      await page.screenshot({ path: testInfo.outputPath(`marque-avant-${mode}.png`), caret: "initial" })

      await enregistrer(page, FORET)

      await expect(page.getByRole("status").filter({ hasText: "Marque enregistrée." })).toBeVisible()
      // Une seule racine `.oto` pour la page ; les pastilles du sélecteur en sont d'autres, voulues.
      const racines = page.locator('.oto:not([aria-hidden="true"])')
      await expect(racines).toHaveCount(1)
      await expect(racines).toHaveAttribute("data-oto-theme", "foret")
      await expect(page.getByRole("navigation", { name: "Navigation principale" }).getByRole("link", { name: ESPACE.nom, exact: true })).toBeVisible()
      await auRepos(page.getByRole("main"))
      await page.screenshot({ path: testInfo.outputPath(`marque-${mode}.png`), caret: "initial" })
      for (const theme of THEMES) {
        await page.evaluate((cle) => document.querySelector(".oto")?.setAttribute("data-oto-theme", cle), theme)
        await auRepos(page.getByRole("main"))
        await page.screenshot({ path: testInfo.outputPath(`marque-${theme}-${mode}.png`), caret: "initial" })
      }
      await page.close()

      // `/login` sur le gabarit (E05-S07, AC14 ; porté d'oto-frontend, E05-S09 partie d3) : le thème de
      // l'organisation sur la racine, son nom au-dessus de l'îlot « Se connecter ».
      const visiteur = await browser.newPage({ colorScheme: mode })
      await visiteur.goto(`${ESPACE.adresse}/login`)
      await expect(visiteur.getByRole("heading", { level: 2 })).toHaveText("Se connecter")
      await expect(visiteur.locator(".oto")).toHaveAttribute("data-oto-theme", "foret")
      // `admin-config`, en parallèle, renomme l'organisation en « <nom> e2e » le temps de son parcours : le nom se
      // lit avec ou sans ce suffixe (une course, pas un défaut de l'écran).
      await expect(visiteur.getByText(new RegExp(`^${ESPACE.nom}( e2e)?$`))).toBeVisible()
      await visiteur.screenshot({ path: testInfo.outputPath(`connexion-${mode}.png`), fullPage: true })
      await visiteur.close()
    })
  }
})
