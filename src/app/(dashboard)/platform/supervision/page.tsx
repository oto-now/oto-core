import type { Metadata } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { listPlatformOrgs } from "@otomata_tech/oto_platform/server"
import { EcranSupervision, resultatDe } from "@otomata_tech/oto_platform/ui"
import { getPlatformSession, getPlatformStaff } from "@/lib/plateforme/session"

// « Supervision » (administration et cellule, N9) : tous les espaces de la cellule, pour l'équipe plateforme seule,
// sans accès daté. La page décide le droit avant toute lecture (`getPlatformStaff`, par `requireStaff`) : hors de
// l'équipe plateforme, la page n'existe pas (`notFound`) ; `listPlatformOrgs` le redécide, et ses fonctions SQL en base.
export const metadata: Metadata = {
  title: "Supervision",
  robots: { index: false },
}

const ICI = "/platform/supervision"

export default async function SupervisionPage() {
  // La session se revérifie ici : le layout n'est pas une frontière (`nextjs-patterns.md § Un layout n'est JAMAIS une
  // frontière d'autorisation`).
  const session = await getPlatformSession()
  if (!session) redirect("/login")
  const staff = await getPlatformStaff(session)
  if (!staff) notFound()
  const resultat = await resultatDe(listPlatformOrgs(session.db, staff))
  return <EcranSupervision resultat={resultat} Lien={Link} ici={ICI} />
}
