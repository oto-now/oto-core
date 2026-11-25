// La connexion menée par l'agent (`connexion-par-l-agent.md`) : l'adresse stable qui mène une personne au seul geste qui
// lui reste (consentir chez le tiers, coller une clé, brancher son compte, ou, administrateur, confirmer l'activation),
// `<origine>/connect/<connecteur>?space=…`, et le seul constructeur des refus « connecteur éteint », « pas de compte » et
// « compte à reconnecter » (`connectRefusal`), qui la portent en `details.url` avec une phrase d'action. La même décision
// (`planConnection`) sert le refus, la fonction `connector.connect` et la page de l'hôte (`connectionStep`) ; un compte
// existant à doter d'une clé (refusée par le tiers, ou jamais posée) a la sienne (`planAccountKey`, `accountKeyRefusal`),
// dont l'adresse nomme le compte (`account_id=<id>`). L'adresse ne
// porte ni secret ni jeton : elle ne vaut que sous la session de la personne, et l'espace qu'elle nomme est revérifié
// contre ses droits à chaque ouverture, jamais cru. Sans ce module, un refus disait seulement à qui demander, et la
// personne cherchait l'écran et la clé à la main.
import type { ConnectAccessChoice } from "../../schemas/connectors"
import { ACCOUNT_LEVELS, accountLevel, administratorNames, describeOwner, isOrgAdmin } from "../access"
import { declaredConnector, type DeclaredAccess } from "../catalog/connector-source"
import { catalogFunctions } from "../catalog/registry"
import type { PlatformDb } from "../db"
import { memberDirectory, teamsWithLeads } from "../directory"
import { inTransaction, PlatformError } from "../errors"
import type { Identity } from "../identity"
import { orgLimits } from "../limits"
import { hasAccesses, requestedAccess } from "./accesses"
import { admittedOwnerKinds, formOwnerKinds, type OwnerKind } from "./account-owners"
import type { AccountOwner } from "./accounts"
import { requireActivable } from "./activations"
import { mayCreateAccountFor } from "./creation-right"
import { HOST_CONSENT_CONNECTOR } from "./definition"
import { accountFieldNames } from "./host-fields"

/** Le chemin de la page de connexion d'un connecteur, sous l'adresse de l'organisation. */
export const CONNECT_PATH = "/connect"

/** Le geste qui reste à faire : consentir chez le tiers, coller une clé, brancher son compte, activer le connecteur. */
export type ConnectGesture = "oauth" | "key" | "hosted_link" | "admin_activation"

/** Ce qui manque : le connecteur est éteint, aucun compte ne sert, ou le compte est à reconnecter. */
export type ConnectReason = "connector_off" | "no_account" | "reconnect"

/** L'espace où le compte se connecte : celui de la personne, celui de l'organisation, celui d'une équipe (par slug). */
export type ConnectSpace = { kind: "user" } | { kind: "org" } | { kind: "team"; slug: string }

/** Un administrateur nommé dans un refus ou sur la page : à qui transmettre l'adresse. */
export type NamedAdministrator = { name: string }

/** Ce qu'il faut pour bâtir une adresse : la base, l'appelant, l'origine de l'adresse de l'organisation appelée. */
export type ConnectWhere = { db: PlatformDb; identity: Identity; origin?: string | null }

/** L'espace tel que l'adresse le dit : `me`, `org`, `team:<slug>`. */
export function spaceParam(space: ConnectSpace): string {
  if (space.kind === "user") return "me"
  return space.kind === "org" ? "org" : `team:${space.slug}`
}

/** L'espace d'une adresse, déjà validé par son schéma (`connectSpaceSchema` : `me`, `org`, `team:<slug>`). */
export function parseSpace(text: string): ConnectSpace {
  if (text === "me") return { kind: "user" }
  if (text === "org") return { kind: "org" }
  return { kind: "team", slug: text.slice("team:".length) }
}

/**
 * L'origine de l'organisation appelée, telle qu'une adresse la prend : `https://acme.example.test`, sans chemin. Absente
 * ou malformée, c'est une erreur de configuration de l'hôte (son adresse publique), dite et journalisée, jamais une
 * adresse devinée.
 */
function checkedOrigin(origin: string | null | undefined): string {
  if (origin) {
    try {
      const url = new URL(origin)
      if ((url.protocol === "https:" || url.protocol === "http:") && url.origin === origin) return origin
    } catch {
      // Malformée : refusée plus bas, comme absente.
    }
  }
  console.error(`[platform] connect link: no public address to build it from (${JSON.stringify(origin ?? null)})`)
  throw new PlatformError(
    "internal",
    "The public address of this organisation is not known, so the connection link cannot be built. Ask whoever runs this application to set its public address.",
  )
}

/**
 * L'adresse stable de la connexion d'un connecteur, dans un espace ; `activate` : celle qu'un administrateur ouvre pour
 * l'activer ; `account` : celle de la clé d'un compte existant (son identifiant, qui n'est pas un secret).
 */
export function connectionUrl(
  origin: string | null | undefined,
  connector: string,
  space: ConnectSpace,
  options: { access?: string | null; activate?: boolean; account?: string } = {},
): string {
  const url = new URL(`${CONNECT_PATH}/${encodeURIComponent(connector)}`, checkedOrigin(origin))
  url.searchParams.set("space", spaceParam(space))
  if (options.access) url.searchParams.set("access", options.access)
  if (options.activate) url.searchParams.set("activate", "1")
  if (options.account) url.searchParams.set("account_id", options.account)
  return url.toString()
}

/**
 * L'accès par lequel se connecter : celui que la saisie nomme (refusé nommément s'il n'existe pas), sinon le seul, sinon
 * celui à consentement (un seul geste chez le tiers), sinon le premier déclaré. `null` : un connecteur non déclaré
 * (simulé), qui n'a ni clé ni consentement.
 */
export function connectAccess(connector: string, access?: string | null): DeclaredAccess | null {
  const declared = declaredConnector(connector)
  if (!declared) return null
  if (access) return requestedAccess(declared, access)
  if (declared.accesses.length === 1) return declared.accesses[0]
  return declared.accesses.find((candidate) => candidate.auth.kind === "user_consent") ?? declared.accesses[0]
}

/** Le geste d'un accès quand le connecteur est ouvert : consentement, branchement hébergé, sinon la saisie d'un compte. */
export function gestureOf(connector: string, access: DeclaredAccess | null): Exclude<ConnectGesture, "admin_activation"> {
  if (connector === HOST_CONSENT_CONNECTOR || access?.auth.kind === "user_consent") return "oauth"
  if (access?.definition.accountIdentity !== undefined) return "hosted_link"
  return "key"
}


/**
 * Les accès d'un connecteur à plusieurs accès offerts au choix, chacun avec le geste qui l'ouvre quand le connecteur
 * est ouvert, sauf `except` (celui que l'adresse nomme déjà) : la page
 * les propose à côté de son geste, et le refus d'un appel sans compte les nomme. Vide pour un connecteur à un seul accès
 * ou non déclaré. Rien n'en est cru : l'accès choisi revient par l'adresse, revérifié (`connectAccess`).
 */
export function accessChoices(connector: string, except: string | null = null): ConnectAccessChoice[] {
  const declared = declaredConnector(connector)
  if (!declared || !hasAccesses(declared)) return []
  return declared.accesses.flatMap((access) =>
    access.name === null || access.label === null || access.name === except ? [] : [{ name: access.name, label: access.label, gesture: gestureOf(connector, access) }],
  )
}

/**
 * Les propriétaires qu'un compte de ce connecteur admet par ce geste : la personne seule pour un consentement ou un
 * branchement ; sinon ceux du formulaire de l'écran, ou, sans formulaire (clé de l'hôte, connecteur simulé),
 * l'organisation et les équipes, comme l'écran Connecteurs.
 */
function ownerKindsOf(connector: string, access: DeclaredAccess | null): OwnerKind[] {
  if (gestureOf(connector, access) !== "key") return ["user"]
  if (!access) return ["org", "team"]
  const form = formOwnerKinds(access.definition)
  return form.length > 0 ? form : admittedOwnerKinds(access.definition)
}

/** Le libellé d'un connecteur : celui de sa déclaration, à défaut son nom. */
export function connectorLabel(connector: string): string {
  return declaredConnector(connector)?.definition.label ?? connector
}

/** L'état du connecteur dans l'organisation : actif, fermé par un administrateur, ou jamais activé. L'API de l'hôte est toujours ouverte. */
async function connectorState(db: PlatformDb, identity: Identity, connector: string): Promise<"active" | "closed" | "never"> {
  if (connector === HOST_CONSENT_CONNECTOR) return "active"
  const [row] = await inTransaction(db, "connectionPlan: connector_activations", (sql) => sql<{ state: string }[]>`
    select state from platform.connector_activations where org_id = ${identity.org.id} and connector = ${connector}`)
  if (!row) return "never"
  return row.state === "active" ? "active" : "closed"
}

type Team = { id: string; slug: string; name: string; leads: string[] }

async function orgTeams(db: PlatformDb, identity: Identity): Promise<Team[]> {
  const [teams, slugs] = await inTransaction(db, "connectionPlan: teams", async (sql) =>
    Promise.all([teamsWithLeads(sql, identity.org.id), sql<{ id: string; slug: string }[]>`select id, slug from platform.teams where org_id = ${identity.org.id}`]),
  )
  return teams
    .map((team) => ({ ...team, slug: slugs.find((row) => row.id === team.id)?.slug ?? "" }))
    .sort((a, b) => a.name.localeCompare(b.name, "fr"))
}

/**
 * Pourquoi la personne ne peut pas connecter un compte de ce connecteur dans cet espace, ou `null` : la déclaration
 * (`kinds`), les capacités de l'hôte (`account_owner_kinds`) et la règle de la création (`mayCreateAccountFor` : soi,
 * l'organisation pour qui l'administre, une équipe pour qui l'administre ou la dirige). L'équipe est lue par son slug.
 */
async function spaceProblem(where: ConnectWhere, space: ConnectSpace, kinds: readonly OwnerKind[], teams: () => Promise<Team[]>): Promise<string | null> {
  const { identity } = where
  const words = { user: "personal", org: "organisation", team: "team" } as const
  const team = space.kind === "team" ? (await teams()).find((candidate) => candidate.slug === space.slug) : undefined
  if (space.kind === "team" && !team) throw new PlatformError("not_found", `No team ${space.slug} in ${identity.org.name}.`)
  if (!kinds.includes(space.kind)) return `this connector takes no ${words[space.kind]} account`
  const admitted = (await orgLimits(identity.org)).account_owner_kinds
  if (admitted !== undefined && !admitted.includes(space.kind)) return `${identity.org.name} does not open ${words[space.kind]} connector accounts`
  if (space.kind === "user") return null
  if (space.kind === "org") return mayCreateAccountFor(identity, { kind: "org" }) ? null : "only an administrator connects an account of the organisation"
  if (!team) throw new PlatformError("not_found", `No team ${space.slug} in ${identity.org.name}.`)
  return mayCreateAccountFor(identity, { kind: "team", teamId: team.id }) ? null : `only an administrator or a lead of team ${team.name} connects its accounts`
}

/**
 * L'espace où la personne connecte le compte quand on ne le lui nomme pas : le sien pour un consentement ou un
 * branchement ; sinon l'organisation si elle l'administre, la première équipe qu'elle dirige, elle-même ; à défaut
 * l'organisation, dont l'adresse ira à un administrateur.
 */
async function defaultSpace(identity: Identity, kinds: readonly OwnerKind[], teams: () => Promise<Team[]>): Promise<ConnectSpace> {
  if (kinds.length === 1 && kinds[0] === "user") return { kind: "user" }
  if (kinds.includes("org") && isOrgAdmin(identity)) return { kind: "org" }
  if (kinds.includes("team")) {
    const led = (await teams()).find((team) => team.leads.includes(identity.user.id))
    if (led) return { kind: "team", slug: led.slug }
  }
  if (kinds.includes("user")) return { kind: "user" }
  return { kind: "org" }
}

/**
 * La connexion à mener : le connecteur, son accès, l'espace, le geste, et l'adresse stable. `byCaller` : la personne fait
 * le geste elle-même ; sinon l'adresse va à un administrateur (`administrators`, nommés). Un connecteur bloqué par un
 * administrateur demande sa réouverture (`admin_activation`, adresse `activate=1`) ; tout autre est ouvert par défaut, et
 * le geste est celui de son accès. `team` : l'équipe de l'espace, lue par son slug.
 */
export type ConnectionPlan = {
  connector: string
  label: string
  access: DeclaredAccess | null
  space: ConnectSpace
  gesture: ConnectGesture
  byCaller: boolean
  administrators: NamedAdministrator[]
  /** Leurs noms, tels qu'une phrase les dit (« Ada Martin and Léa Petit ») ; vide quand la personne fait le geste. */
  administratorNames: string
  /** Le geste `key` fait saisir une clé (des champs du compte) ; sinon le compte s'ajoute sans rien saisir (clé de l'hôte, connecteur simulé). */
  entersKey: boolean
  url: string
  team: { id: string; name: string } | null
  /**
   * Le compte existant dont la clé est à poser (`planAccountKey`) : son libellé, et qui le gère quand ce n'est pas la
   * personne (« Léa Petit », « the administrators of Acme (Ada Martin) », « team Ventes (lead: Claire Morel) »).
   */
  account?: { id: string; label: string; managers: string }
}

/**
 * Décide la connexion d'un connecteur pour la personne. `space` nommé : revérifié contre ses droits, refusé nommément
 * s'il ne lui est pas permis (`forbidden`) ; sans lui, l'espace par défaut, dont l'adresse va à un administrateur quand
 * la personne ne peut pas s'y connecter. Refus : connecteur inconnu ou natif (`requireActivable`), accès inconnu
 * (`invalid_arguments`), équipe inconnue (`not_found`), adresse publique absente (`internal`).
 */
export async function planConnection(where: ConnectWhere, input: { connector: string; access?: string | null; space?: ConnectSpace }): Promise<ConnectionPlan> {
  const { db, identity, origin } = where
  const { connector } = input
  if (connector !== HOST_CONSENT_CONNECTOR) requireActivable(connector, catalogFunctions())
  const access = connector === HOST_CONSENT_CONNECTOR ? null : connectAccess(connector, input.access)
  const accessName = access?.name ?? null
  const kinds = ownerKindsOf(connector, access)
  let read: Promise<Team[]> | null = null
  const teams = () => (read ??= orgTeams(db, identity))
  const space = input.space ?? (await defaultSpace(identity, kinds, teams))
  const problem = await spaceProblem(where, space, kinds, teams)
  if (problem && input.space) {
    throw new PlatformError("forbidden", `You cannot connect ${connectorLabel(connector)} in ${spaceParam(space)}: ${problem}.`, { reason: "space", space: spaceParam(space) })
  }
  const team = space.kind === "team" ? ((await teams()).find((candidate) => candidate.slug === space.slug) ?? null) : null
  const state = await connectorState(db, identity, connector)
  const base = gestureOf(connector, access)
  // Ouvert par défaut : seul un connecteur bloqué demande sa réouverture par un administrateur.
  const off = state === "closed"
  const gesture: ConnectGesture = off ? "admin_activation" : base
  const byCaller = off ? isOrgAdmin(identity) : problem === null
  const { administrators, names } = byCaller ? { administrators: [], names: "" } : await administratorsOf(db, identity)
  return {
    connector,
    label: connectorLabel(connector),
    access,
    space,
    gesture,
    byCaller,
    administrators,
    administratorNames: names,
    entersKey: access !== null && accountFieldNames(access.definition).length > 0,
    url: connectionUrl(origin, connector, space, { access: accessName, activate: off }),
    team: team ? { id: team.id, name: team.name } : null,
  }
}

/** Les administrateurs de l'organisation, par nom, en français, et la phrase qui les nomme. */
async function administratorsOf(db: PlatformDb, identity: Identity): Promise<{ administrators: NamedAdministrator[]; names: string }> {
  const directory = await memberDirectory(db, identity.org.id)
  const administrators = directory
    .filter((person) => person.role === "admin")
    // Leurs noms seuls : l'adresse et le refus passent par l'assistant, jamais un identifiant de personne.
    .map((person) => ({ name: person.name }))
    .sort((a, b) => a.name.localeCompare(b.name, "fr"))
  return { administrators, names: administratorNames(directory) }
}

/**
 * La phrase d'action d'un refus, selon le geste et qui le fait, terminée par l'adresse à ouvrir (`open <url>`, contrat
 * commun du refus de la lib de connecteurs) : un assistant qui ne lit pas `details` relaie quand même le geste.
 */
export function actionSentence(plan: ConnectionPlan, orgName: string, owner?: string): string {
  const { url, label } = plan
  const relay = `ask the user to pass them the link and call again once it is done: open ${url}`
  if (owner !== undefined) return `Only its owner, ${owner}, can connect it again; ${relay}`
  const { account } = plan
  if (account && !plan.byCaller) return `Only ${account.managers} can set the key of account « ${account.label} »; ${relay}`
  if (account) return `Ask the user to paste the ${label} key of account « ${account.label} », then call again: open ${url}`
  if (!plan.byCaller) {
    const names = plan.administratorNames ? ` (${plan.administratorNames})` : ""
    return `Only an administrator of ${orgName}${names} can do it; ${relay}`
  }
  const gesture = {
    oauth: `authorize ${label}`,
    hosted_link: `link their ${label} account`,
    key: plan.entersKey ? `paste the ${label} key` : `add the ${label} account`,
    admin_activation: `confirm the activation of ${label} and connect an account`,
  }[plan.gesture]
  return `Ask the user to ${gesture}, then call again: open ${url}`
}

/** Ce qui précède l'action dans un refus : ce qui manque, et ce qu'un refus ajoute (les comptes partagés). */
export type ConnectRefusalInput = {
  reason: ConnectReason
  /** La phrase qui dit ce qui manque, terminée par un point. */
  said: string
  /** Le compte à reconnecter est partagé par une autre personne : son nom ; l'adresse lui est à transmettre. */
  owner?: string
  /** La phrase et les précisions qui nomment les comptes personnels partagés avec l'appelant (`account-refusals.ts`). */
  shared?: { text: string; details?: Record<string, unknown> }
}

/**
 * La phrase qui offre les autres accès d'un connecteur à plusieurs accès, dans un refus sans compte (`no_account`) : le
 * refus nomme l'accès de son plan (`details.access`, son geste), la page de son adresse propose aussi les autres. Vide
 * pour un compte à reconnecter ou à doter d'une clé, qui garde son accès, et pour un connecteur éteint, que tout accès
 * attend activé.
 */
function otherAccesses(plan: ConnectionPlan, input: ConnectRefusalInput): string {
  if (input.reason !== "no_account" || plan.account || plan.gesture === "admin_activation") return ""
  const others = accessChoices(plan.connector, plan.access?.name ?? null)
  if (others.length === 0) return ""
  const named = others.map((access) => `${access.name} (${access.label})`).join(", ")
  return ` ${plan.label} also opens by ${others.length > 1 ? "other accesses" : "another access"}, ${named}, which the link offers too.`
}

/**
 * Le refus d'un appel faute de connexion (`not_enabled`), une fois la connexion décidée (`planConnection`) : ce qui
 * manque, l'action en clair avec l'adresse finale, et en `details` : `reason`, `gesture`, `connector`, `access`
 * (connecteur à plusieurs accès), `space`, `url`, les `administrators` quand l'adresse leur va, et les comptes partagés.
 */
export function refusalFromPlan(plan: ConnectionPlan, orgName: string, input: ConnectRefusalInput): PlatformError {
  return new PlatformError("not_enabled", `${input.said}${input.shared?.text ?? ""}${otherAccesses(plan, input)} ${actionSentence(plan, orgName, input.owner)}`, {
    reason: input.reason,
    gesture: plan.gesture,
    connector: plan.connector,
    ...(plan.access?.name ? { access: plan.access.name } : {}),
    space: spaceParam(plan.space),
    url: plan.url,
    ...(plan.administrators.length > 0 ? { administrators: plan.administrators } : {}),
    ...input.shared?.details,
  })
}

/**
 * Le refus d'un appel faute de connexion, de bout en bout : la connexion décidée pour l'appelant (`planConnection`, son
 * espace par défaut), puis `refusalFromPlan` ; `label` : le nom que l'action dit, quand le connecteur n'est pas déclaré
 * (l'API de l'hôte). Une adresse qui ne se bâtit pas lève sa propre erreur (`checkedOrigin`) :
 * jamais un refus sans adresse.
 */
export async function connectRefusal(
  where: ConnectWhere,
  input: ConnectRefusalInput & { connector: string; access?: string | null; label?: string },
): Promise<PlatformError> {
  const plan = await planConnection(where, { connector: input.connector, access: input.access })
  return refusalFromPlan(input.label ? { ...plan, label: input.label } : plan, where.identity.org.name, input)
}

/** Le compte existant d'un refus de clé : son identifiant, son libellé, l'accès qu'il retient, son propriétaire. */
export type KeyAccount = { id: string; label: string; access?: string; owner: AccountOwner }

/** L'espace d'un compte existant : celui de sa personne, l'organisation, ou son équipe, lue par son slug. */
export async function accountSpace(where: ConnectWhere, owner: AccountOwner): Promise<{ space: ConnectSpace; team: { id: string; name: string } | null }> {
  if (owner.kind === "user") return { space: { kind: "user" }, team: null }
  if (owner.kind === "org") return { space: { kind: "org" }, team: null }
  const team = (await orgTeams(where.db, where.identity)).find((candidate) => candidate.id === owner.teamId)
  if (!team) {
    console.error(`[platform] connect link: team ${owner.teamId} of an account is not in org ${where.identity.org.id}`)
    throw new PlatformError("internal", "Internal error.")
  }
  return { space: { kind: "team", slug: team.slug }, team: { id: team.id, name: team.name } }
}

/** Le nom de la personne d'un compte personnel, tel que l'annuaire le dit ; absent, une erreur interne, jamais un nom deviné. */
export async function ownerNameOf(where: ConnectWhere, account: { id: string; owner: AccountOwner }): Promise<string> {
  const ownerId = account.owner.userId
  const name = (await memberDirectory(where.db, where.identity.org.id)).find((person) => person.userId === ownerId)?.name
  if (name === undefined) {
    console.error(`[platform] connect link: no directory name for the owner of account ${account.id}`)
    throw new PlatformError("internal", "Internal error.")
  }
  return name
}

/**
 * La connexion d'un compte existant dont la clé est à poser : refusée par le tiers (`credential_rejected`), ou jamais
 * posée. Le geste est `key`, l'espace celui du compte, l'adresse nomme le compte (`account_id=<id>`) : la page y ouvre la
 * saisie de sa clé, pas la création d'un autre compte. La personne agit si elle gère le compte (`ACCOUNT_LEVELS.manage`) ;
 * sinon l'adresse va à qui le gère, nommé (`account.managers`), et aux administrateurs (`administrators`) pour un compte
 * de l'organisation. Le connecteur est ouvert : l'appel l'a déjà vérifié.
 */
export async function planAccountKey(where: ConnectWhere, input: { connector: string; account: KeyAccount }): Promise<ConnectionPlan> {
  const { db, identity, origin } = where
  const { connector, account } = input
  const access = connectAccess(connector, account.access ?? null)
  const { space, team } = await accountSpace(where, account.owner)
  const byCaller = (await accountLevel(db, identity, account.id)) >= ACCOUNT_LEVELS.manage
  const managers = byCaller ? "" : account.owner.kind === "user" ? await ownerNameOf(where, account) : await describeOwner(db, identity, account.owner)
  const { administrators } = !byCaller && account.owner.kind === "org" ? await administratorsOf(db, identity) : { administrators: [] }
  return {
    connector,
    label: connectorLabel(connector),
    access,
    space,
    gesture: "key",
    byCaller,
    administrators,
    administratorNames: "",
    entersKey: true,
    url: connectionUrl(origin, connector, space, { access: access?.name ?? null, account: account.id }),
    team,
    account: { id: account.id, label: account.label, managers },
  }
}

/**
 * Le refus d'un appel dont le compte attend une clé (`not_enabled`, geste `key`) : `reconnect` quand le tiers a refusé
 * la sienne (le compte est marqué), `no_account` quand aucune n'a jamais été posée (aucun compte utilisable). L'adresse
 * mène à la saisie de la clé de ce compte (`planAccountKey`).
 */
export async function accountKeyRefusal(
  where: ConnectWhere,
  input: { connector: string; account: KeyAccount; reason: Extract<ConnectReason, "no_account" | "reconnect">; said: string },
): Promise<PlatformError> {
  const plan = await planAccountKey(where, input)
  return refusalFromPlan(plan, where.identity.org.name, { reason: input.reason, said: input.said })
}
