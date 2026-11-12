// @vitest-environment node
// Les commentaires d'une page sur une vraie base (`server/comments/`, ressources `comments` et `comment-threads` de
// l'API ; migration `20261112090000`). Un test par critère du service, sous trois personnes de l'organisation O : Marc
// lit la page (une règle de lecture le nomme), Léa l'écrit (membre de l'équipe propriétaire), Paul n'y a aucun accès ;
// Ada l'administre. Chaque cas commente une page à lui, sous `ventes`. Les refus sont comparés mot pour mot, et un
// refus décidé par le service se prouve par l'absence de toute requête d'écriture (`spyDb`). La RLS sous un jeton est
// dans `role-dans-les-commentaires.test.ts`. Suite portable.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { handlePlateforme } from "@otomata_tech/oto_platform/api"
import { resolveIdentity, writeNode, type Identity, type PlatformDb } from "@otomata_tech/oto_platform/server"
import { deleteComment, editComment } from "../../packages/plateforme/server/comments/comments"
import { listComments, postComment, setThreadStatus } from "../../packages/plateforme/server/comments/threads"
import { pendingMigrations, pendingReason } from "../helpers/pending-migrations"
import { hex } from "../helpers/plateforme"
import { createLocalFixtures, type LocalFixtures } from "../helpers/session-locale"
import { spyDb, SQL_SKIP_REASON, sqlConfigured, writesOf, type SqlReferenceOrg } from "../helpers/sql"

const VERSION = "20261112090000"
const pending = (await pendingMigrations()).includes(VERSION)

const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 180_000
const SUITE = "comments of a page on a real database"
const suite = !sqlConfigured ? `${SUITE} (${SQL_SKIP_REASON})` : pending ? `${SUITE} (${pendingReason([VERSION])})` : SUITE

type Who = "ada" | "claire" | "lea" | "marc" | "paul"
type Session = { db: PlatformDb; identity: Identity }
type Page = { id: string; path: string; revision: number; intro: string; heading: string; price: string }
type Task = () => Promise<void>

/** Le code et le message d'un refus du service. */
async function refusal(promise: Promise<unknown>): Promise<{ code: unknown; message: unknown }> {
  const error: unknown = await promise.then(
    () => null,
    (reason: unknown) => reason,
  )
  if (!(error instanceof Error) || !("code" in error)) throw new Error(`expected a refusal of the service, got ${String(error)}`)
  return { code: error.code, message: error.message }
}

describe.skipIf(!sqlConfigured || pending)(suite, { timeout: NETWORK_TIMEOUT }, () => {
  let fx: LocalFixtures
  let o: SqlReferenceOrg
  const sessions = new Map<Who, Session>()
  const tokens = new Map<Who, string>()

  function as(who: Who): Session {
    const found = sessions.get(who)
    if (!found) throw new Error(`${who} has no session`)
    return found
  }

  /**
   * Une page publiée de Ventes, à ce cas seulement : un paragraphe avant le premier titre, le titre « Tarifs », un
   * paragraphe sous lui. Marc la lit par une règle qui le nomme.
   */
  async function page(): Promise<Page> {
    const path = `ventes/fil_${hex(3)}`
    const id = await fx.createNode(o.org.id, { parentId: o.nodes.ventes, path, title: "Page commentée" })
    const { revision, blockIds } = await fx.publishBlocks(id, [
      { type: "paragraph", text: "Avant le premier titre." },
      { type: "heading", text: "Tarifs", data: { level: 1 } },
      { type: "paragraph", text: "Le tarif de base est de 100 euros." },
    ])
    await fx.addRule({ orgId: o.org.id, nodeId: id, userId: o.people.marc.id, level: "read" })
    const [intro, heading, price] = blockIds
    return { id, path, revision, intro, heading, price }
  }

  const post = (who: Who, input: Record<string, unknown>) => postComment(as(who).db, as(who).identity, input)

  const threadsOf = (nodeId: string) => fx.admin<{ id: string; block_id: string | null; quote: string | null; block_revision: number | null; status: string; resolved_by: string | null; resolved: boolean; created_by: string | null }[]>`
    select id, block_id, quote, block_revision, status, resolved_by, resolved_at is not null as resolved, created_by
      from platform.comment_threads where node_id = ${nodeId} order by created_at, id`

  const commentsOf = (nodeId: string) => fx.admin<{ author: string | null; text: string; mentions: string[]; edited: boolean }[]>`
    select c.author, c.text, c.mentions::text[] as mentions, c.edited_at is not null as edited
      from platform.comments c join platform.comment_threads t on t.id = c.thread_id
     where t.node_id = ${nodeId} order by c.created_at, c.id`

  /** Ce qu'un service écrit sous `who`, relevé par l'espion : un refus décidé avant la requête n'envoie aucune écriture. */
  async function writesUnder<T>(who: Who, run: (db: PlatformDb, identity: Identity) => Promise<T>): Promise<{ refused: { code: unknown; message: unknown }; writes: unknown[] }> {
    const spied = spyDb(as(who).db)
    const refused = await refusal(run(spied.db, as(who).identity))
    return { refused, writes: writesOf(spied.sent) }
  }

  /**
   * La connexion d'administration en client du paquet : sans RLS, elle rend les fils et les commentaires d'une page que
   * l'appelant ne lit pas. Un refus n'y tient qu'à la décision du service (`security-patterns.md § Droits dans le service`).
   */
  const unfiltered = (): PlatformDb => ({
    tx: async (fn) => {
      const { value } = await fx.admin.begin(async (sql) => ({ value: await fn(sql) }))
      return value
    },
  })

  beforeAll(async () => {
    fx = createLocalFixtures()
    o = await fx.buildReferenceOrg()
    for (const who of ["ada", "claire", "lea", "marc", "paul"] as const) {
      const person = o.people[who]
      const db = fx.as(person)
      sessions.set(who, { db, identity: await resolveIdentity(db, o.host, { userId: person.id, email: person.email }) })
      tokens.set(who, (await fx.sessionFor(person)).accessToken)
    }
  }, SETUP_TIMEOUT)

  afterAll(async () => {
    await fx?.cleanup()
  }, SETUP_TIMEOUT)

  it("should let a reader open a thread on a published block, with or without a quote, or on the whole page, and refuse a foreign block or an absent quote (AC1)", async () => {
    const p = await page()
    const elsewhere = await page()
    const [{ revision: blockRevision }] = await fx.admin<{ revision: number }[]>`select revision from platform.blocks where id = ${p.price} and state = 'published'`

    const quoted = await post("marc", { path: p.path, block: p.price, quote: "tarif de base", text: "Hors taxes ?" })
    await post("marc", { path: p.path, block: p.intro, text: "À préciser." })
    await post("marc", { path: p.path, text: "Belle page." })

    expect(quoted).toMatchObject({ data: { created: true, thread: { status: "open", anchor: "intact", block: p.price, quote: "tarif de base", section: "Tarifs" } }, target: p.path, teamId: o.teams.ventes })
    const marc = o.people.marc.id
    const open = { status: "open", resolved_by: null, resolved: false, created_by: marc }
    expect((await threadsOf(p.id)).map((row) => ({ ...row, id: undefined }))).toEqual([
      { ...open, block_id: p.price, quote: "tarif de base", block_revision: blockRevision },
      { ...open, block_id: p.intro, quote: null, block_revision: blockRevision },
      { ...open, block_id: null, quote: null, block_revision: null },
    ])
    expect((await commentsOf(p.id)).map((comment) => comment.text)).toEqual(["Hors taxes ?", "À préciser.", "Belle page."])

    const foreign = await writesUnder("marc", (db, identity) => postComment(db, identity, { path: p.path, block: elsewhere.price, text: "Ailleurs." }))
    const absent = await writesUnder("marc", (db, identity) => postComment(db, identity, { path: p.path, block: p.price, quote: "tarif réduit", text: "Où ?" }))
    expect([foreign, absent]).toEqual([
      { refused: { code: "invalid_arguments", message: `Block ${elsewhere.price} is not a published block of ${p.path}: comment a published block, or the whole page.` }, writes: [] },
      { refused: { code: "invalid_arguments", message: `The quote is not in the text of block ${p.price}: quote a passage of the published block, or none.` }, writes: [] },
    ])
    expect(await threadsOf(p.id)).toHaveLength(3)
  })

  it("should answer not_found, as for an unknown path, on a page the person does not read, a trashed page or an unknown one, and write nothing (AC2)", async () => {
    const p = await page()
    const trashed = await page()
    const opened = await post("marc", { path: p.path, text: "Un fil que Paul ne lit pas." })
    const thread = opened.data.thread.id
    await post("marc", { path: trashed.path, text: "Avant la corbeille." })
    await fx.admin`update platform.nodes set deleted_at = now() where id = ${trashed.id}`
    const unknownPath = (path: string) => ({ code: "not_found", message: `Unknown path ${path}.` })

    expect({
      read: await refusal(listComments(as("paul").db, as("paul").identity, p.path)),
      write: await writesUnder("paul", (db, identity) => postComment(db, identity, { path: p.path, text: "Je passe." })),
      reply: await writesUnder("paul", (db, identity) => postComment(db, identity, { path: p.path, thread, text: "Je réponds." })),
      resolve: await writesUnder("paul", (db, identity) => setThreadStatus(db, identity, thread, { status: "resolved" })),
      edit: await writesUnder("paul", (db, identity) => editComment(db, identity, opened.data.comment, { text: "Réécrit." })),
      remove: await writesUnder("paul", (db, identity) => deleteComment(db, identity, opened.data.comment)),
      trashedRead: await refusal(listComments(as("marc").db, as("marc").identity, trashed.path)),
      trashedWrite: await writesUnder("lea", (db, identity) => postComment(db, identity, { path: trashed.path, text: "Trop tard." })),
      unknown: await refusal(listComments(as("ada").db, as("ada").identity, "ventes/aucune_page")),
      malformed: await refusal(listComments(as("ada").db, as("ada").identity, "Pas un chemin")),
    }).toEqual({
      read: unknownPath(p.path),
      write: { refused: unknownPath(p.path), writes: [] },
      reply: { refused: unknownPath(p.path), writes: [] },
      resolve: { refused: { code: "not_found", message: `No comment thread ${thread} on a page of Acme Test.` }, writes: [] },
      edit: { refused: { code: "not_found", message: `No comment ${opened.data.comment} on a page of Acme Test.` }, writes: [] },
      remove: { refused: { code: "not_found", message: `No comment ${opened.data.comment} on a page of Acme Test.` }, writes: [] },
      trashedRead: unknownPath(trashed.path),
      trashedWrite: { refused: unknownPath(trashed.path), writes: [] },
      unknown: unknownPath("ventes/aucune_page"),
      malformed: unknownPath("Pas un chemin"),
    })
    expect((await commentsOf(p.id)).map((comment) => comment.text)).toEqual(["Un fil que Paul ne lit pas."])
  })

  it("should answer not_found on a thread and a comment of a page the person does not read, even when the base serves their rows (AC2)", async () => {
    const p = await page()
    const opened = await post("marc", { path: p.path, text: "Un fil que la base rend à Paul." })
    const thread = opened.data.thread.id
    const db = unfiltered()
    const paul = as("paul").identity

    expect({
      resolve: await refusal(setThreadStatus(db, paul, thread, { status: "resolved" })),
      edit: await refusal(editComment(db, paul, opened.data.comment, { text: "Réécrit." })),
      remove: await refusal(deleteComment(db, paul, opened.data.comment)),
    }).toEqual({
      resolve: { code: "not_found", message: `No comment thread ${thread} on a page of Acme Test.` },
      edit: { code: "not_found", message: `No comment ${opened.data.comment} on a page of Acme Test.` },
      remove: { code: "not_found", message: `No comment ${opened.data.comment} on a page of Acme Test.` },
    })
    expect(await threadsOf(p.id)).toMatchObject([{ id: thread, status: "open" }])
    expect((await commentsOf(p.id)).map((comment) => comment.text)).toEqual(["Un fil que la base rend à Paul."])
    // La même base sert le fil à qui lit la page : le refus de Paul ne tient pas à elle.
    expect((await setThreadStatus(db, as("marc").identity, thread, { status: "resolved" })).data.thread.status).toBe("resolved")
  })

  it("should refuse with a logged conflict a reply, an edit or a deletion that the resolution of the thread overtakes, and leave the resolved thread as it was (AC3)", async () => {
    const p = await page()
    const lea = o.people.lea.id
    const fresh = async () => {
      const opened = await post("marc", { path: p.path, text: "Fil de Marc." })
      const reply = await post("marc", { path: p.path, thread: opened.data.thread.id, text: "Suite." })
      return { thread: opened.data.thread.id, first: opened.data.comment, reply: reply.data.comment }
    }
    /** `run` sous Marc, le fil résolu par une autre transaction juste avant sa première écriture `op` de `target`. */
    async function overtaken(thread: string, [op, target]: [string, string], run: (db: PlatformDb, identity: Identity) => Promise<unknown>) {
      let raced = false
      const spied = spyDb(as("marc").db, {
        before: async (query) => {
          if (raced || query.op !== op || query.target !== target) return
          raced = true
          await fx.admin`update platform.comment_threads set status = 'resolved', resolved_by = ${lea}, resolved_at = now() where id = ${thread}`
        },
      })
      return { refused: await refusal(run(spied.db, as("marc").identity)), raced }
    }
    const [replied, edited, removed, whole] = [await fresh(), await fresh(), await fresh(), await fresh()]
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined)

    try {
      const outcomes = [
        await overtaken(replied.thread, ["insert", "comments"], (db, identity) => postComment(db, identity, { path: p.path, thread: replied.thread, text: "Trop tard." })),
        await overtaken(edited.thread, ["update", "comments"], (db, identity) => editComment(db, identity, edited.reply, { text: "Réécrite trop tard." })),
        await overtaken(removed.thread, ["delete", "comments"], (db, identity) => deleteComment(db, identity, removed.reply)),
        await overtaken(whole.thread, ["delete", "comment_threads"], (db, identity) => deleteComment(db, identity, whole.first)),
      ]

      const conflict = { refused: { code: "conflict", message: `The comments of ${p.path} changed meanwhile. Reload them and retry.` }, raced: true }
      expect(outcomes).toEqual([conflict, conflict, conflict, conflict])
      expect(logged.mock.calls).toEqual([
        ["[platform] comments: post: no row written", replied.thread],
        ["[platform] comments: edit: no row written", edited.reply],
        ["[platform] comments: delete: no row written", removed.reply],
        ["[platform] comments: delete: no row written", whole.first],
      ])
    } finally {
      logged.mockRestore()
    }
    expect((await threadsOf(p.id)).map(({ status, resolved_by }) => ({ status, resolved_by }))).toEqual(Array.from({ length: 4 }, () => ({ status: "resolved", resolved_by: lea })))
    expect((await commentsOf(p.id)).map(({ text, edited }) => ({ text, edited }))).toEqual(
      Array.from({ length: 4 }, () => [{ text: "Fil de Marc.", edited: false }, { text: "Suite.", edited: false }]).flat(),
    )
  })

  it("should append a reply at the end of an open thread, and refuse a reply, an edit or a deletion in a resolved thread (AC3)", async () => {
    const p = await page()
    const opened = await post("lea", { path: p.path, text: "Première remarque." })
    const thread = opened.data.thread.id

    const replied = await post("marc", { path: p.path, thread, text: "Réponse de Marc." })
    await post("lea", { path: p.path, thread, text: "Réponse de Léa." })
    expect(replied.data).toMatchObject({ created: false, thread: { id: thread } })
    expect((await commentsOf(p.id)).map((comment) => comment.text)).toEqual(["Première remarque.", "Réponse de Marc.", "Réponse de Léa."])

    await setThreadStatus(as("lea").db, as("lea").identity, thread, { status: "resolved" })
    expect(await writesUnder("marc", (db, identity) => postComment(db, identity, { path: p.path, thread, text: "Encore un mot." }))).toEqual({
      refused: { code: "conflict", message: `This comment thread of ${p.path} is resolved: reopen the thread, then reply.` },
      writes: [],
    })
    // Un fil résolu fige ses commentaires : leur auteur le rouvre avant de les modifier ou de les supprimer.
    expect(await writesUnder("lea", (db, identity) => editComment(db, identity, opened.data.comment, { text: "Réécrite." }))).toEqual({
      refused: { code: "conflict", message: `This comment thread of ${p.path} is resolved: reopen the thread, then edit your comment.` },
      writes: [],
    })
    expect(await writesUnder("lea", (db, identity) => deleteComment(db, identity, opened.data.comment))).toEqual({
      refused: { code: "conflict", message: `This comment thread of ${p.path} is resolved: reopen the thread, then delete your comment.` },
      writes: [],
    })
    expect(await commentsOf(p.id)).toHaveLength(3)
  })

  it("should let the author of a thread, or a writer of the page, resolve and reopen it, and tell any other reader whom to ask (AC4)", async () => {
    const p = await page()
    const ofMarc = (await post("marc", { path: p.path, text: "Fil de Marc." })).data.thread.id
    const ofLea = (await post("lea", { path: p.path, text: "Fil de Léa." })).data.thread.id
    const row = async (id: string) => (await threadsOf(p.id)).filter((thread) => thread.id === id).map(({ status, resolved_by, resolved }) => ({ status, resolved_by, resolved }))[0]

    // Son auteur, qui ne fait que lire la page.
    const byAuthor = await setThreadStatus(as("marc").db, as("marc").identity, ofMarc, { status: "resolved" })
    expect([byAuthor.data.thread, byAuthor.target, await row(ofMarc)]).toMatchObject([
      { status: "resolved", resolvedBy: "Marc Petit", canResolve: true },
      p.path,
      { status: "resolved", resolved_by: o.people.marc.id, resolved: true },
    ])
    expect((await listComments(as("lea").db, as("lea").identity, p.path)).threads.map((thread) => thread.id)).toEqual([ofLea, ofMarc])
    // Qui écrit la page, sans être l'auteur du fil : rouvrir, puis résoudre.
    await setThreadStatus(as("lea").db, as("lea").identity, ofMarc, { status: "open" })
    expect(await row(ofMarc)).toEqual({ status: "open", resolved_by: null, resolved: false })
    await setThreadStatus(as("lea").db, as("lea").identity, ofMarc, { status: "resolved" })
    expect(await row(ofMarc)).toEqual({ status: "resolved", resolved_by: o.people.lea.id, resolved: true })

    // Ni l'un ni l'autre : Marc sur le fil de Léa.
    const who = "its author (Léa Roux) and to those who can edit the page: team Ventes (lead: Claire Morel)"
    expect([
      await writesUnder("marc", (db, identity) => setThreadStatus(db, identity, ofLea, { status: "resolved" })),
      await writesUnder("marc", (db, identity) => setThreadStatus(db, identity, ofMarc, { status: "bogus" })),
    ]).toEqual([
      { refused: { code: "forbidden", message: `Resolving a comment thread of ${p.path} is reserved to ${who}. Ask them to resolve it.` }, writes: [] },
      { refused: { code: "invalid_arguments", message: expect.stringContaining("status") }, writes: [] },
    ])
    await setThreadStatus(as("lea").db, as("lea").identity, ofLea, { status: "resolved" })
    expect((await refusal(setThreadStatus(as("marc").db, as("marc").identity, ofLea, { status: "open" }))).message).toBe(
      `Reopening a comment thread of ${p.path} is reserved to ${who}. Ask them to reopen it.`,
    )
    expect(await row(ofLea)).toEqual({ status: "resolved", resolved_by: o.people.lea.id, resolved: true })
  })

  it("should let the author of a comment edit it, and nobody else, administrator included (AC5)", async () => {
    const p = await page()
    const opened = await post("marc", { path: p.path, text: "Premier jet." })

    const edited = await editComment(as("marc").db, as("marc").identity, opened.data.comment, { text: "Texte corrigé." })

    expect(edited.data.thread.comments).toMatchObject([{ text: "Texte corrigé.", mine: true, author: "Marc Petit" }])
    expect(edited.data.thread.comments[0].editedAt).not.toBeNull()
    expect(opened.data.thread.comments[0].editedAt).toBeNull()
    const reserved = { code: "forbidden", message: `Only its author (Marc Petit) can edit this comment of ${p.path}. Ask them, or reply in the thread.` }
    expect([
      await writesUnder("ada", (db, identity) => editComment(db, identity, opened.data.comment, { text: "Par l'administratrice." })),
      await writesUnder("lea", (db, identity) => editComment(db, identity, opened.data.comment, { text: "Par une rédactrice." })),
    ]).toEqual([
      { refused: reserved, writes: [] },
      { refused: reserved, writes: [] },
    ])
    expect(await commentsOf(p.id)).toEqual([{ author: o.people.marc.id, text: "Texte corrigé.", mentions: [], edited: true }])
  })

  it("should let the author of a comment delete it, the first comment taking the thread and its replies, and nobody else (AC6)", async () => {
    const p = await page()
    const opened = await post("marc", { path: p.path, text: "Fil à supprimer." })
    const thread = opened.data.thread.id
    const reply = await post("lea", { path: p.path, thread, text: "Réponse à retirer." })
    await post("lea", { path: p.path, thread, text: "Réponse gardée." })

    expect([
      await writesUnder("ada", (db, identity) => deleteComment(db, identity, opened.data.comment)),
      await writesUnder("marc", (db, identity) => deleteComment(db, identity, reply.data.comment)),
    ]).toEqual([
      { refused: { code: "forbidden", message: `Only its author (Marc Petit) can delete this comment of ${p.path}. Ask them.` }, writes: [] },
      { refused: { code: "forbidden", message: `Only its author (Léa Roux) can delete this comment of ${p.path}. Ask them.` }, writes: [] },
    ])

    const removed = await deleteComment(as("lea").db, as("lea").identity, reply.data.comment)
    expect(removed.data.thread?.comments.map((comment) => comment.text)).toEqual(["Fil à supprimer.", "Réponse gardée."])
    expect((await commentsOf(p.id)).map((comment) => comment.text)).toEqual(["Fil à supprimer.", "Réponse gardée."])

    const whole = await deleteComment(as("marc").db, as("marc").identity, opened.data.comment)
    expect(whole).toMatchObject({ data: { comment: opened.data.comment, thread: null }, target: p.path })
    expect([await threadsOf(p.id), await commentsOf(p.id)]).toEqual([[], []])
  })

  it("should serve the threads of a page, open first then the most recent, with authors, section, states and what the caller can do (AC7)", async () => {
    const p = await page()
    const first = (await post("marc", { path: p.path, text: "Sur la page." })).data.thread.id
    const second = (await post("lea", { path: p.path, block: p.price, quote: "100 euros", text: "Encore vrai ?" })).data.thread.id
    await post("marc", { path: p.path, thread: second, text: "Oui." })
    const third = (await post("marc", { path: p.path, block: p.intro, text: "Fil résolu." })).data.thread.id
    await setThreadStatus(as("marc").db, as("marc").identity, third, { status: "resolved" })

    const view = await listComments(as("marc").db, as("marc").identity, p.path)

    expect(view.path).toBe(p.path)
    expect(
      view.threads.map((thread) => ({
        id: thread.id,
        status: thread.status,
        anchor: thread.anchor,
        block: thread.block,
        quote: thread.quote,
        section: thread.section,
        canResolve: thread.canResolve,
        comments: thread.comments.map(({ author, mine, text }) => ({ author, mine, text })),
      })),
    ).toEqual([
      { id: second, status: "open", anchor: "intact", block: p.price, quote: "100 euros", section: "Tarifs", canResolve: false, comments: [{ author: "Léa Roux", mine: false, text: "Encore vrai ?" }, { author: "Marc Petit", mine: true, text: "Oui." }] },
      { id: first, status: "open", anchor: "page", block: null, quote: null, section: null, canResolve: true, comments: [{ author: "Marc Petit", mine: true, text: "Sur la page." }] },
      { id: third, status: "resolved", anchor: "intact", block: p.intro, quote: null, section: null, canResolve: true, comments: [{ author: "Marc Petit", mine: true, text: "Fil résolu." }] },
    ])
    // Qui écrit la page résout tous ses fils ; les lecteurs de la page, ceux qu'on peut mentionner : ni Paul ni l'équipe Support.
    expect((await listComments(as("lea").db, as("lea").identity, p.path)).threads.map((thread) => thread.canResolve)).toEqual([true, true, true])
    expect(view.readers.map((reader) => reader.name)).toEqual(["Ada Martin", "Claire Morel", "Léa Roux", "Marc Petit"])
  })

  describe("API", () => {
    function request(method: string, path: string, body?: unknown) {
      return new Request(`https://${o.host}/api/platform/${path}`, {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: { origin: `https://${o.host}`, "x-forwarded-proto": "https", "content-type": "application/json" },
      })
    }

    /** La réponse de la porte sous le jeton de `who`, puis ses lignes de journal, écrites après elle. */
    async function call(who: Who, method: string, path: string, body?: unknown) {
      const tasks: Task[] = []
      const response = await handlePlateforme(request(method, path, body), { accessToken: tokens.get(who), host: o.host, verifyToken: fx.verifyToken, defer: (task) => tasks.push(task) })
      for (const task of tasks) await task()
      return { status: response.status, body: await response.json() }
    }

    const journal = (target: string) => fx.admin<{ tool: string; user_id: string; team_id: string | null; is_error: boolean; error: string | null }[]>`
      select tool, user_id, team_id, is_error, error from platform.journal where org_id = ${o.org.id} and method = 'api' and target = ${target} order by ts, id`

    it("should answer each route with its code, journal each mutation under the path of the page, none for the reading, and refuse an invalid body with 400 (AC7, AC8)", async () => {
      const p = await page()
      const marc = o.people.marc.id

      const created = await call("marc", "POST", "comments", { path: p.path, block: p.price, text: "Par l'API." })
      const thread: string = created.body.data.thread.id
      const comment: string = created.body.data.comment
      const invalid = await call("marc", "POST", "comments", { path: p.path, text: "" })
      const unreadable = await call("paul", "POST", "comments", { path: p.path, text: "Je passe." })
      const edited = await call("marc", "PATCH", `comments/${comment}`, { text: "Par l'API, corrigé." })
      const refused = await call("ada", "PATCH", `comments/${comment}`, { text: "Par une autre." })
      const resolved = await call("marc", "PATCH", `comment-threads/${thread}`, { status: "resolved" })
      const read = await call("lea", "GET", `comments?path=${encodeURIComponent(p.path)}`)
      const hidden = await call("paul", "GET", `comments?path=${encodeURIComponent(p.path)}`)
      // Un fil résolu fige ses commentaires : la suppression est refusée, puis passe une fois le fil rouvert.
      const frozen = await call("marc", "DELETE", `comments/${comment}`)
      await call("marc", "PATCH", `comment-threads/${thread}`, { status: "open" })
      const removed = await call("marc", "DELETE", `comments/${comment}`)

      expect({
        created: [created.status, created.body.data.created, created.body.data.thread.comments[0].text],
        invalid: [invalid.status, invalid.body.error.code],
        unreadable: [unreadable.status, unreadable.body.error],
        edited: [edited.status, edited.body.data.thread.comments[0].text],
        refused: [refused.status, refused.body.error.code],
        resolved: [resolved.status, resolved.body.data.thread.status],
        read: [read.status, read.body.data.threads.map((served: { id: string; status: string }) => [served.id, served.status])],
        hidden: [hidden.status, hidden.body.error],
        frozen: [frozen.status, frozen.body.error.code],
        removed: [removed.status, removed.body.data],
      }).toEqual({
        created: [201, true, "Par l'API."],
        invalid: [400, "invalid_arguments"],
        unreadable: [404, { code: "not_found", message: `Unknown path ${p.path}.` }],
        edited: [200, "Par l'API, corrigé."],
        refused: [403, "forbidden"],
        resolved: [200, "resolved"],
        read: [200, [[thread, "resolved"]]],
        hidden: [404, { code: "not_found", message: `Unknown path ${p.path}.` }],
        frozen: [409, "conflict"],
        removed: [200, { comment, thread: null }],
      })
      // Une ligne par mutation servie ou refusée après la lecture du chemin, sous le chemin du nœud ; aucune pour `GET`.
      const ventes = o.teams.ventes
      expect(await journal(p.path)).toEqual([
        { tool: "POST comments", user_id: marc, team_id: ventes, is_error: false, error: null },
        { tool: "POST comments", user_id: o.people.paul.id, team_id: null, is_error: true, error: `not_found: Unknown path ${p.path}.` },
        { tool: "PATCH comments", user_id: marc, team_id: ventes, is_error: false, error: null },
        { tool: "PATCH comment-threads", user_id: marc, team_id: ventes, is_error: false, error: null },
        { tool: "PATCH comment-threads", user_id: marc, team_id: ventes, is_error: false, error: null },
        { tool: "DELETE comments", user_id: marc, team_id: ventes, is_error: false, error: null },
      ])
      expect((await journal(comment)).map(({ tool, is_error }) => [tool, is_error])).toEqual([
        ["PATCH comments", true],
        ["DELETE comments", true],
      ])
      expect([await threadsOf(p.id), await commentsOf(p.id)]).toEqual([[], []])
    })
  })

  it("should record the readers of the page mentioned by name, and leave any other name as text (AC9)", async () => {
    const p = await page()

    const opened = await post("marc", { path: p.path, text: "@Léa Roux et @Paul Girard, un avis ? Merci @Claire Morel." })
    const edited = await editComment(as("marc").db, as("marc").identity, opened.data.comment, { text: "@Ada Martin, un avis ?" })

    expect(opened.data.thread.comments[0].mentions).toEqual([
      { id: o.people.lea.id, name: "Léa Roux" },
      { id: o.people.claire.id, name: "Claire Morel" },
    ])
    expect(edited.data.thread.comments[0].mentions).toEqual([{ id: o.people.ada.id, name: "Ada Martin" }])
    expect((await commentsOf(p.id)).map((comment) => comment.mentions)).toEqual([[o.people.ada.id]])
  })

  it("should tell a commented block rewritten then published as changed since, and one deleted at the publication as deleted, its quote kept (AC10)", async () => {
    const p = await page()
    const rewritten = (await post("marc", { path: p.path, block: p.price, quote: "100 euros", text: "À revoir." })).data.thread.id
    const removed = (await post("marc", { path: p.path, block: p.intro, quote: "Avant le premier", text: "À garder ?" })).data.thread.id
    const kept = (await post("marc", { path: p.path, block: p.heading, text: "Bon titre." })).data.thread.id

    await writeNode(
      as("lea").db,
      as("lea").identity,
      { path: p.path, base_revision: p.revision, ops: [{ op: "replace_block", block: p.price, text: "Le tarif de base est de 120 euros." }, { op: "delete_block", block: p.intro }], publish: true },
      { kind: "human" },
    )

    const view = await listComments(as("marc").db, as("marc").identity, p.path)
    expect(Object.fromEntries(view.threads.map(({ id, anchor, block, quote, section }) => [id, { anchor, block, quote, section }]))).toEqual({
      [rewritten]: { anchor: "changed", block: p.price, quote: "100 euros", section: "Tarifs" },
      [removed]: { anchor: "deleted", block: null, quote: "Avant le premier", section: null },
      [kept]: { anchor: "intact", block: p.heading, quote: null, section: "Tarifs" },
    })
  })

  it("should take the threads away with a purged page, and keep the comments of a forgotten person without author (AC11)", async () => {
    const purged = await page()
    const p = await page()
    const zoe = await fx.createUser({ fullName: "Zoé Test" })
    await fx.addMember(o.org.id, zoe.id, { profile: { handle: `z${hex(3)}`, name: "Zoé Test" } })
    await fx.addRule({ orgId: o.org.id, nodeId: p.id, userId: zoe.id, level: "read" })
    const zoeDb = fx.as(zoe)
    const zoeIdentity = await resolveIdentity(zoeDb, o.host, { userId: zoe.id, email: zoe.email })
    const opened = await postComment(zoeDb, zoeIdentity, { path: p.path, text: "Fil de Zoé." })
    await post("marc", { path: p.path, thread: opened.data.thread.id, text: "Merci @Zoé Test." })
    await setThreadStatus(zoeDb, zoeIdentity, opened.data.thread.id, { status: "resolved" })
    await post("marc", { path: purged.path, text: "Sur la page purgée." })

    await fx.admin`update platform.nodes set deleted_at = now() - interval '31 days' where id = ${purged.id}`
    await as("lea").db.tx((sql) => sql`select nodes from platform.purge_trash(${o.org.id})`)
    await fx.admin`select platform.forget_user(${zoe.id})`

    const [left] = await fx.admin<{ threads: number; comments: number }[]>`
      select (select count(*)::int from platform.comment_threads where node_id = ${purged.id}) as threads,
             (select count(*)::int from platform.comments c where c.text = 'Sur la page purgée.' and c.org_id = ${o.org.id}) as comments`
    expect(left).toEqual({ threads: 0, comments: 0 })
    expect((await threadsOf(p.id)).map(({ status, resolved_by, resolved, created_by }) => ({ status, resolved_by, resolved, created_by }))).toEqual([
      { status: "resolved", resolved_by: null, resolved: true, created_by: null },
    ])
    expect(await commentsOf(p.id)).toEqual([
      { author: null, text: "Fil de Zoé.", mentions: [], edited: false },
      { author: o.people.marc.id, text: "Merci @Zoé Test.", mentions: [], edited: false },
    ])
    const [thread] = (await listComments(as("marc").db, as("marc").identity, p.path)).threads
    expect([thread.resolvedBy, thread.comments.map((comment) => comment.author)]).toEqual([null, [null, "Marc Petit"]])
  })
})
