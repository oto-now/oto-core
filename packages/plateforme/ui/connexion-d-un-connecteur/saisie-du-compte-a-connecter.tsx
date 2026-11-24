"use client"

// La saisie du compte sur la page de connexion d'un connecteur : le formulaire de l'écran Connecteurs
// (`FormulaireDAjout`, sa sonde et ses refus), l'espace posé par l'adresse et revérifié par le service à l'envoi ; une
// fois le compte créé, la page dit qu'on peut revenir à l'assistant. La clé d'un compte existant (refusée par le tiers,
// ou jamais posée) s'y saisit par le formulaire du détail du compte (`FormulaireDeLaCle`). Sans lui, la page ne ferait
// que renvoyer à l'écran Connecteurs.
import { useState } from "react"
import type { ConnectionStepView } from "../../schemas"
import { FormulaireDAjout } from "../admin/connecteurs/formulaire-d-ajout"
import { FormulaireDeLaCle } from "../admin/connecteurs/saisie-du-compte"
import { connexionDe } from "../admin/connecteurs/etat-du-compte"
import { Alert } from "../ds/react/primitives"
import { CONNEXION_D_UN_CONNECTEUR as MOTS } from "./libelles"

type Saisie = Extract<ConnectionStepView, { kind: "key" }>

export function SaisieDuCompteAConnecter({ etape }: { etape: Saisie }) {
  const [connecte, setConnecte] = useState<string | null>(null)
  if (connecte !== null) {
    return (
      <Alert tone="ok" title={MOTS.compteConnecte(connecte)}>
        {MOTS.revenir}
      </Alert>
    )
  }
  const outil = {
    connecteur: etape.connector,
    libelle: etape.label,
    ...(etape.access ? { acces: { nom: etape.access.name, libelle: etape.access.label } } : {}),
    facon: etape.form ? connexionDe(etape.form) : ("sans_cle" as const),
    proprietaires: [etape.owner],
    mode: etape.mode,
    ferme: false,
    formulaire: etape.form,
  }
  const equipes = etape.team ? [{ id: etape.team.id, name: etape.team.name }] : []
  return (
    <>
      {etape.form && etape.form.fields.length > 0 && <p className="text-sm text-ink">{MOTS.cle(etape.label)}</p>}
      <FormulaireDAjout
        outil={outil}
        equipes={equipes}
        equipe={etape.team?.id}
        nomPropose={etape.label}
        annuler={() => window.history.back()}
        apresAjout={() => setConnecte(etape.label)}
      />
    </>
  )
}

type CleDuCompte = Extract<ConnectionStepView, { kind: "account_key" }>

/** La clé d'un compte existant : le formulaire du détail du compte ; enregistrée, la personne revient à son assistant. */
export function SaisieDeLaCleDuCompte({ etape }: { etape: CleDuCompte }) {
  const [enregistre, setEnregistre] = useState(false)
  if (enregistre) {
    return (
      <Alert tone="ok" title={MOTS.cleEnregistree(etape.account.label)}>
        {MOTS.revenir}
      </Alert>
    )
  }
  return (
    <>
      <p className="text-sm text-ink">{MOTS.cleDuCompte(etape.label, etape.account.label)}</p>
      <FormulaireDeLaCle compte={etape.account} formulaire={etape.form} enregistre={() => setEnregistre(true)} annule={() => window.history.back()} />
    </>
  )
}
