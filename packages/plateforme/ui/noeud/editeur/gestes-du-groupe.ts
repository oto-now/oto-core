// Les gestes d'une sélection de blocs (E11-S17, lot a) : supprimer, déplacer, glisser, copier et couper un groupe, et
// l'« Annuler » d'un geste de groupe. Chacun applique une opération pure (`groupe.ts`), puis part en une seule écriture
// de plusieurs opérations (`use-envois.ts`), s'annonce avec son « Annuler », et signale la frappe à la publication seule
// (AC-a10). Un conflit ouvert refuse tout geste qui écrit, et le dit (HN-E05S08-3, HN-E11S16-7) ; un groupe de plus de
// blocs qu'une page n'en tient aussi (fiche D153). Sans lui, `actions.ts` dépasserait les 300 lignes d'ESLint
// (`coding-standards.md § Complexité`).
import { renderBlocks } from "../../../schemas"
import { BLOCKS_MAX } from "../../../schemas/nodes"
import { copierLeTexte } from "../../components/presse-papiers"
import { nombreLisible } from "../../format/nombres"
import { SELECTION } from "../libelles"
import { verrouille, type EtatDeLEditeur } from "./actions"
import { dansLOrdre, deplacerLeGroupe as deplacerDansLeModele, poserAvant, remettre, retablirLeGroupe, retirerLeGroupe, type GesteDeGroupe } from "./groupe"
import type { Retiree } from "./modele"
import { estLaPageVide } from "./page-vide"

export function gestesDuGroupe(etat: EtatDeLEditeur) {
  const { modele, changerModele, fixes, setErreur, setFocus, envois, annulerLeDiffere, frapper } = etat
  const ordre = () => modele.current.map((rangee) => rangee.cle)
  const memeOrdre = (avant: readonly string[]) => ordre().every((cle, rang) => cle === avant[rang])
  /**
   * Plus de blocs qu'une écriture de l'écran ne porte d'opérations (`BLOCKS_MAX`, fiche D153) : le geste est refusé avant
   * de toucher le modèle, et dit. Une page servie n'en a jamais tant ; seuls des blocs ajoutés sur le poste le pourraient.
   */
  const horsDeLaBorne = (cles: readonly string[]) => {
    if (cles.length <= BLOCKS_MAX) return false
    envois.annoncer(SELECTION.tropDeBlocs(nombreLisible(BLOCKS_MAX)))
    return true
  }
  /** Le groupe déplacé part en `move_block`, en une écriture ; « Annuler » remet l'ordre d'avant (AC-a8). */
  const envoyerLeDeplacement = (cles: readonly string[], avant: readonly string[]) => {
    const deplacees = dansLOrdre(modele.current, cles)
    envois.envoyerDeplacements(deplacees)
    envois.annoncerLeGroupe(SELECTION.deplaces(deplacees.length), { genre: "deplacement", avant, cles: deplacees })
    frapper()
  }

  /**
   * Suppr, Retour arrière, « Supprimer » du menu d'un bloc sélectionné (AC-a6) : tous les blocs partent en une écriture de
   * N `delete_block` ; « Annuler » les rétablit tels qu'ils étaient enregistrés. Un bloc neuf jamais envoyé part sans
   * écriture et ne revient pas, comme par « Supprimer » (HN-E05S02-13). `false` : refusé (un conflit ouvert).
   */
  function supprimerLeGroupe(cles: readonly string[]): boolean {
    if (verrouille(etat) || horsDeLaBorne(cles)) return false
    const retirees = dansLOrdre(modele.current, cles)
    if (retirees.length === 0) return false
    const suite = retirerLeGroupe(modele.current, retirees)
    for (const cle of retirees) {
      annulerLeDiffere(cle)
      setErreur(cle, null)
    }
    changerModele(suite.modele)
    if (suite.focus) setFocus(suite.focus)
    const enregistrees: Retiree[] = suite.retirees.flatMap((retiree) => {
      const fixe = fixes.current.get(retiree.rangee.cle)
      return fixe ? [{ ...retiree, rangee: { cle: retiree.rangee.cle, bloc: fixe } }] : []
    })
    for (const retiree of enregistrees) fixes.current.delete(retiree.rangee.cle)
    if (enregistrees.length > 0) envois.envoyerSuppressions(enregistrees)
    envois.annoncerLeGroupe(SELECTION.supprimes(retirees.length), enregistrees.length > 0 ? { genre: "suppression", retirees: enregistrees } : undefined)
    frapper()
    return true
  }

  /** ⌘C, Ctrl+C (AC-a7) : le markdown des blocs, le même que l'export `.md` (`renderBlocks`), en `text/plain`. */
  async function copierLeGroupe(cles: readonly string[]): Promise<boolean> {
    const copiees = new Set(cles)
    const blocs = modele.current.filter((rangee) => copiees.has(rangee.cle)).map((rangee) => rangee.bloc)
    if (blocs.length === 0) return false
    const copie = await copierLeTexte(renderBlocks(blocs))
    envois.annoncer(copie ? SELECTION.copies(blocs.length) : SELECTION.copieImpossible)
    return copie
  }

  return {
    supprimerLeGroupe,
    copierLeGroupe,
    /** ⌘X, Ctrl+X (AC-a7) : copier, puis supprimer ; une copie refusée ne supprime rien. */
    async couperLeGroupe(cles: readonly string[]): Promise<void> {
      if (verrouille(etat) || horsDeLaBorne(cles)) return
      if (await copierLeGroupe(cles)) supprimerLeGroupe(cles)
    },
    /** ⌥↑, ⌥↓, « Monter », « Descendre » d'un bloc sélectionné (AC-a8) ; `garde` : la rangée dont la poignée garde le focus. */
    deplacerLeGroupe(cles: readonly string[], pas: -1 | 1, garde: string | null) {
      if (verrouille(etat) || horsDeLaBorne(cles)) return
      const avant = ordre()
      changerModele(deplacerDansLeModele(modele.current, cles, pas))
      if (memeOrdre(avant)) return
      if (garde !== null) setFocus({ cle: garde, curseur: null, cible: "rangee" })
      envoyerLeDeplacement(cles, avant)
    },
    /** Le glissé d'une poignée : le groupe posé juste avant la rangée `suivante` (`null` : en fin), le modèle seulement. */
    poserLeGroupe(cles: readonly string[], suivante: string | null) {
      // Un groupe hors de la borne ne bouge pas ; le dépôt le dit.
      if (!envois.conflit && cles.length <= BLOCKS_MAX) changerModele(poserAvant(modele.current, cles, suivante))
    },
    /** Le dépôt du glissé d'un groupe : une écriture de `move_block`, sauf si l'ordre n'a pas changé. */
    deposerLeGroupe(cles: readonly string[], avant: readonly string[]) {
      if (horsDeLaBorne(cles) || memeOrdre(avant)) return
      envoyerLeDeplacement(cles, avant)
    },
    /** Un glissé de groupe interrompu (`pointercancel`) : l'ordre d'avant revient, rien ne part. */
    remettreLeGroupe(avant: readonly string[], cles: readonly string[]) {
      changerModele(remettre(modele.current, avant, cles))
    },
    /** « Annuler » d'un geste de groupe (AC-a6, AC-a8) : les blocs rétablis en une écriture, ou l'ordre d'avant remis. */
    annulerLeGroupe(groupe: GesteDeGroupe) {
      if (groupe.genre === "deplacement") {
        changerModele(remettre(modele.current, groupe.avant, groupe.cles))
        envois.envoyerDeplacements(dansLOrdre(modele.current, groupe.cles))
      } else {
        // Le Texte vide laissé par le dernier bloc retiré cède sa place aux blocs rétablis (E11-S05, AC-g1).
        const suite = retablirLeGroupe(estLaPageVide(modele.current) ? [] : modele.current, groupe.retirees)
        changerModele(suite.modele)
        for (const rangee of suite.modele) if (suite.cles.includes(rangee.cle)) fixes.current.set(rangee.cle, rangee.bloc)
        envois.envoyerInsertions(suite.cles)
        if (suite.cles[0] !== undefined) setFocus({ cle: suite.cles[0], curseur: null, cible: "rangee" })
      }
      envois.fermerAnnonce()
      frapper()
    },
  }
}
