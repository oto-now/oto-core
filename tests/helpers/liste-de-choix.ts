// Aides des tests d'écran pour le `Select` du design system (E05-S11 lot f, retour 8) : une liste de choix
// n'est plus un `<select>` natif qu'un `change` règle, mais un déclencheur qui ouvre sa liste ailleurs dans
// le document (la couche du déclencheur) ; dix-sept fichiers de tests la choisissent.
import { fireEvent, within } from "@testing-library/react"

/** La liste ouverte d'un `Select`, celle que nomme `aria-controls` : lève si elle est fermée. */
export function listeDe(declencheur: HTMLElement): HTMLElement {
  const id = declencheur.getAttribute("aria-controls")
  const liste = id ? document.getElementById(id) : null
  if (!liste) throw new Error(`liste de « ${declencheur.textContent} » fermée`)
  return liste
}

/** Les libellés des choix d'un `Select` : la liste ouverte, lue, puis refermée par son déclencheur. */
export function libellesDesChoix(declencheur: HTMLElement): (string | null)[] {
  fireEvent.click(declencheur)
  const libelles = within(listeDe(declencheur))
    .getAllByRole("option")
    // Le libellé seul : la ligne fine qui décrit un choix (les niveaux d'accès, 1.4.13) n'en fait pas partie.
    .map((option) => (option.querySelector(".oto-menu-label") ?? option).textContent)
  fireEvent.click(declencheur)
  return libelles
}

/** Choisit l'option nommée `option` : ouvre la liste par son déclencheur, clique l'option. */
export function choisirDansLaListe(declencheur: HTMLElement, option: string | RegExp): void {
  fireEvent.click(declencheur)
  fireEvent.click(within(listeDe(declencheur)).getByRole("option", { name: option }))
}
