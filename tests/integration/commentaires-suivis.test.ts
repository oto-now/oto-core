// @vitest-environment node
// Le suivi des commentaires sur une vraie base (`server/comments/followed.ts`) : les fils ouverts destinés à une personne
// sur son accueil (`homeComments`), lus après une vue de la page (`recordNodeView`), et la ligne de `context`
// (`recentBlock`, « 2 new comments ») depuis la conversation précédente. L'organisation O : Claire mène Ventes, qui
// possède les pages commentées ; Léa en est membre ; Marc lit chaque page par une règle qui le nomme ; Paul n'y a aucun
// accès. Chaque cas commente des pages à lui, et ne lit de l'accueil que les fils de ces pages. L'égalité avec la règle
// de l'email groupé, sur la même base, est dans `commentaires-email.test.ts`, qui joue seul les passages de l'envoi.
// Suite portable.
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { resolveIdentity, type Identity, type PlatformDb } from "@otomata_tech/oto_platform/server"
import { homeComments, pagesWithNewComments } from "../../packages/plateforme/server/comments/followed"
import { postComment, setThreadStatus } from "../../packages/plateforme/server/comments/threads"
import { recentBlock } from "../../packages/plateforme/server/context/blocks/recent"
import { recordNodeView } from "../../packages/plateforme/server/node-views"
import { day } from "../../packages/plateforme/server/nodes/read-format"
import { pendingMigrations, pendingReason } from "../helpers/pending-migrations"
import { hex } from "../helpers/plateforme"
import { createLocalFixtures, type LocalFixtures } from "../helpers/session-locale"
import { spyDb, SQL_SKIP_REASON, sqlConfigured, type SqlReferenceOrg } from "../helpers/sql"

const VERSION = "20261113180000"
const pending = (await pendingMigrations()).includes(VERSION)

const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 180_000
const SUITE = "followed comments on a real database"
const suite = !sqlConfigured ? `${SUITE} (${SQL_SKIP_REASON})` : pending ? `${SUITE} (${pendingReason([VERSION])})` : SUITE

const WHO = ["claire", "lea", "marc", "paul"] as const
type Who = (typeof WHO)[number]
type Page = { id: string; path: string; revision: number }

describe.skipIf(!sqlConfigured || pending)(suite, { timeout: NETWORK_TIMEOUT }, () => {
  let fx: LocalFixtures
  let o: SqlReferenceOrg
  const sessions = new Map<Who, { db: PlatformDb; identity: Identity }>()

  const as = (who: Who) => {
    const found = sessions.get(who)
    if (!found) throw new Error(`${who} has no session`)
    return found
  }

  /** Une page publiée de Ventes, à ce cas seulement, que Marc lit par une règle qui le nomme. */
  async function page(title: string): Promise<Page> {
    const path = `ventes/suivi_${hex(3)}`
    const id = await fx.createNode(o.org.id, { parentId: o.nodes.ventes, path, title })
    const { revision } = await fx.publishBlocks(id, [{ type: "paragraph", text: "Le corps de la page." }])
    await fx.addRule({ orgId: o.org.id, nodeId: id, userId: o.people.marc.id, level: "read" })
    return { id, path, revision }
  }

  /** Un commentaire écrit par `who` ; rend l'identifiant de son fil. */
  async function post(who: Who, input: Record<string, unknown>): Promise<string> {
    const { data } = await postComment(as(who).db, as(who).identity, input)
    return data.thread.id
  }

  /** Les fils de l'accueil de `who` sur ces pages, dans l'ordre servi. */
  async function home(who: Who, pages: readonly Page[]) {
    const { threads } = await homeComments(as(who).db, as(who).identity)
    return threads.filter((thread) => pages.some((one) => one.path === thread.path))
  }

  /** Les lignes du bloc des contenus récents de `who` qui nomment l'une de ces pages. */
  async function served(who: Who, since: string | null, pages: readonly Page[]): Promise<string[]> {
    const lines = (await recentBlock(as(who).db, as(who).identity, since))?.text.split("\n") ?? []
    return lines.filter((line) => pages.some((one) => line.includes(one.path)))
  }

  const anHourAgo = () => new Date(Date.now() - 3_600_000).toISOString()

  beforeAll(async () => {
    fx = createLocalFixtures()
    o = await fx.buildReferenceOrg()
    for (const who of WHO) {
      const person = o.people[who]
      const db = fx.as(person)
      sessions.set(who, { db, identity: await resolveIdentity(db, o.host, { userId: person.id, email: person.email }) })
    }
  }, SETUP_TIMEOUT)

  afterAll(async () => {
    await fx?.cleanup()
  }, SETUP_TIMEOUT)

  it("should put a thread on the home of the person it mentions, of those who wrote in it before another, and of the leads of the owning team for a new thread, and of nobody else (AC1, AC2, AC3)", async () => {
    const p = await page("Offre tarifaire")
    const unmentioned = await post("marc", { path: p.path, text: "Le tarif de base est-il à jour ?" })
    const mention = await post("marc", { path: p.path, text: `@${o.people.lea.name}   peux-tu\nconfirmer la remise ?` })
    const talk = await post("lea", { path: p.path, text: "Fil ouvert par Léa." })
    const alone = Object.fromEntries(await Promise.all((["lea", "marc"] as const).map(async (who) => [who, (await home(who, [p])).map((thread) => thread.id)])))
    await post("marc", { path: p.path, thread: talk, text: "Réponse de Marc." })
    await post("lea", { path: p.path, thread: talk, text: "Réponse de Léa." })

    const homes = Object.fromEntries(await Promise.all(WHO.map(async (who) => [who, (await home(who, [p])).map((thread) => thread.id).sort()])))
    const [line] = (await home("lea", [p])).filter((thread) => thread.id === mention)

    // Avant toute réponse : Léa n'a que le fil qui la mentionne, Marc rien (ses seuls commentaires).
    expect(alone).toEqual({ lea: [mention], marc: [] })
    expect(homes).toEqual({
      claire: [unmentioned, mention, talk].sort(),
      lea: [mention, talk].sort(),
      marc: [talk],
      paul: [],
    })
    expect({ ...line, at: null }).toEqual({
      id: mention,
      path: p.path,
      title: "Offre tarifaire",
      author: o.people.marc.name,
      viaAssistant: false,
      excerpt: `@${o.people.lea.name} peux-tu confirmer la remise ?`,
      at: null,
      unread: true,
    })
  })

  it("should mark a thread read once the person has opened its page, keep it on her home, and mark it unread again at the next comment of another (AC1)", async () => {
    const p = await page("Grille de remises")
    const thread = await post("marc", { path: p.path, text: `@${o.people.lea.name} à relire.` })
    const unreadOf = async () => (await home("lea", [p])).map((line) => [line.id, line.unread])

    const before = await unreadOf()
    await recordNodeView(as("lea").db, as("lea").identity, { path: p.path })
    const afterTheView = await unreadOf()
    await post("lea", { path: p.path, thread, text: "Relu." })
    await post("marc", { path: p.path, thread, text: "Merci." })
    // La vue d'une autre personne ne lit rien pour Léa.
    await recordNodeView(as("marc").db, as("marc").identity, { path: p.path })
    const afterAReply = await unreadOf()

    expect([before, afterTheView, afterAReply]).toEqual([[[thread, true]], [[thread, false]], [[thread, true]]])
  })

  it("should leave out a resolved thread, a thread of a trashed page and of a page the person no longer reads, on the home and in context (AC4)", async () => {
    const [kept, resolved, trashed, lost] = [await page("Page gardée"), await page("Page au fil résolu"), await page("Page à la corbeille"), await page("Page retirée à Marc")]
    const pages = [kept, resolved, trashed, lost]
    const since = anHourAgo()
    const threads = new Map<Page, string>()
    for (const one of pages) threads.set(one, await post("lea", { path: one.path, text: `@${o.people.marc.name} à relire.` }))
    const before = (await home("marc", pages)).map((thread) => thread.path).sort()
    await setThreadStatus(as("lea").db, as("lea").identity, threads.get(resolved), { status: "resolved" })
    await fx.admin`update platform.nodes set deleted_at = now() where id = ${trashed.id}`
    await fx.admin`delete from platform.access_rules where node_id = ${lost.id} and subject_user_id = ${o.people.marc.id}`

    const after = (await home("marc", pages)).map((thread) => thread.path)
    // Une page publiée depuis la borne garde sa ligne de nouveauté : seule la marque des commentaires part.
    const lines = (await served("marc", since, pages)).filter((line) => line.includes("new comment"))

    expect(before).toEqual(pages.map((one) => one.path).sort())
    expect(after).toEqual([kept.path])
    expect(lines.map((line) => line.split(" ")[1])).toEqual([kept.path])
  })

  it("should leave out a thread of a page the person no longer reads, even when the base serves its rows (AC4)", async () => {
    const [kept, lost] = [await page("Page encore lue"), await page("Page que la base rend à Marc")]
    for (const one of [kept, lost]) await post("lea", { path: one.path, text: `@${o.people.marc.name} à relire.` })
    await fx.admin`delete from platform.access_rules where node_id = ${lost.id} and subject_user_id = ${o.people.marc.id}`
    // La connexion d'administration en client du paquet : sans RLS, elle rend le fil de la page que Marc ne lit plus.
    // Seul le filtre du service l'écarte (`security-patterns.md § Droits dans le service`).
    const unfiltered: PlatformDb = {
      tx: async (fn) => {
        const { value } = await fx.admin.begin(async (sql) => ({ value: await fn(sql) }))
        return value
      },
    }

    const { threads } = await homeComments(unfiltered, as("marc").identity)

    expect(threads.map((thread) => thread.path).filter((path) => path === kept.path || path === lost.path)).toEqual([kept.path])
  })

  it("should say in context the comments of others since the previous conversation, on the line of the page, in one more read, and nothing without one (AC6)", async () => {
    const p = await page("Conditions de vente")
    const since = anHourAgo()
    const first = await post("lea", { path: p.path, text: `@${o.people.marc.name} premier point.` })
    await post("lea", { path: p.path, text: `@${o.people.marc.name} second point.` })
    // La réponse de Marc lui-même ne compte pas ; celle de Claire, dans un fil qui lui est destiné, oui.
    await post("marc", { path: p.path, thread: first, text: "Vu." })
    await post("claire", { path: p.path, thread: first, text: "D'accord." })
    const today = day(new Date().toISOString())
    const { db, sent } = spyDb(as("marc").db)

    const pagesOfMarc = (await pagesWithNewComments(db, as("marc").identity, since)).filter((one) => one.path === p.path)
    const [withNews, later, unbounded, author] = [
      await served("marc", since, [p]),
      await served("marc", new Date(Date.now() + 60_000).toISOString(), [p]),
      await served("marc", null, [p]),
      await served("lea", since, [p]),
    ]

    expect(pagesOfMarc.map((one) => [one.kind, one.title, one.comments, day(one.at)])).toEqual([["page", "Conditions de vente", 3, today]])
    // Une lecture des fils (avec la dernière visite et la borne), puis les niveaux en un lot : rien par fil ni par page.
    // Deux lectures, quel que soit le nombre de fils et de pages : les fils (avec la dernière visite et la borne, la
    // première table lue étant `node_views`), puis les niveaux de leurs pages en un lot.
    expect(sent.map((query) => [query.op, query.target])).toEqual([
      ["select", "node_views"],
      ["select", "nodes"],
    ])
    expect(withNews).toEqual([`- ${p.path} (page, new v${p.revision}, 3 new comments, ${today}): Conditions de vente`])
    expect([later, unbounded]).toEqual([[], []])
    // Léa, qui a écrit dans le fil : la réponse de Marc et celle de Claire sont nouvelles pour elle.
    expect(author).toEqual([`- ${p.path} (page, new v${p.revision}, 2 new comments, ${today}): Conditions de vente`])
  })
})
