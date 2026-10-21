import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test"
import { clientAuth } from "./fixtures/base"
import { assurerLeNoeud, attendre, attendreLEnregistrement, capturer, ouvrirAQuoiSert, seConnecterSurLEspace, statut } from "./fixtures/noeud"
import { CHEMINS, EQUIPE, ESPACE, SANS_ESPACE } from "./fixtures/espace"

// Contrôle visuel connecté de la page d'un nœud (E05-S02, AC24 ; E05-S08, AC10 : chaque bloc se lit, nommé comme son
// champ, qui se monte au survol ou au focus depuis la 1.1.3 ;
// E05-S09, partie c1 : porté d'oto-frontend) : le compte E2E, administrateur de l'organisation de la campagne et
// responsable de son équipe (`espace.ts`), en clair puis en sombre. Le Contexte de l'équipe, ouvert par le rail,
// montre son document et ses notes en deux colonnes, l'encart « À quoi sert cette page » en une phrase (E05-S13,
// AC-17) ; sur la page jetable `private/<handle>/essai_ecran` (créée si elle
// manque, avec un premier paragraphe), le HTML servi porte déjà les blocs lus, avant l'hydratation, et le
// contenu n'a pour navigation que son fil (AC-a2) ; les blocs laissés par un passage interrompu partent ;
// le paragraphe reçoit un texte horodaté, un titre (le style « Titre » du menu de sa poignée, E05-S10) et un
// texte sont ajoutés, le texte monte, est supprimé puis rétabli, les deux blocs ajoutés sont retirés (la page
// garde sa taille d'un passage à l'autre) ; la page se publie seule (E05-S10, AC-a6), se lit publiée ; le fil ouvre les espaces, « Partager » le
// panneau des règles ; la page se déplace sous `private/<handle>/essai_dossier` puis revient, par le « ⋯ » de sa
// ligne du rail : l'en-tête n'a plus de « Déplacer » (E05-S13, AC-20) ; aucune erreur d'hydratation. Une capture
// par étape, et le Contexte et la page dans les huit thèmes, posés sur la racine `.oto` sans écrire la marque
// (AC-x1, AC-x3), dans `test-results/`, à la largeur des captures d'oto-frontend (1 920 px).
//
// E11-S02 (AC-c1, AC-c2, AC-c5, AC-g1) : une page créée par le « + » du rail, son titre tapé, se lit publiée
// après un rechargement ; une publication refusée pour son en-tête (réponse simulée) se dit sans « Réessayer »,
// en clair puis en sombre. Le compte E2E, seul compte de la campagne, y est au niveau gestion : le niveau
// écriture est tenu par `ecran-de-noeud.test.tsx` (AC-c2) et `gestes-du-rail.test.ts` (AC-c1). E11-S05 (AC-e2, AC-g1,
// AC-g2) : « À quoi sert cette page » s'ouvre par Entrée ; Entrée dans le titre d'une page neuve mène à son Texte vide,
// qui porte l'invite, et une page vide déjà titrée s'ouvre le focus dans ce Texte.

const email = process.env.E2E_USER_EMAIL ?? ""
const password = process.env.E2E_USER_PASSWORD ?? ""
const MODES = ["light", "dark"] as const
const THEMES = ["manuscrit", "ardoise", "grenat", "brique", "foret", "lagune", "cobalt", "violet"]
const RESUME = "Page jetable du contrôle visuel de l'écran de nœud."

// Les deux modes écrivent la même page jetable : l'un après l'autre.
test.describe.configure({ mode: "serial" })

/** Le chemin courant d'un nœud lu par un chemin peut-être ancien (E03-S07) : `GET nodes?path=` le rend. */
async function cheminCourant(page: Page, chemin: string): Promise<string> {
  return page.evaluate(async (lu) => {
    const reponse = await fetch(`/api/platform/nodes?path=${encodeURIComponent(lu)}`)
    const corps: { data?: { path?: string } } = await reponse.json()
    return corps.data?.path ?? ""
  }, chemin)
}

/** Un passage interrompu entre les deux déplacements laisse la page sous le dossier : elle revient d'abord. */
async function remettreEnPlace(page: Page, chemin: string): Promise<void> {
  const courant = await cheminCourant(page, chemin)
  expect(courant).not.toBe("")
  if (courant === chemin) return
  const reponse = await page.evaluate(
    async (corps) => (await fetch("/api/platform/nodes/move", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corps) })).status,
    { path: courant, new_path: chemin },
  )
  expect(reponse).toBe(200)
  await page.goto(`${ESPACE.adresse}/n/${chemin}`)
}

/** Échap dans le champ qui a le focus : son texte part, le focus va à la poignée ; la file a tout écrit. */
async function envoyerEtAttendre(page: Page): Promise<void> {
  await page.keyboard.press("Escape")
  await attendreLEnregistrement(page)
}

/**
 * Un geste du menu de la poignée d'un bloc (E05-S10, AC-a2). La gouttière ne prend le pointeur qu'une fois la
 * rangée survolée ou focalisée (`blocks.css`) : la souris passe d'abord sur la rangée, comme la main d'un rédacteur.
 */
async function geste(page: Page, poignee: Locator, nom: string | RegExp, role: "menuitem" | "menuitemradio" = "menuitem"): Promise<void> {
  await page.locator(".oto-block-row").filter({ has: poignee }).hover()
  await poignee.click()
  await page.getByRole("menu").getByRole(role, { name: nom }).click()
}

/** « Supprimer », au menu de la poignée d'un bloc. */
async function supprimerLeBloc(page: Page, mots: string): Promise<void> {
  const poignee = page.getByRole("button", { name: `Actions sur ce bloc — ${mots}` })
  await geste(page, poignee, "Supprimer")
  await expect(poignee).toHaveCount(0)
}

/** Un passage interrompu laisse les blocs qu'il a ajoutés : ils partent d'abord, la page repart de son premier paragraphe. */
async function retirerLesRestes(page: Page): Promise<void> {
  const poignees = page.getByRole("button", { name: /^Actions sur ce bloc — / })
  // Par rang, pas par nom : deux restes du même texte rendaient le nom ambigu (M31, campagne du 2026-09-27).
  for (let restants = await poignees.count(); restants > 1; restants--) {
    await geste(page, page.locator(".oto-block-row").filter({ has: poignees }).nth(1).getByRole("button", { name: /^Actions sur ce bloc — / }), "Supprimer")
    await expect(poignees).toHaveCount(restants - 1)
  }
  await attendre(statut(page, "Enregistrement…")).toHaveCount(0)
}

/** « Déplacer », au « ⋯ » de la ligne de la page dans le rail (E05-S10, AC-b8), révélé au survol de sa rangée. */
async function deplacerSous(page: Page, parent: string, nouveauChemin: string): Promise<void> {
  const titre = "Essai de l'écran"
  const ligne = page.getByRole("navigation", { name: "Navigation principale" }).getByRole("link", { name: titre, exact: true })
  await ligne.hover()
  await ligne.locator("xpath=..").getByRole("button", { name: `Autres actions sur ${titre}` }).click()
  await page.getByRole("menu").getByRole("menuitem", { name: "Déplacer" }).click()
  const dialogue = page.getByRole("dialog", { name: `Déplacer « ${titre} »` })
  // La liste de choix du design system (E05-S11, retour 8) : un parent se nomme « Titre (chemin) ».
  await dialogue.getByRole("combobox", { name: "Nouveau parent" }).click()
  await page.getByRole("option", { name: new RegExp(`\\(${parent}\\)$`) }).click()
  await expect(statut(page, `Nouveau chemin : ${nouveauChemin}`)).toBeVisible()
  await dialogue.getByRole("button", { name: "Déplacer ici" }).click()
  await attendre(page).toHaveURL(`${ESPACE.adresse}/n/${nouveauChemin}`)
  await attendre(page.getByRole("heading", { level: 1 })).toHaveText("Essai de l'écran")
}

/** Chaque thème posé sur la racine `.oto` de la page, puis celui de l'organisation rendu : la marque n'est pas écrite. */
async function capturerLesThemes(page: Page, testInfo: TestInfo, nom: string): Promise<void> {
  const racine = page.locator(".oto").first()
  const origine = await racine.getAttribute("data-oto-theme")
  for (const theme of THEMES) {
    await racine.evaluate((element, cle) => element.setAttribute("data-oto-theme", cle), theme)
    await capturer(page, testInfo, `${nom}-${theme}`)
  }
  await racine.evaluate((element, cle) => (cle === null ? element.removeAttribute("data-oto-theme") : element.setAttribute("data-oto-theme", cle)), origine)
}

test.describe("page d'un nœud", () => {
  test.skip(!ESPACE.semee, SANS_ESPACE)

  test.beforeAll(async () => {
    const { error } = await clientAuth().auth.signInWithPassword({ email, password })
    test.skip(error !== null, "E2E account missing from the Supabase project: run pnpm demo:seed (E01-S05)")
  })

  for (const mode of MODES) {
    test(`should show a Contexte and a page as oto-frontend does, then edit, publish and move a throwaway page (${mode})`, async ({ browser }, testInfo) => {
      test.setTimeout(900_000)
      const context = await browser.newContext({ colorScheme: mode, viewport: { width: 1920, height: 900 } })
      const page = await context.newPage()
      // Le rendu du serveur et l'hydratation des îlots doivent s'accorder (clés de rendu de l'éditeur, champs
      // montés) ; un écart nomme sa page et garde l'écart de React, comme la spec de la procédure.
      const hydratation: string[] = []
      page.on("console", (message) => {
        if (message.type() === "error" && /hydrat/i.test(message.text())) hydratation.push(`${page.url()} :: ${message.text().slice(0, 1500)}`)
      })
      await seConnecterSurLEspace(page, { email, password })

      // Le Contexte de l'équipe, ouvert par le rail : le document à gauche, ses notes à droite (AC-c1) ; l'encart dit
      // en une phrase qui le lit, sans « Reçu par » (E05-S13, AC-17).
      const rail = page.getByRole("navigation", { name: "Navigation principale" })
      await rail.getByRole("link", { name: `Contexte · ${EQUIPE.nom}` }).click()
      await attendre(page).toHaveURL(`${ESPACE.adresse}/n/${CHEMINS.contexteDeLEquipe}`)
      const note = await ouvrirAQuoiSert(page)
      await attendre(note.getByText(`Ce que votre Claude/ChatGPT/Mistral, comme celui de chaque membre de l'équipe ${EQUIPE.nom}, lit à chaque conversation.`)).toBeVisible()
      await expect(note.getByRole("definition")).toHaveCount(0)
      await expect(page.getByRole("note", { name: "Voici ce que votre agent va lire" }).getByRole("list", { name: "Ordre de lecture" })).toBeVisible()
      await capturerLesThemes(page, testInfo, `contexte-${mode}`)
      const handle = /^\/n\/private\/([^/]+)\/contexte$/.exec((await rail.getByRole("link", { name: "Contexte · Privé" }).getAttribute("href")) ?? "")?.[1]
      expect(handle).toBeTruthy()

      const essai = `private/${handle}/essai_ecran`
      const dossier = `private/${handle}/essai_dossier`
      await assurerLeNoeud(page, { chemin: dossier, titre: "Dossier d'essai", resume: RESUME })
      await assurerLeNoeud(page, { chemin: essai, titre: "Essai de l'écran", resume: RESUME })
      // Avant l'hydratation, le HTML servi porte déjà les blocs, lus sans clic et nommés comme leur champ (E05-S08, AC1).
      const servi = await (await page.goto(`${ESPACE.adresse}/n/${essai}`))?.text()
      expect(servi).toContain('aria-label="Modifier ce texte — ')
      await remettreEnPlace(page, essai)
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Essai de l'écran")
      // L'arbre ne vit que dans le rail : le contenu n'a pour navigation que son fil (AC-a2).
      await expect(page.getByRole("navigation")).toHaveCount(2)
      await expect(page.getByRole("navigation", { name: "Chemin" })).toBeVisible()
      await expect(page.getByRole("button", { name: /^Modifier ce bloc/ })).toHaveCount(0)
      await retirerLesRestes(page)

      // Le premier paragraphe, lu, s'ouvre au focus, puis reçoit un texte horodaté, qui part (AC2).
      const horodatage = new Date().toISOString().slice(0, 19)
      const premier = page.getByRole("textbox", { name: /^Modifier ce texte — / }).first()
      await premier.focus()
      await premier.fill(`Essai ${horodatage}`)
      await envoyerEtAttendre(page)
      await capturer(page, testInfo, `paragraphe-${mode}`)

      // Un « Titre », choisi au menu de la poignée (E05-S10, AC-a2), et un Texte ajoutés ; le Texte monte, est
      // supprimé puis rétabli (AC4). Le focus est dans le champ du bloc neuf : le clavier y écrit.
      // Le « + » ouvre le choix du bloc (E10-S06, AC-a1) : un Texte.
      await page.getByRole("button", { name: `Ajouter un bloc après — Essai ${horodatage}` }).click()
      await page.getByRole("menuitem", { name: "Texte", exact: true }).click()
      await geste(page, page.getByRole("button", { name: "Actions sur ce bloc — bloc vide" }), "Titre", "menuitemradio")
      await attendre(page.getByRole("textbox", { name: "Modifier ce titre — bloc vide" })).toBeFocused()
      await page.keyboard.type(`Notes ${horodatage}`)
      await envoyerEtAttendre(page)
      await page.getByRole("button", { name: `Ajouter un bloc après — Notes ${horodatage}` }).click()
      await page.getByRole("menuitem", { name: "Texte", exact: true }).click()
      await attendre(page.getByRole("textbox", { name: "Modifier ce texte — bloc vide" })).toBeFocused()
      await page.keyboard.type(`Texte ${horodatage}`)
      await envoyerEtAttendre(page)
      await geste(page, page.getByRole("button", { name: `Actions sur ce bloc — Texte ${horodatage}` }), /^Monter/)
      await attendre(statut(page, "Enregistrement…")).toHaveCount(0)
      await capturer(page, testInfo, `blocs-${mode}`)
      await geste(page, page.getByRole("button", { name: `Actions sur ce bloc — Texte ${horodatage}` }), "Supprimer")
      await expect(statut(page, "Bloc supprimé.")).toBeVisible()
      await statut(page, "Bloc supprimé.").getByRole("button", { name: "Annuler" }).click()
      await attendre(page.getByRole("textbox", { name: `Modifier ce texte — Texte ${horodatage}` })).toBeVisible()
      await attendre(statut(page, "Enregistrement…")).toHaveCount(0)
      await capturerLesThemes(page, testInfo, `page-${mode}`)

      // Les deux blocs ajoutés partent : la page garde sa taille d'un passage à l'autre.
      for (const mots of [`Texte ${horodatage}`, `Notes ${horodatage}`]) await supprimerLeBloc(page, mots)
      await attendre(statut(page, "Enregistrement…")).toHaveCount(0)

      // Aucun « Publier » : la page se publie seule, 3 s après la dernière frappe (E05-S10, AC-a6) ; la version
      // publiée se lit sans champ, avec le texte écrit (AC9).
      await expect(page.getByRole("button", { name: "Publier" })).toHaveCount(0)
      await attendre(page.getByText(/^Brouillon non publié/)).toHaveCount(0)
      await capturer(page, testInfo, `publication-${mode}`)
      await attendre(async () => {
        await page.goto(`${ESPACE.adresse}/n/${essai}?version=published`)
        await expect(page.getByText(`Essai ${horodatage}`)).toBeVisible()
      }).toPass({ timeout: 90_000 })
      await attendre(page.getByText(/^Version publiée \(révision \d+\)\.$/)).toBeVisible()
      await expect(page.getByRole("textbox", { name: /^Modifier / })).toHaveCount(0)
      await capturer(page, testInfo, `lecture-${mode}`)
      await page.goto(`${ESPACE.adresse}/n/${essai}`)

      // Le fil : la section ouvre les espaces, chacun menant à son Contexte (AC2).
      await page.getByRole("navigation", { name: "Chemin" }).getByRole("button", { name: "Privé" }).click()
      await expect(page.getByRole("menu").getByRole("menuitemradio", { name: "Privé" })).toHaveAttribute("aria-checked", "true")
      await capturer(page, testInfo, `fil-${mode}`)
      await page.keyboard.press("Escape")
      await expect(page.getByRole("menu")).toHaveCount(0)

      // « Partager · Privé » ouvre le panneau des règles de la page, Échap le referme (AC19).
      await page.getByRole("button", { name: "Partager · Privé" }).click()
      const partage = page.getByRole("dialog", { name: "Partager — Privé" })
      await attendre(partage.getByText("Accès par défaut", { exact: true })).toBeVisible()
      await capturer(page, testInfo, `partage-${mode}`)
      await page.keyboard.press("Escape")
      await expect(partage).toHaveCount(0)
      await expect(page.getByRole("button", { name: "Partager · Privé" })).toBeFocused()

      // Déplacer sous le dossier d'essai, puis revenir (AC20).
      await deplacerSous(page, dossier, `${dossier}/essai_ecran`)
      await capturer(page, testInfo, `deplacement-${mode}`)
      await deplacerSous(page, `private/${handle}`, essai)
      expect(hydratation).toEqual([])
      await context.close()
    })
  }

  for (const mode of MODES) {
    test(`should publish a page created by « + » once its title is typed, then say a refused header without « Réessayer » (${mode})`, async ({ browser }, testInfo) => {
      test.setTimeout(300_000)
      const context = await browser.newContext({ colorScheme: mode, viewport: { width: 1920, height: 900 } })
      const page = await context.newPage()
      await seConnecterSurLEspace(page, { email, password })
      const rail = page.getByRole("navigation", { name: "Navigation principale" })
      const contexte = (await rail.getByRole("link", { name: "Contexte · Privé" }).getAttribute("href")) ?? ""
      expect(contexte).toMatch(/^\/n\/private\/[^/]+\/contexte$/)
      await page.goto(`${ESPACE.adresse}${contexte}`)

      // AC-c1 : le « + » de la ligne du Contexte de Privé crée une page, publiée dès sa création, et l'ouvre.
      const ligne = rail.getByRole("link", { name: "Contexte · Privé", exact: true })
      await ligne.hover()
      await ligne.locator("xpath=..").getByRole("button", { name: "Ajouter dans Contexte · Privé" }).click()
      await page.getByRole("menuitem", { name: "Une page" }).click()
      await attendre(page).toHaveURL(new RegExp(`${contexte}/sans_titre(_\\d+)?$`))
      const cree = new URL(page.url()).pathname.slice("/n/".length)
      try {
        // AC-c5 : le titre d'un nœud neuf est sélectionné, la frappe le remplace ; AC-c2 : rechargée, la page se lit publiée.
        const titre = page.getByRole("textbox", { name: "Titre", exact: true })
        await attendre(titre).toBeFocused()
        const horodatage = new Date().toISOString().slice(0, 19)
        await page.keyboard.type(`Créée ${horodatage}`)
        await page.keyboard.press("Enter")
        // E11-S05 (AC-g1, AC-g2) : Entrée mène au Texte vide de la page, qui porte l'invite, sans « Commencer à écrire ».
        const texteVide = page.getByRole("textbox", { name: /^Modifier ce texte — / })
        await attendre(texteVide).toBeFocused()
        await expect(texteVide).toHaveAttribute("placeholder", "Commencer à écrire... Utilisez '/' pour afficher tous les types de blocs - Utilisez '@' pour citer un autre contenu (page, tableau, procédure) de l'espace")
        await expect(page.getByRole("button", { name: "Commencer à écrire" })).toHaveCount(0)
        await expect(page.getByText("Cette page n'a pas encore de contenu.")).toHaveCount(0)
        await capturer(page, testInfo, `page-vide-${mode}`)
        await attendreLEnregistrement(page)
        await page.reload()
        await attendre(page.getByRole("textbox", { name: "Titre", exact: true })).toHaveValue(`Créée ${horodatage}`)
        // Une page vide déjà titrée s'ouvre le focus dans son Texte (AC-g2).
        await attendre(page.getByRole("textbox", { name: /^Modifier ce texte — / })).toBeFocused()
        await attendre(async () => {
          await page.goto(`${ESPACE.adresse}/n/${cree}?version=published`)
          await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Créée ${horodatage}`)
        }).toPass({ timeout: 90_000 })
        await capturer(page, testInfo, `creee-publiee-${mode}`)

        // AC-g1 : une publication refusée pour son en-tête (réponse du service simulée, `details.reason`) le dit en
        // alerte, sans « Réessayer » ; les écritures du brouillon passent.
        await page.goto(`${ESPACE.adresse}/n/${cree}`)
        await page.route("**/api/platform/nodes", async (route) => {
          const corps: unknown = route.request().postDataJSON()
          if (route.request().method() !== "POST" || !(typeof corps === "object" && corps !== null && "publish" in corps && corps.publish === true)) return route.continue()
          return route.fulfill({
            status: 409,
            contentType: "application/json",
            body: JSON.stringify({ error: { code: "conflict", message: "header refused", details: { reason: "header_refused" } } }),
          })
        })
        const champ = page.getByRole("textbox", { name: "Titre", exact: true })
        await attendre(champ).toHaveValue(`Créée ${horodatage}`)
        await champ.fill(`Refusée ${horodatage}`)
        await champ.press("Enter")
        const alerte = page.getByRole("group", { name: "Publication" }).getByRole("alert")
        await attendre(alerte).toHaveText("Ce changement d'en-tête est refusé : demandez à votre assistant d'abandonner le brouillon.")
        await expect(page.getByRole("button", { name: "Réessayer" })).toHaveCount(0)
        await capturer(page, testInfo, `en-tete-refuse-${mode}`)
        await page.unroute("**/api/platform/nodes")
      } finally {
        const statutDeLaCorbeille = await page.evaluate(
          async (corps) => (await fetch("/api/platform/trash", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corps) })).status,
          { path: cree },
        )
        expect(statutDeLaCorbeille).toBe(200)
        await context.close()
      }
    })
  }
})
