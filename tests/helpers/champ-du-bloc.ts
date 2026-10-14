// Le champ d'un bloc de l'éditeur sous jsdom (1.1.3) : un bloc qu'on ne touche pas se lit (`champ-au-repos.tsx`, un
// `span` nommé comme le champ, `role="textbox"`) ; son focus monte le `<textarea>`, qui prend le focus, curseur à la fin.
// Sans ces aides, chaque suite de l'éditeur réécrivait le même geste d'ouverture et la même lecture du texte d'un bloc.
import { act, screen, within } from "@testing-library/react"
import { sourceDuChamp } from "../../packages/plateforme/ui/noeud/editeur/liens-masques"

/** Le bloc nommé `nom`, lu ou déjà ouvert : l'élément `role="textbox"` qui porte son nom. */
function leBloc(nom: string | RegExp, dans?: HTMLElement): HTMLElement {
  return dans ? within(dans).getByRole("textbox", { name: nom }) : screen.getByRole("textbox", { name: nom })
}

/** Le champ du bloc nommé `nom`, ouvert : un bloc lu reçoit le focus, son `<textarea>` le prend ; un champ déjà ouvert est rendu tel quel. */
export function ouvrirLeChamp(nom: string | RegExp, dans?: HTMLElement): HTMLTextAreaElement {
  const lu = leBloc(nom, dans)
  if (lu instanceof HTMLTextAreaElement) return lu
  act(() => lu.focus())
  const champ = leBloc(nom, dans)
  if (!(champ instanceof HTMLTextAreaElement)) throw new Error(`le bloc « ${String(nom)} » ne s'ouvre pas en champ`)
  return champ
}

/**
 * Le texte brut d'un bloc, sans l'ouvrir : la source de son champ ouvert (qui montre ses liens réduits à leur titre,
 * story `liens-en-edition`), sinon le texte du bloc lu.
 */
export function texteDuBloc(nom: string | RegExp, dans?: HTMLElement): string {
  const element = leBloc(nom, dans)
  if (element instanceof HTMLTextAreaElement) return sourceDuChamp(element)
  const premier = element.firstChild
  return premier?.nodeType === Node.TEXT_NODE ? (premier.textContent ?? "") : ""
}
