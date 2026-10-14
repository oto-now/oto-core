import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { BlockView } from "@otomata_tech/oto_platform/schemas"
import { ContexteDeRafraichissement } from "@otomata_tech/oto_platform/ui"
import { EditeurDeBlocs } from "../../../packages/plateforme/ui/noeud/editeur/editeur-de-blocs"
import { FileDOperations } from "../../../packages/plateforme/ui/noeud/editeur/file-d-operations"
import { ouvrirLeChamp, texteDuBloc } from "../../helpers/champ-du-bloc"
import { bloc, simulerLAPI } from "../../helpers/noeud"

// Les liens réduits à leur titre pendant la frappe (story `liens-en-edition`) : le champ montre `[[Titre]]`, dessine
// crochets et titre sur lui au focus (AC-1, AC-2), et chaque frappe, copie, coupe ou Entrée garde la source (AC-3,
// AC-7, AC-8). Les bords d'un lien et l'annulation se prouvent en fonctions pures : `tests/unit/ui-editeur-liens-masques.test.ts`.

const ID = { texte: "e1500000-0000-4000-8000-000000000001", liste: "e1500000-0000-4000-8000-000000000002" } as const
const TEXTE = "Voir [[prive/moi/taches#k1|Mes taches]] et [le site](https://exemple.fr/doc) demain"
/** Au focus : « Voir », le lien réduit de 5 à 19 (titre de 7 à 17), « et », le lien web réduit de 23 à 32. */
const MONTRE = "Voir [[Mes taches]] et [le site] demain"
const NOM = "Modifier ce texte — Voir Mes taches et"
/** Le bloc d'après une coupe ou une scission : « et le site demain ». */
const SUITE = "Modifier ce texte — et le site demain"

const rafraichir = vi.fn()
let api: ReturnType<typeof simulerLAPI>

function monter(blocs: BlockView[]) {
  render(
    <ContexteDeRafraichissement.Provider value={rafraichir}>
      <FileDOperations chemin="ventes/modele_relance" revisionPubliee={4} tampon={null}>
        <EditeurDeBlocs blocs={blocs} revisionServie={4} prefixeDesPages="/n/" />
      </FileDOperations>
    </ContexteDeRafraichissement.Provider>,
  )
}

/** Une frappe du champ : son texte d'arrivée, et le curseur posé là où la frappe s'arrête, que le champ lit avec elle. */
function frapper(champ: HTMLTextAreaElement, valeur: string, curseur: number) {
  fireEvent.change(champ, { target: { value: valeur, selectionStart: curseur, selectionEnd: curseur } })
}

/** Le texte du bloc envoyé par Échap. */
async function envoye(champ: HTMLTextAreaElement) {
  fireEvent.keyDown(champ, { key: "Escape" })
  await waitFor(() => expect(api.envoyes).toHaveLength(1))
  return api.envoyes[0].ops?.[0]
}

beforeEach(() => {
  api = simulerLAPI()
  rafraichir.mockReset()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("Liens réduits à leur titre pendant la frappe (story liens-en-edition)", () => {
  it("should show each labelled link by its title at focus, drawn over the field, the field keeping the source", () => {
    monter([bloc(ID.texte, "paragraph", TEXTE)])
    const champ = ouvrirLeChamp(NOM)
    expect(champ).toHaveValue(MONTRE)
    expect(champ).toHaveAttribute("data-miroir")
    expect(texteDuBloc(NOM)).toBe(TEXTE)
    const miroir = champ.parentElement?.querySelector(".oto-block-miroir")
    expect(miroir).toHaveTextContent(MONTRE)
    expect(miroir).toHaveAttribute("aria-hidden", "true")
    expect(Array.from(miroir?.querySelectorAll(".oto-lien-reduit-titre") ?? [], (titre) => titre.textContent)).toEqual(["Mes taches", "le site"])
    expect(Array.from(miroir?.querySelectorAll(".oto-lien-reduit-crochet") ?? [], (crochet) => crochet.textContent)).toEqual(["[[", "]]", "[", "]"])
  })

  it("should send the source with the title typed in the link and the text typed beside it, every path and address kept", async () => {
    monter([bloc(ID.texte, "paragraph", TEXTE)])
    const champ = ouvrirLeChamp(NOM)
    frapper(champ, "Voir [[Mes taches!]] et [le site] demain", 18)
    frapper(champ, "Voir [[Mes taches!]] et [le site] demain matin", 46)
    expect(champ).toHaveValue("Voir [[Mes taches!]] et [le site] demain matin")
    expect(await envoye(champ)).toMatchObject({
      op: "replace_block",
      input: { type: "paragraph", text: "Voir [[prive/moi/taches#k1|Mes taches!]] et [le site](https://exemple.fr/doc) demain matin" },
    })
  })

  it("should copy and cut the source of a selection, a link selected whole with its path", () => {
    monter([bloc(ID.texte, "paragraph", TEXTE)])
    const champ = ouvrirLeChamp(NOM)
    const presse = { setData: vi.fn() }
    champ.setSelectionRange(0, 19)
    fireEvent.copy(champ, { clipboardData: presse })
    expect(presse.setData).toHaveBeenCalledWith("text/plain", "Voir [[prive/moi/taches#k1|Mes taches]]")
    champ.setSelectionRange(0, 20)
    fireEvent.cut(champ, { clipboardData: presse })
    expect(presse.setData).toHaveBeenLastCalledWith("text/plain", "Voir [[prive/moi/taches#k1|Mes taches]] ")
    expect(champ).toHaveValue("et [le site] demain")
    expect(texteDuBloc(SUITE)).toBe("et [le site](https://exemple.fr/doc) demain")
  })

  it("should split at the caret of the text shown with Enter, the link kept whole in the block before", async () => {
    monter([bloc(ID.texte, "paragraph", TEXTE)])
    const champ = ouvrirLeChamp(NOM)
    act(() => champ.setSelectionRange(20, 20))
    fireEvent.keyDown(champ, { key: "Enter" })
    await waitFor(() => expect(api.envoyes.length).toBeGreaterThan(0))
    expect(api.envoyes[0].ops?.[0]).toMatchObject({ op: "replace_block", input: { text: "Voir [[prive/moi/taches#k1|Mes taches]] " } })
    expect(texteDuBloc(SUITE)).toBe("et [le site](https://exemple.fr/doc) demain")
  })

  it("should draw the reduced links of a list in its copy at focus, line by line", () => {
    monter([bloc(ID.liste, "list", null, { items: ["un [[a/b|Un]]", "deux [[c/d|Deux]]"] })])
    const champ = ouvrirLeChamp("Modifier cette liste — un Un deux Deux")
    expect(champ).toHaveValue("un [[Un]]\ndeux [[Deux]]")
    const copie = champ.parentElement?.querySelector(".oto-block-copie")
    expect(Array.from(copie?.querySelectorAll(".oto-block-element-texte") ?? [], (ligne) => ligne.textContent)).toEqual(["un [[Un]]", "deux [[Deux]]"])
    expect(copie?.querySelectorAll(".oto-lien-reduit-titre")).toHaveLength(2)
  })
})
