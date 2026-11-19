// Qui peut posséder un compte d'un connecteur déclaré (`connecteurs-et-comptes.md` § Propriétaires d'un compte) : les
// `modes` de la déclaration, contrôlés à `registerConnectors` (une valeur inconnue ou absente refuse la déclaration,
// jamais un défaut), lus par le formulaire de l'écran (`connectorAccountForms`) et par la création d'un compte
// (`createAccount`). Sans ce module, un compte personnel se créerait sur un connecteur que l'éditeur ne vend qu'aux
// organisations, et l'écran proposerait un ajout que le service refuse.
import { PlatformError } from "../errors"
import type { ConnectorView, ConnectorMode } from "./definition"
import { accountFieldNames } from "./host-fields"

/** Un propriétaire de compte (`accounts.owner_kind`). */
export type OwnerKind = "org" | "team" | "user"

const MODES: readonly ConnectorMode[] = ["platform", "byo_user", "byo_org"]

/** L'ordre dans lequel les propriétaires se disent, celui d'`ACCOUNT_OWNER_KINDS`. */
const OWNER_ORDER: readonly OwnerKind[] = ["org", "team", "user"]

/** Le problème des `modes` d'une définition : une liste non vide de valeurs connues, chacune une fois ; `null` : aucun. */
export function modesProblem(definition: ConnectorView): string | null {
  const modes: unknown = definition.modes
  if (!Array.isArray(modes) || modes.length === 0) return `${definition.name}: modes must list who serves an account (${MODES.join(", ")}).`
  const unknown = modes.find((mode) => !MODES.includes(mode))
  if (unknown !== undefined) return `${definition.name}: mode ${JSON.stringify(unknown)} is unknown: ${MODES.join(", ")}.`
  if (new Set(modes).size !== modes.length) return `${definition.name}: modes lists a mode twice.`
  return null
}

const ordered = (kinds: ReadonlySet<OwnerKind>): OwnerKind[] => OWNER_ORDER.filter((kind) => kinds.has(kind))

/** Les propriétaires des modes où le compte apporte sa clé : `byo_user` → `user`, `byo_org` → `org` et `team`. */
function ownKeyOwnerKinds(definition: ConnectorView): Set<OwnerKind> {
  const kinds = new Set<OwnerKind>()
  if (definition.modes.includes("byo_user")) kinds.add("user")
  if (definition.modes.includes("byo_org")) ["org", "team"].forEach((kind) => kinds.add(kind as OwnerKind))
  return kinds
}

/**
 * Les propriétaires qu'un compte ouvert depuis l'écran admet : ceux des modes où le compte apporte sa clé, plus, pour
 * `platform` sur un connecteur dont chaque personne connecte le sien (consentement `oauth2_user`, compte rattaché
 * `accountIdentity`), la personne : elle y connecte son compte (« Connecter mon compte ») avec l'application ou le port
 * de l'hôte. Vide : le connecteur n'a pas de formulaire (`platform` seul, servi par la clé de l'hôte).
 */
export function formOwnerKinds(definition: ConnectorView): OwnerKind[] {
  const kinds = ownKeyOwnerKinds(definition)
  const personal = definition.auth.kind === "oauth2_user" || definition.accountIdentity !== undefined
  if (definition.modes.includes("platform") && personal) kinds.add("user")
  return ordered(kinds)
}

/**
 * Les propriétaires qu'un compte admet à sa création (`createAccount`) : ceux des modes où le compte apporte sa clé,
 * plus, pour `platform` sur un connecteur dont l'hôte fournit tous les champs (aucun à saisir, aucun consentement), un
 * compte d'organisation ou d'équipe, qui ouvre la clé de l'hôte sans rien saisir. Le compte d'une personne sur un
 * connecteur `platform` où chacun connecte le sien ne naît que de son consentement ou de son branchement, jamais ici.
 */
export function admittedOwnerKinds(definition: ConnectorView): OwnerKind[] {
  const kinds = ownKeyOwnerKinds(definition)
  const hostKeyOnly = definition.auth.kind !== "oauth2_user" && accountFieldNames(definition).length === 0
  if (definition.modes.includes("platform") && hostKeyOnly) ["org", "team"].forEach((kind) => kinds.add(kind as OwnerKind))
  return ordered(kinds)
}

/** Refuse un propriétaire que les `modes` du connecteur n'admettent pas (`invalid_arguments`, `owner_kind`). */
export function requireAdmittedOwner(definition: ConnectorView, ownerKind: OwnerKind): void {
  const admitted = admittedOwnerKinds(definition)
  if (admitted.includes(ownerKind)) return
  const words: Record<OwnerKind, string> = { org: "organisation", team: "team", user: "personal" }
  const allowed = admitted.length > 0 ? `only ${admitted.map((kind) => words[kind]).join(" or ")} accounts` : "no account created by hand"
  throw new PlatformError("invalid_arguments", `${definition.label} admits ${allowed}: a ${words[ownerKind]} account is not available.`, {
    reason: "owner_kind",
    admitted,
  })
}
