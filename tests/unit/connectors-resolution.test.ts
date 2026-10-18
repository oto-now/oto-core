// @vitest-environment node
// Équipe porteuse et compte d'un appel (E04-S01, AC10 à AC16), décidés sur des données en mémoire :
// les lectures (journal du `ctx`, propriétaires, comptes, niveaux) sont couvertes par
// `tests/integration/connectors-resolution.test.ts`. Les refus sont servis au modèle : ils se
// comparent mot pour mot (H04, P14). Sur une base réelle (E01-S10, lot t1-d1), où l'isolation seule
// rend ce que la personne ne lit pas : un tableau, une procédure ou un compte invisible ne décide rien
// (E01-S07 AC23).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import type { AccountLevel } from "../../packages/plateforme/server/access-levels"
import type { ConnectorAccount } from "../../packages/plateforme/server/connectors/accounts"
import { accountRefusal, type RefusalWords } from "../../packages/plateforme/server/connectors/account-refusals"
import {
  chooseAccount,
  chooseTeam,
  lastProcedure,
  resolveAccount,
  runningTeam,
  teamRefusal,
  type AccountChoice,
  type FunctionTraits,
  type TeamChoice,
  type TeamChoiceInput,
  type TeamRef,
} from "../../packages/plateforme/server/connectors/resolution"
import { nodeId, ORG, PEOPLE, referenceTables, TEAMS, type Person } from "../helpers/reference-org"
import { seedReferenceTables, type ReferenceOrgSql } from "../helpers/reference-org-sql"
import type { Row } from "../helpers/simulated-db"
import { recordRequests, type RecordedRequest } from "../helpers/spy-t1-d2a"
import { sqlConfigured, seedWithAdmin, type SeededData, portable } from "../helpers/sql"

const VENTES: TeamRef = { id: "t-ventes", slug: "ventes", name: "Ventes" }
const SUPPORT: TeamRef = { id: "t-support", slug: "support", name: "Support" }
const TERRAIN: TeamRef = { id: "t-terrain", slug: "terrain", name: "Équipe Terrain" }

const CREATE: FunctionTraits = { name: "mail.create_draft", connector: "mail", class: "write", origin: "connecteur" }
const SEND: FunctionTraits = { name: "mail.send_draft", connector: "mail", class: "sensitive", origin: "connecteur" }
const LIST: FunctionTraits = { name: "mail.list_drafts", connector: "mail", class: "read", origin: "connecteur" }
const ROWS: FunctionTraits = { name: "table.rows", connector: "table", class: "read", origin: "paquet" }
const INVOICES: FunctionTraits = { name: "erp.list_invoices", connector: "erp", class: "read", origin: "erp" }

const WORDS: RefusalWords = {
  orgName: "Acme Test",
  administrators: "Ada Martin",
  origin: "https://acme.example.test",
  ask: "team Ventes (lead: Claire Morel)",
}

type Owned = { team?: TeamRef; personal?: boolean; owner?: string; status?: string; ownerLeft?: boolean }

/** L'appelant des cas en mémoire : Ada, à qui n'est pas le compte personnel de Claire. */
const ADA = "u-ada"

function account(id: string, label: string, owned: Owned, level: AccountLevel): ConnectorAccount {
  const status = owned.status ?? "active"
  const owner = owned.team
    ? { kind: "team" as const, teamId: owned.team.id, userId: null, description: `team ${owned.team.name}` }
    : owned.personal
      ? { kind: "user" as const, teamId: null, userId: owned.owner ?? "u-claire", description: "personal" }
      : { kind: "org" as const, teamId: null, userId: null, description: "organisation" }
  return { id, label, connector: "mail", mode: "simule", owner, status, level, ...(owned.ownerLeft ? { ownerLeft: true } : {}) }
}

const MAIL_VENTES = account("a-ventes", "Mail Ventes", { team: VENTES }, 2)
const MAIL_SUPPORT = account("a-support", "Mail Support", { team: SUPPORT }, 2)
const MAIL_ACME = account("a-acme", "Mail Acme", {}, 2)
const MAIL_CLAIRE = account("a-claire", "Mail Claire", { personal: true }, 2)

function teamOf(choice: TeamChoice) {
  if (choice.kind !== "team") throw new Error(`expected a team, got ${choice.kind}`)
  return choice.team
}

function accountOf(choice: AccountChoice) {
  if (choice.kind !== "account") throw new Error(`expected an account, got ${choice.kind}`)
  return choice.account
}

function refusalOf(choice: AccountChoice, words: RefusalWords = WORDS, fn: FunctionTraits = CREATE) {
  if (choice.kind === "account") throw new Error(`expected a refusal, got ${choice.account.label}`)
  return accountRefusal(choice, fn, words)
}

describe("chooseTeam: team argument (AC10, N2)", () => {
  const claire = { fn: CREATE, teams: [VENTES, SUPPORT, TERRAIN] }

  it.each(["support", "Support", " SUPPORT "])("should find a team of the person by slug or name, whatever the case: %j", (argument) => {
    expect(teamOf(chooseTeam({ ...claire, argument }))).toEqual({ ...SUPPORT, source: "argument" })
  })

  it("should match a team name without its accents", () => {
    expect(teamOf(chooseTeam({ ...claire, argument: "equipe terrain" }))).toEqual({ ...TERRAIN, source: "argument" })
  })

  it("should win over the table and the procedure", () => {
    const choice = chooseTeam({ ...claire, argument: "support", tableTeam: VENTES, procedureTeam: VENTES })
    expect(teamOf(choice)?.source).toBe("argument")
  })

  it("should refuse a team the person is not in, listing hers by slug", () => {
    const choice = chooseTeam({ ...claire, teams: [VENTES, SUPPORT], argument: "marketing" })
    if (choice.kind !== "unknown") throw new Error(choice.kind)
    const error = teamRefusal(choice, CREATE.name)
    expect(error.code).toBe("not_found")
    expect(error.message).toBe("Unknown team marketing. Your teams: support (Support), ventes (Ventes).")
  })

  it("should say the person belongs to no team", () => {
    const choice = chooseTeam({ fn: CREATE, teams: [], argument: "marketing" })
    if (choice.kind !== "unknown") throw new Error(choice.kind)
    expect(teamRefusal(choice, CREATE.name).message).toBe("Unknown team marketing. You belong to no team.")
  })

  it("should never pick silently between two teams of the same name (N29)", () => {
    const twin = { id: "t-ventes-2", slug: "ventes_nord", name: "Ventes" }
    const choice = chooseTeam({ ...claire, teams: [VENTES, twin], argument: "VENTES " })
    // Le slug « ventes » l'emporte ; le nom seul ne départage pas deux équipes.
    expect(teamOf(choice)).toEqual({ ...VENTES, source: "argument" })
    const byName = chooseTeam({ ...claire, teams: [{ ...VENTES, slug: "ventes_sud" }, twin], argument: "ventes" })
    if (byName.kind !== "ambiguous") throw new Error(byName.kind)
    expect(teamRefusal(byName, CREATE.name).message).toBe(
      'Several of your teams are named ventes: ventes_nord (Ventes), ventes_sud (Ventes). Show them to the user and ask which one to use; do not pick one yourself. Then call again with team: "<slug>".',
    )
  })

  it("should name 20 of 1,000 teams in a refusal, then count the others (N32)", () => {
    const teams = Array.from({ length: 1000 }, (_, index) => ({ id: `t${index}`, slug: `t${String(index).padStart(4, "0")}`, name: `T${index}` }))
    const unknown = chooseTeam({ fn: CREATE, teams, argument: "marketing" })
    if (unknown.kind !== "unknown") throw new Error(unknown.kind)
    const listed = teams.slice(0, 20).map((team) => `${team.slug} (${team.name})`).join(", ")
    expect(teamRefusal(unknown, CREATE.name).message).toBe(`Unknown team marketing. Your teams: ${listed}, … and 980 more.`)
    const ambiguous = chooseTeam({ fn: CREATE, teams, capable: new Set(teams.map((team) => team.id)) })
    if (ambiguous.kind !== "ambiguous") throw new Error(ambiguous.kind)
    const error = teamRefusal(ambiguous, CREATE.name)
    expect(error.message).toBe(
      `Several of your teams can run mail.create_draft: ${listed}, … and 980 more. Show them to the user and ask which one to use; do not pick one yourself. Then call again with team: "<slug>".`,
    )
    // Les données en champs gardent toutes les équipes : `formatError` ne sert que le texte au modèle.
    expect(error.details?.teams).toHaveLength(1000)
  })
})

describe("chooseTeam: place (AC11, AC12)", () => {
  const claire = { fn: CREATE, teams: [VENTES, SUPPORT], capable: new Set([VENTES.id, SUPPORT.id]) }

  it("should take the team owning the table, over the procedure", () => {
    expect(teamOf(chooseTeam({ ...claire, fn: ROWS, tableTeam: SUPPORT, procedureTeam: VENTES }))).toEqual({ ...SUPPORT, source: "table" })
  })

  it("should take the team owning the last procedure when no table decides, even when two teams have an account", () => {
    expect(teamOf(chooseTeam({ ...claire, tableTeam: null, procedureTeam: SUPPORT }))).toEqual({ ...SUPPORT, source: "procedure" })
  })
})

// E05-S13 (fiche D128) : plus d'équipe par défaut. Sans argument, tableau ni procédure : la seule équipe de la
// personne qui peut porter l'appel, sinon le refus qui demande laquelle, sinon aucune équipe.
describe("chooseTeam: without place, the only team with an account (AC13, N1 ; E05-S13)", () => {
  const base: TeamChoiceInput = { fn: CREATE, teams: [VENTES, SUPPORT] }

  it("(b) should take the only team that can run the call", () => {
    expect(teamOf(chooseTeam({ ...base, capable: new Set([SUPPORT.id]) }))).toEqual({ ...SUPPORT, source: "only_team" })
    expect(teamOf(chooseTeam({ ...base, capable: new Set([VENTES.id]) }))).toEqual({ ...VENTES, source: "only_team" })
  })

  it("(c) should refuse as ambiguous when two teams can, listed by slug", () => {
    const choice = chooseTeam({ ...base, capable: new Set([VENTES.id, SUPPORT.id]) })
    if (choice.kind !== "ambiguous") throw new Error(choice.kind)
    const error = teamRefusal(choice, CREATE.name)
    expect(error.code).toBe("ambiguous_team")
    expect(error.message).toBe(
      'Several of your teams can run mail.create_draft: support (Support), ventes (Ventes). Show them to the user and ask which one to use; do not pick one yourself. Then call again with team: "<slug>".',
    )
    expect(error.details).toEqual({ teams: [{ slug: "support", name: "Support" }, { slug: "ventes", name: "Ventes" }] })
  })

  it("(c) should list only the teams that can", () => {
    const three = { ...base, teams: [VENTES, SUPPORT, TERRAIN], capable: new Set([SUPPORT.id, TERRAIN.id]) }
    const choice = chooseTeam(three)
    expect(choice).toEqual({ kind: "ambiguous", teams: [SUPPORT, TERRAIN] })
  })

  it("(d) should give no team when no team can: the account resolution decides", () => {
    expect(teamOf(chooseTeam({ ...base, capable: new Set() }))).toBeNull()
    expect(teamOf(chooseTeam(base))).toBeNull()
  })

  it("(e) should give no team, never an ambiguity, to a function without account", () => {
    for (const fn of [ROWS, INVOICES]) {
      expect(teamOf(chooseTeam({ ...base, fn, capable: new Set([VENTES.id, SUPPORT.id]) }))).toBeNull()
      expect(teamOf(chooseTeam({ ...base, fn, capable: new Set([VENTES.id]) }))).toBeNull()
    }
  })
})

describe("chooseAccount: order and level (AC14, H83, P37)", () => {
  const all = [MAIL_ACME, MAIL_CLAIRE, MAIL_SUPPORT, MAIL_VENTES]

  it("should take the named account, then the running team's, then the organisation's", () => {
    expect(accountOf(chooseAccount({ caller: ADA, fn: CREATE, accounts: all, team: VENTES, account: "Mail Support" }))).toMatchObject({
      id: "a-support",
      source: "named",
    })
    expect(accountOf(chooseAccount({ caller: ADA, fn: CREATE, accounts: all, team: VENTES }))).toEqual({
      id: "a-ventes",
      label: "Mail Ventes",
      connector: "mail",
      mode: "simule",
      owner: MAIL_VENTES.owner,
      level: "write",
      source: "team",
    })
    expect(accountOf(chooseAccount({ caller: ADA, fn: CREATE, accounts: [MAIL_ACME, MAIL_SUPPORT], team: VENTES }))).toMatchObject({
      id: "a-acme",
      source: "organisation",
    })
  })

  it("should skip a team account where a rule leaves the person read only, for a write or sensitive function", () => {
    const readOnly = account("a-ventes", "Mail Ventes", { team: VENTES }, 1)
    const acme = account("a-acme", "Mail Acme", {}, 3)
    for (const fn of [CREATE, SEND]) {
      expect(accountOf(chooseAccount({ caller: ADA, fn, accounts: [readOnly, acme], team: VENTES })).id).toBe("a-acme")
    }
    expect(accountOf(chooseAccount({ caller: ADA, fn: LIST, accounts: [readOnly, acme], team: VENTES }))).toMatchObject({ id: "a-ventes", level: "read" })
    // Une écriture n'ouvre plus les fonctions sensibles (#68) : le compte de l'organisation partagé en écriture
    // sert la création, pas l'envoi.
    expect(chooseAccount({ caller: ADA, fn: SEND, accounts: [readOnly, MAIL_ACME], team: VENTES })).toMatchObject({ kind: "below_level" })
  })

  it("should never resolve a disabled or failing account, nor a personal one that is not named", () => {
    const off = account("a-ventes", "Mail Ventes", { team: VENTES, status: "disabled" }, 3)
    const broken = account("a-acme", "Mail Acme", { status: "error" }, 3)
    expect(chooseAccount({ caller: ADA, fn: CREATE, accounts: [off, broken, MAIL_CLAIRE], team: VENTES })).toEqual({ kind: "none", team: VENTES, shared: [MAIL_CLAIRE] })
    expect(accountOf(chooseAccount({ caller: ADA, fn: CREATE, accounts: [MAIL_CLAIRE], team: VENTES, account: "a-claire" }))).toMatchObject({
      source: "named",
      level: "write",
    })
  })
})

describe("chooseAccount: named account (AC15, N3)", () => {
  it("should refuse an unknown name without trying another account", () => {
    const choice = chooseAccount({ caller: ADA, fn: CREATE, accounts: [MAIL_VENTES, account("a-ro", "Mail Lecture", {}, 1)], team: VENTES, account: " mail compta " })
    const error = refusalOf(choice)
    expect(error.code).toBe("not_found")
    expect(error.message).toBe(
      "Unknown account « mail compta » for mail. Accounts you can use: « Mail Ventes » (team Ventes, simulated). No other account was tried.",
    )
    expect(refusalOf(chooseAccount({ caller: ADA, fn: CREATE, accounts: [], team: VENTES, account: "x" })).message).toBe(
      "Unknown account « x » for mail. Accounts you can use: none. No other account was tried.",
    )
  })

  it("should refuse a named account below the level of the class, saying whom to ask", () => {
    const error = refusalOf(chooseAccount({ caller: ADA, fn: CREATE, accounts: [account("a-ventes", "Mail Ventes", { team: VENTES }, 1)], team: null, account: "MAIL VENTES" }))
    expect(error.code).toBe("forbidden")
    expect(error.message).toBe(
      "Account « Mail Ventes » cannot run mail.create_draft for you (write access needed). Ask team Ventes (lead: Claire Morel) for access.",
    )
  })

  it("should refuse a disabled named account", () => {
    const off = account("a-ventes", "Mail Ventes", { team: VENTES, status: "disabled" }, 3)
    const error = refusalOf(chooseAccount({ caller: ADA, fn: CREATE, accounts: [off, MAIL_ACME], team: VENTES, account: "Mail Ventes" }))
    expect(error.code).toBe("not_enabled")
    expect(error.message).toBe("Account « Mail Ventes » is disabled. Ask team Ventes (lead: Claire Morel) to enable it, or name another account.")
  })

  it("should refuse a named account in error, asking to fix it (N20)", () => {
    const broken = account("a-ventes", "Mail Ventes", { team: VENTES, status: "error" }, 3)
    const error = refusalOf(chooseAccount({ caller: ADA, fn: CREATE, accounts: [broken, MAIL_ACME], team: VENTES, account: "Mail Ventes" }))
    expect(error.code).toBe("not_enabled")
    expect(error.message).toBe("Account « Mail Ventes » is in error. Ask team Ventes (lead: Claire Morel) to fix it, or name another account.")
  })

  it("should refuse the level before the state of a named account both disabled and below the level (N30)", () => {
    const off = account("a-ventes", "Mail Ventes", { team: VENTES, status: "disabled" }, 1)
    expect(chooseAccount({ caller: ADA, fn: CREATE, accounts: [off], team: VENTES, account: "Mail Ventes" })).toEqual({ kind: "named_below_level", account: off })
  })

  it("should find an account by its id, and refuse two labels that only an accent tells apart", () => {
    expect(accountOf(chooseAccount({ caller: ADA, fn: CREATE, accounts: [MAIL_VENTES], team: null, account: "A-VENTES" })).id).toBe("a-ventes")
    const accented = account("a-accent", "Mail Véntes", {}, 2)
    const error = refusalOf(chooseAccount({ caller: ADA, fn: CREATE, accounts: [MAIL_VENTES, accented], team: VENTES, account: "Mail Ventes" }))
    expect(error.code).toBe("ambiguous_account")
    expect(error.message).toBe(
      'Several mail accounts are named « Mail Ventes »: « Mail Ventes » (team Ventes, id a-ventes), « Mail Véntes » (organisation, id a-accent). Show them to the user and ask which one to use; do not pick one yourself. Then call again with account: "<id>".',
    )
  })
})

describe("chooseAccount: nothing usable (AC16, N5, N6)", () => {
  it("should refuse when no account is visible, with the dashboard link", () => {
    const error = refusalOf(chooseAccount({ caller: ADA, fn: CREATE, accounts: [], team: VENTES }))
    expect(error.code).toBe("not_enabled")
    expect(error.message).toBe(
      "No mail account is connected for you (your own, team Ventes, then the organisation). Ask an administrator of Acme Test (Ada Martin) to connect one on the dashboard: https://acme.example.test/admin/connectors.",
    )
    const alone = refusalOf(chooseAccount({ caller: ADA, fn: CREATE, accounts: [], team: null }))
    expect(alone.message).toContain("(your own, then the organisation). Ask an administrator of Acme Test (Ada Martin)")
  })

  it("should refuse when the visible accounts are all below the level, saying whom to ask", () => {
    const readOnly = account("a-acme", "Mail Acme", {}, 1)
    const error = refusalOf(chooseAccount({ caller: ADA, fn: CREATE, accounts: [readOnly], team: VENTES }), {
      ...WORDS,
      ask: "the administrators of Acme Test (Ada Martin)",
    })
    expect(error.code).toBe("forbidden")
    expect(error.message).toBe(
      "mail.create_draft needs write access to a mail account. Accounts you can see but not use this way: « Mail Acme » (organisation, read for you). Ask the administrators of Acme Test (Ada Martin) for access.",
    )
  })

  it("should never choose silently between two usable accounts of the same step", () => {
    const second = account("a-ventes-2", "Mail Ventes 2", { team: VENTES }, 2)
    const atTeam = refusalOf(chooseAccount({ caller: ADA, fn: CREATE, accounts: [MAIL_VENTES, second, MAIL_ACME], team: VENTES }))
    expect(atTeam.code).toBe("ambiguous_account")
    expect(atTeam.message).toBe(
      'Several mail accounts of team Ventes can run mail.create_draft: « Mail Ventes », « Mail Ventes 2 ». Show them to the user and ask which one to use; do not pick one yourself. Then call again with account: "<label>".',
    )
    const acme2 = account("a-acme-2", "Mail Acme 2", {}, 2)
    expect(refusalOf(chooseAccount({ caller: ADA, fn: CREATE, accounts: [MAIL_ACME, acme2], team: VENTES })).message).toBe(
      'Several mail accounts of the organisation can run mail.create_draft: « Mail Acme », « Mail Acme 2 ». Show them to the user and ask which one to use; do not pick one yourself. Then call again with account: "<label>".',
    )
  })
})

describe("chooseAccount: personal accounts and shares (#68)", () => {
  const MAIL_ADA = account("a-ada", "Mail Ada", { personal: true, owner: ADA }, 4)
  const OWNERS: RefusalWords = { ...WORDS, owners: new Map([["u-claire", "Claire Morel"]]) }

  it("should take the caller's own personal account first, before the team's and the organisation's, unnamed", () => {
    expect(accountOf(chooseAccount({ caller: ADA, fn: SEND, accounts: [MAIL_ACME, MAIL_VENTES, MAIL_ADA], team: VENTES }))).toMatchObject({
      id: "a-ada",
      level: "manage",
      source: "personal",
    })
    // Le sien hors d'usage, l'ordre reprend : l'équipe, puis l'organisation.
    const off = account("a-ada", "Mail Ada", { personal: true, owner: ADA, status: "disabled" }, 4)
    expect(accountOf(chooseAccount({ caller: ADA, fn: CREATE, accounts: [MAIL_ACME, MAIL_VENTES, off], team: VENTES }))).toMatchObject({ source: "team" })
  })

  it("should apply the same order to a consent connector, the personal flag only changing the refusal", () => {
    expect(accountOf(chooseAccount({ caller: ADA, fn: CREATE, accounts: [MAIL_ACME, MAIL_ADA], team: null, personal: true })).id).toBe("a-ada")
    expect(accountOf(chooseAccount({ caller: ADA, fn: CREATE, accounts: [MAIL_ACME], team: null, personal: true })).id).toBe("a-acme")
  })

  it("should never serve another person's personal account unnamed, even shared at the needed level", () => {
    const choice = chooseAccount({ caller: ADA, fn: CREATE, accounts: [MAIL_CLAIRE], team: VENTES })
    expect(choice).toEqual({ kind: "none", team: VENTES, shared: [MAIL_CLAIRE] })
    expect(accountOf(chooseAccount({ caller: ADA, fn: CREATE, accounts: [MAIL_CLAIRE], team: VENTES, account: "Mail Claire" }))).toMatchObject({
      id: "a-claire",
      source: "named",
    })
  })

  it("should name the personal accounts shared with the caller and their owner when no account serves", () => {
    const error = refusalOf(chooseAccount({ caller: ADA, fn: CREATE, accounts: [MAIL_CLAIRE], team: VENTES }), OWNERS)
    expect(error.code).toBe("not_enabled")
    expect(error.message).toBe(
      "No mail account is connected for you (your own, team Ventes, then the organisation). Ask an administrator of Acme Test (Ada Martin) to connect one on the dashboard: https://acme.example.test/admin/connectors." +
        ' Personal accounts shared with you, used only when named: « Mail Claire » (owner Claire Morel, simulated). Show them to the user and ask which one to use; do not pick one yourself. Then call again with account: "<label>".',
    )
    expect(error.details).toEqual({ shared_accounts: [{ id: "a-claire", label: "Mail Claire", owner: "Claire Morel" }] })
    // Sous le niveau partout ailleurs, la même mention suit le refus.
    const readOnly = account("a-acme", "Mail Acme", {}, 1)
    const below = refusalOf(chooseAccount({ caller: ADA, fn: CREATE, accounts: [readOnly, MAIL_CLAIRE], team: null }), OWNERS)
    expect(below.code).toBe("forbidden")
    expect(below.message).toContain("Ask team Ventes (lead: Claire Morel) for access. Personal accounts shared with you, used only when named: « Mail Claire » (owner Claire Morel")
  })

  it("should leave out of the mention a shared account below the level, inactive or whose owner left", () => {
    const readOnly = account("a-claire", "Mail Claire", { personal: true }, 1)
    const left = account("a-paul", "Mail Paul", { personal: true, owner: "u-paul", ownerLeft: true }, 2)
    const off = account("a-zoe", "Mail Zoé", { personal: true, owner: "u-zoe", status: "disabled" }, 2)
    expect(chooseAccount({ caller: ADA, fn: CREATE, accounts: [readOnly, left, off], team: null })).toEqual({ kind: "none", team: null, shared: [] })
    expect(refusalOf(chooseAccount({ caller: ADA, fn: CREATE, accounts: [readOnly, left, off], team: null })).message).not.toContain("Personal accounts")
  })

  it("should refuse a named account whose owner left, saying so, and serve it again once they are back", () => {
    const left = account("a-claire", "Mail Claire", { personal: true, ownerLeft: true }, 2)
    const choice = chooseAccount({ caller: ADA, fn: CREATE, accounts: [left, MAIL_ACME], team: null, account: "Mail Claire" })
    expect(choice).toEqual({ kind: "named_owner_left", account: left })
    const error = refusalOf(choice, OWNERS)
    expect(error.code).toBe("not_enabled")
    expect(error.message).toBe("Account « Mail Claire » no longer serves: its owner has left Acme Test. Name another account.")
    expect(accountOf(chooseAccount({ caller: ADA, fn: CREATE, accounts: [MAIL_CLAIRE], team: null, account: "Mail Claire" })).id).toBe("a-claire")
  })

  it("should ask the caller to connect theirs on a consent connector, naming the shared ones", () => {
    const choice = chooseAccount({ caller: ADA, fn: CREATE, accounts: [MAIL_CLAIRE], team: null, personal: true })
    expect(choice).toEqual({ kind: "connect_needed", account: null, shared: [MAIL_CLAIRE] })
    expect(refusalOf(choice, OWNERS).message).toContain("Personal accounts shared with you, used only when named: « Mail Claire » (owner Claire Morel, simulated).")
    const broken = account("a-ada", "Mail Ada", { personal: true, owner: ADA, status: "error" }, 4)
    expect(chooseAccount({ caller: ADA, fn: CREATE, accounts: [broken, MAIL_CLAIRE], team: null, personal: true })).toEqual({
      kind: "connect_needed",
      account: broken,
      shared: [MAIL_CLAIRE],
    })
  })

  it("should refuse a sensitive function on an account shared in write, and serve it once shared up to sensitive", () => {
    const error = refusalOf(chooseAccount({ caller: ADA, fn: SEND, accounts: [MAIL_CLAIRE], team: null, account: "Mail Claire" }), WORDS, SEND)
    expect(error.code).toBe("forbidden")
    expect(error.message).toBe("Account « Mail Claire » cannot run mail.send_draft for you (sensitive access needed). Ask team Ventes (lead: Claire Morel) for access.")
    const sensitive = account("a-claire", "Mail Claire", { personal: true }, 3)
    expect(accountOf(chooseAccount({ caller: ADA, fn: SEND, accounts: [sensitive], team: null, account: "Mail Claire" }))).toMatchObject({ level: "sensitive" })
    expect(accountOf(chooseAccount({ caller: ADA, fn: CREATE, accounts: [MAIL_CLAIRE], team: null, account: "Mail Claire" }))).toMatchObject({ level: "write" })
  })
})

describe("accountRefusal: lists of 1,000 accounts (N32)", () => {
  const many = (level: AccountLevel, label = (index: number) => `Mail ${String(index).padStart(4, "0")}`) =>
    Array.from({ length: 1000 }, (_, index) => account(`a-${index}`, label(index), {}, level))
  const first20 = (accounts: ConnectorAccount[], render: (item: ConnectorAccount) => string) => accounts.slice(0, 20).map(render).join(", ")

  it("should name 20 usable accounts when the named one is unknown", () => {
    const accounts = many(2)
    const error = refusalOf(chooseAccount({ caller: ADA, fn: CREATE, accounts, team: null, account: "mail compta" }))
    const listed = first20(accounts, (item) => `« ${item.label} » (organisation, simulated)`)
    expect(error.message).toBe(`Unknown account « mail compta » for mail. Accounts you can use: ${listed}, … and 980 more. No other account was tried.`)
  })

  it("should name 20 accounts of the same name, of the same step, or below the level", () => {
    const twins = many(2, () => "Mail Ventes")
    const named = refusalOf(chooseAccount({ caller: ADA, fn: CREATE, accounts: twins, team: null, account: "Mail Ventes" }))
    expect(named.message).toContain(`: ${first20(twins, (item) => `« Mail Ventes » (organisation, id ${item.id})`)}, … and 980 more. Show them`)

    const accounts = many(2)
    const step = refusalOf(chooseAccount({ caller: ADA, fn: CREATE, accounts, team: null }))
    expect(step.message).toContain(`can run mail.create_draft: ${first20(accounts, (item) => `« ${item.label} »`)}, … and 980 more. Show them`)

    const readOnly = many(1)
    const below = refusalOf(chooseAccount({ caller: ADA, fn: CREATE, accounts: readOnly, team: null }))
    expect(below.message).toContain(
      `Accounts you can see but not use this way: ${first20(readOnly, (item) => `« ${item.label} » (organisation, read for you)`)}, … and 980 more. Ask `,
    )
    for (const error of [named, step, below]) expect(error.message.length).toBeLessThan(2000)
  })
})

const CTX = "7K3Q-M2XA"

// Sur la base réelle (E01-S10, lot t1-d1) : O de la fixture de référence, ses comptes simulés et actifs ;
// chaque cas écrit ses lignes de journal (le journal d'O vidé avant lui) et ses nœuds, à des chemins à lui.
describe.skipIf(!sqlConfigured)(portable("resolution reads on a real database (N22, E01-S07 AC23)"), { timeout: 60_000 }, () => {
  let seed: SeededData
  let ref: ReferenceOrgSql

  beforeAll(async () => {
    seed = seedWithAdmin()
    const tables = referenceTables()
    for (const row of tables.accounts) Object.assign(row, { mode: "simule", status: "active" })
    ref = await seedReferenceTables(seed, tables)
  }, 180_000)

  afterAll(async () => {
    await seed?.cleanup()
  }, 180_000)

  beforeEach(async () => {
    await seed.admin`delete from platform.journal where org_id = ${ref.org.id}`
  })

  /** Une ligne réussie du journal de `person` sous `CTX`, la plus récente pour `rank` 0. */
  function journalLine(person: Person, target: string | null, rank: number): Row {
    const ts = new Date(Date.parse("2026-09-24T12:00:00.000Z") - rank * 1000).toISOString()
    return { org_id: ORG.id, user_id: PEOPLE[person].id, ctx: CTX, tool: `${ref.org.prefix}_context`, is_error: false, target, ts }
  }

  /** Un nœud publié de O, propriétaire hérité. */
  function placeNode(path: string, kind: string): Row {
    return { id: nodeId(path), org_id: ORG.id, path, kind, owner_kind: null, owner_team_id: null, owner_user_id: null }
  }

  /** Les listes de chemins envoyées à la lecture des procédures (celle qui filtre sur `kind`) : la liste liée (lot d1). */
  const procedurePaths = (requests: readonly RecordedRequest[]) =>
    requests.flatMap((request) => (request.objects.includes("nodes") && /\bkind = 'procedure'/.test(request.text) ? request.values.filter(Array.isArray) : []))

  describe("lastProcedure: the paths sent to the list read (N22)", () => {
    /**
     * Ces lignes de Claire sous `CTX`, la plus récente d'abord, et ces procédures ; le client de Claire,
     * espionné. Titre et résumé courts : le schéma les borne à 200 caractères (`nodes_title_check`), que
     * le titre et le résumé tirés d'un chemin de 1 000 caractères dépasseraient.
     */
    async function journalDb(targets: (string | null)[], procedures: string[]) {
      await ref.write({
        journal: targets.map((target, rank) => journalLine("claire", target, rank)),
        nodes: procedures.map((path) => ({ ...placeNode(path, "procedure"), title: "Relance", summary: "Relancer un devis." })),
      })
      return recordRequests(await ref.db("claire"))
    }

    it("should send every recent path when they fit, the most recent first, phrases left out", async () => {
      const paths = Array.from({ length: 49 }, (_, index) => `ventes/page_${index}`)
      const { db, requests } = await journalDb([...paths, "Relance les devis en attente"], ["ventes/page_3", "ventes/page_7"])
      expect(ref.readable(await lastProcedure(db, ref.identityOf("claire"), ref.id(CTX)))).toEqual({ id: nodeId("ventes/page_3"), path: "ventes/page_3" })
      expect(procedurePaths(requests)).toEqual([paths])
    })
  })

  describe("places and accounts the person cannot read decide nothing (E01-S07 AC23)", () => {
    it("should let neither a table nor a procedure that the person cannot read choose the running team", async () => {
      await ref.write({
        nodes: [placeNode("support/suivi", "table"), placeNode("support/reponse", "procedure"), placeNode("ventes/relance", "procedure")],
        journal: [journalLine("lea", "support/reponse", 0), journalLine("lea", "ventes/relance", 1)],
      })
      // Propriétaire effectif du tableau de Support, porté par `support` (`node_owner`), lu par Paul seul ici.
      const lea = ref.identityOf("lea")
      // Léa ne lit pas le tableau de Support : sa seule équipe qui a un compte porte l'appel (E05-S13) ; Paul le
      // lit, le tableau décide.
      expect(await runningTeam(await ref.db("lea"), lea, { fn: CREATE, tablePath: "support/suivi", ctxCode: null })).toMatchObject({
        slug: "ventes",
        source: "only_team",
      })
      expect(await runningTeam(await ref.db("paul"), ref.identityOf("paul"), { fn: CREATE, tablePath: "support/suivi", ctxCode: null })).toMatchObject({
        slug: "support",
        source: "table",
      })
      // La procédure de Support, la plus récente, lui est invisible : celle de Ventes décide.
      expect(ref.readable(await lastProcedure(await ref.db("lea"), lea, ref.id(CTX)))).toEqual({ id: nodeId("ventes/relance"), path: "ventes/relance" })
    })

    it("should let only the person's successful context and read lines under the code, toward a procedure, choose it (N11)", async () => {
      // Les plus récentes d'abord, chacune écartée par une seule condition de la lecture : une page, un échec,
      // une écriture, un autre code, une ligne de Claire. La base les rend toutes à Léa (l'isolation seule) ;
      // seule la dernière décide (E01-S10, lot d1).
      const lea = (target: string, rank: number, line: Row = {}): Row => ({ ...journalLine("lea", target, rank), ...line })
      const procedures = ["ventes/n11_echec", "ventes/n11_ecrit", "ventes/n11_autre", "ventes/n11_claire", "ventes/n11_retenue"]
      await ref.write({
        nodes: [placeNode("ventes/n11_page", "page"), ...procedures.map((path) => placeNode(path, "procedure"))],
        journal: [
          lea("ventes/n11_page", 0, { tool: `${ref.org.prefix}_read` }),
          lea("ventes/n11_echec", 1, { is_error: true }),
          lea("ventes/n11_ecrit", 2, { tool: `${ref.org.prefix}_write` }),
          lea("ventes/n11_autre", 3, { ctx: "8M4R-N3YB" }),
          journalLine("claire", "ventes/n11_claire", 4),
          lea("ventes/n11_retenue", 5, { tool: `${ref.org.prefix}_read` }),
        ],
      })
      expect(ref.readable(await lastProcedure(await ref.db("lea"), ref.identityOf("lea"), ref.id(CTX)))).toEqual({
        id: nodeId("ventes/n11_retenue"),
        path: "ventes/n11_retenue",
      })
    })

    it("should neither retain nor name an account the person cannot see", async () => {
      // Paul (Support) nomme « Mail Claire », compte personnel qu'il ne voit pas : inconnu, jamais
      // « cannot run … for you », qui le nommerait ; « Mail Org », lisible seulement, n'est pas utilisable.
      const support: TeamRef = { id: ref.id(TEAMS.support.id), slug: "support", name: "Support" }
      await expect(
        resolveAccount(await ref.db("paul"), ref.identityOf("paul"), { fn: CREATE, team: support, account: "Mail Claire", origin: "https://acme.test" }),
      ).rejects.toMatchObject({
        code: "not_found",
        message: "Unknown account « Mail Claire » for mail. Accounts you can use: none. No other account was tried.",
      })
    })
  })
})
