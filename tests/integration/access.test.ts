// @vitest-environment node
// Niveaux et refus « à qui demander » d'E01-S04 (AC21, H68), décidés par `access.ts` sur une vraie base,
// en suite portable (E01-S10, partie e1a : les lectures d'`access.ts`, d'`access-facts.ts` et de
// `directory.ts` passent au SQL ; AC-x3, fiche D76 A) : sans RPC de niveau (E01-S07 AC14), et rien d'une
// autre organisation de l'appelant (HN-E01S07-17). O et P de `seedReferenceOrg` ; chaque personne agit par
// son propre client (`asCaller`), qu'un espion (`spyDb`) regarde ; une règle, un responsable changés par
// un cas le sont par la connexion d'administration, et rendus après lui. Le texte des refus sans base est
// dans `tests/unit/access.test.ts`.
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  accountLevel,
  accountLevels,
  describeOwner,
  nodeLevel,
  nodeLevels,
  requireAccountLevel,
  requireNodeLevel,
} from "../../packages/plateforme/server/access"
import type { PlatformDb } from "../../packages/plateforme/server/db"
import { ACCOUNTS, OTHER_ORG, TEAMS, type Person, type RuleSpec } from "../helpers/reference-org"
import { seedReferenceOrg, type ReferenceOrgSql } from "../helpers/reference-org-sql"
import { asCaller, seedWithAdmin, spyDb, SQL_SKIP_REASON, sqlConfigured, type SeededData, type SentQuery } from "../helpers/sql"

const SETUP_TIMEOUT = 180_000
const SUITE = "access decisions on a real database"

describe.skipIf(!sqlConfigured)(sqlConfigured ? SUITE : `${SUITE} (${SQL_SKIP_REASON})`, () => {
  let seed: SeededData
  let ref: ReferenceOrgSql
  const sent: SentQuery[][] = []

  beforeAll(async () => {
    seed = seedWithAdmin()
    ref = await seedReferenceOrg(seed)
  }, SETUP_TIMEOUT)

  afterAll(async () => {
    await seed?.cleanup()
  }, SETUP_TIMEOUT)

  /** Le client de la personne, espionné : chaque instruction qu'il envoie rejoint `sent`. */
  function dbOf(person: Person): PlatformDb {
    const spied = spyDb(asCaller(ref.people[person].id, ref.people[person].email))
    sent.push(spied.sent)
    return spied.db
  }

  /** Aucune fonction lue hors de `member_directory`, qui nomme à qui demander : aucun niveau lu en base. */
  const levelFunctions = () => sent.flat().filter((query) => query.op === "call" && query.target !== "member_directory")

  /** `rules` posées le temps de `run`, retirées ensuite, même en échec. */
  async function withRules(rules: RuleSpec[], run: () => Promise<void>): Promise<void> {
    const ids = await ref.addRules(rules)
    try {
      await run()
    } finally {
      await seed.admin`delete from platform.access_rules where id in ${seed.admin(ids)}`
    }
  }

  /**
   * Le seul responsable de Support posé à `lead` (`team_members.role`, E05-S13) le temps de `run`, Paul rendu
   * ensuite, et l'appartenance d'un autre retirée.
   */
  async function withSupportLead(lead: string | null, run: () => Promise<void>): Promise<void> {
    const support = ref.id(TEAMS.support.id)
    await seed.admin`update platform.team_members set role = 'member' where team_id = ${support} and role = 'lead'`
    if (lead) await seed.admin`insert into platform.team_members (team_id, user_id, role) values (${support}, ${lead}, 'lead')`
    try {
      await run()
    } finally {
      if (lead) await seed.admin`delete from platform.team_members where team_id = ${support} and user_id = ${lead}`
      await seed.admin`update platform.team_members set role = 'lead' where team_id = ${support} and user_id = ${ref.people.paul.id}`
    }
  }

  describe("describeOwner", () => {
    const team = (key: keyof typeof TEAMS) => ({ kind: "team" as const, teamId: ref.id(TEAMS[key].id), userId: null })

    it("should name a team and its lead", async () => {
      expect(await describeOwner(dbOf("lea"), ref.identityOf("lea"), team("ventes"))).toBe("team Ventes (lead: Claire Morel)")
    })

    it("should name a team without a lead by its name only", async () => {
      await withSupportLead(null, async () => {
        expect(await describeOwner(dbOf("lea"), ref.identityOf("lea"), team("support"))).toBe("team Support")
      })
    })

    it("should name a team whose lead left the organisation by its name only", async () => {
      // Un responsable qui n'est plus membre : l'annuaire ne le connaît pas.
      await withSupportLead(seed.person().id, async () => {
        expect(await describeOwner(dbOf("lea"), ref.identityOf("lea"), team("support"))).toBe("team Support")
      })
    })

    it("should name the administrators of the organisation", async () => {
      expect(await describeOwner(dbOf("lea"), ref.identityOf("lea"), { kind: "org", teamId: null, userId: null })).toBe(
        "the administrators of Acme Test (Ada Martin)",
      )
    })
  })

  describe("decisions (E01-S07 AC14)", () => {
    const devis = () => ({ id: ref.nodeId("ventes/devis"), path: "ventes/devis" })

    it("should give the node levels and the node refusals of E01-S04 AC21", async () => {
      const [ada, lea, paul] = [ref.identityOf("ada"), ref.identityOf("lea"), ref.identityOf("paul")]
      const levels = [nodeLevel(dbOf("paul"), paul, devis().id), nodeLevel(dbOf("lea"), lea, ref.nodeId("guide")), nodeLevel(dbOf("lea"), lea, devis().id)]
      expect(await Promise.all([...levels, nodeLevel(dbOf("lea"), lea, ref.nodeId("private/lea"))])).toEqual([0, 1, 2, 3])
      await expect(requireNodeLevel(dbOf("paul"), paul, devis(), "write")).rejects.toMatchObject({ code: "not_found", message: "Unknown path ventes/devis." })
      await withRules([{ node: "ventes/devis", team: "support", level: "read" }], async () => {
        await expect(requireNodeLevel(dbOf("paul"), paul, devis(), "write")).rejects.toMatchObject({
          code: "forbidden",
          message: "Writing ventes/devis is reserved to team Ventes (lead: Claire Morel). Ask them for access.",
        })
      })
      expect(await requireNodeLevel(dbOf("lea"), lea, devis(), "write")).toBe(2)
      // Écrire publie, et le chemin suit le titre au niveau écriture (E11-S02, H63 remplacée, HN-E11S02-18) ;
      // déplacer reste à la gestion.
      expect(await requireNodeLevel(dbOf("lea"), lea, devis(), "publish")).toBe(2)
      expect(await requireNodeLevel(dbOf("lea"), lea, devis(), "rename")).toBe(2)
      await expect(requireNodeLevel(dbOf("lea"), lea, devis(), "move")).rejects.toMatchObject({
        code: "forbidden",
        message: "Moving ventes/devis is reserved to team Ventes (lead: Claire Morel). Ask them to move it.",
      })
      await expect(requireNodeLevel(dbOf("lea"), lea, { id: ref.nodeId("annonces"), path: "annonces" }, "write")).rejects.toMatchObject({
        code: "forbidden",
        message: "Writing annonces is reserved to the administrators of Acme Test (Ada Martin). Ask them for access.",
      })
      const faq = { id: ref.nodeId("support/faq"), path: "support/faq" }
      await withRules([{ node: "support/faq", team: "ventes", level: "read" }], () =>
        withSupportLead(null, async () => {
          await expect(requireNodeLevel(dbOf("lea"), lea, faq, "write")).rejects.toMatchObject({
            code: "forbidden",
            message: "Writing support/faq is reserved to team Support. Ask them for access.",
          })
        }),
      )
      const notes = { id: ref.nodeId("private/claire/notes"), path: "private/claire/notes" }
      await withRules([{ node: "private/claire/notes", user: "ada", level: "read" }], async () => {
        await expect(requireNodeLevel(dbOf("ada"), ada, notes, "write")).rejects.toMatchObject({
          code: "forbidden",
          message: "Writing private/claire/notes is reserved to its owner. Ask them for access.",
        })
      })
      expect(levelFunctions()).toEqual([])
    })

    it("should give the account levels and the account refusals of E01-S04 AC21", async () => {
      const [lea, paul] = [ref.identityOf("lea"), ref.identityOf("paul")]
      const mail = { id: ref.id(ACCOUNTS.ventes.id), label: "Mail Ventes" }
      const levels = [accountLevel(dbOf("paul"), paul, mail.id), accountLevel(dbOf("lea"), lea, mail.id)]
      expect(await Promise.all([...levels, accountLevel(dbOf("claire"), ref.identityOf("claire"), ref.id(ACCOUNTS.claire.id))])).toEqual([0, 3, 4])
      await expect(requireAccountLevel(dbOf("paul"), paul, mail, 2)).rejects.toMatchObject({ code: "not_found", message: "Unknown account « Mail Ventes »." })
      await withRules([{ account: "ventes", team: "support", level: "read" }], async () => {
        expect(await requireAccountLevel(dbOf("paul"), paul, mail, 1)).toBe(1)
        await expect(requireAccountLevel(dbOf("paul"), paul, mail, 2)).rejects.toMatchObject({
          code: "forbidden",
          message: "Using account « Mail Ventes » is reserved to team Ventes (lead: Claire Morel). Ask them for access.",
        })
      })
      // Partage des comptes (#68) : une règle d'organisation sur un compte personnel, en base, ouvre l'écriture à tout
      // membre et pas les fonctions sensibles, au-dessus.
      const mailClaire = { id: ref.id(ACCOUNTS.claire.id), label: "Mail Claire" }
      await withRules([{ account: "claire", org: true, level: "write" }], async () => {
        expect(await requireAccountLevel(dbOf("paul"), paul, mailClaire, 2)).toBe(2)
        await expect(requireAccountLevel(dbOf("paul"), paul, mailClaire, 3)).rejects.toMatchObject({ code: "forbidden" })
      })
      expect(levelFunctions()).toEqual([])
    })

    it("should give nothing of another organisation of the caller at the address of O (HN-E01S07-17)", async () => {
      // Léa, aussi membre de P où des règles lui donnent la gestion, et Ada, qui administre O : sans la
      // garde de l'organisation, chacune aurait 3 sur le nœud et le compte de P.
      const node = { id: ref.id(OTHER_ORG.node.id), path: OTHER_ORG.node.path }
      const account = { id: ref.id(OTHER_ORG.account.id), label: OTHER_ORG.account.label }
      for (const who of ["lea", "ada"] as const) {
        const identity = ref.identityOf(who)
        expect([await nodeLevel(dbOf(who), identity, node.id), await accountLevel(dbOf(who), identity, account.id)]).toEqual([0, 0])
        expect([...(await nodeLevels(dbOf(who), identity, [ref.id(OTHER_ORG.root), node.id])).values()]).toEqual([0, 0])
        expect([...(await accountLevels(dbOf(who), identity, [account.id])).values()]).toEqual([0])
        await expect(requireNodeLevel(dbOf(who), identity, node, "write")).rejects.toMatchObject({ code: "not_found", message: "Unknown path ventes." })
        await expect(requireAccountLevel(dbOf(who), identity, account, 1)).rejects.toMatchObject({
          code: "not_found",
          message: "Unknown account « Mail Other ».",
        })
      }
      // Les chemins de P répètent ceux de O : les ancêtres de `ventes/devis` restent ceux de O.
      expect(await nodeLevels(dbOf("lea"), ref.identityOf("lea"), [devis().id])).toEqual(new Map([[devis().id, 2]]))
    })
  })
})
