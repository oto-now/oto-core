// Niveaux d'accès calculés en TypeScript (E01-S07, ADR-012 § 3, H123) : une fonction pure des
// faits lus par `access-facts.ts` et de l'appelant dérivé de l'identité, sans base. Même algorithme,
// étape par étape et dans le même ordre, que `platform.node_level_for`
// (`20260927190000_platform_corbeille_partage.sql`, § 6, règle d'organisation d'ADR-014), que la
// recherche emploie encore (E01-S13), tenus égaux par le test de parité
// (`tests/integration/access-parity.test.ts`) ; le niveau d'un compte n'a plus de pendant en base
// (E01-S12 partie c). Sans ce module, un niveau ne se lirait que par RPC, et aucun droit ne se testerait
// sans base.
//
// Repris de la maquette (`mcp-test/src/proto/identity.ts` l. 93-103, `canRead`, `canWrite`) : un
// droit calculé en TypeScript, fonction pure de l'identité. Retiré : l'équipe portée par une colonne
// du nœud (→ propriétaire hérité, H52), l'admin qui lit tout (→ D5), l'absence de règles (→ H66).
import type { FunctionClass } from "./catalog/define"
import type { Identity } from "./identity"

/** Niveaux (H65) : 0 aucun, 1 lecture, 2 écriture, 3 gestion. */
export const ACCESS_LEVELS = { none: 0, read: 1, write: 2, manage: 3 } as const

export type AccessLevel = (typeof ACCESS_LEVELS)[keyof typeof ACCESS_LEVELS]

/**
 * Niveaux d'un compte de connecteur (`droits-d-acces.md` § Partage d'un compte de connecteur) : ceux d'un nœud, plus
 * un niveau sensible entre l'écriture et la gestion, qu'exige une fonction `sensitive` ; une fonction `write` n'exige
 * que l'écriture. Une échelle à part : les nœuds gardent la leur, que tient égale le test de parité avec la base.
 */
export const ACCOUNT_LEVELS = { none: 0, read: 1, write: 2, sensitive: 3, manage: 4 } as const

export type AccountLevel = (typeof ACCOUNT_LEVELS)[keyof typeof ACCOUNT_LEVELS]

/**
 * Niveau exigé sur un compte par la classe d'une fonction (H67) : lecture, écriture, et le niveau sensible, distinct de
 * l'écriture, pour une fonction `sensitive` (`droits-d-acces.md` § Partage d'un compte de connecteur).
 */
export function requiredAccountLevel(fnClass: FunctionClass): AccountLevel {
  return ACCOUNT_LEVELS[fnClass]
}

/** Propriétaire effectif d'un nœud (H52) ou propriétaire d'un compte (H67). */
export type Owner = { kind: "org" | "team" | "user"; teamId: string | null; userId: string | null }

/** Propriétaire effectif d'un nœud et le nœud qui le porte (lui-même ou un ancêtre). */
export type NodeOwner = Owner & { nodeId: string }

/** Chemin de la racine, de profondeur 0 (`lpath` vide, H50) : ancêtre de tout nœud. */
export const ROOT_PATH = "guide"

/** L'appelant tel que le calcul le lit, dérivé de l'identité par `callerOf`. */
export type Caller = {
  userId: string
  orgId: string
  isOrgAdmin: boolean
  /** Ses équipes (`team_members`, responsables compris). */
  teamIds: ReadonlySet<string>
  /** Les équipes dont il est l'un des responsables (`team_members.role`, E05-S13). */
  ledTeamIds: ReadonlySet<string>
}

/** Un nœud : `owner` est son propriétaire explicite, `null` quand il l'hérite (H52). */
export type NodeFact = { id: string; orgId: string; path: string; owner: Owner | null }

/**
 * Une règle (H82) sur un nœud ou un compte (`targetId`), pour une équipe, une personne, ou toute l'organisation (`org`,
 * ADR-014 ; sur un compte depuis le partage des comptes). `level` est au rang de l'échelle de sa cible : celle des
 * nœuds, ou celle des comptes (`AccountRuleFact`).
 */
export type RuleFact<Level extends number = AccessLevel> = { targetId: string; teamId: string | null; userId: string | null; org?: boolean; level: Level }

/** Une règle sur un compte, au rang de l'échelle des comptes (`ACCOUNT_LEVELS`). */
export type AccountRuleFact = RuleFact<AccountLevel>

/**
 * Un nœud, les ancêtres lus (racine comprise ; un nœud qui ne couvre pas son chemin est ignoré) et
 * les règles posées sur eux. `owner` : son propriétaire effectif, fourni quand un ancêtre manque à la
 * lecture (HN-E01S07-4), `null` s'il est introuvable ; sans lui, le plus proche des nœuds lus.
 */
export type NodeChain = {
  node: NodeFact
  ancestors: readonly NodeFact[]
  rules: readonly RuleFact[]
  owner?: NodeOwner | null
}

export type AccountFact = { id: string; orgId: string; owner: Owner }

/** Un compte et les règles posées sur lui : les comptes sont à plat, sans héritage (H67). */
export type AccountFacts = { account: AccountFact; rules: readonly AccountRuleFact[] }

const { none: NONE, read: READ, write: WRITE, manage: MANAGE } = ACCESS_LEVELS

/** Membre de l'équipe plateforme avec un accès en cours à l'organisation (H73, fiche D2). */
export function isStaffWithGrant(identity: Identity): boolean {
  return identity.isStaff && identity.hasOpenGrant
}

/**
 * Administrateur de l'organisation, ou staff avec un accès en cours : c'est `platform.is_org_admin`
 * (fiche D17, option A : un staff aussi membre simple l'est aussi).
 */
export function isOrgAdmin(identity: Identity): boolean {
  return identity.member.role === "admin" || isStaffWithGrant(identity)
}

/** L'un des responsables de l'équipe (`team_members.role`, source unique depuis E05-S13). */
export function leadsTeam(identity: Identity, teamId: string): boolean {
  return identity.teams.some((team) => team.id === teamId && team.role === "lead")
}

export function callerOf(identity: Identity): Caller {
  return {
    userId: identity.user.id,
    orgId: identity.org.id,
    isOrgAdmin: isOrgAdmin(identity),
    teamIds: new Set(identity.teams.map((team) => team.id)),
    ledTeamIds: new Set(identity.teams.filter((team) => team.role === "lead").map((team) => team.id)),
  }
}

/** Profondeur d'un nœud, comme `nlevel(lpath)` : 0 pour la racine, le nombre de segments sinon. */
export function nodeDepth(path: string): number {
  return path === ROOT_PATH ? 0 : path.split("/").length
}

/** Chemins des ancêtres d'un nœud, la racine d'abord : `ventes/devis` → `guide`, `ventes`. */
export function ancestorPaths(path: string): string[] {
  if (path === ROOT_PATH) return []
  const segments = path.split("/")
  return [ROOT_PATH, ...segments.slice(0, -1).map((_, index) => segments.slice(0, index + 1).join("/"))]
}

/** `ancestor` est `path` ou l'un de ses ancêtres (`lpath @>`). */
function covers(ancestor: string, path: string): boolean {
  return ancestor === ROOT_PATH || ancestor === path || path.startsWith(`${ancestor}/`)
}

/** Le nœud et ceux de ses ancêtres qui sont lus, de la même organisation. */
function lineageOf(chain: NodeChain): NodeFact[] {
  const { node } = chain
  const above = chain.ancestors.filter((a) => a.id !== node.id && a.orgId === node.orgId && covers(a.path, node.path))
  return [node, ...above]
}

type PlacedOwner = { owner: Owner; depth: number }

function placedOwner(chain: NodeChain, lineage: readonly NodeFact[]): PlacedOwner | null {
  if (chain.owner === null) return null
  if (chain.owner !== undefined) {
    const { kind, teamId, userId, nodeId } = chain.owner
    const holder = lineage.find((n) => n.id === nodeId)
    // Porteur caché : sa profondeur est inconnue, et le plancher d'un espace personnel n'y change
    // rien. Un nœud lisible sous un porteur caché doit son niveau à une règle posée entre les deux,
    // la plus proche, que le plancher compte de toute façon (HN-E01S07-4).
    return { owner: { kind, teamId, userId }, depth: holder ? nodeDepth(holder.path) : 0 }
  }
  let found: PlacedOwner | null = null
  for (const n of lineage) {
    const depth = nodeDepth(n.path)
    if (n.owner && (!found || depth > found.depth)) found = { owner: n.owner, depth }
  }
  return found
}

/** Propriétaire effectif (H52) : le sien, sinon celui de l'ancêtre le plus proche qui en porte un. */
export function effectiveOwner(chain: NodeChain): Owner | null {
  return placedOwner(chain, lineageOf(chain))?.owner ?? null
}

/** La règle vise l'appelant : lui, une de ses équipes, ou toute l'organisation quand elle compte (`orgCounts`). */
function aimsAt(caller: Caller, rule: RuleFact<number>, orgCounts: boolean): boolean {
  return rule.userId === caller.userId || (rule.teamId !== null && caller.teamIds.has(rule.teamId)) || (orgCounts && rule.org === true)
}

function highest<Level extends number>(rules: readonly RuleFact<Level>[], none: Level): Level {
  return rules.reduce<Level>((level, rule) => (rule.level > level ? rule.level : level), none)
}

/** La règle de la personne l'emporte ; à défaut, le plus haut niveau de ses équipes (H66 (2)). */
function strongest<Level extends number>(caller: Caller, rules: readonly RuleFact<Level>[], none: Level): Level {
  const own = rules.filter((rule) => rule.userId === caller.userId)
  return highest(own.length > 0 ? own : rules, none)
}

/** Responsable de l'équipe propriétaire, sans règle qui le vise nommément (H66 (1 bis), N7). */
function leadKeepsManage(caller: Caller, owner: Owner | null, rules: readonly RuleFact<number>[]): boolean {
  return (
    owner?.kind === "team" &&
    owner.teamId !== null &&
    caller.ledTeamIds.has(owner.teamId) &&
    !rules.some((rule) => rule.userId === caller.userId)
  )
}

/** Sans règle, le propriétaire décide (H66 (3), H67) ; un propriétaire introuvable ne donne rien. */
function ownerDefault(caller: Caller, owner: Owner | null): AccessLevel {
  if (owner?.kind === "org") return READ
  if (owner?.kind === "team" && owner.teamId !== null) {
    if (caller.ledTeamIds.has(owner.teamId)) return MANAGE
    return caller.teamIds.has(owner.teamId) ? WRITE : NONE
  }
  return owner?.kind === "user" && owner.userId === caller.userId ? MANAGE : NONE
}

/**
 * Niveau de l'appelant sur un nœud (H66 avec son cas 1 bis, D5, H61, N35, D20) : 0 pour un nœud
 * d'une autre organisation que celle de l'identité (ADR-004 : l'organisation est celle de l'adresse).
 */
export function nodeLevelOf(caller: Caller, chain: NodeChain): AccessLevel {
  if (chain.node.orgId !== caller.orgId) return NONE
  const lineage = lineageOf(chain)
  const placed = placedOwner(chain, lineage)
  const owner = placed?.owner ?? null
  // D5, H61, N35 : dans un espace personnel, seules comptent les règles posées sur le nœud qui porte
  // la personne comme propriétaire, ou en dessous.
  const floor = owner?.kind === "user" && placed ? placed.depth : 0
  // ADR-014 : une règle d'organisation ne compte pas dans un espace personnel (HN-E05S10e-13).
  const orgCounts = owner?.kind !== "user"
  // (1) administrateur, ou staff avec un accès en cours : gestion, sauf dans un espace personnel.
  if (owner && owner.kind !== "user" && caller.isOrgAdmin) return MANAGE
  const depths = new Map(lineage.map((n) => [n.id, nodeDepth(n.path)]))
  const rules = chain.rules.filter((rule) => depths.has(rule.targetId))
  // (1 bis) une règle qui le nomme, n'importe où dans la chaîne, lui retire la gestion.
  if (leadKeepsManage(caller, owner, rules)) return MANAGE
  // (2) le nœud le plus proche, lui compris et sous le plancher, qui porte une règle visant la
  // personne, ses équipes ou l'organisation ; la règle la plus proche l'emporte, même plus basse, et à
  // ce nœud la personne, puis ses équipes, puis l'organisation (ADR-014).
  const counted = rules.filter((rule) => aimsAt(caller, rule, orgCounts) && (depths.get(rule.targetId) ?? 0) >= floor)
  const nearest = counted.length > 0 ? Math.max(...counted.map((rule) => depths.get(rule.targetId) ?? 0)) : null
  const closest = counted.filter((rule) => depths.get(rule.targetId) === nearest)
  const precise = closest.filter((rule) => rule.org !== true)
  if (precise.length > 0) return strongest(caller, precise, NONE)
  // (3) sans règle de la personne ni de ses équipes : le propriétaire effectif décide, et une règle
  // d'organisation au plus proche ouvre au-delà, sans rien retirer (HN-E05S10e-12).
  const byOwner = ownerDefault(caller, owner)
  const byOrg = highest(closest, NONE)
  return byOrg > byOwner ? byOrg : byOwner
}

/**
 * Sans règle, le propriétaire d'un compte décide (H67) : un compte d'organisation se lit, un compte d'équipe sert ses
 * membres jusqu'aux fonctions sensibles, comme avant le niveau sensible (son responsable le gère) ; le compte personnel
 * d'un autre ne s'ouvre que par une règle (sa personne, elle, le gère : `accountLevelOf`).
 */
function accountOwnerDefault(caller: Caller, owner: Owner): AccountLevel {
  if (owner.kind === "org") return ACCOUNT_LEVELS.read
  if (owner.kind === "team" && owner.teamId !== null) {
    if (caller.ledTeamIds.has(owner.teamId)) return ACCOUNT_LEVELS.manage
    return caller.teamIds.has(owner.teamId) ? ACCOUNT_LEVELS.sensitive : ACCOUNT_LEVELS.none
  }
  return ACCOUNT_LEVELS.none
}

/**
 * Niveau de l'appelant sur un compte (H67), sur l'échelle des comptes (`ACCOUNT_LEVELS`) : même calcul qu'un nœud,
 * sans héritage. Les règles comptées sont celles de l'organisation du compte (M02) : un compte d'une autre organisation
 * vaut 0, et `readAccountFacts` ne lit que les règles de l'organisation de l'identité (précondition des `facts`). La
 * règle qui nomme la personne, puis celles de ses équipes, décident ; sans elles, le défaut du propriétaire, qu'une
 * règle d'organisation ouvre au-delà sans rien retirer, comme sur un nœud (ADR-014 ; `droits-d-acces.md` § Partage
 * d'un compte de connecteur).
 */
export function accountLevelOf(caller: Caller, facts: AccountFacts): AccountLevel {
  const { account } = facts
  if (account.orgId !== caller.orgId) return ACCOUNT_LEVELS.none
  if (account.owner.kind !== "user" && caller.isOrgAdmin) return ACCOUNT_LEVELS.manage
  // Sa personne gère son compte personnel : une règle qu'elle pose pour son équipe ou l'organisation ne la vise pas.
  if (account.owner.kind === "user" && account.owner.userId === caller.userId) return ACCOUNT_LEVELS.manage
  const rules = facts.rules.filter((rule) => rule.targetId === account.id)
  if (leadKeepsManage(caller, account.owner, rules)) return ACCOUNT_LEVELS.manage
  const counted = rules.filter((rule) => aimsAt(caller, rule, true))
  const precise = counted.filter((rule) => rule.org !== true)
  if (precise.length > 0) return strongest(caller, precise, ACCOUNT_LEVELS.none)
  const byOwner = accountOwnerDefault(caller, account.owner)
  const byOrg = highest(counted, ACCOUNT_LEVELS.none)
  return byOrg > byOwner ? byOrg : byOwner
}

/** Rendre personnel ce qui ne l'était pas : propriétaire effectif `user` après, pas avant. */
function becomesPersonal(before: Owner | null, after: Owner | null): boolean {
  return after?.kind === "user" && before?.kind !== "user"
}

/**
 * Poser `owner` sur un compte (N30, N37 ; HN-E01S07-10) : la gestion sur la ligne d'avant et sur la
 * ligne écrite ; rendre personnel un compte qui ne l'était pas, l'administrateur seulement.
 * Précondition : `facts` lus par `readAccountFacts` dans l'organisation de l'appelant (un compte n'a
 * pas d'ancêtre : ses faits sont complets).
 */
export function accountOwnerChangeAllowed(caller: Caller, facts: AccountFacts, owner: Owner): boolean {
  if (becomesPersonal(facts.account.owner, owner) && !caller.isOrgAdmin) return false
  const written: AccountFacts = { ...facts, account: { ...facts.account, owner } }
  return accountLevelOf(caller, facts) === ACCOUNT_LEVELS.manage && accountLevelOf(caller, written) === ACCOUNT_LEVELS.manage
}
