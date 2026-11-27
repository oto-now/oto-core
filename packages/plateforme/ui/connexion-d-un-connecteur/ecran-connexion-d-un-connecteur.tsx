// La page de connexion d'un connecteur (`/connect/<connecteur>?space=…`, `connexion-par-l-agent.md` § Page) : l'adresse
// qu'un refus ou `connector.connect` donne à l'assistant. La page de l'hôte lit l'étape (`connectionStep`), sans rien
// écrire. L'écran montre : l'issue du retour du tiers (réussi, avec l'invitation à revenir à l'assistant, ou échoué, sa
// raison connue seule, avec « Réessayer »), le bouton qui part chez le tiers (`POST` de même origine, jamais à
// l'ouverture), la saisie du compte, celle de la clé d'un compte existant, la confirmation de l'activation par un
// administrateur (un bouton), ou l'adresse à transmettre aux administrateurs ; pour un connecteur à plusieurs accès, le
// choix de l'accès, ou les autres accès à côté du geste de l'un. Server Component ; données, erreur (`role="alert"`). Sans lui, l'adresse d'un refus
// ne mènerait à aucun geste.
import { Plug } from "@phosphor-icons/react/dist/ssr/Plug"
import type { ConnectAccessChoice, ConnectionStepView } from "../../schemas"
import { ConnexionParConsentement } from "../admin/connecteurs/connexion-par-consentement"
import { ORDRE } from "../admin/connecteurs/catalogue-des-connecteurs"
import { echecDuConsentement, type IssueDuConsentement } from "../admin/connecteurs/ecran-connecteurs"
import { faconDeLAcces } from "../admin/connecteurs/etat-du-compte"
import type { Resultat } from "../api/resultat"
import { ActionPlateforme } from "../components/action-plateforme"
import { LIEN } from "../components/classes"
import { ErreurDeLecture } from "../components/erreur-de-lecture"
import { ValeurCopiable } from "../connexion/valeur-copiable"
import { Icon } from "../ds/react/icon"
import { Island, IslandBody } from "../ds/react/island"
import { Alert } from "../ds/react/primitives"
import { ScreenHeader } from "../ds/react/screen-header"
import { CONNEXION_D_UN_CONNECTEUR as MOTS } from "./libelles"
import { SaisieDeLaCleDuCompte, SaisieDuCompteAConnecter } from "./saisie-du-compte-a-connecter"

/** Une étape que l'écran rend. */
export type EtapeAffichee = ConnectionStepView

/**
 * Les accès d'un connecteur à plusieurs accès, chacun un lien vers la même page qui le nomme, l'espace de l'adresse
 * gardé (sans lui, le service le choisit selon l'accès). Le lien dit la façon de l'accès comme la fiche d'ajout de
 * l'écran Connecteurs (`faconDeLAcces`), d'après l'espace que le service lui retient, jamais son libellé déclaré seul,
 * et les façons se rangent comme dans la fiche, soi d'abord (`ORDRE`). Le lien ne fait rien de plus qu'une ouverture.
 */
function Acces({ connecteur, outil, acces }: { connecteur: string; outil: string; acces: ConnectAccessChoice[] }) {
  const aDire = acces.map((choix) => ({ nom: choix.name, libelle: choix.label, chezLeTiers: choix.gesture !== "key", proprietaires: choix.owner ? [choix.owner] : [] }))
  // Chez le tiers, c'est pour soi ; une clé sans espace dit (`others`) vient après celles qui le disent.
  const rang = (choix: ConnectAccessChoice) => (choix.gesture !== "key" ? 0 : choix.owner ? ORDRE.indexOf(choix.owner) : ORDRE.length)
  const ranges = acces.map((choix, indice) => ({ choix, dit: aDire[indice] })).sort((a, b) => rang(a.choix) - rang(b.choix))
  return (
    <ul className="flex flex-col gap-1 text-sm text-ink" aria-label={MOTS.listeDesAcces}>
      {ranges.map(({ choix, dit }) => (
        <li key={choix.name}>
          <a className={LIEN} href={`/connect/${encodeURIComponent(connecteur)}?${new URLSearchParams({ access: choix.name, ...(choix.space ? { space: choix.space } : {}) }).toString()}`}>
            {faconDeLAcces(outil, dit, aDire)}
          </a>
        </li>
      ))}
    </ul>
  )
}

/** Les autres accès offerts à côté du geste d'un accès : rien pour un connecteur à un seul accès. */
function AutresAcces({ etape }: { etape: { connector: string; label: string; others?: ConnectAccessChoice[] } }) {
  if (!etape.others || etape.others.length === 0) return null
  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm text-ink">{MOTS.autres}</p>
      <Acces connecteur={etape.connector} outil={etape.label} acces={etape.others} />
    </div>
  )
}

/** Le bouton qui démarre le consentement ou le branchement, et le compte hébergé déjà relié ailleurs. */
function Autorisation({ etape, retour }: { etape: Extract<EtapeAffichee, { kind: "authorize" }>; retour: string }) {
  const consentement = etape.gesture === "oauth"
  // Une organisation sans nom lisible se dit une fois, quel que soit leur nombre.
  const ailleurs = etape.elsewhere && [...new Set(etape.elsewhere.map((nom) => nom ?? MOTS.autreOrganisation))].join(", ")
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
    case "choose_access":
      return (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-ink">{MOTS.choisir(etape.label)}</p>
          <Acces connecteur={etape.connector} outil={etape.label} acces={etape.accesses} />
        </div>
      )
    case "authorize":
      return (
        <>
          <Autorisation etape={etape} retour={retour} />
          <AutresAcces etape={etape} />
        </>
      )
    case "key":
      return (
        <>
          <SaisieDuCompteAConnecter etape={etape} />
          <AutresAcces etape={etape} />
        </>
      )
    case "account_key":
      return <SaisieDeLaCleDuCompte etape={etape} />
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
          <AutresAcces etape={etape} />
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
      <a className={LIEN} href={reessayer}>
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
