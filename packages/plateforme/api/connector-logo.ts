// `GET connectors/<nom>/logo` : le logo d'un outil, servi depuis l'application (`server/connectors/logo.ts`), par une
// branche avant la table de dispatch, qui ne rend que du JSON : ici, l'image, ou un 404 sans corps que la tuile lit
// comme « pas de logo ». À session : un membre de l'organisation de l'adresse, jamais un relais ouvert vers les sites
// tiers. Une lecture : aucune ligne de journal. Sans elle, l'écran Connecteurs n'aurait que l'initiale de chaque outil.
import { connectorLogo } from "../server/connectors/logo"
import { asPlatformError, authenticationRequired, errorResponse, sessionIdentity, verifiedSession, type SessionOptions } from "./session"

/** Ce que la porte reçoit de l'hôte et passe à la route (`handlePlateforme`). */
type LogoRouteOptions = SessionOptions & { host: string | null }

/** Une absence se garde une heure au navigateur, comme au serveur. */
const MISSING_HEADERS = { "Cache-Control": "private, max-age=3600" }

/** `GET connectors/<nom>/logo` ; segments encore encodés. */
export function isConnectorLogoRoute(segments: readonly string[], method: string): boolean {
  return method.toUpperCase() === "GET" && segments.length === 3 && segments[0] === "connectors" && segments[2] === "logo"
}

/** Le nom encodé du connecteur ; un `%` mal formé ne désigne aucun connecteur. */
function connectorName(segment: string): string | null {
  try {
    return decodeURIComponent(segment)
  } catch {
    return null
  }
}

/**
 * Le logo du connecteur : la session vérifiée (sans elle, 401), l'organisation de l'adresse résolue pour l'appelant, puis
 * l'image, en `nosniff` et sous une CSP qui n'autorise rien, gardée un jour au navigateur ; 404 sans logo.
 */
export async function connectorLogoResponse(request: Request, options: LogoRouteOptions, segments: readonly string[]): Promise<Response> {
  try {
    const session = await verifiedSession(request, options)
    if (!session) return errorResponse(authenticationRequired(), 401)
    await sessionIdentity(session, options.host)
    const name = connectorName(segments[1])
    const logo = name ? await connectorLogo(name) : null
    if (!logo) return new Response(null, { status: 404, headers: MISSING_HEADERS })
    return new Response(new Blob([logo.bytes]), {
      status: 200,
      headers: {
        "Content-Type": logo.type,
        "Cache-Control": "private, max-age=86400",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'",
      },
    })
  } catch (error) {
    return errorResponse(asPlatformError(error))
  }
}
