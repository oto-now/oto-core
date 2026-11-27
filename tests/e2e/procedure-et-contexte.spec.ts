import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test"
import { clientAuth } from "./fixtures/base"
import { CHEMINS, EQUIPE, ESPACE, PROCEDURE as TITRE_DE_LA_PROCEDURE, SANS_ESPACE } from "./fixtures/espace"
import { attendreLEnregistrement, lireLeHtml, ouvrirAQuoiSert, seConnecterSurLEspace } from "./fixtures/noeud"

// Contrôle visuel connecté des écrans d'une procédure et d'un Contexte (E05-S04, AC16 ; E05-S08, AC10 :
// chaque bloc se lit, son champ monté au survol ou au focus depuis la 1.1.3 ; M59, fiche D104 : l'écran d'une
// procédure est celui d'une page) : le compte E2E,
// administrateur de l'organisation de la campagne et responsable de son équipe (`espace.ts`), en clair puis en sombre. Le rail
// mène à la procédure semée (une procédure est une page de l'arbre, E05-S09 AC-a5), dont
// l'écran montre le résumé et ses appels déjà écrits, en texte, dans des blocs de Texte (dans le HTML servi
// avant l'hydratation), ni champ d'appel, ni contrôle du brouillon, ni « Tester une phrase », ni insertion
// d'appel au menu ; sa version publiée se lit comme une page. Sur la procédure jetable
// `private/<handle>/essai_procedure` (créée par le test si elle manque, avec un premier paragraphe ; le
// `handle` lu par « Profil » du menu du compte), une étape écrite en texte est ajoutée, publiée seule, puis
// retirée (la procédure revient à son état de départ) ; le Contexte de l'équipe et le Contexte Perso disent en une phrase qui
// les lit (E05-S13, AC-17), sans « Ma fiche » (E05-S11, AC-8), et la ligne « Mes instructions » de l'encart ouvre la vue
// « Contexte » (`/context`) sur sa partie (AC-11) ; aucune erreur d'hydratation. Une capture par écran et
// par thème dans `test-results/`.

const email = process.env.E2E_USER_EMAIL ?? ""
const password = process.env.E2E_USER_PASSWORD ?? ""
const ADRESSE = ESPACE.adresse
const THEMES = ["light", "dark"] as const
const PROCEDURE = CHEMINS.procedure
/** Une étape écrite en texte, comme JB écrira une procédure tant que les connecteurs ne sont pas là (fiche D104). */
const ETAPE = "Étape 1 : connecte-toi à Gmail et ouvre le dernier devis envoyé."

// Les deux thèmes écrivent la même procédure jetable et la même fiche : l'un après l'autre.
test.describe.configure({ mode: "serial" })

// Serveur de développement sur la machine partagée par les agents : un aller-retour (écriture,
// publication) y prend plusieurs secondes, et chaque route se compile à son premier appel.
const attendre = expect.configure({ timeout: 90_000 })

/**
 * `caret: "initial"` : la capture n'écrit rien dans la page. Par défaut (`hide`), Playwright pose
 * `caret-color` dans le `style` de chaque champ ; prise avant l'hydratation, la capture fait relever à
 * React un attribut `style` que le client ne rend pas, sur chaque champ monté (sonde d'E05-S08).
 */
async function capturer(page: Page, testInfo: TestInfo, nom: string): Promise<void> {
  await page.screenshot({ path: testInfo.outputPath(`${nom}.png`), fullPage: true, caret: "initial" })
}

/**
 * Crée la procédure jetable par `POST /api/platform/nodes` (E03-S03), depuis la page connectée : même
 * origine, même session. Une procédure qui existe déjà rend `stale_revision`, faute de révision lue :
 * elle est gardée telle quelle.
 */
async function assurerLaProcedure(page: Page, chemin: string): Promise<void> {
  const issue = await page.evaluate(async (chemin) => {
    const reponse = await fetch("/api/platform/nodes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path: chemin,
        title: "Essai de procédure",
        summary: "Procédure jetable du contrôle visuel de l'écran de procédure.",
        kind: "procedure",
        ops: [{ op: "insert_after", input: { type: "paragraph", text: "Premier paragraphe." } }],
      }),
    })
    const corps: { error?: { code?: string } } = await reponse.json()
    return reponse.ok ? "créée" : (corps.error?.code ?? String(reponse.status))
  }, chemin)
  expect(["créée", "stale_revision"]).toContain(issue)
}

/** Un geste du menu de la poignée d'un bloc (E05-S10, AC-a2, AC-a10), la main passée sur sa rangée. */
async function geste(page: Page, mots: string, nom: string): Promise<void> {
  await cliquerDansLaRangee(page.getByRole("button", { name: `Actions sur ce bloc — ${mots}` }))
  await page.getByRole("menu").getByRole("menuitem", { name: nom }).click()
}

/**
 * Un geste de la gouttière ou de la poignée d'un bloc : ils ne prennent le pointeur qu'au survol de leur
 * rangée (`blocks.css`). La main passe sur le bloc avant d'aller au geste, comme une personne ; tout droit,
 * le clic tombait sur l'îlot, dessous (M48).
 */
async function cliquerDansLaRangee(geste: Locator): Promise<void> {
  await geste.locator("xpath=ancestor::*[contains(concat(' ', @class, ' '), ' oto-block-row ')][1]").hover()
  await geste.click()
}

/** « Supprimer », au menu de la poignée d'un bloc. */
async function supprimerLeBloc(page: Page, mots: string): Promise<void> {
  await geste(page, mots, "Supprimer")
  await expect(page.getByRole("button", { name: `Actions sur ce bloc — ${mots}` })).toHaveCount(0)
}

/**
 * La version publiée de la procédure lue jusqu'à ce qu'elle rende (ou non) ce texte en paragraphe : aucun
 * « Publier », la procédure se publie seule 3 s après la dernière frappe (E05-S10, AC-a6). Le texte entre
 * balises : celui d'un brouillon, que la page porte aussi en données, ne compte pas.
 */
async function attendreLaPublication(page: Page, chemin: string, texte: string, present: boolean): Promise<void> {
  await expect(page.getByRole("button", { name: "Publier", exact: true })).toHaveCount(0)
  await attendre(async () => {
    expect((await lireLeHtml(page, `/n/${chemin}?version=published`)).includes(`>${texte}<`)).toBe(present)
  }).toPass({ timeout: 90_000 })
}

test.describe("procédure et contexte", () => {
  test.skip(!ESPACE.semee, SANS_ESPACE)

  test.beforeAll(async () => {
    const { error } = await clientAuth().auth.signInWithPassword({ email, password })
    test.skip(error !== null, "E2E account missing from the Supabase project: run pnpm demo:seed (E01-S05)")
  })

  for (const theme of THEMES) {
    test(`should open a procedure from the rail as a page, write a step in text on a throwaway one, then read two Contextes (${theme})`, async ({ browser }, testInfo) => {
      test.setTimeout(600_000)
      const context = await browser.newContext({ colorScheme: theme })
      const page = await context.newPage()
      // Le rendu du serveur et l'hydratation des îlots doivent s'accorder ; un écart nomme sa page et garde
      // l'écart de React (une erreur intermittente, vue au cycle de correction 1, restait sans page).
      const hydratation: string[] = []
      page.on("console", (message) => {
        if (message.type() === "error" && /hydrat/i.test(message.text())) hydratation.push(`${page.url()} :: ${message.text().slice(0, 1500)}`)
      })
      await seConnecterSurLEspace(page, { email, password })

      // L'écran de la procédure, depuis le rail : une page de l'arbre, sans page de liste (E05-S09, AC-a5) ;
      // le résumé, et chaque appel déjà écrit à sa place, en texte, dans un bloc de Texte lu, nommé comme son champ :
      // le HTML servi les porte avant l'hydratation (E05-S08, AC1 ; M59).
      const rail = page.getByRole("navigation", { name: "Navigation principale" })
      await rail.getByRole("link", { name: TITRE_DE_LA_PROCEDURE }).click()
      await attendre(page).toHaveURL(`${ADRESSE}/n/${PROCEDURE}`)
      // La page se compile à son premier appel : son chargement peut durer bien au-delà des 5 s par défaut.
      await attendre(page.getByText(/^Complète les fiches des prospects \(contact, email, montant estimé\)/)).toBeVisible()
      for (const fonction of ["table.schema", "table.claim", "table.write", "table.release"]) {
        await expect(page.getByRole("textbox", { name: `Modifier ce texte — ${fonction}` })).toHaveText(new RegExp(`^Appel de ${fonction.replace(".", "\\.")}`))
      }
      const servie = await lireLeHtml(page, `/n/${PROCEDURE}`)
      for (const retire of ["Arguments (JSON)", "Contrôle du brouillon", "Tester une phrase", "Appel · "]) expect(servie).not.toContain(retire)
      await capturer(page, testInfo, `procedure-${theme}`)
      // Le menu d'une liste numérotée est celui d'une page : aucune insertion d'appel.
      await cliquerDansLaRangee(page.getByRole("button", { name: /^Actions sur ce bloc — Annonce en une/ }))
      await expect(page.getByRole("menu").getByRole("menuitem", { name: /^Supprimer/ })).toBeVisible()
      await expect(page.getByRole("menu").getByText(/appel/i)).toHaveCount(0)
      await page.keyboard.press("Escape")

      // Sa version publiée se lit comme une page : chaque appel en une ligne de texte (ses clés dans l'ordre de
      // `jsonb`, qui n'est pas celui de l'écriture).
      await page.goto(`${ADRESSE}/n/${PROCEDURE}?version=published`)
      await attendre(page.getByText(new RegExp(`^Appel de table\\.claim : \\{ .*"table": "${CHEMINS.tableau}"`))).toBeVisible()
      await expect(page.getByRole("textbox", { name: /^Modifier ce texte/ })).toHaveCount(0)
      await capturer(page, testInfo, `procedure-lue-${theme}`)

      // La procédure jetable, dans l'espace personnel du compte : l'adresse de son Contexte Privé, au rail, porte
      // le `handle` (« Profil » ouvre la page Profil depuis E05-S11, AC-6).
      const handle = /^\/n\/private\/([^/]+)\/contexte$/.exec((await rail.getByRole("link", { name: "Mes instructions" }).getAttribute("href")) ?? "")?.[1]
      expect(handle).toBeTruthy()
      const essai = `private/${handle}/essai_procedure`
      await assurerLaProcedure(page, essai)
      await page.goto(`${ADRESSE}/n/${essai}`)
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Essai de procédure")
      // Un passage interrompu a pu laisser ses blocs : ils partent d'abord.
      for (const mots of ["mail.send", "table.rows", "Étape 1 : connecte-toi"]) {
        if ((await page.getByRole("button", { name: `Actions sur ce bloc — ${mots}` }).count()) > 0) await supprimerLeBloc(page, mots)
      }

      // Une étape écrite en texte, comme sur une page, publiée seule (E05-S10, AC-a6).
      // Le « + » ouvre le choix du bloc (E10-S06, AC-a1) : un Texte.
      await cliquerDansLaRangee(page.getByRole("button", { name: "Ajouter un bloc après — Premier paragraphe." }))
      await page.getByRole("menuitem", { name: "Texte", exact: true }).click()
      const etape = page.getByRole("textbox", { name: "Modifier ce texte — bloc vide" })
      await etape.focus()
      await etape.fill(ETAPE)
      await page.keyboard.press("Escape")
      await attendreLEnregistrement(page)
      await attendreLaPublication(page, essai, ETAPE, true)
      await capturer(page, testInfo, `essai-publie-${theme}`)

      // L'étape part, la procédure se republie : elle revient à son état de départ.
      await supprimerLeBloc(page, "Étape 1 : connecte-toi")
      await attendreLEnregistrement(page)
      await attendreLaPublication(page, essai, ETAPE, false)
      await attendre(page.getByText(/^Brouillon non publié/)).toHaveCount(0)

      // Le Contexte de l'équipe : qui le reçoit, en une phrase (E05-S13, AC-17), ce que le modèle recevra (AC10, AC12).
      await page.goto(`${ADRESSE}/n/${CHEMINS.contexteDeLEquipe}`)
      // Les notes sont dans la colonne d'annexes, à côté du document (E05-S09 c1, comme `page.spec.ts`).
      // Repliée à l'arrivée (E11-S05, AC-e2) : ouverte par Entrée.
      const annexes = await ouvrirAQuoiSert(page)
      await attendre(annexes.getByText(`Ce que votre Claude/ChatGPT/Mistral, comme celui de chaque membre de l'équipe ${EQUIPE.nom}, lit à chaque conversation.`)).toBeVisible()
      await expect(page.getByRole("note", { name: "Voici ce que votre agent va lire" }).getByRole("list", { name: "Ordre de lecture" })).toBeVisible()
      await capturer(page, testInfo, `contexte-equipe-${theme}`)

      // Le Contexte Perso : ses annexes, sans « Ma fiche » (E05-S11, AC-8) ; une ligne de l'encart, « Contexte :
      // Privé », toujours servie (E05-S12, AC-3), ouvre la vue « Contexte » (`/context`, E11-S10) sur sa partie (AC-11).
      await page.goto(`${ADRESSE}/n/private/${handle}/contexte`)
      await attendre((await ouvrirAQuoiSert(page)).getByText(/vous seul le recevez\.$/)).toBeVisible()
      await expect(page.getByRole("region", { name: "Ma fiche" })).toHaveCount(0)
      await page.getByRole("note", { name: "Voici ce que votre agent va lire" }).getByRole("link", { name: /^Mes instructions/ }).click()
      await attendre(page).toHaveURL(`${ADRESSE}/context#private-context`)
      // L'adresse change aussitôt, la vue paraît quand ses lectures finissent (aperçu du Contexte compris,
      // `<Suspense>`) : 2,8 s au calme, 3,9 s sous une campagne complète, au-delà de 5 s au plus chargé (mesuré).
      await attendre(page.getByRole("heading", { level: 1, name: "Contexte" })).toBeVisible()
      await attendre(page.getByRole("region", { name: "Mes instructions" })).toBeInViewport()
      await capturer(page, testInfo, `vue-contexte-${theme}`)
      expect(hydratation).toEqual([])
      await context.close()
    })
  }
})
