"use client"

// L'aparté « Brancher mon Claude, ChatGPT ou Mistral » de l'accueil (E05-S09, partie b, AC-b1 ; E11-S09,
// AC-9, AC-10) : l'état du branchement ; « Brancher » ouvre la grande fenêtre, qui montre le guide en deux
// temps, le même pour tous les assistants (`GuideDeBranchement`, le même que `/connect`), adresse comprise. Porté d'oto-frontend
// (`accueil/branchement-ia.tsx`). Repris : l'îlot et son en-tête, « Brancher » au bout de la bande et sans
// `data-reveal` (c'est le sujet de la carte), l'état dans le corps. Changé : l'état vient des dernières
// connexions de la personne (E02-S04) ; le tutoriel « Bientôt » est le guide servi, en fenêtre `lg`.
// Retiré : l'adresse sur la carte (la fenêtre la porte), « Mistral Vibe ».
//
// 1.4.13 : le titre court « Brancher votre assistant » tient sur une ligne avec « Brancher » (le titre long passait sur
// deux) ; les assistants pris en charge se nomment dessous, en pastilles, avant l'état.
import { useState } from "react"
import type { Resultat } from "../api/resultat"
import { GuideDeBranchement } from "../connexion/guide-de-branchement"
import { ConnexionsRecentes } from "../connexion/connexions-recentes"
import type { AdresseDeConnexion, DerniereConnexion } from "../connexion/types"
import { COMPTE } from "../coque/libelles"
import { Dialog } from "../ds/react/dialog"
import { Island, IslandBody, IslandHead } from "../ds/react/island"
import { Button } from "../ds/react/primitives"
import { StatusDot } from "../ds/react/status-dot"
import { ErreurDeLecture } from "../components/erreur-de-lecture"
import { BRANCHEMENT } from "./libelles"

type BranchementIAProps = {
  adresse: AdresseDeConnexion
  connexions: Resultat<DerniereConnexion[]>
}

/** Les assistants pris en charge, en pastilles : le titre court ne les nomme plus. */
function Assistants() {
  return (
    <ul aria-label={BRANCHEMENT.assistantsLu} className="oto-branchement-assistants">
      {BRANCHEMENT.assistants.map((nom) => (
        <li key={nom} className="oto-badge">
          {nom}
        </li>
      ))}
    </ul>
  )
}

/** L'état : « aucun » tant qu'aucun assistant ne s'est connecté, sinon une ligne par assistant (`ConnexionsRecentes`). Le point est décoratif, le mot le porte. */
function EtatDuBranchement({ connexions }: Pick<BranchementIAProps, "connexions">) {
  if (connexions.error !== undefined) return <ErreurDeLecture message={connexions.error} />
  if (connexions.data.length === 0) {
    return (
      <p className="oto-caption flex items-center gap-2">
        <StatusDot state="rest" aria-hidden="true" />
        {BRANCHEMENT.aucun}
      </p>
    )
  }
  return <ConnexionsRecentes connexions={connexions.data} />
}

export function BranchementIA({ adresse, connexions }: BranchementIAProps) {
  const [ouverte, setOuverte] = useState(false)
  // Chaque ouverture remonte le guide : ses copies repartent sans « Copié » d'une ouverture passée ; il reste monté
  // pendant la sortie animée de la fenêtre, et rien n'est rendu avant la première.
  const [ouvertures, setOuvertures] = useState(0)
  const ouvrir = () => {
    setOuvertures((compte) => compte + 1)
    setOuverte(true)
  }
  const fermer = () => setOuverte(false)
  return (
    <Island aria-label={BRANCHEMENT.titre}>
      <IslandHead>
        <h2>{BRANCHEMENT.titre}</h2>
        {/* `ms-auto` sur le `<span>`, jamais sur le bouton : le reset du design system, hors couche, remet à zéro la marge des contrôles. */}
        <span className="ms-auto">
          <Button variant="secondary" size="sm" onClick={ouvrir}>
            {BRANCHEMENT.brancher}
          </Button>
        </span>
      </IslandHead>
      <IslandBody>
        {/* Les assistants et l'état sur une ligne quand elle les tient ; une liste de connexions passe dessous. */}
        <div className="oto-branchement-ligne">
          <Assistants />
          <EtatDuBranchement connexions={connexions} />
        </div>
      </IslandBody>
      <Dialog
        open={ouverte}
        onClose={fermer}
        size="lg"
        closeLabel={BRANCHEMENT.fermer}
        title={COMPTE.brancher}
        footer={
          <Button variant="secondary" size="sm" onClick={fermer}>
            {BRANCHEMENT.fermer}
          </Button>
        }
      >
        {ouvertures > 0 && <GuideDeBranchement key={ouvertures} adresse={adresse} />}
      </Dialog>
    </Island>
  )
}
