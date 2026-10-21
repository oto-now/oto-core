// L'îlot « Lancer avec Claude » de l'accueil (1.4.13) : les procédures les plus utilisées de la personne
// (`usefulProcedures`, l'ordre du bloc servi par `context`), une ligne d'action chacune : le titre mène à la procédure,
// le bouton à l'icône d'agent ouvre Claude dans un nouvel onglet sur la demande prête (`claude.ai/new?q=`), sans rien
// copier ni rien retaper. Un lien et non un geste : il s'ouvre aussi au clavier, au clic du milieu, et se copie. Server
// Component : le lien de l'hôte arrive en prop. Remplace « Procédures les plus utilisées », qui ne faisait qu'ouvrir la
// procédure, puis « Copier la demande » (retours du 21/10).
import { Play } from "@phosphor-icons/react/dist/ssr/Play"
import { Robot } from "@phosphor-icons/react/dist/ssr/Robot"
import type { UsefulProcedure } from "../../schemas"
import type { Resultat } from "../api/resultat"
import type { LienDeLHote } from "../arbre/navigateur-d-arbre"
import { ErreurDeLecture } from "../components/erreur-de-lecture"
import { EmptyState } from "../ds/react/empty-state"
import { AnimatedIcon } from "../ds/react/icon"
import { Island, IslandBody, IslandHead } from "../ds/react/island"
import { LANCER } from "./libelles"

/** La conversation nouvelle de Claude, préremplie de la demande : l'adresse que claude.ai lit (`q`). */
const NOUVELLE_CONVERSATION = "https://claude.ai/new"

/** L'adresse qui ouvre Claude sur la demande de la procédure. */
export function adresseDeLancement(procedure: UsefulProcedure): string {
  return `${NOUVELLE_CONVERSATION}?${new URLSearchParams({ q: LANCER.demande(procedure.title, procedure.path) })}`
}

type LancerProps = {
  procedures: Resultat<UsefulProcedure[]>
  Lien: LienDeLHote
  /** Le préfixe des pages de l'arbre (« /n/ ») : une procédure s'ouvre à ce préfixe suivi de son chemin. */
  prefixeDesPages: string
}

function Lignes({ procedures, Lien, prefixeDesPages }: Omit<LancerProps, "procedures"> & { procedures: UsefulProcedure[] }) {
  return (
    <ul className="oto-lancer">
      {procedures.map((procedure) => (
        <li key={procedure.path} className="oto-lancer-ligne">
          <Lien href={`${prefixeDesPages}${procedure.path}`} className="oto-lancer-titre">
            <AnimatedIcon as={Play} size="xs" />
            {/* Coupé par des points de suspension : le titre entier au survol, et dans le nom du lien. */}
            <span title={procedure.title}>{procedure.title}</span>
          </Lien>
          <a
            href={adresseDeLancement(procedure)}
            target="_blank"
            rel="noopener noreferrer"
            className="oto-icon-btn anim-host"
            data-variant="ghost"
            data-size="sm"
            data-icon-only=""
            aria-label={LANCER.lancerDans(procedure.title)}
            title={LANCER.lancer}
          >
            <AnimatedIcon as={Robot} size="xs" />
          </a>
        </li>
      ))}
    </ul>
  )
}

export function Lancer({ procedures, ...lignes }: LancerProps) {
  return (
    <Island aria-label={LANCER.titre}>
      <IslandHead>
        <h2>{LANCER.titre}</h2>
      </IslandHead>
      <IslandBody>
        {procedures.error !== undefined ? (
          <ErreurDeLecture message={procedures.error} />
        ) : procedures.data.length === 0 ? (
          <EmptyState title={LANCER.rien} />
        ) : (
          <Lignes procedures={procedures.data} {...lignes} />
        )}
      </IslandBody>
    </Island>
  )
}
