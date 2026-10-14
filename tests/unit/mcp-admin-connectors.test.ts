// @vitest-environment node
// `admin_connector` par InMemoryTransport sur une vraie base (E08-S06, AC7 à AC13 ; E01-S10, lot t1-d2a) :
// catalogue, activation et désactivation d'E04-S01 et d'E08-S03, comptes par libellé, règles d'un compte
// (`server/rules.ts`) ; les refus des services rendus tels quels, et ceux que le service décide avant
// toute écriture (`security-patterns.md § Droits dans le service`). La base des tests admin avec l'arbre
// d'acme (`seedAdminFixture`) et les lignes de `connectorTables` sont semées une fois pour le fichier ; ce
// qu'un test y change, il le défait après lui, même en échec (`undo`). La RLS n'isole que les
// organisations : le compte personnel de Claire, invisible pour l'équipe plateforme, revient à chaque
// lecture, et le service l'écarte. En suite portable (`sqlConfigured`) : le projet, ou le Postgres nu du job `bare-postgres`.
import * as z from "zod/v4"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { resolveAdminOrg } from "../../packages/plateforme/server/admin/context"
import { defineErpFunction, registerFunctions } from "../../packages/plateforme/server/catalog/erp"
import { catalogFunctions } from "../../packages/plateforme/server/catalog/registry"
import { listAccountRules } from "../../packages/plateforme/server/rules"
import { adminTree, codes, connectAdminMcp, NODES, ORGS, PERSONS, TEAMS, type AdminPerson } from "../helpers/mcp-admin"
import { seedAdminFixture, type AdminFixtureSql } from "../helpers/mcp-admin-sql"
import type { Row, Tables } from "../helpers/simulated-db"
import { isoInstants, sqlConfigured, seedWithAdmin, type SeededData, portable } from "../helpers/sql"
import { recordRequests, requestedWrites, undoAll, type RecordedRequest } from "../helpers/spy-t1-d2a"

const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 180_000

const ACTIVATED_AT = "2026-09-24T10:00:00.000Z"
const DEFAULTS = "Without a rule, members read an organisation account, its team writes a team account, its owner manages a personal one."
const NOTHING = (verb: string) => `Nothing was ${verb}. Show this to the user and ask for explicit approval, then call again with confirm: true.`

const accountId = (n: number) => `c1000000-0000-4000-8000-00000000000${n}`

function account(n: number, label: string, owner: Row, status = "active"): Row {
  const columns = { owner_kind: "org", owner_team_id: null, owner_user_id: null, ...owner }
  return { id: accountId(n), org_id: ORGS.acme.id, connector: "mail", label, mode: "simule", status, ...columns }
}

function accountRule(n: number, subject: Row, level: string): Row {
  const columns = { subject_team_id: null, subject_user_id: null, ...subject }
  return { id: `f1000000-0000-4000-8000-00000000000${n}`, org_id: ORGS.acme.id, node_id: null, account_id: accountId(1), ...columns, level }
}

/**
 * `mail` actif chez acme ; quatre comptes, dont le compte personnel de Claire (invisible pour l'équipe
 * plateforme, H61) et un compte désactivé ; la procédure publiée `ventes/relance` appelle `mail` dans un
 * bloc publié (son brouillon ne compte pas) ; sur « Mail Ventes », Support et Marc en lecture.
 */
function connectorTables(tables: Tables): void {
  adminTree(tables)
  tables.connector_activations = [{ org_id: ORGS.acme.id, connector: "mail", state: "active", activated_by: PERSONS.ada.id, updated_at: ACTIVATED_AT }]
  tables.accounts = [
    account(1, "Mail Ventes", { owner_kind: "team", owner_team_id: TEAMS.ventes.id }),
    account(2, "Mail Acme", {}),
    account(3, "Mail Direction", { owner_kind: "user", owner_user_id: PERSONS.claire.id }),
    account(4, "Mail Ancien", {}, "disabled"),
  ]
  const call = (n: number, state: string, fn: string) => ({ id: `b1000000-0000-4000-8000-00000000000${n}`, org_id: ORGS.acme.id, node_id: NODES["ventes/relance"], state, type: "call", data: { function: fn, args: {} } })
  tables.blocks = [call(1, "published", "mail.send_draft"), call(2, "draft", "mail.create_draft")]
  tables.access_rules.push(accountRule(1, { subject_team_id: TEAMS.support.id }, "read"), accountRule(2, { subject_user_id: PERSONS.marc.id }, "read"))
}

/** Dix procédures publiées de plus sous support, dont un bloc publié appelle `mail` : avec ventes/relance, onze. */
function tenMoreProcedures(tables: Tables): void {
  const relance = tables.nodes.find((row) => row.id === NODES["ventes/relance"])
  for (let index = 0; index < 10; index++) {
    const n = String(index).padStart(2, "0")
    const node = { ...relance, id: `e2000000-0000-4000-8000-0000000000${n}`, path: `support/proc_${n}`, parent_id: NODES.support }
    tables.nodes.push(node)
    const data = { function: "mail.create_draft", args: {} }
    tables.blocks.push({ id: `b2000000-0000-4000-8000-0000000000${n}`, org_id: ORGS.acme.id, node_id: node.id, state: "published", type: "call", data })
  }
}

/** Chaque bloc à une place : la base l'exige hors des lignes de tableau (`blocks_position_check`), la base simulée ne la pose pas. */
function placed(blocks: Row[]): Row[] {
  return blocks.map((block, index) => ({ position: index + 1, ...block }))
}

/** Les lignes que `connectorTables` ajoute à l'arbre d'acme : activation, comptes, blocs d'appel, règles des comptes. */
function connectorRows(): Tables {
  const tables: Tables = { access_rules: [] }
  connectorTables(tables)
  return { connector_activations: tables.connector_activations, accounts: tables.accounts, blocks: placed(tables.blocks), access_rules: tables.access_rules }
}

/**
 * La lecture des règles d'un compte (`listAccountRules`) : `access_rules` par égalité sur `account_id`
 * (`account_id = ?`), à part celle des faits de la décision (une liste de comptes, `access.ts`).
 */
const ruleListings = (requests: readonly RecordedRequest[]) =>
  requests.filter((request) => request.objects.includes("access_rules") && /\baccount_id\s*=\s*\?/.test(request.text))

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  registerFunctions([])
})

describe.skipIf(!sqlConfigured)(portable("admin_connector of the admin MCP (E08-S06)"), { timeout: NETWORK_TIMEOUT }, () => {
  let seed: SeededData
  let admin: AdminFixtureSql
  /** Ce que le test en cours a changé dans la graine, défait après lui dans l'ordre inverse, même en échec. */
  const undo: (() => Promise<unknown>)[] = []

  beforeAll(async () => {
    seed = seedWithAdmin()
    admin = await seedAdminFixture(seed, { tree: true })
    await admin.write(connectorRows())
  }, SETUP_TIMEOUT)

  afterEach(() => undoAll(undo), SETUP_TIMEOUT)

  afterAll(async () => {
    try {
      await admin?.forgetJournal()
    } finally {
      await seed?.cleanup()
    }
  }, SETUP_TIMEOUT)

  /** Le MCP admin de `caller` sur la graine, espionné, sa session ouverte, et `admin_connector` sur acme. */
  async function session(caller: AdminPerson = "sam") {
    const deps = await admin.deps(caller)
    const spy = recordRequests(deps.db)
    const mcp = await connectAdminMcp({ ...deps, db: spy.db })
    const { code } = await mcp.openAdmin()
    const connector = (args: Record<string, unknown>) => mcp.call("admin_connector", { ctx: code, org: admin.orgs.acme.slug, ...args })
    return { spy, journal: deps.journal, connector }
  }

  /** L'activation de `mail` de la graine (par Ada, à `ACTIVATED_AT`), remise après le test : réécrite, puisqu'une mise à jour y poserait l'heure (`set_updated_at`). */
  function restoreActivation(): void {
    undo.push(async () => {
      await seed.admin`delete from platform.connector_activations where org_id = ${admin.orgs.acme.id}`
      await admin.write({ connector_activations: connectorRows().connector_activations })
    })
  }

  async function withoutActivation(): Promise<void> {
    restoreActivation()
    await seed.admin`delete from platform.connector_activations where org_id = ${admin.orgs.acme.id}`
  }

  async function activations() {
    return admin.readable([...(await seed.admin`select connector, state, activated_by from platform.connector_activations where org_id = ${admin.orgs.acme.id}`)])
  }

  /** Le statut d'un compte de la graine, dans la base. */
  async function statusOf(simulated: string): Promise<string | undefined> {
    const [row] = await seed.admin<{ status: string }[]>`select status from platform.accounts where id = ${admin.id(simulated)}`
    return row?.status
  }

  /** Les règles de « Mail Ventes » dans la base, `[sujet, niveau]` en identifiants simulés, triées. */
  async function ventesRules(): Promise<string[][]> {
    const rows = await seed.admin`select subject_team_id, subject_user_id, level from platform.access_rules where account_id = ${admin.id(accountId(1))}`
    return admin
      .readable([...rows])
      .map((rule) => [String(rule.subject_team_id ?? rule.subject_user_id), String(rule.level)])
      .sort()
  }

  /** Les règles de « Mail Ventes » de la graine, remises après le test. */
  function restoreVentesRules(): void {
    undo.push(async () => {
      await seed.admin`delete from platform.access_rules where account_id = ${admin.id(accountId(1))}`
      await admin.write({ access_rules: connectorRows().access_rules })
    })
  }

  describe("admin_connector catalogue (AC7)", () => {
    it("should list each activable connector with its state and functions, then the functions that are always active", async () => {
      registerFunctions([
        defineErpFunction({ name: "erp.lookup_customer", class: "read", description: "Reads a customer.", schema: z.strictObject({ code: z.string() }), examples: [{ code: "C-1" }], run: async () => ({ text: "ok" }) }),
      ])
      const { connector } = await session()
      const listed = await connector({ op: "catalogue" })
      // Trois connecteurs natifs : `table`, `node` (E11-S02, AC-h1 : abandon d'un brouillon, corbeille) et `upload`
      // (E10-S02 lot f, ADR-018 : le dépôt par lien).
      const native = catalogFunctions().filter((fn) => fn.origin === "paquet" && fn.connector === "table")
      const nodes = catalogFunctions().filter((fn) => fn.origin === "paquet" && fn.connector === "node")
      const uploads = catalogFunctions().filter((fn) => fn.origin === "paquet" && fn.connector === "upload")
      expect(nodes.map((fn) => `${fn.name} (${fn.class})`)).toEqual(["node.discard_draft (sensitive)", "node.trash (sensitive)", "node.move (write)", "node.write_many (write)", "node.export_tree (read)", "node.import_tree (write)", "node.tree (read)", "node.check (read)"])
      expect(uploads.map((fn) => `${fn.name} (${fn.class})`)).toEqual(["upload.link (write)"])
      expect(listed.text).toBe(
        [
          "- mail (simulated): active since 2026-09-24 by Ada Martin — mail.create_draft (write), mail.send_draft (sensitive)",
          `- table (built in): always active — ${native.map((fn) => `${fn.name} (${fn.class})`).join(", ")}`,
          `- node (built in): always active — ${nodes.map((fn) => `${fn.name} (${fn.class})`).join(", ")}`,
          "- upload (built in): always active — upload.link (write)",
          "- application functions: always active — erp.lookup_customer (read)",
        ].join("\n"),
      )
      expect(isoInstants(listed.structured?.connectors)).toEqual([
        {
          name: "mail",
          kind: "simulated",
          activable: true,
          state: "active",
          since: ACTIVATED_AT,
          functions: [
            { name: "mail.create_draft", class: "write" },
            { name: "mail.send_draft", class: "sensitive" },
          ],
        },
        { name: "table", kind: "built_in", activable: false, state: "always_active", since: null, functions: native.map((fn) => ({ name: fn.name, class: fn.class })) },
        { name: "node", kind: "built_in", activable: false, state: "always_active", since: null, functions: nodes.map((fn) => ({ name: fn.name, class: fn.class })) },
        { name: "upload", kind: "built_in", activable: false, state: "always_active", since: null, functions: [{ name: "upload.link", class: "write" }] },
        { name: "application", kind: "application", activable: false, state: "always_active", since: null, functions: [{ name: "erp.lookup_customer", class: "read" }] },
      ])
      // Sans activation, le connecteur activable est dit inactif (HN-E08S06-9).
      await withoutActivation()
      const inactive = await session()
      expect((await inactive.connector({ op: "catalogue" })).text.split("\n")[0]).toBe("- mail (simulated): inactive — mail.create_draft (write), mail.send_draft (sensitive)")
    })
  })

  describe("admin_connector activate (AC8)", () => {
    it("should activate a connector, say when it was already active, and serve the refusals of E04-S01", async () => {
      await withoutActivation()
      const { journal, connector } = await session()
      const acme = admin.orgs.acme.slug
      expect((await connector({ op: "activate", connector: "mail" })).text).toBe(`mail is now active in ${acme}: its functions are callable at once.`)
      expect(await activations()).toEqual([expect.objectContaining({ connector: "mail", state: "active", activated_by: PERSONS.sam.id })])
      expect((await connector({ op: "activate", connector: "mail" })).text).toBe(`mail is already active in ${acme}; nothing changed.`)
      expect((await connector({ op: "activate", connector: "fax" })).text).toBe("Unknown connector fax. Connectors you can activate: mail.")
      expect((await connector({ op: "activate", connector: "table" })).text).toBe("table is built in: it is always active and has no accounts.")
      expect(codes(journal)).toEqual([null, null, "not_found", "invalid_arguments"])
    })
  })

  describe("admin_connector deactivate (AC9)", () => {
    it("should summarise the impact of a deactivation without deactivating, naming 10 procedures at most, then deactivate once confirmed", async () => {
      restoreActivation()
      const scratch: Tables = {}
      adminTree(scratch)
      tenMoreProcedures(scratch)
      const procedures = scratch.nodes.filter((node) => String(node.path).startsWith("support/proc_"))
      const added = new Set(procedures.map((node) => node.id))
      undo.push(() => seed.admin`delete from platform.nodes where org_id = ${admin.orgs.acme.id} and path in ${seed.admin(procedures.map((node) => String(node.path)))}`)
      await admin.write({ nodes: procedures, blocks: placed(scratch.blocks.filter((block) => added.has(block.node_id))) })
      const { connector } = await session()
      const acme = admin.orgs.acme.slug
      const summary = await connector({ op: "deactivate", connector: "mail" })
      const named = Array.from({ length: 10 }, (_, index) => `support/proc_${String(index).padStart(2, "0")}`).join(", ")
      expect(summary.text).toBe(
        [
          `About to deactivate mail in ${acme}: its functions (mail.create_draft, mail.send_draft) stop at once for everyone (not_enabled); 11 published procedures call it in their call blocks (${named}, +1 more) and will fail at those steps; its 3 accounts are kept.`,
          NOTHING("deactivated"),
        ].join("\n"),
      )
      expect(summary.structured?.next_actions).toEqual([])
      expect((await activations())[0]).toMatchObject({ state: "active" })
      expect((await connector({ op: "deactivate", connector: "mail", confirm: true })).text).toBe(`mail deactivated in ${acme}: its functions answer not_enabled from now on.`)
      expect((await activations())[0]).toMatchObject({ state: "inactive" })
      expect((await connector({ op: "deactivate", connector: "mail" })).text).toBe(`mail is not active in ${acme}; nothing changed.`)
    })
  })

  describe("admin_connector accounts (AC10)", () => {
    it("should list the accounts the caller sees, disabled ones included, and say how to create the first one", async () => {
      const { connector } = await session()
      expect((await connector({ op: "accounts" })).text).toBe(
        [
          "- Mail Acme · mail · organisation · simulated · active",
          "- Mail Ancien · mail · organisation · simulated · disabled",
          "- Mail Ventes · mail · team Ventes · simulated · active",
        ].join("\n"),
      )
      // `demo`, sans compte dans la graine : les comptes d'acme, que lisent les autres tests, restent.
      const { demo } = admin.orgs
      expect((await connector({ op: "accounts", org: demo.slug })).text).toBe(
        `${demo.slug} has no account yet. Create a simulated one with admin_connector {"op": "create_account"}.`,
      )
    })
  })

  describe("admin_connector create_account (AC11)", () => {
    it("should create a simulated team account, and refuse a personal owner, a live mode, a taken label and an unknown connector", async () => {
      undo.push(() => seed.admin`delete from platform.accounts where org_id = ${admin.orgs.acme.id} and label = 'Mail Support'`)
      const { journal, connector } = await session()
      const create = (args: Record<string, unknown>) => connector({ op: "create_account", connector: "mail", ...args })
      expect((await create({ account: "Mail Support", owner: "team:support" })).text).toBe(
        `Simulated account Mail Support (mail) created in ${admin.orgs.acme.slug}, owned by team Support. Nothing it does leaves the server.`,
      )
      const created = await seed.admin`select label, owner_kind, owner_team_id, mode, status from platform.accounts where org_id = ${admin.orgs.acme.id} and label = 'Mail Support'`
      expect(admin.readable([...created])).toEqual([{ label: "Mail Support", owner_kind: "team", owner_team_id: TEAMS.support.id, mode: "simule", status: "active" }])
      expect((await create({ account: "Mail Claire", owner: `user:${admin.persons.claire.email}` })).text).toBe(
        "owner must be org or team:<slug>: a personal account is created by its owner, not by the platform team.",
      )
      expect((await create({ account: "Mail Live", owner: "org", mode: "reel" })).text).toBe(
        "Live and sandbox accounts arrive with the connector service in V2. In this version, accounts are simulated: create it with mode simule.",
      )
      // Le libellé du compte personnel de Claire, que l'équipe plateforme ne voit pas : l'index unique refuse quand même.
      expect((await create({ account: "Mail Direction", owner: "org" })).text).toBe("An account labelled Mail Direction already exists in Acme Test.")
      expect((await create({ account: "Fax", connector: "fax", owner: "org" })).text).toBe("Unknown connector fax. Connectors you can activate: mail.")
      expect(codes(journal)).toEqual([null, "invalid_arguments", "unavailable_in_v1", "conflict", "not_found"])
    })
  })

  describe("admin_connector disable_account (AC12)", () => {
    it("should summarise the disabling of an account found by its label, disable it once confirmed, and never find an account the caller cannot see", async () => {
      undo.push(() => seed.admin`update platform.accounts set status = 'active' where id = ${admin.id(accountId(1))}`)
      const { connector } = await session()
      const disable = (args: Record<string, unknown>) => connector({ op: "disable_account", ...args })
      expect((await disable({ account: "mail ventes" })).text).toBe(
        [
          "About to disable account Mail Ventes (mail, team Ventes): calls that resolve to it fail from now on. V1 cannot enable an account again: create a new one if needed.",
          NOTHING("disabled"),
        ].join("\n"),
      )
      expect(await statusOf(accountId(1))).toBe("active")
      expect((await disable({ account: "Mail Ventes", confirm: true })).text).toBe("Account Mail Ventes disabled.")
      expect(await statusOf(accountId(1))).toBe("disabled")
      expect((await disable({ account: "Mail Ventes" })).text).toBe("Account Mail Ventes is already disabled; nothing changed.")
      // Le compte personnel de Claire est de niveau 0 : ni trouvé, ni nommé dans la liste.
      expect((await disable({ account: "Mail Direction", confirm: true })).text).toBe(
        `No account labelled Mail Direction in ${admin.orgs.acme.slug}. Accounts: Mail Acme, Mail Ancien, Mail Ventes.`,
      )
      expect((await disable({ account: "Mail Acme", connector: "mail" })).text).toBe(
        'Field connector is not used by op disable_account of admin_connector. Fields of disable_account: org, account, confirm. Call admin_connector {"op": "help"} for details.',
      )
      expect(await statusOf(accountId(3))).toBe("active")
    })
  })

  describe("admin_connector rules of an account (AC13)", () => {
    it("should list, set and remove the rules of an account with the renders of a node, and the defaults of H67", async () => {
      restoreVentesRules()
      const { connector } = await session()
      const { marc, ada } = admin.persons
      const rules = (args: Record<string, unknown>) => connector({ account: "Mail Ventes", ...args })
      expect((await rules({ op: "account_rules" })).text).toBe(
        ["- team Support: read", `- user Marc Petit <${marc.email}>: read`, `Owner: team Ventes (lead: Claire Morel). ${DEFAULTS}`].join("\n"),
      )
      expect((await rules({ op: "add_account_rule", subject: "team:conseil", level: "write" })).text).toBe("team Conseil now has write on account Mail Ventes.")
      expect((await rules({ op: "add_account_rule", subject: `user:${marc.email}`, level: "write" })).text).toBe(
        `user Marc Petit <${marc.email}> now has write on account Mail Ventes. It was read.`,
      )
      expect((await rules({ op: "remove_account_rule", subject: "team:support" })).text).toBe(
        `team Support no longer has a rule on account Mail Ventes (it was read). ${DEFAULTS}`,
      )
      expect((await rules({ op: "remove_account_rule", subject: `user:${ada.email}` })).text).toBe(`No rule for user Ada Martin <${ada.email}> on account Mail Ventes.`)
      expect(await ventesRules()).toEqual([
        [PERSONS.marc.id, "write"],
        [TEAMS.conseil.id, "write"],
      ])
    })

    it("should read the rules of an account beyond one page of the database (supabase-patterns.md § Error Handling)", async () => {
      restoreVentesRules()
      // 1 001 règles de plus sur « Mail Ventes » : avec les deux du jeu, 1 003, au-delà d'une lecture (`max_rows`).
      const many = Array.from({ length: 1001 }, (_, index) => {
        const n = String(index).padStart(4, "0")
        return { ...accountRule(9, { subject_user_id: `d1000000-0000-4000-8000-00000000${n}` }, "read"), id: `f2000000-0000-4000-8000-00000000${n}` }
      })
      await admin.write({ access_rules: many })
      const { connector } = await session()
      const lines = (await connector({ op: "account_rules", account: "Mail Ventes" })).text.split("\n")
      expect(lines).toHaveLength(202)
      expect(lines.at(-2)).toBe("… and 803 more")
    })

    it("should refuse to set or remove a rule without the management of the account, and the manage level to a non-administrator, before any write", async () => {
      // La base simulée faisait de tout appelant du MCP admin un membre de l'équipe plateforme (`is_staff`) :
      // Marc et Claire y entrent le temps du test.
      const staff = [admin.persons.marc.id, admin.persons.claire.id]
      undo.push(() => seed.admin`delete from platform.platform_staff where user_id in ${seed.admin(staff)}`)
      await admin.write({ platform_staff: [{ user_id: PERSONS.marc.id }, { user_id: PERSONS.claire.id }] })
      // Marc lit « Mail Ventes » par une règle, sans le gérer : il ne pose ni ne retire une règle.
      const marc = await session("marc")
      const reserved = "Using account « Mail Ventes » is reserved to team Ventes (lead: Claire Morel). Ask them for access."
      expect((await marc.connector({ op: "add_account_rule", account: "Mail Ventes", subject: "team:conseil", level: "read" })).text).toBe(reserved)
      expect((await marc.connector({ op: "remove_account_rule", account: "Mail Ventes", subject: "team:support" })).text).toBe(reserved)
      expect((await ventesRules()).map(([subject]) => subject)).toEqual([TEAMS.support.id, PERSONS.marc.id].sort())
      // Claire le gère (responsable de Ventes), sans administrer acme (fiche D4).
      const claire = await session("claire")
      expect((await claire.connector({ op: "add_account_rule", account: "Mail Ventes", subject: "team:conseil", level: "manage" })).text).toBe(
        "Only an administrator of Acme Test can grant the manage level.",
      )
      expect(requestedWrites([...marc.spy.requests, ...claire.spy.requests])).toEqual([])
      expect(codes([...marc.journal, ...claire.journal])).toEqual(["forbidden", "forbidden", "forbidden"])
    })

    it("should serve the rules of an account the caller reads only, an invisible account answering as an unknown one (H68)", async () => {
      const deps = await admin.deps("sam")
      const spy = recordRequests(deps.db)
      const identity = await resolveAdminOrg(spy.db, deps.caller, admin.orgs.acme.slug)
      const before = spy.requests.length
      // Le compte personnel de Claire est de niveau 0 pour l'équipe plateforme : ni ses règles ni son libellé (H61).
      for (const id of [admin.id(accountId(3)), accountId(9)]) {
        await expect(listAccountRules(spy.db, identity, id), id).rejects.toMatchObject({ code: "not_found", message: `Unknown account ${id}.` })
      }
      expect(ruleListings(spy.requests.slice(before))).toEqual([])
    })
  })
})
