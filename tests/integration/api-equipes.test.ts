// @vitest-environment node
// Porte API du paquet pour les ressources d'E05-S03 (AC19) sur le vrai projet : de vraies `Request`,
// le jeton de personnes jetables, `defer` qui collecte les tâches ; une ligne de journal `api` par
// mutation, réussie ou refusée, au format de la porte (H07). Les routes, leurs statuts et leurs lignes
// de journal sont prouvés sans base (`tests/unit/api-equipes-routes.test.ts`), la ligne écrite sur la
// vraie base par `api-invitations.test.ts`, l'équipe et le chemin rendus par les services dans
// `equipes-services.test.ts` et `regles-services.test.ts` : la création d'équipe, les règles et le
// refus d'un membre simple, redits ici, sont retirés (M11b, revue d'E05-S03 et liste d'E01-S07). Suite
// portable (E11-S14) : personnes sans compte, jetons signés localement que la porte vérifie par
// `verifyToken` (`tests/helpers/session-locale.ts`) ; relectures par la connexion d'administration.
import { randomUUID } from "crypto"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { handlePlateforme } from "@otomata_tech/oto_platform/api"
import { teamSlug } from "@otomata_tech/oto_platform/server"
import { hex } from "../helpers/plateforme"
import { createLocalFixtures, type LocalFixtures } from "../helpers/session-locale"
import { portable, sqlConfigured, testAdminSql, type SqlReferenceOrg, type SqlUser, type TestSql } from "../helpers/sql"
import { privateFolderPending, privateFolderSuite } from "../helpers/pending-migrations"

// Ces tests supposent le dossier `private` en base (fiche D107) : sautés, la version nommée, tant que
// 20260928120000 n'est pas appliquée au projet (`database-patterns.md § Règles`).
const privatePending = await privateFolderPending()

const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 180_000
const USER_AGENT = "api-equipes-test"

// `bea` et `sam` : une seconde administratrice, un membre du staff, ouverts par les tests qui se retirent.
type Caller = "ada" | "claire" | "lea" | "bea" | "sam"
type Task = () => Promise<void>

describe.skipIf(!sqlConfigured || privatePending)(
  privateFolderSuite(portable("platform API teams, members, rules and platform access"), privatePending),
  { timeout: NETWORK_TIMEOUT },
  () => {
    let fx: LocalFixtures
    let admin: TestSql
    let o: SqlReferenceOrg
    let staff: SqlUser
    const tokens = new Map<Caller, string>()

    function request(method: string, path: string, body?: unknown) {
      return new Request(`https://${o.host}/api/platform/${path}`, {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: { origin: `https://${o.host}`, "x-forwarded-proto": "https", "user-agent": USER_AGENT, "content-type": "application/json" },
      })
    }

    /** Un appel sous le jeton de `caller`, sa ligne de journal écrite (les tâches différées jouées). */
    async function call(caller: Caller, method: string, path: string, body?: unknown) {
      const tasks: Task[] = []
      const accessToken = tokens.get(caller) ?? null
      const response = await handlePlateforme(request(method, path, body), { accessToken, host: o.host, verifyToken: fx.verifyToken, defer: (task) => tasks.push(task) })
      for (const task of tasks) await task()
      return { status: response.status, body: await response.json() }
    }

    const journal = (tool: string, target: string) =>
      admin<{ is_error: boolean; error: string | null }[]>`
        select user_id, method, tool, target, team_id, is_error, error, user_agent from platform.journal
        where org_id = ${o.org.id} and tool = ${tool} and target = ${target}`

    beforeAll(async () => {
      fx = createLocalFixtures()
      admin = testAdminSql()
      o = await fx.buildReferenceOrg()
      staff = await fx.createUser({ fullName: "Sam Staff" })
      await fx.makeStaff(staff.id)
      for (const caller of ["ada", "claire", "lea"] as const) tokens.set(caller, (await fx.sessionFor(o.people[caller])).accessToken)
    }, SETUP_TIMEOUT)

    afterAll(async () => {
      try {
        await fx?.cleanup()
      } finally {
        await admin?.end({ timeout: 5 })
      }
    }, SETUP_TIMEOUT)

    describe("teams", () => {
      it("should answer 400 for an empty name and 409 for a taken name, the refusal journaled", async () => {
        expect((await call("ada", "POST", "teams", { name: " " })).status).toBe(400)
        const name = `Juridique ${hex(3)}`
        await call("ada", "POST", "teams", { name })
        const taken = await call("ada", "POST", "teams", { name })
        expect(taken.status).toBe(409)
        expect(taken.body.error).toMatchObject({ code: "conflict", details: { reason: "name_taken" } })

        // Le doublon d'Ada est journalisé sur le slug demandé, comme la création.
        const lignes = await journal("POST teams", teamSlug(name))
        expect(lignes.filter((ligne) => ligne.is_error).map((ligne) => ligne.error?.split(":")[0])).toEqual(["conflict"])
      })

      it("should compose by teams/<id>/members, and let an administrator remove then name again a lead (E05-S13, HN-M-3)", async () => {
        const added = await call("claire", "POST", `teams/${o.teams.ventes}/members`, { userId: o.people.marc.id })
        expect(added.status).toBe(200)
        expect(added.body.data.membership).toMatchObject({ teamId: o.teams.ventes, userId: o.people.marc.id })
        expect(await journal("POST teams/members", o.people.marc.email)).toContainEqual(
          expect.objectContaining({ team_id: o.teams.ventes, is_error: false }),
        )

        // Plusieurs responsables (D128) : retirer une responsable n'est plus refusé à l'administratrice ; Claire est
        // rendue responsable de Ventes aussitôt, pour les tests qui suivent.
        const lead = await call("ada", "DELETE", `teams/${o.teams.ventes}/members/${o.people.claire.id}`)
        expect(lead.status).toBe(200)
        expect((await call("ada", "POST", `teams/${o.teams.ventes}/members`, { userId: o.people.claire.id })).status).toBe(200)
        expect((await call("ada", "PATCH", `teams/${o.teams.ventes}/members/${o.people.claire.id}`, { role: "lead" })).status).toBe(200)
      })

      it("should answer 404 for an unknown team, and 409 with what a team still owns", async () => {
        expect((await call("ada", "DELETE", `teams/${randomUUID()}`)).status).toBe(404)
        const owned = await call("ada", "DELETE", `teams/${o.teams.ventes}`)
        expect(owned.status).toBe(409)
        expect(owned.body.error.details).toMatchObject({ reason: "team_owns_objects", nodes: expect.arrayContaining(["ventes/devis"]) })
      })
    })

    describe("members", () => {
      it("should refuse demoting the last administrator with 409 last_admin, journaled on the member id", async () => {
        const { status, body } = await call("ada", "PATCH", `members/${o.people.ada.id}`, { role: "member" })
        expect(status).toBe(409)
        expect(body.error.details).toEqual({ reason: "last_admin" })
        expect(await journal("PATCH members", o.people.ada.id)).toContainEqual(expect.objectContaining({ is_error: true }))
      })

      // E05-S13 (fiche D128) : l'équipe par défaut ne s'écrit plus, le rôle seul.
      it("should change a role with 200, refuse a default team with 400, and refuse a plain member with 403", async () => {
        expect((await call("ada", "PATCH", `members/${o.people.lea.id}`, { defaultTeamId: o.teams.ventes })).status).toBe(400)
        const changed = await call("ada", "PATCH", `members/${o.people.lea.id}`, { role: "member" })
        expect(changed.status).toBe(200)
        expect(await journal("PATCH members", o.people.lea.email)).toContainEqual(expect.objectContaining({ is_error: false }))
        expect((await call("lea", "DELETE", `members/${o.people.marc.id}`)).status).toBe(403)
      })

      // Limite connue, HN-E05S03-36 : la ligne part après le retrait, sous le jeton de qui n'est plus
      // membre, et `journal_insert_own` la refuse. Quand la migration proposée à la fiche de décisions
      // sera posée, ce test exigera la ligne.
      it("should remove oneself with 200, the journal line refused by the RLS (HN-E05S03-36)", async () => {
        const bea = await fx.createUser({ fullName: "Béa Faure" })
        await fx.addMember(o.org.id, bea.id, { role: "admin" })
        tokens.set("bea", (await fx.sessionFor(bea)).accessToken)
        const erreurs = vi.spyOn(console, "error").mockImplementation(() => {})

        try {
          const { status, body } = await call("bea", "DELETE", `members/${bea.id}`)

          expect(status).toBe(200)
          expect(body).toEqual({ data: { member: { userId: bea.id } } })
          expect(await admin`select user_id from platform.members where org_id = ${o.org.id} and user_id = ${bea.id}`).toEqual([])
          expect(erreurs).toHaveBeenCalledWith("[platform] journal: insert failed", "42501")
          expect(await journal("DELETE members", bea.email)).toEqual([])
        } finally {
          erreurs.mockRestore()
        }
      })
    })

    describe("rules", () => {
      it("should answer 400 for a malformed rule and 404 for an invisible node", async () => {
        expect((await call("claire", "POST", "rules", { path: "Ventes", subject: { kind: "team", id: o.teams.support }, level: "read" })).status).toBe(400)
        expect((await call("lea", "POST", "rules", { path: "private/claire", subject: { kind: "team", id: o.teams.support }, level: "read" })).status).toBe(404)
      })
    })

    describe("platform-access", () => {
      it("should revoke with 200 by platform-access/<id>/revoke, idempotently, journaled on the access id", async () => {
        const grant = await fx.grantPlatformAccess(o.org.id, staff.id, staff.id)

        const first = await call("ada", "POST", `platform-access/${grant}/revoke`, {})
        const second = await call("ada", "POST", `platform-access/${grant}/revoke`, {})

        expect([first.status, second.status]).toEqual([200, 200])
        expect(second.body.data.access.alreadyRevoked).toBe(true)
        expect(await journal("POST platform-access/revoke", grant)).toHaveLength(2)
        expect((await call("lea", "POST", `platform-access/${grant}/revoke`, {})).status).toBe(403)
        // POST platform-access/<id>/revoke seul : ni l'accès sans `revoke`, ni une autre méthode.
        expect((await call("ada", "POST", `platform-access/${grant}`, {})).status).toBe(404)
        expect((await call("ada", "DELETE", `platform-access/${grant}/revoke`)).status).toBe(404)
      })

      // Même limite (HN-E05S03-36) : entré par cet accès, sans ligne `members`, le staff qui le révoque
      // n'est plus de l'organisation quand la porte écrit sa ligne.
      it("should revoke one's own access with 200, the journal line refused by the RLS (HN-E05S03-36)", async () => {
        const grant = await fx.grantPlatformAccess(o.org.id, staff.id, staff.id)
        tokens.set("sam", (await fx.sessionFor(staff)).accessToken)
        const erreurs = vi.spyOn(console, "error").mockImplementation(() => {})

        try {
          const { status, body } = await call("sam", "POST", `platform-access/${grant}/revoke`, {})

          expect(status).toBe(200)
          expect(body.data.access.alreadyRevoked).toBe(false)
          expect(erreurs).toHaveBeenCalledWith("[platform] journal: insert failed", "42501")
          expect(await journal("POST platform-access/revoke", grant)).toEqual([])
        } finally {
          erreurs.mockRestore()
        }
      })
    })
  },
)
