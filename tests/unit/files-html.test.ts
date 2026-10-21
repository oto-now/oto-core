// @vitest-environment node
// La route isolée d'un fichier HTML (E10-S02 lot c : AC-c3, AC-c5 ; ADR-017 § 1) sans base : la politique et les
// en-têtes exacts de l'ADR, texte comparé mot pour mot (tout écart est une faille) ; la règle `Sec-Fetch-Dest` ; les
// adresses que la porte sert avant le jeton de session ; le 401 sans session, en texte brut aux mêmes en-têtes, sans
// aucune lecture de la base.
import { describe, expect, it, vi } from "vitest"
import { fileHtmlResponse, isFileHtmlRoute } from "../../packages/plateforme/api/files-html"
import { isPublicRoute } from "../../packages/plateforme/api/public"
import { HTML_CONTENT_SECURITY_POLICY, htmlHeaders, servedInFrame } from "../../packages/plateforme/server/files/html"

const FICHIER = "0c9e8d7f-6a5b-4c3d-8e2f-1a0b9c8d7e6f"
const JETON = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde"

/** ADR-017 § 1, recopié de l'ADR : la politique du paquet doit lui être égale à l'octet. */
const POLITIQUE_DE_L_ADR =
  "sandbox allow-scripts allow-popups allow-forms; default-src 'none'; script-src 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'"

describe("isolated HTML route headers (AC-c3, ADR-017 § 1)", () => {
  it("should carry the Content-Security-Policy of ADR-017 word for word", () => {
    expect(HTML_CONTENT_SECURITY_POLICY).toBe(POLITIQUE_DE_L_ADR)
  })

  it("should serve a file as HTML and an error as plain text, with the same isolation headers, and noindex through a public link (AC-c5)", () => {
    const communs = {
      "Content-Security-Policy": POLITIQUE_DE_L_ADR,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "private, no-store",
    }
    expect({
      servi: htmlHeaders({ error: false, publicRoute: false }),
      erreur: htmlHeaders({ error: true, publicRoute: false }),
      public: htmlHeaders({ error: false, publicRoute: true }),
    }).toEqual({
      servi: { "Content-Type": "text/html; charset=utf-8", ...communs },
      erreur: { "Content-Type": "text/plain; charset=utf-8", ...communs },
      public: { "Content-Type": "text/html; charset=utf-8", ...communs, "X-Robots-Tag": "noindex, nofollow" },
    })
  })

  it("should serve an iframe, or a browser that sends no Sec-Fetch-Dest, and refuse a tab, a window or a direct link (HN-E10S02-12)", () => {
    expect([null, "iframe", "IFRAME", "document", "empty", "object", "embed"].map(servedInFrame)).toEqual([true, true, true, false, false, false, false])
  })
})

describe("routes served before the session token (AC-c3, AC-c5)", () => {
  it("should route files/<id>/html alone to the isolated route, and GET only", () => {
    expect([
      isFileHtmlRoute(["files", FICHIER, "html"], "GET"),
      isFileHtmlRoute(["files", FICHIER, "html"], "POST"),
      isFileHtmlRoute(["files", FICHIER], "GET"),
      isFileHtmlRoute(["files", FICHIER, "markdown"], "GET"),
      isFileHtmlRoute(["files", FICHIER, "html", "x"], "GET"),
    ]).toEqual([true, false, false, false, false])
  })

  it("should open the public door to a link, its files, their blocks and their HTML, and nothing else", () => {
    const portes = (segments: string[], methode = "GET") => isPublicRoute(segments, methode)
    expect([
      portes(["public", JETON]),
      portes(["public", JETON, "files", FICHIER]),
      portes(["public", JETON, "files", FICHIER, "markdown"]),
      portes(["public", JETON, "files", FICHIER, "html"]),
      portes(["public", JETON, "files", FICHIER, "complete"]),
      portes(["public", JETON, "files"]),
      portes(["public", JETON, "nodes", FICHIER]),
      portes(["public", JETON, "files", FICHIER, "html", "x"]),
      portes(["public", JETON, "files", FICHIER], "POST"),
    ]).toEqual([true, true, true, true, false, false, false, false, false])
  })

  it("should answer 401 forbidden in plain text, with the isolation headers, to a request without a session, verifying nothing, and to a token that does not verify", async () => {
    const verifyToken = vi.fn()
    const request = () => new Request(`https://demo.oto.test/api/platform/files/${FICHIER}/html`)
    const answer = async (response: Response) => ({ status: response.status, body: await response.text(), headers: Object.fromEntries(response.headers) })
    const expected = {
      status: 401,
      body: "forbidden: Authentication required.",
      headers: Object.fromEntries(Object.entries(htmlHeaders({ error: true, publicRoute: false })).map(([nom, valeur]) => [nom.toLowerCase(), valeur])),
    }
    expect({
      sansSession: await answer(await fileHtmlResponse(request(), { accessToken: null, host: "demo.oto.test", verifyToken }, ["files", FICHIER, "html"])),
      jetonRefuse: await answer(await fileHtmlResponse(request(), { accessToken: "jeton-refuse", host: "demo.oto.test", verifyToken: async () => undefined }, ["files", FICHIER, "html"])),
    }).toEqual({ sansSession: expected, jetonRefuse: expected })
    expect(verifyToken).not.toHaveBeenCalled()
  })
})
