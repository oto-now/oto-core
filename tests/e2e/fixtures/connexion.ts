import { expect, type Page } from "@playwright/test"

type Identifiants = { email: string; password: string }

/**
 * Remplit la page de connexion ouverte, l'envoie, puis attend `arrivee`. Seul endroit où une spec
 * saisit un mot de passe : un échec ne l'y laisse jamais. Playwright écrit l'instantané de la page,
 * valeurs saisies comprises, dans `test-results/**\/error-context.md`, que le rapport HTML recopie
 * dans `playwright-report/` ; ce rapport garde aussi, à chaque passage, le titre de l'étape de
 * saisie, `Fill "<valeur>"` : une campagne qui passe ici tourne sous le rapport `line`, celui de
 * `playwright.config.ts`, jamais sous `--reporter=html` (`testing-strategy.md § Anti-patterns`).
 */
export async function envoyerLaConnexion(page: Page, { email, password }: Identifiants, arrivee: () => Promise<void>): Promise<void> {
  await page.getByLabel("Adresse mail").fill(email)
  // L'adresse d'abord (2026-10-20) : « Continuer » montre ensuite le mot de passe.
  await page.getByRole("button", { name: "Continuer", exact: true }).click()
  const motDePasse = page.getByLabel("Mot de passe")
  // Le `try` couvre la saisie, l'envoi et l'attente : tout échec vide le champ avant d'être relancé.
  try {
    await motDePasse.fill(password)
    await page.getByRole("button", { name: "Se connecter" }).click()
    await arrivee()
  } catch (erreur) {
    // Champ déjà parti avec la page (connexion faite, page fermée) : rien à vider, l'échec d'origine suit.
    await motDePasse.fill("", { timeout: 2_000 }).catch(() => undefined)
    throw erreur
  }
}

/**
 * Se connecte par mot de passe sur l'adresse donnée : l'organisation est celle de cette adresse
 * (ADR-004), et le cookie de session est posé sur son hôte. Réutilisée par E05-S03.
 */
export async function seConnecter(page: Page, { baseURL, email, password }: { baseURL: string } & Identifiants) {
  await page.goto(`${baseURL}/login`)
  await envoyerLaConnexion(page, { email, password }, () => expect(page).not.toHaveURL(/\/login(\?|$)/))
}
