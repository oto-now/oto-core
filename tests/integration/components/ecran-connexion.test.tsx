import type { ReactNode } from "react"
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { EcranConnexion, EcranConnexionChargement, type AdresseDeConnexion, type DerniereConnexion } from "@otomata_tech/oto_platform/ui"
import { connectAddress } from "../../../packages/plateforme/server/connect"
import { section } from "../../helpers/ecran"
import { identityOf, ORG } from "../../helpers/reference-org"

// L'écran « Brancher mon Claude, ChatGPT ou Mistral » (E02-S04 ; E11-S09, AC-12, AC-13), porté sur le
// design system d'oto-frontend (E05-S09, partie d3), rendu comme la page de l'hôte le monte : adresse de
// `connectAddress`, exemples et connexions en `resultat`. Le détail des onglets et des étapes est éprouvé par
// `guide-de-branchement.test.tsx`.

// Slug, nom et préfixe distincts : le nom de serveur de Claude Code est le préfixe, et lui seul (AC5).
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
  return render(
    <EcranConnexion adresse={adresseDe("https://acme.example.test/")} prompts={{ data: [] }} connexions={{ data: [] }} Lien={LienDeTest} ici="/connect" {...props} />,
  )
}

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
    const guide = screen.getByRole("tabpanel", { name: "claude.ai" })

    const valeur = within(guide).getByText(URL_ACME)
    expect(valeur.tagName).toBe("CODE")
    expect(valeur).toHaveClass("break-words")
    const bouton = within(guide).getByRole("button", { name: "Copier l'adresse du serveur" })
    const statut = within(bouton.closest("dd") ?? guide).getByRole("status")
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
    const guide = screen.getByRole("tabpanel", { name: "claude.ai" })

    fireEvent.click(within(guide).getByRole("button", { name: "Copier l'adresse du serveur" }))

    expect(await within(guide).findByText("Copie impossible : sélectionnez le texte.")).toHaveAttribute("role", "status")
  })

  it("should build the address of the organisation from the origin of the request", () => {
    expect(connectAddress(ACME, "http://localhost:3000").url).toBe("http://localhost:3000/api/mcp")
  })
})

// Contexte plus court (AC2) : la phrase en quatre lignes, dont la dernière couvre plusieurs Oto ; la note qui
// déconseillait la phrase à qui a plusieurs connecteurs d'organisation part.
describe("EcranConnexion preference sentence", () => {
  it("should copy the four lines of the preference sentence, named after the organisation, with no note against several spaces", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    poserLePressePapiers(writeText)
    rendre()
    const guide = screen.getByRole("tabpanel", { name: "claude.ai" })

    await act(async () => fireEvent.click(within(guide).getByRole("button", { name: "Copier la phrase de préférences" })))
    // Espaces insécables dans les guillemets et avant les deux-points, composés (jamais en littéral).
    const n = String.fromCharCode(160)
    const acme = `«${n}Acme Énergies${n}»`
    expect(writeText).toHaveBeenCalledWith(
      [
        `Au début de chaque conversation, charge le contexte de mon Oto ${acme} avec son outil context.`,
        `Dans ${acme}, tu peux${n}: suivre nos procédures, lire et écrire nos pages et tableaux, utiliser nos connecteurs (emails, comptabilité, CRM…).`,
        `Réflexes${n}: cherche d'abord dans ${acme} avant de répondre de mémoire, de chercher sur le web ou de dire que tu ne peux pas ; suis la procédure trouvée pas à pas.`,
        "Si j'ai plusieurs Oto, charge seulement celui que la demande concerne.",
      ].join("\n"),
    )
    expect(within(guide).queryByText(/plusieurs connecteurs d'organisation/)).toBeNull()
  })
})

describe("EcranConnexion connections (AC7)", () => {
  it("should give one line per assistant family, newest first, with its readable date and signature", () => {
    const connexions: DerniereConnexion[] = [
      { famille: "ChatGPT", signature: "openai-mcp@1.0.0", date: "2026-09-24T10:00:00Z" },
      { famille: "Claude Code", signature: "claude-code@2.1.280", date: "2026-09-23T09:00:00Z" },
      { famille: "claude.ai", signature: "claude-ai@0.1.0", date: "2026-09-22T08:00:00Z" },
      { famille: "Client non identifié", signature: "?@?", date: "2026-09-21T06:00:00Z" },
    ]
    rendre({ connexions: { data: connexions } })

    expect(within(section("Vos connexions")).getAllByRole("listitem").map((ligne) => ligne.textContent)).toEqual([
      "ChatGPT : dernière connexion le 24 septembre 2026 (openai-mcp@1.0.0)",
      "Claude Code : dernière connexion le 23 septembre 2026 (claude-code@2.1.280)",
      "claude.ai : dernière connexion le 22 septembre 2026 (claude-ai@0.1.0)",
      "Client non identifié : dernière connexion le 21 septembre 2026 (?@?)",
    ])
  })

  it("should say that no assistant has connected yet", () => {
    rendre({ connexions: { data: [] } })

    expect(within(section("Vos connexions")).getByText("Aucun assistant ne s'est encore connecté à Acme Énergies avec votre compte.")).toBeInTheDocument()
  })
})

describe("EcranConnexion states (AC-13)", () => {
  it("should say a failed read of the examples in the guide only, with « Réessayer » reading the page again, the guide and the connections intact", () => {
    rendre({ prompts: { error: ECHEC }, connexions: { data: [{ famille: "Claude Code", signature: "claude-code@2.1.280", date: "2026-09-23T09:00:00Z" }] } })

    const guide = screen.getByRole("tabpanel", { name: "Claude Code" })
    expect(screen.getAllByRole("alert")).toHaveLength(1)
    expect(within(guide).getByRole("alert")).toHaveTextContent(ECHEC)
    expect(within(guide).getByRole("button", { name: "Réessayer" })).toBeInTheDocument()
    expect(within(guide).getByRole("button", { name: "Copier la commande d'ajout du serveur" })).toBeInTheDocument()
    expect(within(section("Vos connexions")).getByRole("listitem")).toBeInTheDocument()
  })

  it("should say a failed read of the connections in « Vos connexions » only, with « Réessayer » on /connect, the guide open on claude.ai", () => {
    rendre({ connexions: { error: ECHEC } })

    expect(screen.getAllByRole("alert")).toHaveLength(1)
    expect(within(section("Vos connexions")).getByRole("alert")).toHaveTextContent(ECHEC)
    expect(within(section("Vos connexions")).getByRole("link", { name: "Réessayer" })).toHaveAttribute("href", "/connect")
    expect(within(screen.getByRole("tabpanel", { name: "claude.ai" })).getByText(URL_ACME)).toBeInTheDocument()
  })

  it("should render a busy loading state with a readable label", () => {
    render(<EcranConnexionChargement />)

    const statut = screen.getByRole("status")
    expect(statut).toHaveAttribute("aria-busy", "true")
    expect(statut).toHaveTextContent("Chargement de la page de branchement…")
  })
})

describe("EcranConnexion structure (AC-12)", () => {
  it("should title the page once, then carry the intro and the guide, then « Vos connexions », and nothing else", () => {
    rendre()

    expect(screen.getAllByRole("heading", { level: 1 }).map((titre) => titre.textContent)).toEqual([TITRE])
    const intro = screen.getByText("Ajoutez Acme Énergies à votre assistant : il agira avec votre compte, dans la limite de vos droits.")
    const onglets = screen.getByRole("tablist", { name: "Votre assistant" })
    const connexions = section("Vos connexions")
    expect(intro.closest("section")).toContainElement(onglets)
    expect(intro.closest("section")?.compareDocumentPosition(connexions)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(screen.getAllByRole("heading", { level: 2 }).map((titre) => titre.textContent)).toEqual(["Vos connexions"])
    for (const ancien of ["Adresse du serveur", "Nom du connecteur", "À essayer"]) expect(screen.queryByText(ancien)).toBeNull()
  })
})
