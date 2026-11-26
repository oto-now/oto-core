#!/usr/bin/env node
/**
 * Preuve visuelle d'un écran : captures pleine page à 375, 768 et 1280 px, en clair et en
 * sombre, écrites dans `.ui-shots/` pour que la review les lise.
 *
 * Usage : pnpm ui:shots [route…]   (défaut : /)
 * Base : UI_SHOTS_BASE_URL (défaut http://localhost:3000). Un serveur qui répond déjà est
 * réutilisé ; sinon `pnpm dev` est démarré puis arrêté à la fin.
 *
 * Le thème suit l'émulation `colorScheme` : le ThemeProvider de `src/app/layout.tsx` est en
 * `defaultTheme="system"`, donc next-themes pose la classe `dark` d'après prefers-color-scheme.
 *
 * Écrans protégés : avec le compte des contrôles visuels, `E2E_USER_EMAIL` et `E2E_USER_PASSWORD`
 * (environnement, puis `.env.local` et `.env`), le script se connecte une fois à `<base>/login`, par les gestes des tests de bout en bout,
 * et capture chaque route sous cette session. Sans elles, une route qui finit sur `/login` fait
 * sortir le script en échec, la capture retirée : une page de connexion n'est jamais prise pour
 * l'écran demandé. Aucune valeur de variable n'est écrite. Comptes de test seulement, jamais la
 * production.
 */
import { spawn, spawnSync } from "node:child_process"
import { mkdir, rm } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "@playwright/test"
import { envFileTexts, resolveVariables } from "./lib/env.mjs"
import { landedOnLogin } from "./lib/ui-shots-login.mjs"

const ROOT = fileURLToPath(new URL("..", import.meta.url))
const OUT_DIR = path.join(ROOT, ".ui-shots")
const BASE_URL = process.env.UI_SHOTS_BASE_URL ?? "http://localhost:3000"
const WIDTHS = [375, 768, 1280]
const SCHEMES = ["light", "dark"]
// La première compilation turbopack d'une route à froid dépasse souvent 30 s.
const SERVER_TIMEOUT_MS = 90_000

async function isUp(url) {
  try {
    await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(5_000) })
    return true
  } catch {
    return false
  }
}

function startDevServer() {
  const port = new URL(BASE_URL).port || "3000"
  // Commande en une chaîne via le shell : résout `pnpm.cmd` sous Windows sans DEP0190 ;
  // detached hors Windows pour tuer tout le groupe de process à l'arrêt.
  return spawn("pnpm dev", {
    cwd: ROOT,
    env: { ...process.env, PORT: port },
    shell: true,
    detached: process.platform !== "win32",
    stdio: "ignore",
  })
}

function stopDevServer(child) {
  if (child.exitCode !== null) return
  // `child.kill()` ne tue que le shell : next dev survivrait et garderait le port.
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" })
  } else {
    process.kill(-child.pid, "SIGTERM")
  }
}

async function waitForServer(child) {
  const deadline = Date.now() + SERVER_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`pnpm dev s'est arrêté (code ${child.exitCode})`)
    if (await isUp(BASE_URL)) return
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  throw new Error(`${BASE_URL} ne répond pas après ${SERVER_TIMEOUT_MS / 1000} s`)
}

/** Les variables de la connexion, toutes deux posées ou aucune. */
export const LOGIN_VARIABLES = ["E2E_USER_EMAIL", "E2E_USER_PASSWORD"]

/** Les identifiants de la connexion, `null` sans eux ; une seule des deux variables est une erreur. */
function loginCredentials() {
  const { values } = resolveVariables(process.env, envFileTexts(ROOT), [], LOGIN_VARIABLES)
  const [emailKey, passwordKey] = LOGIN_VARIABLES
  if (!values[emailKey] && !values[passwordKey]) return null
  if (!values[emailKey] || !values[passwordKey]) throw new Error(`${LOGIN_VARIABLES.join(" et ")} vont ensemble : posez les deux`)
  return { email: values[emailKey], password: values[passwordKey] }
}

/** La session d'une connexion par mot de passe, par les gestes de `tests/e2e/fixtures/connexion.ts`. */
async function loggedInState(browser, credentials) {
  const context = await browser.newContext()
  try {
    const page = await context.newPage()
    await page.goto(new URL("/login", BASE_URL).href, { waitUntil: "networkidle", timeout: SERVER_TIMEOUT_MS })
    await page.getByLabel("Adresse mail").fill(credentials.email)
    await page.getByRole("button", { name: "Continuer", exact: true }).click()
    await page.getByLabel("Mot de passe").fill(credentials.password)
    await page.getByRole("button", { name: "Se connecter" }).click()
    await page.waitForURL((url) => url.pathname !== "/login", { timeout: SERVER_TIMEOUT_MS }).catch(() => {
      throw new Error(`la connexion de ${LOGIN_VARIABLES[0]} n'aboutit pas sur ${BASE_URL} (compte, mot de passe ou organisation de l'adresse)`)
    })
    return await context.storageState()
  } finally {
    await context.close()
  }
}

function slugOf(route) {
  const slug = route.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "")
  return slug || "home"
}

async function shootRoute(page, route, name) {
  const response = await page.goto(new URL(route, BASE_URL).href, {
    waitUntil: "networkidle",
    timeout: SERVER_TIMEOUT_MS,
  })
  if (landedOnLogin(route, page.url())) return { route, login: true }
  if (response && response.status() >= 400) {
    process.stderr.write(`attention : ${route} répond ${response.status()}\n`)
  }
  await page.evaluate(() => document.fonts.ready)
  const file = path.join(OUT_DIR, `${slugOf(route)}__${name}.png`)
  await page.screenshot({ path: file, fullPage: true, animations: "disabled" })
  return { file: path.relative(ROOT, file).split(path.sep).join("/") }
}

async function shoot(browser, routes, storageState) {
  const files = []
  const onLogin = []
  for (const width of WIDTHS) {
    for (const scheme of SCHEMES) {
      const context = await browser.newContext({ viewport: { width, height: 800 }, colorScheme: scheme, storageState })
      const page = await context.newPage()
      const shots = []
      for (const route of routes) shots.push(await shootRoute(page, route, `${width}__${scheme}`))
      onLogin.push(...shots.filter((shot) => shot.login).map((shot) => shot.route))
      files.push(...shots.filter((shot) => !shot.login).map((shot) => shot.file))
      await context.close()
    }
  }
  return { files, onLogin: [...new Set(onLogin)] }
}

async function main() {
  const routes = process.argv.slice(2)
  if (routes.length === 0) routes.push("/")

  await rm(OUT_DIR, { recursive: true, force: true })
  await mkdir(OUT_DIR, { recursive: true })

  const credentials = loginCredentials()
  const server = (await isUp(BASE_URL)) ? null : startDevServer()
  let browser
  try {
    if (server) await waitForServer(server)
    browser = await chromium.launch()
    const storageState = credentials ? await loggedInState(browser, credentials) : undefined
    const { files, onLogin } = await shoot(browser, routes, storageState)
    if (files.length > 0) process.stdout.write(files.join("\n") + "\n")
    if (onLogin.length > 0) {
      const remede = credentials ? "la session ne donne pas accès à ces routes" : `posez ${LOGIN_VARIABLES.join(" et ")} (un compte de test) pour capturer un écran protégé`
      throw new Error(`renvoyé sur /login, rien de capturé pour : ${onLogin.join(", ")} ; ${remede}`)
    }
  } finally {
    await browser?.close()
    if (server) stopDevServer(server)
  }
}

main().catch((error) => {
  process.stderr.write(`ui:shots : ${error.message}\n`)
  process.exit(1)
})
