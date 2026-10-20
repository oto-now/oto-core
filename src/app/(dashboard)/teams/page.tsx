import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { equipesListesSchema, equipesSearchSchema, type EquipesTab, type ReglagesDesListes } from "@otomata_tech/oto_platform/schemas"
import {
  invitationOptions,
  isOrgAdmin,
  isPlatformError,
  listInvitations,
  listMembers,
  listTeams,
  orgLimitsView,
  readOpenEntry,
  type Identity,
  type PlatformDb,
} from "@otomata_tech/oto_platform/server"
import { EcranEquipes, resultatDe, type EcranEquipesProps, type Moi } from "@otomata_tech/oto_platform/ui"
import { getPlatformIdentitySafely } from "@/lib/plateforme/session"

// « Équipes & accès » (E05-S03 ; titre d'E05-S11, AC-33) : membres et équipes (E05-S13, AC-5 : les règles
// d'accès se règlent dans « Partager » de chaque contenu, les accès plateforme depuis la console Oto). La page
// lit les services du paquet avec le jeton de la session ; l'écran envoie ses mutations à
// `/api/platform/*` et demande la relecture au fournisseur du layout. Depuis E05-S09 (partie d1), la
// recherche, le filtre et le tri des tableaux sont dans l'adresse (`q`, `filter`, `sort`, `order` ; noms anglais, E11-S07).
export const metadata: Metadata = {
  title: "Équipes & accès",
  robots: { index: false },
}

const ECHEC = { error: "Une erreur est survenue. Réessayez." } as const
/** Où s'ouvre une page de l'arbre (la route `/n/[...chemin]`) : une page qui bloque la suppression d'une équipe y mène. */
const PREFIXE_DES_PAGES = "/n/"

/** L'adresse d'un onglet ; un réglage à sa valeur par défaut n'y est pas écrit. */
function hrefDOnglet(onglet: EquipesTab, reglages: Partial<ReglagesDesListes> = {}): string {
  const recherche = new URLSearchParams({ tab: onglet })
  if (reglages.q) recherche.set("q", reglages.q)
  if (reglages.filter) recherche.set("filter", reglages.filter)
  if (reglages.sort) recherche.set("sort", reglages.sort)
  if (reglages.order === "desc") recherche.set("order", "desc")
  return `/teams?${recherche.toString()}`
}

/** Un simple membre n'invite pas (H72) : son refus devient « pas de formulaire », pas une erreur. */
function optionsOuRien(db: PlatformDb, identity: Identity) {
  return invitationOptions(db, identity).catch((erreur: unknown) => {
    if (isPlatformError(erreur) && erreur.code === "forbidden") return null
    throw erreur
  })
}

type Donnees = Omit<EcranEquipesProps, "onglet" | "reglages" | "Lien" | "hrefDOnglet" | "prefixeDesPages">

async function lire(db: PlatformDb, identity: Identity): Promise<Donnees> {
  // Administrateur comme pour les services : le rôle, ou l'équipe plateforme avec un accès en cours
  // (HN-E05S03-40, fiche D17).
  const moi: Moi = {
    userId: identity.user.id,
    estAdmin: isOrgAdmin(identity),
    equipesDirigees: identity.teams.filter((equipe) => equipe.role === "lead").map((equipe) => equipe.id),
  }
  const [membres, invitations, optionsDInvitation, equipes, limites, entreeSansInvitation] = await Promise.all([
    resultatDe(listMembers(db, identity)),
    resultatDe(listInvitations(db, identity, { state: "pending" })),
    resultatDe(optionsOuRien(db, identity)),
    resultatDe(listTeams(db, identity)),
    // Les capacités (E12-S02) : leur panne ne grise rien, le service refuse quand même.
    orgLimitsView(db, identity).catch(() => undefined),
    // L'entrée sans invitation, pour qui administre ; sa panne ne montre pas le réglage.
    moi.estAdmin ? readOpenEntry(db, identity).catch(() => undefined) : undefined,
  ])
  return { nomOrganisation: identity.org.name, moi, membres, invitations, optionsDInvitation, equipes, limites, entreeSansInvitation }
}

/** Une panne de la résolution de l'identité : l'écran le dit dans chaque onglet, sans rien proposer (AC2). */
const EN_PANNE: Donnees = {
  nomOrganisation: "l'organisation",
  moi: { userId: "", estAdmin: false, equipesDirigees: [] },
  membres: ECHEC,
  invitations: ECHEC,
  optionsDInvitation: ECHEC,
  equipes: ECHEC,
}

export default async function EquipesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  // La session et l'appartenance se revérifient ici, hors de tout `try` : le layout n'est pas une
  // frontière (`nextjs-patterns.md § Un layout n'est JAMAIS une frontière d'autorisation`).
  const identite = await getPlatformIdentitySafely("teams")
  if (identite?.error?.code === "unauthenticated") redirect("/login")
  if (identite?.error) redirect("/no-organization")

  const parametres = await searchParams
  const { tab: onglet } = equipesSearchSchema.parse(parametres)
  const reglages = equipesListesSchema.parse(parametres)
  const donnees = identite ? await lire(identite.data.session.db, identite.data.identity) : EN_PANNE
  return <EcranEquipes {...donnees} onglet={onglet} reglages={reglages} Lien={Link} hrefDOnglet={hrefDOnglet} prefixeDesPages={PREFIXE_DES_PAGES} />
}
