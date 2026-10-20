"use client"

// Un tableau simple dans l'éditeur (E10-S06, AC-b1, AC-b2) : une grille de champs d'une ligne, l'en-tête d'abord,
// chaque cellule nommée par son en-tête. `Tab` et `Maj+Tab` passent à la cellule suivante ou précédente, `Tab` dans la
// dernière ajoute une rangée, `Entrée` descend d'une cellule ; Échap, ⌘S et ⌥↑ / ⌥↓ sont ceux de tout bloc
// (`clavier.ts`). Le tableau part en un seul bloc quand le focus le quitte, sur ⌘S ou 1 200 ms après la dernière
// frappe, comme un Texte (HN-E10S06-4) ; le menu de sa poignée ajoute, retire et aligne à la cellule courante, que
// la rangée tient. Sans lui, un tableau simple ne s'écrit que par un assistant.
//
// Écrit dans le style d'oto-frontend, qui n'a pas de tableau éditable : les classes du rendu d'E10-S04
// (`oto-table-wrap`, `oto-table`), un champ en place par cellule (un `Input` du design system jusqu'à la 1.4.11).
//
// E11-S15 (AC-b1) : le tableau simple (`data-simple`, `editeur.css`) a son en-tête sur le fond teinté du primary, et la
// bordure d'une cellule n'y paraît qu'au survol de la cellule ou au focus de son champ.
//
// 1.4.11 : une cellule est un champ en place qui va à la ligne (sa largeur suit son texte jusqu'à `--table-cell-max`,
// `editeur.css`) ; au repos, son texte se lit comme en lecture, liens compris (`RenduAuRepos`) ; « @ » y cite un
// contenu, la liste ouverte sous le tableau (`citer.tsx`). Une cellule tient sur une ligne de markdown : un saut de
// ligne collé y devient un blanc.
import { useId, useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from "react"
import { simpleTableOf } from "../../../schemas/blocks"
import type { MenuItem } from "../../ds/react/overlays"
import { aDuBalisage } from "../en-ligne"
import { TABLEAU_EDITE } from "../libelles"
import {
  ajouterColonne,
  ajouterRangee,
  aligner,
  avecTableau,
  celluleVoisine,
  ecrireCellule,
  retirerColonne,
  retirerRangee,
  type Alignement,
  type Borne,
  type Position,
  type Tableau,
} from "./blocs-de-page"
import type { LiensDesBlocs } from "./champ-de-bloc"
import { RenduAuRepos } from "./champ-au-repos"
import { idDOption, ListeACiter, useCitation } from "./citer"
import { useGestes, type Gestes } from "./gestes"
import type { BlocEdite } from "./modele"
import { MESSAGES_DU_BLOC } from "./operations"

/** Le texte d'une cellule suit l'alignement de sa colonne, comme à la lecture. */
const CLASSE_D_ALIGNEMENT: Record<Exclude<Alignement, null>, string> = { left: "text-start", center: "text-center", right: "text-end" }

/** Le texte d'une cellule : l'en-tête à la ligne 0, puis les rangées. */
const texteDeLaCellule = (tableau: Tableau, { ligne, colonne }: Position) => (ligne === 0 ? tableau.columns[colonne] : (tableau.rows[ligne - 1]?.[colonne] ?? ""))

/** Une cellule tient sur une ligne de markdown : un saut de ligne (collé) y devient un blanc. */
const surUneLigne = (texte: string) => texte.replace(/[\r\n]+/g, " ")

/** La cellule courante, ramenée dans le tableau (une rangée ou une colonne a pu partir). */
function dansLeTableau(tableau: Tableau, { ligne, colonne }: Position): Position {
  return { ligne: Math.min(ligne, tableau.rows.length), colonne: Math.min(colonne, tableau.columns.length - 1) }
}

/** Le nom d'une cellule (AC-b1) : l'en-tête de sa colonne, ou son rang s'il est vide, puis sa rangée. */
function nomDeCellule(tableau: Tableau, { ligne, colonne }: Position): string {
  if (ligne === 0) return TABLEAU_EDITE.enTete(colonne + 1)
  const enTete = tableau.columns[colonne]?.trim() || TABLEAU_EDITE.colonne(colonne + 1)
  return TABLEAU_EDITE.cellule(enTete, ligne)
}

/** Le tableau changé, reposé dans le bloc, ou la borne dite (AC-b1) ; `true` s'il a changé. */
function ecrire(gestes: Gestes, cle: string, bloc: BlocEdite, suivant: Tableau | Borne): boolean {
  if ("borne" in suivant) {
    gestes.annoncer(MESSAGES_DU_BLOC[suivant.borne])
    return false
  }
  gestes.modifierLeBloc(cle, { ...bloc, data: avecTableau(bloc.data, suivant) })
  return true
}

/**
 * Le menu de la poignée d'un tableau (AC-b2) : une rangée ou une colonne après la cellule courante, retirer sa rangée
 * (jamais l'en-tête) ou sa colonne (jamais la dernière), l'alignement de sa colonne.
 */
export function itemsDuTableau(cle: string, bloc: BlocEdite, courante: Position, gestes: Gestes): MenuItem[] {
  const tableau = simpleTableOf(bloc.data)
  const { ligne, colonne } = dansLeTableau(tableau, courante)
  const alignement = tableau.align?.[colonne] ?? null
  const alignements: [Alignement, string][] = [
    [null, TABLEAU_EDITE.alignements.aucun],
    ["left", TABLEAU_EDITE.alignements.left],
    ["center", TABLEAU_EDITE.alignements.center],
    ["right", TABLEAU_EDITE.alignements.right],
  ]
  return [
    { group: TABLEAU_EDITE.tableau },
    { label: TABLEAU_EDITE.ajouterRangee, onSelect: () => ecrire(gestes, cle, bloc, ajouterRangee(tableau, ligne)) },
    { label: TABLEAU_EDITE.ajouterColonne, onSelect: () => ecrire(gestes, cle, bloc, ajouterColonne(tableau, colonne)) },
    { label: TABLEAU_EDITE.retirerRangee, disabled: ligne === 0, onSelect: () => ecrire(gestes, cle, bloc, retirerRangee(tableau, ligne)) },
    { label: TABLEAU_EDITE.retirerColonne, disabled: tableau.columns.length <= 1, onSelect: () => ecrire(gestes, cle, bloc, retirerColonne(tableau, colonne)) },
    { group: TABLEAU_EDITE.alignement },
    ...alignements.map(([valeur, label]) => ({ label, radio: true, checked: valeur === alignement, onSelect: () => ecrire(gestes, cle, bloc, aligner(tableau, colonne, valeur)) })),
  ]
}

/** La liste de « @ » ouverte pour une cellule : son `id` et l'option active, que la cellule désigne. */
type ListeOuverte = { position: Position; id: string; active?: string }

type CelluleProps = {
  tableau: Tableau
  position: Position
  decritPar?: string
  lectureSeule: boolean
  liens: LiensDesBlocs
  liste: ListeOuverte | null
  surFrappe: (position: Position, texte: string, curseur: number) => void
  surTouche: (position: Position, evenement: KeyboardEvent<HTMLTextAreaElement>) => void
  surFocus: (position: Position) => void
  surSortie: (evenement: FocusEvent<HTMLElement>) => void
}

function Cellule({ tableau, position, decritPar, lectureSeule, liens, liste, surFrappe, surTouche, surFocus, surSortie }: CelluleProps) {
  const { ligne, colonne } = position
  const alignement = tableau.align?.[colonne] ?? null
  const texte = texteDeLaCellule(tableau, position)
  const rendu = aDuBalisage(texte)
  // La liste de « @ » n'est désignée que par la cellule où elle s'est ouverte.
  const ouverte = liste && liste.position.ligne === ligne && liste.position.colonne === colonne ? liste : null
  return (
    <span className="oto-block-pile oto-cellule-editee">
      <textarea
        rows={1}
        data-champ=""
        data-cellule={`${ligne}-${colonne}`}
        data-rendu={rendu ? "" : undefined}
        aria-label={nomDeCellule(tableau, position)}
        aria-describedby={decritPar}
        aria-autocomplete={ouverte ? "list" : undefined}
        aria-controls={ouverte?.id}
        aria-activedescendant={ouverte?.active}
        readOnly={lectureSeule}
        value={texte}
        className={`oto-inline-field field-sizing-content focus-visible:ring-2 focus-visible:ring-ink ${alignement ? CLASSE_D_ALIGNEMENT[alignement] : ""}`}
        onChange={(evenement) => surFrappe(position, surUneLigne(evenement.target.value), evenement.target.selectionStart)}
        onKeyDown={(evenement) => surTouche(position, evenement)}
        onFocus={() => surFocus(position)}
        onBlur={surSortie}
      />
      {rendu && <RenduAuRepos texte={texte} liens={liens} />}
    </span>
  )
}

type LignesProps = Omit<CelluleProps, "position">

/** L'en-tête, une cellule par colonne. */
function EnTetes(props: LignesProps) {
  return props.tableau.columns.map((_, colonne) => (
    // Une cellule n'a pas d'identité : son rang, dans un tableau qui a la sienne.
    <th key={colonne} scope="col">
      <Cellule {...props} position={{ ligne: 0, colonne }} />
    </th>
  ))
}

/** Les rangées, une cellule par colonne. */
function Rangees(props: LignesProps) {
  return props.tableau.rows.map((_, rang) => (
    <tr key={rang}>
      {props.tableau.columns.map((__, colonne) => (
        <td key={colonne}>
          <Cellule {...props} position={{ ligne: rang + 1, colonne }} />
        </td>
      ))}
    </tr>
  ))
}

type TableauEditeProps = {
  cle: string
  bloc: BlocEdite
  decritPar?: string
  lectureSeule: boolean
  liens: LiensDesBlocs
  /** La cellule qui a eu le focus en dernier : le menu de la poignée y ajoute et y retire (AC-b2). */
  suivre: (position: Position) => void
}

export function TableauEdite({ cle, bloc, decritPar, lectureSeule, liens, suivre }: TableauEditeProps) {
  const gestes = useGestes()
  const grille = useRef<HTMLTableElement>(null)
  const [aFocaliser, setAFocaliser] = useState<(Position & { curseur?: number }) | null>(null)
  const tableau = simpleTableOf(bloc.data)
  const idDeLaListe = useId()
  // La cellule où « @ » a été tapé : la liste cite dans son texte.
  const [citee, setCitee] = useState<Position | null>(null)
  const citation = useCitation(citee ? texteDeLaCellule(tableau, citee) : "", (nouveau, curseur) => {
    if (!citee || !ecrire(gestes, cle, bloc, ecrireCellule(tableau, citee, nouveau))) return
    setAFocaliser({ ...citee, curseur })
  })
  const liste = citation.ouverte && citee ? { position: citee, id: idDeLaListe, active: citation.aDesOptions ? idDOption(idDeLaListe, citation.actif) : undefined } : null

  // La cellule où va le focus après `Tab`, `Entrée`, une rangée ajoutée ou un lien cité, une fois la grille rendue.
  useLayoutEffect(() => {
    if (!aFocaliser) return
    setAFocaliser(null)
    const champ = grille.current?.querySelector<HTMLTextAreaElement>(`[data-cellule="${aFocaliser.ligne}-${aFocaliser.colonne}"]`)
    champ?.focus()
    if (aFocaliser.curseur !== undefined) champ?.setSelectionRange(aFocaliser.curseur, aFocaliser.curseur)
  }, [aFocaliser])

  const surTouche = (position: Position, evenement: KeyboardEvent<HTMLTextAreaElement>) => {
    if (citation.toucher(evenement)) return
    const tabulation = evenement.key === "Tab" && !evenement.altKey && !evenement.ctrlKey && !evenement.metaKey
    const voisine = tabulation ? celluleVoisine(tableau, position, evenement.shiftKey ? -1 : 1) : null
    if (voisine) {
      evenement.preventDefault()
      return setAFocaliser(voisine)
    }
    // `Tab` dans la dernière cellule ajoute une rangée ; `Maj+Tab` dans la première sort du tableau.
    if (tabulation && !evenement.shiftKey && !lectureSeule) {
      evenement.preventDefault()
      if (ecrire(gestes, cle, bloc, ajouterRangee(tableau, tableau.rows.length))) setAFocaliser({ ligne: tableau.rows.length + 1, colonne: 0 })
      return
    }
    if (evenement.key === "Enter") {
      evenement.preventDefault()
      if (position.ligne < tableau.rows.length) setAFocaliser({ ligne: position.ligne + 1, colonne: position.colonne })
      return
    }
    gestes.toucher(cle, evenement)
  }
  const cellules: LignesProps = {
    tableau,
    decritPar,
    lectureSeule,
    liens,
    liste,
    surFrappe: (position, texte, curseur) => {
      ecrire(gestes, cle, bloc, ecrireCellule(tableau, position, texte))
      setCitee(position)
      citation.suivre(texte, curseur)
    },
    surTouche,
    // Un autre bloc est en conflit : la cellule se lit, et le dit (HN-E05S08-3).
    surFocus: (position) => (lectureSeule ? gestes.annoncerLeConflit() : suivre(position)),
    surSortie: (evenement) => {
      citation.fermer()
      gestes.quitterLeChamp(cle, evenement)
    },
  }

  return (
    <>
      <div className="oto-table-wrap">
        <table ref={grille} className="oto-table" data-simple="">
          <thead>
            <tr>
              <EnTetes {...cellules} />
            </tr>
          </thead>
          <tbody>
            <Rangees {...cellules} />
          </tbody>
        </table>
      </div>
      {liste && <ListeACiter id={liste.id} resultat={citation.resultat} actif={citation.actif} choisir={citation.choisir} />}
    </>
  )
}
