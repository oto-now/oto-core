import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import {
  connectorAccountForms,
  deactivationImpact,
  isOrgAdmin,
  listConnectorsForOrg,
  listOrgAccounts,
  listTeams,
  orgLimitsView,
  type Identity,
  type PlatformDb,
} from "@otomata_tech/oto_platform/server"
import {
  EcranConnecteurs,
  issueDuConsentement,
  reserveAuxAdministrateurs,
  resultatDe,
  type DonneesDesConnecteurs,
  type EcranConnecteursProps,
} from "@otomata_tech/oto_platform/ui"
import { getPlatformIdentitySafely } from "@/lib/plateforme/session"
import { ADRESSES } from "../adresses"

// « Connecteurs » (E08-S03) : réservée à qui administre l'organisation de l'adresse, décidé ici par
// `isOrgAdmin` avant tout appel (AC1, N1) ; chaque service redécide son droit. La page lit le
// catalogue, les comptes et les équipes avec le jeton de la session, puis l'impact de la désactivation
// de chaque connecteur actif, et le formulaire de compte de chaque connecteur réel déclaré ; l'écran écrit par
// `/api/platform/admin/*`, et connecte un compte à consentement par `/api/platform/connector-consent`, dont le retour
// ramène ici avec son issue en query.
export const metadata: Metadata = {
  title: "Connecteurs",
  robots: { index: false },
}

const ECHEC = { error: "Une erreur est survenue. Réessayez." } as const
const ICI = "/admin/connectors"

async function lire(db: PlatformDb, identity: Identity): Promise<DonneesDesConnecteurs> {
  // Trois lectures indépendantes, en parallèle (`performance-patterns.md § Data Fetching Performance`).
  // Les capacités (E12-S02) : leur panne ne grise rien, le service refuse quand même.
  const [connectors, accounts, teams, limites] = await Promise.all([
    listConnectorsForOrg(db, identity),
    listOrgAccounts(db, identity),
    listTeams(db, identity),
    orgLimitsView(db, identity).catch(() => undefined),
  ])
  const actifs = connectors.filter((connecteur) => connecteur.state === "active")
  const impacts = await Promise.all(actifs.map(async ({ connector }) => [connector, await deactivationImpact(db, identity, connector)] as const))
  return {
    connectors,
    impacts: Object.fromEntries(impacts),
    accounts,
    options: { teams: teams.map(({ id, name }) => ({ id, name })) },
    limites,
    formulaires: connectorAccountForms(),
  }
}

export default async function ConnecteursPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  // La session et l'appartenance se revérifient ici, hors de tout `try` : le layout n'est pas une
  // frontière (`nextjs-patterns.md § Un layout n'est JAMAIS une frontière d'autorisation`).
  const identite = await getPlatformIdentitySafely("admin/connectors")
  if (identite?.error?.code === "unauthenticated") redirect("/login")
  if (identite?.error) redirect("/no-organization")

  const administre = identite ? isOrgAdmin(identite.data.identity) : false
  let resultat: EcranConnecteursProps["resultat"] = ECHEC
  if (identite && !administre) resultat = { error: reserveAuxAdministrateurs(identite.data.identity.org.name) }
  else if (identite) resultat = await resultatDe(lire(identite.data.session.db, identite.data.identity))
  const consentement = searchParams ? issueDuConsentement(await searchParams) : undefined
  return <EcranConnecteurs resultat={resultat} Lien={Link} ici={ICI} fil={{ adresses: ADRESSES, administre }} consentement={consentement} />
}
