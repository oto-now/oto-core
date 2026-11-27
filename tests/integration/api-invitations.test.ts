// @vitest-environment node
// Porte API du paquet sur le vrai projet (E02-S01, AC19 à AC21 ; marque d'E09-S01) : de vraies
// `Request`, le jeton de personnes jetables, `defer` qui collecte les tâches. L'envoi du lien
// magique est espionné sur le client d'auth : aucun email réel ne part des tests. Les refus de la
// porte sans base sont dans `tests/unit/api-handler.test.ts` ; la révocation (route, ligne de journal)
// et le rôle réservé à l'administrateur y sont aussi, et dans le service sur une vraie base, en suite portable
// (`tests/integration/invitations.test.ts`) : leurs cas sur le projet sont retirés (M11b). Suite portable
// (E11-S14) : personnes sans compte, jetons signés localement que la porte vérifie par `verifyToken`
// (`tests/helpers/session-locale.ts`) ; le client du lien magique se construit sur une adresse `.invalid`
// (HN-E11S14-3) et son envoi reste espionné, rien n'est joint. Le journal se relit sous la session de
// l'administratrice par la face SQL, la marque par la connexion d'administration.
import { AuthClient } from "@supabase/supabase-js"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { handlePlateforme } from "@otomata_tech/oto_platform/api"
import type { PlatformDb } from "../../packages/plateforme/server/db"
import { hex, type TestOrg } from "../helpers/plateforme"
import { createLocalFixtures, type LocalFixtures } from "../helpers/session-locale"
import { asCaller, portable, sqlConfigured, testAdminSql, type TestSql } from "../helpers/sql"

const NETWORK_TIMEOUT = 60_000
const USER_AGENT = "api-invitations-test"

type Task = () => Promise<void>
type Caller = "admin"

describe.skipIf(!sqlConfigured)(
  portable("platform API invitations"),
  { timeout: NETWORK_TIMEOUT },
  () => {
    let fx: LocalFixtures
    let admin: TestSql
    let org: TestOrg
    let host: string
    let ventes: string
    const tokens = new Map<Caller, string>()
    /** La face SQL sous la session de l'administratrice : le journal de son organisation, sous RLS. */
    let adminDb: PlatformDb
    let adminId: string
    const otp = vi.spyOn(AuthClient.prototype, "signInWithOtp")

    function token(caller: Caller): string {
      const found = tokens.get(caller)
      if (!found) throw new Error(`${caller} is not signed in`)
      return found
    }

    function request(method: string, path: string, body?: unknown) {
      return new Request(`https://${host}/api/platform/${path}`, {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: {
          origin: `https://${host}`,
          "x-forwarded-proto": "https",
          "user-agent": USER_AGENT,
          "content-type": "application/json",
        },
      })
    }

    async function call(req: Request, options: { caller?: Caller; accessToken?: string | null } = {}) {
      const tasks: Task[] = []
      const accessToken = options.accessToken !== undefined ? options.accessToken : token(options.caller ?? "admin")
      const response = await handlePlateforme(req, {
        accessToken,
        host,
        verifyToken: fx.verifyToken,
        defer: (task) => tasks.push(task),
      })
      return { response, body: await response.json(), tasks }
    }

    const journal = (tool: string, target: string) =>
      adminDb.tx(
        (sql) => sql`
          select org_id, user_id, method, tool, target, team_id, args, is_error, error, duration_ms, user_agent, ctx, host
          from platform.journal where org_id = ${org.id} and tool = ${tool} and target = ${target}`,
      )

    beforeAll(async () => {
      // Le client du lien magique exige l'adresse et la clé publique de l'hôte : aucune n'est jointe.
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://supabase.example.invalid")
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", `anon-${hex(8)}`)
      fx = createLocalFixtures()
      admin = testAdminSql()
      host = `t${hex(4)}.example.invalid`
      org = await fx.createOrg({ hosts: [host] })
      const person = await fx.createUser()
      adminId = person.id
      ventes = (await fx.createTeam(org.id, { name: "Ventes" })).id
      await fx.addMember(org.id, person.id, { role: "admin" })
      const signed = await fx.sessionFor(person)
      tokens.set("admin", signed.accessToken)
      adminDb = asCaller(person.id, person.email)
    }, 120_000)

    beforeEach(() => {
      otp.mockReset()
      otp.mockResolvedValue({ data: { user: null, session: null }, error: null })
    })

    afterAll(async () => {
      otp.mockRestore()
      vi.unstubAllEnvs()
      try {
        await fx?.cleanup()
      } finally {
        await admin?.end({ timeout: 5 })
      }
    }, NETWORK_TIMEOUT)

    describe("gate (AC19)", () => {
      it("should answer 401 for a token that does not verify", async () => {
        const forged = await call(request("GET", "invitations"), { accessToken: `${token("admin")}x` })
        expect(forged.response.status).toBe(401)
      })
    })

    describe("routes (AC20) and journal (AC21)", () => {
      it("should invite with 201, a link back to the address, and a journal line written after the response", async () => {
        const address = `api-${hex(4)}@example.invalid`
        const body = { email: address, teamId: ventes }

        const { response, body: answer, tasks } = await call(request("POST", "invitations", body))

        expect(response.status).toBe(201)
        expect(answer).toEqual({
          data: {
            invitation: { id: expect.any(String), email: address, role: "member", teamId: ventes, teamIds: [ventes], expiresAt: expect.any(String) },
            emailed: true,
          },
        })
        expect(otp).toHaveBeenCalledWith({
          email: address,
          options: { shouldCreateUser: true, emailRedirectTo: `https://${host}/auth/confirm?next=/` },
        })
        expect(await journal("POST invitations", address)).toEqual([])

        for (const task of tasks) await task()
        const lines = await journal("POST invitations", address)
        expect(lines).toHaveLength(1)
        expect(lines[0]).toMatchObject({
          org_id: org.id,
          user_id: adminId,
          method: "api",
          tool: "POST invitations",
          target: address,
          team_id: ventes,
          args: body,
          is_error: false,
          error: null,
          user_agent: USER_AGENT,
          ctx: null,
          host: null,
        })
        expect(lines[0].duration_ms).toBeGreaterThanOrEqual(0)
      })

      it("should journal a refusal after identity with its code and message", async () => {
        const address = `twice-${hex(4)}@example.invalid`
        const first = await call(request("POST", "invitations", { email: address }))
        for (const task of first.tasks) await task()

        const second = await call(request("POST", "invitations", { email: address }))
        for (const task of second.tasks) await task()

        expect(second.response.status).toBe(409)
        const lines = await journal("POST invitations", address)
        expect(lines).toHaveLength(2)
        expect(lines.find((line) => line.is_error)).toMatchObject({
          is_error: true,
          error: `conflict: An invitation is already pending for ${address}. Revoke it to send another.`,
          target: address,
        })
      })
    })

    // Repris de `brand.test.ts` (M11) : même porte, même organisation jetable, même administrateur.
    describe("brand API and journal (E09-S01, AC7 to AC9)", () => {
      it("should save with 200 and journal the success on the target brand", async () => {
        const brand = { theme: "foret", logo_url: "https://example.com/logo.png", display_name: "Démo Forêt" }

        const { response, body, tasks } = await call(request("PATCH", "brand", brand))
        for (const task of tasks) await task()

        expect(response.status).toBe(200)
        expect(body).toEqual({ data: brand })
        expect(await admin`select brand from platform.orgs where id = ${org.id}`).toEqual([{ brand }])
        expect(await journal("PATCH brand", "brand")).toContainEqual(
          expect.objectContaining({ method: "api", tool: "PATCH brand", target: "brand", is_error: false, user_agent: USER_AGENT }),
        )
      })
    })
  },
)
