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
  listMembers,
  listOrgAccounts,
  listTeams,
  orgLimitsView,
  type Identity,
  type PlatformDb,
} from "@otomata_tech/oto_platform/server"
import {
  comptesAuxPartagesLus,
  EcranConnecteurs,
  issueDuConsentement,
  resultatDe,
  vueDesConnecteurs,
  type DonneesDesConnecteurs,
  type EcranConnecteursProps,
} from "@otomata_tech/oto_platform/ui"
import { getPlatformIdentitySafely } from "@/lib/plateforme/session"
import { ADRESSES } from "../adresses"

// « Connecteurs » : une seule vue pour tout membre. La page lit les comptes que la personne voit (`listOrgAccounts` :
// les siens, ceux de ses équipes, de l'organisation, ceux qu'un autre partage avec elle), le catalogue, les équipes et
// les personnes à qui partager, le formulaire de compte de chaque connecteur réel déclaré, puis les partages de ses
// propres comptes et du compte que l'adresse ouvre (`comptesAuxPartagesLus`, `listAccountRules`). Qui administre
// l'organisation de l'adresse, décidé ici par `isOrgAdmin`, y lit en plus l'impact de la désactivation de chaque
// connecteur actif et les capacités. Chaque service redécide son droit ; tout se lit avec le jeton de la session.
// L'écran écrit par `/api/platform/admin/*`, partages compris (`admin/account-rules`), et connecte un compte à
// consentement par `/api/platform/connector-consent`, dont le retour ramène ici avec son issue en query.
export const metadata: Metadata = {
  title: "Connecteurs",
  robots: { index: false },
}

const ECHEC = { error: "Une erreur est survenue. Réessayez." } as const
const ICI = "/admin/connectors"

/** Les partages des comptes de la personne, et du compte ouvert si elle le gère, en parallèle : peu nombreux. */
async function partagesDe(db: PlatformDb, identity: Identity, accounts: AccountView[], ouvert: string | null): Promise<DonneesDesConnecteurs["partages"]> {
  const lus = await Promise.all(comptesAuxPartagesLus(accounts, identity.user.id, ouvert).map(async ({ id }) => [id, await listAccountRules(db, identity, id)] as const))
  return Object.fromEntries(lus)
}

/** Ce que seul un administrateur lit : l'impact de chaque désactivation possible, et les capacités (E12-S02), dont la panne ne grise rien. */
async function administration(db: PlatformDb, identity: Identity, connectors: DonneesDesConnecteurs["connectors"]): Promise<DonneesDesConnecteurs["administration"]> {
  const actifs = connectors.filter((connecteur) => connecteur.state === "active")
  const [impacts, limites] = await Promise.all([
    Promise.all(actifs.map(async ({ connector }) => [connector, await deactivationImpact(db, identity, connector)] as const)),
    orgLimitsView(db, identity).catch(() => undefined),
  ])
  return { impacts: Object.fromEntries(impacts), limites }
}

async function lire(db: PlatformDb, identity: Identity, ouvert: string | null): Promise<DonneesDesConnecteurs> {
  // Quatre lectures indépendantes, en parallèle (`performance-patterns.md § Data Fetching Performance`).
  const [accounts, connectors, teams, members] = await Promise.all([
    listOrgAccounts(db, identity),
    listConnectorsForOrg(db, identity),
    listTeams(db, identity),
    listMembers(db, identity),
  ])
  const [partages, reserve] = await Promise.all([
    partagesDe(db, identity, accounts, ouvert),
    isOrgAdmin(identity) ? administration(db, identity, connectors) : undefined,
  ])
  return {
    accounts,
    connectors,
    formulaires: connectorAccountForms(),
    partages,
    sujets: { equipes: teams.map(({ id, name }) => ({ id, nom: name })), personnes: members.map(({ userId, name }) => ({ id: userId, nom: name })) },
    administration: reserve,
  }
}

export default async function ConnecteursPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  // La session et l'appartenance se revérifient ici, hors de tout `try` : le layout n'est pas une
  // frontière (`nextjs-patterns.md § Un layout n'est JAMAIS une frontière d'autorisation`).
  const identite = await getPlatformIdentitySafely("admin/connectors")
  if (identite?.error?.code === "unauthenticated") redirect("/login")
  if (identite?.error) redirect("/no-organization")

  const query = searchParams ? await searchParams : {}
  const vue = vueDesConnecteurs(query)
  let resultat: EcranConnecteursProps["resultat"] = ECHEC
  if (identite) resultat = await resultatDe(lire(identite.data.session.db, identite.data.identity, vue.compte))
  return (
    <EcranConnecteurs
      resultat={resultat}
      moi={identite?.data.identity.user.id ?? ""}
      vue={vue}
      Lien={Link}
      ici={ICI}
      fil={{ adresses: ADRESSES, administre: identite ? isOrgAdmin(identite.data.identity) : false }}
      consentement={issueDuConsentement(query)}
    />
  )
}
