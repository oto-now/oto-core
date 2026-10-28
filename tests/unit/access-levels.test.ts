// @vitest-environment node
// Calcul pur des niveaux (E01-S07 AC1 à AC11) sur l'organisation O en mémoire, sans base : pour
// chaque règle, le cas qui la prouve et sa frontière, jamais une matrice rôle × niveau
// (`testing-strategy.md § Budget de tests : le minimum vital`). L'égalité avec le SQL est prouvée
// par `tests/integration/access-parity.test.ts`.
import { describe, expect, it } from "vitest"
import {
  accountLevelOf,
  accountOwnerChangeAllowed,
  callerOf,
  isOrgAdmin,
  isStaffWithGrant,
  leadsTeam,
  nodeLevelOf,
  type AccessLevel,
  type AccountFacts,
  type AccountLevel,
  type NodeChain,
  type NodeFact,
  type NodeOwner,
} from "../../packages/plateforme/server/access-levels"
import type { Identity } from "../../packages/plateforme/server/identity"
import {
  accountRuleFact,
  ACCOUNTS,
  identityOf,
  nodeFacts,
  ORG,
  PEOPLE,
  ruleFact,
  TEAMS,
  teamOf,
  type AccountKey,
  type Person,
  type RuleSpec,
} from "../helpers/reference-org"

const NODES = nodeFacts()

function fact(path: string): NodeFact {
  const found = NODES.find((node) => node.path === path)
  if (!found) throw new Error(`no node ${path} in O`)
  return found
}

/** Le propriétaire que `node_owner` rend pour un nœud qui en porte un. */
function ownerAt(path: string): NodeOwner {
  const { owner, id } = fact(path)
  if (!owner) throw new Error(`${path} inherits its owner`)
  return { ...owner, nodeId: id }
}

/** La chaîne de `path` telle qu'on la lit : les nœuds de O sauf `hidden`, les règles données. */
function chain(path: string, rules: RuleSpec[] = [], options: { hidden?: string[]; owner?: NodeOwner } = {}): NodeChain {
  const ancestors = NODES.filter((node) => node.path !== path && !options.hidden?.includes(node.path))
  return { node: fact(path), ancestors, rules: rules.map(ruleFact), ...(options.owner ? { owner: options.owner } : {}) }
}

const identity = (who: Person | Identity): Identity => (typeof who === "string" ? identityOf(who) : who)

function level(who: Person | Identity, path: string, rules: RuleSpec[] = []): AccessLevel {
  return nodeLevelOf(callerOf(identity(who)), chain(path, rules))
}

function account(key: AccountKey, rules: RuleSpec[] = []): AccountFacts {
  const { id, owner } = ACCOUNTS[key]
  return { account: { id, orgId: ORG.id, owner }, rules: rules.map(accountRuleFact) }
}

function accountLevel(who: Person, key: AccountKey, rules: RuleSpec[] = []): AccountLevel {
  return accountLevelOf(callerOf(identityOf(who)), account(key, rules))
}

describe("nodeLevelOf", () => {
  it("should give each owner's default, the effective owner being the closest one (AC1)", () => {
    expect(level("marc", "guide")).toBe(1)
    expect(level("lea", "ventes/devis/modele")).toBe(2)
    expect(level("claire", "ventes/devis/modele")).toBe(3)
    expect(level("paul", "ventes/devis/modele")).toBe(0)
    expect([level("claire", "private/claire/notes"), level("lea", "private/claire/notes")]).toEqual([3, 0])
    // `ventes/zone` porte Support : son contenu est à Support, pas à Ventes, le dossier du dessus.
    expect([level("paul", "ventes/zone/doc"), level("claire", "ventes/zone/doc")]).toEqual([3, 0])
  })

  it("should give administrators and staff with a current access manage before the rules, except in personal spaces (AC2)", () => {
    const rules: RuleSpec[] = [{ node: "ventes/devis", user: "ada", level: "none" }]
    expect((["ada", "s", "t"] as const).map((who) => level(who, "ventes/devis", rules))).toEqual([3, 3, 3])
    expect((["ada", "s", "t"] as const).map((who) => level(who, "private/claire", rules))).toEqual([0, 0, 0])
    const revoked = identityOf("t", { hasOpenGrant: false })
    expect([level(revoked, "guide", rules), level(revoked, "ventes/devis", rules)]).toEqual([1, 0])
  })

  it("should let the closest rule win on the way up to the root, even lower (AC3)", () => {
    const rules: RuleSpec[] = [
      { node: "ventes", team: "support", level: "read" },
      { node: "ventes/devis", team: "support", level: "none" },
    ]
    expect([level("paul", "ventes", rules), level("paul", "ventes/devis/modele", rules)]).toEqual([1, 0])
  })

  it("should put the person's rule before the teams', and take the highest of the teams (AC4)", () => {
    const inBoth = identityOf("lea", { teams: [teamOf("ventes", "lea"), teamOf("support", "lea")] })
    const teams: RuleSpec[] = [
      { node: "support/faq", team: "ventes", level: "read" },
      { node: "support/faq", team: "support", level: "write" },
    ]
    expect(level(inBoth, "support/faq", teams)).toBe(2)
    const named: RuleSpec[] = [
      { node: "ventes/devis", team: "ventes", level: "write" },
      { node: "ventes/devis", user: "lea", level: "read" },
    ]
    expect(level("lea", "ventes/devis", named)).toBe(1)
  })

  it("should keep the lead of the owner team manager until a rule names her anywhere in the chain (AC5)", () => {
    const rules: RuleSpec[] = [{ node: "ventes/devis", team: "ventes", level: "read" }]
    expect([level("claire", "ventes/devis", rules), level("lea", "ventes/devis", rules)]).toEqual([3, 1])
    // HN-E01S07-16 : la règle qui la nomme sur `ventes` lui retire la gestion de `ventes/devis` ; la
    // règle la plus proche y reste celle de son équipe (1), comme `node_level_for` ; le 0 que l'AC
    // écrit vaut sur `ventes`, où sa règle est la plus proche.
    const named: RuleSpec[] = [...rules, { node: "ventes", user: "claire", level: "none" }]
    expect([level("claire", "ventes/devis", named), level("claire", "ventes", named)]).toEqual([1, 0])
  })

  // Règle de la racine (décidée par JB le 28/10) : elle vaut pour les contenus de l'organisation, une règle du contenu
  // l'emportant ; sous une équipe, elle est ignorée, ni ouverte aux autres, ni baissant ses membres ou son responsable.
  it("should count a rule on the root for the organisation's contents only, never under a team folder (AC6)", () => {
    const root: RuleSpec[] = [
      { node: "guide", org: true, level: "write" },
      { node: "guide", team: "support", level: "none" },
      { node: "guide", team: "ventes", level: "read" },
      { node: "guide", user: "claire", level: "read" },
    ]
    expect((["marc", "paul", "lea", "claire"] as const).map((who) => level(who, "annonces", root))).toEqual([2, 0, 1, 1])
    expect((["marc", "paul", "lea", "claire"] as const).map((who) => level(who, "ventes/devis", root))).toEqual([0, 0, 2, 3])
    expect(level("marc", "annonces", [...root, { node: "annonces", org: true, level: "read" }])).toBe(1)
  })

  it("should count in a personal space only the rules from the node that carries the person down (AC7)", () => {
    const above: RuleSpec[] = [
      { node: "private", user: "ada", level: "manage" },
      { node: "ventes", team: "ventes", level: "write" },
    ]
    expect([level("ada", "private/claire", above), level("claire", "ventes/x", above)]).toEqual([0, 0])
    expect(level("lea", "private/claire/notes", [{ node: "private/claire", user: "lea", level: "read" }])).toBe(1)
  })

  it("should count an organisation rule for every member, after the person's and the teams' rules on the same node (ADR-014)", () => {
    const open: RuleSpec[] = [{ node: "annonces", org: true, level: "write" }]
    expect([level("marc", "annonces", open), level("lea", "annonces", open), level("marc", "annonces")]).toEqual([2, 2, 1])
    const precise: RuleSpec[] = [...open, { node: "annonces", team: "support", level: "read" }, { node: "annonces", user: "marc", level: "none" }]
    expect((["paul", "marc", "lea"] as const).map((who) => level(who, "annonces", precise))).toEqual([1, 0, 2])
  })

  it("should let the closest rule win, an organisation one too, without taking from the owner what it gives (HN-E05S10e-12)", () => {
    const rules: RuleSpec[] = [
      { node: "ventes", team: "support", level: "write" },
      { node: "ventes/devis", org: true, level: "read" },
    ]
    expect((["paul", "lea", "marc"] as const).map((who) => level(who, "ventes/devis", rules))).toEqual([1, 2, 1])
    expect(level("lea", "ventes/devis", [{ node: "ventes/devis", org: true, level: "manage" }])).toBe(3)
  })

  it("should not count an organisation rule in a personal space (ADR-014, HN-E05S10e-13)", () => {
    expect([level("lea", "private/claire/notes", [{ node: "private/claire", org: true, level: "write" }]), level("claire", "private/claire/notes")]).toEqual([0, 3])
    expect(level("marc", "ventes/x/y", [{ node: "ventes/x", org: true, level: "write" }])).toBe(0)
  })

  it("should compute on an incomplete chain with the supplied owner, the residual gap aside (AC11)", () => {
    const ada = callerOf(identityOf("ada"))
    const shared: RuleSpec[] = [{ node: "private/claire/notes", user: "ada", level: "read" }]
    const asAdaReadsIt = chain("private/claire/notes", shared, { hidden: ["private/claire"] })
    expect(nodeLevelOf(ada, { ...asAdaReadsIt, owner: ownerAt("private/claire") })).toBe(1)
    // Sans le propriétaire fourni, la racine le devient : 3, pas moins que le seuil d'une liste.
    expect(nodeLevelOf(ada, asAdaReadsIt)).toBe(3)
    const claire = callerOf(identityOf("claire"))
    const gap: RuleSpec[] = [
      { node: "ventes", user: "claire", level: "none" },
      { node: "ventes/devis", team: "ventes", level: "write" },
    ]
    const asClaireReadsIt = chain("ventes/devis", gap.slice(1), { hidden: ["ventes"], owner: ownerAt("ventes") })
    // HN-E01S07-4 (c) : la règle qui la nomme est sur un ancêtre caché, le cas 1 bis s'applique à tort ; sur la racine,
    // elle ne compterait plus sous l'équipe (règle de la racine, 28/10).
    expect([nodeLevelOf(claire, asClaireReadsIt), nodeLevelOf(claire, chain("ventes/devis", gap))]).toEqual([3, 2])
  })
})

describe("accountLevelOf", () => {
  it("should give each owner's default, the lead's manage until named, and no inheritance from nodes (AC8)", () => {
    // Échelle des comptes : 1 lecture, 2 écriture, 3 sensible, 4 gestion ; un membre va jusqu'aux fonctions sensibles
    // du compte de son équipe (#68 : ce que l'écriture ouvrait avant le niveau sensible).
    expect([accountLevel("lea", "org"), accountLevel("ada", "org")]).toEqual([1, 4])
    expect((["lea", "claire", "paul"] as const).map((who) => accountLevel(who, "ventes"))).toEqual([3, 4, 0])
    expect([accountLevel("ada", "claire"), accountLevel("claire", "claire")]).toEqual([0, 4])
    expect(accountLevel("claire", "ventes", [{ account: "ventes", user: "claire", level: "read" }])).toBe(1)
    expect(accountLevel("paul", "ventes", [{ node: "ventes", team: "support", level: "write" }])).toBe(0)
  })
})

describe("accountLevelOf: sharing a personal account (#68)", () => {
  it("should keep the owner of a personal account at manage before any rule, hers or her team's (decided on 19/10)", () => {
    const rules: RuleSpec[][] = [
      [{ account: "claire", user: "claire", level: "read" }],
      [{ account: "claire", user: "claire", level: "none" }],
      [{ account: "claire", team: "ventes", level: "read" }],
      [
        { account: "claire", team: "ventes", level: "none" },
        { account: "claire", user: "claire", level: "sensitive" },
      ],
    ]
    expect(rules.map((spec) => accountLevel("claire", "claire", spec))).toEqual([4, 4, 4, 4])
    // La règle de son équipe sert les autres membres de Ventes, au niveau qu'elle dit.
    expect(accountLevel("lea", "claire", [{ account: "claire", team: "ventes", level: "read" }])).toBe(1)
  })

  it("should let an organisation rule alone open the owner's account to the others, never lower the owner", () => {
    expect(accountLevel("claire", "claire", [{ account: "claire", org: true, level: "read" }])).toBe(4)
  })

  it("should share with the whole organisation, administrators included, without giving them manage", () => {
    const rules: RuleSpec[] = [{ account: "claire", org: true, level: "write" }]
    expect((["lea", "paul", "marc", "ada"] as const).map((who) => accountLevel(who, "claire", rules))).toEqual([2, 2, 2, 2])
  })

  it("should share with a team, and let a person's or a team's rule win over the organisation's", () => {
    expect((["paul", "lea"] as const).map((who) => accountLevel(who, "claire", [{ account: "claire", team: "support", level: "sensitive" }]))).toEqual([3, 0])
    const precise: RuleSpec[] = [
      { account: "claire", org: true, level: "write" },
      { account: "claire", user: "lea", level: "none" },
      { account: "claire", team: "support", level: "read" },
    ]
    expect((["lea", "paul", "marc"] as const).map((who) => accountLevel(who, "claire", precise))).toEqual([0, 1, 2])
  })

  it("should let an organisation rule raise a team account for the other members, never lower its own team", () => {
    const rules: RuleSpec[] = [{ account: "ventes", org: true, level: "read" }]
    expect((["paul", "lea", "claire"] as const).map((who) => accountLevel(who, "ventes", rules))).toEqual([1, 3, 4])
  })
})

describe("owner change", () => {
  it("should require manage before and after, and keep making personal to administrators (AC9)", () => {
    const claire = callerOf(identityOf("claire"))
    expect(accountOwnerChangeAllowed(claire, account("ventes"), ACCOUNTS.org.owner)).toBe(false)
    expect(accountOwnerChangeAllowed(claire, account("ventes"), ACCOUNTS.claire.owner)).toBe(false)
    // Fiche D18 B (M26) : un nœud, lui, se rend personnel par tout gestionnaire ; la décision des nœuds
    // (`nodeOwnerChangeAllowed`) part avec la garde de M02 (`tests/integration/proprietaires.test.ts`).
    const ada = callerOf(identityOf("ada"))
    const toAda = { kind: "user" as const, teamId: null, userId: PEOPLE.ada.id }
    expect(accountOwnerChangeAllowed(ada, account("org"), toAda)).toBe(true)
  })
})

describe("predicates", () => {
  it("should tell administrators, staff with a current access and team leads (AC10)", () => {
    const [t, revoked, claire] = [identityOf("t"), identityOf("t", { hasOpenGrant: false }), identityOf("claire")]
    expect([isOrgAdmin(t), isOrgAdmin(revoked)]).toEqual([true, false])
    expect([isStaffWithGrant(t), isStaffWithGrant(claire)]).toEqual([true, false])
    expect([leadsTeam(claire, TEAMS.ventes.id), leadsTeam(claire, TEAMS.support.id)]).toEqual([true, false])
  })
})
