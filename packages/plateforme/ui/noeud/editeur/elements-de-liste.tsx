"use client"

// Les éléments d'une liste de l'éditeur (E11-S06, lot a) : une copie du texte du champ, posée dans sa case
// (`oto-block-pile`), aux classes du champ (police, corps, rembourrage, bordure, largeur, `pre-wrap`), un élément
// par ligne. Le navigateur replie chaque élément de la copie comme il replie le champ : le repère (puce, numéro ou
// case) se pose sur la première ligne de son élément, jamais sur une ligne repliée. Seul le premier niveau reçoit un
// repère dessiné ; un sous-élément garde sa marque écrite (E10-S04, AC-b2 ; HN-E11S06-7).
//
// Au focus, ou sans lien ni marque, la copie est le texte brut, muet (`aria-hidden`, invisible) : le champ se lit au
// travers. Au repos avec des liens ou des marques (E11-S15, AC-b6), elle rend chaque élément par `EnLigne`, visible, liens cliquables, et tient lieu du rendu
// au repos d'un Texte : les repères suivent alors le texte qu'on voit. Les cases restent de vrais `input` nommés,
// hors de la partie muette. Sans elle, une puce, un numéro ou une case se dessinaient par ligne de champ, lignes
// repliées comprises (retour de démo, fiche D132).
//
// Au focus, quand des liens sont réduits à leur titre (story `liens-en-edition`), la copie dessine le texte montré du
// champ, coloré, ligne par ligne, et le champ se tait dessous.
import { EnLigne } from "../rendu-des-blocs"
import { MENU_DU_BLOC } from "../libelles"
import { numerosDeGouttiere } from "./blocs-de-page"
import type { LiensDesBlocs } from "./champ-de-bloc"
import { useGestes } from "./gestes"
import type { Morceau } from "./liens-masques"
import { MorceauxMontres } from "./miroir-des-liens"

/** La puce d'un élément du premier niveau, pendant du disque de la lecture. */
const PUCE = "•"

/** Un élément de la copie : sa ligne, sa place dans le texte du champ, et son repère dessiné (`null` : aucun). */
type ElementDeListe = { ligne: string; debut: number; repere: string | null }

/**
 * Les éléments d'un champ de liste, un par ligne : au premier niveau, le numéro d'une liste numérotée (à partir de
 * `debut`), sinon la puce ; un sous-élément n'a pas de repère (`numerosDeGouttiere`, qui lit les niveaux d'E10-S06).
 */
function elementsDu(texte: string, debut: number | null): ElementDeListe[] {
  const numeros = numerosDeGouttiere(texte, debut ?? 1)
  let place = 0
  return texte.split("\n").map((ligne, rang) => {
    const element = { ligne, debut: place, repere: numeros[rang] === "" ? null : debut === null ? PUCE : numeros[rang] }
    place += ligne.length + 1
    return element
  })
}

type ElementsDeListeProps = {
  cle: string
  texte: string
  /** `list` ou `checklist`, que le design system dessine (`data-kind`). */
  genre: string
  /** Le premier numéro d'une liste numérotée ; `null` pour des puces ou des cases. */
  debut: number | null
  cases: readonly boolean[]
  lectureSeule: boolean
  /** Au repos avec des liens : les liens que lit le rendu ; `null`, la copie muette du texte brut. */
  rendu: LiensDesBlocs | null
  /** Au focus, des liens réduits : les morceaux montrés de chaque ligne, dessinés ; `null` sinon. */
  miroir?: readonly (readonly Morceau[])[] | null
}

/** Une case d'une liste à cocher, nommée par son texte ; elle se coche sans quitter le bloc (E05-S10, AC-a2). */
function Case({ cle, rang, ligne, cochee, lectureSeule }: { cle: string; rang: number; ligne: string; cochee: boolean; lectureSeule: boolean }) {
  const gestes = useGestes()
  return (
    <span className="oto-block-repere">
      <input
        type="checkbox"
        checked={cochee}
        disabled={lectureSeule}
        aria-label={MENU_DU_BLOC.case(ligne)}
        onChange={() => gestes.basculerLaCase(cle, rang)}
        className="oto-block-check"
      />
    </span>
  )
}

function Elements({ cle, texte, genre, debut, cases, lectureSeule, rendu, miroir }: ElementsDeListeProps) {
  return elementsDu(texte, debut).map((element, rang) => (
    // Un élément est un rang de la liste : l'élément 3 reste l'élément 3 quoi qu'on tape dans sa ligne.
    <span key={rang} className="oto-block-element" data-debut={element.debut}>
      {genre === "checklist" ? (
        <Case cle={cle} rang={rang} ligne={element.ligne} cochee={cases[rang] === true} lectureSeule={lectureSeule} />
      ) : (
        element.repere !== null && (
          <span className="oto-block-repere" aria-hidden="true" data-numero={debut !== null ? "" : undefined}>
            <span>{element.repere}</span>
          </span>
        )
      )}
      {miroir ? (
        <span className="oto-block-element-texte" aria-hidden="true">
          <MorceauxMontres morceaux={miroir[rang] ?? []} />
        </span>
      ) : rendu ? (
        <span className="oto-block-element-texte">
          <EnLigne texte={element.ligne} numeroter Lien="a" hrefDuChemin={(chemin) => `${rendu.prefixe}${chemin}`} cibles={rendu.cibles} lecture={rendu.lecture} />
        </span>
      ) : (
        <span className="oto-block-element-texte" aria-hidden="true" data-brut="">
          {element.ligne}
        </span>
      )}
    </span>
  ))
}

/** La copie d'un champ de liste, un élément par ligne, dans la case du champ (`oto-block-pile`). */
export function ElementsDeListe(props: ElementsDeListeProps) {
  return (
    <span className="oto-block-field oto-block-copie" data-kind={props.genre}>
      <Elements {...props} />
    </span>
  )
}
