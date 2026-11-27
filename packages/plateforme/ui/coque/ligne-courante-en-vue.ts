"use client"

// La ligne de la page ouverte, amenée dans le champ du rail à chaque navigation, en hauteur seulement, sans bouger le
// contenu : seul le conteneur de défilement du rail défile. Sans elle, une page ouverte au fond d'un arbre déplié restait
// hors du rail, qu'il fallait faire défiler à la main pour la retrouver. En largeur, jamais (D11, choix de JB sur #87) :
// le défilement horizontal reste où la personne l'a laissé, 0 par défaut, quelle que soit la façon d'arriver (rail, lien,
// recherche, adresse) ; un nom long au fond de l'arbre peut être coupé à droite, le début de chaque ligne reste visible.
import { useEffect } from "react"

/** L'air laissé autour de la ligne amenée en vue, en hauteur. */
const MARGE = 8

/** Le conteneur défile en hauteur juste ce qu'il faut pour montrer la ligne, au bord le plus proche ; `scrollLeft` n'est jamais touché. */
export function amenerEnVue(conteneur: HTMLElement, ligne: HTMLElement): void {
  const cadre = conteneur.getBoundingClientRect()
  const boite = ligne.getBoundingClientRect()
  if (boite.top < cadre.top) conteneur.scrollTop += boite.top - cadre.top - MARGE
  else if (boite.bottom > cadre.bottom) conteneur.scrollTop += boite.bottom - cadre.bottom + MARGE
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
