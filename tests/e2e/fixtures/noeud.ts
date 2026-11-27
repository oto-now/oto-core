import { expect, type Locator, type Page, type TestInfo } from "@playwright/test"
import { envoyerLaConnexion } from "./connexion"
import { ESPACE } from "./espace"

// Les aides des contrôles visuels de l'écran de nœud (page, procédure, Contexte ; M30) : l'attente longue du
// serveur partagé, la connexion à l'organisation de la campagne (`espace.ts`), la capture sans caret, un nœud
// jetable créé par l'API, les lignes d'état de l'éditeur et l'attente de l'enregistrement. Sans elles, deux specs
// recopiaient les mêmes aides, et une correction n'en touchait qu'une.

/**
 * Serveur de développement sur la machine partagée par les agents : un aller-retour (écriture, publication,
 * déplacement, aperçu) y prend plusieurs secondes, et chaque route se compile à son premier appel.
 */
export const attendre = expect.configure({ timeout: 90_000 })

/**
 * La connexion de `seConnecter` (E02-S01) à l'organisation de la campagne, le mot de passe saisi par
 * `envoyerLaConnexion`, l'arrivée attendue plus longtemps.
 */
export async function seConnecterSurLEspace(page: Page, identifiants: { email: string; password: string }): Promise<void> {
  await page.goto(`${ESPACE.adresse}/login`)
  await envoyerLaConnexion(page, identifiants, () => attendre(page).not.toHaveURL(/\/login(\?|$)/))
}

/**
 * Le HTML servi à une adresse de l'organisation, lu par le navigateur depuis la page connectée (même origine, même
 * session). Jamais par `page.request` : son client, côté Node, ne résout pas `t<hex>.localhost` sous Windows
 * (« getaddrinfo ENOTFOUND », campagne du lot E d'E05-S13), que Chromium résout.
 */
export async function lireLeHtml(page: Page, chemin: string): Promise<string> {
  return page.evaluate(async (adresse) => (await fetch(adresse)).text(), chemin)
}

/** Le rail visible : sous 768 px, le tiroir s'ouvre par « Menu ». */
export async function ouvrirLeRail(page: Page, largeur: number): Promise<Locator> {
  const rail = page.getByRole("navigation", { name: "Navigation principale", includeHidden: true })
  if (largeur < 768 && (await rail.getAttribute("data-open")) === null) await page.getByRole("button", { name: "Menu", exact: true }).click()
  return rail
}

/**
 * `caret: "initial"` : la capture n'écrit rien dans la page. Par défaut (`hide`), Playwright pose
 * `caret-color` dans le `style` de chaque champ ; prise avant l'hydratation, la capture fait relever à
 * React un attribut `style` que le client ne rend pas, sur chaque champ monté (sonde d'E05-S08).
 * `animations: "disabled"` : un menu ou un panneau qui vient de s'ouvrir est capturé à la fin de son
 * entrée (`oto-drop`), et non à demi transparent (campagne de la partie c1 d'E05-S09).
 */
export async function capturer(page: Page, testInfo: TestInfo, nom: string): Promise<void> {
  await page.screenshot({ path: testInfo.outputPath(`${nom}.png`), fullPage: true, caret: "initial", animations: "disabled" })
}

type NoeudJetable = { chemin: string; titre: string; resume: string; genre?: "procedure" }

/**
 * Crée un nœud jetable par `POST /api/platform/nodes` (E03-S03), depuis la page connectée : même origine,
 * même session, un premier paragraphe, publié. Un nœud qui existe déjà (ou dont c'est un ancien chemin) rend
 * `stale_revision`, faute de révision lue : il est gardé tel quel.
 */
export async function assurerLeNoeud(page: Page, { chemin, titre, resume, genre }: NoeudJetable): Promise<void> {
  const issue = await page.evaluate(
    async (corps) => {
      const reponse = await fetch("/api/platform/nodes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corps) })
      const lu: { error?: { code?: string } } = await reponse.json()
      return reponse.ok ? "créée" : (lu.error?.code ?? String(reponse.status))
    },
    {
      path: chemin,
      title: titre,
      summary: resume,
      ...(genre ? { kind: genre } : {}),
      // Publié dès sa création, comme l'étaient sur Démo les nœuds laissés par les passages d'avant : sur
      // l'organisation neuve de la campagne, le bandeau d'un brouillon partait à la première publication et
      // déplaçait les blocs mesurés (`e05s11-page`, campagne du lot E d'E05-S13).
      publish: true,
      ops: [{ op: "insert_after", input: { type: "paragraph", text: "Premier paragraphe." } }],
    },
  )
  expect(["créée", "stale_revision"]).toContain(issue)
}

/** Une ligne d'état de l'éditeur ou de la publication, par son texte. */
export const statut = (page: Page, texte: string | RegExp) => page.getByRole("status").filter({ hasText: texte })

/**
 * Attend que la file ait tout écrit : « Enregistré. » au niveau gestion (le compte E2E administre l'organisation de la campagne, la
 * publication part seule, E05-S10), plus aucun « Enregistrement… ».
 */
export async function attendreLEnregistrement(page: Page): Promise<void> {
  await attendre(statut(page, "Enregistré.")).toBeVisible()
  await attendre(statut(page, "Enregistrement…")).toHaveCount(0)
}

/**
 * La ligne de portée d'un Contexte (refonte #217) : sous la méta, toujours visible, sans repli ; l'ancien « À quoi sert
 * cette page », replié, est retiré. Le nom reste celui des appelants.
 */
export async function ouvrirAQuoiSert(page: Page): Promise<Locator> {
  const ligne = page.locator(".oto-node-lead")
  await attendre(ligne).toBeVisible()
  return ligne
}
