import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { expect, test, type BrowserContext, type Frame, type Page } from "@playwright/test"
import { ESPACE, SANS_ESPACE } from "./fixtures/espace"
import { assurerLeNoeud, attendre, capturer, seConnecterSurLEspace } from "./fixtures/noeud"

// E10-S02 lot c (AC-c1 à AC-c6 ; ADR-017) : « Voir » d'un fichier HTML et d'un `.md`, la visionneuse, les en-têtes
// reçus par le navigateur sur les deux routes isolées (l'exclusion de `next.config.ts`, que le test d'intégration ne
// voit pas), puis chaque canal d'ADR-017 § 2 joué depuis l'iframe : F1 à F16 fermés, O1 à O7 ouverts et nommés.
// « Constaté » : une erreur levée dans l'iframe, un événement `securitypolicyviolation`, l'absence de requête (celles
// des cadres du fichier et celles que reçoit l'origine extérieure), l'absence de téléchargement, ou une 404. Chaque
// essai est une fonction évaluée dans l'iframe par Playwright (hors de sa CSP, qui refuse `eval`), jamais un texte.
// L'adresse extérieure est une seconde origine locale (un serveur de ce processus, autre port), jamais Internet ; le
// CDN admis (O6) est servi par `context.route`. Le fichier se dépose par les routes du paquet depuis la page
// connectée ; la spec se saute quand le serveur n'a pas de stockage (cinq variables `PLATFORM_STORAGE_*`, action de
// JB). Page jetable `private/<handle>/e10s02_voir`, jamais supprimée ; le lien public de la fin est désactivé.

const email = process.env.E2E_USER_EMAIL ?? ""
const password = process.env.E2E_USER_PASSWORD ?? ""

const QUITTE = "Ce contenu a tenté de quitter la page."
const SANS_STOCKAGE = "files are not enabled on the dev server: set the five PLATFORM_STORAGE_* variables (bucket created by JB)"

/** La politique d'ADR-017 § 1, mot pour mot. */
const POLITIQUE =
  "sandbox allow-scripts allow-popups allow-forms; default-src 'none'; script-src 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'"

test.describe.configure({ mode: "serial" })

/** La seconde origine locale : elle garde le chemin de chaque requête reçue ; `/204` répond sans contenu. */
type Exterieur = { origine: string; recues: string[]; fermer: () => Promise<void> }

async function origineExterieure(): Promise<Exterieur> {
  const recues: string[] = []
  const serveur: Server = createServer((requete, reponse) => {
    recues.push(requete.url ?? "")
    if (requete.url === "/204") {
      reponse.writeHead(204).end()
      return
    }
    reponse.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end("<!doctype html><title>Extérieur</title><p>Extérieur</p>")
  })
  await new Promise<void>((resolu) => serveur.listen(0, "127.0.0.1", resolu))
  // Un serveur TCP écoute sur un port : son adresse est un `AddressInfo`, jamais le chemin d'une socket.
  const { port } = serveur.address() as AddressInfo
  return { origine: `http://127.0.0.1:${port}`, recues, fermer: () => new Promise((resolu) => serveur.close(() => resolu())) }
}

/** Le fichier d'essai : de quoi jouer, par un clic, les canaux qui demandent un geste (F10, F11, F13, O3, F14). */
function fichierDEssai(exterieur: string): string {
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>Essai</title></head>
<body>
<h1>Rapport d'essai</h1>
<form id="formulaire" action="${exterieur}/formulaire" method="post" onsubmit="window.soumis = true"><input name="motdepasse"><button>Envoyer</button></form>
<a id="haut" href="${exterieur}/haut" target="_top">Quitter l'onglet</a>
<a id="telecharger" href="data:text/plain,secret" download="secret.txt">Télécharger</a>
<a id="route" href="html" target="_blank">Ouvrir la route</a>
<a id="fenetre" href="${exterieur}/fenetre" target="_blank">Ouvrir une fenêtre</a>
</body></html>`
}

type Depot = { chemin: string; nom: string; contenu: string; mime: string }

/**
 * Dépose un fichier par les routes du paquet, depuis la page connectée (même origine, même session) : demande, envoi
 * au stockage par l'URL présignée (CORS du bucket), confirmation, puis un bloc `file` publié à la fin de la page.
 */
async function joindre(page: Page, depot: Depot): Promise<string> {
  return page.evaluate(async ({ chemin, nom, contenu, mime }) => {
    const octets = new TextEncoder().encode(contenu)
    const envoyer = async (adresse: string, corps: unknown) => {
      const reponse = await fetch(adresse, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corps) })
      const lu = await reponse.json()
      if (!reponse.ok) throw new Error(`${adresse}: ${JSON.stringify(lu.error)}`)
      return lu.data
    }
    const demande = await envoyer("/api/platform/files", { node: chemin, name: nom, mime, size: octets.byteLength })
    const envoi = await fetch(demande.upload.url, { method: "PUT", headers: demande.upload.headers, body: octets })
    if (!envoi.ok) throw new Error(`upload: ${envoi.status}`)
    await envoyer(`/api/platform/files/${demande.id}/complete`, {})
    const tete = await (await fetch(`/api/platform/nodes?path=${encodeURIComponent(chemin)}`)).json()
    await envoyer("/api/platform/nodes", {
      path: chemin,
      base_revision: tete.data.revision,
      ...(tete.data.draft ? { draft_stamp: tete.data.draft.stamp } : {}),
      publish: true,
      ops: [{ op: "insert_after", input: { type: "file", data: { file_id: demande.id, name: nom, size: octets.byteLength, mime } } }],
    })
    return String(demande.id)
  }, depot)
}

/** L'iframe de la visionneuse, une fois son document chargé. */
async function cadreDe(page: Page): Promise<Frame> {
  await attendre(page.locator("iframe[sandbox]")).toBeVisible()
  const cadre = page.frames().find((frame) => /\/html$/.test(new URL(frame.url()).pathname))
  if (!cadre) throw new Error("iframe of the viewer not found")
  await cadre.waitForLoadState()
  return cadre
}

/** Les accès que l'origine opaque refuse (F2 à F4) : le nom de l'erreur levée par chacun, `"permis"` sinon. */
const accesRefuses = (cadre: Frame) =>
  cadre.evaluate(() => {
    const essais: Record<string, () => unknown> = {
      cookie: () => document.cookie,
      localStorage: () => localStorage.length,
      sessionStorage: () => sessionStorage.length,
      indexedDB: () => indexedDB.open("essai"),
      parent: () => parent.document.title,
      top: () => top?.document.title,
    }
    return Object.fromEntries(
      Object.entries(essais).map(([nom, essai]) => {
        try {
          essai()
          return [nom, "permis"]
        } catch (erreur) {
          return [nom, erreur instanceof Error ? erreur.name : String(erreur)]
        }
      }),
    )
  })

/** Les déclencheurs d'une violation de la politique, joués dans l'iframe (F5, F6, F8, F12, O4). */
type Declencheur = "image" | "fond" | "import" | "police" | "cadre" | "objet" | "embed" | "base" | "formulaire" | "dns"

/**
 * La directive violée par un déclencheur (`securitypolicyviolation`, `effectiveDirective`), `"aucune"` s'il n'en vient
 * pas dans les 5 s ; l'événement est écouté avant le déclenchement.
 */
const violation = (cadre: Frame, declencheur: Declencheur, ext: string) =>
  cadre.evaluate(
    async ({ declencheur, ext }) => {
      const vue = new Promise<string>((resolu) => {
        document.addEventListener("securitypolicyviolation", (evenement) => resolu(evenement.effectiveDirective), { once: true })
        setTimeout(() => resolu("aucune"), 5_000)
      })
      const element = (balise: string, attributs: Record<string, string>, dans: Element = document.body) => {
        const cree = document.createElement(balise)
        for (const [nom, valeur] of Object.entries(attributs)) cree.setAttribute(nom, valeur)
        dans.append(cree)
        return cree
      }
      if (declencheur === "image") element("img", { src: `${ext}/image.png` })
      if (declencheur === "fond") element("div", { style: `background-image: url(${ext}/fond.png); width: 10px; height: 10px` })
      if (declencheur === "import") element("style", {}, document.head).textContent = `@import url(${ext}/style.css);`
      if (declencheur === "police") element("style", {}, document.head).textContent = `@font-face { font-family: essai; src: url(${ext}/police.woff2) } h1 { font-family: essai }`
      if (declencheur === "cadre") element("iframe", { src: `${ext}/cadre` })
      if (declencheur === "objet") element("object", { data: `${ext}/objet` })
      if (declencheur === "embed") element("embed", { src: `${ext}/embed` })
      if (declencheur === "base") element("base", { href: `${ext}/` }, document.head)
      if (declencheur === "formulaire") document.querySelector("form")?.requestSubmit()
      if (declencheur === "dns") for (const rel of ["dns-prefetch", "preconnect"]) element("link", { rel, href: ext }, document.head)
      return vue
    },
    { declencheur, ext },
  )

/** Les requêtes parties d'un cadre du fichier (l'iframe, jamais la page de la visionneuse), par adresse. */
function requetesDuFichier(contexte: BrowserContext): string[] {
  const vues: string[] = []
  contexte.on("request", (requete) => {
    try {
      if (/\/html$/.test(new URL(requete.frame().url()).pathname)) vues.push(requete.url())
    } catch {
      // Une requête sans cadre (service worker) ne vient pas du fichier.
      return
    }
  })
  return vues
}

test.describe("E10-S02 lot c : « Voir » et l'isolation d'un fichier HTML", () => {
  test.skip(!ESPACE.semee, SANS_ESPACE)

  let exterieur: Exterieur
  test.beforeAll(async () => {
    exterieur = await origineExterieure()
  })
  test.afterAll(async () => {
    await exterieur?.fermer()
  })

  test("open an HTML file and a .md file in the viewer, check the headers received, close F1 to F16 and name O1 to O7", async ({ page, context, browser }, testInfo) => {
    test.setTimeout(600_000)
    await seConnecterSurLEspace(page, { email, password })
    const actif = await page.evaluate(async () => ((await (await fetch("/api/platform/files")).json()) as { data: { enabled: boolean } }).data.enabled)
    test.skip(!actif, SANS_STOCKAGE)
    const href = await page.locator('a[href^="/n/private/"][href$="/contexte"]').first().getAttribute("href")
    const handle = /^\/n\/private\/([^/]+)\/contexte$/.exec(href ?? "")?.[1] ?? ""
    const chemin = `private/${handle}/e10s02_voir`
    const ext = exterieur.origine
    await assurerLeNoeud(page, { chemin, titre: "e10s02 voir", resume: "Page jetable du contrôle d'E10-S02, lot c." })
    const html = await joindre(page, { chemin, nom: "essai.html", contenu: fichierDEssai(ext), mime: "text/html" })
    const md = await joindre(page, { chemin, nom: "notes.md", contenu: "## Notes\n\nUn paragraphe **gras**.\n", mime: "text/markdown" })
    const route = `/api/platform/files/${html}/html`
    const requetes = requetesDuFichier(context)
    const telechargements: string[] = []
    page.on("download", (telechargement) => telechargements.push(telechargement.url()))

    // AC-c1 : « Voir » ouvre la visionneuse dans un nouvel onglet ; AC-c3 : les en-têtes reçus par le navigateur.
    await page.goto(`${ESPACE.adresse}/n/${chemin}`)
    const [onglet] = await Promise.all([context.waitForEvent("page"), page.getByRole("link", { name: "Voir essai.html (nouvel onglet)" }).click()])
    const recue = await onglet.waitForResponse((reponse) => reponse.url().endsWith(route))
    expect(new URL(onglet.url()).search).toBe(`?view=${html}`)
    const entetes = recue.headers()
    expect({
      statut: recue.status(),
      type: entetes["content-type"],
      politique: entetes["content-security-policy"],
      referrer: entetes["referrer-policy"],
      nosniff: entetes["x-content-type-options"],
      cache: entetes["cache-control"],
      cadre: entetes["x-frame-options"],
    }).toEqual({ statut: 200, type: "text/html; charset=utf-8", politique: POLITIQUE, referrer: "no-referrer", nosniff: "nosniff", cache: "private, no-store", cadre: undefined })
    await onglet.close()

    // AC-c2, AC-c4 : l'en-tête, la bannière hors de l'iframe, l'iframe isolée.
    await page.goto(`${ESPACE.adresse}/n/${chemin}?view=${html}`)
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("essai.html")
    await expect(page.getByRole("note")).toContainText(`Contenu interactif publié par ${ESPACE.nom}. N'y saisissez jamais de mot de passe.`)
    await expect(page.getByRole("link", { name: "Ouvrir la page e10s02 voir" })).toHaveAttribute("href", `/n/${chemin}`)
    await expect(page.locator("iframe[sandbox]")).toHaveAttribute("sandbox", "allow-scripts allow-popups allow-forms")
    await capturer(page, testInfo, "visionneuse-html")
    const cadre = await cadreDe(page)
    const avant = await page.locator("body").innerText()

    // F1, F16 : aucune requête d'un script, vers l'API comme vers la route de dépôt ; F7 : ni socket, ni flux, ni balise.
    const sorties = await cadre.evaluate(async (exterieure) => {
      const issue = (promesse: Promise<unknown>) => promesse.then(
        () => "envoyée",
        (erreur: Error) => erreur.name,
      )
      const evenement = (ouvrir: (ouvert: () => void, echec: () => void) => void) =>
        new Promise<string>((resolu) => {
          try {
            ouvrir(
              () => resolu("ouvert"),
              () => resolu("erreur"),
            )
          } catch (erreur) {
            resolu(erreur instanceof Error ? erreur.name : "erreur")
          }
        })
      return {
        fetch: await issue(fetch("/api/platform/nodes?path=contexte")),
        depot: await issue(fetch(`/api/platform/uploads/${"A".repeat(43)}`, { method: "POST", body: "x" })),
        xhr: await evenement((ouvert, echec) => {
          const xhr = new XMLHttpRequest()
          xhr.onload = ouvert
          xhr.onerror = echec
          xhr.open("GET", "/api/platform/files")
          xhr.send()
        }),
        socket: await evenement((ouvert, echec) => {
          const socket = new WebSocket(`${exterieure.replace("http", "ws")}/socket`)
          socket.onopen = ouvert
          socket.onerror = echec
        }),
        flux: await evenement((ouvert, echec) => {
          const flux = new EventSource(`${exterieure}/flux`)
          flux.onopen = ouvert
          flux.onerror = echec
        }),
        balise: await evenement((ouvert, echec) => (navigator.sendBeacon(`${exterieure}/balise`, "x") ? ouvert() : echec())),
      }
    }, ext)
    expect(sorties.fetch).toBe("TypeError")
    expect(sorties.depot).toBe("TypeError")
    expect([sorties.xhr, sorties.socket, sorties.flux, sorties.balise]).not.toContain("ouvert")

    // F2 à F4 : ni cookie, ni stockage, ni document parent (origine opaque).
    expect(await accesRefuses(cadre)).toEqual({
      cookie: "SecurityError",
      localStorage: "SecurityError",
      sessionStorage: "SecurityError",
      indexedDB: "SecurityError",
      parent: "SecurityError",
      top: "SecurityError",
    })

    // F5 : ni image, ni CSS, ni `@import`, ni police extérieurs ; F8 : ni cadre, ni objet, ni `embed` ; F12 : `<base>`.
    const directives: Record<string, string> = {}
    for (const declencheur of ["image", "fond", "import", "police", "cadre", "objet", "embed", "base"] as const) directives[declencheur] = await violation(cadre, declencheur, ext)
    expect(directives).toEqual({ image: "img-src", fond: "img-src", import: "style-src-elem", police: "font-src", cadre: "frame-src", objet: "object-src", embed: "object-src", base: "base-uri" })
    expect(
      await cadre.evaluate(() => {
        const lien = document.createElement("a")
        lien.setAttribute("href", "relatif")
        return new URL(lien.href).origin
      }),
    ).toBe(new URL(ESPACE.adresse).origin)

    // F6 : le gestionnaire `onsubmit` s'exécute, l'envoi n'a pas lieu (`form-action 'none'`).
    expect(await violation(cadre, "formulaire", ext)).toBe("form-action")
    expect(await cadre.evaluate(() => Reflect.get(window, "soumis"))).toBe(true)

    // F9 : aucun worker `blob:`.
    expect(
      await cadre.evaluate(
        () =>
          new Promise<string>((resolu) => {
            try {
              const travailleur = new Worker(URL.createObjectURL(new Blob(["postMessage(1)"], { type: "text/javascript" })))
              travailleur.onmessage = () => resolu("exécuté")
              travailleur.onerror = () => resolu("erreur")
            } catch (erreur) {
              resolu(erreur instanceof Error ? erreur.name : "erreur")
            }
          }),
      ),
    ).not.toBe("exécuté")

    // F10 : l'onglet ne change pas d'adresse, par un script ni par un lien `target="_top"`.
    const adresse = page.url()
    await cadre.evaluate((exterieure) => {
      try {
        if (top) top.location.href = `${exterieure}/haut-script`
      } catch {
        // Refusé par le `sandbox` : c'est le constat attendu, relu sur l'adresse de l'onglet.
        return
      }
    }, ext)
    await page.frameLocator("iframe[sandbox]").locator("#haut").click()
    expect(page.url()).toBe(adresse)

    // F11 : aucun téléchargement (relu à la fin).
    await page.frameLocator("iframe[sandbox]").locator("#telecharger").click()

    // F15 : un message à l'écran ne change rien (il n'en écoute aucun).
    await cadre.evaluate(() => parent.postMessage({ type: "navigate", url: "/admin" }, "*"))
    expect(await page.locator("body").innerText()).toBe(avant)

    // F13 : la route ouverte hors iframe, en onglet ou dans une fenêtre ouverte depuis l'iframe : 404.
    const horsCadre = await context.newPage()
    expect((await horsCadre.goto(`${ESPACE.adresse}${route}`))?.status()).toBe(404)
    await horsCadre.close()
    const [fenetreDeLaRoute] = await Promise.all([page.waitForEvent("popup"), page.frameLocator("iframe[sandbox]").locator("#route").click()])
    await fenetreDeLaRoute.waitForLoadState()
    expect(await fenetreDeLaRoute.evaluate(() => document.body.innerText)).toBe("not_found: Unknown file.")
    await fenetreDeLaRoute.close()

    // O3, F14 : une fenêtre s'ouvre sur un clic, vers l'extérieur ; le `sandbox` s'y hérite (pas de cookie).
    const [fenetre] = await Promise.all([page.waitForEvent("popup"), page.frameLocator("iframe[sandbox]").locator("#fenetre").click()])
    await fenetre.waitForLoadState()
    expect(exterieur.recues).toContain("/fenetre")
    expect(
      await fenetre.evaluate(() => {
        try {
          return document.cookie
        } catch (erreur) {
          return erreur instanceof Error ? erreur.name : "erreur"
        }
      }),
    ).toBe("SecurityError")
    await fenetre.close()

    // O4 : DNS par `dns-prefetch` et `preconnect`, sans violation ; O5 : WebRTC sans exception.
    expect(await violation(cadre, "dns", ext)).toBe("aucune")
    expect(
      await cadre.evaluate(() => {
        try {
          new RTCPeerConnection({ iceServers: [{ urls: "stun:127.0.0.1:3478" }] }).close()
          return "créée"
        } catch (erreur) {
          return erreur instanceof Error ? erreur.name : "erreur"
        }
      }),
    ).toBe("créée")

    // O6 : un CDN admis est servi (par la spec), sans `Referer`.
    const referers: (string | undefined)[] = []
    await context.route("https://cdnjs.cloudflare.com/**", async (acheminement) => {
      referers.push(acheminement.request().headers()["referer"])
      await acheminement.fulfill({ status: 200, contentType: "text/javascript", body: "window.cdn = true" })
    })
    expect(
      await cadre.evaluate(
        () =>
          new Promise<boolean>((resolu) => {
            const script = document.createElement("script")
            script.src = "https://cdnjs.cloudflare.com/ajax/libs/essai/1.0.0/essai.min.js"
            script.onload = () => resolu(Reflect.get(window, "cdn") === true)
            script.onerror = () => resolu(false)
            document.head.append(script)
          }),
      ),
    ).toBe(true)
    expect(referers).toEqual([undefined])

    // Les canaux fermés n'ont laissé ni requête (reçue dehors, ou partie de l'iframe vers l'application), ni téléchargement.
    const fermes = ["/formulaire", "/haut", "/haut-script", "/image.png", "/fond.png", "/style.css", "/police.woff2", "/cadre", "/objet", "/embed", "/socket", "/flux", "/balise"]
    expect(exterieur.recues.filter((chemin) => fermes.includes(chemin))).toEqual([])
    expect(requetes.filter((url) => new URL(url).origin === new URL(ESPACE.adresse).origin && !url.endsWith(route))).toEqual([])
    expect(telechargements).toEqual([])

    // O1 : la navigation de l'iframe part, et l'écran la remplace par l'avis ; « Recharger » rend le fichier.
    await cadre.evaluate((exterieure) => {
      location.href = new URL("/ailleurs", exterieure).href
    }, ext)
    await attendre(page.getByRole("alert").filter({ hasText: QUITTE })).toBeVisible()
    expect(exterieur.recues).toContain("/ailleurs")
    await page.getByRole("button", { name: "Recharger" }).click()
    const recharge = await cadreDe(page)
    await recharge.evaluate((exterieure) => {
      const meta = document.createElement("meta")
      meta.httpEquiv = "refresh"
      meta.content = `0;url=${exterieure}/rafraichi`
      document.head.append(meta)
    }, ext)
    await attendre(page.getByRole("alert").filter({ hasText: QUITTE })).toBeVisible()
    expect(exterieur.recues).toContain("/rafraichi")
    await page.getByRole("button", { name: "Recharger" }).click()

    // O2 : une navigation vers une réponse 204 part, et l'écran ne voit rien.
    const sans = await cadreDe(page)
    await sans.evaluate((exterieure) => {
      location.href = new URL("/204", exterieure).href
    }, ext)
    await attendre.poll(() => exterieur.recues.includes("/204")).toBe(true)
    await expect(page.getByRole("alert").filter({ hasText: QUITTE })).toHaveCount(0)

    // AC-c2 : un `.md` se lit en blocs, sans bannière ni iframe.
    await page.goto(`${ESPACE.adresse}/n/${chemin}?view=${md}`)
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("notes.md")
    await expect(page.getByRole("heading", { level: 2, name: "Notes" })).toBeVisible()
    await expect(page.locator("iframe")).toHaveCount(0)
    await capturer(page, testInfo, "visionneuse-md")

    // AC-c5 : la même visionneuse par un lien public, hors session, avec la même bannière ; la route reçue `noindex`.
    const partage = await page.evaluate(async (cible) => {
      const reponse = await fetch("/api/platform/shares", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: cible, include_children: false }) })
      return ((await reponse.json()) as { data: { share: { id: string; token: string } } }).data.share
    }, chemin)
    const visiteur = await (await browser.newContext()).newPage()
    try {
      const [publique] = await Promise.all([
        visiteur.waitForResponse((reponse) => reponse.url().endsWith(`/public/${partage.token}/files/${html}/html`)),
        visiteur.goto(`${ESPACE.adresse}/p/${partage.token}?view=${html}`),
      ])
      expect([publique.status(), publique.headers()["content-security-policy"], publique.headers()["x-robots-tag"], publique.headers()["x-frame-options"]]).toEqual([
        200,
        POLITIQUE,
        "noindex, nofollow",
        undefined,
      ])
      await expect(visiteur.getByRole("note")).toContainText("N'y saisissez jamais de mot de passe.")
      // O7 : le script d'un HTML vu par un lien public lit le jeton dans sa propre adresse ; il ne l'envoie que par O1.
      const cadrePublic = await cadreDe(visiteur)
      expect(await cadrePublic.evaluate(() => location.pathname)).toContain(`/public/${partage.token}/files/`)
      await capturer(visiteur, testInfo, "visionneuse-publique")
    } finally {
      await visiteur.context().close()
      await page.evaluate(async (id) => fetch(`/api/platform/shares/${id}`, { method: "DELETE" }), partage.id)
    }
  })
})
