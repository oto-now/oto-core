// La page de connexion d'un connecteur (`/connect/<connecteur>?space=…`, `connexion-par-l-agent.md` § Page) : l'adresse
// qu'un refus ou `connector.connect` donne à l'assistant. La page de l'hôte lit l'étape (`connectionStep`), sans rien
// écrire. L'écran montre : l'issue du retour du tiers (réussi, avec l'invitation à revenir à l'assistant, ou échoué, sa
// raison connue seule, avec « Réessayer »), le bouton qui part chez le tiers (`POST` de même origine, jamais à
// l'ouverture), la saisie du compte, la confirmation de l'activation par un administrateur (un bouton), ou l'adresse à
// transmettre aux administrateurs. Server Component ; données, erreur (`role="alert"`). Sans lui, l'adresse d'un refus
// ne mènerait à aucun geste.
import { Plug } from "@phosphor-icons/react/dist/ssr/Plug"
import type { ConnectionStepView } from "../../schemas"
import { ConnexionParConsentement } from "../admin/connecteurs/connexion-par-consentement"
import { echecDuConsentement, type IssueDuConsentement } from "../admin/connecteurs/ecran-connecteurs"
import type { Resultat } from "../api/resultat"
import { ActionPlateforme } from "../components/action-plateforme"
import { ErreurDeLecture } from "../components/erreur-de-lecture"
import { ValeurCopiable } from "../connexion/valeur-copiable"
import { Icon } from "../ds/react/icon"
import { Island, IslandBody } from "../ds/react/island"
import { Alert } from "../ds/react/primitives"
import { ScreenHeader } from "../ds/react/screen-header"
import { CONNEXION_D_UN_CONNECTEUR as MOTS } from "./libelles"
import { SaisieDuCompteAConnecter } from "./saisie-du-compte-a-connecter"

/** Une étape que l'écran rend. */
export type EtapeAffichee = ConnectionStepView

/** Le bouton qui démarre le consentement ou le branchement, et le compte hébergé déjà relié ailleurs. */
function Autorisation({ etape, retour }: { etape: Extract<EtapeAffichee, { kind: "authorize" }>; retour: string }) {
  const consentement = etape.gesture === "oauth"
  const ailleurs = etape.elsewhere?.join(", ")
  const libelle = consentement ? MOTS.autoriser(etape.label) : ailleurs ? MOTS.relier(etape.label) : MOTS.brancher(etape.label)
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink">{consentement ? MOTS.consentement(etape.label) : MOTS.branchement(etape.label)}</p>
      {ailleurs && <p className="text-sm text-ink">{MOTS.ailleurs(etape.label, ailleurs)}</p>}
      <div>
        <ConnexionParConsentement
          ressource={consentement ? "connector-consent" : "hosted-link"}
          connecteur={etape.connector}
          {...(etape.access ? { acces: etape.access } : {})}
          libelle={libelle}
          retour={retour}
        />
      </div>
    </div>
  )
}

function Etape({ etape, retour }: { etape: EtapeAffichee; retour: string }) {
  switch (etape.kind) {
    case "authorize":
      return <Autorisation etape={etape} retour={retour} />
    case "key":
      return <SaisieDuCompteAConnecter etape={etape} />
    case "activate":
      return (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-ink">{MOTS.activation(etape.label)}</p>
          <div>
            <ActionPlateforme
              libelle={MOTS.activer(etape.label)}
              nomAccessible={MOTS.activer(etape.label)}
              requete={{ methode: "POST", ressource: `admin/connectors/${encodeURIComponent(etape.connector)}/activation`, corps: {} }}
              ancre={MOTS.ancre}
            />
          </div>
        </div>
      )
    case "ask_admin":
      return (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-ink">{MOTS.administrateurs(etape.label, etape.administrators.map((admin) => admin.name).join(", "))}</p>
          <ValeurCopiable valeur={etape.url} cible={MOTS.lien} />
        </div>
      )
  }
}

/** L'issue du retour du tiers : réussie, la personne revient à son assistant ; échouée, elle réessaie. */
function Issue({ issue, reessayer }: { issue: IssueDuConsentement; reessayer: string }) {
  if (issue.issue === "connected") {
    return (
      <Alert tone="ok" title={MOTS.reussi}>
        {MOTS.revenir}
      </Alert>
    )
  }
  return (
    <Alert tone="fail" title={echecDuConsentement(issue.raison)}>
      <a className="underline" href={reessayer}>
        {MOTS.reessayer}
      </a>
    </Alert>
  )
}

export type EcranConnexionDUnConnecteurProps = {
  /** Le nom de l'outil, pour le titre : le libellé de l'étape, sinon le nom de l'adresse. */
  outil: string
  /** L'étape (`connectionStep`, par `resultatDe`), absente quand l'adresse porte l'issue du retour du tiers. */
  resultat?: Resultat<EtapeAffichee>
  /** L'issue du retour du tiers (`issueDuConsentement`), lue dans l'adresse. */
  issue?: IssueDuConsentement
  /** L'adresse de la page sans l'issue : « Réessayer » y repart, et le tiers y ramène. */
  reessayer: string
}

export function EcranConnexionDUnConnecteur({ outil, resultat, issue, reessayer }: EcranConnexionDUnConnecteurProps) {
  const libelle = resultat?.data?.label ?? outil
  return (
    <>
      <ScreenHeader title={<span id={MOTS.ancre} tabIndex={-1}>{MOTS.titre(libelle)}</span>} icon={<Icon as={Plug} size="sm" />} meta={MOTS.description} />
      <Island aria-label={MOTS.ilot}>
        <IslandBody className="flex flex-col gap-4">
          {issue ? (
            <Issue issue={issue} reessayer={reessayer} />
          ) : resultat?.error !== undefined ? (
            <ErreurDeLecture titre={MOTS.impossible} message={resultat?.error ?? ""} />
          ) : (
            resultat && <Etape etape={resultat.data} retour={reessayer} />
          )}
        </IslandBody>
      </Island>
    </>
  )
}
