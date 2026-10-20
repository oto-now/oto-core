import { expect, test } from "@playwright/test"
import { auRepos } from "./fixtures/au-repos"
import { clientAuth, compteDuStaff } from "./fixtures/base"
import { seConnecterSurLEspace } from "./fixtures/noeud"
import { ESPACE, SANS_ESPACE } from "./fixtures/espace"

// Contrôle visuel connecté de l'usage et des retours (E08-S09, AC14, AC15), sur les écrans portés
// d'oto-frontend (E05-S09 partie d2) : le compte E2E, administrateur de l'organisation de la campagne
// (`espace.ts`, semée par les sections `journal` et `usage`) et de l'équipe plateforme, en clair puis en sombre.
// `/admin/usage` est caché : la page répond 404 (E05-S13, AC-8). `/admin/feedback`, réservé au staff (E05-S13,
// AC-9), sous « Tous » : les trois tickets, « Prendre en compte » sur le ticket ouvert puis « Rouvrir », qui rend
// l'état semé. Une capture par écran et par mode dans `test-results/`, et les retours dans les huit thèmes, posés
// sur la racine `.oto` (AC-x1, AC-x3). En série : les deux modes changent le même ticket.

const email = process.env.E2E_USER_EMAIL ?? ""
const password = process.env.E2E_USER_PASSWORD ?? ""
const MODES = ["light", "dark"] as const
const THEMES = ["manuscrit", "ardoise", "grenat", "brique", "foret", "lagune", "cobalt", "violet"]
const OUVERT = "L'écriture dans le tableau des prospects a été refusée sans dire quelle valeur posait problème."

test.describe("admin usage and feedback", () => {
  test.describe.configure({ mode: "serial" })
  // Un parcours et ses captures, dont les huit thèmes dans les deux modes, sur un serveur de développement qui
  // compile chaque écran à sa première ouverture : au-delà des 30 s par défaut.
  test.setTimeout(240_000)
  test.skip(!ESPACE.semee, SANS_ESPACE)

  test.beforeAll(async () => {
    const { error } = await clientAuth().auth.signInWithPassword({ email, password })
    test.skip(error !== null, "E2E account missing from the Supabase project: run pnpm demo:seed (E01-S05)")
    // `/admin/feedback` est réservé au staff (E05-S13, AC-9) : un compte E2E hors de l'équipe plateforme n'y entre pas.
    test.skip(!(await compteDuStaff(email)), "E2E account is not platform staff: /admin/feedback is staff-only (E05-S13, AC-9)")
  })

  for (const mode of MODES) {
    test(`should show the statistics, then acknowledge and reopen the open ticket (${mode})`, async ({ browser }, testInfo) => {
      const adresse = ESPACE.adresse
      // Plus haute que la fenêtre des captures d'oto-frontend : les retours tiennent en entier, le contenu défilant
      // dans son cadre, pas dans le document.
      const page = await browser.newPage({ colorScheme: mode, viewport: { width: 1920, height: 1800 } })
      const capturer = (nom: string) => page.screenshot({ path: testInfo.outputPath(`${nom}-${mode}.png`), caret: "initial" }).then(() => undefined)
      await seConnecterSurLEspace(page, { email, password })

      // 1.4.13 : l'usage est l'onglet Statistiques d'« Activité », où mène son ancienne adresse, avec ses îlots ajoutés.
      expect((await page.goto(`${adresse}/admin/usage?period=7`))?.status()).toBe(200)
      await expect(page).toHaveURL(`${adresse}/journal?tab=statistics&period=7`)
      await expect(page.getByRole("heading", { level: 1, name: "Activité" })).toBeVisible()
      await expect(page.getByRole("tab", { name: "Statistiques" })).toHaveAttribute("aria-selected", "true")
      for (const titre of ["Adoption", "Par équipe", "Par personne", "Contenu", "Partage et connecteurs"]) await expect(page.getByRole("heading", { level: 2, name: titre })).toBeVisible()
      await capturer("statistiques")

      await page.goto(`${adresse}/admin/feedback?state=all`)
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Retours des assistants")
      await expect(page.getByRole("radiogroup", { name: "Filtrer par état" }).getByRole("radio", { name: "Tous" })).toHaveAttribute("aria-checked", "true")
      const ouvert = page.getByRole("row").filter({ hasText: OUVERT })
      for (const texte of ["Il manque un moyen de compter les prospects", OUVERT, "Aucune procédure ne prépare le planning"]) {
        await expect(page.getByRole("row").filter({ hasText: texte })).toHaveCount(1)
      }
      // Le geste attend sa réponse puis la relecture de la page. Le premier `PATCH` d'un serveur de développement
      // compile la route de l'API : 4,6 s, puis 2,9 s de relecture, au calme ; plus de 9 s sous une campagne complète
      // (mesuré) ; les gestes suivants, 1 à 2 s. D'où le délai, comme le `PATCH admin/org` d'`admin-config`.
      await ouvert.getByRole("button", { name: /^Prendre en compte/ }).click()
      await expect(ouvert.getByRole("cell", { name: "Pris en compte", exact: true })).toBeVisible({ timeout: 20_000 })
      await ouvert.getByRole("button", { name: /^Rouvrir/ }).click()
      await expect(ouvert.getByRole("cell", { name: "Ouvert", exact: true })).toBeVisible({ timeout: 20_000 })
      await auRepos(page.getByRole("main"))
      await capturer("retours")
      for (const theme of THEMES) {
        await page.evaluate((cle) => document.querySelector(".oto")?.setAttribute("data-oto-theme", cle), theme)
        await auRepos(page.getByRole("main"))
        await capturer(`retours-${theme}`)
      }
      await page.close()
    })
  }
})
