// La hauteur du champ d'un bloc : l'estimation d'avant l'hydratation (`rows`) et la mesure là où le navigateur n'a pas
// `field-sizing`. Sortie de `champ-de-bloc.tsx` (borne de 300 lignes), sans changement.
import { useLayoutEffect, useRef, type RefObject } from "react"

/** Les caractères d'une ligne du document, à la mesure de lecture : l'estimation d'avant l'hydratation, que la mesure remplace. */
const CARACTERES_PAR_LIGNE = 80

/** Les lignes que le texte occupera, lignes repliées comprises : le même nombre au serveur et au navigateur. */
export function lignesEstimees(texte: string): number {
  return texte.split("\n").reduce((total, ligne) => total + Math.max(1, Math.ceil(ligne.length / CARACTERES_PAR_LIGNE)), 0)
}

/** `field-sizing: content` (Chrome, Edge) : la hauteur suit le texte par le seul CSS, sans mesure. */
const hauteurParLeCss = () => typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("field-sizing", "content")

/** `auto` d'abord, sinon `scrollHeight` ne redescend jamais sous la hauteur déjà posée. */
function mesurer(champ: HTMLTextAreaElement) {
  champ.style.height = "auto"
  champ.style.height = `${champ.scrollHeight}px`
}

/** Les champs montés en attente de leur hauteur : mesurés ensemble à l'image suivante, en une seule mise en page. */
const aMesurer = new Set<HTMLTextAreaElement>()

function mesurerEnsemble() {
  const champs = [...aMesurer]
  aMesurer.clear()
  // Toutes les écritures, puis toutes les lectures, puis toutes les écritures : jamais une lecture après l'écriture d'un seul.
  for (const champ of champs) champ.style.height = "auto"
  const hauteurs = champs.map((champ) => champ.scrollHeight)
  champs.forEach((champ, rang) => {
    champ.style.height = `${hauteurs[rang]}px`
  })
}

/**
 * La hauteur d'un champ suit son texte, là où le navigateur n'a pas `field-sizing` (Firefox, Safari) : au montage, avec
 * les autres champs montés dans le même rendu, à l'image suivante (une mesure par champ forçait une mise en page par
 * bloc, et figeait une page longue plusieurs secondes) ; ensuite, à chaque texte reçu (frappe, annulation) et à chaque
 * forme (un titre change de corps), ce seul champ, tout de suite : il grandit pendant qu'on tape. `monte` : le champ
 * vient d'être monté à la place du bloc lu.
 */
export function useHauteurDuTexte(champ: RefObject<HTMLTextAreaElement | null>, texte: string, genre: string, monte: boolean) {
  const mesure = useRef<HTMLTextAreaElement | null>(null)
  useLayoutEffect(() => {
    const element = champ.current
    if (!element || hauteurParLeCss()) return
    if (mesure.current === element) return mesurer(element)
    mesure.current = element
    if (aMesurer.size === 0) requestAnimationFrame(mesurerEnsemble)
    aMesurer.add(element)
    return () => void aMesurer.delete(element)
  }, [champ, texte, genre, monte])
}
