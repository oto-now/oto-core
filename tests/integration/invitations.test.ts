// @vitest-environment node
// Invitations décidées et filtrées par le service (E01-S07 AC16 à AC18, HN-E01S07-7, HN-E01S07-8 ; cas
// d'E02-S01 AC5, AC16, AC17), sur une vraie base depuis que le module parle SQL (E01-S10, lot e1b3) :
// l'isolation seule y rend les invitations que l'appelant ne doit pas voir (toutes celles de O à un
// membre de O, celle de P à Léa, membre de P), et le service les filtre ou les refuse ; l'espion des
// deux faces (`spyDb`) prouve qu'un refus n'envoie aucune écriture. Les invariants d'état
// (`already_member`, `already_invited`) sont ceux du déclencheur `invitations_guard`, levés par la base.
// Portable (fiche D76 A, AC-x3) : `asCaller` et la connexion d'administration, sans Supabase Auth ; le
// lien magique est espionné sur le client d'auth, sous une adresse et une clé publique factices : aucun
// email ne part. Une O et une P par cas, sur la graine du fichier : chaque cas lit toutes les invitations
// de son O, et une invitation adressée à un membre ne s'écrit qu'avant lui (`invitations_guard`). La
// porte, sur le vrai projet : `tests/integration/api-invitations.test.ts`.
import { randomUUID } from "crypto"
import { AuthApiError, AuthClient } from "@supabase/supabase-js"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import {
  acceptInvitations,
  invitationOptions,
  inviteMember,
  listInvitations,
  resolveIdentity,
  revokeInvitation,
  visibleTree,
  type PlatformDb,
} from "@otomata_tech/oto_platform/server"
import type { TreeNode } from "@otomata_tech/oto_platform/schemas"
import { changeInvitationTeams } from "../../packages/plateforme/server/pending-members"
import { sectionsDeLArbre } from "../../packages/plateforme/ui/arbre/depuis-l-arbre"
import { hex } from "../helpers/plateforme"
import { contentTables, ORG, OTHER_ORG, PEOPLE, TEAMS, type Person } from "../helpers/reference-org"
import { personDb, seedReferenceTables, type ReferenceOrgSql } from "../helpers/reference-org-sql"
import type { Row } from "../helpers/simulated-db"
import { asCaller, seedWithAdmin, spyDb, SQL_SKIP_REASON, sqlConfigured, writesOf, type SeededData, type SentQuery } from "../helpers/sql"

const NETWORK_TIMEOUT = 60_000
const REDIRECT = { redirectTo: "https://acme.test/auth/confirm?next=/" }
const NOW = Date.now()
/** Il y a `minutes` minutes ; plus c'est petit, plus l'invitation est récente. */
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString()
const NEXT_WEEK = new Date(NOW + 7 * 86_400_000).toISOString()
/** Une adresse jetable, qu'aucune autre invitation ouverte de l'organisation ne porte. */
const address = () => `test-${hex(6)}@example.invalid`

/** Une invitation de O, ouverte, émise par Ada ; ses champs en identifiants simulés. */
function invitation(id: string, fields: Row = {}): Row {
  return {
    id,
    org_id: ORG.id,
    email: address(),
    role: "member",
    team_id: null,
    invited_by: PEOPLE.ada.id,
    created_at: ago(1),
    expires_at: NEXT_WEEK,
    accepted_at: null,
    declined_at: null,
    revoked_at: null,
    ...fields,
  }
}

/** Le client d'une personne semée, face SQL seule : le module n'appelle plus PostgREST. */
const dbOf = (ref: ReferenceOrgSql, person: Person): PlatformDb => asCaller(ref.people[person].id, ref.people[person].email)

const LINK_SENT = { data: { user: null, session: null }, error: null }

/** Un envoi du lien magique refusé par Supabase Auth avec ce statut. */
const linkRefused = (status: number) => ({ data: { user: null, session: null }, error: new AuthApiError("smtp down", status, undefined) })

function spyOnMagicLink() {
  return vi.spyOn(AuthClient.prototype, "signInWithOtp").mockResolvedValue(LINK_SENT)
}

describe.skipIf(!sqlConfigured)(
  sqlConfigured ? "invitations services on a real base, portable" : `invitations services on a real base, portable (${SQL_SKIP_REASON})`,
  { timeout: NETWORK_TIMEOUT },
  () => {
    let seed: SeededData
    let otp: ReturnType<typeof spyOnMagicLink>

    beforeAll(() => {
      seed = seedWithAdmin()
    })

    afterAll(async () => {
      await seed?.cleanup()
    }, NETWORK_TIMEOUT)

    beforeEach(() => {
      // L'hôte du lien : une adresse et une clé publique factices ; l'envoi est espionné, rien ne part.
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.invalid")
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key")
      otp = spyOnMagicLink()
    })

    afterEach(() => {
      vi.unstubAllEnvs()
      vi.restoreAllMocks()
    })

    /** O et P de la base simulée, avec ces invitations (écrites avant les membres) et ces équipes en plus. */
    async function seedO(invitations: Row[] = [], teams: Row[] = []): Promise<ReferenceOrgSql> {
      const tables = contentTables()
      tables.invitations = [...invitations, ...tables.invitations]
      tables.teams = [...tables.teams, ...teams]
      return seedReferenceTables(seed, tables)
    }

    /** Les issues des invitations de O et de P, relues par la connexion d'administration. */
    const outcomes = async (ref: ReferenceOrgSql) => [
      ...(await seed.admin`
        select id, accepted_at, declined_at, revoked_at from platform.invitations
         where org_id in (${ref.org.id}, ${ref.other.id}) order by id`),
    ]

    describe("invitationOptions and inviteMember (E01-S07 AC16)", () => {
      it("should decide by isOrgAdmin and leadsTeam, and refuse before any insertion or email", async () => {
        const ref = await seedO()
        const [ventes, support] = [ref.id(TEAMS.ventes.id), ref.id(TEAMS.support.id)]
        const spies: { sent: SentQuery[] }[] = []
        const as = (person: Person) => {
          const spy = spyDb(dbOf(ref, person))
          spies.push(spy)
          return spy.db
        }
        // T : membre simple de O, de l'équipe plateforme avec un accès en cours (fiche D17) : les options de l'admin.
        expect(ref.readable(await invitationOptions(as("t"), ref.identityOf("t")))).toEqual({
          roles: ["member", "admin"],
          teams: [
            { id: TEAMS.support.id, slug: "support", name: "Support" },
            { id: TEAMS.ventes.id, slug: "ventes", name: "Ventes" },
          ],
          teamRequired: false,
        })
        expect(ref.readable(await invitationOptions(as("claire"), ref.identityOf("claire")))).toEqual({
          roles: ["member"],
          teams: [{ id: TEAMS.ventes.id, slug: "ventes", name: "Ventes" }],
          teamRequired: true,
        })
        const invited = address()
        const refused: [Person, Record<string, unknown>, string, string | undefined][] = [
          ["lea", { email: invited, role: "member", teamId: ventes }, "forbidden", "not_allowed"],
          ["claire", { email: invited, role: "admin", teamId: ventes }, "forbidden", "admin_role_reserved"],
          ["claire", { email: invited, role: "member" }, "forbidden", "team_required"],
          ["claire", { email: invited, role: "member", teamId: support }, "forbidden", "team_required"],
          // Chaque équipe vérifiée une à une : une équipe qu'elle ne mène pas, à côté de la sienne, refuse l'invitation.
          ["claire", { email: invited, role: "member", teamIds: [ventes, support] }, "forbidden", "team_required"],
          ["ada", { email: invited, role: "member", teamIds: [ventes, randomUUID()] }, "invalid_arguments", undefined],
          ["ada", { email: "pas-une-adresse", role: "member" }, "invalid_arguments", undefined],
          ["ada", { email: invited, role: "member", teamId: randomUUID() }, "invalid_arguments", undefined],
        ]
        for (const [who, input, code, reason] of refused) {
          const error = await inviteMember(as(who), ref.identityOf(who), input, REDIRECT).catch((thrown: unknown) => thrown)
          expect(error, `${who} ${JSON.stringify(input)}`).toMatchObject({ code, details: reason ? { reason } : undefined })
        }
        expect(writesOf(spies.flatMap((spy) => spy.sent))).toEqual([])
        expect(otp).not.toHaveBeenCalled()

        // L'insertion, puis le lien, une fois sa transaction validée (une autre connexion lit l'invitation) ;
        // l'adresse rognée et mise en minuscules.
        const order: string[] = []
        otp.mockImplementation(async (credentials) => {
          const email = "email" in credentials ? credentials.email : null
          const [seen] = await seed.admin`select count(*)::int as committed from platform.invitations where org_id = ${ref.org.id} and email = ${email}`
          order.push(`signInWithOtp, committed: ${seen.committed}`)
          return LINK_SENT
        })
        const claire = spyDb(dbOf(ref, "claire"), { before: (query) => void order.push(`${query.op} ${query.target}`) })
        const created = await inviteMember(claire.db, ref.identityOf("claire"), { email: ` ${invited.toUpperCase()} `, role: "member", teamId: ventes }, REDIRECT)
        expect(order).toEqual(["select teams", "insert invitations", "signInWithOtp, committed: 1"])
        expect(otp).toHaveBeenCalledWith({ email: invited, options: { shouldCreateUser: true, emailRedirectTo: REDIRECT.redirectTo } })
        // L'échéance a la forme que PostgREST lui donnait : celle que lisent l'API et l'écran.
        const [stored] = await seed.admin`
          select org_id, email, role, team_id, invited_by, revoked_at, to_json(expires_at) #>> '{}' as expires_at
            from platform.invitations where id = ${created.invitation.id}`
        expect(ref.readable({ created, stored })).toEqual({
          created: { invitation: { id: expect.any(String), email: invited, role: "member", teamId: TEAMS.ventes.id, teamIds: [TEAMS.ventes.id], expiresAt: stored.expires_at }, emailed: true },
          stored: { org_id: ORG.id, email: invited, role: "member", team_id: TEAMS.ventes.id, invited_by: PEOPLE.claire.id, revoked_at: null, expires_at: stored.expires_at },
        })
      })

      // Tri en mémoire, comme les équipes de l'identité : la collation de la base (`C` mesurée en N17)
      // rangerait « Zèbre » avant « achats » et « Études » après (revue E02-S01). Les trois équipes sont
      // écrites après Ventes et Support, dans cet ordre : lues sans `order by`, elles viendraient ainsi.
      // Ada, membre de P aussi : l'isolation lui rend l'équipe de P, que seul le service écarte.
      it("should offer the teams of O only, sorted the French way, whatever the case and the accents", async () => {
        const teams = ["Zèbre", "achats", "Études"].map((name, rank) => ({ id: `team-${rank}`, org_id: ORG.id, slug: `equipe_${rank}`, name, lead_user_id: null }))
        const ref = await seedO([], [...teams, { id: "team-p", org_id: OTHER_ORG.id, slug: "equipe_p", name: "Autre", lead_user_id: null }])
        await ref.write({ members: [{ org_id: OTHER_ORG.id, user_id: PEOPLE.ada.id, role: "member" }] })
        const offered = await invitationOptions(dbOf(ref, "ada"), ref.identityOf("ada"))
        expect(offered.teams.map((team) => team.name)).toEqual(["achats", "Études", "Support", "Ventes", "Zèbre"])
      })

      it("should invite into two teams for an administrator, write both, and let the person into both at her first sign-in", async () => {
        const ref = await seedO()
        const nina = { ...seed.person(), name: "Nina Nouvelle" }
        const teamIds = [ref.id(TEAMS.support.id), ref.id(TEAMS.ventes.id)]
        const { invitation } = await inviteMember(dbOf(ref, "ada"), ref.identityOf("ada"), { email: nina.email, teamIds }, REDIRECT)
        const written = await seed.admin`select team_id from platform.invitation_teams where invitation_id = ${invitation.id} order by team_id`
        await acceptInvitations(await personDb(nina))
        const joined = await seed.admin`select team_id, role from platform.team_members where user_id = ${nina.id} order by team_id`

        expect(ref.readable(invitation)).toMatchObject({ teamId: TEAMS.support.id, teamIds: [TEAMS.support.id, TEAMS.ventes.id] })
        expect(written.map((row) => row.team_id)).toEqual([...teamIds].sort())
        expect(joined).toEqual([...teamIds].sort().map((team_id) => ({ team_id, role: "member" })))
      })
    })

    // La RLS de `invitation_teams`, sous la session de chacun : la frontière que le service redit (`invitationOptions`).
    describe("invitation_teams under row level security", () => {
      const codeOf = (promise: Promise<unknown>) => promise.then(() => null, (error: { code?: string }) => error.code ?? "unknown")

      it("should be read by an administrator and the lead of the row's team only, and written by them on an open invitation of their organisation", async () => {
        const ref = await seedO(
          [invitation("i-two", { team_id: TEAMS.ventes.id }), invitation("i-none"), invitation("i-closed", { revoked_at: ago(1) })],
          [{ id: "team-p", org_id: OTHER_ORG.id, slug: "equipe_p", name: "Autre", lead_user_id: null }],
        )
        const [two, none, closed] = ["i-two", "i-none", "i-closed"].map((id) => ref.id(id))
        const [ventes, support] = [ref.id(TEAMS.ventes.id), ref.id(TEAMS.support.id)]
        // L'équipe de `team_id` vient du déclencheur ; Support, une seconde équipe.
        await seed.admin`insert into platform.invitation_teams (invitation_id, team_id) values (${two}, ${support})`
        const seen = async (person: Person) =>
          ref.readable((await dbOf(ref, person).tx((sql) => sql<{ team_id: string }[]>`select team_id from platform.invitation_teams where invitation_id = ${two}`)).map((row) => row.team_id)).sort()
        const insert = (person: Person, invitationId: string, teamId: string) =>
          codeOf(dbOf(ref, person).tx((sql) => sql`insert into platform.invitation_teams (invitation_id, team_id) values (${invitationId}, ${teamId})`))

        expect({ ada: await seen("ada"), claire: await seen("claire"), paul: await seen("paul"), lea: await seen("lea") }).toEqual({
          ada: [TEAMS.support.id, TEAMS.ventes.id],
          claire: [TEAMS.ventes.id],
          paul: [TEAMS.support.id],
          lea: [],
        })
        expect({
          leadOtherTeam: await insert("claire", none, support),
          member: await insert("lea", none, ventes),
          otherOrgTeam: await insert("ada", none, ref.id("team-p")),
          closed: await insert("ada", closed, ventes),
          lead: await insert("claire", none, ventes),
          admin: await insert("ada", none, support),
        }).toEqual({ leadOtherTeam: "42501", member: "42501", otherOrgTeam: "42501", closed: "42501", lead: null, admin: null })
        // Une suppression que la RLS écarte n'efface rien : Claire ne retire pas Support, Paul le retire.
        const removed = async (person: Person, teamId: string) =>
          (await dbOf(ref, person).tx((sql) => sql`delete from platform.invitation_teams where invitation_id = ${two} and team_id = ${teamId} returning team_id`)).length
        expect([await removed("claire", support), await removed("paul", support)]).toEqual([0, 1])
      })
    })

    // Le « + » d'une personne en attente (`POST` et `DELETE invitations/<id>/teams/<teamId>`) : chaque équipe décidée
    // par le service, avant toute écriture.
    describe("changeInvitationTeams", () => {
      it("should let a lead add or remove the teams he leads only, an administrator any team, and refuse a closed invitation", async () => {
        const ref = await seedO([invitation("i-open", { team_id: TEAMS.support.id }), invitation("i-closed", { revoked_at: ago(1) })])
        const [open, closed] = [ref.id("i-open"), ref.id("i-closed")]
        const [ventes, support] = [ref.id(TEAMS.ventes.id), ref.id(TEAMS.support.id)]
        const change = (person: Person, invitationId: string, add: string[], remove: string[]) => {
          const spy = spyDb(dbOf(ref, person))
          const done = changeInvitationTeams(spy.db, ref.identityOf(person), invitationId, { add, remove }).then(
            () => null,
            (error: { code?: string; details?: { reason?: string } }) => `${error.code}${error.details?.reason ? `:${error.details.reason}` : ""}`,
          )
          return done.then((outcome) => ({ outcome, writes: writesOf(spy.sent).length }))
        }
        const teamsOf = async () => ref.readable((await seed.admin`select team_id from platform.invitation_teams where invitation_id = ${open} order by team_id`).map((row) => row.team_id)).sort()
        vi.spyOn(console, "error").mockImplementation(() => {})

        expect({
          leadRemovesOther: await change("claire", open, [], [support]),
          leadAddsOther: await change("claire", open, [support], []),
          memberAdds: await change("lea", open, [ventes], []),
          leadAddsHis: await change("claire", open, [ventes], []),
          afterLead: await teamsOf(),
          adminRemovesAny: await change("ada", open, [], [support]),
          afterAdmin: await teamsOf(),
          closed: await change("ada", closed, [ventes], []),
        }).toEqual({
          leadRemovesOther: { outcome: "forbidden:team_required", writes: 0 },
          leadAddsOther: { outcome: "forbidden:team_required", writes: 0 },
          memberAdds: { outcome: expect.stringMatching(/^forbidden/), writes: 0 },
          leadAddsHis: { outcome: null, writes: 1 },
          afterLead: [TEAMS.support.id, TEAMS.ventes.id].sort(),
          adminRemovesAny: { outcome: null, writes: 1 },
          afterAdmin: [TEAMS.ventes.id],
          closed: { outcome: "conflict", writes: 0 },
        })
      })

      // `changeInvitationTeams` et `accept_invitations` prennent le verrou 7101 de l'invitation (organisation, adresse) :
      // la fenêtre entre la lecture de l'invitation ouverte et l'écriture de ses équipes, rendue sûre par une table
      // tenue en partage, ne laisse plus passer l'acceptation. Sans le verrou, elle passe : la personne entre sans
      // l'équipe ajoutée, écrite sur une invitation close (ou refusée par la RLS, hors de `conflict`).
      it("should not interleave with accept_invitations: the team added reaches the member, or the change is a conflict and writes nothing", async () => {
        const ref = await seedO()
        const nina = { ...seed.person(), name: "Nina Nouvelle" }
        const [ventes, support] = [ref.id(TEAMS.ventes.id), ref.id(TEAMS.support.id)]
        const [{ id: invitationId }] = await seed.admin<{ id: string }[]>`
          insert into platform.invitations (org_id, email, role, team_id) values (${ref.org.id}, ${nina.email}, 'member', ${support}) returning id`
        const ninaDb = await personDb(nina)
        const waiting = async (condition: string) =>
          (await seed.admin.unsafe<{ waiting: boolean }[]>(`select exists (select 1 from pg_catalog.pg_locks where not granted and ${condition}) as waiting`))[0].waiting
        let changed: Promise<string | null> = Promise.resolve(null)
        let accepted: Promise<unknown> = Promise.resolve()
        await seed.admin.begin(async (tx) => {
          await tx`lock table platform.invitation_teams in share mode`
          changed = changeInvitationTeams(dbOf(ref, "claire"), ref.identityOf("claire"), invitationId, { add: [ventes], remove: [] }).then(
            () => null,
            (error: { code?: string }) => error.code ?? "unknown",
          )
          for (let tries = 0; !(await waiting(`locktype = 'relation' and relation = 'platform.invitation_teams'::regclass`)); tries += 1) {
            if (tries > 500) throw new Error("the change never reached the write of its teams")
            await new Promise((resolve) => setTimeout(resolve, 20))
          }
          let settled = false
          accepted = acceptInvitations(ninaDb).finally(() => {
            settled = true
          })
          for (let tries = 0; !settled && !(await waiting(`locktype = 'advisory' and classid = 7101`)); tries += 1) {
            if (tries > 500) throw new Error("the acceptance neither ended nor waited for the invitation lock")
            await new Promise((resolve) => setTimeout(resolve, 20))
          }
        })
        const [outcome] = await Promise.all([changed, accepted])
        const joined = (await seed.admin`select team_id from platform.team_members where user_id = ${nina.id} order by team_id`).map((row) => row.team_id)
        const written = (await seed.admin`select team_id from platform.invitation_teams where invitation_id = ${invitationId} order by team_id`).map((row) => row.team_id)

        expect([null, "conflict"]).toContain(outcome)
        if (outcome === null) expect(ref.readable(joined).sort()).toEqual([TEAMS.support.id, TEAMS.ventes.id].sort())
        else expect([ref.readable(joined), ref.readable(written)]).toEqual([[TEAMS.support.id], [TEAMS.support.id]])
      })

      it("should refuse an invitation id that is not a UUID with invalid_arguments, before any query", async () => {
        const ref = await seedO([])
        const spy = spyDb(dbOf(ref, "ada"))
        const refused = await changeInvitationTeams(spy.db, ref.identityOf("ada"), "pas-un-id", { add: [ref.id(TEAMS.ventes.id)], remove: [] }).catch((error: { code?: string }) => error.code)
        expect([refused, spy.sent]).toEqual(["invalid_arguments", []])
      })
    })

    describe("inviteMember refused by the database or by the email (E02-S01 AC16, AC17)", () => {
      it("should name the refusals of the invitations trigger, already a member or already invited (conflict), without any email", async () => {
        const pending = address()
        const ref = await seedO([invitation("i-pending", { email: pending })])
        const member = ref.people.marc.email
        // `invitations_guard` lève 23505 avec la raison pour seul message.
        for (const [email, reason, message] of [
          [member, "already_member", `${member} is already a member of Acme Test.`],
          [pending, "already_invited", `An invitation is already pending for ${pending}. Revoke it to send another.`],
        ] as const) {
          await expect(inviteMember(dbOf(ref, "ada"), ref.identityOf("ada"), { email }, REDIRECT)).rejects.toMatchObject({
            code: "conflict",
            message,
            details: { reason },
          })
        }
        expect(otp).not.toHaveBeenCalled()
      })

      it("should withdraw the invitation when the email fails: internal, or conflict email_rate_limited on a 429", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {})
        const ref = await seedO()
        const refusals = [
          [500, { code: "internal", message: "The invitation email could not be sent; the invitation was withdrawn. Try again." }],
          [429, { code: "conflict", details: { reason: "email_rate_limited" } }],
        ] as const
        for (const [status, refusal] of refusals) {
          const email = address()
          otp.mockResolvedValueOnce(linkRefused(status))
          await expect(inviteMember(dbOf(ref, "ada"), ref.identityOf("ada"), { email }, REDIRECT)).rejects.toMatchObject(refusal)
          const withdrawn = await seed.admin`select revoked_at is not null as withdrawn from platform.invitations where org_id = ${ref.org.id} and email = ${email}`
          expect(withdrawn.map((row) => row.withdrawn), String(status)).toEqual([true])
        }
      })

      // Rare : une panne entre l'insertion et le retrait laisse l'invitation en attente sans email, et
      // elle bloque une nouvelle invitation de l'adresse. Le log la nomme pour qu'on la révoque.
      it("should name the invitation left pending in the log when withdrawing it fails", async () => {
        const logged = vi.spyOn(console, "error").mockImplementation(() => {})
        const ref = await seedO()
        const email = address()
        otp.mockResolvedValueOnce(linkRefused(500))
        const failing = spyDb(dbOf(ref, "ada"), { fail: (query) => (query.op === "update" && query.target === "invitations" ? { code: "08006" } : null) })
        await expect(inviteMember(failing.db, ref.identityOf("ada"), { email }, REDIRECT)).rejects.toMatchObject({ code: "internal" })
        const [pending] = await seed.admin`select id, revoked_at from platform.invitations where org_id = ${ref.org.id} and email = ${email}`
        expect(pending.revoked_at).toBeNull()
        expect(logged).toHaveBeenCalledWith(`[platform] inviteMember: invitation ${pending.id} stays pending without an email; withdrawing it failed`, "08006")
      })
    })

    describe("listInvitations (E01-S07 AC17)", () => {
      const listed = async (ref: ReferenceOrgSql, person: Person) =>
        ref.readable((await listInvitations(dbOf(ref, person), ref.identityOf(person), { state: "all" })).map((row) => row.id))

      it("should serve the administrator every invitation of O, a lead those of her team and to her email, a member those to her email", async () => {
        const ref = await seedO([
          invitation("i-ventes", { team_id: TEAMS.ventes.id, created_at: ago(1) }),
          invitation("i-support", { team_id: TEAMS.support.id, created_at: ago(2) }),
          invitation("i-sans-equipe", { created_at: ago(3) }),
          invitation("i-lea", { email: PEOPLE.lea.email, created_at: ago(4) }),
          invitation("i-claire", { email: PEOPLE.claire.email, team_id: TEAMS.support.id, created_at: ago(5) }),
        ])
        // La base rend à Claire toutes celles de O, et à Léa, membre de P, aussi celle de P à son adresse.
        expect(await listed(ref, "ada")).toEqual(["i-ventes", "i-support", "i-sans-equipe", "i-lea", "i-claire"])
        expect(await listed(ref, "claire")).toEqual(["i-ventes", "i-claire"])
        expect(await listed(ref, "lea")).toEqual(["i-lea"])
      })

      it("should bound the list at 200 after the filter: a lead gets her 5 under 250 more recent ones of another team, an administrator 200 of 255", async () => {
        const support = Array.from({ length: 250 }, (_, n) => invitation(`i-support-${n}`, { team_id: TEAMS.support.id, created_at: ago(n / 100) }))
        const ventes = Array.from({ length: 5 }, (_, n) => invitation(`i-ventes-${n}`, { team_id: TEAMS.ventes.id, created_at: ago(10 + n) }))
        const ref = await seedO([...support, ...ventes])
        expect(await listed(ref, "claire")).toEqual(ventes.map((row) => row.id))
        // La borne elle-même, prise par les plus récentes ; par l'autre bout, Ventes, plus ancienne, entrerait.
        expect(await listed(ref, "ada")).toEqual(support.slice(0, 200).map((row) => row.id))
      })

      it("should give each invitation its state, and keep only the pending ones by default", async () => {
        const ref = await seedO([
          invitation("i-pending", { created_at: ago(1) }),
          invitation("i-accepted", { accepted_at: ago(1), created_at: ago(2) }),
          invitation("i-declined", { declined_at: ago(1), created_at: ago(3) }),
          invitation("i-revoked", { revoked_at: ago(1), created_at: ago(4) }),
          invitation("i-expired", { expires_at: ago(1), created_at: ago(5) }),
        ])
        const all = await listInvitations(dbOf(ref, "ada"), ref.identityOf("ada"), { state: "all" })
        expect(ref.readable(all.map((row) => [row.id, row.state]))).toEqual([
          ["i-pending", "pending"],
          ["i-accepted", "accepted"],
          ["i-declined", "declined"],
          ["i-revoked", "revoked"],
          ["i-expired", "expired"],
        ])
        const pendingOnly = await listInvitations(dbOf(ref, "ada"), ref.identityOf("ada"))
        expect(ref.readable(pendingOnly.map((row) => row.id))).toEqual(["i-pending"])
        // Chaque invitation telle que PostgREST la rendait : dates par `to_json` (AC-x2).
        const stored = await seed.admin`
          select id, email, role, team_id as "teamId", invited_by as "invitedBy",
                 to_json(created_at) #>> '{}' as "createdAt", to_json(expires_at) #>> '{}' as "expiresAt"
            from platform.invitations where org_id = ${ref.org.id} order by created_at desc`
        const states = ["pending", "accepted", "declined", "revoked", "expired"]
        expect(all).toEqual(stored.map((row, rank) => ({ ...row, teamIds: [], state: states[rank] })))
      })
    })

    describe("revokeInvitation (E01-S07 AC18)", () => {
      const rows = () => [
        invitation("i-ventes", { team_id: TEAMS.ventes.id }),
        invitation("i-by-claire", { team_id: TEAMS.ventes.id, invited_by: PEOPLE.claire.id }),
        invitation("i-by-paul", { team_id: TEAMS.support.id, invited_by: PEOPLE.paul.id }),
        invitation("i-accepted", { accepted_at: ago(1) }),
        invitation("i-declined", { declined_at: ago(1) }),
        invitation("i-revoked", { revoked_at: ago(1) }),
      ]
      const notFound = (id: string) => ({ code: "not_found", message: `No open invitation ${id} that you can revoke.` })

      it("should decide before writing: the issuer or an administrator revokes an open invitation of O, anyone else finds nothing", async () => {
        const ref = await seedO(rows())
        // Ada, membre de P aussi : l'isolation lui rend l'invitation de P, que seul le service écarte.
        await ref.write({ members: [{ org_id: OTHER_ORG.id, user_id: PEOPLE.ada.id, role: "member" }] })
        const spies: { sent: SentQuery[] }[] = []
        const as = (person: Person) => {
          const spy = spyDb(dbOf(ref, person))
          spies.push(spy)
          return spy.db
        }
        const before = await outcomes(ref)
        // Claire mène Ventes et voit l'invitation, mais ne l'a pas émise : rien à révoquer pour elle.
        await expect(revokeInvitation(as("claire"), ref.identityOf("claire"), ref.id("i-ventes"))).rejects.toMatchObject(notFound(ref.id("i-ventes")))
        for (const id of [randomUUID(), ref.id(OTHER_ORG.invitation), ref.id("i-accepted"), ref.id("i-declined"), ref.id("i-revoked")]) {
          await expect(revokeInvitation(as("ada"), ref.identityOf("ada"), id)).rejects.toMatchObject(notFound(id))
        }
        // Un id qui n'est pas un UUID ne part pas en base.
        await expect(revokeInvitation(as("ada"), ref.identityOf("ada"), "42")).rejects.toMatchObject({ code: "invalid_arguments" })
        expect(writesOf(spies.flatMap((spy) => spy.sent))).toEqual([])
        expect(await outcomes(ref)).toEqual(before)

        expect(ref.readable(await revokeInvitation(as("ada"), ref.identityOf("ada"), ref.id("i-ventes")))).toEqual({ id: "i-ventes", state: "revoked", teamId: TEAMS.ventes.id })
        const [revoked] = await seed.admin`select revoked_at from platform.invitations where id = ${ref.id("i-ventes")}`
        expect(revoked.revoked_at).toEqual(expect.any(Date))
        // Chaque branche seule vraie : Ada, administratrice, révoque celle qu'a émise Paul ; Claire,
        // émettrice sans être administratrice, la sienne.
        expect(ref.readable(await revokeInvitation(as("ada"), ref.identityOf("ada"), ref.id("i-by-paul")))).toEqual({ id: "i-by-paul", state: "revoked", teamId: TEAMS.support.id })
        expect(ref.readable(await revokeInvitation(as("claire"), ref.identityOf("claire"), ref.id("i-by-claire")))).toEqual({ id: "i-by-claire", state: "revoked", teamId: TEAMS.ventes.id })
        // Témoin de la liste vide plus haut : le même espion voit les écritures de ce service sur la face SQL.
        expect(writesOf(spies.flatMap((spy) => spy.sent)).map((query) => `${query.op} ${query.target}`)).toEqual([
          "update invitations",
          "update invitations",
          "update invitations",
        ])
      })

      it("should answer conflict when the invitation closes between the read and the write (HN-E01S07-6)", async () => {
        const log = vi.spyOn(console, "error").mockImplementation(() => {})
        const ref = await seedO(rows())
        const id = ref.id("i-ventes")
        // L'invitation est acceptée par une autre transaction juste avant l'écriture : la garde « encore
        // ouverte » ne trouve plus de ligne (la policy `invitations_update_revoke` non plus, HN-E01S10-e1b3-9).
        const racing = spyDb(dbOf(ref, "ada"), {
          before: async (query) => {
            if (query.op === "update" && query.target === "invitations") await seed.admin`update platform.invitations set accepted_at = now() where id = ${id}`
          },
        })
        await expect(revokeInvitation(racing.db, ref.identityOf("ada"), id)).rejects.toMatchObject({
          code: "conflict",
          message: `Invitation ${id} changed meanwhile. Reload the invitations and retry.`,
        })
        expect(log).toHaveBeenCalledWith(`[platform] revokeInvitation: invitation ${id} closed between the read and the write`)
      })
    })

    // Ce que `accept_invitations` fait des invitations est prouvé par `tests/integration/identite-sql.test.ts` ;
    // ici, ce qu'en rend le service, et le nom de l'appelant qu'elle recopie (HN-E01S10-9).
    describe("acceptInvitations (E02-S01 AC5)", () => {
      it("should return the organisations joined, with the role accept_invitations wrote, and copy the caller's name into members", async () => {
        const ref = await seedO()
        const nina = { ...seed.person(), name: "Nina Nouvelle" }
        await seed.admin`insert into platform.invitations (org_id, email, role) values (${ref.org.id}, ${nina.email}, 'admin')`
        const joined = await acceptInvitations(await personDb(nina))
        expect(ref.readable(joined)).toEqual([{ orgId: ORG.id, slug: ref.org.slug, name: "Acme Test", role: "admin" }])
        const [member] = await seed.admin`select role, email, name from platform.members where org_id = ${ref.org.id} and user_id = ${nina.id}`
        expect(member).toEqual({ role: "admin", email: nina.email, name: "Nina Nouvelle" })
        // Première connexion (E11-S10, AC-a5) : son espace et son Contexte sont dans son arbre, et le rail ouvre « Privé » sur lui.
        const db = await personDb(nina)
        const identity = await resolveIdentity(db, ref.org.host, { userId: nina.id, email: nina.email })
        const handle = String(identity.member.profile.handle)
        const { tree } = await visibleTree(db, identity)
        const paths = (nodes: TreeNode[]): string[] => nodes.flatMap((node) => [node.path, ...paths(node.children)])
        expect(paths(tree)).toContain(`private/${handle}/contexte`)
        const prive = sectionsDeLArbre(tree, [], handle).find((section) => section.cle === "private")
        expect(prive).toMatchObject({ titre: "Privé", noeuds: [{ chemin: `private/${handle}/contexte`, titre: "Contexte" }] })
      })
    })
  },
)
