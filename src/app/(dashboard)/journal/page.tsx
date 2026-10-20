import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { journalFiltersSchema, usageQuerySchema, type JournalFilters, type UsagePeriod, type UsageQuery } from "@otomata_tech/oto_platform/schemas"
import { getConversation, isOrgAdmin, listConversations, listMembers, listTeams, usageSummary, type Identity, type PlatformDb } from "@otomata_tech/oto_platform/server"
import {
  EcranDActivite,
  resultatDe,
  type EcranDActiviteProps,
  type EcranDuJournalProps,
  type EcranUsageProps,
  type OngletDActivite,
  type ParametresDuJournal,
} from "@otomata_tech/oto_platform/ui"
import { getPlatformIdentitySafely } from "@/lib/plateforme/session"

// « Activité » (E05-S05 ; 1.4.13) : une page à deux onglets, dans l'adresse (`?tab=`). « Statistiques », pour qui administre
// l'organisation (`isOrgAdmin`, décidé ici avant tout appel ; `usageSummary` le redécide), ouvert par défaut pour lui ;
// « Journal », les conversations que la personne voit (H74, portée décidée par le service), filtrées par l'adresse, et le
// détail d'une conversation. La page ne lit que l'onglet ouvert, avec le jeton de la session ; l'écran n'écrit rien.
// `/admin/usage` mène ici.
export const metadata: Metadata = {
  title: "Activité",
  robots: { index: false },
}

const ECHEC = { error: "Une erreur est survenue. Réessayez." } as const
const ICI = "/journal"

/** L'adresse d'un onglet avec ces paramètres ; un paramètre absent n'y est pas écrit. */
function adresse(onglet: OngletDActivite, parametres: Record<string, string | undefined> = {}): string {
  const recherche = new URLSearchParams({ tab: onglet })
  for (const [cle, valeur] of Object.entries(parametres)) if (valeur) recherche.set(cle, valeur)
  return `${ICI}?${recherche}`
}

const hrefDuJournal = (parametres: ParametresDuJournal) => adresse("journal", parametres)
const hrefDOnglet = (onglet: OngletDActivite) => adresse(onglet)

/** La page d'un nœud (E05-S02) : la procédure servie d'une conversation y mène (AC3). */
const hrefDuNoeud = (chemin: string) => `/n/${chemin}`

/** La conversation dans l'onglet Journal (E05-S05). */
const hrefDeConversation = (code: string, periode: UsagePeriod) => adresse("journal", { conversation: code, period: String(periode) })

type DonneesDuJournal = Pick<EcranDuJournalProps, "resultat" | "conversation" | "equipes" | "personnes">

async function lireLeJournal(db: PlatformDb, identity: Identity, filtres: JournalFilters): Promise<DonneesDuJournal> {
  const liste = { periodDays: filtres.period, teamId: filtres.team, userId: filtres.person, errorsOnly: filtres.errors === "1", cursor: filtres.cursor }
  const [resultat, conversation, equipes, personnes] = await Promise.all([
    resultatDe(listConversations(db, identity, liste)),
    filtres.conversation ? resultatDe(getConversation(db, identity, filtres.conversation, { cursor: filtres.calls })) : undefined,
    resultatDe(listTeams(db, identity)),
    resultatDe(listMembers(db, identity)),
  ])
  return { resultat, conversation, equipes, personnes }
}

/** Une panne de la résolution de l'identité : chaque lecture se dit en échec, avec « Réessayer » (AC2). */
function journalEnPanne(filtres: JournalFilters): DonneesDuJournal {
  return { resultat: ECHEC, conversation: filtres.conversation ? ECHEC : undefined, equipes: ECHEC, personnes: ECHEC }
}

function lireLesStatistiques(db: PlatformDb, identity: Identity, query: UsageQuery): Promise<EcranUsageProps["resultat"]> {
  return resultatDe(Promise.all([usageSummary(db, identity, query), listTeams(db, identity)]).then(([usage, equipes]) => ({ usage, equipes: equipes.map(({ id, name }) => ({ id, name })) })))
}

/** L'onglet ouvert : celui de l'adresse, Statistiques réservé à qui administre ; par défaut, le premier qu'il voit. */
function ongletDe(demande: string | string[] | undefined, administre: boolean): OngletDActivite {
  if (demande === "journal") return "journal"
  if (demande === "statistics") return administre ? "statistics" : "journal"
  return administre ? "statistics" : "journal"
}

export default async function ActivitePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  // La session et l'appartenance se revérifient ici, hors de tout `try` : le layout n'est pas une
  // frontière (`nextjs-patterns.md § Un layout n'est JAMAIS une frontière d'autorisation`).
  const identite = await getPlatformIdentitySafely("journal")
  if (identite?.error?.code === "unauthenticated") redirect("/login")
  if (identite?.error) redirect("/no-organization")

  const parametres = await searchParams
  const administre = identite ? isOrgAdmin(identite.data.identity) : false
  const onglet = ongletDe(parametres.tab, administre)
  let props: EcranDActiviteProps
  // Aucune valeur de l'adresse ne va brute à un service : une valeur illisible retombe sur son défaut (AC4, N3).
  if (onglet === "statistics") {
    const filtres = usageQuerySchema.parse(parametres)
    const resultat = identite ? await lireLesStatistiques(identite.data.session.db, identite.data.identity, filtres) : ECHEC
    props = {
      onglet,
      hrefDOnglet,
      statistiques: {
        resultat,
        filtres,
        Lien: Link,
        hrefDuNoeud,
        hrefDeConversation,
        hrefDeFenetre: (periode) => adresse("statistics", { period: String(periode), team: filtres.team }),
        actionDuFiltre: ICI,
        parametresCaches: { tab: "statistics" },
      },
    }
  } else {
    const filtres = journalFiltersSchema.parse(parametres)
    const donnees = identite ? await lireLeJournal(identite.data.session.db, identite.data.identity, filtres) : journalEnPanne(filtres)
    props = { onglet, hrefDOnglet, statistiquesPermises: administre, journal: { ...donnees, filtres, Lien: Link, hrefDuJournal, hrefDuNoeud } }
  }
  return <EcranDActivite {...props} />
}
