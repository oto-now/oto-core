// `POST` et `DELETE admin/connectors/<nom>/activation` du tableau de bord (E08-S03, AC5, AC10) :
// activer, désactiver un connecteur. Adaptateur mince : la validation du nom, le droit (`isOrgAdmin`)
// et l'écriture sont dans `activateConnector` et `deactivateConnector` d'E04-S01 ; la réponse est la
// ligne du connecteur telle que la rend `listConnectorsForOrg`. `POST admin/connectors/<nom>/probe` (écran
// Connecteurs, lot 1) : essayer une clé avant d'ajouter un compte, par `probeConnector`, ouvert à tout membre.
import { connectorRefSchema } from "../../schemas"
import { activateConnector, deactivateConnector } from "../../server/connectors/activations"
import { probeConnector } from "../../server/connectors/probe"
import type { Route } from "../handler"

const ACTIVATION = { 0: "connectors", 2: "activation" } as const

/** La cible du journal : le connecteur nommé par l'adresse, s'il en a la forme. */
function connectorOrNull({ params }: { params: string[] }): string | null {
  const parsed = connectorRefSchema.safeParse({ connector: params[1] })
  return parsed.success ? parsed.data.connector : null
}

export const activationRoute: Route = {
  params: 3,
  fixed: ACTIVATION,
  target: connectorOrNull,
  async handle({ db, identity, params }) {
    const connector = await activateConnector(db, identity, { connector: params[1] })
    return { status: 200, data: { connector }, journal: { target: connector.connector } }
  },
}

export const deactivationRoute: Route = {
  params: 3,
  fixed: ACTIVATION,
  target: connectorOrNull,
  async handle({ db, identity, params }) {
    const connector = await deactivateConnector(db, identity, { connector: params[1] })
    return { status: 200, data: { connector }, journal: { target: connector.connector } }
  },
}

/**
 * Essaie une clé avant l'ajout d'un compte : `{ fields, settings? }`, les champs du formulaire. N'écrit rien, hors de
 * la ligne du journal de la route, qui ne garde que le connecteur (`journalArgs`) : ni champ ni réglage, jamais la clé.
 */
export const connectorProbeRoute: Route = {
  params: 3,
  fixed: { 0: "connectors", 2: "probe" },
  target: connectorOrNull,
  journalArgs: ({ params }) => ({ connector: params[1] }),
  async handle({ db, identity, params, body }) {
    const probe = await probeConnector(db, identity, { connector: params[1], input: body })
    return { status: 200, data: { probe }, journal: { target: params[1] } }
  },
}
