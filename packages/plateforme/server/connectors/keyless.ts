// Les connecteurs sans clé (`auth: none`, l'open data ; `format-de-description.md` de la lib `connectors`) : ouverts
// par défaut comme tout connecteur déclaré, ils s'exécutent sans compte ni secret. `runCall` ne leur résout aucun compte,
// et le moteur les court sur un credential vide, qui ne lit ni n'écrit aucun jeton. Sans ce module, un connecteur
// d'open data demanderait un compte à créer, sans rien à y saisir.
import { declaredConnector } from "../catalog/connector-source"
import type { Identity } from "../identity"
import { PlatformError } from "../errors"
import type { AccountCredential } from "./auth"
import type { DescribedCall } from "./engine"

/** Vrai pour un connecteur déclaré dont l'accès est `auth: none` : il s'appelle sans compte. */
export function isKeylessConnector(connector: string): boolean {
  const declared = declaredConnector(connector)
  return declared !== null && declared.accesses.length > 0 && declared.accesses.every((access) => access.auth.kind === "none")
}

/** Sans clé, un connecteur s'appelle sans compte : il n'a pas d'autre accès qu'un compte retiendrait. `null` : aucun problème. */
export function keylessAccessesProblem(connector: string, kinds: readonly string[]): string | null {
  return kinds.length > 1 && kinds.includes("none") ? `${connector}: auth none is called without an account: it cannot be one of several accesses.` : null
}

/** Aucun jeton : un connecteur sans clé n'en échange ni n'en range jamais ; une écriture qui y arrive est un câblage fautif. */
const noTokens: AccountCredential["tokens"] = {
  read: async () => null,
  write: async () => {
    console.error("[platform] keyless connector: a token write reached a connector without authentication")
    throw new PlatformError("internal", "Internal error.")
  },
}

/**
 * L'appel d'un connecteur sans clé : un credential vide (ni champ, ni réglage, ni marque) et un identifiant d'appel propre
 * à l'organisation (`open:<org>`), qui ne nomme aucun compte : il sert au rythme des requêtes et aux logs.
 */
export function keylessCall(identity: Identity): Pick<DescribedCall, "credential" | "accountId"> {
  const credential: AccountCredential = { fields: {}, settings: {}, tokens: noTokens }
  return { credential, accountId: `open:${identity.org.id}` }
}
