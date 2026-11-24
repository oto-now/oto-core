// La page de connexion d'un connecteur (`/connect/<connecteur>?space=…`, `connexion-par-l-agent.md` § Page) : ce qu'elle
// montre à l'ouverture, décidé ici sous la session de la personne. Rien ne s'écrit ni ne part chez un tiers à
// l'ouverture (un GET, qu'un lien forgé ou une navigation d'un autre site peut déclencher) : un consentement ou un
// branchement se démarre par le bouton de la page, en `POST` de même origine sur la porte existante
// (`connector-consent`, `hosted-link`) ; une clé s'y saisit, l'espace posé ; un connecteur éteint demande à un
// administrateur de confirmer l'activation, ou nomme les administrateurs à qui transmettre l'adresse. L'espace de
// l'adresse est revérifié contre les droits de la personne (`planConnection`) : jamais cru. Sans ce module, l'adresse
// d'un refus ne mènerait à aucun geste. L'adresse d'un compte existant (`account_id=<id>`, clé refusée par le tiers ou
// jamais posée) montre la saisie de sa clé, à qui le gère seul.
import { connectionPageSchema, type ConnectionPageInput, type ConnectionStepView } from "../../schemas/connectors"
import { ACCOUNT_LEVELS } from "../access"
import { declaredConnector } from "../catalog/connector-source"
import type { PlatformDb } from "../db"
import { ownerNames } from "../directory"
import { invalidInput, PlatformError } from "../errors"
import type { Identity } from "../identity"
import { accountAccess } from "./accesses"
import { connectorAccountForms } from "./account-secret"
import { accountOwner, accountView, managedAccount } from "./accounts"
import { accountSpace, connectorLabel, parseSpace, planConnection, spaceParam } from "./connect-link"
import { accountFieldNames } from "./host-fields"
import { hostedLinkedElsewhere } from "./hosted-link"
import { creatableModes } from "./modes"

/**
 * L'étape de la page pour la personne connectée : `authorize` (le bouton qui démarre le consentement ou le branchement,
 * et les autres organisations où son compte hébergé est déjà relié), `key` (le formulaire du compte, l'espace posé),
 * `activate` (un administrateur confirme l'activation), `ask_admin` (l'adresse à transmettre, les administrateurs
 * nommés). Lecture seule. Refus : saisie invalide (`invalid_arguments`), connecteur inconnu ou natif, espace non permis
 * (`forbidden`, nommé), équipe inconnue (`not_found`). Avec `account_id` : l'étape `account_key` (`accountKeyStep`).
 */
export async function connectionStep(db: PlatformDb, identity: Identity, input: unknown, options: { origin: string }): Promise<ConnectionStepView> {
  const parsed = connectionPageSchema.safeParse(input)
  if (!parsed.success) throw invalidInput(parsed.error)
  if (parsed.data.account_id) return accountKeyStep(db, identity, { ...parsed.data, account_id: parsed.data.account_id })
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

/**
 * La saisie de la clé d'un compte existant (`account_key`) : réservée à qui le gère (`managedAccount` : inconnu ou
 * invisible, `not_found` ; non géré, `forbidden`, qui dit qui le gère). L'adresse est revérifiée contre le compte : son
 * connecteur, son accès et son espace, refusés nommément s'ils ne sont pas les siens (`invalid_arguments`) ; un compte
 * qui ne prend pas de clé (consentement, clé de l'hôte seule) aussi. L'envoi passe par `setAccountSecret`, qui revérifie.
 */
async function accountKeyStep(db: PlatformDb, identity: Identity, input: ConnectionPageInput & { account_id: string }): Promise<ConnectionStepView> {
  const row = await managedAccount(db, identity, input.account_id, { service: "connectionStep", gesture: "Setting the key of" })
  const label = connectorLabel(input.connector)
  if (row.connector !== input.connector) throw new PlatformError("invalid_arguments", `Account « ${row.label} » is not a ${label} account.`)
  if ((input.access ?? null) !== row.access) throw new PlatformError("invalid_arguments", `Account « ${row.label} » does not open by access ${input.access ?? "none"}.`)
  const declared = declaredConnector(row.connector)
  if (!declared) throw new PlatformError("invalid_arguments", `Connector ${row.connector} is not declared by this application: its accounts have no key to set.`)
  const access = accountAccess(declared, { label: row.label, access: row.access })
  if (access.auth.kind === "user_consent" || accountFieldNames(access.definition).length === 0) {
    throw new PlatformError("invalid_arguments", `Account « ${row.label} » takes no key: open the link without an account.`)
  }
  const owner = accountOwner(row)
  const { space } = await accountSpace({ db, identity }, owner)
  if (input.space !== undefined && input.space !== spaceParam(space)) {
    throw new PlatformError("invalid_arguments", `Account « ${row.label} » is in ${spaceParam(space)}, not in ${input.space}.`)
  }
  const form = connectorAccountForms().find((candidate) => candidate.connector === row.connector && (candidate.access?.name ?? null) === row.access)
  if (!form) {
    console.error(`[platform] connectionStep: no account form for ${row.connector} (access ${row.access ?? "none"})`)
    throw new PlatformError("internal", "Internal error.")
  }
  const names = await ownerNames(db, identity.org.id, [row])
  return { kind: "account_key", connector: row.connector, label, space: spaceParam(space), account: accountView(row, ACCOUNT_LEVELS.manage, names), form }
}
