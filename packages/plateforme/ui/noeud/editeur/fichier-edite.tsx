"use client"

// Un fichier joint dans l'éditeur (E10-S02, lot b : AC-b1 à AC-b4, AC-b8) : le bloc local d'un envoi en cours (l'aperçu
// d'une image, révoqué au démontage, la progression, « Annuler », le refus traduit et « Retirer »), puis l'image jointe
// avec son texte alternatif, saisi dans le bloc, et le signal « Sans description » tant qu'il est vide ; la carte d'un
// fichier. Comme le tableau et le repli (`tableau-edite.tsx`, `repli-edite.tsx`) : un bloc écrit par ses propres champs,
// dont les gestes viennent du contexte de l'éditeur. Sans lui, un envoi ne se verrait pas, et une image ne se décrirait
// qu'à travers un assistant.
import { useEffect, useId, useState } from "react"
import { Input } from "../../ds/react/forms"
import { Button } from "../../ds/react/primitives"
import { Progress } from "../../ds/react/progress"
import { CarteDeFichier } from "../fichier-du-bloc"
import { FICHIERS } from "../libelles-des-fichiers"
import { RenduDUnBloc } from "../rendu-des-blocs"
import type { Depot } from "./envoi-de-fichier"
import { useGestes } from "./gestes"
import type { Rangee } from "./modele"

const chaine = (valeur: unknown): string => (typeof valeur === "string" ? valeur : "")

/** L'aperçu local d'une image en envoi (`URL.createObjectURL`), révoqué au démontage (`uploads-patterns.md § Côté composant`). */
function useApercu(fichier: File | null): string | null {
  const [adresse, setAdresse] = useState<string | null>(null)
  useEffect(() => {
    if (!fichier) return
    const locale = URL.createObjectURL(fichier)
    setAdresse(locale)
    return () => URL.revokeObjectURL(locale)
  }, [fichier])
  return adresse
}

/**
 * Le bloc local d'un envoi (AC-b1, AC-b4) : pendant l'envoi, l'aperçu d'une image et la progression, « Annuler » ;
 * refusé, le refus traduit et « Retirer ». Rien n'est écrit dans la page avant la confirmation.
 */
export function DepotEnCours({ cle, depot }: { cle: string; depot: Depot }) {
  const gestes = useGestes()
  const apercu = useApercu(depot.genre === "image" ? depot.fichier : null)
  const nom = depot.fichier.name
  const refuse = depot.erreur !== null
  return (
    <div className="mb-3.5 flex flex-col gap-2" aria-busy={!refuse}>
      {/* L'aperçu redit l'image dont le nom suit : décoratif. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- adresse locale du navigateur (`blob:`), que next/image ne sert pas */}
      {apercu && <img src={apercu} alt="" aria-hidden="true" className="max-h-48 max-w-full rounded-md opacity-60" />}
      {refuse ? (
        <>
          <p className="text-sm text-ink">{nom}</p>
          <p role="alert" className="oto-field-error">
            {depot.erreur}
          </p>
        </>
      ) : (
        // La progression va de 0 à 1, montrée en pour cent.
        <Progress label={FICHIERS.envoi(nom)} value={Math.round(depot.progression * 100)} max={100} />
      )}
      <div>
        <Button variant="ghost" size="sm" aria-label={refuse ? FICHIERS.retirerNom(nom) : FICHIERS.annulerNom(nom)} onClick={() => gestes.annulerLEnvoi(cle)}>
          {refuse ? FICHIERS.retirer : FICHIERS.annuler}
        </Button>
      </div>
    </div>
  )
}

type FichierEditeProps = {
  rangee: Rangee
  erreur: string | null
  /** Un autre bloc est en conflit : le texte alternatif se lit, il ne s'écrit pas (HN-E05S08-3). */
  lectureSeule: boolean
  prefixe: string
}

/**
 * Une image jointe ou écrite par son adresse, ou un fichier, dans l'éditeur (AC-b1 à AC-b3) : l'image comme à la
 * lecture (largeur, agrandissement), son texte alternatif dans le bloc, facultatif, qui part comme un texte ; la carte
 * d'un fichier. Un refus du contrôle ou d'une conversion se dit dessous.
 */
export function FichierEdite({ rangee, erreur, lectureSeule, prefixe }: FichierEditeProps) {
  const gestes = useGestes()
  const signal = useId()
  const { cle, bloc } = rangee
  const alt = chaine(bloc.data.alt)
  const sansDescription = alt.trim() === ""
  const refus = erreur && (
    <p role="alert" className="oto-field-error">
      {erreur}
    </p>
  )
  if (bloc.type === "file") {
    return (
      <div id={bloc.ref} className="mb-3.5 flex flex-col gap-1">
        <CarteDeFichier id={chaine(bloc.data.file_id)} nom={chaine(bloc.data.name)} taille={typeof bloc.data.size === "number" ? bloc.data.size : 0} />
        {refus}
      </div>
    )
  }
  return (
    <div id={bloc.ref} className="flex flex-col gap-1.5">
      {/* La figure sans ancre : celle du bloc est ici, une seule par page. */}
      <RenduDUnBloc bloc={{ type: bloc.type, text: bloc.text, data: bloc.data }} Lien="a" hrefDuChemin={(chemin) => `${prefixe}${chemin}`} />
      <div className="mb-3.5 flex flex-wrap items-center gap-2">
        <Input
          size="sm"
          data-champ=""
          aria-label={FICHIERS.decrire}
          aria-describedby={sansDescription ? signal : undefined}
          placeholder={FICHIERS.decrire}
          value={alt}
          readOnly={lectureSeule}
          className="min-w-0 flex-1"
          onChange={(evenement) => gestes.modifierLeBloc(cle, { ...bloc, data: { ...bloc.data, alt: evenement.target.value } })}
          onBlur={(evenement) => gestes.quitterLeChamp(cle, evenement)}
          onFocus={lectureSeule ? gestes.annoncerLeConflit : undefined}
        />
        {sansDescription && (
          <span id={signal} className="oto-caption">
            {FICHIERS.sansDescription}
          </span>
        )}
      </div>
      {refus}
    </div>
  )
}
