// @vitest-environment node
// Les blocs de `context` sur la face SQL (E01-S10, lot c2) : ce que les tests réécrits sur base réelle
// par le lot t1-c2 ne prouvent plus (HN-E01S10-t1c2-3 et 4). Une lecture en panne fait rejeter le module
// lui-même, Contextes, nouveautés, procédures utiles, documents récents, équipe et procédure servie, sous un refus qui ne porte
// jamais le texte de la base, la lecture nommée au log serveur : l'assemblage de `context` sert alors les
// en-têtes des Contextes ou omet le bloc (AC13 d'E03-S08, `tests/unit/context-blocks.test.ts`). Le bloc
// équipe lit les responsables de toutes les équipes en une requête (AC22 d'E03-S01) ; « aucune sans
// équipe » est prouvé par `tests/unit/connectors-context.test.ts`.
// Portable : O et P semées par la connexion d'administration (`seedReferenceOrg`), le client d'`asCaller`
// espionné sur ses deux faces (`spyDb`, `tests/helpers/sql.ts`), qui rend la panne à la place de la première
// lecture du module ; aucun module encore sur PostgREST n'est atteint. Les lignes des connecteurs du bloc
// équipe (partie d, `connectors/lines.ts`, prouvées par ses propres tests) sont remplacées par une liste
// vide : le sujet est la lecture des responsables.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { contextBodies } from "../../packages/plateforme/server/context/blocks/contexts"
import { newsItems } from "../../packages/plateforme/server/context/blocks/news"
import { procedureBlock } from "../../packages/plateforme/server/context/blocks/procedure"
import { proceduresBlock } from "../../packages/plateforme/server/context/blocks/procedures"
import { recentBlock } from "../../packages/plateforme/server/context/blocks/recent"
import { teamFacts } from "../../packages/plateforme/server/context/blocks/team"
import type { PlatformDb } from "../../packages/plateforme/server/db"
import type { Identity } from "../../packages/plateforme/server/identity"
import type { Candidate } from "../../packages/plateforme/server/routing"
import { seedReferenceOrg, type ReferenceOrgSql } from "../helpers/reference-org-sql"
import { asCaller, seedWithAdmin, spyDb, SQL_SKIP_REASON, sqlConfigured, type SeededData, type SentQuery } from "../helpers/sql"

vi.mock("../../packages/plateforme/server/connectors/lines", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../packages/plateforme/server/connectors/lines")>()
  return { ...original, teamConnectorLines: vi.fn(async () => ({ everyone: [], teams: new Map() })) }
})

const SETUP_TIMEOUT = 120_000

/** Une panne de lecture (dépassement de délai), rendue par l'espion à la place de la requête visée. */
const TIMEOUT = { code: "57014" }

/**
 * Un bloc, la table de la première lecture de son module (que l'espion fait échouer), ce que le module
 * écrit au log serveur avec le code, et son appel.
 */
type Failure = [block: string, table: string, context: string, run: (db: PlatformDb, identity: Identity) => Promise<unknown>]

/** Une procédure servie par le routage ; sa première lecture échoue avant de partir, son nœud n'est jamais lu. */
const SERVED: Candidate = { nodeId: "00000000-0000-4000-8000-000000000001", path: "ventes/devis", title: "Devis", summary: "Devis", kind: "procedure", ownerTeamId: null, score: 1 }

const FAILURES: Failure[] = [
  ["the Contextes", "nodes", "context: contexts", contextBodies],
  ["what's new", "node_versions", "context: node_versions", (db, identity) => newsItems(db, identity, new Date(Date.now() - 14 * 86_400_000).toISOString())],
  ["the procedures you can run", "nodes", "context: procedures", proceduresBlock],
  ["the recent content", "journal", "context: recent content", recentBlock],
  // Rejet traduit de la lecture des responsables et de celle de la procédure servie (M32, revue de c2).
  ["the team facts", "team_members", "teamFacts: team_members, members", teamFacts],
  ["the procedure served", "nodes", "procedureBlock: nodes and blocks", (db, identity) => procedureBlock(db, SERVED, identity)],
]

describe.skipIf(!sqlConfigured)(sqlConfigured ? "context blocks on the SQL face" : `context blocks on the SQL face (${SQL_SKIP_REASON})`, { timeout: SETUP_TIMEOUT }, () => {
  let seed: SeededData
  let ref: ReferenceOrgSql

  beforeAll(async () => {
    seed = seedWithAdmin()
    ref = await seedReferenceOrg(seed)
  }, SETUP_TIMEOUT)

  afterAll(async () => {
    await seed?.cleanup()
  }, SETUP_TIMEOUT)

  afterEach(() => {
    vi.restoreAllMocks()
  })

  /** Léa, de Ventes (que mène Claire) et de Support (que mène Paul), sous son client espionné. */
  function lea(fail?: (query: SentQuery) => { code: string } | null) {
    const identity = ref.identityOf("lea", { teams: [ref.teamOf("ventes", "lea"), ref.teamOf("support", "lea")] })
    return { identity, ...spyDb(asCaller(ref.people.lea.id, ref.people.lea.email), { fail }) }
  }

  // Une table de cas en un test (DG1) : le verdict de chaque bloc, le différentiel de `toEqual` nomme les fautifs.
  it("should make the block of each module reject when its first read fails, naming the read in the log and never the database text (AC13)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    const verdicts: Record<string, unknown> = {}
    for (const [block, table, context, run] of FAILURES) {
      log.mockClear()
      const { db, identity, sent } = lea((query) => (query.face === "sql" && query.target === table ? TIMEOUT : null))
      const refusal = await run(db, identity).then(
        () => null,
        (error: unknown) => (error instanceof Error ? { name: error.name, code: "code" in error ? error.code : undefined, message: error.message } : error),
      )
      verdicts[block] = {
        refusal,
        failedReads: sent.filter((query) => query.face === "sql" && query.target === table).length,
        logged: log.mock.calls.some(([line, code]) => line === `[platform] ${context}` && code === TIMEOUT.code),
      }
    }
    expect(verdicts).toEqual(
      Object.fromEntries(FAILURES.map(([block]) => [block, { refusal: { name: "PlatformError", code: "internal", message: "Internal error." }, failedReads: 1, logged: true }])),
    )
  })

  it("should read the leads of all the identity's teams in one query (E03-S01, AC22)", async () => {
    const { db, identity, sent } = lea()

    expect(await teamFacts(db, identity)).toEqual({
      teams: ["Team Ventes. Lead: Claire Morel.", "Team Support. Lead: Paul Girard."],
      teamConnectors: [[], []],
      connectors: [],
    })
    expect(sent.map((query) => [query.face, query.op, query.target])).toEqual([["sql", "select", "team_members"]])
  })
})
