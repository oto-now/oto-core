// @vitest-environment node
// Le partage d'un nœud par un assistant (1.4.13) : `node.access`, `node.share` et `node.public_link` derrière `call`
// (`runCall`), sur une vraie base : les niveaux sont ceux que le service calcule, les refus ceux des services de l'écran
// (`setNodeRule`, `setGeneralAccess`, `shareNode`). Chaque cas range une page à lui sous `ventes` : aucun ne dépend de
// l'ordre. Suite portable : chaque personne agit par `fx.as`, sans Supabase Auth.
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { resolveIdentity, type Identity, type PlatformDb } from "@otomata_tech/oto_platform/server"
import { runCall, type CallInput } from "../../packages/plateforme/server/calls"
import { buildDictionary, type Dictionary } from "../../packages/plateforme/server/pseudonym/dictionary"
import { pseudonymizedText } from "../../packages/plateforme/server/pseudonym/gate"
import { orgKey, token as tokenOf } from "../../packages/plateforme/server/pseudonym/token"
import { hex } from "../helpers/plateforme"
import { createSqlFixtures, SQL_SKIP_REASON, spyDb, sqlConfigured, writesOf, type SqlFixtures, type SqlReferenceOrg } from "../helpers/sql"

const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 180_000
const ORIGIN = "https://acme.test"

type Who = "ada" | "claire" | "lea" | "marc"

describe.skipIf(!sqlConfigured)(sqlConfigured ? "sharing through call" : `sharing through call (${SQL_SKIP_REASON})`, { timeout: NETWORK_TIMEOUT }, () => {
  let fx: SqlFixtures
  let o: SqlReferenceOrg
  const sessions = new Map<Who, { db: PlatformDb; identity: Identity }>()

  beforeAll(async () => {
    fx = createSqlFixtures()
    o = await fx.buildReferenceOrg()
    for (const who of ["ada", "claire", "lea", "marc"] as const) {
      const person = o.people[who]
      const db = fx.as(person)
      sessions.set(who, { db, identity: await resolveIdentity(db, o.host, { userId: person.id, email: person.email }) })
    }
  }, SETUP_TIMEOUT)

  afterAll(async () => {
    await fx?.cleanup()
  }, SETUP_TIMEOUT)

  /** Un `call` de la personne, requêtes espionnées : son résultat ou son refus, et ce qui est parti. */
  async function call(who: Who, input: CallInput, dictionary?: Dictionary) {
    const session = sessions.get(who)
    if (!session) throw new Error(`${who} has no session`)
    const spied = spyDb(session.db)
    const deps = { db: spied.db, identity: session.identity, ctxCode: null, origin: ORIGIN, activeConnectors: async () => new Set<string>(), dictionary }
    const outcome = await runCall(deps, input).then(
      (result) => ({ result, error: null }),
      (error: unknown) => ({ result: null, error }),
    )
    return { ...outcome, writes: writesOf(spied.sent) }
  }

  /** Le résultat d'une fonction exécutée (et non un récapitulatif). */
  const resultOf = (outcome: Awaited<ReturnType<typeof call>>): Record<string, unknown> | undefined => {
    const data = outcome.result?.data
    const result: unknown = data && "result" in data ? data.result : undefined
    return typeof result === "object" && result !== null && !Array.isArray(result) ? Object.fromEntries(Object.entries(result)) : undefined
  }

  async function pageDeVentes(): Promise<{ id: string; path: string }> {
    const path = `ventes/partage_${hex(3)}`
    return { id: await fx.createNode(o.org.id, { parentId: o.nodes.ventes, path, title: "Page partagée" }), path }
  }

  const rulesOf = (nodeId: string) =>
    fx.admin<{ subject_team_id: string | null; subject_user_id: string | null; subject_org: boolean; level: string }[]>`
      select subject_team_id, subject_user_id, subject_org, level from platform.access_rules where node_id = ${nodeId} order by level, subject_org`

  it("should read who has access: the owner team's default, the organisation, the added, each member, and the link to its manager only", async () => {
    const page = await pageDeVentes()
    await fx.addRule({ orgId: o.org.id, nodeId: page.id, teamId: o.teams.support, level: "read" })

    const claire = resultOf(await call("claire", { function: "node.access", arguments: { path: page.path } }))
    expect(claire).toMatchObject({
      path: page.path,
      owner: { kind: "team", team: "Ventes" },
      your_level: "manage",
      owner_team_default: { level: "write", set_here: false },
      organisation: "none",
      added: [{ kind: "team", name: "Support", level: "read" }],
      members: [
        { name: "Claire Morel", lead: true, level: "manage", set_here: false },
        { name: "Léa Roux", lead: false, level: "write", set_here: false },
      ],
      public_link: "none",
    })
    const lea = resultOf(await call("lea", { function: "node.access", arguments: { path: page.path } }))
    expect(lea).toMatchObject({ your_level: "write", public_link: "reserved" })
  })

  it("should give a person found by name without case nor accents a level, then remove it, and list the candidates of a vague name without writing", async () => {
    const page = await pageDeVentes()
    const set = await call("claire", { function: "node.share", arguments: { path: page.path, subject: "person", name: "MARC petit", level: "read" } })
    expect(resultOf(set)).toMatchObject({ changed: true, access: { added: [{ kind: "user", name: "Marc Petit", level: "read" }] } })
    expect(await rulesOf(page.id)).toEqual([{ subject_team_id: null, subject_user_id: o.people.marc.id, subject_org: false, level: "read" }])

    const removed = await call("claire", { function: "node.share", arguments: { path: page.path, subject: "person", name: o.people.marc.email, level: "remove" } })
    expect(resultOf(removed)).toMatchObject({ changed: true })
    expect(await rulesOf(page.id)).toEqual([])

    // « t » est dans Ventes et dans Support : les deux sont rendus, rien n'est écrit.
    const vague = await call("claire", { function: "node.share", arguments: { path: page.path, subject: "team", name: "t", level: "read" } })
    expect(resultOf(vague)).toEqual({ changed: false, candidates: ["Support", "Ventes"] })
    expect(vague.writes).toEqual([])
  })

  // Décision de JB du 20/10 : dans une organisation pseudonymisée, la personne se désigne par le jeton que son nom a reçu.
  it("should find a person by the token a pseudonymised workspace served for her name, and refuse an unknown token", async () => {
    const page = await pageDeVentes()
    const marc = { id: "contact-marc", values: { firstNames: "Marc", lastName: "Petit" } }
    const kind = { kind: "contact", list: async () => [marc], read: async () => null }
    const dictionary = await buildDictionary([kind], { id: o.org.id, slug: o.org.slug }, orgKey(Buffer.alloc(32, 7), o.org.id, "salt"))
    const token = pseudonymizedText(dictionary, "Marc Petit")
    expect(token).not.toBe("Marc Petit")

    const set = await call("claire", { function: "node.share", arguments: { path: page.path, subject: "person", name: token, level: "read" } }, dictionary)
    expect(resultOf(set)).toMatchObject({ changed: true })
    expect(await rulesOf(page.id)).toEqual([{ subject_team_id: null, subject_user_id: o.people.marc.id, subject_org: false, level: "read" }])

    const unknown = await call("claire", { function: "node.share", arguments: { path: page.path, subject: "person", name: tokenOf("contact", "0".repeat(13)), level: "read" } }, dictionary)
    expect(unknown.error).toMatchObject({ code: "invalid_arguments" })
  })

  it("should share with a team by its name, and refuse manage to a lead who is not an administrator", async () => {
    const page = await pageDeVentes()
    await call("claire", { function: "node.share", arguments: { path: page.path, subject: "team", name: "support", level: "write" } })
    expect(await rulesOf(page.id)).toEqual([{ subject_team_id: o.teams.support, subject_user_id: null, subject_org: false, level: "write" }])

    const manage = await call("claire", { function: "node.share", arguments: { path: page.path, subject: "person", name: "Léa Roux", level: "manage" } })
    expect(manage.error).toMatchObject({ code: "forbidden" })
  })

  it("should set the owner team's default, raise it with the organisation, and refuse it below the organisation", async () => {
    const page = await pageDeVentes()
    await call("claire", { function: "node.share", arguments: { path: page.path, subject: "owner_team", level: "read" } })
    const opened = await call("claire", { function: "node.share", arguments: { path: page.path, subject: "organisation", level: "write" } })
    expect(resultOf(opened)).toMatchObject({ changed: true, access: { organisation: "write", owner_team_default: { level: "write", set_here: true } } })
    expect(await rulesOf(page.id)).toEqual([
      { subject_team_id: o.teams.ventes, subject_user_id: null, subject_org: false, level: "write" },
      { subject_team_id: null, subject_user_id: null, subject_org: true, level: "write" },
    ])

    const below = await call("claire", { function: "node.share", arguments: { path: page.path, subject: "owner_team", level: "read" } })
    expect(below.error).toMatchObject({ code: "invalid_arguments" })
    expect(below.writes).toEqual([])

    const closed = await call("claire", { function: "node.share", arguments: { path: page.path, subject: "organisation", level: "remove" } })
    expect(resultOf(closed)).toMatchObject({ changed: true, access: { organisation: "none" } })
  })

  it("should summarize a public link without writing, create it on confirm, then disable it in two steps", async () => {
    const page = await pageDeVentes()
    const recap = await call("claire", { function: "node.public_link", arguments: { path: page.path, action: "create", include_children: true } })
    expect(recap.result?.data).toMatchObject({ status: "needs_confirmation", summary: { path: page.path, action: "create", include_children: true, already_public: false } })
    expect(recap.writes).toEqual([])

    const created = await call("claire", { function: "node.public_link", arguments: { path: page.path, action: "create", include_children: true }, confirm: true })
    expect(resultOf(created)).toMatchObject({ path: page.path, include_children: true, created: true })
    expect(String(resultOf(created)?.url)).toMatch(new RegExp(`^${ORIGIN}/p/[A-Za-z0-9_-]{43}$`))

    const off = await call("claire", { function: "node.public_link", arguments: { path: page.path, action: "disable" } })
    expect(off.writes).toEqual([])
    await call("claire", { function: "node.public_link", arguments: { path: page.path, action: "disable" }, confirm: true })
    const shares = await fx.admin<{ active: boolean }[]>`select revoked_at is null as active from platform.node_shares where node_id = ${page.id}`
    expect(shares).toEqual([{ active: false }])

    const lea = await call("lea", { function: "node.public_link", arguments: { path: page.path, action: "create" } })
    expect(lea.error).toMatchObject({ code: "forbidden" })
  })
})
