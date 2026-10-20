"use client"

// La ligne de la page ouverte, amenée dans le champ du rail à chaque navigation, en hauteur et en largeur (son retrait
// visible), sans bouger le contenu : seul le conteneur de défilement du rail défile. Sans elle, une page ouverte au fond
// d'un arbre déplié restait hors du rail, qu'il fallait faire défiler à la main pour la retrouver.
import { useEffect } from "react"

/** L'air laissé autour de la ligne amenée en vue. */
const MARGE = 8

/**
 * Le conteneur défile juste ce qu'il faut pour montrer la ligne : en hauteur, au bord le plus proche ; en largeur, son
 * début (le retrait de sa profondeur), dès qu'elle dépasse d'un côté.
 */
export function amenerEnVue(conteneur: HTMLElement, ligne: HTMLElement): void {
  const cadre = conteneur.getBoundingClientRect()
  const boite = ligne.getBoundingClientRect()
  if (boite.top < cadre.top) conteneur.scrollTop += boite.top - cadre.top - MARGE
  else if (boite.bottom > cadre.bottom) conteneur.scrollTop += boite.bottom - cadre.bottom + MARGE
  if (boite.left < cadre.left || boite.right > cadre.right) conteneur.scrollLeft += boite.left - cadre.left - MARGE
}

/** Après chaque navigation (`chemin`), une fois l'arbre déplié jusqu'à elle, la ligne courante du rail `idDuRail` en vue. */
export function useLigneCouranteEnVue(idDuRail: string, chemin: string): void {
  useEffect(() => {
    // Deux images : le dépliage de la branche qui porte la ligne se rend d'abord.
    let seconde = 0
    const premiere = requestAnimationFrame(() => {
      seconde = requestAnimationFrame(() => {
        const defilement = document.getElementById(idDuRail)?.querySelector<HTMLElement>(".oto-rail-scroll")
        const ligne = defilement?.querySelector<HTMLElement>('[aria-current="page"]')
        if (defilement && ligne) amenerEnVue(defilement, ligne)
      })
    })
    return () => {
      cancelAnimationFrame(premiere)
      cancelAnimationFrame(seconde)
    }
  }, [idDuRail, chemin])
}
