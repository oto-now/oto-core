// @vitest-environment node
// Connecteur `mail` simulé (E04-S01, AC17 pour la validation, AC18 pour la garde de l'envoi, AC19) :
// schémas stricts, identifiant `sim_` + 8 hexadécimaux, métadonnées du catalogue, les gardes qui
// passent avant la base, et l'envoi que la mise à jour gardée ne fait pas, joué sur une base réelle
// (E01-S10, lot t1-d1). Les écritures dans `sim_outbox` sont couvertes par
// `tests/integration/mail-simulated.test.ts`.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { CatalogFunction, FunctionContext } from "../../packages/plateforme/server/catalog/define"
import type { ResolvedAccount } from "../../packages/plateforme/server/connectors/resolution"
import { mailCreateDraft, mailSendDraft } from "../../packages/plateforme/server/connectors/simulated/mail"
import type { PlatformDb } from "../../packages/plateforme/server/db"
import { PlatformError } from "../../packages/plateforme/server/errors"
import type { Identity } from "../../packages/plateforme/server/identity"
import { ACCOUNTS, ORG, PEOPLE, TEAMS } from "../helpers/reference-org"
import { seedReferenceOrg, type ReferenceOrgSql } from "../helpers/reference-org-sql"
import type { Row } from "../helpers/simulated-db"
import { sqlConfigured, recordDb, seedWithAdmin, spyDb, type SeededData, type SentQuery, portable } from "../helpers/sql"

const DRAFT = { to: "sophie@valbrune.test", subject: "Votre rendez-vous", body: "Bonjour Sophie, …" }

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

const IDENTITY: Identity = {
  org: { id: "org-1", slug: "acme", name: "Acme Test", prefix: "acme", brand: {}, domains: null },
  user: { id: "user-1", email: "claire@example.test", name: "Claire Morel" },
  member: { role: "member", profile: {} },
  teams: [],
  isStaff: false,
  viaGrant: false,
  hasOpenGrant: false,
}

const ACCOUNT: ResolvedAccount = {
  id: "a-ventes",
  label: "Mail Ventes",
  connector: "mail",
  mode: "simule",
  owner: { kind: "team", teamId: "t-ventes", userId: null, description: "team Ventes" },
  level: "write",
  source: "team",
}

function context(account?: ResolvedAccount): FunctionContext {
  return { db: untouchable, identity: IDENTITY, account }
}

function run(fn: CatalogFunction, account: ResolvedAccount | undefined, args: Record<string, unknown>) {
  // Le type commun du catalogue efface les arguments en `never` ; ceux-ci suivent le schéma de la fonction.
  return fn.run(context(account), args as never)
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
  vi.restoreAllMocks()
})

describe("mail.create_draft arguments (AC17)", () => {
  const parse = (args: unknown) => mailCreateDraft.schema.safeParse(args)

  it("should accept one recipient, a subject and a body", () => {
    expect(parse(DRAFT)).toEqual({ success: true, data: DRAFT })
  })

  // `from`, une autre clé inconnue, suit la même règle (`strict`).
  it("should refuse the unknown key cc, naming it", () => {
    const result = parse({ ...DRAFT, cc: "paul@valbrune.test" })
    expect(result.success).toBe(false)
    expect(result.error?.issues.map((issue) => issue.message)).toEqual(['Unrecognized key: "cc"'])
  })

  it("should refuse an address that is not an email", () => {
    expect(parse({ ...DRAFT, to: "sophie" }).error?.issues[0].path).toEqual(["to"])
  })

  it("should keep the subject between 1 and 200 characters and the body between 1 and 20,000", () => {
    expect(parse({ ...DRAFT, subject: "" }).success).toBe(false)
    expect(parse({ ...DRAFT, subject: "s".repeat(200) }).success).toBe(true)
    expect(parse({ ...DRAFT, subject: "s".repeat(201) }).success).toBe(false)
    expect(parse({ ...DRAFT, body: "" }).success).toBe(false)
    expect(parse({ ...DRAFT, body: "b".repeat(20_000) }).success).toBe(true)
    expect(parse({ ...DRAFT, body: "b".repeat(20_001) }).success).toBe(false)
  })
})

describe("mail.send_draft arguments (AC18, N14)", () => {
  it("should take a draft id of the form sim_ and 8 hexadecimal digits, and nothing else", () => {
    expect(mailSendDraft.schema.safeParse({ id: "sim_1a2b3c4d" }).success).toBe(true)
    expect(mailSendDraft.schema.safeParse({ id: " sim_1a2b3c4d " }).data).toEqual({ id: "sim_1a2b3c4d" })
    for (const id of ["sim_1A2B3C4D", "sim_1a2b3c4", "dr_1a2b3c4d", "sim_1a2b3c4d5"]) {
      expect(mailSendDraft.schema.safeParse({ id }).success, id).toBe(false)
    }
    expect(mailSendDraft.schema.safeParse({ id: "sim_1a2b3c4d", confirm: true }).success).toBe(false)
  })
})

describe("catalog metadata (AC19)", () => {
  it("should declare the classes, the connector and the origin", () => {
    expect([mailCreateDraft, mailSendDraft].map(({ name, connector, class: fnClass, origin }) => ({ name, connector, fnClass, origin }))).toEqual([
      { name: "mail.create_draft", connector: "mail", fnClass: "write", origin: "connecteur" },
      { name: "mail.send_draft", connector: "mail", fnClass: "sensitive", origin: "connecteur" },
    ])
  })

  it("should describe each function in English, first sentence first, with examples and refusals", () => {
    expect(mailCreateDraft.description.startsWith("Saves an email draft")).toBe(true)
    expect(mailSendDraft.description.startsWith("Sends an email draft")).toBe(true)
    for (const fn of [mailCreateDraft, mailSendDraft]) {
      expect(fn.examples.length, fn.name).toBeGreaterThan(0)
      expect(fn.refusals.length, fn.name).toBeGreaterThan(0)
      for (const example of fn.examples) expect(fn.schema.safeParse(example).success, fn.name).toBe(true)
    }
  })

  it("should propose mail.send_draft after mail.create_draft, and summarize before sending", () => {
    expect(mailCreateDraft.next).toEqual(["mail.send_draft"])
    expect(mailSendDraft.summarize).toBeTypeOf("function")
    expect(mailCreateDraft.summarize).toBeUndefined()
  })

  // La classe `sensitive` servie comme une confirmation en deux temps : `catalog.test.ts`, « should announce the
  // two-step confirmation of a sensitive function ».
})

describe("guards before the database (H85)", () => {
  it("should refuse a live or sandbox account without writing anything", async () => {
    for (const mode of ["reel", "sandbox"] as const) {
      const error = await refusal(run(mailCreateDraft, { ...ACCOUNT, mode }, DRAFT))
      expect(error.code, mode).toBe("unavailable_in_v1")
    }
    const live = await refusal(run(mailSendDraft, { ...ACCOUNT, mode: "reel" }, { id: "sim_1a2b3c4d" }))
    expect(live.message).toBe(
      "Account « Mail Ventes » is a live account (mode reel): this connector is simulated in this version and runs on simulated accounts only. Nothing was sent.",
    )
    const sandbox = await refusal(run(mailSendDraft, { ...ACCOUNT, mode: "sandbox" }, { id: "sim_1a2b3c4d" }))
    expect(sandbox.message).toContain("is a sandbox account (mode sandbox)")
  })

  it("should fail as internal when the call brings no mail account", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    expect((await refusal(run(mailCreateDraft, undefined, DRAFT))).code).toBe("internal")
    expect((await refusal(run(mailCreateDraft, { ...ACCOUNT, connector: "sellsy" }, DRAFT))).code).toBe("internal")
    expect(log).toHaveBeenCalledWith("[platform] mail: called without a resolved mail account")
  })
})

// Sur la base réelle (E01-S10, lot t1-d1) : O de la fixture de référence et ses brouillons, que chaque
// cas retrouve (`beforeEach`) ; une course se joue par une autre requête, avant celle du service
// (`before` de `spyDb`, sur la face SQL où `mail.ts` est passé au lot d1).
describe.skipIf(!sqlConfigured)(portable("mail on a real database (AC18, E01-S07 AC23)"), { timeout: 60_000 }, () => {
  const ID = "sim_1a2b3c4d"
  let seed: SeededData
  let ref: ReferenceOrgSql

  beforeAll(async () => {
    seed = seedWithAdmin()
    ref = await seedReferenceOrg(seed)
  }, 180_000)

  afterAll(async () => {
    await seed?.cleanup()
  }, 180_000)

  const draft = (id: string, accountId: string): Row => ({
    id,
    org_id: ORG.id,
    account_id: accountId,
    connector: "mail",
    function: "mail.create_draft",
    payload: DRAFT,
    status: "draft",
    created_by: PEOPLE.claire.id,
    sent_by: null,
    sent_at: null,
  })

  beforeEach(async () => {
    await seed.admin`delete from platform.sim_outbox where org_id = ${ref.org.id}`
    await ref.write({ sim_outbox: [draft(ID, ACCOUNTS.ventes.id), draft("sim_0000000a", ACCOUNTS.ventes.id), draft("sim_0000000b", ACCOUNTS.claire.id)] })
  })

  /** « Mail Ventes » de O, résolu au niveau `level` (calculé par `access.ts` à la résolution). */
  const mailVentes = (level: ResolvedAccount["level"] = "write"): ResolvedAccount => ({
    ...ACCOUNT,
    id: ref.id(ACCOUNTS.ventes.id),
    owner: { ...ACCOUNT.owner, teamId: ref.id(TEAMS.ventes.id) },
    level,
  })

  /** Une requête de `sim_outbox`, sur l'une ou l'autre face. */
  const onOutbox = (query: SentQuery, op: SentQuery["op"]) => query.target === "sim_outbox" && query.op === op

  /** L'état d'un brouillon posé par une autre requête : envoyé à cette date, ou de nouveau à envoyer. */
  async function markDraft(id: string, sentAt: string | null): Promise<void> {
    await seed.admin`update platform.sim_outbox set status = ${sentAt ? "sent" : "draft"}, sent_at = ${sentAt} where id = ${id}`
  }

  describe("send guarded by status draft (AC18, N36)", () => {
    function send(db: PlatformDb) {
      // Le type commun du catalogue efface les arguments en `never` ; ceux-ci suivent le schéma de la fonction.
      return mailSendDraft.run({ db, identity: ref.identityOf("claire"), account: mailVentes() }, { id: ref.id(ID) } as never)
    }

    it("should refuse a draft that another send marked sent between the read and the guarded update, with its date", async () => {
      const id = ref.id(ID)
      const { db } = spyDb(await ref.db("claire"), {
        before: async (query) => {
          if (onOutbox(query, "update")) await markDraft(id, "2026-09-23T14:02:00Z")
        },
      })
      const error = await refusal(send(db))
      expect(error.code).toBe("conflict")
      expect(error.message).toBe(`Draft ${id} was already sent on 2026-09-23 14:02 UTC.`)
      // La mise à jour gardée par l'identifiant et l'état : l'envoi de l'autre requête reste le sien, les
      // deux autres brouillons restent à envoyer.
      const rows = await seed.admin<{ id: string; status: string; sent_by: string | null }[]>`
        select id, status, sent_by from platform.sim_outbox where org_id = ${ref.org.id}`
      expect(ref.readable([...rows]).sort((a, b) => a.id.localeCompare(b.id))).toEqual([
        { id: "sim_0000000a", status: "draft", sent_by: null },
        { id: "sim_0000000b", status: "draft", sent_by: null },
        { id: ID, status: "sent", sent_by: null },
      ])
    })

    // E01-S07 AC27 : aucune ligne écrite après une décision positive est un conflit, jamais un refus.
    it("should answer conflict when the guarded update changes no row while the draft is still to send", async () => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {})
      const id = ref.id(ID)
      // Envoyé par une autre requête juste avant la mise à jour gardée, de nouveau à envoyer avant la relecture.
      let updated = false
      const { db } = spyDb(await ref.db("claire"), {
        before: async (query) => {
          if (onOutbox(query, "update")) {
            updated = true
            await markDraft(id, "2026-09-23T14:02:00Z")
          } else if (updated && onOutbox(query, "select")) await markDraft(id, null)
        },
      })
      const error = await refusal(send(db))
      expect(error.code).toBe("conflict")
      expect(error.message).toBe(`Draft ${id} changed meanwhile. Retry the call.`)
      expect(log).toHaveBeenCalledWith(`[platform] mail.send_draft: no row written for draft ${id}`)
    })
  })

  describe("level on the account decided before sim_outbox is written (E01-S07 AC23)", () => {
    it("should refuse a read-only account before inserting or updating, and never name the account of a draft the person cannot see", async () => {
      const { db, writes } = recordDb(await ref.db("lea"))
      /** Léa, avec « Mail Ventes » de O résolu au niveau `level`. */
      const asLea = (fn: CatalogFunction, level: ResolvedAccount["level"], args: Record<string, unknown>) =>
        // Le type commun du catalogue efface les arguments en `never` ; ceux-ci suivent le schéma de la fonction.
        fn.run({ db, identity: ref.identityOf("lea"), account: mailVentes(level) }, args as never)
      const [ventesDraft, claireDraft] = [ref.id("sim_0000000a"), ref.id("sim_0000000b")]
      // Le refus dit à qui demander (H68), comme celui de la résolution pour la même condition.
      expect(await refusal(asLea(mailCreateDraft, "read", DRAFT))).toMatchObject({
        code: "forbidden",
        message: "Account « Mail Ventes » cannot save a draft for you (write access needed). Ask team Ventes (lead: Claire Morel) for access.",
      })
      expect(await refusal(asLea(mailSendDraft, "read", { id: ventesDraft }))).toMatchObject({
        code: "forbidden",
        message: `Account « Mail Ventes » cannot send draft ${ventesDraft} for you (write access needed). Ask team Ventes (lead: Claire Morel) for access.`,
      })
      // Le brouillon du compte personnel de Claire, que Léa ne voit pas : inconnu, jamais « appartient à « Mail Claire » ».
      expect(await refusal(asLea(mailSendDraft, "write", { id: claireDraft }))).toMatchObject({
        code: "not_found",
        message: `Unknown draft ${claireDraft}. Create one with mail.create_draft.`,
      })
      expect(writes()).toEqual([])
    })
  })
})
