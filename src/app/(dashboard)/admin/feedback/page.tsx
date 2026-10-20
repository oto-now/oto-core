import type { Metadata } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { feedbackListQuerySchema, type FeedbackListQuery, type UsagePeriod } from "@otomata_tech/oto_platform/schemas"
import { handlesFeedback, isOrgAdmin, listFeedback, type Identity, type PlatformDb } from "@otomata_tech/oto_platform/server"
import { EcranRetours, resultatDe, type EcranRetoursProps } from "@otomata_tech/oto_platform/ui"
import { getPlatformIdentitySafely } from "@/lib/plateforme/session"
import { ADRESSES } from "../adresses"

// « Retours des assistants » (E08-S09) : des frictions d'assistant, destinées à l'équipe plateforme. E05-S13 (AC-9,
// HN-E05S13-7) : réservé au membre de l'équipe plateforme qui administre l'organisation de l'adresse, et, quand elle a
// allumé « Retours visibles » (1.4.13), à ses administrateurs (`handlesFeedback`), décidé ici avant la liste ; à un
// administrateur d'une organisation qui ne les affiche pas, l'écran le dit et les affiche sur place ; à qui n'administre
// pas, `notFound()` ; le service le redécide. L'écran change l'état d'un retour par
// `PATCH /api/platform/feedback/<ticket>`, puis la page se relit.
export const metadata: Metadata = {
  title: "Retours des assistants",
  robots: { index: false },
}

const ECHEC = { error: "Une erreur est survenue. Réessayez." } as const

/** L'adresse des retours pour ces paramètres ; un paramètre absent n'y est pas écrit. */
function hrefDeFiltre(parametres: FeedbackListQuery): string {
  const recherche = new URLSearchParams({ state: parametres.state, period: String(parametres.period) })
  if (parametres.type) recherche.set("type", parametres.type)
  if (parametres.cursor) recherche.set("cursor", parametres.cursor)
  return `/admin/feedback?${recherche}`
}

/** La conversation du ticket dans l'écran Journal (E05-S05). */
const hrefDeConversation = (code: string, periode: UsagePeriod) => `/journal?conversation=${encodeURIComponent(code)}&period=${periode}`

function lire(db: PlatformDb, identity: Identity, filtres: FeedbackListQuery): Promise<EcranRetoursProps["resultat"]> {
  const state = filtres.state === "all" ? undefined : filtres.state
  return resultatDe(listFeedback(db, identity, { state, type: filtres.type, days: filtres.period, cursor: filtres.cursor }))
}

/** Les retours de qui les traite ; à un administrateur d'une organisation qui ne les affiche pas, leur absence dite. */
async function lireOuMasquer(db: PlatformDb, identity: Identity, filtres: FeedbackListQuery): Promise<EcranRetoursProps["resultat"]> {
  const traites = await resultatDe(handlesFeedback(db, identity))
  if (traites.error !== undefined) return traites
  return traites.data ? lire(db, identity, filtres) : { masques: true }
}

export default async function RetoursPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  // La session et l'appartenance se revérifient ici, hors de tout `try` : le layout n'est pas une
  // frontière (`nextjs-patterns.md § Un layout n'est JAMAIS une frontière d'autorisation`).
  const identite = await getPlatformIdentitySafely("admin/feedback")
  if (identite?.error?.code === "unauthenticated") redirect("/login")
  if (identite?.error) redirect("/no-organization")

  // Aucune valeur de l'adresse ne va brute à un service : une valeur inconnue retombe sur son défaut (AC9).
  const filtres = feedbackListQuerySchema.parse(await searchParams)
  if (identite && !isOrgAdmin(identite.data.identity)) notFound()
  const resultat: EcranRetoursProps["resultat"] = identite ? await lireOuMasquer(identite.data.session.db, identite.data.identity, filtres) : ECHEC
  return (
    <EcranRetours
      resultat={resultat}
      filtres={filtres}
      Lien={Link}
      hrefDeFiltre={hrefDeFiltre}
      hrefDeConversation={hrefDeConversation}
      // Les adresses du rail de qui traite les retours, que le layout lui donne aussi : le fil range Retours sous le suivi.
      fil={{ adresses: { ...ADRESSES, retours: "/admin/feedback" }, administre: identite !== null }}
    />
  )
}
