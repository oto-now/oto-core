import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import type { AccountView } from "@otomata_tech/oto_platform/schemas"
import {
  connectorAccountForms,
  deactivationImpact,
  isOrgAdmin,
  listAccountRules,
  listConnectorsForOrg,
  listOrgAccounts,
  listOwnAccounts,
  listTeams,
  orgLimitsView,
  type Identity,
  type PlatformDb,
} from "@otomata_tech/oto_platform/server"
import {
  EcranConnecteurs,
  issueDuConsentement,
  partageable,
  resultatDe,
  type DonneesDeMesComptes,
  type DonneesDesConnecteurs,
  type EcranConnecteursProps,
} from "@otomata_tech/oto_platform/ui"
import { getPlatformIdentitySafely } from "@/lib/plateforme/session"
import { ADRESSES } from "../adresses"

// « Connecteurs » (E08-S03 ; ouvert aux membres) : qui administre l'organisation de l'adresse, décidé ici par
// `isOrgAdmin` (AC1, N1), y lit le catalogue, les comptes de l'organisation et les équipes, l'impact de la désactivation
// de chaque connecteur actif et le formulaire de compte de chaque connecteur réel déclaré ; un autre membre, ses seuls
// comptes personnels (`listOwnAccounts`). Pour chacun, les partages de chaque compte personnel qu'il gère
// (`partageable`, `listAccountRules`). Chaque service redécide son droit ; tout se lit avec le jeton de la session.
// L'écran écrit par `/api/platform/admin/*`, partages compris (`admin/account-rules`), et connecte un compte à
// consentement par `/api/platform/connector-consent`, dont le retour ramène ici avec son issue en query.
export const metadata: Metadata = {
  title: "Connecteurs",
  robots: { index: false },
}

const ECHEC = { error: "Une erreur est survenue. Réessayez." } as const
const ICI = "/admin/connectors"

/** Les partages de chaque compte personnel que la personne gère, en parallèle : ses comptes, peu nombreux. */
async function partagesDe(db: PlatformDb, identity: Identity, accounts: AccountView[]): Promise<DonneesDesConnecteurs["partages"]> {
  const lus = await Promise.all(accounts.filter(partageable).map(async ({ id }) => [id, await listAccountRules(db, identity, id)] as const))
  return Object.fromEntries(lus)
}

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
  const [impacts, partages] = await Promise.all([
    Promise.all(actifs.map(async ({ connector }) => [connector, await deactivationImpact(db, identity, connector)] as const)),
    partagesDe(db, identity, accounts),
  ])
  return {
    connectors,
    impacts: Object.fromEntries(impacts),
    accounts,
    options: { teams: teams.map(({ id, name }) => ({ id, name })) },
    limites,
    formulaires: connectorAccountForms(),
    partages,
  }
}

/** La vue d'un membre qui n'administre pas : ses comptes personnels, leurs partages, les équipes à qui partager. */
async function lireMesComptes(db: PlatformDb, identity: Identity): Promise<DonneesDeMesComptes> {
  const [accounts, teams] = await Promise.all([listOwnAccounts(db, identity), listTeams(db, identity)])
  return {
    accounts,
    options: { teams: teams.map(({ id, name }) => ({ id, name })) },
    formulaires: connectorAccountForms(),
    partages: await partagesDe(db, identity, accounts),
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
  if (identite) {
    const { db } = identite.data.session
    const { identity } = identite.data
    resultat = await resultatDe(administre ? lire(db, identity) : lireMesComptes(db, identity))
  }
  const consentement = searchParams ? issueDuConsentement(await searchParams) : undefined
  return <EcranConnecteurs resultat={resultat} Lien={Link} ici={ICI} fil={{ adresses: ADRESSES, administre }} consentement={consentement} />
}
