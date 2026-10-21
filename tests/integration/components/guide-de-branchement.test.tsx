// Le guide de branchement (E11-S09, AC-1 à AC-8) : un onglet par assistant, ses étapes, ses copies, ses
// liens et les demandes à essayer. Monté seul, comme la fenêtre de l'accueil et la page `/connect` le
// montent ; les textes viennent des constantes de `ui/connexion/libelles.ts`, plus un texte en dur par
// onglet, qui retient la constante de dériver.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { AdresseDeConnexion, DerniereConnexion } from "@otomata_tech/oto_platform/ui"
import { GuideDeBranchement } from "../../../packages/plateforme/ui/connexion/guide-de-branchement"
import { ASSISTANTS, ETAPES, EXEMPLES_GENERIQUES, type Assistant } from "../../../packages/plateforme/ui/connexion/libelles"

// Nom et préfixe distincts : Mistral et Claude Code prennent le préfixe, jamais le nom (AC-5, AC-6).
const ADRESSE: AdresseDeConnexion = {
  url: "https://acme.example.test/api/mcp",
  nom: "Acme Énergies",
  nomCli: "acme",
  phrase: "Au début de chaque conversation, appelle une fois l'outil de contexte du connecteur « Acme Énergies » : il porte mes consignes. Utilise ensuite ses autres outils seulement quand la demande concerne mon travail (mes pages, mes procédures, mes données).",
}
const ECHEC = "Une erreur est survenue. Réessayez."

type Props = Parameters<typeof GuideDeBranchement>[0]

const connexion = (famille: string): DerniereConnexion => ({ famille, signature: `${famille}@1.0`, date: "2026-09-24T09:00:00Z" })

function monter(props: Partial<Props> = {}) {
  render(<GuideDeBranchement adresse={ADRESSE} exemples={{ data: [] }} connexions={{ data: [] }} {...props} />)
}

function ouvrir(assistant: Assistant) {
  fireEvent.click(screen.getByRole("tab", { name: assistant }))
  return screen.getByRole("tabpanel", { name: assistant })
}

/** Les étapes du panneau : la phrase de tête de chacune, sans les listes qu'elle porte. */
const etapes = (panneau: HTMLElement) => [...panneau.querySelectorAll(":scope ol > li")].map((etape) => etape.querySelector("p")?.textContent)

/** Ce que dit chaque étape, lu des constantes : « C'est branché. » en tête de la dernière. */
const attendues = (assistant: Assistant) =>
  ETAPES[assistant].map((etape) => `${etape.branche ? "C'est branché. " : ""}${etape.texte(ADRESSE).map((segment) => (typeof segment === "string" ? segment : segment.code)).join("")}`)

function poserLePressePapiers() {
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })
  return writeText
}

afterEach(() => {
  cleanup()
  // jsdom n'a pas de presse-papiers : celui d'un test ne passe pas au suivant.
  Reflect.deleteProperty(navigator, "clipboard")
})

describe("GuideDeBranchement tabs (AC-1)", () => {
  it("should carry four tabs in a named tablist, one panel named by its tab, only the chosen tab in the tab order, arrows, Home, End and a click choosing", () => {
    monter()

    const barre = screen.getByRole("tablist", { name: "Votre assistant" })
    const onglets = within(barre).getAllByRole("tab")
    expect(onglets.map((onglet) => onglet.textContent)).toEqual(["claude.ai", "ChatGPT", "Mistral", "Claude Code"])
    const choisi = () => [onglets.map((onglet) => onglet.getAttribute("aria-selected")).indexOf("true"), onglets.map((onglet) => onglet.tabIndex)]
    expect(choisi()).toEqual([0, [0, -1, -1, -1]])
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1)
    expect(screen.getByRole("tabpanel", { name: "claude.ai" })).toHaveAttribute("id", onglets[0].getAttribute("aria-controls"))

    onglets[0].focus()
    fireEvent.keyDown(onglets[0], { key: "ArrowRight" })
    expect(document.activeElement).toBe(onglets[1])
    expect(choisi()).toEqual([1, [-1, 0, -1, -1]])
    expect(screen.getByRole("tabpanel", { name: "ChatGPT" })).toBeInTheDocument()
    fireEvent.keyDown(onglets[1], { key: "End" })
    expect(document.activeElement).toBe(onglets[3])
    fireEvent.keyDown(onglets[3], { key: "ArrowRight" })
    expect(document.activeElement).toBe(onglets[0])
    fireEvent.keyDown(onglets[0], { key: "ArrowLeft" })
    expect(document.activeElement).toBe(onglets[3])
    fireEvent.keyDown(onglets[3], { key: "Home" })
    expect(document.activeElement).toBe(onglets[0])
    expect(choisi()[0]).toBe(0)

    fireEvent.click(onglets[2])
    expect(choisi()[0]).toBe(2)
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1)
    expect(screen.getByRole("tabpanel", { name: "Mistral" })).toBeInTheDocument()
  })
})

describe("GuideDeBranchement first tab (AC-2)", () => {
  it("should open on the tab of the latest family, claude.ai without a known one", () => {
    const cas: [string, Props["connexions"], Assistant][] = [
      ["ChatGPT", { data: [connexion("ChatGPT"), connexion("claude.ai")] }, "ChatGPT"],
      ["Mistral", { data: [connexion("Mistral"), connexion("claude.ai")] }, "Mistral"],
      ["Claude Code", { data: [connexion("Claude Code"), connexion("ChatGPT")] }, "Claude Code"],
      ["no connection", { data: [] }, "claude.ai"],
      ["an unknown family", { data: [connexion("Client non identifié"), connexion("ChatGPT")] }, "claude.ai"],
      ["a failed read", { error: ECHEC }, "claude.ai"],
    ]
    const verdicts = Object.fromEntries(
      cas.map(([nom, connexions]) => {
        monter({ connexions })
        const choisi = screen.getByRole("tab", { selected: true }).textContent
        cleanup()
        return [nom, choisi]
      }),
    )
    expect(verdicts).toEqual(Object.fromEntries(cas.map(([nom, , onglet]) => [nom, onglet])))
  })
})

describe("GuideDeBranchement steps (AC-3 to AC-6)", () => {
  it("should list the steps of each assistant in order, as written, the last one saying it is plugged in", () => {
    const cas: [Assistant, number, string][] = [
      ["claude.ai", 5, "Dans claude.ai, ouvrez Paramètres → Connecteurs, puis ajoutez un connecteur personnalisé."],
      ["ChatGPT", 5, "Dans ChatGPT, ouvrez Paramètres → Applications → Paramètres avancés, puis activez le mode développeur."],
      ["Mistral", 4, "Dans Le Chat, ouvrez Connecteurs, cliquez sur « Ajouter un connecteur », puis choisissez l'onglet « Connecteur MCP personnalisé »."],
      ["Claude Code", 3, "Dans un terminal, ajoutez le serveur :"],
    ]
    monter()

    const verdicts = Object.fromEntries(
      cas.map(([assistant]) => {
        const panneau = ouvrir(assistant)
        const lues = etapes(panneau)
        const fort = panneau.querySelector("ol > li:last-child strong")?.textContent?.trim()
        return [assistant, { nombre: lues.length, lues, premiere: lues[0], branche: lues.at(-1)?.startsWith("C'est branché. "), fort }]
      }),
    )
    expect(verdicts).toEqual(
      Object.fromEntries(cas.map(([assistant, nombre, premiere]) => [assistant, { nombre, lues: attendues(assistant), premiere, branche: true, fort: "C'est branché." }])),
    )
  })

  it("should give claude.ai no refresh step, its two fields as a definition list, each whole value in code with its copy, and the preference sentence (AC-3)", async () => {
    const writeText = poserLePressePapiers()
    monter()

    const panneau = ouvrir("claude.ai")
    expect(panneau).not.toHaveTextContent("Actualiser la liste d'outils")
    const champs = panneau.querySelector("ol > li:nth-child(2) dl")
    if (!(champs instanceof HTMLElement)) throw new Error("champs absents")
    expect([...champs.querySelectorAll("dt")].map((terme) => terme.textContent)).toEqual(["Nom", "Adresse"])
    expect([...champs.querySelectorAll("dd code")].map((valeur) => valeur.textContent)).toEqual([ADRESSE.nom, ADRESSE.url])
    await act(async () => fireEvent.click(within(champs).getByRole("button", { name: "Copier le nom du connecteur" })))
    await act(async () => fireEvent.click(within(champs).getByRole("button", { name: "Copier l'adresse du serveur" })))
    await act(async () => fireEvent.click(within(panneau).getByRole("button", { name: "Copier la phrase de préférences" })))
    expect(writeText.mock.calls).toEqual([[ADRESSE.nom], [ADRESSE.url], [ADRESSE.phrase]])
  })

  it("should name the Mistral connector by the prefix, never the name (AC-5)", async () => {
    const writeText = poserLePressePapiers()
    monter()

    const panneau = ouvrir("Mistral")
    expect([...panneau.querySelectorAll("dd code")].map((valeur) => valeur.textContent)).toEqual([ADRESSE.nomCli, ADRESSE.url])
    await act(async () => fireEvent.click(within(panneau).getByRole("button", { name: "Copier le nom du connecteur" })))
    expect(writeText).toHaveBeenCalledWith("acme")
  })

  it("should copy exactly the two Claude Code commands (AC-6)", async () => {
    const writeText = poserLePressePapiers()
    monter()

    const panneau = ouvrir("Claude Code")
    await act(async () => fireEvent.click(within(panneau).getByRole("button", { name: "Copier la commande d'ajout du serveur" })))
    await act(async () => fireEvent.click(within(panneau).getByRole("button", { name: "Copier la commande de connexion" })))
    expect(writeText.mock.calls).toEqual([["claude mcp add --transport http acme https://acme.example.test/api/mcp"], ["claude mcp login acme"]])
  })
})

describe("GuideDeBranchement requests to try (AC-7)", () => {
  const titres = (nombre: number) => ["Qualifier un prospect", "Relancer les devis", "Préparer un rendez-vous", "Clore le mois"].slice(0, nombre).map((titre) => ({ titre }))
  const demandes = (panneau: HTMLElement) => [...panneau.querySelectorAll("ol > li:last-child ul code")].map((code) => code.textContent)

  it("should give three requests to copy in the last step of every tab, procedures first, then generic ones", () => {
    const cas: [string, Props["exemples"], string[]][] = [
      ["four procedures", { data: titres(4) }, ["Qualifier un prospect", "Relancer les devis", "Préparer un rendez-vous"]],
      ["one procedure", { data: titres(1) }, ["Qualifier un prospect", ...EXEMPLES_GENERIQUES.slice(0, 2)]],
      ["no procedure", { data: [] }, ["Qu'est-ce que je peux te demander ici ?", "Quelles procédures puis-je lancer ?", "Résume ce qui a changé cette semaine."]],
    ]
    const verdicts = Object.fromEntries(
      cas.map(([nom, exemples, attendu]) => {
        monter({ exemples })
        const lues = ASSISTANTS.map((assistant) => {
          const panneau = ouvrir(assistant)
          return { demandes: demandes(panneau), copie: within(panneau).queryByRole("button", { name: `Copier la demande « ${attendu[0]} »` }) !== null }
        })
        cleanup()
        return [nom, lues]
      }),
    )
    expect(verdicts).toEqual(Object.fromEntries(cas.map(([nom, , attendu]) => [nom, ASSISTANTS.map(() => ({ demandes: attendu, copie: true }))])))
  })

  it("should say a failed read in place of the requests, with « Réessayer », the rest of the guide intact", () => {
    monter({ exemples: { error: ECHEC } })

    const panneau = ouvrir("claude.ai")
    expect(within(panneau).getByRole("alert")).toHaveTextContent(ECHEC)
    expect(within(panneau).getByRole("button", { name: "Réessayer" })).toBeInTheDocument()
    expect(etapes(panneau)).toEqual(attendues("claude.ai"))
    expect(within(panneau).getByRole("button", { name: "Copier l'adresse du serveur" })).toBeInTheDocument()
  })
})

describe("GuideDeBranchement links (AC-8)", () => {
  it.each<[Assistant, string, string]>([
    ["claude.ai", "Ouvrir les connecteurs de claude.ai (nouvel onglet)", "https://claude.ai/customize/connectors"],
    ["ChatGPT", "Ouvrir les paramètres de ChatGPT (nouvel onglet)", "https://chatgpt.com/#settings/Connectors"],
    ["Mistral", "Ouvrir les connecteurs de Le Chat (nouvel onglet)", "https://chat.mistral.ai/connections"],
  ])("should link %s in its first step to its page, in a new tab", (assistant, nom, href) => {
    monter()

    const panneau = ouvrir(assistant)
    const lien = within(panneau).getByRole("link", { name: nom })
    expect(panneau.querySelector("ol > li:first-child")).toContainElement(lien)
    expect(lien).toHaveAttribute("href", href)
    expect(lien).toHaveAttribute("target", "_blank")
    expect(lien).toHaveAttribute("rel", "noopener noreferrer")
  })

  it("should give Claude Code no link", () => {
    monter()

    expect(within(ouvrir("Claude Code")).queryByRole("link")).toBeNull()
  })
})
