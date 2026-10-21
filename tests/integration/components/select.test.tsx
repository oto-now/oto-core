// La liste de choix du design system (E05-S11 lot f, retour 8 ; AC-19, AC-20) : un déclencheur arrondi qui
// ouvre un popover de choix au clavier comme à la souris, jamais un `<select>` natif ; la valeur part avec un
// formulaire GET comme avec React Hook Form ; dans un panneau (« Partager »), la liste vit dans le panneau.
// Les écrans qui la montent gardent leurs tests (partage, déplacement, journal, profil…).
import { useEffect } from "react"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { useForm } from "react-hook-form"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { AccessPanel } from "../../../packages/plateforme/ui/ds/react/access-panel"
import { Dialog } from "../../../packages/plateforme/ui/ds/react/dialog"
import { Field } from "../../../packages/plateforme/ui/ds/react/forms"
import { Popover } from "../../../packages/plateforme/ui/ds/react/popover"
import { Select } from "../../../packages/plateforme/ui/ds/react/select"
import { simulerLesDialogues } from "../../helpers/dialogue"
import { choisirDansLaListe, listeDe } from "../../helpers/liste-de-choix"

const NIVEAUX = [
  { value: "manage", label: "Accès complet" },
  { value: "write", label: "Peut modifier" },
  { value: "read", label: "Peut lire" },
  { value: "none", label: "Retirer", disabled: true },
]

const niveau = () => screen.getByRole("combobox", { name: "Niveau" })
const surlignee = () => document.getElementById(niveau().getAttribute("aria-activedescendant") ?? "")?.textContent

function FormulaireGet({ defaut = "write", options = NIVEAUX }: { defaut?: string; options?: typeof NIVEAUX }) {
  return (
    <form aria-label="Filtrer">
      <Field label="Niveau">
        <Select name="niveau" defaultValue={defaut} options={options} />
      </Field>
    </form>
  )
}

const envoi = () => [...new FormData(screen.getByRole<HTMLFormElement>("form", { name: "Filtrer" })).entries()]

beforeAll(simulerLesDialogues)
afterEach(cleanup)

describe("Select, a list of choices in a popover (AC-19)", () => {
  it("should render a rounded combobox, never a native select, opening a listbox where the current choice is selected", () => {
    const { container } = render(<FormulaireGet />)
    expect(container.querySelector("select")).toBeNull()
    expect(niveau()).toHaveClass("oto-scope")
    expect(niveau()).toHaveAttribute("aria-haspopup", "listbox")
    expect(niveau()).toHaveAttribute("aria-expanded", "false")
    expect(niveau()).toHaveTextContent("Peut modifier")

    fireEvent.click(niveau())
    expect(niveau()).toHaveAttribute("aria-expanded", "true")
    const liste = within(listeDe(niveau()))
    expect(liste.getAllByRole("option").map((option) => option.textContent)).toEqual(["Accès complet", "Peut modifier", "Peut lire", "Retirer"])
    expect(liste.getByRole("option", { selected: true })).toHaveTextContent("Peut modifier")
    expect(liste.getByRole("option", { name: "Retirer" })).toHaveAttribute("aria-disabled", "true")
  })

  it("should move with the arrows, Home, End and the initial, skip a disabled choice, choose on Enter or Space and close on Escape, the focus kept on the trigger", () => {
    render(<FormulaireGet />)
    niveau().focus()
    fireEvent.keyDown(niveau(), { key: "ArrowDown" })
    expect(surlignee()).toBe("Peut modifier")
    fireEvent.keyDown(niveau(), { key: "ArrowDown" })
    expect(surlignee()).toBe("Peut lire")
    // « Retirer » est hors d'atteinte : la flèche reste sur « Peut lire », Fin aussi.
    fireEvent.keyDown(niveau(), { key: "ArrowDown" })
    expect(surlignee()).toBe("Peut lire")
    fireEvent.keyDown(niveau(), { key: "Home" })
    expect(surlignee()).toBe("Accès complet")
    fireEvent.keyDown(niveau(), { key: "End" })
    expect(surlignee()).toBe("Peut lire")
    fireEvent.keyDown(niveau(), { key: "a" })
    expect(surlignee()).toBe("Accès complet")
    fireEvent.keyDown(niveau(), { key: "Enter" })
    expect(niveau()).toHaveAttribute("aria-expanded", "false")
    expect(niveau()).toHaveValue("manage")
    expect(niveau()).toHaveFocus()

    fireEvent.keyDown(niveau(), { key: " " })
    fireEvent.keyDown(niveau(), { key: "ArrowDown" })
    fireEvent.keyDown(niveau(), { key: " " })
    expect(niveau()).toHaveValue("write")

    fireEvent.keyDown(niveau(), { key: "p" })
    expect(niveau()).toHaveAttribute("aria-expanded", "true")
    expect(surlignee()).toBe("Peut lire")
    fireEvent.keyDown(niveau(), { key: "Escape" })
    expect(niveau()).toHaveAttribute("aria-expanded", "false")
    expect(niveau()).toHaveValue("write")
    expect(niveau()).toHaveFocus()

    // Survolée, une option désactivée ne prend pas la ligne surlignée, qu'Entrée choisirait.
    fireEvent.click(niveau())
    fireEvent.mouseEnter(within(listeDe(niveau())).getByRole("option", { name: "Retirer" }))
    expect(surlignee()).toBe("Peut modifier")
  })

  it("should close without choosing on Tab (HN-E05S11-f3)", () => {
    const changer = vi.fn()
    render(<Select aria-label="Niveau" value="write" options={NIVEAUX} onChange={changer} />)
    fireEvent.click(niveau())
    fireEvent.keyDown(niveau(), { key: "ArrowDown" })
    fireEvent.keyDown(niveau(), { key: "Tab" })
    expect(niveau()).toHaveAttribute("aria-expanded", "false")
    expect(changer).not.toHaveBeenCalled()
  })

  it("should close only the list on Escape inside a modal dialog, the dialog's cancel prevented", () => {
    const fermer = vi.fn()
    render(
      <Dialog open onClose={fermer} title="Responsable">
        <Select aria-label="Niveau" defaultValue="write" options={NIVEAUX} />
      </Dialog>,
    )
    fireEvent.click(niveau())
    expect(screen.getByRole("dialog", { name: "Responsable" })).toContainElement(listeDe(niveau()))
    // Le navigateur annule un `<dialog>` modal par l'action par défaut d'Échap : l'empêcher le garde ouvert.
    expect(fireEvent.keyDown(niveau(), { key: "Escape" })).toBe(false)
    expect(niveau()).toHaveAttribute("aria-expanded", "false")
    expect(fermer).not.toHaveBeenCalled()
  })

  it("should close only the list on Escape inside a panel that listens on the document, such as a column filter", () => {
    render(
      <Popover aria-label="Filtrer sur statut" trigger={<button type="button">Filtrer</button>}>
        <Select aria-label="Niveau" defaultValue="write" options={NIVEAUX} />
      </Popover>,
    )
    fireEvent.click(screen.getByRole("button", { name: "Filtrer" }))
    fireEvent.click(niveau())
    fireEvent.keyDown(niveau(), { key: "Escape" })
    expect(niveau()).toHaveAttribute("aria-expanded", "false")
    expect(screen.getByRole("dialog", { name: "Filtrer sur statut" })).toBeInTheDocument()
  })
})

describe("Select in a form (AC-20)", () => {
  it("should send the choice with a GET form", () => {
    render(<FormulaireGet />)
    choisirDansLaListe(niveau(), "Peut lire")
    expect(envoi()).toEqual([["niveau", "read"]])
  })

  it("should show and send the first available choice when the value names no choice, as a native list does", () => {
    // Une adresse périmée (`?team=<équipe supprimée>`), puis une relecture qui retire le choix courant.
    const { rerender } = render(<FormulaireGet defaut="supprimee" options={[NIVEAUX[3], ...NIVEAUX.slice(0, 3)]} />)
    expect(niveau()).toHaveTextContent("Accès complet")
    expect(envoi()).toEqual([["niveau", "manage"]])
    choisirDansLaListe(niveau(), "Peut lire")
    rerender(<FormulaireGet defaut="supprimee" options={NIVEAUX.filter((option) => option.value !== "read")} />)
    expect(niveau()).toHaveTextContent("Accès complet")
    expect(envoi()).toEqual([["niveau", "manage"]])
  })

  it("should leave the controlled value in the form when the parent refuses the choice", () => {
    const changer = vi.fn()
    render(
      <form aria-label="Filtrer">
        <Select aria-label="Niveau" name="niveau" value="write" options={NIVEAUX} onChange={(evenement) => changer(evenement.target.value)} />
      </form>,
    )
    // Deux fois : le second refus ne rend plus rien, qui remettrait l'entrée à la valeur tenue par le parent.
    choisirDansLaListe(niveau(), "Peut lire")
    choisirDansLaListe(niveau(), "Peut lire")
    expect(changer.mock.calls).toEqual([["read"], ["read"]])
    expect(envoi()).toEqual([["niveau", "write"]])
  })

  it("should give React Hook Form the chosen value, take the focus of a refused choice, and show the value it writes back", async () => {
    const envoye = vi.fn()
    function Formulaire({ remis }: { remis?: string }) {
      const form = useForm({ defaultValues: { niveau: "write" } })
      useEffect(() => {
        if (remis) form.reset({ niveau: remis })
      }, [remis, form])
      return (
        <form onSubmit={(evenement) => void form.handleSubmit(envoye)(evenement)}>
          <Field label="Niveau">
            <Select options={NIVEAUX} {...form.register("niveau", { validate: (valeur) => valeur !== "write" || "Choisissez un autre niveau." })} />
          </Field>
          <button type="submit">Enregistrer</button>
        </form>
      )
    }
    const { rerender } = render(<Formulaire />)
    expect(niveau()).toHaveTextContent("Peut modifier")
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }))
    await waitFor(() => expect(niveau()).toHaveFocus())
    expect(envoye).not.toHaveBeenCalled()
    choisirDansLaListe(niveau(), "Peut lire")
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }))
    await waitFor(() => expect(envoye).toHaveBeenCalledTimes(1))
    expect(envoye.mock.calls[0][0]).toEqual({ niveau: "read" })

    rerender(<Formulaire remis="manage" />)
    await waitFor(() => expect(niveau()).toHaveTextContent("Accès complet"))
    expect(niveau()).toHaveValue("manage")
  })

  it("should open and choose inside « Partager » without closing the panel, Escape closing the list first, then the panel", () => {
    const changer = vi.fn()
    render(<AccessPanel scope="Partager · Ventes" panelLabel="Partager — Ventes" panel={<Select aria-label="Niveau" value="write" options={NIVEAUX} onChange={(evenement) => changer(evenement.target.value)} />} />)
    fireEvent.click(screen.getByRole("button", { name: "Partager · Ventes" }))
    const panneau = screen.getByRole("dialog", { name: "Partager — Ventes" })
    fireEvent.click(niveau())
    expect(panneau).toContainElement(listeDe(niveau()))

    const option = within(listeDe(niveau())).getByRole("option", { name: "Peut lire" })
    fireEvent.pointerDown(option)
    fireEvent.click(option)
    expect(changer).toHaveBeenCalledWith("read")
    expect(screen.getByRole("dialog", { name: "Partager — Ventes" })).toBeInTheDocument()

    fireEvent.click(niveau())
    fireEvent.keyDown(niveau(), { key: "Escape" })
    expect(niveau()).toHaveAttribute("aria-expanded", "false")
    expect(screen.getByRole("dialog", { name: "Partager — Ventes" })).toBeInTheDocument()
    fireEvent.keyDown(niveau(), { key: "Escape" })
    expect(screen.queryByRole("dialog", { name: "Partager — Ventes" })).toBeNull()
  })
})
