"use client"

// « Connecter mon compte » d'un connecteur à consentement (`oauth2_user`, connecteurs et comptes § Consentement d'une
// personne) ou à compte rattaché (`accountIdentity`, § Compte de l'hôte et compte rattaché) : le bouton par défaut de
// l'écran Connecteurs, posé sur la même porte que l'écran d'un hôte (`POST /api/platform/connector-consent`,
// `startConnectorConsent` ; `POST /api/platform/hosted-link`, `startHostedLink`) ; il envoie le navigateur à l'adresse
// que rend la porte, chez le tiers, qui le ramène ici par l'adresse de retour du paquet. L'interface d'un hôte reste la
// sienne : ce bouton n'est que le défaut du paquet.
import { useState } from "react"
import { ArrowSquareOut } from "@phosphor-icons/react/dist/csr/ArrowSquareOut"
import { appelerPlateforme } from "../../api/client"
import { messageDErreur } from "../../api/messages"
import { Icon } from "../../ds/react/icon"
import { Alert, Button } from "../../ds/react/primitives"

type ConnexionProps = {
  /** La porte du parcours : le consentement (`oauth2_user`) ou le branchement hébergé (`accountIdentity`). */
  ressource: "connector-consent" | "hosted-link"
  /** Le nom du connecteur. */
  connecteur: string
  /** L'accès à consentement d'un connecteur à plusieurs accès ; absent pour un connecteur à un seul. */
  acces?: string
  /** Le libellé du bouton : « Connecter mon compte Microsoft 365 », « Reconnecter ». */
  libelle: string
  /** Le nom accessible du bouton, quand le libellé ne nomme pas le compte. */
  nomAccessible?: string
  /** L'écran où revenir après le parcours (chemin de l'adresse) ; l'écran Connecteurs par défaut. */
  retour?: string
  /** Avant de partir chez le tiers : l'accord du premier partage, et le partage gardé pour le retour ; `false` : on reste. */
  avantDePartir?: () => Promise<boolean>
  /** Le départ a échoué : ce que `avantDePartir` a gardé s'oublie. */
  apresUnEchec?: () => void
  /** Le bouton principal d'une fiche d'ajout ; secondaire ailleurs (une ligne, le détail). */
  variante?: "primary" | "secondary"
  /**
   * Dans le pied de la fiche d'ajout : sous `sm`, le bouton prend toute la largeur et son libellé passe à la ligne (« Connecter
   * mon compte Google Search Console » ne tient pas à 375 px) ; l'icône dit qu'on part chez le tiers.
   */
  dansLePied?: boolean
}

export function ConnexionParConsentement({ ressource, connecteur, acces, libelle, nomAccessible, retour, avantDePartir, apresUnEchec, variante = "secondary", dansLePied = false }: ConnexionProps) {
  const [enCours, setEnCours] = useState(false)
  const [erreur, setErreur] = useState("")

  async function connecter() {
    if (avantDePartir && !(await avantDePartir())) return
    setErreur("")
    setEnCours(true)
    const corps = { connector: connecteur, ...(acces !== undefined ? { access: acces } : {}), ...(retour ? { return_to: retour } : {}) }
    const reponse = await appelerPlateforme<{ url: string }>({ methode: "POST", ressource, corps })
    if (reponse.erreur) {
      apresUnEchec?.()
      setErreur(messageDErreur(reponse.erreur))
      setEnCours(false)
      return
    }
    window.location.assign(reponse.data.url)
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        type="button"
        variant={variante}
        disabled={enCours}
        aria-busy={enCours}
        aria-label={nomAccessible}
        onClick={() => void connecter()}
        className={dansLePied ? "max-sm:w-full" : undefined}
        iconEnd={dansLePied ? <Icon as={ArrowSquareOut} size="xs" /> : undefined}
      >
        {/* Sur deux lignes au plus dans la hauteur du bouton : `.oto-btn` ne passe pas à la ligne, son libellé si. */}
        {dansLePied ? <span className="block whitespace-normal text-center leading-tight">{enCours ? "Redirection…" : libelle}</span> : enCours ? "Redirection…" : libelle}
      </Button>
      {erreur && <Alert tone="fail" title={erreur} />}
    </div>
  )
}
