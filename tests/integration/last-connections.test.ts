// @vitest-environment node
// `lastConnections` (E02-S04, AC7, AC8) sur une base réelle (E01-S10, lot e2b) : O et P de la graine de
// référence (`seedReferenceOrg`). L'isolation seule (E01-S08) rend à Léa, membre de O et de P, les lignes de
// Claire dans O et les siennes dans P : le service les écarte par sa requête
// (`security-patterns.md § Droits dans le service`, H123). Portable (AC-x3, fiche D76) : Léa appelle par
// `asCaller`, la connexion d'administration pose le journal ; le job `bare-postgres` joue ce fichier. Déplacé de
// `tests/unit/server-connect.test.ts`, où il tournait sur la base simulée du constructeur PostgREST.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { lastConnections } from "../../packages/plateforme/server/connect"
import { PlatformError } from "../../packages/plateforme/server/errors"
import { ORG, OTHER_ORG, PEOPLE } from "../helpers/reference-org"
import { seedReferenceOrg, type ReferenceOrgSql } from "../helpers/reference-org-sql"
import type { Row } from "../helpers/simulated-db"
import { asCaller, isoInstants, seedWithAdmin, spyDb, SQL_SKIP_REASON, sqlConfigured, type SeededData } from "../helpers/sql"

const SETUP_TIMEOUT = 120_000

function initialize(host: string | null, ts: string, overrides: Row = {}): Row {
  return { org_id: ORG.id, user_id: PEOPLE.lea.id, method: "initialize", host, ts, ...overrides }
}

// L'ordre d'AC7, de la plus récente à la plus ancienne : ChatGPT, Claude Code, claude.ai (T1, pas T0),
// le client qui ne s'est pas nommé ; puis une signature inconnue.
const T3 = "2026-09-24T10:00:00.000Z"
const T2 = "2026-09-24T09:00:00.000Z"
const T1 = "2026-09-24T08:00:00.000Z"
const T0 = "2026-09-24T07:00:00.000Z"
const T4 = "2026-09-24T06:00:00.000Z"
const T5 = "2026-09-23T12:00:00.000Z"

const JOURNAL: Row[] = [
  initialize("claude-ai@0.1.0", T1),
  initialize("Anthropic/ClaudeAI@1.0.0", T0),
  initialize("claude-code@2.1.280", T2),
  initialize("openai-mcp@1.0.0", T3),
  initialize("?@?", T4),
  initialize("foo@1", T5),
  // Plus récentes que toutes, et jamais comptées : un appel d'outil, une autre personne de O, Léa dans P.
  initialize("claude-ai@0.1.0", "2026-09-24T11:00:00.000Z", { method: "tools/call" }),
  initialize("mistral-le-chat@2.0.0", "2026-09-24T12:00:00.000Z", { user_id: PEOPLE.claire.id }),
  initialize("other-client@1.0.0", "2026-09-24T13:00:00.000Z", { org_id: OTHER_ORG.id }),
]

let seed: SeededData
let ref: ReferenceOrgSql

describe.skipIf(!sqlConfigured)(
  sqlConfigured ? "lastConnections on a real database" : `lastConnections on a real database (${SQL_SKIP_REASON})`,
  { timeout: SETUP_TIMEOUT },
  () => {
    beforeAll(async () => {
      seed = seedWithAdmin()
      ref = await seedReferenceOrg(seed)
      await ref.write({ journal: JOURNAL })
    }, SETUP_TIMEOUT)

    afterAll(async () => {
      await seed?.cleanup()
    }, SETUP_TIMEOUT)

    const lea = () => asCaller(ref.people.lea.id, ref.people.lea.email)

    it("should keep the latest initialize of each family, newest first, from this person in this organisation only (AC7)", async () => {
      const connections = await lastConnections(lea(), ref.identityOf("lea"))

      // Les instants comparés, pas leur graphie ; le texte est celui de PostgREST (décalage horaire, jamais `Z`).
      expect(isoInstants(connections)).toEqual([
        { family: "ChatGPT", signature: "openai-mcp@1.0.0", at: T3 },
        // claude-code et claude-ai, un seul assistant : la plus récente des deux.
        { family: "Claude", signature: "claude-code@2.1.280", at: T2 },
        { family: "Client non identifié", signature: "?@?", at: T4 },
        { family: "foo", signature: "foo@1", at: T5 },
      ])
      expect(connections[0].at).toMatch(/[+-]\d{2}:\d{2}$/)
    })

    it("should say a failed read of the journal, never an empty list (AC8)", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {})
      const { db } = spyDb(lea(), { fail: (query) => (query.target === "journal" ? { code: "57014" } : null) })

      await expect(lastConnections(db, ref.identityOf("lea"))).rejects.toBeInstanceOf(PlatformError)
      vi.restoreAllMocks()
    })
  },
)
