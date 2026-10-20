"use client"

// Le champ d'un bloc qu'on ne touche pas (1.1.3, qui remplace le champ toujours monté de la fiche D21 B) : son texte
// brut dans un `span` aux classes du champ (`oto-block-field`, `data-kind`), à la même géométrie, sous le rendu au
// repos quand le texte en a un (`data-rendu`, `editeur.css`) ; le dessin reste celui d'un champ hors du focus. Il est
// atteint au clavier et se dit modifiable (`role="textbox"`, nom du champ) ; son focus (tabulation, toucher, geste de
// l'éditeur) monte le `<textarea>` à sa place, curseur au caractère touché, sinon à la fin. Sans lui, chaque bloc
// d'une page montait son `<textarea>`, et une page de trois cents blocs se figeait plusieurs secondes à l'ouverture.
//
// 1.1.4 : un diagramme non vide se lit au repos comme à l'écran de lecture (`DiagrammeAuRepos`).
import { useRef, type ReactNode } from "react"
import { EnLigne } from "../rendu-des-blocs"
import type { LiensDesBlocs } from "./champ-de-bloc"

/**
 * Le rang, dans le texte brut du champ au repos, du caractère sous le pointeur (le rendu posé dessus laisse passer le
 * pointeur) ; `null` hors du texte, ou sans l'API du navigateur (jsdom).
 */
function rangSousLePointeur(element: HTMLElement, x: number, y: number): number | null {
  const document = element.ownerDocument
  const position = typeof document.caretPositionFromPoint === "function" ? document.caretPositionFromPoint(x, y) : null
  const plage = position === null && typeof document.caretRangeFromPoint === "function" ? document.caretRangeFromPoint(x, y) : null
  const noeud = position?.offsetNode ?? plage?.startContainer
  const rang = position?.offset ?? plage?.startOffset
  // Le texte brut est le premier enfant du champ au repos ; l'invite et le saut de ligne final n'en sont pas.
  return noeud !== undefined && noeud === element.firstChild && noeud.nodeType === Node.TEXT_NODE && rang !== undefined ? rang : null
}

/** Le temps d'un toucher, de l'appui au focus qu'il donne après le lâcher. */
const DUREE_D_UN_TOUCHER_MS = 1_000

type ChampAuReposProps = {
  texte: string
  nom: string
  genre: string
  decritPar?: string
  lectureSeule: boolean
  /** Le rendu du texte est posé dessus : le texte brut se tait (`editeur.css`). */
  rendu: boolean
  invite?: string
  /** Le focus arrive : le champ se monte, curseur à `curseur`. */
  ouvrir: (curseur: number) => void
}

export function ChampAuRepos({ texte, nom, genre, decritPar, lectureSeule, rendu, invite, ouvrir }: ChampAuReposProps) {
  // Le caractère touché par l'appui qui précède le focus (au doigt ; à la souris, le champ est déjà monté au survol). Au
  // doigt, le focus suit le lâcher : l'appui vaut jusqu'au focus, une seconde au plus, et un appui annulé ne vaut rien.
  const touche = useRef<{ rang: number | null; instant: number } | null>(null)
  return (
    <span
      role="textbox"
      aria-multiline="true"
      aria-label={nom}
      aria-describedby={decritPar}
      aria-readonly={lectureSeule || undefined}
      aria-placeholder={invite}
      tabIndex={0}
      data-champ=""
      data-au-repos=""
      data-kind={genre}
      data-rendu={rendu ? "" : undefined}
      className="oto-block-field focus-visible:outline-hidden!"
      onPointerDown={(evenement) => {
        touche.current = { rang: rangSousLePointeur(evenement.currentTarget, evenement.clientX, evenement.clientY), instant: Date.now() }
      }}
      onPointerCancel={() => {
        touche.current = null
      }}
      onFocus={() => {
        const appui = touche.current
        touche.current = null
        ouvrir(appui !== null && Date.now() - appui.instant < DUREE_D_UN_TOUCHER_MS ? (appui.rang ?? texte.length) : texte.length)
      }}
    >
      {texte}
      {/* Un texte vide ou fini par un saut de ligne garde sa dernière ligne, comme dans le `<textarea>`. */}
      {texte === "" && invite ? (
        <span className="oto-block-invite" aria-hidden="true">
          {invite}
        </span>
      ) : texte === "" || texte.endsWith("\n") ? (
        <br />
      ) : null}
    </span>
  )
}

type DiagrammeAuReposProps = {
  nom: string
  decritPar?: string
  /** Le focus arrive sur le bloc lui-même : le champ du code se monte, curseur à la fin. */
  ouvrir: () => void
  /** Le diagramme tel qu'à la lecture (`RenduDUnBloc`) : le dessin, puis « Voir le code » replié. */
  children: ReactNode
}

/**
 * Un diagramme non vide au repos (1.1.4) : lu comme à la lecture, pas en texte. Un groupe nommé comme le champ, et non
 * une zone de texte ni un bouton : il contient le `<details>` de « Voir le code », qu'aucun de ces deux rôles ne peut
 * contenir. Son propre focus (tabulation, clic sur le dessin, geste de l'éditeur) monte le champ du code ; celui de
 * « Voir le code », qui garde son repli, ne le monte pas.
 */
export function DiagrammeAuRepos({ nom, decritPar, ouvrir, children }: DiagrammeAuReposProps) {
  return (
    <div
      role="group"
      aria-label={nom}
      aria-describedby={decritPar}
      tabIndex={0}
      data-champ=""
      data-au-repos=""
      className="cursor-pointer focus-visible:outline-hidden!"
      onFocus={(evenement) => {
        if (evenement.target === evenement.currentTarget) ouvrir()
      }}
    >
      {children}
    </div>
  )
}

/**
 * Le texte d'un champ en place au repos (le résumé et le corps d'un repli, une cellule de tableau), rendu sur lui comme
 * en lecture (marques, liens), dans la même case (`oto-block-pile`) : ses classes lui donnent la géométrie du champ.
 */
export function RenduAuRepos({ texte, liens }: { texte: string; liens: LiensDesBlocs }) {
  return (
    <span className="oto-inline-field oto-block-rendu">
      <EnLigne texte={texte} Lien="a" hrefDuChemin={(chemin) => `${liens.prefixe}${chemin}`} cibles={liens.cibles} lecture={liens.lecture} />
    </span>
  )
}
