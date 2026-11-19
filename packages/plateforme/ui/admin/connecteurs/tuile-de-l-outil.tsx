// La tuile d'un outil sur l'écran Connecteurs : son initiale dans un carré, à défaut de logo (le moteur ne sert pas
// encore le domaine de l'éditeur). Décorative : le nom de l'outil est toujours écrit à côté. Module sans « use client » :
// la liste et la fenêtre d'ajout (îlots clients) comme le détail (rendu par le serveur) la montent.

type TuileDeLOutilProps = {
  /** Le nom lisible de l'outil : sa première lettre fait la tuile. */
  nom: string
  taille?: "md" | "lg"
}

const TAILLES = { md: "size-10 text-base", lg: "size-12 text-lg" } as const

export function TuileDeLOutil({ nom, taille = "md" }: TuileDeLOutilProps) {
  return (
    <span aria-hidden="true" className={`flex flex-none items-center justify-center rounded-lg bg-desk font-bold text-ink ring-1 ring-inset ring-hair ${TAILLES[taille]}`}>
      {nom.trim().charAt(0).toUpperCase()}
    </span>
  )
}
