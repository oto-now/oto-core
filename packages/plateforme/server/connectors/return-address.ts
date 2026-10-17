// L'écran de l'hôte où revenir après un parcours chez un tiers (consentement, branchement hébergé), à l'adresse de
// l'organisation, avec l'issue en query. Partagé par les deux parcours et leurs routes : sans ce module, chacun
// recomposerait l'adresse.

/** L'écran où revenir, à l'adresse de l'organisation, avec l'issue en query (une query déjà là est gardée). */
export function returnAddress(origin: string, returnTo: string, outcome: Record<string, string>): string {
  const url = new URL(returnTo, origin)
  for (const [name, value] of Object.entries(outcome)) url.searchParams.set(name, value)
  return url.toString()
}
