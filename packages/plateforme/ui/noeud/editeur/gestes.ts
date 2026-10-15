"use client"

// Les gestes de l'éditeur, servis à ses rangées par un contexte (E05-S02, AC22) : une rangée reçoit
// des données, jamais une fonction (`portage-ecrans.md § 2`), et lit ici ce que font ses boutons, son
// champ et son clavier. Sans lui, chaque rangée recevrait une douzaine de rappels en props.
import { createContext, useContext, useInsertionEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent } from "react"
import type { Tableau } from "./blocs-de-page"
import type { Genre } from "./envoi-de-fichier"
import type { OptionDuDepot } from "./gestes-des-fichiers"
import type { PoigneeGlissee } from "./glisser"
import type { GesteDeGroupe } from "./groupe"
import type { BlocEdite, Choix, Forme, Retiree } from "./modele"

export type Gestes = {
  /** La poignée (« Actions sur ce bloc ») se glisse-dépose (E05-S10, AC-a3) ; son clic ouvre le menu du bloc. */
  poignee: PoigneeGlissee
  /** « Dupliquer » (E05-S10, AC-a2) : le même bloc juste après, qui part tout de suite. */
  dupliquer: (cle: string) => void
  /** Une case d'une liste à cocher, cochée ou décochée ; l'état part tout de suite (E05-S10, AC-a2). */
  basculerLaCase: (cle: string, ligne: number) => void
  /**
   * Un collage de plusieurs lignes (E10-S01, AC-a1) : inséré après le bloc entier, en mode tolérant, derrière les
   * écritures en attente ; un bloc vide est remplacé ; puis le brouillon relu.
   */
  insererDuMarkdown: (cle: string, texte: string) => void
  /** Un `.md` lâché sur un bloc (E10-S01, AC-a4) : inséré après lui, comme un collage. */
  deposerUnFichier: (cle: string, fichier: File) => void
  /** « Convertir en tableau de données » d'un tableau simple (E10-S01, AC-b7). */
  convertirEnTableau: (cle: string) => void
  /** « @ » (E05-S10, AC-a9) : le texte où le lien vient d'être inséré, et le curseur après lui. */
  citer: (cle: string, texte: string, curseur: number) => void
  /** Le choix du « + » (E10-S06, AC-a1) : le bloc choisi après celui-ci ; un séparateur part tout de suite. */
  inserer: (cle: string, choix: Choix) => void
  /** « / » (E10-S06, AC-a2) : le Texte devient le bloc choisi ; `colle`, le tableau d'un tableur collé (AC-b3). */
  remplacerParChoix: (cle: string, choix: Choix, colle?: Tableau) => void
  /** Un tableau ou un repli écrit dans ses champs (E10-S06, AC-b1, AC-b4) : il part comme un texte tapé. */
  modifierLeBloc: (cle: string, bloc: BlocEdite) => void
  /** Une phrase dans la ligne d'annonce de l'éditeur (E10-S06, AC-a6, AC-b1) : un geste qui ne change rien, et pourquoi. */
  annoncer: (message: string) => void
  /** Une frappe dans un champ ; `attendreLeChoix` : la liste de « / » est ouverte, le différé n'écrit rien (E10-S06, HN-E10S06-10). */
  saisir: (cle: string, texte: string, attendreLeChoix?: boolean) => void
  toucher: (cle: string, evenement: KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => void
  /** Le focus quitte un champ : son texte part (E05-S08, AC2). */
  quitterLeChamp: (cle: string, evenement: FocusEvent<HTMLElement>) => void
  /** Le focus quitte la rangée : un bloc vidé part en `delete_block` ; un bloc neuf vide reste (E05-S10, AC-a4). */
  quitterLaRangee: (cle: string, evenement: FocusEvent<HTMLElement>) => void
  /** Un appui du pointeur dans la rangée : la sortie de focus qui le suit n'en est pas une (Safari et Firefox macOS, M30). */
  appuyerDansLaRangee: (cle: string) => void
  /** Un champ en lecture seule pendant un conflit reçoit le focus : « Réglez d'abord le bloc en conflit. » (HN-E05S08-3). */
  annoncerLeConflit: () => void
  changerDeForme: (cle: string, forme: Forme) => void
  deplacer: (cle: string, pas: -1 | 1) => void
  supprimer: (cle: string) => void
  annulerLesModifications: (cle: string) => void
  /** Le texte final d'un bloc en conflit, envoyé sur la version enregistrée (AC15). */
  enregistrerLeTexteFinal: (texte: string) => void
  reinsererMonTexte: () => void
  abandonnerMonTexte: () => void
  /** « Réessayer » : la file repart de l'écriture refusée (AC15, AC18). */
  relancer: () => void
  /** « Annuler » d'une suppression (AC12). */
  retablir: (retiree: Retiree) => void
  /** Les dix secondes d'« Annuler » sont passées. */
  oublierLAnnonce: () => void
  /** Le « + » approché ou un geste de fichier : l'état du stockage se lit, une fois (E10-S02, HN-E10S02-6). */
  connaitreLesFichiers: () => void
  /** « Image » ou « Fichier » du « + » (E10-S02, AC-b1, AC-b2) : le dialogue du choix, types et limites dits (AC-b4). */
  choisirUnFichier: (cle: string, quoi: Genre) => void
  /** Le fichier choisi dans ce dialogue : joint après le bloc, sans choix au dépôt (AC-b5). */
  fichierChoisi: (fichier: File) => void
  /** Un fichier lâché sur un bloc (AC-b1, AC-b2, AC-b5) ; stockage désactivé, le dépôt d'E10-S01. */
  deposerUnFichierDansLaPage: (cle: string, fichier: File) => void
  /** Une image collée dans un champ (AC-b1, AC-b7). */
  collerUneImage: (cle: string, fichier: File) => void
  /** « Annuler » un envoi, « Retirer » un envoi refusé (AC-b4). */
  annulerLEnvoi: (cle: string) => void
  /** Le choix au dépôt d'un `.md` ou d'un `.csv` (AC-b5). */
  choisirAuDepot: (option: OptionDuDepot) => void
  /** Le tableau d'un CSV importé : sa référence après le bloc (AC-b5, AC-b6). */
  tableauImporte: (chemin: string) => void
  /** « Convertir en tableau » d'un CSV joint (AC-b6). */
  convertirLeCsv: (cle: string) => void
  /** « Intégration » du « + » ou de « / », ou « Modifier l'adresse » d'un cadre (1.4.3) : le dialogue de son adresse. */
  ouvrirLIntegration: (cle: string, modifier?: boolean, adresse?: string) => void
  /** L'adresse validée du dialogue : le cadre s'écrit après la rangée, ou prend cette adresse (1.4.3). */
  integrer: (url: string) => void
  /** Échap, « Annuler » ou « Fermer » d'un dialogue de fichier : rien ne s'écrit. */
  fermerLeDialogue: () => void
  /** La sélection d'un champ a changé : `totale`, elle couvre tout son texte non vide, le menu de sa poignée s'ouvre (E05-S11, AC-28). */
  selectionner: (cle: string, totale: boolean) => void
  /** Le menu ouvert par une sélection se ferme : Échap, la frappe suivante, un clic ailleurs (AC-28). */
  fermerLeMenu: () => void
  /** ⌘A ou Ctrl+A une seconde fois dans un champ : tous les blocs de la page sont sélectionnés (E11-S17, AC-a2). */
  toutSelectionnerLesBlocs: () => void
  /** Un clic sur la poignée : Maj l'étend à la sélection, Ctrl ou ⌘ l'y ajoute ou l'en retire, seul il ouvre le menu (AC-a4). */
  cliquerLaPoignee: (cle: string, evenement: MouseEvent<HTMLElement>) => void
  /** « Annuler » d'un geste sur une sélection de blocs (AC-a6, AC-a8). */
  annulerLeGroupe: (groupe: GesteDeGroupe) => void
  /** Un bloc lu reçoit le focus (tabulation, toucher) : son champ se monte et prend le focus, le curseur à `curseur` (1.1.3). */
  ouvrirLeChamp: (cle: string, curseur: number) => void
  /** Le champ monté d'un bloc prend le focus, ou son panneau « Lien » s'ouvre : il reste monté quand le pointeur s'en va (1.1.3). */
  activerLeChamp: (cle: string) => void
  /** Le chevron d'un titre : sa section se replie ou se déplie, gardée dans ce navigateur. */
  basculerLePli: (cle: string) => void
}

export const ContexteDesGestes = createContext<Gestes | null>(null)

type Appelable = (...parametres: unknown[]) => unknown

/** Pour chaque geste de `modele` (la poignée comprise, un objet de gestes), une enveloppe qui appelle celui que `lire` rend. */
function enveloppes<T extends object>(modele: T, lire: () => T): T {
  const stables: Record<string, unknown> = {}
  for (const [nom, valeur] of Object.entries(modele)) {
    // Un geste est une fonction, ou un objet de fonctions (`poignee`) ; les deux se relisent par leur nom.
    const courant = () => (lire() as Record<string, unknown>)[nom]
    stables[nom] = typeof valeur === "function" ? (...parametres: unknown[]) => (courant() as Appelable)(...parametres) : enveloppes(valeur as object, courant as () => object)
  }
  // Les mêmes noms que `modele`, chacun une fonction ou un objet de fonctions de même signature.
  return stables as T
}

/**
 * Les gestes servis par le contexte, les mêmes d'un rendu à l'autre : chacun appelle celui du dernier rendu, et un
 * geste ne fige donc jamais un état périmé. Sans eux, chaque rendu de l'éditeur (chaque frappe) rendait à nouveau
 * toutes les rangées, qui lisent ce contexte. Relus avant tout effet de mise en page, ceux des rangées comprises.
 */
export function useGestesStables(courants: Gestes): Gestes {
  const lus = useRef(courants)
  useInsertionEffect(() => {
    lus.current = courants
  })
  const [stables] = useState(() => enveloppes(courants, () => lus.current))
  return stables
}

export function useGestes(): Gestes {
  const gestes = useContext(ContexteDesGestes)
  if (!gestes) throw new Error("useGestes : rangée montée hors de l'éditeur de blocs.")
  return gestes
}
