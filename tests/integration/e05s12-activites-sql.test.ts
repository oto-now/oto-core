// @vitest-environment node
// Les activités de l'accueil sur une vraie base (E05-S12, lot B, AC-12, AC-15, AC-17), la portée et les
// niveaux étant le sujet : `listActivities` lit le journal dans la portée H74 décidée par le service (qui
// administre voit l'organisation ; un membre ses gestes, et ceux des équipes qu'il mène), ne rend jamais
// `args` entiers, coupe l'espace personnel d'autrui à `private/<handle>` (D44), ne donne titre et lien que
// d'un contenu que la personne lit, écarte les lignes en erreur et hors période, et dit `truncated` au-delà
// de 2 000 lignes. Les procédures utiles (AC-18) : celles que la personne lit, publiées, dans l'ordre du bloc
// servi. Portable : l'organisation O d'E01-S04 par `buildReferenceOrg`, chaque personne par `fx.as`.
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { ActivityPage } from "../../packages/plateforme/schemas"
import { JOURNAL_ROWS_SCANNED } from "../../packages/plateforme/schemas/journal"
import { listActivities } from "../../packages/plateforme/server/activities"
import { proceduresBlock, usefulProcedures } from "../../packages/plateforme/server/context/blocks/procedures"
import type { PlatformDb } from "../../packages/plateforme/server/db"
import { homeContents, homeNews } from "../../packages/plateforme/server/home-contents"
import { resolveIdentity, type Identity } from "../../packages/plateforme/server/identity"
import { ctxCode, hex } from "../helpers/plateforme"
import { createSqlFixtures, portable, recordDb, spyDb, sqlConfigured, type SqlFixtures, type SqlReferenceOrg } from "../helpers/sql"

const SETUP_TIMEOUT = 240_000
const NETWORK_TIMEOUT = 60_000
const MINUTE = 60_000
const SECRET = "SECRET-NOTE-E05S12"

type Who = "ada" | "claire" | "lea"

describe.skipIf(!sqlConfigured)(portable("listActivities on a real base: scope, levels, personal spaces (E05-S12, AC-12, AC-15, AC-17)"), { timeout: NETWORK_TIMEOUT }, () => {
  let fx: SqlFixtures
  let o: SqlReferenceOrg
  const ran = ctxCode()

  beforeAll(async () => {
    fx = createSqlFixtures()
    o = await fx.buildReferenceOrg()
    const orgId = o.org.id
    const ids = await fx.seedNodes(orgId, [
      { path: "ventes/tarifs", kind: "page", title: "Tarifs 2026", summary: "La grille de l'année." },
      { path: "ventes/salons", kind: "table", title: "Salons", summary: "Les salons de l'année." },
      { path: "ventes/relance_devis", kind: "procedure", title: "Relancer les devis", summary: "Relance les devis en attente." },
      { path: "ventes/ancienne", kind: "page", title: "Ancienne grille", summary: "La grille d'avant." },
      { path: "private/lea/notes", kind: "page", title: "Notes", summary: "Mes notes." },
      { path: "ventes/a_suivre", kind: "procedure", title: "Suivre les prospects", summary: "Suit les prospects." },
      { path: "ventes/brouillon", kind: "procedure", title: "Brouillon", summary: "Pas encore publiée.", published: false },
      { path: "private/lea/ma_procedure", kind: "procedure", title: "Ma procédure", summary: "Pour Léa seule." },
    ])
    const { lea, claire, paul } = o.people
    // Une page que Claire ne lit pas (règle « none » pour elle), mise à la corbeille par Léa : sa nature ne lui est pas dite.
    const cachee = await fx.createNode(orgId, { parentId: o.nodes.ventes, path: "ventes/cachee", title: "Page cachée" })
    await fx.addRule({ orgId, nodeId: cachee, userId: claire.id, level: "none" })
    await fx.admin`update platform.nodes set deleted_at = now() where id in ${fx.admin([ids.get("ventes/ancienne") ?? "", cachee])}`
    const { ventes, support } = o.teams
    const now = Date.now()
    // Du plus ancien au plus récent : l'identifiant croît avec le temps, comme en production.
    const lines = [
      { at: now - 8 * 24 * 60 * MINUTE, user: lea.id, team: ventes, method: "api", tool: "POST nodes", target: "ventes/tarifs", args: { path: "ventes/tarifs", base_revision: 0 } },
      { at: now - 120 * MINUTE, user: lea.id, team: ventes, method: "api", tool: "POST nodes", target: "ventes/tarifs", args: { path: "ventes/tarifs", base_revision: 2 } },
      { at: now - 100 * MINUTE, user: lea.id, team: ventes, method: "api", tool: "POST nodes", target: "ventes/tarifs", args: { path: "ventes/tarifs", base_revision: 1 } },
      { at: now - 90 * MINUTE, user: lea.id, team: ventes, method: "api", tool: "POST nodes", target: "ventes/tarifs", args: { path: "ventes/tarifs", base_revision: 1, publish: true, note: SECRET } },
      {
        at: now - 80 * MINUTE,
        user: lea.id,
        team: ventes,
        method: "tools/call",
        tool: `${o.org.prefix}_call`,
        target: "table.write",
        args: { ctx: ran, function: "table.write", arguments: { table: "ventes/salons", rows: [{ key: "Salon A", set: { ville: { value: SECRET, comment: "Site" } } }] } },
      },
      { at: now - 70 * MINUTE, user: lea.id, team: null, method: "tools/call", tool: `${o.org.prefix}_context`, target: "ventes/relance_devis", ctx: ran, args: { phrase: "relance les devis" } },
      { at: now - 60 * MINUTE, user: lea.id, team: null, method: "api", tool: "POST nodes", target: "private/lea/notes", args: { path: "private/lea/notes", title: "Notes", kind: "page" } },
      { at: now - 50 * MINUTE, user: lea.id, team: ventes, method: "api", tool: "POST trash", target: "ventes/ancienne", args: { path: "ventes/ancienne" } },
      { at: now - 45 * MINUTE, user: lea.id, team: ventes, method: "api", tool: "POST trash", target: "ventes/cachee", args: { path: "ventes/cachee" } },
      { at: now - 40 * MINUTE, user: lea.id, team: ventes, method: "api", tool: "POST nodes", target: "ventes/tarifs", args: { path: "ventes/tarifs" }, error: true },
      { at: now - 30 * MINUTE, user: paul.id, team: support, method: "api", tool: "POST nodes", target: "support/faq", args: { path: "support/faq", base_revision: 0 } },
      { at: now - 20 * MINUTE, user: claire.id, team: ventes, method: "api", tool: "POST tables/review", target: "ventes/salons", args: { table: "ventes/salons", key: "Salon A" } },
      { at: now - 10 * MINUTE, user: lea.id, team: ventes, method: "api", tool: "POST nodes/position", target: "ventes/tarifs", args: { path: "ventes/tarifs", after: null } },
      // E11-S02 (AC-h3) : les gestes d'un assistant par `call`. Un récapitulatif (sans `confirm`) et un abandon de
      // brouillon ne comptent pas ; deux suppressions confirmées de lignes se regroupent, leurs lignes à revoir lues
      // de `args._outcome` (un `_outcome` qui n'est pas un entier est ignoré) ; une mise à la corbeille confirmée.
      { at: now - 8 * MINUTE, user: lea.id, team: ventes, method: "tools/call", tool: `${o.org.prefix}_call`, target: "table.delete_rows", args: { ctx: ran, function: "table.delete_rows", arguments: { table: "ventes/salons", keys: ["Salon A"] } } },
      {
        at: now - 7 * MINUTE,
        user: lea.id,
        team: ventes,
        method: "tools/call",
        tool: `${o.org.prefix}_call`,
        target: "table.delete_rows",
        args: { ctx: ran, function: "table.delete_rows", arguments: { table: "ventes/salons", keys: ["Salon A", "Salon B"] }, confirm: true, _outcome: { deleted: 2, review: 1 } },
      },
      {
        at: now - 6 * MINUTE,
        user: lea.id,
        team: ventes,
        method: "tools/call",
        tool: `${o.org.prefix}_call`,
        target: "table.delete_rows",
        args: { ctx: ran, function: "table.delete_rows", arguments: { table: "ventes/salons", keys: ["Salon C"] }, confirm: true, _outcome: { deleted: 1, review: "1" } },
      },
      { at: now - 5 * MINUTE, user: lea.id, team: ventes, method: "tools/call", tool: `${o.org.prefix}_call`, target: "node.discard_draft", args: { ctx: ran, function: "node.discard_draft", arguments: { path: "ventes/salons" }, confirm: true } },
      { at: now - 4 * MINUTE, user: lea.id, team: ventes, method: "tools/call", tool: `${o.org.prefix}_call`, target: "node.trash", args: { ctx: ran, function: "node.trash", arguments: { path: "ventes/tarifs" }, confirm: true } },
    ]
    for (const line of lines) {
      await fx.admin`
        insert into platform.journal (ts, org_id, user_id, team_id, ctx, method, tool, target, args, is_error)
        values (${new Date(line.at)}, ${orgId}, ${line.user}, ${line.team}, ${line.ctx ?? null}, ${line.method}, ${line.tool}, ${line.target},
                ${fx.admin.json(line.args)}, ${line.error ?? false})`
    }
  }, SETUP_TIMEOUT)

  afterAll(async () => {
    await fx?.cleanup()
  }, SETUP_TIMEOUT)

  async function activitiesOf(who: Who): Promise<ActivityPage> {
    const person = o.people[who]
    const db = fx.as(person)
    return listActivities(db, await resolveIdentity(db, o.host, { userId: person.id, email: person.email }), { periodDays: 7 })
  }

  const shown = (page: ActivityPage) => page.activities.map(({ verb, path, title, kind, count, userName }) => [verb, path, title, kind, count, userName])

  it("should give a member her own gestures only, at both doors, errors, other lines and the older week left out, the whole of her personal space kept", async () => {
    const page = await activitiesOf("lea")

    expect(shown(page)).toEqual([
      ["trashed", "ventes/tarifs", "Tarifs 2026", "page", 1, "Léa Roux"],
      ["deleted_rows", "ventes/salons", "Salons", "table", 2, "Léa Roux"],
      ["trashed", "ventes/cachee", null, "page", 1, "Léa Roux"],
      ["trashed", "ventes/ancienne", null, "page", 1, "Léa Roux"],
      ["created", "private/lea/notes", "Notes", "page", 1, "Léa Roux"],
      ["ran", "ventes/relance_devis", "Relancer les devis", "procedure", 1, "Léa Roux"],
      ["wrote_rows", "ventes/salons", "Salons", "table", 1, "Léa Roux"],
      ["published", "ventes/tarifs", "Tarifs 2026", "page", 1, "Léa Roux"],
      ["edited", "ventes/tarifs", "Tarifs 2026", "page", 2, "Léa Roux"],
    ])
    expect(page.activities.find((activity) => activity.verb === "ran")?.ctx).toBe(ran)
    expect(page.activities.find((activity) => activity.verb === "deleted_rows")?.inReview).toBe(1)
    expect(page.truncated).toBe(false)
  })

  it("should give a team lead her gestures and those of the team she leads, never a gesture of another team nor of a personal space", async () => {
    expect(shown(await activitiesOf("claire"))).toEqual([
      ["trashed", "ventes/tarifs", "Tarifs 2026", "page", 1, "Léa Roux"],
      ["deleted_rows", "ventes/salons", "Salons", "table", 2, "Léa Roux"],
      ["reviewed", "ventes/salons", "Salons", "table", 1, "Claire Morel"],
      ["trashed", "ventes/cachee", null, null, 1, "Léa Roux"],
      ["trashed", "ventes/ancienne", null, "page", 1, "Léa Roux"],
      ["wrote_rows", "ventes/salons", "Salons", "table", 1, "Léa Roux"],
      ["published", "ventes/tarifs", "Tarifs 2026", "page", 1, "Léa Roux"],
      ["edited", "ventes/tarifs", "Tarifs 2026", "page", 2, "Léa Roux"],
    ])
  })

  // 1.4.13 : le filtre de l'accueil resserre la portée du journal, jamais ne l'élargit.
  it("should narrow the feed to her own gestures (Moi), to those of her teams (Mes équipes), never beyond her journal scope", async () => {
    const person = o.people.claire
    const db = fx.as(person)
    const identity = await resolveIdentity(db, o.host, { userId: person.id, email: person.email })
    const auteurs = async (scope: "me" | "teams" | "org") =>
      [...new Set((await listActivities(db, identity, { periodDays: 7, scope })).activities.map((activity) => activity.userName))].sort()

    expect(await auteurs("me")).toEqual(["Claire Morel"])
    expect(await auteurs("teams")).toEqual(["Claire Morel", "Léa Roux"])
    // Toute l'organisation reste bornée par sa portée : ni Paul (Support), ni l'espace personnel de Léa.
    expect(await auteurs("org")).toEqual(await auteurs("teams"))
  })

  it("should give an administrator the whole organisation, another person's personal space cut to private/<handle>, without title nor nature", async () => {
    expect(shown(await activitiesOf("ada"))).toEqual([
      ["trashed", "ventes/tarifs", "Tarifs 2026", "page", 1, "Léa Roux"],
      ["deleted_rows", "ventes/salons", "Salons", "table", 2, "Léa Roux"],
      ["reviewed", "ventes/salons", "Salons", "table", 1, "Claire Morel"],
      ["edited", "support/faq", "FAQ", "page", 1, "Paul Girard"],
      ["trashed", "ventes/cachee", null, "page", 1, "Léa Roux"],
      ["trashed", "ventes/ancienne", null, "page", 1, "Léa Roux"],
      ["created", "private/lea", null, null, 1, "Léa Roux"],
      ["ran", "ventes/relance_devis", "Relancer les devis", "procedure", 1, "Léa Roux"],
      ["wrote_rows", "ventes/salons", "Salons", "table", 1, "Léa Roux"],
      ["published", "ventes/tarifs", "Tarifs 2026", "page", 1, "Léa Roux"],
      ["edited", "ventes/tarifs", "Tarifs 2026", "page", 2, "Léa Roux"],
    ])
  })

  it("should read the journal with the scope in the query, and never return whole arguments, only the keys that classify", async () => {
    const person = o.people.claire
    const spied = spyDb(fx.as(person))
    const page = await listActivities(spied.db, await resolveIdentity(fx.as(person), o.host, { userId: person.id, email: person.email }), { periodDays: 7 })

    const journal = spied.sent.filter((query) => query.target === "journal")
    expect(journal).toHaveLength(1)
    const text = String(journal[0].detail)
    // Chaque lecture de `args` n'en prend qu'une clé (`->`, `->>`, `?`), jamais la valeur entière.
    expect(text).toMatch(/j\.args/)
    expect(text).not.toMatch(/j\.args(?!\s*(->|\?))/)
    expect(JSON.stringify(page)).not.toContain(SECRET)
  })

  // Un service de lecture tient ses requêtes en une transaction (`supabase-patterns.md § Couplage à Supabase
  // (ADR-012)`) : les lectures de l'accueil, comptées par l'espion de la face SQL (`recordDb`).
  it.each<[string, (db: PlatformDb, identity: Identity) => Promise<unknown>]>([
    ["listActivities", (db, identity) => listActivities(db, identity, { periodDays: 7 })],
    ["usefulProcedures", (db, identity) => usefulProcedures(db, identity, 6)],
    // 1.4.13 : la carte « Reprendre » (une page par onglet) et les nouveautés.
    ["homeContents (recent)", (db, identity) => homeContents(db, identity, { tab: "recent", scope: "teams" })],
    ["homeContents (viewed)", (db, identity) => homeContents(db, identity, { tab: "viewed", scope: "org" })],
    ["homeNews", (db, identity) => homeNews(db, identity)],
  ])("should read %s in one transaction", async (name, read) => {
    const person = o.people.claire
    const identity = await resolveIdentity(fx.as(person), o.host, { userId: person.id, email: person.email })
    const recorded = recordDb(fx.as(person))

    await read(recorded.db, identity)
    const transactions = recorded.requests.filter((request) => request.kind === "transaction").length
    if (process.env.E05S12B_MESURE) console.info(`[e05s12b] ${name}: ${transactions} transactions`)
    expect(transactions).toBe(1)
  })

  /** Les chemins des procédures listées par le bloc servi à `context`, dans son ordre. */
  const blockPaths = (text: string) => text.split("\n").flatMap((line) => /^- ([a-z0-9_/]+): /.exec(line)?.[1] ?? [])

  it.each<[Who, number, string[]]>([
    // Léa a lancé « Relancer les devis » : l'usage la met devant, puis le chemin ; sa procédure privée est à elle.
    ["lea", 2, ["ventes/relance_devis", "private/lea/ma_procedure"]],
    // Ada n'a rien lancé : l'ordre des chemins ; ni la procédure privée de Léa, ni le brouillon.
    ["ada", 6, ["ventes/a_suivre", "ventes/relance_devis"]],
  ])("should give %s the first %i useful procedures in the order of the served block, only those she reads and published (AC-18)", async (who, limit, expected) => {
    const person = o.people[who]
    const db = fx.as(person)
    const identity = await resolveIdentity(db, o.host, { userId: person.id, email: person.email })

    const procedures = await usefulProcedures(db, identity, limit)
    expect(procedures.map((procedure) => procedure.path)).toEqual(expected)
    expect(procedures.find((procedure) => procedure.path === "ventes/relance_devis")?.title).toBe("Relancer les devis")
    expect(blockPaths((await proceduresBlock(db, identity)).text).slice(0, limit)).toEqual(expected)
  })
})

describe.skipIf(!sqlConfigured)(portable("listActivities on a real base: more lines than the read takes (E05-S12, AC-17)"), { timeout: NETWORK_TIMEOUT }, () => {
  let fx: SqlFixtures
  let host: string
  let marc: { id: string; email: string }

  beforeAll(async () => {
    fx = createSqlFixtures()
    host = `t${hex(4)}.example.invalid`
    const org = await fx.createOrg({ hosts: [host] })
    await fx.createTree(org.id)
    marc = await fx.createUser({ fullName: "Marc Petit" })
    await fx.addMember(org.id, marc.id, { profile: { handle: "marc", name: "Marc Petit" } })
    const start = Date.now() - 60 * MINUTE
    const rows = Array.from({ length: JOURNAL_ROWS_SCANNED + 1 }, (_, rank) => ({
      ts: new Date(start + rank * 1000),
      org_id: org.id,
      user_id: marc.id,
      method: "api",
      tool: "POST trash",
      target: "guide",
      is_error: false,
    }))
    await fx.admin`insert into platform.journal ${fx.admin(rows)}`
  }, SETUP_TIMEOUT)

  afterAll(async () => {
    await fx?.cleanup()
  }, SETUP_TIMEOUT)

  it("should read the 2,000 most recent lines and say that the week holds more", async () => {
    const db = fx.as(marc)
    const page = await listActivities(db, await resolveIdentity(db, host, { userId: marc.id, email: marc.email }), { periodDays: 7 })

    expect(page.truncated).toBe(true)
    expect(page.activities.map(({ verb, count }) => [verb, count])).toEqual([["trashed", JOURNAL_ROWS_SCANNED]])
  })
})
