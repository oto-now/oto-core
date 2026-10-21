import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { FormulaireDInscription } from "@otomata_tech/oto_platform/ui"
import { DepartVersLOrganisation } from "../../../packages/plateforme/ui/inscription/depart-vers-l-organisation"
import { prefixePropose, slugPropose } from "../../../packages/plateforme/ui/inscription/formulaire-d-inscription"

// Le formulaire d'inscription (E12-S01, AC-12) : un seul champ, le nom, dont se déduisent l'adresse et le préfixe (leurs
// champs ne reviennent que sur un conflit ou un nom inexploitable) ; l'adresse lue sous le champ après une pause de
// frappe, par l'aperçu qui n'écrit rien ; un seul bouton, qui crée au premier clic ; puis le départ vers l'adresse de la
// nouvelle organisation, dès qu'elle répond ; les refus dits en français, sauf le texte du contrôle d'abus de l'hôte,
// dit tel quel. `fetch` simulé pour l'API et pour la sonde de l'adresse.

const assign = vi.fn()

function reponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

const apercuDe = (hote: string) => () => reponse(200, { data: { created: false, org: {}, addresses: { hosts: [hote], added: [hote] } } })
const creee = (hote: string) => () => reponse(201, { data: { created: true, org: {}, hosts: [hote], setup: [] } })
const conflit = () => reponse(409, { error: { code: "conflict", message: "Slug atelier is already taken. Pick another slug." } })

/** Les corps reçus par l'API, dans l'ordre : aperçus (`confirm: false`) et créations (`confirm: true`). */
let recus: Record<string, unknown>[] = []
let sondes: string[] = []

/** L'API simulée : ce que rend un aperçu, ce que rendent les créations dans l'ordre, et si l'adresse sondée répond. */
function api({ apercu = apercuDe("atelier.oto.test"), creations = [], repond = true }: { apercu?: () => Response; creations?: (() => Response)[]; repond?: boolean }) {
  const suite = [...creations]
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (adresse, init) => {
      if (!String(adresse).startsWith("/api/platform/")) {
        sondes.push(String(adresse))
        if (!repond) throw new TypeError("Failed to fetch")
        return new Response(null)
      }
      const corps = JSON.parse(String(init?.body)) as Record<string, unknown>
      recus.push(corps)
      if (corps.confirm !== true) return apercu()
      const rendre = suite.shift()
      if (!rendre) throw new Error("unexpected creation")
      return rendre()
    }),
  )
}

const creer = () => screen.getByRole("button", { name: "Créer l'organisation" })
const nomme = (valeur: string) => fireEvent.change(screen.getByLabelText("Nom de l'organisation"), { target: { value: valeur } })

beforeEach(() => {
  recus = []
  sondes = []
  assign.mockReset()
  vi.stubGlobal("location", { ...window.location, protocol: "https:", assign })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("slugPropose, prefixePropose", () => {
  it("should derive the address and the tool prefix from the name, as the schemas admit them", () => {
    expect(slugPropose("  Société Générale d'Études  ")).toBe("societe-generale-d-etudes")
    expect(prefixePropose("societe-generale-d-etudes")).toBe("societegener")
    expect(prefixePropose("3d-atelier")).toBe("datelier")
  })
})

describe("FormulaireDInscription (AC-12)", () => {
  it("should show the address after a pause of typing, create at the first click and leave for the address once it answers", async () => {
    api({ creations: [creee("atelier.oto.test")] })
    render(<FormulaireDInscription />)
    nomme("Atelier")
    // Un seul champ à l'écran : l'adresse et le préfixe se déduisent du nom, sans champ.
    expect(screen.getAllByRole("textbox")).toHaveLength(1)
    expect(screen.queryByLabelText("Adresse")).toBeNull()
    expect(screen.queryByLabelText("Préfixe des outils")).toBeNull()

    // Sans clic : l'aperçu part seul, et n'écrit rien.
    expect(await screen.findByText("Votre organisation sera servie à atelier.oto.test.")).toBeInTheDocument()
    expect(recus).toEqual([{ name: "Atelier", org: "atelier", prefix: "atelier", confirm: false }])

    fireEvent.click(creer())
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://atelier.oto.test/"))
    expect(recus[1]).toEqual({ name: "Atelier", org: "atelier", prefix: "atelier", confirm: true })
    expect(sondes).toEqual(["https://atelier.oto.test/"])
  })

  it("should create at a click that comes before the preview, without sending the preview", async () => {
    api({ creations: [creee("atelier.oto.test")] })
    render(<FormulaireDInscription />)
    nomme("Atelier")
    fireEvent.click(creer())
    await waitFor(() => expect(assign).toHaveBeenCalled())
    expect(recus).toEqual([{ name: "Atelier", org: "atelier", prefix: "atelier", confirm: true }])
  })

  it("should stay on the page, with its steps and a link, while the new address does not answer", async () => {
    api({ creations: [creee("atelier.oto.test")], repond: false })
    render(<FormulaireDInscription />)
    nomme("Atelier")
    fireEvent.click(creer())
    expect(await screen.findByText("Votre organisation est créée.")).toBeInTheDocument()
    // Le focus est posé par un effet, après le rendu du texte : on l'attend, comme le lecteur d'écran le reçoit.
    await waitFor(() => expect(screen.getByRole("heading", { name: "Votre espace se prépare" })).toHaveFocus())
    expect(screen.getAllByRole("listitem").map((etape) => etape.textContent)).toEqual([
      "Organisation créée (fait)",
      "Adresse réservée (fait)atelier.oto.test",
      "Mise en ligne sécurisée (en cours)Le certificat de votre adresse s'installe.",
    ])
    expect(screen.getByRole("progressbar", { name: "Mise en ligne de votre espace" })).toBeInTheDocument()
    // Aucun lien vers l'adresse tant qu'elle ne répond pas : il mènerait à l'erreur du navigateur.
    expect(screen.queryByRole("link")).toBeNull()
    await waitFor(() => expect(sondes).toHaveLength(1))
    expect(assign).not.toHaveBeenCalled()
  })

  it("should keep a refusal of the preview silent, and say a refusal of the creation in French, the host's abuse check in its own words", async () => {
    const refus = (details: Record<string, unknown>) => () => reponse(403, { error: { code: "forbidden", message: "…", details } })
    api({ apercu: refus({ reason: "signup_refused", text: "Acceptez les conditions." }), creations: [refus({ reason: "email_required" }), refus({ reason: "signup_refused", text: "Captcha invalide." })] })
    render(<FormulaireDInscription />)
    nomme("Atelier")
    await waitFor(() => expect(recus).toHaveLength(1))
    expect(screen.queryByRole("alert")).toBeNull()

    fireEvent.click(creer())
    expect(await screen.findByRole("alert")).toHaveTextContent("L'inscription demande une adresse email vérifiée.")
    fireEvent.click(creer())
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Captcha invalide."))
  })

  it("should ask the host's terms when it gives them, and send them accepted (P5)", async () => {
    api({ creations: [creee("atelier.oto.test")] })
    render(<FormulaireDInscription conditions={{ libelle: "conditions générales", url: "https://oto.test/cgu" }} />)
    nomme("Atelier")
    expect(creer()).toBeDisabled()
    expect(screen.getByRole("link", { name: "conditions générales" })).toHaveAttribute("href", "https://oto.test/cgu")
    fireEvent.click(screen.getByRole("checkbox"))
    fireEvent.click(creer())
    await waitFor(() => expect(assign).toHaveBeenCalled())
    expect(recus).toEqual([{ name: "Atelier", org: "atelier", prefix: "atelier", accepted_terms: true, confirm: true }])
  })

  it("should show no box and send no acceptance without the host's terms", () => {
    render(<FormulaireDInscription />)
    expect(screen.queryByRole("checkbox")).toBeNull()
  })

  it("should give back the address and prefix fields on a conflict at creation, filled with the deduced values, and preview what is typed", async () => {
    api({ creations: [conflit] })
    render(<FormulaireDInscription />)
    nomme("Atelier")
    fireEvent.click(creer())
    expect(await screen.findByRole("alert")).toHaveTextContent("Cette adresse ou ce préfixe est déjà pris : choisissez-en un autre.")
    expect(screen.getByLabelText("Adresse")).toHaveValue("atelier")
    expect(screen.getByLabelText("Préfixe des outils")).toHaveValue("atelier")

    api({ apercu: apercuDe("atelier-nord.oto.test") })
    fireEvent.change(screen.getByLabelText("Adresse"), { target: { value: "atelier-nord" } })
    await screen.findByText("Votre organisation sera servie à atelier-nord.oto.test.")
    // Le préfixe, non touché, suit l'adresse saisie : un préfixe pris se libère du même geste.
    expect(recus.at(-1)).toEqual({ name: "Atelier", org: "atelier-nord", prefix: "ateliernord", confirm: false })
  })

  it("should say a conflict seen by the preview, and give the fields back only when the name field is left", async () => {
    api({ apercu: conflit })
    render(<FormulaireDInscription />)
    const nom = screen.getByLabelText("Nom de l'organisation")
    fireEvent.focus(nom)
    nomme("Atelier")
    expect(await screen.findByRole("alert")).toHaveTextContent("Cette adresse ou ce préfixe est déjà pris : choisissez-en un autre.")
    expect(screen.getAllByRole("textbox")).toHaveLength(1)
    fireEvent.blur(nom)
    expect(screen.getByLabelText("Adresse")).toHaveValue("atelier")
  })

  it("should not judge the name while it is typed, and say a one-letter name is too short when the field is left or Enter is pressed", () => {
    api({})
    render(<FormulaireDInscription />)
    const nom = screen.getByLabelText("Nom de l'organisation")
    const TROP_COURT = "Le nom doit compter au moins 2 caractères."
    nomme("o")
    expect(screen.getAllByRole("textbox")).toHaveLength(1)
    expect(screen.queryByText(TROP_COURT)).toBeNull()
    expect(creer()).toBeDisabled()

    fireEvent.keyDown(nom, { key: "Enter" })
    expect(screen.getByText(TROP_COURT)).toBeInTheDocument()
    expect(screen.getAllByRole("textbox")).toHaveLength(1)

    nomme("ot")
    expect(screen.queryByText(TROP_COURT)).toBeNull()
    fireEvent.blur(nom)
    expect(screen.getAllByRole("textbox")).toHaveLength(1)
    expect(creer()).toBeEnabled()
  })

  it.each([
    ["all digits", "2026"],
    ["non-Latin characters", "東京"],
  ])("should ask for the address and the prefix when nothing valid comes out of a name of %s", (_what, nom) => {
    api({})
    render(<FormulaireDInscription />)
    expect(creer()).toBeDisabled()
    nomme(nom)
    // Le nom n'est jugé qu'à la sortie du champ.
    expect(screen.queryByLabelText("Adresse")).toBeNull()
    fireEvent.blur(screen.getByLabelText("Nom de l'organisation"))
    expect(screen.getByText("Ce nom ne donne pas d'adresse ou de préfixe valide : choisissez-les.")).toBeInTheDocument()
    expect(creer()).toBeDisabled()
    fireEvent.change(screen.getByLabelText("Adresse"), { target: { value: "atelier" } })
    fireEvent.change(screen.getByLabelText("Préfixe des outils"), { target: { value: "atelier" } })
    expect(creer()).toBeEnabled()
  })
})

describe("DepartVersLOrganisation", () => {
  it("should say the last step done and leave once the address answers", async () => {
    api({})
    render(<DepartVersLOrganisation adresse="https://atelier.oto.test/" />)
    expect(await screen.findByText("C'est prêt : ouverture de votre espace.")).toBeInTheDocument()
    expect(screen.getAllByRole("listitem")[2]).toHaveTextContent("Mise en ligne sécurisée (fait)")
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://atelier.oto.test/"))
  })

  it("should stop after two minutes without an answer, say so, and probe again on « Réessayer »", async () => {
    vi.useFakeTimers()
    api({ repond: false })
    render(<DepartVersLOrganisation adresse="https://atelier.oto.test/" />)
    await act(() => vi.advanceTimersByTimeAsync(121_000))
    expect(sondes).toHaveLength(40)
    expect(screen.getByText("La mise en ligne prend plus de temps que prévu. Votre organisation est bien créée.")).toBeInTheDocument()
    expect(screen.queryByRole("progressbar")).toBeNull()
    expect(screen.getByRole("link", { name: "Ouvrir atelier.oto.test" })).toHaveAttribute("href", "https://atelier.oto.test/")

    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }))
    await act(() => vi.advanceTimersByTimeAsync(100))
    expect(sondes).toHaveLength(41)
    expect(screen.getByRole("progressbar")).toBeInTheDocument()
    expect(assign).not.toHaveBeenCalled()
  })
})
