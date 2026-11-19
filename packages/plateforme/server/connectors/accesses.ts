// Les accès d'un connecteur (`connecteurs-et-comptes.md` § Plusieurs accès) : un connecteur s'ouvre par un seul accès
// (`auth`, `credential`, `modes`) ou par plusieurs (`accesses`, à leur place), chacun jugé comme un connecteur à un
// seul accès, sur le connecteur tel qu'il le voit (`ConnectorView`). Un compte retient l'accès qui l'a ouvert
// (`accounts.access`) : exigé et contrôlé pour un connecteur à plusieurs accès, nul pour un connecteur à un seul ; un
// compte ne change jamais d'accès. Lu par la déclaration (`declaration.ts`), la création d'un compte, le consentement,
// la sonde et l'appel ; sans ce module, chacun redirait la vue d'un accès et ses refus, et un appel pourrait se signer
// par un accès que le compte n'a pas.
import { declaredConnector, type DeclaredAccess, type DeclaredConnector } from "../catalog/connector-source"
import { PlatformError } from "../errors"
import { isJsonObject } from "../json"
import type { ConnectorDefinition, ConnectorView } from "./definition"
import { FIELD_NAME } from "./host-declaration"

/** Comme le libellé d'un connecteur. */
const ACCESS_LABEL_MAX = 80

/** Un accès vu par la déclaration : son nom et son libellé (`null` pour un connecteur à un seul accès), et sa vue. */
export type AccessView = { name: string | null; label: string | null; view: ConnectorView }

/**
 * Le problème de `accesses` : au moins deux accès, jamais à côté de `auth`, `credential` ou `modes` ; chacun un objet à
 * nom (lettres minuscules ASCII, chiffres et _, unique) et libellé ; aucun compte rattaché (`accountIdentity`), que
 * le paquet ne sert qu'à un seul accès. `null` : aucun problème, ou un connecteur à un seul accès.
 */
export function accessesProblem(definition: ConnectorDefinition): string | null {
  const accesses: unknown = definition.accesses
  if (accesses === undefined) return null
  const { name } = definition
  if (definition.auth !== undefined || definition.credential !== undefined || definition.modes !== undefined) {
    return `${name}: accesses replaces auth, credential and modes: declare one or the other, never both.`
  }
  if (!Array.isArray(accesses) || accesses.length < 2) return `${name}: accesses must list at least two accesses; a connector with one declares auth, credential and modes.`
  for (const access of accesses) {
    if (!isJsonObject(access) || typeof access.name !== "string" || !FIELD_NAME.test(access.name)) {
      return `${name}: each access needs a name in lowercase ASCII letters, digits and _, starting with a letter.`
    }
    if (typeof access.label !== "string" || !access.label.trim() || access.label.length > ACCESS_LABEL_MAX) {
      return `${name}: access ${access.name} needs a label of 1 to ${ACCESS_LABEL_MAX} characters.`
    }
  }
  const names = accesses.map((access: { name: string }) => access.name)
  const twice = names.find((access, index) => names.indexOf(access) !== index)
  if (twice !== undefined) return `${name}: access ${twice} is declared twice.`
  if (definition.accountIdentity !== undefined) return `${name}: accountIdentity is served for a connector with a single access only, not with accesses.`
  return null
}

/** Les accès d'une définition contrôlée par `accessesProblem` : le seul, sans nom, ou chacun, vu par lui. */
export function accessViews(definition: ConnectorDefinition): AccessView[] {
  if (definition.accesses === undefined) return [{ name: null, label: null, view: definition }]
  const { accesses, ...shared } = definition
  return accesses.map(({ name, label, auth, credential, modes }) => ({ name, label, view: { ...shared, auth, credential, modes } }))
}

/** Le refus d'un accès, nommé : `Access <nom> of <connecteur>: <problème>` ; tel quel pour un connecteur à un seul accès. */
export function accessProblem(access: AccessView, problem: string | null): string | null {
  if (problem === null || access.name === null) return problem
  return `Access ${access.name} of ${access.view.name}: ${problem}`
}

/** Vrai pour un connecteur déclaré à plusieurs accès. */
export const hasAccesses = (declared: DeclaredConnector): boolean => declared.definition.accesses !== undefined

/** La phrase qui nomme les accès d'un connecteur : « service_account (Service account of the organization), … ». */
const accessList = (declared: DeclaredConnector): string => declared.accesses.map((access) => `${access.name} (${access.label})`).join(", ")

/**
 * L'accès qu'une saisie nomme (création d'un compte, consentement, sonde à blanc) : exigé et déclaré pour un connecteur
 * à plusieurs accès, refusé pour un connecteur à un seul ; jamais un accès par défaut (`invalid_arguments`, `access`).
 */
export function requestedAccess(declared: DeclaredConnector, given: string | undefined): DeclaredAccess {
  const { name, label } = declared.definition
  if (!hasAccesses(declared)) {
    if (given !== undefined) throw new PlatformError("invalid_arguments", `${label} opens by a single access: access is not given.`, { reason: "access" })
    return declared.accesses[0]
  }
  const found = given === undefined ? null : declared.accesses.find((access) => access.name === given)
  if (found) return found
  const said = given === undefined ? `${label} opens by several accesses: name one` : `${label} has no access ${given}`
  throw new PlatformError("invalid_arguments", `${said} (${accessList(declared)}).`, { reason: "access", connector: name, accesses: declared.accesses.map((access) => access.name) })
}

/**
 * L'accès qu'un compte a retenu, par lequel il s'ouvre et se signe : `null` pour un connecteur à un seul accès, un nom
 * déclaré pour un connecteur à plusieurs. Un compte qui n'en retient pas, ou en retient un que la déclaration ne porte
 * pas (l'hôte a changé ses accès) : refusé nommément (`not_enabled`, `access`), jamais rabattu sur un autre ; un autre
 * compte se connecte.
 */
export function accountAccess(declared: DeclaredConnector, account: { label: string; access?: string | null }): DeclaredAccess {
  const wanted = account.access ?? null
  const found = declared.accesses.find((access) => access.name === wanted)
  if (found) return found
  const { name, label } = declared.definition
  console.error(`[platform] connector ${name}: an account retains access ${wanted ?? "none"}, which the declaration does not match`)
  const said =
    wanted === null
      ? `Account « ${account.label} » does not say by which access it opens, and ${label} opens by several (${accessList(declared)})`
      : `Account « ${account.label} » opens by access ${wanted}, which ${label} no longer declares`
  throw new PlatformError("not_enabled", `${said}. Connect another account of ${label}.`, { reason: "access" })
}

/**
 * Le seul accès d'un connecteur qui n'en a qu'un (un compte rattaché, que `accessesProblem` refuse à plusieurs accès) ;
 * sinon câblage fautif.
 */
export function singleAccess(declared: DeclaredConnector): DeclaredAccess {
  if (!hasAccesses(declared) && declared.accesses.length === 1) return declared.accesses[0]
  console.error(`[platform] connector ${declared.definition.name}: a single access expected`)
  throw new PlatformError("internal", "Internal error.")
}

/**
 * L'accès d'un compte créé à la main (`createAccount`) : celui que la saisie nomme pour un connecteur déclaré
 * (`requestedAccess`) ; aucun pour un connecteur non déclaré (simulé), qui n'en admet pas. Un connecteur, ou un accès, à
 * consentement (`oauth2_user`) n'a pas de compte créé à la main, quel qu'en soit le titulaire : ses jetons ne naissent
 * que du consentement d'une personne, qui en fait un compte personnel, partagé ensuite comme tout compte personnel.
 */
export function creationAccess(connector: string, given: string | undefined): DeclaredAccess | null {
  const declared = declaredConnector(connector)
  if (!declared) {
    if (given !== undefined) throw new PlatformError("invalid_arguments", `${connector} opens by no access: access is not given.`, { reason: "access" })
    return null
  }
  const access = requestedAccess(declared, given)
  if (access.auth.kind !== "user_consent") return access
  const of = access.name === null ? connector : `${connector} by access ${access.name}`
  throw new PlatformError("invalid_arguments", `Accounts of ${of} are not created by hand: each person connects their own by consenting (Connect my account), then may share it like any personal account.`)
}
