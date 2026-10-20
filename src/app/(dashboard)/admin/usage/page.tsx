import { redirect } from "next/navigation"
import { usageQuerySchema } from "@otomata_tech/oto_platform/schemas"

// L'ancienne adresse des statistiques (E08-S09) : depuis la 1.4.13, elles sont l'onglet Statistiques d'« Activité »
// (`/journal?tab=statistics`), qui décide le droit ; la fenêtre et l'équipe suivent, lues par `usageQuerySchema`.
export default async function UsagePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }): Promise<never> {
  const { period, team } = usageQuerySchema.parse(await searchParams)
  const recherche = new URLSearchParams({ tab: "statistics", period: String(period) })
  if (team) recherche.set("team", team)
  redirect(`/journal?${recherche}`)
}
