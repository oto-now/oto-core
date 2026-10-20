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
//
// 1.4.11 : « @ » dans le corps ouvre sous lui la liste des contenus à citer, comme dans un Texte (`citer.tsx`). 1.4.12 : au
// focus, les liens du résumé et du corps se montrent réduits à leur titre, comme dans un Texte (`useChampEnPlace`).
import { useId, useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from "react"
import { IconButton } from "../../ds/react/primitives"
import { uneLigne } from "../en-tete-modifiable"
import { aDuBalisage } from "../en-ligne"
import { REPLI_EDITE } from "../libelles"
import { usePliGarde } from "../plis-gardes"
import { GlypheDuPli } from "../plis-lus"
import type { LiensDesBlocs } from "./champ-de-bloc"
import { RenduAuRepos } from "./champ-au-repos"
import { useChampEnPlace } from "./champ-en-place"
import { idDOption, ListeACiter, useCitation } from "./citer"
import { useGestes } from "./gestes"
import { placeDansLeChamp } from "./liens-masques"
import type { BlocEdite } from "./modele"

type RepliEditeProps = { cle: string; bloc: BlocEdite; mots: string; decritPar?: string; lectureSeule: boolean; liens: LiensDesBlocs }

/** Les lignes du corps : sa hauteur suit son texte, avant toute mesure (`field-sizing: content`). */
const lignesDuCorps = (corps: string) => Math.max(2, corps.split("\n").length)

export function RepliEdite({ cle, bloc, mots, decritPar, lectureSeule, liens }: RepliEditeProps) {
  const gestes = useGestes()
  const resume = useRef<HTMLTextAreaElement>(null)
  const corps = useRef<HTMLTextAreaElement>(null)
  const chevron = useRef<HTMLButtonElement>(null)
  const idDuCorps = useId()
  const idDeLaListe = useId()
  const [ouvert, setOuvert] = usePliGarde(bloc.id, bloc.id === undefined)
  // `Entrée` dans le résumé d'un repli replié : le corps se déplie, puis prend le focus une fois rendu.
  const [versLeCorps, setVersLeCorps] = useState(false)
  // Le curseur à poser dans le corps une fois le lien cité écrit.
  const [curseurDuCorps, setCurseurDuCorps] = useState<number | null>(null)
  const texteDuResume = typeof bloc.data.summary === "string" ? bloc.data.summary : ""
  const texteDuCorps = bloc.text ?? ""
  const ecrire = (nouveauResume: string, nouveauCorps: string) => gestes.modifierLeBloc(cle, { ...bloc, text: nouveauCorps, data: { ...bloc.data, summary: nouveauResume } })
  // Le curseur est en position de la source : sa place dans le texte montré, liens réduits (`placeDansLeChamp`).
  const aller = (champ: HTMLTextAreaElement | null, curseur: number) => {
    champ?.focus()
    if (champ) champ.setSelectionRange(placeDansLeChamp(champ, curseur), placeDansLeChamp(champ, curseur))
  }

  const citation = useCitation(texteDuCorps, (nouveau, curseur) => {
    ecrire(texteDuResume, nouveau)
    setCurseurDuCorps(curseur)
  })
  const resumeEnPlace = useChampEnPlace(texteDuResume, resume, lectureSeule, (source) => ecrire(uneLigne(source), texteDuCorps))
  const corpsEnPlace = useChampEnPlace(texteDuCorps, corps, lectureSeule, (source, curseur) => {
    ecrire(texteDuResume, source)
    citation.suivre(source, curseur)
  })

  useLayoutEffect(() => {
    if (!versLeCorps) return
    setVersLeCorps(false)
    aller(corps.current, 0)
  }, [versLeCorps])

  useLayoutEffect(() => {
    if (curseurDuCorps === null) return
    setCurseurDuCorps(null)
    aller(corps.current, curseurDuCorps)
  }, [curseurDuCorps])

  const toucherLeResume = (evenement: KeyboardEvent<HTMLTextAreaElement>) => {
    if (evenement.key !== "Enter") return gestes.toucher(cle, evenement)
    evenement.preventDefault()
    setOuvert(true)
    setVersLeCorps(true)
  }
  // Retour arrière dans un corps vide revient au résumé (AC-b4) ; dans un corps écrit, il reste au corps.
  const toucherLeCorps = (evenement: KeyboardEvent<HTMLTextAreaElement>) => {
    if (citation.toucher(evenement)) return
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
            {...resumeEnPlace.champ}
            className={champ}
            onKeyDown={toucherLeResume}
            onFocus={() => {
              resumeEnPlace.suivreLeFocus(true)
              auFocus?.()
            }}
            onBlur={(evenement) => {
              resumeEnPlace.suivreLeFocus(false)
              quitter(evenement)
            }}
          />
          {resumeAuRepos && <RenduAuRepos texte={texteDuResume} liens={liens} />}
          {resumeEnPlace.miroir}
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
            aria-autocomplete={citation.ouverte ? "list" : undefined}
            aria-controls={citation.ouverte ? idDeLaListe : undefined}
            aria-activedescendant={citation.ouverte && citation.aDesOptions ? idDOption(idDeLaListe, citation.actif) : undefined}
            readOnly={lectureSeule}
            {...corpsEnPlace.champ}
            className={champ}
            onKeyDown={toucherLeCorps}
            onFocus={() => {
              corpsEnPlace.suivreLeFocus(true)
              auFocus?.()
            }}
            onBlur={(evenement) => {
              corpsEnPlace.suivreLeFocus(false)
              citation.fermer()
              quitter(evenement)
            }}
          />
          {corpsAuRepos && <RenduAuRepos texte={texteDuCorps} liens={liens} />}
          {corpsEnPlace.miroir}
        </span>
        {citation.ouverte && <ListeACiter id={idDeLaListe} resultat={citation.resultat} actif={citation.actif} choisir={citation.choisir} />}
      </div>
    </div>
  )
}
