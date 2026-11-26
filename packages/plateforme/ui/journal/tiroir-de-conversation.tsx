"use client"

// Le tiroir d'une conversation du journal (E05-S09, partie d1). Porté d'oto-frontend (`fiche-dun-appel.tsx`,
// `timeline-dun-deroule.tsx`) : le `Drawer` du design system, un `<dialog>` natif (piège de focus, Échap,
// inertie du fond, le focus rendu au déclencheur à la fermeture), ouvert par l'adresse, jamais par un état
// qui ne survivrait pas au rechargement. Changé : le contenu est rendu par la page (Server Component) ; fermer
// ouvre l'adresse sans la conversation (`useHote().naviguer`) et referme le tiroir sans attendre la relecture.
// `taille` : `"lg"` pose la variante large du `Drawer` (`data-size="lg"`, 560 px), pour un détail à sections
// (connecteur) ; absente, la largeur par défaut. Le titre peut porter un visuel (le logo d'un outil).
import { useState, type ReactNode } from "react"
import { Drawer } from "../ds/react/drawer"
import { useHote } from "../hote/navigation"

type TiroirDeConversationProps = { titre: ReactNode; fermer: string; taille?: "lg"; children: ReactNode }

export function TiroirDeConversation({ titre, fermer, taille, children }: TiroirDeConversationProps) {
  const { naviguer } = useHote()
  const [ouvert, setOuvert] = useState(true)
  return (
    <Drawer
      open={ouvert}
      onClose={() => {
        setOuvert(false)
        naviguer(fermer)
      }}
      side="right"
      data-size={taille}
      title={titre}
      closeLabel="Fermer le détail"
    >
      {children}
    </Drawer>
  )
}
