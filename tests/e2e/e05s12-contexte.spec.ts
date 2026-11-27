import { expect, test, type Locator, type Page } from "@playwright/test"
import { clientAuth } from "./fixtures/base"
import { assurerLeNoeud, attendre, capturer, lireLeHtml, seConnecterSurLEspace } from "./fixtures/noeud"
import { CHEMINS, ESPACE, SANS_ESPACE } from "./fixtures/espace"

// Contrôle visuel connecté des écrans du Contexte après E05-S12, lot C, et E11-S05, lot e : le compte E2E,
// administrateur de l'organisation (`espace.ts`), en clair puis en sombre, à 375 et à 1 280 px. Une page jetable
// `private/<handle>/essai_e05s12` et une page rangée sous le Contexte Privé (D110) donnent à l'une et à l'autre leur
// encart « Sous-pages ». À 1 280 px, rail ouvert, la colonne de droite commence au haut de la carte, dans une piste
// d'au moins 270 px : sur la page, « Sous-pages » ; sur le Contexte, « À quoi sert cette page » (AC-21, E11-S05 AC-e1,
// AC-e2) ; à 375 px, une colonne, la carte puis les encarts (AC-e5) ; aucun défilement horizontal du contenu, sur le
// Contexte et sur la vue « Contexte », à `/context` depuis E11-S10, sans « Règles Oto » ni tête servie. Une capture par
// étape dans `test-results/`.

const email = process.env.E2E_USER_EMAIL ?? ""
const password = process.env.E2E_USER_PASSWORD ?? ""
const MODES = ["light", "dark"] as const
const LARGEURS = [375, 1_280] as const

// Les passages créent les mêmes pages jetables : l'un après l'autre.
test.describe.configure({ mode: "serial" })

async function boite(element: Locator) {
  const lue = await element.boundingBox()
  if (!lue) throw new Error("élément non mesuré")
  return lue
}

/** Le contenu ne défile pas en largeur : c'est `.oto-content` qui défile, le bureau (`documentElement`) jamais. */
async function sansDefilementHorizontal(page: Page): Promise<boolean> {
  return page.locator(".oto-content").first().evaluate((contenu) => contenu.scrollWidth <= contenu.clientWidth)
}

/**
 * La colonne de droite commence au haut de la carte du document, à droite d'elle, lisible (280 px, `--annexes-w`,
 * sous 1 410 px de contenu) ; sous 1 024 px, une colonne, sous la carte (AC-21 ; E11-S05, AC-e1, AC-e5).
 */
async function colonneALaCarte(page: Page, premier: Locator, largeur: number) {
  const carte = page.locator(".oto-two-columns-main .oto-island").first()
  await attendre(carte).toBeVisible()
  await attendre(premier).toBeVisible()
  const [enCarte, enColonne] = [await boite(carte), await boite(premier)]
  if (largeur === 1_280) {
    expect(Math.abs(enColonne.y - enCarte.y)).toBeLessThanOrEqual(1)
    expect(enColonne.x).toBeGreaterThan(enCarte.x + enCarte.width)
    expect(enColonne.width).toBeGreaterThanOrEqual(270)
  } else {
    expect(enColonne.y).toBeGreaterThan(enCarte.y + enCarte.height)
  }
}

test.describe("écrans du Contexte (E05-S12, lot C)", () => {
  test.skip(!ESPACE.semee, SANS_ESPACE)

  test.beforeAll(async () => {
    const { error } = await clientAuth().auth.signInWithPassword({ email, password })
    test.skip(error !== null, "E2E account missing from the Supabase project: run pnpm demo:seed (E01-S05)")
  })

  for (const mode of MODES) {
    for (const largeur of LARGEURS) {
      test(`should align the right column with the card, on a page and on a Contexte (${mode}, ${largeur} px)`, async ({ browser }, testInfo) => {
        test.setTimeout(600_000)
        const context = await browser.newContext({ colorScheme: mode, viewport: { width: largeur, height: 900 } })
        const page = await context.newPage()
        const nom = `${mode}-${largeur}`
        await seConnecterSurLEspace(page, { email, password })
        // Le `handle` du compte, lu dans le lien de son Contexte Privé, que le rail rend côté serveur à toute largeur.
        const servi = await lireLeHtml(page, `/n/${CHEMINS.contexteDeLEquipe}`)
        const handle = /\/n\/private\/([a-z0-9_]+)\/contexte/.exec(servi)?.[1]
        expect(handle).toBeTruthy()
        const essai = `private/${handle}/essai_e05s12`
        await assurerLeNoeud(page, { chemin: essai, titre: "Essai du lot C", resume: "Page jetable du contrôle visuel d'E05-S12." })
        await assurerLeNoeud(page, { chemin: `${essai}/enfant`, titre: "Enfant", resume: "Sous-page jetable." })
        await assurerLeNoeud(page, { chemin: `private/${handle}/contexte/essai_e05s12`, titre: "Rangée sous le Contexte", resume: "Page jetable sous le Contexte Privé (D110)." })

        // Une page : « Sous-pages » en tête de la colonne de droite ; ni chapô ni résumé (E11-S05, AC-f1).
        await page.goto(`${ESPACE.adresse}/n/${essai}`)
        await colonneALaCarte(page, page.locator(".oto-two-columns-aside details.oto-linked").first(), largeur)
        await expect(page.locator(".oto-node-lead")).toHaveCount(0)
        await expect(page.getByText("Page jetable du contrôle visuel d'E05-S12.")).toHaveCount(0)
        expect(await sansDefilementHorizontal(page)).toBe(true)
        await capturer(page, testInfo, `page-${nom}`)

        // Le Contexte Privé : « À quoi sert cette page » en tête de la colonne de droite, replié (AC-e2).
        await page.goto(`${ESPACE.adresse}/n/private/${handle}/contexte`)
        const aQuoiSert = page.getByRole("group", { name: "À quoi sert cette page" })
        await colonneALaCarte(page, aQuoiSert, largeur)
        await expect(aQuoiSert).not.toHaveAttribute("open")
        expect(await sansDefilementHorizontal(page)).toBe(true)
        await capturer(page, testInfo, `contexte-${nom}`)

        // E11-S10 (lot f) : la vue « Contexte », à `/context`, sans « Règles Oto », sans tête servie ni lien vers
        // Profil dans la partie Privé ; aucune ancienne partie (AC-6).
        await page.goto(`${ESPACE.adresse}/context`)
        const prive = page.getByRole("region", { name: "Mes instructions" })
        await attendre(prive).toBeVisible()
        await expect(page.getByRole("region", { name: "Règles Oto" })).toHaveCount(0)
        await expect(page.getByRole("main")).not.toContainText("How this workspace works")
        await expect(prive.getByText(/^## Context:|^You: /)).toHaveCount(0)
        await expect(prive.getByRole("link", { name: "Modifier dans Profil" })).toHaveCount(0)
        await expect(page.getByRole("region", { name: "Vous", exact: true })).toHaveCount(0)
        expect(await sansDefilementHorizontal(page)).toBe(true)
        await capturer(page, testInfo, `contexte-vue-${nom}`)
        await context.close()
      })
    }
  }
})
