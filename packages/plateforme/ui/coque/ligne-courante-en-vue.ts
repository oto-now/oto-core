"use client"

// La ligne de la page ouverte, amenée dans le champ du rail à chaque navigation, en hauteur et en largeur (son retrait
// visible), sans bouger le contenu : seul le conteneur de défilement du rail défile. Sans elle, une page ouverte au fond
// d'un arbre déplié restait hors du rail, qu'il fallait faire défiler à la main pour la retrouver.
import { useEffect } from "react"

/** L'air laissé autour de la ligne amenée en vue, en hauteur. */
const MARGE = 8

/**
 * Le défilement en largeur qui montre une ligne de l'arbre à la profondeur `profondeur` (1 : sous une section, comme le
 * Contexte d'une équipe) : un pas de retrait par niveau sous le premier, jamais plus, et seulement quand la ligne
 * dépasse du cadre ; sinon le défilement `actuel` ne bouge pas. `pas` est le retrait qu'ajoute un niveau, mesuré.
 * Défiler jusqu'au début du libellé, glyphe et bascule compris, partait trop à droite dès le premier niveau.
 */
export function defilementEnLargeur(profondeur: number, pas: number, deborde: boolean, actuel: number): number {
  if (!deborde) return actuel
  return Math.max(0, profondeur - 1) * Math.max(0, pas)
}

/** La profondeur de la ligne dans l'arbre du rail : le nombre d'arbres (`.oto-rail-tree`) qui la contiennent. */
function profondeurDe(ligne: HTMLElement, conteneur: HTMLElement): number {
  let profondeur = 0
  for (let element = ligne.parentElement; element && element !== conteneur; element = element.parentElement) {
    if (element.classList.contains("oto-rail-tree")) profondeur += 1
  }
  return profondeur
}

/** Le retrait d'un niveau, lu sur un arbre imbriqué (`.oto-rail-tree .oto-rail-tree`, son rembourrage de début). */
function pasDuRetrait(conteneur: HTMLElement): number {
  const imbrique = conteneur.querySelector<HTMLElement>(".oto-rail-tree .oto-rail-tree")
  return imbrique ? Number.parseFloat(getComputedStyle(imbrique).paddingInlineStart) || 0 : 0
}

/**
 * Le conteneur défile juste ce qu'il faut pour montrer la ligne : en hauteur, au bord le plus proche ; en largeur, un pas
 * de retrait par niveau sous le premier (`defilementEnLargeur`), dès qu'elle dépasse d'un côté.
 */
export function amenerEnVue(conteneur: HTMLElement, ligne: HTMLElement): void {
  const cadre = conteneur.getBoundingClientRect()
  const boite = ligne.getBoundingClientRect()
  if (boite.top < cadre.top) conteneur.scrollTop += boite.top - cadre.top - MARGE
  else if (boite.bottom > cadre.bottom) conteneur.scrollTop += boite.bottom - cadre.bottom + MARGE
  const deborde = boite.left < cadre.left || boite.right > cadre.right
  conteneur.scrollLeft = defilementEnLargeur(profondeurDe(ligne, conteneur), pasDuRetrait(conteneur), deborde, conteneur.scrollLeft)
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
