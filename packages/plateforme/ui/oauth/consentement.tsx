// Consentement OAuth d'un assistant (E02-S02, AC9 à AC14, AC17, AC21) : qui demande l'accès, avec
// quel compte, pour quelle organisation, et ce qu'il pourra faire. Server Component : il choisit
// l'état et pose la Server Action de l'hôte (`decider`) en `action` du formulaire, sans qu'aucune
// fonction ne traverse la frontière client ; seuls les boutons ont un état (`BoutonsDeDecision`).
//
// Aucun écran d'oto-frontend (la connexion d'Oto passe par Logto) : l'îlot est celui de ses écrans
// d'identifiants (`src/components/auth/auth-page.tsx`), sur le design system porté (E05-S09, partie d3) —
// `Island`, l'en-tête du client dans `IslandHead`, la demande dans `IslandBody`, la décision au pied, les
// messages dans des `Alert`. Repris du banc E03 (`mcp-test/src/app/(auth)/oauth/consent/page.tsx`
// l. 64-122, `consent-form.tsx`) : en-tête du client (logo `no-referrer`, nom, site), liste de définitions
// (compte, adresse de retour en `<code>`, accès, « Aucun scope » devenu une phrase), Refuser et Autoriser,
// erreur sous les boutons. Retiré : la marque de l'hôte de la page (celle de l'organisation de la
// ressource la remplace, E09-S02), la carte et les jetons du gabarit.
import type { ReactNode } from "react"
import { webUrl } from "../../schemas/oauth"
import { LIEN } from "../components/classes"
import { Island, IslandBody, IslandFoot, IslandHead } from "../ds/react/island"
import { Alert } from "../ds/react/primitives"
import { Skeleton } from "../ds/react/skeleton"
import { LogoDOrganisation } from "../marque/logo-d-organisation"
import { BoutonsDeDecision } from "./boutons-de-decision"
import type { DemandeDeConsentement, ErreurDeDecision, OrganisationDeLaDemande } from "./types"

/** Même forme que le retour des actions (`ActionResult`) : la demande, ou le message à montrer. */
type ResultatDeConsentement = { data: DemandeDeConsentement; error?: never } | { data?: never; error: string }

type ConsentementProps = {
  resultat: ResultatDeConsentement
  /** Server Action de l'hôte : reçoit `authorization_id` et `decision` (`approve` ou `deny`). */
  decider: (formData: FormData) => void | Promise<void>
  /** Échec de la décision précédente, lu par l'hôte dans son adresse (`?error=`). */
  erreur?: ErreurDeDecision
}

const ECHECS: Record<ErreurDeDecision, string> = {
  decision: "La décision n'a pas abouti. Rechargez la page, puis réessayez.",
}

function nomDeLOrganisation(organisation: OrganisationDeLaDemande): string {
  if (organisation.etat === "connue") return organisation.nom
  if (organisation.etat === "inconnue") return `Adresse inconnue (${organisation.hote})`
  // Le MCP admin n'a pas d'organisation d'adresse : il est nommé (HN-E02S02-28).
  if (organisation.etat === "administration") return "Administration de la plateforme"
  return "Non déterminée"
}

// Le terme : l'étiquette du design system, dont la marge du bas donne l'air au-dessus de la valeur.
function Detail({ terme, children }: { terme: string; children: ReactNode }) {
  return (
    <div className="flex flex-col">
      <dt className="oto-label">{terme}</dt>
      <dd>{children}</dd>
    </div>
  )
}

/**
 * La marque de l'organisation de la ressource (E09-S02, AC14), au-dessus du titre : la même pour un
 * membre et pour un non-membre, publique sur `/login` de son adresse. Rien sans organisation connue.
 */
function MarqueDeLOrganisation({ organisation }: { organisation: OrganisationDeLaDemande }) {
  if (organisation.etat !== "connue") return null
  const { marque } = organisation
  return (
    <p className="flex items-center gap-2 text-sm font-semibold">
      <LogoDOrganisation nom={marque.nomAffiche} logo={webUrl(marque.logo)} taille={32} />
      <span>{marque.nomAffiche}</span>
    </p>
  )
}

function EnTeteDuClient({ client, organisation }: { client: DemandeDeConsentement["client"]; organisation: OrganisationDeLaDemande }) {
  // Revérifiées ici aussi : un hôte peut construire la demande sans `consentRequest`, et seule une
  // adresse `http:` ou `https:` part en `href` ou en `src`.
  const site = webUrl(client.site)
  const logo = webUrl(client.logo)
  return (
    <IslandHead>
      <div className="flex min-w-0 flex-col gap-3 py-1">
        <MarqueDeLOrganisation organisation={organisation} />
        <div className="flex items-start gap-3">
          {logo && <LogoDOrganisation nom={client.nom} logo={logo} taille={40} />}
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="oto-page-title break-words">{`${client.nom} demande l'accès à votre compte`}</h1>
            {site && (
              <a href={site} target="_blank" rel="noopener noreferrer" className={`break-all text-sm ${LIEN}`}>
                {site}
              </a>
            )}
          </div>
        </div>
      </div>
    </IslandHead>
  )
}

function DetailsDeLaDemande({ demande }: { demande: DemandeDeConsentement }) {
  return (
    <dl className="flex flex-col gap-4">
      <Detail terme="Organisation">{nomDeLOrganisation(demande.organisation)}</Detail>
      <Detail terme="Compte">{demande.compte}</Detail>
      <Detail terme="Adresse de retour">
        <code className="break-all">{demande.adresseDeRetour}</code>
      </Detail>
      <Detail terme="Accès demandés">
        {demande.acces.length === 0 ? (
          // Supabase omet un `scope` vide : une phrase, jamais une liste vide.
          "Aucun accès particulier demandé"
        ) : (
          <ul className="list-disc space-y-1 ps-5">
            {/* Un scope peut revenir deux fois : affiché tel que le host l'envoie. */}
            {demande.acces.map(({ scope, libelle }, rang) => (
              <li key={`${rang}-${scope}`}>{libelle}</li>
            ))}
          </ul>
        )}
      </Detail>
    </dl>
  )
}

/**
 * Non-membre : prévenu sans être bloqué (HN-E02S02-9). Ses appels à cette organisation seront refusés,
 * mais le jeton ne porte pas l'adresse : il vaut pour les organisations dont la personne est membre
 * (`mcp-patterns.md § 6`, point 8). L'avis le dit, sans pousser à consentir (HN-E02S02-28) ; ton
 * d'information (`run`) : sa description tient 4,58:1 sur la teinte, celle d'un avertissement 4,36:1.
 */
function AvisDeNonMembre({ organisation }: { organisation: OrganisationDeLaDemande }) {
  if (organisation.etat !== "connue" || organisation.membre) return null
  const { nom } = organisation
  return (
    <Alert tone="run">
      {`Vous n'êtes pas membre de ${nom} : l'assistant ne pourra rien y faire. Il aura pourtant accès à votre compte, donc aux organisations dont vous êtes membre : refusez si vous n'avez pas lancé cette connexion vous-même. Pour ${nom}, demandez l'accès à l'un de ses administrateurs.`}
    </Alert>
  )
}

export function Consentement({ resultat, decider, erreur }: ConsentementProps) {
  if (resultat.error !== undefined) {
    return (
      <Island aria-label="Autorisation impossible">
        <IslandHead>
          <h1 className="oto-page-title">Autorisation impossible</h1>
        </IslandHead>
        <IslandBody>
          <Alert tone="fail">{resultat.error}</Alert>
        </IslandBody>
      </Island>
    )
  }

  const demande = resultat.data
  return (
    <Island aria-label={`${demande.client.nom} demande l'accès à votre compte`}>
      <EnTeteDuClient client={demande.client} organisation={demande.organisation} />
      <IslandBody className="flex flex-col gap-4">
        <DetailsDeLaDemande demande={demande} />
        <AvisDeNonMembre organisation={demande.organisation} />
      </IslandBody>
      <IslandFoot>
        <form action={decider} className="flex w-full flex-col gap-3">
          <input type="hidden" name="authorization_id" value={demande.authorizationId} />
          <BoutonsDeDecision />
          {erreur && <Alert tone="fail">{ECHECS[erreur]}</Alert>}
        </form>
      </IslandFoot>
    </Island>
  )
}

/** L'état de chargement, à passer en `fallback` du `<Suspense>` qui attend la demande. */
export function ConsentementChargement() {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-3">
      <span className="oto-sr-only">Chargement de la demande d&apos;autorisation…</span>
      <Skeleton width="66%" />
      <Skeleton />
      <Skeleton width="50%" />
    </div>
  )
}
