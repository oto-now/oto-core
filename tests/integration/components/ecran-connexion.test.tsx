import type { ReactNode } from "react"
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { EcranConnexion, EcranConnexionChargement, type AdresseDeConnexion, type DerniereConnexion } from "@otomata_tech/oto_platform/ui"
import { connectAddress } from "../../../packages/plateforme/server/connect"
import { identityOf, ORG } from "../../helpers/reference-org"

// L'écran « Brancher mon Claude, ChatGPT ou Mistral » (E02-S04 ; E11-S09, AC-12, AC-13), porté sur le
// design system d'oto-frontend (E05-S09, partie d3), rendu comme la page de l'hôte le monte : adresse de
// `connectAddress`, connexions en `resultat`. Le détail des deux temps est éprouvé par
// `guide-de-branchement.test.tsx`.

const ACME = identityOf("lea", { org: { id: ORG.id, slug: "acme-energies", name: "Acme Énergies", prefix: "acme", brand: {}, domains: null } })
const URL_ACME = "https://acme.example.test/api/mcp"
const ECHEC = "Une erreur est survenue. Réessayez."
const TITRE = "Brancher mon Claude, ChatGPT ou Mistral"

type Props = Parameters<typeof EcranConnexion>[0]

/** Comme la page de l'hôte : les noms anglais du service vers les formes de l'écran. */
function adresseDe(origine: string): AdresseDeConnexion {
  const { url, name, cliName, preferenceSentence } = connectAddress(ACME, origine)
  return { url, nom: name, nomCli: cliName, phrase: preferenceSentence }
}

function LienDeTest({ children, ...props }: { href: string; className?: string; "aria-current"?: "page"; children: ReactNode }) {
  return <a {...props}>{children}</a>
}

function rendre(props: Partial<Props> = {}) {
  // La barre finale de l'origine prouve qu'aucun `/` double n'entre dans l'adresse (AC1).
  return render(<EcranConnexion adresse={adresseDe("https://acme.example.test/")} connexions={{ data: [] }} Lien={LienDeTest} ici="/connect" {...props} />)
}

/** L'îlot du guide, repéré par son premier temps. */
const guide = () => screen.getByText("Ajoutez un connecteur personnalisé").closest("section") ?? document.body
const ligneDEtat = () => screen.queryByRole("list", { name: "Vos connexions" })

function poserLePressePapiers(writeText: (texte: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  // jsdom n'a pas de presse-papiers : celui d'un test ne passe pas au suivant.
  Reflect.deleteProperty(navigator, "clipboard")
})

describe("EcranConnexion address (AC1)", () => {
  it("should show the whole address in code in the guide, copy exactly it, say « Copié » in a region mounted empty, then clear it", async () => {
    vi.useFakeTimers()
    const writeText = vi.fn().mockResolvedValue(undefined)
    poserLePressePapiers(writeText)
    rendre()

    const valeur = screen.getByText(URL_ACME)
    expect(valeur.tagName).toBe("CODE")
    expect(valeur).toHaveClass("break-words")
    const bouton = screen.getByRole("button", { name: "Copier l'adresse du serveur" })
    const statut = within(bouton.closest("dd") ?? document.body).getByRole("status")
    expect(statut).toBeEmptyDOMElement()
    // Le libellé visible est « Copier » ; la cible n'est lue que par le nom accessible, qui commence par lui.
    expect(bouton).toHaveTextContent(/^Copier$/)

    await act(async () => fireEvent.click(bouton))
    expect(writeText).toHaveBeenCalledWith(URL_ACME)
    expect(statut).toHaveTextContent("Copié")

    act(() => vi.advanceTimersByTime(2000))
    expect(statut).toBeEmptyDOMElement()
  })

  it("should say the copy failed when the clipboard refuses it", async () => {
    poserLePressePapiers(vi.fn().mockRejectedValue(new DOMException("Write permission denied.", "NotAllowedError")))
    rendre()

    fireEvent.click(screen.getByRole("button", { name: "Copier l'adresse du serveur" }))

    expect(await screen.findByText("Copie impossible : sélectionnez le texte.")).toHaveAttribute("role", "status")
  })

  it("should build the address of the organisation from the origin of the request", () => {
    expect(connectAddress(ACME, "http://localhost:3000").url).toBe("http://localhost:3000/api/mcp")
  })

  it("should name in the preference sentence the connector by the name the guide copies, never the display name", () => {
    const { cliName, preferenceSentence } = connectAddress(ACME, "https://acme.example.test")

    expect(preferenceSentence).toContain(`du connecteur « ${cliName} »`)
    expect(preferenceSentence).not.toContain("Acme Énergies")
  })
})

describe("EcranConnexion status line (AC7)", () => {
  it("should give one line per assistant family, newest first, in the format of the home, without signature", () => {
    const connexions: DerniereConnexion[] = [
      { famille: "ChatGPT", signature: "openai-mcp@1.0.0", date: "2026-09-24T10:00:00Z" },
      { famille: "Claude", signature: "claude-ai@0.1.0", date: "2026-09-22T08:00:00Z" },
    ]
    rendre({ connexions: { data: connexions } })

    expect(within(ligneDEtat() ?? document.body).getAllByRole("listitem").map((ligne) => ligne.textContent)).toEqual([
      "ChatGPT · dernière connexion le 24 septembre 2026",
      "Claude · dernière connexion le 22 septembre 2026",
    ])
  })

  it("should show no status line before any connection", () => {
    rendre({ connexions: { data: [] } })

    expect(ligneDEtat()).toBeNull()
    expect(screen.queryByText(/dernière connexion|Aucun assistant/)).toBeNull()
  })
})

describe("EcranConnexion states (AC-13)", () => {
  it("should say a failed read of the connections in place of the status line, with « Réessayer » on /connect, the guide intact", () => {
    rendre({ connexions: { error: ECHEC } })

    const alerte = screen.getByRole("alert")
    expect(screen.getAllByRole("alert")).toHaveLength(1)
    expect(alerte).toHaveTextContent(ECHEC)
    expect(within(alerte).getByRole("link", { name: "Réessayer" })).toHaveAttribute("href", "/connect")
    expect(screen.getByText(URL_ACME)).toBeInTheDocument()
  })

  it("should render a busy loading state with a readable label", () => {
    render(<EcranConnexionChargement />)

    const statut = screen.getByRole("status")
    expect(statut).toHaveAttribute("aria-busy", "true")
    expect(statut).toHaveTextContent("Chargement de la page de branchement…")
  })
})

describe("EcranConnexion structure (AC-12)", () => {
  it("should title the page once, then carry the status line and the guide in the same column, and nothing else", () => {
    rendre({ connexions: { data: [{ famille: "Mistral", signature: "mistral@1", date: "2026-09-24T10:00:00Z" }] } })

    expect(screen.getAllByRole("heading", { level: 1 }).map((titre) => titre.textContent)).toEqual([TITRE])
    expect(screen.queryAllByRole("heading", { level: 2 })).toEqual([])
    expect(screen.queryByRole("tablist")).toBeNull()
    const ligne = ligneDEtat()
    const ilot = guide()
    expect(ligne?.parentElement).toBe(ilot.parentElement)
    expect(ligne?.compareDocumentPosition(ilot)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })
})
