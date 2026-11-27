"use client"

// La tuile d'un outil sur l'écran Connecteurs : son logo, l'image déclarée ou à défaut le favicon de son domaine, relayé
// par la plateforme (`GET connectors/<nom>/logo`), sinon son initiale dans un carré : sans logo déclaré, et quand le
// logo ne se charge pas (le serveur rend 404 sans image). Décorative : le nom de l'outil est toujours écrit à côté. Client pour l'échec
// du chargement, que seul le navigateur voit ; la liste, la fenêtre d'ajout et le détail la montent comme une balise.
import { useEffect, useRef, useState } from "react"

type TuileDeLOutilProps = {
  /** Le nom lisible de l'outil : sa première lettre fait la tuile sans logo. */
  nom: string
  /** L'adresse du logo (`logoDe`), `null` pour un outil sans domaine déclaré. */
  logo: string | null
  taille?: "md" | "lg"
}

const TAILLES = { md: "size-10 text-base", lg: "size-12 text-lg" } as const

export function TuileDeLOutil({ nom, logo, taille = "md" }: TuileDeLOutilProps) {
  const [echec, setEchec] = useState<string | null>(null)
  const image = useRef<HTMLImageElement>(null)
  // Un logo en échec avant l'hydratation n'a pas appelé `onError` : il se reconnaît, chargé sans pixel, au montage.
  useEffect(() => {
    const chargee = image.current
    if (logo && chargee?.complete && chargee.naturalWidth === 0) setEchec(logo)
  }, [logo])
  const cadre = `flex flex-none items-center justify-center rounded-lg bg-desk ring-1 ring-inset ring-hair ${TAILLES[taille]}`
  if (logo && echec !== logo) {
    return (
      <span aria-hidden="true" className={`${cadre} p-2`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- image servie par la porte du paquet : next/image demanderait à l'hôte de la déclarer */}
        <img ref={image} src={logo} alt="" className="size-full object-contain" onError={() => setEchec(logo)} />
      </span>
    )
  }
  return (
    <span aria-hidden="true" className={`${cadre} font-bold text-ink`}>
      {nom.trim().charAt(0).toUpperCase()}
    </span>
  )
}
