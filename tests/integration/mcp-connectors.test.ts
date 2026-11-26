// @vitest-environment node
// Connecteurs vus par les hosts (E04-S01, AC21, AC22) : `tools/list` et le bloc `team` de `context`
// par InMemoryTransport, sessions câblées comme la route (`tests/helpers/mcp.ts`), organisations et
// personnes jetables. Les textes servis au modèle se comparent mot pour mot (H04, P14). Suite portable
// (E11-S14) : personnes sans compte, jetons signés localement (`tests/helpers/session-locale.ts`) ;
// l'écriture de mise en place passe par la connexion d'administration.
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { connectMcp } from "../helpers/mcp"
import type { ReferencePerson } from "../helpers/plateforme"
import { createLocalFixtures, type LocalFixtures } from "../helpers/session-locale"
import { portable, sqlConfigured, testAdminSql, type SqlReferenceOrg, type TestSql } from "../helpers/sql"
import { privateFolderPending, privateFolderSuite } from "../helpers/pending-migrations"

// Ces tests supposent le dossier `private` en base (fiche D107) : sautés, la version nommée, tant que
// 20260928120000 n'est pas appliquée au projet (`database-patterns.md § Règles`).
const privatePending = await privateFolderPending()

// Projet partagé par les agents d'une vague : jusqu'à 30 s mesurées pour un test, le 2026-09-24.
const NETWORK_TIMEOUT = 120_000
const SETUP_TIMEOUT = 240_000
// E05-S13 (fiche D128) : les connecteurs d'une équipe qui a un compte dans sa partie, les autres après les faits de l'organisation.
const HEADER = "Connectors (this team runs a call when the procedure or the call names it, or when it is your only team with an account; if several are, ask the user which one):"
const ORG_HEADER = "Connectors (when no team of yours runs the call):"

type Person = { id: string; email: string; accessToken: string }

describe.skipIf(!sqlConfigured || privatePending)(
  privateFolderSuite(portable("connectors through the MCP"), privatePending),
  { timeout: NETWORK_TIMEOUT },
  () => {
    let fx: LocalFixtures
    let admin: TestSql
    let o: SqlReferenceOrg
    const people = new Map<ReferencePerson, Person>()

    function person(who: ReferencePerson): Person {
      const found = people.get(who)
      if (!found) throw new Error(`${who} has no session`)
      return found
    }

    async function callDescription(org: { host: string }, who: ReferencePerson): Promise<string> {
      const session = await connectMcp(org, person(who))
      const { tools } = await session.client.listTools()
      return tools.find((tool) => tool.name.endsWith("_call"))?.description ?? ""
    }

    /**
     * La tête d'une partie servie à la personne (E05-S12, AC-2) : son en-tête, sa ligne de faits, puis les lignes qui
     * suivent tant qu'elles ne sont pas le corps du Contexte (connecteurs : leur en-tête, puis une ligne par connecteur).
     */
    async function partHead(who: ReferencePerson, header: string): Promise<string> {
      const session = await connectMcp(o, person(who))
      const { text } = await session.openContext()
      const lines = text.slice(text.indexOf(`\n\n## Context: ${header}`) + 2).split("\n\n")[0].split("\n")
      const connectors = lines[2] === HEADER || lines[2] === ORG_HEADER ? lines.slice(2).filter((line, index) => index === 0 || /^[a-z0-9_.-]+: /.test(line)) : []
      return [...lines.slice(0, 2), ...connectors].join("\n")
    }

    beforeAll(async () => {
      fx = createLocalFixtures()
      admin = testAdminSql()
      o = await fx.buildReferenceOrg()
      await fx.addActivation(o.org.id, "mail")
      // Claire : de Ventes et de Support. Marc : des deux aussi (E05-S13 : plus d'équipe par défaut).
      // Léa : de Ventes, mais une règle ne lui laisse que la lecture de « Mail Ventes » ; le
      // compte d'organisation ne lui est ouvert qu'en lecture (niveau d'un membre). Ada :
      // administratrice, sans équipe.
      await fx.addTeamMember(o.teams.support, o.people.claire.id)
      await fx.addTeamMember(o.teams.ventes, o.people.marc.id)
      await fx.addTeamMember(o.teams.support, o.people.marc.id)
      const ventes = await fx.createAccount(o.org.id, { ownerKind: "team", ownerTeamId: o.teams.ventes, label: "Mail Ventes" })
      await fx.createAccount(o.org.id, { ownerKind: "team", ownerTeamId: o.teams.support, label: "Mail Support" })
      await fx.createAccount(o.org.id, { ownerKind: "org", label: "Mail Acme" })
      await fx.addRule({ orgId: o.org.id, accountId: ventes, userId: o.people.lea.id, level: "read" })
      for (const who of ["ada", "claire", "lea", "marc"] as const) {
        const { accessToken } = await fx.sessionFor(o.people[who])
        people.set(who, { id: o.people[who].id, email: o.people[who].email, accessToken })
      }
    }, SETUP_TIMEOUT)

    afterAll(async () => {
      try {
        await fx?.cleanup()
      } finally {
        await admin?.end({ timeout: 5 })
      }
    }, SETUP_TIMEOUT)

    // E05-S13 (fiche D128) : les lignes des connecteurs suivent les faits de chaque équipe qui a un compte, ou ceux
    // de l'organisation pour un connecteur dont aucune équipe de la personne n'a de compte.
    describe("connectors in the parts of context (AC21)", () => {
      it("should say which simulated account runs mail for Claire, in the part of each of her teams with an account", async () => {
        expect(await partHead("claire", "team Ventes")).toBe(
          [
            "## Context: team Ventes (ventes/contexte)",
            "Team Ventes. Lead: Claire Morel.",
            HEADER,
            "mail: team Ventes (write), account « Mail Ventes » (simulated)",
          ].join("\n"),
        )
        expect(await partHead("claire", "team Support")).toBe(
          ["## Context: team Support (support/contexte)", "Team Support. Lead: Paul Girard.", HEADER, "mail: team Support (write), account « Mail Support » (simulated)"].join("\n"),
        )
      })

      it("should give each team of a person its own account line, the header asking which one when several can (N31)", async () => {
        expect(await partHead("marc", "team Support")).toBe(
          [
            "## Context: team Support (support/contexte)",
            "Team Support. Lead: Paul Girard.",
            HEADER,
            "mail: team Support (write), account « Mail Support » (simulated)",
          ].join("\n"),
        )
      })

      it("should say which accounts the person can only read, and that write access is missing (N39)", async () => {
        expect(await partHead("lea", "team Ventes")).toContain(
          `${HEADER}\nmail: no account you can use (team Ventes): calls will be refused until you are given write access; you can only read « Mail Ventes », « Mail Acme ».`,
        )
      })

      it("should give a person without team the organisation account and its mode, after the facts of the organisation (N17)", async () => {
        const head = (await partHead("ada", "everyone")).split("\n")
        expect([head[0], head[1].startsWith("Organisation: "), head.slice(2)]).toEqual([
          "## Context: everyone (contexte)",
          true,
          [ORG_HEADER, "mail: no team (write), account « Mail Acme » (simulated)"],
        ])
      })
    })

    describe("examples of call (AC22)", () => {
      it("should cite no function of a connector open by default, cite mail.create_draft once mail has an account, and none once it is blocked", async () => {
        const b = await fx.buildReferenceOrg(o.people)
        // Ouvert par défaut, jamais adopté : `find` le trouve, mais les exemples ne citent pas tout le catalogue.
        const untouched = await callDescription(b, "claire")
        // `table.rows`, fonction native toujours active, est citée pour toute organisation (E07-S01).
        expect(untouched).toContain(`Runs a function of Acme Test's catalog (e.g. table.rows) with arguments`)
        expect(untouched).not.toContain("mail.")

        // Un compte adopte le connecteur : ses exemples entrent dans la description.
        await fx.createAccount(b.org.id, { ownerKind: "team", ownerTeamId: b.teams.ventes, label: "Mail Ventes" })
        const adopted = await callDescription(b, "claire")
        expect(adopted).toContain("Runs a function of Acme Test's catalog (e.g. mail.create_draft, table.rows) with arguments")
        expect(adopted).not.toContain("mail.send_draft")

        await fx.addActivation(b.org.id, "mail", "inactive")
        const off = await callDescription(b, "claire")
        expect(off).toContain(`Runs a function of Acme Test's catalog (e.g. table.rows) with arguments`)
        expect(off).not.toContain("mail.")
        const session = await connectMcp(b, person("claire"))
        const { text } = await session.openContext()
        expect(text).not.toContain(HEADER)
        expect(text).not.toContain("mail:")
      })
    })
  },
)
