// Le clavier d'un champ de l'éditeur (E05-S02 ; E05-S08, AC3) : Entrée scinde ou sort d'une liste,
// ⇧Entrée passe à la ligne, ⌥↑ / ⌥↓ déplacent, Retour arrière au début et Suppr à la fin fusionnent, Échap
// envoie le texte et porte le focus sur la poignée, ⌘S l'envoie sans quitter le champ. Ce qui n'est pas
// intercepté reste au `<textarea>` (sélection, annulation). Sans lui, `actions.ts` dépasserait les 300
// lignes d'ESLint (`coding-standards.md § Complexité`).
//
// Porté d'oto-frontend (`components/editor/block-editor.tsx`, `useClavier`). Repris : les touches et leurs
// conditions (sortie de liste sur une dernière ligne vide, rien avant le premier bloc), Échap vers la
// poignée. Retiré : l'enregistrement différé du corps entier, relancé par chaque touche.
//
// E10-S06 : `Tab` et `Maj+Tab` descendent et remontent la ligne d'une liste à puces ou numérotée (AC-a6) ; les
// champs d'un tableau et d'un repli gardent leurs propres touches, seuls Échap, ⌘S et ⌥↑ / ⌥↓ passent ici.
// `Tab` sur la poignée d'un bloc qui garde `Tab` sort du bloc (AC-a6, `sortirDuBlocAuClavier`, venu de `rangee-de-bloc.tsx`).
//
// 1.1.3 : ↑ au début d'un champ va à la fin du bloc d'avant, ↓ à la fin d'un champ au début du bloc d'après ; seul le
// bloc touché monte son champ, les autres se lisent (`champ-de-bloc.tsx`).
import type { KeyboardEvent } from "react"
import { NIVEAUX_DE_LISTE } from "../libelles"
import type { EtatDeLEditeur } from "./actions"
import { estUnTitre, niveauDeLigne, positionDansLaLigne } from "./blocs-de-page"
import { placeDansLaSource, sourceDuChamp } from "./liens-masques"
import * as modeleDEdition from "./modele"
import { formeDe, FORMES_EN_LIGNES, texteDe, type Forme } from "./modele"
import { MESSAGES_DU_BLOC } from "./operations"

export type Clavier = { envoyerLeTexte: (cle: string) => boolean; fondre: (cle: string) => void; deplacer: (cle: string, pas: -1 | 1) => void }

type Champ = HTMLTextAreaElement | HTMLInputElement

/** Les formes écrites dans leurs propres champs (E10-S06) : ni scission, ni fusion, ni niveau de liste depuis ce clavier. */
const A_CHAMPS_PROPRES: ReadonlySet<Forme> = new Set(["tableau", "repli"])

/**
 * Entrée d'un Texte ou d'un titre : scinder au curseur, un titre donnant un Texte (AC3). Scinder part tout
 * de suite, le texte d'avant puis celui d'après s'il n'est pas vide (HN-E05S08-10) ; le focus va au bloc
 * d'après, sauf quand le contrôle refuse le texte d'avant. Dans une liste (à puces, numérotée, à cocher) ou
 * du code, Entrée ajoute une ligne, et Entrée sur la dernière ligne vide en sort (E05-S10, AC-a2). Sur un
 * bloc vide, Entrée en ouvre un autre, vide lui aussi (E05-S10, AC-a4).
 */
function entree(etat: EtatDeLEditeur, envoyerLeTexte: Clavier["envoyerLeTexte"], cle: string, champ: Champ): boolean {
  const { modele, changerModele, setFocus } = etat
  const liste = formeDe(modele.current.find((rangee) => rangee.cle === cle)?.bloc ?? { type: "", data: {} })
  const dansUneListe = liste !== null && FORMES_EN_LIGNES.has(liste)
  const auBout = champ.selectionStart === champ.selectionEnd && champ.selectionStart === champ.value.length
  if (dansUneListe && !(auBout && (champ.value === "" || champ.value.endsWith("\n")))) return false
  const suite = dansUneListe ? modeleDEdition.sortirDeLaListe(modele.current, cle) : modeleDEdition.scinder(modele.current, cle, placeDansLaSource(champ, champ.selectionStart ?? 0))
  changerModele(suite.modele)
  if (!suite.focus) return true
  const accepte = suite.focus.cle === cle || envoyerLeTexte(cle)
  if (suite.focus.cle !== cle) envoyerLeTexte(suite.focus.cle)
  if (accepte) setFocus(suite.focus)
  return true
}

/**
 * `Tab` ou `Maj+Tab` dans une liste à puces ou numérotée (E10-S06, AC-a6) : la ligne du curseur change de niveau, le
 * curseur reste dans son texte ; un refus ne change rien et s'annonce.
 */
function niveau(etat: EtatDeLEditeur, cle: string, champ: Champ, pas: 1 | -1) {
  const numerotee = formeDe(etat.modele.current.find((rangee) => rangee.cle === cle)?.bloc ?? { type: "", data: {} }) === "numerotee"
  // Le champ montre ses liens réduits à leur titre : la ligne se lit dans la source (story `liens-en-edition`).
  const lu = niveauDeLigne(sourceDuChamp(champ), placeDansLaSource(champ, champ.selectionStart ?? 0), pas, numerotee)
  if ("refus" in lu) return etat.envois.annoncer(lu.refus === "troisNiveaux" ? MESSAGES_DU_BLOC.troisNiveaux : NIVEAUX_DE_LISTE[lu.refus])
  const suite = modeleDEdition.ecrireTexte(etat.modele.current, cle, lu.texte)
  etat.changerModele(suite.modele)
  // Le champ se réécrit depuis le modèle (marques renumérotées) : le curseur se place dans la ligne réécrite.
  const bloc = suite.modele.find((rangee) => rangee.cle === cle)?.bloc
  if (bloc) etat.setFocus({ cle, curseur: positionDansLaLigne(texteDe(bloc), lu.ligne, lu.colonne) })
  etat.differer(cle)
  etat.frapper()
}

/**
 * ⌘S envoie sans quitter le champ ; Échap envoie le texte et porte le focus sur la poignée de la rangée,
 * sauf quand le contrôle le refuse (AC2, AC3).
 * `true` : la touche est prise.
 */
export function echapOuEnregistrer(etat: EtatDeLEditeur, envoyerLeTexte: Clavier["envoyerLeTexte"], cle: string, evenement: KeyboardEvent<HTMLElement>): boolean {
  const enregistrer = (evenement.metaKey || evenement.ctrlKey) && evenement.key.toLowerCase() === "s"
  if (!enregistrer && evenement.key !== "Escape") return false
  evenement.preventDefault()
  if (envoyerLeTexte(cle) && !enregistrer) etat.setFocus({ cle, curseur: null, cible: "rangee" })
  return true
}

/** Le clavier d'un champ (AC3) ; ce qui n'est pas intercepté reste au champ. */
/** La clé de la rangée visible avant (`pas` -1) ou après (1) celle du champ ; une rangée cachée sous un titre replié est sautée. */
function cleVisibleVoisine(champ: Champ, pas: 1 | -1): string | null {
  let element: Element | null | undefined = champ.closest("[data-cle]")
  while ((element = pas === 1 ? element?.nextElementSibling : element?.previousElementSibling)) {
    if (element instanceof HTMLElement && element.dataset.cle !== undefined && !element.hidden) return element.dataset.cle
  }
  return null
}

export function clavier(etat: EtatDeLEditeur, actions: Clavier) {
  return (cle: string, evenement: KeyboardEvent<Champ>) => {
    if (echapOuEnregistrer(etat, actions.envoyerLeTexte, cle, evenement)) return
    // Pendant un conflit, les champs sont en lecture seule : ni scission, ni fusion, ni déplacement (HN-E05S08-3).
    if (etat.envois.conflit) return
    const champ = evenement.currentTarget
    const { selectionStart: debut, selectionEnd: fin } = champ
    const forme = formeDe(etat.modele.current.find((rangee) => rangee.cle === cle)?.bloc ?? { type: "", data: {} })
    const rang = etat.modele.current.findIndex((rangee) => rangee.cle === cle)
    const intercepter = (geste: () => unknown) => {
      evenement.preventDefault()
      geste()
    }
    if (evenement.altKey && (evenement.key === "ArrowUp" || evenement.key === "ArrowDown")) return intercepter(() => actions.deplacer(cle, evenement.key === "ArrowUp" ? -1 : 1))
    if (forme !== null && A_CHAMPS_PROPRES.has(forme)) return
    const tabulation = evenement.key === "Tab" && !evenement.altKey && !evenement.ctrlKey && !evenement.metaKey
    // La liste à cocher n'a pas de sous-niveaux (HN-E10S04-2) : `Tab` y garde son rôle (AC-a6).
    if (tabulation && (forme === "puces" || forme === "numerotee")) return intercepter(() => niveau(etat, cle, champ, evenement.shiftKey ? -1 : 1))
    if (evenement.key === "Enter" && !evenement.shiftKey) return entree(etat, actions.envoyerLeTexte, cle, champ) ? evenement.preventDefault() : undefined
    if (evenement.key === "Enter" && estUnTitre(forme)) return evenement.preventDefault()
    if (evenement.key === "Backspace" && debut === 0 && fin === 0 && rang > 0) return intercepter(() => actions.fondre(cle))
    const suivante = etat.modele.current[rang + 1]
    if (evenement.key === "Delete" && debut === fin && fin === champ.value.length && suivante) return intercepter(() => actions.fondre(suivante.cle))
    // ↑ au début du texte, ↓ à sa fin : le bloc voisin visible, dont le champ se monte, curseur à sa fin ou à son début (1.1.3) ;
    // la section d'un titre replié est sautée.
    const seule = !evenement.shiftKey && !evenement.altKey && !evenement.ctrlKey && !evenement.metaKey
    const voisine = (pas: 1 | -1) => etat.modele.current.find((rangee) => rangee.cle === cleVisibleVoisine(champ, pas))
    if (evenement.key === "ArrowUp" && seule && debut === 0 && fin === 0) {
      const precedente = voisine(-1)
      if (precedente) return intercepter(() => etat.setFocus({ cle: precedente.cle, curseur: texteDe(precedente.bloc).length }))
    }
    if (evenement.key === "ArrowDown" && seule && debut === fin && fin === champ.value.length) {
      const visible = voisine(1)
      if (visible) return intercepter(() => etat.setFocus({ cle: visible.cle, curseur: 0 }))
    }
  }
}

/** Les formes dont le champ garde `Tab` (E10-S06, AC-a6, AC-b1) : de leur poignée, `Tab` sort du bloc. */
const GARDENT_TAB: ReadonlySet<Forme> = new Set(["puces", "numerotee", "tableau"])

/**
 * Un élément de la tabulation, rendu : `tabIndex` positif ou nul, ni désactivé, ni sous `[hidden]`, `[inert]` ou dans un
 * `<details>` fermé, ni caché par le style (`checkVisibility`, là où le navigateur l'a ; jsdom ne calcule pas le rendu).
 */
function tabulable(element: HTMLElement): boolean {
  return (
    element.tabIndex >= 0 &&
    !element.matches(":disabled") &&
    element.closest("[hidden], [inert], details:not([open]) > :not(summary)") === null &&
    (typeof element.checkVisibility !== "function" || element.checkVisibility())
  )
}

/** `element` suit `repere` dans le document, hors de lui. */
const apres = (repere: Element, element: Element) => !repere.contains(element) && (repere.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0

/**
 * Retire des éléments de la tabulation le temps de l'action par défaut de `Tab`, qui suit le `keydown`, et les y rend au
 * tour suivant, que le focus ait bougé ou non ; chacun retrouve son attribut `tabindex` tel qu'il était.
 */
function horsDeLaTabulationUnInstant(elements: HTMLElement[]) {
  const avant = elements.map((element) => ({ element, attribut: element.getAttribute("tabindex") }))
  for (const element of elements) element.tabIndex = -1
  setTimeout(() => {
    for (const { element, attribut } of avant) {
      if (attribut === null) element.removeAttribute("tabindex")
      else element.setAttribute("tabindex", attribut)
    }
  }, 0)
}

/**
 * `Tab` sur la poignée d'une liste à puces ou numérotée, ou d'un tableau (AC-a6) : le champ qui suit la poignée garde
 * `Tab`, le focus va donc au premier élément après la rangée. Rien après elle (la fin de la page) : la touche reste au
 * navigateur, qui sort de la page, les champs de la rangée hors de la tabulation le temps de son geste. `Maj+Tab` et
 * les autres touches restent au menu.
 */
export function sortirDuBlocAuClavier(evenement: KeyboardEvent<HTMLButtonElement>, forme: Forme | null) {
  if (evenement.key !== "Tab" || evenement.shiftKey || evenement.altKey || evenement.ctrlKey || evenement.metaKey) return
  if (forme === null || !GARDENT_TAB.has(forme)) return
  const poignee = evenement.currentTarget
  const rangee = poignee.closest("[data-cle]")
  if (!rangee) return
  const suivant = Array.from(rangee.ownerDocument.body.querySelectorAll<HTMLElement>("*")).find((element) => apres(rangee, element) && tabulable(element))
  if (!suivant) {
    horsDeLaTabulationUnInstant(Array.from(rangee.querySelectorAll<HTMLElement>("*")).filter((element) => apres(poignee, element) && tabulable(element)))
    return
  }
  evenement.preventDefault()
  suivant.focus()
}
