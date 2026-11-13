// @vitest-environment node
// Fonctions SQL de l'identité (E02-S01, AC2 à AC8), avec des organisations et des personnes jetables ;
// chaque appel passe par le rôle qu'il vise : `anon` (`withAnonSession`), personne connectée (`asCaller`,
// ou sa session avec un nom quand la fonction le lit), connexion d'administration pour le hook et
// `unique_handle` (le rôle du serveur d'auth et de l'outillage). Suite portable depuis E01-S10 f2 (plus de
// PostgREST ni de Supabase Auth) : le job `bare-postgres` la joue. Les tables qu'anon ne lit pas sont
// prouvées par `isolation-par-table.test.ts` (AC3) ; les refus d'anon, réunis en un test (M11b).
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { withAnonSession, withCallerSession, type Tx } from "../../packages/plateforme/server/sql"
import { hex } from "../helpers/plateforme"
import { asCaller, seedWithAdmin, SQL_SKIP_REASON, sqlConfigured, type SeededData, type SeededOrg, type SeededPerson } from "../helpers/sql"

const NETWORK_TIMEOUT = 60_000
const PAST = new Date(Date.now() - 24 * 3600 * 1000)
// Le refus du hook par son code : le message est un texte d'écran, hors contrat (M11b).
const HOOK_REFUSAL = { error: { http_code: 403 } }
const SUITE = "platform identity SQL functions"

/**
 * Événement d'une première connexion par un fournisseur (E09-S03) : le serveur d'auth appelle le
 * hook dans le rappel OAuth quand aucun compte n'existe encore (`internal/api/external.go` de
 * supabase/auth). Repris de `hook-fournisseurs.test.ts` (M11).
 */
function providerHookEvent(provider: string, email: string) {
  const userId = crypto.randomUUID()
  const sub = hex(10)
  const identityData = { email, email_verified: true, full_name: "Claire Morel", name: "Claire Morel", provider_id: sub, sub }
  return {
    metadata: { uuid: crypto.randomUUID(), time: new Date().toISOString(), name: "before-user-created", ip_address: "127.0.0.1" },
    user: {
      id: userId,
      aud: "authenticated",
      role: "",
      email,
      phone: "",
      app_metadata: { provider, providers: [provider] },
      user_metadata: identityData,
      identities: [{ identity_id: crypto.randomUUID(), id: sub, user_id: userId, identity_data: identityData, provider, email }],
      is_anonymous: false,
    },
  }
}

/** Événement du hook « Before User Created », forme de la doc Supabase. */
function hookEvent(email: string | undefined) {
  return {
    metadata: { uuid: crypto.randomUUID(), time: new Date().toISOString(), name: "before-user-created", ip_address: "127.0.0.1" },
    user: {
      id: crypto.randomUUID(),
      aud: "authenticated",
      role: "",
      email,
      phone: "",
      app_metadata: { provider: "email", providers: ["email"] },
      user_metadata: {},
      identities: [],
      is_anonymous: false,
    },
  }
}

/** L'appel du hook dans une transaction : sa réponse. */
const callHook = (sql: Tx, event: object) =>
  sql<{ answer: unknown }[]>`select platform.hook_before_user_created(${sql.json(JSON.parse(JSON.stringify(event)))}) as answer`.then(([row]) => row.answer)

type Joined = { org_id: string; slug: string; name: string; role: string }

describe.skipIf(!sqlConfigured)(sqlConfigured ? SUITE : `${SUITE} (${SQL_SKIP_REASON})`, { timeout: NETWORK_TIMEOUT }, () => {
  let seed: SeededData

  /** `accept_invitations` sous la session de la personne ; `name` : le nom que porte sa session (H31). */
  const accept = (person: SeededPerson, name: string | null = null) =>
    withCallerSession({ userId: person.id, email: person.email, name }, (sql) => sql<{ joined: Joined[] }[]>`select platform.accept_invitations() as joined`).then(
      ([row]) => row.joined,
    )

  /** Un membre semé par la connexion d'administration, avec son rôle et sa fiche. */
  async function addMember(org: SeededOrg, person: SeededPerson, options: { role?: "admin" | "member"; profile?: object } = {}) {
    await seed.admin`insert into platform.members (org_id, user_id, role, profile, email)
                     values (${org.id}, ${person.id}, ${options.role ?? "member"},
                             ${seed.admin.json(JSON.parse(JSON.stringify(options.profile ?? {})))}, ${person.email})`
  }

  async function createTeam(org: SeededOrg, name: string): Promise<string> {
    const [team] = await seed.admin<{ id: string }[]>`insert into platform.teams (org_id, slug, name) values (${org.id}, ${`team-${hex(3)}`}, ${name}) returning id`
    return team.id
  }

  beforeAll(() => {
    seed = seedWithAdmin()
  })

  afterAll(async () => {
    await seed?.cleanup()
  }, NETWORK_TIMEOUT)

  describe("org_by_host (AC2)", () => {
    it("should serve an organisation to anon by its host, whatever the case and port, and no row for an unknown host", async () => {
      const org = await seed.createOrg()
      await seed.admin`update platform.orgs set settings = ${seed.admin.json({ domains: "sales, support" })} where id = ${org.id}`
      const byHost = (host: string) => withAnonSession((sql) => sql`select * from platform.org_by_host(${host})`)

      expect(await byHost(`${org.host.toUpperCase()}:3000`)).toEqual([
        { id: org.id, slug: org.slug, name: org.name, prefix: org.prefix, brand: {}, domains: "sales, support" },
      ])
      expect(await byHost(`t${hex(4)}.example.invalid`)).toEqual([])
    })

    // Les refus d'anon d'`org_contact`, d'`accept_invitations` et du hook, réunis ici (M11b).
    it("should let anon execute org_by_host only: membership functions, org_contact, accept_invitations and the hook refused (42501)", async () => {
      const refusedCode = (run: (sql: Tx) => Promise<unknown>) => withAnonSession(run).then(
        () => null,
        (error: { code?: string }) => error.code,
      )
      const refused = await Promise.all([
        refusedCode((sql) => sql`select * from platform.member_orgs()`),
        refusedCode((sql) => sql`select * from platform.org_contact(${crypto.randomUUID()})`),
        refusedCode((sql) => sql`select platform.accept_invitations()`),
        refusedCode((sql) => callHook(sql, hookEvent("a@x.test"))),
      ])
      expect(refused).toEqual(["42501", "42501", "42501", "42501"])
    })
  })

  describe("org_contact (AC3)", () => {
    const contactOf = (person: SeededPerson, org: SeededOrg) => asCaller(person.id, person.email).tx((sql) => sql`select * from platform.org_contact(${org.id})`)

    it("should name the oldest admin to a member and to the platform team, and nobody to a signed-in non-member", async () => {
      const org = await seed.createOrg()
      const first = seed.person()
      const second = seed.person()
      const member = seed.person()
      const staff = seed.person()
      await addMember(org, first, { role: "admin", profile: { name: "Paul Martin" } })
      await addMember(org, second, { role: "admin" })
      await addMember(org, member)
      await seed.admin`insert into platform.platform_staff (user_id, email) values (${staff.id}, ${staff.email})`

      const contact = [{ name: "Paul Martin", email: first.email }]
      expect([await contactOf(member, org), await contactOf(staff, org), await contactOf(seed.person(), org)]).toEqual([contact, contact, []])
    })

    it("should return no row for an organisation without admin", async () => {
      const org = await seed.createOrg()
      const member = seed.person()
      await addMember(org, member)

      expect(await contactOf(member, org)).toEqual([])
    })
  })

  describe("unique_handle (AC4)", () => {
    it("should derive an ASCII handle from the email local part, numbered when taken in the organisation, not in another one", async () => {
      const org = await seed.createOrg()
      const other = await seed.createOrg()
      const derived = async (orgId: string, email: string) =>
        (await seed.admin<{ handle: string }[]>`select platform.unique_handle(${orgId}, ${email}) as handle`)[0].handle
      const handle = (orgId: string) => derived(orgId, "claire.morel@x.test")

      expect(await derived(org.id, "Claire.Morel@x.test")).toBe("claire_morel")
      expect(await derived(org.id, "Élodie-Ré@x.test")).toBe("elodie_re")
      expect(await derived(org.id, "+++@x.test")).toBe("membre")

      await addMember(org, seed.person(), { profile: { handle: "claire_morel" } })
      expect(await handle(org.id)).toBe("claire_morel_2")
      await addMember(org, seed.person(), { profile: { handle: "claire_morel_2" } })
      expect(await handle(org.id)).toBe("claire_morel_3")
      expect(await handle(other.id)).toBe("claire_morel")
    })

    it("should refuse two members with the same handle in one organisation", async () => {
      const org = await seed.createOrg()
      await addMember(org, seed.person(), { profile: { handle: "same" } })
      await expect(addMember(org, seed.person(), { profile: { handle: "same" } })).rejects.toMatchObject({ code: "23505" })
    })
  })

  describe("accept_invitations (AC5 to AC7)", () => {
    it("should create the membership, the team membership and close the invitation", async () => {
      const org = await seed.createOrg()
      const inviter = seed.person()
      await addMember(org, inviter, { role: "admin" })
      const ventes = await createTeam(org, "Ventes")
      const person = seed.person()
      const [invitation] = await seed.admin<{ id: string }[]>`
        insert into platform.invitations (org_id, email, role, team_id, invited_by)
        values (${org.id}, ${person.email}, 'member', ${ventes}, ${inviter.id}) returning id`

      expect(await accept(person, "Claire Morel")).toEqual([{ org_id: org.id, slug: org.slug, name: org.name, role: "member" }])
      // E05-S13 (fiche D128) : l'invitation n'écrit plus d'équipe par défaut ; la personne entre dans l'équipe.
      const [member] = await seed.admin`select role, default_team_id, profile from platform.members where org_id = ${org.id} and user_id = ${person.id}`
      expect(member).toEqual({
        role: "member",
        default_team_id: null,
        profile: { handle: person.email.split("@")[0].replace(/-/g, "_"), name: "Claire Morel" },
      })
      const [teamMember] = await seed.admin<{ role: string }[]>`select role from platform.team_members where team_id = ${ventes} and user_id = ${person.id}`
      expect(teamMember?.role).toBe("member")
      const [closed] = await seed.admin<{ accepted_at: Date | null; accepted_by: string | null }[]>`
        select accepted_at, accepted_by from platform.invitations where id = ${invitation.id}`
      expect(closed.accepted_at).not.toBeNull()
      expect(closed.accepted_by).toBe(person.id)

      expect(await accept(person, "Claire Morel")).toEqual([])
    })

    // L'invitation précède l'appartenance : le déclencheur refuse d'inviter un membre existant. Le
    // rôle retenu est le plus haut : un admin invité membre reste admin, un membre invité admin l'est.
    it("should never demote an admin, and promote a member invited as admin", async () => {
      const org = await seed.createOrg()
      const ventes = await createTeam(org, "Ventes")
      const adminUser = seed.person()
      await seed.admin`insert into platform.invitations (org_id, email, role, team_id) values (${org.id}, ${adminUser.email}, 'member', ${ventes})`
      await addMember(org, adminUser, { role: "admin" })

      expect(await accept(adminUser)).toEqual([{ org_id: org.id, slug: org.slug, name: org.name, role: "admin" }])
      const [member] = await seed.admin`select role, default_team_id from platform.members where org_id = ${org.id} and user_id = ${adminUser.id}`
      expect(member).toEqual({ role: "admin", default_team_id: null })
      const inVentes = await seed.admin`select user_id from platform.team_members where team_id = ${ventes} and user_id = ${adminUser.id}`
      expect(inVentes).toHaveLength(1)

      const plainMember = seed.person()
      await seed.admin`insert into platform.invitations (org_id, email, role) values (${org.id}, ${plainMember.email}, 'admin')`
      await addMember(org, plainMember, { role: "member" })

      expect(await accept(plainMember)).toEqual([{ org_id: org.id, slug: org.slug, name: org.name, role: "admin" }])
    })

    it("should silently skip invitations that are not pending for this email", async () => {
      const person = seed.person()
      const orgs = await Promise.all([seed.createOrg(), seed.createOrg(), seed.createOrg(), seed.createOrg()])
      await seed.admin`insert into platform.invitations (org_id, email) values (${orgs[0].id}, ${`other-${hex(4)}@example.invalid`})`
      await seed.admin`insert into platform.invitations (org_id, email, expires_at) values (${orgs[1].id}, ${person.email}, ${PAST})`
      await seed.admin`insert into platform.invitations (org_id, email, revoked_at) values (${orgs[2].id}, ${person.email}, now())`
      await seed.admin`insert into platform.invitations (org_id, email, accepted_at) values (${orgs[3].id}, ${person.email}, now())`

      expect(await accept(person)).toEqual([])
      expect(await seed.admin`select org_id from platform.members where user_id = ${person.id}`).toEqual([])
    })

    // H12 (seul un email vérifié entre) : depuis E01-S09, `accept_invitations` lit l'email dans la
    // session, qui n'existe qu'une fois l'email confirmé (HN-E01S09-3) ; une session sans claim
    // `email` n'accepte rien (`portabilite-schema.test.ts`, AC3).
  })

  describe("hook_before_user_created (AC8)", () => {
    const hookAnswer = (event: object) => seed.admin.begin((sql) => callHook(sql, event))

    it("should accept an address that a pending invitation awaits, whatever its case", async () => {
      const org = await seed.createOrg()
      const suffix = hex(4)
      await seed.admin`insert into platform.invitations (org_id, email) values (${org.id}, ${`new-${suffix}@example.invalid`})`

      expect(await hookAnswer(hookEvent(`New-${suffix}@Example.invalid`))).toEqual({})
    })

    // Garde contre un filtre futur sur le fournisseur ; le parcours réel est la campagne de JB (E09-S03, AC9).
    it("should accept a first google sign-in whose address a pending invitation awaits, whatever its case", async () => {
      const org = await seed.createOrg()
      const suffix = hex(4)
      await seed.admin`insert into platform.invitations (org_id, email) values (${org.id}, ${`new-${suffix}@example.invalid`})`

      expect(await hookAnswer(providerHookEvent("google", `New-${suffix}@Example.invalid`))).toEqual({})
    })

    it("should refuse an address without a pending invitation, or no address", async () => {
      const org = await seed.createOrg()
      const emails = { expired: `x-${hex(4)}@example.invalid`, revoked: `y-${hex(4)}@example.invalid`, accepted: `z-${hex(4)}@example.invalid` }
      await seed.admin`insert into platform.invitations (org_id, email, expires_at) values (${org.id}, ${emails.expired}, ${PAST})`
      await seed.admin`insert into platform.invitations (org_id, email, revoked_at) values (${org.id}, ${emails.revoked}, now())`
      await seed.admin`insert into platform.invitations (org_id, email, accepted_at) values (${org.id}, ${emails.accepted}, now())`

      for (const email of [`none-${hex(4)}@example.invalid`, emails.expired, emails.revoked, emails.accepted, undefined]) {
        expect(await hookAnswer(hookEvent(email)), String(email)).toMatchObject(HOOK_REFUSAL)
      }
    })

    it("should refuse a signed-in person", async () => {
      const person = seed.person()
      await expect(asCaller(person.id, person.email).tx((sql) => callHook(sql, hookEvent("a@x.test")))).rejects.toMatchObject({ code: "42501" })
    })
  })
})
