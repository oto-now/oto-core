// Le consentement d'une personne à un connecteur `oauth2_user` (`connecteurs-et-comptes.md` § Consentement d'une
// personne) : `POST connector-consent` démarre le consentement de la personne connectée et rend l'adresse
// d'autorisation du tiers (le bouton « Connecter mon compte » de l'écran Connecteurs, ou l'écran de l'hôte, y envoie
// le navigateur) ; `GET connector-consent/callback` est l'adresse de retour que l'hôte déclare chez le tiers : le
// navigateur y revient avec le code, la route le fait ranger puis renvoie à l'écran de départ, `?consent=connected`
// ou `?consent=failed&reason=<code>`. Adaptateur mince : `startConnectorConsent` et `completeConnectorConsent` décident.
// Le retour, un `GET`, laisse sa ligne de journal comme une mutation (il crée ou reconnecte un compte), sans arguments :
// ni code ni `state` n'y vont.
import { CONSENT_DEFAULT_RETURN, completeConnectorConsent, startConnectorConsent } from "../server/connectors/consent"
import { returnAddress } from "../server/connectors/return-address"
import { isPlatformError, PlatformError } from "../server/errors"
import { clip, MAX_TARGET_CHARS } from "../server/journal"
import type { ResourceRoutes } from "./handler"

/** L'écran de départ d'un refus, quand la demande l'a dit (`details.returnTo`) ; sinon l'écran Connecteurs. */
export function returnOf(error: PlatformError): string {
  const returnTo = error.details?.returnTo
  return typeof returnTo === "string" ? returnTo : CONSENT_DEFAULT_RETURN
}

export const connectorConsentRoutes: ResourceRoutes = {
  POST: {
    params: 0,
    target: ({ body }) => (typeof body === "object" && body !== null && "connector" in body && typeof body.connector === "string" ? clip(body.connector, MAX_TARGET_CHARS) : null),
    async handle({ db, identity, body, origin }) {
      const { url } = await startConnectorConsent(db, identity, body, { origin })
      const connector = (body as { connector: string }).connector
      return { status: 200, data: { url }, journal: { target: connector } }
    },
  },
  GET: {
    params: 1,
    fixed: { 0: "callback" },
    journaled: true,
    async handle({ db, identity, request, origin }) {
      const query = Object.fromEntries(new URL(request.url).searchParams)
      try {
        const { account, returnTo } = await completeConnectorConsent(db, identity, query, { origin })
        return { status: 302, data: null, redirect: returnAddress(origin, returnTo, { consent: "connected", account: account.label }), journal: { target: account.label } }
      } catch (error) {
        if (!isPlatformError(error)) throw error
        return { status: 302, data: null, redirect: returnAddress(origin, returnOf(error), { consent: "failed", reason: error.code }), journal: { error } }
      }
    },
  },
}
