// Le passage commenté, dans le document à l'écran (parcours 5.4) : l'élément d'un bloc (`data-bloc`, posé par la
// lecture et par la rangée de l'éditeur), le texte sélectionné dans un seul bloc, qui devient la citation d'un fil, et
// le surlignage de la citation du fil ouvert. Fonctions du navigateur, sans état ni React. Sans ce module, la bulle, la
// sélection et la carte chercheraient chacune le bloc d'un fil à leur façon.
import { COMMENT_QUOTE_MAX_CHARS } from "../../../schemas/comments"

/** L'élément du bloc `id` à l'écran, lu ou écrit ; `null` s'il n'est pas montré (replié avec sa section, ou retiré). */
export function elementDuBloc(id: string): HTMLElement | null {
  return [...document.querySelectorAll<HTMLElement>("[data-bloc]")].find((element) => element.dataset.bloc === id) ?? null
}

function blocDe(noeud: Node | null): string | null {
  const element = noeud instanceof Element ? noeud : (noeud?.parentElement ?? null)
  return element?.closest<HTMLElement>("[data-bloc]")?.dataset.bloc ?? null
}

/** Les blancs réduits, comme le service compare une citation au texte de son bloc. */
const reduit = (texte: string) => texte.replace(/\s+/g, " ").trim()

/** Une sélection devient une citation si elle tient dans la borne du schéma ; sinon le fil s'ouvre sur le bloc seul. */
function citable(texte: string): string | null {
  const citation = reduit(texte)
  return citation !== "" && [...citation].length <= COMMENT_QUOTE_MAX_CHARS ? citation : null
}

/** Un passage sélectionné : son bloc, sa citation (nulle si elle ne se retrouverait pas dans le texte du bloc), et où poser le bouton : au-dessus du milieu de la sélection, ou du bloc quand la sélection est dans son champ ouvert (un champ de saisie ne dit pas où est sa sélection). */
export type PassageChoisi = { bloc: string; citation: string | null; haut: number; centre: number }

/**
 * Le passage que la personne a sélectionné dans un seul bloc publié, ou `null`. Dans le champ ouvert de l'éditeur, la
 * sélection est le texte écrit lui-même. Dans un bloc lu, elle n'est gardée en citation que si elle tient dans un seul
 * nœud de texte : à cheval sur du gras ou un lien, elle ne se retrouverait pas dans le texte du bloc, que le service
 * compare, et le fil s'ouvre sur le bloc sans citation.
 */
export function passageChoisi(publies: ReadonlySet<string>): PassageChoisi | null {
  const actif = document.activeElement
  if (actif instanceof HTMLTextAreaElement && actif.selectionStart !== actif.selectionEnd) {
    const bloc = blocDe(actif)
    if (bloc === null || !publies.has(bloc)) return null
    const cadre = actif.getBoundingClientRect()
    return { bloc, citation: citable(actif.value.slice(actif.selectionStart, actif.selectionEnd)), haut: cadre.top, centre: cadre.left + cadre.width / 2 }
  }
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null
  const bloc = blocDe(selection.anchorNode)
  if (bloc === null || bloc !== blocDe(selection.focusNode) || !publies.has(bloc)) return null
  const texte = selection.toString()
  if (texte.trim() === "") return null
  const plage = selection.getRangeAt(0)
  // Sans mise en page (jsdom), une plage n'a pas de cadre : celui du bloc.
  const cadre = typeof plage.getBoundingClientRect === "function" ? plage.getBoundingClientRect() : (elementDuBloc(bloc)?.getBoundingClientRect() ?? { top: 0, left: 0, width: 0 })
  return { bloc, citation: plage.startContainer === plage.endContainer ? citable(texte) : null, haut: cadre.top, centre: cadre.left + cadre.width / 2 }
}

/** La plage de `citation` dans un nœud de texte de `racine`, blancs réduits ; `null` si aucun ne la porte en entier. */
export function plageDeLaCitation(racine: Node, citation: string): Range | null {
  const cherche = reduit(citation)
  if (cherche === "") return null
  const textes = document.createTreeWalker(racine, NodeFilter.SHOW_TEXT)
  for (let noeud = textes.nextNode(); noeud !== null; noeud = textes.nextNode()) {
    const brut = noeud.nodeValue ?? ""
    // Le texte aux blancs réduits, et pour chacun de ses caractères sa place dans le texte brut.
    let lu = ""
    const places: number[] = []
    for (let rang = 0; rang < brut.length; rang++) {
      const blanc = /\s/.test(brut[rang])
      if (blanc && (lu === "" || lu.endsWith(" "))) continue
      lu += blanc ? " " : brut[rang]
      places.push(rang)
    }
    const debut = lu.indexOf(cherche)
    if (debut === -1) continue
    const plage = document.createRange()
    plage.setStart(noeud, places[debut])
    plage.setEnd(noeud, places[debut + cherche.length - 1] + 1)
    return plage
  }
  return null
}

/** Le nom du surlignage. */
const SURLIGNAGE = "oto-passage"

/**
 * La règle du surlignage, la paire de la sélection de texte (`--ink` sur `--ring-solid`), posée à l'exécution : le
 * compilateur CSS de l'hôte (Turbopack) refuse `::highlight()` dans une feuille du paquet.
 */
const REGLE = `::highlight(${SURLIGNAGE}) { background-color: var(--ring-solid); color: var(--ink); }`

let reglePosee = false

function poserLaRegle(): void {
  if (reglePosee || typeof CSSStyleSheet === "undefined" || !("adoptedStyleSheets" in document)) return
  reglePosee = true
  const feuille = new CSSStyleSheet()
  feuille.replaceSync(REGLE)
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, feuille]
}

/**
 * Surligne la citation du fil ouvert dans son bloc, sans toucher au document (surlignage du navigateur) ; sans bloc ou
 * sans citation, l'efface. Un navigateur sans ce surlignage garde le bloc mis en valeur (`data-actif`), rien de plus.
 */
export function surlignerLePassage(bloc: string | null, citation: string | null): void {
  if (typeof CSS === "undefined" || !("highlights" in CSS) || typeof Highlight === "undefined") return
  poserLaRegle()
  CSS.highlights.delete(SURLIGNAGE)
  const element = bloc !== null && citation !== null ? elementDuBloc(bloc) : null
  const plage = element && citation !== null ? plageDeLaCitation(element, citation) : null
  if (plage) CSS.highlights.set(SURLIGNAGE, new Highlight(plage))
}

/** Amène le bloc d'un fil dans la vue, s'il est montré. */
export function allerAuBloc(bloc: string): void {
  const element = elementDuBloc(bloc)
  // Absent de jsdom : rien à faire défiler sans mise en page.
  if (element && typeof element.scrollIntoView === "function") element.scrollIntoView({ block: "nearest", behavior: "smooth" })
}
