// Le branchement hébergé d'un compte à un connecteur à `accountIdentity` (`connecteurs-et-comptes.md` § Compte de
// l'hôte et compte rattaché) : `POST hosted-link` démarre le branchement de la personne connectée et rend l'adresse où
// envoyer le navigateur (le lien d'authentification hébergée du tiers, ou l'écran de retour quand un identifiant déjà
// à elle se relie sans lui) ; `GET hosted-link/callback?request=<demande>` est l'adresse de retour que le paquet donne
// au tiers : la route fait lier le compte puis renvoie à l'écran de départ, `?hosted=connected&account=<libellé>` ou
// `?hosted=failed&reason=<raison>` (la raison du refus, `details.refusal`, sinon son code). Adaptateur mince :
// `startHostedLink` et `linkHostedAccount` décident. Le retour, un `GET`, laisse sa ligne de journal comme une
// mutation (il crée ou relie un compte), sans arguments : l'indice du tiers n'y va pas.
import { linkHostedAccount, startHostedLink } from "../server/connectors/hosted-link"
import { returnAddress } from "../server/connectors/return-address"
import { isPlatformError } from "../server/errors"
import { clip, MAX_TARGET_CHARS } from "../server/journal"
import { returnOf } from "./connector-consent"
import type { ResourceRoutes } from "./handler"

export const hostedLinkRoutes: ResourceRoutes = {
  POST: {
    params: 0,
    target: ({ body }) => (typeof body === "object" && body !== null && "connector" in body && typeof body.connector === "string" ? clip(body.connector, MAX_TARGET_CHARS) : null),
    async handle({ db, identity, body, origin }) {
      const { url } = await startHostedLink(db, identity, body, { origin })
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
        const { account, returnTo } = await linkHostedAccount(db, identity, query)
        return { status: 302, data: null, redirect: returnAddress(origin, returnTo, { hosted: "connected", account: account.label }), journal: { target: account.label } }
      } catch (error) {
        if (!isPlatformError(error)) throw error
        const refusal = error.details?.refusal
        const reason = typeof refusal === "string" ? refusal : error.code
        return { status: 302, data: null, redirect: returnAddress(origin, returnOf(error), { hosted: "failed", reason }), journal: { error } }
      }
    },
  },
}
