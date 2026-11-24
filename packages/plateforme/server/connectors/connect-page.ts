// La page de connexion d'un connecteur (`/connect/<connecteur>?space=…`, `connexion-par-l-agent.md` § Page) : ce qu'elle
// fait à l'ouverture, décidé ici sous la session de la personne. Un consentement ou un branchement sur un espace permis
// part aussitôt chez le tiers (la demande posée par le parcours existant, `startConnectorConsent` ou `startHostedLink`,
// avec cette page pour retour) ; une clé s'y saisit, l'espace posé ; un connecteur éteint demande à un administrateur
// de confirmer l'activation (jamais à l'ouverture), ou nomme les administrateurs à qui transmettre l'adresse. L'espace
// de l'adresse est revérifié contre les droits de la personne (`planConnection`) : jamais cru. Sans ce module, l'adresse
// d'un refus ne mènerait à aucun geste.
import { connectionPageSchema, type ConnectionStepView } from "../../schemas/connectors"
import type { PlatformDb } from "../db"
import { invalidInput } from "../errors"
import type { Identity } from "../identity"
import { connectorAccountForms } from "./account-secret"
import { parseSpace, planConnection, spaceParam } from "./connect-link"
import { startConnectorConsent } from "./consent"
import { startHostedLink } from "./hosted-link"
import { creatableModes } from "./modes"

/**
 * L'étape de la page pour la personne connectée : `redirect` (l'adresse du tiers, la demande posée), `key` (le
 * formulaire du compte, l'espace posé), `activate` (un administrateur confirme l'activation), `ask_admin` (l'adresse à
 * transmettre, les administrateurs nommés). Refus : saisie invalide (`invalid_arguments`), connecteur inconnu ou natif,
 * espace non permis (`forbidden`, nommé), équipe inconnue (`not_found`), et ceux du départ d'un consentement ou d'un
 * branchement (application OAuth absente : `not_enabled`).
 */
export async function connectionStep(db: PlatformDb, identity: Identity, input: unknown, options: { origin: string }): Promise<ConnectionStepView> {
  const parsed = connectionPageSchema.safeParse(input)
  if (!parsed.success) throw invalidInput(parsed.error)
  const { connector, access, space } = parsed.data
  const plan = await planConnection({ db, identity, origin: options.origin }, { connector, access, ...(space ? { space: parseSpace(space) } : {}) })
  const base = { connector: plan.connector, label: plan.label, space: spaceParam(plan.space) }
  if (!plan.byCaller) return { kind: "ask_admin", ...base, url: plan.url, administrators: plan.administrators }
  if (plan.gesture === "admin_activation") return { kind: "activate", ...base }
  // Le retour du tiers ramène sur cette page, sans `activate` : l'adresse d'un connecteur ouvert n'en porte pas.
  const back = new URL(plan.url)
  const returnTo = `${back.pathname}${back.search}`
  const accessName = plan.access?.name ?? null
  if (plan.gesture === "oauth") {
    const { url } = await startConnectorConsent(db, identity, { connector: plan.connector, ...(accessName ? { access: accessName } : {}), return_to: returnTo }, options)
    return { kind: "redirect", url }
  }
  if (plan.gesture === "hosted_link") {
    const { url } = await startHostedLink(db, identity, { connector: plan.connector, return_to: returnTo }, options)
    return { kind: "redirect", url }
  }
  const form = connectorAccountForms().find((candidate) => candidate.connector === plan.connector && (candidate.access?.name ?? null) === accessName) ?? null
  return {
    kind: "key",
    ...base,
    ...(form?.access ? { access: form.access } : {}),
    owner: plan.space.kind,
    ...(plan.team ? { team: plan.team } : {}),
    mode: creatableModes(plan.connector)[0] ?? "reel",
    form,
  }
}
