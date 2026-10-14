import { expect, test, type Locator, type Page } from "@playwright/test"
import { tableHeaderSchema } from "../../packages/plateforme/schemas"
import { isRecord } from "../../packages/plateforme/schemas/tables"
import { avecLaBase, clientAuth } from "./fixtures/base"
import { CHEMINS, ESPACE, idDeLEspace, SANS_ESPACE } from "./fixtures/espace"
import { assurerLeNoeud, attendre, capturer, lireLeHtml, ouvrirAQuoiSert, ouvrirLeRail, seConnecterSurLEspace } from "./fixtures/noeud"

// Contrôle visuel connecté des écrans d'un contenu après E11-S05 : le compte E2E, administrateur de l'organisation de
// la campagne (`espace.ts`), en clair puis en sombre, à 375 et à 1 280 px. Une page jetable `private/<handle>/essai_e11s05`,
// sa sous-page et une page qui la cite : « Cité dans », « Cite » et « Sous-pages » dans la colonne de droite, fermés,
// sous la carte à 375 px, un encart s'ouvre (AC-e1, AC-e5) ; le Contexte Privé : « À quoi sert cette page » en tête de la
// colonne, ouvert par Entrée (AC-e2) ; le tableau de l'équipe : ses encarts en ligne au-dessus de la grille, le chevron
// d'une cellule au survol, puis ouverte, la ligne à revoir, « Télécharger en .csv » (AC-a1, AC-a4, AC-c1, AC-e3) ; un
// tableau et une page créés par le « + » du rail : le vide nommé par l'assistant (AC-h1), le Texte vide, son invite et
// le focus (AC-g1, AC-g2), puis mis à la corbeille. Aucun défilement horizontal. Une capture par étape dans `test-results/`.

const email = process.env.E2E_USER_EMAIL ?? ""
const password = process.env.E2E_USER_PASSWORD ?? ""
const MODES = ["light", "dark"] as const
const LARGEURS = [375, 1_280] as const
const INVITE = "Commencer à écrire... Utilisez '/' pour afficher tous les types de blocs - Utilisez '@' pour citer un autre contenu (page, tableau, procédure) de l'espace"

// Les passages écrivent les mêmes pages jetables : l'un après l'autre.
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

/** Le titre et le total des encarts de la page, dans l'ordre du document. */
const encarts = (racine: Locator) => racine.locator("details.oto-linked > summary").allInnerTexts()

/** Un nœud neuf, créé par le « + » de la ligne « Contexte · Privé » du rail ; rend son chemin. */
async function creerDansPrive(page: Page, largeur: number, genre: "Une page" | "Un tableau"): Promise<string> {
  const rail = await ouvrirLeRail(page, largeur)
  const ligne = rail.getByRole("link", { name: "Contexte · Privé", exact: true })
  await ligne.hover()
  await ligne.locator("xpath=..").getByRole("button", { name: "Ajouter dans Contexte · Privé" }).click()
  await page.getByRole("menuitem", { name: genre }).click()
  await attendre(page).toHaveURL(/\/contexte\/sans_titre(_\d+)?$/)
  return new URL(page.url()).pathname.slice("/n/".length)
}

/**
 * Les clés des lignes « à revoir » du tableau de l'équipe, lues par la connexion d'administration juste avant la
 * vérification, comme `tableau.spec.ts` : la revue d'un autre passage les change, jamais écrites en dur.
 */
async function clesARevoir(): Promise<Set<string>> {
  const orgId = await idDeLEspace()
  return avecLaBase(async (sql) => {
    const [noeud] = await sql<{ id: string; meta: unknown }[]>`select id, meta from platform.nodes where org_id = ${orgId} and path = ${CHEMINS.tableau}`
    if (!noeud) throw new Error(`${CHEMINS.tableau} missing from the campaign organisation`)
    const cycle = tableHeaderSchema.parse(noeud.meta).lifecycle
    if (!cycle?.review) throw new Error(`${CHEMINS.tableau} declares no review: see scripts/demo/50-tableau.mjs`)
    const lignes = await sql<{ key: string | null; data: unknown }[]>`
      select key, data from platform.blocks where node_id = ${noeud.id} and state = 'published' and type = 'row'`
    return new Set(lignes.flatMap((ligne) => (ligne.key !== null && isRecord(ligne.data) && ligne.data[cycle.column] === cycle.review?.state ? [ligne.key] : [])))
  })
}

async function alaCorbeille(page: Page, chemin: string): Promise<void> {
  const statut = await page.evaluate(
    async (corps) => (await fetch("/api/platform/trash", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corps) })).status,
    { path: chemin },
  )
  expect(statut).toBe(200)
}

test.describe("écrans d'un contenu (E11-S05)", () => {
  test.skip(!ESPACE.semee, SANS_ESPACE)

  test.beforeAll(async () => {
    const { error } = await clientAuth().auth.signInWithPassword({ email, password })
    test.skip(error !== null, "E2E account missing from the Supabase project: run pnpm demo:seed (E01-S05)")
  })

  for (const mode of MODES) {
    for (const largeur of LARGEURS) {
      test(`should show the encarts, the cells, the download and the empty page and table (${mode}, ${largeur} px)`, async ({ browser }, testInfo) => {
        test.setTimeout(900_000)
        const context = await browser.newContext({ colorScheme: mode, viewport: { width: largeur, height: 900 } })
        const page = await context.newPage()
        const nom = `${mode}-${largeur}`
        await seConnecterSurLEspace(page, { email, password })
        const servi = await lireLeHtml(page, `/n/${CHEMINS.contexteDeLEquipe}`)
        const handle = /\/n\/private\/([a-z0-9_]+)\/contexte/.exec(servi)?.[1]
        expect(handle).toBeTruthy()

        // Lot e : une page, sa sous-page, et une page qui la cite.
        const essai = `private/${handle}/essai_e11s05`
        await assurerLeNoeud(page, { chemin: essai, titre: "Essai des encarts", resume: "Page jetable du contrôle visuel d'E11-S05." })
        await assurerLeNoeud(page, { chemin: `${essai}/dessous`, titre: "Dessous", resume: "Sous-page jetable." })
        // Un chemin par passage : un nœud à la corbeille garde le sien, et une création sur ce chemin est refusée.
        const citant = `private/${handle}/essai_e11s05_citant_${Date.now().toString(36)}`
        const creee = await page.evaluate(
          async (corps) => (await fetch("/api/platform/nodes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corps) })).status,
          { path: citant, title: "Essai citant", summary: "Page jetable qui cite.", publish: true, ops: [{ op: "insert_after", input: { type: "paragraph", text: `Voir [[${essai}]].` } }] },
        )
        expect(creee).toBe(200)
        try {
          await page.goto(`${ESPACE.adresse}/n/${essai}`)
          const colonne = page.locator(".oto-two-columns-aside")
          await attendre(colonne.locator("details.oto-linked").first()).toBeVisible()
          await attendre(page.getByText("Lecture des liens…")).toHaveCount(0)
          expect((await encarts(colonne)).map((texte) => texte.replace(/\d+$/, "").trim())).toEqual(["Cité dans", "Sous-pages"])
          const carte = page.locator(".oto-two-columns-main .oto-island").first()
          const [enCarte, enColonne] = [await boite(carte), await boite(colonne.locator("details.oto-linked").first())]
          if (largeur === 1_280) expect(Math.abs(enColonne.y - enCarte.y)).toBeLessThanOrEqual(1)
          else expect(enColonne.y).toBeGreaterThan(enCarte.y + enCarte.height)
          const sousPages = colonne.locator("details.oto-linked").filter({ hasText: "Sous-pages" })
          await sousPages.locator("summary").click()
          await expect(sousPages).toHaveAttribute("open", "")
          await expect(sousPages.getByRole("link", { name: /^Dessous/ })).toBeVisible()
          expect(await sansDefilementHorizontal(page)).toBe(true)
          await capturer(page, testInfo, `page-encarts-${nom}`)
        } finally {
          await alaCorbeille(page, citant)
        }

        // AC-e2 : le Contexte Privé, « À quoi sert cette page » en tête de la colonne, ouvert par Entrée.
        await page.goto(`${ESPACE.adresse}/n/private/${handle}/contexte`)
        const aQuoiSert = await ouvrirAQuoiSert(page)
        await expect(aQuoiSert.getByText("Vous l'écrivez comme n'importe quelle page.")).toBeVisible()
        expect(await sansDefilementHorizontal(page)).toBe(true)
        await capturer(page, testInfo, `contexte-${nom}`)

        // Lots a, c et e : le tableau de l'équipe, ses encarts sur une ligne au-dessus de la grille, la grille pleine largeur.
        await page.goto(`${ESPACE.adresse}/n/${CHEMINS.tableau}`)
        const grille = page.getByRole("table").first()
        await attendre(grille).toBeVisible()
        await expect(page.locator(".oto-two-columns")).toHaveCount(0)
        await expect(page.getByRole("button", { name: "Télécharger en .csv" })).toBeVisible()
        // Les lignes à revoir de la première page, et elles seules, sont marquées (AC-a4).
        const aRevoir = await clesARevoir()
        const affichees = (await grille.locator("tbody td[data-primary]").allInnerTexts()).map((texte) => texte.split("\n")[0].trim())
        await expect(grille.locator('tbody tr[data-state="review"]')).toHaveCount(affichees.filter((cle) => aRevoir.has(cle)).length)
        const summary = grille.locator("tbody .oto-cell-detail > summary").first()
        if (largeur === 1_280 && (await summary.count()) > 0) {
          await summary.locator("xpath=ancestor::td[1]").hover()
          await attendre(summary.locator(".oto-cell-chevron")).toHaveCSS("opacity", "1")
          await capturer(page, testInfo, `cellule-survolee-${nom}`)
          await summary.click()
          await expect(summary.locator("xpath=..")).toHaveAttribute("open", "")
          await capturer(page, testInfo, `cellule-ouverte-${nom}`)
        }
        await capturer(page, testInfo, `tableau-${nom}`)

        // Lot h : un tableau neuf est vide ; il dit qui écrira ses lignes (l'absence d'alerte est prouvée par `noeud-tableau-page.test.tsx`).
        const tableau = await creerDansPrive(page, largeur, "Un tableau")
        try {
          await attendre(page.getByText("Ce tableau est vide", { exact: true })).toBeVisible()
          await expect(page.getByText(/^C'est (Claude|ChatGPT|votre assistant) qui pourra créer et modifier ses lignes\.$/)).toBeVisible()
          await capturer(page, testInfo, `tableau-vide-${nom}`)
        } finally {
          await alaCorbeille(page, tableau)
        }

        // Lot g : une page neuve, titre sélectionné ; Entrée mène au Texte vide, qui porte l'invite.
        const vide = await creerDansPrive(page, largeur, "Une page")
        try {
          const titre = page.getByRole("textbox", { name: "Titre", exact: true })
          await attendre(titre).toBeFocused()
          await page.keyboard.type("Page vide d'essai")
          await page.keyboard.press("Enter")
          const texte = page.getByRole("textbox", { name: /^Modifier ce texte — / })
          await attendre(texte).toBeFocused()
          await expect(texte).toHaveAttribute("placeholder", INVITE)
          await expect(page.getByText("Cette page n'a pas encore de contenu.")).toHaveCount(0)
          expect(await sansDefilementHorizontal(page)).toBe(true)
          await capturer(page, testInfo, `page-vide-${nom}`)
        } finally {
          await alaCorbeille(page, vide)
        }
        await context.close()
      })
    }
  }
})
