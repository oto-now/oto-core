import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test"
import { tableHeaderSchema, type TableHeader } from "../../packages/plateforme/schemas"
import { isRecord } from "../../packages/plateforme/schemas/tables"
import { avecLaBase, clientAuth } from "./fixtures/base"
import { CHEMINS, ESPACE, idDeLEspace, SANS_ESPACE } from "./fixtures/espace"
import { seConnecterSurLEspace } from "./fixtures/noeud"

// Contrôle visuel connecté du tableau (E07-S03, AC19), sur la grille portée d'oto-frontend (E05-S09 partie
// c2, AC-c2, AC-x1, AC-x3) : le compte E2E, administrateur de l'organisation de la campagne et responsable de
// son équipe (`espace.ts`, semée par la section `tableau` : lignes « à revoir », page de la vue), en clair puis
// en sombre. La grille du tableau semé : méta, pied, résumé et file ; le tri par `montant_estime` (le bouton de
// l'en-tête) et le filtre `ville` « contient Valbrune » (le panneau de l'en-tête) changent l'adresse et les
// lignes, sans recharger le document ; la provenance d'une cellule s'ouvre au clavier ; une recherche sans
// réponse dit son vide ; puis la page de la vue rend sa vue et sa carte en place. En clair seulement, une ligne
// est approuvée puis une autre refusée, et le résumé les cite. Les nombres attendus se calculent sur l'en-tête et
// les blocs `row` lus juste avant chaque vérification, par la connexion d'administration (HN-E07S03-10,
// HN-E01S10-f2e2e-3) : jamais écrits en dur. Une capture par étape et par thème, et la grille dans les huit
// thèmes, posés sur la racine `.oto` de la page, sans écrire la marque.
//
// E11-S05 : l'icône de provenance d'une cellule (le chevron d'un repli jusqu'à la 1.4.11), invisible au repos, paraît au
// survol de la cellule, et reste montrée sous le profil mobile (AC-a1) ; une ligne à revoir est marquée, et l'îlot « À revoir » dit le cycle (AC-a4, AC-a5) ;
// « Télécharger en .csv », à gauche de « Partager », rend le fichier du tableau (AC-c1, AC-c2) ; la carte d'une page
// citée ne montre pas son résumé (AC-f2).

const email = process.env.E2E_USER_EMAIL ?? ""
const password = process.env.E2E_USER_PASSWORD ?? ""
const MODES = ["light", "dark"] as const
const THEMES = ["manuscrit", "ardoise", "grenat", "brique", "foret", "lagune", "cobalt", "violet"]
const TABLEAU = CHEMINS.tableau
const PAGE_DE_LA_VUE = CHEMINS.pageDeLaVue
const GRILLE_TARIFAIRE = CHEMINS.grilleTarifaire
const VILLE = "Valbrune"
/** Les lignes d'une première page de la grille (`n` par défaut), et celles de la vue de la page semée. */
const PREMIERE_PAGE = 20
const LIGNES_DE_LA_VUE = 5

// Les deux thèmes lisent le tableau que la revue change : l'un après l'autre, la revue en dernier.
test.describe.configure({ mode: "serial" })

// Serveur de développement sur la machine partagée par les agents : chaque route se compile à son premier appel.
const attendre = expect.configure({ timeout: 90_000 })

const NOMBRE = new Intl.NumberFormat("fr-FR")
const PAR_CLE = new Intl.Collator("fr", { numeric: true })
/** Comme le service (`normalizeTitle`) : sans casse ni accent. */
const normaliser = (texte: string) => texte.normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase()
const compte = (n: number, singulier: string, pluriel: string) => `${NOMBRE.format(n)} ${n > 1 ? pluriel : singulier}`
const nLignes = (n: number) => compte(n, "ligne", "lignes")
const echappe = (texte: string) => texte.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

type Ligne = { key: string; data: Record<string, unknown> }
type Demo = { titre: string; entete: TableHeader; lignes: Ligne[]; carte: { titre: string; resume: string } }

type NoeudLu = { id: string; path: string; title: string; summary: string; meta: unknown }

/** L'en-tête et les lignes du tableau, et la page citée par la carte, dans l'organisation de la campagne. */
async function lireLaDemo(): Promise<Demo> {
  const orgId = await idDeLEspace()
  return avecLaBase(async (sql) => {
    const noeuds = await sql<NoeudLu[]>`
      select id, path, title, summary, meta from platform.nodes where org_id = ${orgId} and path in ${sql([TABLEAU, GRILLE_TARIFAIRE])}`
    const tableau = noeuds.find((noeud) => noeud.path === TABLEAU)
    const grille = noeuds.find((noeud) => noeud.path === GRILLE_TARIFAIRE)
    if (!tableau || !grille) throw new Error(`${TABLEAU} or ${GRILLE_TARIFAIRE} missing from the campaign organisation`)
    const lues = await sql<{ key: string | null; data: unknown }[]>`
      select key, data from platform.blocks where node_id = ${tableau.id} and state = 'published' and type = 'row'`
    const lignes = lues.flatMap((ligne) => (ligne.key !== null && isRecord(ligne.data) ? [{ key: ligne.key, data: ligne.data }] : []))
    return { titre: tableau.title, entete: tableHeaderSchema.parse(tableau.meta), lignes, carte: { titre: grille.title, resume: grille.summary } }
  })
}

/** Ce que l'écran doit montrer pour ces lignes, sous un filtre facultatif sur la ville. */
function attendus({ entete, lignes }: Demo, ville?: (valeur: string) => boolean) {
  const cycle = entete.lifecycle
  if (!cycle?.review) throw new Error(`${TABLEAU} declares no review: see scripts/demo/50-tableau.mjs`)
  const colonne = cycle.column
  const retenues = ville ? lignes.filter((ligne) => typeof ligne.data.ville === "string" && ville(ligne.data.ville)) : lignes
  const montants = retenues.flatMap((ligne) => (typeof ligne.data.montant_estime === "number" ? [{ key: ligne.key, montant: ligne.data.montant_estime }] : []))
  const affichees = Math.min(retenues.length, PREMIERE_PAGE)
  return {
    cycle: { ...cycle, review: cycle.review },
    toutes: nLignes(lignes.length),
    retenues: retenues.length,
    pied: `${compte(affichees, "ligne affichée", "lignes affichées")} sur ${NOMBRE.format(retenues.length)}`,
    parEtat: `Par ${colonne} : ${cycle.states.map((etat) => `${etat} ${NOMBRE.format(retenues.filter((ligne) => ligne.data[colonne] === etat).length)}`).join(" · ")}`,
    somme: `montant_estime : total ${NOMBRE.format(montants.reduce((total, ligne) => total + ligne.montant, 0))}`,
    /** Par montant croissant, égalité départagée par la clé (`sortRows`, E07-S01). */
    parMontant: [...montants].sort((a, b) => a.montant - b.montant || PAR_CLE.compare(a.key, b.key)).map((ligne) => ligne.key),
    aRevoir: lignes.filter((ligne) => ligne.data[colonne] === cycle.review?.state).map((ligne) => ligne.key).sort(PAR_CLE.compare),
  }
}

const contientLaVille = (valeur: string) => normaliser(valeur).includes(normaliser(VILLE))
const estLaVille = (valeur: string) => normaliser(valeur) === normaliser(VILLE)

/**
 * Les clés des lignes affichées, dans l'ordre : la première ligne du texte rendu de chaque cellule clé, la
 * cellule principale de la ligne (un repli de provenance fermé n'est pas rendu ; le bail suit la clé).
 */
async function clesAffichees(table: Locator): Promise<string[]> {
  return (await table.locator("tbody td[data-primary]").allInnerTexts()).map((texte) => texte.split("\n")[0].trim())
}

/** L'ordre attendu des premières lignes : celles de `parMontant`, en tête de la grille (une ligne sans montant va après). */
async function attendreLOrdre(table: Locator, parMontant: readonly string[]): Promise<void> {
  const premieres = parMontant.slice(0, PREMIERE_PAGE)
  expect((await clesAffichees(table)).slice(0, premieres.length)).toEqual(premieres)
}

/**
 * Attend la fin des entrées et des transitions d'un élément et de ses descendants : une capture ne saisit rien à
 * mi-course. Seulement celles du temps du document : l'ombre de l'en-tête collant de la table suit le défilement
 * (`animation-timeline: scroll()`, `table.css`), et une telle animation ne finit jamais.
 */
const auRepos = (element: Locator) =>
  element.evaluate((racine) =>
    Promise.all(
      racine
        .getAnimations({ subtree: true })
        .filter((animation) => animation.timeline === document.timeline && animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished),
    ).then(() => undefined),
  )

async function capturer(page: Page, testInfo: TestInfo, nom: string): Promise<void> {
  await page.screenshot({ path: testInfo.outputPath(`${nom}.png`), fullPage: true })
}

test.describe("tableau, vue et revue", () => {
  test.skip(!ESPACE.semee, SANS_ESPACE)

  test.beforeAll(async () => {
    const { error } = await clientAuth().auth.signInWithPassword({ email, password })
    test.skip(error !== null, "E2E account missing from the Supabase project: run pnpm demo:seed (E01-S05)")
  })

  for (const mode of MODES) {
    test(`should show the grid, sort it, filter it, open a provenance, say an empty search, and render the view and the card (${mode})`, async ({ browser }, testInfo) => {
      test.setTimeout(600_000)
      const adresse = ESPACE.adresse
      const page = await browser.newPage({ colorScheme: mode, viewport: { width: 1280, height: 900 } })
      await seConnecterSurLEspace(page, { email, password })

      // La grille sans recherche ni filtre : méta, légende, pied, résumé et file (AC1, AC7, AC8, AC10).
      let lue = await lireLaDemo()
      let attendu = attendus(lue)
      await page.goto(`${adresse}/n/${TABLEAU}`)
      await attendre(page.getByRole("heading", { level: 1 })).toHaveText(lue.titre)
      const grille = page.getByRole("table", { name: `${lue.titre} — ${attendu.toutes}`, exact: true })
      await attendre(grille).toBeVisible()
      // E05-S10, AC-a7 : les lignes passent dans l'infobulle de « modifié … ».
      await page.locator(".oto-screen-header-meta").getByText(/^modifié /).focus()
      await expect(page.getByRole("tooltip")).toContainText(attendu.toutes)
      await expect(page.getByRole("searchbox", { name: `Chercher dans ${attendu.toutes}` })).toBeVisible()
      await expect(page.getByText(attendu.pied, { exact: true })).toBeVisible()
      await expect(page.getByText(attendu.parEtat, { exact: true })).toBeVisible()
      await expect(page.getByText(attendu.somme, { exact: true })).toBeVisible()
      const file = page.getByRole("region", { name: "À revoir" })
      const [premiere] = attendu.aRevoir
      await expect(file.getByText(premiere ? compte(attendu.aRevoir.length, "ligne à revoir", "lignes à revoir") : "Rien à revoir.", { exact: true })).toBeVisible()
      if (premiere) await expect(file.locator(".oto-wait-item-demand")).toHaveText(premiere)
      // E11-S05 (AC-a4, AC-a5) : les lignes à revoir de la page sont marquées, et elles seules ; le cycle se lit sous le titre.
      const aRevoirAffichees = (await clesAffichees(grille)).filter((cle) => attendu.aRevoir.includes(cle))
      await expect(grille.locator('tbody tr[data-state="review"]')).toHaveCount(aRevoirAffichees.length)
      await expect(grille.locator("tbody tr[data-state]:not([data-state='review'])")).toHaveCount(0)
      await expect(file.getByText(`Une ligne entre à « ${attendu.cycle.states[0]} »`, { exact: false })).toBeVisible()
      // E11-S05 (AC-c1, AC-c2) : « Télécharger en .csv » à gauche de « Partager » rend le fichier de tout le tableau.
      const telecharger = page.getByRole("button", { name: "Télécharger en .csv" })
      const partager = page.getByRole("button", { name: /^Partager · / })
      expect((await telecharger.boundingBox())?.x ?? 0).toBeLessThan((await partager.boundingBox())?.x ?? 0)
      const [fichier] = await Promise.all([page.waitForEvent("download"), telecharger.click()])
      expect(fichier.suggestedFilename()).toBe(`${TABLEAU.split("/").at(-1)}.csv`)
      // E11-S05 (AC-a1) : l'icône de provenance, invisible au repos, paraît au survol de sa cellule.
      const chevron = grille.locator("tbody .oto-cell-info > .oto-cell-info-btn").first()
      if ((await chevron.count()) > 0) {
        await attendre(chevron).toHaveCSS("opacity", "0")
        await chevron.locator("xpath=ancestor::td[1]").hover()
        await attendre(chevron).toHaveCSS("opacity", "1")
        await capturer(page, testInfo, `chevron-${mode}`)
        await page.mouse.move(0, 0)
      }
      // La grille défile dans son îlot, jamais la fenêtre (`tables-patterns.md § Accessibilité`, 1 280 px).
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0)
      await auRepos(page.getByRole("main"))
      await capturer(page, testInfo, `grille-${mode}`)
      // Une cellule de texte tronquée se focalise et redit son texte entier en infobulle (quand le tableau semé en a une).
      const tronquee = grille.locator('td[data-clip][tabindex="0"]').first()
      if ((await tronquee.count()) > 0) {
        await tronquee.focus()
        await expect(page.getByRole("tooltip")).toHaveText((await tronquee.textContent()) ?? "")
        await capturer(page, testInfo, `infobulle-${mode}`)
        await page.keyboard.press("Escape")
      }
      const themeDeDemo = await page.evaluate(() => document.querySelector(".oto")?.getAttribute("data-oto-theme") ?? null)
      for (const theme of THEMES) {
        await page.evaluate((cle) => document.querySelector(".oto")?.setAttribute("data-oto-theme", cle), theme)
        await auRepos(page.getByRole("main"))
        await page.getByRole("main").screenshot({ path: testInfo.outputPath(`grille-${theme}-${mode}.png`) })
      }
      await page.evaluate((cle) => (cle ? document.querySelector(".oto")?.setAttribute("data-oto-theme", cle) : document.querySelector(".oto")?.removeAttribute("data-oto-theme")), themeDeDemo)

      // Un rechargement du document emporterait cette marque ; une navigation de l'hôte la garde.
      await page.evaluate(() => {
        document.body.dataset.sansRechargement = "oui"
      })

      // Le tri par montant_estime (AC4) : le bouton de l'en-tête, l'adresse, `aria-sort` et l'ordre des lignes, qui n'est pas celui des clés.
      await grille.getByRole("button", { name: "Trier sur montant_estime" }).click()
      await attendre(page).toHaveURL(/[?&]sort=montant_estime(&|$)/)
      const triee = page.getByRole("table", { name: `${lue.titre} — ${attendu.toutes}`, exact: true })
      // L'en-tête se nomme par ses deux boutons (« Trier sur montant_estime Filtrer sur montant_estime ») : la table du design system.
      await attendre(triee.getByRole("columnheader", { name: /^Trier sur montant_estime / })).toHaveAttribute("aria-sort", "ascending")
      // Des montants rangés comme les clés ne prouveraient pas le tri (`testing-strategy.md § Anti-patterns`).
      const premieres = attendu.parMontant.slice(0, PREMIERE_PAGE)
      expect(premieres, "the seeded amounts follow the key order: the sort would prove nothing").not.toEqual([...premieres].sort(PAR_CLE.compare))
      await attendreLOrdre(triee, attendu.parMontant)
      await capturer(page, testInfo, `tri-${mode}`)

      // Le filtre ville « contient Valbrune » (AC6), par le panneau de l'en-tête : l'adresse, les lignes, le résumé.
      await triee.getByRole("button", { name: "Filtrer sur ville" }).click()
      const panneau = page.getByRole("form", { name: "Filtrer sur ville" })
      await expect(panneau.getByLabel("Contient")).toBeFocused()
      await panneau.getByLabel("Contient").fill(VILLE)
      await auRepos(page.getByRole("dialog"))
      await capturer(page, testInfo, `panneau-du-filtre-${mode}`)
      await panneau.getByRole("button", { name: "Filtrer" }).click()
      await attendre(page).toHaveURL(new RegExp(`[?&]f=ville%3Acontains%3A${VILLE}(&|$)`))
      await expect(page).toHaveURL(/[?&]sort=montant_estime(&|$)/)
      lue = await lireLaDemo()
      attendu = attendus(lue)
      const filtre = attendus(lue, contientLaVille)
      const filtree = page.getByRole("table", { name: `${lue.titre} — ${attendu.toutes} · ${compte(filtre.retenues, "ligne correspond", "lignes correspondent")}`, exact: true })
      await attendre(filtree).toBeVisible()
      await expect(filtree.locator("tbody tr")).toHaveCount(Math.min(filtre.retenues, PREMIERE_PAGE))
      await expect(filtree.getByRole("button", { name: "Filtrer sur ville" })).toHaveAttribute("aria-pressed", "true")
      // Le tri est prouvé à l'étape précédente ; à Valbrune, les montants du pilote sont égaux (6 500 : P-003,
      // P-009, E06-S01) et se départagent par la clé : l'ordre se vérifie, sans en attendre une preuve du tri.
      await attendreLOrdre(filtree, filtre.parMontant)
      await expect(page.getByText(filtre.somme, { exact: true })).toBeVisible()
      expect(await page.evaluate(() => document.body.dataset.sansRechargement)).toBe("oui")
      await capturer(page, testInfo, `filtre-${mode}`)

      // La provenance d'une cellule s'ouvre au clavier, dans un panneau posé par-dessus la grille (AC3, 1.4.11).
      const cellule = filtree.locator("tbody td[data-primary]").first().locator(".oto-cell-info-btn").first()
      await cellule.focus()
      await page.keyboard.press("Enter")
      await expect(cellule).toHaveAttribute("aria-expanded", "true")
      await expect(page.getByRole("dialog", { name: /^Provenance de / }).locator("p").first()).toBeVisible()
      await capturer(page, testInfo, `provenance-${mode}`)

      // Une recherche sans réponse (AC5, AC9) : le vide le dit, et son geste retire la recherche et les filtres.
      const recherche = page.getByRole("searchbox", { name: `Chercher dans ${attendu.toutes}` })
      await recherche.fill("zzzz-aucune-ligne")
      await recherche.press("Enter")
      await attendre(page).toHaveURL(/[?&]q=zzzz-aucune-ligne(&|$)/)
      await attendre(page.getByText("Aucune ligne pour cette recherche", { exact: true })).toBeVisible()
      await expect(page.getByRole("link", { name: "Retirer la recherche et les filtres" })).toBeVisible()
      await auRepos(page.getByRole("main"))
      await capturer(page, testInfo, `vide-${mode}`)

      // La vue et la carte rendues en place (AC15, AC16) : les lignes de Valbrune par clé, 5 au plus.
      await page.goto(`${adresse}/n/${PAGE_DE_LA_VUE}`)
      lue = await lireLaDemo()
      const valbrune = lue.lignes.filter((ligne) => typeof ligne.data.ville === "string" && estLaVille(ligne.data.ville)).map((ligne) => ligne.key).sort(PAR_CLE.compare)
      const vue = page.getByRole("table", { name: `${lue.titre} — vue`, exact: true })
      await attendre(vue).toBeVisible()
      await expect(vue.getByRole("rowheader")).toHaveText(valbrune.slice(0, LIGNES_DE_LA_VUE))
      await expect(page.getByText(`${nLignes(Math.min(valbrune.length, LIGNES_DE_LA_VUE))} sur ${NOMBRE.format(valbrune.length)}`, { exact: true })).toBeVisible()
      await expect(page.getByRole("link", { name: "Ouvrir le tableau" })).toHaveAttribute("href", `/n/${TABLEAU}`)
      // La carte : son titre en lien, sa nature, sans le résumé d'une page (E11-S05, AC-f2).
      const lienDeLaCarte = page.getByRole("link", { name: lue.carte.titre, exact: true })
      await expect(lienDeLaCarte).toHaveAttribute("href", `/n/${GRILLE_TARIFAIRE}`)
      const carte = page.locator("div", { has: lienDeLaCarte }).last()
      await expect(carte.getByText("Page", { exact: true })).toBeVisible()
      await expect(carte.getByText(lue.carte.resume, { exact: true })).toHaveCount(0)
      await capturer(page, testInfo, `vue-et-carte-${mode}`)
      await page.close()
    })
  }

  // E11-S01, lot g (AC-g3, AC-g7) : « Preuve exigée » décochée puis recochée depuis « Réglages », au clavier ; l'état
  // tient après un rechargement ; le panneau capturé dans chaque thème. Le tableau de la Démo exige la preuve (AC-f8).
  for (const mode of MODES) {
    test(`should turn « Preuve exigée » off then on from « Réglages », by keyboard, the state holding after a reload (${mode})`, async ({ browser }, testInfo) => {
      test.setTimeout(600_000)
      test.skip(!(await lireLaDemo()).entete.proof, `${TABLEAU} does not require proof: see scripts/demo/50-tableau.mjs`)
      const page = await browser.newPage({ colorScheme: mode, viewport: { width: 1280, height: 900 } })
      await seConnecterSurLEspace(page, { email, password })
      await page.goto(`${ESPACE.adresse}/n/${TABLEAU}`)
      const reglages = page.getByRole("button", { name: "Réglages", exact: true })
      await attendre(reglages).toBeVisible()
      await reglages.click()
      const panneau = page.getByRole("dialog", { name: "Réglages du tableau" })
      const preuve = panneau.getByRole("switch", { name: "Preuve exigée" })
      await expect(preuve).toBeChecked()
      await auRepos(panneau)
      await capturer(page, testInfo, `reglages-${mode}`)

      // `Tab` atteint l'interrupteur, `Espace` le bascule ; le focus reste sur lui pendant et après l'envoi.
      await page.keyboard.press("Tab")
      await expect(preuve).toBeFocused()
      await page.keyboard.press("Space")
      await attendre(panneau.getByRole("status")).toHaveText("Preuve exigée : désactivée.")
      await expect(preuve).not.toBeChecked()
      await expect(preuve).toBeFocused()
      expect((await lireLaDemo()).entete.proof).toBe(false)
      await auRepos(panneau)
      await capturer(page, testInfo, `reglages-decoche-${mode}`)
      await page.keyboard.press("Space")
      await attendre(panneau.getByRole("status")).toHaveText("Preuve exigée : activée.")

      // Rechargée, la page relit l'en-tête publié ; `Échap` ferme le panneau et rend le focus à « Réglages ».
      await page.reload()
      await attendre(reglages).toBeVisible()
      await reglages.click()
      await expect(preuve).toBeChecked()
      await page.keyboard.press("Escape")
      await expect(panneau).toBeHidden()
      await expect(reglages).toBeFocused()
      expect((await lireLaDemo()).entete.proof).toBe(true)
      await page.close()
    })
  }

  // E11-S05 (AC-a1) : sans survol (un écran tactile), l'icône de provenance reste montrée.
  test("should show the provenance icon of a cell at once on a touch screen (E11-S05, AC-a1)", async ({ browser }, testInfo) => {
    test.setTimeout(300_000)
    const context = await browser.newContext({ viewport: { width: 375, height: 800 }, isMobile: true, hasTouch: true })
    const page = await context.newPage()
    await seConnecterSurLEspace(page, { email, password })
    await page.goto(`${ESPACE.adresse}/n/${TABLEAU}`)
    const chevron = page.locator("tbody .oto-cell-info > .oto-cell-info-btn").first()
    await attendre(chevron).toBeAttached()
    await attendre(chevron).toHaveCSS("opacity", "1")
    await capturer(page, testInfo, "chevron-mobile")
    await context.close()
  })

  test("should approve a row, then reject the next one, and cite both in the summary (light)", async ({ browser }, testInfo) => {
    test.setTimeout(600_000)
    const avant = attendus(await lireLaDemo())
    test.skip(avant.aRevoir.length < 2, "fewer than two rows to review in the campaign organisation")
    const [premiere, seconde] = avant.aRevoir
    const { approve, reject } = avant.cycle.review
    const adresse = ESPACE.adresse
    const page = await browser.newPage({ colorScheme: "light", viewport: { width: 1280, height: 900 } })
    await seConnecterSurLEspace(page, { email, password })

    // AC11 : la première ligne de la file, approuvée avec une raison ; l'issue annoncée, la suivante paraît.
    await page.goto(`${adresse}/n/${TABLEAU}`)
    const file = page.getByRole("region", { name: "À revoir" })
    const demande = file.locator(".oto-wait-item-demand")
    await attendre(demande).toHaveText(premiere)
    await file.getByLabel("Raison (facultative)").fill("Contrôle visuel : fiche relue.")
    await file.getByRole("button", { name: `Approuver → ${approve}` }).click()
    await attendre(file.getByRole("status").filter({ hasText: `${premiere} → ${approve}.` })).toBeVisible()
    await attendre(demande).toHaveText(seconde)
    await expect(file).toBeFocused()
    await capturer(page, testInfo, "revue-approuvee-light")

    // La suivante, refusée ; la file relue passe à la troisième, ou se vide ; le résumé de la session cite les deux (AC14).
    await file.getByRole("button", { name: `Refuser → ${reject}` }).click()
    await attendre(file.getByRole("status").filter({ hasText: `${seconde} → ${reject}.` })).toBeVisible()
    const [troisieme] = avant.aRevoir.slice(2)
    if (troisieme) await attendre(demande).toHaveText(troisieme)
    else await attendre(file.getByText("Rien à revoir.", { exact: true })).toBeVisible()
    const resume = file.getByRole("textbox", { name: "Résumé de la revue" })
    await expect(resume).toHaveValue(new RegExp(`^Revue de ${echappe(TABLEAU)} le \\d{2}/\\d{2}/\\d{4} : 1 approuvée \\(${echappe(approve)} : ${premiere}\\), 1 refusée \\(${echappe(reject)} : ${seconde}\\)\\.$`))
    await capturer(page, testInfo, "revue-resume-light")

    // Les deux décisions sont écrites dans le tableau ; la file compte deux lignes de moins.
    const apres = await lireLaDemo()
    const etat = (cle: string) => apres.lignes.find((ligne) => ligne.key === cle)?.data[avant.cycle.column]
    expect([etat(premiere), etat(seconde)]).toEqual([approve, reject])
    expect(attendus(apres).aRevoir).toEqual(avant.aRevoir.filter((cle) => cle !== premiere && cle !== seconde))
    await page.close()
  })
})
