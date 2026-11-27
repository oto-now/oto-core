// Le guide de branchement (E11-S09, FR-CONN-04) : deux temps, les mêmes pour tous les assistants, ajouter le
// connecteur (nom et adresse à copier, avec les liens directs de claude.ai, ChatGPT et Mistral) puis coller
// la phrase dans les préférences personnelles. Monté par la fenêtre de l'accueil et par la page
// `/connect` : une seule source, là où deux copies divergeraient. Sans état, donc sans `"use client"` : seules
// les copies sont client. Il ne lit pas la base, il reçoit l'adresse (`portage-ecrans.md § 4`).
import { ArrowSquareOut } from "@phosphor-icons/react/dist/ssr/ArrowSquareOut"
import { LIEN } from "../components/classes"
import { Icon } from "../ds/react/icon"
import { GUIDE, LIENS_CONNECTEURS, type LienDirect } from "./libelles"
import type { AdresseDeConnexion } from "./types"
import { ValeurCopiable } from "./valeur-copiable"

type GuideDeBranchementProps = {
  adresse: AdresseDeConnexion
}

// Des marqueurs de liste, donc pas de flex : un `li` devenu élément flex peut perdre son numéro. Un filet entre les
// deux temps (`oto-etapes`, E11-S15, AC-a5).
const LISTE_DES_TEMPS = "oto-etapes list-decimal space-y-4 ps-6"

/** Les liens d'un temps, côte à côte : un autre site, dans un nouvel onglet, qui se dit dans son nom (AC-8). */
function Liens({ liens }: { liens: readonly LienDirect[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1">
      {liens.map(({ assistant, href }) => (
        <li key={assistant}>
          {/* `inline-flex` : la hauteur de 44 px des cibles tactiles (< 640 px) ne prend pas sur un élément en ligne. */}
          <a href={href} target="_blank" rel="noopener noreferrer" className={`${LIEN} inline-flex items-center gap-1`}>
            {assistant}
            <Icon as={ArrowSquareOut} size="xs" />
            <span className="oto-sr-only">{GUIDE.nouvelOnglet}</span>
          </a>
        </li>
      ))}
    </ul>
  )
}

/** Les deux champs du connecteur, en liste de définitions : un seul nom, sans espace, que Mistral exige. */
function Champs({ adresse }: { adresse: AdresseDeConnexion }) {
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3">
      <dt className="font-medium">{GUIDE.nom}</dt>
      <dd>
        <ValeurCopiable valeur={adresse.nomCli} cible={GUIDE.copierNom} />
      </dd>
      <dt className="font-medium">{GUIDE.adresse}</dt>
      <dd>
        <ValeurCopiable valeur={adresse.url} cible={GUIDE.copierAdresse} />
      </dd>
    </dl>
  )
}

export function GuideDeBranchement({ adresse }: GuideDeBranchementProps) {
  return (
    <ol className={LISTE_DES_TEMPS}>
      <li className="space-y-2">
        <p className="oto-section-title">{GUIDE.connecteur}</p>
        <Champs adresse={adresse} />
        <Liens liens={LIENS_CONNECTEURS} />
        <p className="oto-caption">{GUIDE.chatGpt}</p>
      </li>
      <li className="space-y-2">
        <p className="oto-section-title">{GUIDE.preferences}</p>
        <ValeurCopiable valeur={adresse.phrase} cible={GUIDE.copierPhrase} />
        {/* Sans lien direct : aucune adresse des préférences personnelles n'est relevée pour ces assistants. */}
      </li>
    </ol>
  )
}
