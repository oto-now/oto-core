import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ProfileSheet } from "@otomata_tech/oto_platform/schemas"
import { ContexteDeRafraichissement, EcranProfil, EcranProfilChargement } from "@otomata_tech/oto_platform/ui"
import { choisirDansLaListe, libellesDesChoix } from "../../helpers/liste-de-choix"

// L'écran « Profil » (E05-S11, AC-3) : prénom, nom, langue et couleur de la personne, seuls les champs changés
// envoyés à `PATCH /api/platform/profile` (prénom et nom ensemble), « Enregistrer » désactivé tant que rien ne
// change, refus dit par la table des messages ; les quatre états. `fetch` simulé, relecture espionnée.

const rafraichir = vi.fn()
const corps: unknown[] = []
let reponses: Response[] = []

const FICHE: ProfileSheet = {
  profile: { name: "Léa Roux", first_name: "Léa", last_name: "Roux", language: "fr" },
  organisation: { language: "en", theme: "cobalt" },
}

function ecran(fiche: ProfileSheet = FICHE) {
  return (
    <ContexteDeRafraichissement.Provider value={rafraichir}>
      <EcranProfil resultat={{ data: fiche }} />
    </ContexteDeRafraichissement.Provider>
  )
}

const prenom = () => screen.getByRole("textbox", { name: "Prénom" })
const nom = () => screen.getByRole("textbox", { name: "Nom" })
const langue = () => screen.getByRole("combobox", { name: "Langue" })
const couleur = () => screen.getByRole("group", { name: "Couleur" })
const pastille = (nomDuTheme: string) => within(couleur()).getByRole("button", { name: nomDuTheme })
const enregistrer = () => screen.getByRole("button", { name: "Enregistrer" })

beforeEach(() => {
  corps.length = 0
  reponses = []
  rafraichir.mockReset()
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_adresse: string, init?: RequestInit) => {
      corps.push(JSON.parse(String(init?.body)))
      return reponses.shift() ?? Response.json({ data: {} })
    }),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("EcranProfil (AC-3)", () => {
  it("should prefill the four fields, name the organisation's language, and keep « Enregistrer » disabled until something changes", () => {
    render(ecran())
    expect(screen.getByRole("heading", { level: 1, name: "Profil" })).toBeInTheDocument()
    expect(prenom()).toHaveValue("Léa")
    expect(nom()).toHaveValue("Roux")
    expect(langue()).toHaveValue("fr")
    expect(libellesDesChoix(langue())).toEqual(["Celle de l'organisation (English)", "Français", "English"])
    expect(screen.getByText("La langue dans laquelle l'assistant vous répond. Les écrans restent en français.")).toBeInTheDocument()
    // Sans couleur choisie, « Celle de l'organisation » est pressé ; puis les huit thèmes, nommés.
    expect(within(couleur()).getAllByRole("button").map((bouton) => [bouton.getAttribute("aria-label") ?? bouton.textContent, bouton.getAttribute("aria-pressed")])).toEqual([
      ["Celle de l'organisation", "true"],
      ["Manuscrit", "false"],
      ["Ardoise", "false"],
      ["Grenat", "false"],
      ["Brique", "false"],
      ["Forêt", "false"],
      ["Lagune", "false"],
      ["Cobalt", "false"],
      ["Violet", "false"],
    ])
    expect(enregistrer()).toBeDisabled()
    // Le `handle` fonde `private/<handle>` : aucun champ ne l'écrit.
    expect(screen.getAllByRole("textbox")).toEqual([prenom(), nom()])
  })

  it("should send only the changed field, then say it, give the focus to the title and reread the page", async () => {
    render(ecran())
    choisirDansLaListe(langue(), "English")
    await waitFor(() => expect(enregistrer()).toBeEnabled())
    fireEvent.click(enregistrer())
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Profil enregistré."))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Vous" })))
    expect(corps).toEqual([{ language: "en" }])
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("/api/platform/profile")
    expect(vi.mocked(fetch).mock.calls[0][1]?.method).toBe("PATCH")
    expect(rafraichir).toHaveBeenCalledTimes(1)
    expect(enregistrer()).toBeDisabled()
  })

  it("should send the first and the last name together when one changes, a chosen theme, and the organisation's as an empty string", async () => {
    render(ecran({ ...FICHE, profile: { ...FICHE.profile, theme: "foret" } }))
    expect(pastille("Forêt")).toHaveAttribute("aria-pressed", "true")
    fireEvent.change(nom(), { target: { value: "Martin" } })
    fireEvent.click(pastille("Lagune"))
    expect(pastille("Lagune")).toHaveAttribute("aria-pressed", "true")
    expect(pastille("Forêt")).toHaveAttribute("aria-pressed", "false")
    await waitFor(() => expect(enregistrer()).toBeEnabled())
    fireEvent.click(enregistrer())
    await waitFor(() => expect(corps).toHaveLength(1))
    expect(corps[0]).toEqual({ first_name: "Léa", last_name: "Martin", theme: "lagune" })

    await waitFor(() => expect(enregistrer()).toBeDisabled())
    fireEvent.click(within(couleur()).getByRole("button", { name: "Celle de l'organisation" }))
    await waitFor(() => expect(enregistrer()).toBeEnabled())
    fireEvent.click(enregistrer())
    await waitFor(() => expect(corps).toHaveLength(2))
    expect(corps[1]).toEqual({ theme: "" })
  })

  // Une fiche écrite avant E05-S11 n'a que son nom : il va entier dans « Prénom », jamais coupé au premier espace.
  it("should put the whole name of a profile without first and last names into the first name", () => {
    render(ecran({ ...FICHE, profile: { name: "Léa Roux" } }))
    expect(prenom()).toHaveValue("Léa Roux")
    expect(nom()).toHaveValue("")
    expect(langue()).toHaveValue("")
  })

  it("should check the bound before sending, and say a refusal from the message table, keeping the input", async () => {
    const { rerender } = render(ecran())
    fireEvent.change(prenom(), { target: { value: "x".repeat(81) } })
    await waitFor(() => expect(enregistrer()).toBeEnabled())
    fireEvent.click(enregistrer())
    await waitFor(() => expect(prenom()).toHaveAccessibleDescription("80 caractères au plus."))
    expect(corps).toEqual([])

    reponses.push(Response.json({ error: { code: "invalid_arguments", message: "Some values are invalid." } }, { status: 400 }))
    fireEvent.change(prenom(), { target: { value: "Léa-Marie" } })
    fireEvent.click(enregistrer())
    expect(await screen.findByRole("alert")).toHaveTextContent("Certaines valeurs sont invalides.")
    // Le prénom seul a changé : il part avec le nom, jamais le nom seul (HN-E05S11-2).
    expect(corps).toEqual([{ first_name: "Léa-Marie", last_name: "Roux" }])
    expect(prenom()).toHaveValue("Léa-Marie")
    expect(rafraichir).not.toHaveBeenCalled()

    // L'îlot survit à la relecture : une fiche nouvelle remet ses champs à ce qu'elle sert (`portage-ecrans.md § 2`).
    rerender(ecran({ ...FICHE, profile: { name: "Noé Petit", first_name: "Noé", last_name: "Petit", language: "en", theme: "ardoise" } }))
    await waitFor(() => expect(prenom()).toHaveValue("Noé"))
    expect(nom()).toHaveValue("Petit")
    expect(langue()).toHaveValue("en")
    expect(pastille("Ardoise")).toHaveAttribute("aria-pressed", "true")
    expect(within(couleur()).getByRole("button", { name: "Celle de l'organisation" })).toHaveAttribute("aria-pressed", "false")
  })

  it("should say a failed read with « Réessayer », and render its loading state", () => {
    const { unmount } = render(<EcranProfil resultat={{ error: "Seuls les membres de l'organisation ont un profil ici." }} />)
    const alerte = screen.getByRole("alert")
    expect(alerte).toHaveTextContent("Seuls les membres de l'organisation ont un profil ici.")
    expect(within(alerte).getByRole("button", { name: "Réessayer" })).toBeInTheDocument()
    expect(screen.queryByRole("textbox")).toBeNull()
    unmount()

    render(<EcranProfilChargement />)
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true")
    expect(screen.getByRole("status")).toHaveTextContent("Chargement de votre profil")
  })
})
