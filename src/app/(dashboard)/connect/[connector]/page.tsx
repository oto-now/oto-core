import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { connectionStep } from "@otomata_tech/oto_platform/server"
import { EcranConnexionDUnConnecteur, issueDuConsentement, resultatDe, type EtapeAffichee } from "@otomata_tech/oto_platform/ui"
// Pour son effet : la page lit les connecteurs que l'hôte déclare, et son bundle n'a pas ceux des routes.
import "@/lib/fonctions-metier"
import { getPlatformIdentity, getRequestOrigin } from "@/lib/plateforme/session"
import { loginPath } from "@/lib/schemas/auth"

// « Connecter un outil » (`connexion-par-l-agent.md` § Page) : l'adresse finale qu'un refus de connecteur ou
// `connector.connect` donne à l'assistant. La session et l'appartenance se revérifient ici ; sans session, la connexion
// ramène sur cette même adresse. Le service décide l'étape sous le jeton de la session, l'espace de l'adresse revérifié :
// un consentement ou un branchement part aussitôt chez le tiers (la demande posée, cette page pour retour), le reste se
// montre. Le retour du tiers revient ici avec son issue en query, qui ne relance rien.
export const metadata: Metadata = {
  title: "Connecter un outil",
  robots: { index: false },
}

type Query = Record<string, string | string[] | undefined>

/** La query de l'étape : l'espace, l'accès, `activate` ; le reste (l'issue d'un retour) n'en est pas. */
function entreeDe(query: Query): Record<string, string> {
  return Object.fromEntries(["space", "access", "activate"].flatMap((nom) => (typeof query[nom] === "string" ? [[nom, query[nom]]] : [])))
}

export default async function ConnexionDUnConnecteurPage({ params, searchParams }: { params: Promise<{ connector: string }>; searchParams: Promise<Query> }) {
  const [{ connector }, query] = await Promise.all([params, searchParams])
  const entree = entreeDe(query)
  const parametres = new URLSearchParams(entree).toString()
  const ici = `/connect/${encodeURIComponent(connector)}${parametres ? `?${parametres}` : ""}`
  // Hors de tout `try` : le layout n'est pas une frontière (`nextjs-patterns.md § Un layout n'est JAMAIS une frontière d'autorisation`).
  const identite = await getPlatformIdentity()
  if (identite.error?.code === "unauthenticated") redirect(loginPath(ici))
  if (identite.error) redirect("/no-organization")

  const issue = issueDuConsentement(query)
  if (issue) return <EcranConnexionDUnConnecteur outil={connector} issue={issue} reessayer={ici} />

  const origine = await getRequestOrigin()
  if (!origine) {
    console.error("[host] connect page: no trusted public address for this request")
    const resultat = { error: "L'adresse publique de cette organisation n'est pas réglée : la connexion ne peut pas aboutir. Demandez à qui gère l'application." }
    return <EcranConnexionDUnConnecteur outil={connector} resultat={resultat} reessayer={ici} />
  }
  const { identity, session } = identite.data
  const etape = await resultatDe(connectionStep(session.db, identity, { connector, ...entree }, { origin: origine }))
  if (etape.data?.kind === "redirect") redirect(etape.data.url)
  return <EcranConnexionDUnConnecteur outil={connector} resultat={etape as { data: EtapeAffichee } | { error: string }} reessayer={ici} />
}
