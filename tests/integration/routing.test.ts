// @vitest-environment node
// Test de routage sans host (E03-S02, AC6 ; H43 amendé, P37) sur une vraie base : le classement de
// `route_candidates` est le sujet. Une organisation jetable, les dix procédures d'Acme semées par
// `seedNodes` (seul leur résumé porte leurs formulations), la personne « jb » (administrateur, membre de
// Ventes, Support et Conseil) ; chaque phrase passe par `rankCandidates` puis `decide` au réglage par
// défaut, sous la session de jb. Repris de la maquette
// (`mcp-test/tests/integration/proto-routing.test.ts` l. 14-81) : métriques et ligne de rapport ;
// retiré : Delta, les phrases stockées et les voisines (P37), le synonyme « PdV » (ADR-011 § 7). Suite
// portable depuis E01-S10 f2 (jb par `fx.as`, sans Supabase Auth ni PostgREST) : le job `bare-postgres` la joue.
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { hex } from "../helpers/plateforme"
import { createSqlFixtures, SQL_SKIP_REASON, sqlConfigured, type SqlFixtures } from "../helpers/sql"
import { blockInputSchema, normalizeTitle } from "../../packages/plateforme/schemas"
import type { PlatformDb } from "../../packages/plateforme/server/db"
import { resolveIdentity, type Identity } from "../../packages/plateforme/server/identity"
import { CANDIDATES_SHOWN, decide, rankCandidates, routingSettings } from "../../packages/plateforme/server/routing"
import { ACME_PEOPLE, ACME_PROCEDURES, ACME_TEAMS, acmeProfile, seedNodesOf, type AcmeTeam } from "./fixtures/acme"
import { ACME_AMBIGUOUS, ACME_FORMULATIONS, ACME_NEGATIVES, ACME_PARAPHRASES, type RoutingCase } from "./fixtures/acme-routing.cases"
import { TODO_CASES, TODO_PROCEDURES, type TodoRoutingCase } from "./fixtures/todo-routing.cases"
import { SCALE_CASES, SCALE_FORMULATIONS, SCALE_PROCEDURES, type ScaleRoutingCase } from "./fixtures/scale-routing.cases"

const NETWORK_TIMEOUT = 180_000
const SETUP_TIMEOUT = 240_000
/** Phrases routées en même temps : le projet est partagé par les agents (quatre allers-retours chacune). */
const CONCURRENCY = 6

type Outcome = RoutingCase & { top: string | null; served: string | null }

/** Sans casse ni accent (`normalizeTitle`), apostrophes typographiques ramenées : la forme que compare la précondition. */
const plain = (text: string) => normalizeTitle(text).replace(/’/g, "'")

/** Juste : la procédure attendue, ou, sans attente, toute autre que celle interdite. */
function correct(outcome: Outcome): boolean {
  if (outcome.expect === undefined) return outcome.served !== outcome.forbid
  return outcome.served === outcome.expect
}

function report(outcomes: Outcome[]) {
  const withExpectation = outcomes.filter((outcome) => outcome.kind !== "ambiguous")
  const served = withExpectation.filter((outcome) => outcome.served)
  const rate = (kind: RoutingCase["kind"]) => {
    const all = outcomes.filter((outcome) => outcome.kind === kind)
    return { served: all.filter((outcome) => outcome.served === outcome.expect).length, of: all.length }
  }
  const named = outcomes.filter((outcome) => typeof outcome.expect === "string")
  const metrics = {
    phrases: outcomes.length,
    served: outcomes.filter((outcome) => outcome.served).length,
    precision: served.length ? served.filter(correct).length / served.length : 1,
    formulations: rate("formulation"),
    paraphrases: rate("paraphrase"),
    ambiguousServed: outcomes.filter((outcome) => outcome.kind === "ambiguous" && outcome.served).length,
    top1: named.filter((outcome) => outcome.top === outcome.expect).length / Math.max(1, named.length),
  }
  const percent = (value: number) => `${(value * 100).toFixed(1)} %`
  console.log(
    `[routage Acme] ${metrics.phrases} phrases, ${metrics.served} servies, précision ${percent(metrics.precision)}, ` +
      `formulations ${metrics.formulations.served}/${metrics.formulations.of}, paraphrases ${metrics.paraphrases.served}/${metrics.paraphrases.of}, ` +
      `ambiguës servies ${metrics.ambiguousServed}/${ACME_AMBIGUOUS.length}, premier candidat juste ${percent(metrics.top1)}`,
  )
  for (const outcome of served.filter((candidate) => !correct(candidate))) console.log(`  ✗ ${outcome.kind} « ${outcome.phrase} » → ${outcome.served}`)
  for (const outcome of outcomes.filter((candidate) => candidate.kind !== "negative" && candidate.expect && candidate.served !== candidate.expect)) {
    console.log(`  · non servie : ${outcome.kind} « ${outcome.phrase} » (premier candidat ${outcome.top})`)
  }
  for (const outcome of outcomes.filter((candidate) => candidate.kind === "ambiguous" && candidate.served)) {
    console.log(`  · ambiguë servie : « ${outcome.phrase} » → ${outcome.served}`)
  }
  return metrics
}

describe.skipIf(!sqlConfigured)(
  sqlConfigured ? "routing without a host on Acme (AC6)" : `routing without a host on Acme (AC6) (${SQL_SKIP_REASON})`,
  { timeout: NETWORK_TIMEOUT },
  () => {
    let fx: SqlFixtures
    let db: PlatformDb
    let jb: Identity

    beforeAll(async () => {
      fx = createSqlFixtures()
      const host = `t${hex(4)}.example.invalid`
      const org = await fx.createOrg({ name: "Acme Énergies", hosts: [host] })
      // L'arbre d'abord : dossiers d'équipe et Contextes naissent avec les équipes (P39).
      await fx.createTree(org.id)
      const user = await fx.createUser({ fullName: ACME_PEOPLE.jb.name })
      const createTeam = async (team: AcmeTeam) => {
        const lead = ACME_TEAMS[team].lead === "jb" ? { leadUserId: user.id } : {}
        return (await fx.createTeam(org.id, { slug: team, name: ACME_TEAMS[team].name, ...lead })).id
      }
      const teamIds: Record<AcmeTeam, string> = { ventes: await createTeam("ventes"), support: await createTeam("support"), conseil: await createTeam("conseil") }
      await fx.addMember(org.id, user.id, { role: "admin", profile: acmeProfile("jb") })
      for (const team of ACME_PEOPLE.jb.teams) await fx.addTeamMember(teamIds[team], user.id)
      await fx.seedNodes(org.id, seedNodesOf(ACME_PROCEDURES, teamIds))
      db = fx.as(user)
      jb = await resolveIdentity(db, host, { userId: user.id, email: user.email })
    }, SETUP_TIMEOUT)

    afterAll(async () => {
      await fx?.cleanup()
    }, SETUP_TIMEOUT)

    async function route(cases: RoutingCase[]): Promise<Outcome[]> {
      const outcomes: Outcome[] = []
      for (let at = 0; at < cases.length; at += CONCURRENCY) {
        const batch = cases.slice(at, at + CONCURRENCY)
        outcomes.push(
          ...(await Promise.all(
            batch.map(async (routingCase) => {
              const candidates = await rankCandidates(db, jb, { query: routingCase.phrase, limit: 3 })
              return { ...routingCase, top: candidates[0]?.path ?? null, served: decide(candidates, routingSettings(null))?.path ?? null }
            }),
          )),
        )
      }
      return outcomes
    }

    it("should serve ≥ 95 % of the formulations, no negative on the procedure it forbids, no step outside the procedures", async () => {
      // Préconditions : chaque formulation est dans le résumé de sa procédure ; chaque bloc semé passe le schéma.
      for (const formulation of ACME_FORMULATIONS) {
        const summary = ACME_PROCEDURES.find((node) => node.path === formulation.expect)?.summary ?? ""
        expect(plain(summary), formulation.phrase).toContain(plain(formulation.phrase))
      }
      for (const block of ACME_PROCEDURES.flatMap((node) => node.blocks)) expect(blockInputSchema.safeParse(block).success).toBe(true)

      const outcomes = await route([...ACME_FORMULATIONS, ...ACME_PARAPHRASES, ...ACME_NEGATIVES, ...ACME_AMBIGUOUS])
      const metrics = report(outcomes)

      expect(metrics.formulations.served / metrics.formulations.of).toBeGreaterThanOrEqual(0.95)
      expect(metrics.precision).toBeGreaterThanOrEqual(0.95)
      for (const outcome of outcomes.filter((candidate) => candidate.forbid)) expect(outcome.served, outcome.phrase).not.toBe(outcome.forbid)
      for (const outcome of outcomes.filter((candidate) => candidate.expect === null)) expect(outcome.served, outcome.phrase).toBeNull()
    })
  },
)

// Jeu « todo » (E11-S04, AC-c1) : une organisation jetable, une personne membre, les quatre procédures
// d'organisation du rapport de tests, sans bonus d'équipe ni d'usage, au réglage par défaut.
describe.skipIf(!sqlConfigured)(
  sqlConfigured ? "routing without a host on the todo (E11-S04, AC-c1)" : `routing without a host on the todo (E11-S04, AC-c1) (${SQL_SKIP_REASON})`,
  { timeout: NETWORK_TIMEOUT },
  () => {
    let fx: SqlFixtures
    let db: PlatformDb
    let member: Identity

    beforeAll(async () => {
      fx = createSqlFixtures()
      const host = `t${hex(4)}.example.invalid`
      const org = await fx.createOrg({ name: "Todo Test", hosts: [host] })
      await fx.createTree(org.id)
      const user = await fx.createUser({ fullName: "Membre Todo" })
      await fx.addMember(org.id, user.id, { role: "member" })
      await fx.seedNodes(org.id, TODO_PROCEDURES)
      db = fx.as(user)
      member = await resolveIdentity(db, host, { userId: user.id, email: user.email })
    }, SETUP_TIMEOUT)

    afterAll(async () => {
      await fx?.cleanup()
    }, SETUP_TIMEOUT)

    it("should serve, rank first or show the expected procedure for each phrase of the report, and never serve the others", async () => {
      const outcomes: (TodoRoutingCase & { served: string | null; shown: string[] })[] = []
      for (const todoCase of TODO_CASES) {
        const candidates = await rankCandidates(db, member, { query: todoCase.phrase, limit: CANDIDATES_SHOWN })
        const served = decide(candidates, routingSettings(null))?.path ?? null
        console.log(`[routage todo] « ${todoCase.phrase} » → ${served ?? "rien de servi"} ; ${candidates.map((c) => `${c.path} ${c.score.toFixed(2)}`).join(", ")}`)
        outcomes.push({ ...todoCase, served, shown: candidates.map((candidate) => candidate.path) })
      }
      const verdict = (outcome: (typeof outcomes)[number]) => {
        if (outcome.expect === "served") return outcome.served === outcome.path
        if (outcome.expect === "first") return outcome.shown[0] === outcome.path && [null, outcome.path].includes(outcome.served)
        if (outcome.expect === "shown") return outcome.shown.includes(outcome.path ?? "") && [null, outcome.path].includes(outcome.served)
        return outcome.served === null
      }
      expect(outcomes.filter((outcome) => !verdict(outcome)).map(({ phrase, served, shown }) => ({ phrase, served, shown }))).toEqual([])
    })
  },
)

// Jeu « à l'échelle » : soixante procédures d'organisation, dont des voisines volontaires, la personne
// membre, sans bonus d'équipe ni d'usage, au réglage par défaut. Le sujet (E11-S16, AC-a6) : quand les
// procédures se comptent par dizaines, la demandée est servie ou parmi les candidates que l'assistant départage.
describe.skipIf(!sqlConfigured)(
  sqlConfigured ? "routing without a host among sixty procedures" : `routing without a host among sixty procedures (${SQL_SKIP_REASON})`,
  { timeout: NETWORK_TIMEOUT },
  () => {
    let fx: SqlFixtures
    let db: PlatformDb
    let member: Identity

    beforeAll(async () => {
      fx = createSqlFixtures()
      const host = `t${hex(4)}.example.invalid`
      const org = await fx.createOrg({ name: "Scale Test", hosts: [host] })
      await fx.createTree(org.id)
      const user = await fx.createUser({ fullName: "Membre Échelle" })
      await fx.addMember(org.id, user.id, { role: "member" })
      await fx.seedNodes(org.id, SCALE_PROCEDURES)
      db = fx.as(user)
      member = await resolveIdentity(db, host, { userId: user.id, email: user.email })
    }, SETUP_TIMEOUT)

    afterAll(async () => {
      await fx?.cleanup()
    }, SETUP_TIMEOUT)

    it("should serve ≥ 95 % of the formulations, show the asked procedure among the candidates, and serve nothing off topic", async () => {
      const outcomes: (ScaleRoutingCase & { served: string | null; top: string | null; shown: string[] })[] = []
      for (let at = 0; at < SCALE_CASES.length; at += CONCURRENCY) {
        const batch = SCALE_CASES.slice(at, at + CONCURRENCY)
        outcomes.push(
          ...(await Promise.all(
            batch.map(async (scaleCase) => {
              const candidates = await rankCandidates(db, member, { query: scaleCase.phrase, limit: CANDIDATES_SHOWN })
              const shown = candidates.map((candidate) => candidate.path)
              return { ...scaleCase, served: decide(candidates, routingSettings(null))?.path ?? null, top: shown[0] ?? null, shown }
            }),
          )),
        )
      }
      const formulations = outcomes.filter((outcome) => outcome.kind === "formulation")
      const paraphrases = outcomes.filter((outcome) => outcome.kind === "paraphrase")
      const count = (all: typeof outcomes, kept: (outcome: (typeof outcomes)[number]) => boolean) => `${all.filter(kept).length}/${all.length}`
      console.log(
        `[routage échelle] ${SCALE_PROCEDURES.length} procédures, ${outcomes.length} phrases ; formulations servies ${count(formulations, (o) => o.served === o.path)}, ` +
          `paraphrases servies ${count(paraphrases, (o) => o.served === o.path)}, en tête ${count(paraphrases, (o) => o.top === o.path)}, ` +
          `montrées ${count(paraphrases, (o) => o.shown.includes(o.path ?? ""))}`,
      )
      for (const outcome of outcomes.filter((candidate) => candidate.path && candidate.served !== candidate.path)) {
        const rank = outcome.shown.indexOf(outcome.path ?? "")
        console.log(`  · ${outcome.kind} « ${outcome.phrase} » → ${outcome.served ?? "rien de servi"} (rang ${rank === -1 ? "absent" : rank + 1})`)
      }

      // AC-a1 : cinq candidates montrées au plus depuis le 2026-10-27 (trois avant), sur une phrase qui en a davantage
      // au-dessus de 0,30.
      const wide = "Peux-tu relancer les clients qui n'ont pas répondu à nos devis ?"
      expect((await rankCandidates(db, member, { query: wide, limit: 50 })).length).toBeGreaterThan(CANDIDATES_SHOWN)
      expect(outcomes.find((outcome) => outcome.phrase === wide)?.shown).toHaveLength(CANDIDATES_SHOWN)
      expect(formulations.length).toBe(SCALE_FORMULATIONS.length)
      expect(formulations.filter((outcome) => outcome.served === outcome.path).length / formulations.length).toBeGreaterThanOrEqual(0.95)
      const missed = outcomes.filter(
        (outcome) => (outcome.expect === "shown" && !outcome.shown.includes(outcome.path ?? "")) || (outcome.expect === "never" && outcome.served !== null),
      )
      expect(missed.map(({ phrase, served, shown }) => ({ phrase, served, shown }))).toEqual([])
    })
  },
)
