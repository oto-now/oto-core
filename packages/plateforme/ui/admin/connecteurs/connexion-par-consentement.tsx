"use client"

// « Connecter mon compte » d'un connecteur à consentement (`oauth2_user`, connecteurs et comptes § Consentement d'une
// personne) : le bouton par défaut de l'écran Connecteurs, posé sur la même porte que l'écran d'un hôte
// (`POST /api/platform/connector-consent`, `startConnectorConsent`) ; il envoie le navigateur à l'adresse
// d'autorisation du tiers, qui le ramène ici par l'adresse de retour du paquet. L'interface d'un hôte reste la sienne :
// ce bouton n'est que le défaut du paquet.
import { useState } from "react"
import { appelerPlateforme } from "../../api/client"
import { messageDErreur } from "../../api/messages"
import { Alert, Button } from "../../ds/react/primitives"

type ConnexionProps = {
  /** Le nom du connecteur. */
  connecteur: string
  /** Le libellé du bouton : « Connecter mon compte Microsoft 365 », « Reconnecter ». */
  libelle: string
  /** Le nom accessible du bouton, quand le libellé ne nomme pas le compte. */
  nomAccessible?: string
  /** L'écran où revenir après le consentement (chemin de l'adresse) ; l'écran Connecteurs par défaut. */
  retour?: string
}

export function ConnexionParConsentement({ connecteur, libelle, nomAccessible, retour }: ConnexionProps) {
  const [enCours, setEnCours] = useState(false)
  const [erreur, setErreur] = useState("")

  async function connecter() {
    setErreur("")
    setEnCours(true)
    const reponse = await appelerPlateforme<{ url: string }>({ methode: "POST", ressource: "connector-consent", corps: { connector: connecteur, ...(retour ? { return_to: retour } : {}) } })
    if (reponse.erreur) {
      setErreur(messageDErreur(reponse.erreur))
      setEnCours(false)
      return
    }
    window.location.assign(reponse.data.url)
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button type="button" variant="secondary" disabled={enCours} aria-busy={enCours} aria-label={nomAccessible} onClick={() => void connecter()}>
        {enCours ? "Redirection…" : libelle}
      </Button>
      {erreur && <Alert tone="fail" title={erreur} />}
    </div>
  )
}
