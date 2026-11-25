// Le logo d'un outil sur l'écran Connecteurs : le favicon du domaine que sa déclaration nomme (`logoDomain`), lu par le
// serveur et servi depuis l'application (`GET connectors/<nom>/logo`). Le navigateur ne contacte ainsi aucun site tiers,
// et la politique de sécurité (CSP) de l'hôte n'a rien à autoriser. La lecture passe par `fetchSource`, comme le logo
// de l'image de partage : `https` et port 443, jamais une adresse privée, de bouclage ou de métadonnées, trois
// redirections au plus. Une image raster seulement : un SVG servi depuis l'origine de l'application pourrait porter un
// script. Sans ce module, la tuile n'a que l'initiale de l'outil.
import { declaredConnector } from "../catalog/connector-source"
import { fetchSource, type Resolve, type SourceGet } from "../uploads-fetch"

export type ConnectorLogo = { bytes: Uint8Array; type: string }

/** Le transport de `fetchSource`, remplacé par les tests. */
type LogoDeps = { resolve?: Resolve; get?: SourceGet; now?: () => number }

/** Les types d'image servis : raster seulement. */
const RASTER_TYPES: ReadonlySet<string> = new Set(["image/png", "image/x-icon", "image/vnd.microsoft.icon", "image/gif", "image/jpeg", "image/webp"])
export const LOGO_BYTES_MAX = 64 * 1024
const LOGO_TIMEOUT_MS = 3_000
/** Un logo trouvé se garde un jour, une absence une heure : un site qui ajoute son favicon le montre dans l'heure. */
const FOUND_MS = 24 * 60 * 60 * 1000
const MISSING_MS = 60 * 60 * 1000

// Une mémoire par processus, par domaine : la promesse y entre aussitôt, deux tuiles à la fois ne lisent qu'une fois.
const memory = new Map<string, { at: number; logo: Promise<ConnectorLogo | null> }>()

/** Le favicon d'un domaine (`https://<domaine>/favicon.ico`), ou `null` : absent, hors des types, trop lourd, trop lent. */
export async function faviconOf(domain: string, deps: LogoDeps = {}): Promise<ConnectorLogo | null> {
  const fetched = await fetchSource(`https://${domain}/favicon.ico`, { resolve: deps.resolve, get: deps.get, timeoutMs: LOGO_TIMEOUT_MS, maxBytes: LOGO_BYTES_MAX })
  if ("failure" in fetched || fetched.bytes.byteLength === 0) return null
  const type = (fetched.type ?? "").split(";")[0].trim().toLowerCase()
  return RASTER_TYPES.has(type) ? { bytes: fetched.bytes, type } : null
}

/** Le logo d'un connecteur déclaré, par le favicon de son domaine, gardé en mémoire ; `null` sans domaine ou sans favicon. */
export async function connectorLogo(connector: string, deps: LogoDeps = {}): Promise<ConnectorLogo | null> {
  const domain = declaredConnector(connector)?.definition.logoDomain
  if (!domain) return null
  const now = (deps.now ?? Date.now)()
  const kept = memory.get(domain)
  if (kept) {
    const logo = await kept.logo
    if (now - kept.at < (logo ? FOUND_MS : MISSING_MS)) return logo
  }
  const logo = faviconOf(domain, deps)
  memory.set(domain, { at: now, logo })
  return logo
}
