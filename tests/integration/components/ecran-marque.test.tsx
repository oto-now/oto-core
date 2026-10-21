import { hydrateRoot } from "react-dom/client"
import { renderToString } from "react-dom/server"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest"
import { EcranMarque, EcranMarqueChargement, type DonneesDeMarque } from "@otomata_tech/oto_platform/ui"

// L'écran de marque (E09-S01, AC6 à AC10, AC12), porté sur le design system d'oto-frontend (E05-S09 partie
// d2 : `settings.appearance.lazy.tsx`, `ThemePicker`) : `fetch` simulé pour l'API, `location` simulée pour le
// rechargement qui suit un enregistrement.

const DEMO: DonneesDeMarque = {
  marque: { theme: "cobalt", logo: "https://example.com/actuel.png", nomAffiche: "Démo" },
  nomOrganisation: "Démo",
  peutModifier: true,
}

const THEMES = [
  ["manuscrit", "Manuscrit", "jaune"],
  ["ardoise", "Ardoise", "neutre"],
  ["grenat", "Grenat", "rouge"],
  ["brique", "Brique", "orange"],
  ["foret", "Forêt", "vert"],
  ["lagune", "Lagune", "cyan"],
  ["cobalt", "Cobalt", "bleu"],
  ["violet", "Violet", "violet"],
] as const

const fetchMock = vi.fn<typeof fetch>()
const assign = vi.fn()

function reponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

function rendre(donnees: DonneesDeMarque = DEMO, enregistre = false) {
  return render(<EcranMarque resultat={{ data: donnees }} enregistre={enregistre} />)
}

const champLogo = () => screen.getByLabelText("Adresse du logo (https)")
const enregistrer = () => fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }))

beforeEach(() => {
  fetchMock.mockReset()
  assign.mockReset()
  vi.stubGlobal("fetch", fetchMock)
  vi.stubGlobal("location", { ...window.location, pathname: "/admin/brand", assign })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("EcranMarque for an administrator (AC6)", () => {
  it("should title the screen and offer the eight named themes as native radios, the current one checked", () => {
    rendre()

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Marque de l'organisation")
    expect(screen.getAllByRole("heading", { level: 2 }).map((titre) => titre.textContent)).toEqual(["Le logo", "La couleur"])
    const groupe = screen.getByRole("group", { name: "Thème" })
    const radios = within(groupe).getAllByRole("radio")
    expect(radios.map((radio) => radio.getAttribute("type"))).toEqual(Array(8).fill("radio"))
    expect(radios.map((radio) => radio.getAttribute("value"))).toEqual(THEMES.map(([cle]) => cle))
    for (const [cle, nom, famille] of THEMES) {
      const radio = within(groupe).getByRole("radio", { name: nom })
      expect(radio).toHaveAccessibleDescription(famille)
      if (cle === "cobalt") expect(radio).toBeChecked()
      else expect(radio).not.toBeChecked()
    }
  })

  // E05-S13 (AC-3) : plus de « Nom affiché », le nom de l'entreprise se règle dans « L'entreprise ».
  it("should prefill the logo address with its preview beside it, without a display name field", () => {
    rendre()

    expect(champLogo()).toHaveValue("https://example.com/actuel.png")
    const apercu = champLogo().parentElement?.querySelector("img")
    expect(apercu).toHaveAttribute("src", "https://example.com/actuel.png")
    expect(screen.queryByLabelText("Nom affiché")).toBeNull()
    expect(screen.getByRole("button", { name: "Enregistrer" })).toBeEnabled()
  })

  it("should follow the brand served when the screen is read again without remounting (portage-ecrans.md § 2)", async () => {
    const { rerender } = rendre()
    const relue: DonneesDeMarque = { ...DEMO, marque: { theme: "foret", logo: "https://example.com/neuf.png", nomAffiche: "Démo Forêt" } }

    rerender(<EcranMarque resultat={{ data: relue }} enregistre={false} />)

    await waitFor(() => expect(champLogo()).toHaveValue("https://example.com/neuf.png"))
    expect(screen.getByRole("radio", { name: "Forêt" })).toBeChecked()
  })
})

describe("EcranMarque saving (AC7, AC8)", () => {
  // L'envoi de la marque entière par PATCH /api/platform/brand, puis le rechargement : le même formulaire
  // (`FormulaireDeMarque`) est éprouvé par `ecran-organisation.test.tsx`, « should write the whole brand by PATCH
  // /api/platform/brand… ».
  it("should disable the button while sending, busy and saying so", async () => {
    let terminer: (value: Response) => void = () => {}
    fetchMock.mockReturnValue(new Promise<Response>((resolve) => (terminer = resolve)))
    rendre()

    enregistrer()

    const bouton = await screen.findByRole("button", { name: "Enregistrement…" })
    expect(bouton).toBeDisabled()
    expect(bouton).toHaveAttribute("aria-busy", "true")
    await act(async () => terminer(reponse(200, { data: {} })))
  })

  it("should refuse an http logo under its field, without any request", async () => {
    rendre()
    fireEvent.change(champLogo(), { target: { value: "http://example.com/logo.png" } })

    enregistrer()

    expect(await screen.findByText("L'adresse du logo doit commencer par https://")).toBeInTheDocument()
    expect(champLogo()).toHaveAccessibleDescription("L'adresse du logo doit commencer par https://")
    expect(champLogo()).toHaveAttribute("aria-invalid", "true")
    expect(fetchMock).not.toHaveBeenCalled()
  })

})

describe("EcranMarque refusals and failures (AC9, AC10)", () => {
  it("should show a refusal of the API as a global alert", async () => {
    const refus: [Response, string][] = [
      [reponse(403, { error: { code: "forbidden", message: "Only an administrator of Démo can change its brand." } }), "Vous n'avez pas le droit de faire cela."],
      [reponse(500, { error: { code: "internal", message: "Internal error." } }), "Une erreur est survenue. Réessayez."],
    ]
    for (const [reponseDeLApi, message] of refus) {
      fetchMock.mockResolvedValueOnce(reponseDeLApi)
      rendre()

      enregistrer()

      expect(await screen.findByRole("alert")).toHaveTextContent(message)
      expect(assign).not.toHaveBeenCalled()
      expect(screen.getByRole("button", { name: "Enregistrer" })).toBeEnabled()
      cleanup()
    }
  })

  it("should tell a member the screen is reserved, without any form", () => {
    rendre({ ...DEMO, peutModifier: false })

    expect(screen.getByRole("alert")).toHaveTextContent("Réservé aux administrateurs de Démo.")
    expect(screen.queryByRole("radio")).toBeNull()
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("should show the message of a failed read, with « Réessayer » when the host gives its link and address", () => {
    const echec = { error: "La marque n'a pas pu être chargée. Réessayez dans un instant." }
    const vue = render(<EcranMarque resultat={echec} enregistre={false} />)

    expect(screen.getByRole("alert")).toHaveTextContent(echec.error)
    expect(screen.queryByRole("radio")).toBeNull()
    expect(screen.queryByRole("link", { name: "Réessayer" })).toBeNull()

    vue.rerender(<EcranMarque resultat={echec} enregistre={false} Lien={({ children, ...props }) => <a {...props}>{children}</a>} ici="/admin/brand" />)
    expect(screen.getByRole("link", { name: "Réessayer" })).toHaveAttribute("href", "/admin/brand")
  })
})

describe("EcranMarque status (AC7, AC12)", () => {
  it("should mount the status region empty from the start", () => {
    rendre()
    expect(screen.getByRole("status")).toBeEmptyDOMElement()
  })

  it("should write the saved message once hydrated, not in the server HTML, so that it is announced", async () => {
    // Une région `role="status"` n'annonce que ce qui change après son montage : un message déjà
    // dans le HTML du serveur s'afficherait sans être dit.
    const ecran = <EcranMarque resultat={{ data: DEMO }} enregistre />
    const conteneur = document.body.appendChild(document.createElement("div"))
    onTestFinished(() => conteneur.remove())
    conteneur.innerHTML = renderToString(ecran)
    expect(within(conteneur).getByRole("status")).toBeEmptyDOMElement()

    const racine = await act(async () => hydrateRoot(conteneur, ecran))
    onTestFinished(() => act(() => racine.unmount()))

    expect(within(conteneur).getByRole("status")).toHaveTextContent("Marque enregistrée.")
  })

  it("should render a busy loading state with a readable label", () => {
    render(<EcranMarqueChargement />)
    const statut = screen.getByRole("status")
    expect(statut).toHaveAttribute("aria-busy", "true")
    expect(statut).toHaveTextContent("Chargement de la marque…")
  })
})
