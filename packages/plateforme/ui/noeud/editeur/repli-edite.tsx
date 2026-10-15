"use client"

// Un repli dans l'éditeur (E10-S06, AC-b4) : deux champs, le résumé (une ligne) puis le corps (plusieurs lignes).
// `Entrée` dans le résumé passe au corps ; Retour arrière dans le corps vide revient au résumé ; Échap, ⌘S et ⌥↑ / ⌥↓
// sont ceux de tout bloc (`clavier.ts`). Il part comme un Texte, quand le focus quitte le repli, sur ⌘S ou 1 200 ms
// après la dernière frappe ; un résumé vide, un repli dans le corps, sont refusés par le contrôle (`operations.ts`),
// le message sous le champ. Sans lui, un repli ne s'écrit que par un assistant.
//
// Le menu dépliant s'écrit dans le dessin de la lecture (`DepliantLu`, `plis-lus.tsx`) : chevron à gauche, sans fond
// ni filet, le corps décalé de la largeur du chevron (`.oto-depliant`, `content.css`), sur une `div`, un champ ne vivant
// pas dans un `<summary>` qui replie au clic. Chaque champ est en place (`oto-inline-field`) : au repos, son texte se
// lit comme en lecture, marques et liens compris, comme un Texte (`oto-block-pile`) ; sa bordure paraît au survol et au
// focus (`editeur.css`). Le chevron replie et déplie le corps : replié à l'ouverture de la page, sauf s'il a été
// gardé ouvert dans ce navigateur (`plis-gardes.ts`) ; un menu qu'on vient d'insérer est ouvert.
import { useId, useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from "react"
import { IconButton } from "../../ds/react/primitives"
import { uneLigne } from "../en-tete-modifiable"
import { aDuBalisage } from "../en-ligne"
import { REPLI_EDITE } from "../libelles"
import { usePliGarde } from "../plis-gardes"
import { GlypheDuPli } from "../plis-lus"
import { EnLigne } from "../rendu-des-blocs"
import type { LiensDesBlocs } from "./champ-de-bloc"
import { useGestes } from "./gestes"
import type { BlocEdite } from "./modele"

type RepliEditeProps = { cle: string; bloc: BlocEdite; mots: string; decritPar?: string; lectureSeule: boolean; liens: LiensDesBlocs }

/** Les lignes du corps : sa hauteur suit son texte, avant toute mesure (`field-sizing: content`). */
const lignesDuCorps = (corps: string) => Math.max(2, corps.split("\n").length)

/** Le texte d'un champ au repos, rendu sur lui comme en lecture (marques, liens), dans la même case : ses classes lui donnent la géométrie du champ. */
function AuRepos({ texte, liens }: { texte: string; liens: LiensDesBlocs }) {
  return (
    <span className="oto-inline-field oto-block-rendu">
      <EnLigne texte={texte} Lien="a" hrefDuChemin={(chemin) => `${liens.prefixe}${chemin}`} cibles={liens.cibles} lecture={liens.lecture} />
    </span>
  )
}

export function RepliEdite({ cle, bloc, mots, decritPar, lectureSeule, liens }: RepliEditeProps) {
  const gestes = useGestes()
  const resume = useRef<HTMLTextAreaElement>(null)
  const corps = useRef<HTMLTextAreaElement>(null)
  const chevron = useRef<HTMLButtonElement>(null)
  const idDuCorps = useId()
  const [ouvert, setOuvert] = usePliGarde(bloc.id, bloc.id === undefined)
  // `Entrée` dans le résumé d'un repli replié : le corps se déplie, puis prend le focus une fois rendu.
  const [versLeCorps, setVersLeCorps] = useState(false)
  const texteDuResume = typeof bloc.data.summary === "string" ? bloc.data.summary : ""
  const texteDuCorps = bloc.text ?? ""
  const ecrire = (nouveauResume: string, nouveauCorps: string) => gestes.modifierLeBloc(cle, { ...bloc, text: nouveauCorps, data: { ...bloc.data, summary: nouveauResume } })
  const aller = (champ: HTMLTextAreaElement | null, curseur: number) => {
    champ?.focus()
    champ?.setSelectionRange(curseur, curseur)
  }

  useLayoutEffect(() => {
    if (!versLeCorps) return
    setVersLeCorps(false)
    aller(corps.current, 0)
  }, [versLeCorps])

  const toucherLeResume = (evenement: KeyboardEvent<HTMLTextAreaElement>) => {
    if (evenement.key !== "Enter") return gestes.toucher(cle, evenement)
    evenement.preventDefault()
    setOuvert(true)
    setVersLeCorps(true)
  }
  // Retour arrière dans un corps vide revient au résumé (AC-b4) ; dans un corps écrit, il reste au corps.
  const toucherLeCorps = (evenement: KeyboardEvent<HTMLTextAreaElement>) => {
    if (evenement.key !== "Backspace" || evenement.currentTarget.value !== "") return gestes.toucher(cle, evenement)
    evenement.preventDefault()
    aller(resume.current, texteDuResume.length)
  }
  // Le chevron est dans le repli : y passer n'envoie rien ; le focus qui quitte le repli depuis lui l'envoie.
  const quitter = (evenement: FocusEvent<HTMLElement>) => {
    if (evenement.relatedTarget !== chevron.current) gestes.quitterLeChamp(cle, evenement)
  }
  // Un autre bloc est en conflit : le repli se lit, et le dit (HN-E05S08-3).
  const auFocus = lectureSeule ? gestes.annoncerLeConflit : undefined
  const resumeAuRepos = aDuBalisage(texteDuResume)
  const corpsAuRepos = aDuBalisage(texteDuCorps)
  const champ = "oto-inline-field field-sizing-content focus-visible:ring-2 focus-visible:ring-ink"

  return (
    <div className="oto-depliant" data-open={ouvert ? "" : undefined} data-vide={texteDuCorps.trim() === "" ? "" : undefined}>
      <div className="oto-depliant-tete">
        <IconButton ref={chevron} size="sm" className="oto-pli-bouton" label={REPLI_EDITE.plier(ouvert, mots)} aria-expanded={ouvert} aria-controls={idDuCorps} onClick={() => setOuvert(!ouvert)} onBlur={quitter}>
          <GlypheDuPli />
        </IconButton>
        <span className="oto-block-pile oto-depliant-resume">
          <textarea
            ref={resume}
            data-champ=""
            data-rendu={resumeAuRepos ? "" : undefined}
            rows={1}
            aria-label={REPLI_EDITE.resume(mots)}
            aria-describedby={decritPar}
            readOnly={lectureSeule}
            value={texteDuResume}
            className={champ}
            onChange={(evenement) => ecrire(uneLigne(evenement.target.value), texteDuCorps)}
            onKeyDown={toucherLeResume}
            onFocus={auFocus}
            onBlur={quitter}
          />
          {resumeAuRepos && <AuRepos texte={texteDuResume} liens={liens} />}
        </span>
      </div>
      <div id={idDuCorps} className="oto-depliant-corps" hidden={!ouvert}>
        <span className="oto-block-pile text-sm text-ink">
          <textarea
            ref={corps}
            data-champ=""
            data-rendu={corpsAuRepos ? "" : undefined}
            rows={lignesDuCorps(texteDuCorps)}
            aria-label={REPLI_EDITE.corps(mots)}
            aria-describedby={decritPar}
            readOnly={lectureSeule}
            value={texteDuCorps}
            className={champ}
            onChange={(evenement) => ecrire(texteDuResume, evenement.target.value)}
            onKeyDown={toucherLeCorps}
            onFocus={auFocus}
            onBlur={quitter}
          />
          {corpsAuRepos && <AuRepos texte={texteDuCorps} liens={liens} />}
        </span>
      </div>
    </div>
  )
}
