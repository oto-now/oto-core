"use client"

// Les pièces visuelles du panneau « Partager » (1.4.13) : l'intertitre d'une section, en étiquette avec son icône et son
// compte, le niveau d'une ligne en pastille de couleur (Aucun accès gris, Peut lire bleu, Peut modifier vert, Accès
// complet violet), choisi dans la liste du design system ou lu seulement, et les étiquettes d'une ligne (« vous »,
// « responsable »). Sans elles, le panneau était un texte gris uniforme où l'on ne voyait pas d'un coup d'œil qui lit et
// qui modifie. Le mot du niveau reste écrit : la couleur ne dit jamais seule le niveau.
import { forwardRef, type ReactNode } from "react"
import { Eye } from "@phosphor-icons/react/dist/csr/Eye"
import { Key } from "@phosphor-icons/react/dist/csr/Key"
import { PencilSimple } from "@phosphor-icons/react/dist/csr/PencilSimple"
import { Prohibit } from "@phosphor-icons/react/dist/csr/Prohibit"
import { ACCESS_LEVEL_NAMES, type AccessLevelName } from "../../schemas"
import { Select, type SelectEvent, type SelectOption } from "../ds/react/select"
import { DETAIL_DES_NIVEAUX, NIVEAUX_D_ACCES } from "./libelles"

type SectionProps = { id: string; icone: ReactNode; titre: string; compte?: number; children: ReactNode }

/** Une section du panneau : son intertitre en étiquette (l'ancre du focus quand il porte l'`id` du panneau), puis sa liste. */
export function SectionDuPartage({ id, icone, titre, compte, children }: SectionProps) {
  return (
    <section aria-labelledby={id} className="oto-share-section">
      <h3 id={id} tabIndex={-1} className="oto-share-heading">
        <span aria-hidden="true" className="oto-share-heading-icon">
          {icone}
        </span>
        {titre}
        {compte !== undefined && <span className="oto-share-count">{`· ${compte}`}</span>}
      </h3>
      {children}
    </section>
  )
}

/** Le glyphe de chaque niveau dans sa liste : interdit, œil, crayon, clé. */
const GLYPHES_DES_NIVEAUX: Record<AccessLevelName, ReactNode> = { none: <Prohibit />, read: <Eye />, write: <PencilSimple />, manage: <Key /> }

/** Le choix d'un niveau dans une liste : son nom, son glyphe, et ce qu'il permet en une ligne fine (1.4.13). */
export function optionDuNiveau(niveau: AccessLevelName): SelectOption {
  return { value: niveau, label: NIVEAUX_D_ACCES[niveau], description: DETAIL_DES_NIVEAUX[niveau], icon: GLYPHES_DES_NIVEAUX[niveau] }
}

/** Le niveau d'une valeur du menu, `undefined` pour « Retirer » : la pastille garde alors la couleur du niveau servi. */
const niveauDe = (valeur: string): AccessLevelName | undefined => ACCESS_LEVEL_NAMES.find((niveau) => niveau === valeur)

type ChoixProps = {
  valeur: string
  /** Le niveau servi : sa couleur reste pendant qu'un choix part, et pour une valeur qui n'est pas un niveau. */
  servi: AccessLevelName
  options: SelectOption[]
  "aria-label": string
  onChange: (evenement: SelectEvent) => void
  disabled?: boolean
}

/** Le niveau d'une ligne, en pastille de sa couleur, qui ouvre la liste des niveaux proposés. */
export const ChoixDuNiveau = forwardRef<HTMLDivElement, ChoixProps>(function ChoixDuNiveau({ valeur, servi, ...select }, ref) {
  return (
    <span className="oto-share-level" data-niveau={niveauDe(valeur) ?? servi}>
      <Select ref={ref} size="sm" value={valeur} {...select} />
    </span>
  )
})

/** Le niveau d'une ligne pour qui ne le change pas : la même pastille, sans liste. */
export function NiveauLu({ niveau }: { niveau: AccessLevelName }) {
  return (
    <span className="oto-share-level" data-niveau={niveau}>
      <span className="oto-share-pill">{NIVEAUX_D_ACCES[niveau]}</span>
    </span>
  )
}

/** Une étiquette de la ligne (« vous », « responsable », « exception ») ; `accent` : celle de qui regarde. */
export function EtiquetteDeLigne({ children, accent = false }: { children: ReactNode; accent?: boolean }) {
  return (
    <span className="oto-badge" data-tone={accent ? "oto" : undefined}>
      {children}
    </span>
  )
}
