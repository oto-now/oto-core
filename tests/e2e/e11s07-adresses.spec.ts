import { expect, test } from "@playwright/test"
import { clientAuth } from "./fixtures/base"
import { seConnecterSurLEspace } from "./fixtures/noeud"
import { ESPACE, SANS_ESPACE } from "./fixtures/espace"

// Les adresses en anglais (E11-S07, AC-a1, AC-a3) : le compte E2E, administrateur de l'organisation de la campagne
// (`espace.ts`), ouvre chaque nouvelle route et y trouve son écran ; chaque ancienne adresse, redirections retirées
// comprises, répond 404 sans redirection (HN-E11S07-5) ; `/admin` mène à `/admin/organization` ; l'API des écrans
// répond sous `/api/platform/`, plus sous l'ancien préfixe. Seul fichier de `tests/` exclu de la garde des anciens noms
// (`scripts/check-framework-invariants.mjs`, AC-d2) : il les cite pour prouver qu'ils ne répondent plus.

const email = process.env.E2E_USER_EMAIL ?? ""
const password = process.env.E2E_USER_PASSWORD ?? ""

/** Chaque nouvelle route et le titre de son écran (`h1`) ; `/admin/feedback` est réservé au staff (E05-S13, AC-9). */
const NOUVELLES = [
  ["/teams", "Équipes & accès"],
  ["/profile", "Profil"],
  ["/trash", "Corbeille"],
  ["/admin/organization", "Organisation"],
  ["/admin/connectors", "Connecteurs"],
] as const

const ANCIENNES = [
  "/equipes",
  "/profil",
  "/corbeille",
  "/plateforme",
  "/plateforme/invitations",
  "/aucune-organisation",
  "/auth/confirmer",
  "/admin/organisation",
  "/admin/connecteurs",
  "/admin/retours",
  "/admin/acces",
  "/admin/marque",
  "/admin/drapeaux",
]

test.describe("addresses in English", () => {
  // Un serveur de développement compile chaque écran à sa première ouverture : au-delà des 30 s par défaut.
  test.setTimeout(240_000)
  test.skip(!ESPACE.semee, SANS_ESPACE)

  test.beforeAll(async () => {
    const { error } = await clientAuth().auth.signInWithPassword({ email, password })
    test.skip(error !== null, "E2E account missing from the Supabase project: run pnpm demo:seed (E01-S05)")
  })

  test("should serve each new route, answer 404 without redirect on each former one, and serve the API under its new prefix", async ({ page }) => {
    await seConnecterSurLEspace(page, { email, password })
    const adresse = ESPACE.adresse

    for (const [route, titre] of NOUVELLES) {
      const reponse = await page.goto(`${adresse}${route}`)
      expect(reponse?.status(), route).toBe(200)
      await expect(page.getByRole("heading", { level: 1 }), route).toContainText(titre)
    }
    for (const route of ["/platform", "/context", "/journal"]) {
      expect((await page.goto(`${adresse}${route}`))?.status(), route).toBe(200)
    }
    // 1.4.13 : la page des retours sert tout administrateur ; option « Retours visibles » éteinte, elle le dit.
    expect((await page.goto(`${adresse}/admin/feedback`))?.status(), "/admin/feedback").toBe(200)

    // `/admin` mène à `/admin/organization` (AC-a1).
    await page.goto(`${adresse}/admin`)
    await expect(page).toHaveURL(`${adresse}/admin/organization`)

    for (const route of ANCIENNES) {
      const reponse = await page.goto(`${adresse}${route}`)
      expect(reponse?.request().redirectedFrom(), route).toBeNull()
      expect(reponse?.status(), route).toBe(404)
    }

    // Par le navigateur : `page.request`, côté Node, ne résout pas `t<hex>.localhost` sous Windows (`lireLeHtml`).
    const statuts = await page.evaluate(async () => {
      const lire = async (chemin: string) => (await fetch(chemin, { credentials: "same-origin" })).status
      return { nouveau: await lire("/api/platform/nodes?path=contexte"), ancien: await lire("/api/plateforme/nodes?path=contexte") }
    })
    expect(statuts).toEqual({ nouveau: 200, ancien: 404 })
  })
})
