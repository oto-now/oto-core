"use client"

// Le cadre d'un bloc « Intégration » (1.4.3) : la page `https` d'un autre site, dans une iframe isolée (`sandbox`), à la
// hauteur choisie, avec un lien qui l'ouvre dans un onglet (un site qui refuse d'être intégré le dit dans le cadre ; le
// lien reste). L'iframe se monte après l'hydratation : le navigateur seul dit si l'adresse est sur l'origine de la page,
// auquel cas le cadre perd `allow-same-origin` (avec `allow-scripts`, une page de l'hôte lirait la page qui la montre).
// Sans lui, une vidéo, une maquette ou un tableau de bord d'un autre outil ne se voit qu'en le quittant.
import { useEffect, useState } from "react"
import { EMBED_HEIGHTS, type EmbedHeight } from "../../schemas/blocks"
import { INTEGRATION } from "./libelles"

/** Les droits du cadre : ses scripts, ses formulaires et ses fenêtres ; sa propre origine seulement hors de celle de la page. */
const SANDBOX = "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation"

/** Le nom d'hôte d'une adresse, sans `www.`, pour nommer le cadre ; l'adresse entière si elle ne se lit pas. */
export function hoteDe(adresse: string): string {
  try {
    return new URL(adresse).hostname.replace(/^www\./, "")
  } catch {
    return adresse
  }
}

/** La hauteur d'un cadre : celle du bloc, `medium` sans elle ou pour une valeur inconnue. */
export function hauteurDe(valeur: unknown): EmbedHeight {
  return EMBED_HEIGHTS.find((une) => une === valeur) ?? "medium"
}

/** `hauteur` : celle du bloc telle que servie, lue par `hauteurDe` ici (un module serveur n'appelle pas une fonction d'un module client). */
type CadreProps = { id?: string; adresse: string; hauteur: unknown }

export function CadreIntegre({ id, adresse, hauteur }: CadreProps) {
  const [origine, setOrigine] = useState<"tierce" | "page" | null>(null)
  useEffect(() => {
    try {
      setOrigine(new URL(adresse).origin === window.location.origin ? "page" : "tierce")
    } catch {
      setOrigine("page")
    }
  }, [adresse])
  const hote = hoteDe(adresse)
  // La base n'admet qu'une adresse `https://` ; une autre (un bloc d'une version future, une donnée abîmée) ne se monte pas.
  if (!adresse.startsWith("https://")) return <p id={id} className="oto-caption mb-3.5">{INTEGRATION.invalide}</p>
  return (
    <figure id={id} className="oto-integration mb-3.5" data-height={hauteurDe(hauteur)}>
      {origine === null ? (
        <div className="oto-integration-cadre" aria-hidden="true" />
      ) : (
        <iframe
          className="oto-integration-cadre"
          src={adresse}
          title={INTEGRATION.titre(hote)}
          sandbox={origine === "tierce" ? `${SANDBOX} allow-same-origin` : SANDBOX}
          allow="fullscreen; picture-in-picture; clipboard-write; encrypted-media"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          loading="lazy"
        />
      )}
      <figcaption className="oto-caption">
        <a href={adresse} target="_blank" rel="noopener noreferrer">
          {INTEGRATION.ouvrir(hote)}
        </a>
      </figcaption>
    </figure>
  )
}
