// Ce qui arrête un connecteur déclaré, ouvert par défaut, avant qu'un compte ne s'y branche ou qu'une fonction ne
// l'appelle (`connecteurs-et-comptes.md` § Ouverts et adoptés) : un blocage posé par un administrateur (une ligne
// `inactive`, `closed`), ou, pour un connecteur payé par la clé de l'hôte, l'absence d'adoption (aucune ligne,
// `not_adopted`). Lu au départ et au retour d'une connexion, à l'écriture d'un compte, à la sonde et à l'appel ; sans ce
// module, chacun redirait la règle et son refus.
import { administrators } from "../access"
import { declaredConnector } from "../catalog/connector-source"
import type { PlatformDb } from "../db"
import { memberDirectory } from "../directory"
import { inTransaction, PlatformError } from "../errors"
import type { Identity } from "../identity"
import type { Tx } from "../sql"
import { hostFieldsOf } from "./host-fields"

/** Ce qui arrête un connecteur : bloqué par un administrateur, ou payé par l'hôte et pas encore adopté. */
export type ConnectorBarrier = "closed" | "not_adopted"

/**
 * Vrai pour un connecteur dont un accès en mode `platform` se sert d'une clé de l'hôte (un champ `holder: host`) :
 * chaque appel est payé par l'application, donc un administrateur l'adopte avant tout compte ou appel. Dérivé de la
 * déclaration (modes et champs de chaque accès), jamais d'une liste de noms.
 */
export function paidByHostKey(connector: string): boolean {
  const declared = declaredConnector(connector)
  return declared !== null && declared.accesses.some(({ definition }) => definition.modes.includes("platform") && hostFieldsOf(definition).length > 0)
}

/** La barrière d'un connecteur, lue dans la transaction de l'appelant : `null` quand rien ne l'arrête. */
export async function barrierIn(sql: Tx, orgId: string, connector: string): Promise<ConnectorBarrier | null> {
  const [row] = await sql<{ state: string }[]>`
    select state from platform.connector_activations where org_id = ${orgId} and connector = ${connector}`
  if (row) return row.state === "active" ? null : "closed"
  return paidByHostKey(connector) ? "not_adopted" : null
}

/** La barrière d'un connecteur, lue sous l'appelant. */
export async function connectorBarrier(db: PlatformDb, identity: Identity, connector: string): Promise<ConnectorBarrier | null> {
  return inTransaction(db, "connectorBarrier: connector_activations", (sql) => barrierIn(sql, identity.org.id, connector))
}

/**
 * Le refus d'un connecteur arrêté (`not_enabled`, `reason` : `closed` ou `not_adopted`), qui nomme les administrateurs à
 * qui demander, par leur nom seulement. Sans barrière donnée, elle est relue (`closed` si rien ne l'arrête plus).
 */
export async function closedConnector(db: PlatformDb, identity: Identity, connector: string, barrier?: ConnectorBarrier): Promise<PlatformError> {
  const reason = barrier ?? (await connectorBarrier(db, identity, connector)) ?? "closed"
  const directory = await memberDirectory(db, identity.org.id)
  const admins = directory
    .filter((person) => person.role === "admin")
    // Leurs noms seuls, comme `connectRefusal` : un refus n'expose jamais l'identifiant d'une personne.
    .map((person) => ({ name: person.name }))
    .sort((a, b) => a.name.localeCompare(b.name, "fr"))
  const who = administrators(identity, directory)
  const message =
    reason === "closed"
      ? `${connector} is deactivated at ${identity.org.name}: no account can be added or enabled. Ask ${who} to activate it.`
      : `${connector} runs on this application's key: an administrator of ${identity.org.name} adopts it before anyone connects an account or calls it. Ask ${who} to adopt it.`
  return new PlatformError("not_enabled", message, { reason, administrators: admins })
}

/** Refuse un connecteur arrêté, lu sous l'appelant ; rien quand rien ne l'arrête. */
export async function requireUsableConnector(db: PlatformDb, identity: Identity, connector: string): Promise<void> {
  const barrier = await connectorBarrier(db, identity, connector)
  if (barrier) throw await closedConnector(db, identity, connector, barrier)
}
