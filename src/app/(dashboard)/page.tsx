import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { Suspense, use } from "react"
import { journalFiltersSchema, LAUNCH_PROCEDURES_SHOWN } from "@otomata_tech/oto_platform/schemas"
import { connectAddress, homeContents, lastConnections, listActivities, usefulProcedures, type Identity, type LastConnection } from "@otomata_tech/oto_platform/server"
import {
  EcranDAccueil,
  EcranDAccueilChargement,
  resultatDe,
  type DerniereConnexion,
  type DonneesDeLAccueil,
  type EcranDAccueilProps,
} from "@otomata_tech/oto_platform/ui"
import { adresseDe } from "@/lib/plateforme/connexion"
import { getPlatformIdentitySafely, getRequestOrigin, type PlatformSession } from "@/lib/plateforme/session"

// L'accueil (E05-S09, partie b ; E05-S12, lot B) : le salut, les activités de la semaine
// (le journal par gestes), « Brancher un assistant » et les procédures utiles à droite. La page revérifie la session, hors de tout `try` (le layout
// n'est pas une frontière, `nextjs-patterns.md § Layouts`), puis lit les services du paquet avec le jeton
// de la session, en parallèle, chacun par `resultatDe` : une lecture en échec se dit dans son îlot, et
// l'écran reste ouvert. La session est celle de l'hôte, Supabase ou OIDC (E01-S11 b, AC-b6).
//
// E11-S10 (lot e, AC-e3) : l'accueil n'a plus d'onglets ; la vue « Contexte » est à `/context`, et le
// paramètre d'onglet n'est plus lu.
//
// E05-S12 (lot B) : les activités de la semaine (`listActivities`, le journal par gestes) au lieu des
// conversations, qui restent à `/journal`, et les procédures utiles de l'îlot de droite (`usefulProcedures`).
//
// 1.4.13 : la première page de « Reprendre » (contenus récents de ses équipes, `homeContents`) et les dix procédures de
// « Lancer avec Claude » ; les autres pages de « Reprendre » passent par l'API.
export const metadata: Metadata = {
  title: "Accueil",
  robots: { index: false },
}

const ECHEC = { error: "Une erreur est survenue. Réessayez." } as const

/** La semaine du journal : la période par défaut de `/journal`, celle que « Tout le journal » ouvre. */
const PERIODE = journalFiltersSchema.parse({}).period

/** Les adresses de l'hôte que l'écran ouvre, et son lien. */
const NAVIGATION: Omit<EcranDAccueilProps, "donnees"> = {
  Lien: Link,
  hrefDuJournal: "/journal",
  hrefDeConversation: (code) => `/journal?${new URLSearchParams({ conversation: code })}`,
  prefixeDesPages: "/n/",
}

/** Les noms des services adaptés à l'écran, comme sur `/connect`. */
function connexionsDe(connexions: LastConnection[]): DerniereConnexion[] {
  return connexions.map(({ family, signature, at }) => ({ famille: family, signature, date: at }))
}

async function lire({ identity, session }: { identity: Identity; session: PlatformSession }, origine: string): Promise<DonneesDeLAccueil> {
  const [activites, reprendre, connexions, procedures] = await Promise.all([
    // Le fil s'ouvre sur « Mes équipes », le filtre par défaut de la carte ; ses autres filtres passent par l'API.
    resultatDe(listActivities(session.db, identity, { periodDays: PERIODE, scope: "teams" })),
    resultatDe(homeContents(session.db, identity, { tab: "recent", scope: "teams" })),
    resultatDe(lastConnections(session.db, identity).then(connexionsDe)),
    resultatDe(usefulProcedures(session.db, identity, LAUNCH_PROCEDURES_SHOWN)),
  ])
  return {
    nom: identity.member.profile.name || identity.user.name || null,
    moi: identity.user.id,
    activites,
    reprendre,
    adresse: adresseDe(connectAddress(identity, origine)),
    connexions,
    procedures,
  }
}

/** L'accueil lu, sous son `<Suspense>` : le chargement paraît pendant les lectures. */
function AccueilLu({ lecture }: { lecture: Promise<DonneesDeLAccueil> }) {
  return <EcranDAccueil donnees={{ data: use(lecture) }} {...NAVIGATION} />
}

export default async function AccueilPage() {
  const identite = await getPlatformIdentitySafely("accueil")
  if (identite?.error?.code === "unauthenticated") redirect("/login")
  if (identite?.error) redirect("/no-organization")
  // Une panne de la résolution de l'identité : l'écran la dit une fois, avec « Réessayer ».
  if (!identite) return <EcranDAccueil donnees={ECHEC} {...NAVIGATION} />
  // L'identité vient de l'hôte de la requête : sans hôte, elle n'aurait pas été résolue (comme `/connect`).
  const origine = await getRequestOrigin()
  if (!origine) redirect("/no-organization")
  return (
    <Suspense fallback={<EcranDAccueilChargement />}>
      <AccueilLu lecture={lire(identite.data, origine)} />
    </Suspense>
  )
}
