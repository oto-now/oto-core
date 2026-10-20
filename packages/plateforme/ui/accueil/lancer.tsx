"use client"

// L'îlot « Lancer » de l'accueil (1.4.13) : les procédures les plus utilisées de la personne (`usefulProcedures`, l'ordre
// du bloc servi par `context`), une ligne d'action chacune : le titre mène à la procédure, « Copier la demande » copie
// la phrase à coller dans son assistant (`copierLeTexte`, la copie honnête du paquet), et « Demande copiée » se dit dans
// une région montée vide. Remplace « Procédures les plus utilisées », qui ne faisait qu'ouvrir la procédure : on la lance
// par l'assistant, la demande prête lui évite de la retaper.
import { useEffect, useState } from "react"
import { Copy } from "@phosphor-icons/react/dist/csr/Copy"
import { Play } from "@phosphor-icons/react/dist/csr/Play"
import type { UsefulProcedure } from "../../schemas"
import type { Resultat } from "../api/resultat"
import { ErreurDeLecture } from "../components/erreur-de-lecture"
import { COPIE_IMPOSSIBLE, copierLeTexte } from "../components/presse-papiers"
import { EmptyState } from "../ds/react/empty-state"
import { AnimatedIcon } from "../ds/react/icon"
import { Island, IslandBody, IslandHead } from "../ds/react/island"
import { IconButton } from "../ds/react/primitives"
import { useHote } from "../hote/navigation"
import { LANCER } from "./libelles"

/** « Demande copiée » s'efface : resté à l'écran, il se lirait encore après une copie faite ailleurs. */
const DUREE_DE_COPIE_MS = 2000

type LignesProps = { procedures: UsefulProcedure[]; prefixeDesPages: string; copier: (procedure: UsefulProcedure) => void }

function Lignes({ procedures, prefixeDesPages, copier }: LignesProps) {
  const { Lien } = useHote()
  return (
    <ul className="oto-lancer">
      {procedures.map((procedure) => (
        <li key={procedure.path} className="oto-lancer-ligne">
          <Lien href={`${prefixeDesPages}${procedure.path}`} className="oto-lancer-titre">
            <AnimatedIcon as={Play} size="xs" />
            <span>{procedure.title}</span>
          </Lien>
          <IconButton variant="ghost" size="sm" label={LANCER.copierPour(procedure.title)} title={LANCER.copier} onClick={() => copier(procedure)}>
            <AnimatedIcon as={Copy} size="xs" />
          </IconButton>
        </li>
      ))}
    </ul>
  )
}

type LancerProps = { procedures: Resultat<UsefulProcedure[]>; prefixeDesPages: string }

export function Lancer({ procedures, prefixeDesPages }: LancerProps) {
  const [statut, setStatut] = useState("")
  useEffect(() => {
    if (statut !== LANCER.copiee) return
    const minuteur = setTimeout(() => setStatut(""), DUREE_DE_COPIE_MS)
    return () => clearTimeout(minuteur)
  }, [statut])
  async function copier({ title, path }: UsefulProcedure) {
    setStatut((await copierLeTexte(LANCER.demande(title, path))) ? LANCER.copiee : COPIE_IMPOSSIBLE)
  }
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
          <Lignes procedures={procedures.data} prefixeDesPages={prefixeDesPages} copier={(procedure) => void copier(procedure)} />
        )}
        {/* Montée vide, remplie au clic : une région de statut n'annonce que ce qui change après son montage. */}
        <p role="status" className="oto-caption">
          {statut}
        </p>
      </IslandBody>
    </Island>
  )
}
