// La surface que l'hôte déclare servir à un assistant (`registerHostSurface`, `surface.ts`), lue à chaque appel par le
// registre (`assistantFunctions`), la porte MCP (capacités) et le téléchargement d'une adresse fournie (`fetchSource`).
// Module à part, sans import à l'exécution, comme `erp-source.ts` : le registre le lit, et `surface.ts` lit le registre
// pour valider.

/** Les capacités MCP que la porte sert en plus des outils : chacune se ferme. */
export const OPTIONAL_CAPABILITIES = ["prompts", "resources"] as const

export type OptionalCapability = (typeof OPTIONAL_CAPABILITIES)[number]

/**
 * Ce qu'un hôte sert à un assistant, en liste fermée : ce qu'une mise à jour du paquet ajoute n'est servi qu'une fois
 * nommé ici. `functions` : les fonctions du paquet, par nom (celles que l'hôte inscrit lui-même, ERP et connecteurs
 * décrits, ne sont pas concernées). `capabilities` : les capacités MCP facultatives. `fetchCallerUrls` : le serveur
 * télécharge-t-il une adresse fournie par un appelant (`source_url`, fichiers d'un arbre importé, logo).
 */
export type HostSurface = {
  functions: readonly string[]
  capabilities: readonly OptionalCapability[]
  fetchCallerUrls: boolean
}

let surface: HostSurface | null = null

/** La surface déclarée ; `null` : aucune déclaration, tout est servi. */
export function hostSurface(): HostSurface | null {
  return surface
}

/** Remplace la déclaration ; seul appelant : `registerHostSurface`, la déclaration validée. */
export function replaceHostSurface(next: HostSurface | null): void {
  surface = next ? { functions: [...next.functions], capabilities: [...next.capabilities], fetchCallerUrls: next.fetchCallerUrls } : null
}

export function servesCapability(capability: OptionalCapability): boolean {
  return surface === null || surface.capabilities.includes(capability)
}

export function fetchesCallerUrls(): boolean {
  return surface === null || surface.fetchCallerUrls
}
