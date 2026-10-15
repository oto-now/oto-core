// Les gestes de l'éditeur (E05-S02 ; E05-S08, AC2 à AC6) : le champ du bloc touché (1.1.3, qui remplace les champs
// toujours montés de la fiche D21 B ; la sortie de la rangée le démonte), le
// texte d'un bloc qui part quand le focus quitte son champ, sur ⌘S ou après 1 200 ms sans frappe
// (HN-E05S08-1), les gestes de structure (ajouter, scinder, fusionner, déplacer, supprimer, changer de
// forme) qui partent tout de suite, et le clavier. Chaque geste applique une opération pure du modèle
// (`modele.ts`), puis confie à `use-envois.ts` ce qui doit partir. Sans lui, ces règles vivraient dans les
// composants.
//
// Porté d'oto-frontend (`components/editor/block-editor.tsx` ; `use-autosave.ts`). Repris : le différé de
// 1 200 ms, le texte envoyé quand le focus quitte le champ, le focus posé impérativement ; le clavier vit
// dans `clavier.ts`. Retiré : l'enregistrement du corps entier (→ une opération par bloc), le verrou de
// page au conflit (→ conflit au bloc, HN-E05S08-3).
//
// M59 (fiche D104) : une procédure s'écrit comme une page ; les gestes des appels (E05-S04) sont partis.
//
// E05-S10 : chaque geste de la personne est signalé à la file (`frapper`), d'où part la publication seule
// (AC-a6) ; un bloc neuf vide reste quand le focus le quitte, pour qu'on en ajoute plusieurs de suite
// (AC-a4) ; les gestes neufs du menu, du glisser-déposer et de « @ » vivent dans `gestes-du-menu.ts`.
//
// E10-S06 : le « + » insère le bloc choisi, « / » change le Texte en lui (AC-a1, AC-a2) ; un séparateur part tout de
// suite, jamais vide (AC-a4) ; un tableau et un repli, écrits dans leurs propres champs, partent comme un texte.
//
// E10-S02 (lot b) : une image et un fichier joint partent comme un texte (texte alternatif, largeur) ; les gestes des
// fichiers vivent dans `gestes-des-fichiers.ts`.
import type { FocusEvent, RefObject } from "react"
import { EDITEUR } from "../libelles"
import type { Tableau } from "./blocs-de-page"
import { clavier } from "./clavier"
import type { FichiersDeLEditeur } from "./envoi-de-fichier"
import type { Gestes } from "./gestes"
import { gestesDesFichiers } from "./gestes-des-fichiers"
import { gestesDuGroupe } from "./gestes-du-groupe"
import { gestesDuMenu } from "./gestes-du-menu"
import * as modeleDEdition from "./modele"
import { avecTexte, formeDe, type BlocEdite, type Choix, type Focus, type Rangee, type Retiree, type Suite } from "./modele"
import { controler, estVide, SANS_TEXTE } from "./operations"
import { estLaPageVide } from "./page-vide"
import type { useEnvois } from "./use-envois"

export type EtatDeLEditeur = {
  modele: RefObject<Rangee[]>
  changerModele: (modele: Rangee[]) => void
  fixes: RefObject<Map<string, BlocEdite>>
  /** Le message d'un bloc refusé par le contrôle, sous son champ ; `null` l'efface (AC2). */
  setErreur: (cle: string, message: string | null) => void
  setFocus: (focus: Focus | null) => void
  envois: ReturnType<typeof useEnvois>
  /** Un geste de la personne, signalé à la file : la publication seule repart de là (E05-S10, AC-a6). */
  frapper: () => void
  /** Arme le différé de 1 200 ms du champ où l'on tape (HN-E05S08-1) ; `annulerLeDiffere` le désarme. */
  differer: (cle: string) => void
  annulerLeDiffere: (cle: string) => void
  /** Le dernier appui du pointeur dans une rangée, et quand : la sortie d'une rangée qui le suit n'en est pas une (M30). */
  appui: RefObject<{ cle: string; instant: number } | null>
  /** Les fichiers joints (E10-S02) : le stockage, les envois en cours, le dialogue ouvert. */
  fichiers: FichiersDeLEditeur
  /** Le focus a quitté la rangée : son champ se démonte, le bloc se lit (1.1.3). */
  fermerLeChamp: (cle: string) => void
}

const FIN = Number.MAX_SAFE_INTEGER

/**
 * Le temps d'un clic : sous Safari et Firefox macOS, un bouton cliqué ne prend pas le focus, le champ quitté
 * le laisse à `<body>`, et la rangée semblait quittée pendant qu'on y cliquait (M30).
 */
const DUREE_D_UN_APPUI_MS = 500

/** Deux blocs de même contenu : un texte inchangé n'envoie rien (AC2). */
function memeBloc(a: BlocEdite, b: BlocEdite): boolean {
  return a.type === b.type && a.text === b.text && a.key === b.key && JSON.stringify(a.data) === JSON.stringify(b.data)
}

/**
 * Un champ modifié qui n'est pas encore parti (AC5) : son bloc diffère de celui qui est parti, un bloc neuf
 * a du texte. La publication seule l'attend, et quitter l'onglet demande confirmation.
 */
export function aEnvoyer(rangee: Rangee, fixe: BlocEdite | undefined): boolean {
  if (formeDe(rangee.bloc) === null && !SANS_TEXTE.has(rangee.bloc.type)) return false
  return fixe ? !memeBloc(fixe, rangee.bloc) : !estVide(rangee.bloc)
}

/** Un conflit ouvert refuse tout geste de structure jusqu'à son règlement, et le dit (HN-E05S08-3, HN-E05S08-17). */
export function verrouille(etat: EtatDeLEditeur): boolean {
  if (!etat.envois.conflit) return false
  etat.envois.annoncer(EDITEUR.conflitAReglerDAbord)
  return true
}

/**
 * « Supprimer » (AC4) : part `delete_block`, sans confirmation, avec « Annuler » ; un bloc neuf jamais
 * envoyé ne part pas. `ailleurs` : le focus a déjà quitté la rangée (bloc vidé), il reste où il est allé.
 */
function suppression(etat: EtatDeLEditeur) {
  const { modele, changerModele, fixes, setErreur, setFocus, envois, annulerLeDiffere, frapper } = etat
  return (cle: string, ailleurs = false) => {
    if (verrouille(etat)) return
    const suite = modeleDEdition.retirer(modele.current, cle)
    if (!suite.retiree) return
    annulerLeDiffere(cle)
    setErreur(cle, null)
    changerModele(suite.modele)
    if (suite.focus && !ailleurs) setFocus(suite.focus)
    const fixe = fixes.current.get(cle)
    if (!fixe) return
    fixes.current.delete(cle)
    // « Annuler » réinsère le bloc tel qu'il était enregistré (HN-E05S02-13).
    const retiree: Retiree = { ...suite.retiree, rangee: { cle, bloc: fixe } }
    envois.envoyerSuppression(retiree)
    envois.annoncer(EDITEUR.supprime, retiree)
    frapper()
  }
}

/** Ce que devient le texte d'un bloc (AC2) : il part, il attend, ou il se retire. */
function textes(etat: EtatDeLEditeur, supprimer: (cle: string, ailleurs: boolean) => void) {
  const { modele, fixes, setErreur, envois, annulerLeDiffere } = etat
  const trouver = (cle: string) => modele.current.find((rangee) => rangee.cle === cle)
  const refuser = (cle: string, message: string) => {
    setErreur(cle, message)
    return false
  }
  /** Le bloc part : `replace_block`, ou `insert_after` pour un bloc neuf ; identique à ce qui est parti, rien. */
  const partir = (cle: string, bloc: BlocEdite) => {
    const fixe = fixes.current.get(cle)
    setErreur(cle, null)
    if (fixe && memeBloc(fixe, bloc)) return true
    fixes.current.set(cle, bloc)
    if (fixe) envois.envoyerRemplacement(cle)
    else envois.envoyerInsertion(cle)
    return true
  }

  /**
   * Le texte d'un bloc part (AC2) : quand le focus quitte son champ, sur ⌘S, après 1 200 ms sans frappe.
   * Inchangé, rien ne part ; vide, il attend que le focus quitte sa rangée (`retirerSiVide`) ; refusé par
   * le contrôle, son message reste sous le champ ; en conflit, le panneau du conflit écrit à sa place.
   * `false` : refusé.
   */
  function envoyerLeTexte(cle: string): boolean {
    annulerLeDiffere(cle)
    const rangee = trouver(cle)
    if (!rangee || envois.conflit?.cle === cle) return true
    // Un séparateur, sans forme, part quand il est neuf ou qu'il remplace un Texte (E10-S06, AC-a4) ; une image ou un
    // fichier joint, quand son texte alternatif ou sa largeur change (E10-S02, AC-b1, AC-b3).
    if (formeDe(rangee.bloc) === null && !SANS_TEXTE.has(rangee.bloc.type)) return true
    const fixe = fixes.current.get(cle)
    if (estVide(rangee.bloc) || (fixe && memeBloc(fixe, rangee.bloc))) {
      setErreur(cle, null)
      return true
    }
    const controle = controler(rangee.bloc)
    if ("message" in controle) return refuser(cle, controle.message)
    return partir(cle, rangee.bloc)
  }

  /**
   * La rangée quittée (AC2) : un bloc vidé part en `delete_block`, comme par « Supprimer » (avec
   * « Annuler »), sans reprendre le focus parti ailleurs ; un bloc neuf vide reste, sans rien envoyer, pour
   * qu'on en ajoute plusieurs de suite (E05-S10, AC-a4) ; un bloc servi vide reste (HN-E05S08-7).
   */
  function retirerSiVide(cle: string) {
    const rangee = trouver(cle)
    if (!rangee || formeDe(rangee.bloc) === null || !estVide(rangee.bloc)) return
    const fixe = fixes.current.get(cle)
    if (fixe && !estVide(fixe)) supprimer(cle, true)
  }

  return { envoyerLeTexte, retirerSiVide }
}

/** Ajouter, déplacer, rétablir, fusionner, changer de forme, écrire (AC3, AC4). */
function structure(etat: EtatDeLEditeur, envoyerLeTexte: (cle: string) => boolean) {
  const { modele, changerModele, fixes, setErreur, setFocus, envois, differer, annulerLeDiffere, frapper } = etat
  const appliquer = (suite: Suite) => {
    changerModele(suite.modele)
    if (suite.focus) setFocus(suite.focus)
  }
  /** Un séparateur n'a pas de texte à attendre : il part tout de suite (E10-S06, AC-a4) ; un autre bloc attend sa frappe. */
  const partirOuAttendre = (cle: string, choix: Choix) => {
    if (choix === "separateur") envoyerLeTexte(cle)
    else differer(cle)
    frapper()
  }

  return {
    inserer(cle: string, choix: Choix = "texte") {
      if (verrouille(etat)) return
      const suite = modeleDEdition.insererApres(modele.current, cle, choix)
      appliquer(suite)
      if (choix === "separateur" && suite.focus) partirOuAttendre(suite.focus.cle, choix)
    },
    remplacerParChoix(cle: string, choix: Choix, colle?: Tableau) {
      if (verrouille(etat)) return
      annulerLeDiffere(cle)
      appliquer(modeleDEdition.remplacerParChoix(modele.current, cle, choix, colle))
      partirOuAttendre(cle, choix)
    },
    modifierLeBloc(cle: string, bloc: BlocEdite) {
      if (verrouille(etat)) return
      changerModele(modeleDEdition.remplacerLeBloc(modele.current, cle, bloc))
      differer(cle)
      frapper()
    },
    /** « Annuler » (AC4) : le même bloc, sans `id`, après son ancien voisin ; le serveur en fabrique un nouveau. */
    retablirSuppression(retiree: Retiree) {
      // Le Texte vide laissé par le dernier bloc retiré cède sa place au bloc rétabli (E11-S05, AC-g1).
      const suite = modeleDEdition.retablir(estLaPageVide(modele.current) ? [] : modele.current, retiree)
      appliquer(suite)
      const cle = suite.focus?.cle
      if (!cle) return
      fixes.current.set(cle, suite.modele.find((rangee) => rangee.cle === cle)?.bloc ?? retiree.rangee.bloc)
      envois.envoyerInsertion(cle)
      envois.fermerAnnonce()
      frapper()
    },
    /** « Monter », « Descendre », ⌥↑ / ⌥↓ (AC3, AC4) : part `move_block`, sauf pour un bloc neuf jamais envoyé. */
    deplacer(cle: string, pas: -1 | 1) {
      if (verrouille(etat)) return
      const avant = modele.current.findIndex((rangee) => rangee.cle === cle)
      const suite = modeleDEdition.deplacer(modele.current, cle, pas)
      if (suite.modele.findIndex((rangee) => rangee.cle === cle) === avant) return
      appliquer(suite)
      if (fixes.current.has(cle)) envois.envoyerDeplacement(cle)
      frapper()
    },
    /** Fondre `cle` dans le bloc qui le précède (AC3) : `replace_block` du précédent, puis `delete_block` de celui-ci. */
    fondre(cle: string) {
      const suite = modeleDEdition.fusionner(modele.current, cle)
      if (!suite.avec) return suite.focus ? setFocus(suite.focus) : undefined
      const avec = suite.avec
      const fondue = suite.modele.find((rangee) => rangee.cle === avec)?.bloc
      if (!fondue) return
      // Deux textes joints refusés par le contrôle (titre sur deux lignes, trop long) : rien ne fusionne.
      const controle = controler(fondue)
      if ("message" in controle) return setErreur(cle, controle.message)
      const precedent = fixes.current.get(avec)
      const courant = fixes.current.get(cle)
      annulerLeDiffere(cle)
      appliquer(suite)
      // Un bloc vide fondu ne change pas le précédent : rien ne part pour lui.
      if (!estVide(fondue) && (!precedent || !memeBloc(precedent, fondue))) {
        fixes.current.set(avec, fondue)
        if (precedent) envois.envoyerRemplacement(avec)
        else envois.envoyerInsertion(avec)
      }
      if (courant) {
        fixes.current.delete(cle)
        envois.envoyerSuppression({ rangee: { cle, bloc: courant }, voisin: avec, rang: suite.modele.findIndex((rangee) => rangee.cle === avec) + 1 })
      }
      setErreur(cle, null)
      setErreur(avec, null)
      frapper()
    },
    /** Le style du bloc (AC4 ; E05-S10, AC-a2) : le texte suit et part tout de suite (HN-E05S08-1). */
    changerDeForme(cle: string, forme: modeleDEdition.Forme) {
      if (verrouille(etat)) return
      appliquer(modeleDEdition.changerDeForme(modele.current, cle, forme))
      envoyerLeTexte(cle)
      frapper()
    },
    saisir(cle: string, texte: string, attendreLeChoix = false) {
      // « 1. » tapé au début d'un Texte en fait une liste numérotée (AC3).
      const suite = modeleDEdition.ecrireTexte(modele.current, cle, texte)
      appliquer(suite)
      const bloc = suite.modele.find((rangee) => rangee.cle === cle)?.bloc
      // Un Texte devenu séparateur part tout de suite, le Texte neuf d'après a le focus (E10-S06, AC-a4) ; tant que la
      // liste de « / » est ouverte, le Texte attend le choix d'un bloc : le différé ne l'écrit pas, même armé par une
      // frappe d'avant (AC-a2, HN-E10S06-10).
      if (bloc?.type === "divider") partirOuAttendre(cle, "separateur")
      else if (!attendreLeChoix) partirOuAttendre(cle, "texte")
      else {
        annulerLeDiffere(cle)
        frapper()
      }
    },
    /** « Annuler les modifications du bloc » (AC2) : son dernier contenu enregistré revient. */
    annulerLesModifications(cle: string) {
      const rangee = modele.current.find((une) => une.cle === cle)
      if (!rangee) return
      const bloc = fixes.current.get(cle) ?? avecTexte(rangee.bloc, "")
      annulerLeDiffere(cle)
      changerModele(modele.current.map((une) => (une.cle === cle ? { cle, bloc } : une)))
      setErreur(cle, null)
      setFocus({ cle, curseur: FIN })
    },
  }
}

/** Le menu de la poignée, ou le choix du « + », est ouvert : le focus y est parti sans quitter le bloc (E05-S10, AC-a2 ; E10-S06, AC-a1). */
const menuOuvert = (rangee: HTMLElement) => rangee.querySelector('[data-geste="poignee"][aria-expanded="true"], [data-geste="inserer"][aria-expanded="true"]') !== null

/** Les sorties du focus (AC2, AC4) : d'un champ, d'une rangée. */
function sorties(etat: EtatDeLEditeur, envoyerLeTexte: (cle: string) => boolean, retirerSiVide: (cle: string) => void) {
  const { envois, appui } = etat
  /**
   * Un appui du pointeur dans la rangée vient de précéder la sortie, et le focus est resté à la page : on y
   * clique, on ne la quitte pas. Le focus parti sur un autre élément est une vraie sortie. L'appui ne retient
   * qu'une sortie.
   */
  const appuiDans = (cle: string) => {
    const retenue = appui.current !== null && appui.current.cle === cle && Date.now() - appui.current.instant < DUREE_D_UN_APPUI_MS && (document.activeElement === null || document.activeElement === document.body)
    if (retenue) appui.current = null
    return retenue
  }
  return {
    annoncerLeConflit: () => envois.annoncer(EDITEUR.conflitAReglerDAbord),
    appuyerDansLaRangee: (cle: string) => {
      appui.current = { cle, instant: Date.now() }
    },
    /**
     * Le focus quitte un champ : son texte part (AC2). Décidé au tour suivant : un champ remonté (forme
     * changée) ou une rangée déplacée perdent un instant le focus, que l'éditeur leur rend aussitôt ; un
     * champ de la même rangée qui reprend le focus ne quitte pas le bloc (AC8).
     */
    quitterLeChamp(cle: string, evenement: FocusEvent<HTMLElement>) {
      const rangee = evenement.currentTarget.closest("[data-cle]")
      setTimeout(() => {
        const actif = document.activeElement
        if (rangee?.isConnected && actif instanceof HTMLElement && actif.hasAttribute("data-champ") && rangee.contains(actif)) return
        envoyerLeTexte(cle)
      }, 0)
    },
    /** Le focus quitte la rangée (clic ou tabulation au-dehors, hors de son menu) : un bloc vidé se retire (AC2). */
    quitterLaRangee(cle: string, evenement: FocusEvent<HTMLElement>) {
      const rangee = evenement.currentTarget
      const vers = evenement.relatedTarget
      if (vers instanceof Node && rangee.contains(vers)) return
      setTimeout(() => {
        if (rangee.isConnected && (rangee.contains(document.activeElement) || menuOuvert(rangee))) return
        if (appuiDans(cle)) return
        retirerSiVide(cle)
        etat.fermerLeChamp(cle)
      }, 0)
    },
  }
}

/** Ce que l'éditeur arme lui-même, en plus des gestes des rangées : le différé, le départ de la page, le glisser-déposer. */
type ActionsPropres = {
  envoyerLeTexte: (cle: string) => boolean
  glisserDUnRang: (cle: string, pas: -1 | 1) => void
  deposer: (cle: string) => void
}

/** Ce que la sélection de blocs lit, en plus des gestes des rangées (E11-S17, lot a). */
type ActionsDuGroupe = Omit<ReturnType<typeof gestesDuGroupe>, "annulerLeGroupe"> & {
  /** ⌘Z pendant l'annonce d'un geste qu'on peut annuler (AC-a6) : `false`, rien à annuler. */
  annulerLAnnonce: () => boolean
}

/**
 * Les gestes servis aux rangées et aux lignes d'état par le contexte de l'éditeur, sauf la poignée glissée, le
 * menu ouvert par la sélection (E05-S11, AC-28) et la sélection de blocs (E11-S17), que l'éditeur y ajoute ;
 * `ActionsPropres` et `ActionsDuGroupe`, en plus, pour ce que l'éditeur arme lui-même.
 */
export function actionsDeLEditeur(
  etat: EtatDeLEditeur,
): Omit<Gestes, "poignee" | "selectionner" | "fermerLeMenu" | "toutSelectionnerLesBlocs" | "cliquerLaPoignee" | "ouvrirLeChamp" | "activerLeChamp" | "basculerLePli"> &
  ActionsPropres &
  ActionsDuGroupe {
  const supprimer = suppression(etat)
  const { envoyerLeTexte, retirerSiVide } = textes(etat, supprimer)
  const { retablirSuppression, fondre, ...struct } = structure(etat, envoyerLeTexte)
  const { envois } = etat
  const menu = gestesDuMenu(etat, envoyerLeTexte)
  const groupe = gestesDuGroupe(etat)
  return {
    ...struct,
    ...groupe,
    annulerLAnnonce: () => {
      const annonce = envois.annonce
      if (annonce?.retiree) retablirSuppression(annonce.retiree)
      else if (annonce?.groupe) groupe.annulerLeGroupe(annonce.groupe)
      return annonce?.retiree !== undefined || annonce?.groupe !== undefined
    },
    supprimer,
    ...sorties(etat, envoyerLeTexte, retirerSiVide),
    ...menu,
    ...gestesDesFichiers(etat, menu.deposerUnFichier),
    envoyerLeTexte,
    annoncer: (message: string) => envois.annoncer(message),
    toucher: clavier(etat, { envoyerLeTexte, fondre, deplacer: struct.deplacer }),
    retablir: retablirSuppression,
    relancer: envois.relancer,
    oublierLAnnonce: envois.fermerAnnonce,
    abandonnerMonTexte: envois.abandonnerMonTexte,
  }
}
