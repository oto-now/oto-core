import { hydrateRoot } from "react-dom/client"
import { renderToString } from "react-dom/server"
import type { ReactElement, ReactNode } from "react"
import { act } from "@testing-library/react"
import { describe, expect, it, onTestFinished, vi } from "vitest"
import { loggedText } from "../../helpers/logs"
import { Tooltip } from "../../../packages/plateforme/ui/ds/react/tooltip"

// L'ancre des flottants (`Anchor`, sous `Tooltip`, `Popover`, `DropdownMenu`) rend le même balisage au serveur et
// au client quand son déclencheur vient d'un Server Component. Au rendu serveur d'une page, le client Flight de
// React rend un élément dont une référence n'est pas encore arrivée (en développement : son propriétaire, sa pile)
// sous une enveloppe paresseuse (`createLazyChunkWrapper` de `react-server-dom-webpack/client`), que le navigateur,
// qui a déjà tout le flux à l'hydratation, reçoit en élément : l'enveloppe est reproduite ici telle quelle.

const REACT_LAZY_TYPE = Symbol.for("react.lazy")

/** L'élément tel que le client Flight le rend au serveur : une enveloppe paresseuse sur un morceau déjà résolu. */
function enveloppeDeFlight(element: ReactElement): ReactNode {
  const morceau = { status: "fulfilled", value: element, then: (resoudre: (valeur: ReactElement) => void) => resoudre(element) }
  // Un nœud paresseux de React n'a pas de type public : `ReactNode` ne le décrit pas, React le rend pourtant.
  return { $$typeof: REACT_LAZY_TYPE, _payload: morceau, _init: (charge: typeof morceau) => charge.value } as unknown as ReactNode
}

function declencheur(): ReactElement {
  return (
    <span tabIndex={0} className="oto-node-modified">
      Modifiée il y a 2 jours
    </span>
  )
}

describe("Anchor hydration", () => {
  it("should render the same trigger on the server and the client when the server child is a Flight lazy element", async () => {
    const erreurs = vi.spyOn(console, "error").mockImplementation(() => {})
    onTestFinished(() => erreurs.mockRestore())
    const recuperees: unknown[] = []
    const conteneur = document.body.appendChild(document.createElement("div"))
    onTestFinished(() => conteneur.remove())

    conteneur.innerHTML = renderToString(<Tooltip content="Type : page">{enveloppeDeFlight(declencheur())}</Tooltip>)
    const racine = await act(async () =>
      hydrateRoot(conteneur, <Tooltip content="Type : page">{declencheur()}</Tooltip>, { onRecoverableError: (erreur) => recuperees.push(erreur) }),
    )
    onTestFinished(() => act(() => racine.unmount()))

    expect({ recuperees, console: loggedText(erreurs) }).toEqual({ recuperees: [], console: "" })
    expect(conteneur.firstElementChild).toHaveClass("oto-node-modified")
  })
})
