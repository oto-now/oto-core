// La page de connexion d'un connecteur (`/connect/<connecteur>?space=…`, `connexion-par-l-agent.md` § Page) : ce qu'elle
// montre à l'ouverture, décidé ici sous la session de la personne. Rien ne s'écrit ni ne part chez un tiers à
// l'ouverture (un GET, qu'un lien forgé ou une navigation d'un autre site peut déclencher) : un consentement ou un
// branchement se démarre par le bouton de la page, en `POST` de même origine sur la porte existante
// (`connector-consent`, `hosted-link`) ; une clé s'y saisit, l'espace posé ; un connecteur éteint demande à un
// administrateur de confirmer l'activation, ou nomme les administrateurs à qui transmettre l'adresse. L'espace de
// l'adresse est revérifié contre les droits de la personne (`planConnection`) : jamais cru. Sans ce module, l'adresse
// d'un refus ne mènerait à aucun geste.
import { connectionPageSchema, type ConnectionStepView } from "../../schemas/connectors"
import type { PlatformDb } from "../db"
import { invalidInput } from "../errors"
import type { Identity } from "../identity"
import { connectorAccountForms } from "./account-secret"
import { parseSpace, planConnection, spaceParam } from "./connect-link"
import { hostedLinkedElsewhere } from "./hosted-link"
import { creatableModes } from "./modes"

/**
 * L'étape de la page pour la personne connectée : `authorize` (le bouton qui démarre le consentement ou le branchement,
 * et les autres organisations où son compte hébergé est déjà relié), `key` (le formulaire du compte, l'espace posé),
 * `activate` (un administrateur confirme l'activation), `ask_admin` (l'adresse à transmettre, les administrateurs
 * nommés). Lecture seule. Refus : saisie invalide (`invalid_arguments`), connecteur inconnu ou natif, espace non permis
 * (`forbidden`, nommé), équipe inconnue (`not_found`).
 */
export async function connectionStep(db: PlatformDb, identity: Identity, input: unknown, options: { origin: string }): Promise<ConnectionStepView> {
  const parsed = connectionPageSchema.safeParse(input)
  if (!parsed.success) throw invalidInput(parsed.error)
  const { connector, access, space } = parsed.data
  const plan = await planConnection({ db, identity, origin: options.origin }, { connector, access, ...(space ? { space: parseSpace(space) } : {}) })
  const base = { connector: plan.connector, label: plan.label, space: spaceParam(plan.space) }
  if (!plan.byCaller) return { kind: "ask_admin", ...base, url: plan.url, administrators: plan.administrators }
  if (plan.gesture === "admin_activation") return { kind: "activate", ...base }
  const accessName = plan.access?.name ?? null
  if (plan.gesture === "oauth" || plan.gesture === "hosted_link") {
    const elsewhere = plan.gesture === "hosted_link" ? await hostedLinkedElsewhere(db, identity, plan.connector) : []
    return { kind: "authorize", gesture: plan.gesture, ...base, ...(accessName ? { access: accessName } : {}), ...(elsewhere.length > 0 ? { elsewhere } : {}) }
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
