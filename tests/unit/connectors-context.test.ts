// @vitest-environment node
// Ce que `context` et `tools/list` disent des connecteurs (E04-S01, AC4, AC21, AC22), sur des
// données en mémoire : ligne des connecteurs par connecteur actif, activation qui masque les
// fonctions, exemples de la description de `call` ; les faits d'équipe d'une personne sans équipe, sur
// une base réelle (E01-S10, lot t1-d1 ; E05-S12 : `teamFacts`). Le texte servi par le MCP est couvert par
// `tests/integration/mcp-connectors.test.ts`.
import * as z from "zod/v4"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { defineFunction, type CatalogFunction, type FunctionClass } from "../../packages/plateforme/server/catalog/define"
import { callExamples, catalogFunctions, isActive } from "../../packages/plateforme/server/catalog/registry"
import type { ConnectorAccount } from "../../packages/plateforme/server/connectors/accounts"
import { connectorLines, connectorOutlook, type ConnectorOutlook } from "../../packages/plateforme/server/connectors/lines"
import type { TeamRef } from "../../packages/plateforme/server/connectors/resolution"
import { teamFacts } from "../../packages/plateforme/server/context/blocks/team"
import { ORG, TEAMS } from "../helpers/reference-org"
import { seedReferenceOrg, type ReferenceOrgSql } from "../helpers/reference-org-sql"
import type { Row } from "../helpers/simulated-db"
import { namesOf, sqlConfigured, recordDb, seedWithAdmin, type SeededData, portable } from "../helpers/sql"

const VENTES: TeamRef = { id: "t-ventes", slug: "ventes", name: "Ventes" }
const SUPPORT: TeamRef = { id: "t-support", slug: "support", name: "Support" }
const CONSEIL: TeamRef = { id: "t-conseil", slug: "conseil", name: "Conseil" }

const ok = async () => ({ text: "ok" })

function fn(name: string, fnClass: FunctionClass, origin: CatalogFunction["origin"] = "connecteur"): CatalogFunction {
  const [connector] = name.split(".")
  return defineFunction({ name, connector, class: fnClass, origin, description: "Test.", schema: z.strictObject({}), examples: [], refusals: [], run: ok })
}

function teamAccount(label: string, team: TeamRef, level: 1 | 2 | 3, mode: ConnectorAccount["mode"] = "simule"): ConnectorAccount {
  return {
    id: `a-${label}`,
    label,
    connector: label.split(" ")[0].toLowerCase(),
    mode,
    owner: { kind: "team", teamId: team.id, userId: null, description: `team ${team.name}` },
    status: "active",
    level,
  }
}

const MAIL = catalogFunctions().filter((candidate) => candidate.connector === "mail")
const X = [fn("x.read", "read"), fn("x.write", "write")]

describe("connectorLines (AC21, N8)", () => {
  const claire: ConnectorOutlook = {
    connector: "mail",
    write: { kind: "account", team: VENTES, account: { label: "Mail Ventes", mode: "simule", level: "write" } },
  }

  it("should say the team, what the person can do, the account and its mode", () => {
    expect(connectorLines([claire])).toEqual(["mail: team Ventes (write), account « Mail Ventes » (simulated)"])
  })

  it("should say read at level 1 and write beyond, and name the sandbox and live modes", () => {
    const outcome = (mode: "sandbox" | "reel", level: "read" | "manage") => ({
      kind: "account" as const,
      team: VENTES,
      account: { label: "Mail Ventes", mode, level },
    })
    expect(connectorLines([{ connector: "mail", read: outcome("sandbox", "read") }])).toEqual([
      "mail: team Ventes (read), account « Mail Ventes » (sandbox)",
    ])
    expect(connectorLines([{ connector: "mail", write: outcome("reel", "manage") }])).toEqual([
      "mail: team Ventes (write), account « Mail Ventes » (live)",
    ])
  })

  it("should say when no account can be used", () => {
    expect(connectorLines([{ connector: "mail", write: { kind: "no_account", team: VENTES } }])).toEqual([
      "mail: no account you can use (team Ventes): calls will be refused until an administrator connects one.",
    ])
  })

  it("should name the accounts the person can only read, and say that write access is missing (N39)", () => {
    const readOnly = { kind: "read_only" as const, team: VENTES, labels: ["Mail Ventes", "Mail Acme"] }
    expect(connectorLines([{ connector: "mail", write: readOnly }])).toEqual([
      "mail: no account you can use (team Ventes): calls will be refused until you are given write access; you can only read « Mail Ventes », « Mail Acme ».",
    ])
    const read = { kind: "account" as const, team: CONSEIL, account: { label: "X Conseil", mode: "simule" as const, level: "read" as const } }
    expect(connectorLines([{ connector: "x", read, write: readOnly }])).toEqual([
      "x: read with team Conseil, account « X Conseil » (simulated); write: read access only (team Ventes)",
    ])
  })

  it("should say the account of a person without running team (N21)", () => {
    const outcome = { kind: "account" as const, team: null, account: { label: "Mail Acme", mode: "simule" as const, level: "manage" as const } }
    expect(connectorLines([{ connector: "mail", write: outcome }])).toEqual(["mail: no team (write), account « Mail Acme » (simulated)"])
    expect(connectorLines([{ connector: "mail", write: { kind: "no_account", team: null } }])).toEqual([
      "mail: no account you can use: calls will be refused until an administrator connects one.",
    ])
  })

  it("should ask the user which account when several can run the calls, at the team or organisation step (N21, N31)", () => {
    expect(connectorLines([{ connector: "mail", write: { kind: "several_accounts", team: VENTES, labels: ["Mail Ventes", "Mail Ventes 2"] } }])).toEqual([
      "mail: team Ventes, several accounts; ask the user which one and pass account in the call: « Mail Ventes », « Mail Ventes 2 ».",
    ])
    expect(connectorLines([{ connector: "mail", write: { kind: "several_accounts", team: null, labels: ["Mail Acme", "Mail Acme 2"] } }])).toEqual([
      "mail: several organisation accounts; ask the user which one and pass account in the call: « Mail Acme », « Mail Acme 2 ».",
    ])
  })

  it("should write each half of a two-part line, a refusal on one side included (N21)", () => {
    const read = { kind: "account" as const, team: CONSEIL, account: { label: "X Conseil", mode: "simule" as const, level: "read" as const } }
    expect(connectorLines([{ connector: "x", read, write: { kind: "no_account", team: VENTES } }])).toEqual([
      "x: read with team Conseil, account « X Conseil » (simulated); write: no account you can use (team Ventes)",
    ])
    expect(connectorLines([{ connector: "x", read, write: { kind: "several_accounts", team: VENTES, labels: ["X Ventes", "X Ventes 2"] } }])).toEqual([
      "x: read with team Conseil, account « X Conseil » (simulated); write: several accounts (« X Ventes », « X Ventes 2 »)",
    ])
  })

  it("should write one line in two parts when reading and writing differ", () => {
    const x: ConnectorOutlook = {
      connector: "x",
      read: { kind: "account", team: CONSEIL, account: { label: "X Conseil", mode: "simule", level: "read" } },
      write: { kind: "account", team: VENTES, account: { label: "X Ventes", mode: "simule", level: "write" } },
    }
    expect(connectorLines([x])).toEqual([
      "x: read with team Conseil, account « X Conseil » (simulated); write with team Ventes, account « X Ventes » (simulated)",
    ])
  })

  it("should write no line for a connector without function, and keep a line under 200 characters", () => {
    expect(connectorLines([{ connector: "mail" }])).toEqual([])
    const label = "L".repeat(80)
    const long: ConnectorOutlook = {
      connector: `c${"o".repeat(39)}`,
      read: { kind: "account", team: CONSEIL, account: { label, mode: "simule", level: "read" } },
      write: { kind: "account", team: VENTES, account: { label: `${label}2`, mode: "simule", level: "write" } },
    }
    const [line] = connectorLines([long])
    expect(line.length).toBeLessThanOrEqual(200)
    expect(line).toContain(`« ${"L".repeat(39)}… »`)
    expect(line.endsWith("…")).toBe(true)
  })
})

// E05-S13 (fiche D128) : ce qu'obtient un appel que porte une équipe donnée (la partie de chaque équipe qui a
// un compte), ou aucune (la partie de Tout le monde) ; plus d'équipe par défaut.
describe("connectorOutlook (AC21 with AC13 and AC16)", () => {
  it("should resolve the account of the team that runs the calls, for the write functions of mail", () => {
    const accounts = [teamAccount("Mail Ventes", VENTES, 3), teamAccount("Mail Support", SUPPORT, 3)]
    expect(connectorLines([connectorOutlook({ connector: "mail", functions: MAIL, accounts, team: VENTES })])).toEqual([
      "mail: team Ventes (write), account « Mail Ventes » (simulated)",
    ])
    expect(connectorLines([connectorOutlook({ connector: "mail", functions: MAIL, accounts, team: SUPPORT })])).toEqual([
      "mail: team Support (write), account « Mail Support » (simulated)",
    ])
  })

  it("should say read only, not no account, when the only account is read only for the person (N39)", () => {
    const outlook = connectorOutlook({ connector: "mail", functions: MAIL, accounts: [teamAccount("Mail Ventes", VENTES, 1)], team: VENTES })
    expect(outlook.write).toEqual({ kind: "read_only", team: VENTES, labels: ["Mail Ventes"] })
  })

  it("should give the organisation's step to calls that no team runs", () => {
    const outlook = connectorOutlook({ connector: "mail", functions: MAIL, accounts: [teamAccount("Mail Ventes", VENTES, 3)], team: null })
    expect(outlook.write).toEqual({ kind: "no_account", team: null })
  })

  it("should read with the team's account and write with the organisation's when the team's only reads", () => {
    const acme: ConnectorAccount = { ...teamAccount("X Acme", CONSEIL, 2), owner: { kind: "org", teamId: null, userId: null, description: "organisation" } }
    const outlook = connectorOutlook({ connector: "x", functions: X, accounts: [teamAccount("X Conseil", CONSEIL, 1), acme], team: CONSEIL })
    expect(connectorLines([outlook])).toEqual([
      "x: read with team Conseil, account « X Conseil » (simulated); write with team Conseil, account « X Acme » (simulated)",
    ])
  })
})

describe("activation hides the functions (AC4, AC22)", () => {
  const none: ReadonlySet<string> = new Set()
  const mail: ReadonlySet<string> = new Set(["mail"])

  it("should hide mail.create_draft and mail.send_draft until mail is active, never native or ERP functions", () => {
    for (const name of ["mail.create_draft", "mail.send_draft"]) {
      const found = MAIL.find((candidate) => candidate.name === name)
      if (!found) throw new Error(`${name} missing from the catalog`)
      expect(isActive(found, none), name).toBe(false)
      expect(isActive(found, mail), name).toBe(true)
    }
    expect(isActive(fn("table.rows", "read", "paquet"), none)).toBe(true)
    expect(isActive(fn("erp.list_invoices", "read", "erp"), none)).toBe(true)
    // Les fonctions natives des tableaux (E07-S01), celles qui suppriment (E11-S02, HN-E11S02-1) et le dépôt par lien
    // (E10-S02 lot f) sont toujours actives.
    const native = ["table.schema", "table.rows", "table.aggregate", "table.write", "table.claim", "table.release", "table.import", "table.delete_rows", "node.discard_draft", "node.trash", "node.move", "node.write_many", "node.export_tree", "node.import_tree", "upload.link"]
    expect(catalogFunctions().filter((candidate) => isActive(candidate, none)).map((candidate) => candidate.name)).toEqual(native)
    expect(catalogFunctions().filter((candidate) => isActive(candidate, mail)).map((candidate) => candidate.name)).toEqual([
      "mail.create_draft",
      "mail.send_draft",
      ...native,
    ])
  })

  it("should cite mail.create_draft in the examples of call when mail is active, never mail.send_draft", () => {
    expect(callExamples(catalogFunctions(), mail)).toEqual(["mail.create_draft", "table.rows"])
    expect(callExamples(catalogFunctions(), none)).toEqual(["table.rows"])
  })
})

// Sur la base réelle (E01-S10, lot t1-d1) : O de la fixture de référence, dont Ada administre sans
// équipe ; chaque cas pose les comptes d'O et l'activation de `mail` qu'il lit. Ada gère chaque compte
// d'organisation ou d'équipe (aucune règle ici).
describe.skipIf(!sqlConfigured)(portable("teamFacts without team (N17, bench E04 F5)"), { timeout: 60_000 }, () => {
  const HEADER = "Connectors (when no team of yours runs the call):"
  let seed: SeededData
  let ref: ReferenceOrgSql

  beforeAll(async () => {
    seed = seedWithAdmin()
    ref = await seedReferenceOrg(seed)
  }, 180_000)

  afterAll(async () => {
    await seed?.cleanup()
  }, 180_000)

  function accountRow(id: string, label: string, team?: keyof typeof TEAMS): Row {
    const owner = team ? { owner_kind: "team", owner_team_id: TEAMS[team].id } : { owner_kind: "org", owner_team_id: null }
    return { id, org_id: ORG.id, label, connector: "mail", mode: "simule", status: "active", ...owner, owner_user_id: null }
  }

  /** Les comptes d'O et l'activation de `mail` du cas, puis le client d'Ada, espionné. */
  async function given(active: boolean, accounts: Row[]) {
    await seed.admin`delete from platform.connector_activations where org_id = ${ref.org.id}`
    await seed.admin`delete from platform.accounts where org_id = ${ref.org.id}`
    await ref.write({ accounts, connector_activations: active ? [{ org_id: ORG.id, connector: "mail", state: "active" }] : [] })
    return recordDb(await ref.db("ada"))
  }

  it("should give no team line, then the account a person without team would use and its mode", async () => {
    const { db } = await given(true, [accountRow("account:mail-acme", "Mail Acme"), accountRow("account:mail-ventes", "Mail Ventes", "ventes")])
    expect(await teamFacts(db, ref.identityOf("ada"))).toEqual({
      teams: [],
      teamConnectors: [],
      connectors: [HEADER, "mail: no team (write), account « Mail Acme » (simulated)"],
    })
  })

  it("should say that no account can be used without an organisation account", async () => {
    const { db } = await given(true, [accountRow("account:mail-ventes", "Mail Ventes", "ventes")])
    expect((await teamFacts(db, ref.identityOf("ada"))).connectors).toEqual([
      HEADER,
      "mail: no account you can use: calls will be refused until an administrator connects one.",
    ])
  })

  it("should give no line at all, reading only the activations, when no connector is active", async () => {
    const { db, requests } = await given(false, [])
    expect(await teamFacts(db, ref.identityOf("ada"))).toEqual({ teams: [], teamConnectors: [], connectors: [] })
    expect(requests.flatMap(namesOf)).toEqual(["connector_activations"])
  })
})
