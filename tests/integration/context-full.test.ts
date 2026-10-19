// @vitest-environment node
// `context` complet sur une vraie base (E03-S08, AC11) : le seul test de la story
// sur la vraie base, dont le sujet est la latence de `context` et les lectures de la story sur le vrai
// schéma — jointure `node_versions` → `nodes`, `links` et leurs cibles, blocs publiés des Contextes,
// `blocks.updated_by`, journal. Une organisation jetable, Acme semée par `seedNodes` (Contextes publiés,
// une procédure, une page, le tableau), un Contexte republié avec un lien, un journal ; tout passe par la
// porte MCP sous la session de la personne, la connexion d'administration ne sert qu'à poser. Suite
// portable (E11-S14) : personne sans compte, jeton signé localement (`tests/helpers/session-locale.ts`),
// passé à la porte par `connectMcp`. Les autres AC se prouvent sur la base
// simulée (`tests/unit/context-blocks.test.ts`, `tests/unit/context-engine.test.ts`).
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { connectMcp } from "../helpers/mcp"
import { hex } from "../helpers/plateforme"
import { createLocalFixtures, type LocalFixtures } from "../helpers/session-locale"
import { portable, sqlConfigured, testAdminSql, type TestSql } from "../helpers/sql"
import type { BlockInput } from "../../packages/plateforme/schemas"
import { privateFolderPending, privateFolderSuite } from "../helpers/pending-migrations"
import { ACME_CONTEXTS, ACME_PEOPLE, ACME_PROCEDURES, ACME_TABLE, ACME_TEAMS, acmeNode, acmeProfile, seedNodesOf, type AcmeTeam } from "./fixtures/acme"

// Ces tests supposent le dossier `private` en base (fiche D107) : sautés, la version nommée, tant que
// 20260928120000 n'est pas appliquée au projet (`database-patterns.md § Règles`).
const privatePending = await privateFolderPending()

const NETWORK_TIMEOUT = 120_000
const SETUP_TIMEOUT = 240_000
/** Appels mesurés : assez pour une médiane, peu pour le projet partagé. */
const RUNS = 5

const GRILLE = "conseil/grille_tarifaire_2026"

const SUITE = "context in full on a real database (AC11)"

describe.skipIf(!sqlConfigured || privatePending)(
  privateFolderSuite(portable(SUITE), privatePending),
  { timeout: NETWORK_TIMEOUT },
  () => {
    let fx: LocalFixtures
    let admin: TestSql
    let org: { id: string; prefix: string; name: string; host: string }
    let jb: { id: string; email: string; accessToken: string }

    beforeAll(async () => {
      fx = createLocalFixtures()
      admin = testAdminSql()
      const host = `t${hex(4)}.example.invalid`
      org = { ...(await fx.createOrg({ name: "Acme Énergies", hosts: [host] })), host }
      // L'arbre d'abord : dossiers d'équipe et Contextes naissent avec les équipes et les membres (P39).
      await fx.createTree(org.id)
      const user = await fx.createUser({ fullName: ACME_PEOPLE.jb.name })
      const createTeam = async (team: AcmeTeam) => {
        const lead = ACME_TEAMS[team].lead === "jb" ? { leadUserId: user.id } : {}
        return (await fx.createTeam(org.id, { slug: team, name: ACME_TEAMS[team].name, ...lead })).id
      }
      const teamIds: Record<AcmeTeam, string> = { ventes: await createTeam("ventes"), support: await createTeam("support"), conseil: await createTeam("conseil") }
      await fx.addMember(org.id, user.id, { role: "admin", profile: acmeProfile("jb") })
      for (const team of ACME_PEOPLE.jb.teams) await fx.addTeamMember(teamIds[team], user.id)
      const contexts = ACME_CONTEXTS.filter((node) => !node.path.startsWith("private/") || node.path === "private/jb/contexte")
      const ids = await fx.seedNodes(org.id, seedNodesOf([ACME_PROCEDURES[0], acmeNode(GRILLE), ACME_TABLE, ...contexts], teamIds))
      // Lu par jb et ses lignes du tableau écrites par lui : ses documents récents.
      await fx.seedCtxJournal(org, user, [{ tool: `${org.prefix}_read`, target: GRILLE }])
      await admin`update platform.blocks set updated_by = ${user.id} where node_id = ${ids.get(ACME_TABLE.path) ?? null} and state = 'published'`
      // Republié après le `ctx` semé, avec un bloc `reference` et son lien : une nouveauté, une page liée.
      const contexte = acmeNode("contexte")
      const blocks: BlockInput[] = [...contexte.blocks, { type: "reference", data: { path: GRILLE } }]
      await fx.publishBlocks(ids.get("contexte") ?? "", blocks, { title: contexte.title, summary: contexte.summary, links: [{ block: blocks.length - 1, path: GRILLE }] })
      jb = { id: user.id, email: user.email, accessToken: (await fx.sessionFor(user)).accessToken }
    }, SETUP_TIMEOUT)

    afterAll(async () => {
      try {
        await fx?.cleanup()
      } finally {
        await admin?.end({ timeout: 5 })
      }
    }, SETUP_TIMEOUT)

    it("should serve the Contextes, what's new, the procedures and the recent content from the real schema, and print its latency", async () => {
      const session = await connectMcp(org, jb, `context-full-${hex(3)}`)
      const durations: number[] = []
      const texts: string[] = []
      for (let run = 0; run < RUNS; run += 1) {
        const started = performance.now()
        const opened = await session.openContext("relance les devis en attente")
        durations.push(performance.now() - started)
        texts.push(opened.text)
      }
      const sorted = [...durations].sort((a, b) => a - b)
      console.log(
        `[context] latence p50 ${Math.round(sorted[Math.floor(RUNS / 2)])} ms sur ${RUNS} appels (min ${Math.round(sorted[0])}, max ${Math.round(sorted[RUNS - 1])}) ; cible NFR-TASK-02 : p50 < 1 000 ms, non bloquante`,
      )

      const [first, next] = texts
      const grille = acmeNode(GRILLE)
      expect(first.length).toBeLessThanOrEqual(20_000)
      expect(first.match(/^## Context: .*$/gm)).toEqual([
        "## Context: everyone (contexte)",
        "## Context: you only (private/jb/contexte)",
        "## Context: team Conseil (conseil/contexte)",
        "## Context: team Support (support/contexte)",
        "## Context: team Ventes (ventes/contexte)",
      ])
      // E05-S12 (AC-1) : chaque partie s'ouvre par sa ligne de faits, sur le vrai schéma.
      expect(first).toContain(`\n\n## Context: everyone (contexte)\nOrganisation: ${org.name}.\n`)
      expect(first).toContain(`\n\n## Context: team Conseil (conseil/contexte)\nTeam Conseil. Lead: ${ACME_PEOPLE.jb.name}.\n`)
      expect(first).toContain(`\n\n→ page: ${grille.title} — ${grille.summary} (${GRILLE})\n\nLinked pages:\n- ${GRILLE} — ${grille.title} — ${grille.summary}\n\n`)
      expect(first).toMatch(/\n## What's new since \d{4}-\d{2}-\d{2}\n- contexte v2 \(\d{4}-\d{2}-\d{2}\): Contexte\n/)
      expect(first).toContain(`\n## Procedures you can run, most used first (1)\n- ${ACME_PROCEDURES[0].path}: ${ACME_PROCEDURES[0].summary}\n`)
      expect(first).toMatch(new RegExp(`\\n## Recent content\\n- ${ACME_TABLE.path} \\(table, \\d{4}-\\d{2}-\\d{2}\\): ${ACME_TABLE.title}\\n- ${GRILLE} \\(page, \\d{4}-\\d{2}-\\d{2}\\): ${grille.title}$`))
      // La conversation suivante ne revoit pas la nouveauté (AC3, sur le vrai schéma) ; rien depuis le jour même : aucun bloc (M53).
      expect(next).not.toContain("## What's new")
    })
  },
)
