// @vitest-environment node
// Services connecteurs (E04-S01, AC2, AC3, AC6, AC7, AC8) : ce qui se décide avant la base, sur un
// client qui lève dès qu'on le touche ; et les droits décidés par le service (E01-S07 AC23), sur une
// base réelle (E01-S10, lot t1-d1) où l'isolation seule rend les comptes que la personne ne voit pas.
// Les écritures, la RLS et les refus nominatifs sont couverts par
// `tests/integration/connectors-services.test.ts`.
import * as z from "zod/v4"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { defineFunction, type CatalogFunction } from "../../packages/plateforme/server/catalog/define"
import { catalogFunctions } from "../../packages/plateforme/server/catalog/registry"
import { createAccount, disableAccount, listUsableAccounts } from "../../packages/plateforme/server/connectors/accounts"
import {
  activableConnectors,
  activateConnector,
  deactivateConnector,
  listConnectorsForOrg,
  requireActivable,
} from "../../packages/plateforme/server/connectors/activations"
import type { PlatformDb } from "../../packages/plateforme/server/db"
import { PlatformError } from "../../packages/plateforme/server/errors"
import type { Identity } from "../../packages/plateforme/server/identity"
import { ACCOUNTS, ORG, OTHER_ORG, PEOPLE, referenceTables, TEAMS, type Person } from "../helpers/reference-org"
import { seedReferenceOrg, type ReferenceOrgSql } from "../helpers/reference-org-sql"
import type { Row } from "../helpers/simulated-db"
import { namesOf, sqlConfigured, recordDb, recordPeople, seedWithAdmin, spyDb, type SeededData, type SentQuery, portable } from "../helpers/sql"

// Le vrai catalogue, sauf quand un test le vide (« catalogue sans connecteur activable »).
vi.mock("../../packages/plateforme/server/catalog/registry", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../packages/plateforme/server/catalog/registry")>()
  return { ...original, catalogFunctions: vi.fn(original.catalogFunctions) }
})

// Toute lecture ou écriture en base lève : ce qui passe ici ne l'a pas touchée. Un Proxy vide n'a
// pas le type du client : l'assertion le fait passer pour lui.
const untouchable = new Proxy(
  {},
  {
    get() {
      throw new Error("database touched")
    },
  },
) as unknown as PlatformDb

const ADMIN: Identity = {
  org: { id: "org-1", slug: "acme", name: "Acme Test", prefix: "acme", brand: {}, domains: null },
  user: { id: "user-ada", email: "ada@example.test", name: "Ada Martin" },
  member: { role: "admin", profile: {} },
  teams: [],
  isStaff: false,
  viaGrant: false,
  hasOpenGrant: false,
}

const ok = async () => ({ text: "ok" })

function fn(name: string, origin: CatalogFunction["origin"]): CatalogFunction {
  const [connector] = name.split(".")
  return defineFunction({ name, connector, class: "read", origin, description: "Test.", schema: z.strictObject({}), examples: [], refusals: [], run: ok })
}

async function refusal(promise: Promise<unknown>): Promise<PlatformError> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  )
  if (!(error instanceof PlatformError)) throw new Error(`expected a PlatformError, got ${String(error)}`)
  return error
}

afterEach(() => {
  vi.mocked(catalogFunctions).mockClear()
})

describe("activableConnectors and requireActivable (AC2, AC3, H81)", () => {
  const functions = [fn("slack.post", "connecteur"), fn("mail.list", "connecteur"), fn("table.rows", "paquet"), fn("erp.list_invoices", "erp")]

  it("should keep only the connectors of remote functions, sorted by name", () => {
    expect([...activableConnectors(functions).keys()]).toEqual(["mail", "slack"])
    expect(activableConnectors([]).size).toBe(0)
  })

  it("should refuse a built-in connector, table included before its functions exist", () => {
    for (const name of ["table", "erp"]) {
      const error = (() => {
        try {
          requireActivable(name, functions)
        } catch (thrown) {
          return thrown
        }
      })()
      expect(error).toMatchObject({ code: "invalid_arguments", message: `${name} is built in: it is always active and has no accounts.` })
    }
    expect(() => requireActivable("table", [])).toThrow("table is built in: it is always active and has no accounts.")
  })

  it("should refuse an unknown connector, listing those that can be activated", () => {
    expect(() => requireActivable("sellsy", catalogFunctions())).toThrow("Unknown connector sellsy. Connectors you can activate: mail.")
    expect(() => requireActivable("sellsy", [])).toThrow("Unknown connector sellsy. Connectors you can activate: none.")
  })

  it("should name 20 of 1,000 connectors that can be activated, then count the others (N32)", () => {
    const many = Array.from({ length: 1000 }, (_, index) => fn(`c${String(index).padStart(4, "0")}.run`, "connecteur"))
    const listed = many.slice(0, 20).map((candidate) => candidate.connector).join(", ")
    expect(() => requireActivable("sellsy", many)).toThrow(`Unknown connector sellsy. Connectors you can activate: ${listed}, … and 980 more.`)
  })
})

describe("activation refusals before the database (AC2)", () => {
  it("should refuse an unknown or malformed connector, to activate as to deactivate", async () => {
    const refusals: [Record<string, unknown>, string, string][] = [
      [{ connector: "sellsy" }, "not_found", "Unknown connector sellsy. Connectors you can activate: mail."],
      [{ connector: "Mail!" }, "invalid_arguments", "Invalid arguments: connector: Connector: lowercase letters, digits and _, starting with a letter, 40 characters max, e.g. mail."],
    ]
    const verdicts: Record<string, unknown> = {}
    for (const [input] of refusals) {
      const answers = []
      for (const service of [activateConnector, deactivateConnector]) {
        const error = await refusal(service(untouchable, ADMIN, input))
        answers.push({ code: error.code, message: error.message })
      }
      verdicts[JSON.stringify(input)] = answers
    }
    expect(verdicts).toEqual(Object.fromEntries(refusals.map(([input, code, message]) => [JSON.stringify(input), [{ code, message }, { code, message }]])))
  })
})

/** Les comptes d'O simulés et actifs : ceux de la fixture de référence, que chaque cas retrouve. */
function baseAccounts(): Row[] {
  return referenceTables()
    .accounts.filter((row) => row.org_id === ORG.id)
    .map((row) => ({ ...row, mode: "simule", status: "active" }))
}

/** Une requête sur une table, par l'une ou l'autre face. */
const onTable = (query: SentQuery, table: string, op: SentQuery["op"]) => query.target === table && query.op === op

// Sur la base réelle (E01-S10, lot t1-d1) : O de la fixture de référence, `mail` actif, ses trois
// comptes simulés et actifs ; chaque cas retrouve cette base (`beforeEach`), ses écritures défaites.
describe.skipIf(!sqlConfigured)(portable("connector services on a real database (E01-S07 AC23)"), { timeout: 60_000 }, () => {
  let seed: SeededData
  let ref: ReferenceOrgSql

  beforeAll(async () => {
    seed = seedWithAdmin()
    ref = await seedReferenceOrg(seed)
  }, 180_000)

  afterAll(async () => {
    await seed?.cleanup()
  }, 180_000)

  /** L'état de `mail` chez O, posé par la connexion d'administration. */
  async function setMail(state: "active" | "inactive"): Promise<void> {
    await seed.admin`insert into platform.connector_activations (org_id, connector, state, activated_by, updated_at)
                     values (${ref.org.id}, 'mail', ${state}, ${ref.people.ada.id}, '2026-09-24T10:00:00.000Z')
                     on conflict (org_id, connector) do update set state = excluded.state`
  }

  async function mailState(): Promise<string | undefined> {
    const [row] = await seed.admin<{ state: string }[]>`select state from platform.connector_activations where org_id = ${ref.org.id} and connector = 'mail'`
    return row?.state
  }

  beforeEach(async () => {
    await seed.admin`delete from platform.accounts where org_id = ${ref.org.id}`
    await ref.write({ accounts: baseAccounts() })
    await setMail("active")
  })

  describe("activation decided by isOrgAdmin (AC2 ; E01-S07 AC23)", () => {
    it("should refuse a member before any write, naming the administrators, and let T deactivate as an administrator", async () => {
      const spied = recordPeople(ref.db)
      for (const service of [activateConnector, deactivateConnector]) {
        await expect(service(await spied.db("lea"), ref.identityOf("lea"), { connector: "mail" })).rejects.toMatchObject({
          code: "forbidden",
          message: "Activating or deactivating connectors at Acme Test is reserved to its administrators (Ada Martin).",
        })
      }
      expect(spied.writes()).toEqual([])
      // T : membre simple de O, de l'équipe plateforme avec un accès en cours (fiche D17).
      expect(await deactivateConnector(await spied.db("t"), ref.identityOf("t"), { connector: "mail" })).toMatchObject({ connector: "mail", state: "inactive" })
      expect(spied.writes()).toHaveLength(1)
      expect(await mailState()).toBe("inactive")
    })

    // Une désactivation que l'écriture ne fait pas après la décision : `mail` inactif au moment de la mise
    // à jour, qui ne change aucune ligne, puis réactivé par une autre requête avant la relecture (course).
    it("should answer conflict when the deactivation changes no row while mail stays active (HN-E01S07-6)", async () => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {})
      try {
        await setMail("inactive")
        let updated = false
        const { db } = spyDb(await ref.db("ada"), {
          before: async (query) => {
            if (onTable(query, "connector_activations", "update")) updated = true
            else if (updated && onTable(query, "connector_activations", "select")) await setMail("active")
          },
        })
        const error = await refusal(deactivateConnector(db, ref.identityOf("ada"), { connector: "mail" }))
        expect(error.code).toBe("conflict")
        expect(error.message).toBe("Connector mail at Acme Test changed meanwhile. Reload it and retry.")
        expect(log).toHaveBeenCalledWith("[platform] deactivateConnector: mail still active after the update")
      } finally {
        log.mockRestore()
      }
    })
  })

  describe("accounts decided by the service (E01-S07 AC23)", () => {
    /** Les comptes d'O créés par les cas, relus dans l'ordre de leurs libellés. */
    async function created(labels: string[]): Promise<Row[]> {
      const rows = await seed.admin<Row[]>`select label, owner_kind, owner_team_id, owner_user_id from platform.accounts
                                           where org_id = ${ref.org.id} and label in ${seed.admin(labels)}`
      return labels.map((label) => ref.readable(rows.find((row) => row.label === label)) ?? {})
    }

    it("should read the levels of the connector's accounts in one batch, and never serve an account the person cannot see", async () => {
      const { db, requests } = recordDb(await ref.db("paul"))
      // Paul (Support) lit le compte de l'organisation ; ni celui de Ventes, ni celui de Claire.
      const usable = await listUsableAccounts(db, ref.identityOf("paul"), { connector: "mail" })
      expect(usable.map(({ label, level }) => [label, level])).toEqual([["Mail Org", "read"]])
      // Une lecture des comptes, le nom de leur équipe joint (`teams`, face SQL du lot d1) et le départ du propriétaire
      // d'un compte personnel (`members`, partage des comptes), puis leurs niveaux en un lot.
      expect(requests.flatMap(namesOf).sort()).toEqual(["access_rules", "accounts", "accounts", "members", "teams"])
    })

    it("should decide who creates which account before inserting it", async () => {
      const spied = recordPeople(ref.db)
      const ventes = ref.id(TEAMS.ventes.id)
      const create = async (person: Person, owner: Record<string, unknown>) =>
        createAccount(await spied.db(person), ref.identityOf(person), { connector: "mail", label: `Mail ${person} ${String(owner.owner_kind)}`, mode: "simule", ...owner })
      await expect(create("lea", { owner_kind: "org" })).rejects.toMatchObject({
        code: "forbidden",
        message: "Creating an organisation account is reserved to the administrators of Acme Test (Ada Martin).",
      })
      await expect(create("lea", { owner_kind: "team", team_id: ventes })).rejects.toMatchObject({
        code: "forbidden",
        message: "Creating an account for team Ventes is reserved to its lead (Claire Morel) and the administrators of Acme Test (Ada Martin).",
      })
      // Une équipe de P, dont Léa est aussi membre : la base la lui rend, et seul le service la cherche dans
      // l'organisation de l'adresse ; aucune garde en base ne lie l'équipe d'un compte à son organisation
      // (E01-S10, lot d1).
      await ref.write({ teams: [{ id: "other:team", org_id: OTHER_ORG.id, slug: "equipe_p", name: "Ventes P", lead_user_id: null }] })
      const foreign = ref.id("other:team")
      await expect(create("lea", { owner_kind: "team", team_id: foreign })).rejects.toMatchObject({
        code: "invalid_arguments",
        message: `Unknown team ${foreign} in Acme Test.`,
      })
      expect(spied.writes()).toEqual([])
      // T administre (fiche D17), Claire mène Ventes, Léa crée le sien.
      await create("t", { owner_kind: "org" })
      await create("claire", { owner_kind: "team", team_id: ventes })
      await create("lea", { owner_kind: "user" })
      expect(spied.writes()).toHaveLength(3)
      expect(await created(["Mail t org", "Mail claire team", "Mail lea user"])).toEqual([
        { label: "Mail t org", owner_kind: "org", owner_team_id: null, owner_user_id: null },
        { label: "Mail claire team", owner_kind: "team", owner_team_id: TEAMS.ventes.id, owner_user_id: null },
        { label: "Mail lea user", owner_kind: "user", owner_team_id: null, owner_user_id: PEOPLE.lea.id },
      ])
    })

    it("should answer a failure and keep nothing when the account it just wrote is not read back (M32)", async () => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {})
      try {
        const real = await ref.db("t")
        // La relecture des comptes (une lecture de `accounts`) rend zéro ligne, comme une lecture qui refuserait
        // le compte écrit ; l'insertion, elle, part.
        const blind: PlatformDb = {
          tx: (fn) =>
            real.tx((sql) =>
              fn(
                new Proxy(sql, {
                  apply(target, thisArg, args: unknown[]) {
                    const [strings] = args
                    const text = Array.isArray(strings) ? strings.join("?") : ""
                    return /^\s*select\b/i.test(text) && /\bfrom platform\.accounts\b/.test(text) ? Promise.resolve([]) : Reflect.apply(target, thisArg, args)
                  },
                }),
              ),
            ),
        }
        await expect(createAccount(blind, ref.identityOf("t"), { connector: "mail", owner_kind: "org", label: "Mail relu", mode: "simule" })).rejects.toMatchObject({
          code: "internal",
          message: "Internal error.",
        })
        expect(log).toHaveBeenCalledWith(expect.stringMatching(/^\[platform\] createAccount: account [0-9a-f-]{36} written but not read back$/))
        expect(await created(["Mail relu"])).toEqual([{}])
      } finally {
        log.mockRestore()
      }
    })

    it("should decide the level before disabling an account, and answer conflict when no row is written after the decision", async () => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {})
      try {
        const [ventes, org] = [ref.id(ACCOUNTS.ventes.id), ref.id(ACCOUNTS.org.id)]
        const spied = recordPeople(ref.db)
        await expect(disableAccount(await spied.db("paul"), ref.identityOf("paul"), { account_id: ventes })).rejects.toMatchObject({
          code: "not_found",
          message: `Unknown account ${ventes}.`,
        })
        await expect(disableAccount(await spied.db("lea"), ref.identityOf("lea"), { account_id: ventes })).rejects.toMatchObject({
          code: "forbidden",
          message: "Disabling « Mail Ventes » is reserved to those who manage it: team Ventes (lead: Claire Morel).",
        })
        expect(spied.writes()).toEqual([])
        expect(await disableAccount(await spied.db("claire"), ref.identityOf("claire"), { account_id: ventes })).toMatchObject({
          label: "Mail Ventes",
          status: "disabled",
        })
        expect(spied.writes()).toHaveLength(1)
        const [disabled] = await seed.admin<{ status: string }[]>`select status from platform.accounts where id = ${ventes}`
        expect(disabled.status).toBe("disabled")
        // Le compte disparu entre la décision et l'écriture : aucune ligne écrite.
        const { db: gone } = spyDb(await ref.db("ada"), {
          before: async (query) => {
            if (onTable(query, "accounts", "update")) await seed.admin`delete from platform.accounts where id = ${org}`
          },
        })
        await expect(disableAccount(gone, ref.identityOf("ada"), { account_id: org })).rejects.toMatchObject({
          code: "conflict",
          message: "Account « Mail Org » changed meanwhile. Reload it and retry.",
        })
        expect(log).toHaveBeenCalledWith(`[platform] disableAccount: no row written for account ${org}`)
      } finally {
        log.mockRestore()
      }
    })
  })
})

describe("listConnectorsForOrg (AC3)", () => {
  it("should return an empty list, without reading, when the catalog has no connector to activate", async () => {
    vi.mocked(catalogFunctions).mockReturnValueOnce([fn("table.rows", "paquet")])
    expect(await listConnectorsForOrg(untouchable, ADMIN)).toEqual([])
  })
})

describe("account refusals before the database (AC6, AC7)", () => {
  const team = "7f4bb501-5627-48f8-855d-3c0f3ffd3c8f"

  // Prise des connecteurs (AC13, AC14) : le mode que le connecteur admet, décidé avant la base.
  it("should refuse an account in a mode its connector does not admit, and create nothing", async () => {
    const refusals: [string, string, string, string][] = [
      ["mail", "reel", "unavailable_in_v1", "mail is simulated in this version: its accounts are simulated, a live account is not available. Create it with mode simule."],
      ["crm", "sandbox", "unavailable_in_v1", "Sandbox accounts are not available yet. Create a live account of crm with mode reel."],
      ["crm", "simule", "invalid_arguments", "crm is a live connector: its accounts are live, never simulated. Create it with mode reel."],
    ]
    const verdicts: Record<string, unknown> = {}
    for (const [connector, mode] of refusals) {
      // Un connecteur réel déclaré par l'hôte (moteur des connecteurs décrits), à côté du mail simulé du paquet.
      vi.mocked(catalogFunctions).mockReturnValueOnce([fn("mail.create_draft", "connecteur"), fn("crm.get_company", "connecteur")])
      const error = await refusal(createAccount(untouchable, ADMIN, { connector, owner_kind: "org", label: "Compte Acme", mode }))
      verdicts[`${connector} ${mode}`] = { code: error.code, message: error.message }
    }
    expect(verdicts).toEqual(Object.fromEntries(refusals.map(([connector, mode, code, message]) => [`${connector} ${mode}`, { code, message }])))
  })

  it("should refuse an empty or too long label, a missing team, a built-in or unknown connector", async () => {
    const base = { connector: "mail", owner_kind: "team", team_id: team }
    expect((await refusal(createAccount(untouchable, ADMIN, { ...base, label: "  " }))).code).toBe("invalid_arguments")
    expect((await refusal(createAccount(untouchable, ADMIN, { ...base, label: "x".repeat(81) }))).code).toBe("invalid_arguments")
    expect((await refusal(createAccount(untouchable, ADMIN, { connector: "mail", owner_kind: "team", label: "Mail" }))).message).toBe(
      "Invalid arguments: team_id: team_id is required for a team account.",
    )
    expect(await refusal(createAccount(untouchable, ADMIN, { ...base, connector: "table", label: "Tables" }))).toMatchObject({
      code: "invalid_arguments",
      message: "table is built in: it is always active and has no accounts.",
    })
    expect(await refusal(createAccount(untouchable, ADMIN, { ...base, connector: "sellsy", label: "Sellsy" }))).toMatchObject({
      code: "not_found",
      message: "Unknown connector sellsy. Connectors you can activate: mail.",
    })
  })

  it("should refuse an account id that is not a UUID", async () => {
    expect((await refusal(disableAccount(untouchable, ADMIN, { account_id: "Mail Ventes" }))).code).toBe("invalid_arguments")
  })

  it("should list the usable accounts of a connector that can be activated only, as createAccount does (N35)", async () => {
    expect(await refusal(listUsableAccounts(untouchable, ADMIN, { connector: "sellsy" }))).toMatchObject({
      code: "not_found",
      message: "Unknown connector sellsy. Connectors you can activate: mail.",
    })
    expect(await refusal(listUsableAccounts(untouchable, ADMIN, { connector: "table" }))).toMatchObject({
      code: "invalid_arguments",
      message: "table is built in: it is always active and has no accounts.",
    })
    expect(await refusal(listUsableAccounts(untouchable, ADMIN, {}))).toMatchObject({
      code: "invalid_arguments",
      message: "Invalid arguments: connector: Invalid input: expected string, received undefined.",
    })
  })
})
