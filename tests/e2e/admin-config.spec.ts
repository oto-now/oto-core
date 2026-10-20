import { expect, test, type Page } from "@playwright/test"
import { auRepos } from "./fixtures/au-repos"
import { avecLaBase, clientAuth } from "./fixtures/base"
import { seConnecterSurLEspace } from "./fixtures/noeud"
import { EQUIPE, ESPACE, SANS_ESPACE } from "./fixtures/espace"

// Contrôle visuel connecté du tableau de bord (E08-S03, AC1 à AC9, AC12), sur les écrans portés d'oto-frontend
// (E05-S09 partie d2) : le compte E2E, administrateur de l'organisation de la campagne (`espace.ts`), ouvre
// « Organisation » depuis le menu de l'entreprise, en tête du rail (AC-a4), et « Connecteurs » depuis le pied du
// rail (E05-S11, AC-32), en clair puis en sombre ; « Organisation » porte le fil des réglages, dont le maillon
// courant ouvre ses frères (Organisation, Équipes & accès, Journal : E05-S11, AC-33 ; E05-S13, AC-10) ; il change
// le nom de l'organisation, seul champ de « L'entreprise », sans « Domaines de travail » ni « Nom affiché »
// (E05-S13, AC-1, AC-3), relit la page, puis remet l'ancien nom ; il ouvre la question de la désactivation de
// `mail` et garde le connecteur. « Organisation » porte la marque et le Contexte de Tout le monde, sans seuils ni
// annexes (E05-S11, AC-22 à AC-24) ; les adresses des écrans retirés répondent 404 depuis E11-S07
// (`e11s07-adresses.spec.ts`). Le nom d'avant est remis par la connexion d'administration si
// le parcours échoue en route. Une capture par page et par mode dans `test-results/`, « Organisation » à 375 et
// 1 280 px, et dans les huit thèmes, posés sur la racine `.oto` de la page sans écrire la marque (AC-x1, AC-x3).

const email = process.env.E2E_USER_EMAIL ?? ""
const password = process.env.E2E_USER_PASSWORD ?? ""
const ADRESSE = ESPACE.adresse
const MODES = ["light", "dark"] as const
const THEMES = ["manuscrit", "ardoise", "grenat", "brique", "foret", "lagune", "cobalt", "violet"]

type Parcours = { page: Page; capturer: (nom: string) => Promise<void> }

/** Le maillon courant du fil de l'en-tête : l'écran ouvert. */
const ecranOuvert = (page: Page, nom: string) => page.getByRole("navigation", { name: "Chemin" }).getByRole("button", { name: nom, exact: true })

/** Ouvre une entrée du menu de l'entreprise et attend son écran, que le fil nomme. */
async function ouvrir(page: Page, entree: string) {
  await page.getByRole("navigation", { name: "Navigation principale" }).getByRole("button", { name: /^Entreprise : / }).click()
  await page.getByRole("menu").getByRole("menuitem", { name: entree, exact: true }).click()
  await expect(ecranOuvert(page, entree)).toHaveAttribute("aria-current", "page")
}

/** L'organisation de la campagne, lue et remise par la connexion d'administration (outillage des tests, jamais l'application). */
async function lireLOrganisation() {
  const [org] = await avecLaBase((sql) => sql<{ id: string; name: string }[]>`select id, name from platform.orgs where slug = ${ESPACE.slug}`)
  if (!org) throw new Error("campaign organisation not found")
  return org
}

async function organisation({ page, capturer }: Parcours) {
  await ouvrir(page, "Organisation")
  const { name } = await lireLOrganisation()
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name)
  // La marque et le Contexte de Tout le monde ; ni seuils ni annexes d'hier (E05-S11, AC-22 à AC-24).
  for (const ilot of ["L’entreprise", "Le logo", "La couleur", "Contexte · Tout le monde"]) await expect(page.getByRole("region", { name: ilot })).toBeVisible()
  await expect(page.getByLabel("Seuil de routage")).toHaveCount(0)
  await expect(page.getByRole("region", { name: "Adresses et outils" })).toHaveCount(0)
  // Un seul nom, celui de l'organisation : ni domaines de travail ni nom affiché (E05-S13, AC-1, AC-3).
  await expect(page.getByLabel("Domaines de travail")).toHaveCount(0)
  await expect(page.getByLabel("Nom affiché")).toHaveCount(0)
  await expect(page.getByRole("region", { name: "Contexte · Tout le monde" }).getByRole("link", { name: "Modifier" })).toHaveAttribute("href", "/n/contexte")
  for (const largeur of [375, 1280]) {
    await page.setViewportSize({ width: largeur, height: 900 })
    await auRepos(page.getByRole("main"))
    await capturer(`organisation-${largeur}`)
  }
  await page.setViewportSize({ width: 1920, height: 1080 })
  const entreprise = page.getByRole("region", { name: "L’entreprise" })
  const essai = `${name} e2e`
  // « Enregistrer » de « L'entreprise » : celui de la marque, au bout de « La couleur », recharge la page.
  const enregistrer = () => entreprise.getByRole("button", { name: "Enregistrer" }).click()
  await entreprise.getByLabel("Nom", { exact: true }).fill(essai)
  await enregistrer()
  // Le premier `PATCH admin/org` d'un serveur de développement compile sa route : au-delà des 5 s par défaut (mesuré, E05-S11 d).
  await expect(page.getByRole("status").filter({ hasText: "Enregistré" })).toBeVisible({ timeout: 20_000 })
  await page.reload()
  await expect(entreprise.getByLabel("Nom", { exact: true })).toHaveValue(essai)
  await capturer("organisation")
  await entreprise.getByLabel("Nom", { exact: true }).fill(name)
  await enregistrer()
  await expect(page.getByRole("status").filter({ hasText: "Enregistré" })).toBeVisible()
}

async function connecteurs({ page, capturer }: Parcours) {
  // Une ligne du pied du rail, pour qui administre (E05-S11, AC-32) ; son écran n'a plus de fil (aucun groupe du menu).
  const ligne = page.getByRole("navigation", { name: "Navigation principale" }).getByRole("link", { name: "Connecteurs", exact: true })
  await ligne.click()
  // Seule spec à ouvrir « Connecteurs » : un serveur de développement y compile l'écran, au-delà des 5 s par défaut
  // sous une campagne complète (constaté).
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Connecteurs", { timeout: 20_000 })
  await expect(ligne).toHaveAttribute("aria-current", "page")
  await expect(page.getByText(/^Actif depuis le /)).toBeVisible()
  await expect(page.getByText(new RegExp(`^Mail ${EQUIPE.nom} · mail · équipe ${EQUIPE.nom} · simulé · `))).toBeVisible()
  await page.getByRole("button", { name: "Désactiver mail" }).click()
  await expect(page.getByText(/^Désactiver « mail » \? Ses fonctions cesseront aussitôt de répondre/)).toBeVisible()
  await capturer("connecteurs")
  await page.getByRole("button", { name: "Garder" }).click()
  await expect(page.getByRole("button", { name: "Désactiver mail" })).toBeFocused()
  await expect(page.getByText(/^Actif depuis le /)).toBeVisible()
}

/** Le fil des réglages ; les écrans retirés (E05-S11, AC-25) n'ont plus d'adresse, 404 (E11-S07, `e11s07-adresses.spec.ts`). */
async function filDesReglages({ page, capturer }: Parcours) {
  // Le maillon courant du fil ouvre ses frères (settings-shell) : les réglages, « Activité » (l'ancien Journal) compris
  // (E05-S11, AC-33 ; E05-S13, AC-10 ; 1.4.13), puis « Équipes & accès », sans onglet d'accès plateforme (E05-S13, AC-5).
  await ouvrir(page, "Organisation")
  await ecranOuvert(page, "Organisation").click()
  const freres = page.getByRole("menu")
  await auRepos(freres)
  await expect(freres.getByRole("menuitemradio")).toHaveText(["Organisation", "Équipes & accès", "Activité"])
  await capturer("fil-des-reglages")
  await freres.getByRole("menuitemradio", { name: "Équipes & accès" }).click()
  await expect(page).toHaveURL(`${ADRESSE}/teams`)
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Équipes & accès")
  await expect(page.getByRole("tab", { name: "Accès plateforme" })).toHaveCount(0)
  await capturer("equipes")
}

test.describe("tableau de bord : configuration", () => {
  test.skip(!ESPACE.semee, SANS_ESPACE)

  test.beforeAll(async () => {
    const { error } = await clientAuth().auth.signInWithPassword({ email, password })
    test.skip(error !== null, "E2E account missing from the Supabase project: run pnpm demo:seed (E01-S05)")
  })

  // Les deux modes écrivent le même nom d'organisation : l'un après l'autre.
  test.describe.configure({ mode: "serial" })
  // Un parcours et ses captures, dont les huit thèmes dans les deux modes, sur un serveur de développement qui
  // compile chaque écran à sa première ouverture : au-delà des 30 s par défaut.
  test.setTimeout(240_000)

  for (const mode of MODES) {
    test(`should open the pages from the menu and their trail, save the organisation name, keep mail active and redirect the removed pages (${mode})`, async ({ browser }, testInfo) => {
      const avant = await lireLOrganisation()
      const page = await browser.newPage({ colorScheme: mode, viewport: { width: 1920, height: 1080 } })
      const capturer = (nom: string) => page.screenshot({ path: testInfo.outputPath(`${nom}-${mode}.png`), fullPage: true, caret: "initial" }).then(() => undefined)
      try {
        await seConnecterSurLEspace(page, { email, password })
        for (const etape of [organisation, connecteurs, filDesReglages]) await etape({ page, capturer })

        await ouvrir(page, "Organisation")
        for (const theme of THEMES) {
          await page.evaluate((cle) => document.querySelector(".oto")?.setAttribute("data-oto-theme", cle), theme)
          await auRepos(page.getByRole("main"))
          await capturer(`organisation-${theme}`)
        }
      } finally {
        await page.close()
        await avecLaBase((sql) => sql`update platform.orgs set name = ${avant.name} where id = ${avant.id}`)
      }
    })
  }
})
