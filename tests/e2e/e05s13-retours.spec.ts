import { expect, test, type Page } from "@playwright/test"
import { avecLaBase, clientAuth } from "./fixtures/base"
import { AUTRE_EQUIPE, CHEMINS, EQUIPE, ESPACE, SANS_ESPACE } from "./fixtures/espace"
import { attendre, capturer, ouvrirAQuoiSert, ouvrirLeRail, seConnecterSurLEspace } from "./fixtures/noeud"

// Les retours du soir de JB (E05-S13, AC-29), en contrôle visuel connecté sur l'organisation de la campagne
// (`espace.ts`), en clair puis en sombre, à 375 et 1 280 px : le menu de l'entreprise range Journal dans les
// réglages, sans Usage ni Retours, un seul groupe sans sous-titre (AC-10, puis 1.1.3) ; le titre
// d'une section du rail la plie et la déplie comme le chevron, un seul contrôle, le pli retenu (AC-12) ; la vue
// « Contexte » (`/context` depuis E11-S10) montre ses parties en cartes, en français, sans chiffres (AC-13, AC-14) ; l'encart
// « Voici ce que votre agent va lire » sans chiffres ni légende visible (AC-13) ; « À quoi sert cette page » en une
// phrase par portée, plus « Vous l'écrivez comme n'importe quelle page. » (AC-17) ; aucun « Déplacer » en tête d'un
// contenu (AC-20) ; l'encart « Contexte · Tout le monde » d'Organisation porte les pages que cite ce Contexte
// (AC-4) ; Équipes : colonne « Responsables », « — » sans responsable, plus de « Changer de responsable… » (AC-24).
// Seule écriture : la lecture d'une page par l'assistant du compte, au journal (précondition d'AC-14). Une capture
// par étape dans `test-results/`.

const email = process.env.E2E_USER_EMAIL ?? ""
const password = process.env.E2E_USER_PASSWORD ?? ""
const MODES = ["light", "dark"] as const
const LARGEURS = [375, 1_280] as const
/** Ce que l'écran ne dit plus (E05-S13, AC-13, AC-14) : l'anglais servi et les chiffres. */
const RETIRES = ["Procedures you can run", "What's new", "Recent content", "Nothing new", "caractères sur", "reflète les versions"]

/** Le menu de l'entreprise, ouvert par sa pastille en tête du rail. */
async function menuDeLEntreprise(page: Page, largeur: number) {
  const rail = await ouvrirLeRail(page, largeur)
  await rail.getByRole("button", { name: /^Entreprise : / }).click()
  return page.getByRole("menu")
}

test.describe("E05-S13 : les retours du soir", () => {
  test.skip(!ESPACE.semee, SANS_ESPACE)

  test.beforeAll(async () => {
    const { error } = await clientAuth().auth.signInWithPassword({ email, password })
    test.skip(error !== null, "E2E account missing from the Supabase project: run pnpm demo:seed (E01-S05)")
    // AC-14 suppose des contenus récents : sur l'organisation neuve de la campagne, le compte n'a encore lu ni écrit
    // aucune page, et le produit n'en sert aucun. Une lecture de la grille tarifaire par son assistant, écrite comme
    // la porte MCP l'écrit (section `journal` du semis), les lui donne ; elle part avec l'organisation.
    const lues = await avecLaBase(
      (sql) => sql`
        insert into platform.journal (org_id, user_id, method, tool, target, is_error)
        select o.id, m.user_id, 'tools/call', o.prefix || '_read', ${CHEMINS.grilleTarifaire}, false
          from platform.orgs o join platform.members m on m.org_id = o.id
         where o.slug = ${ESPACE.slug} and lower(m.email) = lower(${email})
        returning id`,
    )
    if (lues.length !== 1) throw new Error("E2E account is not a member of the campaign organisation")
  })

  for (const mode of MODES) {
    for (const largeur of LARGEURS) {
      test(`should show the evening feedback on the menu, the rail, the Contexte screens, the headers and the teams (${mode}, ${largeur} px)`, async ({ browser }, testInfo) => {
        test.setTimeout(600_000)
        const context = await browser.newContext({ colorScheme: mode, viewport: { width: largeur, height: 900 } })
        const page = await context.newPage()
        const nom = `${mode}-${largeur}`
        const main = page.getByRole("main")
        await seConnecterSurLEspace(page, { email, password })

        // AC-10 : dans les réglages, « Activité » (Statistiques et Journal, 1.4.13) à la place du Journal ; « Suivi de
        // l'entreprise » revient avec Retours, toujours montré à qui administre (1.4.13, décision de JB : la page dit
        // l'option « Retours visibles » éteinte) ; deux groupes, chacun son sous-titre.
        const menu = await menuDeLEntreprise(page, largeur)
        await expect(menu.getByRole("menuitem")).toHaveText(["Organisation", "Équipes & accès", "Activité", "Retours"])
        await expect(menu.getByRole("menuitem", { name: "Journal" })).toHaveCount(0)
        await expect(menu.getByRole("menuitem", { name: "Statistiques" })).toHaveCount(0)
        await expect(menu.getByText("Réglages de l’entreprise", { exact: true })).toHaveCount(1)
        await expect(menu.getByText("Suivi de l’entreprise", { exact: true })).toHaveCount(1)
        await capturer(page, testInfo, `menu-entreprise-${nom}`)
        await page.keyboard.press("Escape")
        if (largeur < 768) await page.keyboard.press("Escape")

        // AC-12 : le titre de la section Privé la plie comme le chevron, un seul contrôle, au clavier ; le pli est retenu.
        let rail = await ouvrirLeRail(page, largeur)
        const pli = rail.getByRole("button", { name: /^(Replier|Déplier) Privé$/ })
        await expect(pli).toHaveCount(1)
        await expect(pli).toHaveAttribute("aria-expanded", "true")
        await expect(pli).toHaveAttribute("aria-controls", /.+/)
        await pli.click()
        await expect(rail.getByRole("button", { name: "Déplier Privé", exact: true })).toHaveAttribute("aria-expanded", "false")
        await capturer(page, testInfo, `rail-plie-${nom}`)
        await page.reload()
        rail = await ouvrirLeRail(page, largeur)
        const plie = rail.getByRole("button", { name: "Déplier Privé", exact: true })
        await attendre(plie).toHaveAttribute("aria-expanded", "false")
        await plie.focus()
        await page.keyboard.press("Enter")
        await expect(rail.getByRole("button", { name: "Replier Privé", exact: true })).toHaveAttribute("aria-expanded", "true")
        if (largeur < 768) await page.keyboard.press("Escape")

        // AC-13, AC-14 : la vue « Contexte » (`/context`, E11-S10), ses parties en cartes et en français, sans chiffres ni
        // « Règles Oto ».
        // Un connecteur parmi les nouveautés (AC-14), le bloc n'en gardant que les 20 lignes plus récentes : les specs parallèles
        // publient des versions du Privé du compte, qui chassent l'activation semée. Elle est redatée juste avant la
        // lecture, comme une réactivation (`updated_at`, la date que lit le bloc).
        const redatees = await avecLaBase(
          (sql) => sql`
            update platform.connector_activations a set updated_at = now()
              from platform.orgs o
             where o.slug = ${ESPACE.slug} and a.org_id = o.id and a.connector = 'mail' and a.state = 'active'
            returning a.connector`,
        )
        expect(redatees, "active mail connector of the campaign organisation").toHaveLength(1)
        await page.goto(`${ESPACE.adresse}/context`)
        const vue = main
        await attendre(vue.getByRole("region", { name: "Contexte : Tout le monde" })).toBeVisible()
        // 2026-10-27 : nouveautés et contenus récents en une partie ; plus de procédures utiles servies.
        await expect(vue.getByRole("region", { name: /^Contenus récents et nouveautés/ })).toBeVisible()
        for (const partie of ["Nouveautés", "Procédures utiles"]) await expect(vue.getByRole("region", { name: new RegExp(`^${partie}`) })).toHaveCount(0)
        await expect(vue.getByRole("region", { name: "Règles Oto" })).toHaveCount(0)
        for (const retire of RETIRES) await expect(vue, retire).not.toContainText(retire)
        await expect(vue.getByRole("region", { name: /^Contenus récents/ }).getByText(/^Connecteur .+ activé le /).first()).toBeVisible()
        await expect(vue.getByRole("region", { name: /^Contenus récents/ }).locator('a[href^="/n/"]').first()).toBeVisible()
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
        await capturer(page, testInfo, `vue-contexte-${nom}`)

        // AC-13, AC-17, AC-20 : le Contexte de l'équipe, ses deux encarts, et aucun « Déplacer » en tête.
        await page.goto(`${ESPACE.adresse}/n/${CHEMINS.contexteDeLEquipe}`)
        const aQuoiSert = await ouvrirAQuoiSert(page)
        await attendre(aQuoiSert.getByText(`Ce que votre Claude/ChatGPT/Mistral, comme celui de chaque membre de l'équipe ${EQUIPE.nom}, lit à chaque conversation.`)).toBeVisible()
        await expect(aQuoiSert.getByText("Vous l'écrivez comme n'importe quelle page.")).toBeVisible()
        await expect(aQuoiSert.getByText("Reçu par")).toHaveCount(0)
        await expect(aQuoiSert.getByRole("definition")).toHaveCount(0)
        const lecture = page.getByRole("note", { name: "Voici ce que votre agent va lire" })
        await expect(lecture.getByRole("list", { name: "Ordre de lecture" })).toBeVisible()
        await expect(lecture.getByText("Ordre de lecture", { exact: true })).toHaveCount(0)
        await expect(lecture.getByText(/\(ce contexte\)/)).toBeVisible()
        for (const retire of [/caractères sur/, /reflète les versions/, /· complet/]) await expect(lecture.getByText(retire)).toHaveCount(0)
        await expect(page.getByRole("button", { name: "Déplacer", exact: true })).toHaveCount(0)
        await capturer(page, testInfo, `contexte-equipe-${nom}`)

        // AC-17 : la phrase de Tout le monde et celle de Privé.
        await page.goto(`${ESPACE.adresse}/n/contexte`)
        await attendre((await ouvrirAQuoiSert(page)).getByText(/^Ce que votre Claude\/ChatGPT\/Mistral, comme celui de chaque membre de .+, lit à chaque conversation\.$/)).toBeVisible()
        rail = await ouvrirLeRail(page, largeur)
        const prive = await rail.locator('a[href^="/n/private/"][href$="/contexte"]').first().getAttribute("href")
        if (largeur < 768) await page.keyboard.press("Escape")
        await page.goto(`${ESPACE.adresse}${prive ?? ""}`)
        await attendre((await ouvrirAQuoiSert(page)).getByText("Ce que votre assistant lit à chaque conversation ; vous seul le recevez.", { exact: true })).toBeVisible()

        // AC-20 : ni une page, ni une procédure, ni un tableau n'ont « Déplacer » en tête.
        for (const chemin of [CHEMINS.grilleTarifaire, CHEMINS.procedure, CHEMINS.tableau]) {
          await page.goto(`${ESPACE.adresse}/n/${chemin}`)
          await attendre(main.getByRole("heading", { level: 1 })).toBeVisible()
          await expect(page.getByRole("button", { name: "Déplacer", exact: true }), chemin).toHaveCount(0)
        }

        // AC-4 : l'encart « Contexte · Tout le monde » d'Organisation porte, sous les blocs, les pages que ce Contexte cite.
        await page.goto(`${ESPACE.adresse}/admin/organization`)
        const encart = page.getByRole("region", { name: "Contexte · Tout le monde" })
        await attendre(encart.getByRole("list", { name: "Pages citées" })).toBeVisible()
        await expect(encart.getByRole("list", { name: "Pages citées" }).locator(`a[href="/n/${CHEMINS.grilleTarifaire}"]`)).toBeVisible()
        for (const retire of RETIRES.slice(0, 4)) await expect(encart, retire).not.toContainText(retire)
        await capturer(page, testInfo, `organisation-encart-${nom}`)

        // AC-24 : les responsables d'une équipe, « — » sans responsable, plus de « Changer de responsable… ».
        await page.goto(`${ESPACE.adresse}/teams?tab=teams`)
        const equipes = page.getByRole("table", { name: `Les équipes de ${ESPACE.nom}` })
        await attendre(equipes.getByRole("columnheader", { name: "Responsables" })).toBeVisible()
        await expect(equipes.getByRole("row").filter({ hasText: AUTRE_EQUIPE.nom })).toContainText("—")
        await expect(page.getByText("Sans responsable")).toHaveCount(0)
        await page.getByRole("button", { name: `Gérer ${EQUIPE.nom}`, exact: true }).click()
        await expect(page.getByRole("menu").getByRole("menuitem", { name: "Changer de responsable…" })).toHaveCount(0)
        await page.keyboard.press("Escape")
        await page.getByRole("button", { name: `Voir les personnes de ${EQUIPE.nom}` }).click()
        await attendre(page.getByRole("button", { name: /Retirer .*des responsables/ }).first()).toBeVisible()
        await capturer(page, testInfo, `equipes-responsables-${nom}`)
        await context.close()
      })
    }
  }
})
