"use client"

// « Ajouter un connecteur » (écran Connecteurs) : le bouton et sa fenêtre. Elle rassemble ce que le moteur sait faire
// aujourd'hui : chacun y connecte son propre compte à un service à consentement ou à compte rattaché
// (`ConnexionParConsentement`), et un administrateur y crée un compte pour l'organisation ou pour une équipe
// (`CreationDeCompte`). Le catalogue avec recherche, l'ajout d'un connecteur à clé par tout membre et le test à la saisie
// attendent le moteur (`ajout-d-un-connecteur.md`) : ils rempliront cette fenêtre. L'îlot ne reçoit que des données.
import { useState } from "react"
import type { ConnectorAccountForm } from "../../../schemas"
import { Dialog } from "../../ds/react/dialog"
import { Button } from "../../ds/react/primitives"
import { useHote } from "../../hote/navigation"
import { ConnexionParConsentement } from "./connexion-par-consentement"
import { CreationDeCompte } from "./creation-de-compte"
import { adresseDeLaVue } from "./lignes-des-connecteurs"

const TITRE = "Ajouter un connecteur"

/** Un service que la personne connecte d'ici, par son consentement ou par un compte rattaché. */
export type ServiceAConnecter = { connecteur: string; libelle: string; ressource: "connector-consent" | "hosted-link" }

/** Ce qu'un administrateur crée : un compte d'un de ces connecteurs, pour l'organisation ou une de ces équipes. */
export type CreationPossible = { connecteurs: string[]; equipes: { id: string; name: string }[]; formulaires: ConnectorAccountForm[] }

type AjoutDUnConnecteurProps = {
  aConnecter: ServiceAConnecter[]
  /** `null` : la personne n'administre pas l'organisation. */
  creation: CreationPossible | null
  /** L'adresse de l'écran : un consentement y revient. */
  ici: string
}

function ServicesAConnecter({ services, ici }: { services: ServiceAConnecter[]; ici: string }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="oto-label">Connecter mon compte</h3>
      <p className="oto-caption">Ces services se connectent personne par personne : le connecteur est à vous, privé tant que vous ne le partagez pas.</p>
      {services.map((service) => (
        <ConnexionParConsentement key={service.connecteur} ressource={service.ressource} connecteur={service.connecteur} libelle={`Connecter mon compte ${service.libelle}`} retour={ici} />
      ))}
    </section>
  )
}

function Creation({ creation, apresCreation }: { creation: CreationPossible; apresCreation: (compte: { id: string }) => void }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="oto-label">Pour l&apos;organisation ou une équipe</h3>
      {creation.connecteurs.length === 0 ? (
        <p className="oto-caption">Aucun outil ne demande de clé dans cette version de la plateforme.</p>
      ) : (
        <CreationDeCompte connecteurs={creation.connecteurs} equipes={creation.equipes} formulaires={creation.formulaires} apresCreation={apresCreation} />
      )}
    </section>
  )
}

export function AjoutDUnConnecteur({ aConnecter, creation, ici }: AjoutDUnConnecteurProps) {
  const { naviguer } = useHote()
  const [ouvert, setOuvert] = useState(false)
  // Un compte créé : la fenêtre se ferme, la liste le montre et son détail s'ouvre.
  const ouvrirLeDetail = (compte: { id: string }) => {
    setOuvert(false)
    naviguer(adresseDeLaVue(ici, { filtre: "all", q: "", compte: compte.id }))
  }
  const rien = aConnecter.length === 0 && creation === null
  return (
    <>
      <Button type="button" variant="primary" onClick={() => setOuvert(true)}>
        {TITRE}
      </Button>
      {/* Montée à l'ouverture : fermée, ni le formulaire ni sa saisie ne restent dans le document. */}
      {ouvert && (
        <Dialog open onClose={() => setOuvert(false)} title={TITRE} size="md">
          <div className="flex flex-col gap-6">
            {aConnecter.length > 0 && <ServicesAConnecter services={aConnecter} ici={ici} />}
            {creation && <Creation creation={creation} apresCreation={ouvrirLeDetail} />}
            {rien && <p>Aucun outil ne se connecte par vous-même pour l&apos;instant. Un administrateur peut ajouter un connecteur et le partager avec vous.</p>}
          </div>
        </Dialog>
      )}
    </>
  )
}
