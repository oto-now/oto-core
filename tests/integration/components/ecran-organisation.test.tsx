import type { AnchorHTMLAttributes } from "react"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { BlockView, OrgView } from "@otomata_tech/oto_platform/schemas"
import {
  ContexteDeLHote,
  ContexteDeRafraichissement,
  EcranOrganisation,
  EcranOrganisationChargement,
  type AdressesDuRail,
  type EcranOrganisationProps,
} from "@otomata_tech/oto_platform/ui"

// L'écran « Organisation » du tableau de bord (E08-S03 : AC2, AC3, AC12), porté sur le design system
// d'oto-frontend (E05-S09 partie d2 : `settings.company.lazy.tsx`, `company-identity.tsx`, `company-logo.tsx`,
// `settings-shell.tsx`), avec la marque et le Contexte de Tout le monde (E05-S11 : AC-22 à AC-24) : `fetch`
// simulé pour l'API, `location` pour le rechargement qui suit la marque, relecture et navigation de l'hôte
// fournies par des contextes de test.

const DEMO: OrgView = {
  name: "Démo",
  slug: "demo",
  prefix: "demo",
  tools: ["demo_context", "demo_find", "demo_read", "demo_call", "demo_write", "demo_feedback"],
  hosts: ["demo.localhost", "demo.oto.cx"],
  domains: "sales, support",
  routing: { threshold: null, gap: 0.2 },
  contact: { name: "Claire Morel", email: "claire@demo.test" },
}

const MARQUE = { theme: "cobalt", logo: "https://example.com/logo.png", nomAffiche: "Démo" } as const

const ADRESSES: AdressesDuRail = {
  pages: "/n/",
  journal: "/journal",
  usage: "/admin/usage",
  retours: "/admin/feedback",
  organisation: "/admin/organization",
  equipes: "/teams",
  // Servies ici pour prouver qu'elles ne sont plus des frères (E05-S11, AC-31, AC-32).
  marque: "/admin/brand",
  drapeaux: "/admin/flags",
  acces: "/admin/access",
  connecteurs: "/admin/connectors",
}

function bloc(rang: number, type: BlockView["type"], text: string): BlockView {
  return { id: `bloc-${rang}`, ref: `b${rang}`, type, text, data: {}, key: null, position: rang, revision: 1, provenance: {} }
}

const fetchMock = vi.fn<typeof fetch>()
const assign = vi.fn()
const rafraichir = vi.fn()
const naviguer = vi.fn()

function reponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

function Lien({ children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return <a {...props}>{children}</a>
}

type Options = Pick<EcranOrganisationProps, "marque" | "enregistre" | "contexte" | "retoursVisibles"> & { administre?: boolean }

function ecran(organisation: OrgView | { error: string } = DEMO, { administre = true, ...props }: Options = {}) {
  const resultat = "error" in organisation ? organisation : { data: organisation }
  return (
    <ContexteDeLHote.Provider value={{ Lien, chemin: "/admin/organization", naviguer }}>
      <ContexteDeRafraichissement.Provider value={rafraichir}>
        <EcranOrganisation resultat={resultat} Lien={Lien} ici="/admin/organization" hrefGuide="/n/contexte" fil={{ adresses: ADRESSES, administre }} {...props} />
      </ContexteDeRafraichissement.Provider>
    </ContexteDeLHote.Provider>
  )
}

/** Monte l'écran avec la lecture du Contexte de Tout le monde, résolue sous son `<Suspense>`. */
async function avecLeContexte(lecture: Promise<{ data: BlockView[] } | { error: string }>) {
  await act(async () => {
    render(ecran(DEMO, { contexte: { lecture, prefixeDesPages: "/n/" } }))
  })
  return within(screen.getByRole("region", { name: "Contexte · Tout le monde" }))
}

const envoi = () => {
  const [url, init] = fetchMock.mock.calls[0]
  return { url, methode: init?.method, corps: JSON.parse(String(init?.body)) }
}

const enregistrer = () => screen.getByRole("button", { name: /^Enregistr/ })

beforeEach(() => {
  fetchMock.mockReset()
  assign.mockReset()
  rafraichir.mockReset()
  naviguer.mockReset()
  vi.stubGlobal("fetch", fetchMock)
  vi.stubGlobal("location", { ...window.location, pathname: "/admin/organization", assign })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("EcranOrganisation, reading (AC2 ; E05-S09, AC-d2 ; E05-S11, AC-23)", () => {
  it("should title the screen with the organisation and show « L'entreprise », without routing thresholds nor the former annexes", () => {
    render(ecran())

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Démo")
    expect(screen.getAllByRole("heading", { level: 2 }).map((titre) => titre.textContent)).toEqual(["L’entreprise"])
    expect(screen.getByLabelText("Nom")).toHaveValue("Démo")
    // Le service, l'API et `admin_org` gardent ces réglages ; l'écran ne les montre plus (AC-23 ; E05-S13, AC-1).
    expect(screen.queryByLabelText("Domaines de travail")).toBeNull()
    expect(screen.queryByLabelText("Seuil de routage")).toBeNull()
    expect(screen.queryByLabelText("Écart minimal")).toBeNull()
    for (const ilot of ["Adresses et outils", "Contact", "Marque et guide"]) expect(screen.queryByRole("region", { name: ilot })).toBeNull()
    expect(screen.queryByText(/demo\.oto\.cx|claire@demo\.test/)).toBeNull()
    expect(screen.queryByRole("link", { name: /Modifier la marque/ })).toBeNull()
  })

  it("should show the logo of the brand in « L'entreprise », or the initial of the organisation without one (company-logo)", () => {
    const vue = render(ecran(DEMO, { marque: MARQUE }))
    const entreprise = () => screen.getByRole("region", { name: "L’entreprise" })
    expect(entreprise().querySelector('img[src="https://example.com/logo.png"]')).toHaveAttribute("aria-hidden", "true")
    vue.rerender(ecran(DEMO, { marque: { ...MARQUE, logo: null } }))
    expect(entreprise().querySelector("img")).toBeNull()
    expect(within(entreprise()).getByText("D", { ignore: "input" })).toHaveAttribute("aria-hidden", "true")
  })
})

describe("EcranOrganisation, the brand (E05-S11, AC-22)", () => {
  // E05-S13 (AC-3) : un seul nom, celui de « L'entreprise » ; « Le logo » n'a plus de « Nom affiché ».
  it("should carry « Le logo » then « La couleur » under « L'entreprise », the current theme checked, and a single name field", () => {
    render(ecran(DEMO, { marque: MARQUE }))

    expect(screen.getAllByRole("heading", { level: 2 }).map((titre) => titre.textContent)).toEqual(["L’entreprise", "Le logo", "La couleur"])
    const logo = within(screen.getByRole("region", { name: "Le logo" }))
    expect(logo.getByLabelText("Adresse du logo (https)")).toHaveValue("https://example.com/logo.png")
    expect(screen.queryByLabelText("Nom affiché")).toBeNull()
    expect(screen.getAllByRole("textbox", { name: /^Nom/ }).map((champ) => champ.getAttribute("name"))).toEqual(["name"])
    const couleur = within(screen.getByRole("region", { name: "La couleur" }))
    expect(couleur.getAllByRole("radio")).toHaveLength(8)
    expect(couleur.getByRole("radio", { name: "Cobalt" })).toBeChecked()
    expect(couleur.getByText("La couleur de chaque compte qui n'a pas choisi la sienne dans son profil.")).toBeInTheDocument()
  })

  it("should write the whole brand by PATCH /api/platform/brand, the former display name removed, then come back to the screen with ?saved=1", async () => {
    const marque = { theme: "foret", logo_url: "https://example.com/logo.png", display_name: null }
    fetchMock.mockResolvedValue(reponse(200, { data: marque }))
    render(ecran(DEMO, { marque: MARQUE }))

    fireEvent.click(screen.getByRole("radio", { name: "Forêt" }))
    fireEvent.click(within(screen.getByRole("region", { name: "La couleur" })).getByRole("button", { name: "Enregistrer" }))

    await waitFor(() => expect(assign).toHaveBeenCalledWith("/admin/organization?saved=1"))
    expect(envoi()).toEqual({ url: "/api/platform/brand", methode: "PATCH", corps: marque })
  })

  it("should say the brand was saved when the screen comes back from it", () => {
    render(ecran(DEMO, { marque: MARQUE, enregistre: true }))
    expect(within(screen.getByRole("region", { name: "La couleur" })).getByRole("status")).toHaveTextContent("Marque enregistrée.")
  })
})

describe("EcranOrganisation, the Contexte of Tout le monde (E05-S11, AC-24)", () => {
  it("should read its published blocks as on its page, and open its page by « Modifier »", async () => {
    const contexte = await avecLeContexte(
      Promise.resolve({ data: [bloc(1, "heading", "Qui nous sommes"), bloc(2, "paragraph", "Nous vendons des **pompes**.")] }),
    )

    // Dans l'annexe de l'écran (`TwoColumns`), la matière restant aux réglages.
    expect(within(screen.getByRole("complementary")).getByRole("region", { name: "Contexte · Tout le monde" })).toBeInTheDocument()
    // Un `<h3>`, sous le `<h2>` de l'îlot (`accessibility-patterns.md § Checklist rapide`).
    expect(contexte.getByRole("heading", { name: "Qui nous sommes", level: 3 })).toBeInTheDocument()
    expect(contexte.getByText("pompes").tagName).toBe("STRONG")
    expect(contexte.getByRole("link", { name: "Modifier" })).toHaveAttribute("href", "/n/contexte")
  })

  it("should say an empty Contexte", async () => {
    const contexte = await avecLeContexte(Promise.resolve({ data: [] }))
    expect(contexte.getByText("Rien n'est encore publié dans ce Contexte.")).toBeInTheDocument()
    expect(contexte.getByRole("link", { name: "Modifier" })).toHaveAttribute("href", "/n/contexte")
  })

  it("should say a failed read, with a way to retry", async () => {
    const contexte = await avecLeContexte(Promise.resolve({ error: "Une erreur est survenue. Réessayez." }))
    expect(contexte.getByRole("alert")).toHaveTextContent("Une erreur est survenue. Réessayez.")
    expect(contexte.getByRole("link", { name: "Réessayer" })).toHaveAttribute("href", "/admin/organization")
  })
})

describe("EcranOrganisation, the trail of the settings (E05-S09, AC-d2 ; settings-shell)", () => {
  it("should go up to the first settings screen, and open the siblings of the current one, which navigate by the host", () => {
    render(ecran())

    const fil = within(screen.getByRole("navigation", { name: "Chemin" }))
    expect(fil.getByRole("link", { name: "Réglages de l’entreprise" })).toHaveAttribute("href", "/admin/organization")
    const courant = fil.getByRole("button", { name: "Organisation" })
    expect(courant).toHaveAttribute("aria-current", "page")
    fireEvent.click(courant)
    const freres = within(screen.getByRole("menu")).getAllByRole("menuitemradio")
    // E05-S13 (AC-10) : le Journal se range dans les réglages ; 1.4.13 : il y devient « Activité ».
    expect(freres.map((frere) => [frere.textContent, frere.getAttribute("aria-checked")])).toEqual([
      ["Organisation", "true"],
      ["Équipes & accès", "false"],
      ["Activité", "false"],
    ])
    fireEvent.click(freres[1])
    expect(naviguer).toHaveBeenCalledWith("/teams")
  })

  it("should show no trail to a person who does not administer the organisation", () => {
    render(ecran({ error: "Cette page est réservée aux administrateurs de Démo." }, { administre: false }))
    expect(screen.queryByRole("navigation", { name: "Chemin" })).toBeNull()
  })
})

// 1.4.13 : l'option « Retours visibles », dite par son état et basculée par `PATCH admin/flags`, puis la page relue.
describe("EcranOrganisation, « Retours des assistants » (1.4.13)", () => {
  it("should say the feedback is hidden and show it by PATCH admin/flags, then have the page re-read", async () => {
    fetchMock.mockResolvedValue(reponse(200, { data: { flag: { name: "feedback_visible", description: "…", enabled: true } } }))
    render(ecran(DEMO, { retoursVisibles: { data: false } }))
    const ilot = within(screen.getByRole("region", { name: "Retours des assistants" }))
    expect(ilot.getByText("Retours masqués")).toBeInTheDocument()

    fireEvent.click(ilot.getByRole("button", { name: "Afficher les retours des assistants aux administrateurs" }))

    await waitFor(() => expect(rafraichir).toHaveBeenCalledTimes(1))
    expect(envoi()).toEqual({ url: "/api/platform/admin/flags", methode: "PATCH", corps: { name: "feedback_visible", enabled: true } })
  })

  it("should offer to hide the feedback when shown, say a failed read with a way to retry, and show nothing without the reading", () => {
    const { unmount } = render(ecran(DEMO, { retoursVisibles: { data: true } }))
    expect(screen.getByText("Retours affichés")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Masquer les retours des assistants aux administrateurs" })).toBeInTheDocument()
    unmount()

    const lu = render(ecran(DEMO, { retoursVisibles: { error: "Une erreur est survenue. Réessayez." } }))
    expect(within(screen.getByRole("region", { name: "Retours des assistants" })).getByRole("alert")).toHaveTextContent("Une erreur est survenue. Réessayez.")
    lu.unmount()

    render(ecran())
    expect(screen.queryByRole("region", { name: "Retours des assistants" })).toBeNull()
  })
})

describe("EcranOrganisation, settings (AC3)", () => {
  // E05-S13 (AC-1) : le nom seul part ; sans `domains` dans l'envoi, le service garde ceux enregistrés.
  it("should send only the changed name, without domains, then say it is saved and have the page re-read", async () => {
    let repondre: (valeur: Response) => void = () => {}
    fetchMock.mockReturnValue(new Promise((resolve) => (repondre = resolve)))
    render(ecran())

    expect(enregistrer()).toBeDisabled()
    fireEvent.change(screen.getByLabelText("Nom"), { target: { value: "Démo Énergie" } })
    fireEvent.click(enregistrer())

    await waitFor(() => expect(enregistrer()).toHaveTextContent("Enregistrement…"))
    expect(envoi()).toEqual({ url: "/api/platform/admin/org", methode: "PATCH", corps: { name: "Démo Énergie" } })
    await act(async () => repondre(reponse(200, { data: { org: { ...DEMO, name: "Démo Énergie" } } })))

    expect(await screen.findByRole("status")).toHaveTextContent("Enregistré")
    expect(rafraichir).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText("Nom")).toHaveValue("Démo Énergie")
    expect(enregistrer()).toBeDisabled()
  })

  it("should say an invalid field under it and send nothing", async () => {
    render(ecran())
    fireEvent.change(screen.getByLabelText("Nom"), { target: { value: "" } })
    fireEvent.click(enregistrer())

    expect(await screen.findByText("Le nom compte de 1 à 80 caractères.")).toBeInTheDocument()
    expect(screen.getByLabelText("Nom")).toHaveAttribute("aria-invalid", "true")
    expect(screen.getByLabelText("Nom")).toHaveAccessibleDescription("Le nom compte de 1 à 80 caractères.")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // Les phrases propres au geste pour `forbidden` et pour un autre code : `ui-messages.test.ts`, « should prefer the
  // phrase of the gesture for the reason, then for the code ».
  it.each([
    ["conflict", () => Promise.resolve(reponse(409, { error: { code: "conflict", message: "server text" } })), "L'organisation a changé entre-temps : rechargez la page avant d'enregistrer."],
    ["network", () => Promise.reject(new TypeError("Failed to fetch")), "La connexion au serveur a échoué. Rien n'a été enregistré."],
  ])("should say a %s refusal in an alert, and keep what was typed", async (_code, refus, message) => {
    fetchMock.mockImplementation(refus)
    render(ecran())
    fireEvent.change(screen.getByLabelText("Nom"), { target: { value: "Démo Énergie" } })
    fireEvent.click(enregistrer())

    expect(await screen.findByRole("alert")).toHaveTextContent(message)
    expect(screen.getByLabelText("Nom")).toHaveValue("Démo Énergie")
    expect(rafraichir).not.toHaveBeenCalled()
  })

  it("should take the served settings again when the page re-reads another organisation state (portage § 2)", () => {
    const vue = render(ecran())
    vue.rerender(ecran({ ...DEMO, name: "Démo Énergie", domains: "energy" }))
    expect(screen.getByLabelText("Nom")).toHaveValue("Démo Énergie")
    expect(enregistrer()).toBeDisabled()
  })
})

describe("EcranOrganisation, states (AC12)", () => {
  it("should render a busy status while loading", () => {
    render(<EcranOrganisationChargement />)
    const chargement = screen.getByRole("status")
    expect(chargement).toHaveAttribute("aria-busy", "true")
    expect(chargement).toHaveTextContent("Chargement de l'organisation…")
  })

  it("should say a failed read in an alert, with a way to retry, under the heading of the screen", () => {
    render(ecran({ error: "Cette page est réservée aux administrateurs de Démo." }, { marque: MARQUE }))
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Organisation")
    expect(screen.getByRole("alert")).toHaveTextContent("Cette page est réservée aux administrateurs de Démo.")
    expect(screen.getByRole("link", { name: "Réessayer" })).toHaveAttribute("href", "/admin/organization")
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull()
  })
})
