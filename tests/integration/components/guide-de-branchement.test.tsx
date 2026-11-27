// Le guide de branchement (E11-S09) : deux temps, les mêmes pour tous les assistants, leurs copies et
// leurs liens directs. Monté seul, comme la fenêtre de l'accueil et la page `/connect` le montent ; les
// textes sont écrits en dur, ce qui retient les constantes de `ui/connexion/libelles.ts` de dériver.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { AdresseDeConnexion } from "@otomata_tech/oto_platform/ui"
import { GuideDeBranchement } from "../../../packages/plateforme/ui/connexion/guide-de-branchement"

// Nom et préfixe distincts : le connecteur prend le préfixe, sans espace, jamais le nom.
const ADRESSE: AdresseDeConnexion = {
  url: "https://acme.example.test/api/mcp",
  nom: "Acme Énergies",
  nomCli: "acme",
  phrase: "Au début de chaque conversation, appelle une fois l'outil de contexte du connecteur « acme ».",
}
const CONNECTEUR = "Ajoutez un connecteur personnalisé"
const PREFERENCES = "Collez cette phrase dans vos préférences personnelles"

function monter() {
  render(<GuideDeBranchement adresse={ADRESSE} />)
}

/** Les deux temps, chacun par sa phrase de tête. */
function temps() {
  const items = [...document.querySelectorAll<HTMLElement>("ol > li")]
  return Object.fromEntries(items.map((item) => [item.querySelector("p")?.textContent ?? "", item]))
}

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

describe("GuideDeBranchement two times", () => {
  it("should carry two times in order, without tabs, Claude Code, requests to try nor intro", () => {
    monter()

    expect(screen.queryByRole("tablist")).toBeNull()
    expect(Object.keys(temps())).toEqual([CONNECTEUR, PREFERENCES])
    expect(document.body).not.toHaveTextContent(/Claude Code|claude mcp|C'est branché|Autoriser|Rechargez|Ajoutez Acme/)
  })

  it("should give one name without space and the address with their copies, then the ChatGPT line, in the first time", async () => {
    const writeText = poserLePressePapiers()
    monter()

    const premier = temps()[CONNECTEUR]
    expect([...premier.querySelectorAll("dt")].map((terme) => terme.textContent)).toEqual(["Nom", "Adresse"])
    expect([...premier.querySelectorAll("dd code")].map((valeur) => valeur.textContent)).toEqual([ADRESSE.nomCli, ADRESSE.url])
    await act(async () => fireEvent.click(within(premier).getByRole("button", { name: "Copier le nom du connecteur" })))
    await act(async () => fireEvent.click(within(premier).getByRole("button", { name: "Copier l'adresse du serveur" })))
    expect(writeText.mock.calls).toEqual([[ADRESSE.nomCli], [ADRESSE.url]])
    expect(within(premier).getByText("ChatGPT : mode développeur requis (offres payantes), puis « Actualiser » sur la fiche de l'application.")).toBeInTheDocument()
  })

  it("should give the preference sentence with its copy in the second time", async () => {
    const writeText = poserLePressePapiers()
    monter()

    const second = temps()[PREFERENCES]
    await act(async () => fireEvent.click(within(second).getByRole("button", { name: "Copier la phrase de préférences" })))
    expect(writeText).toHaveBeenCalledWith(ADRESSE.phrase)
  })
})

describe("GuideDeBranchement links (AC-8)", () => {
  it("should give the first time three direct links, Claude, ChatGPT and Mistral, each in a new tab, and the second none", () => {
    monter()

    const lus = Object.fromEntries(
      Object.entries(temps()).map(([tete, item]) => [
        tete,
        within(item)
          .queryAllByRole("link")
          .map((lien) => [lien.textContent, lien.getAttribute("href"), lien.getAttribute("target"), lien.getAttribute("rel")]),
      ]),
    )
    const enOnglet = (assistant: string, href: string) => [`${assistant} (nouvel onglet)`, href, "_blank", "noopener noreferrer"]
    expect(lus).toEqual({
      [CONNECTEUR]: [
        enOnglet("Claude", "https://claude.ai/plugins?filter=connectors-only"),
        enOnglet("ChatGPT", "https://chatgpt.com/plugins?directoryTab=personal"),
        enOnglet("Mistral", "https://chat.mistral.ai/connections"),
      ],
      [PREFERENCES]: [],
    })
  })
})
