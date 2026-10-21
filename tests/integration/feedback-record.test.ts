// @vitest-environment node
// `recordFeedback` sur une base réelle (E01-S07 AC24 ; E01-S10, lot e2a) : la recherche du doublon ne
// lit que les tickets de la personne dans l'organisation de l'adresse, et l'insertion écrit le sien.
// L'organisation O de la fixture (`seedReferenceOrg`), et P, dont Léa est aussi membre : l'isolation seule
// (E01-S08) lui rend les tickets de O de Claire et les siens dans P, que le service doit écarter
// (`security-patterns.md § Droits dans le service`). Portable (AC-x3, fiche D76) : sans Supabase Auth,
// Léa appelle par `asCaller`, la connexion d'administration pose et relit les tickets ; le job
// `bare-postgres` joue ce fichier. Déplacé de `tests/unit/feedback.test.ts`, où il tournait sur la base
// simulée du constructeur PostgREST, que la face SQL de `feedback.ts` n'emprunte plus.
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { recordFeedback } from "../../packages/plateforme/server/feedback"
import { ORG, OTHER_ORG, PEOPLE } from "../helpers/reference-org"
import { seedReferenceOrg, type ReferenceOrgSql } from "../helpers/reference-org-sql"
import type { Row } from "../helpers/simulated-db"
import { asCaller, seedWithAdmin, SQL_SKIP_REASON, sqlConfigured, type SeededData } from "../helpers/sql"

const SETUP_TIMEOUT = 120_000
const REPORT = { type: "friction" as const, text: "Le devis ne se relit pas.", target: "ventes/devis" }

let seed: SeededData
let ref: ReferenceOrgSql

const minuteAgo = () => new Date(Date.now() - 60_000).toISOString()

/** Un ticket du même signalement, déposé il y a une minute ; son id, la base le tire, et la fixture lui remet son numéro. */
const ticket = (number: number, org: string, person: "lea" | "claire"): Row => ({
  org_id: org,
  user_id: PEOPLE[person].id,
  number,
  state: "open",
  created_at: minuteAgo(),
  ctx: null,
  ...REPORT,
})

/** Les tickets de O et de P : chaque moitié du cas pose les siens. */
async function replaceTickets(rows: Row[]): Promise<void> {
  await seed.admin`delete from platform.feedback where org_id in ${seed.admin([ref.org.id, ref.other.id])}`
  await ref.write({ feedback: rows })
}

/** Les tickets de O puis de P, relus par la connexion d'administration, en identifiants simulés. */
async function tickets(): Promise<Row[]> {
  const rows = await seed.admin<Row[]>`
    select org_id, user_id, number, ctx, type, text, target, state from platform.feedback
    where org_id in ${seed.admin([ref.org.id, ref.other.id])}`
  const organisations: string[] = [ORG.id, OTHER_ORG.id]
  return ref.readable([...rows]).sort((a, b) => organisations.indexOf(String(a.org_id)) - organisations.indexOf(String(b.org_id)) || Number(a.number) - Number(b.number))
}

describe.skipIf(!sqlConfigured)(
  sqlConfigured ? "recordFeedback reads and writes the caller's tickets only (E01-S07 AC24)" : `recordFeedback reads and writes the caller's tickets only (E01-S07 AC24) (${SQL_SKIP_REASON})`,
  () => {
    beforeAll(async () => {
      seed = seedWithAdmin()
      ref = await seedReferenceOrg(seed)
    }, SETUP_TIMEOUT)

    afterAll(async () => {
      await seed?.cleanup()
    }, SETUP_TIMEOUT)

    it("should take neither another person's nor another organisation's same report for a duplicate, and write the caller's ticket", async () => {
      const lea = asCaller(ref.people.lea.id, ref.people.lea.email)
      // Le même signalement, il y a une minute : de Claire dans O, de Léa dans P ; la base rend les deux à Léa.
      await replaceTickets([ticket(1, ORG.id, "claire"), ticket(2, OTHER_ORG.id, "lea")])

      // 21/10 : le numéro va au journal (`target`), jamais à ce que lit l'assistant.
      const ecrit = await recordFeedback(lea, ref.identityOf("lea"), REPORT, "7K3Q-M2XA")
      expect([ecrit.target, ecrit.data]).toEqual(["FB-0002", { recorded: true, type: REPORT.type, duplicate: false }])
      expect(ecrit.text).not.toMatch(/FB-/)
      expect(await tickets()).toEqual([
        { org_id: ORG.id, user_id: PEOPLE.claire.id, number: 1, ctx: null, ...REPORT, state: "open" },
        { org_id: ORG.id, user_id: PEOPLE.lea.id, number: 2, ctx: "7K3Q-M2XA", ...REPORT, state: "open" },
        { org_id: OTHER_ORG.id, user_id: PEOPLE.lea.id, number: 2, ctx: null, ...REPORT, state: "open" },
      ])

      // Son propre signalement, lui, est retrouvé.
      await replaceTickets([ticket(3, ORG.id, "lea")])
      const double = await recordFeedback(lea, ref.identityOf("lea"), REPORT, "7K3Q-M2XA")
      expect([double.target, double.data]).toEqual(["FB-0003", { recorded: true, type: REPORT.type, duplicate: true }])
      expect(double.text).not.toMatch(/FB-/)
    })
  },
)
