import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { Suspense, use } from "react"
import { contextRequestQuerySchema } from "@otomata_tech/oto_platform/schemas"
import { isPlatformError, loadNode, previewContext, type Identity, type PlatformDb } from "@otomata_tech/oto_platform/server"
import { cheminDuContexte, EcranDuContexte, EcranDuContexteChargement, resultatDe, type DonneesDuContexteServi } from "@otomata_tech/oto_platform/ui"
import { getPlatformIdentitySafely } from "@/lib/plateforme/session"

// La vue « Contexte » (E11-S10, lot e, AC-e2) : ce que `context` servirait à la personne, ouverte par le menu du
// compte ; ex-onglet de l'accueil (E05-S11, AC-13, AC-14). La page revérifie la session, hors de tout `try` (le
// layout n'est pas une frontière, `nextjs-patterns.md § Un layout n'est JAMAIS une frontière d'autorisation`), puis
// lit l'aperçu (`previewContext` sans phrase) et chaque Contexte qu'il sert par son chemin (`loadNode`), dont le
// niveau de la personne, décidé par le service, choisit l'éditeur ou la lecture. Le paramètre `q` de l'adresse porte une
// demande à tester : validé par son schéma, il part à `previewContext` et à l'écran ; illisible, rien n'est testé.
export const metadata: Metadata = {
  title: "Contexte",
  robots: { index: false },
}

const ECHEC = { error: "Une erreur est survenue. Réessayez." } as const

/** L'adresse de la vue : « Réessayer » y revient. */
const ICI = "/context"

/**
 * Ce que lit la vue (AC-13, AC-14) : l'aperçu, puis, en parallèle, chaque Contexte qu'il sert, par son chemin ; le
 * service décide du niveau (H123), la page ne décide rien. L'aperçu ne sert que des Contextes que la personne lit :
 * une lecture refusée depuis est une lecture en échec, dite dans sa partie.
 */
async function lireLeContexte(db: PlatformDb, identity: Identity, demande: string | undefined): Promise<DonneesDuContexteServi> {
  const apercu = await resultatDe(previewContext(db, identity, demande === undefined ? {} : { phrase: demande }))
  // Le Contexte de chaque partie, servi ou non : un Contexte écrivable montre son éditeur même en brouillon
  // (E05-S12, AC-7, HN-E05S12-C2).
  const chemins = apercu.data ? [...new Set(apercu.data.blocks.flatMap((bloc) => cheminDuContexte(bloc) ?? []))] : []
  // Un Contexte absent ou hors de portée (`not_found`) n'est pas une panne : omis, sa partie garde son texte servi, sans
  // alerte ; tout autre échec se dit (HN-E05S12-C10).
  const lus = await Promise.all(
    chemins.map((path) =>
      resultatDe(loadNode(db, identity, { path }).catch((erreur: unknown) => (isPlatformError(erreur) && erreur.code === "not_found" ? null : Promise.reject(erreur)))),
    ),
  )
  return {
    apercu,
    contextes: Object.fromEntries(
      chemins.flatMap((chemin, rang): [string, DonneesDuContexteServi["contextes"][string]][] => {
        const lu = lus[rang]
        if (lu.error !== undefined) return [[chemin, lu]]
        return lu.data === null ? [] : [[chemin, { data: lu.data }]]
      }),
    ),
    // Les Contextes d'équipe servis sont ceux des équipes de la personne (E03-S08, AC-f7) : l'identité les nomme.
    equipes: identity.teams,
  }
}

/** La vue lue, sous son `<Suspense>` : le chargement paraît pendant les lectures. */
function ContexteLu({ lecture, demande }: { lecture: Promise<DonneesDuContexteServi>; demande: string | undefined }) {
  return <EcranDuContexte resultat={{ data: use(lecture) }} Lien={Link} prefixeDesPages="/n/" ici={ICI} test={{ demande }} />
}

type ContextePageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> }

export default async function ContextePage({ searchParams }: ContextePageProps) {
  const identite = await getPlatformIdentitySafely("context")
  if (identite?.error?.code === "unauthenticated") redirect("/login")
  if (identite?.error) redirect("/no-organization")
  // Une panne de la résolution de l'identité : l'écran la dit une fois, avec « Réessayer ».
  if (!identite) return <EcranDuContexte resultat={ECHEC} Lien={Link} prefixeDesPages="/n/" ici={ICI} />
  const { session, identity } = identite.data
  const lu = contextRequestQuerySchema.safeParse(await searchParams)
  const demande = lu.success ? lu.data.q : undefined
  return (
    // `key` : une autre demande relit sous le chargement, au lieu de garder l'écran d'avant.
    <Suspense key={demande ?? ""} fallback={<EcranDuContexteChargement />}>
      <ContexteLu lecture={lireLeContexte(session.db, identity, demande)} demande={demande} />
    </Suspense>
  )
}
