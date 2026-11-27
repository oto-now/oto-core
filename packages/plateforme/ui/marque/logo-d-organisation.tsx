"use client"

// Le seul « logo, sinon initiale » du paquet : le logo d'une organisation, ou la tuile d'un outil de l'écran Connecteurs
// (`tuile`), sinon la première lettre du nom dans un carré cerclé du filet du DS. Décoratif : le nom, écrit à côté, porte
// l'information. Un logo qui ne se charge pas (le favicon relayé d'un outil rend 404 sans favicon, l'adresse d'un logo
// peut mourir) rend l'initiale : client pour cet échec, que seul le navigateur voit ; les écrans le montent comme une
// balise. Sans lui, la barre latérale, la page de connexion, l'écran de marque, le consentement et l'écran Connecteurs
// rendraient chacun leur logo.
//
// Repris d'oto-frontend (`components/settings/company-logo.tsx`) : le logo, sinon l'initiale,
// cachés aux lecteurs d'écran. Retiré : `Avatar` du design system d'Oto.
import { useEffect, useRef, useState } from "react"

type LogoDOrganisationProps = {
  /** Nom affiché : sa première lettre remplace le logo absent. */
  nom: string
  /** Adresse `http:` ou `https:` vérifiée par le serveur (`readBrand`, `consentRequest`), celle du logo d'un outil (`logoDe`), ou `null`. */
  logo: string | null
  /** Côté du carré, en pixels. */
  taille: number
  /** La tuile d'un outil : le logo en retrait dans un carré sur le fond du bureau, l'initiale en gras. */
  tuile?: boolean
}

export function LogoDOrganisation({ nom, logo, taille, tuile = false }: LogoDOrganisationProps) {
  const [echec, setEchec] = useState<string | null>(null)
  const image = useRef<HTMLImageElement>(null)
  // Un logo en échec avant l'hydratation n'a pas appelé `onError` : il se reconnaît, chargé sans pixel, au montage.
  useEffect(() => {
    const chargee = image.current
    if (logo && chargee?.complete && chargee.naturalWidth === 0) setEchec(logo)
  }, [logo])
  // En style et pas en attribut seul : la base de Tailwind pose `height: auto` sur `img`, qui
  // écraserait un logo plus large que haut.
  const carre = { width: taille, height: taille }
  const affiche = logo && echec !== logo ? logo : null
  // eslint-disable-next-line @next/next/no-img-element -- hôte arbitraire, saisi par l'administrateur, déclaré par un client OAuth ou relayé par la porte du paquet : next/image exigerait de le déclarer dans next.config
  const img = (classe: string, style?: typeof carre) => <img ref={image} src={affiche ?? undefined} alt="" aria-hidden="true" width={taille} height={taille} referrerPolicy="no-referrer" className={classe} style={style} onError={() => setEchec(affiche)} />
  const initiale = Array.from(nom.trim())[0]?.toLocaleUpperCase("fr")
  if (tuile) {
    const cadre = "flex flex-none items-center justify-center rounded-lg bg-desk ring-1 ring-inset ring-hair"
    return affiche ? (
      <span aria-hidden="true" className={`${cadre} p-2`} style={carre}>
        {img("size-full object-contain")}
      </span>
    ) : (
      <span aria-hidden="true" className={`${cadre} font-bold text-ink`} style={{ ...carre, fontSize: Math.round(taille * 0.4) }}>
        {initiale}
      </span>
    )
  }
  if (affiche) return img("shrink-0 rounded-md object-contain", carre)
  return (
    <span aria-hidden="true" className="flex shrink-0 items-center justify-center rounded-md font-semibold ring-1 ring-inset ring-hair" style={{ ...carre, fontSize: Math.round(taille / 2) }}>
      {initiale}
    </span>
  )
}
