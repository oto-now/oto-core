// Ce que fait `connector.connect` (`catalog/connector-connect.ts`, `connexion-par-l-agent.md` § Fonction) : le plan de
// la connexion (`planConnection`), dit comme les refus (`actionSentence`), ou le compte qui marche déjà dans l'espace
// (`gesture: "none"`). À part du contrat de la fonction, que le registre lit au chargement : ce module lit les comptes
// et les déclarations, qui lisent le registre ; la fonction le charge à l'appel, sans cycle d'imports évalués.
import type { ConnectorConnectArgs } from "../../schemas/connectors"
import type { CallAccount, CallAccountOwner } from "../calls"
import { declaredConnector } from "../catalog/connector-source"
import type { FunctionContext, FunctionOutput } from "../catalog/define"
import { requestedAccess } from "./accesses"
import { connectorAccounts, type ConnectorAccount } from "./accounts"
import { actionSentence, parseSpace, planConnection, spaceParam, type ConnectionPlan } from "./connect-link"

/** Le compte est-il celui de l'espace du plan : le sien, celui de l'organisation, ou celui de l'équipe nommée. */
function inSpace(account: ConnectorAccount, plan: ConnectionPlan, userId: string): boolean {
  const { owner } = account
  if (plan.space.kind === "user") return owner.kind === "user" && owner.userId === userId
  if (plan.space.kind === "org") return owner.kind === "org"
  return owner.kind === "team" && owner.teamId === plan.team?.id
}

/**
 * Le compte rendu à l'assistant : celui des données d'un appel (`CallAccount`), sauf l'identifiant de sa personne, qu'un
 * client MCP ne reçoit jamais (`{kind: "user", name, yours}`, comme les noms des administrateurs d'un refus). Les données
 * d'un appel le gardent : le journal en lit qui a prêté le compte (`lender`).
 */
type ConnectedAccount = Omit<CallAccount, "owner"> & { owner: Exclude<CallAccountOwner, { kind: "user" }> | { kind: "user"; name: string; yours: boolean } }

/**
 * Le compte qui marche déjà dans l'espace du plan, pour l'accès du plan : actif, sans marque, dont la personne
 * n'est pas partie ; `null` quand le connecteur est éteint (le geste reste l'activation) ou qu'aucun ne marche.
 */
async function workingAccount(context: FunctionContext, plan: ConnectionPlan): Promise<ConnectedAccount | null> {
  if (plan.gesture === "admin_activation") return null
  const { identity } = context
  const wanted = plan.access?.name
  const found = (await connectorAccounts(context.db, identity, plan.connector)).find(
    (account) =>
      account.status === "active" && !account.mark && account.ownerLeft !== true && (!wanted || account.access === wanted) && inSpace(account, plan, identity.user.id),
  )
  if (!found) return null
  const { owner } = found
  return {
    id: found.id,
    label: found.label,
    mode: found.mode,
    owner: owner.kind === "user" ? { kind: "user", name: identity.user.name, yours: true } : { kind: owner.kind, description: owner.description },
  }
}

export async function runConnectorConnect(context: FunctionContext, args: ConnectorConnectArgs): Promise<FunctionOutput> {
  // Un connecteur à plusieurs accès se connecte par l'accès nommé, jamais par un accès choisi à la place de la personne.
  const declared = declaredConnector(args.connector)
  if (declared && !args.access) requestedAccess(declared, undefined)
  const plan = await planConnection(context, { connector: args.connector, access: args.access, ...(args.space ? { space: parseSpace(args.space) } : {}) })
  const space = spaceParam(plan.space)
  const account = await workingAccount(context, plan)
  if (account) {
    return {
      text: `${plan.label} is already connected (${space}): account « ${account.label} ». Call its functions; name the account if several serve.`,
      data: { gesture: "none", connector: plan.connector, ...(plan.access?.name ? { access: plan.access.name } : {}), space, account },
    }
  }
  return {
    text: `Connecting ${plan.label} (${space}). ${actionSentence(plan, context.identity.org.name)}`,
    data: {
      url: plan.url,
      gesture: plan.gesture,
      connector: plan.connector,
      ...(plan.access?.name ? { access: plan.access.name } : {}),
      space,
      by: plan.byCaller ? "user" : "administrator",
      ...(plan.administrators.length > 0 ? { administrators: plan.administrators } : {}),
    },
  }
}
