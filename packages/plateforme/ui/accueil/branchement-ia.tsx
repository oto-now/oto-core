"use client"

// L'aparté « Brancher mon Claude, ChatGPT ou Mistral » de l'accueil (E05-S09, partie b, AC-b1 ; E11-S09,
// AC-9, AC-10) : l'état du branchement ; « Brancher » ouvre la grande fenêtre, qui montre le guide par
// assistant (`GuideDeBranchement`, le même que `/connect`), adresse comprise. Porté d'oto-frontend
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
import type { AdresseDeConnexion, DerniereConnexion, ExempleDePrompt } from "../connexion/types"
import { COMPTE } from "../coque/libelles"
import { Dialog } from "../ds/react/dialog"
import { Island, IslandBody, IslandHead } from "../ds/react/island"
import { Button } from "../ds/react/primitives"
import { StatusDot } from "../ds/react/status-dot"
import { dateLisible } from "../format/dates"
import { ErreurDeLecture } from "../components/erreur-de-lecture"
import { BRANCHEMENT } from "./libelles"

type BranchementIAProps = {
  adresse: AdresseDeConnexion
  /** Les demandes à essayer du guide : les titres des procédures utiles (AC-7, AC-11). */
  exemples: Resultat<ExempleDePrompt[]>
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

/** L'état : un point décoratif, le mot le porte (`accessibility-patterns.md § Couleurs & Contraste`). */
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
  return (
    <ul className="flex flex-col gap-1">
      {connexions.data.map(({ famille, date }) => (
        <li key={famille} className="oto-caption flex items-center gap-2">
          <StatusDot state="ok" aria-hidden="true" />
          {BRANCHEMENT.derniere(famille, dateLisible(date) ?? "?")}
        </li>
      ))}
    </ul>
  )
}

export function BranchementIA({ adresse, exemples, connexions }: BranchementIAProps) {
  const [ouverte, setOuverte] = useState(false)
  // Chaque ouverture remonte le guide : il s'ouvre sur la famille la plus récente (AC-2) ; il reste monté
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
        <Assistants />
        <EtatDuBranchement connexions={connexions} />
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
        {ouvertures > 0 && <GuideDeBranchement key={ouvertures} adresse={adresse} exemples={exemples} connexions={connexions} />}
      </Dialog>
    </Island>
  )
}
