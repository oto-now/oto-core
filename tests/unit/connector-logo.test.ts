// @vitest-environment node
// Le logo d'un outil de l'écran Connecteurs : le favicon du domaine déclaré, raster et borné en taille, gardé en mémoire,
// et servi par la porte à une session seulement, en image, jamais en JSON. Le réseau est simulé par le transport de
// `fetchSource`, dont les gardes (https, adresses privées, redirections) ont leurs propres tests ; la session est celle
// que rend la vérification simulée.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { connectorLogoResponse, isConnectorLogoRoute } from "../../packages/plateforme/api/connector-logo"
import { registerConnectors } from "../../packages/plateforme/server/connectors/declaration"
import { connectorLogo, faviconOf, LOGO_BYTES_MAX } from "../../packages/plateforme/server/connectors/logo"
import type { Resolve, SourceGet } from "../../packages/plateforme/server/uploads-fetch"
import { describedConnector } from "../factories/described-connector"

vi.mock("../../packages/plateforme/api/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../packages/plateforme/api/session")>()),
  verifiedSession: async (_request: Request, options: { accessToken: string | null }) => (options.accessToken ? { db: {}, email: "lea@example.invalid", caller: {} } : null),
  sessionIdentity: async () => ({}),
}))

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
const PUBLIQUE: Resolve = async () => [{ address: "93.184.216.34", family: 4 }]

/** Un faux réseau : chaque adresse rend son type et son corps, 404 sinon ; les adresses lues sont notées. */
function reseau(reponses: Record<string, { type: string; corps: Uint8Array }>) {
  const lues: string[] = []
  const get: SourceGet = async (url) => {
    lues.push(url.href)
    const reponse = reponses[url.href]
    async function* corps() {
      if (reponse) yield reponse.corps
    }
    return { status: reponse ? 200 : 404, location: null, length: reponse?.corps.byteLength ?? null, type: reponse?.type ?? null, body: corps(), discard: () => undefined }
  }
  return { get, lues }
}

describe("faviconOf", () => {
  it("should serve a raster favicon, and nothing for an SVG, a body over the bound or an absent favicon", async () => {
    const lire = (type: string, corps: Uint8Array) => faviconOf("d.example", { resolve: PUBLIQUE, get: reseau({ "https://d.example/favicon.ico": { type, corps } }).get })
    expect({
      png: await lire("image/png", PNG),
      ico: await lire("image/x-icon; charset=binary", PNG),
      svg: await lire("image/svg+xml", PNG),
      lourd: await lire("image/png", new Uint8Array(LOGO_BYTES_MAX + 1)),
      absent: await faviconOf("d.example", { resolve: PUBLIQUE, get: reseau({}).get }),
    }).toEqual({ png: { bytes: PNG, type: "image/png" }, ico: { bytes: PNG, type: "image/x-icon" }, svg: null, lourd: null, absent: null })
  })
})

describe("connectorLogo", () => {
  afterEach(() => registerConnectors([]))

  it("should read the favicon of the declared domain once a day, an absence once an hour, and nothing for a connector without domain", async () => {
    registerConnectors([{ ...describedConnector(), logoDomain: "cache.example" }, describedConnector("sans"), { ...describedConnector("rien"), logoDomain: "rien.example" }])
    const { get, lues } = reseau({ "https://cache.example/favicon.ico": { type: "image/png", corps: PNG } })
    const heure = 60 * 60 * 1000
    const lire = (connecteur: string, depuis: number) => connectorLogo(connecteur, { resolve: PUBLIQUE, get, now: () => 1_000_000 + depuis })
    const servis = [await lire("crm", 0), await lire("crm", 23 * heure), await lire("rien", 0), await lire("rien", heure / 2), await lire("sans", 0)]
    expect(servis.map((logo) => logo?.type ?? null)).toEqual(["image/png", "image/png", null, null, null])
    expect(lues).toEqual(["https://cache.example/favicon.ico", "https://rien.example/favicon.ico"])
    await lire("crm", 25 * heure)
    await lire("rien", 2 * heure)
    expect(lues.slice(2)).toEqual(["https://cache.example/favicon.ico", "https://rien.example/favicon.ico"])
  })

  it("should serve the declared PNG ahead of the domain favicon, without reading the network", async () => {
    // Le domaine sert un favicon d'autres octets : l'image servie dit laquelle a gagné.
    const favicon = new Uint8Array([...PNG, 1])
    registerConnectors([{ ...describedConnector(), logo: Buffer.from(PNG).toString("base64"), logoDomain: "declare.example" }])
    const { get, lues } = reseau({ "https://declare.example/favicon.ico": { type: "image/png", corps: favicon } })
    expect(await connectorLogo("crm", { resolve: PUBLIQUE, get })).toEqual({ bytes: PNG, type: "image/png" })
    expect(lues).toEqual([])
  })
})

describe("connector logo route", () => {
  beforeEach(() => registerConnectors([{ ...describedConnector(), logoDomain: "route.example" }]))
  afterEach(() => registerConnectors([]))

  it("should route connectors/<name>/logo alone, GET only", () => {
    expect([
      isConnectorLogoRoute(["connectors", "crm", "logo"], "GET"),
      isConnectorLogoRoute(["connectors", "crm", "logo"], "POST"),
      isConnectorLogoRoute(["connectors", "crm"], "GET"),
      isConnectorLogoRoute(["admin", "crm", "logo"], "GET"),
    ]).toEqual([true, false, false, false])
  })

  it("should refuse without a session, answer an empty 404 for a connector without logo, and serve the logo with its type, nosniff and a day of private cache", async () => {
    // La mémoire du logo, remplie par une première lecture au transport simulé : la route la sert sans réseau.
    await connectorLogo("crm", { resolve: PUBLIQUE, get: reseau({ "https://route.example/favicon.ico": { type: "image/png", corps: PNG } }).get })
    const servir = (chemin: string[], accessToken: string | null) =>
      connectorLogoResponse(new Request(`https://acme.example.test/api/platform/${chemin.join("/")}`), { accessToken, host: "acme.example.test" }, chemin)
    const sansSession = await servir(["connectors", "crm", "logo"], null)
    const inconnu = await servir(["connectors", "inconnu", "logo"], "jeton")
    const servi = await servir(["connectors", "crm", "logo"], "jeton")
    expect([sansSession.status, inconnu.status, servi.status]).toEqual([401, 404, 200])
    expect(await inconnu.text()).toBe("")
    expect(Object.fromEntries(servi.headers)).toEqual({
      "cache-control": "private, max-age=86400",
      "content-security-policy": "default-src 'none'",
      "content-type": "image/png",
      "x-content-type-options": "nosniff",
    })
    expect(new Uint8Array(await servi.arrayBuffer())).toEqual(PNG)
  })
})
