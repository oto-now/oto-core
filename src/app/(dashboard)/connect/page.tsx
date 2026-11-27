import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { connectAddress, lastConnections, type LastConnection } from "@otomata_tech/oto_platform/server"
import { EcranConnexion, resultatDe, type DerniereConnexion } from "@otomata_tech/oto_platform/ui"
import { adresseDe } from "@/lib/plateforme/connexion"
import { getPlatformIdentity, getRequestOrigin } from "@/lib/plateforme/session"
import { loginPath } from "@/lib/schemas/auth"

// « Brancher mon Claude, ChatGPT ou Mistral » (E02-S04, E11-S09) : le guide en deux temps, le même pour tous
// les assistants, pour l'organisation de l'adresse, sous les dernières connexions de la personne. La page
// lit les services du paquet avec le jeton de la session ; `resource_documentation` des métadonnées OAuth y
// mène (E02-S02).
export const metadata: Metadata = {
  title: "Brancher mon Claude, ChatGPT ou Mistral",
  robots: { index: false },
}

const ICI = "/connect"

function connexionsDe(connexions: LastConnection[]): DerniereConnexion[] {
  return connexions.map(({ family, signature, at }) => ({ famille: family, signature, date: at }))
}

export default async function ConnectPage() {
  // La session et l'appartenance se revérifient ici, hors de tout `try` : le layout n'est pas une
  // frontière (`nextjs-patterns.md § Un layout n'est JAMAIS une frontière d'autorisation`).
  const identite = await getPlatformIdentity()
  if (identite.error?.code === "unauthenticated") redirect(loginPath(ICI))
  if (identite.error) redirect("/no-organization")
  // L'identité vient de l'hôte de la requête : sans hôte, elle n'aurait pas été résolue.
  const origine = await getRequestOrigin()
  if (!origine) redirect("/no-organization")

  const { identity, session } = identite.data
  // Son échec se dit seul, le guide reste affiché (AC-13).
  const connexions = await resultatDe(lastConnections(session.db, identity).then(connexionsDe))
  return (
    <EcranConnexion
      adresse={adresseDe(connectAddress(identity, origine))}
      connexions={connexions}
      Lien={Link}
      ici={ICI}
    />
  )
}
